/**
 * Optimized Foundation Agent Factory with Advanced Caching
 *
 * Dramatically reduces initialization time through sophisticated caching,
 * intelligent warm-up strategies, and performance optimization.
 */

import * as path from "path";
import { logger } from "../../utils/logger";
import {
  FoundationAgentFactory,
  FoundationAgentDependencies,
  FoundationAgents,
} from "./FoundationAgentFactory";
import { FoundationPipelineConfig } from "./IFoundationAgent";
import { AgentCache, CacheConfig } from "./cache/AgentCache";
import {
  PerformanceMonitor,
  InitializationMetrics,
} from "./cache/PerformanceMonitor";

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

export interface OptimizationConfig {
  enableCache: boolean;
  enablePerformanceMonitoring: boolean;
  enablePreWarming: boolean;
  enableParallelInitialization: boolean;
  cacheConfig: Partial<CacheConfig>;
  initializationStrategy: "eager" | "lazy" | "hybrid";
  maxConcurrentInitializations: number;
  fallbackToBasicFactory: boolean;
}

/**
 * High-performance foundation agent factory with advanced caching and optimization
 */
export class OptimizedFoundationAgentFactory extends FoundationAgentFactory {
  private cache: AgentCache;
  private performanceMonitor: PerformanceMonitor;
  private optimizationConfig: OptimizationConfig;
  private warmupPromise?: Promise<void>;
  private initializationPool = new Map<keyof FoundationAgents, Promise<any>>();
  
  // Thread-safety inherited from base class
  
  // Singleton pattern implementation
  private static optimizedInstance: OptimizedFoundationAgentFactory | null = null;
  private static optimizedInstanceKey: string | null = null;
  
  // Global warmup completion flag to prevent infinite loops
  private static warmupCompleted = false;
  private static instanceCount = 0;

  private constructor(
    dependencies: FoundationAgentDependencies,
    config: Partial<FoundationPipelineConfig> = {},
    optimizationConfig: Partial<OptimizationConfig> = {}
  ) {
    super(dependencies, config);
    
    // Track factory instances to detect creation loops
    OptimizedFoundationAgentFactory.instanceCount++;
    if (OptimizedFoundationAgentFactory.instanceCount > 10) {
      logger.error(`[OPTIMIZED_FACTORY] EMERGENCY: Too many factory instances created (${OptimizedFoundationAgentFactory.instanceCount})! Possible infinite loop.`);
      throw new Error("Too many OptimizedFoundationAgentFactory instances - infinite loop detected");
    }
    
    logger.debug(`[OPTIMIZED_FACTORY] Instance ${OptimizedFoundationAgentFactory.instanceCount} created`);

    this.optimizationConfig = {
      enableCache: true,
      enablePerformanceMonitoring: true,
      enablePreWarming: true,
      enableParallelInitialization: true,
      initializationStrategy: "hybrid",
      maxConcurrentInitializations: 5,
      fallbackToBasicFactory: true,
      cacheConfig: {
        enabled: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        persistToDisk: true,
        warmupEnabled: true,
        precomputeEmbeddings: true,
        validateOnLoad: false,
      },
      ...optimizationConfig,
    };

    // Initialize cache and performance monitoring
    const cacheDir = path.join(
      process.env.HOME || process.env.USERPROFILE || ".",
      ".ollama-agent",
      "cache"
    );
    this.cache = new AgentCache(cacheDir, this.optimizationConfig.cacheConfig);
    this.performanceMonitor = new PerformanceMonitor();

    logger.info(
      "[OPTIMIZED_FACTORY] Initialized optimized foundation agent factory"
    );

    // Start background warmup if enabled
    if (this.optimizationConfig.enablePreWarming) {
      this.startBackgroundWarmup();
    }
  }

  /**
   * Create agents with advanced caching and optimization (thread-safe)
   */
  async createAgents(): Promise<FoundationAgents> {
    // Return existing agents if already created
    if (this.agents && this.initialized) {
      return this.agents;
    }

    // If creation is already in progress, wait for it to complete
    if (this.isCreating && this.creationPromise) {
      logger.debug("[OPTIMIZED_FACTORY] Agent creation already in progress, waiting...");
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
   * Internal method that performs the actual agent creation (optimized version)
   */
  protected async performAgentCreation(): Promise<FoundationAgents> {
    try {
      logger.info(
        "[OPTIMIZED_FACTORY] Creating optimized foundation agents..."
      );
      const startTime = Date.now();

      // Strategy: Try cache-first, then create/initialize only missing agents
      const agents = await this.createAgentsOptimized();

      this.agents = agents;
      const creationTime = Date.now() - startTime;

      logger.info(
        `[OPTIMIZED_FACTORY] Created all agents in ${creationTime}ms (${
          Math.round((creationTime / 1000) * 10) / 10
        }s)`
      );

      // Log performance summary periodically
      if (this.optimizationConfig.enablePerformanceMonitoring) {
        this.performanceMonitor.logSummary();
      }

      return this.agents;
    } catch (error) {
      logger.error(
        "[OPTIMIZED_FACTORY] Failed to create optimized agents:",
        error
      );

      // Fallback to basic factory if enabled
      if (this.optimizationConfig.fallbackToBasicFactory) {
        logger.info("[OPTIMIZED_FACTORY] Falling back to basic factory...");
        return super.createAgents();
      }

      throw error;
    }
  }

  /**
   * Create agents with optimization strategies
   */
  private async createAgentsOptimized(): Promise<FoundationAgents> {
    const agentCreators: Array<{
      type: keyof FoundationAgents;
      creator: () => Promise<any>;
      priority: number;
    }> = [
      // High priority - frequently used
      {
        type: "retriever",
        creator: () =>
          this.createOptimizedAgent("retriever", () =>
            this.createRetrieverAgent()
          ),
        priority: 1,
      },
      {
        type: "toolSelector",
        creator: () =>
          this.createOptimizedAgent("toolSelector", () =>
            this.createToolSelectorAgent()
          ),
        priority: 1,
      },
      {
        type: "embedder",
        creator: () =>
          this.createOptimizedAgent("embedder", () =>
            this.createEmbedderAgent()
          ),
        priority: 1,
      },

      // Medium priority
      {
        type: "taskPlanner",
        creator: () =>
          this.createOptimizedAgent("taskPlanner", () =>
            this.createTaskPlannerAgent()
          ),
        priority: 2,
      },
      {
        type: "cotGenerator",
        creator: () =>
          this.createOptimizedAgent("cotGenerator", () =>
            this.createCoTGeneratorAgent()
          ),
        priority: 2,
      },
      {
        type: "actionCaller",
        creator: () =>
          this.createOptimizedAgent("actionCaller", () =>
            this.createActionCallerAgent()
          ),
        priority: 2,
      },

      // Lower priority - specialized use cases
      {
        type: "reranker",
        creator: () =>
          this.createOptimizedAgent("reranker", () =>
            this.createRerankerAgent()
          ),
        priority: 3,
      },
      {
        type: "critic",
        creator: () =>
          this.createOptimizedAgent("critic", () => this.createCriticAgent()),
        priority: 3,
      },
      {
        type: "queryRewriter",
        creator: () =>
          this.createOptimizedAgent("queryRewriter", () =>
            this.createQueryRewriterAgent()
          ),
        priority: 3,
      },
      {
        type: "chunkScorer",
        creator: () =>
          this.createOptimizedAgent("chunkScorer", () =>
            this.createChunkScorerAgent()
          ),
        priority: 3,
      },
    ];

    // Sort by priority for optimal user experience
    agentCreators.sort((a, b) => a.priority - b.priority);

    let agents: Partial<FoundationAgents> = {};

    if (this.optimizationConfig.enableParallelInitialization) {
      // Parallel initialization with concurrency control
      agents = await this.createAgentsParallel(agentCreators);
    } else {
      // Sequential initialization for resource-constrained environments
      agents = await this.createAgentsSequential(agentCreators);
    }

    // Ensure all agents are present
    const requiredAgents: (keyof FoundationAgents)[] = [
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

    for (const agentType of requiredAgents) {
      if (!agents[agentType]) {
        throw new Error(`Failed to create required agent: ${agentType}`);
      }
    }

    return agents as FoundationAgents;
  }

  /**
   * Create agents in parallel with concurrency control
   */
  private async createAgentsParallel(
    agentCreators: Array<{
      type: keyof FoundationAgents;
      creator: () => Promise<any>;
      priority: number;
    }>
  ): Promise<Partial<FoundationAgents>> {
    const agents: Partial<FoundationAgents> = {};
    const maxConcurrent = this.optimizationConfig.maxConcurrentInitializations;

    // Process agents in batches by priority
    const priorities = [
      ...new Set(agentCreators.map((a) => a.priority)),
    ].sort();

    for (const priority of priorities) {
      const batch = agentCreators.filter((a) => a.priority === priority);

      // Process batch with concurrency limit
      const batchPromises = batch.map(({ type, creator }) =>
        this.limitConcurrency(type, creator)
      );

      const results = await Promise.allSettled(batchPromises);

      results.forEach((result, index) => {
        const { type } = batch[index];
        if (result.status === "fulfilled") {
          agents[type] = result.value;
        } else {
          logger.error(
            `[OPTIMIZED_FACTORY] Failed to create ${type}:`,
            result.reason
          );
          throw new Error(`Failed to create ${type}: ${result.reason}`);
        }
      });

      logger.debug(
        `[OPTIMIZED_FACTORY] Completed priority ${priority} batch (${batch.length} agents)`
      );
    }

    return agents;
  }

  /**
   * Create agents sequentially (fallback for resource-constrained environments)
   */
  private async createAgentsSequential(
    agentCreators: Array<{
      type: keyof FoundationAgents;
      creator: () => Promise<any>;
      priority: number;
    }>
  ): Promise<Partial<FoundationAgents>> {
    const agents: Partial<FoundationAgents> = {};

    for (const { type, creator } of agentCreators) {
      try {
        agents[type] = await creator();
        logger.debug(`[OPTIMIZED_FACTORY] Created ${type} sequentially`);
      } catch (error) {
        logger.error(`[OPTIMIZED_FACTORY] Failed to create ${type}:`, error);
        throw error;
      }
    }

    return agents;
  }

  /**
   * Limit concurrent initialization for resource management
   */
  private async limitConcurrency<T>(
    type: keyof FoundationAgents,
    creator: () => Promise<T>
  ): Promise<T> {
    // Reuse existing initialization if in progress
    if (this.initializationPool.has(type)) {
      return this.initializationPool.get(type)!;
    }

    const promise = creator();
    this.initializationPool.set(type, promise);

    try {
      const result = await promise;
      this.initializationPool.delete(type);
      return result;
    } catch (error) {
      this.initializationPool.delete(type);
      throw error;
    }
  }

  /**
   * Create agent with caching optimization
   */
  private async createOptimizedAgent<T>(
    agentType: keyof FoundationAgents,
    agentCreator: () => Promise<T>
  ): Promise<T> {
    const startTime = this.performanceMonitor.startTiming(agentType);
    let cacheHit = false;
    let agent: T;
    let error: string | undefined;

    try {
      // Try cache first
      if (this.optimizationConfig.enableCache) {
        const model = this.getModelForAgent(agentType);
        const config = this.getAgentConfig(agentType);
        const cachedEntry = await this.cache.get(agentType, model, config);

        if (cachedEntry) {
          // Create agent from cache metadata
          agent = await this.restoreAgentFromCache(agentType, cachedEntry);
          cacheHit = true;
          logger.debug(`[OPTIMIZED_FACTORY] Restored ${agentType} from cache`);
        } else {
          // Create new agent and cache it
          const initStartTime = Date.now();
          agent = await agentCreator();
          const initTime = Date.now() - initStartTime;

          // Cache the agent if it took significant time to initialize
          if (this.cache.shouldCache(agentType, initTime)) {
            await this.cache.set(agentType, model, config, agent, initTime);
            logger.debug(
              `[OPTIMIZED_FACTORY] Cached ${agentType} (init: ${initTime}ms)`
            );
          }
        }
      } else {
        // No caching - create directly
        agent = await agentCreator();
      }

      // Only initialize if not already initialized (robust runtime type guard)
      // Skip initialization for cache-restored agents
      if (
        agent &&
        typeof agent === "object" &&
        "isInitialized" in agent &&
        typeof (agent as any).isInitialized === "function" &&
        !(agent as any).isInitialized() &&
        !cacheHit // Don't initialize cache-restored agents
      ) {
        if (
          "initialize" in agent &&
          typeof (agent as any).initialize === "function"
        ) {
          await (agent as any).initialize();
        }
      }
      // Apply warmup data if available and agent supports it
      if (cacheHit && this.optimizationConfig.enablePreWarming) {
        await this.applyWarmupOptimizations(agent, agentType);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      // Record performance metrics
      if (this.optimizationConfig.enablePerformanceMonitoring) {
        this.performanceMonitor.endTiming(
          agentType,
          startTime,
          !error,
          cacheHit,
          error
        );
      }
    }

    return agent;
  }

  /**
   * Restore agent from cache entry
   */
  private async restoreAgentFromCache<T>(
    agentType: keyof FoundationAgents,
    cacheEntry: any
  ): Promise<T> {
    const model = this.getModelForAgent(agentType);
    const config = this.getAgentConfig(agentType);

    // Create the agent instance (this is fast - no initialization yet)
    let agent: any;

    switch (agentType) {
      case "retriever":
        agent = new RetrieverAgent(
          this.dependencies.ollamaUrl,
          model,
          this.dependencies.contextManager,
          this.dependencies.vectorDatabase,
          config
        );
        break;
      case "reranker":
        agent = new RerankerAgent(this.dependencies.ollamaUrl, model, config);
        break;
      case "toolSelector":
        agent = new ToolSelectorAgent(
          this.dependencies.ollamaUrl,
          model,
          this.dependencies.toolManager,
          config
        );
        break;
      case "critic":
        agent = new CriticAgent(this.dependencies.ollamaUrl, model, config);
        break;
      case "taskPlanner":
        agent = new TaskPlannerAgent(
          this.dependencies.ollamaUrl,
          model,
          this.dependencies.contextManager,
          this.dependencies.vectorDatabase,
          config
        );
        break;
      case "queryRewriter":
        agent = new QueryRewriterAgent(
          this.dependencies.ollamaUrl,
          model,
          config
        );
        break;
      case "cotGenerator":
        agent = new CoTGeneratorAgent(
          this.dependencies.ollamaUrl,
          model,
          this.dependencies.contextManager,
          this.dependencies.vectorDatabase,
          config
        );
        break;
      case "chunkScorer":
        agent = new ChunkScorerAgent(
          this.dependencies.ollamaUrl,
          model,
          config
        );
        break;
      case "actionCaller":
        agent = new ActionCallerAgent(
          this.dependencies.ollamaUrl,
          model,
          this.dependencies.contextManager,
          this.dependencies.vectorDatabase,
          this.dependencies.toolManager,
          config
        );
        break;
      case "embedder":
        agent = new EmbedderAgent(this.dependencies.ollamaUrl, model, config);
        break;
      default:
        throw new Error(`Unknown agent type: ${agentType}`);
    }

    // Mark as initialized (skip expensive initialization)
    if (agent && typeof agent.setInitialized === "function") {
      agent.setInitialized(true);
    }

    // Apply cached warmup data
    await this.cache.applyWarmupData(agent, cacheEntry);

    return agent as T;
  }

  /**
   * Apply warmup optimizations to agent
   */
  private async applyWarmupOptimizations(
    agent: any,
    agentType: keyof FoundationAgents
  ): Promise<void> {
    try {
      // Agent-specific warmup optimizations
      switch (agentType) {
        case "embedder":
          if (agent.embeddingCache && agent.embeddingCache.size > 0) {
            logger.debug(
              `[OPTIMIZED_FACTORY] Applied ${agent.embeddingCache.size} cached embeddings to ${agentType}`
            );
          }
          break;

        case "toolSelector":
          if (agent.toolMetadataCache && agent.toolMetadataCache.size > 0) {
            logger.debug(
              `[OPTIMIZED_FACTORY] Applied cached tool metadata to ${agentType}`
            );
          }
          break;

        // Add more agent-specific optimizations as needed
      }
    } catch (error) {
      logger.warn(
        `[OPTIMIZED_FACTORY] Failed to apply warmup optimizations for ${agentType}:`,
        error
      );
    }
  }

  /**
   * Get agent configuration for caching
   */
  private getAgentConfig(agentType: keyof FoundationAgents): any {
    const allConfig = this.buildDefaultConfig({});
    return allConfig[agentType] || {};
  }

  /**
   * Start background warmup process
   */
  /**
   * Get or create singleton instance of OptimizedFoundationAgentFactory
   */
  public static getInstance(
    dependencies?: FoundationAgentDependencies,
    config?: Partial<FoundationPipelineConfig>,
    optimizationConfig?: Partial<OptimizationConfig>
  ): OptimizedFoundationAgentFactory {
    // Create a unique key based on configuration INCLUDING foundation models
    const newKey = dependencies ? 
      `${dependencies.ollamaUrl}|${dependencies.model}|${dependencies.extensionConfig?.lmdeploy?.enabled || false}|${JSON.stringify(dependencies.extensionConfig?.foundation?.models || {})}|optimized` :
      'default-optimized';
    
    // Return existing instance if configuration matches
    if (OptimizedFoundationAgentFactory.optimizedInstance && OptimizedFoundationAgentFactory.optimizedInstanceKey === newKey) {
      logger.debug(`[OPTIMIZED_FOUNDATION_FACTORY] Returning existing singleton instance`);
      logger.debug(`[OPTIMIZED_FOUNDATION_FACTORY] Cached foundation models: ${JSON.stringify(dependencies?.extensionConfig?.foundation?.models || {}, null, 2)}`);
      return OptimizedFoundationAgentFactory.optimizedInstance;
    }
    
    // Create new instance if configuration changed or no instance exists
    if (dependencies) {
      logger.info(`[OPTIMIZED_FOUNDATION_FACTORY] Creating new singleton instance (config changed)`);
      logger.info(`[OPTIMIZED_FOUNDATION_FACTORY] Foundation models being used: ${JSON.stringify(dependencies.extensionConfig?.foundation?.models || {}, null, 2)}`);
      OptimizedFoundationAgentFactory.optimizedInstance = new OptimizedFoundationAgentFactory(dependencies, config || {}, optimizationConfig || {});
      OptimizedFoundationAgentFactory.optimizedInstanceKey = newKey;
    } else if (!OptimizedFoundationAgentFactory.optimizedInstance) {
      throw new Error("OptimizedFoundationAgentFactory: Cannot create instance without dependencies on first call");
    }
    
    return OptimizedFoundationAgentFactory.optimizedInstance!;
  }
  
  /**
   * Reset singleton instance (for testing/cleanup)
   */
  public static resetInstance(): void {
    OptimizedFoundationAgentFactory.optimizedInstance = null;
    OptimizedFoundationAgentFactory.optimizedInstanceKey = null;
    OptimizedFoundationAgentFactory.instanceCount = 0;
    OptimizedFoundationAgentFactory.warmupCompleted = false;
    
    // Reset EmbedderAgent initialization counter to prevent false alarms
    try {
      const EmbedderAgent = require('./agents/EmbedderAgent').EmbedderAgent;
      if (EmbedderAgent.resetInitializationCount) {
        EmbedderAgent.resetInitializationCount();
      }
    } catch (error) {
      // Silently continue if not available
    }
    
    logger.debug("[OPTIMIZED_FOUNDATION_FACTORY] Singleton instance reset");
  }

  private startBackgroundWarmup(): void {
    if (this.warmupPromise) return;
    if (OptimizedFoundationAgentFactory.warmupCompleted) {
      logger.debug("[OPTIMIZED_FACTORY] Warmup already completed globally, skipping");
      return;
    }

    this.warmupPromise = this.performBackgroundWarmup();
  }

  /**
   * Perform background warmup operations
   */
  private async performBackgroundWarmup(): Promise<void> {
    try {
      logger.info("[OPTIMIZED_FACTORY] Starting background warmup...");

      // Warmup operations that can be done in background
      const warmupTasks = [
        this.warmupCache(),
        this.warmupPerformanceMonitoring(),
        this.warmupContextSystems(),
        this.warmupAllFoundationAgents(), // Preload all 10 agents
      ];

      await Promise.allSettled(warmupTasks);
      logger.info("[OPTIMIZED_FACTORY] Background warmup completed");
    } catch (error) {
      logger.warn("[OPTIMIZED_FACTORY] Background warmup failed:", error);
    }
  }

  /**
   * Warmup cache system
   */
  private async warmupCache(): Promise<void> {
    try {
      // Trigger cache cleanup to remove expired entries
      await this.cache.cleanup();

      // Log cache statistics
      const metrics = this.cache.getMetrics();
      logger.debug(
        `[OPTIMIZED_FACTORY] Cache warmed up - Size: ${
          metrics.cacheSize
        }, Hit rate: ${(metrics.hitRate * 100).toFixed(1)}%`
      );
    } catch (error) {
      logger.warn("[OPTIMIZED_FACTORY] Cache warmup failed:", error);
    }
  }

  /**
   * Warmup performance monitoring
   */
  private async warmupPerformanceMonitoring(): Promise<void> {
    try {
      // Initialize performance monitoring
      const summary = this.performanceMonitor.getSummary();
      logger.debug(
        `[OPTIMIZED_FACTORY] Performance monitoring warmed up - ${summary.totalInitializations} tracked initializations`
      );
    } catch (error) {
      logger.warn(
        "[OPTIMIZED_FACTORY] Performance monitoring warmup failed:",
        error
      );
    }
  }

  /**
   * Warmup context systems
   */
  private async warmupContextSystems(): Promise<void> {
    try {
      // Warmup context manager and vector database connections
      if (this.dependencies.contextManager) {
        // Trigger a small test search to warm up connections
        await this.dependencies.contextManager.searchContext({
          query: "warmup",
          maxResults: 1,
        });
      }

      if (this.dependencies.vectorDatabase) {
        // Initialize vector database connection
        await this.dependencies.vectorDatabase.initialize();
      }

      logger.debug("[OPTIMIZED_FACTORY] Context systems warmed up");
    } catch (error) {
      logger.debug(
        "[OPTIMIZED_FACTORY] Context systems warmup completed with warnings:",
        error
      );
    }
  }

  /**
   * Get optimization statistics
   */
  getOptimizationStats(): {
    cacheMetrics: ReturnType<AgentCache["getMetrics"]>;
    performanceMetrics: ReturnType<PerformanceMonitor["getSummary"]>;
    config: OptimizationConfig;
  } {
    return {
      cacheMetrics: this.cache.getMetrics(),
      performanceMetrics: this.performanceMonitor.getSummary(),
      config: this.optimizationConfig,
    };
  }

  /**
   * Clear all caches and reset optimization
   */
  async clearOptimizationCache(): Promise<void> {
    await this.cache.clear();
    this.performanceMonitor.clear();
    this.initializationPool.clear();
    logger.info("[OPTIMIZED_FACTORY] Optimization cache cleared");
  }

  /**
   * Preload and cache all 10 foundation agents for optimal startup performance.
   * This guarantees the agent cache covers all agent types.
   */
  private async warmupAllFoundationAgents(): Promise<void> {
    // Prevent multiple warmup attempts
    if (OptimizedFoundationAgentFactory.warmupCompleted) {
      logger.debug("[OPTIMIZED_FACTORY] Warmup already completed, skipping");
      return;
    }
    
    try {
      logger.debug("[OPTIMIZED_FACTORY] Creating optimized foundation agents...");
      
      const agentTypes: (keyof FoundationAgents)[] = [
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
      
      // Emergency brake: limit to max 10 iterations
      let agentCount = 0;
      for (const type of agentTypes) {
        if (++agentCount > 10) {
          logger.error("[OPTIMIZED_FACTORY] EMERGENCY: Too many agent creation attempts, stopping");
          break;
        }
        
        await this.createOptimizedAgent(type, () =>
          this.createAgentByType(type)
        );
      }
      
      OptimizedFoundationAgentFactory.warmupCompleted = true;
      logger.info(
        "[OPTIMIZED_FACTORY] All foundation agents preloaded and cached"
      );
    } catch (error) {
      logger.warn("[OPTIMIZED_FACTORY] Foundation agent warmup failed:", error);
    }
  }

  /**
   * Helper to create agent by type (used for warmup)
   */
  private async createAgentByType(type: keyof FoundationAgents): Promise<any> {
    switch (type) {
      case "retriever":
        return this.createRetrieverAgent();
      case "reranker":
        return this.createRerankerAgent();
      case "toolSelector":
        return this.createToolSelectorAgent();
      case "critic":
        return this.createCriticAgent();
      case "taskPlanner":
        return this.createTaskPlannerAgent();
      case "queryRewriter":
        return this.createQueryRewriterAgent();
      case "cotGenerator":
        return this.createCoTGeneratorAgent();
      case "chunkScorer":
        return this.createChunkScorerAgent();
      case "actionCaller":
        return this.createActionCallerAgent();
      case "embedder":
        return this.createEmbedderAgent();
      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
  }
}
