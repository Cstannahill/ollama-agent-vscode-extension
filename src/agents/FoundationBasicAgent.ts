/**
 * Foundation-Enhanced Basic Agent
 * 
 * Integrates the full foundation pipeline into the basic agent workflow
 * providing sophisticated multi-stage reasoning and execution.
 */

import { OllamaLLM } from "../api/ollama";
import { ToolManager } from "../core/ToolManager";
import { ChatSession, AgentAction } from "../core/ChatSession";
import { ContextManager } from "../core/ContextManager";
import { VectorDatabase } from "../documentation/VectorDatabase";
import { logger } from "../utils/logger";
import { 
  agenticLogger, 
  logStageStart, 
  logStageEnd, 
  logToolExecution,
  logReasoning,
  AgentLogContext,
  ActionLogEntry 
} from "../utils/agentic-logger";
import * as vscode from "vscode";

// Foundation system imports
import { FoundationPipeline } from "../core/foundation/FoundationPipeline";
import { 
  FoundationAgentFactory, 
  FoundationAgentDependencies,
  FoundationAgents 
} from "../core/foundation/FoundationAgentFactory";
import { 
  FoundationPipelineConfig,
  FoundationPipelineResult 
} from "../core/foundation/IFoundationAgent";
import { LLMRouter, ProviderConfig, RoutingPreferences } from "../api/llm-router";
import { LMDeployConfig } from "../api/lmdeploy";

// Base agent imports
import {
  IAgent,
  AgentSpecialization,
  AgentCapability,
  TaskAnalysis,
  ProgressCallback,
  AgentResponse
} from "./IAgent";

import { ExtensionConfig } from "../config";

export interface FoundationBasicAgentConfig {
  ollamaUrl: string;
  model: string;
  temperature?: number;
  maxIterations?: number;
  verbose?: boolean;
  enableFoundationPipeline?: boolean;
  foundationConfig?: Partial<FoundationPipelineConfig>;
  // Add full extension config for vLLM integration
  extensionConfig?: ExtensionConfig;
}

/**
 * Enhanced Basic Agent with Foundation Pipeline Integration
 */
export class FoundationBasicAgent implements IAgent {
  public readonly specialization: AgentSpecialization = AgentSpecialization.GENERAL;
  public readonly capabilities: AgentCapability[] = [
    {
      name: "Code Analysis",
      description: "Analyze code structure, patterns, and quality",
      toolsRequired: ["file_read", "grep"],
      confidenceThreshold: 0.7
    },
    {
      name: "Task Planning",
      description: "Break down complex tasks into manageable steps",
      toolsRequired: [],
      confidenceThreshold: 0.8
    },
    {
      name: "Tool Usage",
      description: "Execute various development tools and commands",
      toolsRequired: ["shell_exec"],
      confidenceThreshold: 0.6
    },
    {
      name: "Reasoning",
      description: "Logical reasoning and problem solving",
      toolsRequired: [],
      confidenceThreshold: 0.7
    },
    {
      name: "Context Awareness",
      description: "Understand and utilize workspace context",
      toolsRequired: ["context_search"],
      confidenceThreshold: 0.8
    },
    {
      name: "Multi-step Execution",
      description: "Execute complex workflows with multiple steps",
      toolsRequired: [],
      confidenceThreshold: 0.7
    }
  ];

  private llm: OllamaLLM;
  private toolManager: ToolManager;
  private contextManager: ContextManager;
  private vectorDB?: VectorDatabase;
  private config: FoundationBasicAgentConfig;
  
  // Foundation system components
  private foundationFactory?: FoundationAgentFactory;
  private foundationPipeline?: FoundationPipeline;
  private foundationAgents?: FoundationAgents;
  private llmRouter?: LLMRouter;
  private foundationInitialized = false;
  
  // Agent caching system
  private static foundationCache: Map<string, FoundationAgentFactory> = new Map();
  private static pipelineCache: Map<string, FoundationPipeline> = new Map();
  private cacheKey: string;
  
  // Retry logic configuration
  private maxRetryAttempts = 3;
  private retryDelayMs = 1000;
  private currentRetryAttempt = 0;

  constructor(
    config: FoundationBasicAgentConfig,
    toolManager: ToolManager,
    contextManager: ContextManager,
    vectorDB?: VectorDatabase
  ) {
    this.config = {
      temperature: 0.3,
      maxIterations: 10,
      verbose: false,
      enableFoundationPipeline: true,
      ...config
    };

    this.llm = new OllamaLLM({
      baseUrl: config.ollamaUrl,
      model: config.model,
      temperature: this.config.temperature,
    });

    this.toolManager = toolManager;
    this.contextManager = contextManager;
    this.vectorDB = vectorDB;
    
    // Generate cache key based on configuration
    this.cacheKey = this.generateCacheKey(config);
  }
  
  /**
   * Generate cache key for foundation agents
   */
  private generateCacheKey(config: FoundationBasicAgentConfig): string {
    const keyComponents = [
      config.ollamaUrl,
      config.model,
      config.enableFoundationPipeline ? 'foundation' : 'basic',
      config.extensionConfig?.lmdeploy?.enabled ? 'lmdeploy' : 'ollama-only',
      // Include foundation models config to invalidate cache when models change
      JSON.stringify(config.extensionConfig?.foundation?.models || {})
    ];
    return keyComponents.join('|');
  }
  
  /**
   * Try to restore agents from cache
   */
  private tryRestoreFromCache(): boolean {
    try {
      // Check if foundation factory is cached
      const cachedFactory = FoundationBasicAgent.foundationCache.get(this.cacheKey);
      if (cachedFactory) {
        logger.info("[FOUNDATION_AGENT] Restoring foundation factory from cache");
        this.foundationFactory = cachedFactory;
        
        // Get the foundation agents from factory
        if (cachedFactory.getInitializationStatus && Object.values(cachedFactory.getInitializationStatus()).some(status => status)) {
          this.foundationAgents = (cachedFactory as any).agents;
          
          // Check for cached pipeline
          const cachedPipeline = FoundationBasicAgent.pipelineCache.get(this.cacheKey);
          if (cachedPipeline) {
            logger.info("[FOUNDATION_AGENT] Restoring foundation pipeline from cache");
            this.foundationPipeline = cachedPipeline;
            this.foundationInitialized = true;
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      logger.warn("[FOUNDATION_AGENT] Failed to restore from cache:", error);
      return false;
    }
  }
  
  /**
   * Cache foundation agents for reuse
   */
  private cacheFoundationSystem(): void {
    try {
      if (this.foundationFactory) {
        FoundationBasicAgent.foundationCache.set(this.cacheKey, this.foundationFactory);
        logger.debug("[FOUNDATION_AGENT] Cached foundation factory");
      }
      
      if (this.foundationPipeline) {
        FoundationBasicAgent.pipelineCache.set(this.cacheKey, this.foundationPipeline);
        logger.debug("[FOUNDATION_AGENT] Cached foundation pipeline");
      }
    } catch (error) {
      logger.warn("[FOUNDATION_AGENT] Failed to cache foundation system:", error);
    }
  }

  /**
   * Clear all foundation system caches (useful when models are updated)
   */
  public static clearFoundationCaches(): void {
    logger.info("[FOUNDATION_AGENT] Clearing all foundation system caches...");
    FoundationBasicAgent.foundationCache.clear();
    FoundationBasicAgent.pipelineCache.clear();
    // Also clear the FoundationAgentFactory singleton
    FoundationAgentFactory.resetInstance();
    
    // Clear OptimizedFoundationAgentFactory singleton too
    try {
      const { OptimizedFoundationAgentFactory } = require('../core/foundation/OptimizedFoundationAgentFactory');
      OptimizedFoundationAgentFactory.resetInstance();
      logger.info("[FOUNDATION_AGENT] Also cleared OptimizedFoundationAgentFactory singleton");
    } catch (error) {
      logger.debug("[FOUNDATION_AGENT] OptimizedFoundationAgentFactory not available for reset:", error);
    }
    
    logger.info("[FOUNDATION_AGENT] All foundation caches cleared");
  }

  /**
   * Initialize the foundation pipeline with caching support
   */
  async initializeFoundationSystem(): Promise<void> {
    if (this.foundationInitialized || !this.config.enableFoundationPipeline) {
      logger.debug("[FOUNDATION_AGENT] Foundation system already initialized or disabled");
      return;
    }
    
    // Try to restore from cache first
    if (this.tryRestoreFromCache()) {
      logger.info("[FOUNDATION_AGENT] Successfully restored foundation system from cache");
      return;
    }

    // Prevent concurrent initialization
    if (this.foundationInitialized === false) {
      this.foundationInitialized = true; // Set immediately to prevent race conditions
    }

    try {
      logger.info("[FOUNDATION_AGENT] Initializing foundation pipeline...");
      logger.info(`[FOUNDATION_AGENT] Foundation models config: ${JSON.stringify(this.config.extensionConfig?.foundation?.models || {}, null, 2)}`);

      // Initialize LLMRouter if ExtensionConfig is available
      if (this.config.extensionConfig) {
        const providerConfig: ProviderConfig = {
          ollama: {
            baseUrl: this.config.extensionConfig.ollamaUrl,
            model: this.config.extensionConfig.model,
            temperature: this.config.extensionConfig.temperature
          },
          lmdeploy: {
            baseUrl: this.config.extensionConfig.lmdeploy.serverUrl,
            model: this.config.extensionConfig.lmdeploy.model,
            sessionLen: this.config.extensionConfig.lmdeploy.sessionLen,
            maxBatchSize: this.config.extensionConfig.lmdeploy.maxBatchSize,
            tensorParallelSize: this.config.extensionConfig.lmdeploy.tensorParallelSize,
            cacheMaxEntryCount: this.config.extensionConfig.lmdeploy.cacheMaxEntryCount,
            engineType: this.config.extensionConfig.lmdeploy.engineType
          },
          lmdeployEnabled: this.config.extensionConfig.lmdeploy.enabled
        };

        const routingPreferences: RoutingPreferences = {
          chatPreference: this.config.extensionConfig.routing.chatPreference as "ollama" | "lmdeploy",
          embeddingPreference: this.config.extensionConfig.routing.embeddingPreference as "ollama" | "lmdeploy",
          toolCallingPreference: this.config.extensionConfig.routing.toolCallingPreference as "ollama" | "lmdeploy",
          batchProcessingPreference: this.config.extensionConfig.routing.batchProcessingPreference as "ollama" | "lmdeploy",
          preferSpeed: this.config.extensionConfig.routing.preferSpeed,
          preferAccuracy: false, // Default
          smallModelThreshold: "7b",
          largeModelThreshold: "13b",
          enableFallback: this.config.extensionConfig.routing.enableFallback,
          fallbackTimeout: this.config.extensionConfig.routing.fallbackTimeout
        };

        this.llmRouter = new LLMRouter(providerConfig, routingPreferences);
        logger.info(`🎯 [FOUNDATION_AGENT] LLMRouter initialized with LMDeploy ${this.config.extensionConfig.lmdeploy.enabled ? 'ENABLED' : 'DISABLED'}`);
      }

      // Create foundation agent factory
      const dependencies: FoundationAgentDependencies = {
        ollamaUrl: this.config.ollamaUrl,
        model: this.config.model,
        toolManager: this.toolManager,
        contextManager: this.contextManager,
        vectorDatabase: this.vectorDB,
        llmRouter: this.llmRouter, // Pass LLMRouter for vLLM integration
        extensionConfig: this.config.extensionConfig // Pass full extension config for per-agent models
      };

      this.foundationFactory = FoundationAgentFactory.getInstance(
        dependencies,
        this.config.foundationConfig || {}
      );

      // Create and initialize all foundation agents
      this.foundationAgents = await this.foundationFactory.createAgents();
      await this.foundationFactory.initializeAgents();

      // Create the foundation pipeline
      this.foundationPipeline = new FoundationPipeline(
        this.foundationAgents,
        this.foundationFactory['config'] // Access private config
      );

      await this.foundationPipeline.initialize();

      this.foundationInitialized = true;
      
      // Cache the successfully initialized system
      this.cacheFoundationSystem();
      
      logger.info("[FOUNDATION_AGENT] Foundation pipeline initialized successfully");

    } catch (error) {
      logger.error("[FOUNDATION_AGENT] Failed to initialize foundation pipeline:", error);
      // Reset initialization flag to allow retry, don't permanently disable
      this.foundationInitialized = false;
      
      // Increment retry counter and potentially retry
      this.currentRetryAttempt++;
      
      if (this.currentRetryAttempt < this.maxRetryAttempts) {
        logger.warn(`[FOUNDATION_AGENT] Initialization attempt ${this.currentRetryAttempt}/${this.maxRetryAttempts} failed, will retry`);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, this.retryDelayMs * this.currentRetryAttempt));
        
        // Retry initialization
        try {
          return await this.initializeFoundationSystem();
        } catch (retryError) {
          logger.error(`[FOUNDATION_AGENT] Retry attempt ${this.currentRetryAttempt} also failed:`, retryError);
          // Fall through to final error handling
        }
      }
      
      // Final failure after all retries
      logger.warn(`[FOUNDATION_AGENT] Foundation pipeline initialization failed after ${this.currentRetryAttempt} attempts, will use basic flow`);
      this.currentRetryAttempt = 0; // Reset for future attempts
      throw error; // Let the caller handle the failure
    }
  }

  /**
   * Execute task using foundation pipeline
   */
  async executeTask(
    task: string,
    session?: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse> {
    try {
      // Initialize foundation system if enabled and not initialized
      if (this.config.enableFoundationPipeline && !this.foundationInitialized) {
        try {
          await this.initializeFoundationSystem();
        } catch (initError) {
          logger.warn("[FOUNDATION_AGENT] Foundation initialization failed, using basic flow:", initError);
          progressCallback?.onThought?.("⚠️ Foundation pipeline unavailable, using basic execution...");
          return await this.executeWithBasicFlow(task, session, progressCallback);
        }
      }

      // Use foundation pipeline if available and properly initialized
      if (this.foundationPipeline && this.config.enableFoundationPipeline && this.foundationInitialized) {
        return await this.executeWithFoundationPipeline(task, session, progressCallback);
      } else {
        return await this.executeWithBasicFlow(task, session, progressCallback);
      }

    } catch (error) {
      logger.error("[FOUNDATION_AGENT] Task execution failed:", error);
      
      return {
        content: `Error executing task: ${error instanceof Error ? error.message : String(error)}`,
        actions: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
        agentType: this.specialization
      };
    }
  }

  /**
   * Execute task using the foundation pipeline
   */
  private async executeWithFoundationPipeline(
    task: string,
    session?: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse> {
    const sessionId = `foundation_${Date.now()}`;
    
    // Create agent context for logging
    const agentContext: AgentLogContext = {
      agentName: 'FoundationBasicAgent',
      agentType: 'FoundationBasicAgent',
      specialization: 'general',
      model: this.config.model,
      provider: 'ollama',
      sessionId: sessionId
    };

    try {
      progressCallback?.onThought?.("🚀 Starting foundation pipeline execution...");

      // Log agent initialization
      logStageStart('foundation_initialization', 'agent_execution', task, agentContext, sessionId);

      // Get available tools
      const availableTools = this.toolManager.getAllTools().map(tool => ({
        id: tool.name,
        name: tool.name,
        description: tool.description,
        category: 'general',
        parameters: {},
        examples: []
      }));

      // Get workspace context
      const workspaceContext = {
        workspaceFolders: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [],
        activeDocument: vscode.window.activeTextEditor?.document.fileName,
        extension: 'ollama-agent-vscode'
      };

      // Log context gathering
      agenticLogger.logAgentAction(
        agentContext,
        {
          actionType: 'reasoning',
          actionName: 'context_gathering',
          input: { availableTools: availableTools.length, workspaceContext },
          success: true
        },
        undefined,
        sessionId
      );

      // Execute foundation pipeline
      const startTime = Date.now();
      const pipelineResult: FoundationPipelineResult = await this.foundationPipeline!.execute(
        task,
        workspaceContext,
        availableTools,
        progressCallback
      );
      const pipelineDuration = Date.now() - startTime;

      // Log pipeline execution completion
      logStageEnd('foundation_pipeline', true, pipelineDuration, pipelineResult.confidence, pipelineResult, undefined, agentContext, sessionId);

      // Convert pipeline actions to agent actions
      const actions: AgentAction[] = [];
      
      // Track each pipeline stage as an action
      for (const stage of pipelineResult.stagesCompleted) {
        actions.push({
          thought: `Executing pipeline stage: ${stage}`,
          observation: `✅ ${stage} completed`,
          timestamp: new Date()
        });
      }

      // Execute the generated action calls
      if (pipelineResult.actionCalls && pipelineResult.actionCalls.length > 0) {
        progressCallback?.onAction?.("⚡ Executing planned actions...", pipelineResult.actionCalls);
        
        // Log start of tool execution phase
        logStageStart('tool_execution_phase', 'agent_execution', pipelineResult.actionCalls, agentContext, sessionId);
        
        for (const actionCall of pipelineResult.actionCalls) {
          const toolStartTime = Date.now();
          
          try {
            // Find the tool and execute it
            const tool = this.toolManager.getTool(actionCall.toolId);
            if (tool) {
              const result = await this.toolManager.executeTool(actionCall.toolId, actionCall.parameters);
              const toolDuration = Date.now() - toolStartTime;
              
              // Log successful tool execution
              logToolExecution(
                actionCall.toolId,
                agentContext,
                actionCall.parameters,
                result,
                toolDuration,
                true,
                undefined
              );
              
              actions.push({
                thought: `Executing tool: ${actionCall.toolId}`,
                toolCall: {
                  id: `${Date.now()}-${Math.random()}`,
                  toolName: actionCall.toolId,
                  input: actionCall.parameters,
                  output: String(result),
                  timestamp: new Date()
                },
                observation: String(result),
                timestamp: new Date()
              });
            } else {
              const toolDuration = Date.now() - toolStartTime;
              
              // Log tool not found
              logToolExecution(
                actionCall.toolId,
                agentContext,
                actionCall.parameters,
                undefined,
                toolDuration,
                false,
                'Tool not found'
              );
              
              actions.push({
                thought: `Attempting to execute tool: ${actionCall.toolId}`,
                observation: `Tool ${actionCall.toolId} not found`,
                timestamp: new Date()
              });
            }
          } catch (toolError) {
            const toolDuration = Date.now() - toolStartTime;
            const errorMsg = toolError instanceof Error ? toolError.message : String(toolError);
            
            // Log failed tool execution
            logToolExecution(
              actionCall.toolId,
              agentContext,
              actionCall.parameters,
              undefined,
              toolDuration,
              false,
              errorMsg
            );
            
            actions.push({
              thought: `Tool execution failed for: ${actionCall.toolId}`,
              observation: `Tool execution failed: ${errorMsg}`,
              timestamp: new Date()
            });
          }
        }

        // Log completion of tool execution phase
        const successfulTools = actions.filter(a => a.toolCall && !a.toolCall.error).length;
        logStageEnd('tool_execution_phase', true, undefined, undefined, { executedTools: successfulTools, totalTools: pipelineResult.actionCalls.length }, undefined, agentContext, sessionId);
      }

      // Generate final response based on pipeline reasoning
      let finalContent = "";
      
      // Log reasoning synthesis
      if (pipelineResult.reasoning) {
        const reasoningSteps = pipelineResult.reasoning.steps ? 
          pipelineResult.reasoning.steps.map(step => String(typeof step === 'string' ? step : (step as any).step || JSON.stringify(step))) :
          ['Pipeline reasoning completed'];
        
        logReasoning(
          agentContext,
          'chain_of_thought',
          reasoningSteps,
          pipelineResult.reasoning.confidence,
          undefined
        );
      }
      
      if (pipelineResult.reasoning?.conclusion) {
        finalContent = pipelineResult.reasoning.conclusion;
      } else {
        finalContent = "Task processed through foundation pipeline";
      }

      // Add execution summary if actions were performed
      if (actions.length > 0) {
        const successfulActions = actions.filter(a => a.toolCall && !a.toolCall.error).length;
        finalContent += `\n\nExecuted ${successfulActions}/${actions.length} actions successfully.`;
      }

      // Add pipeline confidence if available
      if (pipelineResult.confidence > 0) {
        finalContent += `\n\n*Confidence: ${(pipelineResult.confidence * 100).toFixed(1)}%*`;
      }

      // Store actions in session
      if (session) {
        for (const action of actions) {
          session.addAction(action);
        }
      }

      const response: AgentResponse = {
        content: finalContent,
        actions,
        success: pipelineResult.errors.length === 0,
        error: pipelineResult.errors.length > 0 ? pipelineResult.errors.join('; ') : undefined,
        agentType: this.specialization
      };
      
      progressCallback?.onComplete?.(response);

      return response;

    } catch (error) {
      logger.error("[FOUNDATION_AGENT] Foundation pipeline execution failed:", error);
      
      // Fallback to basic execution
      progressCallback?.onThought?.("⚠️ Foundation pipeline failed, falling back to basic execution...");
      return await this.executeWithBasicFlow(task, session, progressCallback);
    }
  }

  /**
   * Execute task using basic flow (fallback)
   */
  private async executeWithBasicFlow(
    task: string,
    session?: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse> {
    const sessionId = `basic_${Date.now()}`;
    
    // Create agent context for logging
    const agentContext: AgentLogContext = {
      agentName: 'FoundationBasicAgent',
      agentType: 'BasicFlow',
      specialization: 'general',
      model: this.config.model,
      provider: 'ollama',
      sessionId: sessionId
    };

    try {
      progressCallback?.onThought?.("🔧 Executing with basic agent flow...");

      // Log basic flow start
      logStageStart('basic_execution', 'agent_execution', task, agentContext, sessionId);

      // Simple execution using just the LLM and tool manager
      const prompt = `You are a helpful coding assistant. Complete this task: ${task}

Available tools: ${this.toolManager.getAllTools().map(t => t.name).join(', ')}

Think step by step and use tools as needed to complete the task.`;

      // Log prompt generation
      agenticLogger.logAgentAction(
        agentContext,
        {
          actionType: 'reasoning',
          actionName: 'prompt_generation',
          input: { task, availableTools: this.toolManager.getAllTools().length },
          success: true
        },
        undefined,
        sessionId
      );

      const startTime = Date.now();
      const response = await this.llm.generateText(prompt);
      const duration = Date.now() - startTime;
      
      // Log LLM response generation
      agenticLogger.logAgentAction(
        agentContext,
        {
          actionType: 'observation',
          actionName: 'llm_response',
          input: prompt,
          output: response,
          duration: duration,
          success: true
        },
        undefined,
        sessionId
      );
      
      const action: AgentAction = {
        thought: "Generating response using basic LLM flow",
        observation: response,
        timestamp: new Date()
      };

      if (session) {
        session.addAction(action);
      }

      const agentResponse: AgentResponse = {
        content: response,
        actions: [action],
        success: true,
        agentType: this.specialization
      };
      
      // Log basic flow completion
      logStageEnd('basic_execution', true, duration, undefined, response, undefined, agentContext, sessionId);
      
      progressCallback?.onComplete?.(agentResponse);

      return agentResponse;

    } catch (error) {
      logger.error("[FOUNDATION_AGENT] Basic flow execution failed:", error);
      
      return {
        content: `Failed to execute task: ${error instanceof Error ? error.message : String(error)}`,
        actions: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
        agentType: this.specialization
      };
    }
  }

  /**
   * Analyze task complexity and requirements
   */
  async analyzeTask(task: string): Promise<TaskAnalysis> {
    try {
      // Use foundation pipeline for analysis if available
      if (this.foundationPipeline && this.foundationInitialized) {
        // Get task planner for analysis
        const taskPlanner = this.foundationAgents?.taskPlanner;
        if (taskPlanner) {
          const taskPlan = await taskPlanner.planTask(task);
          
          return {
            complexity: taskPlan.steps.length > 5 ? 'high' : taskPlan.steps.length > 2 ? 'medium' : 'low',
            requiredCapabilities: this.inferCapabilitiesFromSteps(taskPlan.steps).map(cap => cap.name),
            estimatedDuration: taskPlan.estimatedDuration || 300,
            confidence: 0.8,
            reasoningSteps: taskPlan.successCriteria || [],
            primaryDomain: this.specialization
          };
        }
      }

      // Fallback analysis
      return {
        complexity: task.length > 200 ? 'high' : task.length > 50 ? 'medium' : 'low',
        requiredCapabilities: ["Tool Usage"],
        estimatedDuration: 120,
        confidence: 0.6,
        reasoningSteps: ["Use available tools to complete the task"],
        primaryDomain: this.specialization
      };

    } catch (error) {
      logger.error("[FOUNDATION_AGENT] Task analysis failed:", error);
      
      return {
        complexity: 'medium',
        requiredCapabilities: ["Tool Usage"],
        estimatedDuration: 180,
        confidence: 0.3,
        reasoningSteps: ["Manual task execution recommended"],
        primaryDomain: this.specialization
      };
    }
  }

  /**
   * Infer required capabilities from task steps
   */
  private inferCapabilitiesFromSteps(steps: any[]): AgentCapability[] {
    const capabilities: Set<AgentCapability> = new Set();
    
    for (const step of steps) {
      const action = step.action?.toLowerCase() || step.description?.toLowerCase() || '';
      
      if (action.includes('code') || action.includes('program')) {
        capabilities.add(this.capabilities.find(c => c.name === "Code Analysis")!);
      }
      if (action.includes('plan') || action.includes('strategy')) {
        capabilities.add(this.capabilities.find(c => c.name === "Task Planning")!);
      }
      if (action.includes('tool') || action.includes('execute')) {
        capabilities.add(this.capabilities.find(c => c.name === "Tool Usage")!);
      }
      if (action.includes('reason') || action.includes('analyze')) {
        capabilities.add(this.capabilities.find(c => c.name === "Reasoning")!);
      }
      if (steps.length > 1) {
        capabilities.add(this.capabilities.find(c => c.name === "Multi-step Execution")!);
      }
    }

    capabilities.add(this.capabilities.find(c => c.name === "Context Awareness")!); // Always context-aware
    
    return Array.from(capabilities);
  }

  /**
   * Get foundation pipeline statistics
   */
  getFoundationStatistics(): any {
    if (!this.foundationPipeline) {
      return { status: 'not_initialized' };
    }

    return {
      status: 'initialized',
      statistics: this.foundationPipeline.getStatistics(),
      initializationStatus: this.foundationFactory?.getInitializationStatus() || {},
      capabilities: this.foundationFactory?.getCapabilitiesSummary() || {}
    };
  }

  /**
   * Health check for foundation system
   */
  async healthCheck(): Promise<any> {
    if (!this.foundationFactory) {
      return { status: 'not_available' };
    }

    return await this.foundationFactory.healthCheck();
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    // Foundation system initialization is handled separately
    // to avoid blocking basic functionality
  }

  /**
   * Check if agent can handle the task
   */
  async canHandle(task: string, context?: any): Promise<TaskAnalysis> {
    return await this.analyzeTask(task);
  }

  /**
   * Get agent specialization
   */
  getSpecialization(): AgentSpecialization {
    return this.specialization;
  }

  /**
   * Get agent capabilities
   */
  getCapabilities(): AgentCapability[] {
    return this.capabilities;
  }

  /**
   * Get agent configuration
   */
  getConfiguration(): any {
    return this.config;
  }

  /**
   * Update agent configuration
   */
  updateConfiguration(config: any): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if agent is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.llm.generateText("test");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get prompt templates
   */
  getPromptTemplates(): Record<string, string> {
    return {
      foundation_pipeline: "Execute task using the foundation pipeline with multi-stage reasoning.",
      basic_execution: "Execute task using basic agent capabilities.",
      task_analysis: "Analyze task complexity and requirements."
    };
  }

  /**
   * Validate task requirements
   */
  async validateTask(task: string): Promise<{valid: boolean; issues: string[]; suggestions: string[]}> {
    const issues: string[] = [];
    const suggestions: string[] = [];

    if (!task || task.trim().length === 0) {
      issues.push("Task description is empty");
      suggestions.push("Provide a clear description of what you want to accomplish");
    }

    if (task.length > 2000) {
      issues.push("Task description is very long");
      suggestions.push("Consider breaking down the task into smaller, more focused requests");
    }

    return {
      valid: issues.length === 0,
      issues,
      suggestions
    };
  }
}