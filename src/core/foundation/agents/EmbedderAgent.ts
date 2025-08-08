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
  FoundationAgentConfig
} from "../IFoundationAgent";

export class EmbedderAgent implements IEmbedderAgent {
  public readonly name = "EmbedderAgent";
  public readonly modelSize = "0.1-1B";

  private llm: OllamaLLM;
  private initialized = false;
  private config: FoundationAgentConfig;
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(
    ollamaUrl: string,
    model: string,
    config?: Partial<FoundationAgentConfig>
  ) {
    this.config = {
      modelSize: '0.1-1B',
      temperature: 0.0, // No randomness for embeddings
      maxTokens: 1, // Embeddings don't need text generation
      timeout: 10000,
      ...config
    };

    this.llm = new OllamaLLM({
      baseUrl: ollamaUrl,
      model: model,
      temperature: this.config.temperature,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      logger.info("[EMBEDDER_AGENT] Initializing embedder agent...");
      
      // Test embedding generation with timeout protection
      try {
        const testEmbedding = await Promise.race([
          this.generateSimulatedEmbedding("test initialization text"),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Embedding test timeout")), 5000)
          )
        ]);
        
        if (testEmbedding && Array.isArray(testEmbedding) && testEmbedding.length > 0) {
          logger.debug(`[EMBEDDER_AGENT] Embedding test successful (${testEmbedding.length} dimensions)`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 
          (typeof error === 'object' && error !== null) ? JSON.stringify(error) : String(error);
        logger.warn(`[EMBEDDER_AGENT] Embedding test failed, continuing with fallback functionality: ${errorMessage}`);
        // Don't throw here - allow the agent to initialize with fallback embedding
      }
      
      this.initialized = true;
      logger.info("[EMBEDDER_AGENT] Embedder agent initialized successfully");
    } catch (error) {
      logger.error("[EMBEDDER_AGENT] Failed to initialize:", error);
      // Still mark as initialized to prevent blocking the pipeline
      this.initialized = true;
      logger.warn("[EMBEDDER_AGENT] Marked as initialized with degraded functionality");
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
      "Efficient caching and retrieval"
    ];
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Check cache first
    const cacheKey = this.getCacheKey(text);
    if (this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey)!;
    }

    try {
      logger.debug(`[EMBEDDER_AGENT] Generating embedding for text: ${text.substring(0, 50)}...`);

      // Note: Ollama doesn't have native embedding endpoints in the current API
      // This is a simulation using text similarity. In production, you would:
      // 1. Use a dedicated embedding model via Ollama embeddings API when available
      // 2. Use an external embedding service (OpenAI, Cohere, etc.)
      // 3. Use a local embedding model (sentence-transformers, etc.)
      
      const embedding = await this.generateSimulatedEmbedding(text);
      
      // Cache the result
      this.embeddingCache.set(cacheKey, embedding);
      
      logger.debug(`[EMBEDDER_AGENT] Generated ${embedding.length}-dimensional embedding`);
      return embedding;

    } catch (error) {
      logger.error("[EMBEDDER_AGENT] Embedding generation failed:", error);
      
      // Fallback: generate a simple hash-based pseudo-embedding
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
      logger.debug(`[EMBEDDER_AGENT] Generating batch embeddings for ${texts.length} texts`);

      const embeddings = await Promise.all(
        texts.map(async (text) => {
          try {
            return await this.embed(text);
          } catch (error) {
            logger.warn(`[EMBEDDER_AGENT] Failed to embed text: ${text.substring(0, 30)}...`, error);
            return this.generateFallbackEmbedding(text);
          }
        })
      );

      logger.debug(`[EMBEDDER_AGENT] Generated ${embeddings.length} batch embeddings`);
      return embeddings;

    } catch (error) {
      logger.error("[EMBEDDER_AGENT] Batch embedding generation failed:", error);
      
      // Fallback: generate simple embeddings for all texts
      return texts.map(text => this.generateFallbackEmbedding(text));
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
              embeddingDimension: embedding.length
            }
          });
        }
      });

      // Sort by similarity (descending)
      results.sort((a, b) => b.similarity - a.similarity);

      logger.debug(`[EMBEDDER_AGENT] Found ${results.length} similar embeddings above threshold ${threshold}`);
      return results;

    } catch (error) {
      logger.error("[EMBEDDER_AGENT] Similar embedding search failed:", error);
      return [];
    }
  }

  /**
   * Generate embedding using Ollama's embedding API
   * Falls back to simulated embedding if the model doesn't support embeddings
   */
  private async generateSimulatedEmbedding(text: string): Promise<number[]> {
    try {
      // First, try to use the proper embedding API
      if (this.llm.generateEmbedding) {
        try {
          return await this.llm.generateEmbedding(text);
        } catch (error) {
          logger.debug("[EMBEDDER_AGENT] Embedding API failed, falling back to simulation:", error);
        }
      }

      // Fallback: Use LLM to analyze text characteristics and generate a pseudo-embedding
      const analysisPrompt = `Analyze this text and provide numeric scores (0.0-1.0) for these dimensions:
1. Technical content level
2. Positive sentiment
3. Complexity level  
4. Specificity level
5. Action orientation
6. Question/query nature
7. Code-related content
8. Problem-solving focus

Text: "${text.substring(0, 200)}..."

Respond with 8 numbers between 0.0 and 1.0, separated by commas:`;

      const response = await this.llm.generateText(analysisPrompt);

      // Extract numbers from response
      const numbers = response.match(/(\d+\.?\d*)/g);
      if (numbers && numbers.length >= 8) {
        const embedding = numbers.slice(0, 8).map(n => parseFloat(n));
        
        // Extend to higher dimensions with derived features
        const extendedEmbedding = this.extendEmbedding(embedding, text);
        return this.normalizeEmbedding(extendedEmbedding);
      }

      // Fallback if parsing fails
      return this.generateFallbackEmbedding(text);

    } catch (error) {
      logger.warn("[EMBEDDER_AGENT] Simulated embedding generation failed:", error);
      return this.generateFallbackEmbedding(text);
    }
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
    const codeIndicators = ['{', '}', '(', ')', ';', '=', 'function', 'class', 'import'];
    const codeScore = codeIndicators.filter(indicator => text.includes(indicator)).length / codeIndicators.length;
    embedding.push(codeScore);
    
    // Question indicators
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'which', '?'];
    const questionScore = questionWords.filter(word => text.toLowerCase().includes(word)).length / questionWords.length;
    embedding.push(questionScore);
    
    // Technical content
    const techWords = ['api', 'function', 'method', 'class', 'variable', 'error', 'debug', 'test'];
    const techScore = techWords.filter(word => text.toLowerCase().includes(word)).length / techWords.length;
    embedding.push(techScore);
    
    // Action words
    const actionWords = ['create', 'build', 'make', 'implement', 'fix', 'solve', 'add', 'update'];
    const actionScore = actionWords.filter(word => text.toLowerCase().includes(word)).length / actionWords.length;
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
    
    return embedding.map(val => val / norm);
  }

  /**
   * Generate simple hash from text
   */
  private simpleHash(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
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
  getCacheStats(): { size: number; hitRate?: number } {
    return {
      size: this.embeddingCache.size
    };
  }
}