/**
 * Unified Cache Management System
 * 
 * Provides enterprise-grade caching with LRU eviction, TTL support,
 * statistics monitoring, and configurable cache policies.
 */

import { logger } from "../../utils/logger";

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expires: number;
  accessCount: number;
  lastAccessed: number;
  size: number; // Estimated size in bytes
}

export interface CacheConfig {
  maxSize: number; // Maximum number of entries
  maxMemoryMB: number; // Maximum memory usage in MB
  defaultTTLMs: number; // Default TTL in milliseconds
  enableLRU: boolean; // Enable LRU eviction
  enableStats: boolean; // Enable statistics collection
  cleanupIntervalMs: number; // Cleanup interval
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  size: number;
  memoryUsageMB: number;
  hitRate: number;
  oldestEntry: number;
  newestEntry: number;
}

export class SmartCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private accessOrder: string[] = []; // LRU tracking
  private stats: CacheStats;
  private config: CacheConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 1000,
      maxMemoryMB: 50,
      defaultTTLMs: 300000, // 5 minutes
      enableLRU: true,
      enableStats: true,
      cleanupIntervalMs: 60000, // 1 minute
      ...config
    };

    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
      size: 0,
      memoryUsageMB: 0,
      hitRate: 0,
      oldestEntry: 0,
      newestEntry: 0
    };

    if (this.config.cleanupIntervalMs > 0) {
      this.startCleanupTimer();
    }

    logger.debug(`[CACHE] SmartCache initialized with maxSize: ${this.config.maxSize}, maxMemory: ${this.config.maxMemoryMB}MB`);
  }

  /**
   * Set a cache entry with optional TTL
   */
  set(key: string, data: T, ttlMs?: number): void {
    const now = Date.now();
    const ttl = ttlMs ?? this.config.defaultTTLMs;
    const estimatedSize = this.estimateSize(data);
    
    // Remove existing entry if it exists
    if (this.cache.has(key)) {
      this.delete(key);
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      expires: now + ttl,
      accessCount: 0,
      lastAccessed: now,
      size: estimatedSize
    };

    // Check memory limits before adding
    if (this.shouldEvict(estimatedSize)) {
      this.performEviction(estimatedSize);
    }

    this.cache.set(key, entry);
    
    if (this.config.enableLRU) {
      this.updateAccessOrder(key);
    }

    this.stats.sets++;
    this.updateStats();

    logger.debug(`[CACHE] Set key: ${key} (size: ${estimatedSize}B, TTL: ${ttl}ms)`);
  }

  /**
   * Get a cache entry
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      this.updateStats();
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expires) {
      this.delete(key);
      this.stats.misses++;
      this.updateStats();
      return null;
    }

    // Update access tracking
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    
    if (this.config.enableLRU) {
      this.updateAccessOrder(key);
    }

    this.stats.hits++;
    this.updateStats();

    logger.debug(`[CACHE] Hit key: ${key} (access count: ${entry.accessCount})`);
    return entry.data;
  }

  /**
   * Delete a cache entry
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.removeFromAccessOrder(key);
      this.updateStats();
      logger.debug(`[CACHE] Deleted key: ${key}`);
    }
    return deleted;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expires) {
      this.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Get or compute value if not in cache
   */
  async getOrCompute<K>(
    key: string, 
    computeFn: () => Promise<T> | T,
    ttlMs?: number
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const computed = await computeFn();
    this.set(key, computed, ttlMs);
    return computed;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.accessOrder = [];
    this.updateStats();
    logger.info(`[CACHE] Cleared ${size} entries`);
  }

  /**
   * Get current cache statistics
   */
  getStats(): CacheStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const now = Date.now();
    const keysToDelete: string[] = [];
    
    for (const [key, entry] of this.cache) {
      if (now > entry.expires) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.delete(key));
    
    if (keysToDelete.length > 0) {
      logger.debug(`[CACHE] Cleaned up ${keysToDelete.length} expired entries`);
    }

    return keysToDelete.length;
  }

  /**
   * Get all keys (for debugging)
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Destroy cache and cleanup resources
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.clear();
    logger.debug("[CACHE] Cache destroyed");
  }

  // Private methods

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  private shouldEvict(newEntrySize: number): boolean {
    const currentMemoryMB = this.stats.memoryUsageMB;
    const newEntrySizeMB = newEntrySize / (1024 * 1024);
    
    return (
      this.cache.size >= this.config.maxSize ||
      (currentMemoryMB + newEntrySizeMB) > this.config.maxMemoryMB
    );
  }

  private performEviction(spaceNeeded: number): void {
    const spaceNeededMB = spaceNeeded / (1024 * 1024);
    let freedSpace = 0;
    let evicted = 0;

    // LRU eviction
    if (this.config.enableLRU) {
      while (
        (this.cache.size >= this.config.maxSize || 
         (this.stats.memoryUsageMB - freedSpace) + spaceNeededMB > this.config.maxMemoryMB) &&
        this.accessOrder.length > 0
      ) {
        const lruKey = this.accessOrder.shift()!;
        const entry = this.cache.get(lruKey);
        if (entry) {
          freedSpace += entry.size / (1024 * 1024);
          this.cache.delete(lruKey);
          evicted++;
        }
      }
    } else {
      // Simple eviction - remove oldest entries
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      for (const [key, entry] of entries) {
        if (
          this.cache.size >= this.config.maxSize ||
          (this.stats.memoryUsageMB - freedSpace) + spaceNeededMB > this.config.maxMemoryMB
        ) {
          freedSpace += entry.size / (1024 * 1024);
          this.cache.delete(key);
          this.removeFromAccessOrder(key);
          evicted++;
        } else {
          break;
        }
      }
    }

    this.stats.evictions += evicted;
    
    if (evicted > 0) {
      logger.debug(`[CACHE] Evicted ${evicted} entries (freed ${freedSpace.toFixed(2)}MB)`);
    }
  }

  private updateAccessOrder(key: string): void {
    // Remove from current position
    this.removeFromAccessOrder(key);
    // Add to end (most recently used)
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  private estimateSize(data: T): number {
    try {
      // Rough estimation - more accurate sizing could be implemented
      const jsonString = JSON.stringify(data);
      return jsonString.length * 2; // UTF-16 encoding
    } catch {
      return 100; // Default size for non-serializable objects
    }
  }

  private updateStats(): void {
    this.stats.size = this.cache.size;
    
    // Calculate memory usage
    let totalSize = 0;
    let oldestTime = Date.now();
    let newestTime = 0;
    
    for (const entry of this.cache.values()) {
      totalSize += entry.size;
      if (entry.timestamp < oldestTime) oldestTime = entry.timestamp;
      if (entry.timestamp > newestTime) newestTime = entry.timestamp;
    }
    
    this.stats.memoryUsageMB = totalSize / (1024 * 1024);
    this.stats.hitRate = this.stats.hits + this.stats.misses > 0 
      ? this.stats.hits / (this.stats.hits + this.stats.misses) 
      : 0;
    this.stats.oldestEntry = oldestTime;
    this.stats.newestEntry = newestTime;
  }
}

/**
 * Global Cache Manager - Singleton for managing multiple named caches
 */
export class CacheManager {
  private static instance: CacheManager;
  private caches = new Map<string, SmartCache<any>>();
  private globalStats: { [cacheName: string]: CacheStats } = {};

  private constructor() {}

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  /**
   * Get or create a named cache
   */
  getCache<T>(name: string, config?: Partial<CacheConfig>): SmartCache<T> {
    if (!this.caches.has(name)) {
      const cache = new SmartCache<T>(config);
      this.caches.set(name, cache);
      logger.info(`[CACHE_MANAGER] Created cache: ${name}`);
    }
    return this.caches.get(name)!;
  }

  /**
   * Get global statistics for all caches
   */
  getGlobalStats(): { [cacheName: string]: CacheStats } {
    this.globalStats = {};
    for (const [name, cache] of this.caches) {
      this.globalStats[name] = cache.getStats();
    }
    return this.globalStats;
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    logger.info("[CACHE_MANAGER] Cleared all caches");
  }

  /**
   * Cleanup all caches
   */
  cleanupAll(): number {
    let totalCleaned = 0;
    for (const cache of this.caches.values()) {
      totalCleaned += cache.cleanup();
    }
    return totalCleaned;
  }

  /**
   * Destroy all caches
   */
  destroyAll(): void {
    for (const cache of this.caches.values()) {
      cache.destroy();
    }
    this.caches.clear();
    logger.info("[CACHE_MANAGER] Destroyed all caches");
  }

  /**
   * Log cache statistics
   */
  logStats(): void {
    const stats = this.getGlobalStats();
    for (const [name, cacheStats] of Object.entries(stats)) {
      logger.info(`[CACHE_STATS] ${name}: ${JSON.stringify({
        size: cacheStats.size,
        hitRate: (cacheStats.hitRate * 100).toFixed(1) + '%',
        memoryMB: cacheStats.memoryUsageMB.toFixed(2),
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        evictions: cacheStats.evictions
      })}`);
    }
  }
}