/**
 * Foundation Agent Factory - Centralized creation and management of foundation agents
 *
 * Provides a unified interface for creating, initializing, and managing
 * all 10 specialized foundation agents that form the core agentic system.
 */

import { logger } from "../../utils/logger";
import { ToolManager } from "../ToolManager";
import { ContextManager } from "../ContextManager";
import { VectorDatabase } from "../../documentation/VectorDatabase";
import {
  FoundationPipelineConfig,
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
} from "./IFoundationAgent";

// Import all foundation agents
import { RetrieverAgent } from "./agents/RetrieverAgent";
import { RerankerAgent } from "./agents/RerankerAgent";
import { ToolSelectorAgent } from "./agents/ToolSelectorAgent";
import { CriticAgent } from "./agents/CriticAgent";
import { TaskPlannerAgent } from "./agents/TaskPlannerAgent";
import { QueryRewriterAgent } from "./agents/QueryRewriterAgent";
import { CoTGeneratorAgent } from "./agents/CoTGeneratorAgent";
import { ChunkScorerAgent } from "./agents/ChunkScorerAgent";
import { ActionCallerAgent } from "./agents/ActionCallerAgent";
import { EmbedderAgent } from "./agents/EmbedderAgent";
import { 
  DisabledRetrieverAgent,
  DisabledRerankerAgent,
  DisabledToolSelectorAgent,
  DisabledCriticAgent,
  DisabledTaskPlannerAgent,
  DisabledQueryRewriterAgent,
  DisabledCoTGeneratorAgent,
  DisabledChunkScorerAgent,
  DisabledActionCallerAgent,
  DisabledEmbedderAgentImpl
} from "./agents/DisabledFoundationAgent";
import { FoundationPipeline } from "./FoundationPipeline";
import { LLMRouter } from "../../api/llm-router";
import { ExtensionConfig } from "../../config";

export interface FoundationAgentDependencies {
  ollamaUrl: string;
  model: string; // Default/fallback model
  toolManager?: ToolManager;
  contextManager?: ContextManager;
  vectorDatabase?: VectorDatabase;
  llmRouter?: LLMRouter;
  extensionConfig?: ExtensionConfig; // Full extension config for per-agent models
}

export interface FoundationAgents {
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
}

/**
 * Singleton Factory for creating and managing foundation agents
 */
export class FoundationAgentFactory {
  protected dependencies: FoundationAgentDependencies;
  protected config: FoundationPipelineConfig;
  protected agents?: FoundationAgents;
  protected initialized = false;
  
  // Thread-safety for concurrent createAgents() calls
  protected creationPromise?: Promise<FoundationAgents>;
  protected isCreating = false;
  
  // Singleton pattern implementation
  private static instance: FoundationAgentFactory | null = null;
  private static instanceKey: string | null = null;

  protected constructor(
    dependencies: FoundationAgentDependencies,
    config: Partial<FoundationPipelineConfig> = {}
  ) {
    const stack = new Error().stack;
    const callerInfo = stack?.split('\n')[2]?.trim() || 'unknown caller';
    logger.info(`[FOUNDATION_FACTORY] NEW FACTORY INSTANCE created for model: ${dependencies.model}`);
    logger.debug(`[FOUNDATION_FACTORY] Factory constructor called from: ${callerInfo}`);
    
    this.dependencies = dependencies;
    this.config = this.buildDefaultConfig(config);
  }
  
  /**
   * Get or create singleton instance of FoundationAgentFactory
   */
  public static getInstance(
    dependencies?: FoundationAgentDependencies,
    config?: Partial<FoundationPipelineConfig>
  ): FoundationAgentFactory {
    // Create a unique key based on configuration INCLUDING foundation models
    const newKey = dependencies ? 
      `${dependencies.ollamaUrl}|${dependencies.model}|${dependencies.extensionConfig?.lmdeploy?.enabled || false}|${JSON.stringify(dependencies.extensionConfig?.foundation?.models || {})}` :
      'default';
    
    // Return existing instance if configuration matches
    if (FoundationAgentFactory.instance && FoundationAgentFactory.instanceKey === newKey) {
      logger.debug(`[FOUNDATION_FACTORY] Returning existing singleton instance`);
      logger.debug(`[FOUNDATION_FACTORY] Cached foundation models: ${JSON.stringify(dependencies?.extensionConfig?.foundation?.models || {}, null, 2)}`);
      return FoundationAgentFactory.instance;
    }
    
    // Create new instance if configuration changed or no instance exists
    if (dependencies) {
      logger.info(`[FOUNDATION_FACTORY] Creating new singleton instance (config changed)`);
      logger.info(`[FOUNDATION_FACTORY] Foundation models being used: ${JSON.stringify(dependencies.extensionConfig?.foundation?.models || {}, null, 2)}`);
      FoundationAgentFactory.instance = new FoundationAgentFactory(dependencies, config || {});
      FoundationAgentFactory.instanceKey = newKey;
    } else if (!FoundationAgentFactory.instance) {
      throw new Error("FoundationAgentFactory: Cannot create instance without dependencies on first call");
    }
    
    return FoundationAgentFactory.instance!;
  }
  
  /**
   * Reset singleton instance (for testing/cleanup)
   */
  public static resetInstance(): void {
    FoundationAgentFactory.instance = null;
    FoundationAgentFactory.instanceKey = null;
    logger.debug("[FOUNDATION_FACTORY] Singleton instance reset");
  }

  /**
   * Get the model for a specific foundation agent
   */
  protected getModelForAgent(agentType: keyof FoundationAgents): string {
    // Enhanced debugging to understand configuration state
    logger.info(`[FOUNDATION_FACTORY] ⚡ Checking model for agent: ${agentType}`);
    logger.info(`[FOUNDATION_FACTORY] Extension config exists: ${!!this.dependencies.extensionConfig}`);
    logger.info(`[FOUNDATION_FACTORY] Foundation config exists: ${!!this.dependencies.extensionConfig?.foundation}`);
    logger.info(`[FOUNDATION_FACTORY] Foundation models config exists: ${!!this.dependencies.extensionConfig?.foundation?.models}`);
    logger.info(`[FOUNDATION_FACTORY] Default model fallback: ${this.dependencies.model}`);
    
    if (this.dependencies.extensionConfig?.foundation?.models) {
      logger.info(`[FOUNDATION_FACTORY] All foundation models config: ${JSON.stringify(this.dependencies.extensionConfig.foundation.models, null, 2)}`);
      const specificModel = this.dependencies.extensionConfig.foundation.models[agentType];
      logger.info(`[FOUNDATION_FACTORY] Model for ${agentType}: "${specificModel}" (type: ${typeof specificModel})`);
    } else {
      logger.warn(`[FOUNDATION_FACTORY] No foundation models config found! Using default: ${this.dependencies.model}`);
    }
    
    // Debug the full config structure
    if (this.dependencies.extensionConfig) {
      logger.debug(`[FOUNDATION_FACTORY] Full foundation config: ${JSON.stringify({
        foundation: this.dependencies.extensionConfig.foundation,
        model: this.dependencies.model
      }, null, 2)}`);
    } else {
      logger.warn(`[FOUNDATION_FACTORY] No extension config at all! This is the problem.`);
    }

    // Check if the extension config and foundation models exist
    const foundationModels = this.dependencies.extensionConfig?.foundation?.models;
    
    if (!foundationModels) {
      logger.debug(
        `[FOUNDATION_FACTORY] No foundation models config found, using default: ${this.dependencies.model}`
      );
      return this.dependencies.model; // Fallback to default model
    }

    const configuredModel = foundationModels[agentType];
    
    // Handle three cases:
    // 1. undefined/null: No configuration, use default
    // 2. empty string: User explicitly set no model, prevent default usage
    // 3. actual string: Use specified model
    if (configuredModel === undefined || configuredModel === null) {
      logger.info(
        `[FOUNDATION_FACTORY] ${agentType} agent using default model: ${this.dependencies.model} (not configured)`
      );
      return this.dependencies.model;
    }
    
    if (configuredModel === "") {
      logger.warn(
        `[FOUNDATION_FACTORY] ${agentType} agent has empty model configuration - agent creation will be skipped`
      );
      throw new Error(`Agent ${agentType} has no model configured. Use the Foundation Models panel to configure a model.`);
    }

    logger.info(
      `[FOUNDATION_FACTORY] ${agentType} agent using configured model: ${configuredModel}`
    );
    return configuredModel;
  }

  /**
   * Create all foundation agents (thread-safe)
   */
  async createAgents(): Promise<FoundationAgents> {
    // Return existing agents if already created
    if (this.agents && this.initialized) {
      return this.agents;
    }

    // If creation is already in progress, wait for it to complete
    if (this.isCreating && this.creationPromise) {
      logger.debug("[FOUNDATION_FACTORY] Agent creation already in progress, waiting...");
      return this.creationPromise;
    }

    // Start creation process
    this.isCreating = true;
    this.creationPromise = this.performAgentCreation();

    try {
      const agents = await this.creationPromise;
      return agents;
    } finally {
      // Reset creation state when done (success or failure)
      this.isCreating = false;
      this.creationPromise = undefined;
    }
  }

  /**
   * Internal method that performs the actual agent creation
   */
  protected async performAgentCreation(): Promise<FoundationAgents> {
    try {
      logger.info("[FOUNDATION_FACTORY] Creating foundation agents...");

      const startTime = Date.now();

      // Create all agents in parallel for efficiency
      const [
        retriever,
        reranker,
        toolSelector,
        critic,
        taskPlanner,
        queryRewriter,
        cotGenerator,
        chunkScorer,
        actionCaller,
        embedder,
      ] = await Promise.all([
        this.createRetrieverAgent(),
        this.createRerankerAgent(),
        this.createToolSelectorAgent(),
        this.createCriticAgent(),
        this.createTaskPlannerAgent(),
        this.createQueryRewriterAgent(),
        this.createCoTGeneratorAgent(),
        this.createChunkScorerAgent(),
        this.createActionCallerAgent(),
        this.createEmbedderAgent(),
      ]);

      this.agents = {
        retriever,
        reranker,
        toolSelector,
        critic,
        taskPlanner,
        queryRewriter,
        cotGenerator,
        chunkScorer,
        actionCaller,
        embedder,
      };

      const creationTime = Date.now() - startTime;
      
      // Count enabled vs disabled agents
      const enabledAgents = Object.values(this.agents).filter(agent => agent.isInitialized()).length;
      const disabledAgents = 10 - enabledAgents;

      logger.info(
        `[FOUNDATION_FACTORY] Created all 10 foundation agents in ${creationTime}ms (${enabledAgents} enabled, ${disabledAgents} disabled)`
      );

      return this.agents;
    } catch (error) {
      logger.error(
        "[FOUNDATION_FACTORY] Failed to create foundation agents:",
        error
      );
      throw error;
    }
  }

  /**
   * Initialize all foundation agents
   */
  async initializeAgents(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.agents) {
      await this.createAgents();
    }

    try {
      logger.info("[FOUNDATION_FACTORY] Initializing foundation agents...");

      const startTime = Date.now();
      const initializationPromises = [
        this.agents!.retriever.initialize(),
        this.agents!.reranker.initialize(),
        this.agents!.toolSelector.initialize(),
        this.agents!.critic.initialize(),
        this.agents!.taskPlanner.initialize(),
        this.agents!.queryRewriter.initialize(),
        this.agents!.cotGenerator.initialize(),
        this.agents!.chunkScorer.initialize(),
        this.agents!.actionCaller.initialize(),
        this.agents!.embedder.initialize(),
      ];

      // Initialize agents with timeout protection
      const results = await Promise.allSettled(initializationPromises);

      // Check which agents failed to initialize
      const failures: string[] = [];
      const agentNames = [
        "retriever",
        "reranker",
        "toolSelector",
        "critic",
        "taskPlanner",
        "queryRewriter",
        "cotGenerator",
        "chunkScorer",
        "actionCaller",
        "embedder",
      ];

      results.forEach((result, index) => {
        if (result.status === "rejected") {
          failures.push(agentNames[index]);
          logger.warn(
            `[FOUNDATION_FACTORY] Failed to initialize ${agentNames[index]}:`,
            result.reason
          );
        }
      });

      const initializationTime = Date.now() - startTime;
      const successCount = results.length - failures.length;

      logger.info(
        `[FOUNDATION_FACTORY] Initialized ${successCount}/${results.length} agents in ${initializationTime}ms`
      );

      if (failures.length > 0) {
        logger.warn(
          `[FOUNDATION_FACTORY] Failed to initialize: ${failures.join(", ")}`
        );
      }

      this.initialized = true;
    } catch (error) {
      logger.error(
        "[FOUNDATION_FACTORY] Foundation agent initialization failed:",
        error
      );
      throw error;
    }
  }

  /**
   * Get initialization status of all agents
   */
  getInitializationStatus(): { [agentName: string]: boolean } {
    if (!this.agents) {
      return {};
    }

    return {
      retriever: this.agents.retriever.isInitialized(),
      reranker: this.agents.reranker.isInitialized(),
      toolSelector: this.agents.toolSelector.isInitialized(),
      critic: this.agents.critic.isInitialized(),
      taskPlanner: this.agents.taskPlanner.isInitialized(),
      queryRewriter: this.agents.queryRewriter.isInitialized(),
      cotGenerator: this.agents.cotGenerator.isInitialized(),
      chunkScorer: this.agents.chunkScorer.isInitialized(),
      actionCaller: this.agents.actionCaller.isInitialized(),
      embedder: this.agents.embedder.isInitialized(),
    };
  }

  /**
   * Get agent capabilities summary
   */
  getCapabilitiesSummary(): { [agentName: string]: string[] } {
    if (!this.agents) {
      return {};
    }

    return {
      retriever: this.agents.retriever.getCapabilities(),
      reranker: this.agents.reranker.getCapabilities(),
      toolSelector: this.agents.toolSelector.getCapabilities(),
      critic: this.agents.critic.getCapabilities(),
      taskPlanner: this.agents.taskPlanner.getCapabilities(),
      queryRewriter: this.agents.queryRewriter.getCapabilities(),
      cotGenerator: this.agents.cotGenerator.getCapabilities(),
      chunkScorer: this.agents.chunkScorer.getCapabilities(),
      actionCaller: this.agents.actionCaller.getCapabilities(),
      embedder: this.agents.embedder.getCapabilities(),
    };
  }

  /**
   * Create individual agents
   */
  protected async createRetrieverAgent(): Promise<IRetrieverAgent> {
    try {
      const model = this.getModelForAgent("retriever");
      return new RetrieverAgent(
        this.dependencies.ollamaUrl,
        model,
        this.dependencies.contextManager,
        this.dependencies.vectorDatabase,
        this.config.retriever
      );
    } catch (error) {
      logger.warn(`[FOUNDATION_FACTORY] Skipping RetrieverAgent creation: ${error instanceof Error ? error.message : String(error)}`);
      return new DisabledRetrieverAgent();
    }
  }

  protected async createRerankerAgent(): Promise<IRerankerAgent> {
    try {
      const model = this.getModelForAgent("reranker");
      return new RerankerAgent(
        this.dependencies.ollamaUrl,
        model,
        this.config.reranker
      );
    } catch (error) {
      logger.warn(`[FOUNDATION_FACTORY] Skipping RerankerAgent creation: ${error instanceof Error ? error.message : String(error)}`);
      return new DisabledRerankerAgent();
    }
  }

  protected async createToolSelectorAgent(): Promise<IToolSelectorAgent> {
    try {
      const model = this.getModelForAgent("toolSelector");
      return new ToolSelectorAgent(
        this.dependencies.ollamaUrl,
        model,
        this.dependencies.toolManager,
        this.config.toolSelector
      );
    } catch (error) {
      logger.warn(`[FOUNDATION_FACTORY] Skipping ToolSelectorAgent creation: ${error instanceof Error ? error.message : String(error)}`);
      return new DisabledToolSelectorAgent();
    }
  }

  protected async createCriticAgent(): Promise<ICriticAgent> {
    try {
      const model = this.getModelForAgent("critic");
      return new CriticAgent(
        this.dependencies.ollamaUrl,
        model,
        this.config.critic
      );
    } catch (error) {
      logger.warn(`[FOUNDATION_FACTORY] Skipping CriticAgent creation: ${error instanceof Error ? error.message : String(error)}`);
      return new DisabledCriticAgent();
    }
  }

  protected async createTaskPlannerAgent(): Promise<ITaskPlannerAgent> {
    try {
      const model = this.getModelForAgent("taskPlanner");
      logger.info(`[FOUNDATION_FACTORY] 🎯 Creating TaskPlannerAgent with model: ${model}`);
      return new TaskPlannerAgent(
        this.dependencies.ollamaUrl,
        model,
        this.dependencies.contextManager,
        this.dependencies.vectorDatabase,
        this.config.taskPlanner
      );
    } catch (error) {
      logger.warn(`[FOUNDATION_FACTORY] Skipping TaskPlannerAgent creation: ${error instanceof Error ? error.message : String(error)}`);
      return new DisabledTaskPlannerAgent();
    }
  }

  protected async createQueryRewriterAgent(): Promise<IQueryRewriterAgent> {
    try {
      const model = this.getModelForAgent("queryRewriter");
      return new QueryRewriterAgent(
        this.dependencies.ollamaUrl,
        model,
        this.config.queryRewriter
      );
    } catch (error) {
      logger.warn(`[FOUNDATION_FACTORY] Skipping QueryRewriterAgent creation: ${error instanceof Error ? error.message : String(error)}`);
      return new DisabledQueryRewriterAgent();
    }
  }

  protected async createCoTGeneratorAgent(): Promise<ICoTGeneratorAgent> {
    try {
      const model = this.getModelForAgent("cotGenerator");
      logger.info(`[FOUNDATION_FACTORY] 🧠 Creating CoTGeneratorAgent with model: ${model}`);
      return new CoTGeneratorAgent(
        this.dependencies.ollamaUrl,
        model,
        this.dependencies.contextManager,
        this.dependencies.vectorDatabase,
        this.config.cotGenerator
      );
    } catch (error) {
      logger.warn(`[FOUNDATION_FACTORY] Skipping CoTGeneratorAgent creation: ${error instanceof Error ? error.message : String(error)}`);
      return new DisabledCoTGeneratorAgent();
    }
  }

  protected async createChunkScorerAgent(): Promise<IChunkScorerAgent> {
    try {
      const model = this.getModelForAgent("chunkScorer");
      return new ChunkScorerAgent(
        this.dependencies.ollamaUrl,
        model,
        this.config.chunkScorer
      );
    } catch (error) {
      logger.warn(`[FOUNDATION_FACTORY] Skipping ChunkScorerAgent creation: ${error instanceof Error ? error.message : String(error)}`);
      return new DisabledChunkScorerAgent();
    }
  }

  protected async createActionCallerAgent(): Promise<IActionCallerAgent> {
    try {
      const model = this.getModelForAgent("actionCaller");
      return new ActionCallerAgent(
        this.dependencies.ollamaUrl,
        model,
        this.dependencies.contextManager,
        this.dependencies.vectorDatabase,
        this.dependencies.toolManager,
        this.config.actionCaller
      );
    } catch (error) {
      logger.warn(`[FOUNDATION_FACTORY] Skipping ActionCallerAgent creation: ${error instanceof Error ? error.message : String(error)}`);
      return new DisabledActionCallerAgent();
    }
  }

  protected async createEmbedderAgent(): Promise<IEmbedderAgent> {
    try {
      const model = this.getModelForAgent("embedder");
      logger.info(`[FOUNDATION_FACTORY] Creating EmbedderAgent with model: ${model}`);
      const stack = new Error().stack;
      const callerInfo = stack?.split('\n')[2]?.trim() || 'unknown caller';
      logger.debug(`[FOUNDATION_FACTORY] createEmbedderAgent called from: ${callerInfo}`);
      
      return new EmbedderAgent(
        this.dependencies.ollamaUrl,
        model,
        this.config.embedder
      );
    } catch (error) {
      logger.warn(`[FOUNDATION_FACTORY] Skipping EmbedderAgent creation: ${error instanceof Error ? error.message : String(error)}`);
      // Return a disabled agent that will report as not initialized
      return new DisabledEmbedderAgentImpl();
    }
  }

  /**
   * Build default configuration
   */
  protected buildDefaultConfig(
    partialConfig: Partial<FoundationPipelineConfig>
  ): FoundationPipelineConfig {
    return {
      // Agent-specific configs
      retriever: {
        modelSize: "0.1-1B",
        temperature: 0.1,
        maxTokens: 2000,
        timeout: 60000,
        ...partialConfig.retriever,
      },
      reranker: {
        modelSize: "1-3B",
        temperature: 0.05,
        maxTokens: 100,
        timeout: 60000,
        ...partialConfig.reranker,
      },
      toolSelector: {
        modelSize: "1-7B",
        temperature: 0.2,
        maxTokens: 1000,
        timeout: 60000,
        ...partialConfig.toolSelector,
      },
      critic: {
        modelSize: "1-3B",
        temperature: 0.3,
        maxTokens: 1500,
        timeout: 60000,
        ...partialConfig.critic,
      },
      taskPlanner: {
        modelSize: "1-7B",
        temperature: 0.4,
        maxTokens: 2000,
        timeout: 60000,
        ...partialConfig.taskPlanner,
      },
      queryRewriter: {
        modelSize: "0.5-2B",
        temperature: 0.3,
        maxTokens: 800,
        timeout: 60000,
        ...partialConfig.queryRewriter,
      },
      cotGenerator: {
        modelSize: "1-3B",
        temperature: 0.4,
        maxTokens: 1500,
        timeout: 60000,
        ...partialConfig.cotGenerator,
      },
      chunkScorer: {
        modelSize: "0.5-2B",
        temperature: 0.1,
        maxTokens: 400,
        timeout: 60000,
        ...partialConfig.chunkScorer,
      },
      actionCaller: {
        modelSize: "1-3B",
        temperature: 0.2,
        maxTokens: 800,
        timeout: 60000,
        ...partialConfig.actionCaller,
      },
      embedder: {
        modelSize: "0.1-1B",
        temperature: 0.0,
        maxTokens: 1,
        timeout: 60000,
        ...partialConfig.embedder,
      },

      // Pipeline settings
      enableParallelProcessing: partialConfig.enableParallelProcessing ?? true,
      maxConcurrency: partialConfig.maxConcurrency ?? 3,
      timeoutMs: partialConfig.timeoutMs ?? 120000,
      retryAttempts: partialConfig.retryAttempts ?? 2,
    };
  }

  /**
   * Health check for all agents
   */
  async healthCheck(): Promise<{
    [agentName: string]: { healthy: boolean; error?: string };
  }> {
    if (!this.agents) {
      return {};
    }

    const healthChecks = await Promise.allSettled([
      this.testAgent("retriever", async () =>
        this.agents!.retriever.retrieve("test")
      ),
      this.testAgent("reranker", async () =>
        this.agents!.reranker.scoreRelevance("test", "test")
      ),
      this.testAgent("toolSelector", async () =>
        this.agents!.toolSelector.selectTools("test", [])
      ),
      this.testAgent("critic", async () =>
        this.agents!.critic.evaluate("test", "test")
      ),
      this.testAgent("taskPlanner", async () =>
        this.agents!.taskPlanner.planTask("test")
      ),
      this.testAgent("queryRewriter", async () =>
        this.agents!.queryRewriter.expandQuery("test")
      ),
      this.testAgent("cotGenerator", async () =>
        this.agents!.cotGenerator.generateReasoning("test")
      ),
      this.testAgent("chunkScorer", async () =>
        this.agents!.chunkScorer.scoreChunk("test", "test")
      ),
      this.testAgent("actionCaller", async () =>
        this.agents!.actionCaller.generateActionCall({
          id: "test",
          description: "test",
          action: "test",
          parameters: {},
          dependencies: [],
          estimatedTime: 1,
          priority: "low",
        })
      ),
      this.testAgent("embedder", async () =>
        this.agents!.embedder.embed("test")
      ),
    ]);

    const agentNames = [
      "retriever",
      "reranker",
      "toolSelector",
      "critic",
      "taskPlanner",
      "queryRewriter",
      "cotGenerator",
      "chunkScorer",
      "actionCaller",
      "embedder",
    ];

    const results: {
      [agentName: string]: { healthy: boolean; error?: string };
    } = {};

    healthChecks.forEach((result, index) => {
      const agentName = agentNames[index];
      if (result.status === "fulfilled") {
        results[agentName] = result.value;
      } else {
        results[agentName] = { healthy: false, error: String(result.reason) };
      }
    });

    return results;
  }

  /**
   * Create Foundation Pipeline with provider optimization
   */
  async createFoundationPipeline(): Promise<FoundationPipeline> {
    // Ensure agents are created and initialized
    if (!this.agents) {
      await this.createAgents();
      await this.initializeAgents();
    }

    logger.info(
      "[FOUNDATION_FACTORY] Creating foundation pipeline with provider optimization..."
    );

    // Create pipeline with LLM router for provider optimization
    const pipeline = new FoundationPipeline(
      this.agents!,
      this.config,
      this.dependencies.llmRouter
    );

    // Initialize the pipeline
    await pipeline.initialize();

    logger.info(
      "[FOUNDATION_FACTORY] Foundation pipeline created successfully"
    );
    return pipeline;
  }

  /**
   * Test individual agent health
   */
  private async testAgent(
    name: string,
    testFn: () => Promise<any>
  ): Promise<{ healthy: boolean; error?: string }> {
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Health check timeout")), 5000)
      );

      await Promise.race([testFn(), timeout]);
      return { healthy: true };
    } catch (error) {
      logger.warn(`[FOUNDATION_FACTORY] Health check failed for ${name}:`, error);
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
