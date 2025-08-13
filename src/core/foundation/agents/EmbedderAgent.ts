/**
 * Embedder Agent - Vector operations and similarity calculations
 *
 * Implements text embedding generation and vector similarity operations
 * for semantic search and content matching.
 */

import { logger } from "../../../utils/logger";
import { OllamaLLM } from "../../../api/ollama";
import {
  IEmbedderAgent,
  SimilarityResult,
  FoundationAgentConfig,
} from "../IFoundationAgent";
import { CacheManager, SmartCache } from "../../cache/CacheManager";

export class EmbedderAgent implements IEmbedderAgent {
  /**
   * Set initialized state (for cache restoration)
   */
  setInitialized(state: boolean): void {
    this.initialized = state;
  }
  public readonly name = "EmbedderAgent";
  public readonly modelSize = "0.1-1B";
  
  // Emergency circuit breaker for infinite initialization loops
  private static initializationCount = 0;
  private static readonly MAX_INITIALIZATION_ATTEMPTS = 10; // Reduced from 50
  
  /**
   * Reset initialization counter (for testing/cleanup)
   */
  public static resetInitializationCount(): void {
    EmbedderAgent.initializationCount = 0;
  }

  private llm: OllamaLLM;
  private initialized = false;
  private config: FoundationAgentConfig;
  private embeddingCache: SmartCache<number[]>;
  private cacheManager: CacheManager;
  private readonly maxCacheSize: number;

  constructor(
    ollamaUrl: string,
    model: string,
    config?: Partial<FoundationAgentConfig>
  ) {
    // Log constructor calls to track instance creation
    const stack = new Error().stack;
    const callerInfo = stack?.split('\n')[2]?.trim() || 'unknown caller';
    logger.info(`[EMBEDDER_AGENT] NEW INSTANCE created for model: ${model} (${ollamaUrl})`);
    logger.debug(`[EMBEDDER_AGENT] Constructor called from: ${callerInfo}`);
    
    this.config = {
      modelSize: "0.1-1B",
      temperature: 0.0, // No randomness for embeddings
      maxTokens: 1, // Embeddings don't need text generation
      timeout: config?.timeout ?? 10000,
      ...config,
    };

    this.llm = new OllamaLLM({
      baseUrl: ollamaUrl,
      model: model,
      temperature: this.config.temperature,
    });
    this.maxCacheSize = config?.maxCacheSize ?? 5000;
    
    // Initialize smart caching system
    this.cacheManager = CacheManager.getInstance();
    this.embeddingCache = this.cacheManager.getCache(`embeddings_${model}`, {
      maxSize: this.maxCacheSize,
      maxMemoryMB: 100, // 100MB for embeddings
      defaultTTLMs: 3600000, // 1 hour TTL for embeddings
      enableLRU: true,
      enableStats: true,
      cleanupIntervalMs: 300000 // 5 minutes cleanup
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      // Idempotent: skip all logging and logic if already initialized
      return;
    }
    
    // Emergency circuit breaker: prevent infinite initialization loops
    if (EmbedderAgent.initializationCount > EmbedderAgent.MAX_INITIALIZATION_ATTEMPTS) {
      const stack = new Error().stack;
      logger.error(`[EMBEDDER_AGENT] EMERGENCY: Infinite initialization loop detected! Attempt #${EmbedderAgent.initializationCount}`);
      logger.error(`[EMBEDDER_AGENT] Stack trace: ${stack}`);
      logger.error("[EMBEDDER_AGENT] Stopping initialization to prevent system hang.");
      this.initialized = true; // Force initialized to break the loop
      return;
    }
    
    EmbedderAgent.initializationCount++;
    
    // Detailed logging to track initialization calls
    const stack = new Error().stack;
    const callerInfo = stack?.split('\n')[3]?.trim() || 'unknown caller';
    logger.info(`[EMBEDDER_AGENT] Initializing embedder agent... (attempt #${EmbedderAgent.initializationCount})`);
    logger.debug(`[EMBEDDER_AGENT] Called from: ${callerInfo}`);
    
    try {
      // Test deterministic embedding generation (no API calls)
      try {
        const testEmbedding = this.generateDeterministicEmbedding("test initialization text");
        if (testEmbedding && Array.isArray(testEmbedding) && testEmbedding.length > 0) {
          logger.debug(
            `[EMBEDDER_AGENT] Deterministic embedding test successful (${testEmbedding.length} dimensions)`
          );
        }
      } catch (error) {
        logger.warn(
          `[EMBEDDER_AGENT] Deterministic embedding test failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      // Pre-warm cache with common texts
      const commonTexts = [
        "project",
        "agent",
        "context",
        "test",
        "initialize",
        "embedding",
        "cache",
        "memory",
        "performance",
        "optimization",
      ];
      for (const text of commonTexts) {
        try {
          // Call generateEmbedding directly to avoid infinite loop
          await this.generateEmbedding(text);
        } catch {}
      }
      this.initialized = true;
      logger.info(`[EMBEDDER_AGENT] Embedder agent initialized successfully (attempt #${EmbedderAgent.initializationCount})`);
    } catch (error) {
      logger.error("[EMBEDDER_AGENT] Failed to initialize:", error);
      this.initialized = true;
      logger.warn(
        "[EMBEDDER_AGENT] Marked as initialized with degraded functionality"
      );
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCapabilities(): string[] {
    return [
      "Text embedding generation",
      "Semantic similarity calculation",
      "Batch embedding processing",
      "Vector space operations",
      "Similarity threshold filtering",
      "Efficient caching and retrieval",
    ];
  }

  /**
   * Generate embedding for a single text (smart cached)
   */
  async embed(text: string): Promise<number[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const cacheKey = this.getCacheKey(text);
    
    // Use smart cache with automatic LRU and TTL management
    return await this.embeddingCache.getOrCompute(cacheKey, async () => {
      return await this.generateEmbedding(text);
    });
  }

  /**
   * Generate embedding without caching (internal method)
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      logger.debug(
        `[EMBEDDER_AGENT] Generating embedding for text: ${text.substring(
          0,
          50
        )}...`
      );
      const embedding = await this.generateSimulatedEmbedding(text);
      logger.debug(
        `[EMBEDDER_AGENT] Generated ${embedding.length}-dimensional embedding`
      );
      return embedding;
    } catch (error) {
      logger.error("[EMBEDDER_AGENT] Embedding generation failed:", error);
      return this.generateFallbackEmbedding(text);
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(
        `[EMBEDDER_AGENT] Generating batch embeddings for ${texts.length} texts`
      );

      const embeddings = await Promise.all(
        texts.map(async (text) => {
          try {
            return await this.embed(text);
          } catch (error) {
            logger.warn(
              `[EMBEDDER_AGENT] Failed to embed text: ${text.substring(
                0,
                30
              )}...`,
              error
            );
            return this.generateFallbackEmbedding(text);
          }
        })
      );

      logger.debug(
        `[EMBEDDER_AGENT] Generated ${embeddings.length} batch embeddings`
      );
      return embeddings;
    } catch (error) {
      logger.error(
        "[EMBEDDER_AGENT] Batch embedding generation failed:",
        error
      );

      // Fallback: generate simple embeddings for all texts
      return texts.map((text) => this.generateFallbackEmbedding(text));
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  similarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      logger.warn("[EMBEDDER_AGENT] Embedding dimension mismatch");
      return 0;
    }

    try {
      // Cosine similarity calculation
      let dotProduct = 0;
      let norm1 = 0;
      let norm2 = 0;

      for (let i = 0; i < embedding1.length; i++) {
        dotProduct += embedding1[i] * embedding2[i];
        norm1 += embedding1[i] * embedding1[i];
        norm2 += embedding2[i] * embedding2[i];
      }

      if (norm1 === 0 || norm2 === 0) {
        return 0;
      }

      const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
      return Math.max(-1, Math.min(1, similarity)); // Clamp to [-1, 1]
    } catch (error) {
      logger.error("[EMBEDDER_AGENT] Similarity calculation failed:", error);
      return 0;
    }
  }

  /**
   * Find similar embeddings above threshold
   */
  findSimilar(
    query: number[],
    embeddings: number[][],
    threshold: number = 0.5
  ): SimilarityResult[] {
    try {
      const results: SimilarityResult[] = [];

      embeddings.forEach((embedding, index) => {
        const similarityScore = this.similarity(query, embedding);

        if (similarityScore >= threshold) {
          results.push({
            index,
            similarity: similarityScore,
            metadata: {
              threshold,
              embeddingDimension: embedding.length,
            },
          });
        }
      });

      // Sort by similarity (descending)
      results.sort((a, b) => b.similarity - a.similarity);

      logger.debug(
        `[EMBEDDER_AGENT] Found ${results.length} similar embeddings above threshold ${threshold}`
      );
      return results;
    } catch (error) {
      logger.error("[EMBEDDER_AGENT] Similar embedding search failed:", error);
      return [];
    }
  }

  /**
   * Generate embedding using proper embedding methods
   * No text generation fallbacks - embeddings only!
   */
  private async generateSimulatedEmbedding(text: string): Promise<number[]> {
    try {
      // First, try to use the proper embedding API
      if (this.llm.generateEmbedding) {
        try {
          return await this.llm.generateEmbedding(text);
        } catch (error) {
          logger.debug(
            "[EMBEDDER_AGENT] Embedding API failed, using deterministic fallback:",
            error
          );
        }
      }

      // IMPORTANT: No text generation here! Generate embedding deterministically
      logger.debug("[EMBEDDER_AGENT] Using deterministic embedding generation for:", text.substring(0, 50));
      return this.generateDeterministicEmbedding(text);
      
    } catch (error) {
      logger.warn(
        "[EMBEDDER_AGENT] Embedding generation failed:",
        error
      );
      return this.generateFallbackEmbedding(text);
    }
  }

  /**
   * Generate deterministic embedding based on text features
   * This replaces the incorrect text generation approach
   */
  private generateDeterministicEmbedding(text: string): number[] {
    const features = this.extractTextFeatures(text);
    const embedding = this.extendEmbedding(features, text);
    return this.normalizeEmbedding(embedding);
  }

  /**
   * Extract numerical features from text without using LLM text generation
   */
  private extractTextFeatures(text: string): number[] {
    const lowerText = text.toLowerCase();
    const chars = text.length;
    
    return [
      // Technical content indicators (0-1 scale)
      Math.min(1, (lowerText.match(/\b(function|class|method|api|code|programming|software|development|algorithm|database|server|client|http|json|xml|javascript|python|typescript|java|react|node|git|sql|html|css)\b/g)?.length || 0) / 10),
      
      // Sentiment approximation (0-1 scale, 0.5 = neutral)
      0.5 + Math.max(-0.5, Math.min(0.5, ((lowerText.match(/\b(good|great|excellent|awesome|love|like|perfect|amazing|fantastic|wonderful|help|solve|fix|improve|better|success|work|easy|simple)\b/g)?.length || 0) - (lowerText.match(/\b(bad|terrible|awful|hate|broken|fail|error|problem|issue|bug|difficult|hard|impossible|wrong|slow)\b/g)?.length || 0)) / 20)),
      
      // Complexity level (0-1 scale)
      Math.min(1, chars / 1000), // Length-based complexity
      
      // Specificity level (0-1 scale)
      Math.min(1, (text.match(/\b[A-Z][a-z]+\b/g)?.length || 0) / 20), // Proper nouns
      
      // Action orientation (0-1 scale)
      Math.min(1, (lowerText.match(/\b(create|build|implement|develop|generate|make|write|add|update|delete|remove|fix|solve|execute|run|start|stop|install|configure|setup|deploy|test|debug)\b/g)?.length || 0) / 10),
      
      // Question nature (0-1 scale)
      (text.includes('?') ? 0.8 : 0) + Math.min(0.2, (lowerText.match(/\b(what|how|why|when|where|which|who|can|could|should|would|is|are|do|does|will)\b/g)?.length || 0) / 20),
      
      // Code-related content (0-1 scale)
      Math.min(1, ((text.match(/[{}();]/g)?.length || 0) + (text.match(/\b(const|let|var|function|class|import|export|return|if|else|for|while|switch|case|try|catch)\b/g)?.length || 0)) / 30),
      
      // Problem-solving focus (0-1 scale)
      Math.min(1, (lowerText.match(/\b(solve|fix|debug|troubleshoot|resolve|analyze|investigate|diagnose|repair|correct|address|handle)\b/g)?.length || 0) / 10)
    ];
  }

  /**
   * Generate fallback embedding using text characteristics
   */
  private generateFallbackEmbedding(text: string): number[] {
    const embedding: number[] = [];

    // Text length feature
    embedding.push(Math.min(1.0, text.length / 1000));

    // Word count feature
    const words = text.split(/\s+/).length;
    embedding.push(Math.min(1.0, words / 100));

    // Character diversity
    const uniqueChars = new Set(text.toLowerCase()).size;
    embedding.push(Math.min(1.0, uniqueChars / 50));

    // Code-like content
    const codeIndicators = [
      "{",
      "}",
      "(",
      ")",
      ";",
      "=",
      "function",
      "class",
      "import",
    ];
    const codeScore =
      codeIndicators.filter((indicator) => text.includes(indicator)).length /
      codeIndicators.length;
    embedding.push(codeScore);

    // Question indicators
    const questionWords = ["what", "how", "why", "when", "where", "which", "?"];
    const questionScore =
      questionWords.filter((word) => text.toLowerCase().includes(word)).length /
      questionWords.length;
    embedding.push(questionScore);

    // Technical content
    const techWords = [
      "api",
      "function",
      "method",
      "class",
      "variable",
      "error",
      "debug",
      "test",
    ];
    const techScore =
      techWords.filter((word) => text.toLowerCase().includes(word)).length /
      techWords.length;
    embedding.push(techScore);

    // Action words
    const actionWords = [
      "create",
      "build",
      "make",
      "implement",
      "fix",
      "solve",
      "add",
      "update",
    ];
    const actionScore =
      actionWords.filter((word) => text.toLowerCase().includes(word)).length /
      actionWords.length;
    embedding.push(actionScore);

    // Extend to higher dimensions with hash-based features
    return this.extendEmbedding(embedding, text);
  }

  /**
   * Extend embedding to higher dimensions
   */
  private extendEmbedding(baseEmbedding: number[], text: string): number[] {
    const extended = [...baseEmbedding];

    // Add hash-based features for higher dimensionality
    const textHash = this.simpleHash(text);
    const dimensions = 64; // Target dimension count

    while (extended.length < dimensions) {
      const index = extended.length;
      const hashFeature = ((textHash * (index + 1)) % 1000) / 1000;
      extended.push(hashFeature);
    }

    return extended.slice(0, dimensions);
  }

  /**
   * Normalize embedding to unit length
   */
  private normalizeEmbedding(embedding: number[]): number[] {
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));

    if (norm === 0) {
      return embedding.map(() => 0);
    }

    return embedding.map((val) => val / norm);
  }

  /**
   * Generate simple hash from text
   */
  private simpleHash(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Generate cache key for text
   */
  private getCacheKey(text: string): string {
    return `embed_${this.simpleHash(text)}_${text.length}`;
  }

  /**
   * Clear embedding cache
   */
  clearCache(): void {
    this.embeddingCache.clear();
    logger.debug("[EMBEDDER_AGENT] Embedding cache cleared");
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const stats = this.embeddingCache.getStats();
    return {
      size: stats.size,
      maxCacheSize: this.maxCacheSize,
      evictions: stats.evictions,
      hitRate: stats.hitRate,
      memoryUsageMB: stats.memoryUsageMB,
      hits: stats.hits,
      misses: stats.misses
    };
  }

  /**
   * Unload agent and free memory
   */
  unload(): void {
    this.embeddingCache.destroy();
    this.llm = null as any;
    this.initialized = false;
    logger.info("[EMBEDDER_AGENT] Unloaded and memory released");
  }
}
