import { logger } from '../utils/logger';
import {
  ContextItem,
  ContextType,
  ContextSource,
  ContextPriority,
  LearningPattern
} from './types';
import { ChromaContextDB } from './storage/ChromaContextDB';

export interface ConsolidatedMemory {
  id: string;
  content: string;
  type: 'pattern' | 'technique' | 'knowledge';
  sourceContextIds: string[];
  consolidationDate: Date;
  usageCount: number;
  effectiveness: number;
}

/**
 * Manages long-term memory and cross-project learning patterns
 */
export class LongTermMemory {
  private contextDB: ChromaContextDB;
  private initialized = false;
  private patternCache = new Map<string, LearningPattern>();
  private consolidationThreshold = 3; // Minimum frequency to consider a pattern

  constructor(contextDB: ChromaContextDB) {
    this.contextDB = contextDB;
  }

  /**
   * Initialize long-term memory system
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('[LONG_TERM_MEMORY] Already initialized');
      return;
    }

    try {
      logger.info('[LONG_TERM_MEMORY] Initializing long-term memory system...');
      
      // Load existing patterns into cache
      await this.loadExistingPatterns();
      
      this.initialized = true;
      logger.info('[LONG_TERM_MEMORY] Long-term memory system initialized');

    } catch (error) {
      logger.error('[LONG_TERM_MEMORY] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Store a learning experience for future pattern extraction
   */
  public async recordLearning(
    experience: string,
    category: 'success' | 'failure' | 'technique' | 'antipattern',
    context: string,
    projectId?: string,
    tags: string[] = []
  ): Promise<void> {
    try {
      logger.debug(`[LONG_TERM_MEMORY] Recording learning: ${category}`);

      const contextItem: ContextItem = {
        id: `learning_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: ContextType.LONG_TERM,
        source: this.getCategorySource(category),
        content: experience,
        metadata: {
          category,
          context,
          recordedAt: new Date(),
          projectId,
          learningType: 'experience'
        },
        relevanceScore: 0.6,
        priority: ContextPriority.MEDIUM,
        timestamp: new Date(),
        tags: ['learning', `category:${category}`, ...tags],
        projectId
      };

      await this.contextDB.store(contextItem);

      // Update or create pattern
      await this.updatePattern(experience, category, context, projectId, tags);

      logger.debug(`[LONG_TERM_MEMORY] Learning recorded: ${contextItem.id}`);

    } catch (error) {
      logger.error('[LONG_TERM_MEMORY] Failed to record learning:', error);
      throw error;
    }
  }

  /**
   * Get relevant long-term patterns for current context
   */
  public async getRelevantPatterns(
    query: string,
    context?: string,
    projectId?: string,
    maxResults: number = 10
  ): Promise<ContextItem[]> {
    try {
      logger.debug(`[LONG_TERM_MEMORY] Getting relevant patterns: "${query}"`);

      const searchQuery = {
        query,
        types: [ContextType.LONG_TERM],
        projectId,
        maxResults
      };

      const results = await this.contextDB.search(searchQuery);

      // Apply long-term memory specific scoring
      const scoredResults = this.applyLongTermScoring(results, query, context);

      // Sort by relevance
      scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

      logger.debug(`[LONG_TERM_MEMORY] Found ${scoredResults.length} relevant patterns`);
      return scoredResults;

    } catch (error) {
      logger.error('[LONG_TERM_MEMORY] Failed to get relevant patterns:', error);
      return [];
    }
  }

  /**
   * Get success patterns for similar contexts
   */
  public async getSuccessPatterns(context: string, tags: string[] = []): Promise<ContextItem[]> {
    try {
      logger.debug(`[LONG_TERM_MEMORY] Getting success patterns for: ${context}`);

      const searchQuery = {
        query: context,
        types: [ContextType.LONG_TERM],
        sources: [ContextSource.SUCCESS_PATTERN],
        maxResults: 5
      };

      const results = await this.contextDB.search(searchQuery);

      // Filter and boost results based on tag similarity
      const relevantResults = results.filter(item => {
        const commonTags = item.tags.filter(tag => tags.includes(tag));
        return commonTags.length > 0 || item.content.toLowerCase().includes(context.toLowerCase());
      });

      logger.debug(`[LONG_TERM_MEMORY] Found ${relevantResults.length} success patterns`);
      return relevantResults;

    } catch (error) {
      logger.error('[LONG_TERM_MEMORY] Failed to get success patterns:', error);
      return [];
    }
  }

  /**
   * Get failure patterns to avoid
   */
  public async getFailurePatterns(context: string, tags: string[] = []): Promise<ContextItem[]> {
    try {
      logger.debug(`[LONG_TERM_MEMORY] Getting failure patterns for: ${context}`);

      const searchQuery = {
        query: context,
        types: [ContextType.LONG_TERM],
        sources: [ContextSource.ERROR_RECOVERY],
        maxResults: 5
      };

      const results = await this.contextDB.search(searchQuery);

      // Filter based on relevance to current context
      const relevantResults = results.filter(item => {
        const commonTags = item.tags.filter(tag => tags.includes(tag));
        return commonTags.length > 0 || item.content.toLowerCase().includes(context.toLowerCase());
      });

      logger.debug(`[LONG_TERM_MEMORY] Found ${relevantResults.length} failure patterns`);
      return relevantResults;

    } catch (error) {
      logger.error('[LONG_TERM_MEMORY] Failed to get failure patterns:', error);
      return [];
    }
  }

  /**
   * Consolidate learning patterns into actionable knowledge
   */
  public async consolidatePatterns(): Promise<void> {
    try {
      logger.info('[LONG_TERM_MEMORY] Starting pattern consolidation...');

      // Get patterns that appear frequently
      const frequentPatterns = Array.from(this.patternCache.values())
        .filter(pattern => pattern.frequency >= this.consolidationThreshold);

      logger.debug(`[LONG_TERM_MEMORY] Found ${frequentPatterns.length} patterns for consolidation`);

      for (const pattern of frequentPatterns) {
        if (pattern) {
          await this.consolidatePattern(pattern);
        }
      }

      logger.info('[LONG_TERM_MEMORY] Pattern consolidation completed');

    } catch (error) {
      logger.error('[LONG_TERM_MEMORY] Failed to consolidate patterns:', error);
      throw error;
    }
  }

  /**
   * Clean up old or ineffective memories
   */
  public async cleanupMemories(): Promise<void> {
    try {
      logger.info('[LONG_TERM_MEMORY] Starting memory cleanup...');

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 90); // Keep memories from last 90 days

      // Remove old, unused memories - ChromaDB cleanup doesn't take parameters
      await this.contextDB.cleanup();

      // Clear pattern cache for refresh
      this.patternCache.clear();
      await this.loadExistingPatterns();

      logger.info('[LONG_TERM_MEMORY] Memory cleanup completed');

    } catch (error) {
      logger.error('[LONG_TERM_MEMORY] Failed to cleanup memories:', error);
      throw error;
    }
  }

  /**
   * Add context item to long-term memory
   */
  public async addContext(item: ContextItem): Promise<void> {
    try {
      logger.debug(`[LONG_TERM_MEMORY] Adding context item: ${item.id}`);
      await this.contextDB.store(item);
    } catch (error) {
      logger.error('[LONG_TERM_MEMORY] Failed to add context:', error);
      throw error;
    }
  }

  /**
   * Get long-term memory statistics
   */
  public async getStats(): Promise<any> {
    try {
      const totalPatterns = this.patternCache.size;
      const frequentPatterns = Array.from(this.patternCache.values())
        .filter(p => p.frequency >= this.consolidationThreshold).length;

      const categoryStats = Array.from(this.patternCache.values())
        .reduce((acc, pattern) => {
          acc[pattern.category] = (acc[pattern.category] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

      return {
        totalPatterns,
        frequentPatterns,
        categoryStats,
        consolidationThreshold: this.consolidationThreshold,
        initialized: this.initialized
      };
    } catch (error) {
      logger.error('[LONG_TERM_MEMORY] Failed to get stats:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async loadExistingPatterns(): Promise<void> {
    try {
      // Load learning patterns from database
      const patterns = await this.contextDB.getLearningPatterns();
      
      for (const pattern of patterns) {
        this.patternCache.set(pattern.id, pattern);
      }

      logger.debug(`[LONG_TERM_MEMORY] Loaded ${patterns.length} existing patterns`);

    } catch (error) {
      logger.debug('[LONG_TERM_MEMORY] Failed to load existing patterns:', error);
    }
  }

  private async updatePattern(
    experience: string,
    category: 'success' | 'failure' | 'technique' | 'antipattern',
    context: string,
    projectId?: string,
    tags: string[] = []
  ): Promise<void> {
    // Create a pattern key based on experience content
    const patternKey = this.generatePatternKey(experience, category);
    
    const existingPattern = this.patternCache.get(patternKey);
    
    let pattern: LearningPattern;
    
    if (existingPattern) {
      // Update existing pattern
      existingPattern.frequency++;
      existingPattern.lastSeen = new Date();
      if (projectId && !existingPattern.projects.includes(projectId)) {
        existingPattern.projects.push(projectId);
      }
      // Merge tags
      if (existingPattern.tags) {
        const newTags = tags.filter(tag => !existingPattern.tags.includes(tag));
        existingPattern.tags.push(...newTags);
      } else {
        existingPattern.tags = [...tags];
      }
      pattern = existingPattern;
    } else {
      // Create new pattern
      pattern = {
        id: patternKey,
        pattern: experience,
        category,
        context,
        frequency: 1,
        lastSeen: new Date(),
        projects: projectId ? [projectId] : [],
        tags,
        confidence: 0.5 // Initial confidence
      };
    }

    // Calculate confidence based on frequency and project diversity
    if (pattern) {
      pattern.confidence = Math.min(
        0.1 + (pattern.frequency * 0.1) + (pattern.projects.length * 0.05),
        1.0
      );

      this.patternCache.set(patternKey, pattern);

      // Store updated pattern in database
      await this.contextDB.storeLearningPattern(pattern);
    }
  }

  private async consolidatePattern(pattern: LearningPattern): Promise<void> {
    try {
      // Create consolidated memory from pattern
      const consolidatedMemory: ConsolidatedMemory = {
        id: `consolidated_${pattern.id}`,
        content: this.generateConsolidatedContent(pattern),
        type: this.getConsolidationType(pattern.category),
        sourceContextIds: [], // Could track source context items
        consolidationDate: new Date(),
        usageCount: 0,
        effectiveness: pattern.confidence
      };

      // Store as high-priority long-term context
      const contextItem: ContextItem = {
        id: consolidatedMemory.id,
        type: ContextType.LONG_TERM,
        source: ContextSource.CONSOLIDATED_LEARNING,
        content: consolidatedMemory.content,
        metadata: {
          consolidatedMemory,
          sourcePattern: pattern,
          consolidationType: consolidatedMemory.type
        },
        relevanceScore: 0.8,
        priority: ContextPriority.HIGH,
        timestamp: new Date(),
        tags: ['consolidated', `type:${consolidatedMemory.type}`, ...pattern.tags]
      };

      await this.contextDB.store(contextItem);

      logger.debug(`[LONG_TERM_MEMORY] Consolidated pattern: ${pattern.id}`);

    } catch (error) {
      logger.error(`[LONG_TERM_MEMORY] Failed to consolidate pattern ${pattern.id}:`, error);
    }
  }

  private generatePatternKey(experience: string, category: string): string {
    // Create a consistent key for similar experiences
    const normalized = experience.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    const hash = Buffer.from(`${category}:${normalized}`).toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 16);
    
    return `pattern_${hash}`;
  }

  private generateConsolidatedContent(pattern: LearningPattern): string {
    const projectContext = pattern.projects.length > 1 
      ? `across ${pattern.projects.length} projects` 
      : 'in project context';

    return `${pattern.category.toUpperCase()}: ${pattern.pattern} (observed ${pattern.frequency} times ${projectContext}, confidence: ${Math.round(pattern.confidence * 100)}%)`;
  }

  private getConsolidationType(category: string): 'pattern' | 'technique' | 'knowledge' {
    switch (category) {
      case 'success':
      case 'failure':
        return 'pattern';
      case 'technique':
        return 'technique';
      case 'antipattern':
        return 'knowledge';
      default:
        return 'knowledge';
    }
  }

  private getCategorySource(category: string): ContextSource {
    switch (category) {
      case 'success':
        return ContextSource.SUCCESS_PATTERN;
      case 'failure':
        return ContextSource.ERROR_RECOVERY;
      case 'technique':
        return ContextSource.LEARNING;
      case 'antipattern':
        return ContextSource.LEARNING;
      default:
        return ContextSource.LEARNING;
    }
  }

  private applyLongTermScoring(items: ContextItem[], query: string, context?: string): ContextItem[] {
    const queryLower = query.toLowerCase();
    const contextLower = context?.toLowerCase() || '';

    return items.map(item => {
      let score = item.relevanceScore;

      // Boost consolidated learnings
      if (item.source === ContextSource.CONSOLIDATED_LEARNING) {
        score += 0.3;
      }

      // Boost success patterns
      if (item.source === ContextSource.SUCCESS_PATTERN) {
        score += 0.2;
      }

      // Boost items with high confidence
      if (item.metadata?.consolidatedMemory?.effectiveness > 0.7) {
        score += 0.2;
      }

      // Boost patterns seen across multiple projects
      if (item.metadata?.sourcePattern?.projects?.length > 1) {
        score += 0.15;
      }

      // Context similarity boost
      if (context && item.content.toLowerCase().includes(contextLower)) {
        score += 0.2;
      }

      // Query term matching
      const contentLower = item.content.toLowerCase();
      const queryTerms = queryLower.split(/\s+/).filter(term => term.length > 2);
      const matchingTerms = queryTerms.filter(term => contentLower.includes(term));
      score += (matchingTerms.length / queryTerms.length) * 0.2;

      return {
        ...item,
        relevanceScore: Math.min(score, 1.0)
      };
    });
  }
}