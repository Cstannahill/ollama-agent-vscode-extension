import { IAgent, AgentSpecialization, TaskAnalysis, AgentResponse, ProgressCallback } from "./IAgent";
import { BasicAgent, AgentConfig } from "./BasicAgent";
import { FoundationBasicAgent, FoundationBasicAgentConfig } from "./FoundationBasicAgent";
import { CodeReviewAgent } from "./CodeReviewAgent";
import { TestAutomationAgent } from "./TestAutomationAgent";
import { DevOpsAgent } from "./DevOpsAgent";
import { DocumentationAgent } from "./DocumentationAgent";
import { RefactoringAgent } from "./RefactoringAgent";
import { SmartAgentRouter, RouterDecision } from "./SmartAgentRouter";
import { ToolManager } from "../core/ToolManager";
import { ContextManager } from "../core/ContextManager";
import { OllamaLLM } from "../api/ollama";
import { ExtensionConfig } from "../config";
import { logger } from "../utils/logger";
import { 
  agenticLogger, 
  logStageStart, 
  logStageEnd, 
  AgentLogContext,
  ActionLogEntry 
} from "../utils/agentic-logger";

export interface TaskKeyword {
  keywords: string[];
  specialization: AgentSpecialization;
  weight: number;
}

export interface AgentFactoryConfig {
  defaultAgent: AgentSpecialization;
  selectionThreshold: number;
  enableMultiAgentWorkflows: boolean;
  taskAnalysisModel?: string;
  useSmartRouter: boolean;
}

/**
 * Factory for creating and selecting appropriate agents based on task analysis
 */
export class AgentFactory {
  private agents: Map<AgentSpecialization, IAgent> = new Map();
  private taskKeywords: TaskKeyword[] = [];
  private llm: OllamaLLM;
  private config: AgentFactoryConfig;
  private smartRouter?: SmartAgentRouter;

  constructor(
    private agentConfig: AgentConfig,
    private toolManager: ToolManager,
    private contextManager?: ContextManager,
    factoryConfig?: Partial<AgentFactoryConfig>,
    private extensionConfig?: ExtensionConfig
  ) {
    this.config = {
      defaultAgent: AgentSpecialization.GENERAL,
      selectionThreshold: 0.7,
      enableMultiAgentWorkflows: true,
      useSmartRouter: true,
      ...factoryConfig
    };

    this.llm = new OllamaLLM({
      baseUrl: agentConfig.ollamaUrl,
      model: this.config.taskAnalysisModel || agentConfig.model,
      temperature: 0.3 // Lower temperature for more consistent task analysis
    });

    this.initializeTaskKeywords();
    this.initializeAgents();
    
    // Initialize smart router if enabled
    if (this.config.useSmartRouter) {
      this.smartRouter = new SmartAgentRouter(
        agentConfig.ollamaUrl,
        agentConfig.model,
        this
      );
    }
  }

  /**
   * Initialize task keyword patterns for quick agent selection
   */
  private initializeTaskKeywords(): void {
    this.taskKeywords = [
      // Code Review patterns
      {
        keywords: ["review", "lint", "analyze", "check", "quality", "security", "vulnerability", "eslint", "prettier", "typescript", "complexity"],
        specialization: AgentSpecialization.CODE_REVIEW,
        weight: 1.0
      },
      // Testing patterns  
      {
        keywords: ["test", "testing", "jest", "mocha", "vitest", "pytest", "coverage", "unit test", "integration test", "e2e", "tdd", "bdd"],
        specialization: AgentSpecialization.TEST_AUTOMATION,
        weight: 1.0
      },
      // DevOps patterns
      {
        keywords: ["git", "commit", "push", "pull", "merge", "branch", "deploy", "deployment", "ci", "cd", "pipeline", "build", "release"],
        specialization: AgentSpecialization.DEVOPS,
        weight: 1.0
      },
      // Documentation patterns
      {
        keywords: ["document", "readme", "markdown", "docs", "api docs", "changelog", "wiki", "comment", "jsdoc", "typescript docs"],
        specialization: AgentSpecialization.DOCUMENTATION,
        weight: 1.0
      },
      // Refactoring patterns
      {
        keywords: ["refactor", "refactoring", "restructure", "optimize", "improve", "modernize", "clean up", "architecture", "design pattern"],
        specialization: AgentSpecialization.REFACTORING,
        weight: 1.0
      }
    ];
  }

  /**
   * Initialize all available agents
   */
  private async initializeAgents(): Promise<void> {
    try {
      // Create foundation-enhanced BasicAgent as primary general agent
      const foundationBasicAgent = new FoundationBasicAgent(
        {
          ollamaUrl: this.agentConfig.ollamaUrl,
          model: this.agentConfig.model,
          temperature: 0.3,
          enableFoundationPipeline: true,
          extensionConfig: this.extensionConfig // Pass full config for vLLM support
        },
        this.toolManager,
        this.contextManager!
      );
      this.agents.set(AgentSpecialization.GENERAL, foundationBasicAgent);

      // Also create fallback BasicAgent
      const basicAgent = new BasicAgent(this.agentConfig, this.toolManager, this.contextManager);
      await basicAgent.initialize();
      // Store as fallback but don't override the foundation agent
      
      // Initialize specialized agents
      const codeReviewAgent = new CodeReviewAgent(this.agentConfig, this.toolManager, this.contextManager, undefined, {
        enableFoundationPipeline: true
      });
      this.agents.set(AgentSpecialization.CODE_REVIEW, codeReviewAgent);

      const testAutomationAgent = new TestAutomationAgent(this.agentConfig, this.toolManager, this.contextManager, {
        enableFoundationPipeline: true
      });
      this.agents.set(AgentSpecialization.TEST_AUTOMATION, testAutomationAgent);

      // DevOps agent with foundation pipeline (has different constructor signature)
      const devopsAgent = new DevOpsAgent(this.agentConfig, this.toolManager, this.contextManager, {
        enableFoundationPipeline: true
      });
      this.agents.set(AgentSpecialization.DEVOPS, devopsAgent);

      // Documentation and Refactoring agents (keep original constructors for now)
      const documentationAgent = new DocumentationAgent(this.agentConfig, this.toolManager, this.contextManager);
      this.agents.set(AgentSpecialization.DOCUMENTATION, documentationAgent);

      const refactoringAgent = new RefactoringAgent(this.agentConfig, this.toolManager, this.contextManager);
      this.agents.set(AgentSpecialization.REFACTORING, refactoringAgent);

      logger.info(`[AGENT_FACTORY] Initialized ${this.agents.size} agents with foundation-enhanced general agent`);
    } catch (error) {
      logger.error("[AGENT_FACTORY] Failed to initialize agents:", error);
      throw error;
    }
  }

  /**
   * Register a new agent type
   */
  public registerAgent(specialization: AgentSpecialization, agent: IAgent): void {
    this.agents.set(specialization, agent);
    logger.info(`[AGENT_FACTORY] Registered ${specialization} agent`);
  }

  /**
   * Get the most appropriate agent for a given task
   */
  public async selectBestAgent(task: string, context?: any, progressCallback?: ProgressCallback): Promise<{agent: IAgent; analysis: TaskAnalysis; routerDecision?: RouterDecision}> {
    const sessionId = `agent_selection_${Date.now()}`;
    
    // Create agent context for factory logging
    const factoryContext: AgentLogContext = {
      agentName: 'AgentFactory',
      agentType: 'AgentFactory',
      specialization: 'routing',
      model: this.agentConfig.model,
      provider: 'ollama',
      sessionId: sessionId
    };

    try {
      logger.debug(`[AGENT_FACTORY] Selecting best agent for task: ${task.substring(0, 100)}...`);
      
      // Log agent selection start
      logStageStart('agent_selection', 'agent_execution', task, factoryContext, sessionId);
      
      // Use smart router if available and enabled
      if (this.smartRouter && this.config.useSmartRouter) {
        try {
          // Log smart router attempt
          agenticLogger.logAgentAction(
            factoryContext,
            {
              actionType: 'reasoning',
              actionName: 'smart_router_analysis',
              input: { task, useSmartRouter: true }
            },
            undefined,
            sessionId
          );

          const routerStartTime = Date.now();
          const routerResult = await this.smartRouter.getBestAgent(task, context, progressCallback);
          const routerDuration = Date.now() - routerStartTime;
          
          // Log smart router success
          agenticLogger.logAgentAction(
            factoryContext,
            {
              actionType: 'observation',
              actionName: 'smart_router_decision',
              output: {
                selectedAgent: routerResult.decision.selectedAgent,
                confidence: routerResult.decision.confidence,
                reasoning: routerResult.decision.reasoning
              },
              duration: routerDuration,
              confidence: routerResult.decision.confidence,
              success: true
            },
            undefined,
            sessionId
          );

          logger.info(`[AGENT_FACTORY] Smart router selected ${routerResult.decision.selectedAgent} with confidence ${routerResult.decision.confidence}`);
          
          // Log successful agent selection completion
          logStageEnd('agent_selection', true, routerDuration, routerResult.decision.confidence, routerResult.decision, undefined, factoryContext, sessionId);
          
          return {
            agent: routerResult.agent,
            analysis: routerResult.analysis,
            routerDecision: routerResult.decision
          };
        } catch (error) {
          // Log smart router failure
          agenticLogger.logAgentAction(
            factoryContext,
            {
              actionType: 'observation',
              actionName: 'smart_router_failure',
              error: error instanceof Error ? error.message : String(error),
              success: false
            },
            undefined,
            sessionId
          );

          logger.warn("[AGENT_FACTORY] Smart router failed, falling back to keyword analysis:", error);
          progressCallback?.onThought?.("⚠️ Smart router failed, using keyword fallback...");
        }
      }
      
      // Fallback: keyword-based selection
      logger.debug("[AGENT_FACTORY] Using keyword-based agent selection");

      // Log keyword analysis start
      agenticLogger.logAgentAction(
        factoryContext,
        {
          actionType: 'reasoning',
          actionName: 'keyword_analysis',
          input: { task, fallbackMode: !this.config.useSmartRouter }
        },
        undefined,
        sessionId
      );

      // First, try quick keyword-based selection
      const keywordMatch = this.analyzeTaskKeywords(task);
      
      // Get detailed analysis from all available agents
      const agentAnalyses: Array<{agent: IAgent; analysis: TaskAnalysis}> = [];
      
      for (const [specialization, agent] of this.agents.entries()) {
        try {
          const analysis = await agent.canHandle(task, context);
          agentAnalyses.push({ agent, analysis });
          
          logger.debug(`[AGENT_FACTORY] ${specialization} confidence: ${analysis.confidence}`);
        } catch (error) {
          logger.warn(`[AGENT_FACTORY] Failed to analyze task for ${specialization}:`, error);
        }
      }

      // Sort by confidence and apply keyword boost
      agentAnalyses.sort((a, b) => {
        let scoreA = a.analysis.confidence;
        let scoreB = b.analysis.confidence;

        // Apply keyword boost
        if (keywordMatch && a.agent.getSpecialization() === keywordMatch.specialization) {
          scoreA += keywordMatch.weight * 0.2; // 20% boost for keyword match
        }
        if (keywordMatch && b.agent.getSpecialization() === keywordMatch.specialization) {
          scoreB += keywordMatch.weight * 0.2;
        }

        return scoreB - scoreA;
      });

      const bestMatch = agentAnalyses[0];
      
      // Log agent analysis results
      agenticLogger.logAgentAction(
        factoryContext,
        {
          actionType: 'observation',
          actionName: 'agent_analysis_complete',
          output: {
            totalAgents: agentAnalyses.length,
            bestMatch: bestMatch?.agent.getSpecialization(),
            bestConfidence: bestMatch?.analysis.confidence,
            keywordMatch: keywordMatch?.specialization,
            threshold: this.config.selectionThreshold
          },
          success: true
        },
        undefined,
        sessionId
      );
      
      if (bestMatch && bestMatch.analysis.confidence >= this.config.selectionThreshold) {
        logger.info(`[AGENT_FACTORY] Selected ${bestMatch.agent.getSpecialization()} agent (confidence: ${bestMatch.analysis.confidence})`);
        
        // Log successful agent selection
        logStageEnd('agent_selection', true, undefined, bestMatch.analysis.confidence, bestMatch.agent.getSpecialization(), undefined, factoryContext, sessionId);
        
        return bestMatch;
      }

      // Fallback to default agent
      const defaultAgent = this.agents.get(this.config.defaultAgent);
      if (!defaultAgent) {
        throw new Error(`Default agent ${this.config.defaultAgent} not available`);
      }

      // Log default agent selection
      agenticLogger.logAgentAction(
        factoryContext,
        {
          actionType: 'observation',
          actionName: 'default_agent_fallback',
          output: { selectedAgent: this.config.defaultAgent, reason: 'no_confident_match' },
          confidence: 0.5,
          success: true
        },
        undefined,
        sessionId
      );

      logger.info(`[AGENT_FACTORY] Using default ${this.config.defaultAgent} agent (no confident match found)`);
      
      const defaultResult = {
        agent: defaultAgent,
        analysis: {
          primaryDomain: this.config.defaultAgent,
          confidence: 0.5,
          reasoningSteps: ["No specialized agent found, using default"],
          requiredCapabilities: [],
          complexity: "medium" as const,
          estimatedDuration: 30000
        }
      };

      // Log default agent selection completion
      logStageEnd('agent_selection', true, undefined, 0.5, this.config.defaultAgent, undefined, factoryContext, sessionId);
      
      return defaultResult;

    } catch (error) {
      logger.error("[AGENT_FACTORY] Agent selection failed:", error);
      
      // Emergency fallback to BasicAgent
      const basicAgent = this.agents.get(AgentSpecialization.GENERAL);
      if (!basicAgent) {
        throw new Error("No agents available, including fallback");
      }

      return {
        agent: basicAgent,
        analysis: {
          primaryDomain: AgentSpecialization.GENERAL,
          confidence: 0.3,
          reasoningSteps: ["Emergency fallback due to selection error"],
          requiredCapabilities: [],
          complexity: "high",
          estimatedDuration: 60000
        }
      };
    }
  }

  /**
   * Quick keyword-based task analysis
   */
  private analyzeTaskKeywords(task: string): TaskKeyword | null {
    const lowerTask = task.toLowerCase();
    
    for (const keywordSet of this.taskKeywords) {
      const matchCount = keywordSet.keywords.filter(keyword => 
        lowerTask.includes(keyword.toLowerCase())
      ).length;

      if (matchCount > 0) {
        const confidence = Math.min(matchCount / keywordSet.keywords.length, 1.0);
        return {
          ...keywordSet,
          weight: confidence
        };
      }
    }

    return null;
  }

  /**
   * Execute a task with automatic agent selection
   */
  public async executeTask(
    task: string,
    context?: any,
    progressCallback?: (response: AgentResponse) => void
  ): Promise<AgentResponse> {
    try {
      const { agent, analysis } = await this.selectBestAgent(task, context);
      
      const response = await agent.executeTask(task, undefined, {
        onComplete: progressCallback
      });

      // Add agent selection metadata to response
      response.metadata = {
        ...response.metadata,
        selectedAgent: agent.getSpecialization(),
        selectionAnalysis: analysis,
        factoryVersion: "1.0.0"
      };

      return response;

    } catch (error) {
      logger.error("[AGENT_FACTORY] Task execution failed:", error);
      
      return {
        content: `Task execution failed: ${error instanceof Error ? error.message : String(error)}`,
        actions: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
        agentType: AgentSpecialization.GENERAL,
        confidence: 0
      };
    }
  }

  /**
   * Get all available agents
   */
  public getAvailableAgents(): Array<{specialization: AgentSpecialization; agent: IAgent}> {
    return Array.from(this.agents.entries()).map(([specialization, agent]) => ({
      specialization,
      agent
    }));
  }

  /**
   * Get agent by specialization
   */
  public getAgent(specialization: AgentSpecialization): IAgent | undefined {
    return this.agents.get(specialization);
  }

  /**
   * Check if a specific agent type is available
   */
  public hasAgent(specialization: AgentSpecialization): boolean {
    return this.agents.has(specialization);
  }

  /**
   * Update factory configuration
   */
  public updateConfiguration(config: Partial<AgentFactoryConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info("[AGENT_FACTORY] Configuration updated");
  }

  /**
   * Get factory statistics
   */
  public getStatistics(): {
    totalAgents: number;
    availableSpecializations: AgentSpecialization[];
    defaultAgent: AgentSpecialization;
    selectionThreshold: number;
  } {
    return {
      totalAgents: this.agents.size,
      availableSpecializations: Array.from(this.agents.keys()),
      defaultAgent: this.config.defaultAgent,
      selectionThreshold: this.config.selectionThreshold
    };
  }
}