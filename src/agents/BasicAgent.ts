import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { AIMessage } from "@langchain/core/messages";
import { OllamaLLM, OllamaChatModel } from "../api/ollama";
import chalk from "chalk";
import { ToolManager } from "../core/ToolManager";
import { ToolWrapper } from "../core/ToolWrapper";
import { ChatSession, AgentAction } from "../core/ChatSession";
import { PromptBuilder } from "../core/PromptBuilder";
import {
  ResponseFormatter,
  FormattedResponse,
} from "../core/ResponseFormatter";
import { ContextManager } from "../core/ContextManager";
import { ContextType, ContextSource, ContextPriority } from "../context/types";
import { SemanticWorkflowEngine, SemanticWorkflowQuery } from "../core/SemanticWorkflowEngine";
import { SpecializedPromptTemplates, AgentType, PromptContext } from "../core/SpecializedPromptTemplates";
import {
  OptimizedReActEngine,
  StreamingProgressCallback,
  OptimizedAgentResponse,
} from "../core/OptimizedReActEngine";
import {
  IAgent,
  AgentSpecialization,
  AgentCapability,
  TaskAnalysis,
  ProgressCallback as IProgressCallback,
} from "./IAgent";
import { logger } from "../utils/logger";
import { 
  agenticLogger, 
  logStageStart, 
  logStageEnd, 
  logToolExecution,
  logReasoning,
  AgentLogContext,
  ActionLogEntry 
} from "../utils/agentic-logger";
import * as vscode from "vscode";

export interface AgentConfig {
  ollamaUrl: string;
  model: string;
  temperature?: number;
  maxIterations?: number;
  verbose?: boolean;
  enableOptimizedExecution?: boolean;
  maxConcurrency?: number;
  enableParallelExecution?: boolean;
  enableResponseStreaming?: boolean;
  quantizedModel?: boolean;
}

export interface AgentResponse {
  content: string;
  actions: AgentAction[];
  success: boolean;
  error?: string;
  formatted?: FormattedResponse;
}

export interface ProgressCallback {
  onThought?(thought: string): void;
  onAction?(action: string, input: any): void;
  onActionResult?(output: string, error?: string): void;
  onStreamingResponse?(chunk: string): void;
  onComplete?(response: AgentResponse): void;
}

/**
 * Basic ReAct-style agent using LangChain and Ollama
 */
export class BasicAgent implements IAgent {
  private llm: OllamaLLM;
  private chatModel: OllamaChatModel;
  private toolManager: ToolManager;
  private promptBuilder: PromptBuilder;
  private responseFormatter: ResponseFormatter;
  private contextManager?: ContextManager;
  private config: AgentConfig;
  private executor?: AgentExecutor;
  private optimizedEngine?: OptimizedReActEngine;
  private semanticWorkflowEngine: SemanticWorkflowEngine;
  private promptTemplates: SpecializedPromptTemplates;

  constructor(
    config: AgentConfig,
    toolManager: ToolManager,
    contextManager?: ContextManager
  ) {
    this.config = config;
    this.toolManager = toolManager;
    this.contextManager = contextManager;
    this.promptBuilder = new PromptBuilder(toolManager);
    this.semanticWorkflowEngine = SemanticWorkflowEngine.getInstance();
    this.promptTemplates = SpecializedPromptTemplates.getInstance();

    // Initialize response formatter
    this.responseFormatter = new ResponseFormatter({
      ollamaUrl: config.ollamaUrl,
      model: config.model,
      temperature: 0.3, // Lower temperature for consistent formatting
    });

    // Keep LLM for backward compatibility and manual ReAct loop
    this.llm = new OllamaLLM({
      baseUrl: config.ollamaUrl,
      model: config.model,
      temperature: config.temperature || 0.7,
    });

    // Add chat model for LangChain agent integration
    this.chatModel = new OllamaChatModel({
      baseUrl: config.ollamaUrl,
      model: config.model,
      temperature: config.temperature || 0.7,
    });

    // Initialize optimized engine if enabled
    if (config.enableOptimizedExecution) {
      this.optimizedEngine = new OptimizedReActEngine(
        this.llm,
        toolManager,
        this.promptBuilder,
        contextManager,
        {
          maxIterations: config.maxIterations || 10,
          maxConcurrency: config.maxConcurrency || 3,
          enableParallelExecution: config.enableParallelExecution !== false,
          enableResponseStreaming: config.enableResponseStreaming !== false,
          contextCacheSize: 50,
          aggressiveOptimization: false,
        }
      );
    }

    logger.info(
      chalk.green(
        `[OAVSCE] [AGENT INIT] Initialized BasicAgent with model: ${
          config.model
        }${config.enableOptimizedExecution ? " (optimized)" : ""}`
      )
    );
  }

  /**
   * Initialize the agent executor with tools
   */
  async initialize(): Promise<void> {
    try {
      // Create a custom prompt for function calling
      const prompt = await this.createAgentPrompt();

      // Get all tools from the tool manager and convert to LangChain tools
      const baseTools = this.toolManager.getAllTools();
      const tools = ToolWrapper.toLangChainTools(baseTools);

      // Debug: Check if bindTools exists
      logger.debug(
        chalk.blue(`[OAVSCE] [AGENT] Chat model type: ${typeof this.chatModel}`)
      );
      logger.debug(
        chalk.magenta(
          `[OAVSCE] [AGENT] bindTools exists: ${typeof this.chatModel
            .bindTools}`
        )
      );
      logger.debug(
        chalk.magenta(
          `[OAVSCE] [AGENT] bindTools is function: ${
            typeof this.chatModel.bindTools === "function"
          }`
        )
      );

      // Verify the method exists before calling createToolCallingAgent
      if (typeof this.chatModel.bindTools !== "function") {
        logger.error(
          chalk.red(
            `[OAVSCE] [AGENT ERROR] Chat model does not have bindTools method`
          )
        );
        throw new Error("Chat model does not have bindTools method");
      }

      logger.debug("[AGENT INIT] Creating tool calling agent with:", {
        toolsCount: tools.length,
        toolNames: tools.map((t) => t.name),
        promptType: prompt.constructor.name,
      });

      // Create the agent using chat model
      const agent = createToolCallingAgent({
        llm: this.chatModel,
        tools,
        prompt,
      });

      logger.debug("[AGENT INIT] Tool calling agent created successfully");

      // Create the executor
      logger.debug("[AGENT INIT] Creating agent executor...");
      this.executor = new AgentExecutor({
        agent,
        tools,
        maxIterations: this.config.maxIterations || 10,
        verbose: this.config.verbose || false,
      });

      logger.debug("[AGENT INIT] Agent executor created successfully");

      logger.info("Agent executor initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize agent:", error);
      throw new Error(`Agent initialization failed: ${error}`);
    }
  }

  /**
   * Execute a task using the agent (legacy method for backward compatibility)
   */
  async executeTaskLegacy(
    task: string,
    session?: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse> {
    // Use optimized engine if available and enabled
    if (this.optimizedEngine && this.config.enableOptimizedExecution) {
      try {
        logger.info(
          `Executing task with optimized engine using model: ${this.config.model}`
        );

        const streamingCallback: StreamingProgressCallback = {
          onThought: progressCallback?.onThought,
          onToolStart: (toolName, input) =>
            progressCallback?.onAction?.(toolName, input),
          onToolComplete: (toolName, output) =>
            progressCallback?.onActionResult?.(output),
          onToolError: (toolName, error) =>
            progressCallback?.onActionResult?.("", error),
          onResponse: (chunk: string) =>
            progressCallback?.onStreamingResponse?.(chunk),
          onComplete: (response) => progressCallback?.onComplete?.(response),
        };

        const optimizedResult = await this.optimizedEngine.execute(
          task,
          session,
          streamingCallback
        );

        return {
          content: optimizedResult.content,
          actions: optimizedResult.actions,
          success: optimizedResult.success,
          error: optimizedResult.error,
        };
      } catch (error) {
        logger.warn(
          "Optimized engine failed, falling back to standard ReAct:",
          error
        );
        // Fall through to standard execution
      }
    }

    // Standard execution path
    try {
      logger.info(
        `Executing task with standard ReAct loop using model: ${this.config.model}`
      );
      return await this.executeReActLoop(task, session, progressCallback);
    } catch (error) {
      logger.warn("ReAct loop failed, trying LangChain executor:", error);

      // Reinitialize executor if needed and try LangChain agent
      try {
        if (!this.executor) {
          await this.initialize();
        }
        return await this.executeLangChainAgent(task, session);
      } catch (initError) {
        logger.error("LangChain executor also failed:", initError);
        throw error; // Return original error
      }
    }
  }

  /**
   * Execute task using LangChain agent executor (fallback)
   */
  private async executeLangChainAgent(
    task: string,
    session?: ChatSession
  ): Promise<AgentResponse> {
    if (!this.executor) {
      throw new Error("Agent not initialized. Call initialize() first.");
    }

    const chatSession = session || new ChatSession();

    try {
      logger.info(`Executing task with LangChain executor: ${task}`);

      // Add the task as a human message
      chatSession.addHumanMessage(task);

      // Get workspace context
      const workspaceContext = await this.getWorkspaceContext();
      chatSession.setWorkspaceContext(workspaceContext);

      // Build the complete prompt with context
      const prompt = await this.promptBuilder.buildAgentPrompt(
        task,
        workspaceContext,
        chatSession.getActionsSummary()
      );

      // Execute with the agent
      const result = await this.executor.invoke({
        input: prompt,
        chat_history: chatSession.getMessages(),
      });

      // Process the result
      const content = result.output || "Task completed";
      chatSession.addAIMessage(content);

      logger.info("LangChain task execution completed successfully");

      return {
        content,
        actions: chatSession.getActions(),
        success: true,
      };
    } catch (error) {
      const errorMessage = `LangChain task execution failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMessage);

      return {
        content: errorMessage,
        actions: chatSession.getActions(),
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a simple ReAct loop manually (fallback if LangChain agent fails)
   */
  async executeReActLoop(
    task: string,
    session?: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse> {
    const chatSession = session || new ChatSession();
    const actions: AgentAction[] = [];
    const maxIterations = this.config.maxIterations || 10;
    const executedActions = new Set<string>(); // Track executed actions to prevent loops
    const actionAttempts = new Map<string, number>(); // Track attempts per action+input combination
    const successfulActions = new Set<string>(); // Track successful actions to prevent redundant execution
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 2; // Reduced from 3 to 2 to prevent triple attempts

    // Initialize context tracking for this task (outside try block for scope)
    const taskId = `task_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;
    const sessionId = chatSession.getSessionId();
    const loopStartTime = Date.now();

    // Create agent context for logging
    const agentContext: AgentLogContext = {
      agentName: 'BasicAgent',
      agentType: 'BasicAgent',
      specialization: 'general',
      model: this.config.model,
      provider: 'ollama',
      sessionId: sessionId
    };

    try {
      logger.info(`Starting ReAct loop for task: ${task}`);
      
      // Log ReAct loop start
      logStageStart('react_loop', 'agent_execution', task, agentContext, sessionId);

      // Get workspace context
      const workspaceContext = await this.getWorkspaceContext();
      chatSession.setWorkspaceContext(workspaceContext);

      // Record task start in context system
      if (this.contextManager) {
        await this.contextManager.addContext({
          id: `task_start_${taskId}`,
          type: ContextType.TASK,
          source: ContextSource.TASK_ATTEMPT,
          content: `Started task: ${task}`,
          metadata: {
            taskId,
            sessionId,
            startTime: new Date(),
            workspaceContext,
          },
          relevanceScore: 0.8,
          priority: ContextPriority.HIGH,
          timestamp: new Date(),
          tags: ["task", "start", "agent"],
          taskId,
          sessionId,
        });
      }

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        logger.debug(`ReAct iteration ${iteration + 1}/${maxIterations}`);

        // Log iteration start
        agenticLogger.logAgentAction(
          agentContext,
          {
            actionType: 'reasoning',
            actionName: 'react_iteration_start',
            input: { 
              iteration: iteration + 1, 
              maxIterations,
              consecutiveFailures,
              executedActionsCount: executedActions.size
            }
          },
          undefined,
          sessionId
        );

        // Get relevant context for this iteration
        let contextualInfo = "";
        if (this.contextManager) {
          try {
            const relevantContextResult =
              await this.contextManager.searchContext({
                query: task,
                types: [
                  ContextType.TASK,
                  ContextType.PROJECT,
                  ContextType.LONG_TERM,
                ],
                maxResults: 5,
                taskId,
                sessionId,
              });

            if (relevantContextResult.items.length > 0) {
              contextualInfo =
                "\n\nRelevant Context:\n" +
                relevantContextResult.items
                  .map((item) => `- ${item.content}`)
                  .join("\n");
              logger.debug(
                `[CONTEXT] Found ${relevantContextResult.items.length} relevant context items`
              );

              // Log context retrieval
              agenticLogger.logAgentAction(
                agentContext,
                {
                  actionType: 'observation',
                  actionName: 'context_retrieved',
                  output: { contextItems: relevantContextResult.items.length },
                  success: true
                },
                undefined,
                sessionId
              );
            }
          } catch (error) {
            logger.debug("[CONTEXT] Failed to get relevant context:", error);
          }
        }

        // Build prompt for current iteration with context
        const prompt = await this.promptBuilder.buildAgentPrompt(
          task + contextualInfo,
          workspaceContext,
          chatSession.getActionsSummary()
        );

        // Get response from LLM
        const llmStartTime = Date.now();
        const response = await this.llm.generateText(prompt);
        const llmDuration = Date.now() - llmStartTime;

        // Log LLM response
        agenticLogger.logAgentAction(
          agentContext,
          {
            actionType: 'observation',
            actionName: 'llm_response_generated',
            input: { promptLength: prompt.length },
            output: { responseLength: response.length },
            duration: llmDuration,
            success: true
          },
          undefined,
          sessionId
        );

        // Parse the response for thought/action/input
        const parsedResponse = this.parseAgentResponse(response);

        // Log parsing results
        agenticLogger.logAgentAction(
          agentContext,
          {
            actionType: 'reasoning',
            actionName: 'response_parsing',
            output: {
              hasThought: !!parsedResponse.thought,
              hasAction: !!parsedResponse.action,
              hasActionInput: !!parsedResponse.actionInput,
              action: parsedResponse.action
            },
            success: true
          },
          undefined,
          sessionId
        );

        logger.debug(`Raw LLM response:\n${response}`);
        logger.debug(`Parsed response:`, {
          hasThought: !!parsedResponse.thought,
          hasAction: !!parsedResponse.action,
          hasActionInput: !!parsedResponse.actionInput,
          action: parsedResponse.action,
          actionInput: parsedResponse.actionInput,
        });

        // Report thinking progress
        if (parsedResponse.thought && progressCallback?.onThought) {
          progressCallback.onThought(parsedResponse.thought);
        }

        if (!parsedResponse.action) {
          // No action needed, task is complete
          logger.info(
            `Task completion detected - looking for final answer. Response length: ${response.length}`
          );

          // Check if there's a final answer in the response
          const finalAnswer = this.extractFinalAnswer(response);
          logger.info(
            `Final answer extraction result: ${
              finalAnswer ? "Found" : "None"
            }, length: ${finalAnswer?.length || 0}`
          );

          if (finalAnswer) {
            chatSession.addAIMessage(finalAnswer);
            logger.info("ReAct loop completed with final answer");
          } else {
            // If there's a thought but no action, record it as a thinking step
            if (parsedResponse.thought) {
              const thinkingAction: AgentAction = {
                thought: parsedResponse.thought,
                timestamp: new Date(),
              };
              chatSession.addAction(thinkingAction);
              actions.push(thinkingAction);
            }

            // Provide a meaningful fallback message
            let fallbackMessage = parsedResponse.thought || response;
            if (!fallbackMessage || fallbackMessage.trim().length === 0) {
              fallbackMessage = "Task completed successfully.";
              logger.warn(
                "Empty fallback message, using default completion message"
              );
            } else {
              logger.info(
                `Using fallback message, length: ${fallbackMessage.length}`
              );
            }

            chatSession.addAIMessage(fallbackMessage);
            logger.info("ReAct loop completed - no more actions needed");
          }
          break;
        }

        // Check for action loops with more tolerant thresholds and parameter mapping awareness
        const normalizedInput = JSON.stringify(
          parsedResponse.actionInput,
          Object.keys(parsedResponse.actionInput || {}).sort()
        );
        const actionKey = `${parsedResponse.action}:${normalizedInput}`;

        // Also check with mapped parameters to detect parameter format variations
        const mappedInput = this.mapParameterNames(
          parsedResponse.action,
          parsedResponse.actionInput
        );
        const normalizedMappedInput = JSON.stringify(
          mappedInput,
          Object.keys(mappedInput || {}).sort()
        );
        const mappedActionKey = `${parsedResponse.action}:${normalizedMappedInput}`;

        // Track attempts for the same action+input combination (either format)
        const actionInputKey = mappedActionKey; // Use mapped version as canonical
        const currentAttempts = actionAttempts.get(actionInputKey) || 0;

        // Check if this exact action was already successful
        if (successfulActions.has(actionInputKey)) {
          logger.warn(
            `Action ${parsedResponse.action} with same parameters was already successful. Skipping redundant execution.`
          );
          chatSession.addAIMessage(
            `The action ${parsedResponse.action} was already completed successfully with these parameters. Task analysis complete.`
          );
          break;
        }

        if (currentAttempts >= 2) {
          logger.warn(
            `Action ${parsedResponse.action} with same parameters attempted ${
              currentAttempts + 1
            } times. Stopping to prevent infinite retries.`
          );
          chatSession.addAIMessage(
            `Unable to complete the action ${parsedResponse.action} after ${
              currentAttempts + 1
            } attempts with the same parameters. There may be an issue with the input format or the requested operation.`
          );
          break;
        }

        actionAttempts.set(actionInputKey, currentAttempts + 1);

        // Count occurrences of this exact action+params combination
        const actionOccurrences = Array.from(executedActions).filter(
          (key) => key === actionKey || key === mappedActionKey
        ).length;

        // Allow up to 1 exact repetition to reduce from 2 to 1 for stricter control
        if (actionOccurrences >= 1) {
          logger.warn(
            `Detected action loop: ${parsedResponse.action} repeated ${
              actionOccurrences + 1
            } times. Breaking out of loop.`
          );
          chatSession.addAIMessage(
            `Task completed. Detected repetitive action: ${
              parsedResponse.action
            } (repeated ${actionOccurrences + 1} times)`
          );
          break;
        }

        // Also check for excessive use of the same tool (regardless of params)
        const actionOnlyKey = parsedResponse.action;
        const sameToolCount = Array.from(executedActions).filter((key) =>
          key.startsWith(actionOnlyKey + ":")
        ).length;

        // Allow up to 4 uses of the same tool with different parameters
        if (sameToolCount >= 4) {
          logger.warn(
            `Detected excessive use of tool: ${parsedResponse.action} used ${
              sameToolCount + 1
            } times. Breaking out of loop.`
          );
          chatSession.addAIMessage(
            `Task completed. Tool ${
              parsedResponse.action
            } used too many times (${sameToolCount + 1})`
          );
          break;
        }

        executedActions.add(actionKey);

        // Execute the tool
        try {
          // Map parameter names for common variations
          const mappedInput = this.mapParameterNames(
            parsedResponse.action,
            parsedResponse.actionInput
          );

          logger.debug(`Executing tool ${parsedResponse.action} with input:`, {
            original: parsedResponse.actionInput,
            mapped: mappedInput,
          });

          // Report action progress
          if (progressCallback?.onAction) {
            progressCallback.onAction(parsedResponse.action, mappedInput);
          }

          // Log tool execution start
          agenticLogger.logAgentAction(
            agentContext,
            {
              actionType: 'tool_call',
              actionName: parsedResponse.action,
              input: mappedInput
            },
            undefined,
            sessionId
          );

        const toolStartTime = Date.now();
          const toolOutput = await this.toolManager.executeTool(
            parsedResponse.action,
            mappedInput
          );
          const toolDuration = Date.now() - toolStartTime;

          // Log successful tool execution
          logToolExecution(
            parsedResponse.action,
            agentContext,
            mappedInput,
            toolOutput,
            toolDuration,
            true,
            undefined
          );

          // Report action result
          if (progressCallback?.onActionResult) {
            progressCallback.onActionResult(toolOutput);
          }

          // Record the action
          const toolCall = chatSession.recordToolCall(
            parsedResponse.action,
            parsedResponse.actionInput,
            toolOutput
          );

          const action: AgentAction = {
            thought: parsedResponse.thought,
            toolCall,
            observation: toolOutput,
            timestamp: new Date(),
          };

          chatSession.addAction(action);
          actions.push(action);

          // Log reasoning/observation from tool result
          if (parsedResponse.thought) {
            logReasoning(
              agentContext,
              'chain_of_thought',
              [parsedResponse.thought],
              undefined,
              undefined
            );
          }

          // Record successful tool execution in context system
          if (this.contextManager) {
            await this.contextManager.addContext({
              id: `success_${taskId}_${iteration}`,
              type: ContextType.TASK,
              source: ContextSource.SUCCESS_PATTERN,
              content: `Successfully executed ${parsedResponse.action}: ${
                toolOutput.length > 200
                  ? toolOutput.substring(0, 200) + "..."
                  : toolOutput
              }`,
              metadata: {
                taskId,
                sessionId,
                iteration,
                toolName: parsedResponse.action,
                toolInput: mappedInput,
                toolOutput: toolOutput,
                thought: parsedResponse.thought,
              },
              relevanceScore: 0.7,
              priority: ContextPriority.MEDIUM,
              timestamp: new Date(),
              tags: ["success", "tool", parsedResponse.action, "agent"],
              taskId,
              sessionId,
            });
          }

          // Reset consecutive failures on success
          consecutiveFailures = 0;

          // Mark this action as successful to prevent redundant execution
          successfulActions.add(actionInputKey);
          logger.debug(`Marked action as successful: ${actionInputKey}`);
        } catch (toolError) {
          const errorMessage =
            toolError instanceof Error ? toolError.message : String(toolError);
          consecutiveFailures++;

          // Log failed tool execution
          const toolDuration = Date.now() - llmStartTime;
          logToolExecution(
            parsedResponse.action,
            agentContext,
            mappedInput,
            undefined,
            toolDuration,
            false,
            errorMessage
          );

          // Report action error
          if (progressCallback?.onActionResult) {
            progressCallback.onActionResult("", errorMessage);
          }

          // Record the failed tool call with already mapped input
          const toolCall = chatSession.recordToolCall(
            parsedResponse.action,
            mappedInput,
            undefined,
            errorMessage
          );

          const action: AgentAction = {
            thought: parsedResponse.thought,
            toolCall,
            timestamp: new Date(),
          };

          chatSession.addAction(action);
          actions.push(action);

          // Record failed tool execution in context system
          if (this.contextManager) {
            await this.contextManager.addContext({
              id: `error_${taskId}_${iteration}`,
              type: ContextType.TASK,
              source: ContextSource.ERROR_RECOVERY,
              content: `Failed to execute ${parsedResponse.action}: ${errorMessage}`,
              metadata: {
                taskId,
                sessionId,
                iteration,
                toolName: parsedResponse.action,
                toolInput: mappedInput,
                error: errorMessage,
                thought: parsedResponse.thought,
                consecutiveFailures,
              },
              relevanceScore: 0.8,
              priority: ContextPriority.HIGH,
              timestamp: new Date(),
              tags: [
                "error",
                "failure",
                "tool",
                parsedResponse.action,
                "agent",
              ],
              taskId,
              sessionId,
            });
          }

          // Check if we've had too many consecutive failures
          if (consecutiveFailures >= maxConsecutiveFailures) {
            logger.error(
              `Too many consecutive failures (${consecutiveFailures}). Stopping execution.`
            );
            chatSession.addAIMessage(
              `Unable to complete the task due to repeated errors. Last error: ${errorMessage}`
            );
            break;
          }

          // Try to recover from the error with improved parameter preservation
          const errorPrompt = await this.promptBuilder.buildErrorPrompt(
            toolCall.error!,
            parsedResponse.action,
            parsedResponse.actionInput,
            chatSession.getActionsSummary()
          );

          // Add context about parameter format requirements
          const enhancedErrorPrompt = `${errorPrompt}

IMPORTANT: When retrying, ensure parameters match the exact format required by the tool:
- file_read requires: {"filePath": "path/to/file"}
- file_write requires: {"filePath": "path/to/file", "content": "file content"}
- file_list requires: {"dirPath": "path/to/directory"}

Previous attempt failed with: ${toolCall.error}
Original action input was: ${JSON.stringify(parsedResponse.actionInput)}

Please retry with the correct parameter format.`;

          const errorResponse = await this.llm.generateText(
            enhancedErrorPrompt
          );
          logger.debug("Error recovery response:", errorResponse);
        }
      }

      // Get the final content from the last AI message in the chat session
      const messages = chatSession.getMessages();
      const aiMessages = messages.filter((msg) => msg instanceof AIMessage);
      const lastAIMessage = aiMessages[aiMessages.length - 1];

      logger.debug(
        `[AGENT] Final content extraction - Found ${aiMessages.length} AI messages`
      );
      logger.debug(`[AGENT] Total messages in session: ${messages.length}`);
      if (lastAIMessage) {
        logger.debug(
          `[AGENT] Last AI message content type: ${typeof lastAIMessage.content}`
        );
        logger.debug(
          `[AGENT] Last AI message content preview: "${
            typeof lastAIMessage.content === "string"
              ? lastAIMessage.content.substring(0, 100) + "..."
              : "Non-string content"
          }"`
        );
      } else {
        logger.debug(`[AGENT] No AI messages found in session`);
      }

      // Determine the final content with improved fallback logic
      let finalContent: string;

      if (lastAIMessage) {
        finalContent =
          typeof lastAIMessage.content === "string"
            ? lastAIMessage.content
            : JSON.stringify(lastAIMessage.content);
      } else {
        // No AI messages - create a summary from actions
        const actionsSummary = chatSession.getActionsSummary();
        if (actionsSummary && actionsSummary.trim().length > 0) {
          finalContent = `Task completed. Actions performed:\n${actionsSummary}`;
        } else if (actions.length > 0) {
          finalContent = `Task completed successfully. Performed ${actions.length} action(s).`;
        } else {
          finalContent = "Task analyzed and completed.";
        }
        logger.warn(
          `[AGENT] No AI message found, using fallback: "${finalContent}"`
        );
      }

      // Ensure we have meaningful content
      if (!finalContent || finalContent.trim().length === 0) {
        finalContent = "Task completed successfully.";
        logger.warn(
          `[AGENT] Empty final content, using default completion message`
        );
      }

      logger.debug(
        `[AGENT] Final content for response: "${finalContent.substring(
          0,
          200
        )}..."`
      );
      logger.debug(`[AGENT] Final content length: ${finalContent.length}`);
      const baseResponse: AgentResponse = {
        content: finalContent,
        actions,
        success: true,
      };

      // Format the response for better user experience
      try {
        logger.debug("[AGENT] Formatting response for user");
        const formattedResponse = await this.responseFormatter.formatResponse(
          task,
          baseResponse,
          finalContent
        );

        baseResponse.formatted = formattedResponse;
        baseResponse.content = formattedResponse.summary;

        logger.debug("[AGENT] Response formatted successfully", {
          originalLength: finalContent.length,
          formattedLength: formattedResponse.summary.length,
        });
      } catch (formatError) {
        logger.warn(
          "[AGENT] Failed to format response, using original:",
          formatError
        );
        // Continue with original response if formatting fails
      }

      // Record task completion in context system
      if (this.contextManager) {
        await this.contextManager.addContext({
          id: `task_complete_${taskId}`,
          type: ContextType.TASK,
          source: ContextSource.SUCCESS_PATTERN,
          content: `Task completed successfully: ${task}. Final result: ${
            finalContent.length > 300
              ? finalContent.substring(0, 300) + "..."
              : finalContent
          }`,
          metadata: {
            taskId,
            sessionId,
            endTime: new Date(),
            totalActions: actions.length,
            success: true,
            finalContent: finalContent,
          },
          relevanceScore: 0.9,
          priority: ContextPriority.HIGH,
          timestamp: new Date(),
          tags: ["task", "complete", "success", "agent"],
          taskId,
          sessionId,
        });
      }

      // Log successful ReAct loop completion
      const totalDuration = Date.now() - loopStartTime;
      logStageEnd('react_loop', true, totalDuration, undefined, { 
        totalActions: actions.length, 
        finalContentLength: finalContent.length,
        iterationsUsed: actions.length
      }, undefined, agentContext, sessionId);

      // Report completion
      if (progressCallback?.onComplete) {
        progressCallback.onComplete(baseResponse);
      }

      return baseResponse;
    } catch (error) {
      const errorMessage = `ReAct loop failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMessage);

      // Log failed ReAct loop
      const totalDuration = Date.now() - loopStartTime;
      logStageEnd('react_loop', false, totalDuration, undefined, undefined, errorMessage, agentContext, sessionId);

      // Record task failure in context system
      if (this.contextManager) {
        await this.contextManager.addContext({
          id: `task_failed_${taskId}`,
          type: ContextType.TASK,
          source: ContextSource.ERROR_RECOVERY,
          content: `Task failed: ${task}. Error: ${errorMessage}`,
          metadata: {
            taskId,
            sessionId,
            endTime: new Date(),
            totalActions: actions.length,
            success: false,
            error: errorMessage,
          },
          relevanceScore: 0.8,
          priority: ContextPriority.HIGH,
          timestamp: new Date(),
          tags: ["task", "failed", "error", "agent"],
          taskId,
          sessionId,
        });
      }

      const response: AgentResponse = {
        content: errorMessage,
        actions,
        success: false,
        error: errorMessage,
      };

      // Report completion even on error
      if (progressCallback?.onComplete) {
        progressCallback.onComplete(response);
      }

      return response;
    }
  }

  /**
   * Create the agent prompt template
   */
  private async createAgentPrompt(): Promise<ChatPromptTemplate> {
    try {
      logger.debug("[AGENT PROMPT] Starting prompt creation...");

      // Get tools description
      const toolsDescription = await this.promptBuilder.getToolsDescription();
      logger.debug("[AGENT PROMPT] Tools description generated:", {
        length: toolsDescription.length,
        preview: toolsDescription.substring(0, 200) + "...",
      });

      // Get system prompt template
      const systemPromptTemplate = this.promptBuilder.createSystemPrompt();
      logger.debug("[AGENT PROMPT] System prompt template created");

      // Format the system prompt
      const systemPromptText = await systemPromptTemplate.format({
        tools: toolsDescription,
      });
      logger.debug("[AGENT PROMPT] System prompt formatted:", {
        length: systemPromptText.length,
        preview: systemPromptText.substring(0, 300) + "...",
      });

      // Create the chat prompt template
      const chatPrompt = ChatPromptTemplate.fromMessages([
        ["system", systemPromptText],
        ["placeholder", "{chat_history}"],
        ["human", "{input}"],
        ["placeholder", "{agent_scratchpad}"],
      ]);

      logger.debug("[AGENT PROMPT] Chat prompt template created successfully");
      return chatPrompt;
    } catch (error) {
      logger.error("[AGENT PROMPT] Failed to create prompt:", error);
      logger.error("[AGENT PROMPT] Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Parse agent response for thought/action/input pattern
   */
  private parseAgentResponse(response: string): {
    thought: string;
    action?: string;
    actionInput?: any;
    finalAnswer?: string;
  } {
    if (!response || typeof response !== "string") {
      return { thought: "No response received" };
    }

    let thought = "";
    let action: string | undefined;
    let actionInput: any;
    let finalAnswer: string | undefined;

    // Clean up the response - remove extra whitespace and normalize line endings
    const cleanResponse = response.replace(/\r\n/g, "\n").trim();

    // Parse THOUGHT - be more flexible with patterns
    const thoughtMatch = cleanResponse.match(
      /(?:^|\n)THOUGHT:\s*([\s\S]*?)(?=\n(?:ACTION|FINAL_ANSWER|ANSWER):|$)/
    );
    if (thoughtMatch) {
      thought = thoughtMatch[1].trim();
    }

    // Parse ACTION - only accept valid tool names
    const validTools = this.toolManager.getToolNames();
    const actionMatch = cleanResponse.match(/(?:^|\n)ACTION:\s*(\w+)(?=\n|$)/m);
    if (actionMatch) {
      const potentialAction = actionMatch[1].trim();
      if (validTools.includes(potentialAction)) {
        action = potentialAction;
      } else {
        logger.warn(
          `Invalid action detected: ${potentialAction}. Valid tools: ${validTools.join(
            ", "
          )}`
        );
      }
    }

    // Parse ACTION_INPUT with improved JSON extraction
    if (action) {
      const actionInputMatch = cleanResponse.match(
        /ACTION_INPUT:\s*([^\n]*?)(?=\n|$)/m
      );
      if (actionInputMatch) {
        let inputText = actionInputMatch[1].trim();

        // Enhanced JSON extraction with corruption detection
        let jsonText = "";

        // Clean the input text of any obvious corruption markers
        let cleanInputText = inputText;

        // Remove any malformed JSON that includes escaped quotes as keys
        if (
          cleanInputText.includes('{"filePath"') ||
          cleanInputText.includes('"RESULT"')
        ) {
          logger.warn(
            `Detected corrupted JSON structure in ACTION_INPUT for ${action}: ${cleanInputText}`
          );

          // Try to extract just the core parameter from the corrupted text
          const coreParamMatch =
            cleanInputText.match(/filePath['"]*:\s*['"]*([^'",}]+)['"]*/) ||
            cleanInputText.match(
              /['"]*([A-Za-z0-9_.-]+\.(md|txt|js|ts|json|py|html|css|yaml|yml))['"]*/
            ) ||
            cleanInputText.match(/['"]*README\.md['"]*/) ||
            cleanInputText.match(/['"]*([A-Za-z0-9_.-]+)['"]*$/);

          if (coreParamMatch && coreParamMatch[1]) {
            const cleanValue = coreParamMatch[1].replace(/['"{}]/g, "");
            cleanInputText = `{"filePath": "${cleanValue}"}`;
            logger.debug(
              `Reconstructed clean JSON for ${action}: ${cleanInputText}`
            );
          } else {
            // Fallback to default
            cleanInputText = '{"filePath": "README.md"}';
            logger.debug(
              `Using fallback JSON for ${action}: ${cleanInputText}`
            );
          }
        }

        // Look for JSON that starts immediately (most common correct case)
        const immediateJsonMatch = cleanInputText.match(
          /^(\{[^}]*\}|\[[^\]]*\])/
        );
        if (immediateJsonMatch) {
          jsonText = immediateJsonMatch[1];
        } else {
          // Fallback: look for any JSON in the text
          const anyJsonMatch = cleanInputText.match(/(\{[^}]*\}|\[[^\]]*\])/);
          if (anyJsonMatch) {
            jsonText = anyJsonMatch[1];
          }
        }

        try {
          if (jsonText) {
            let parsed = JSON.parse(jsonText);

            // Validate that we got a clean object with proper parameter structure
            if (parsed && typeof parsed === "object") {
              // Check for corrupted parameter structure (keys that look like JSON)
              const corruptedKeys = Object.keys(parsed).filter(
                (key) =>
                  key.includes('"') || key.includes("{") || key.includes("}")
              );

              if (corruptedKeys.length > 0) {
                logger.warn(
                  `Detected corrupted parameter keys for ${action}:`,
                  corruptedKeys,
                  `Full object:`,
                  parsed
                );
                throw new Error("Corrupted parameter structure detected");
              }

              // Check if there's an "input" field that contains the actual parameters
              if (parsed.input && typeof parsed.input === "string") {
                try {
                  // Try to parse the nested JSON string
                  const nestedParams = JSON.parse(parsed.input);
                  if (nestedParams && typeof nestedParams === "object") {
                    // Validate nested parameters don't have corrupted keys
                    const nestedCorruptedKeys = Object.keys(
                      nestedParams
                    ).filter(
                      (key) =>
                        key.includes('"') ||
                        key.includes("{") ||
                        key.includes("}")
                    );

                    if (nestedCorruptedKeys.length === 0) {
                      actionInput = nestedParams;
                      logger.debug(
                        `Extracted clean nested parameters from input field for ${action}:`,
                        actionInput
                      );
                    } else {
                      logger.warn(
                        `Nested parameters also corrupted for ${action}`
                      );
                      actionInput = parsed;
                    }
                  } else {
                    actionInput = parsed;
                  }
                } catch (nestedError) {
                  logger.debug(
                    `Failed to parse nested input field for ${action}:`,
                    nestedError
                  );
                  actionInput = parsed;
                }
              } else {
                actionInput = parsed;
              }
            } else {
              actionInput = parsed;
            }

            logger.debug(
              `Successfully parsed ACTION_INPUT for ${action}:`,
              actionInput
            );
          } else {
            // Fallback: try to extract simple key-value pairs
            logger.warn(
              `No valid JSON found in ACTION_INPUT for ${action}, trying fallback parsing:`,
              inputText
            );

            // Look for quoted key-value pairs
            const kvMatches = inputText.match(/"([^"]+)"\s*:\s*"([^"]+)"/g);
            if (kvMatches) {
              actionInput = {};
              kvMatches.forEach((match) => {
                const matchResult = match.match(/"([^"]+)"\s*:\s*"([^"]+)"/);
                if (matchResult && matchResult.length >= 3) {
                  const key = matchResult[1];
                  const value = matchResult[2];
                  actionInput[key] = value;
                }
              });
            } else {
              // Last resort: assume single parameter
              actionInput = { filePath: inputText.replace(/['"]/g, "") };
            }
          }

          // Validate that we have proper parameters
          if (!actionInput || typeof actionInput !== "object") {
            logger.warn(
              `Invalid ACTION_INPUT format for ${action}:`,
              inputText
            );
            actionInput = {};
          }
        } catch (parseError) {
          logger.warn(
            `Failed to parse ACTION_INPUT JSON for ${action}:`,
            jsonText || inputText,
            parseError
          );

          // Enhanced emergency fallback with corruption detection
          if (action === "file_read") {
            // Try to extract a clean file path from corrupted input
            let cleanFilePath = "README.md"; // Default fallback

            // Look for any mention of a file path in the input text
            const filePathPatterns = [
              /filePath['"]*:\s*['"]*([^'",}]+)['"]*/, // Match filePath: "value"
              /['"]*filePath['"]*[^:]*['"]*([^'",}]+)['"]*/, // Match any filePath variant
              /([A-Za-z0-9_.-]+\.(md|txt|js|ts|json|py|html|css|yaml|yml))/, // Match file extensions
              /([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:md|txt|js|ts|json|py|html|css))/, // Match paths with extensions
            ];

            for (const pattern of filePathPatterns) {
              const match = inputText.match(pattern);
              if (
                match &&
                match[1] &&
                !match[1].includes('"') &&
                !match[1].includes("{")
              ) {
                cleanFilePath = match[1].trim();
                logger.debug(
                  `Recovered clean file path from corrupted input: ${cleanFilePath}`
                );
                break;
              }
            }

            actionInput = { filePath: cleanFilePath };
          } else if (action === "file_list") {
            // Extract directory path or default to current
            const dirMatch = inputText.match(
              /([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/
            );
            if (
              dirMatch &&
              !dirMatch[1].includes('"') &&
              !dirMatch[1].includes("{")
            ) {
              actionInput = { dirPath: dirMatch[1] };
            } else {
              actionInput = { dirPath: "." };
            }
          } else if (action === "file_write") {
            // Try to extract path and content safely
            const pathMatch = inputText.match(
              /([A-Za-z0-9_.-]+\.(md|txt|js|ts|json|py|html|css))/
            );
            const filePath =
              pathMatch && !pathMatch[1].includes('"')
                ? pathMatch[1]
                : "new-file.md";
            const content =
              inputText.length > 0
                ? inputText.replace(/[{}'"]/g, " ").trim() // Clean up corrupted content
                : "# New File\n\nContent to be added.";
            actionInput = { filePath, content };
          } else {
            actionInput = {};
          }

          logger.warn(
            `Applied emergency fallback parameters for ${action}:`,
            actionInput
          );
        }
      } else {
        // If we have an action but no input, provide sensible defaults based on action type
        logger.warn(
          `No ACTION_INPUT found for ${action}, providing default parameters`
        );

        if (action === "file_read") {
          // For file_read, try to infer from context or provide common files
          actionInput = { filePath: "README.md" };
        } else if (action === "file_list") {
          // For file_list, default to current directory
          actionInput = { dirPath: "." };
        } else if (action === "file_write") {
          // For file_write, this is problematic as we need both path and content
          // Try to extract from the thought or surrounding context
          if (thought && thought.toLowerCase().includes("ollama")) {
            actionInput = {
              filePath: "ollama-agent.md",
              content:
                "# Ollama Agent\n\nThis document contains information about the Ollama Agent extension.",
            };
          } else {
            actionInput = {
              filePath: "new-file.md",
              content: "# New File\n\nContent to be added.",
            };
          }
        } else {
          actionInput = {};
        }

        logger.debug(`Provided default parameters for ${action}:`, actionInput);
      }
    }

    // Parse FINAL_ANSWER
    const finalAnswerMatch = cleanResponse.match(
      /(?:FINAL_ANSWER|ANSWER):\s*([\s\S]*?)(?=\n(?:THOUGHT|ACTION):|$)/
    );
    if (finalAnswerMatch) {
      finalAnswer = finalAnswerMatch[1].trim();
    }

    // If no structured response found, treat the entire response as thought
    if (!thought && !action && !finalAnswer && cleanResponse.length > 0) {
      thought = cleanResponse;
    }

    logger.debug("Parsed agent response:", {
      thought: thought ? thought.substring(0, 100) + "..." : "none",
      action: action || "none",
      hasActionInput: !!actionInput,
      finalAnswer: finalAnswer ? finalAnswer.substring(0, 100) + "..." : "none",
    });

    return { thought, action, actionInput, finalAnswer };
  }

  /**
   * Map parameter names for common variations between agent output and tool expectations
   */
  private mapParameterNames(toolName: string, input: any): any {
    if (!input || typeof input !== "object") {
      return input;
    }

    // Prevent double-mapping by checking if already mapped
    if (this.isAlreadyMapped(toolName, input)) {
      logger.debug(
        `Parameters already mapped for tool ${toolName}, skipping mapping`
      );
      return input;
    }

    const mappings: Record<string, Record<string, string>> = {
      file_read: {
        file_path: "filePath",
        path: "filePath",
        filename: "filePath",
      },
      file_write: {
        file_path: "filePath",
        path: "filePath",
        filename: "filePath",
      },
      file_list: {
        dir_path: "dirPath",
        directory: "dirPath",
        path: "dirPath",
      },
      run_shell: {
        cmd: "command",
        shell_command: "command",
      },
      open_file: {
        file_path: "filePath",
        path: "filePath",
        filename: "filePath",
      },
      vscode_command: {
        cmd: "command",
        vscode_command: "command",
      },
    };

    const toolMappings = mappings[toolName];
    if (!toolMappings) {
      return input;
    }

    const mappedInput = { ...input };

    for (const [sourceKey, targetKey] of Object.entries(toolMappings)) {
      if (sourceKey in mappedInput && !(targetKey in mappedInput)) {
        mappedInput[targetKey] = mappedInput[sourceKey];
        delete mappedInput[sourceKey];
        logger.debug(
          `Mapped parameter ${sourceKey} -> ${targetKey} for tool ${toolName}`
        );
      }
    }

    return mappedInput;
  }

  /**
   * Check if parameters are already in the expected format to prevent double-mapping
   */
  private isAlreadyMapped(toolName: string, input: any): boolean {
    if (!input || typeof input !== "object") {
      return false;
    }

    const expectedParams: Record<string, string[]> = {
      file_read: ["filePath"],
      file_write: ["filePath", "content"],
      file_list: ["dirPath"],
      run_shell: ["command"],
      open_file: ["filePath"],
      vscode_command: ["command"],
    };

    const expected = expectedParams[toolName];
    if (!expected) {
      return false; // Unknown tool, allow mapping
    }

    // Check if all expected parameters are present with correct names
    return expected.every((param) => param in input);
  }

  /**
   * Extract final answer from response text
   */
  private extractFinalAnswer(response: string): string | undefined {
    if (!response) {
      logger.debug("extractFinalAnswer: Empty response");
      return undefined;
    }

    logger.debug(
      `extractFinalAnswer: Processing response of length ${response.length}`
    );

    // Look for common final answer patterns
    const finalAnswerPatterns = [
      /FINAL_ANSWER:\s*([\s\S]*?)(?=\n\n|\n$|$)/i,
      /ANSWER:\s*([\s\S]*?)(?=\n\n|\n$|$)/i,
      /(?:Here's|Here is) (?:the |a )?(?:summary|answer|result):\s*([\s\S]*?)(?=\n\n|\n$|$)/i,
      /(?:^|\n)([^:]+)$/m, // Last line that doesn't contain a colon (likely a conclusion)
    ];

    for (let i = 0; i < finalAnswerPatterns.length; i++) {
      const pattern = finalAnswerPatterns[i];
      const match = response.match(pattern);
      if (match && match[1]) {
        const result = match[1].trim();
        if (result.length > 10) {
          // Ensure it's substantial
          logger.debug(
            `extractFinalAnswer: Found with pattern ${i}, length: ${result.length}`
          );
          return result;
        }
      }
    }

    // If no explicit final answer found, check if the response looks like a complete answer
    // (doesn't contain THOUGHT/ACTION patterns and is substantial)
    if (
      !response.includes("THOUGHT:") &&
      !response.includes("ACTION:") &&
      !response.includes("ACTION_INPUT:") &&
      response.length > 50
    ) {
      const cleanResponse = response.trim();
      logger.debug(
        `extractFinalAnswer: Using clean response as final answer, length: ${cleanResponse.length}`
      );
      return cleanResponse;
    }

    logger.debug("extractFinalAnswer: No suitable final answer found");
    return undefined;
  }

  /**
   * Get workspace context information
   */
  private async getWorkspaceContext(): Promise<string> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return "No workspace folder found";
      }

      // Get basic workspace info
      const workspaceName = workspaceFolder.name;
      const workspacePath = workspaceFolder.uri.fsPath;

      // Try to get project structure
      try {
        const files = await this.toolManager.executeTool("file_list", {
          dirPath: ".",
          recursive: false,
        });

        return `Workspace: ${workspaceName}
Path: ${workspacePath}

Root files and directories:
${files}`;
      } catch {
        return `Workspace: ${workspaceName}
Path: ${workspacePath}`;
      }
    } catch (error) {
      logger.warn("Failed to get workspace context:", error);
      return "Unable to determine workspace context";
    }
  }

  /**
   * Check if Ollama is available
   */
  async isOllamaAvailable(): Promise<boolean> {
    return await this.chatModel.isAvailable();
  }

  /**
   * Check if the configured model is available
   */
  async isModelAvailable(): Promise<boolean> {
    return await this.chatModel.isModelAvailable(this.config.model);
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<string[]> {
    return await this.chatModel.listModels();
  }

  /**
   * Update the model configuration
   */
  updateModel(newModel: string): void {
    this.config.model = newModel;

    // Update LLM instances with new model
    this.llm = new OllamaLLM({
      baseUrl: this.config.ollamaUrl,
      model: newModel,
      temperature: this.config.temperature || 0.7,
    });

    this.chatModel = new OllamaChatModel({
      baseUrl: this.config.ollamaUrl,
      model: newModel,
      temperature: this.config.temperature || 0.7,
    });

    // Update optimized engine with new LLM instance if it exists
    if (this.optimizedEngine) {
      this.optimizedEngine = new OptimizedReActEngine(
        this.llm,
        this.toolManager,
        this.promptBuilder,
        this.contextManager,
        {
          maxIterations: this.config.maxIterations || 10,
          maxConcurrency: this.config.maxConcurrency || 3,
          enableParallelExecution:
            this.config.enableParallelExecution !== false,
          enableResponseStreaming:
            this.config.enableResponseStreaming !== false,
          contextCacheSize: 50,
          aggressiveOptimization: false,
        }
      );

      logger.debug(
        chalk.blue(
          `[OAVSCE] [AGENT] Recreated optimized engine with new model: ${newModel}`
        )
      );
    }

    // Update response formatter with new model
    this.responseFormatter.updateModel(newModel);

    // Reset executor to force reinitialization with new model
    this.executor = undefined;

    logger.info(chalk.green(`[OAVSCE] [AGENT] Updated model to: ${newModel}`));
  }

  /**
   * Get current model
   */
  getCurrentModel(): string {
    return this.config.model;
  }

  // IAgent interface implementation
  public getSpecialization(): AgentSpecialization {
    return AgentSpecialization.GENERAL;
  }

  public getCapabilities(): AgentCapability[] {
    return [
      {
        name: "general_task_execution",
        description: "Execute general-purpose tasks using ReAct methodology",
        toolsRequired: this.toolManager.getToolNames(),
        confidenceThreshold: 0.7,
      },
    ];
  }

  public async canHandle(task: string, context?: any): Promise<TaskAnalysis> {
    // BasicAgent can handle any task as a fallback
    return {
      primaryDomain: AgentSpecialization.GENERAL,
      confidence: 0.5, // Default confidence as fallback
      reasoningSteps: [
        "BasicAgent provides general task execution capabilities",
      ],
      requiredCapabilities: ["general_task_execution"],
      complexity: "medium",
      estimatedDuration: 30000,
    };
  }

  public getConfiguration(): any {
    return this.config;
  }

  public updateConfiguration(config: any): void {
    this.config = { ...this.config, ...config };
  }

  public getPromptTemplates(): Record<string, string> {
    return {
      general: `You are a helpful AI assistant capable of analyzing tasks and using available tools to accomplish objectives.
        Follow the ReAct methodology: Think step-by-step, plan your actions, execute tools, and provide clear responses.`,
    };
  }

  public async validateTask(
    task: string
  ): Promise<{ valid: boolean; issues: string[]; suggestions: string[] }> {
    return {
      valid: true,
      issues: [],
      suggestions: [
        "Consider using specialized agents for domain-specific tasks",
      ],
    };
  }

  public async isAvailable(): Promise<boolean> {
    return await this.isOllamaAvailable();
  }

  // IAgent executeTask implementation
  public async executeTask(
    task: string,
    session?: ChatSession,
    progressCallback?: IProgressCallback
  ): Promise<import("./IAgent").AgentResponse> {
    // Convert IProgressCallback to local ProgressCallback
    const localCallback: ProgressCallback | undefined = progressCallback
      ? {
          onThought: progressCallback.onThought,
          onAction: progressCallback.onAction,
          onActionResult: progressCallback.onActionResult,
          onStreamingResponse: progressCallback.onStreamingResponse,
          onComplete: (response) => {
            if (progressCallback.onComplete) {
              progressCallback.onComplete({
                ...response,
                agentType: AgentSpecialization.GENERAL,
                confidence: 0.8,
              });
            }
          },
        }
      : undefined;

    const result = await this.executeTaskLegacy(task, session, localCallback);

    return {
      ...result,
      agentType: AgentSpecialization.GENERAL,
      confidence: result.success ? 0.8 : 0.3,
    };
  }

  /**
   * Execute task using semantic workflow engine for enhanced context understanding
   */
  async executeSemanticTask(
    task: string,
    session?: ChatSession,
    progressCallback?: ProgressCallback,
    agentType: AgentType = AgentType.BASIC
  ): Promise<AgentResponse> {
    try {
      logger.info(`[SEMANTIC_AGENT] Executing semantic task with ${agentType} specialization: ${task.substring(0, 100)}...`);

      // Initialize semantic workflow engine
      await this.semanticWorkflowEngine.initialize();

      // Build semantic query
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const activeEditor = vscode.window.activeTextEditor;

      const semanticQuery: SemanticWorkflowQuery = {
        intent: task,
        context: activeEditor?.document.getText()?.substring(0, 2000),
        workflowType: this.mapAgentTypeToWorkflowType(agentType),
        similarityThreshold: 0.4,
        maxResults: 15,
        includeRecentActivity: true,
        includeProjectContext: !!workspaceFolder,
        includeDocumentation: true
      };

      // Execute semantic workflow analysis
      const semanticResult = await this.semanticWorkflowEngine.executeSemanticWorkflow(semanticQuery);
      
      logger.info(`[SEMANTIC_AGENT] Semantic analysis completed with confidence: ${semanticResult.confidence.toFixed(2)}`);

      // Build enhanced prompt context
      const promptContext: PromptContext = {
        workspacePath: workspaceFolder?.uri.fsPath,
        currentFile: activeEditor?.document.fileName,
        fileContent: activeEditor?.document.getText(),
        contextItems: semanticResult.contextItems,
        userTask: task,
        sessionHistory: session?.getActionsSummary().split('\n').slice(-5) // Last 5 actions
      };

      // Generate specialized prompt
      const specializedPrompt = this.promptTemplates.generatePrompt(agentType, promptContext);
      
      // Enhanced task with semantic context
      const enhancedTask = this.buildEnhancedTask(task, semanticResult, specializedPrompt);

      // Execute with enhanced context awareness
      let result: AgentResponse;
      
      if (semanticResult.executionStrategy === "auto_execute" && semanticResult.confidence >= 0.8) {
        // High confidence - execute automatically with guided actions
        result = await this.executeWithSemanticGuidance(enhancedTask, semanticResult, session, progressCallback);
      } else {
        // Use traditional execution with enhanced context
        result = await this.executeTaskLegacy(enhancedTask, session, progressCallback);
      }

      // Store semantic workflow result for learning
      await this.storeLearningContext(task, semanticResult, result);

      logger.info(`[SEMANTIC_AGENT] Semantic task completed successfully`);
      return result;

    } catch (error) {
      logger.error("[SEMANTIC_AGENT] Semantic task execution failed:", error);
      
      // Fallback to traditional execution
      logger.info("[SEMANTIC_AGENT] Falling back to traditional execution");
      return await this.executeTaskLegacy(task, session, progressCallback);
    }
  }

  /**
   * Execute task with semantic guidance and suggested actions
   */
  private async executeWithSemanticGuidance(
    task: string,
    semanticResult: any,
    session?: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse> {
    const chatSession = session || new ChatSession();
    const actions: AgentAction[] = [];

    try {
      // Progress callback for semantic execution
      if (progressCallback?.onThought) {
        progressCallback.onThought(`Using semantic guidance with ${semanticResult.suggestedActions.length} suggested actions`);
      }

      // Execute high-confidence suggested actions first
      const prioritizedActions = semanticResult.suggestedActions
        .filter((action: any) => action.confidence >= 0.7)
        .sort((a: any, b: any) => b.priority - a.priority)
        .slice(0, 3); // Top 3 high-confidence actions

      for (const suggestedAction of prioritizedActions) {
        if (suggestedAction.type === "tool_execution" && suggestedAction.toolName) {
          try {
            if (progressCallback?.onAction) {
              progressCallback.onAction(suggestedAction.toolName, suggestedAction.parameters || {});
            }

            const toolResult = await this.toolManager.executeTool(
              suggestedAction.toolName,
              suggestedAction.parameters || {}
            );

            const action: AgentAction = {
              thought: `Semantic guidance: ${suggestedAction.description}`,
              toolCall: {
                id: `semantic_${Date.now()}`,
                toolName: suggestedAction.toolName,
                input: suggestedAction.parameters || {},
                output: toolResult,
                timestamp: new Date()
              },
              timestamp: new Date()
            };

            actions.push(action);
            chatSession.addAction(action);

            if (progressCallback?.onActionResult) {
              progressCallback.onActionResult(toolResult);
            }

          } catch (error) {
            logger.warn(`[SEMANTIC_AGENT] Suggested action failed: ${error}`);
          }
        }
      }

      // Build enhanced context with semantic insights
      let enhancedContext = `\n\nSemantic Analysis Insights:\n`;
      enhancedContext += `- Confidence: ${(semanticResult.confidence * 100).toFixed(1)}%\n`;
      enhancedContext += `- Context Items Found: ${semanticResult.contextItems.length}\n`;
      enhancedContext += `- Documentation References: ${semanticResult.documentationChunks.length}\n`;
      enhancedContext += `- Related Patterns: ${semanticResult.relatedWorkflows.length}\n`;

      if (semanticResult.contextItems.length > 0) {
        enhancedContext += `\nRelevant Context:\n`;
        semanticResult.contextItems.slice(0, 3).forEach((item: any, index: number) => {
          enhancedContext += `${index + 1}. [${item.type}] ${item.content.substring(0, 100)}...\n`;
        });
      }

      // Continue with traditional ReAct execution for remaining task
      const finalTask = task + enhancedContext;
      const remainingResult = await this.executeTaskLegacy(finalTask, chatSession, progressCallback);

      // Combine results
      return {
        content: remainingResult.content,
        actions: [...actions, ...remainingResult.actions],
        success: remainingResult.success,
        error: remainingResult.error,
        formatted: remainingResult.formatted
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[SEMANTIC_AGENT] Semantic guidance execution failed:", error);
      
      return {
        content: `Semantic execution failed: ${errorMessage}`,
        actions,
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Build enhanced task description with semantic context
   */
  private buildEnhancedTask(task: string, semanticResult: any, specializedPrompt: any): string {
    let enhancedTask = task;

    // Add specialized prompt context
    if (specializedPrompt.contextualPrompt) {
      enhancedTask += `\n\n${specializedPrompt.contextualPrompt}`;
    }

    // Add semantic insights
    if (semanticResult.confidence >= 0.6) {
      enhancedTask += `\n\nSemantic Analysis Results:`;
      enhancedTask += `\nConfidence: ${(semanticResult.confidence * 100).toFixed(1)}%`;
      enhancedTask += `\nExecution Strategy: ${semanticResult.executionStrategy}`;
      
      if (semanticResult.suggestedActions.length > 0) {
        enhancedTask += `\nSuggested Actions: ${semanticResult.suggestedActions.slice(0, 3)
          .map((action: any) => action.description).join(', ')}`;
      }
    }

    return enhancedTask;
  }

  /**
   * Map agent type to workflow type for semantic search
   */
  private mapAgentTypeToWorkflowType(agentType: AgentType): "code_analysis" | "documentation" | "problem_solving" | "task_execution" {
    switch (agentType) {
      case AgentType.CODE_REVIEW:
      case AgentType.REFACTORING:
        return "code_analysis";
      case AgentType.DOCUMENTATION:
        return "documentation";
      case AgentType.DEVOPS:
      case AgentType.TEST_AUTOMATION:
        return "problem_solving";
      default:
        return "task_execution";
    }
  }

  /**
   * Store learning context for future semantic improvements
   */
  private async storeLearningContext(
    originalTask: string,
    semanticResult: any,
    executionResult: AgentResponse
  ): Promise<void> {
    try {
      if (!this.contextManager) return;

      const learningContext = {
        id: `semantic_learning_${Date.now()}`,
        type: ContextType.LONG_TERM,
        source: ContextSource.CONSOLIDATED_LEARNING,
        content: `Task: ${originalTask}\nConfidence: ${semanticResult.confidence}\nSuccess: ${executionResult.success}\nActions: ${executionResult.actions.length}`,
        metadata: {
          semanticConfidence: semanticResult.confidence,
          executionStrategy: semanticResult.executionStrategy,
          suggestedActionsCount: semanticResult.suggestedActions.length,
          success: executionResult.success,
          taskType: this.inferTaskType(originalTask)
        },
        relevanceScore: executionResult.success ? 0.8 : 0.4,
        priority: ContextPriority.MEDIUM,
        timestamp: new Date(),
        tags: ["semantic_learning", "agent_execution"],
        sessionId: `semantic_${Date.now()}`
      };

      await this.contextManager.addContext(learningContext);
      logger.debug("[SEMANTIC_AGENT] Stored learning context for future improvement");

    } catch (error) {
      logger.warn("[SEMANTIC_AGENT] Failed to store learning context:", error);
    }
  }

  /**
   * Infer task type from task description for better categorization
   */
  private inferTaskType(task: string): string {
    const taskLower = task.toLowerCase();
    
    if (taskLower.includes('test') || taskLower.includes('spec')) return 'testing';
    if (taskLower.includes('doc') || taskLower.includes('readme')) return 'documentation'; 
    if (taskLower.includes('review') || taskLower.includes('analyze')) return 'code_analysis';
    if (taskLower.includes('refactor') || taskLower.includes('optimize')) return 'refactoring';
    if (taskLower.includes('deploy') || taskLower.includes('build')) return 'devops';
    if (taskLower.includes('fix') || taskLower.includes('bug')) return 'debugging';
    if (taskLower.includes('create') || taskLower.includes('add')) return 'development';
    
    return 'general';
  }

  /**
   * Get semantic workflow analytics
   */
  async getSemanticAnalytics(): Promise<any> {
    try {
      await this.semanticWorkflowEngine.initialize();
      return await this.semanticWorkflowEngine.getWorkflowAnalytics();
    } catch (error) {
      logger.error("[SEMANTIC_AGENT] Failed to get analytics:", error);
      return null;
    }
  }
}
