/**
 * ChromaDB-based Project Context Manager
 * 
 * Modern replacement for the SQLite-based context system, using ChromaDB
 * for semantic search and better integration with foundation agents.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../utils/logger';
import { ChromaContextDB } from './storage/ChromaContextDB';
import { ContextIndexer } from './indexing/ContextIndexer';
import {
  ContextItem,
  ContextQuery,
  ContextType,
  ContextSource,
  ContextPriority,
  ProjectMetadata,
  ContextSearchResult,
} from './types';

export interface ChromaProjectContextConfig {
  workspacePath: string;
  maxFileSize: number; // bytes
  excludePatterns: string[];
  includePatterns: string[];
  maxConcurrency: number;
  chromaUrl?: string;
  chunkSize?: number;
  enableSemanticSearch: boolean;
}

export interface ProjectContextStats {
  totalContextItems: number;
  itemsByType: Record<string, number>;
  itemsBySource: Record<string, number>;
  collections: Record<string, number>;
  lastIndexed?: Date;
  projectMetadata?: ProjectMetadata;
}

export interface IndexingProgress {
  stage: 'discovering' | 'analyzing' | 'indexing' | 'completed' | 'error';
  progress: number; // 0-100
  message: string;
  filesProcessed: number;
  totalFiles: number;
  currentFile?: string;
  errors: string[];
}

/**
 * Modern project context manager using ChromaDB for semantic search
 */
export class ChromaProjectContextManager {
  private static instance: ChromaProjectContextManager;
  private config: ChromaProjectContextConfig;
  private contextDB: ChromaContextDB;
  private indexer: ContextIndexer;
  private initialized = false;
  
  private currentProjectId?: string;
  private indexingProgress?: IndexingProgress;
  private extensionContext?: vscode.ExtensionContext;

  private constructor(config: ChromaProjectContextConfig, extensionContext?: vscode.ExtensionContext) {
    this.config = config;
    this.extensionContext = extensionContext;

    // Initialize ChromaDB storage
    this.contextDB = new ChromaContextDB({
      chromaUrl: config.chromaUrl,
      chunkSize: config.chunkSize || 1000,
      enableSemanticSearch: config.enableSemanticSearch,
      // Required ContextConfig properties
      maxContextWindow: 8000,
      defaultStrategy: 'relevance',
      vectorDimensions: 384,
      cacheSize: 100,
      cleanupInterval: 3600000, // 1 hour
      retentionPeriod: 2592000000, // 30 days
      chunkOverlap: 100,
    }, extensionContext);

    // Initialize context indexer
    this.indexer = new ContextIndexer(
      this.contextDB,
      config.workspacePath,
      {
        includePatterns: config.includePatterns,
        excludePatterns: config.excludePatterns,
        maxFileSize: config.maxFileSize,
        chunkSize: config.chunkSize || 1000,
        enableCodeAnalysis: true,
        enableDocumentationExtraction: true,
        respectGitignore: true,
      }
    );
  }

  /**
   * Get singleton instance
   */
  public static getInstance(
    config?: ChromaProjectContextConfig, 
    extensionContext?: vscode.ExtensionContext
  ): ChromaProjectContextManager {
    if (!ChromaProjectContextManager.instance && config) {
      ChromaProjectContextManager.instance = new ChromaProjectContextManager(config, extensionContext);
    }
    return ChromaProjectContextManager.instance;
  }

  /**
   * Initialize the context manager
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      logger.info('[CHROMA_PROJECT_CONTEXT] Initializing ChromaDB project context manager...');
      
      await this.contextDB.initialize();
      
      // Generate project ID from workspace path
      this.currentProjectId = this.generateProjectId(this.config.workspacePath);
      
      this.initialized = true;
      logger.info('[CHROMA_PROJECT_CONTEXT] ChromaDB project context manager initialized');
    } catch (error) {
      logger.error('[CHROMA_PROJECT_CONTEXT] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Index the current project with progress reporting
   */
  public async indexProject(
    progressCallback?: (progress: IndexingProgress) => void
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.currentProjectId) {
      throw new Error('No current project ID');
    }

    try {
      logger.info(`[CHROMA_PROJECT_CONTEXT] Starting project indexing: ${this.currentProjectId}`);

      // Initialize progress tracking
      this.indexingProgress = {
        stage: 'discovering',
        progress: 0,
        message: 'Starting project analysis...',
        filesProcessed: 0,
        totalFiles: 0,
        errors: [],
      };

      progressCallback?.(this.indexingProgress);

      // Run the indexing with progress updates
      const results = await this.indexer.indexProject(
        this.currentProjectId,
        (indexProgress) => {
          this.indexingProgress = {
            stage: 'indexing',
            progress: indexProgress.percentage,
            message: indexProgress.message,
            filesProcessed: Math.round((indexProgress.percentage / 100) * this.indexingProgress!.totalFiles),
            totalFiles: this.indexingProgress!.totalFiles,
            errors: this.indexingProgress!.errors,
          };
          progressCallback?.(this.indexingProgress);
        }
      );

      // Update final progress
      this.indexingProgress = {
        stage: 'completed',
        progress: 100,
        message: `Indexing completed: ${results.indexedFiles}/${results.totalFiles} files processed`,
        filesProcessed: results.indexedFiles,
        totalFiles: results.totalFiles,
        errors: results.errors,
      };

      progressCallback?.(this.indexingProgress);

      logger.info(
        `[CHROMA_PROJECT_CONTEXT] Project indexing completed: ` +
        `${results.indexedFiles}/${results.totalFiles} files indexed`
      );

    } catch (error) {
      logger.error('[CHROMA_PROJECT_CONTEXT] Project indexing failed:', error);
      
      if (this.indexingProgress) {
        this.indexingProgress.stage = 'error';
        this.indexingProgress.message = `Indexing failed: ${error instanceof Error ? error.message : String(error)}`;
        this.indexingProgress.errors.push(this.indexingProgress.message);
        progressCallback?.(this.indexingProgress);
      }

      throw error;
    }
  }

  /**
   * Search project context using semantic search
   */
  public async searchContext(query: ContextQuery): Promise<ContextSearchResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`[CHROMA_PROJECT_CONTEXT] Searching context: "${query.query || 'metadata query'}"`);

      const items = await this.contextDB.search({
        ...query,
        projectId: this.currentProjectId,
      });

      const result: ContextSearchResult = {
        items: items.map(item => ({
          id: item.id,
          type: item.type,
          source: item.source,
          content: item.content,
          metadata: item.metadata,
          relevanceScore: item.relevanceScore,
          priority: item.priority,
          timestamp: item.timestamp,
          tags: item.tags,
          expiresAt: item.expiresAt,
          projectId: item.projectId,
          sessionId: item.sessionId,
          taskId: item.taskId,
          chatId: item.chatId,
        })),
        totalCount: items.length,
        query: query.query || '',
        searchTime: Date.now(), // Simple timestamp
      };

      logger.debug(`[CHROMA_PROJECT_CONTEXT] Found ${result.totalCount} context items`);
      return result;

    } catch (error) {
      logger.error('[CHROMA_PROJECT_CONTEXT] Context search failed:', error);
      
      return {
        items: [],
        totalCount: 0,
        query: query.query || '',
        searchTime: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get context item by ID
   */
  public async getContextById(id: string, type?: ContextType): Promise<ContextItem | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.contextDB.getById(id, type);
    } catch (error) {
      logger.error(`[CHROMA_PROJECT_CONTEXT] Failed to get context by ID ${id}:`, error);
      return null;
    }
  }

  /**
   * Store new context item
   */
  public async storeContext(item: ContextItem): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Ensure project ID is set
      if (!item.projectId && this.currentProjectId) {
        item.projectId = this.currentProjectId;
      }

      await this.contextDB.store(item);
      logger.debug(`[CHROMA_PROJECT_CONTEXT] Stored context item: ${item.id}`);
    } catch (error) {
      logger.error(`[CHROMA_PROJECT_CONTEXT] Failed to store context item ${item.id}:`, error);
      throw error;
    }
  }

  /**
   * Update existing context item
   */
  public async updateContext(item: ContextItem): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      await this.contextDB.update(item);
      logger.debug(`[CHROMA_PROJECT_CONTEXT] Updated context item: ${item.id}`);
    } catch (error) {
      logger.error(`[CHROMA_PROJECT_CONTEXT] Failed to update context item ${item.id}:`, error);
      throw error;
    }
  }

  /**
   * Remove context item
   */
  public async removeContext(id: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      await this.contextDB.remove(id);
      logger.debug(`[CHROMA_PROJECT_CONTEXT] Removed context item: ${id}`);
    } catch (error) {
      logger.error(`[CHROMA_PROJECT_CONTEXT] Failed to remove context item ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get project statistics
   */
  public async getProjectStats(): Promise<ProjectContextStats> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const stats = await this.contextDB.getStats();
      
      // Try to get project metadata
      let projectMetadata: ProjectMetadata | undefined;
      if (this.currentProjectId) {
        const metadataItem = await this.contextDB.getById(`project_metadata_${this.currentProjectId}`);
        if (metadataItem) {
          try {
            projectMetadata = JSON.parse(metadataItem.content);
          } catch (error) {
            logger.warn('[CHROMA_PROJECT_CONTEXT] Failed to parse project metadata:', error);
          }
        }
      }

      return {
        totalContextItems: stats.totalItems,
        itemsByType: stats.itemsByType,
        itemsBySource: stats.itemsBySource,
        collections: stats.collections,
        lastIndexed: projectMetadata?.lastAnalyzed,
        projectMetadata,
      };

    } catch (error) {
      logger.error('[CHROMA_PROJECT_CONTEXT] Failed to get project stats:', error);
      
      return {
        totalContextItems: 0,
        itemsByType: {},
        itemsBySource: {},
        collections: {},
      };
    }
  }

  /**
   * Get current indexing progress
   */
  public getIndexingProgress(): IndexingProgress | null {
    return this.indexingProgress || null;
  }

  /**
   * Check if project has been indexed
   */
  public async isProjectIndexed(): Promise<boolean> {
    try {
      const stats = await this.getProjectStats();
      return stats.totalContextItems > 0;
    } catch (error) {
      logger.error('[CHROMA_PROJECT_CONTEXT] Failed to check indexing status:', error);
      return false;
    }
  }

  /**
   * Clear all project context
   */
  public async clearProjectContext(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.currentProjectId) return;

    try {
      logger.info('[CHROMA_PROJECT_CONTEXT] Clearing project context...');
      
      // Search for all items in this project and remove them
      const allItems = await this.contextDB.search({
        projectId: this.currentProjectId,
        maxResults: 10000, // Large number to get all items
      });

      for (const item of allItems) {
        await this.contextDB.remove(item.id);
      }

      this.indexingProgress = undefined;
      
      logger.info(`[CHROMA_PROJECT_CONTEXT] Cleared ${allItems.length} context items`);
    } catch (error) {
      logger.error('[CHROMA_PROJECT_CONTEXT] Failed to clear project context:', error);
      throw error;
    }
  }

  /**
   * Health check for the context system
   */
  public async healthCheck(): Promise<{
    isHealthy: boolean;
    contextDB: boolean;
    itemCount: number;
    error?: string;
  }> {
    try {
      if (!this.initialized) {
        return {
          isHealthy: false,
          contextDB: false,
          itemCount: 0,
          error: 'Not initialized',
        };
      }

      const dbHealth = await this.contextDB.healthCheck();
      
      return {
        isHealthy: dbHealth.isHealthy,
        contextDB: dbHealth.isHealthy,
        itemCount: dbHealth.itemCount,
        error: dbHealth.error,
      };

    } catch (error) {
      return {
        isHealthy: false,
        contextDB: false,
        itemCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Close connections and cleanup
   */
  public async close(): Promise<void> {
    try {
      await this.contextDB.close();
      this.initialized = false;
      logger.info('[CHROMA_PROJECT_CONTEXT] Closed ChromaDB project context manager');
    } catch (error) {
      logger.error('[CHROMA_PROJECT_CONTEXT] Failed to close:', error);
    }
  }

  /**
   * Generate project ID from workspace path
   */
  private generateProjectId(workspacePath: string): string {
    const projectName = path.basename(workspacePath);
    const pathHash = this.simpleHash(workspacePath);
    return `${projectName}_${pathHash}`;
  }

  /**
   * Simple hash function for generating IDs
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Static method to create instance for a workspace
   */
  public static async createForWorkspace(
    workspaceFolder: vscode.WorkspaceFolder,
    extensionContext?: vscode.ExtensionContext,
    options: {
      maxFileSize?: number;
      enableSemanticSearch?: boolean;
      chromaUrl?: string;
    } = {}
  ): Promise<ChromaProjectContextManager> {
    const config: ChromaProjectContextConfig = {
      workspacePath: workspaceFolder.uri.fsPath,
      maxFileSize: options.maxFileSize || 1024 * 1024, // 1MB
      excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/target/**',
        '**/.git/**',
        '**/coverage/**',
        '**/*.log',
        '**/tmp/**',
        '**/temp/**',
      ],
      includePatterns: [
        '**/*.ts',
        '**/*.js',
        '**/*.tsx',
        '**/*.jsx',
        '**/*.py',
        '**/*.java',
        '**/*.c',
        '**/*.cpp',
        '**/*.cs',
        '**/*.go',
        '**/*.rs',
        '**/*.php',
        '**/*.rb',
        '**/*.swift',
        '**/*.kt',
        '**/*.md',
        '**/README*',
        '**/package.json',
        '**/tsconfig.json',
        '**/Cargo.toml',
        '**/requirements.txt',
      ],
      maxConcurrency: 3,
      chromaUrl: options.chromaUrl,
      chunkSize: 1000,
      enableSemanticSearch: options.enableSemanticSearch !== false,
    };

    const manager = new ChromaProjectContextManager(config, extensionContext);
    await manager.initialize();
    return manager;
  }
}