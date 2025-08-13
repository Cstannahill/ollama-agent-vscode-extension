import { ChromaClient, CloudClient, Collection, IncludeEnum } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import * as path from "path";
import * as fs from "fs/promises";
import * as vscode from "vscode";
import { logger } from "../utils/logger";
import { extensionContextProvider } from "../utils/ExtensionContextProvider";
// Environment variables should be loaded by extension.ts at startup

export interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    source: string;
    title: string;
    url?: string;
    language?: string;
    framework?: string;
    version?: string;
    section?: string;
    lastUpdated: string;
    chunkIndex: number;
    totalChunks: number;
    category?: string;
    author?: string;
    priority?: string;
    tags?: string;
    originalFile?: string;
  };
  embedding?: number[];
}

export interface SearchResult {
  document: DocumentChunk;
  score: number;
  distance: number;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  filter?: Record<string, any>;
  includeMetadata?: boolean;
}

/**
 * Vector database for storing and searching documentation
 * Uses ChromaDB for cloud or local persistent vector storage
 * Cloud mode: Uses CHROMA_API_KEY, CHROMA_TENANT, CHROMA_DATABASE from .env
 * Local mode: Fallback to local ChromaDB server
 */
export class VectorDatabase {
  private static instance: VectorDatabase;
  private client: ChromaClient | null = null;
  private collection: Collection | null = null;
  private readonly collectionName = "documentation";
  private readonly dbPath: string;
  private isInitialized = false;
  private initializationAttempted = false;
  private lastInitializationAttempt = 0;
  private readonly INITIALIZATION_COOLDOWN = 60000; // 1 minute cooldown between retries

  private constructor() {
    this.dbPath = this.getDatabasePath();
    console.log("GETDBPATH:", this.dbPath);
  }

  static getInstance(): VectorDatabase {
    if (!VectorDatabase.instance) {
      VectorDatabase.instance = new VectorDatabase();
      // Force initialization log to help debug
      console.log("[VECTOR_DB] Creating VectorDatabase singleton instance");
    }
    return VectorDatabase.instance;
  }

  private getDatabasePath(): string {
    // Use global storage path which is guaranteed to be writable
    // Falls back to user's home directory if context is not available
    try {
      const globalStoragePath = extensionContextProvider.getGlobalStoragePath();
      console.log("GLOBAL_STORAGE_PATH:", globalStoragePath);
      if (globalStoragePath) {
        return path.join(globalStoragePath, ".chroma");
      }
    } catch (error) {
      logger.warn("[VECTOR_DB] Could not access global storage path:", error);
    }

    // Fallback to workspace storage if available
    try {
      const workspaceStoragePath =
        extensionContextProvider.getWorkspaceStoragePath();
      if (workspaceStoragePath) {
        return path.join(workspaceStoragePath, ".chroma");
      }
    } catch (error) {
      logger.warn(
        "[VECTOR_DB] Could not access workspace storage path:",
        error
      );
    }

    // Final fallback to user's home directory
    const homeDir = require("os").homedir();
    const fallbackPath = path.join(
      homeDir,
      ".vscode",
      "ollama-agent",
      ".chroma"
    );
    logger.info(`[VECTOR_DB] Using fallback path: ${fallbackPath}`);
    return fallbackPath;
  }

  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) {
        return;
      }

      // Prevent frequent re-initialization attempts
      const now = Date.now();
      if (this.initializationAttempted && !this.isInitialized) {
        if (
          now - this.lastInitializationAttempt <
          this.INITIALIZATION_COOLDOWN
        ) {
          logger.debug(
            `[VECTOR_DB] Skipping initialization - cooldown period (${Math.round(
              (this.INITIALIZATION_COOLDOWN -
                (now - this.lastInitializationAttempt)) /
                1000
            )}s remaining)`
          );
          return;
        }
      }

      this.lastInitializationAttempt = now;
      this.initializationAttempted = true;

      logger.info("[VECTOR_DB] Initializing ChromaDB...");
      logger.debug(`[VECTOR_DB] Database path: ${this.dbPath}`);

      // Check if ChromaDB is available

      // Check if we're using cloud configuration
      const chromaApiKey = process.env.CHROMA_API_KEY;
      const chromaTenant = process.env.CHROMA_TENANT;
      const chromaDatabase = process.env.CHROMA_DATABASE;
      const isCloudMode = chromaApiKey && chromaTenant && chromaDatabase;

      logger.debug(
        `[VECTOR_DB] Environment check - API Key: ${
          chromaApiKey ? "present" : "missing"
        }, Tenant: ${chromaTenant ? "present" : "missing"}, Database: ${
          chromaDatabase ? "present" : "missing"
        }`
      );
      logger.debug(
        `[VECTOR_DB] Cloud mode: ${isCloudMode ? "enabled" : "disabled"}`
      );

      // Only create local database directory if not using cloud
      if (!isCloudMode) {
        try {
          await fs.mkdir(this.dbPath, { recursive: true });
          logger.debug(
            `[VECTOR_DB] Created local database directory: ${this.dbPath}`
          );
        } catch (error) {
          logger.error(
            `[VECTOR_DB] Failed to create database directory: ${this.dbPath}`,
            error
          );
          throw new Error(`Failed to create database directory: ${error}`);
        }
      }

      // Initialize ChromaDB client (cloud or local)
      try {
        const chromaApiKey = process.env.CHROMA_API_KEY;
        const chromaTenant = process.env.CHROMA_TENANT;
        const chromaDatabase = process.env.CHROMA_DATABASE;

        if (chromaApiKey && chromaTenant && chromaDatabase) {
          // Cloud configuration using modern ChromaDB client format
          logger.info(
            "[VECTOR_DB] Initializing ChromaDB with cloud configuration..."
          );
          logger.debug(
            `[VECTOR_DB] Cloud config details - API Key: ${chromaApiKey.substring(
              0,
              10
            )}..., Tenant: ${chromaTenant}, Database: ${chromaDatabase}`
          );

          this.client = new CloudClient({
            apiKey: chromaApiKey,
            tenant: chromaTenant,
            database: chromaDatabase,
          });
          logger.info(
            `[VECTOR_DB] Using cloud ChromaDB - Tenant: ${chromaTenant}, Database: ${chromaDatabase}`
          );
        } else {
          // Local fallback configuration
          logger.info(
            "[VECTOR_DB] No cloud config found, using local ChromaDB..."
          );
          this.client = new ChromaClient();
          logger.debug("[VECTOR_DB] Using local ChromaDB server");
        }

        // Test the connection with detailed error logging
        try {
          logger.debug("[VECTOR_DB] Testing ChromaDB connection...");
          await this.client.heartbeat();
          logger.info(
            "[VECTOR_DB] ChromaDB client created and server is reachable"
          );
        } catch (connectionError) {
          logger.error("[VECTOR_DB] ChromaDB connection test failed:", {
            error:
              connectionError instanceof Error
                ? connectionError.message
                : String(connectionError),
            stack:
              connectionError instanceof Error
                ? connectionError.stack
                : undefined,
            isCloudMode: !!(chromaApiKey && chromaTenant && chromaDatabase),
            endpoint: chromaApiKey ? "https://api.trychroma.com" : "local",
          });
          throw connectionError;
        }
      } catch (error) {
        logger.warn(
          "[VECTOR_DB] ChromaDB server not available, falling back to no-op mode:",
          error
        );
        // Don't throw error, just log warning and continue with degraded functionality
        this.client = null;
        // Still mark as initialized to prevent constant retries
        this.isInitialized = true;
        return;
      }

      // Create embedding function (required for ChromaDB 3.0+)
      let embeddingFunction;
      try {
        // ChromaDB 3.0+ requires explicit embedding function
        embeddingFunction = new DefaultEmbeddingFunction();
        logger.debug("[VECTOR_DB] Created DefaultEmbeddingFunction");
      } catch (error) {
        logger.error("[VECTOR_DB] Failed to create embedding function:", error);
        throw new Error(`Failed to create embedding function: ${error}`);
      }

      // Only proceed if client is available
      if (!this.client) {
        logger.warn(
          "[VECTOR_DB] ChromaDB client not available, skipping collection setup"
        );
        return;
      }

      // Get or create collection with permission-aware error handling
      try {
        this.collection = await this.client.getCollection({
          name: this.collectionName,
          embeddingFunction,
        });
        logger.info("[VECTOR_DB] Connected to existing collection");
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.debug(
          "[VECTOR_DB] Collection doesn't exist, attempting to create:",
          errorMessage
        );

        try {
          this.collection = await this.client.createCollection({
            name: this.collectionName,
            embeddingFunction,
            metadata: {
              description: "Documentation embeddings for agent assistance",
            },
          });
          logger.info("[VECTOR_DB] Created new collection");
        } catch (createError) {
          const createErrorMessage =
            createError instanceof Error
              ? createError.message
              : String(createError);

          // Handle permission errors gracefully
          if (
            createErrorMessage.toLowerCase().includes("unauthorized") ||
            createErrorMessage.toLowerCase().includes("permission")
          ) {
            logger.warn(
              `[VECTOR_DB] Limited permissions for collection creation: ${createErrorMessage}`
            );
            logger.warn(
              "[VECTOR_DB] Collection operations may be restricted - this may be normal for read-only API keys"
            );
            // Mark as initialized but without a collection - operations will gracefully fail
            this.isInitialized = true;
            return;
          }

          logger.error("[VECTOR_DB] Failed to create collection:", createError);
          throw new Error(`Failed to create collection: ${createError}`);
        }
      }

      this.isInitialized = true;
      logger.info("[VECTOR_DB] Initialization complete");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[VECTOR_DB] Initialization failed:", errorMessage, error);

      // Mark as initialized even if failed to prevent constant retries
      // The system will fall back to no-op mode
      this.isInitialized = true;
      logger.warn(
        `[VECTOR_DB] Initialization failed, falling back to no-op mode: ${errorMessage}`
      );
    }
  }

  async addDocuments(documents: DocumentChunk[]): Promise<void> {
    await this.ensureInitialized();

    if (!this.isAvailable()) {
      logger.warn(
        "[VECTOR_DB] ChromaDB not available, skipping document addition"
      );
      return;
    }

    // Try to get/create collection if we don't have one
    if (!this.collection && this.client) {
      try {
        await this.ensureCollection();
      } catch (error) {
        logger.warn(
          "[VECTOR_DB] Could not ensure collection exists, skipping document addition:",
          error
        );
        return;
      }
    }

    try {
      if (documents.length === 0) {
        return;
      }

      logger.info(`[VECTOR_DB] Adding ${documents.length} documents`);

      // Validate and clean documents before adding
      const validDocuments = this.validateDocuments(documents);
      if (validDocuments.length === 0) {
        logger.warn("[VECTOR_DB] No valid documents to add after validation");
        return;
      }

      if (validDocuments.length < documents.length) {
        logger.warn(
          `[VECTOR_DB] Filtered out ${
            documents.length - validDocuments.length
          } invalid documents`
        );
      }

      // Process documents in batches to avoid ChromaDB limits
      const batchSize = 100; // Process 100 documents at a time
      let processed = 0;

      for (let i = 0; i < validDocuments.length; i += batchSize) {
        const batch = validDocuments.slice(i, i + batchSize);

        // Prepare data for ChromaDB batch
        const ids = batch.map((doc) => doc.id);
        const embeddings = batch.map((doc) => doc.embedding);
        const metadatas = batch.map((doc) =>
          this.sanitizeMetadata(doc.metadata)
        );
        const documents_content = batch.map((doc) => doc.content);

        try {
          // Check if we have embeddings, if not we'll let ChromaDB generate them
          if (embeddings.some((emb) => !emb)) {
            // Add without embeddings - ChromaDB will generate them
            await this.collection!.add({
              ids,
              documents: documents_content,
              metadatas,
            });
          } else {
            // Add with pre-computed embeddings
            await this.collection!.add({
              ids,
              embeddings: embeddings as number[][],
              documents: documents_content,
              metadatas,
            });
          }

          processed += batch.length;
          logger.debug(
            `[VECTOR_DB] Processed batch ${
              Math.ceil(i / batchSize) + 1
            }: ${processed}/${validDocuments.length} documents`
          );
        } catch (batchError: any) {
          const batchErrorMessage =
            batchError instanceof Error
              ? batchError.message
              : String(batchError);

          logger.error(
            `[VECTOR_DB] Failed to add batch ${
              Math.ceil(i / batchSize) + 1
            }/${Math.ceil(validDocuments.length / batchSize)}:`,
            batchError
          );

          // Handle permission errors gracefully
          if (
            batchErrorMessage.toLowerCase().includes("unauthorized") ||
            batchErrorMessage.toLowerCase().includes("permission")
          ) {
            logger.warn(
              `[VECTOR_DB] Permission denied for document addition: ${batchErrorMessage}`
            );
            logger.warn("[VECTOR_DB] API key may have read-only permissions");
            // Continue processing but log warning
            continue;
          }

          // Log detailed error information for ChromaValueError
          if (
            batchError.name === "ChromaValueError" ||
            batchError.message?.includes("ChromaValueError")
          ) {
            logger.error("[VECTOR_DB] ChromaValueError details:", {
              errorName: batchError.name,
              message: batchError.message,
              batchSize: batch.length,
              sampleIds: ids.slice(0, 3), // Log first 3 IDs for debugging
              sampleMetadata: metadatas.slice(0, 1), // Log first metadata object
            });

            // Try to continue with the next batch instead of failing completely
            logger.warn(
              "[VECTOR_DB] Skipping problematic batch and continuing..."
            );
            continue;
          }

          throw batchError; // Re-throw other errors
        }
      }

      logger.info(
        `[VECTOR_DB] Successfully added ${validDocuments.length} documents`
      );
    } catch (error) {
      logger.error("[VECTOR_DB] Failed to add documents:", error);
      throw new Error(`Failed to add documents: ${error}`);
    }
  }

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();

    if (!this.isAvailable()) {
      logger.warn(
        "[VECTOR_DB] ChromaDB not available, returning empty search results"
      );
      return [];
    }

    // Try to ensure collection access
    if (!this.collection && this.client) {
      try {
        await this.ensureCollection();
      } catch (error) {
        logger.warn(
          "[VECTOR_DB] Could not access collection for search, returning empty results:",
          error
        );
        return [];
      }
    }

    if (!this.collection) {
      logger.warn(
        "[VECTOR_DB] No collection access available, returning empty search results"
      );
      return [];
    }

    try {
      const { limit = 10, threshold = 0.05, filter } = options;

      logger.debug(
        `[VECTOR_DB] Searching for: "${query}" with threshold: ${threshold}`
      );

      const results = await this.collection!.query({
        queryTexts: [query],
        nResults: limit,
        where: filter,
        include: [
          "documents" as IncludeEnum,
          "metadatas" as IncludeEnum,
          "distances" as IncludeEnum,
        ],
      });

      if (!results.documents || !results.documents[0]) {
        logger.debug("[VECTOR_DB] No documents returned from query");
        return [];
      }

      const searchResults: SearchResult[] = [];
      const documents = results.documents[0];
      const metadatas = results.metadatas?.[0] || [];
      const distances = results.distances?.[0] || [];
      const ids = results.ids?.[0] || [];

      logger.debug(
        `[VECTOR_DB] Raw query returned ${documents.length} documents`
      );

      // Check for embedding issues - identical distances suggest problems
      const uniqueDistances = new Set(
        distances.filter((d) => d !== null && d !== undefined)
      );
      if (uniqueDistances.size === 1 && documents.length > 1) {
        logger.warn(
          `[VECTOR_DB] All ${
            documents.length
          } results have identical distance: ${
            Array.from(uniqueDistances)[0]
          } - possible embedding issue`
        );
      }

      // Debug: Check document content quality
      if (documents.length > 0) {
        const firstDoc = documents[0];
        const firstMeta = metadatas[0];
        logger.debug(
          `[VECTOR_DB] Sample document content (first 200 chars): "${firstDoc?.substring(
            0,
            200
          )}"`
        );
        logger.debug(
          `[VECTOR_DB] Sample metadata: ${JSON.stringify(firstMeta)}`
        );
      }

      // Check if all scores are negative (indicates poor embeddings)
      const scores = distances
        .filter((d) => d !== null && d !== undefined)
        .map((d) => 1 - d);
      const positiveScores = scores.filter((s) => s > 0);
      if (positiveScores.length === 0 && scores.length > 0) {
        logger.warn(
          `[VECTOR_DB] All search scores are negative (range: ${Math.min(
            ...scores
          ).toFixed(3)} to ${Math.max(...scores).toFixed(
            3
          )}) - possible embedding function issue`
        );
      }

      for (let i = 0; i < documents.length; i++) {
        const distance = distances[i];
        if (distance === null || distance === undefined) {
          logger.debug(`[VECTOR_DB] Skipping result ${i} - null distance`);
          continue; // Skip if distance is null
        }
        const score = 1 - distance; // Convert distance to similarity score

        logger.debug(
          `[VECTOR_DB] Result ${i}: distance=${distance}, score=${score}, threshold=${threshold}`
        );

        if (score >= threshold) {
          searchResults.push({
            document: {
              id: ids[i],
              content: documents[i] || "",
              metadata: metadatas[i] as DocumentChunk["metadata"],
            },
            score,
            distance,
          });
        }
      }

      logger.debug(
        `[VECTOR_DB] Found ${searchResults.length} results above threshold (out of ${documents.length} total)`
      );
      return searchResults.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error("[VECTOR_DB] Search failed:", error);
      return []; // Return empty array instead of throwing
    }
  }

  async updateDocument(document: DocumentChunk): Promise<void> {
    await this.ensureInitialized();

    try {
      // ChromaDB doesn't have native update, so we delete and re-add
      await this.deleteDocument(document.id);
      await this.addDocuments([document]);

      logger.debug(`[VECTOR_DB] Updated document: ${document.id}`);
    } catch (error) {
      logger.error("[VECTOR_DB] Failed to update document:", error);
      throw new Error(`Failed to update document: ${error}`);
    }
  }

  async deleteDocument(id: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.collection!.delete({
        ids: [id],
      });

      logger.debug(`[VECTOR_DB] Deleted document: ${id}`);
    } catch (error) {
      logger.error("[VECTOR_DB] Failed to delete document:", error);
      throw new Error(`Failed to delete document: ${error}`);
    }
  }

  async deleteByFilter(filter: Record<string, any>): Promise<number> {
    await this.ensureInitialized();

    try {
      const results = await this.collection!.get({
        where: filter,
        include: ["documents" as IncludeEnum],
      });

      if (results.ids && results.ids.length > 0) {
        await this.collection!.delete({
          where: filter,
        });

        logger.debug(
          `[VECTOR_DB] Deleted ${results.ids.length} documents matching filter`
        );
        return results.ids.length;
      }

      return 0;
    } catch (error) {
      logger.error("[VECTOR_DB] Failed to delete by filter:", error);
      throw new Error(`Failed to delete by filter: ${error}`);
    }
  }

  async getCollectionStats(): Promise<{
    count: number;
    sources: string[];
    languages: string[];
    frameworks: string[];
  }> {
    await this.ensureInitialized();

    if (!this.isAvailable()) {
      logger.warn("[VECTOR_DB] ChromaDB not available, returning empty stats");
      return { count: 0, sources: [], languages: [], frameworks: [] };
    }

    // Try to ensure collection access
    if (!this.collection && this.client) {
      try {
        await this.ensureCollection();
      } catch (error) {
        logger.debug(
          "[VECTOR_DB] Could not access collection for stats, returning empty stats:",
          error
        );
        return { count: 0, sources: [], languages: [], frameworks: [] };
      }
    }

    if (!this.collection) {
      logger.debug(
        "[VECTOR_DB] No collection access available, returning empty stats"
      );
      return { count: 0, sources: [], languages: [], frameworks: [] };
    }

    try {
      const results = await this.collection!.get({
        include: ["metadatas" as IncludeEnum],
      });

      const metadatas = results.metadatas || [];
      const sources = new Set<string>();
      const languages = new Set<string>();
      const frameworks = new Set<string>();

      logger.debug(
        `[VECTOR_DB] Collection stats: ${metadatas.length} total documents`
      );

      metadatas.forEach((meta: any) => {
        if (meta.source) sources.add(meta.source);
        if (meta.language) languages.add(meta.language);
        if (meta.framework) frameworks.add(meta.framework);
      });

      const stats = {
        count: metadatas.length,
        sources: Array.from(sources),
        languages: Array.from(languages),
        frameworks: Array.from(frameworks),
      };

      logger.debug(`[VECTOR_DB] Stats breakdown: ${JSON.stringify(stats)}`);

      return stats;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Handle permission errors gracefully
      if (
        errorMessage.toLowerCase().includes("unauthorized") ||
        errorMessage.toLowerCase().includes("permission")
      ) {
        logger.debug(
          `[VECTOR_DB] Permission denied for collection stats: ${errorMessage}`
        );
        logger.debug(
          "[VECTOR_DB] API key may have read-only permissions - returning empty stats"
        );
        return { count: 0, sources: [], languages: [], frameworks: [] };
      }

      logger.error("[VECTOR_DB] Failed to get stats:", error);
      return { count: 0, sources: [], languages: [], frameworks: [] };
    }
  }

  async debugCollection(): Promise<void> {
    await this.ensureInitialized();

    if (!this.isAvailable()) {
      logger.warn("[VECTOR_DB] ChromaDB not available for debugging");
      return;
    }

    try {
      // Get a few sample documents to check content quality
      const sampleResults = await this.collection!.get({
        limit: 3,
        include: ["documents" as IncludeEnum, "metadatas" as IncludeEnum],
      });

      logger.info(`[VECTOR_DB] === COLLECTION DEBUG ===`);
      // Get actual collection count
      const fullResults = await this.collection!.count();
      logger.info(
        `[VECTOR_DB] Collection has ${fullResults} total documents (sample shows ${
          sampleResults.ids?.length || 0
        })`
      );

      // Check source distribution
      const allDocs = await this.collection!.get({
        include: ["metadatas" as IncludeEnum],
      });

      const sourceStats: Record<string, number> = {};
      allDocs.metadatas?.forEach((meta: any) => {
        const source = meta?.source || "Unknown";
        sourceStats[source] = (sourceStats[source] || 0) + 1;
      });

      logger.info(
        `[VECTOR_DB] Documents by source: ${JSON.stringify(
          sourceStats,
          null,
          2
        )}`
      );

      if (sampleResults.documents && sampleResults.metadatas) {
        sampleResults.documents.forEach((doc, i) => {
          const meta = sampleResults.metadatas?.[i];
          logger.info(`[VECTOR_DB] Sample doc ${i + 1}:`);
          logger.info(`  - ID: ${sampleResults.ids?.[i]}`);
          logger.info(`  - Source: ${meta?.source}`);
          logger.info(`  - Title: ${meta?.title}`);
          logger.info(
            `  - Content (first 150 chars): "${doc?.substring(0, 150)}"`
          );
          logger.info(`  - Content length: ${doc?.length || 0} chars`);
        });
      }

      // Test a simple search to see what happens
      logger.info(`[VECTOR_DB] Testing simple search for known content...`);
      const testResults = await this.collection!.query({
        queryTexts: ["function"],
        nResults: 3,
        include: ["documents" as IncludeEnum, "distances" as IncludeEnum],
      });

      if (testResults.distances?.[0]) {
        const distances = testResults.distances[0].filter(
          (d) => d !== null
        ) as number[];
        const scores = distances.map((d) => 1 - d);
        logger.info(
          `[VECTOR_DB] Test search distances: ${distances
            .map((d) => d.toFixed(3))
            .join(", ")}`
        );
        logger.info(
          `[VECTOR_DB] Test search scores: ${scores
            .map((s) => s.toFixed(3))
            .join(", ")}`
        );
      }
    } catch (error) {
      logger.error("[VECTOR_DB] Debug collection failed:", error);
    }
  }

  async getSourceStats(source: string): Promise<{
    documentCount: number;
    lastUpdated?: Date;
  }> {
    await this.ensureInitialized();

    if (!this.isAvailable()) {
      logger.warn(
        `[VECTOR_DB] ChromaDB not available, returning empty stats for source ${source}`
      );
      return { documentCount: 0 };
    }

    // Try to ensure collection access
    if (!this.collection && this.client) {
      try {
        await this.ensureCollection();
      } catch (error) {
        logger.debug(
          `[VECTOR_DB] Could not access collection for stats source ${source}, returning empty stats:`,
          error
        );
        return { documentCount: 0 };
      }
    }

    if (!this.collection) {
      logger.debug(
        `[VECTOR_DB] No collection access available, returning empty stats for source ${source}`
      );
      return { documentCount: 0 };
    }

    try {
      const results = await this.collection!.get({
        where: { source: source },
        include: ["metadatas" as IncludeEnum],
      });

      const metadatas = results.metadatas || [];
      let lastUpdated: Date | undefined;

      // Find the most recent lastUpdated timestamp
      metadatas.forEach((meta: any) => {
        if (meta.lastUpdated) {
          const updated = new Date(meta.lastUpdated);
          if (!lastUpdated || updated > lastUpdated) {
            lastUpdated = updated;
          }
        }
      });

      return {
        documentCount: metadatas.length,
        lastUpdated,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Handle permission errors gracefully
      if (
        errorMessage.toLowerCase().includes("unauthorized") ||
        errorMessage.toLowerCase().includes("permission")
      ) {
        logger.debug(
          `[VECTOR_DB] Permission denied for source stats ${source}: ${errorMessage}`
        );
        logger.debug(
          "[VECTOR_DB] API key may have read-only permissions - returning empty stats"
        );
        return { documentCount: 0 };
      }

      logger.error(
        `[VECTOR_DB] Failed to get stats for source ${source}:`,
        error
      );
      return { documentCount: 0 };
    }
  }

  async clearCollection(): Promise<void> {
    await this.ensureInitialized();

    if (!this.isAvailable()) {
      logger.warn(
        "[VECTOR_DB] ChromaDB not available, skipping collection clear"
      );
      return;
    }

    try {
      // Delete all documents in the collection (ChromaDB 3.0+ syntax)
      await this.collection!.delete({});
      logger.info("[VECTOR_DB] Cleared all documents from collection");
    } catch (error) {
      logger.error("[VECTOR_DB] Failed to clear collection:", error);
      throw new Error(`Failed to clear collection: ${error}`);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private async ensureCollection(): Promise<void> {
    if (!this.client) {
      throw new Error("No ChromaDB client available");
    }

    if (this.collection) {
      return; // Collection already available
    }

    // Create embedding function (required for ChromaDB 3.0+)
    let embeddingFunction;
    try {
      const {
        DefaultEmbeddingFunction,
      } = require("@chroma-core/default-embed");
      embeddingFunction = new DefaultEmbeddingFunction();
      logger.debug(
        "[VECTOR_DB] Created DefaultEmbeddingFunction for collection access"
      );
    } catch (error) {
      logger.error("[VECTOR_DB] Failed to create embedding function:", error);
      throw new Error(`Failed to create embedding function: ${error}`);
    }

    // Try to get existing collection first
    try {
      this.collection = await this.client.getCollection({
        name: this.collectionName,
        embeddingFunction,
      });
      logger.info(
        "[VECTOR_DB] Successfully connected to existing documentation collection"
      );
      return;
    } catch (error) {
      logger.debug(
        "[VECTOR_DB] Documentation collection doesn't exist, attempting to create"
      );
    }

    // Try to create collection if it doesn't exist
    try {
      this.collection = await this.client.createCollection({
        name: this.collectionName,
        embeddingFunction,
        metadata: {
          description: "Documentation embeddings for agent assistance",
        },
      });
      logger.info(
        "[VECTOR_DB] Successfully created new documentation collection"
      );
    } catch (createError) {
      const createErrorMessage =
        createError instanceof Error
          ? createError.message
          : String(createError);

      // Handle permission errors gracefully
      if (
        createErrorMessage.toLowerCase().includes("unauthorized") ||
        createErrorMessage.toLowerCase().includes("permission")
      ) {
        logger.warn(
          `[VECTOR_DB] Limited permissions for collection creation: ${createErrorMessage}`
        );
        logger.warn(
          "[VECTOR_DB] API key may have read-only permissions - collection operations will be restricted"
        );
        // Don't throw - we can still work without collection access
        return;
      }

      logger.error("[VECTOR_DB] Failed to create collection:", createError);
      throw new Error(`Failed to create collection: ${createError}`);
    }
  }

  private isAvailable(): boolean {
    // Database is available if we have a client connection, even without collection access
    return this.isInitialized && this.client !== null;
  }

  private validateDocuments(documents: DocumentChunk[]): DocumentChunk[] {
    const seenIds = new Set<string>();

    return documents.filter((doc) => {
      // Check for required fields
      if (!doc.id || !doc.content || !doc.metadata) {
        logger.warn(
          `[VECTOR_DB] Skipping document with missing required fields: ${
            doc.id || "unknown"
          }`
        );
        return false;
      }

      // Sanitize and validate ID
      const originalId = doc.id;
      doc.id = this.sanitizeId(doc.id);

      if (doc.id !== originalId) {
        logger.debug(
          `[VECTOR_DB] Sanitized ID from "${originalId}" to "${doc.id}"`
        );
      }

      // Check for duplicate IDs
      if (seenIds.has(doc.id)) {
        // Create a unique ID by appending a counter
        let counter = 1;
        let uniqueId = `${doc.id}_${counter}`;
        while (seenIds.has(uniqueId)) {
          counter++;
          uniqueId = `${doc.id}_${counter}`;
        }
        logger.warn(
          `[VECTOR_DB] Duplicate document ID "${doc.id}" changed to "${uniqueId}"`
        );
        doc.id = uniqueId;
      }
      seenIds.add(doc.id);

      // Check ID format (ChromaDB has specific requirements)
      if (doc.id.length === 0 || doc.id.length > 100) {
        logger.warn(
          `[VECTOR_DB] Skipping document with invalid ID length: ${doc.id}`
        );
        return false;
      }

      // Check content
      if (doc.content.trim().length === 0) {
        logger.warn(
          `[VECTOR_DB] Skipping document with empty content: ${doc.id}`
        );
        return false;
      }

      // Check if content is too large (ChromaDB has limits)
      if (doc.content.length > 10000) {
        logger.debug(
          `[VECTOR_DB] Content too large for document ${doc.id}, truncating`
        );
        doc.content = doc.content.substring(0, 10000) + "...";
      }

      return true;
    });
  }

  private sanitizeId(id: string): string {
    // ChromaDB ID requirements:
    // - Must be non-empty string
    // - Should not contain special characters that might cause issues
    // - Length should be reasonable (< 100 chars)

    let sanitized = id
      .replace(/[^\w\-_.]/g, "_") // Replace non-alphanumeric chars with underscore
      .replace(/_+/g, "_") // Replace multiple underscores with single
      .replace(/^_|_$/g, "") // Remove leading/trailing underscores
      .substring(0, 90); // Leave room for uniqueness suffix

    // Ensure ID is not empty
    if (sanitized.length === 0) {
      sanitized = `doc_${Date.now()}`;
    }

    return sanitized;
  }

  private sanitizeMetadata(metadata: any): Record<string, any> {
    const sanitized: Record<string, any> = {};

    // ChromaDB metadata requirements:
    // - Values must be strings, numbers, or booleans
    // - No null or undefined values
    // - No nested objects or arrays
    // - String values should be reasonable length
    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || value === undefined) {
        continue; // Skip null/undefined values
      }

      // Sanitize key name - ChromaDB might have requirements for keys too
      const sanitizedKey = String(key).replace(/[^\w]/g, "_").substring(0, 50);

      if (typeof value === "string") {
        // Ensure string is not too long and doesn't contain problematic characters
        const sanitizedValue = String(value).substring(0, 500); // Limit string length
        sanitized[sanitizedKey] = sanitizedValue;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        sanitized[sanitizedKey] = value;
      } else if (typeof value === "boolean") {
        sanitized[sanitizedKey] = value;
      } else if (Array.isArray(value)) {
        // Convert arrays to comma-separated strings, but limit length
        const joinedValue = value.join(", ").substring(0, 500);
        sanitized[sanitizedKey] = joinedValue;
      } else if (typeof value === "object") {
        // Convert objects to JSON strings, but limit length
        try {
          const jsonValue = JSON.stringify(value).substring(0, 500);
          sanitized[sanitizedKey] = jsonValue;
        } catch {
          sanitized[sanitizedKey] = "[object]"; // Fallback for non-serializable objects
        }
      } else {
        // Convert everything else to string with length limit
        sanitized[sanitizedKey] = String(value).substring(0, 500);
      }
    }

    return sanitized;
  }

  async close(): Promise<void> {
    if (this.client) {
      // ChromaDB doesn't require explicit closing
      this.client = null;
      this.collection = null;
      this.isInitialized = false;
      this.initializationAttempted = false;
      this.lastInitializationAttempt = 0;
      logger.info("[VECTOR_DB] Closed database connection");
    }
  }

  /**
   * Force reinitialize the database (bypasses cooldown)
   * Useful for retry attempts when cloud connection is restored
   */
  async forceReinitialize(): Promise<void> {
    logger.info("[VECTOR_DB] Forcing database reinitialization...");
    this.isInitialized = false;
    this.initializationAttempted = false;
    this.lastInitializationAttempt = 0;
    this.client = null;
    this.collection = null;
    await this.initialize();
  }

  /**
   * Test what collections are available and accessible with current API key
   */
  async testCloudAccess(): Promise<void> {
    await this.ensureInitialized();

    if (!this.client) {
      logger.warn("[VECTOR_DB] No client available for cloud access test");
      return;
    }

    try {
      logger.info("[VECTOR_DB] Testing cloud ChromaDB access...");

      // Test heartbeat
      await this.client.heartbeat();
      logger.info(
        "[VECTOR_DB] ✓ Heartbeat successful - server connection working"
      );

      // Try to list collections
      try {
        const collections = await this.client.listCollections();
        logger.info(
          `[VECTOR_DB] ✓ Collection listing successful - found ${collections.length} collections:`
        );
        collections.forEach((collection, index) => {
          logger.info(
            `[VECTOR_DB]   ${index + 1}. ${collection.name} (${
              collection.metadata
                ? JSON.stringify(collection.metadata)
                : "no metadata"
            })`
          );
        });

        // Check if our documentation collection exists
        const docCollection = collections.find(
          (c) => c.name === this.collectionName
        );
        if (docCollection) {
          logger.info(
            `[VECTOR_DB] ✓ Documentation collection '${this.collectionName}' exists in cloud`
          );

          // Try to access it
          try {
            const {
              DefaultEmbeddingFunction,
            } = require("@chroma-core/default-embed");
            const embeddingFunction = new DefaultEmbeddingFunction();

            this.collection = await this.client.getCollection({
              name: this.collectionName,
              embeddingFunction,
            });
            logger.info(
              "[VECTOR_DB] ✓ Successfully connected to existing documentation collection"
            );

            // Try to get collection count
            try {
              const count = await this.collection.count();
              logger.info(
                `[VECTOR_DB] ✓ Collection contains ${count} documents`
              );
            } catch (countError) {
              logger.warn(
                "[VECTOR_DB] ⚠ Could not get collection count:",
                countError
              );
            }
          } catch (getError) {
            logger.warn(
              "[VECTOR_DB] ⚠ Could not access documentation collection:",
              getError
            );
          }
        } else {
          logger.info(
            `[VECTOR_DB] ⚠ Documentation collection '${this.collectionName}' does not exist in cloud`
          );
          logger.info(
            "[VECTOR_DB] Available collections:",
            collections.map((c) => c.name).join(", ")
          );
        }
      } catch (listError) {
        const listErrorMessage =
          listError instanceof Error ? listError.message : String(listError);
        if (
          listErrorMessage.toLowerCase().includes("unauthorized") ||
          listErrorMessage.toLowerCase().includes("permission")
        ) {
          logger.warn(
            "[VECTOR_DB] ⚠ API key does not have permission to list collections"
          );
          logger.info(
            "[VECTOR_DB] Attempting to access documentation collection directly..."
          );

          // Try to access our collection directly
          try {
            const {
              DefaultEmbeddingFunction,
            } = require("@chroma-core/default-embed");
            const embeddingFunction = new DefaultEmbeddingFunction();

            this.collection = await this.client.getCollection({
              name: this.collectionName,
              embeddingFunction,
            });
            logger.info(
              "[VECTOR_DB] ✓ Successfully accessed documentation collection directly"
            );

            try {
              const count = await this.collection.count();
              logger.info(
                `[VECTOR_DB] ✓ Collection contains ${count} documents`
              );
            } catch (countError) {
              logger.warn(
                "[VECTOR_DB] ⚠ Could not get collection count:",
                countError
              );
            }
          } catch (directAccessError) {
            logger.warn(
              "[VECTOR_DB] ⚠ Could not access documentation collection directly:",
              directAccessError
            );
          }
        } else {
          logger.error("[VECTOR_DB] ✗ Failed to list collections:", listError);
        }
      }
    } catch (testError) {
      logger.error("[VECTOR_DB] ✗ Cloud access test failed:", testError);
    }
  }
}
