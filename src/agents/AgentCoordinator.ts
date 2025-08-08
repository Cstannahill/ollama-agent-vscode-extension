import {
  IAgent,
  AgentSpecialization,
  TaskAnalysis,
  AgentResponse,
  ProgressCallback,
} from "./IAgent";
import { AgentFactory } from "./AgentFactory";
import { ChatSession } from "../core/ChatSession";
import { OllamaLLM } from "../api/ollama";
import { logger } from "../utils/logger";
import {
  agenticLogger,
  logStageStart,
  logStageEnd,
  AgentLogContext,
  ActionLogEntry,
} from "../utils/agentic-logger";
import { AgentConfig } from "./BasicAgent";

export interface TaskPlan {
  id: string;
  description: string;
  agentType: AgentSpecialization;
  dependencies: string[];
  priority: number;
  estimatedDuration: number;
  context?: any;
}

export interface WorkflowResult {
  taskId: string;
  agentType: AgentSpecialization;
  result: AgentResponse;
  duration: number;
  success: boolean;
}

export interface CoordinatorConfig {
  enableParallelExecution: boolean;
  maxConcurrency: number;
  taskTimeout: number;
  failureRetryCount: number;
  enableTaskOptimization: boolean;
}

/**
 * Orchestrates multi-agent workflows and complex task decomposition
 */
export class AgentCoordinator {
  private agentFactory: AgentFactory;
  private llm: OllamaLLM;
  private config: CoordinatorConfig;
  private activeTasks: Map<string, TaskPlan> = new Map();
  private completedTasks: Map<string, WorkflowResult> = new Map();

  constructor(
    agentFactory: AgentFactory,
    agentConfig: AgentConfig,
    coordinatorConfig?: Partial<CoordinatorConfig>
  ) {
    this.agentFactory = agentFactory;

    this.config = {
      enableParallelExecution: true,
      maxConcurrency: 3,
      taskTimeout: 300000, // 5 minutes
      failureRetryCount: 2,
      enableTaskOptimization: true,
      ...coordinatorConfig,
    };

    this.llm = new OllamaLLM({
      baseUrl: agentConfig.ollamaUrl,
      model: agentConfig.model,
      temperature: 0.2, // Low temperature for consistent task decomposition
    });
  }

  /**
   * Orchestrate a complex task that may require multiple specialized agents
   */
  public async orchestrateTask(
    complexTask: string,
    context?: any,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse> {
    const sessionId = `coordination_${Date.now()}`;
    const startTime = Date.now();

    // Create coordinator context for logging
    const coordinatorContext: AgentLogContext = {
      agentName: "AgentCoordinator",
      agentType: "AgentCoordinator",
      specialization: "multi-agent-orchestration",
      model: "coordinator",
      provider: "system",
      sessionId: sessionId,
    };

    try {
      logger.info(
        `[AGENT_COORDINATOR] Starting orchestration for: ${complexTask}`
      );

      // Log orchestration start
      logStageStart(
        "multi_agent_orchestration",
        "agent_execution",
        complexTask,
        coordinatorContext,
        sessionId
      );

      // Phase 1: Analyze if this is a complex multi-agent task
      progressCallback?.onThought?.(
        "Analyzing task complexity and decomposition requirements..."
      );

      // Log task analysis phase
      agenticLogger.logAgentAction(
        coordinatorContext,
        {
          actionType: "reasoning",
          actionName: "task_complexity_analysis",
          input: { task: complexTask },
        },
        undefined,
        sessionId
      );

      const analysisStartTime = Date.now();
      const taskAnalysis = await this.analyzeTaskComplexity(
        complexTask,
        context
      );
      const analysisDuration = Date.now() - analysisStartTime;

      // Log task analysis results
      agenticLogger.logAgentAction(
        coordinatorContext,
        {
          actionType: "observation",
          actionName: "task_analysis_complete",
          output: {
            requiresMultipleAgents: taskAnalysis.requiresMultipleAgents,
            complexity: taskAnalysis.complexity,
            potentialAgents: taskAnalysis.potentialAgents,
            reasoningSteps: taskAnalysis.reasoningSteps,
          },
          duration: analysisDuration,
          success: true,
        },
        undefined,
        sessionId
      );

      // Always treat as multi-agent orchestration, even for simple tasks

      // Phase 2: Decompose complex task into subtasks
      progressCallback?.onThought?.(
        "Decomposing complex task into specialized subtasks..."
      );

      // Log task decomposition phase
      agenticLogger.logAgentAction(
        coordinatorContext,
        {
          actionType: "reasoning",
          actionName: "task_decomposition",
          input: {
            complexity: taskAnalysis.complexity,
            potentialAgents: taskAnalysis.potentialAgents,
          },
        },
        undefined,
        sessionId
      );

      const decompositionStartTime = Date.now();
      const taskPlan = await this.decomposeTask(
        complexTask,
        context,
        progressCallback
      );
      const decompositionDuration = Date.now() - decompositionStartTime;

      progressCallback?.onThought?.(
        `Task decomposed into ${taskPlan.length} subtasks`
      );

      // Log task decomposition results
      agenticLogger.logAgentAction(
        coordinatorContext,
        {
          actionType: "observation",
          actionName: "task_decomposition_complete",
          output: {
            totalSubtasks: taskPlan.length,
            subtasks: taskPlan.map((t) => ({
              id: t.id,
              agentType: t.agentType,
              description: t.description,
            })),
            parallelTasks: taskPlan.filter((t) => t.dependencies.length === 0)
              .length,
            dependentTasks: taskPlan.filter((t) => t.dependencies.length > 0)
              .length,
          },
          duration: decompositionDuration,
          success: true,
        },
        undefined,
        sessionId
      );

      // Notify UI about workflow start
      progressCallback?.onWorkflowStart?.(taskPlan, taskAnalysis.complexity);

      // Phase 3: Execute task plan
      // Log task execution phase
      agenticLogger.logAgentAction(
        coordinatorContext,
        {
          actionType: "planning",
          actionName: "task_execution_start",
          input: {
            totalTasks: taskPlan.length,
            enableParallel: this.config.enableParallelExecution,
            maxConcurrency: this.config.maxConcurrency,
          },
        },
        undefined,
        sessionId
      );

      const executionStartTime = Date.now();
      const workflowResults = await this.executeTaskPlan(
        taskPlan,
        progressCallback
      );
      const executionDuration = Date.now() - executionStartTime;

      // Log task execution results
      const successfulTasks = workflowResults.filter((r) => r.success).length;
      agenticLogger.logAgentAction(
        coordinatorContext,
        {
          actionType: "observation",
          actionName: "task_execution_complete",
          output: {
            totalTasks: workflowResults.length,
            successfulTasks,
            failedTasks: workflowResults.length - successfulTasks,
            totalDuration: executionDuration,
            averageTaskDuration:
              workflowResults.reduce((sum, r) => sum + r.duration, 0) /
              workflowResults.length,
          },
          duration: executionDuration,
          confidence: successfulTasks / workflowResults.length,
          success: successfulTasks > 0,
        },
        undefined,
        sessionId
      );

      // Phase 4: Synthesize results
      progressCallback?.onThought?.(
        "Synthesizing results from multiple agents..."
      );

      const synthesisStartTime = Date.now();
      const finalResult = await this.synthesizeResults(
        complexTask,
        workflowResults,
        taskPlan
      );
      const synthesisDuration = Date.now() - synthesisStartTime;

      // Log result synthesis
      agenticLogger.logAgentAction(
        coordinatorContext,
        {
          actionType: "observation",
          actionName: "result_synthesis_complete",
          output: {
            finalSuccess: finalResult.success,
            synthesizedContent: finalResult.content.length,
            totalActions: finalResult.actions.length,
          },
          duration: synthesisDuration,
          confidence: finalResult.confidence,
          success: finalResult.success,
        },
        undefined,
        sessionId
      );

      // Notify UI about workflow completion
      const successRate =
        workflowResults.filter((r) => r.success).length /
        workflowResults.length;
      progressCallback?.onWorkflowComplete?.(workflowResults, successRate);

      const totalDuration = Date.now() - startTime;
      logger.info(`[AGENT_COORDINATOR] Orchestration completed successfully`);

      // Log successful orchestration completion
      logStageEnd(
        "multi_agent_orchestration",
        finalResult.success,
        totalDuration,
        finalResult.confidence,
        finalResult,
        finalResult.error,
        coordinatorContext,
        sessionId
      );

      return finalResult;
    } catch (error) {
      const errorMessage = `Multi-agent orchestration failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error("[AGENT_COORDINATOR] Orchestration failed:", error);

      return {
        content: errorMessage,
        actions: [],
        success: false,
        error: errorMessage,
        agentType: AgentSpecialization.GENERAL,
        confidence: 0,
        metadata: {
          orchestrationFailed: true,
          originalTask: complexTask,
        },
      };
    }
  }

  /**
   * Analyze if a task requires multiple agents
   */
  private async analyzeTaskComplexity(
    task: string,
    context?: any
  ): Promise<{
    requiresMultipleAgents: boolean;
    complexity: "low" | "medium" | "high";
    potentialAgents: AgentSpecialization[];
    reasoningSteps: string[];
  }> {
    const lowerTask = task.toLowerCase();
    const potentialAgents: AgentSpecialization[] = [];
    const reasoningSteps: string[] = [];

    // Keywords that suggest multi-agent workflows
    const multiAgentIndicators = [
      "and",
      "then",
      "also",
      "including",
      "plus",
      "with",
      "complete",
      "comprehensive",
      "full",
      "end-to-end",
      "entire",
      "whole",
    ];

    const crossDomainKeywords = {
      [AgentSpecialization.CODE_REVIEW]: [
        "review",
        "analyze",
        "check",
        "quality",
      ],
      [AgentSpecialization.TEST_AUTOMATION]: ["test", "testing", "coverage"],
      [AgentSpecialization.DEVOPS]: ["deploy", "git", "release", "pipeline"],
      [AgentSpecialization.DOCUMENTATION]: ["document", "readme", "docs"],
      [AgentSpecialization.REFACTORING]: ["refactor", "improve", "optimize"],
    };

    // Check for multi-agent indicators
    const hasMultiAgentIndicators = multiAgentIndicators.some((indicator) =>
      lowerTask.includes(indicator)
    );

    // Check how many domains are referenced
    for (const [agent, keywords] of Object.entries(crossDomainKeywords)) {
      const matches = keywords.filter((keyword) => lowerTask.includes(keyword));
      if (matches.length > 0) {
        potentialAgents.push(agent as AgentSpecialization);
        reasoningSteps.push(`${agent} needed for: ${matches.join(", ")}`);
      }
    }

    const requiresMultipleAgents =
      (hasMultiAgentIndicators && potentialAgents.length >= 2) ||
      potentialAgents.length >= 3;

    let complexity: "low" | "medium" | "high" = "low";
    if (potentialAgents.length >= 2) complexity = "medium";
    if (potentialAgents.length >= 4 || lowerTask.includes("comprehensive"))
      complexity = "high";

    if (requiresMultipleAgents) {
      reasoningSteps.push(
        `Multi-agent workflow detected: ${potentialAgents.length} agents needed`
      );
    }

    return {
      requiresMultipleAgents,
      complexity,
      potentialAgents,
      reasoningSteps,
    };
  }

  /**
   * Decompose a complex task into subtasks for different agents
   */
  public async decomposeTask(
    complexTask: string,
    context?: any,
    progressCallback?: ProgressCallback
  ): Promise<TaskPlan[]> {
    // Use high-level specialized agents instead of foundation pipeline stages
    // Foundation pipeline is handled internally by the FoundationBasicAgent

    // Check what type of task this is and create appropriate subtasks
    const lowerTask = complexTask.toLowerCase();
    const taskPlans: TaskPlan[] = [];
    let taskId = 1;

    // Always start with the foundation-enhanced general agent for analysis
    taskPlans.push({
      id: `task-${taskId++}`,
      description: `Analyze and process: ${complexTask}`,
      agentType: AgentSpecialization.GENERAL,
      dependencies: [],
      priority: 1,
      estimatedDuration: 30000,
      context,
    });

    // Add specialized agents based on task content
    if (
      lowerTask.includes("review") ||
      lowerTask.includes("analyze") ||
      lowerTask.includes("check")
    ) {
      taskPlans.push({
        id: `task-${taskId++}`,
        description: "Review and analyze code quality",
        agentType: AgentSpecialization.CODE_REVIEW,
        dependencies: [taskPlans[0].id],
        priority: 2,
        estimatedDuration: 25000,
        context,
      });
    }

    if (lowerTask.includes("test") || lowerTask.includes("testing")) {
      taskPlans.push({
        id: `task-${taskId++}`,
        description: "Generate and run tests",
        agentType: AgentSpecialization.TEST_AUTOMATION,
        dependencies: [taskPlans[0].id],
        priority: 3,
        estimatedDuration: 30000,
        context,
      });
    }

    if (
      lowerTask.includes("deploy") ||
      lowerTask.includes("git") ||
      lowerTask.includes("ci") ||
      lowerTask.includes("build")
    ) {
      taskPlans.push({
        id: `task-${taskId++}`,
        description: "Handle DevOps tasks",
        agentType: AgentSpecialization.DEVOPS,
        dependencies: [taskPlans[0].id],
        priority: 4,
        estimatedDuration: 20000,
        context,
      });
    }

    if (
      lowerTask.includes("document") ||
      lowerTask.includes("readme") ||
      lowerTask.includes("docs")
    ) {
      taskPlans.push({
        id: `task-${taskId++}`,
        description: "Create or update documentation",
        agentType: AgentSpecialization.DOCUMENTATION,
        dependencies: [taskPlans[0].id],
        priority: 5,
        estimatedDuration: 25000,
        context,
      });
    }

    if (
      lowerTask.includes("refactor") ||
      lowerTask.includes("improve") ||
      lowerTask.includes("optimize")
    ) {
      taskPlans.push({
        id: `task-${taskId++}`,
        description: "Refactor and improve code",
        agentType: AgentSpecialization.REFACTORING,
        dependencies: [taskPlans[0].id],
        priority: 6,
        estimatedDuration: 35000,
        context,
      });
    }

    // If no specialized tasks were identified, just use the general agent
    if (taskPlans.length === 1) {
      // Update the general task to be more comprehensive
      taskPlans[0].description = `Complete task: ${complexTask}`;
      taskPlans[0].estimatedDuration = 45000;
    }

    return taskPlans;
  }

  /**
   * Execute a task plan with dependency resolution and parallel execution
   */
  private async executeTaskPlan(
    taskPlan: TaskPlan[],
    progressCallback?: ProgressCallback
  ): Promise<WorkflowResult[]> {
    const results: WorkflowResult[] = [];
    const pendingTasks = new Map<string, TaskPlan>();
    const runningTasks = new Map<string, Promise<WorkflowResult>>();

    // Initialize pending tasks
    taskPlan.forEach((task) => {
      pendingTasks.set(task.id, task);
    });

    while (pendingTasks.size > 0 || runningTasks.size > 0) {
      // Find tasks ready to execute (dependencies satisfied)
      const readyTasks = Array.from(pendingTasks.values()).filter((task) =>
        task.dependencies.every((depId) =>
          results.some((result) => result.taskId === depId && result.success)
        )
      );

      // Start new tasks up to concurrency limit
      const availableSlots = this.config.maxConcurrency - runningTasks.size;
      const tasksToStart = readyTasks.slice(0, availableSlots);

      for (const task of tasksToStart) {
        pendingTasks.delete(task.id);
        const taskPromise = this.executeTask(task, progressCallback);
        runningTasks.set(task.id, taskPromise);

        progressCallback?.onThought?.(`Starting task: ${task.description}`);
        progressCallback?.onTaskStart?.(
          task.id,
          task.agentType,
          task.description
        );
      }

      // Wait for at least one task to complete
      if (runningTasks.size > 0) {
        const completedTaskId = await Promise.race(
          Array.from(runningTasks.entries()).map(async ([id, promise]) => {
            await promise;
            return id;
          })
        );

        const result = await runningTasks.get(completedTaskId)!;
        runningTasks.delete(completedTaskId);
        results.push(result);

        progressCallback?.onThought?.(`Completed task: ${result.taskId}`);
        progressCallback?.onTaskComplete?.(
          result.taskId,
          result.success,
          result.duration
        );
      }
    }

    return results;
  }

  /**
   * Execute a single task using the appropriate agent
   */
  private async executeTask(
    task: TaskPlan,
    progressCallback?: ProgressCallback
  ): Promise<WorkflowResult> {
    const startTime = Date.now();

    try {
      const agent = this.agentFactory.getAgent(task.agentType);
      if (!agent) {
        throw new Error(`Agent ${task.agentType} not available`);
      }

      const result = await agent.executeTask(
        task.description,
        undefined,
        progressCallback
      );
      const duration = Date.now() - startTime;

      return {
        taskId: task.id,
        agentType: task.agentType,
        result,
        duration,
        success: result.success,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[AGENT_COORDINATOR] Task ${task.id} failed:`, error);

      return {
        taskId: task.id,
        agentType: task.agentType,
        result: {
          content: `Task failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          actions: [],
          success: false,
          error: error instanceof Error ? error.message : String(error),
          agentType: task.agentType,
          confidence: 0,
        },
        duration,
        success: false,
      };
    }
  }

  /**
   * Synthesize results from multiple agents into a cohesive response
   */
  private async synthesizeResults(
    originalTask: string,
    workflowResults: WorkflowResult[],
    taskPlan: TaskPlan[]
  ): Promise<AgentResponse> {
    const successfulResults = workflowResults.filter((r) => r.success);
    const failedResults = workflowResults.filter((r) => !r.success);

    let content = `Multi-agent workflow completed for: ${originalTask}\n\n`;

    if (successfulResults.length > 0) {
      content += `✅ Completed Tasks (${successfulResults.length}):\n`;
      successfulResults.forEach((result) => {
        const task = taskPlan.find((t) => t.id === result.taskId);
        content += `- ${
          task?.description || result.taskId
        }: ${result.result.content.substring(0, 100)}...\n`;
      });
      content += `\n`;
    }

    if (failedResults.length > 0) {
      content += `❌ Failed Tasks (${failedResults.length}):\n`;
      failedResults.forEach((result) => {
        const task = taskPlan.find((t) => t.id === result.taskId);
        content += `- ${task?.description || result.taskId}: ${
          result.result.error
        }\n`;
      });
      content += `\n`;
    }

    const allActions = successfulResults.flatMap((r) => r.result.actions);
    const allSuggestions = successfulResults.flatMap(
      (r) => r.result.suggestions || []
    );

    // Calculate overall success
    const successRate = successfulResults.length / workflowResults.length;
    const overallSuccess = successRate >= 0.5; // At least half succeeded

    return {
      content,
      actions: allActions,
      success: overallSuccess,
      agentType: AgentSpecialization.GENERAL,
      confidence: successRate,
      suggestions: [...new Set(allSuggestions)], // Deduplicate suggestions
      metadata: {
        workflowResults,
        taskPlan,
        successRate,
        totalDuration: workflowResults.reduce((sum, r) => sum + r.duration, 0),
        agentsUsed: [...new Set(workflowResults.map((r) => r.agentType))],
      },
    };
  }

  /**
   * Get coordinator statistics
   */
  public getStatistics(): {
    totalTasksExecuted: number;
    successRate: number;
    averageTaskDuration: number;
    agentUsageStats: Record<AgentSpecialization, number>;
  } {
    const totalTasks = this.completedTasks.size;
    const successfulTasks = Array.from(this.completedTasks.values()).filter(
      (t) => t.success
    ).length;
    const successRate = totalTasks > 0 ? successfulTasks / totalTasks : 0;

    const totalDuration = Array.from(this.completedTasks.values()).reduce(
      (sum, task) => sum + task.duration,
      0
    );
    const averageTaskDuration = totalTasks > 0 ? totalDuration / totalTasks : 0;

    const agentUsageStats: Record<AgentSpecialization, number> = {} as any;
    Array.from(this.completedTasks.values()).forEach((task) => {
      agentUsageStats[task.agentType] =
        (agentUsageStats[task.agentType] || 0) + 1;
    });

    return {
      totalTasksExecuted: totalTasks,
      successRate,
      averageTaskDuration,
      agentUsageStats,
    };
  }
}
