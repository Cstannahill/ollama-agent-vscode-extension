/**
 * Query Rewriter Agent - Search query expansion and optimization
 * 
 * Transforms short queries into expanded, optimized versions for better
 * search results and information retrieval.
 */

import { logger } from "../../../utils/logger";
import { OllamaLLM } from "../../../api/ollama";
import { robustJSON } from "../../../utils/RobustJSONParser";
import {
  IQueryRewriterAgent,
  ExpandedQuery,
  OptimizedQuery,
  QueryVariation,
  FoundationAgentConfig
} from "../IFoundationAgent";

export class QueryRewriterAgent implements IQueryRewriterAgent {
  public readonly name = "QueryRewriterAgent";
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
      temperature: 0.3, // Moderate creativity for query expansion
      maxTokens: 800,
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
      logger.info("[QUERY_REWRITER_AGENT] Initializing query rewriter agent...");
      
      // Mark as initialized first to prevent recursive calls
      this.initialized = true;
      
      // Test LLM connection with a simple query expansion
      await this.expandQuery("test query");
      
      logger.info("[QUERY_REWRITER_AGENT] Query rewriter agent initialized successfully");
    } catch (error) {
      // Reset initialization state on failure
      this.initialized = false;
      logger.error("[QUERY_REWRITER_AGENT] Failed to initialize:", error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCapabilities(): string[] {
    return [
      "Short-to-long query expansion",
      "Search query optimization",
      "Multi-variant query generation",
      "Intent recognition and clarification",
      "Keyword and concept extraction",
      "Context-aware query enhancement"
    ];
  }

  /**
   * Expand a short query into a comprehensive version
   */
  async expandQuery(shortQuery: string, context?: string): Promise<ExpandedQuery> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`[QUERY_REWRITER_AGENT] Expanding query: ${shortQuery}`);

      const expansionPrompt = this.buildExpansionPrompt(shortQuery, context);
      const response = await this.llm.generateText(expansionPrompt);

      const expandedQuery = this.parseExpansionResponse(response, shortQuery);
      
      logger.debug(`[QUERY_REWRITER_AGENT] Expanded "${shortQuery}" with confidence ${expandedQuery.confidence.toFixed(2)}`);
      return expandedQuery;

    } catch (error) {
      logger.error("[QUERY_REWRITER_AGENT] Query expansion failed:", error);
      
      return {
        original: shortQuery,
        expanded: shortQuery,
        keywords: this.extractSimpleKeywords(shortQuery),
        concepts: [shortQuery],
        intent: "general_search",
        confidence: 0.3
      };
    }
  }

  /**
   * Optimize query for specific search types
   */
  async optimizeForSearch(
    query: string, 
    searchType: 'semantic' | 'keyword' | 'hybrid'
  ): Promise<OptimizedQuery> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const optimizationPrompt = this.buildOptimizationPrompt(query, searchType);
      const response = await this.llm.generateText(optimizationPrompt);

      return this.parseOptimizationResponse(response, query, searchType);

    } catch (error) {
      logger.error("[QUERY_REWRITER_AGENT] Query optimization failed:", error);
      
      return {
        query: query,
        searchTerms: this.extractSimpleKeywords(query),
        filters: {},
        boost: {},
        strategy: searchType
      };
    }
  }

  /**
   * Generate multiple variations of a query
   */
  async generateVariations(query: string, count: number = 5): Promise<QueryVariation[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const variationPrompt = this.buildVariationPrompt(query, count);
      const response = await this.llm.generateText(variationPrompt);

      return this.parseVariationsResponse(response, query);

    } catch (error) {
      logger.error("[QUERY_REWRITER_AGENT] Query variation generation failed:", error);
      
      // Fallback: generate simple variations
      return this.generateFallbackVariations(query, count);
    }
  }

  /**
   * Build query expansion prompt
   */
  private buildExpansionPrompt(shortQuery: string, context?: string): string {
    const contextSection = context ? `
**Additional Context:** ${context}` : '';

    return `You are a query expansion expert. Transform this short query into a comprehensive, detailed version.

**Short Query:** "${shortQuery}"
${contextSection}

**Expansion Guidelines:**
1. **Intent Recognition**: Identify what the user is really looking for
2. **Keyword Expansion**: Add relevant synonyms, related terms, and technical vocabulary
3. **Concept Identification**: Extract main concepts and themes
4. **Context Addition**: Add implied context and background information
5. **Specificity**: Make vague terms more specific and actionable

**Analysis Framework:**
- What domain/field does this query relate to?
- What are the key concepts and their relationships?
- What synonyms and related terms should be included?
- What context is implied but not explicitly stated?
- What would make this query more effective for search?

**Respond in JSON format:**
{
  "original": "${shortQuery}",
  "expanded": "Detailed, comprehensive version of the query with added context and keywords",
  "keywords": ["extracted", "keywords", "and", "key", "terms"],
  "concepts": ["main_concept_1", "main_concept_2", "related_concept"],
  "intent": "specific_intent_category",
  "confidence": 0.85,
  "reasoning": "Brief explanation of expansion choices"
}`;
  }

  /**
   * Build query optimization prompt
   */
  private buildOptimizationPrompt(query: string, searchType: 'semantic' | 'keyword' | 'hybrid'): string {
    const searchTypeGuidelines = {
      semantic: {
        focus: "meaning, context, and conceptual relationships",
        strategy: "Use natural language, synonyms, and related concepts. Focus on semantic similarity."
      },
      keyword: {
        focus: "exact terms, Boolean operators, and specific vocabulary", 
        strategy: "Use precise keywords, technical terms, and exact phrase matching. Optimize for literal matches."
      },
      hybrid: {
        focus: "combination of semantic understanding and keyword precision",
        strategy: "Balance natural language with specific terms. Use both conceptual and literal matching."
      }
    };

    const guidelines = searchTypeGuidelines[searchType];

    return `Optimize this query for ${searchType.toUpperCase()} search.

**Original Query:** "${query}"

**Search Type:** ${searchType}
**Focus:** ${guidelines.focus}
**Strategy:** ${guidelines.strategy}

**Optimization Tasks:**
1. **Search Terms**: Identify the most effective search terms
2. **Filters**: Suggest useful filters or constraints
3. **Boost Factors**: Identify terms that should be emphasized
4. **Query Structure**: Optimize the query structure for the search type

**Respond in JSON format:**
{
  "query": "Optimized query string",
  "searchTerms": ["primary", "search", "terms"],
  "filters": {
    "category": "suggested_category",
    "timeframe": "if_applicable",
    "type": "content_type"
  },
  "boost": {
    "high_priority_term": 2.0,
    "important_concept": 1.5
  },
  "strategy": "${searchType}",
  "improvements": ["explanation", "of", "optimizations"]
}`;
  }

  /**
   * Build query variation prompt
   */
  private buildVariationPrompt(query: string, count: number): string {
    return `Generate ${count} different variations of this query, each with a different focus or approach.

**Original Query:** "${query}"

**Variation Guidelines:**
- Each variation should target the same intent but from different angles
- Use different vocabulary, phrasing, and emphasis
- Include both broader and more specific versions
- Consider different user perspectives and contexts
- Maintain semantic similarity while varying expression

**Focus Areas for Variations:**
1. **Technical Focus**: More technical/specialized terms
2. **Beginner Focus**: Simpler, more accessible language  
3. **Comprehensive Focus**: Broader, more inclusive terms
4. **Specific Focus**: Narrow, precise targeting
5. **Alternative Perspective**: Different angle or approach

**Respond in JSON format:**
{
  "variations": [
    {
      "query": "First variation of the query",
      "similarity": 0.85,
      "focus": "technical_focus"
    },
    {
      "query": "Second variation",
      "similarity": 0.80,
      "focus": "beginner_friendly"
    }
  ]
}`;
  }

  /**
   * Parse expansion response from LLM
   */
  private parseExpansionResponse(response: string, originalQuery: string): ExpandedQuery {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        original: originalQuery,
        expanded: data.expanded || originalQuery,
        keywords: Array.isArray(data.keywords) ? data.keywords : this.extractSimpleKeywords(originalQuery),
        concepts: Array.isArray(data.concepts) ? data.concepts : [originalQuery],
        intent: data.intent || "general_search",
        confidence: Math.max(0, Math.min(1, parseFloat(data.confidence) || 0.7))
      };
    }

    // Fallback expansion
    return this.fallbackExpansion(response, originalQuery);
  }

  /**
   * Parse optimization response from LLM
   */
  private parseOptimizationResponse(
    response: string, 
    originalQuery: string, 
    searchType: 'semantic' | 'keyword' | 'hybrid'
  ): OptimizedQuery {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        query: data.query || originalQuery,
        searchTerms: Array.isArray(data.searchTerms) ? data.searchTerms : this.extractSimpleKeywords(originalQuery),
        filters: data.filters || {},
        boost: data.boost || {},
        strategy: searchType
      };
    }

    // Fallback optimization
    return {
      query: originalQuery,
      searchTerms: this.extractSimpleKeywords(originalQuery),
      filters: {},
      boost: {},
      strategy: searchType
    };
  }

  /**
   * Parse variations response from LLM
   */
  private parseVariationsResponse(response: string, originalQuery: string): QueryVariation[] {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success && parseResult.data.variations) {
      return parseResult.data.variations.map((variation: any) => ({
        query: variation.query || originalQuery,
        similarity: Math.max(0, Math.min(1, parseFloat(variation.similarity) || 0.8)),
        focus: variation.focus || "general"
      }));
    }

    // Fallback: generate simple variations
    return this.generateFallbackVariations(originalQuery, 3);
  }

  /**
   * Extract simple keywords from query (fallback method)
   */
  private extractSimpleKeywords(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .slice(0, 8); // Limit to 8 keywords
  }

  /**
   * Fallback expansion when parsing fails
   */
  private fallbackExpansion(response: string, originalQuery: string): ExpandedQuery {
    // Try to extract an expanded version from the response
    const sentences = response.split(/[.!?]/).filter(s => s.trim().length > originalQuery.length);
    const expanded = sentences.length > 0 ? sentences[0].trim() : originalQuery;

    return {
      original: originalQuery,
      expanded: expanded,
      keywords: this.extractSimpleKeywords(originalQuery),
      concepts: [originalQuery],
      intent: "general_search",
      confidence: 0.5
    };
  }

  /**
   * Generate fallback variations
   */
  private generateFallbackVariations(query: string, count: number): QueryVariation[] {
    const variations: QueryVariation[] = [];
    const words = query.split(' ');

    // Variation 1: Add "how to" prefix
    if (!query.toLowerCase().startsWith('how')) {
      variations.push({
        query: `How to ${query}`,
        similarity: 0.8,
        focus: "instructional"
      });
    }

    // Variation 2: Add "best practices" or "guide"
    variations.push({
      query: `${query} best practices guide`,
      similarity: 0.75,
      focus: "comprehensive"
    });

    // Variation 3: More specific technical version
    variations.push({
      query: `${query} implementation details`,
      similarity: 0.7,
      focus: "technical"
    });

    // Variation 4: Problem-solving focus
    variations.push({
      query: `${query} troubleshooting solutions`,
      similarity: 0.65,
      focus: "problem_solving"
    });

    // Variation 5: Beginner-friendly version
    variations.push({
      query: `${query} for beginners tutorial`,
      similarity: 0.6,
      focus: "beginner_friendly"
    });

    return variations.slice(0, count);
  }
}