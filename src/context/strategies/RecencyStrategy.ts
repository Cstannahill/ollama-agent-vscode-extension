import { logger } from "../../utils/logger";
import {
  ContextQuery,
  ContextSearchResult,
  ContextStrategy,
  ContextItem,
} from "../types";
import { ChromaContextDB } from "../storage/ChromaContextDB";

/**
 * Strategy that prioritizes recent context over older context
 */
export class RecencyStrategy implements ContextStrategy {
  public name = "recency";
  public priority = 2;

  private contextDB: ChromaContextDB;

  constructor(contextDB: ChromaContextDB) {
    this.contextDB = contextDB;
  }

  public canHandle(query: ContextQuery): boolean {
    // Particularly good for session-based queries or when time is important
    return (
      query.sessionId !== undefined ||
      query.taskId !== undefined ||
      query.chatId !== undefined
    );
  }

  public async search(query: ContextQuery): Promise<ContextSearchResult> {
    const startTime = Date.now();

    try {
      logger.debug(
        `[RECENCY_STRATEGY] Searching with recency strategy: "${
          query.query || "undefined"
        }"`
      );

      // Get recent context from database

      // Get base results from database
      const items = await this.contextDB.search(query);

      // Apply recency scoring
      const scoredItems = this.applyRecencyScoring(items);

      // Sort by recency score (most recent first)
      scoredItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Apply result limits
      const limitedItems = query.maxResults
        ? scoredItems.slice(0, query.maxResults)
        : scoredItems;

      const result: ContextSearchResult = {
        items: limitedItems,
        totalCount: scoredItems.length,
        searchTime: Date.now() - startTime,
        strategy: this.name,
      };

      logger.debug(
        `[RECENCY_STRATEGY] Found ${result.items.length} recent items`
      );
      return result;
    } catch (error) {
      logger.error(`[RECENCY_STRATEGY] Search failed:`, error);
      return {
        items: [],
        totalCount: 0,
        searchTime: Date.now() - startTime,
        strategy: this.name,
      };
    }
  }

  private applyRecencyScoring(items: ContextItem[]): ContextItem[] {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    return items.map((item) => {
      const age = now - item.timestamp.getTime();
      const normalizedAge = Math.min(age / maxAge, 1.0); // Normalize to 0-1

      // Recency score: 1.0 for brand new, declining to 0.1 for old items
      const recencyScore = Math.max(0.1, 1.0 - normalizedAge);

      // Combine with original relevance but weight recency heavily
      const combinedScore = item.relevanceScore * 0.3 + recencyScore * 0.7;

      return {
        ...item,
        relevanceScore: combinedScore,
      };
    });
  }
}
