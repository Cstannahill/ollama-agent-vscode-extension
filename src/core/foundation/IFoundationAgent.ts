/**
 * Foundation Agent Interfaces for Specialized AI Components
 *
 * This file defines the interfaces for the 10 foundational AI agents that form
 * the core of our agentic system. Each agent specializes in a specific aspect
 * of the reasoning and execution pipeline.
 */

export interface FoundationAgentConfig {
  modelSize: "0.1-1B" | "0.5-2B" | "1-3B" | "1-7B";
  temperature: number;
  maxTokens: number;
  timeout: number;
  maxCacheSize?: number;
}

// Base interface for all foundation agents
export interface IFoundationAgent {
  name: string;
  modelSize: string;
  initialize(): Promise<void>;
  isInitialized(): boolean;
  getCapabilities(): string[];
}

// 1. Retriever Agent - BGE, E5, GTE style semantic search
export interface IRetrieverAgent extends IFoundationAgent {
  retrieve(
    query: string,
    positiveExamples?: string[],
    negativeExamples?: string[]
  ): Promise<RetrievalResult[]>;
  retrieveWithContext(
    query: string,
    contextType: "code" | "docs" | "conversation",
    limit?: number
  ): Promise<RetrievalResult[]>;
}

export interface RetrievalResult {
  content: string;
  score: number;
  source: string;
  metadata: {
    type: "code" | "docs" | "context" | "memory";
    filePath?: string;
    lineNumber?: number;
    chunkId?: string;
  };
}

// 2. Reranker Agent - Cross-encoder style document scoring
export interface IRerankerAgent extends IFoundationAgent {
  rerank(query: string, documents: RetrievalResult[]): Promise<RerankResult[]>;
  scoreRelevance(query: string, document: string): Promise<number>;
}

export interface RerankResult extends RetrievalResult {
  originalRank: number;
  rerankScore: number;
  confidence: number;
}

// 3. Tool Selector Agent - DPO-style classifier for tool selection
export interface IToolSelectorAgent extends IFoundationAgent {
  selectTools(
    task: string,
    availableTools: ToolMetadata[]
  ): Promise<ToolSelectionResult>;
  rankTools(task: string, tools: ToolMetadata[]): Promise<ToolRanking[]>;
  validateToolSelection(
    task: string,
    selectedTools: string[]
  ): Promise<ValidationResult>;
}

export interface ToolMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: any;
  examples: string[];
  prerequisites?: string[];
}

export interface ToolSelectionResult {
  selectedTools: string[];
  confidence: number;
  reasoning: string[];
  alternatives: Array<{
    toolId: string;
    score: number;
    reason: string;
  }>;
}

export interface ToolRanking {
  toolId: string;
  rank: number;
  score: number;
  reasoning: string;
}

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
}

// 4. Critic/Evaluator Agent - HH-RLHF style evaluation
export interface ICriticAgent extends IFoundationAgent {
  evaluate(prompt: string, answer: string): Promise<EvaluationResult>;
  critique(
    response: string,
    criteria: EvaluationCriteria
  ): Promise<CritiqueResult>;
  scoreQuality(
    content: string,
    type: "code" | "text" | "reasoning"
  ): Promise<QualityScore>;
}

export interface EvaluationResult {
  score: number; // 0-1
  rating: "excellent" | "good" | "fair" | "poor";
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  confidence: number;
}

export interface EvaluationCriteria {
  accuracy: number;
  completeness: number;
  clarity: number;
  helpfulness: number;
  safety: number;
}

export interface CritiqueResult {
  overallScore: number;
  criteriaScores: EvaluationCriteria;
  feedback: string;
  improvements: string[];
}

export interface QualityScore {
  score: number;
  aspects: {
    correctness: number;
    efficiency: number;
    readability: number;
    maintainability: number;
  };
  issues: Array<{
    severity: "low" | "medium" | "high";
    message: string;
    line?: number;
  }>;
}

// 5. Task Planner Agent - CAMEL-AI, AutoGPT-style planning
export interface ITaskPlannerAgent extends IFoundationAgent {
  planTask(prompt: string, context?: PlanningContext): Promise<TaskPlan>;
  decomposeTask(task: string, maxSteps?: number): Promise<TaskStep[]>;
  generateWorkflow(goal: string, constraints?: string[]): Promise<Workflow>;
}

export interface PlanningContext {
  availableTools: string[];
  workspaceInfo: any;
  previousResults?: any[];
  timeConstraints?: number;
  projectStructure?: any;
  availableResources?: string[];
  constraints?: string[];
  userPreferences?: any;
  contextualInfo?: Array<{
    type: string;
    content: string;
    relevance: number;
  }>;
  similarTaskPatterns?: Array<{
    task: string;
    approach: string;
    confidence: number;
    source: string;
  }>;
}

export interface TaskPlan {
  goal: string;
  steps: TaskStep[];
  estimatedDuration: number;
  dependencies: string[];
  riskFactors: string[];
  successCriteria: string[];
}

export interface TaskStep {
  id: string;
  description: string;
  action: string;
  parameters: any;
  dependencies: string[];
  estimatedTime: number;
  priority: "low" | "medium" | "high";
  validation?: string;
}

export interface Workflow {
  name: string;
  description: string;
  steps: TaskStep[];
  triggers: string[];
  outputs: string[];
}

// 6. Query Rewriter Agent - Search query expansion and optimization
export interface IQueryRewriterAgent extends IFoundationAgent {
  expandQuery(shortQuery: string, context?: string): Promise<ExpandedQuery>;
  optimizeForSearch(
    query: string,
    searchType: "semantic" | "keyword" | "hybrid"
  ): Promise<OptimizedQuery>;
  generateVariations(query: string, count?: number): Promise<QueryVariation[]>;
}

export interface ExpandedQuery {
  original: string;
  expanded: string;
  keywords: string[];
  concepts: string[];
  intent: string;
  confidence: number;
}

export interface OptimizedQuery {
  query: string;
  searchTerms: string[];
  filters: any;
  boost: any;
  strategy: string;
}

export interface QueryVariation {
  query: string;
  similarity: number;
  focus: string;
}

// 7. CoT (Chain of Thought) Generator Agent
export interface ICoTGeneratorAgent extends IFoundationAgent {
  generateReasoning(
    question: string,
    context?: string
  ): Promise<ChainOfThought>;
  explainSolution(
    problem: string,
    solution: string
  ): Promise<ReasoningExplanation>;
  validateReasoning(
    reasoning: string,
    conclusion: string
  ): Promise<ReasoningValidation>;
}

export interface ChainOfThought {
  question: string;
  steps: ReasoningStep[];
  conclusion: string;
  confidence: number;
  assumptions: string[];
}

export interface ReasoningStep {
  step: number;
  thought: string;
  evidence: string[];
  conclusion: string;
  confidence: number;
}

export interface ReasoningExplanation {
  problem: string;
  solution: string;
  reasoning: ChainOfThought;
  alternatives: string[];
  verification: string[];
}

export interface ReasoningValidation {
  isValid: boolean;
  score: number;
  issues: Array<{
    step: number;
    issue: string;
    severity: "low" | "medium" | "high";
  }>;
  suggestions: string[];
}

// 8. Chunk Scorer Agent - Content relevance and ranking
export interface IChunkScorerAgent extends IFoundationAgent {
  scoreChunk(chunk: string, query: string): Promise<ChunkScore>;
  rankChunks(chunks: string[], query: string): Promise<RankedChunk[]>;
  extractRelevantPortions(
    chunk: string,
    query: string
  ): Promise<RelevantPortion[]>;
}

export interface ChunkScore {
  score: number;
  relevance: number;
  quality: number;
  completeness: number;
  reasoning: string;
}

export interface RankedChunk {
  content: string;
  rank: number;
  score: ChunkScore;
  highlights: string[];
}

export interface RelevantPortion {
  text: string;
  startIndex: number;
  endIndex: number;
  relevanceScore: number;
  context: string;
}

// 9. Action Caller Agent - Function calling and API interaction
export interface IActionCallerAgent extends IFoundationAgent {
  generateActionCall(plan: TaskStep, context?: any): Promise<ActionCall>;
  validateActionCall(actionCall: ActionCall): Promise<ActionValidation>;
  executeAction(actionCall: ActionCall): Promise<ActionResult>;
}

export interface ActionCall {
  toolId: string;
  functionName: string;
  parameters: any;
  metadata: {
    reasoning: string;
    confidence: number;
    alternatives?: ActionCall[];
  };
}

export interface ActionValidation {
  isValid: boolean;
  issues: string[];
  suggestions: string[];
  confidence: number;
}

export interface ActionResult {
  success: boolean;
  result: any;
  error?: string;
  duration: number;
  metadata: any;
}

// 10. Embedder Agent - Vector operations and similarity
export interface IEmbedderAgent extends IFoundationAgent {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  similarity(embedding1: number[], embedding2: number[]): number;
  findSimilar(
    query: number[],
    embeddings: number[][],
    threshold?: number
  ): SimilarityResult[];
}

export interface SimilarityResult {
  index: number;
  similarity: number;
  metadata?: any;
}

// Foundation Pipeline Configuration
export interface FoundationPipelineConfig {
  retriever: FoundationAgentConfig;
  reranker: FoundationAgentConfig;
  toolSelector: FoundationAgentConfig;
  critic: FoundationAgentConfig;
  taskPlanner: FoundationAgentConfig;
  queryRewriter: FoundationAgentConfig;
  cotGenerator: FoundationAgentConfig;
  chunkScorer: FoundationAgentConfig;
  actionCaller: FoundationAgentConfig;
  embedder: FoundationAgentConfig;

  // Pipeline settings
  enableParallelProcessing: boolean;
  maxConcurrency: number;
  timeoutMs: number;
  retryAttempts: number;
}

// Foundation Pipeline Result
export interface FoundationPipelineResult {
  query: string;
  retrievalResults: RetrievalResult[];
  rerankedResults: RerankResult[];
  selectedTools: string[];
  taskPlan: TaskPlan;
  reasoning: ChainOfThought;
  actionCalls: ActionCall[];
  evaluation: EvaluationResult;

  // Pipeline metadata
  duration: number;
  stagesCompleted: string[];
  errors: string[];
  confidence: number;
}
