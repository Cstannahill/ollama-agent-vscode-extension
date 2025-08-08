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
   * Select agents to preload based on strategy and usage patterns
   */
  private selectAgentsToPreload(): (keyof FoundationAgents)[] {
    const allAgents: (keyof FoundationAgents)[] = [
      'retriever', 'reranker', 'toolSelector', 'critic', 'taskPlanner',
      'queryRewriter', 'cotGenerator', 'chunkScorer', 'actionCaller', 'embedder'
    ];

    switch (this.config.strategy) {
      case 'aggressive':
        // Preload all agents
        return allAgents;

      case 'conservative':
        // Only preload the most critical agents
        return this.config.priorityAgents.slice(0, 2);

      case 'balanced':
      default:
        // Preload priority agents plus a few others based on usage patterns
        const prioritySet = new Set(this.config.priorityAgents);
        const balanced = [...this.config.priorityAgents];
        
        // Add additional frequently used agents
        const additionalAgents = ['taskPlanner', 'cotGenerator'];
        for (const agent of additionalAgents) {
          if (!prioritySet.has(agent as keyof FoundationAgents) && balanced.length < 6) {
            balanced.push(agent as keyof FoundationAgents);
          }
        }
        
        return balanced;
    }
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
        
        // Estimate user benefit (time saved on first use)
        this.metrics.userBenefit += Math.max(0, duration - 100); // Assume cache overhead of 100ms
        
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

    // Create a temporary optimized factory for preloading
    const tempFactory = new OptimizedFoundationAgentFactory(
      this.factory['dependencies'], // Access private dependencies
      this.factory['config'], // Access private config
      preloadConfig
    );

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