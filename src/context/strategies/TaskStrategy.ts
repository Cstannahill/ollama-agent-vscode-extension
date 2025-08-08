import { logger } from "../../utils/logger";
import {
  ContextQuery,
  ContextSearchResult,
  ContextStrategy,
  ContextType,
  ContextSource,
} from "../types";
import { ChromaContextDB } from "../storage/ChromaContextDB";

/**
 * Strategy that focuses on task progression and failure recovery
 */
export class TaskStrategy implements ContextStrategy {
  public name = "task";
  public priority = 5;

  private contextDB: ChromaContextDB;

  constructor(contextDB: ChromaContextDB) {
    this.contextDB = contextDB;
  }

  public canHandle(query: ContextQuery): boolean {
    // Handle task-specific queries or when task context is requested
    return (
      query.taskId !== undefined ||
      Boolean(query.types && query.types.includes(ContextType.TASK))
    );
  }

  public async search(query: ContextQuery): Promise<ContextSearchResult> {
    const startTime = Date.now();

    try {
      logger.debug(
        `[TASK_STRATEGY] Searching with task strategy: "${
          query.query || "undefined"
        }"`
      );

      // Get task-specific context first
      const taskItems = await this.getTaskSpecificContext(query);

      // Get related patterns (success/failure)
      const patternItems = await this.getRelatedPatterns(query);

      // Combine and score
      const allItems = [...taskItems, ...patternItems];
      const scoredItems = this.applyTaskScoring(allItems, query);

      // Sort by task relevance
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
        `[TASK_STRATEGY] Found ${result.items.length} task-relevant items`
      );
      return result;
    } catch (error) {
      logger.error(`[TASK_STRATEGY] Search failed:`, error);
      return {
        items: [],
        totalCount: 0,
        searchTime: Date.now() - startTime,
        strategy: this.name,
      };
    }
  }

  private async getTaskSpecificContext(query: ContextQuery): Promise<any[]> {
    const taskQuery = {
      ...query,
      types: [ContextType.TASK],
    };

    return await this.contextDB.search(taskQuery);
  }

  private async getRelatedPatterns(query: ContextQuery): Promise<any[]> {
    // Search for success patterns that might help
    const successQuery = {
      ...query,
      sources: [ContextSource.SUCCESS_PATTERN],
      maxResults: 10,
    };

    // Search for error patterns to avoid
    const errorQuery = {
      ...query,
      sources: [ContextSource.ERROR_RECOVERY],
      maxResults: 10,
    };

    const [successItems, errorItems] = await Promise.all([
      this.contextDB.search(successQuery),
      this.contextDB.search(errorQuery),
    ]);

    return [...successItems, ...errorItems];
  }

  private applyTaskScoring(items: any[], query: ContextQuery): any[] {
    return items.map((item) => {
      let score = item.relevanceScore;

      // Highest priority for current task context
      if (query.taskId && item.taskId === query.taskId) {
        score += 0.5;
      }

      // High priority for success patterns
      if (item.source === ContextSource.SUCCESS_PATTERN) {
        score += 0.4;
      }

      // Medium priority for error patterns (to avoid)
      if (item.source === ContextSource.ERROR_RECOVERY) {
        score += 0.3;
      }

      // Boost recent task actions
      if (item.type === ContextType.TASK) {
        const ageInMinutes =
          (Date.now() - item.timestamp.getTime()) / (1000 * 60);
        if (ageInMinutes < 30) {
          // Recent within 30 minutes
          score += 0.2;
        }
      }

      // Boost items with task-related tags
      const taskTags = item.tags.filter(
        (tag: string) =>
          tag.includes("attempt") ||
          tag.includes("success") ||
          tag.includes("failure") ||
          tag.includes("pattern")
      );
      score += taskTags.length * 0.1;

      // Boost items with metadata indicating attempts or solutions
      if (item.metadata?.attempts || item.metadata?.solution) {
        score += 0.15;
      }

      return {
        ...item,
        relevanceScore: Math.min(score, 1.0),
      };
    });
  }
}
