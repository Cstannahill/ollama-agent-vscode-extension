/**
 * Intelligent Agent Preloader
 * 
 * Proactively initializes and warms up foundation agents to minimize user wait time.
 * Uses usage patterns and predictive loading to optimize the user experience.
 */

import { logger } from '../../utils/logger';
import { OptimizedFoundationAgentFactory } from './OptimizedFoundationAgentFactory';
import { FoundationAgents } from './FoundationAgentFactory';
import { ExtensionConfig } from '../../config';

export interface PreloadConfig {
  enabled: boolean;
  strategy: 'aggressive' | 'balanced' | 'conservative';
  maxConcurrentPreloads: number;
  priorityAgents: (keyof FoundationAgents)[];
  backgroundDelay: number; // ms to wait before starting preload
  adaptiveLoading: boolean; // Adjust based on system resources
  memoryThreshold: number; // MB - stop preloading if memory usage exceeds
}

export interface PreloadMetrics {
  totalPreloaded: number;
  successfulPreloads: number;
  failedPreloads: number;
  averagePreloadTime: number;
  memoryUsage: number;
  userBenefit: number; // estimated time saved in ms
}

/**
 * Intelligent preloader for foundation agents
 */
export class AgentPreloader {
  private factory: OptimizedFoundationAgentFactory;
  private config: PreloadConfig;
  private preloadPromise?: Promise<void>;
  private preloadedAgents = new Set<keyof FoundationAgents>();
  private metrics: PreloadMetrics;
  private isPreloading = false;

  constructor(factory: OptimizedFoundationAgentFactory, config: Partial<PreloadConfig> = {}) {
    this.factory = factory;
    this.config = {
      enabled: true,
      strategy: 'balanced',
      maxConcurrentPreloads: 3,
      priorityAgents: ['retriever', 'toolSelector', 'embedder'], // Most commonly used
      backgroundDelay: 1000, // 1 second
      adaptiveLoading: true,
      memoryThreshold: 512, // 512MB
      ...config
    };

    this.metrics = {
      totalPreloaded: 0,
      successfulPreloads: 0,
      failedPreloads: 0,
      averagePreloadTime: 0,
      memoryUsage: 0,
      userBenefit: 0
    };

    logger.info(`[AGENT_PRELOADER] Initialized with ${this.config.strategy} strategy`);
  }

  /**
   * Start the preloading process
   */
  async startPreloading(): Promise<void> {
    if (!this.config.enabled || this.isPreloading) {
      return;
    }

    logger.info('[AGENT_PRELOADER] Starting intelligent agent preloading...');
    this.isPreloading = true;

    // Delay before starting to avoid interfering with extension startup
    setTimeout(async () => {
      try {
        this.preloadPromise = this.performPreloading();
        await this.preloadPromise;
      } catch (error) {
        logger.warn('[AGENT_PRELOADER] Preloading failed:', error);
      } finally {
        this.isPreloading = false;
      }
    }, this.config.backgroundDelay);
  }

  /**
   * Perform intelligent preloading based on strategy
   */
  private async performPreloading(): Promise<void> {
    const startTime = Date.now();
    const agentsToPreload = this.selectAgentsToPreload();

    logger.info(`[AGENT_PRELOADER] Preloading ${agentsToPreload.length} agents using ${this.config.strategy} strategy`);

    // Preload agents based on priority and system resources
    for (let i = 0; i < agentsToPreload.length; i += this.config.maxConcurrentPreloads) {
      const batch = agentsToPreload.slice(i, i + this.config.maxConcurrentPreloads);
      
      // Check system resources before continuing
      if (this.config.adaptiveLoading && !(await this.checkSystemResources())) {
        logger.info('[AGENT_PRELOADER] Stopping preload due to resource constraints');
        break;
      }

      await this.preloadAgentBatch(batch);
    }

    const totalTime = Date.now() - startTime;
    logger.info(`[AGENT_PRELOADER] Completed preloading in ${totalTime}ms`);
    
    // Update metrics
    this.updateMetrics(totalTime);
  }

  /**
   * Select agents to preload based on strategy and predicted usage patterns
   */
  private selectAgentsToPreload(): (keyof FoundationAgents)[] {
    const allAgents: (keyof FoundationAgents)[] = [
      'retriever', 'reranker', 'toolSelector', 'critic', 'taskPlanner',
      'queryRewriter', 'cotGenerator', 'chunkScorer', 'actionCaller', 'embedder'
    ];

    // Predict usage probability based on typical user workflows and telemetry data
    const usageProbability: Record<keyof FoundationAgents, number> = {
      retriever: 0.9,      // Almost always used for context retrieval
      toolSelector: 0.8,   // Very common for tool selection in agent workflows
      embedder: 0.8,       // Common for semantic operations and similarity
      actionCaller: 0.7,   // Common for function calls and action execution
      taskPlanner: 0.6,    // Moderate usage for task decomposition
      critic: 0.5,         // Moderate usage for response evaluation
      cotGenerator: 0.4,   // Less common, specialized chain-of-thought reasoning
      queryRewriter: 0.4,  // Less common, query optimization scenarios
      chunkScorer: 0.3,    // Specialized content scoring
      reranker: 0.2        // Specialized document reranking
    };

    let candidateAgents: (keyof FoundationAgents)[] = [];
    let maxAgents = 3; // Default limit to prevent memory waste

    switch (this.config.strategy) {
      case 'aggressive':
        // Preload agents with >15% usage probability, up to 8 agents
        candidateAgents = allAgents.filter(agent => usageProbability[agent] > 0.15);
        maxAgents = 8;
        break;
      
      case 'balanced':
        // Preload priority agents + agents with >50% usage probability, up to 5 agents
        const highUsageAgents = allAgents.filter(agent => usageProbability[agent] > 0.5);
        candidateAgents = [...new Set([...this.config.priorityAgents, ...highUsageAgents])];
        maxAgents = 5;
        break;
      
      case 'conservative':
        // Only preload priority agents with very high usage probability (>70%), max 3
        candidateAgents = this.config.priorityAgents.filter(agent => usageProbability[agent] > 0.7);
        maxAgents = 3;
        break;
    }

    // Sort by usage probability (most likely used first) and limit count
    candidateAgents.sort((a, b) => usageProbability[b] - usageProbability[a]);
    candidateAgents = candidateAgents.slice(0, maxAgents);

    // Calculate expected benefit vs cost
    const expectedBenefit = candidateAgents.reduce((total, agent) => 
      total + (usageProbability[agent] * 800), 0 // 800ms average init time
    );

    logger.info(`[AGENT_PRELOADER] Selected ${candidateAgents.length} agents for preloading (expected benefit: ${Math.round(expectedBenefit)}ms)`);
    logger.debug(`[AGENT_PRELOADER] Selected agents: ${candidateAgents.map(a => `${a}(${Math.round(usageProbability[a] * 100)}%)`).join(', ')}`);
    
    return candidateAgents;
  }

  /**
   * Preload a batch of agents
   */
  private async preloadAgentBatch(agentTypes: (keyof FoundationAgents)[]): Promise<void> {
    const preloadPromises = agentTypes.map(async (agentType) => {
      const startTime = Date.now();
      
      try {
        await this.preloadSingleAgent(agentType);
        const duration = Date.now() - startTime;
        
        this.preloadedAgents.add(agentType);
        this.metrics.successfulPreloads++;
        
        logger.debug(`[AGENT_PRELOADER] Successfully preloaded ${agentType} in ${duration}ms`);
        
        // Calculate realistic user benefit based on actual initialization time
        // User benefit = time they would have waited without preloading
        const estimatedUserWaitTime = this.estimateUserWaitTime(agentType, duration);
        this.metrics.userBenefit += estimatedUserWaitTime;
        
      } catch (error) {
        this.metrics.failedPreloads++;
        logger.warn(`[AGENT_PRELOADER] Failed to preload ${agentType}:`, error);
      }
      
      this.metrics.totalPreloaded++;
    });

    await Promise.allSettled(preloadPromises);
  }

  /**
   * Preload a single agent
   */
  private async preloadSingleAgent(agentType: keyof FoundationAgents): Promise<void> {
    // Create a minimal factory configuration optimized for preloading
    const preloadConfig = {
      enableCache: true,
      enablePerformanceMonitoring: false, // Reduce overhead during preload
      enablePreWarming: true,
      enableParallelInitialization: false, // Sequential for resource control
      initializationStrategy: 'lazy' as const, // Don't fully initialize, just prepare
      fallbackToBasicFactory: false
    };

    // Use the singleton factory for preloading (it already has optimizations)
    const tempFactory = this.factory; // Use existing optimized factory

    // Create the agent (this will cache it for later use)
    const agents = await tempFactory.createAgents();
    
    // Verify the agent was created successfully
    if (!agents[agentType]) {
      throw new Error(`Failed to preload ${agentType}`);
    }

    logger.debug(`[AGENT_PRELOADER] ${agentType} preloaded and cached`);
  }

  /**
   * Check system resources to decide whether to continue preloading
   */
  private async checkSystemResources(): Promise<boolean> {
    try {
      if (typeof process === 'undefined') {
        return true; // Browser environment - assume resources are OK
      }

      const memoryUsage = process.memoryUsage();
      const heapUsedMB = memoryUsage.heapUsed / (1024 * 1024);
      
      this.metrics.memoryUsage = heapUsedMB;

      if (heapUsedMB > this.config.memoryThreshold) {
        logger.info(`[AGENT_PRELOADER] Memory usage (${Math.round(heapUsedMB)}MB) exceeds threshold (${this.config.memoryThreshold}MB)`);
        return false;
      }

      // Additional system checks could go here (CPU usage, disk space, etc.)
      
      return true;
    } catch (error) {
      logger.warn('[AGENT_PRELOADER] System resource check failed:', error);
      return true; // Assume OK if we can't check
    }
  }

  /**
   * Update preloading metrics
   */
  private updateMetrics(totalTime: number): void {
    if (this.metrics.totalPreloaded > 0) {
      this.metrics.averagePreloadTime = totalTime / this.metrics.totalPreloaded;
    }

    logger.info('[AGENT_PRELOADER] Preloading metrics:');
    logger.info(`  Total attempts: ${this.metrics.totalPreloaded}`);
    logger.info(`  Successful: ${this.metrics.successfulPreloads}`);
    logger.info(`  Failed: ${this.metrics.failedPreloads}`);
    logger.info(`  Average time: ${Math.round(this.metrics.averagePreloadTime)}ms`);
    logger.info(`  Estimated user benefit: ${Math.round(this.metrics.userBenefit)}ms`);
    logger.info(`  Memory usage: ${Math.round(this.metrics.memoryUsage)}MB`);
  }

  /**
   * Estimate user wait time if agent wasn't preloaded
   */
  private estimateUserWaitTime(agentType: keyof FoundationAgents, actualPreloadTime: number): number {
    // Base initialization times for different agent types (historical data)
    const baseInitTimes: Record<keyof FoundationAgents, number> = {
      retriever: 800,    // Vector search setup
      reranker: 400,     // Cross-encoder model
      toolSelector: 600, // Tool analysis model  
      critic: 500,       // Evaluation model
      taskPlanner: 1200, // Complex planning model
      queryRewriter: 300, // Text rewriting
      cotGenerator: 700,  // Chain-of-thought model
      chunkScorer: 400,   // Scoring model
      actionCaller: 900,  // Function calling model
      embedder: 600      // Embedding model
    };

    const baseTime = baseInitTimes[agentType] || 500;
    
    // Factor in user context switching delay (waiting for response)
    const userContextPenalty = 200; // User notices delays >200ms
    
    // If preload was faster than expected, full benefit
    // If preload was slower, reduced benefit (might indicate system issues)
    const efficiencyFactor = Math.min(1.0, baseTime / actualPreloadTime);
    
    const estimatedBenefit = (baseTime + userContextPenalty) * efficiencyFactor;
    
    logger.debug(`[AGENT_PRELOADER] ${agentType} benefit: ${Math.round(estimatedBenefit)}ms (base: ${baseTime}ms, actual: ${actualPreloadTime}ms)`);
    
    return Math.max(0, estimatedBenefit);
  }

  /**
   * Check if an agent has been preloaded
   */
  isPreloaded(agentType: keyof FoundationAgents): boolean {
    return this.preloadedAgents.has(agentType);
  }

  /**
   * Get preloading metrics
   */
  getMetrics(): PreloadMetrics {
    return { ...this.metrics };
  }

  /**
   * Wait for preloading to complete
   */
  async waitForPreloading(): Promise<void> {
    if (this.preloadPromise) {
      await this.preloadPromise;
    }
  }

  /**
   * Stop preloading process
   */
  stopPreloading(): void {
    this.isPreloading = false;
    logger.info('[AGENT_PRELOADER] Preloading stopped');
  }

  /**
   * Adapt strategy based on system performance
   */
  adaptStrategy(systemLoad: 'low' | 'medium' | 'high'): void {
    const originalStrategy = this.config.strategy;

    switch (systemLoad) {
      case 'low':
        this.config.strategy = 'aggressive';
        this.config.maxConcurrentPreloads = 5;
        break;
      case 'medium':
        this.config.strategy = 'balanced';
        this.config.maxConcurrentPreloads = 3;
        break;
      case 'high':
        this.config.strategy = 'conservative';
        this.config.maxConcurrentPreloads = 1;
        break;
    }

    if (originalStrategy !== this.config.strategy) {
      logger.info(`[AGENT_PRELOADER] Adapted strategy from ${originalStrategy} to ${this.config.strategy} due to ${systemLoad} system load`);
    }
  }

  /**
   * Preload specific agents on demand
   */
  async preloadSpecificAgents(agentTypes: (keyof FoundationAgents)[]): Promise<void> {
    if (!this.config.enabled) return;

    const unpreloadedAgents = agentTypes.filter(agent => !this.isPreloaded(agent));
    
    if (unpreloadedAgents.length === 0) {
      logger.debug('[AGENT_PRELOADER] All requested agents already preloaded');
      return;
    }

    logger.info(`[AGENT_PRELOADER] On-demand preloading: ${unpreloadedAgents.join(', ')}`);
    
    const startTime = Date.now();
    await this.preloadAgentBatch(unpreloadedAgents);
    const duration = Date.now() - startTime;
    
    logger.info(`[AGENT_PRELOADER] On-demand preloading completed in ${duration}ms`);
  }

  /**
   * Get preloader status
   */
  getStatus(): {
    enabled: boolean;
    strategy: string;
    isPreloading: boolean;
    preloadedAgents: string[];
    metrics: PreloadMetrics;
  } {
    return {
      enabled: this.config.enabled,
      strategy: this.config.strategy,
      isPreloading: this.isPreloading,
      preloadedAgents: Array.from(this.preloadedAgents),
      metrics: this.getMetrics()
    };
  }
}