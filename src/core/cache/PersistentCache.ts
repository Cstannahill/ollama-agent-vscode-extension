/**
 * Persistent Cache System
 * 
 * Provides cache persistence across VS Code contexts/sessions to avoid
 * expensive reinitializations (tool descriptions, agents, embeddings).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from "../../utils/logger";

export interface PersistentCacheEntry {
  data: any;
  timestamp: number;
  expires: number;
  version: string;
  size: number;
}

export interface PersistentCacheManifest {
  version: string;
  created: number;
  lastAccessed: number;
  entries: { [key: string]: string }; // key -> filename mapping
}

export class PersistentCache {
  private static instance: PersistentCache;
  private cacheDir: string;
  private manifestPath: string;
  private manifest!: PersistentCacheManifest; // Definite assignment assertion - initialized in constructor
  private readonly VERSION = "1.0.0";
  
  private constructor() {
    // Create cache directory in OS temp folder for persistence
    this.cacheDir = path.join(os.tmpdir(), 'ollama-agent-vscode-cache');
    this.manifestPath = path.join(this.cacheDir, 'manifest.json');
    
    this.ensureCacheDirectory();
    this.loadManifest();
  }
  
  static getInstance(): PersistentCache {
    if (!PersistentCache.instance) {
      PersistentCache.instance = new PersistentCache();
    }
    return PersistentCache.instance;
  }

  /**
   * Get cached data if valid and not expired
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const filename = this.manifest.entries[key];
      if (!filename) {
        return null;
      }

      const filePath = path.join(this.cacheDir, filename);
      if (!fs.existsSync(filePath)) {
        // Clean up stale manifest entry
        delete this.manifest.entries[key];
        this.saveManifest();
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const entry: PersistentCacheEntry = JSON.parse(content);

      // Check expiration
      if (Date.now() > entry.expires) {
        this.delete(key);
        return null;
      }

      // Version compatibility check
      if (entry.version !== this.VERSION) {
        this.delete(key);
        return null;
      }

      this.manifest.lastAccessed = Date.now();
      this.saveManifest();
      
      logger.debug(`[PERSISTENT_CACHE] Cache hit: ${key} (${Math.round(entry.size / 1024)}KB)`);
      return entry.data as T;
      
    } catch (error) {
      logger.warn(`[PERSISTENT_CACHE] Failed to read cache entry ${key}:`, error);
      return null;
    }
  }

  /**
   * Store data in persistent cache
   */
  async set<T>(key: string, data: T, ttlMs: number = 3600000): Promise<void> {
    try {
      const entry: PersistentCacheEntry = {
        data,
        timestamp: Date.now(),
        expires: Date.now() + ttlMs,
        version: this.VERSION,
        size: this.estimateSize(data)
      };

      const filename = `${key.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
      const filePath = path.join(this.cacheDir, filename);

      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf8');
      
      // Update manifest
      const oldFilename = this.manifest.entries[key];
      if (oldFilename) {
        // Delete old file
        const oldPath = path.join(this.cacheDir, oldFilename);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      
      this.manifest.entries[key] = filename;
      this.manifest.lastAccessed = Date.now();
      this.saveManifest();
      
      logger.debug(`[PERSISTENT_CACHE] Cached: ${key} (${Math.round(entry.size / 1024)}KB, TTL: ${Math.round(ttlMs / 1000)}s)`);
      
    } catch (error) {
      logger.error(`[PERSISTENT_CACHE] Failed to cache entry ${key}:`, error);
    }
  }

  /**
   * Delete cached entry
   */
  delete(key: string): void {
    try {
      const filename = this.manifest.entries[key];
      if (filename) {
        const filePath = path.join(this.cacheDir, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        delete this.manifest.entries[key];
        this.saveManifest();
        logger.debug(`[PERSISTENT_CACHE] Deleted cache entry: ${key}`);
      }
    } catch (error) {
      logger.warn(`[PERSISTENT_CACHE] Failed to delete cache entry ${key}:`, error);
    }
  }

  /**
   * Get or compute with persistent caching
   */
  async getOrCompute<T>(
    key: string, 
    computeFn: () => Promise<T> | T, 
    ttlMs: number = 3600000
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    logger.info(`[PERSISTENT_CACHE] Computing and caching: ${key}`);
    const computed = await computeFn();
    await this.set(key, computed, ttlMs);
    return computed;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    let cleaned = 0;
    const now = Date.now();
    
    try {
      for (const [key, filename] of Object.entries(this.manifest.entries)) {
        const filePath = path.join(this.cacheDir, filename);
        
        if (!fs.existsSync(filePath)) {
          delete this.manifest.entries[key];
          cleaned++;
          continue;
        }

        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const entry: PersistentCacheEntry = JSON.parse(content);
          
          if (now > entry.expires) {
            fs.unlinkSync(filePath);
            delete this.manifest.entries[key];
            cleaned++;
          }
        } catch (error) {
          // Corrupted file, remove it
          fs.unlinkSync(filePath);
          delete this.manifest.entries[key];
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.saveManifest();
        logger.info(`[PERSISTENT_CACHE] Cleaned up ${cleaned} expired entries`);
      }
      
    } catch (error) {
      logger.warn("[PERSISTENT_CACHE] Cleanup failed:", error);
    }
    
    return cleaned;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    totalEntries: number;
    totalSizeMB: number;
    oldestEntry: number;
    newestEntry: number;
    cacheDir: string;
  } {
    let totalSize = 0;
    let oldestEntry = Date.now();
    let newestEntry = 0;
    
    for (const filename of Object.values(this.manifest.entries)) {
      const filePath = path.join(this.cacheDir, filename);
      if (fs.existsSync(filePath)) {
        try {
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
          oldestEntry = Math.min(oldestEntry, stats.mtime.getTime());
          newestEntry = Math.max(newestEntry, stats.mtime.getTime());
        } catch (error) {
          // Ignore stats errors
        }
      }
    }

    return {
      totalEntries: Object.keys(this.manifest.entries).length,
      totalSizeMB: Math.round((totalSize / 1024 / 1024) * 100) / 100,
      oldestEntry: oldestEntry === Date.now() ? 0 : oldestEntry,
      newestEntry,
      cacheDir: this.cacheDir
    };
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    try {
      for (const filename of Object.values(this.manifest.entries)) {
        const filePath = path.join(this.cacheDir, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      
      this.manifest.entries = {};
      this.saveManifest();
      
      logger.info("[PERSISTENT_CACHE] Cleared all cache entries");
    } catch (error) {
      logger.error("[PERSISTENT_CACHE] Failed to clear cache:", error);
    }
  }

  private ensureCacheDirectory(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
        logger.info(`[PERSISTENT_CACHE] Created cache directory: ${this.cacheDir}`);
      }
    } catch (error) {
      logger.error("[PERSISTENT_CACHE] Failed to create cache directory:", error);
      throw error;
    }
  }

  private loadManifest(): void {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const content = fs.readFileSync(this.manifestPath, 'utf8');
        this.manifest = JSON.parse(content);
        
        // Version compatibility check
        if (this.manifest.version !== this.VERSION) {
          logger.info(`[PERSISTENT_CACHE] Version mismatch, clearing cache (${this.manifest.version} -> ${this.VERSION})`);
          this.clear();
          this.createNewManifest();
        }
      } else {
        this.createNewManifest();
      }
    } catch (error) {
      logger.warn("[PERSISTENT_CACHE] Failed to load manifest, creating new:", error);
      this.createNewManifest();
    }
  }

  private createNewManifest(): void {
    this.manifest = {
      version: this.VERSION,
      created: Date.now(),
      lastAccessed: Date.now(),
      entries: {}
    };
    this.saveManifest();
  }

  private saveManifest(): void {
    try {
      fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2), 'utf8');
    } catch (error) {
      logger.error("[PERSISTENT_CACHE] Failed to save manifest:", error);
    }
  }

  private estimateSize(data: any): number {
    try {
      return JSON.stringify(data).length * 2; // Rough estimate in bytes
    } catch {
      return 1024; // Default 1KB if can't estimate
    }
  }
}