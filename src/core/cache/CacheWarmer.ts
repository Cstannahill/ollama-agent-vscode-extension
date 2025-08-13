/**
 * Cache Warming System
 * 
 * Preloads and warms caches during extension startup to improve
 * initial performance and user experience.
 */

import { logger } from "../../utils/logger";
import { CacheManager } from "./CacheManager";
import { ToolManager } from "../ToolManager";

export interface WarmupConfig {
  enableToolCache: boolean;
  enableAgentCache: boolean;
  enableEmbeddingCache: boolean;
  warmupBatchSize: number;
  maxWarmupTimeMs: number;
}

export class CacheWarmer {
  private static instance: CacheWarmer;
  private cacheManager: CacheManager;
  private isWarming = false;
  
  private constructor() {
    this.cacheManager = CacheManager.getInstance();
  }
  
  static getInstance(): CacheWarmer {
    if (!CacheWarmer.instance) {
      CacheWarmer.instance = new CacheWarmer();
    }
    return CacheWarmer.instance;
  }

  /**
   * Warm up all caches with essential data
   */
  async warmupAll(
    toolManager: ToolManager,
    config: Partial<WarmupConfig> = {}
  ): Promise<void> {
    if (this.isWarming) {
      logger.debug("[CACHE_WARMER] Warmup already in progress");
      return;
    }

    const fullConfig: WarmupConfig = {
      enableToolCache: true,
      enableAgentCache: true,
      enableEmbeddingCache: true,
      warmupBatchSize: 10,
      maxWarmupTimeMs: 5000, // 5 seconds max warmup time
      ...config
    };

    this.isWarming = true;
    const startTime = Date.now();
    
    try {
      logger.info("[CACHE_WARMER] Starting cache warmup process...");

      const warmupPromises: Promise<void>[] = [];

      // Tool cache warmup
      if (fullConfig.enableToolCache) {
        warmupPromises.push(this.warmupToolCache(toolManager));
      }

      // Agent cache warmup 
      if (fullConfig.enableAgentCache) {
        warmupPromises.push(this.warmupAgentCache());
      }

      // Embedding cache warmup
      if (fullConfig.enableEmbeddingCache) {
        warmupPromises.push(this.warmupEmbeddingCache());
      }

      // Execute warmup with timeout
      await Promise.race([
        Promise.allSettled(warmupPromises),
        this.timeout(fullConfig.maxWarmupTimeMs)
      ]);

      const elapsedTime = Date.now() - startTime;
      logger.info(`[CACHE_WARMER] Cache warmup completed in ${elapsedTime}ms`);
      
      // Log cache statistics after warmup
      this.logWarmupStats();

    } catch (error) {
      logger.warn(`[CACHE_WARMER] Cache warmup failed: ${error}`);
    } finally {
      this.isWarming = false;
    }
  }

  /**
   * Warm up tool-related caches
   */
  private async warmupToolCache(toolManager: ToolManager): Promise<void> {
    try {
      logger.debug("[CACHE_WARMER] Warming up tool cache...");
      
      // Preload commonly accessed tool data
      toolManager.warmupCache();
      
      logger.debug("[CACHE_WARMER] Tool cache warmup completed");
    } catch (error) {
      logger.warn(`[CACHE_WARMER] Tool cache warmup failed: ${error}`);
    }
  }

  /**
   * Warm up agent-related caches
   */
  private async warmupAgentCache(): Promise<void> {
    try {
      logger.debug("[CACHE_WARMER] Warming up agent cache...");
      
      // Preload agent metadata and configurations with long TTL for persistence
      const agentCache = this.cacheManager.getCache('agents', {
        maxSize: 50,
        maxMemoryMB: 20, // Increased for longer persistence
        defaultTTLMs: 86400000, // 24 hours (persistent agents)
        enableLRU: true
      });

      // Preload common agent configurations
      const commonConfigs = [
        'foundation_basic_agent',
        'code_review_agent', 
        'test_automation_agent',
        'documentation_agent',
        'refactoring_agent'
      ];

      for (const configKey of commonConfigs) {
        agentCache.set(configKey, { preloaded: true, timestamp: Date.now() });
      }
      
      logger.debug(`[CACHE_WARMER] Agent cache warmup completed (${commonConfigs.length} configs)`);
    } catch (error) {
      logger.warn(`[CACHE_WARMER] Agent cache warmup failed: ${error}`);
    }
  }

  /**
   * Warm up embedding cache with common vectors
   */
  private async warmupEmbeddingCache(): Promise<void> {
    try {
      logger.debug("[CACHE_WARMER] Warming up embedding cache...");
      
      const embeddingCache = this.cacheManager.getCache('embeddings_warmup', {
        maxSize: 200, // Increased capacity
        maxMemoryMB: 50, // More memory for longer retention
        defaultTTLMs: 86400000, // 24 hours (persistent embeddings)
        enableLRU: true
      });

      // Precompute embeddings for common programming terms
      const commonTerms = [
        'function',
        'variable',
        'class',
        'method',
        'return',
        'import',
        'export',
        'interface',
        'type',
        'const'
      ];

      for (const term of commonTerms) {
        // Generate deterministic embedding for common terms
        const embedding = this.generateDeterministicEmbedding(term);
        embeddingCache.set(`warmup_${term}`, embedding);
      }
      
      logger.debug(`[CACHE_WARMER] Embedding cache warmup completed (${commonTerms.length} terms)`);
    } catch (error) {
      logger.warn(`[CACHE_WARMER] Embedding cache warmup failed: ${error}`);
    }
  }

  /**
   * Warm up project context cache
   */
  async warmupProjectCache(workspacePath: string): Promise<void> {
    try {
      logger.debug("[CACHE_WARMER] Warming up project cache...");
      
      const projectCache = this.cacheManager.getCache('project_context', {
        maxSize: 500, // More project data
        maxMemoryMB: 100, // More memory for project context
        defaultTTLMs: 86400000, // 24 hours (persistent project context)
        enableLRU: true
      });

      // Cache common project patterns and structures
      projectCache.set('workspace_path', workspacePath);
      projectCache.set('last_indexed', Date.now());
      projectCache.set('project_type', 'unknown'); // Will be determined during indexing
      
      logger.debug("[CACHE_WARMER] Project cache warmup completed");
    } catch (error) {
      logger.warn(`[CACHE_WARMER] Project cache warmup failed: ${error}`);
    }
  }

  /**
   * Schedule periodic cache maintenance
   */
  startMaintenanceSchedule(): void {
    // Reduced maintenance frequency to avoid aggressive cache eviction
    // Run cache cleanup every 30 minutes (was 10 minutes)
    setInterval(() => {
      this.performMaintenance();
    }, 1800000);

    // Log cache statistics every 15 minutes (was 5 minutes) 
    setInterval(() => {
      // Always log stats in maintenance - the logger will handle level filtering
      this.cacheManager.logStats();
    }, 900000);
    
    logger.info("[CACHE_WARMER] Started optimized cache maintenance schedule (30min cleanup, 15min stats)");
  }

  /**
   * Perform routine cache maintenance
   */
  performMaintenance(): void {
    try {
      const cleaned = this.cacheManager.cleanupAll();
      if (cleaned > 0) {
        logger.debug(`[CACHE_WARMER] Maintenance cleaned ${cleaned} expired entries`);
      }
    } catch (error) {
      logger.warn(`[CACHE_WARMER] Cache maintenance failed: ${error}`);
    }
  }

  /**
   * Log warmup statistics
   */
  private logWarmupStats(): void {
    const stats = this.cacheManager.getGlobalStats();
    const totalSize = Object.values(stats).reduce((sum, stat) => sum + stat.size, 0);
    const totalMemory = Object.values(stats).reduce((sum, stat) => sum + stat.memoryUsageMB, 0);
    
    logger.info(
      `[CACHE_WARMER] Warmup stats: ${totalSize} entries, ${totalMemory.toFixed(2)}MB across ${Object.keys(stats).length} caches`
    );
  }

  /**
   * Generate deterministic embedding for warmup
   */
  private generateDeterministicEmbedding(text: string): number[] {
    const embedding = new Array(384).fill(0);
    
    for (let i = 0; i < text.length && i < embedding.length; i++) {
      const charCode = text.charCodeAt(i);
      embedding[i] = Math.sin(charCode * 0.1) * 0.5 + 0.5;
    }
    
    // Add some deterministic variation based on text properties
    const textHash = this.simpleHash(text);
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] += Math.sin((textHash + i) * 0.01) * 0.1;
    }
    
    return embedding;
  }

  /**
   * Simple hash function for deterministic embeddings
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Timeout utility
   */
  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Warmup timeout')), ms);
    });
  }
}