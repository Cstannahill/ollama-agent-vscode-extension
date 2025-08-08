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
 * Factory for creating and managing foundation agents
 */
export class FoundationAgentFactory {
  protected dependencies: FoundationAgentDependencies;
  protected config: FoundationPipelineConfig;
  protected agents?: FoundationAgents;
  protected initialized = false;

  constructor(
    dependencies: FoundationAgentDependencies,
    config: Partial<FoundationPipelineConfig> = {}
  ) {
    this.dependencies = dependencies;
    this.config = this.buildDefaultConfig(config);
  }

  /**
   * Get the model for a specific foundation agent
   */
  protected getModelForAgent(agentType: keyof FoundationAgents): string {
    if (!this.dependencies.extensionConfig?.foundation.models) {
      logger.debug(
        `[FOUNDATION_FACTORY] No per-agent models configured, using default: ${this.dependencies.model}`
      );
      return this.dependencies.model; // Fallback to default model
    }

    const configuredModel =
      this.dependencies.extensionConfig.foundation.models[agentType];
    const finalModel = configuredModel || this.dependencies.model;

    logger.info(
      `[FOUNDATION_FACTORY] ${agentType} agent using model: ${finalModel}${
        configuredModel ? " (configured)" : " (default)"
      }`
    );

    // Return configured model if available, otherwise fallback to default
    return finalModel;
  }

  /**
   * Create all foundation agents
   */
  async createAgents(): Promise<FoundationAgents> {
    if (this.agents && this.initialized) {
      return this.agents;
    }

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
      logger.info(
        `[FOUNDATION_FACTORY] Created all 10 foundation agents in ${creationTime}ms`
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
    const model = this.getModelForAgent("retriever");
    return new RetrieverAgent(
      this.dependencies.ollamaUrl,
      model,
      this.dependencies.contextManager,
      this.dependencies.vectorDatabase,
      this.config.retriever
    );
  }

  protected async createRerankerAgent(): Promise<IRerankerAgent> {
    const model = this.getModelForAgent("reranker");
    return new RerankerAgent(
      this.dependencies.ollamaUrl,
      model,
      this.config.reranker
    );
  }

  protected async createToolSelectorAgent(): Promise<IToolSelectorAgent> {
    const model = this.getModelForAgent("toolSelector");
    return new ToolSelectorAgent(
      this.dependencies.ollamaUrl,
      model,
      this.dependencies.toolManager,
      this.config.toolSelector
    );
  }

  protected async createCriticAgent(): Promise<ICriticAgent> {
    const model = this.getModelForAgent("critic");
    return new CriticAgent(
      this.dependencies.ollamaUrl,
      model,
      this.config.critic
    );
  }

  protected async createTaskPlannerAgent(): Promise<ITaskPlannerAgent> {
    const model = this.getModelForAgent("taskPlanner");
    return new TaskPlannerAgent(
      this.dependencies.ollamaUrl,
      model,
      this.dependencies.contextManager,
      this.dependencies.vectorDatabase,
      this.config.taskPlanner
    );
  }

  protected async createQueryRewriterAgent(): Promise<IQueryRewriterAgent> {
    const model = this.getModelForAgent("queryRewriter");
    return new QueryRewriterAgent(
      this.dependencies.ollamaUrl,
      model,
      this.config.queryRewriter
    );
  }

  protected async createCoTGeneratorAgent(): Promise<ICoTGeneratorAgent> {
    const model = this.getModelForAgent("cotGenerator");
    return new CoTGeneratorAgent(
      this.dependencies.ollamaUrl,
      model,
      this.dependencies.contextManager,
      this.dependencies.vectorDatabase,
      this.config.cotGenerator
    );
  }

  protected async createChunkScorerAgent(): Promise<IChunkScorerAgent> {
    const model = this.getModelForAgent("chunkScorer");
    return new ChunkScorerAgent(
      this.dependencies.ollamaUrl,
      model,
      this.config.chunkScorer
    );
  }

  protected async createActionCallerAgent(): Promise<IActionCallerAgent> {
    const model = this.getModelForAgent("actionCaller");
    return new ActionCallerAgent(
      this.dependencies.ollamaUrl,
      model,
      this.dependencies.contextManager,
      this.dependencies.vectorDatabase,
      this.config.actionCaller
    );
  }

  protected async createEmbedderAgent(): Promise<IEmbedderAgent> {
    const model = this.getModelForAgent("embedder");
    return new EmbedderAgent(
      this.dependencies.ollamaUrl,
      model,
      this.config.embedder
    );
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
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
