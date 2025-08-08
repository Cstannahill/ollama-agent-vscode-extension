/**
 * Sophisticated Agent Caching System
 * 
 * Provides persistent state storage, intelligent warm-up, and performance optimization
 * for foundation agents to dramatically reduce initialization time.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../utils/logger';
import { FoundationAgents } from '../FoundationAgentFactory';

export interface AgentCacheEntry {
  agentType: keyof FoundationAgents;
  model: string;
  capabilities: string[];
  lastInitialized: number;
  configuration: any;
  healthStatus: boolean;
  initializationTime: number;
  warmupData?: any; // Pre-computed data for faster startup
}

export interface CacheConfig {
  enabled: boolean;
  maxAge: number; // milliseconds
  persistToDisk: boolean;
  warmupEnabled: boolean;
  precomputeEmbeddings: boolean;
  validateOnLoad: boolean;
}

export interface CacheMetrics {
  totalCacheHits: number;
  totalCacheMisses: number;
  totalInitTime: number;
  averageInitTime: number;
  lastCleanup: number;
}

/**
 * Advanced caching system for foundation agents
 */
export class AgentCache {
  private cache = new Map<string, AgentCacheEntry>();
  private cacheDir: string;
  private config: CacheConfig;
  private metrics: CacheMetrics;

  constructor(cacheDir: string, config: Partial<CacheConfig> = {}) {
    this.cacheDir = cacheDir;
    this.config = {
      enabled: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      persistToDisk: true,
      warmupEnabled: true,
      precomputeEmbeddings: true,
      validateOnLoad: false,
      ...config
    };

    this.metrics = {
      totalCacheHits: 0,
      totalCacheMisses: 0,
      totalInitTime: 0,
      averageInitTime: 0,
      lastCleanup: Date.now()
    };

    this.ensureCacheDirectory();
    this.loadCacheFromDisk();
  }

  /**
   * Get cached agent entry if valid
   */
  async get(agentType: keyof FoundationAgents, model: string, config: any): Promise<AgentCacheEntry | null> {
    if (!this.config.enabled) return null;

    const cacheKey = this.generateCacheKey(agentType, model, config);
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      this.metrics.totalCacheMisses++;
      return null;
    }

    // Check cache age
    if (Date.now() - entry.lastInitialized > this.config.maxAge) {
      this.cache.delete(cacheKey);
      this.metrics.totalCacheMisses++;
      return null;
    }

    // Optional validation
    if (this.config.validateOnLoad && !(await this.validateCacheEntry(entry))) {
      this.cache.delete(cacheKey);
      this.metrics.totalCacheMisses++;
      return null;
    }

    this.metrics.totalCacheHits++;
    logger.debug(`[AGENT_CACHE] Cache hit for ${agentType} with model ${model}`);
    return entry;
  }

  /**
   * Store agent entry in cache
   */
  async set(
    agentType: keyof FoundationAgents,
    model: string,
    config: any,
    agent: any,
    initTime: number
  ): Promise<void> {
    if (!this.config.enabled) return;

    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(agentType, model, config);

    // Pre-compute warmup data for faster future initialization
    const warmupData = await this.generateWarmupData(agent, agentType);

    const entry: AgentCacheEntry = {
      agentType,
      model,
      capabilities: agent.getCapabilities ? agent.getCapabilities() : [],
      lastInitialized: Date.now(),
      configuration: this.sanitizeConfig(config),
      healthStatus: agent.isInitialized ? agent.isInitialized() : true,
      initializationTime: initTime,
      warmupData
    };

    this.cache.set(cacheKey, entry);
    
    // Update metrics
    this.metrics.totalInitTime += initTime;
    const totalEntries = this.metrics.totalCacheHits + this.metrics.totalCacheMisses;
    this.metrics.averageInitTime = this.metrics.totalInitTime / Math.max(1, totalEntries);

    // Persist to disk if enabled
    if (this.config.persistToDisk) {
      await this.saveCacheEntryToDisk(cacheKey, entry);
    }

    const cacheTime = Date.now() - startTime;
    logger.debug(`[AGENT_CACHE] Cached ${agentType} in ${cacheTime}ms (init: ${initTime}ms)`);
  }

  /**
   * Generate warmup data for faster agent initialization
   */
  private async generateWarmupData(agent: any, agentType: keyof FoundationAgents): Promise<any> {
    if (!this.config.warmupEnabled) return null;

    try {
      const warmupData: any = {};

      // Pre-compute common operations based on agent type
      switch (agentType) {
        case 'embedder':
          if (this.config.precomputeEmbeddings && agent.embed) {
            warmupData.commonEmbeddings = await this.precomputeCommonEmbeddings(agent);
          }
          break;

        case 'retriever':
          if (agent.retrieveFromContext) {
            warmupData.contextMetadata = await this.cacheContextMetadata(agent);
          }
          break;

        case 'toolSelector':
          if (agent.loadToolMetadata) {
            warmupData.toolMetadata = await this.cacheToolMetadata(agent);
          }
          break;

        default:
          // Generic warmup - test basic functionality
          warmupData.basicTest = true;
      }

      return warmupData;
    } catch (error) {
      logger.warn(`[AGENT_CACHE] Failed to generate warmup data for ${agentType}:`, error);
      return null;
    }
  }

  /**
   * Pre-compute common embeddings to avoid repeated calculation
   */
  private async precomputeCommonEmbeddings(embedderAgent: any): Promise<any> {
    const commonQueries = [
      'function',
      'class', 
      'variable',
      'error',
      'test',
      'documentation',
      'api',
      'method',
      'property',
      'typescript'
    ];

    const embeddings: { [query: string]: number[] } = {};

    try {
      for (const query of commonQueries) {
        const embedding = await embedderAgent.embed(query);
        if (embedding && embedding.length > 0) {
          embeddings[query] = embedding;
        }
      }
    } catch (error) {
      logger.warn('[AGENT_CACHE] Failed to precompute embeddings:', error);
    }

    return embeddings;
  }

  /**
   * Cache context metadata for faster retrieval
   */
  private async cacheContextMetadata(retrieverAgent: any): Promise<any> {
    try {
      // Cache frequently accessed context patterns
      return {
        lastAccessed: Date.now(),
        commonPatterns: ['class', 'function', 'interface', 'type', 'import']
      };
    } catch (error) {
      logger.warn('[AGENT_CACHE] Failed to cache context metadata:', error);
      return null;
    }
  }

  /**
   * Cache tool metadata for faster tool selection
   */
  private async cacheToolMetadata(toolSelectorAgent: any): Promise<any> {
    try {
      if (toolSelectorAgent.toolMetadataCache) {
        return {
          size: toolSelectorAgent.toolMetadataCache.size,
          lastUpdated: Date.now()
        };
      }
      return null;
    } catch (error) {
      logger.warn('[AGENT_CACHE] Failed to cache tool metadata:', error);
      return null;
    }
  }

  /**
   * Validate cache entry integrity
   */
  private async validateCacheEntry(entry: AgentCacheEntry): Promise<boolean> {
    try {
      // Basic validation checks
      if (!entry.agentType || !entry.model || !entry.capabilities) {
        return false;
      }

      // Check if configuration is still valid
      if (entry.configuration && typeof entry.configuration !== 'object') {
        return false;
      }

      return true;
    } catch (error) {
      logger.warn('[AGENT_CACHE] Cache entry validation failed:', error);
      return false;
    }
  }

  /**
   * Apply cached warmup data to accelerate agent initialization
   */
  async applyWarmupData(agent: any, entry: AgentCacheEntry): Promise<void> {
    if (!entry.warmupData) return;

    try {
      const { agentType, warmupData } = entry;

      switch (agentType) {
        case 'embedder':
          if (warmupData.commonEmbeddings && agent.embeddingCache) {
            // Pre-populate embedding cache
            Object.entries(warmupData.commonEmbeddings).forEach(([query, embedding]) => {
              const cacheKey = agent.getCacheKey ? agent.getCacheKey(query) : query;
              agent.embeddingCache.set(cacheKey, embedding);
            });
            logger.debug(`[AGENT_CACHE] Applied ${Object.keys(warmupData.commonEmbeddings).length} cached embeddings`);
          }
          break;

        case 'toolSelector':
          if (warmupData.toolMetadata && agent.toolMetadataCache) {
            // Tool metadata is already loaded during initialization
            logger.debug('[AGENT_CACHE] Tool metadata warmup data available');
          }
          break;

        default:
          logger.debug(`[AGENT_CACHE] Applied generic warmup data for ${agentType}`);
      }
    } catch (error) {
      logger.warn(`[AGENT_CACHE] Failed to apply warmup data for ${entry.agentType}:`, error);
    }
  }

  /**
   * Generate cache key from agent type, model, and config
   */
  private generateCacheKey(agentType: keyof FoundationAgents, model: string, config: any): string {
    const configHash = this.hashConfig(config);
    return `${agentType}_${model}_${configHash}`;
  }

  /**
   * Generate config hash for cache key
   */
  private hashConfig(config: any): string {
    const configStr = JSON.stringify(this.sanitizeConfig(config));
    return this.simpleHash(configStr).toString(36);
  }

  /**
   * Remove sensitive data from config for caching
   */
  private sanitizeConfig(config: any): any {
    if (!config || typeof config !== 'object') return {};
    
    const sanitized = { ...config };
    
    // Remove sensitive fields
    delete sanitized.apiKey;
    delete sanitized.token;
    delete sanitized.password;
    
    return sanitized;
  }

  /**
   * Simple hash function
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Ensure cache directory exists
   */
  private ensureCacheDirectory(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (error) {
      logger.warn('[AGENT_CACHE] Failed to create cache directory:', error);
    }
  }

  /**
   * Load cache from disk on startup
   */
  private async loadCacheFromDisk(): Promise<void> {
    if (!this.config.persistToDisk) return;

    try {
      const cacheFiles = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.cache.json'));
      
      let loadedCount = 0;
      for (const file of cacheFiles) {
        try {
          const filePath = path.join(this.cacheDir, file);
          const data = fs.readFileSync(filePath, 'utf8');
          const entry: AgentCacheEntry = JSON.parse(data);
          
          // Check if entry is still valid
          if (Date.now() - entry.lastInitialized < this.config.maxAge) {
            const cacheKey = file.replace('.cache.json', '');
            this.cache.set(cacheKey, entry);
            loadedCount++;
          } else {
            // Clean up expired cache file
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          logger.warn(`[AGENT_CACHE] Failed to load cache file ${file}:`, error);
        }
      }

      if (loadedCount > 0) {
        logger.info(`[AGENT_CACHE] Loaded ${loadedCount} cached agent entries from disk`);
      }
    } catch (error) {
      logger.warn('[AGENT_CACHE] Failed to load cache from disk:', error);
    }
  }

  /**
   * Save cache entry to disk
   */
  private async saveCacheEntryToDisk(cacheKey: string, entry: AgentCacheEntry): Promise<void> {
    try {
      const filePath = path.join(this.cacheDir, `${cacheKey}.cache.json`);
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
    } catch (error) {
      logger.warn(`[AGENT_CACHE] Failed to save cache entry ${cacheKey}:`, error);
    }
  }

  /**
   * Clear expired cache entries
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    let cleanedCount = 0;

    // Clean memory cache
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.lastInitialized > this.config.maxAge) {
        this.cache.delete(key);
        cleanedCount++;

        // Clean disk cache too
        if (this.config.persistToDisk) {
          try {
            const filePath = path.join(this.cacheDir, `${key}.cache.json`);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (error) {
            logger.warn(`[AGENT_CACHE] Failed to delete cache file for ${key}:`, error);
          }
        }
      }
    }

    this.metrics.lastCleanup = now;

    if (cleanedCount > 0) {
      logger.info(`[AGENT_CACHE] Cleaned up ${cleanedCount} expired cache entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getMetrics(): CacheMetrics & { cacheSize: number; hitRate: number } {
    const totalRequests = this.metrics.totalCacheHits + this.metrics.totalCacheMisses;
    const hitRate = totalRequests > 0 ? this.metrics.totalCacheHits / totalRequests : 0;

    return {
      ...this.metrics,
      cacheSize: this.cache.size,
      hitRate
    };
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    this.cache.clear();
    
    if (this.config.persistToDisk) {
      try {
        const cacheFiles = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.cache.json'));
        for (const file of cacheFiles) {
          fs.unlinkSync(path.join(this.cacheDir, file));
        }
      } catch (error) {
        logger.warn('[AGENT_CACHE] Failed to clear disk cache:', error);
      }
    }

    logger.info('[AGENT_CACHE] Cache cleared');
  }

  /**
   * Check if agent should be cached
   */
  shouldCache(agentType: keyof FoundationAgents, initTime: number): boolean {
    // Cache agents that take longer than 1 second to initialize
    return this.config.enabled && initTime > 1000;
  }
}