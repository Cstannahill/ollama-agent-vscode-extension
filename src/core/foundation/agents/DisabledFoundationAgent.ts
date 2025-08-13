/**
 * Disabled Foundation Agent implementations
 *
 * These agents are used when users explicitly configure no model
 * for foundation agents in the management window.
 */

import { logger } from "../../../utils/logger";
import { 
  IFoundationAgent,
  IRetrieverAgent, 
  IRerankerAgent, 
  IToolSelectorAgent,
  ICriticAgent,
  ITaskPlannerAgent,
  IQueryRewriterAgent,
  ICoTGeneratorAgent,
  IChunkScorerAgent,
  IActionCallerAgent,
  IEmbedderAgent,
  RetrievalResult,
  RerankResult,
  ToolMetadata,
  ToolSelectionResult,
  ToolRanking,
  ValidationResult,
  EvaluationResult,
  EvaluationCriteria,
  CritiqueResult,
  QualityScore,
  TaskPlan,
  TaskStep,
  Workflow,
  PlanningContext,
  ExpandedQuery,
  OptimizedQuery,
  QueryVariation,
  ChainOfThought,
  ReasoningExplanation,
  ReasoningValidation,
  ChunkScore,
  RankedChunk,
  RelevantPortion,
  ActionCall,
  ActionValidation,
  ActionResult,
  SimilarityResult
} from "../IFoundationAgent";

export class DisabledRetrieverAgent implements IRetrieverAgent {
  public readonly name = "retriever";
  public readonly modelSize = "disabled";

  async initialize(): Promise<void> {}
  isInitialized(): boolean { return false; }
  getCapabilities(): string[] { return ["Disabled - No model configured"]; }
  
  async retrieve(query: string, positiveExamples?: string[], negativeExamples?: string[]): Promise<RetrievalResult[]> {
    logger.warn(`[DISABLED_AGENT] Cannot retrieve - retriever agent is disabled`);
    return [];
  }

  async retrieveWithContext(query: string, contextType: "code" | "docs" | "conversation", limit?: number): Promise<RetrievalResult[]> {
    logger.warn(`[DISABLED_AGENT] Cannot retrieve with context - retriever agent is disabled`);
    return [];
  }
}

export class DisabledRerankerAgent implements IRerankerAgent {
  public readonly name = "reranker";
  public readonly modelSize = "disabled";

  async initialize(): Promise<void> {}
  isInitialized(): boolean { return false; }
  getCapabilities(): string[] { return ["Disabled - No model configured"]; }

  async rerank(query: string, documents: RetrievalResult[]): Promise<RerankResult[]> {
    logger.warn(`[DISABLED_AGENT] Cannot rerank - reranker agent is disabled`);
    return [];
  }

  async scoreRelevance(query: string, document: string): Promise<number> {
    logger.warn(`[DISABLED_AGENT] Cannot score relevance - reranker agent is disabled`);
    return 0;
  }
}

export class DisabledToolSelectorAgent implements IToolSelectorAgent {
  public readonly name = "toolSelector";
  public readonly modelSize = "disabled";

  async initialize(): Promise<void> {}
  isInitialized(): boolean { return false; }
  getCapabilities(): string[] { return ["Disabled - No model configured"]; }

  async selectTools(task: string, availableTools: ToolMetadata[]): Promise<ToolSelectionResult> {
    logger.warn(`[DISABLED_AGENT] Cannot select tools - tool selector agent is disabled`);
    return {
      selectedTools: [],
      confidence: 0,
      reasoning: ["Agent disabled - no model configured"],
      alternatives: []
    };
  }

  async rankTools(task: string, tools: ToolMetadata[]): Promise<ToolRanking[]> {
    logger.warn(`[DISABLED_AGENT] Cannot rank tools - tool selector agent is disabled`);
    return [];
  }

  async validateToolSelection(task: string, selectedTools: string[]): Promise<ValidationResult> {
    logger.warn(`[DISABLED_AGENT] Cannot validate tool selection - tool selector agent is disabled`);
    return {
      isValid: false,
      confidence: 0,
      issues: ["Agent disabled - no model configured"],
      suggestions: []
    };
  }
}

export class DisabledCriticAgent implements ICriticAgent {
  public readonly name = "critic";
  public readonly modelSize = "disabled";

  async initialize(): Promise<void> {}
  isInitialized(): boolean { return false; }
  getCapabilities(): string[] { return ["Disabled - No model configured"]; }

  async evaluate(prompt: string, answer: string): Promise<EvaluationResult> {
    logger.warn(`[DISABLED_AGENT] Cannot evaluate - critic agent is disabled`);
    throw new Error("Critic agent is disabled. Configure a model in the Foundation Models panel.");
  }

  async critique(response: string, criteria: EvaluationCriteria): Promise<CritiqueResult> {
    logger.warn(`[DISABLED_AGENT] Cannot critique - critic agent is disabled`);
    return {
      overallScore: 0,
      criteriaScores: {
        accuracy: 0,
        completeness: 0,
        clarity: 0,
        helpfulness: 0,
        safety: 0
      },
      feedback: "Agent disabled - no model configured",
      improvements: ["Configure a model in the Foundation Models panel"]
    };
  }

  async scoreQuality(content: string, type: "code" | "text" | "reasoning"): Promise<QualityScore> {
    logger.warn(`[DISABLED_AGENT] Cannot score quality - critic agent is disabled`);
    return {
      score: 0,
      aspects: {
        correctness: 0,
        efficiency: 0,
        readability: 0,
        maintainability: 0
      },
      issues: [{
        severity: "high",
        message: "Agent disabled - no model configured"
      }]
    };
  }
}

export class DisabledTaskPlannerAgent implements ITaskPlannerAgent {
  public readonly name = "taskPlanner";
  public readonly modelSize = "disabled";

  async initialize(): Promise<void> {}
  isInitialized(): boolean { return false; }
  getCapabilities(): string[] { return ["Disabled - No model configured"]; }

  async planTask(prompt: string, context?: any): Promise<TaskPlan> {
    logger.warn(`[DISABLED_AGENT] Cannot plan task - task planner agent is disabled`);
    throw new Error("Task planner agent is disabled. Configure a model in the Foundation Models panel.");
  }

  async decomposeTask(task: string, maxSteps?: number): Promise<TaskStep[]> {
    logger.warn(`[DISABLED_AGENT] Cannot decompose task - task planner agent is disabled`);
    return [];
  }

  async generateWorkflow(goal: string, constraints?: string[]): Promise<Workflow> {
    logger.warn(`[DISABLED_AGENT] Cannot generate workflow - task planner agent is disabled`);
    return {
      name: "Disabled Workflow",
      description: "Agent disabled - no model configured",
      steps: [],
      triggers: [],
      outputs: []
    };
  }
}

export class DisabledQueryRewriterAgent implements IQueryRewriterAgent {
  public readonly name = "queryRewriter";
  public readonly modelSize = "disabled";

  async initialize(): Promise<void> {}
  isInitialized(): boolean { return false; }
  getCapabilities(): string[] { return ["Disabled - No model configured"]; }

  async expandQuery(shortQuery: string, context?: string): Promise<ExpandedQuery> {
    logger.warn(`[DISABLED_AGENT] Cannot expand query - query rewriter agent is disabled`);
    throw new Error("Query rewriter agent is disabled. Configure a model in the Foundation Models panel.");
  }

  async optimizeForSearch(query: string, searchType: "semantic" | "keyword" | "hybrid"): Promise<OptimizedQuery> {
    logger.warn(`[DISABLED_AGENT] Cannot optimize for search - query rewriter agent is disabled`);
    return {
      query: query,
      searchTerms: [],
      filters: {},
      boost: {},
      strategy: "disabled"
    };
  }

  async generateVariations(query: string, count?: number): Promise<QueryVariation[]> {
    logger.warn(`[DISABLED_AGENT] Cannot generate variations - query rewriter agent is disabled`);
    return [];
  }
}

export class DisabledCoTGeneratorAgent implements ICoTGeneratorAgent {
  public readonly name = "cotGenerator";
  public readonly modelSize = "disabled";

  async initialize(): Promise<void> {}
  isInitialized(): boolean { return false; }
  getCapabilities(): string[] { return ["Disabled - No model configured"]; }

  async generateReasoning(question: string, context?: string): Promise<ChainOfThought> {
    logger.warn(`[DISABLED_AGENT] Cannot generate reasoning - CoT generator agent is disabled`);
    throw new Error("CoT generator agent is disabled. Configure a model in the Foundation Models panel.");
  }

  async explainSolution(problem: string, solution: string): Promise<ReasoningExplanation> {
    logger.warn(`[DISABLED_AGENT] Cannot explain solution - CoT generator agent is disabled`);
    return {
      problem,
      solution,
      reasoning: {
        question: problem,
        steps: [],
        conclusion: "Agent disabled",
        confidence: 0,
        assumptions: ["Agent disabled - no model configured"]
      },
      alternatives: [],
      verification: []
    };
  }

  async validateReasoning(reasoning: string, conclusion: string): Promise<ReasoningValidation> {
    logger.warn(`[DISABLED_AGENT] Cannot validate reasoning - CoT generator agent is disabled`);
    return {
      isValid: false,
      score: 0,
      issues: [{
        step: 0,
        issue: "Agent disabled - no model configured",
        severity: "high"
      }],
      suggestions: ["Configure a model in the Foundation Models panel"]
    };
  }
}

export class DisabledChunkScorerAgent implements IChunkScorerAgent {
  public readonly name = "chunkScorer";
  public readonly modelSize = "disabled";

  async initialize(): Promise<void> {}
  isInitialized(): boolean { return false; }
  getCapabilities(): string[] { return ["Disabled - No model configured"]; }

  async scoreChunk(chunk: string, query: string): Promise<ChunkScore> {
    logger.warn(`[DISABLED_AGENT] Cannot score chunk - chunk scorer agent is disabled`);
    return {
      score: 0,
      relevance: 0,
      quality: 0,
      completeness: 0,
      reasoning: "Agent disabled - no model configured"
    };
  }

  async rankChunks(chunks: string[], query: string): Promise<RankedChunk[]> {
    logger.warn(`[DISABLED_AGENT] Cannot rank chunks - chunk scorer agent is disabled`);
    return [];
  }

  async extractRelevantPortions(chunk: string, query: string): Promise<RelevantPortion[]> {
    logger.warn(`[DISABLED_AGENT] Cannot extract relevant portions - chunk scorer agent is disabled`);
    return [];
  }
}

export class DisabledActionCallerAgent implements IActionCallerAgent {
  public readonly name = "actionCaller";
  public readonly modelSize = "disabled";

  async initialize(): Promise<void> {}
  isInitialized(): boolean { return false; }
  getCapabilities(): string[] { return ["Disabled - No model configured"]; }

  async generateActionCall(plan: TaskStep, context?: any): Promise<ActionCall> {
    logger.warn(`[DISABLED_AGENT] Cannot generate action call - action caller agent is disabled`);
    throw new Error("Action caller agent is disabled. Configure a model in the Foundation Models panel.");
  }

  async validateActionCall(actionCall: ActionCall): Promise<ActionValidation> {
    logger.warn(`[DISABLED_AGENT] Cannot validate action call - action caller agent is disabled`);
    return {
      isValid: false,
      confidence: 0,
      issues: ["Agent disabled - no model configured"],
      suggestions: []
    };
  }

  async executeAction(actionCall: ActionCall): Promise<ActionResult> {
    logger.warn(`[DISABLED_AGENT] Cannot execute action - action caller agent is disabled`);
    return {
      success: false,
      result: "Agent disabled",
      error: "Action caller agent is disabled. Configure a model in the Foundation Models panel.",
      duration: 0,
      metadata: { disabled: true }
    };
  }
}

export class DisabledEmbedderAgentImpl implements IEmbedderAgent {
  public readonly name = "embedder";
  public readonly modelSize = "disabled";

  async initialize(): Promise<void> {}
  isInitialized(): boolean { return false; }
  getCapabilities(): string[] { return ["Disabled - No model configured"]; }
  setInitialized(state: boolean): void {}

  async embed(text: string): Promise<number[]> {
    logger.warn(`[DISABLED_AGENT] Cannot embed text - embedder agent is disabled`);
    throw new Error("Embedder agent is disabled. Configure a model in the Foundation Models panel.");
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    logger.warn(`[DISABLED_AGENT] Cannot embed batch - embedder agent is disabled`);
    throw new Error("Embedder agent is disabled. Configure a model in the Foundation Models panel.");
  }

  similarity(embedding1: number[], embedding2: number[]): number {
    logger.warn(`[DISABLED_AGENT] Cannot calculate similarity - embedder agent is disabled`);
    return 0;
  }

  findSimilar(query: number[], embeddings: number[][], threshold: number = 0.5): SimilarityResult[] {
    logger.warn(`[DISABLED_AGENT] Cannot find similar embeddings - embedder agent is disabled`);
    return [];
  }

  clearCache(): void {}
  getCacheStats() {
    return {
      size: 0,
      maxCacheSize: 0,
      evictions: 0,
      hitRate: 0,
      memoryUsageMB: 0,
      hits: 0,
      misses: 0
    };
  }
  unload(): void {}
}