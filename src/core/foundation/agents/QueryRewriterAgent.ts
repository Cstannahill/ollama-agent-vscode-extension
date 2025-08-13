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

      // Enhance context with workspace information to prevent over-expansion
      const enhancedContext = this.buildWorkspaceAwareContext(shortQuery, context);
      const expansionPrompt = this.buildExpansionPrompt(shortQuery, enhancedContext);
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
   * Build workspace-aware context to prevent over-expansion
   */
  private buildWorkspaceAwareContext(shortQuery: string, context?: string): string {
    let workspaceContext = context || '';
    
    // Detect existing project structure indicators
    const projectIndicators = [
      'src/app', 'src/components', 'src/pages',
      'app/', 'components/', 'pages/',
      'package.json', 'next.config', 'tsconfig',
      'tailwind.config', 'eslint', 'prettier'
    ];
    
    const hasProjectStructure = projectIndicators.some(indicator => 
      shortQuery.toLowerCase().includes(indicator.toLowerCase())
    );
    
    if (hasProjectStructure) {
      workspaceContext += `\n\nWORKSPACE CONTEXT: The user is working within an existing project with established structure. Do not add project creation or setup steps.`;
    }
    
    // Detect framework indicators
    if (shortQuery.toLowerCase().includes('page.tsx') || shortQuery.toLowerCase().includes('next')) {
      workspaceContext += `\n\nFRAMEWORK: This appears to be a Next.js project with TypeScript. Focus on component creation within existing structure.`;
    }
    
    if (shortQuery.toLowerCase().includes('tailwind')) {
      workspaceContext += `\n\nSTYLING: Tailwind CSS is already configured. Focus on utility classes and component styling.`;
    }
    
    return workspaceContext;
  }

  /**
   * Build query expansion prompt
   */
  private buildExpansionPrompt(shortQuery: string, context?: string): string {
    const contextSection = context ? `
**Additional Context:** ${context}` : '';

    return `You are a query expansion expert. Transform this short query into a more detailed version while staying faithful to the original intent.

**Short Query:** "${shortQuery}"
${contextSection}

**CRITICAL EXPANSION RULES:**
1. **Stay Faithful**: Do NOT add information that isn't explicitly stated or clearly implied
2. **No Assumptions**: Do not assume project setup, folder structures, or create new requirements
3. **Preserve Scope**: If the task mentions existing files/folders (like "src/app"), assume they exist - don't create new projects
4. **Conservative Enhancement**: Only add technical details that directly relate to the stated request

**Expansion Guidelines:**
1. **Intent Recognition**: Identify exactly what the user is asking for
2. **Technical Clarification**: Add relevant technical terms and best practices 
3. **Implementation Details**: Include specific implementation approaches mentioned or implied
4. **Keyword Enhancement**: Add synonyms and related technical vocabulary
5. **Quality Standards**: Include relevant quality/styling requirements if mentioned

**WHAT NOT TO DO:**
- Do not add project creation steps if not requested
- Do not assume missing infrastructure needs to be built
- Do not expand scope beyond the original request
- Do not add steps for setting up environments unless asked

**Respond in JSON format:**
{
  "original": "${shortQuery}",
  "expanded": "Enhanced version that clarifies and adds technical detail WITHOUT changing scope",
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
      let expanded = data.expanded || originalQuery;
      
      // Detect and correct over-expansion
      expanded = this.correctOverExpansion(originalQuery, expanded);
      
      return {
        original: originalQuery,
        expanded: expanded,
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
   * Detect and correct over-expansion that adds unwanted scope
   */
  private correctOverExpansion(originalQuery: string, expanded: string): string {
    const overExpansionPatterns = [
      // Project creation patterns when original doesn't mention it
      /create a .*? project/gi,
      /set up a .*? project/gi,
      /initialize a .*? project/gi,
      /build a new .*? project/gi,
      // Workspace setup when not requested
      /workspace folder/gi,
      /project structure/gi,
      // Environment setup when not requested  
      /configure.*environment/gi,
      /install.*dependencies/gi,
      /setup.*development/gi
    ];
    
    let corrected = expanded;
    const originalLower = originalQuery.toLowerCase();
    
    // Only apply corrections if original doesn't contain project setup keywords
    const setupKeywords = ['create project', 'new project', 'setup project', 'initialize project'];
    const originalHasSetup = setupKeywords.some(keyword => originalLower.includes(keyword));
    
    if (!originalHasSetup) {
      // Remove over-expansion patterns
      for (const pattern of overExpansionPatterns) {
        // Check if the pattern exists in expanded but not in original
        if (pattern.test(corrected) && !pattern.test(originalQuery)) {
          logger.debug(`[QUERY_REWRITER_AGENT] Correcting over-expansion pattern: ${pattern}`);
          // Remove sentences containing these patterns
          corrected = corrected.replace(new RegExp(`[^.]*${pattern.source}[^.]*\.?`, 'gi'), '');
        }
      }
      
      // Clean up any resulting formatting issues
      corrected = corrected.replace(/\s+/g, ' ').trim();
      corrected = corrected.replace(/\.\s*\./g, '.');
      
      // If we removed too much, fall back to a conservative expansion
      if (corrected.length < originalQuery.length * 1.2) {
        corrected = this.createConservativeExpansion(originalQuery);
      }
    }
    
    return corrected || originalQuery;
  }

  /**
   * Create a conservative expansion that stays close to the original
   */
  private createConservativeExpansion(originalQuery: string): string {
    const queryLower = originalQuery.toLowerCase();
    let expansion = originalQuery;
    
    // Add minimal technical context based on what's mentioned
    if (queryLower.includes('page.tsx')) {
      expansion = `${originalQuery}. Implement as a TypeScript React component with proper file structure.`;
    } else if (queryLower.includes('tailwind')) {
      expansion = `${originalQuery}. Use Tailwind CSS utility classes for styling and responsive design.`;
    } else if (queryLower.includes('directory') && queryLower.includes('file')) {
      expansion = `${originalQuery}. Create the directory structure and file with appropriate content.`;
    }
    
    return expansion;
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