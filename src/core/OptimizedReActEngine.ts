import { OllamaLLM } from "../api/ollama";
import { ToolManager } from "./ToolManager";
import { ChatSession, AgentAction } from "./ChatSession";
import { PromptBuilder } from "./PromptBuilder";
import {
  ParallelToolExecutor,
  ToolExecutionPlan,
} from "./ParallelToolExecutor";
import { ContextManager } from "./ContextManager";
import { ContextType, ContextSource, ContextPriority } from "../context/types";
import { logger } from "../utils/logger";
import { robustJSON } from "../utils/RobustJSONParser";

export interface OptimizedReActConfig {
  maxIterations: number;
  maxConcurrency: number;
  enableParallelExecution: boolean;
  enableResponseStreaming: boolean;
  contextCacheSize: number;
  aggressiveOptimization: boolean;
}

export interface StreamingProgressCallback {
  onThought?(thought: string): void;
  onPlan?(plan: ToolExecutionPlan[]): void;
  onParallelStart?(plan: ToolExecutionPlan[]): void;
  onToolStart?(toolName: string, input: any): void;
  onToolComplete?(toolName: string, output: string, duration: number): void;
  onToolError?(toolName: string, error: string): void;
  onIterationComplete?(iteration: number, totalTime: number): void;
  onResponse?(partialResponse: string): void;
  onComplete?(response: any): void;
}

export interface OptimizedAgentResponse {
  content: string;
  actions: AgentAction[];
  success: boolean;
  error?: string;
  executionStats: {
    totalIterations: number;
    totalDuration: number;
    parallelExecutions: number;
    timeSaved: number;
    averageIterationTime: number;
    toolExecutions: number;
  };
}

/**
 * High-performance ReAct engine with parallel execution and streaming
 */
export class OptimizedReActEngine {
  private llm: OllamaLLM;
  private toolManager: ToolManager;
  private promptBuilder: PromptBuilder;
  private parallelExecutor: ParallelToolExecutor;
  private contextManager?: ContextManager;
  private config: OptimizedReActConfig;
  private contextCache = new Map<string, any>();

  constructor(
    llm: OllamaLLM,
    toolManager: ToolManager,
    promptBuilder: PromptBuilder,
    contextManager?: ContextManager,
    config: Partial<OptimizedReActConfig> = {}
  ) {
    this.llm = llm;
    this.toolManager = toolManager;
    this.promptBuilder = promptBuilder;
    this.contextManager = contextManager;

    this.config = {
      maxIterations: 10,
      maxConcurrency: 3,
      enableParallelExecution: true,
      enableResponseStreaming: true,
      contextCacheSize: 50,
      aggressiveOptimization: false,
      ...config,
    };

    this.parallelExecutor = new ParallelToolExecutor(toolManager, {
      maxConcurrency: this.config.maxConcurrency,
      executionTimeout: 30000,
    });

    logger.info(
      `[OPTIMIZED_REACT] Initialized with config: ${JSON.stringify(
        this.config
      )}`
    );
  }

  /**
   * Execute optimized ReAct loop with parallel execution and streaming
   */
  public async execute(
    task: string,
    session?: ChatSession,
    progressCallback?: StreamingProgressCallback
  ): Promise<OptimizedAgentResponse> {
    const startTime = Date.now();
    const chatSession = session || new ChatSession();
    const actions: AgentAction[] = [];

    // Loop detection state
    const executedActions = new Set<string>(); // Track executed actions to prevent loops
    const actionAttempts = new Map<string, number>(); // Track attempts per action+input combination
    const successfulActions = new Set<string>(); // Track successful actions to prevent redundant execution
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 2;

    const stats = {
      totalIterations: 0,
      totalDuration: 0,
      parallelExecutions: 0,
      timeSaved: 0,
      averageIterationTime: 0,
      toolExecutions: 0,
    };

    const taskId = `opt_task_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;
    const sessionId = chatSession.getSessionId();

    try {
      logger.info(`[OPTIMIZED_REACT] Starting optimized execution: ${task}`);

      // Get and cache workspace context
      const workspaceContext = await this.getCachedWorkspaceContext();
      chatSession.setWorkspaceContext(workspaceContext);

      // Record task start
      await this.recordTaskStart(taskId, sessionId, task, workspaceContext);

      // Main execution loop
      for (
        let iteration = 0;
        iteration < this.config.maxIterations;
        iteration++
      ) {
        const iterationStart = Date.now();
        stats.totalIterations = iteration + 1;

        logger.debug(
          `[OPTIMIZED_REACT] Iteration ${iteration + 1}/${
            this.config.maxIterations
          }`
        );

        // Stream iteration start to UI
        if (progressCallback?.onIterationComplete) {
          progressCallback.onIterationComplete(iteration + 1, 0); // 0 duration for start
        }

        // Get relevant context with caching
        const contextualInfo = await this.getCachedRelevantContext(
          task,
          taskId,
          sessionId
        );

        // Build optimized prompt
        const actionsSummary = chatSession.getActionsSummary();
        logger.debug(
          `[OPTIMIZED_REACT] Actions summary for iteration ${iteration + 1}:`,
          {
            actionCount: chatSession.getActions().length,
            summaryPreview:
              actionsSummary.substring(0, 200) +
              (actionsSummary.length > 200 ? "..." : ""),
            summaryLength: actionsSummary.length,
          }
        );

        const prompt = await this.buildOptimizedPrompt(
          task,
          contextualInfo,
          workspaceContext,
          actionsSummary
        );

        // Get LLM response with streaming if enabled and real-time parsing
        let accumulatedResponse = "";
        let lastThought = "";
        let parsedActions: { action: string; input: any }[] = [];

        const response = await this.getStreamingResponse(prompt, {
          ...progressCallback,
          onResponse: (chunk: string) => {
            accumulatedResponse += chunk;

            // Try to parse thinking in real-time with enhanced patterns
            const thoughtPatterns = [
              /THOUGHT:\s*(.*?)(?=ACTION:|FINAL_ANSWER:|$)/s,
              /Thought:\s*(.*?)(?=Action:|Final Answer:|$)/s,
              /I need to\s*(.*?)(?=ACTION:|FINAL_ANSWER:|$)/s,
              /Let me\s*(.*?)(?=ACTION:|FINAL_ANSWER:|$)/s,
            ];

            for (const pattern of thoughtPatterns) {
              const thoughtMatch = accumulatedResponse.match(pattern);
              if (thoughtMatch && thoughtMatch[1].trim() !== lastThought) {
                const newThought = thoughtMatch[1].trim();
                if (newThought && newThought.length > 5) {
                  // Avoid tiny fragments
                  lastThought = newThought;
                  if (progressCallback?.onThought) {
                    progressCallback.onThought(lastThought);
                  }
                  break; // Use first match
                }
              }
            }

            // Try to detect actions in real-time and stream them
            const actionPattern = /ACTION:\s*([^\n]+)/g;
            const inputPattern = /ACTION_INPUT:\s*(\{[^}]*\})/g;

            let actionMatch;
            while (
              (actionMatch = actionPattern.exec(accumulatedResponse)) !== null
            ) {
              const actionName = actionMatch[1].trim();
              if (!parsedActions.find((a) => a.action === actionName)) {
                // Found new action, try to find its input
                const inputMatch = inputPattern.exec(accumulatedResponse);
                if (inputMatch) {
                  // Use robust JSON parser for streaming responses
                  const parseResult = robustJSON.parse(inputMatch[1], {
                    fixCommonErrors: true,
                    fallbackToKeyValue: true,
                    logLevel: 'debug'
                  });
                  
                  if (parseResult.success) {
                    parsedActions.push({ action: actionName, input: parseResult.data });

                    // Stream the action start immediately
                    if (progressCallback?.onToolStart) {
                      progressCallback.onToolStart(actionName, parseResult.data);
                    }
                  } else {
                    // Input parsing failed, we'll get it later in complete parsing
                    logger.debug(`[OPTIMIZED_REACT] Streaming parse failed: ${parseResult.error}`);
                  }
                }
              }
            }

            // Also call original callback for UI streaming
            if (progressCallback?.onResponse) {
              progressCallback.onResponse(chunk);
            }
          },
        });

        // Parse complete response for final action planning
        const planningResult = this.parseMultiActionResponse(response);

        // Report final thinking if not already streamed
        if (
          planningResult.thought &&
          planningResult.thought !== lastThought &&
          progressCallback?.onThought
        ) {
          progressCallback.onThought(planningResult.thought);
        }

        // Check for completion
        if (planningResult.actions.length === 0) {
          const finalAnswer = this.extractFinalAnswer(
            response,
            planningResult.thought
          );
          chatSession.addAIMessage(finalAnswer);
          logger.info(
            "[OPTIMIZED_REACT] Task completed - no more actions needed"
          );
          break;
        }

        // Apply loop detection to prevent infinite loops
        const filteredActions = [];
        let shouldBreak = false;

        for (const action of planningResult.actions) {
          // Normalize action for consistent comparison
          const normalizedInput = JSON.stringify(
            action.input,
            Object.keys(action.input || {}).sort()
          );
          const actionKey = `${action.action}:${normalizedInput}`;

          logger.debug(`[OPTIMIZED_REACT] Loop detection check:`, {
            actionKey,
            actionName: action.action,
            input: action.input,
            isInSuccessfulActions: successfulActions.has(actionKey),
            successfulActionsSize: successfulActions.size,
          });

          // Track attempts for the same action+input combination
          const currentAttempts = actionAttempts.get(actionKey) || 0;

          // Check if this exact action was already successful
          if (successfulActions.has(actionKey)) {
            logger.warn(
              `[OPTIMIZED_REACT] Action ${action.action} with same parameters was already successful. Skipping redundant execution.`,
              {
                actionKey,
                successfulActionsSize: successfulActions.size,
                successfulActionsList: Array.from(successfulActions),
              }
            );
            // Skip this action but continue with others or next iteration
            continue;
          }

          if (currentAttempts >= 2) {
            logger.warn(
              `[OPTIMIZED_REACT] Action ${
                action.action
              } with same parameters attempted ${
                currentAttempts + 1
              } times. Stopping to prevent infinite retries.`
            );
            chatSession.addAIMessage(
              `Unable to complete the action ${action.action} after ${
                currentAttempts + 1
              } attempts with the same parameters. There may be an issue with the input format or the requested operation.`
            );
            shouldBreak = true;
            break;
          }

          // Count occurrences of this exact action+params combination
          const actionOccurrences = Array.from(executedActions).filter(
            (key) => key === actionKey
          ).length;

          // Allow up to 1 exact repetition for stricter control
          if (actionOccurrences >= 1) {
            logger.warn(
              `[OPTIMIZED_REACT] Detected action loop: ${
                action.action
              } repeated ${actionOccurrences + 1} times. Breaking out of loop.`
            );
            chatSession.addAIMessage(
              `Task completed. Detected repetitive action: ${
                action.action
              } (repeated ${actionOccurrences + 1} times)`
            );
            shouldBreak = true;
            break;
          }

          // Check for excessive use of the same tool (regardless of params)
          const actionOnlyKey = action.action;
          const sameToolCount = Array.from(executedActions).filter((key) =>
            key.startsWith(actionOnlyKey + ":")
          ).length;

          // Allow up to 4 uses of the same tool with different parameters
          if (sameToolCount >= 4) {
            logger.warn(
              `[OPTIMIZED_REACT] Detected excessive use of tool: ${
                action.action
              } used ${sameToolCount + 1} times. Breaking out of loop.`
            );
            chatSession.addAIMessage(
              `Task completed. Tool ${action.action} used too many times (${
                sameToolCount + 1
              })`
            );
            shouldBreak = true;
            break;
          }

          // Track this action attempt ONLY after it passes validation
          actionAttempts.set(actionKey, currentAttempts + 1);
          executedActions.add(actionKey);

          // Add to filtered actions for execution
          filteredActions.push(action);
        }

        // Break out of main loop if loop detection triggered
        if (shouldBreak) {
          break;
        }

        // Skip execution if no valid actions remain after filtering
        if (filteredActions.length === 0) {
          logger.warn(
            "[OPTIMIZED_REACT] No valid actions remain after loop detection filtering"
          );
          chatSession.addAIMessage(
            "Task completed - all actions were filtered due to loop detection."
          );
          break;
        }

        // Create execution plan for parallel processing using filtered actions
        const executionPlans = this.config.enableParallelExecution
          ? this.parallelExecutor.analyzeParallelizationOpportunities(
              filteredActions
            )
          : this.createSequentialPlans(filteredActions);

        // Stream plan information immediately
        if (progressCallback?.onPlan) {
          progressCallback.onPlan(executionPlans);
        }

        // Execute tools (parallel or sequential) with enhanced streaming
        const executionResult = this.config.enableParallelExecution
          ? await this.executeParallelTools(executionPlans, progressCallback)
          : await this.executeSequentialTools(executionPlans, progressCallback);

        // Update statistics
        stats.toolExecutions += executionResult.results.length;
        if (executionResult.parallelizationGain > 0) {
          stats.parallelExecutions++;
          stats.timeSaved +=
            executionResult.totalDuration * executionResult.parallelizationGain;
        }

        // Record actions and results
        await this.recordExecutionResults(
          executionResult,
          planningResult.thought,
          taskId,
          sessionId,
          iteration,
          chatSession,
          actions
        );

        // Track successful actions to prevent redundant execution
        for (const result of executionResult.results) {
          if (result.success) {
            const normalizedInput = JSON.stringify(
              result.input,
              Object.keys(result.input || {}).sort()
            );
            const actionKey = `${result.toolName}:${normalizedInput}`;
            logger.debug(
              `[OPTIMIZED_REACT] Adding successful action to tracking:`,
              {
                actionKey,
                toolName: result.toolName,
                input: result.input,
                successfulActionsSize: successfulActions.size,
              }
            );
            successfulActions.add(actionKey);
            consecutiveFailures = 0; // Reset consecutive failures on success
          }
        }

        // Check for consecutive failures
        const recentFailures = executionResult.results
          .slice(-2) // Check last 2 attempts instead of 3
          .filter((r) => !r.success).length;

        if (recentFailures >= 2) {
          consecutiveFailures += recentFailures;
          if (consecutiveFailures >= maxConsecutiveFailures) {
            // Break after reaching max consecutive failures
            logger.warn(
              "[OPTIMIZED_REACT] Too many consecutive failures, breaking loop"
            );
            break;
          }
        }

        const iterationDuration = Date.now() - iterationStart;
        stats.averageIterationTime =
          (stats.averageIterationTime * iteration + iterationDuration) /
          (iteration + 1);

        if (progressCallback?.onIterationComplete) {
          progressCallback.onIterationComplete(
            iteration + 1,
            iterationDuration
          );
        }
      }

      stats.totalDuration = Date.now() - startTime;

      const finalResponse: OptimizedAgentResponse = {
        content: String(
          chatSession.getMessages().slice(-1)[0]?.content || "Task completed"
        ),
        actions,
        success: true,
        executionStats: stats,
      };

      if (progressCallback?.onComplete) {
        progressCallback.onComplete(finalResponse);
      }

      logger.info(
        `[OPTIMIZED_REACT] Execution completed in ${stats.totalDuration}ms with ${stats.parallelExecutions} parallel executions`
      );

      return finalResponse;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[OPTIMIZED_REACT] Execution failed:", error);

      stats.totalDuration = Date.now() - startTime;

      return {
        content: `Execution failed: ${errorMessage}`,
        actions,
        success: false,
        error: errorMessage,
        executionStats: stats,
      };
    }
  }

  /**
   * Parse response for multiple actions and planning
   */
  private parseMultiActionResponse(response: string): {
    thought: string;
    actions: { action: string; input: any }[];
  } {
    const result = {
      thought: "",
      actions: [] as { action: string; input: any }[],
    };

    // Extract thought
    const thoughtMatch = response.match(/THOUGHT:\s*(.*?)(?=ACTION:|$)/s);
    if (thoughtMatch) {
      result.thought = thoughtMatch[1].trim();
    }

    // Look for multiple actions or action plans
    const actionPattern =
      /ACTION:\s*(.*?)\nACTION_INPUT:\s*(.*?)(?=\nACTION:|$)/gs;
    let actionMatch;

    while ((actionMatch = actionPattern.exec(response)) !== null) {
      const action = actionMatch[1].trim();
      const inputText = actionMatch[2].trim();

      // Use robust JSON parser with fallback strategies
      const parseResult = robustJSON.parse(inputText, {
        fixCommonErrors: true,
        fallbackToKeyValue: true,
        allowPartial: false,
        logLevel: 'debug'
      });
      
      if (parseResult.success) {
        result.actions.push({ action, input: parseResult.data });
      } else {
        logger.warn(
          `[OPTIMIZED_REACT] Robust JSON parsing failed for action input: ${inputText}. Error: ${parseResult.error}`
        );
        result.actions.push({ action, input: { raw: inputText, parseError: parseResult.error } });
      }
    }

    // Fallback to single action parsing if no multiple actions found
    if (result.actions.length === 0) {
      const singleAction = this.parseSingleAction(response);
      if (singleAction) {
        result.actions.push(singleAction);
      }
    }

    return result;
  }

  /**
   * Execute tools in parallel with progress tracking
   */
  private async executeParallelTools(
    plans: ToolExecutionPlan[],
    progressCallback?: StreamingProgressCallback
  ) {
    if (progressCallback?.onParallelStart) {
      progressCallback.onParallelStart(plans);
    }

    // Execute with immediate progress notifications
    const promises = plans.map(async (plan) => {
      const startTime = Date.now();

      // Stream tool start immediately
      if (progressCallback?.onToolStart) {
        progressCallback.onToolStart(plan.toolName, plan.input);
      }

      try {
        const output = await this.toolManager.executeTool(
          plan.toolName,
          plan.input
        );
        const duration = Date.now() - startTime;

        // Stream completion immediately
        if (progressCallback?.onToolComplete) {
          progressCallback.onToolComplete(plan.toolName, output, duration);
        }

        return {
          id: plan.id,
          toolName: plan.toolName,
          input: plan.input,
          output,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration,
          success: true,
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Stream error immediately
        if (progressCallback?.onToolError) {
          progressCallback.onToolError(plan.toolName, errorMessage);
        }

        return {
          id: plan.id,
          toolName: plan.toolName,
          input: plan.input,
          error: errorMessage,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration,
          success: false,
        };
      }
    });

    const results = await Promise.all(promises);
    const totalDuration = Math.max(...results.map((r) => r.duration));

    return {
      results,
      totalDuration,
      successCount: results.filter((r) => r.success).length,
      errorCount: results.filter((r) => !r.success).length,
      parallelizationGain: plans.length > 1 ? 0.3 : 0, // Estimated parallelization benefit
    };
  }

  /**
   * Execute tools sequentially with progress tracking
   */
  private async executeSequentialTools(
    plans: ToolExecutionPlan[],
    progressCallback?: StreamingProgressCallback
  ) {
    const results = [];
    const startTime = Date.now();

    for (const plan of plans) {
      if (progressCallback?.onToolStart) {
        progressCallback.onToolStart(plan.toolName, plan.input);
      }

      const toolStart = Date.now();
      try {
        const output = await this.toolManager.executeTool(
          plan.toolName,
          plan.input
        );
        const duration = Date.now() - toolStart;

        results.push({
          id: plan.id,
          toolName: plan.toolName,
          input: plan.input,
          output,
          startTime: new Date(toolStart),
          endTime: new Date(),
          duration,
          success: true,
        });

        if (progressCallback?.onToolComplete) {
          progressCallback.onToolComplete(plan.toolName, output, duration);
        }
      } catch (error) {
        const duration = Date.now() - toolStart;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        results.push({
          id: plan.id,
          toolName: plan.toolName,
          input: plan.input,
          error: errorMessage,
          startTime: new Date(toolStart),
          endTime: new Date(),
          duration,
          success: false,
        });

        if (progressCallback?.onToolError) {
          progressCallback.onToolError(plan.toolName, errorMessage);
        }
      }
    }

    return {
      results,
      totalDuration: Date.now() - startTime,
      successCount: results.filter((r) => r.success).length,
      errorCount: results.filter((r) => !r.success).length,
      parallelizationGain: 0, // No parallelization in sequential execution
    };
  }

  /**
   * Get streaming response from LLM if enabled
   */
  private async getStreamingResponse(
    prompt: string,
    progressCallback?: StreamingProgressCallback
  ): Promise<string> {
    if (this.config.enableResponseStreaming && progressCallback?.onResponse) {
      logger.debug("[OPTIMIZED_REACT] Using streaming response generation");

      return await this.llm.generateTextStreaming(prompt, {
        onChunk: (chunk: string) => {
          progressCallback.onResponse?.(chunk);
        },
        onProgress: (progress: { text: string; isComplete: boolean }) => {
          if (progress.isComplete) {
            logger.debug("[OPTIMIZED_REACT] Streaming response completed");
          }
        },
        onError: (error: Error) => {
          logger.error("[OPTIMIZED_REACT] Streaming error:", error);
        },
      });
    }

    return await this.llm.generateText(prompt);
  }

  /**
   * Cache workspace context for performance
   */
  private async getCachedWorkspaceContext(): Promise<any> {
    const cacheKey = "workspace_context";

    if (this.contextCache.has(cacheKey)) {
      return this.contextCache.get(cacheKey);
    }

    // Get workspace context (implement based on existing method)
    const context = await this.getWorkspaceContext();

    // Cache with TTL
    this.contextCache.set(cacheKey, context);
    setTimeout(() => {
      this.contextCache.delete(cacheKey);
    }, 60000); // 1 minute TTL

    return context;
  }

  /**
   * Cache relevant context for performance
   */
  private async getCachedRelevantContext(
    task: string,
    taskId: string,
    sessionId: string
  ): Promise<string> {
    if (!this.contextManager) return "";

    const cacheKey = `context_${Buffer.from(task)
      .toString("base64")
      .substring(0, 16)}`;

    if (this.contextCache.has(cacheKey)) {
      return this.contextCache.get(cacheKey);
    }

    try {
      // Ensure context manager is initialized before use
      await this.ensureContextManagerInitialized();

      const relevantContextResult = await this.contextManager.searchContext({
        query: task,
        types: [ContextType.TASK, ContextType.PROJECT, ContextType.LONG_TERM],
        maxResults: 5,
        taskId,
        sessionId,
      });

      const contextualInfo =
        relevantContextResult.items.length > 0
          ? "\n\nRelevant Context:\n" +
            relevantContextResult.items
              .map((item) => `- ${item.content}`)
              .join("\n")
          : "";

      // Cache with shorter TTL for context
      this.contextCache.set(cacheKey, contextualInfo);
      setTimeout(() => {
        this.contextCache.delete(cacheKey);
      }, 30000); // 30 second TTL

      return contextualInfo;
    } catch (error) {
      logger.debug("[OPTIMIZED_REACT] Failed to get relevant context:", error);
      return "";
    }
  }

  /**
   * Ensure context manager is initialized before use
   */
  private async ensureContextManagerInitialized(): Promise<void> {
    if (!this.contextManager) return;

    try {
      // Try to initialize if not already done
      await this.contextManager.initialize();
    } catch (error) {
      logger.warn(
        "[OPTIMIZED_REACT] Context manager initialization failed:",
        error
      );
      // Set contextManager to null to prevent further attempts
      this.contextManager = undefined;
    }
  }

  // Helper methods (simplified implementations)

  private createSequentialPlans(
    actions: { action: string; input: any }[]
  ): ToolExecutionPlan[] {
    return actions.map((action, index) => ({
      id: `seq_${index}`,
      toolName: action.action,
      input: action.input,
      priority: 50,
      dependencies: index > 0 ? [`seq_${index - 1}`] : [],
      canRunInParallel: false,
    }));
  }

  private async buildOptimizedPrompt(
    task: string,
    contextualInfo: string,
    workspaceContext: any,
    actionsSummary: string
  ): Promise<string> {
    return await this.promptBuilder.buildAgentPrompt(
      task + contextualInfo,
      workspaceContext,
      actionsSummary
    );
  }

  private parseSingleAction(
    response: string
  ): { action: string; input: any } | null {
    // Implement single action parsing (use existing logic)
    const actionMatch = response.match(/ACTION:\s*(.*?)(?:\n|$)/);
    const inputMatch = response.match(/ACTION_INPUT:\s*(.*?)(?:\n|$)/s);

    if (actionMatch && inputMatch) {
      const parseResult = robustJSON.parse(inputMatch[1].trim(), {
        fixCommonErrors: true,
        fallbackToKeyValue: true,
        logLevel: 'none' // Less verbose for single action parsing
      });
      
      if (parseResult.success) {
        return {
          action: actionMatch[1].trim(),
          input: parseResult.data,
        };
      } else {
        logger.debug(`[OPTIMIZED_REACT] Single action parsing failed: ${parseResult.error}`);
        return null;
      }
    }

    return null;
  }

  private parseSimpleInput(inputText: string): any {
    // Simple key-value parsing for non-JSON input
    const lines = inputText.split("\n");
    const result: any = {};

    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        result[key] = value;
      }
    }

    return Object.keys(result).length > 0 ? result : { raw: inputText };
  }

  private extractFinalAnswer(response: string, thought?: string): string {
    // Look for final answer patterns
    const patterns = [
      /FINAL_ANSWER:\s*(.*?)$/s,
      /Final Answer:\s*(.*?)$/s,
      /Answer:\s*(.*?)$/s,
    ];

    for (const pattern of patterns) {
      const match = response.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    // Fallback to thought or response
    return thought || response || "Task completed successfully.";
  }

  private async getWorkspaceContext(): Promise<any> {
    // Implement workspace context gathering
    return { currentFile: "", workspaceRoot: "" };
  }

  private async recordTaskStart(
    taskId: string,
    sessionId: string,
    task: string,
    workspaceContext: any
  ): Promise<void> {
    if (!this.contextManager) return;

    try {
      await this.ensureContextManagerInitialized();
      if (!this.contextManager) return; // May have been set to undefined

      await this.contextManager.addContext({
        id: `opt_task_start_${taskId}`,
        type: ContextType.TASK,
        source: ContextSource.TASK_ATTEMPT,
        content: `Started optimized task: ${task}`,
        metadata: {
          taskId,
          sessionId,
          startTime: new Date(),
          workspaceContext,
        },
        relevanceScore: 0.8,
        priority: ContextPriority.HIGH,
        timestamp: new Date(),
        tags: ["optimized", "task", "start"],
        taskId,
        sessionId,
      });
    } catch (error) {
      logger.warn("[OPTIMIZED_REACT] Failed to record task start:", error);
      // Continue execution even if context recording fails
    }
  }

  private async recordExecutionResults(
    executionResult: any,
    thought: string | undefined,
    taskId: string,
    sessionId: string,
    iteration: number,
    chatSession: ChatSession,
    actions: AgentAction[]
  ): Promise<void> {
    // Record each tool execution result
    for (const result of executionResult.results) {
      const toolCall = chatSession.recordToolCall(
        result.toolName,
        result.input,
        result.output || `Error: ${result.error}`
      );

      const action: AgentAction = {
        thought: thought || "",
        toolCall,
        observation: result.output || `Error: ${result.error}`,
        timestamp: new Date(),
      };

      chatSession.addAction(action);
      actions.push(action);

      // Record in context system
      if (this.contextManager && result.success) {
        try {
          await this.ensureContextManagerInitialized();
          if (!this.contextManager) return; // May have been set to undefined

          await this.contextManager.addContext({
            id: `opt_success_${taskId}_${iteration}_${result.id}`,
            type: ContextType.TASK,
            source: ContextSource.SUCCESS_PATTERN,
            content: `Optimized execution: ${result.toolName} completed in ${result.duration}ms`,
            metadata: {
              taskId,
              sessionId,
              iteration,
              toolName: result.toolName,
              duration: result.duration,
              parallelized: executionResult.parallelizationGain > 0,
            },
            relevanceScore: 0.7,
            priority: ContextPriority.MEDIUM,
            timestamp: new Date(),
            tags: ["optimized", "success", result.toolName],
            taskId,
            sessionId,
          });
        } catch (error) {
          logger.warn(
            "[OPTIMIZED_REACT] Failed to record execution result:",
            error
          );
          // Continue execution even if context recording fails
        }
      }
    }
  }
}
