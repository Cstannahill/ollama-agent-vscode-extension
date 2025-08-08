import { ChromaClient, Collection, IncludeEnum } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import * as path from "path";
import * as fs from "fs/promises";
import * as vscode from "vscode";
import { logger } from "../utils/logger";
import { extensionContextProvider } from "../utils/ExtensionContextProvider";

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
 * Uses ChromaDB for local, persistent vector storage
 */
export class VectorDatabase {
  private static instance: VectorDatabase;
  private client: ChromaClient | null = null;
  private collection: Collection | null = null;
  private readonly collectionName = "documentation";
  private readonly dbPath: string;
  private isInitialized = false;

  private constructor() {
    this.dbPath = this.getDatabasePath();
  }

  static getInstance(): VectorDatabase {
    if (!VectorDatabase.instance) {
      VectorDatabase.instance = new VectorDatabase();
    }
    return VectorDatabase.instance;
  }

  private getDatabasePath(): string {
    // Use global storage path which is guaranteed to be writable
    // Falls back to user's home directory if context is not available
    try {
      const globalStoragePath = extensionContextProvider.getGlobalStoragePath();
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

      logger.info("[VECTOR_DB] Initializing ChromaDB...");
      logger.debug(`[VECTOR_DB] Database path: ${this.dbPath}`);

      // Check if ChromaDB is available
      try {
        const ChromaClient = require("chromadb").ChromaClient;
        logger.debug("[VECTOR_DB] ChromaDB package found");
      } catch (error) {
        logger.error(
          "[VECTOR_DB] ChromaDB package not found or not installed:",
          error
        );
        throw new Error(
          "ChromaDB package not found. Please install chromadb package."
        );
      }

      // Ensure database directory exists
      try {
        await fs.mkdir(this.dbPath, { recursive: true });
        logger.debug(`[VECTOR_DB] Created database directory: ${this.dbPath}`);
      } catch (error) {
        logger.error(
          `[VECTOR_DB] Failed to create database directory: ${this.dbPath}`,
          error
        );
        throw new Error(`Failed to create database directory: ${error}`);
      }

      // Initialize ChromaDB client (v3.0+ uses HTTP client)
      try {
        // Try different initialization approaches for ChromaDB 3.0+
        this.client = new ChromaClient();

        // Test the connection
        await this.client.heartbeat();
        logger.debug(
          "[VECTOR_DB] ChromaDB client created and server is reachable"
        );
      } catch (error) {
        logger.warn(
          "[VECTOR_DB] ChromaDB server not available, falling back to no-op mode:",
          error
        );
        // Don't throw error, just log warning and continue with degraded functionality
        this.client = null;
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

      // Get or create collection
      try {
        this.collection = await this.client.getCollection({
          name: this.collectionName,
          embeddingFunction,
        });
        logger.info("[VECTOR_DB] Connected to existing collection");
      } catch (error) {
        logger.debug(
          "[VECTOR_DB] Collection doesn't exist, creating new one:",
          error
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

      // Set a flag to indicate ChromaDB is not available
      this.isInitialized = false;
      throw new Error(`Failed to initialize vector database: ${errorMessage}`);
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
          logger.error(
            `[VECTOR_DB] Failed to add batch ${
              Math.ceil(i / batchSize) + 1
            }/${Math.ceil(validDocuments.length / batchSize)}:`,
            batchError
          );

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

          throw batchError; // Re-throw non-ChromaValueError errors
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
      try {
        await this.initialize();
      } catch (error) {
        logger.warn(
          "[VECTOR_DB] ChromaDB not available, falling back to no-op mode"
        );
        // Don't throw error, just log warning and continue with degraded functionality
      }
    }
  }

  private isAvailable(): boolean {
    return (
      this.isInitialized && this.client !== null && this.collection !== null
    );
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
      logger.info("[VECTOR_DB] Closed database connection");
    }
  }
}
