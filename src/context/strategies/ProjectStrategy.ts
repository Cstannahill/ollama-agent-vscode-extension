import { logger } from "../../utils/logger";
import {
  ContextQuery,
  ContextSearchResult,
  ContextStrategy,
  ContextType,
} from "../types";
import { ChromaContextDB } from "../storage/ChromaContextDB";

/**
 * Strategy that focuses on project-specific context and patterns
 */
export class ProjectStrategy implements ContextStrategy {
  public name = "project";
  public priority = 4;

  private contextDB: ChromaContextDB;

  constructor(contextDB: ChromaContextDB) {
    this.contextDB = contextDB;
  }

  public canHandle(query: ContextQuery): boolean {
    // Handle queries that are project-specific or include project context types
    return (
      query.projectId !== undefined ||
      Boolean(query.types && query.types.includes(ContextType.PROJECT))
    );
  }

  public async search(query: ContextQuery): Promise<ContextSearchResult> {
    const startTime = Date.now();

    try {
      logger.debug(
        `[PROJECT_STRATEGY] Searching with project strategy: "${
          query.query || "undefined"
        }"`
      );

      // Enhance query to prioritize project context
      const enhancedQuery = {
        ...query,
        types: query.types || [
          ContextType.PROJECT,
          ContextType.LONG_TERM,
          ContextType.TASK,
        ],
      };

      // Get base results from database
      const items = await this.contextDB.search(enhancedQuery);

      // Apply project-specific scoring
      const scoredItems = this.applyProjectScoring(items, query);

      // Sort by project relevance
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
        `[PROJECT_STRATEGY] Found ${result.items.length} project-relevant items`
      );
      return result;
    } catch (error) {
      logger.error(`[PROJECT_STRATEGY] Search failed:`, error);
      return {
        items: [],
        totalCount: 0,
        searchTime: Date.now() - startTime,
        strategy: this.name,
      };
    }
  }

  private applyProjectScoring(items: any[], query: ContextQuery): any[] {
    return items.map((item) => {
      let score = item.relevanceScore;

      // Boost items from the same project
      if (query.projectId && item.projectId === query.projectId) {
        score += 0.4;
      }

      // Boost project-type context
      if (item.type === ContextType.PROJECT) {
        score += 0.3;
      }

      // Boost long-term patterns that might apply to project
      if (item.type === ContextType.LONG_TERM) {
        score += 0.2;
      }

      // Boost items with project-related tags
      const projectTags = item.tags.filter(
        (tag: string) =>
          tag.includes("project") ||
          tag.includes("architecture") ||
          tag.includes("pattern")
      );
      score += projectTags.length * 0.1;

      return {
        ...item,
        relevanceScore: Math.min(score, 1.0),
      };
    });
  }
}
