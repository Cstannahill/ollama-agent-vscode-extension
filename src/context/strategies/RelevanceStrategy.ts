import { logger } from "../../utils/logger";
import {
  ContextQuery,
  ContextSearchResult,
  ContextStrategy,
  ContextItem,
} from "../types";
import { ChromaContextDB } from "../storage/ChromaContextDB";

/**
 * Strategy that prioritizes context based on relevance scores and content similarity
 */
export class RelevanceStrategy implements ContextStrategy {
  public name = "relevance";
  public priority = 3;

  private contextDB: ChromaContextDB;

  constructor(contextDB: ChromaContextDB) {
    this.contextDB = contextDB;
  }

  public canHandle(query: ContextQuery): boolean {
    // Can handle any query, serves as a good general-purpose strategy
    return true;
  }

  public async search(query: ContextQuery): Promise<ContextSearchResult> {
    const startTime = Date.now();

    try {
      logger.debug(
        `[RELEVANCE_STRATEGY] Searching with relevance strategy: "${
          query.query || "undefined"
        }"`
      );

      // Get base results from database
      const items = await this.contextDB.search(query);

      // Re-rank based on relevance calculation
      const rankedItems = await this.calculateRelevanceScores(items, query);

      // Sort by relevance score
      rankedItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Apply result limits
      const limitedItems = query.maxResults
        ? rankedItems.slice(0, query.maxResults)
        : rankedItems;

      const result: ContextSearchResult = {
        items: limitedItems,
        totalCount: rankedItems.length,
        searchTime: Date.now() - startTime,
        strategy: this.name,
      };

      logger.debug(
        `[RELEVANCE_STRATEGY] Found ${result.items.length} relevant items`
      );
      return result;
    } catch (error) {
      logger.error(`[RELEVANCE_STRATEGY] Search failed:`, error);
      return {
        items: [],
        totalCount: 0,
        searchTime: Date.now() - startTime,
        strategy: this.name,
      };
    }
  }

  private async calculateRelevanceScores(
    items: ContextItem[],
    query: ContextQuery
  ): Promise<ContextItem[]> {
    // Handle case where query.query is undefined
    if (!query.query) {
      return items; // Return items with original scores if no query text
    }

    const queryLower = query.query.toLowerCase();
    const queryTerms = queryLower
      .split(/\s+/)
      .filter((term) => term.length > 2);

    return items.map((item) => {
      let score = item.relevanceScore; // Base score

      // Content similarity boost
      const contentLower = item.content.toLowerCase();
      const matchingTerms = queryTerms.filter((term) =>
        contentLower.includes(term)
      );
      const termMatchRatio =
        queryTerms.length > 0 ? matchingTerms.length / queryTerms.length : 0;
      score += termMatchRatio * 0.3;

      // Tag matching boost
      const tagMatches = item.tags.filter((tag) =>
        queryTerms.some((term) => tag.toLowerCase().includes(term))
      );
      score += tagMatches.length * 0.1;

      // Priority boost
      score += item.priority * 0.05;

      // Recency boost (more recent items get slight boost)
      const ageInDays =
        (Date.now() - item.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      const recencyBoost = Math.max(0, 0.1 - ageInDays * 0.01);
      score += recencyBoost;

      // Context type specific boosts
      if (query.types && query.types.includes(item.type)) {
        score += 0.2;
      }

      return {
        ...item,
        relevanceScore: Math.min(score, 1.0), // Cap at 1.0
      };
    });
  }
}
