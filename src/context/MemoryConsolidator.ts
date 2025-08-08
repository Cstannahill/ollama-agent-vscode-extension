import { logger } from '../utils/logger';
import {
  ContextItem,
  ContextType,
  ContextSource,
  ContextPriority
} from './types';
import { ChromaContextDB } from './storage/ChromaContextDB';
import { LongTermMemory } from './LongTermMemory';
import { LearningPattern } from './types';

export interface ConsolidationJob {
  id: string;
  type: 'pattern_extraction' | 'knowledge_distillation' | 'failure_analysis';
  contextItems: ContextItem[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  results?: ConsolidationResult[];
}

export interface ConsolidationResult {
  id: string;
  type: 'pattern' | 'insight' | 'technique' | 'antipattern';
  title: string;
  description: string;
  evidence: string[];
  confidence: number;
  frequency: number;
  applicability: string[];
  tags: string[];
}

/**
 * Handles consolidation of context items into learnable patterns and knowledge
 */
export class MemoryConsolidator {
  private contextDB: ChromaContextDB;
  private longTermMemory: LongTermMemory;
  private initialized = false;
  private consolidationQueue: ConsolidationJob[] = [];
  private isProcessing = false;

  constructor(contextDB: ChromaContextDB, longTermMemory: LongTermMemory) {
    this.contextDB = contextDB;
    this.longTermMemory = longTermMemory;
  }

  /**
   * Initialize the memory consolidator
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('[MEMORY_CONSOLIDATOR] Already initialized');
      return;
    }

    try {
      logger.info('[MEMORY_CONSOLIDATOR] Initializing memory consolidator...');
      
      // Start background processing
      this.startBackgroundProcessing();
      
      this.initialized = true;
      logger.info('[MEMORY_CONSOLIDATOR] Memory consolidator initialized');

    } catch (error) {
      logger.error('[MEMORY_CONSOLIDATOR] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Schedule consolidation of context items
   */
  public async scheduleConsolidation(
    contextItems: ContextItem[],
    type: 'pattern_extraction' | 'knowledge_distillation' | 'failure_analysis' = 'pattern_extraction'
  ): Promise<string> {
    try {
      const jobId = `consolidation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const job: ConsolidationJob = {
        id: jobId,
        type,
        contextItems,
        status: 'pending',
        createdAt: new Date()
      };

      this.consolidationQueue.push(job);
      
      logger.debug(`[MEMORY_CONSOLIDATOR] Scheduled consolidation job: ${jobId} (${contextItems.length} items)`);
      
      // Trigger processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }

      return jobId;

    } catch (error) {
      logger.error('[MEMORY_CONSOLIDATOR] Failed to schedule consolidation:', error);
      throw error;
    }
  }

  /**
   * Extract patterns from successful task completions
   */
  public async extractSuccessPatterns(contextItems: ContextItem[]): Promise<ConsolidationResult[]> {
    try {
      logger.debug(`[MEMORY_CONSOLIDATOR] Extracting success patterns from ${contextItems.length} items`);

      const successItems = contextItems.filter(item => 
        item.source === ContextSource.SUCCESS_PATTERN ||
        item.tags.includes('success') ||
        item.tags.includes('completed')
      );

      const patterns: ConsolidationResult[] = [];

      // Group similar successful outcomes
      const groupedOutcomes = this.groupSimilarItems(successItems);

      for (const group of groupedOutcomes) {
        if (group.length >= 2) { // Need at least 2 occurrences to be a pattern
          const pattern = await this.createSuccessPattern(group);
          patterns.push(pattern);
        }
      }

      logger.debug(`[MEMORY_CONSOLIDATOR] Extracted ${patterns.length} success patterns`);
      return patterns;

    } catch (error) {
      logger.error('[MEMORY_CONSOLIDATOR] Failed to extract success patterns:', error);
      return [];
    }
  }

  /**
   * Analyze failure patterns and create recovery strategies
   */
  public async analyzeFailurePatterns(contextItems: ContextItem[]): Promise<ConsolidationResult[]> {
    try {
      logger.debug(`[MEMORY_CONSOLIDATOR] Analyzing failure patterns from ${contextItems.length} items`);

      const failureItems = contextItems.filter(item => 
        item.source === ContextSource.ERROR_RECOVERY ||
        item.tags.includes('error') ||
        item.tags.includes('failure') ||
        item.tags.includes('abandoned')
      );

      const patterns: ConsolidationResult[] = [];

      // Group similar failures
      const groupedFailures = this.groupSimilarItems(failureItems);

      for (const group of groupedFailures) {
        if (group.length >= 2) { // Need at least 2 occurrences to be a pattern
          const antipattern = await this.createFailurePattern(group);
          patterns.push(antipattern);
        }
      }

      logger.debug(`[MEMORY_CONSOLIDATOR] Analyzed ${patterns.length} failure patterns`);
      return patterns;

    } catch (error) {
      logger.error('[MEMORY_CONSOLIDATOR] Failed to analyze failure patterns:', error);
      return [];
    }
  }

  /**
   * Extract reusable techniques from context items
   */
  public async extractTechniques(contextItems: ContextItem[]): Promise<ConsolidationResult[]> {
    try {
      logger.debug(`[MEMORY_CONSOLIDATOR] Extracting techniques from ${contextItems.length} items`);

      const techniqueItems = contextItems.filter(item => 
        item.source === ContextSource.TOOL_USAGE ||
        item.source === ContextSource.CODE_ANALYSIS ||
        item.tags.includes('technique') ||
        item.tags.includes('method')
      );

      const techniques: ConsolidationResult[] = [];

      // Look for repeated tool usage patterns
      const toolUsagePatterns = this.analyzeTechnicalPatterns(techniqueItems);
      techniques.push(...toolUsagePatterns);

      logger.debug(`[MEMORY_CONSOLIDATOR] Extracted ${techniques.length} techniques`);
      return techniques;

    } catch (error) {
      logger.error('[MEMORY_CONSOLIDATOR] Failed to extract techniques:', error);
      return [];
    }
  }

  /**
   * Consolidate insights across different context types
   */
  public async consolidateInsights(contextItems: ContextItem[]): Promise<ConsolidationResult[]> {
    try {
      logger.debug(`[MEMORY_CONSOLIDATOR] Consolidating insights from ${contextItems.length} items`);

      const insights: ConsolidationResult[] = [];

      // Cross-context analysis
      const crossContextPatterns = this.analyzeCrossContextPatterns(contextItems);
      insights.push(...crossContextPatterns);

      // Temporal patterns
      const temporalPatterns = this.analyzeTemporalPatterns(contextItems);
      insights.push(...temporalPatterns);

      logger.debug(`[MEMORY_CONSOLIDATOR] Consolidated ${insights.length} insights`);
      return insights;

    } catch (error) {
      logger.error('[MEMORY_CONSOLIDATOR] Failed to consolidate insights:', error);
      return [];
    }
  }

  /**
   * Get consolidation job status
   */
  public getJobStatus(jobId: string): ConsolidationJob | null {
    return this.consolidationQueue.find(job => job.id === jobId) || null;
  }

  /**
   * Get consolidator statistics
   */
  public async getStats(): Promise<any> {
    try {
      const queueLength = this.consolidationQueue.length;
      const completedJobs = this.consolidationQueue.filter(job => job.status === 'completed').length;
      const failedJobs = this.consolidationQueue.filter(job => job.status === 'failed').length;

      return {
        queueLength,
        completedJobs,
        failedJobs,
        isProcessing: this.isProcessing,
        initialized: this.initialized
      };
    } catch (error) {
      logger.error('[MEMORY_CONSOLIDATOR] Failed to get stats:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private startBackgroundProcessing(): void {
    // Process queue every 30 seconds
    setInterval(() => {
      if (!this.isProcessing && this.consolidationQueue.length > 0) {
        this.processQueue();
      }
    }, 30000);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    try {
      while (this.consolidationQueue.length > 0) {
        const job = this.consolidationQueue.find(j => j.status === 'pending');
        if (!job) break;

        await this.processJob(job);
      }
    } catch (error) {
      logger.error('[MEMORY_CONSOLIDATOR] Error processing queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processJob(job: ConsolidationJob): Promise<void> {
    try {
      logger.debug(`[MEMORY_CONSOLIDATOR] Processing job: ${job.id}`);
      
      job.status = 'processing';
      let results: ConsolidationResult[] = [];

      switch (job.type) {
        case 'pattern_extraction':
          results = await this.extractSuccessPatterns(job.contextItems);
          break;
        case 'failure_analysis':
          results = await this.analyzeFailurePatterns(job.contextItems);
          break;
        case 'knowledge_distillation':
          results = await this.consolidateInsights(job.contextItems);
          break;
      }

      // Store results as long-term memory
      for (const result of results) {
        await this.storeConsolidationResult(result);
      }

      job.results = results;
      job.status = 'completed';
      job.completedAt = new Date();

      logger.debug(`[MEMORY_CONSOLIDATOR] Completed job: ${job.id} (${results.length} results)`);

    } catch (error) {
      logger.error(`[MEMORY_CONSOLIDATOR] Failed to process job ${job.id}:`, error);
      job.status = 'failed';
    }
  }

  private groupSimilarItems(items: ContextItem[]): ContextItem[][] {
    const groups: ContextItem[][] = [];
    const processed = new Set<string>();

    for (const item of items) {
      if (processed.has(item.id)) continue;

      const similarItems = [item];
      processed.add(item.id);

      // Find similar items based on content, tags, or metadata
      for (const otherItem of items) {
        if (processed.has(otherItem.id)) continue;

        if (this.areItemsSimilar(item, otherItem)) {
          similarItems.push(otherItem);
          processed.add(otherItem.id);
        }
      }

      if (similarItems.length > 1) {
        groups.push(similarItems);
      }
    }

    return groups;
  }

  private areItemsSimilar(item1: ContextItem, item2: ContextItem): boolean {
    // Check tag overlap
    const commonTags = item1.tags.filter(tag => item2.tags.includes(tag));
    const tagSimilarity = commonTags.length / Math.max(item1.tags.length, item2.tags.length);

    // Check content similarity (simple word overlap)
    const words1 = item1.content.toLowerCase().split(/\s+/);
    const words2 = item2.content.toLowerCase().split(/\s+/);
    const commonWords = words1.filter(word => word.length > 3 && words2.includes(word));
    const contentSimilarity = commonWords.length / Math.max(words1.length, words2.length);

    // Items are similar if they have good tag or content overlap
    return tagSimilarity > 0.3 || contentSimilarity > 0.2;
  }

  private async createSuccessPattern(items: ContextItem[]): Promise<ConsolidationResult> {
    const commonTags = this.extractCommonTags(items);
    const evidence = items.map(item => item.content);
    
    return {
      id: `success_pattern_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: 'pattern',
      title: `Success Pattern: ${this.generatePatternTitle(items)}`,
      description: this.generateSuccessDescription(items),
      evidence,
      confidence: this.calculateConfidence(items),
      frequency: items.length,
      applicability: this.extractApplicability(items),
      tags: ['success', 'pattern', ...commonTags]
    };
  }

  private async createFailurePattern(items: ContextItem[]): Promise<ConsolidationResult> {
    const commonTags = this.extractCommonTags(items);
    const evidence = items.map(item => item.content);
    
    return {
      id: `failure_pattern_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: 'antipattern',
      title: `Failure Pattern: ${this.generatePatternTitle(items)}`,
      description: this.generateFailureDescription(items),
      evidence,
      confidence: this.calculateConfidence(items),
      frequency: items.length,
      applicability: this.extractApplicability(items),
      tags: ['failure', 'antipattern', ...commonTags]
    };
  }

  private analyzeTechnicalPatterns(items: ContextItem[]): ConsolidationResult[] {
    const patterns: ConsolidationResult[] = [];
    
    // Group by tool usage
    const toolGroups = new Map<string, ContextItem[]>();
    
    for (const item of items) {
      const toolUsed = this.extractToolFromItem(item);
      if (toolUsed) {
        if (!toolGroups.has(toolUsed)) {
          toolGroups.set(toolUsed, []);
        }
        toolGroups.get(toolUsed)!.push(item);
      }
    }

    // Create technique patterns for frequently used tools
    for (const [tool, toolItems] of toolGroups) {
      if (toolItems.length >= 3) { // Used at least 3 times
        patterns.push({
          id: `technique_${tool}_${Date.now()}`,
          type: 'technique',
          title: `${tool} Usage Pattern`,
          description: `Effective usage of ${tool} based on ${toolItems.length} observations`,
          evidence: toolItems.map(item => item.content),
          confidence: Math.min(0.3 + (toolItems.length * 0.1), 0.9),
          frequency: toolItems.length,
          applicability: this.extractApplicability(toolItems),
          tags: ['technique', 'tool', `tool:${tool}`]
        });
      }
    }

    return patterns;
  }

  private analyzeCrossContextPatterns(items: ContextItem[]): ConsolidationResult[] {
    const patterns: ConsolidationResult[] = [];
    
    // Group by context type combinations
    const typeGroups = new Map<string, ContextItem[]>();
    
    for (const item of items) {
      const key = `${item.type}:${item.source}`;
      if (!typeGroups.has(key)) {
        typeGroups.set(key, []);
      }
      typeGroups.get(key)!.push(item);
    }

    // Look for patterns across different context types
    for (const [contextKey, contextItems] of typeGroups) {
      if (contextItems.length >= 5) { // Need significant data
        patterns.push({
          id: `cross_context_${contextKey}_${Date.now()}`,
          type: 'insight',
          title: `Cross-Context Pattern: ${contextKey}`,
          description: `Pattern observed across ${contextItems.length} contexts of type ${contextKey}`,
          evidence: contextItems.slice(0, 5).map(item => item.content), // Sample evidence
          confidence: Math.min(0.4 + (contextItems.length * 0.05), 0.8),
          frequency: contextItems.length,
          applicability: ['general'],
          tags: ['cross-context', 'insight', contextKey.split(':')[0]]
        });
      }
    }

    return patterns;
  }

  private analyzeTemporalPatterns(items: ContextItem[]): ConsolidationResult[] {
    const patterns: ConsolidationResult[] = [];
    
    // Sort by timestamp
    const sortedItems = items.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Look for sequential patterns
    if (sortedItems.length >= 3) {
      const sequences = this.findSequentialPatterns(sortedItems);
      patterns.push(...sequences);
    }

    return patterns;
  }

  private findSequentialPatterns(items: ContextItem[]): ConsolidationResult[] {
    // Simplified sequential pattern detection
    // In a real implementation, this would be more sophisticated
    return [];
  }

  private async storeConsolidationResult(result: ConsolidationResult): Promise<void> {
    const contextItem: ContextItem = {
      id: result.id,
      type: ContextType.LONG_TERM,
      source: ContextSource.CONSOLIDATED_LEARNING,
      content: `${result.title}: ${result.description}`,
      metadata: {
        consolidationResult: result,
        evidence: result.evidence,
        confidence: result.confidence,
        frequency: result.frequency
      },
      relevanceScore: result.confidence,
      priority: result.confidence > 0.7 ? ContextPriority.HIGH : ContextPriority.MEDIUM,
      timestamp: new Date(),
      tags: result.tags
    };

    await this.contextDB.store(contextItem);

    // Also record as learning in long-term memory
    await this.longTermMemory.recordLearning(
      result.description,
      result.type === 'antipattern' ? 'failure' : 'success',
      result.title,
      undefined,
      result.tags
    );
  }

  private extractCommonTags(items: ContextItem[]): string[] {
    const tagCounts = new Map<string, number>();
    
    for (const item of items) {
      for (const tag of item.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    // Return tags that appear in at least half the items
    const threshold = Math.ceil(items.length / 2);
    return Array.from(tagCounts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([tag]) => tag);
  }

  private generatePatternTitle(items: ContextItem[]): string {
    const commonTags = this.extractCommonTags(items);
    if (commonTags.length > 0) {
      return commonTags.filter(tag => !['success', 'failure', 'pattern'].includes(tag))
        .slice(0, 2)
        .join(' + ') || 'General Pattern';
    }
    return 'General Pattern';
  }

  private generateSuccessDescription(items: ContextItem[]): string {
    return `Successful approach observed in ${items.length} similar contexts. Key factors include consistent application and positive outcomes.`;
  }

  private generateFailureDescription(items: ContextItem[]): string {
    return `Common failure pattern observed in ${items.length} contexts. Avoid this approach or apply with caution.`;
  }

  private calculateConfidence(items: ContextItem[]): number {
    const avgRelevance = items.reduce((sum, item) => sum + item.relevanceScore, 0) / items.length;
    const frequencyBoost = Math.min(items.length * 0.1, 0.3);
    return Math.min(avgRelevance + frequencyBoost, 1.0);
  }

  private extractApplicability(items: ContextItem[]): string[] {
    const applicability = new Set<string>();
    
    for (const item of items) {
      // Extract languages, frameworks, tools from tags
      for (const tag of item.tags) {
        if (tag.startsWith('lang:') || tag.startsWith('framework:') || tag.startsWith('tool:')) {
          applicability.add(tag);
        }
      }
    }

    return Array.from(applicability);
  }

  private extractToolFromItem(item: ContextItem): string | null {
    // Look for tool usage in tags or metadata
    for (const tag of item.tags) {
      if (tag.startsWith('tool:')) {
        return tag.substring(5);
      }
    }
    
    if (item.metadata?.tool) {
      return item.metadata.tool;
    }

    return null;
  }
}