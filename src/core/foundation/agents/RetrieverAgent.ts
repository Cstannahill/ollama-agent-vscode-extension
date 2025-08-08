/**
 * Retriever Agent - BGE, E5, GTE style semantic search and retrieval
 * 
 * Handles context retrieval with positive/negative examples and semantic search.
 * Integrates with the existing context system and vector database.
 */

import { logger } from "../../../utils/logger";
import { OllamaLLM } from "../../../api/ollama";
import { ContextManager } from "../../ContextManager";
import { VectorDatabase } from "../../../documentation/VectorDatabase";
import { robustJSON } from "../../../utils/RobustJSONParser";
import {
  IRetrieverAgent,
  RetrievalResult,
  FoundationAgentConfig
} from "../IFoundationAgent";

export class RetrieverAgent implements IRetrieverAgent {
  public readonly name = "RetrieverAgent";
  public readonly modelSize = "0.1-1B";

  private llm: OllamaLLM;
  private contextManager?: ContextManager;
  private vectorDB?: VectorDatabase;
  private initialized = false;
  private config: FoundationAgentConfig;

  constructor(
    ollamaUrl: string,
    model: string,
    contextManager?: ContextManager,
    vectorDB?: VectorDatabase,
    config?: Partial<FoundationAgentConfig>
  ) {
    this.config = {
      modelSize: '0.1-1B',
      temperature: 0.1,
      maxTokens: 2000,
      timeout: 15000,
      ...config
    };

    this.llm = new OllamaLLM({
      baseUrl: ollamaUrl,
      model: model,
      temperature: this.config.temperature,
    });

    this.contextManager = contextManager;
    this.vectorDB = vectorDB;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      logger.info("[RETRIEVER_AGENT] Initializing retriever agent...");
      
      // Test LLM connection with timeout and graceful fallback
      try {
        const testResponse = await Promise.race([
          this.llm.generateText("test"),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("LLM test timeout")), 5000)
          )
        ]);
        logger.debug("[RETRIEVER_AGENT] LLM connection test successful");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 
          (typeof error === 'object' && error !== null) ? JSON.stringify(error) : String(error);
        logger.warn(`[RETRIEVER_AGENT] LLM test failed, continuing with degraded functionality: ${errorMessage}`);
        // Don't throw here - allow the agent to initialize with limited functionality
      }
      
      // Initialize vector database if available
      if (this.vectorDB) {
        try {
          await this.vectorDB.initialize();
          logger.debug("[RETRIEVER_AGENT] Vector DB initialized successfully");
        } catch (error) {
          logger.warn("[RETRIEVER_AGENT] Vector DB initialization failed:", error);
        }
      }
      
      this.initialized = true;
      logger.info("[RETRIEVER_AGENT] Retriever agent initialized successfully");
    } catch (error) {
      logger.error("[RETRIEVER_AGENT] Failed to initialize:", error);
      // Still mark as initialized to prevent blocking the pipeline
      this.initialized = true;
      logger.warn("[RETRIEVER_AGENT] Marked as initialized with degraded functionality");
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCapabilities(): string[] {
    return [
      "Semantic content retrieval",
      "Context-aware search",
      "Positive/negative example learning",
      "Multi-source content aggregation",
      "Relevance-based ranking",
      "Code and documentation search"
    ];
  }

  /**
   * Retrieve content using query with optional positive/negative examples
   */
  async retrieve(
    query: string,
    positiveExamples?: string[],
    negativeExamples?: string[]
  ): Promise<RetrievalResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`[RETRIEVER_AGENT] Retrieving content for: ${query.substring(0, 100)}...`);

      const results: RetrievalResult[] = [];

      // 1. Context-based retrieval
      if (this.contextManager) {
        const contextResults = await this.retrieveFromContext(query);
        results.push(...contextResults);
      }

      // 2. Vector database retrieval
      if (this.vectorDB) {
        const vectorResults = await this.retrieveFromVectorDB(query);
        results.push(...vectorResults);
      }

      // 3. Enhanced retrieval with examples
      if (positiveExamples || negativeExamples) {
        const enhancedResults = await this.retrieveWithExamples(
          query,
          positiveExamples || [],
          negativeExamples || [],
          results
        );
        results.push(...enhancedResults);
      }

      // 4. Deduplicate and rank results
      const uniqueResults = this.deduplicateResults(results);
      const rankedResults = await this.rankResults(query, uniqueResults);

      logger.debug(`[RETRIEVER_AGENT] Retrieved ${rankedResults.length} unique results`);
      return rankedResults;

    } catch (error) {
      logger.error("[RETRIEVER_AGENT] Retrieval failed:", error);
      return [];
    }
  }

  /**
   * Retrieve content with specific context type
   */
  async retrieveWithContext(
    query: string,
    contextType: 'code' | 'docs' | 'conversation',
    limit: number = 10
  ): Promise<RetrievalResult[]> {
    try {
      const results = await this.retrieve(query);
      
      // Filter by context type
      const filteredResults = results.filter(result => {
        switch (contextType) {
          case 'code':
            return result.metadata.type === 'code' || result.source.includes('.ts') || result.source.includes('.js');
          case 'docs':
            return result.metadata.type === 'docs' || result.source.includes('.md') || result.source.includes('README');
          case 'conversation':
            return result.metadata.type === 'context' || result.metadata.type === 'memory';
          default:
            return true;
        }
      });

      return filteredResults.slice(0, limit);
    } catch (error) {
      logger.error("[RETRIEVER_AGENT] Context retrieval failed:", error);
      return [];
    }
  }

  /**
   * Retrieve from context manager
   */
  private async retrieveFromContext(query: string): Promise<RetrievalResult[]> {
    if (!this.contextManager) return [];

    try {
      const contextResult = await this.contextManager.searchContext({
        query: query,
        maxResults: 20
      });

      return contextResult.items.map((item, index) => ({
        content: item.content || '',
        score: item.relevanceScore || (1.0 - index * 0.05), // Decreasing score
        source: `context:${item.source}`,
        metadata: {
          type: 'context' as const,
          filePath: item.metadata?.filePath,
          lineNumber: item.metadata?.lineNumber,
          chunkId: item.id
        }
      }));
    } catch (error) {
      logger.warn("[RETRIEVER_AGENT] Context retrieval failed:", error);
      return [];
    }
  }

  /**
   * Retrieve from vector database
   */
  private async retrieveFromVectorDB(query: string): Promise<RetrievalResult[]> {
    if (!this.vectorDB) return [];

    try {
      const vectorResults = await this.vectorDB.search(query, {
        limit: 15,
        threshold: 0.3
      });

      return vectorResults.map(result => ({
        content: result.document.content,
        score: result.score,
        source: `vector:${result.document.metadata.source}`,
        metadata: {
          type: 'docs' as const,
          filePath: result.document.metadata.url,
          chunkId: result.document.id
        }
      }));
    } catch (error) {
      logger.warn("[RETRIEVER_AGENT] Vector database retrieval failed:", error);
      return [];
    }
  }

  /**
   * Enhanced retrieval using positive/negative examples
   */
  private async retrieveWithExamples(
    query: string,
    positiveExamples: string[],
    negativeExamples: string[],
    existingResults: RetrievalResult[]
  ): Promise<RetrievalResult[]> {
    try {
      // Generate enhanced search query using examples
      const enhancedQuery = await this.generateEnhancedQuery(
        query,
        positiveExamples,
        negativeExamples
      );

      if (!enhancedQuery || enhancedQuery === query) {
        return []; // No enhancement possible
      }

      // Search with enhanced query
      const enhancedResults: RetrievalResult[] = [];
      
      if (this.contextManager) {
        const contextResults = await this.retrieveFromContext(enhancedQuery);
        enhancedResults.push(...contextResults);
      }

      if (this.vectorDB) {
        const vectorResults = await this.retrieveFromVectorDB(enhancedQuery);
        enhancedResults.push(...vectorResults);
      }

      // Score results based on similarity to positive examples
      return await this.scoreWithExamples(
        enhancedResults,
        positiveExamples,
        negativeExamples
      );

    } catch (error) {
      logger.warn("[RETRIEVER_AGENT] Example-based retrieval failed:", error);
      return [];
    }
  }

  /**
   * Generate enhanced query using examples
   */
  private async generateEnhancedQuery(
    originalQuery: string,
    positiveExamples: string[],
    negativeExamples: string[]
  ): Promise<string> {
    const prompt = `You are a query enhancement expert. Given an original query and examples of what the user wants (positive) and doesn't want (negative), create an enhanced search query.

Original Query: "${originalQuery}"

Positive Examples (what the user wants):
${positiveExamples.map((ex, i) => `${i + 1}. ${ex}`).join('\n')}

Negative Examples (what the user doesn't want):
${negativeExamples.map((ex, i) => `${i + 1}. ${ex}`).join('\n')}

Generate an enhanced query that captures the intent better. Focus on keywords and concepts from positive examples while avoiding negative ones.

Respond with only the enhanced query, no explanation:`;

    try {
      const response = await this.llm.generateText(prompt);

      return response.trim() || originalQuery;
    } catch (error) {
      logger.warn("[RETRIEVER_AGENT] Query enhancement failed:", error);
      return originalQuery;
    }
  }

  /**
   * Score results based on positive/negative examples
   */
  private async scoreWithExamples(
    results: RetrievalResult[],
    positiveExamples: string[],
    negativeExamples: string[]
  ): Promise<RetrievalResult[]> {
    const scoredResults = await Promise.all(
      results.map(async (result) => {
        try {
          // Calculate similarity to positive examples
          const positiveScore = await this.calculateExampleSimilarity(
            result.content,
            positiveExamples
          );

          // Calculate similarity to negative examples
          const negativeScore = await this.calculateExampleSimilarity(
            result.content,
            negativeExamples
          );

          // Adjust score: boost for positive similarity, penalize for negative
          const adjustedScore = result.score + (positiveScore * 0.3) - (negativeScore * 0.2);

          return {
            ...result,
            score: Math.max(0, Math.min(1, adjustedScore))
          };
        } catch (error) {
          logger.warn("[RETRIEVER_AGENT] Example scoring failed for result:", error);
          return result;
        }
      })
    );

    return scoredResults.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate similarity between content and examples using LLM
   */
  private async calculateExampleSimilarity(
    content: string,
    examples: string[]
  ): Promise<number> {
    if (examples.length === 0) return 0;

    const prompt = `Rate the similarity between the content and the examples on a scale of 0.0 to 1.0.

Content: "${content.substring(0, 500)}..."

Examples:
${examples.map((ex, i) => `${i + 1}. ${ex}`).join('\n')}

Consider semantic similarity, topic relevance, and conceptual overlap.
Respond with only a number between 0.0 and 1.0:`;

    try {
      const response = await this.llm.generateText(prompt);

      const score = parseFloat(response.trim());
      return isNaN(score) ? 0 : Math.max(0, Math.min(1, score));
    } catch (error) {
      return 0;
    }
  }

  /**
   * Remove duplicate results based on content similarity
   */
  private deduplicateResults(results: RetrievalResult[]): RetrievalResult[] {
    const unique: RetrievalResult[] = [];
    const seenContent = new Set<string>();

    for (const result of results) {
      // Create a normalized version for comparison
      const normalized = result.content.toLowerCase().replace(/\s+/g, ' ').trim();
      const contentHash = this.simpleHash(normalized);

      if (!seenContent.has(contentHash)) {
        seenContent.add(contentHash);
        unique.push(result);
      }
    }

    return unique;
  }

  /**
   * Rank results by relevance and quality
   */
  private async rankResults(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]> {
    // Sort by score (descending) and add position-based decay
    return results
      .sort((a, b) => b.score - a.score)
      .map((result, index) => ({
        ...result,
        score: result.score * (1 - index * 0.01) // Small decay for position
      }))
      .filter(result => result.score > 0.1) // Filter out very low scores
      .slice(0, 50); // Limit total results
  }

  /**
   * Simple hash function for content deduplication
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }
}