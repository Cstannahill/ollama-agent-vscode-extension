import { ChatSession, AgentAction } from "../core/ChatSession";

export enum AgentSpecialization {
  GENERAL = "general",
  CODE_REVIEW = "code_review",
  TEST_AUTOMATION = "test_automation",
  DEVOPS = "devops",
  DOCUMENTATION = "documentation",
  REFACTORING = "refactoring",
  // Foundation agent specializations
  QUERY_REWRITER = "query_rewriter",
  RETRIEVER = "retriever",
  RERANKER = "reranker",
  CHUNK_SCORER = "chunk_scorer",
  TASK_PLANNER = "task_planner",
  TOOL_SELECTOR = "tool_selector",
  COT_GENERATOR = "cot_generator",
  ACTION_CALLER = "action_caller",
  CRITIC = "critic",
  EMBEDDER = "embedder",
}

export interface AgentResponse {
  content: string;
  actions: AgentAction[];
  success: boolean;
  error?: string;
  agentType: AgentSpecialization;
  confidence?: number;
  suggestions?: string[];
  metadata?: Record<string, any>;
}

export interface AgentCapability {
  name: string;
  description: string;
  toolsRequired: string[];
  confidenceThreshold: number;
}

export interface TaskAnalysis {
  primaryDomain: AgentSpecialization;
  confidence: number;
  reasoningSteps: string[];
  requiredCapabilities: string[];
  complexity: "low" | "medium" | "high";
  estimatedDuration: number;
}

export interface ProgressCallback {
  onThought?(thought: string): void;
  onAction?(action: string, input: any): void;
  onActionResult?(output: string, error?: string): void;
  onStreamingResponse?(chunk: string): void;
  onComplete?(response: AgentResponse): void;
  onAgentSwitch?(
    fromAgent: AgentSpecialization,
    toAgent: AgentSpecialization,
    reason: string
  ): void;

  // Multi-agent workflow callbacks
  onWorkflowStart?(taskPlan: any[], complexity: string): void;
  onTaskStart?(
    taskId: string,
    agentType: AgentSpecialization,
    description: string
  ): void;
  onTaskProgress?(taskId: string, progress: number, status: string): void;
  onTaskComplete?(taskId: string, success: boolean, duration: number): void;
  onWorkflowComplete?(results: any[], successRate: number): void;
}

/**
 * Base interface for all specialized agents
 */
export interface IAgent {
  /**
   * Get the agent's specialization type
   */
  getSpecialization(): AgentSpecialization;

  /**
   * Get the agent's capabilities
   */
  getCapabilities(): AgentCapability[];

  /**
   * Analyze if this agent can handle a specific task
   */
  canHandle(task: string, context?: any): Promise<TaskAnalysis>;

  /**
   * Execute a task using this agent's specialized approach
   */
  executeTask(
    task: string,
    session?: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse>;

  /**
   * Get agent-specific configuration
   */
  getConfiguration(): any;

  /**
   * Update agent configuration
   */
  updateConfiguration(config: any): void;

  /**
   * Check if the agent is available and properly configured
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get specialized prompt templates for this agent
   */
  getPromptTemplates(): Record<string, string>;

  /**
   * Validate task requirements before execution
   */
  validateTask(
    task: string
  ): Promise<{ valid: boolean; issues: string[]; suggestions: string[] }>;
}

/**
 * Base abstract class implementing common agent functionality
 */
export abstract class BaseAgent implements IAgent {
  protected specialization: AgentSpecialization;
  protected capabilities: AgentCapability[] = [];
  protected configuration: any = {};

  constructor(specialization: AgentSpecialization) {
    this.specialization = specialization;
    this.initializeCapabilities();
  }

  protected abstract initializeCapabilities(): void;

  public getSpecialization(): AgentSpecialization {
    return this.specialization;
  }

  public getCapabilities(): AgentCapability[] {
    return this.capabilities;
  }

  public getConfiguration(): any {
    return this.configuration;
  }

  public updateConfiguration(config: any): void {
    this.configuration = { ...this.configuration, ...config };
  }

  // Default implementations that can be overridden
  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public getPromptTemplates(): Record<string, string> {
    return {};
  }

  public async validateTask(
    task: string
  ): Promise<{ valid: boolean; issues: string[]; suggestions: string[] }> {
    return {
      valid: true,
      issues: [],
      suggestions: [],
    };
  }

  // Abstract methods that must be implemented by specialized agents
  public abstract canHandle(task: string, context?: any): Promise<TaskAnalysis>;
  public abstract executeTask(
    task: string,
    session?: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse>;
}
