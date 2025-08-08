/**
 * Chunk Scorer Agent - Content relevance and ranking specialist
 * 
 * Implements sophisticated chunk scoring for determining relevance
 * and extracting the most pertinent portions of content.
 */

import { logger } from "../../../utils/logger";
import { OllamaLLM } from "../../../api/ollama";
import { robustJSON } from "../../../utils/RobustJSONParser";
import {
  IChunkScorerAgent,
  ChunkScore,
  RankedChunk,
  RelevantPortion,
  FoundationAgentConfig
} from "../IFoundationAgent";

export class ChunkScorerAgent implements IChunkScorerAgent {
  public readonly name = "ChunkScorerAgent";
  public readonly modelSize = "0.5-2B";

  private llm: OllamaLLM;
  private initialized = false;
  private config: FoundationAgentConfig;

  constructor(
    ollamaUrl: string,
    model: string,
    config?: Partial<FoundationAgentConfig>
  ) {
    this.config = {
      modelSize: '0.5-2B',
      temperature: 0.1, // Low temperature for consistent scoring
      maxTokens: 400,
      timeout: 15000,
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
      logger.info("[CHUNK_SCORER_AGENT] Initializing chunk scorer agent...");
      
      // Mark as initialized first to prevent recursive calls
      this.initialized = true;
      
      // Test with simple scoring task
      await this.scoreChunk("test content", "test query");
      
      logger.info("[CHUNK_SCORER_AGENT] Chunk scorer agent initialized successfully");
    } catch (error) {
      // Reset initialization state on failure
      this.initialized = false;
      logger.error("[CHUNK_SCORER_AGENT] Failed to initialize:", error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCapabilities(): string[] {
    return [
      "Content relevance scoring",
      "Multi-criteria chunk evaluation",
      "Relevant portion extraction",
      "Quality assessment",
      "Semantic similarity analysis",
      "Content completeness evaluation"
    ];
  }

  /**
   * Score a single chunk against a query
   */
  async scoreChunk(chunk: string, query: string): Promise<ChunkScore> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`[CHUNK_SCORER_AGENT] Scoring chunk for query: ${query.substring(0, 50)}...`);

      const scoringPrompt = this.buildScoringPrompt(chunk, query);
      const response = await this.llm.generateText(scoringPrompt);

      const chunkScore = this.parseScoringResponse(response);
      
      logger.debug(`[CHUNK_SCORER_AGENT] Chunk scored: ${chunkScore.score.toFixed(2)}`);
      return chunkScore;

    } catch (error) {
      logger.error("[CHUNK_SCORER_AGENT] Chunk scoring failed:", error);
      
      return {
        score: 0.3,
        relevance: 0.3,
        quality: 0.5,
        completeness: 0.4,
        reasoning: `Scoring failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Rank multiple chunks by relevance
   */
  async rankChunks(chunks: string[], query: string): Promise<RankedChunk[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`[CHUNK_SCORER_AGENT] Ranking ${chunks.length} chunks`);

      // Score all chunks
      const scoringPromises = chunks.map(async (chunk, index) => {
        try {
          const score = await this.scoreChunk(chunk, query);
          const highlights = await this.extractHighlights(chunk, query);
          
          return {
            content: chunk,
            rank: 0, // Will be set after sorting
            score,
            highlights
          };
        } catch (error) {
          logger.warn(`[CHUNK_SCORER_AGENT] Failed to score chunk ${index}:`, error);
          return {
            content: chunk,
            rank: 0,
            score: {
              score: 0.2,
              relevance: 0.2,
              quality: 0.3,
              completeness: 0.2,
              reasoning: "Scoring failed"
            },
            highlights: []
          };
        }
      });

      const rankedChunks = await Promise.all(scoringPromises);
      
      // Sort by overall score and assign ranks
      rankedChunks.sort((a, b) => b.score.score - a.score.score);
      rankedChunks.forEach((chunk, index) => {
        chunk.rank = index + 1;
      });

      logger.debug(`[CHUNK_SCORER_AGENT] Ranked ${rankedChunks.length} chunks`);
      return rankedChunks;

    } catch (error) {
      logger.error("[CHUNK_SCORER_AGENT] Chunk ranking failed:", error);
      
      // Fallback: return chunks with basic scores
      return chunks.map((chunk, index) => ({
        content: chunk,
        rank: index + 1,
        score: {
          score: Math.max(0.1, 0.8 - index * 0.1),
          relevance: 0.5,
          quality: 0.5,
          completeness: 0.5,
          reasoning: "Fallback ranking"
        },
        highlights: []
      }));
    }
  }

  /**
   * Extract most relevant portions from a chunk
   */
  async extractRelevantPortions(chunk: string, query: string): Promise<RelevantPortion[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const extractionPrompt = this.buildExtractionPrompt(chunk, query);
      const response = await this.llm.generateText(extractionPrompt);

      return this.parseExtractionResponse(response, chunk);

    } catch (error) {
      logger.error("[CHUNK_SCORER_AGENT] Relevant portion extraction failed:", error);
      
      // Fallback: return entire chunk as one portion
      return [{
        text: chunk.substring(0, 500), // Limit length
        startIndex: 0,
        endIndex: Math.min(500, chunk.length),
        relevanceScore: 0.5,
        context: "Fallback extraction - full chunk"
      }];
    }
  }

  /**
   * Build chunk scoring prompt
   */
  private buildScoringPrompt(chunk: string, query: string): string {
    return `Score this content chunk for relevance to the query across multiple criteria.

**Query:** "${query}"

**Content Chunk:**
\`\`\`
${chunk.substring(0, 1000)}${chunk.length > 1000 ? '\n...[truncated]' : ''}
\`\`\`

**Scoring Criteria (0.0 to 1.0 scale):**

1. **Relevance**: How well does the content address the query?
   - 0.9-1.0: Directly answers the query with comprehensive information
   - 0.7-0.8: Addresses most aspects of the query with good detail
   - 0.5-0.6: Partially relevant with some useful information  
   - 0.3-0.4: Tangentially related but limited usefulness
   - 0.0-0.2: Not relevant or off-topic

2. **Quality**: How well-written and accurate is the content?
   - Consider clarity, accuracy, and information density
   - Higher scores for well-structured, clear, informative content

3. **Completeness**: How complete is the information for the query?
   - Does it provide a full answer or just partial information?
   - Higher scores for comprehensive coverage

**Respond in JSON format:**
{
  "score": 0.75,
  "relevance": 0.80,
  "quality": 0.70,
  "completeness": 0.75,
  "reasoning": "Brief explanation of the scoring rationale"
}`;
  }

  /**
   * Build relevant portion extraction prompt
   */
  private buildExtractionPrompt(chunk: string, query: string): string {
    return `Extract the most relevant portions of this content for the given query.

**Query:** "${query}"

**Content:**
\`\`\`
${chunk}
\`\`\`

**Extraction Guidelines:**
- Identify 1-3 most relevant text portions
- Each portion should be 50-200 characters
- Include sufficient context for understanding
- Focus on content that directly addresses the query
- Provide relevance scores for each portion

**Respond in JSON format:**
{
  "portions": [
    {
      "text": "extracted relevant text portion",
      "startIndex": 125,
      "endIndex": 275,
      "relevanceScore": 0.90,
      "context": "Brief context explanation"
    }
  ]
}`;
  }

  /**
   * Parse scoring response
   */
  private parseScoringResponse(response: string): ChunkScore {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        score: Math.max(0, Math.min(1, parseFloat(data.score) || 0.5)),
        relevance: Math.max(0, Math.min(1, parseFloat(data.relevance) || 0.5)),
        quality: Math.max(0, Math.min(1, parseFloat(data.quality) || 0.5)),
        completeness: Math.max(0, Math.min(1, parseFloat(data.completeness) || 0.5)),
        reasoning: data.reasoning || "No reasoning provided"
      };
    }

    // Fallback scoring
    return this.generateFallbackScore(response);
  }

  /**
   * Parse extraction response
   */
  private parseExtractionResponse(response: string, originalChunk: string): RelevantPortion[] {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success && Array.isArray(parseResult.data.portions)) {
      return parseResult.data.portions.map((portion: any) => ({
        text: portion.text || "No text extracted",
        startIndex: Math.max(0, parseInt(portion.startIndex) || 0),
        endIndex: Math.min(originalChunk.length, parseInt(portion.endIndex) || 100),
        relevanceScore: Math.max(0, Math.min(1, parseFloat(portion.relevanceScore) || 0.5)),
        context: portion.context || "No context provided"
      }));
    }

    // Fallback: extract first significant sentence
    const sentences = originalChunk.split(/[.!?]/).filter(s => s.trim().length > 20);
    if (sentences.length > 0) {
      const firstSentence = sentences[0].trim();
      return [{
        text: firstSentence,
        startIndex: 0,
        endIndex: firstSentence.length,
        relevanceScore: 0.6,
        context: "First significant sentence"
      }];
    }

    return [{
      text: originalChunk.substring(0, 200),
      startIndex: 0,
      endIndex: Math.min(200, originalChunk.length),
      relevanceScore: 0.4,
      context: "Fallback extraction"
    }];
  }

  /**
   * Extract highlights from chunk for display
   */
  private async extractHighlights(chunk: string, query: string): Promise<string[]> {
    try {
      const queryWords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
      const chunkLower = chunk.toLowerCase();
      const highlights: string[] = [];

      // Find sentences containing query words
      const sentences = chunk.split(/[.!?]/).filter(s => s.trim().length > 10);
      
      for (const sentence of sentences.slice(0, 3)) { // Limit to 3 highlights
        const sentenceLower = sentence.toLowerCase();
        const matchCount = queryWords.filter(word => sentenceLower.includes(word)).length;
        
        if (matchCount > 0) {
          highlights.push(sentence.trim());
        }
      }

      return highlights.slice(0, 3); // Max 3 highlights
    } catch (error) {
      return [];
    }
  }

  /**
   * Generate fallback score when parsing fails
   */
  private generateFallbackScore(response: string): ChunkScore {
    // Analyze response content for scoring hints
    const lowerResponse = response.toLowerCase();
    let score = 0.5;

    // Look for quality indicators
    const qualityWords = ['excellent', 'good', 'high', 'relevant', 'useful', 'comprehensive'];
    const lowQualityWords = ['poor', 'bad', 'low', 'irrelevant', 'useless', 'incomplete'];

    qualityWords.forEach(word => {
      if (lowerResponse.includes(word)) score += 0.1;
    });

    lowQualityWords.forEach(word => {
      if (lowerResponse.includes(word)) score -= 0.1;
    });

    // Try to extract numeric scores from response
    const numbers = response.match(/(\d+\.?\d*)/g);
    if (numbers && numbers.length > 0) {
      const firstNumber = parseFloat(numbers[0]);
      if (firstNumber >= 0 && firstNumber <= 1) {
        score = firstNumber;
      } else if (firstNumber > 1 && firstNumber <= 100) {
        score = firstNumber / 100;
      }
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      relevance: score,
      quality: score * 0.9,
      completeness: score * 0.8,
      reasoning: "Fallback analysis of response content"
    };
  }
}