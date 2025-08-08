/**
 * Reranker Agent - Cross-encoder style document scoring and reranking
 * 
 * Implements sophisticated document reranking using cross-encoder patterns
 * to improve the relevance ordering of retrieved content.
 */

import { logger } from "../../../utils/logger";
import { OllamaLLM } from "../../../api/ollama";
import { robustJSON } from "../../../utils/RobustJSONParser";
import {
  IRerankerAgent,
  RetrievalResult,
  RerankResult,
  FoundationAgentConfig
} from "../IFoundationAgent";

export class RerankerAgent implements IRerankerAgent {
  public readonly name = "RerankerAgent";
  public readonly modelSize = "1-3B";

  private llm: OllamaLLM;
  private initialized = false;
  private config: FoundationAgentConfig;

  constructor(
    ollamaUrl: string,
    model: string,
    config?: Partial<FoundationAgentConfig>
  ) {
    this.config = {
      modelSize: '1-3B',
      temperature: 0.05, // Very low temperature for consistent scoring
      maxTokens: 100,
      timeout: 20000,
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
      logger.info("[RERANKER_AGENT] Initializing reranker agent...");
      
      // Mark as initialized first to prevent recursive calls
      this.initialized = true;
      
      // Test LLM connection with a simple reranking task
      await this.scoreRelevance("test query", "test document");
      
      logger.info("[RERANKER_AGENT] Reranker agent initialized successfully");
    } catch (error) {
      // Reset initialization state on failure
      this.initialized = false;
      logger.error("[RERANKER_AGENT] Failed to initialize:", error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCapabilities(): string[] {
    return [
      "Cross-encoder document scoring",
      "Query-document relevance assessment",
      "Sophisticated reranking algorithms", 
      "Confidence-based scoring",
      "Multi-criteria evaluation",
      "Context-aware relevance scoring"
    ];
  }

  /**
   * Rerank documents based on query relevance using cross-encoder approach
   */
  async rerank(query: string, documents: RetrievalResult[]): Promise<RerankResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (documents.length === 0) {
      return [];
    }

    try {
      logger.debug(`[RERANKER_AGENT] Reranking ${documents.length} documents for query: ${query.substring(0, 100)}...`);

      // Process documents in batches for efficiency
      const batchSize = 5;
      const rerankResults: RerankResult[] = [];

      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        const batchResults = await this.rerankBatch(query, batch, i);
        rerankResults.push(...batchResults);
      }

      // Sort by rerank score
      const sortedResults = rerankResults.sort((a, b) => b.rerankScore - a.rerankScore);

      logger.debug(`[RERANKER_AGENT] Reranked ${sortedResults.length} documents`);
      return sortedResults;

    } catch (error) {
      logger.error("[RERANKER_AGENT] Reranking failed:", error);
      
      // Fallback: return original results with minimal reranking
      return documents.map((doc, index) => ({
        ...doc,
        originalRank: index,
        rerankScore: doc.score * 0.9, // Slight penalty for failed reranking
        confidence: 0.3
      }));
    }
  }

  /**
   * Score relevance between query and document
   */
  async scoreRelevance(query: string, document: string): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const score = await this.calculateCrossEncoderScore(query, document);
      return Math.max(0, Math.min(1, score));
    } catch (error) {
      logger.warn("[RERANKER_AGENT] Relevance scoring failed:", error);
      return 0.5; // Default score
    }
  }

  /**
   * Rerank a batch of documents
   */
  private async rerankBatch(
    query: string,
    documents: RetrievalResult[],
    startIndex: number
  ): Promise<RerankResult[]> {
    const rerankPromises = documents.map(async (doc, batchIndex) => {
      try {
        const originalRank = startIndex + batchIndex;
        
        // Calculate cross-encoder score
        const rerankScore = await this.calculateCrossEncoderScore(query, doc.content);
        
        // Calculate confidence based on score consistency
        const confidence = await this.calculateConfidence(query, doc.content, rerankScore);
        
        const rerankResult: RerankResult = {
          ...doc,
          originalRank,
          rerankScore: Math.max(0, Math.min(1, rerankScore)),
          confidence: Math.max(0, Math.min(1, confidence))
        };

        return rerankResult;
      } catch (error) {
        logger.warn(`[RERANKER_AGENT] Failed to rerank document ${startIndex + batchIndex}:`, error);
        
        // Return original document with reduced score
        return {
          ...doc,
          originalRank: startIndex + batchIndex,
          rerankScore: doc.score * 0.8,
          confidence: 0.2
        };
      }
    });

    return Promise.all(rerankPromises);
  }

  /**
   * Calculate cross-encoder style relevance score
   */
  private async calculateCrossEncoderScore(query: string, document: string): Promise<number> {
    const prompt = `You are a precise relevance scorer. Given a query and a document, score their relevance on a scale of 0.00 to 1.00.

Consider:
- Semantic similarity and topic match
- Query intent fulfillment 
- Information completeness
- Context appropriateness
- Answer quality potential

Query: "${query}"

Document: "${document.substring(0, 1000)}${document.length > 1000 ? '...' : ''}"

Score (0.00-1.00):`;

    try {
      const response = await this.llm.generateText(prompt);

      // Extract numeric score
      const scoreMatch = response.match(/(\d+\.?\d*)/);
      if (scoreMatch) {
        const score = parseFloat(scoreMatch[1]);
        
        // Handle different scales (0-1 vs 0-100)
        if (score > 1) {
          return score / 100.0;
        }
        return score;
      }

      // Fallback: try to extract from a more complex response
      return await this.extractScoreFromComplexResponse(response);

    } catch (error) {
      logger.warn("[RERANKER_AGENT] Cross-encoder scoring failed:", error);
      return 0.5;
    }
  }

  /**
   * Calculate confidence in the reranking score
   */
  private async calculateConfidence(
    query: string,
    document: string,
    rerankScore: number
  ): Promise<number> {
    // Use a simplified approach for confidence calculation
    try {
      const prompt = `Rate your confidence in this relevance assessment on a scale of 0.00 to 1.00:

Query: "${query.substring(0, 200)}..."
Document: "${document.substring(0, 300)}..."
Assessed Relevance Score: ${rerankScore.toFixed(2)}

How confident are you in this score? Consider clarity of query, document quality, and assessment certainty.

Confidence (0.00-1.00):`;

      const response = await this.llm.generateText(prompt);

      const scoreMatch = response.match(/(\d+\.?\d*)/);
      if (scoreMatch) {
        const confidence = parseFloat(scoreMatch[1]);
        return confidence > 1 ? confidence / 100.0 : confidence;
      }

      // Fallback confidence based on score characteristics
      return this.calculateFallbackConfidence(rerankScore, query, document);

    } catch (error) {
      return this.calculateFallbackConfidence(rerankScore, query, document);
    }
  }

  /**
   * Extract score from complex LLM response
   */
  private async extractScoreFromComplexResponse(response: string): Promise<number> {
    try {
      // Try JSON parsing
      const jsonResult = robustJSON.parse(response, {
        fallbackToKeyValue: true,
        allowPartial: true
      });

      if (jsonResult.success && jsonResult.data.score) {
        const score = parseFloat(jsonResult.data.score);
        return isNaN(score) ? 0.5 : (score > 1 ? score / 100.0 : score);
      }

      // Try keyword extraction
      const keywords = ['score:', 'relevance:', 'rating:', 'value:'];
      for (const keyword of keywords) {
        const keywordIndex = response.toLowerCase().indexOf(keyword);
        if (keywordIndex !== -1) {
          const afterKeyword = response.substring(keywordIndex + keyword.length);
          const numberMatch = afterKeyword.match(/(\d+\.?\d*)/);
          if (numberMatch) {
            const score = parseFloat(numberMatch[1]);
            return score > 1 ? score / 100.0 : score;
          }
        }
      }

      // Last resort: analyze response sentiment
      return this.analyzeResponseSentiment(response);

    } catch (error) {
      return 0.5;
    }
  }

  /**
   * Analyze response sentiment as score fallback
   */
  private analyzeResponseSentiment(response: string): number {
    const positive = ['excellent', 'high', 'good', 'relevant', 'strong', 'clear', 'perfect'];
    const negative = ['poor', 'low', 'bad', 'irrelevant', 'weak', 'unclear', 'terrible'];
    
    const lowerResponse = response.toLowerCase();
    let score = 0.5;
    
    positive.forEach(word => {
      if (lowerResponse.includes(word)) score += 0.1;
    });
    
    negative.forEach(word => {
      if (lowerResponse.includes(word)) score -= 0.1;
    });
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate fallback confidence based on heuristics
   */
  private calculateFallbackConfidence(
    rerankScore: number,
    query: string,
    document: string
  ): number {
    let confidence = 0.5;
    
    // Higher confidence for extreme scores (very high or very low)
    if (rerankScore > 0.8 || rerankScore < 0.2) {
      confidence += 0.2;
    }
    
    // Higher confidence for longer, more detailed documents
    if (document.length > 500) {
      confidence += 0.1;
    }
    
    // Higher confidence for clear, specific queries
    if (query.length > 20 && query.split(' ').length > 3) {
      confidence += 0.1;
    }
    
    // Lower confidence for very short content
    if (document.length < 100) {
      confidence -= 0.2;
    }
    
    return Math.max(0.1, Math.min(1, confidence));
  }

  /**
   * Advanced reranking with multiple criteria
   */
  async advancedRerank(
    query: string,
    documents: RetrievalResult[],
    criteria: {
      relevance: number;
      recency: number;
      quality: number;
      completeness: number;
    } = { relevance: 0.6, recency: 0.15, quality: 0.15, completeness: 0.1 }
  ): Promise<RerankResult[]> {
    try {
      const rerankedDocs = await this.rerank(query, documents);
      
      // Apply weighted scoring with multiple criteria
      const enhancedResults = rerankedDocs.map(doc => {
        // Calculate additional scores
        const recencyScore = this.calculateRecencyScore(doc);
        const qualityScore = this.calculateQualityScore(doc.content);
        const completenessScore = this.calculateCompletenessScore(doc.content, query);
        
        // Weighted final score
        const finalScore = 
          (doc.rerankScore * criteria.relevance) +
          (recencyScore * criteria.recency) +
          (qualityScore * criteria.quality) +
          (completenessScore * criteria.completeness);
        
        return {
          ...doc,
          rerankScore: Math.max(0, Math.min(1, finalScore))
        };
      });
      
      return enhancedResults.sort((a, b) => b.rerankScore - a.rerankScore);
      
    } catch (error) {
      logger.warn("[RERANKER_AGENT] Advanced reranking failed:", error);
      return await this.rerank(query, documents);
    }
  }

  /**
   * Calculate recency score based on metadata
   */
  private calculateRecencyScore(doc: RetrievalResult): number {
    // Simple heuristic - could be enhanced with actual timestamps
    if (doc.metadata.type === 'context') {
      return 0.8; // Recent context is valuable
    }
    return 0.5; // Default for unknown recency
  }

  /**
   * Calculate quality score based on content characteristics
   */
  private calculateQualityScore(content: string): number {
    let score = 0.5;
    
    // Longer content often indicates more comprehensive information
    if (content.length > 1000) score += 0.2;
    if (content.length > 2000) score += 0.1;
    
    // Code-like content (structured)
    if (content.includes('function') || content.includes('class') || content.includes('{')) {
      score += 0.2;
    }
    
    // Well-formatted content
    if (content.includes('\n') && content.split('\n').length > 5) {
      score += 0.1;
    }
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate completeness score relative to query
   */
  private calculateCompletenessScore(content: string, query: string): number {
    const queryWords = query.toLowerCase().split(' ').filter(w => w.length > 2);
    const contentLower = content.toLowerCase();
    
    const matchedWords = queryWords.filter(word => contentLower.includes(word));
    return queryWords.length > 0 ? matchedWords.length / queryWords.length : 0.5;
  }
}