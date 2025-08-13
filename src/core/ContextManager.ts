import * as vscode from "vscode";
import { logger } from "../utils/logger";
import {
  ContextItem,
  ContextQuery,
  ContextSearchResult,
  ContextStrategy,
  ContextType,
  ContextPriority,
  ContextSource,
  ContextConfig,
  ContextEvent,
  ContextEventHandler,
} from "../context/types";
import { ChromaContextDB } from "../context/storage/ChromaContextDB";
import { ChromaProjectContextManager } from "../context/ChromaProjectContextManager";
import { TaskContext } from "../context/TaskContext";
import { ProjectContext } from "../context/ProjectContext";
import { ChatContext } from "../context/ChatContext";
import { LongTermMemory } from "../context/LongTermMemory";
import { DocumentationContextStrategy } from "../context/DocumentationContext";

/**
 * Central hub for managing all context types and routing context queries
 * Provides unified interface for context storage, retrieval, and management
 */
export class ContextManager {
  private static instance: ContextManager;
  private strategies: Map<string, ContextStrategy> = new Map();
  private contextDB: ChromaContextDB;
  private projectContextManager?: ChromaProjectContextManager;
  private taskContext: TaskContext;
  private projectContext: ProjectContext;
  private chatContext: ChatContext;
  private longTermMemory: LongTermMemory;
  private documentationContext: DocumentationContextStrategy;
  private config: ContextConfig;
  private eventHandlers: Set<ContextEventHandler> = new Set();
  private cache: Map<string, ContextSearchResult> = new Map();
  private initialized = false;
  private extensionContext?: vscode.ExtensionContext;

  private constructor(extensionContext?: vscode.ExtensionContext) {
    this.extensionContext = extensionContext;
    this.config = this.loadConfig();
    
    // Initialize ChromaDB-based storage
    this.contextDB = new ChromaContextDB(this.config, extensionContext);
    
    // Initialize project context manager for ChromaDB migration
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      this.projectContextManager = ChromaProjectContextManager.getInstance({
        workspacePath: vscode.workspace.workspaceFolders[0].uri.fsPath,
        maxFileSize: 1024 * 1024, // 1MB
        excludePatterns: [
          // Version control
          '**/.git/**',
          '**/.svn/**',
          '**/.hg/**',
          
          // Node.js
          '**/node_modules/**',
          
          // Python virtual environments
          '**/venv/**',
          '**/env/**',
          '**/.venv/**',
          '**/__pycache__/**',
          '**/site-packages/**',
          
          // Build outputs
          '**/build/**',
          '**/dist/**',
          '**/out/**',
          '**/target/**',
          
          // Rust specific
          '**/target/**',
          '**/Cargo.lock',
          '**/*.pdb',
          '**/*.exe',
          '**/*.dll',
          
          // Framework specific
          '**/.next/**',
          '.next/**',
          '**/.nuxt/**',
          
          // Package managers
          '**/vendor/**',
          '**/Pods/**',
          
          // Caches
          '**/.cache/**',
          '**/coverage/**',
          '**/logs/**',
          '**/.tmp/**',
          '**/temp/**',
          
          // IDE and system files  
          '**/.gradle/**',
          '**/gradle/**',
          '**/cmake-build-*/**',
          '**/DerivedData/**',
          '**/.dart_tool/**',
          '**/packages/**',
          '**/.pub-cache/**',
          '**/bin/**',
          '**/obj/**',
          
          // Log files
          '**/*.log',
          
          // Hidden files (but allow important config files)
          '**/.*',
          '!**/.env.example',
          '!**/.gitignore',
          '!**/.eslintrc*',
          '!**/.prettierrc*'
        ],
        includePatterns: [
          '**/*.ts',
          '**/*.js',
          '**/*.tsx',
          '**/*.jsx',
          '**/*.py',
          '**/*.java',
          '**/*.md',
          '**/README*',
          '**/package.json',
          '**/tsconfig.json',
        ],
        maxConcurrency: 3,
        chromaUrl: (this.config as any).chromaUrl,
        chunkSize: (this.config as any).chunkSize || 1000,
        enableSemanticSearch: this.config.enableSemanticSearch || true,
      }, extensionContext);
    }
    
    this.taskContext = new TaskContext(this.contextDB);
    this.projectContext = new ProjectContext(this.contextDB);
    this.chatContext = new ChatContext(this.contextDB);
    this.longTermMemory = new LongTermMemory(this.contextDB);
    this.documentationContext = new DocumentationContextStrategy();

    logger.info("[CONTEXT] ContextManager initialized");
  }

  /**
   * Get singleton instance
   */
  public static getInstance(
    extensionContext?: vscode.ExtensionContext
  ): ContextManager {
    if (!ContextManager.instance) {
      ContextManager.instance = new ContextManager(extensionContext);
    }
    return ContextManager.instance;
  }

  /**
   * Initialize the context system
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug("[CONTEXT] ContextManager already initialized");
      return;
    }

    try {
      logger.info("[CONTEXT] Initializing context system...");

      // Initialize ChromaDB storage layer
      await this.contextDB.initialize();
      
      // Initialize project context manager if available
      if (this.projectContextManager) {
        await this.projectContextManager.initialize();
      }

      // Initialize context layers
      await this.taskContext.initialize();
      await this.projectContext.initialize();
      await this.chatContext.initialize();
      await this.longTermMemory.initialize();
      await this.documentationContext.initialize();

      // Register default strategies
      await this.registerDefaultStrategies();

      // Setup cleanup intervals
      this.setupCleanupTasks();

      this.initialized = true;
      logger.info("[CONTEXT] Context system initialized successfully");

      this.emitEvent({
        type: "add",
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error("[CONTEXT] Failed to initialize context system:", error);
      throw new Error(
        `Context system initialization failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Add context item to appropriate layer
   */
  public async addContext(item: ContextItem): Promise<void> {
    try {
      logger.debug(
        `[CONTEXT] Adding context item: ${item.type}/${item.source}`
      );

      // Validate context item
      this.validateContextItem(item);

      // Route to appropriate context layer
      switch (item.type) {
        case ContextType.TASK:
          await this.taskContext.addContext(item);
          break;
        case ContextType.PROJECT:
          await this.projectContext.addContext(item);
          break;
        case ContextType.CHAT:
          await this.chatContext.addContext(item);
          break;
        case ContextType.LONG_TERM:
          await this.longTermMemory.addContext(item);
          break;
        case ContextType.SESSION:
          // Session context is handled by ChatSession
          await this.contextDB.store(item);
          break;
        default:
          logger.warn(`[CONTEXT] Unknown context type: ${item.type}`);
          await this.contextDB.store(item);
      }

      // Clear related cache entries
      this.invalidateCache(item);

      this.emitEvent({
        type: "add",
        contextId: item.id,
        timestamp: new Date(),
      });

      logger.debug(`[CONTEXT] Context item added successfully: ${item.id}`);
    } catch (error) {
      logger.error(`[CONTEXT] Failed to add context item:`, error);
      this.emitEvent({
        type: "add",
        contextId: item.id,
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: new Date(),
      });
      throw error;
    }
  }

  /**
   * Search for relevant context
   */
  public async searchContext(
    query: ContextQuery
  ): Promise<ContextSearchResult> {
    const startTime = Date.now();

    try {
      logger.debug(
        `[CONTEXT] Searching context: "${query.query || "undefined"}"`
      );

      // Check cache first
      const cacheKey = this.generateCacheKey(query);
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey)!;
        logger.debug(
          `[CONTEXT] Cache hit for query: ${query.query || "undefined"}`
        );
        return cached;
      }

      // Find best strategy for this query
      const strategy = this.selectStrategy(query);
      logger.debug(`[CONTEXT] Using strategy: ${strategy.name}`);

      // Execute search
      const result = await strategy.search(query);
      result.searchTime = Date.now() - startTime;
      result.strategy = strategy.name;

      // Cache result
      this.cache.set(cacheKey, result);

      // Trim cache if needed
      if (this.cache.size > this.config.cacheSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey as string);
      }

      logger.debug(
        `[CONTEXT] Search completed: ${result.items.length} items in ${result.searchTime}ms`
      );

      this.emitEvent({
        type: "search",
        query,
        result,
        timestamp: new Date(),
        duration: result.searchTime,
      });

      return result;
    } catch (error) {
      const searchTime = Date.now() - startTime;
      logger.error(`[CONTEXT] Search failed after ${searchTime}ms:`, error);

      this.emitEvent({
        type: "search",
        query,
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: new Date(),
        duration: searchTime,
      });

      // Return empty result on error
      return {
        items: [],
        totalCount: 0,
        searchTime,
        strategy: "error",
      };
    }
  }

  /**
   * Update existing context item
   */
  public async updateContext(item: ContextItem): Promise<void> {
    try {
      logger.debug(`[CONTEXT] Updating context item: ${item.id}`);

      await this.contextDB.update(item);
      this.invalidateCache(item);

      this.emitEvent({
        type: "update",
        contextId: item.id,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error(`[CONTEXT] Failed to update context item:`, error);
      throw error;
    }
  }

  /**
   * Remove context item
   */
  public async removeContext(contextId: string): Promise<void> {
    try {
      logger.debug(`[CONTEXT] Removing context item: ${contextId}`);

      await this.contextDB.remove(contextId);
      this.cache.clear(); // Simple cache invalidation

      this.emitEvent({
        type: "remove",
        contextId,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error(`[CONTEXT] Failed to remove context item:`, error);
      throw error;
    }
  }

  /**
   * Register a context strategy
   */
  public registerStrategy(strategy: ContextStrategy): void {
    logger.debug(`[CONTEXT] Registering strategy: ${strategy.name}`);
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * Get context layers for direct access
   */
  public getTaskContext(): TaskContext {
    return this.taskContext;
  }

  public getProjectContext(): ProjectContext {
    return this.projectContext;
  }

  public getChatContext(): ChatContext {
    return this.chatContext;
  }

  public getLongTermMemory(): LongTermMemory {
    return this.longTermMemory;
  }

  /**
   * Add event handler
   */
  public addEventListener(handler: ContextEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Remove event handler
   */
  public removeEventListener(handler: ContextEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Consolidate memories and patterns
   */
  public async consolidateMemories(): Promise<void> {
    try {
      logger.info("[CONTEXT] Starting memory consolidation...");

      await this.longTermMemory.consolidatePatterns();

      this.emitEvent({
        type: "consolidate",
        timestamp: new Date(),
      });

      logger.info("[CONTEXT] Memory consolidation completed");
    } catch (error) {
      logger.error("[CONTEXT] Memory consolidation failed:", error);
      throw error;
    }
  }

  /**
   * Get system statistics
   */
  public async getStats(): Promise<any> {
    try {
      const dbStats = await this.contextDB.getStats();
      const taskStats = await this.taskContext.getStats();
      const projectStats = await this.projectContext.getStats();
      const chatStats = await this.chatContext.getStats();
      const memoryStats = await this.longTermMemory.getStats();

      return {
        database: dbStats,
        task: taskStats,
        project: projectStats,
        chat: chatStats,
        memory: memoryStats,
        strategies: Array.from(this.strategies.keys()),
        cacheSize: this.cache.size,
        initialized: this.initialized,
      };
    } catch (error) {
      logger.error("[CONTEXT] Failed to get stats:", error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private loadConfig(): ContextConfig {
    const config = vscode.workspace.getConfiguration("ollamaAgent.context");

    return {
      maxContextWindow: config.get<number>("maxContextWindow") || 8000,
      defaultStrategy: config.get<string>("defaultStrategy") || "adaptive",
      enableSemanticSearch: config.get<boolean>("enableSemanticSearch") || true,
      vectorDimensions: config.get<number>("vectorDimensions") || 384,
      cacheSize: config.get<number>("cacheSize") || 100,
      cleanupInterval: config.get<number>("cleanupInterval") || 3600000, // 1 hour
      retentionPeriod: config.get<number>("retentionPeriod") || 2592000000, // 30 days
    };
  }

  private async registerDefaultStrategies(): Promise<void> {
    // Import and register strategies
    try {
      const { RelevanceStrategy } = await import(
        "../context/strategies/RelevanceStrategy"
      );
      const { RecencyStrategy } = await import(
        "../context/strategies/RecencyStrategy"
      );
      const { ProjectStrategy } = await import(
        "../context/strategies/ProjectStrategy"
      );
      const { TaskStrategy } = await import(
        "../context/strategies/TaskStrategy"
      );

      this.registerStrategy(new RelevanceStrategy(this.contextDB));
      this.registerStrategy(new RecencyStrategy(this.contextDB));
      this.registerStrategy(new ProjectStrategy(this.contextDB));
      this.registerStrategy(new TaskStrategy(this.contextDB));
      this.registerStrategy(this.documentationContext);

      logger.debug("[CONTEXT] Default strategies registered");
    } catch (error) {
      logger.error("[CONTEXT] Failed to register default strategies:", error);
    }
  }

  private selectStrategy(query: ContextQuery): ContextStrategy {
    // Find strategies that can handle this query
    const candidateStrategies = Array.from(this.strategies.values())
      .filter((strategy) => strategy.canHandle(query))
      .sort((a, b) => b.priority - a.priority);

    if (candidateStrategies.length === 0) {
      // Fallback to first available strategy
      const fallback = this.strategies.values().next().value;
      if (!fallback) {
        throw new Error("No context strategies available");
      }
      return fallback;
    }

    return candidateStrategies[0];
  }

  private validateContextItem(item: ContextItem): void {
    if (!item.id || !item.content || !item.type) {
      throw new Error("Invalid context item: missing required fields");
    }

    if (item.content.length > this.config.maxContextWindow) {
      logger.warn(`[CONTEXT] Context item exceeds max window size: ${item.id}`);
      item.content = item.content.substring(0, this.config.maxContextWindow);
    }
  }

  private generateCacheKey(query: ContextQuery): string {
    return Buffer.from(JSON.stringify(query)).toString("base64");
  }

  private invalidateCache(item: ContextItem): void {
    // Simple cache invalidation - clear all for now
    // Could be optimized to only clear related entries
    this.cache.clear();
  }

  private setupCleanupTasks(): void {
    setInterval(async () => {
      try {
        await this.contextDB.cleanup();
        this.cache.clear();
        logger.debug("[CONTEXT] Cleanup task completed");
      } catch (error) {
        logger.error("[CONTEXT] Cleanup task failed:", error);
      }
    }, this.config.cleanupInterval);
  }

  /**
   * Get the context database for health checks and diagnostics
   */
  public getContextDB(): ChromaContextDB {
    return this.contextDB;
  }
  
  /**
   * Get the project context manager for project-specific operations
   */
  public getProjectContextManager(): ChromaProjectContextManager | undefined {
    return this.projectContextManager;
  }
  
  /**
   * Index current project with progress reporting
   */
  public async indexProject(
    progressCallback?: (progress: any) => void
  ): Promise<void> {
    if (!this.projectContextManager) {
      throw new Error('No workspace folder available for project indexing');
    }
    
    await this.projectContextManager.indexProject(progressCallback);
  }
  
  /**
   * Search project context using semantic search
   */
  public async searchProjectContext(query: string, maxResults?: number): Promise<ContextSearchResult> {
    if (!this.projectContextManager) {
      // Fallback to regular context search
      return this.searchContext({ query, maxResults });
    }
    
    return this.projectContextManager.searchContext({ query, maxResults });
  }
  
  /**
   * Get project statistics and health
   */
  public async getProjectStats(): Promise<any> {
    if (!this.projectContextManager) {
      return { error: 'No project context manager available' };
    }
    
    return this.projectContextManager.getProjectStats();
  }

  private emitEvent(event: ContextEvent): void {
    this.eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        logger.error("[CONTEXT] Event handler error:", error);
      }
    });
  }
}
