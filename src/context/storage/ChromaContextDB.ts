/**
 * ChromaDB-based Context Storage System
 * 
 * Complete replacement of SQLite with ChromaDB for project context storage.
 * Provides semantic search, vector embeddings, and efficient context retrieval.
 */

import { ChromaClient, Collection } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import * as vscode from "vscode";
import { logger } from "../../utils/logger";
import {
  ContextItem,
  ContextQuery,
  ContextType,
  ContextSource,
  ContextConfig,
  ProjectMetadata,
  TaskMetadata,
  ChatMetadata,
  LearningPattern,
  ContextPriority,
} from "../types";

// ChromaDB collection naming conventions
const COLLECTION_PREFIX = "project_";
const COLLECTIONS = {
  context: COLLECTION_PREFIX + "context",           // General project context
  code: COLLECTION_PREFIX + "code",                // Code files and snippets  
  documentation: COLLECTION_PREFIX + "docs",        // Documentation files
  dependencies: COLLECTION_PREFIX + "dependencies", // Package/dependency info
  structure: COLLECTION_PREFIX + "structure",       // Project structure info
  metadata: COLLECTION_PREFIX + "metadata",         // Project metadata
  tasks: COLLECTION_PREFIX + "tasks",              // Task-related context
  chats: COLLECTION_PREFIX + "chats",              // Chat/conversation context
  patterns: COLLECTION_PREFIX + "patterns",        // Learning patterns
} as const;

type CollectionKey = keyof typeof COLLECTIONS;

interface ChromaDocument {
  id: string;
  content: string;
  metadata: Record<string, any>;
  embedding?: number[];
}

interface ChromaContextDBConfig extends ContextConfig {
  chromaUrl?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  enableSemanticSearch: boolean; // Remove optional to match parent interface
}

/**
 * ChromaDB-based context storage with semantic search capabilities
 */
export class ChromaContextDB {
  private chromaClient: ChromaClient | null = null;
  private collections: Record<CollectionKey, Collection | null> = {
    context: null,
    code: null,
    documentation: null,
    dependencies: null,
    structure: null,
    metadata: null,
    tasks: null,
    chats: null,
    patterns: null,
  };
  private config: ChromaContextDBConfig;
  private initialized = false;
  private extensionContext?: vscode.ExtensionContext;

  constructor(
    config: ChromaContextDBConfig,
    extensionContext?: vscode.ExtensionContext
  ) {
    this.config = {
      chunkSize: 1000,
      chunkOverlap: 100,
      ...config
    };
    this.extensionContext = extensionContext;
  }

  /**
   * Initialize ChromaDB client and collections
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug("[CHROMA_CONTEXT_DB] Already initialized");
      return;
    }

    try {
      logger.info("[CHROMA_CONTEXT_DB] Initializing ChromaDB context storage...");

      // Initialize ChromaDB client with error handling
      const chromaUrl = this.config.chromaUrl || "http://localhost:8000";
      this.chromaClient = new ChromaClient({
        path: chromaUrl
      });

      // Test ChromaDB connection
      try {
        await this.chromaClient.heartbeat();
        logger.info(`[CHROMA_CONTEXT_DB] Connected to ChromaDB at ${chromaUrl}`);
      } catch (error) {
        logger.warn(`[CHROMA_CONTEXT_DB] ChromaDB server not available at ${chromaUrl}, will retry on demand`);
        // Continue initialization - collections will be created when server is available
      }

      // Create embedding function with error handling
      let embeddingFunction;
      try {
        embeddingFunction = new DefaultEmbeddingFunction();
      } catch (error) {
        logger.warn("[CHROMA_CONTEXT_DB] DefaultEmbeddingFunction not available, using basic text mode");
        embeddingFunction = undefined; // ChromaDB can work without embeddings
      }

      // Create or get collections for each context type
      for (const [key, name] of Object.entries(COLLECTIONS)) {
        try {
          this.collections[key as CollectionKey] = await this.chromaClient.getCollection({
            name,
            embeddingFunction,
          });
          logger.debug(`[CHROMA_CONTEXT_DB] Connected to collection: ${name}`);
        } catch (error) {
          try {
            logger.debug(`[CHROMA_CONTEXT_DB] Creating new collection: ${name}`);
            this.collections[key as CollectionKey] = await this.chromaClient.createCollection({
              name,
              embeddingFunction,
              metadata: { 
                description: `${key} context for project analysis`,
                type: key,
                created: new Date().toISOString()
              },
            });
            logger.debug(`[CHROMA_CONTEXT_DB] Created collection: ${name}`);
          } catch (createError) {
            logger.warn(`[CHROMA_CONTEXT_DB] Failed to create collection ${name}:`, createError);
            // Set collection to null - operations will be skipped for this collection
            this.collections[key as CollectionKey] = null;
          }
        }
      }

      this.initialized = true;
      logger.info("[CHROMA_CONTEXT_DB] ChromaDB context storage initialized successfully");
    } catch (error) {
      logger.error("[CHROMA_CONTEXT_DB] Failed to initialize:", error);
      
      // Provide helpful error message and instructions
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch')) {
        logger.warn(`[CHROMA_CONTEXT_DB] ChromaDB server appears to be offline. To start ChromaDB:`);
        logger.warn(`[CHROMA_CONTEXT_DB] 1. Install ChromaDB: pip install chromadb`);
        logger.warn(`[CHROMA_CONTEXT_DB] 2. Start server: chroma run --host localhost --port 8000`);
        logger.warn(`[CHROMA_CONTEXT_DB] 3. Or use Docker: docker run -p 8000:8000 chromadb/chroma`);
        
        // Initialize with limited functionality
        this.initialized = true; // Mark as initialized but with limited functionality
        logger.warn("[CHROMA_CONTEXT_DB] Running in offline mode - context storage will be limited");
        return;
      }
      
      throw new Error(
        `ChromaDB context initialization failed: ${errorMessage}`
      );
    }
  }

  /**
   * Store context item in appropriate ChromaDB collection
   */
  public async store(item: ContextItem): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`[CHROMA_CONTEXT_DB] Storing context item: ${item.id}`);

      // Determine the appropriate collection based on context type
      const collectionKey = this.getCollectionKey(item.type, item.source);
      const collection = this.collections[collectionKey];

      if (!collection) {
        logger.warn(`[CHROMA_CONTEXT_DB] Collection not available: ${collectionKey}, skipping storage`);
        return; // Skip storage if collection is not available
      }

      // Chunk content if it's too large
      const chunks = this.chunkContent(item.content);
      
      // Store each chunk with unique IDs
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = chunks.length > 1 ? `${item.id}_chunk_${i}` : item.id;
        
        // Sanitize metadata for ChromaDB (only string, number, boolean values allowed)
        const chunkMetadata = this.sanitizeMetadata({
          // Basic item metadata (filter to safe values only)
          type: item.type,
          source: item.source,
          relevanceScore: item.relevanceScore,
          priority: item.priority,
          timestamp: item.timestamp.toISOString(),
          expiresAt: item.expiresAt?.toISOString() || "",
          tags: JSON.stringify(item.tags || []),
          projectId: item.projectId || "",
          sessionId: item.sessionId || "",
          taskId: item.taskId || "",
          chatId: item.chatId || "",
          // Chunk-specific metadata
          originalId: item.id,
          chunkIndex: i,
          totalChunks: chunks.length,
          chunkSize: chunks[i].length,
          // Add simple metadata from item.metadata
          ...(item.metadata?.filePath ? { filePath: String(item.metadata.filePath) } : {}),
          ...(item.metadata?.fileType ? { fileType: String(item.metadata.fileType) } : {}),
          ...(item.metadata?.language ? { language: String(item.metadata.language) } : {}),
        });

        // Add to collection with error handling
        try {
          await collection.add({
            ids: [chunkId],
            documents: [chunks[i]],
            metadatas: [chunkMetadata],
          });
        } catch (addError) {
          logger.error(`[CHROMA_CONTEXT_DB] Failed to add chunk ${chunkId} to collection:`, addError);
          // Try simplified metadata on retry
          try {
            await collection.add({
              ids: [chunkId],
              documents: [chunks[i]],
              metadatas: [{
                type: item.type,
                source: item.source,
                originalId: item.id,
                chunkIndex: i,
                totalChunks: chunks.length
              }],
            });
            logger.debug(`[CHROMA_CONTEXT_DB] Successfully added chunk ${chunkId} with simplified metadata`);
          } catch (retryError) {
            logger.error(`[CHROMA_CONTEXT_DB] Failed to add chunk ${chunkId} even with simplified metadata:`, retryError);
            throw retryError;
          }
        }
      }

      logger.debug(`[CHROMA_CONTEXT_DB] Stored context item as ${chunks.length} chunks: ${item.id}`);
    } catch (error) {
      logger.error(`[CHROMA_CONTEXT_DB] Failed to store context item:`, error);
      throw error;
    }
  }

  /**
   * Update existing context item
   */
  public async update(item: ContextItem): Promise<void> {
    try {
      logger.debug(`[CHROMA_CONTEXT_DB] Updating context item: ${item.id}`);

      // Remove existing item and re-add with new content
      await this.remove(item.id);
      await this.store(item);

      logger.debug(`[CHROMA_CONTEXT_DB] Updated context item: ${item.id}`);
    } catch (error) {
      logger.error(`[CHROMA_CONTEXT_DB] Failed to update context item:`, error);
      throw error;
    }
  }

  /**
   * Remove context item from ChromaDB
   */
  public async remove(contextId: string): Promise<void> {
    if (!this.initialized) {
      throw new Error("ChromaDB not initialized");
    }

    try {
      logger.debug(`[CHROMA_CONTEXT_DB] Removing context item: ${contextId}`);

      // Search across all collections to find and remove the item and its chunks
      let removedCount = 0;
      
      for (const [key, collection] of Object.entries(this.collections)) {
        if (!collection) continue;

        try {
          // Find items with matching originalId or exact id
          const results = await collection.get({
            where: {
              "originalId": contextId
            },
            include: ["metadatas"]
          });

          if (results.ids && results.ids.length > 0) {
            await collection.delete({ ids: results.ids });
            removedCount += results.ids.length;
            logger.debug(`[CHROMA_CONTEXT_DB] Removed ${results.ids.length} items from ${key} collection`);
          }
        } catch (error) {
          // Continue to next collection if this one fails
          logger.debug(`[CHROMA_CONTEXT_DB] No items found in ${key} collection for ${contextId}`);
        }
      }

      if (removedCount === 0) {
        logger.warn(`[CHROMA_CONTEXT_DB] No items found to remove: ${contextId}`);
      } else {
        logger.debug(`[CHROMA_CONTEXT_DB] Removed ${removedCount} chunks for context item: ${contextId}`);
      }
    } catch (error) {
      logger.error(`[CHROMA_CONTEXT_DB] Failed to remove context item:`, error);
      throw error;
    }
  }

  /**
   * Search context items using semantic search
   */
  public async search(query: ContextQuery): Promise<ContextItem[]> {
    if (!this.initialized) {
      throw new Error("ChromaDB not initialized");
    }

    try {
      logger.debug(`[CHROMA_CONTEXT_DB] Searching context: "${query.query || 'no query'}"`);

      const results: ContextItem[] = [];
      const seenIds = new Set<string>();

      // Determine which collections to search
      const collectionsToSearch = this.getSearchCollections(query);

      for (const collectionKey of collectionsToSearch) {
        const collection = this.collections[collectionKey];
        if (!collection) continue;

        try {
          let searchResults;

          if (query.query && this.config.enableSemanticSearch) {
            // Semantic search using embeddings
            searchResults = await collection.query({
              queryTexts: [query.query],
              nResults: query.maxResults || 10,
              where: this.buildWhereClause(query),
              include: ["documents", "metadatas", "distances"]
            });
          } else {
            // Metadata-only search
            searchResults = await collection.get({
              where: this.buildWhereClause(query),
              limit: query.maxResults || 10,
              include: ["documents", "metadatas"]
            });

            // Convert get results to query format
            if (searchResults.ids) {
              searchResults = {
                ids: [searchResults.ids],
                documents: [searchResults.documents],
                metadatas: [searchResults.metadatas],
                distances: [searchResults.ids.map(() => 0.5)] // Default distance
              };
            }
          }

          // Process results
          if (searchResults.ids && searchResults.ids[0]) {
            for (let i = 0; i < searchResults.ids[0].length; i++) {
              const id = searchResults.ids[0][i];
              const document = searchResults.documents?.[0]?.[i] || '';
              const metadataArray = searchResults.metadatas?.[0];
              const metadata = (Array.isArray(metadataArray) ? metadataArray[i] : metadataArray) || {};
              // Handle distance safely for both query and get results
              const distance = ('distances' in searchResults && searchResults.distances?.[0]?.[i]) || 0.5;

              // Get original ID (handle chunks)
              const originalId = String(metadata.originalId || id);
              
              // Skip if we've already processed this original item
              if (seenIds.has(originalId)) continue;
              seenIds.add(originalId);

              // Convert to ContextItem
              const item = await this.reconstructContextItem(originalId, {
                id: String(id),
                document: String(document),
                metadata,
                distance: Number(distance)
              });

              if (item) {
                results.push(item);
              }
            }
          }
        } catch (collectionError: any) {
          // Handle ChromaValueError specifically (common with empty collections or invalid queries)
          if (collectionError.name === 'ChromaValueError' || collectionError.message?.includes('ChromaValueError')) {
            logger.debug(`[CHROMA_CONTEXT_DB] Search failed in collection ${collectionKey}: ${collectionError.name} (likely empty collection or invalid query)`);
          } else {
            logger.debug(`[CHROMA_CONTEXT_DB] Search failed in collection ${collectionKey}:`, collectionError);
          }
        }
      }

      // Sort by relevance (inverse of distance) and timestamp
      results.sort((a, b) => {
        if (a.relevanceScore !== b.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return b.timestamp.getTime() - a.timestamp.getTime();
      });

      // Apply final limit
      const finalResults = query.maxResults ? results.slice(0, query.maxResults) : results;

      logger.debug(`[CHROMA_CONTEXT_DB] Found ${finalResults.length} context items across ${collectionsToSearch.length} collections`);
      return finalResults;
    } catch (error) {
      logger.error(`[CHROMA_CONTEXT_DB] Search failed:`, error);
      return [];
    }
  }

  /**
   * Get context item by ID
   */
  public async getById(contextId: string, type?: ContextType): Promise<ContextItem | null> {
    if (!this.initialized) {
      throw new Error("ChromaDB not initialized");
    }

    try {
      // Determine collection based on type
      const collectionsToSearch = type 
        ? [this.getCollectionKey(type)]
        : Object.keys(this.collections) as CollectionKey[];

      for (const collectionKey of collectionsToSearch) {
        const collection = this.collections[collectionKey];
        if (!collection) continue;

        try {
          // Search for exact ID or originalId match
          const results = await collection.get({
            where: {
              "originalId": contextId
            },
            include: ["documents", "metadatas"]
          });

          if (results.ids && results.ids.length > 0) {
            const item = await this.reconstructContextItem(contextId, {
              id: results.ids[0],
              document: results.documents?.[0] || '',
              metadata: results.metadatas?.[0] || {},
              distance: 0
            });

            if (item) {
              logger.debug(`[CHROMA_CONTEXT_DB] Found context item: ${contextId}`);
              return item;
            }
          }
        } catch (collectionError) {
          logger.debug(`[CHROMA_CONTEXT_DB] Item not found in collection ${collectionKey}: ${contextId}`);
        }
      }

      logger.debug(`[CHROMA_CONTEXT_DB] Context item not found: ${contextId}`);
      return null;
    } catch (error) {
      logger.error(`[CHROMA_CONTEXT_DB] Failed to get context item:`, error);
      return null;
    }
  }

  /**
   * Get database statistics
   */
  public async getStats(): Promise<{
    totalItems: number;
    itemsByType: Record<string, number>;
    itemsBySource: Record<string, number>;
    storageType: string;
    collections: Record<string, number>;
  }> {
    if (!this.initialized) {
      throw new Error("ChromaDB not initialized");
    }

    try {
      let totalItems = 0;
      const itemsByType: Record<string, number> = {};
      const itemsBySource: Record<string, number> = {};
      const collections: Record<string, number> = {};

      for (const [key, collection] of Object.entries(this.collections)) {
        if (!collection) continue;

        try {
          const results = await collection.get({
            include: ["metadatas"]
          });

          const count = results.ids?.length || 0;
          collections[key] = count;
          totalItems += count;

          // Count by type and source
          if (results.metadatas) {
            results.metadatas.forEach((metadata: any) => {
              if (metadata.type) {
                itemsByType[metadata.type] = (itemsByType[metadata.type] || 0) + 1;
              }
              if (metadata.source) {
                itemsBySource[metadata.source] = (itemsBySource[metadata.source] || 0) + 1;
              }
            });
          }
        } catch (collectionError) {
          logger.warn(`[CHROMA_CONTEXT_DB] Failed to get stats for collection ${key}:`, collectionError);
          collections[key] = 0;
        }
      }

      return {
        totalItems,
        itemsByType,
        itemsBySource,
        storageType: "chromadb",
        collections
      };
    } catch (error) {
      logger.error("[CHROMA_CONTEXT_DB] Failed to get stats:", error);
      throw error;
    }
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<{
    isHealthy: boolean;
    itemCount: number;
    error?: string;
  }> {
    try {
      const stats = await this.getStats();
      return {
        isHealthy: this.initialized && stats.totalItems >= 0,
        itemCount: stats.totalItems,
      };
    } catch (error) {
      return {
        isHealthy: false,
        itemCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Cleanup old/expired data
   */
  public async cleanup(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      logger.info("[CHROMA_CONTEXT_DB] Running cleanup task...");
      
      // Remove expired items across all collections
      const expiredQuery = {
        expiresAt: { "$lt": new Date().toISOString() }
      };

      for (const [key, collection] of Object.entries(this.collections)) {
        if (!collection) continue;

        try {
          const results = await collection.get({
            where: expiredQuery,
            include: ["metadatas"]
          });

          if (results.ids && results.ids.length > 0) {
            await collection.delete({ ids: results.ids });
            logger.debug(`[CHROMA_CONTEXT_DB] Cleaned up ${results.ids.length} expired items from ${key}`);
          }
        } catch (error) {
          logger.debug(`[CHROMA_CONTEXT_DB] No expired items found in ${key} collection`);
        }
      }

      logger.debug("[CHROMA_CONTEXT_DB] Cleanup completed");
    } catch (error) {
      logger.error("[CHROMA_CONTEXT_DB] Cleanup failed:", error);
    }
  }

  /**
   * Close connections and cleanup
   */
  public async close(): Promise<void> {
    this.chromaClient = null;
    this.collections = {
      context: null,
      code: null,
      documentation: null,
      dependencies: null,
      structure: null,
      metadata: null,
      tasks: null,
      chats: null,
      patterns: null,
    };
    this.initialized = false;
    logger.info("[CHROMA_CONTEXT_DB] ChromaDB connections closed");
  }

  /**
   * Store project metadata
   */
  public async storeProjectMetadata(metadata: ProjectMetadata): Promise<void> {
    const contextItem: ContextItem = {
      id: `project_metadata_${metadata.projectId}`,
      type: ContextType.PROJECT,
      source: ContextSource.FILE_SYSTEM,
      content: JSON.stringify(metadata, null, 2),
      metadata: {
        ...metadata,
        itemType: 'project_metadata'
      },
      relevanceScore: 1.0,
      priority: ContextPriority.HIGH,
      timestamp: new Date(),
      tags: ['metadata', 'project'],
      projectId: metadata.projectId,
    };

    await this.store(contextItem);
  }

  /**
   * Store task metadata
   */
  public async storeTaskMetadata(metadata: TaskMetadata): Promise<void> {
    const contextItem: ContextItem = {
      id: `task_metadata_${metadata.taskId}`,
      type: ContextType.TASK,
      source: ContextSource.SYSTEM,
      content: JSON.stringify(metadata, null, 2),
      metadata: {
        ...metadata,
        itemType: 'task_metadata'
      },
      relevanceScore: 0.8,
      priority: ContextPriority.MEDIUM,
      timestamp: new Date(),
      tags: ['metadata', 'task'],
      taskId: metadata.taskId,
    };

    await this.store(contextItem);
  }

  /**
   * Store chat metadata
   */
  public async storeChatMetadata(metadata: ChatMetadata): Promise<void> {
    const contextItem: ContextItem = {
      id: `chat_metadata_${metadata.chatId}`,
      type: ContextType.CONVERSATION,
      source: ContextSource.CHAT,
      content: JSON.stringify(metadata, null, 2),
      metadata: {
        ...metadata,
        itemType: 'chat_metadata'
      },
      relevanceScore: 0.7,
      priority: ContextPriority.MEDIUM,
      timestamp: new Date(),
      tags: ['metadata', 'chat'],
      chatId: metadata.chatId,
      sessionId: metadata.sessionId,
    };

    await this.store(contextItem);
  }

  /**
   * Store learning pattern
   */
  public async storeLearningPattern(pattern: LearningPattern): Promise<void> {
    const contextItem: ContextItem = {
      id: `learning_pattern_${pattern.id}`,
      type: ContextType.LEARNING,
      source: ContextSource.SYSTEM,
      content: JSON.stringify(pattern, null, 2),
      metadata: {
        ...pattern,
        itemType: 'learning_pattern'
      },
      relevanceScore: pattern.confidence,
      priority: ContextPriority.MEDIUM,
      timestamp: new Date(),
      tags: ['pattern', 'learning', ...pattern.tags],
    };

    await this.store(contextItem);
  }

  /**
   * Get learning patterns
   */
  public async getLearningPatterns(): Promise<LearningPattern[]> {
    const query: ContextQuery = {
      types: [ContextType.LEARNING],
      maxResults: 100
    };

    const items = await this.search(query);
    
    return items
      .map(item => {
        try {
          return JSON.parse(item.content) as LearningPattern;
        } catch (error) {
          logger.warn('[CHROMA_CONTEXT_DB] Failed to parse learning pattern:', error);
          return null;
        }
      })
      .filter((pattern): pattern is LearningPattern => pattern !== null);
  }

  // Private helper methods

  /**
   * Sanitize metadata to ensure only valid ChromaDB values (string, number, boolean)
   */
  private sanitizeMetadata(metadata: Record<string, any>): Record<string, string | number | boolean> {
    const sanitized: Record<string, string | number | boolean> = {};
    
    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || value === undefined) {
        continue; // Skip null/undefined values
      }
      
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        sanitized[key] = value;
      } else {
        // Convert complex types to strings
        sanitized[key] = String(value);
      }
    }
    
    return sanitized;
  }

  /**
   * Determine the appropriate collection for a context item
   */
  private getCollectionKey(type: ContextType, source?: ContextSource): CollectionKey {
    switch (type) {
      case ContextType.CODE:
        return 'code';
      case ContextType.DOCUMENTATION:
        return 'documentation';
      case ContextType.DEPENDENCY:
        return 'dependencies';
      case ContextType.PROJECT:
        return 'structure';
      case ContextType.TASK:
        return 'tasks';
      case ContextType.CONVERSATION:
        return 'chats';
      case ContextType.LEARNING:
        return 'patterns';
      default:
        return 'context';
    }
  }

  /**
   * Chunk large content for better embedding and retrieval
   */
  private chunkContent(content: string): string[] {
    if (!this.config.chunkSize || content.length <= this.config.chunkSize) {
      return [content];
    }

    const chunks: string[] = [];
    const chunkSize = this.config.chunkSize;
    const overlap = this.config.chunkOverlap || 0;

    for (let i = 0; i < content.length; i += chunkSize - overlap) {
      const end = Math.min(i + chunkSize, content.length);
      const chunk = content.slice(i, end);
      
      if (chunk.trim().length > 0) {
        chunks.push(chunk.trim());
      }

      if (end >= content.length) break;
    }

    return chunks.length > 0 ? chunks : [content];
  }

  /**
   * Build ChromaDB where clause from query
   */
  private buildWhereClause(query: ContextQuery): Record<string, any> | undefined {
    const conditions: any[] = [];

    if (query.types && query.types.length > 0) {
      conditions.push({
        type: { "$in": query.types }
      });
    }

    if (query.sources && query.sources.length > 0) {
      conditions.push({
        source: { "$in": query.sources }
      });
    }

    if (query.projectId) {
      conditions.push({
        projectId: query.projectId
      });
    }

    if (query.sessionId) {
      conditions.push({
        sessionId: query.sessionId
      });
    }

    if (query.taskId) {
      conditions.push({
        taskId: query.taskId
      });
    }

    if (query.chatId) {
      conditions.push({
        chatId: query.chatId
      });
    }

    if (query.minRelevanceScore !== undefined) {
      conditions.push({
        relevanceScore: { "$gte": query.minRelevanceScore }
      });
    }

    if (query.timeRange) {
      conditions.push({
        timestamp: {
          "$gte": query.timeRange.start.toISOString(),
          "$lte": query.timeRange.end.toISOString()
        }
      });
    }

    // Filter out expired items
    conditions.push({
      "$or": [
        { expiresAt: { "$eq": null } },
        { expiresAt: { "$gt": new Date().toISOString() } }
      ]
    });

    return conditions.length > 0 ? { "$and": conditions } : undefined;
  }

  /**
   * Determine which collections to search based on query
   */
  private getSearchCollections(query: ContextQuery): CollectionKey[] {
    if (query.types && query.types.length > 0) {
      const collections = new Set<CollectionKey>();
      
      query.types.forEach(type => {
        collections.add(this.getCollectionKey(type));
      });
      
      return Array.from(collections);
    }

    // Search all collections if no type specified
    return Object.keys(this.collections) as CollectionKey[];
  }

  /**
   * Reconstruct a ContextItem from ChromaDB results, handling chunks
   */
  private async reconstructContextItem(
    originalId: string,
    result: { id: string; document: string; metadata: any; distance: number }
  ): Promise<ContextItem | null> {
    try {
      const metadata = result.metadata;

      // If this is a chunk, try to get all chunks for the original item
      let content = result.document;
      if (metadata.totalChunks > 1) {
        content = await this.reconstructChunkedContent(originalId, metadata);
      }

      // Convert distance to relevance score (inverse relationship)
      const relevanceScore = metadata.relevanceScore || Math.max(0, 1 - result.distance);

      const item: ContextItem = {
        id: originalId,
        type: metadata.type || ContextType.PROJECT,
        source: metadata.source || ContextSource.SYSTEM,
        content,
        metadata: {
          ...metadata,
          // Remove chunk-specific metadata
          originalId: undefined,
          chunkIndex: undefined,
          totalChunks: undefined,
          chunkSize: undefined,
        },
        relevanceScore,
        priority: metadata.priority || ContextPriority.MEDIUM,
        timestamp: new Date(metadata.timestamp || Date.now()),
        expiresAt: metadata.expiresAt ? new Date(metadata.expiresAt) : undefined,
        tags: typeof metadata.tags === 'string' ? JSON.parse(metadata.tags) : (metadata.tags || []),
        projectId: metadata.projectId,
        sessionId: metadata.sessionId,
        taskId: metadata.taskId,
        chatId: metadata.chatId,
      };

      return item;
    } catch (error) {
      logger.error('[CHROMA_CONTEXT_DB] Failed to reconstruct context item:', error);
      return null;
    }
  }

  /**
   * Reconstruct content from multiple chunks
   */
  private async reconstructChunkedContent(originalId: string, sampleMetadata: any): Promise<string> {
    try {
      // Find the collection this item belongs to
      const collectionKey = this.getCollectionKey(sampleMetadata.type, sampleMetadata.source);
      const collection = this.collections[collectionKey];

      if (!collection) {
        return sampleMetadata.content || '';
      }

      // Get all chunks for this original ID
      const results = await collection.get({
        where: { originalId: originalId },
        include: ["documents", "metadatas"]
      });

      if (!results.ids || results.ids.length === 0) {
        return sampleMetadata.content || '';
      }

      // Sort chunks by index and reconstruct content
      const chunks: Array<{ index: number; content: string }> = [];
      
      for (let i = 0; i < results.ids.length; i++) {
        const metadata = results.metadatas?.[i];
        const document = results.documents?.[i];
        
        if (metadata && document) {
          const chunkIndex = typeof metadata.chunkIndex === 'number' ? metadata.chunkIndex : 0;
          chunks.push({
            index: chunkIndex,
            content: document
          });
        }
      }

      // Sort by chunk index and join
      chunks.sort((a, b) => a.index - b.index);
      return chunks.map(chunk => chunk.content).join(' ');

    } catch (error) {
      logger.error('[CHROMA_CONTEXT_DB] Failed to reconstruct chunked content:', error);
      return sampleMetadata.content || '';
    }
  }
}