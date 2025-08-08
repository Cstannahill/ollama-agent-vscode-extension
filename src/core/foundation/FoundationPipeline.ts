/**
 * Foundation Pipeline - Orchestrates the 10 specialized AI agents
 * 
 * This is the core of our agentic system that coordinates all foundation agents
 * in a sophisticated multi-stage pipeline for each user request.
 */

import { logger } from "../../utils/logger";
import { 
  agenticLogger, 
  logPipelineStart, 
  logPipelineEnd, 
  logStageStart, 
  logStageEnd, 
  logModelRouting,
  AgentLogContext,
  ActionLogEntry,
  StageLogEntry
} from "../../utils/agentic-logger";
import { ProgressCallback } from "../../agents/IAgent";
import {
  IFoundationAgent,
  IRetrieverAgent,
  IRerankerAgent,
  IToolSelectorAgent,
  ICriticAgent,
  ITaskPlannerAgent,
  IQueryRewriterAgent,
  ICoTGeneratorAgent,
  IChunkScorerAgent,
  IActionCallerAgent,
  IEmbedderAgent,
  FoundationPipelineConfig,
  FoundationPipelineResult,
  RetrievalResult,
  RerankResult,
  ToolSelectionResult,
  TaskPlan,
  ChainOfThought,
  ActionCall,
  EvaluationResult,
  ExpandedQuery,
} from "./IFoundationAgent";
import { ProviderOptimizer } from "./adapters/ProviderOptimizer";
import { LLMRouter, LLMProvider } from "../../api/llm-router";
import chalk from "chalk";

export interface PipelineStage {
  name: string;
  agent: IFoundationAgent;
  execute: (input: any, context: PipelineContext) => Promise<any>;
  dependencies: string[];
  parallel: boolean;
  critical: boolean; // If true, pipeline fails if this stage fails
}

export interface PipelineContext {
  originalQuery: string;
  expandedQuery?: ExpandedQuery;
  workspaceContext?: any;
  availableTools?: any[];
  previousResults?: Map<string, any>;
  userPreferences?: any;
  progressCallback?: ProgressCallback;
  
  // Enhanced context features
  semanticContext?: SemanticContext;
  accumulatedInsights?: Map<string, any>;
  contextConfidence?: number;
  stageContext?: Map<string, any>;
  contextManager?: any;
  vectorDatabase?: any;
}

export interface SemanticContext {
  queryEmbedding?: number[];
  workspaceEmbeddings?: number[];
  domainKnowledge?: Array<{
    content: string;
    relevance: number;
    source: string;
  }>;
  historicalPatterns?: Array<{
    pattern: string;
    confidence: number;
    usage: string;
  }>;
  contextualInsights?: Array<{
    stage: string;
    insight: string;
    confidence: number;
    timestamp: Date;
  }>;
}

/**
 * Foundation Pipeline - Core agentic reasoning system
 */
export class FoundationPipeline {
  private retriever: IRetrieverAgent;
  private reranker: IRerankerAgent;
  private toolSelector: IToolSelectorAgent;
  private critic: ICriticAgent;
  private taskPlanner: ITaskPlannerAgent;
  private queryRewriter: IQueryRewriterAgent;
  private cotGenerator: ICoTGeneratorAgent;
  private chunkScorer: IChunkScorerAgent;
  private actionCaller: IActionCallerAgent;
  private embedder: IEmbedderAgent;
  
  private config: FoundationPipelineConfig;
  private stages: Map<string, PipelineStage> = new Map();
  private initialized = false;
  
  // Provider optimization integration
  private providerOptimizer?: ProviderOptimizer;
  private llmRouter?: LLMRouter;
  private stageProviders: Map<string, { provider: LLMProvider; decision: any }> = new Map();

  constructor(
    agents: {
      retriever: IRetrieverAgent;
      reranker: IRerankerAgent;
      toolSelector: IToolSelectorAgent;
      critic: ICriticAgent;
      taskPlanner: ITaskPlannerAgent;
      queryRewriter: IQueryRewriterAgent;
      cotGenerator: ICoTGeneratorAgent;
      chunkScorer: IChunkScorerAgent;
      actionCaller: IActionCallerAgent;
      embedder: IEmbedderAgent;
    },
    config: FoundationPipelineConfig,
    llmRouter?: LLMRouter
  ) {
    this.retriever = agents.retriever;
    this.reranker = agents.reranker;
    this.toolSelector = agents.toolSelector;
    this.critic = agents.critic;
    this.taskPlanner = agents.taskPlanner;
    this.queryRewriter = agents.queryRewriter;
    this.cotGenerator = agents.cotGenerator;
    this.chunkScorer = agents.chunkScorer;
    this.actionCaller = agents.actionCaller;
    this.embedder = agents.embedder;
    
    this.config = config;
    this.llmRouter = llmRouter;
    
    // Initialize provider optimization if router is available
    if (this.llmRouter) {
      this.providerOptimizer = new ProviderOptimizer(this.llmRouter);
      logger.info(chalk.green("[FOUNDATION_PIPELINE] Provider optimization enabled"));
    }
    
    this.initializePipelineStages();
  }

  /**
   * Initialize the pipeline stages with their dependencies and execution logic
   */
  private initializePipelineStages(): void {
    // Stage 1: Query Rewriting (expand and optimize the user query)
    this.stages.set('query_rewriting', {
      name: 'Query Rewriting',
      agent: this.queryRewriter,
      dependencies: [],
      parallel: false,
      critical: false,
      execute: async (input: string, context: PipelineContext) => {
        context.progressCallback?.onThought?.("🔄 Expanding and optimizing query...");
        const expandedQuery = await this.queryRewriter.expandQuery(input, JSON.stringify(context.workspaceContext));
        context.expandedQuery = expandedQuery;
        return expandedQuery;
      }
    });

    // Stage 2: Retrieval (fetch relevant context using expanded query)
    this.stages.set('retrieval', {
      name: 'Context Retrieval',
      agent: this.retriever,
      dependencies: ['query_rewriting'],
      parallel: false,
      critical: true,
      execute: async (expandedQuery: ExpandedQuery, context: PipelineContext) => {
        context.progressCallback?.onThought?.("🔍 Retrieving relevant context...");
        const retrievalResults = await this.retriever.retrieveWithContext(
          expandedQuery.expanded,
          'code',
          20
        );
        return retrievalResults;
      }
    });

    // Stage 3: Reranking (score and reorder retrieved content)
    this.stages.set('reranking', {
      name: 'Content Reranking',
      agent: this.reranker,
      dependencies: ['retrieval'],
      parallel: false,
      critical: false,
      execute: async (retrievalResults: RetrievalResult[], context: PipelineContext) => {
        context.progressCallback?.onThought?.("📊 Reranking content by relevance...");
        const rerankedResults = await this.reranker.rerank(
          context.expandedQuery?.expanded || context.originalQuery,
          retrievalResults
        );
        return rerankedResults.slice(0, 10); // Keep top 10
      }
    });

    // Stage 4: Chunk Scoring (extract most relevant portions)
    this.stages.set('chunk_scoring', {
      name: 'Chunk Scoring',
      agent: this.chunkScorer,
      dependencies: ['reranking'],
      parallel: true,
      critical: false,
      execute: async (rerankedResults: RerankResult[], context: PipelineContext) => {
        context.progressCallback?.onThought?.("📝 Scoring content chunks...");
        const query = context.expandedQuery?.expanded || context.originalQuery;
        
        // Score chunks in parallel
        const scoredChunks = await Promise.all(
          rerankedResults.map(async (result) => ({
            ...result,
            chunkScore: await this.chunkScorer.scoreChunk(result.content, query)
          }))
        );
        
        return scoredChunks.sort((a, b) => b.chunkScore.score - a.chunkScore.score);
      }
    });

    // Stage 5: Tool Selection (identify needed tools for the task)
    this.stages.set('tool_selection', {
      name: 'Tool Selection',
      agent: this.toolSelector,
      dependencies: ['query_rewriting'],
      parallel: true,
      critical: true,
      execute: async (expandedQuery: ExpandedQuery, context: PipelineContext) => {
        context.progressCallback?.onThought?.("🛠️ Selecting appropriate tools...");
        const toolSelection = await this.toolSelector.selectTools(
          expandedQuery.expanded,
          context.availableTools || []
        );
        return toolSelection;
      }
    });

    // Stage 6: Task Planning (create execution plan)
    this.stages.set('task_planning', {
      name: 'Task Planning',
      agent: this.taskPlanner,
      dependencies: ['tool_selection', 'chunk_scoring'],
      parallel: false,
      critical: true,
      execute: async (input: any, context: PipelineContext) => {
        context.progressCallback?.onThought?.("📋 Creating task execution plan...");
        const toolSelection = context.previousResults?.get('tool_selection') as ToolSelectionResult;
        
        const taskPlan = await this.taskPlanner.planTask(
          context.expandedQuery?.expanded || context.originalQuery,
          {
            availableTools: toolSelection.selectedTools,
            workspaceInfo: context.workspaceContext,
            timeConstraints: this.config.timeoutMs
          }
        );
        return taskPlan;
      }
    });

    // Stage 7: Chain of Thought Generation (reasoning for the approach)
    this.stages.set('cot_generation', {
      name: 'Chain of Thought',
      agent: this.cotGenerator,
      dependencies: ['task_planning'],
      parallel: true,
      critical: false,
      execute: async (taskPlan: TaskPlan, context: PipelineContext) => {
        context.progressCallback?.onThought?.("🧠 Generating reasoning chain...");
        const cotResult = await this.cotGenerator.generateReasoning(
          context.originalQuery,
          JSON.stringify({
            plan: taskPlan,
            context: context.workspaceContext
          })
        );
        return cotResult;
      }
    });

    // Stage 8: Action Call Generation (create executable actions)
    this.stages.set('action_generation', {
      name: 'Action Generation',
      agent: this.actionCaller,
      dependencies: ['task_planning'],
      parallel: true,
      critical: true,
      execute: async (taskPlan: TaskPlan, context: PipelineContext) => {
        context.progressCallback?.onThought?.("⚡ Generating executable actions...");
        
        const actionCalls = await Promise.all(
          taskPlan.steps.map(async (step) => {
            try {
              return await this.actionCaller.generateActionCall(step, context.workspaceContext);
            } catch (error) {
              logger.warn(`[FOUNDATION_PIPELINE] Failed to generate action for step ${step.id}:`, error);
              return null;
            }
          })
        );
        
        return actionCalls.filter(call => call !== null);
      }
    });

    // Stage 9: Action Validation (validate generated actions)
    this.stages.set('action_validation', {
      name: 'Action Validation',
      agent: this.actionCaller,
      dependencies: ['action_generation'],
      parallel: true,
      critical: false,
      execute: async (actionCalls: ActionCall[], context: PipelineContext) => {
        context.progressCallback?.onThought?.("✅ Validating generated actions...");
        
        const validatedActions = await Promise.all(
          actionCalls.map(async (action) => ({
            action,
            validation: await this.actionCaller.validateActionCall(action)
          }))
        );
        
        return validatedActions.filter(va => va.validation.isValid).map(va => va.action);
      }
    });

    // Stage 10: Evaluation & Critique (assess the overall pipeline result)
    this.stages.set('evaluation', {
      name: 'Result Evaluation',
      agent: this.critic,
      dependencies: ['cot_generation', 'action_validation'],
      parallel: false,
      critical: false,
      execute: async (input: any, context: PipelineContext) => {
        context.progressCallback?.onThought?.("🎯 Evaluating pipeline results...");
        
        const cotResult = context.previousResults?.get('cot_generation') as ChainOfThought;
        const validatedActions = context.previousResults?.get('action_validation') as ActionCall[];
        
        const evaluation = await this.critic.evaluate(
          context.originalQuery,
          JSON.stringify({
            reasoning: cotResult,
            actions: validatedActions,
            confidence: cotResult?.confidence || 0.5
          })
        );
        
        return evaluation;
      }
    });

    logger.info(`[FOUNDATION_PIPELINE] Initialized ${this.stages.size} pipeline stages`);
  }

  /**
   * Initialize all foundation agents
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      logger.info("[FOUNDATION_PIPELINE] Initializing foundation agents...");
      
      const agents = [
        this.retriever, this.reranker, this.toolSelector, this.critic,
        this.taskPlanner, this.queryRewriter, this.cotGenerator,
        this.chunkScorer, this.actionCaller, this.embedder
      ];

      // Initialize agents with timeout
      const initPromises = agents.map(agent => 
        Promise.race([
          agent.initialize(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`${agent.name} initialization timeout`)), 30000)
          )
        ]).catch(error => {
          logger.warn(`[FOUNDATION_PIPELINE] Failed to initialize ${agent.name}:`, error);
          return null;
        })
      );

      await Promise.all(initPromises);
      
      // Check which agents initialized successfully
      const initializedAgents = agents.filter(agent => agent.isInitialized());
      logger.info(`[FOUNDATION_PIPELINE] Initialized ${initializedAgents.length}/${agents.length} agents`);
      
      this.initialized = true;
    } catch (error) {
      logger.error("[FOUNDATION_PIPELINE] Failed to initialize foundation pipeline:", error);
      throw error;
    }
  }

  /**
   * Execute the complete foundation pipeline
   */
  async execute(
    query: string,
    workspaceContext?: any,
    availableTools?: any[],
    progressCallback?: ProgressCallback,
    contextManager?: any,
    vectorDatabase?: any
  ): Promise<FoundationPipelineResult> {
    const startTime = Date.now();
    const pipelineId = `pipeline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Start agentic logging
    logPipelineStart(pipelineId, query);
    
    if (!this.initialized) {
      await this.initialize();
    }

    // Initialize semantic context for pipeline
    const semanticContext: SemanticContext = await this.initializeSemanticContext(query, workspaceContext, contextManager, vectorDatabase);

    const context: PipelineContext = {
      originalQuery: query,
      workspaceContext,
      availableTools,
      previousResults: new Map(),
      progressCallback,
      // Enhanced context features
      semanticContext,
      accumulatedInsights: new Map(),
      contextConfidence: 0.5,
      stageContext: new Map(),
      contextManager,
      vectorDatabase
    };

    const stagesCompleted: string[] = [];
    const errors: string[] = [];

    try {
      logger.info(`[FOUNDATION_PIPELINE] Executing pipeline for query: ${query.substring(0, 100)}...`);
      progressCallback?.onThought?.("🚀 Starting foundation pipeline...");

      // Execute stages in dependency order with context accumulation
      const executionOrder = this.getExecutionOrder();
      
      // Pre-optimize stage providers if optimizer is available
      if (this.providerOptimizer) {
        await this.optimizeStageProviders(executionOrder, context);
      }
      
      for (const stageName of executionOrder) {
        const stage = this.stages.get(stageName);
        if (!stage) continue;

        const stageStartTime = Date.now(); // Move outside try block for error handling

        // Create agent context for logging
        const agentContext: AgentLogContext = {
          agentName: stage.agent.name,
          agentType: 'FoundationAgent',
          specialization: stageName,
          model: this.getStageModel(stageName),
          provider: this.getStageProvider(stageName)?.provider || 'ollama',
          stage: stageName,
          pipelineId: pipelineId
        };

        // Log stage start
        logStageStart(stageName, 'pipeline_stage', this.getStageInput(stage, context), agentContext);

        try {
          progressCallback?.onThought?.(`📍 Stage: ${stage.name}`);
          
          // Get input from dependencies
          const input = this.getStageInput(stage, context);
          
          // Pre-stage context enrichment
          await this.enrichStageContext(stageName, context);
          
          // Log reasoning/thinking phase
          agenticLogger.logAgentAction(
            agentContext,
            {
              actionType: 'thought',
              actionName: `Processing ${stageName}`,
              input: input
            }
          );
          
          // Execute stage
          const result = await this.executeStageWithTimeout(stage, input, context);
          const stageDuration = Date.now() - stageStartTime;
          
          // Extract confidence from result if available
          const confidence = this.extractResultConfidence(result);
          
          // Log successful execution
          agenticLogger.logAgentAction(
            agentContext,
            {
              actionType: 'observation',
              actionName: `${stageName}_completed`,
              output: result,
              duration: stageDuration,
              confidence: confidence,
              success: true
            }
          );
          
          // Update provider performance metrics
          this.updateStagePerformanceMetrics(stageName, stageDuration, true);
          
          // Store result and accumulate insights
          context.previousResults!.set(stageName, result);
          await this.accumulateStageInsights(stageName, result, context, stageDuration);
          
          stagesCompleted.push(stageName);
          
          // Update context confidence based on stage results
          this.updateContextConfidence(stageName, result, context);
          
          // Log stage completion
          logStageEnd(stageName, true, stageDuration, confidence, result, undefined, agentContext);
          
          logger.debug(`[FOUNDATION_PIPELINE] Completed ${stage.name} in ${stageDuration}ms (confidence: ${context.contextConfidence?.toFixed(2)})`);
          
        } catch (error) {
          const errorMsg = `Stage ${stage.name} failed: ${error instanceof Error ? error.message : String(error)}`;
          const stageDuration = Date.now() - stageStartTime; // Actual duration on error
          
          // Log failed execution
          agenticLogger.logAgentAction(
            agentContext,
            {
              actionType: 'observation',
              actionName: `${stageName}_failed`,
              duration: stageDuration,
              success: false,
              error: errorMsg
            }
          );
          
          // Update provider performance metrics for failure
          this.updateStagePerformanceMetrics(stageName, stageDuration, false);
          
          errors.push(errorMsg);
          logger.error(`[FOUNDATION_PIPELINE] ${errorMsg}`, error);
          
          // Record failure in context
          context.accumulatedInsights?.set(`${stageName}_error`, {
            stage: stageName,
            error: errorMsg,
            timestamp: new Date(),
            impact: 'stage_failure'
          });
          
          // Log stage failure
          logStageEnd(stageName, false, stageDuration, undefined, undefined, errorMsg, agentContext);
          
          if (stage.critical) {
            throw new Error(`Critical stage ${stage.name} failed: ${errorMsg}`);
          }
        }
      }

      // Compile final result
      const result: FoundationPipelineResult = {
        query,
        retrievalResults: context.previousResults!.get('retrieval') || [],
        rerankedResults: context.previousResults!.get('reranking') || [],
        selectedTools: (context.previousResults!.get('tool_selection') as ToolSelectionResult)?.selectedTools || [],
        taskPlan: context.previousResults!.get('task_planning') as TaskPlan,
        reasoning: context.previousResults!.get('cot_generation') as ChainOfThought,
        actionCalls: context.previousResults!.get('action_validation') || [],
        evaluation: context.previousResults!.get('evaluation') as EvaluationResult,
        
        duration: Date.now() - startTime,
        stagesCompleted,
        errors,
        confidence: this.calculateOverallConfidence(context.previousResults!)
      };

      logger.info(`[FOUNDATION_PIPELINE] Pipeline completed in ${result.duration}ms with ${stagesCompleted.length} stages`);
      progressCallback?.onThought?.(`✅ Foundation pipeline completed (${result.duration}ms)`);
      
      // Log successful pipeline completion
      logPipelineEnd(pipelineId, true, undefined, result.confidence);
      
      return result;

    } catch (error) {
      const errorMsg = `Foundation pipeline failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.error("[FOUNDATION_PIPELINE] Pipeline execution failed:", error);
      
      // Log failed pipeline completion
      logPipelineEnd(pipelineId, false, errorMsg, 0);
      
      return {
        query,
        retrievalResults: [],
        rerankedResults: [],
        selectedTools: [],
        taskPlan: {} as TaskPlan,
        reasoning: {} as ChainOfThought,
        actionCalls: [],
        evaluation: {} as EvaluationResult,
        
        duration: Date.now() - startTime,
        stagesCompleted,
        errors: [...errors, errorMsg],
        confidence: 0
      };
    }
  }

  /**
   * Get stage execution order based on dependencies
   */
  private getExecutionOrder(): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (stageName: string): void => {
      if (visiting.has(stageName)) {
        throw new Error(`Circular dependency detected involving ${stageName}`);
      }
      if (visited.has(stageName)) {
        return;
      }

      visiting.add(stageName);
      const stage = this.stages.get(stageName);
      if (stage) {
        for (const dep of stage.dependencies) {
          visit(dep);
        }
        visited.add(stageName);
        order.push(stageName);
      }
      visiting.delete(stageName);
    };

    for (const stageName of this.stages.keys()) {
      visit(stageName);
    }

    return order;
  }

  /**
   * Get input for a stage from its dependencies
   */
  private getStageInput(stage: PipelineStage, context: PipelineContext): any {
    if (stage.dependencies.length === 0) {
      return context.originalQuery;
    }
    
    if (stage.dependencies.length === 1) {
      return context.previousResults!.get(stage.dependencies[0]);
    }
    
    // Multiple dependencies - return as object
    const inputs: any = {};
    for (const dep of stage.dependencies) {
      inputs[dep] = context.previousResults!.get(dep);
    }
    return inputs;
  }

  /**
   * Execute a stage with timeout protection
   */
  private async executeStageWithTimeout(
    stage: PipelineStage,
    input: any,
    context: PipelineContext
  ): Promise<any> {
    const timeoutMs = this.config.timeoutMs || 30000;
    
    const stagePromise = stage.execute(input, context);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Stage ${stage.name} timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([stagePromise, timeoutPromise]);
  }

  /**
   * Calculate overall confidence from stage results
   */
  private calculateOverallConfidence(results: Map<string, any>): number {
    const confidenceValues: number[] = [];
    
    const evaluation = results.get('evaluation') as EvaluationResult;
    if (evaluation?.confidence) {
      confidenceValues.push(evaluation.confidence);
    }
    
    const reasoning = results.get('cot_generation') as ChainOfThought;
    if (reasoning?.confidence) {
      confidenceValues.push(reasoning.confidence);
    }
    
    const toolSelection = results.get('tool_selection') as ToolSelectionResult;
    if (toolSelection?.confidence) {
      confidenceValues.push(toolSelection.confidence);
    }

    if (confidenceValues.length === 0) {
      return 0.5; // Default confidence
    }

    return confidenceValues.reduce((sum, conf) => sum + conf, 0) / confidenceValues.length;
  }

  /**
   * Initialize semantic context for pipeline execution
   */
  private async initializeSemanticContext(
    query: string, 
    workspaceContext?: any,
    contextManager?: any,
    vectorDatabase?: any
  ): Promise<SemanticContext> {
    const semanticContext: SemanticContext = {
      domainKnowledge: [],
      historicalPatterns: [],
      contextualInsights: []
    };

    try {
      // Generate query embedding if embedder is available
      if (this.embedder?.isInitialized()) {
        try {
          semanticContext.queryEmbedding = await this.embedder.embed(query);
        } catch (error) {
          logger.debug("[FOUNDATION_PIPELINE] Query embedding failed:", error);
        }
      }

      // Gather domain knowledge from context manager
      if (contextManager) {
        try {
          const contextResults = await contextManager.searchContext({
            query,
            maxResults: 5
          });

          semanticContext.domainKnowledge = contextResults.items
            .filter((item: any) => item.relevanceScore > 0.5)
            .map((item: any) => ({
              content: item.content.substring(0, 200),
              relevance: item.relevanceScore,
              source: item.source || 'context'
            }));
        } catch (error) {
          logger.debug("[FOUNDATION_PIPELINE] Context manager search failed:", error);
        }
      }

      // Gather historical patterns from vector database
      if (vectorDatabase) {
        try {
          const similarQueries = await vectorDatabase.search(query, {
            limit: 3,
            threshold: 0.4
          });

          semanticContext.historicalPatterns = similarQueries.map((result: any) => ({
            pattern: result.document.content.substring(0, 150),
            confidence: result.score,
            usage: `Similar query pattern (${(result.score * 100).toFixed(1)}% match)`
          }));
        } catch (error) {
          logger.debug("[FOUNDATION_PIPELINE] Vector database search failed:", error);
        }
      }

      logger.debug(`[FOUNDATION_PIPELINE] Initialized semantic context with ${semanticContext.domainKnowledge?.length || 0} knowledge items and ${semanticContext.historicalPatterns?.length || 0} patterns`);

    } catch (error) {
      logger.warn("[FOUNDATION_PIPELINE] Semantic context initialization failed:", error);
    }

    return semanticContext;
  }

  /**
   * Enrich stage-specific context before execution
   */
  private async enrichStageContext(stageName: string, context: PipelineContext): Promise<void> {
    try {
      const stageContext: any = {
        stageName,
        timestamp: new Date(),
        previousStages: Array.from(context.previousResults?.keys() || []),
        queryProgress: this.calculateQueryProgress(stageName, context)
      };

      // Add stage-specific context enrichment
      switch (stageName) {
        case 'retrieval':
          stageContext.retrievalHints = this.extractRetrievalHints(context);
          break;
        case 'task_planning':
          stageContext.planningInsights = this.extractPlanningInsights(context);
          break;
        case 'cot_generation':
          stageContext.reasoningContext = this.extractReasoningContext(context);
          break;
      }

      context.stageContext?.set(stageName, stageContext);
      logger.debug(`[FOUNDATION_PIPELINE] Enriched context for stage: ${stageName}`);

    } catch (error) {
      logger.debug(`[FOUNDATION_PIPELINE] Stage context enrichment failed for ${stageName}:`, error);
    }
  }

  /**
   * Accumulate insights from completed stage
   */
  private async accumulateStageInsights(
    stageName: string, 
    result: any, 
    context: PipelineContext, 
    duration: number
  ): Promise<void> {
    try {
      const insight: any = {
        stage: stageName,
        timestamp: new Date(),
        confidence: this.extractResultConfidence(result),
        duration,
        resultType: this.determineResultType(result),
        keyFindings: this.extractKeyFindings(stageName, result)
      };

      // Add stage-specific insights
      if (stageName === 'retrieval' && Array.isArray(result)) {
        insight.retrievalStats = {
          itemCount: result.length,
          averageScore: result.reduce((sum: number, item: any) => sum + (item.score || 0), 0) / result.length,
          topScore: Math.max(...result.map((item: any) => item.score || 0))
        };
      }

      if (stageName === 'task_planning' && result?.steps) {
        insight.planningStats = {
          stepCount: result.steps.length,
          estimatedDuration: result.estimatedDuration || 0,
          complexity: result.steps.length > 5 ? 'high' : result.steps.length > 2 ? 'medium' : 'low'
        };
      }

      context.accumulatedInsights?.set(stageName, insight);
      
      // Update semantic context with new insights
      if (context.semanticContext?.contextualInsights) {
        context.semanticContext.contextualInsights.push({
          stage: stageName,
          insight: insight.keyFindings || `${stageName} completed successfully`,
          confidence: insight.confidence,
          timestamp: new Date()
        });
      }

      logger.debug(`[FOUNDATION_PIPELINE] Accumulated insights for ${stageName}: confidence=${insight.confidence.toFixed(2)}, duration=${duration}ms`);

    } catch (error) {
      logger.debug(`[FOUNDATION_PIPELINE] Insight accumulation failed for ${stageName}:`, error);
    }
  }

  /**
   * Update overall context confidence based on stage results
   */
  private updateContextConfidence(stageName: string, result: any, context: PipelineContext): void {
    try {
      const stageConfidence = this.extractResultConfidence(result);
      const currentConfidence = context.contextConfidence || 0.5;
      
      // Weighted average with slight bias toward more recent results
      const weight = 0.3;
      const newConfidence = (currentConfidence * (1 - weight)) + (stageConfidence * weight);
      
      context.contextConfidence = Math.max(0.1, Math.min(0.95, newConfidence));
      
      logger.debug(`[FOUNDATION_PIPELINE] Updated context confidence: ${context.contextConfidence.toFixed(3)} (stage: ${stageName}, stage confidence: ${stageConfidence.toFixed(3)})`);

    } catch (error) {
      logger.debug(`[FOUNDATION_PIPELINE] Context confidence update failed for ${stageName}:`, error);
    }
  }

  /**
   * Helper methods for context processing
   */
  private calculateQueryProgress(stageName: string, context: PipelineContext): number {
    const completedStages = context.previousResults?.size || 0;
    const totalStages = this.stages.size;
    return completedStages / totalStages;
  }

  private extractRetrievalHints(context: PipelineContext): string[] {
    const hints: string[] = [];
    const expandedQuery = context.expandedQuery;
    
    if (expandedQuery?.keywords?.length) {
      hints.push(`Focus on keywords: ${expandedQuery.keywords.slice(0, 3).join(', ')}`);
    }
    
    if (context.semanticContext?.domainKnowledge?.length) {
      hints.push(`Leverage domain knowledge: ${context.semanticContext.domainKnowledge.length} items available`);
    }
    
    return hints;
  }

  private extractPlanningInsights(context: PipelineContext): string[] {
    const insights: string[] = [];
    const toolSelection = context.previousResults?.get('tool_selection');
    
    if (toolSelection?.selectedTools?.length) {
      insights.push(`Selected tools: ${toolSelection.selectedTools.slice(0, 3).join(', ')}`);
    }
    
    if (context.semanticContext?.historicalPatterns?.length) {
      insights.push(`Historical patterns available: ${context.semanticContext.historicalPatterns.length} patterns`);
    }
    
    return insights;
  }

  private extractReasoningContext(context: PipelineContext): string[] {
    const reasoningContext: string[] = [];
    const taskPlan = context.previousResults?.get('task_planning');
    
    if (taskPlan?.goal) {
      reasoningContext.push(`Goal: ${taskPlan.goal}`);
    }
    
    if (context.accumulatedInsights?.size) {
      reasoningContext.push(`Accumulated insights: ${context.accumulatedInsights.size} stages`);
    }
    
    return reasoningContext;
  }

  private extractResultConfidence(result: any): number {
    if (typeof result === 'object' && result !== null) {
      if ('confidence' in result && typeof result.confidence === 'number') {
        return Math.max(0, Math.min(1, result.confidence));
      }
      if ('score' in result && typeof result.score === 'number') {
        return Math.max(0, Math.min(1, result.score));
      }
      if (Array.isArray(result) && result.length > 0) {
        const scores = result.map(item => this.extractResultConfidence(item));
        return scores.reduce((sum, score) => sum + score, 0) / scores.length;
      }
    }
    return 0.6; // Default confidence
  }

  private determineResultType(result: any): string {
    if (Array.isArray(result)) return 'array';
    if (typeof result === 'object' && result !== null) {
      if ('steps' in result) return 'plan';
      if ('reasoning' in result) return 'reasoning';
      if ('selectedTools' in result) return 'tool_selection';
    }
    return 'unknown';
  }

  private extractKeyFindings(stageName: string, result: any): string {
    switch (stageName) {
      case 'retrieval':
        return Array.isArray(result) ? `Retrieved ${result.length} items` : 'Retrieval completed';
      case 'task_planning':
        return result?.steps?.length ? `Planned ${result.steps.length} steps` : 'Planning completed';
      case 'cot_generation':
        return result?.steps?.length ? `Generated ${result.steps.length} reasoning steps` : 'Reasoning completed';
      case 'tool_selection':
        return result?.selectedTools?.length ? `Selected ${result.selectedTools.length} tools` : 'Tool selection completed';
      default:
        return `${stageName} completed successfully`;
    }
  }


  /**
   * Get optimized provider for a specific stage
   */
  getStageProvider(stageName: string): { provider: LLMProvider; decision: any } | null {
    return this.stageProviders.get(stageName) || null;
  }

  /**
   * Update stage performance metrics for optimization
   */
  private updateStagePerformanceMetrics(
    stageName: string, 
    duration: number, 
    success: boolean
  ): void {
    if (!this.providerOptimizer) return;

    const stageProvider = this.stageProviders.get(stageName);
    if (!stageProvider) return;

    try {
      this.providerOptimizer.updateOptimization(stageProvider.provider, stageProvider.provider, {
        latency: duration,
        success,
        throughput: success ? 1 : 0
      });

      logger.debug(
        chalk.cyan(
          `[FOUNDATION_PIPELINE] Updated metrics for ${stageName} (${stageProvider.provider}): ${duration}ms, success=${success}`
        )
      );

    } catch (error) {
      logger.debug(`[FOUNDATION_PIPELINE] Failed to update stage metrics for ${stageName}:`, error);
    }
  }

  /**
   * Get provider optimization insights
   */
  getProviderOptimizationInsights(): {
    recommendations: string[];
    bottlenecks: string[];
    optimizations: string[];
  } | null {
    if (!this.providerOptimizer) return null;
    
    return this.providerOptimizer.getPerformanceInsights();
  }

  /**
   * Export provider optimization configuration
   */
  exportProviderConfiguration(): any {
    if (!this.providerOptimizer) return null;
    
    return {
      optimization: this.providerOptimizer.exportConfiguration(),
      stageProviders: Array.from(this.stageProviders.entries()),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get pipeline statistics
   */
  getStatistics(): {
    totalStages: number;
    initializedAgents: number;
    totalAgents: number;
    stageNames: string[];
    providerOptimization?: {
      enabled: boolean;
      optimizedStages: number;
      providers: Array<{ stage: string; provider: LLMProvider; confidence: number }>;
    };
  } {
    const agents = [
      this.retriever, this.reranker, this.toolSelector, this.critic,
      this.taskPlanner, this.queryRewriter, this.cotGenerator,
      this.chunkScorer, this.actionCaller, this.embedder
    ];

    const statistics = {
      totalStages: this.stages.size,
      initializedAgents: agents.filter(a => a.isInitialized()).length,
      totalAgents: agents.length,
      stageNames: Array.from(this.stages.keys())
    };

    // Add provider optimization statistics
    if (this.providerOptimizer && this.stageProviders.size > 0) {
      (statistics as any).providerOptimization = {
        enabled: true,
        optimizedStages: this.stageProviders.size,
        providers: Array.from(this.stageProviders.entries()).map(([stage, opt]) => ({
          stage,
          provider: opt.provider,
          confidence: opt.decision.confidence || 0
        }))
      };
    }

    return statistics;
  }

  /**
   * Get model for a specific stage
   */
  private getStageModel(stageName: string): string {
    const stageProvider = this.stageProviders.get(stageName);
    if (stageProvider) {
      return stageProvider.provider;
    }

    // Try to get from stage agent
    const stage = this.stages.get(stageName);
    if (stage?.agent && 'model' in stage.agent) {
      return (stage.agent as any).model || 'unknown';
    }

    // Fallback to default model (this would normally come from config)
    return 'llama3.2:3b';
  }

  /**
   * Log model routing decisions with enhanced detail
   */
  private logModelRoutingDecision(
    stageName: string,
    originalProvider: string,
    selectedProvider: string,
    model: string,
    decision: any
  ): void {
    logModelRouting(
      stageName,
      originalProvider,
      selectedProvider,
      model,
      decision.reason || 'provider optimization',
      decision.confidence,
      {
        latencyWeight: decision.latencyWeight,
        accuracyWeight: decision.accuracyWeight,
        costWeight: decision.costWeight
      }
    );
  }

  /**
   * Enhanced provider optimization with logging
   */
  private async optimizeStageProviders(
    executionOrder: string[], 
    context: PipelineContext
  ): Promise<void> {
    if (!this.providerOptimizer) return;

    try {
      logger.debug(chalk.cyan("[FOUNDATION_PIPELINE] Optimizing stage providers..."));
      
      // Optimize stages in batch for potential performance gains
      const optimizations = await this.providerOptimizer.optimizeBatch(executionOrder);
      
      for (const [stageName, optimization] of optimizations) {
        this.stageProviders.set(stageName, optimization);
        
        // Log the routing decision
        this.logModelRoutingDecision(
          stageName,
          'ollama', // Default provider
          optimization.provider,
          optimization.provider,
          optimization.decision
        );
        
        logger.info(
          chalk.blue(
            `🧠 [FOUNDATION_PIPELINE] STAGE_OPTIMIZATION | Stage: ${stageName} → Provider: ${optimization.provider.toUpperCase()} | Reason: ${optimization.decision.reason} | Confidence: ${optimization.decision.confidence?.toFixed(2) || 'N/A'}`
          )
        );
      }

      // Store optimization insights in context
      if (context.accumulatedInsights) {
        context.accumulatedInsights.set('provider_optimization', {
          stage: 'optimization',
          optimizedStages: executionOrder.length,
          routingDecisions: Array.from(this.stageProviders.entries()).map(([stage, opt]) => ({
            stage,
            provider: opt.provider,
            confidence: opt.decision.confidence
          })),
          timestamp: new Date()
        });
      }

    } catch (error) {
      logger.warn(chalk.yellow("[FOUNDATION_PIPELINE] Provider optimization failed:"), error);
    }
  }

  /**
   * Get agentic logging statistics for the current pipeline
   */
  getAgenticLoggingStatistics(): any {
    return agenticLogger.getPipelineStatistics();
  }
}