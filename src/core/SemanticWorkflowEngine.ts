import * as vscode from "vscode";
import { ContextManager } from "./ContextManager";
import { ContextItem, ContextQuery, ContextType, ContextSource, ContextPriority } from "../context/types";
import { VectorDatabase, DocumentChunk, SearchResult } from "../documentation/VectorDatabase";
import { FoundationPipeline } from "./foundation/FoundationPipeline";
import { FoundationPipelineResult } from "./foundation/IFoundationAgent";
import { logger } from "../utils/logger";

export interface SemanticWorkflowQuery {
  intent: string;
  context?: string;
  priority?: ContextPriority;
  workflowType?: "code_analysis" | "documentation" | "problem_solving" | "task_execution";
  similarityThreshold?: number;
  maxResults?: number;
  includeRecentActivity?: boolean;
  includeProjectContext?: boolean;
  includeDocumentation?: boolean;
}

export interface SemanticWorkflowResult {
  query: SemanticWorkflowQuery;
  contextItems: ContextItem[];
  documentationChunks: DocumentChunk[];
  relatedWorkflows: WorkflowPattern[];
  semanticSimilarity: number;
  confidence: number;
  suggestedActions: WorkflowAction[];
  executionStrategy: string;
}

export interface WorkflowPattern {
  id: string;
  name: string;
  description: string;
  contextTypes: ContextType[];
  sources: ContextSource[];
  frequency: number;
  successRate: number;
  averageExecutionTime: number;
  commonParameters: Record<string, any>;
  lastUsed: Date;
  tags: string[];
}

export interface WorkflowAction {
  type: "tool_execution" | "context_search" | "documentation_lookup" | "code_analysis";
  description: string;
  toolName?: string;
  parameters?: Record<string, any>;
  priority: number;
  estimatedTime: number;
  confidence: number;
}

/**
 * Semantic Workflow Engine for intelligent agent workflow optimization
 * Combines context search, documentation lookup, and pattern recognition
 */
export class SemanticWorkflowEngine {
  private static instance: SemanticWorkflowEngine;
  private contextManager: ContextManager;
  private vectorDatabase: VectorDatabase;
  private workflowPatterns: Map<string, WorkflowPattern> = new Map();
  private workflowHistory: Map<string, SemanticWorkflowResult[]> = new Map();
  private initialized = false;

  private constructor() {
    this.contextManager = ContextManager.getInstance();
    this.vectorDatabase = VectorDatabase.getInstance();
  }

  static getInstance(): SemanticWorkflowEngine {
    if (!SemanticWorkflowEngine.instance) {
      SemanticWorkflowEngine.instance = new SemanticWorkflowEngine();
    }
    return SemanticWorkflowEngine.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      logger.info("[SEMANTIC_WORKFLOW] Initializing semantic workflow engine...");
      
      await this.contextManager.initialize();
      await this.vectorDatabase.initialize();
      await this.loadWorkflowPatterns();
      
      this.initialized = true;
      logger.info("[SEMANTIC_WORKFLOW] Semantic workflow engine initialized");
    } catch (error) {
      logger.error("[SEMANTIC_WORKFLOW] Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Execute semantic search across all workflow sources
   */
  async executeSemanticWorkflow(query: SemanticWorkflowQuery): Promise<SemanticWorkflowResult> {
    await this.ensureInitialized();

    try {
      logger.info(`[SEMANTIC_WORKFLOW] Executing semantic workflow: ${query.intent}`);
      const startTime = Date.now();

      // Step 1: Search context system
      const contextItems = await this.searchContextSemantically(query);
      
      // Step 2: Search documentation if requested
      const documentationChunks = query.includeDocumentation 
        ? await this.searchDocumentationSemantically(query)
        : [];

      // Step 3: Find related workflow patterns
      const relatedWorkflows = await this.findRelatedWorkflowPatterns(query);

      // Step 4: Calculate semantic similarity and confidence
      const semanticSimilarity = this.calculateSemanticSimilarity(query, contextItems, documentationChunks);
      const confidence = this.calculateConfidence(contextItems, documentationChunks, relatedWorkflows);

      // Step 5: Generate suggested actions
      const suggestedActions = await this.generateWorkflowActions(query, contextItems, documentationChunks, relatedWorkflows);

      // Step 6: Determine execution strategy
      const executionStrategy = this.determineExecutionStrategy(query, suggestedActions, confidence);

      const result: SemanticWorkflowResult = {
        query,
        contextItems,
        documentationChunks,
        relatedWorkflows,
        semanticSimilarity,
        confidence,
        suggestedActions,
        executionStrategy
      };

      // Store in history for learning
      await this.storeWorkflowResult(result);

      const executionTime = Date.now() - startTime;
      logger.info(`[SEMANTIC_WORKFLOW] Semantic workflow completed in ${executionTime}ms with confidence ${confidence.toFixed(2)}`);

      return result;
    } catch (error) {
      logger.error("[SEMANTIC_WORKFLOW] Semantic workflow failed:", error);
      throw new Error(`Semantic workflow execution failed: ${error}`);
    }
  }

  /**
   * Search context system using semantic similarity
   */
  private async searchContextSemantically(query: SemanticWorkflowQuery): Promise<ContextItem[]> {
    const contextQuery: ContextQuery = {
      query: query.intent,
      text: query.context,
      maxResults: query.maxResults || 20,
      minRelevanceScore: query.similarityThreshold || 0.3,
      minPriority: query.priority || ContextPriority.LOW
    };

    // Add workflow-specific filters
    if (query.workflowType) {
      contextQuery.tags = [query.workflowType];
    }

    if (query.includeProjectContext) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        contextQuery.projectId = workspaceFolders[0].name;
      }
    }

    if (query.includeRecentActivity) {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      contextQuery.timeRange = {
        start: oneDayAgo,
        end: new Date()
      };
    }

    const searchResult = await this.contextManager.searchContext(contextQuery);
    return searchResult.items;
  }

  /**
   * Search documentation using vector similarity
   */
  private async searchDocumentationSemantically(query: SemanticWorkflowQuery): Promise<DocumentChunk[]> {
    const searchOptions = {
      limit: query.maxResults || 10,
      threshold: query.similarityThreshold || 0.3,
      includeMetadata: true
    };

    // Add workflow-specific filters
    if (query.workflowType) {
      (searchOptions as any).filter = { category: query.workflowType };
    }

    const searchResults: SearchResult[] = await this.vectorDatabase.search(query.intent, searchOptions);
    return searchResults.map(result => result.document);
  }

  /**
   * Execute workflow using enhanced Foundation Pipeline with context integration
   */
  async executeWithFoundationPipeline(
    query: string,
    foundationPipeline: FoundationPipeline,
    workspaceContext?: any,
    availableTools?: any[]
  ): Promise<{
    pipelineResult: FoundationPipelineResult;
    workflowResult: SemanticWorkflowResult;
    contextInsights: any;
  }> {
    await this.ensureInitialized();

    try {
      logger.info(`[SEMANTIC_WORKFLOW] Executing foundation pipeline with semantic context for query: ${query.substring(0, 100)}...`);
      const startTime = Date.now();

      // Step 1: Build semantic workflow query for context enrichment
      const semanticQuery: SemanticWorkflowQuery = {
        intent: query,
        workflowType: this.inferWorkflowType(query),
        includeRecentActivity: true,
        includeProjectContext: true,
        includeDocumentation: true,
        maxResults: 8,
        similarityThreshold: 0.4
      };

      // Step 2: Execute semantic workflow to gather comprehensive context
      const workflowResult = await this.executeSemanticWorkflow(semanticQuery);

      // Step 3: Execute enhanced foundation pipeline with enriched context
      const pipelineResult = await foundationPipeline.execute(
        query,
        {
          ...workspaceContext,
          semanticWorkflow: {
            contextItems: workflowResult.contextItems,
            documentationChunks: workflowResult.documentationChunks,
            relatedPatterns: workflowResult.relatedWorkflows,
            suggestedActions: workflowResult.suggestedActions
          }
        },
        availableTools,
        undefined, // progressCallback can be added later
        this.contextManager,
        this.vectorDatabase
      );

      // Step 4: Extract context insights from pipeline execution
      const contextInsights = this.extractContextInsights(pipelineResult, workflowResult);

      // Step 5: Update workflow patterns based on execution results
      await this.updateWorkflowPatterns(query, pipelineResult, workflowResult);

      const totalDuration = Date.now() - startTime;
      logger.info(`[SEMANTIC_WORKFLOW] Foundation pipeline execution completed in ${totalDuration}ms with confidence: ${pipelineResult.confidence.toFixed(2)}`);

      return {
        pipelineResult,
        workflowResult,
        contextInsights
      };

    } catch (error) {
      logger.error("[SEMANTIC_WORKFLOW] Foundation pipeline execution failed:", error);
      throw error;
    }
  }

  /**
   * Extract context insights from pipeline and workflow results
   */
  private extractContextInsights(
    pipelineResult: FoundationPipelineResult,
    workflowResult: SemanticWorkflowResult
  ): any {
    return {
      pipelineConfidence: pipelineResult.confidence,
      workflowConfidence: workflowResult.confidence,
      stagesCompleted: pipelineResult.stagesCompleted,
      contextItemsUsed: workflowResult.contextItems.length,
      documentationChunksUsed: workflowResult.documentationChunks.length,
      relatedPatternsFound: workflowResult.relatedWorkflows.length,
      suggestedActionsGenerated: workflowResult.suggestedActions.length,
      executionDuration: pipelineResult.duration,
      errors: pipelineResult.errors,
      
      // Semantic analysis
      semanticSimilarity: workflowResult.semanticSimilarity,
      executionStrategy: workflowResult.executionStrategy,
      
      // Context effectiveness scoring
      contextEffectiveness: this.calculateContextEffectiveness(pipelineResult, workflowResult),
      
      // Recommendations for future queries
      recommendations: this.generateRecommendations(pipelineResult, workflowResult)
    };
  }

  /**
   * Calculate context effectiveness based on pipeline and workflow results
   */
  private calculateContextEffectiveness(
    pipelineResult: FoundationPipelineResult,
    workflowResult: SemanticWorkflowResult
  ): number {
    let effectiveness = 0.5; // Base effectiveness

    // Pipeline success contribution
    if (pipelineResult.confidence > 0.7) effectiveness += 0.2;
    if (pipelineResult.stagesCompleted.length >= 8) effectiveness += 0.1;
    if (pipelineResult.errors.length === 0) effectiveness += 0.1;

    // Workflow context contribution
    if (workflowResult.contextItems.length > 3) effectiveness += 0.1;
    if (workflowResult.semanticSimilarity > 0.6) effectiveness += 0.1;

    return Math.min(1.0, effectiveness);
  }

  /**
   * Generate recommendations for future similar queries
   */
  private generateRecommendations(
    pipelineResult: FoundationPipelineResult,
    workflowResult: SemanticWorkflowResult
  ): string[] {
    const recommendations: string[] = [];

    if (pipelineResult.confidence < 0.6) {
      recommendations.push("Consider providing more specific context or examples");
    }

    if (workflowResult.contextItems.length < 3) {
      recommendations.push("More context items could improve accuracy - consider adding relevant files to workspace");
    }

    if (workflowResult.documentationChunks.length === 0) {
      recommendations.push("Documentation integration could enhance results - consider indexing relevant docs");
    }

    if (pipelineResult.stagesCompleted.length < 8) {
      recommendations.push("Some pipeline stages may need optimization for better coverage");
    }

    return recommendations;
  }

  /**
   * Update workflow patterns based on execution results
   */
  private async updateWorkflowPatterns(
    query: string,
    pipelineResult: FoundationPipelineResult,
    workflowResult: SemanticWorkflowResult
  ): Promise<void> {
    try {
      const patternId = `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const newPattern: WorkflowPattern = {
        id: patternId,
        name: `Auto-generated: ${query.substring(0, 50)}...`,
        description: query,
        contextTypes: workflowResult.contextItems.map(item => item.type),
        sources: workflowResult.contextItems.map(item => item.source),
        frequency: 1,
        successRate: pipelineResult.confidence,
        averageExecutionTime: pipelineResult.duration,
        commonParameters: {
          stagesCompleted: pipelineResult.stagesCompleted,
          toolsSelected: pipelineResult.selectedTools,
          contextItemCount: workflowResult.contextItems.length
        },
        lastUsed: new Date(),
        tags: [workflowResult.query.workflowType || 'general']
      };

      this.workflowPatterns.set(patternId, newPattern);
      
      // Store successful patterns for future use
      if (pipelineResult.confidence > 0.7) {
        const historyKey = workflowResult.query.workflowType || 'general';
        if (!this.workflowHistory.has(historyKey)) {
          this.workflowHistory.set(historyKey, []);
        }
        
        const history = this.workflowHistory.get(historyKey)!;
        history.push(workflowResult);
        
        // Keep only recent successful patterns (last 50)
        if (history.length > 50) {
          history.splice(0, history.length - 50);
        }
      }

      logger.debug(`[SEMANTIC_WORKFLOW] Updated workflow patterns with new execution data`);

    } catch (error) {
      logger.warn("[SEMANTIC_WORKFLOW] Failed to update workflow patterns:", error);
    }
  }

  /**
   * Infer workflow type from query content
   */
  private inferWorkflowType(query: string): SemanticWorkflowQuery['workflowType'] {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('analyze') || lowerQuery.includes('review') || lowerQuery.includes('check')) {
      return 'code_analysis';
    }
    
    if (lowerQuery.includes('document') || lowerQuery.includes('explain') || lowerQuery.includes('how')) {
      return 'documentation';
    }
    
    if (lowerQuery.includes('solve') || lowerQuery.includes('fix') || lowerQuery.includes('debug')) {
      return 'problem_solving';
    }
    
    return 'task_execution';
  }

  /**
   * Find workflow patterns similar to the current query
   */
  private async findRelatedWorkflowPatterns(query: SemanticWorkflowQuery): Promise<WorkflowPattern[]> {
    const allPatterns = Array.from(this.workflowPatterns.values());
    
    // Score patterns based on semantic similarity
    const scoredPatterns = allPatterns.map(pattern => {
      let score = 0;
      
      // Intent similarity (simple keyword matching for now)
      const intentWords = query.intent.toLowerCase().split(/\\s+/);
      const patternWords = pattern.description.toLowerCase().split(/\\s+/);
      const commonWords = intentWords.filter(word => patternWords.includes(word));
      score += (commonWords.length / intentWords.length) * 0.4;

      // Workflow type match
      if (query.workflowType && pattern.tags.includes(query.workflowType)) {
        score += 0.3;
      }

      // Success rate bonus
      score += pattern.successRate * 0.2;

      // Recent usage bonus
      const daysSinceLastUsed = (Date.now() - pattern.lastUsed.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastUsed < 7) {
        score += 0.1;
      }

      return { pattern, score };
    });

    // Return top patterns above threshold
    return scoredPatterns
      .filter(({ score }) => score >= (query.similarityThreshold || 0.3))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.maxResults || 5)
      .map(({ pattern }) => pattern);
  }

  /**
   * Calculate semantic similarity score
   */
  private calculateSemanticSimilarity(
    query: SemanticWorkflowQuery, 
    contextItems: ContextItem[], 
    documentationChunks: DocumentChunk[]
  ): number {
    if (contextItems.length === 0 && documentationChunks.length === 0) {
      return 0;
    }

    // Average relevance scores from context items
    const contextSimilarity = contextItems.length > 0
      ? contextItems.reduce((sum, item) => sum + item.relevanceScore, 0) / contextItems.length
      : 0;

    // For documentation, we'll use a simple heuristic for now
    const docSimilarity = documentationChunks.length > 0 ? 0.7 : 0;

    return (contextSimilarity + docSimilarity) / 2;
  }

  /**
   * Calculate overall confidence in the workflow result
   */
  private calculateConfidence(
    contextItems: ContextItem[], 
    documentationChunks: DocumentChunk[], 
    relatedWorkflows: WorkflowPattern[]
  ): number {
    let confidence = 0;

    // Context availability
    if (contextItems.length > 0) {
      confidence += 0.3;
      
      // High-priority context items boost confidence
      const highPriorityItems = contextItems.filter(item => item.priority >= ContextPriority.HIGH).length;
      confidence += (highPriorityItems / contextItems.length) * 0.2;
    }

    // Documentation availability
    if (documentationChunks.length > 0) {
      confidence += 0.2;
    }

    // Related workflow patterns
    if (relatedWorkflows.length > 0) {
      confidence += 0.3;
      
      // Average success rate of related workflows
      const avgSuccessRate = relatedWorkflows.reduce((sum, workflow) => sum + workflow.successRate, 0) / relatedWorkflows.length;
      confidence += avgSuccessRate * 0.2;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Generate suggested workflow actions
   */
  private async generateWorkflowActions(
    query: SemanticWorkflowQuery,
    contextItems: ContextItem[],
    documentationChunks: DocumentChunk[],
    relatedWorkflows: WorkflowPattern[]
  ): Promise<WorkflowAction[]> {
    const actions: WorkflowAction[] = [];

    // Analyze context items to suggest actions
    const contextSources = new Set(contextItems.map(item => item.source));
    
    if (contextSources.has(ContextSource.CODE_ANALYSIS)) {
      actions.push({
        type: "code_analysis",
        description: "Analyze code based on similar patterns found in context",
        priority: 3,
        estimatedTime: 5000,
        confidence: 0.8
      });
    }

    if (contextSources.has(ContextSource.ERROR_RECOVERY)) {
      actions.push({
        type: "tool_execution",
        description: "Execute error recovery procedures",
        toolName: "eslint",
        parameters: { fix: true },
        priority: 4,
        estimatedTime: 3000,
        confidence: 0.9
      });
    }

    // Suggest documentation lookup if relevant docs found
    if (documentationChunks.length > 0) {
      actions.push({
        type: "documentation_lookup",
        description: `Reference ${documentationChunks.length} relevant documentation sections`,
        priority: 2,
        estimatedTime: 1000,
        confidence: 0.7
      });
    }

    // Use related workflow patterns to suggest actions
    relatedWorkflows.forEach(workflow => {
      if (workflow.commonParameters.toolName) {
        actions.push({
          type: "tool_execution",
          description: `Execute ${workflow.name} workflow pattern`,
          toolName: workflow.commonParameters.toolName,
          parameters: workflow.commonParameters,
          priority: Math.round(workflow.successRate * 5),
          estimatedTime: workflow.averageExecutionTime,
          confidence: workflow.successRate
        });
      }
    });

    // Sort by priority and confidence
    return actions
      .sort((a, b) => (b.priority * b.confidence) - (a.priority * a.confidence))
      .slice(0, 10); // Limit to top 10 actions
  }

  /**
   * Determine optimal execution strategy
   */
  private determineExecutionStrategy(
    query: SemanticWorkflowQuery,
    actions: WorkflowAction[],
    confidence: number
  ): string {
    if (confidence >= 0.8) {
      return "auto_execute"; // High confidence, can execute automatically
    } else if (confidence >= 0.5) {
      return "guided_execution"; // Medium confidence, provide guidance
    } else if (actions.length > 0) {
      return "manual_review"; // Low confidence, require manual review
    } else {
      return "fallback_search"; // No clear path, use fallback search
    }
  }

  /**
   * Store workflow result for learning and pattern recognition
   */
  private async storeWorkflowResult(result: SemanticWorkflowResult): Promise<void> {
    const queryKey = `${result.query.intent}_${result.query.workflowType || 'general'}`;
    
    if (!this.workflowHistory.has(queryKey)) {
      this.workflowHistory.set(queryKey, []);
    }
    
    const history = this.workflowHistory.get(queryKey)!;
    history.push(result);
    
    // Keep only last 50 results per query type
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }

    // Note: Workflow patterns are now updated via executeWithFoundationPipeline method
    // This method stores history for pattern recognition
  }


  /**
   * Load existing workflow patterns from storage
   */
  private async loadWorkflowPatterns(): Promise<void> {
    // For now, initialize with some default patterns
    // In a full implementation, this would load from persistent storage
    
    const defaultPatterns: WorkflowPattern[] = [
      {
        id: "code_analysis_eslint",
        name: "Code Quality Analysis",
        description: "Analyze code quality and fix common issues",
        contextTypes: [ContextType.PROJECT, ContextType.TASK],
        sources: [ContextSource.CODE_ANALYSIS, ContextSource.ERROR_RECOVERY],
        frequency: 10,
        successRate: 0.85,
        averageExecutionTime: 3000,
        commonParameters: { toolName: "eslint", fix: true },
        lastUsed: new Date(),
        tags: ["code_analysis"]
      },
      {
        id: "documentation_lookup",
        name: "Documentation Research",
        description: "Find relevant documentation for coding tasks",
        contextTypes: [ContextType.DOCUMENTATION, ContextType.TASK],
        sources: [ContextSource.DOCUMENTATION, ContextSource.USER_INPUT],
        frequency: 15,
        successRate: 0.75,
        averageExecutionTime: 2000,
        commonParameters: {},
        lastUsed: new Date(),
        tags: ["documentation"]
      },
      {
        id: "problem_solving_debug",
        name: "Problem Solving Debug",
        description: "Debug and solve coding problems systematically",
        contextTypes: [ContextType.TASK, ContextType.PROJECT],
        sources: [ContextSource.ERROR_RECOVERY, ContextSource.CODE_ANALYSIS],
        frequency: 8,
        successRate: 0.70,
        averageExecutionTime: 8000,
        commonParameters: { includeTests: true },
        lastUsed: new Date(),
        tags: ["problem_solving", "debugging"]
      }
    ];

    defaultPatterns.forEach(pattern => {
      this.workflowPatterns.set(pattern.id, pattern);
    });

    logger.info(`[SEMANTIC_WORKFLOW] Loaded ${defaultPatterns.length} workflow patterns`);
  }

  /**
   * Get workflow statistics and insights
   */
  async getWorkflowAnalytics(): Promise<{
    totalWorkflows: number;
    averageConfidence: number;
    topPatterns: WorkflowPattern[];
    executionStrategies: Record<string, number>;
    recentActivity: SemanticWorkflowResult[];
  }> {
    const allResults = Array.from(this.workflowHistory.values()).flat();
    
    const totalWorkflows = allResults.length;
    const averageConfidence = totalWorkflows > 0 
      ? allResults.reduce((sum, result) => sum + result.confidence, 0) / totalWorkflows
      : 0;

    const topPatterns = Array.from(this.workflowPatterns.values())
      .sort((a, b) => (b.frequency * b.successRate) - (a.frequency * a.successRate))
      .slice(0, 10);

    const executionStrategies: Record<string, number> = {};
    allResults.forEach(result => {
      executionStrategies[result.executionStrategy] = (executionStrategies[result.executionStrategy] || 0) + 1;
    });

    const recentActivity = allResults
      .sort((a, b) => new Date().getTime() - new Date().getTime()) // Most recent first
      .slice(0, 20);

    return {
      totalWorkflows,
      averageConfidence,
      topPatterns,
      executionStrategies,
      recentActivity
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}