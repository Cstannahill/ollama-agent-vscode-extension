import * as vscode from "vscode";
import { BasicAgent } from "../agents/BasicAgent";
import { AgentFactory } from "../agents/AgentFactory";
import { AgentCoordinator } from "../agents/AgentCoordinator";
import { AgentSpecialization, ProgressCallback } from "../agents/IAgent";
import { ChatSession } from "../core/ChatSession";
import { CONSTANTS } from "../config";
import { logger } from "../utils/logger";
import { getAgentDisplayInfo, getAllAgentDisplayInfo, AgentDisplayInfo } from "../agents/AgentMetadata";
import { getToolMetadata, ToolCategory, TOOL_CATEGORIES, getAllCategoriesWithCounts } from "../core/ToolMetadata";
import { ToolUsageTracker } from "../core/ToolUsageTracker";

export interface ToolCall {
  id: string;
  toolName: string;
  input: any;
  output?: string;
  error?: string;
  timestamp: Date;
}

export interface AgentAction {
  thought: string;
  toolCall?: ToolCall;
  observation?: string;
  timestamp: Date;
}

export interface WorkflowTask {
  id: string;
  description: string;
  agentType: AgentSpecialization;
  dependencies: string[];
  priority: number;
  estimatedDuration: number;
  status: "pending" | "running" | "completed" | "failed";
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  progress?: number;
}

export interface WorkflowVisualization {
  id: string;
  originalTask: string;
  complexity: string;
  tasks: WorkflowTask[];
  startTime: Date;
  endTime?: Date;
  successRate?: number;
  isActive: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  isError?: boolean;
  actions?: AgentAction[];
  isProcessing?: boolean;
  model?: string; // Added to track which model generated the message
  workflow?: WorkflowVisualization; // Added for multi-agent workflow visualization
}

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _messages: ChatMessage[] = [];
  private _agent: BasicAgent;
  private _agentFactory?: AgentFactory;
  private _agentCoordinator?: AgentCoordinator;
  private _chatSession: ChatSession;
  private _selectedAgentType: AgentSpecialization = AgentSpecialization.GENERAL;
  private _agentDisplayInfo: AgentDisplayInfo[] = [];
  private _useAutoAgentSelection: boolean = true;
  private _activeWorkflows: Map<string, WorkflowVisualization> = new Map();
  private _toolUsageTracker: ToolUsageTracker;
  private _activeToolSessions: Map<string, string> = new Map(); // messageId -> sessionId

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    agent: BasicAgent,
    agentFactory?: AgentFactory,
    agentCoordinator?: AgentCoordinator
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._agent = agent;
    this._agentFactory = agentFactory;
    this._agentCoordinator = agentCoordinator;
    this._chatSession = new ChatSession();
    this._agentDisplayInfo = getAllAgentDisplayInfo();
    this._toolUsageTracker = ToolUsageTracker.getInstance();

    // Set the webview's initial HTML content
    this._update();


    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Update the content based on view changes
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.visible) {
          this._update();
        }
      },
      null,
      this._disposables
    );

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "sendMessage":
            await this._handleUserMessage(message.text);
            break;
          case "clearChat":
            this._clearChat();
            break;
          case "openDocumentation":
            this._openDocumentation();
            break;
          case "exportChat":
            this._exportChat();
            break;
          case "openSettings":
            this._openSettings();
            break;
          case "openProjectContext":
            this._openProjectContext();
            break;
          case "openFoundationModels":
            this._openFoundationModels();
            break;
          case "toggleSettings":
            this._toggleSettings();
            break;
          case "updateSetting":
            await this._updateSetting(message.key, message.value);
            break;
          case "loadModels":
            await this._loadModelsForSettings();
            break;
          case "changeAgent":
            this._changeSelectedAgent(message.agentType);
            break;
          case "toggleAutoAgentSelection":
            this._toggleAutoAgentSelection(message.enabled);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public static createOrShow(
    extensionUri: vscode.Uri, 
    agent: BasicAgent,
    agentFactory?: AgentFactory,
    agentCoordinator?: AgentCoordinator
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : undefined;

    // If we already have a panel, show it
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel._panel.reveal(column);
      ChatPanel.currentPanel._agent = agent; // Update agent in case it was reinitialized
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      CONSTANTS.CHAT_VIEW_TYPE,
      "Ollama Agent Chat",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
          vscode.Uri.joinPath(extensionUri, "out", "media"),
        ],
      }
    );

    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, agent, agentFactory, agentCoordinator);
  }

  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    agent: BasicAgent,
    agentFactory?: AgentFactory,
    agentCoordinator?: AgentCoordinator
  ) {
    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, agent, agentFactory, agentCoordinator);
  }

  public dispose() {
    ChatPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async _handleUserMessage(text: string) {
    if (!text.trim()) {
      return;
    }

    // Add user message
    const userMessage: ChatMessage = {
      id: this._generateId(),
      role: "user",
      content: text.trim(),
      timestamp: new Date(),
    };

    this._messages.push(userMessage);
    this._updateMessages();

    // Create processing message that will be updated progressively
    const assistantMessageId = this._generateId();
    const processingMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "Processing...",
      timestamp: new Date(),
      isError: false,
      actions: [],
      isProcessing: true,
    };

    this._messages.push(processingMessage);
    this._updateMessages();

    // Show thinking indicator
    this._showThinking(true);

    try {
      // Create progress callback for real-time updates
      const progressCallback: ProgressCallback = {
        onThought: (thought: string) => {
          // Add thinking section to current message
          logger.debug(`[CHAT] Progressive thought update: "${thought.substring(0, 100)}..."`);
          this._addProgressiveThought(assistantMessageId, thought);
        },
        onAction: (action: string, input: any) => {
          // Add action indicator to current message
          logger.debug(`[CHAT] Progressive action update: ${action} with input:`, input);
          this._addProgressiveActionUpdate(assistantMessageId, action, input);
          
          // Start tool usage tracking
          const sessionId = `${assistantMessageId}_${action}_${Date.now()}`;
          this._toolUsageTracker.startToolUsage(action, sessionId);
          this._activeToolSessions.set(assistantMessageId, sessionId);
        },
        onActionResult: (output: string, error?: string) => {
          // Update the last action with result
          logger.debug(`[CHAT] Progressive action result update:`, { 
            outputLength: output?.length || 0, 
            hasError: !!error 
          });
          this._updateActionResult(assistantMessageId, output, error);
          
          // End tool usage tracking
          const sessionId = this._activeToolSessions.get(assistantMessageId);
          if (sessionId) {
            this._toolUsageTracker.endToolUsage(sessionId, !error, error);
            this._activeToolSessions.delete(assistantMessageId);
          }
        },
        onStreamingResponse: (chunk: string) => {
          // Handle streaming response chunks
          logger.debug(`[CHAT] Streaming response chunk: "${chunk.substring(0, 50)}..."`);
          this._addStreamingResponseChunk(assistantMessageId, chunk);
        },
        onComplete: (_response) => {
          // Final update handled below
        },
        
        // Multi-agent workflow callbacks
        onWorkflowStart: (taskPlan: any[], complexity: string) => {
          logger.debug(`[CHAT] Workflow started with ${taskPlan.length} tasks (${complexity} complexity)`);
          this._createWorkflowVisualization(assistantMessageId, text, taskPlan, complexity);
        },
        onTaskStart: (taskId: string, agentType: AgentSpecialization, description: string) => {
          logger.debug(`[CHAT] Task started: ${taskId} (${agentType})`);
          this._updateWorkflowTask(assistantMessageId, taskId, { status: "running", startTime: new Date() });
        },
        onTaskProgress: (taskId: string, progress: number, status: string) => {
          logger.debug(`[CHAT] Task progress: ${taskId} - ${progress}%`);
          this._updateWorkflowTask(assistantMessageId, taskId, { progress, status: "running" });
        },
        onTaskComplete: (taskId: string, success: boolean, duration: number) => {
          logger.debug(`[CHAT] Task completed: ${taskId} - ${success ? 'success' : 'failed'}`);
          this._updateWorkflowTask(assistantMessageId, taskId, { 
            status: success ? "completed" : "failed", 
            endTime: new Date(),
            duration 
          });
        },
        onWorkflowComplete: (results: any[], successRate: number) => {
          logger.debug(`[CHAT] Workflow completed with ${Math.round(successRate * 100)}% success rate`);
          this._completeWorkflowVisualization(assistantMessageId, results, successRate);
        },
      };

      // Execute task with appropriate agent based on selection mode
      let response;
      let actualAgentType = AgentSpecialization.GENERAL;

      if (this._useAutoAgentSelection && this._agentCoordinator) {
        // Use multi-agent coordination for automatic selection
        try {
          response = await this._agentCoordinator.orchestrateTask(text, undefined, progressCallback);
        } catch (error) {
          logger.warn("Multi-agent coordination failed, falling back to basic agent:", error);
          response = await this._agent.executeTask(text, this._chatSession, progressCallback);
        }
      } else if (this._useAutoAgentSelection && this._agentFactory) {
        // Use automatic single agent selection
        try {
          const { agent, analysis } = await this._agentFactory.selectBestAgent(text, undefined, progressCallback);
          actualAgentType = agent.getSpecialization();
          
          // Show which agent was selected
          progressCallback?.onThought?.(`🎯 Selected ${getAgentDisplayInfo(actualAgentType).displayName} (confidence: ${Math.round(analysis.confidence * 100)}%)`);
          
          response = await agent.executeTask(text, this._chatSession, progressCallback);
        } catch (error) {
          logger.warn("Failed to select specialized agent, using basic agent:", error);
          response = await this._agent.executeTask(text, this._chatSession, progressCallback);
        }
      } else if (this._selectedAgentType !== AgentSpecialization.GENERAL && this._agentFactory) {
        // Use manually selected specialized agent
        try {
          const selectedAgent = this._agentFactory.getAgentSync(this._selectedAgentType);
          if (selectedAgent) {
            actualAgentType = this._selectedAgentType;
            progressCallback?.onThought?.(`🎯 Using ${getAgentDisplayInfo(actualAgentType).displayName} (manual selection)`);
            response = await selectedAgent.executeTask(text, this._chatSession, progressCallback);
          } else {
            throw new Error(`Agent ${this._selectedAgentType} not found`);
          }
        } catch (error) {
          logger.warn("Failed to use selected agent, using basic agent:", error);
          response = await this._agent.executeTask(text, this._chatSession, progressCallback);
        }
      } else {
        // Use basic agent
        response = await this._agent.executeTask(text, this._chatSession, progressCallback);
      }

      logger.debug(`Agent response:`, {
        success: response.success,
        contentLength: response.content?.length || 0,
        content: response.content?.substring(0, 200) + "...",
        actionsCount: response.actions?.length || 0,
      });

      // Update the processing message to mark completion (preserve all progressive content)
      const messageIndex = this._messages.findIndex(
        (m) => m.id === assistantMessageId
      );
      if (messageIndex >= 0) {
        const existingMessage = this._messages[messageIndex];

        // Update existing message to mark as complete while preserving all progressive content
        this._messages[messageIndex] = {
          ...existingMessage,
          isError: !response.success,
          isProcessing: false,
          actions: response.actions || existingMessage.actions || [],
        };

        // Store the final response content for rendering by the UI
        // Don't call _updateMessageContent as it rebuilds content as plain text
        // The UI will render the structured agentic flow from the actions array
        if (
          response.content &&
          response.content !== "Task completed" &&
          response.content.trim().length > 0
        ) {
          // Store the final response content - the UI will render it properly
          this._messages[messageIndex].content = response.content;
        } else {
          // Set a default completion message
          this._messages[messageIndex].content = "Task completed";
        }

        logger.debug(
          `Updated message ${assistantMessageId} to completion state, preserved progressive content`,
          {
            actionsCount: this._messages[messageIndex].actions?.length || 0,
            finalContentLength: this._messages[messageIndex].content?.length || 0,
            isProcessing: this._messages[messageIndex].isProcessing
          }
        );
        
        // Send updated messages to webview to reflect completion state
        this._updateMessages();
      }

      // Log actions taken if any
      if (response.actions && response.actions.length > 0) {
        logger.info(
          `Agent took ${response.actions.length} actions:`,
          response.actions
        );
      }
    } catch (error) {
      // Add error message
      const errorMessage: ChatMessage = {
        id: this._generateId(),
        role: "assistant",
        content: `Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        timestamp: new Date(),
        isError: true,
      };

      this._messages.push(errorMessage);
      logger.error("Chat error:", error);
    } finally {
      this._showThinking(false);
      this._updateMessages();
    }
  }

  private _clearChat() {
    this._messages = [];
    this._chatSession = new ChatSession();
    this._updateMessages();
    logger.info("Chat cleared");
  }

  private _openDocumentation() {
    // Execute the VS Code command to open documentation panel
    vscode.commands.executeCommand(CONSTANTS.COMMANDS.OPEN_DOCUMENTATION);
    logger.info("[CHAT] Documentation panel opened from chat");
  }

  private _exportChat() {
    const chatContent = this._messages
      .map((msg) => {
        const timestamp = msg.timestamp.toLocaleString();
        const role = msg.role.toUpperCase();
        return `[${timestamp}] ${role}: ${msg.content}`;
      })
      .join("\n\n");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `ollama-chat-${timestamp}.txt`;

    vscode.workspace
      .openTextDocument({
        content: chatContent,
        language: "plaintext",
      })
      .then((doc) => {
        vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`Chat exported as ${filename}`);
      });
  }

  private _openSettings() {
    vscode.commands.executeCommand(CONSTANTS.COMMANDS.OPEN_SETTINGS);
    logger.info("Opening settings from chat panel");
  }

  private _openProjectContext() {
    vscode.commands.executeCommand(CONSTANTS.COMMANDS.OPEN_PROJECT_CONTEXT);
    logger.info("Opening project context from chat panel");
  }

  private _openFoundationModels() {
    vscode.commands.executeCommand(CONSTANTS.COMMANDS.OPEN_FOUNDATION_MODELS);
    logger.info("Opening foundation models from chat panel");
  }

  /**
   * Toggle the inline settings view
   */
  private _toggleSettings(): void {
    this._panel.webview.postMessage({
      command: "toggleSettingsView",
    });
  }

  /**
   * Update a setting from the inline settings view
   */
  private async _updateSetting(key: string, value: any): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration("ollamaAgent");
      await config.update(key, value, vscode.ConfigurationTarget.Workspace);
      
      // Send success message
      this._panel.webview.postMessage({
        command: "settingUpdated",
        key,
        value,
        success: true,
      });

      logger.info(`Setting updated: ${key} = ${value}`);
    } catch (error) {
      // Send error message
      this._panel.webview.postMessage({
        command: "settingUpdated",
        key,
        value,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      
      logger.error(`Failed to update setting ${key}:`, error);
    }
  }

  /**
   * Load models for the settings view
   */
  private async _loadModelsForSettings(): Promise<void> {
    try {
      const models = await this._agent.getAvailableModels();
      this._panel.webview.postMessage({
        command: "modelsLoadedForSettings",
        models: models,
      });
    } catch (error) {
      this._panel.webview.postMessage({
        command: "modelsErrorForSettings",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private _showThinking(show: boolean) {
    this._panel.webview.postMessage({
      command: "showThinking",
      show: show,
    });
  }

  private _updateMessages() {
    // Clean model names before sending to webview
    const messagesWithCleanModels = this._messages.map((msg) => ({
      ...msg,
      model: this._cleanModelName(msg.model),
    }));

    logger.debug(
      `Updating webview with ${messagesWithCleanModels.length} messages`
    );

    this._panel.webview.postMessage({
      command: "updateMessages",
      messages: messagesWithCleanModels,
    });
  }

  /**
   * Add a progressive thought update to a message
   */
  private _addProgressiveThought(messageId: string, thought: string) {
    // Update the local message store first
    const messageIndex = this._messages.findIndex((m) => m.id === messageId);
    if (messageIndex >= 0) {
      if (!this._messages[messageIndex].actions) {
        this._messages[messageIndex].actions = [];
      }

      // Add or update the current thinking action
      let currentAction =
        this._messages[messageIndex].actions[
          this._messages[messageIndex].actions.length - 1
        ];
      if (!currentAction || currentAction.toolCall) {
        // Create new thinking action
        currentAction = {
          thought: thought,
          timestamp: new Date(),
        };
        this._messages[messageIndex].actions.push(currentAction);
      } else {
        // Update existing thinking
        currentAction.thought = thought;
      }

      // Build up the content progressively instead of overwriting
      this._updateMessageContent(messageIndex);
      this._messages[messageIndex].isProcessing = true;
    }

    // Send updated messages to webview immediately
    this._panel.webview.postMessage({
      command: "updateMessages",
      messages: this._messages,
    });
  }

  /**
   * Add streaming response chunk to a message
   */
  private _addStreamingResponseChunk(messageId: string, chunk: string) {
    // Update the local message store first
    const messageIndex = this._messages.findIndex((m) => m.id === messageId);
    if (messageIndex >= 0) {
      const message = this._messages[messageIndex];
      
      // Initialize streaming content if not already set
      if (!message.content || message.content === "Processing...") {
        message.content = "";
      }
      
      // Append the new chunk to the message content
      message.content += chunk;
      message.isProcessing = true;
      
      // Send updated messages to webview immediately for real-time streaming
      this._panel.webview.postMessage({
        command: "updateMessages",
        messages: this._messages,
      });
    }
  }

  /**
   * Add a progressive action update to a message
   */
  private _addProgressiveActionUpdate(
    messageId: string,
    actionName: string,
    input: any
  ) {
    // Update the local message store first
    const messageIndex = this._messages.findIndex((m) => m.id === messageId);
    if (messageIndex >= 0) {
      if (!this._messages[messageIndex].actions) {
        this._messages[messageIndex].actions = [];
      }

      // Get or create the current action
      let currentAction =
        this._messages[messageIndex].actions[
          this._messages[messageIndex].actions.length - 1
        ];
      if (!currentAction) {
        currentAction = {
          thought: "",
          timestamp: new Date(),
        };
        this._messages[messageIndex].actions.push(currentAction);
      }

      // Add tool call info
      currentAction.toolCall = {
        id: "progressive_" + Date.now(),
        toolName: actionName,
        input: input,
        timestamp: new Date(),
      };

      // Build up the content progressively instead of overwriting
      this._updateMessageContent(messageIndex);
      this._messages[messageIndex].isProcessing = true;
    }

    // Send updated messages to webview immediately
    this._panel.webview.postMessage({
      command: "updateMessages",
      messages: this._messages,
    });
  }

  /**
   * Update the content of a message based on its actions
   */
  private _updateMessageContent(messageIndex: number) {
    const message = this._messages[messageIndex];
    if (!message.actions || message.actions.length === 0) {
      message.content = "Processing...";
      return;
    }

    const contentParts: string[] = [];

    message.actions.forEach((action, index) => {
      if (action.thought) {
        contentParts.push(`**🤔 Thinking:** ${action.thought}`);
      }

      if (action.toolCall) {
        const toolName = action.toolCall.toolName;
        const inputStr =
          typeof action.toolCall.input === "string"
            ? action.toolCall.input
            : JSON.stringify(action.toolCall.input);

        contentParts.push(`**🔧 Action:** ${toolName}`);
        if (inputStr && inputStr.length < 100) {
          contentParts.push(`**Input:** ${inputStr}`);
        }

        if (action.toolCall.output) {
          const output =
            action.toolCall.output.length > 200
              ? action.toolCall.output.substring(0, 200) + "..."
              : action.toolCall.output;
          contentParts.push(`**Result:** ${output}`);
        }

        if (action.toolCall.error) {
          contentParts.push(`**❌ Error:** ${action.toolCall.error}`);
        }
      }

      if (action.observation) {
        contentParts.push(`**👁️ Observation:** ${action.observation}`);
      }

      // Add separator between actions (except for last one)
      if (message.actions && index < message.actions.length - 1) {
        contentParts.push("---");
      }
    });

    // If currently processing, add a processing indicator
    if (message.isProcessing) {
      contentParts.push("⏳ *Processing...*");
    }

    message.content = contentParts.join("\n\n");
  }


  /**
   * Update the result of the last action
   */
  private _updateActionResult(
    messageId: string,
    output: string,
    error?: string
  ) {
    // Update the local message store first
    const messageIndex = this._messages.findIndex((m) => m.id === messageId);
    if (
      messageIndex >= 0 &&
      this._messages[messageIndex].actions &&
      this._messages[messageIndex].actions.length > 0
    ) {
      const lastAction =
        this._messages[messageIndex].actions[
          this._messages[messageIndex].actions.length - 1
        ];
      if (lastAction.toolCall) {
        if (error) {
          lastAction.toolCall.error = error;
        } else {
          lastAction.toolCall.output = output;
        }
        lastAction.observation = error || output;

        // Build up the content progressively instead of overwriting
        this._updateMessageContent(messageIndex);
      }
    }

    // Send updated messages to webview immediately
    this._panel.webview.postMessage({
      command: "updateMessages",
      messages: this._messages,
    });
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(_webview: vscode.Webview) {
    const messagesJson = JSON.stringify(this._messages);
    const agentInfoJson = JSON.stringify(this._agentDisplayInfo);
    const currentAgentInfo = JSON.stringify(getAgentDisplayInfo(this._selectedAgentType));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ollama Agent Chat</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .chat-header {
            background-color: var(--vscode-panel-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
        }

        .chat-title {
            font-weight: 600;
            color: var(--vscode-foreground);
            min-width: fit-content;
        }

        .agent-selector-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            min-width: 200px;
        }

        .agent-selector {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .auto-agent-toggle {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .auto-agent-toggle input[type="checkbox"] {
            width: auto;
            margin: 0;
        }

        .agent-dropdown {
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            min-width: 160px;
        }

        .agent-dropdown:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .agent-dropdown:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .current-agent-indicator {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .agent-icon {
            font-size: 14px;
        }



        .chat-actions {
            display: flex;
            gap: 8px;
        }

        .action-button {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            min-width: 60px;
            min-height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            white-space: nowrap;
            text-overflow: ellipsis;
            overflow: hidden;
        }

        .action-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
            color: var(--vscode-button-foreground);
        }


        .chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .message {
            max-width: 80%;
            padding: 12px 16px;
            border-radius: 12px;
            word-wrap: break-word;
        }

        .message.user {
            align-self: flex-end;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .message.assistant {
            align-self: flex-start;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
        }

        .message.assistant.error {
            background-color: var(--vscode-inputValidation-errorBackground);
            border-color: var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-errorForeground);
        }

        .message-header {
            font-size: 11px;
            opacity: 0.7;
            margin-bottom: 4px;
        }

        .message-content {
            line-height: 1.4;
            white-space: pre-wrap;
        }

        .agent-flow {
            margin-top: 8px;
        }

        .thinking-section {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin: 8px 0;
            overflow: hidden;
        }

        .thinking-header {
            padding: 8px 12px;
            background-color: var(--vscode-panel-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .thinking-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .thinking-toggle {
            font-family: monospace;
            font-size: 10px;
            transition: transform 0.2s;
        }

        .thinking-toggle.expanded {
            transform: rotate(90deg);
        }

        .thinking-content {
            padding: 12px;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            display: none;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .thinking-content.expanded {
            display: block;
        }

        .action-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            margin: 4px 0;
            background-color: var(--vscode-textCodeBlock-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            border-radius: 0 4px 4px 0;
            font-size: 13px;
        }

        .action-indicator.error {
            border-left-color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
        }

        .action-icon {
            font-size: 14px;
            min-width: 16px;
        }

        .action-details {
            flex: 1;
        }

        .action-tool {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }

        .action-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }

        .action-result {
            margin-top: 8px;
            padding: 8px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            font-size: 12px;
            max-height: 100px;
            overflow-y: auto;
        }

        .final-response {
            margin-top: 12px;
            padding: 12px;
            background-color: var(--vscode-editor-background);
            border-radius: 6px;
            border-left: 3px solid var(--vscode-textLink-activeForeground);
        }

        .response-label {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-textLink-activeForeground);
            margin-bottom: 8px;
        }

        .response-content {
            line-height: 1.6;
        }

        /* Markdown styles for response content */
        .response-content h1, .response-content h2, .response-content h3 {
            color: var(--vscode-foreground);
            margin: 16px 0 8px 0;
            font-weight: 600;
        }

        .response-content h1 {
            font-size: 1.4em;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 4px;
        }

        .response-content h2 {
            font-size: 1.2em;
        }

        .response-content h3 {
            font-size: 1.1em;
        }

        .response-content strong {
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .response-content em {
            font-style: italic;
            color: var(--vscode-descriptionForeground);
        }

        .response-content code {
            background-color: var(--vscode-textCodeBlock-background);
            color: var(--vscode-textPreformat-foreground);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 0.9em;
        }

        .response-content pre {
            background-color: var(--vscode-textCodeBlock-background);
            color: var(--vscode-textPreformat-foreground);
            padding: 12px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 8px 0;
            border: 1px solid var(--vscode-panel-border);
        }

        .response-content pre code {
            background: transparent;
            padding: 0;
            border-radius: 0;
        }

        .response-content ul {
            margin: 8px 0;
            padding-left: 20px;
        }

        .response-content li {
            margin: 4px 0;
            line-height: 1.4;
        }

        .response-content a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }

        .response-content a:hover {
            color: var(--vscode-textLink-activeForeground);
            text-decoration: underline;
        }

        /* Also apply markdown styles to regular assistant messages */
        .message.assistant .message-content h1, 
        .message.assistant .message-content h2, 
        .message.assistant .message-content h3 {
            color: var(--vscode-input-foreground);
            margin: 12px 0 6px 0;
            font-weight: 600;
        }

        .message.assistant .message-content h1 {
            font-size: 1.3em;
            border-bottom: 1px solid var(--vscode-input-border);
            padding-bottom: 3px;
        }

        .message.assistant .message-content h2 {
            font-size: 1.2em;
        }

        .message.assistant .message-content h3 {
            font-size: 1.1em;
        }

        .message.assistant .message-content strong {
            font-weight: 600;
        }

        .message.assistant .message-content code {
            background-color: var(--vscode-textCodeBlock-background);
            color: var(--vscode-textPreformat-foreground);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 0.9em;
        }

        .message.assistant .message-content pre {
            background-color: var(--vscode-textCodeBlock-background);
            color: var(--vscode-textPreformat-foreground);
            padding: 8px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 6px 0;
            border: 1px solid var(--vscode-input-border);
        }

        .message.assistant .message-content ul {
            margin: 6px 0;
            padding-left: 16px;
        }

        .message.assistant .message-content li {
            margin: 2px 0;
        }

        .message.assistant .message-content a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }

        .message.assistant .message-content a:hover {
            color: var(--vscode-textLink-activeForeground);
            text-decoration: underline;
        }

        .thinking-indicator {
            align-self: flex-start;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            padding: 12px 16px;
            border-radius: 12px;
            max-width: 80%;
            display: none;
        }

        .thinking-indicator.show {
            display: block;
        }

        .thinking-dots {
            display: inline-block;
        }

        .thinking-dots::after {
            content: "...";
            animation: thinking 1.5s infinite;
        }

        @keyframes thinking {
            0%, 20% { content: "."; }
            40% { content: ".."; }
            60%, 100% { content: "..."; }
        }

        .input-container {
            background-color: var(--vscode-panel-background);
            border-top: 1px solid var(--vscode-panel-border);
            padding: 16px;
            display: flex;
            gap: 8px;
        }

        .message-input {
            flex: 1;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 8px 12px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            resize: none;
            min-height: 20px;
            max-height: 120px;
        }

        .message-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .send-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            padding: 8px 16px;
            cursor: pointer;
            font-weight: 500;
        }

        .send-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .send-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .empty-state {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            margin-top: 40px;
        }

        .empty-state h3 {
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }

        /* Settings Overlay Styles */
        .settings-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            outline: none; /* Remove focus outline */
            cursor: pointer; /* Indicate clickable background */
        }

        .settings-modal {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            width: 90%;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        }

        .settings-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-panel-background);
            border-radius: 8px 8px 0 0;
        }

        .settings-header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        }

        .close-button {
            background: none;
            border: none;
            color: var(--vscode-icon-foreground);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .close-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .settings-content {
            padding: 20px;
        }

        .settings-section {
            margin-bottom: 24px;
        }

        .settings-section h3 {
            margin: 0 0 12px 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .setting-item {
            margin-bottom: 16px;
        }

        .setting-item label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
            color: var(--vscode-foreground);
        }

        .setting-item input,
        .setting-item select {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: inherit;
        }

        .setting-item input:focus,
        .setting-item select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .checkbox-container {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .checkbox-container input[type="checkbox"] {
            width: auto;
        }

        .slider-container {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .slider-container input[type="range"] {
            flex: 1;
        }

        .slider-value {
            font-weight: 500;
            min-width: 40px;
            text-align: center;
        }

        .setting-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin: 4px 0 0 0;
        }

        .refresh-models-btn {
            background: var(--vscode-button-secondaryBackground);
            border: 1px solid var(--vscode-button-border);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 4px;
            padding: 6px 8px;
            cursor: pointer;
            margin-left: 8px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .refresh-models-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .setting-item:has(.refresh-models-btn) {
            display: flex;
            align-items: flex-end;
            gap: 8px;
        }

        .setting-item:has(.refresh-models-btn) select {
            flex: 1;
        }

        /* Multi-Agent Workflow Visualization Styles */
        .workflow-container {
            margin: 16px 0;
            padding: 16px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
        }

        .workflow-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .workflow-title {
            font-weight: 600;
            color: var(--vscode-foreground);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .workflow-status {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
        }

        .workflow-complexity {
            padding: 2px 6px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .workflow-complexity.low {
            background-color: var(--vscode-testing-iconPassed);
            color: var(--vscode-editor-background);
        }

        .workflow-complexity.medium {
            background-color: var(--vscode-testing-iconQueued);
            color: var(--vscode-editor-background);
        }

        .workflow-complexity.high {
            background-color: var(--vscode-testing-iconFailed);
            color: var(--vscode-editor-background);
        }

        .workflow-progress {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .workflow-progress-bar {
            width: 100px;
            height: 6px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 3px;
            overflow: hidden;
        }

        .workflow-progress-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-foreground);
            transition: width 0.3s ease;
        }

        .task-graph {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .task-row {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .task-node {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            min-width: 200px;
            position: relative;
            transition: all 0.3s ease;
        }

        .task-node.pending {
            opacity: 0.6;
            border-color: var(--vscode-input-border);
        }

        .task-node.running {
            border-color: var(--vscode-progressBar-foreground);
            background-color: var(--vscode-list-activeSelectionBackground);
            animation: pulse 2s infinite;
        }

        .task-node.completed {
            border-color: var(--vscode-testing-iconPassed);
            background-color: rgba(0, 128, 0, 0.1);
        }

        .task-node.failed {
            border-color: var(--vscode-testing-iconFailed);
            background-color: rgba(255, 0, 0, 0.1);
        }

        @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(0, 122, 204, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(0, 122, 204, 0); }
            100% { box-shadow: 0 0 0 0 rgba(0, 122, 204, 0); }
        }

        .task-agent-icon {
            font-size: 16px;
            min-width: 20px;
        }

        .task-details {
            flex: 1;
        }

        .task-description {
            font-size: 13px;
            font-weight: 500;
            color: var(--vscode-foreground);
            margin-bottom: 2px;
        }

        .task-agent-name {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .task-status-indicator {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            font-weight: 500;
        }

        .task-duration {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }

        .task-dependencies {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-left: 12px;
        }

        .dependency-line {
            width: 24px;
            height: 1px;
            background-color: var(--vscode-panel-border);
            position: relative;
        }

        .dependency-line::after {
            content: '→';
            position: absolute;
            right: -8px;
            top: -8px;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }

        .parallel-indicator {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-top: 8px;
        }

        .workflow-summary {
            margin-top: 16px;
            padding: 12px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 6px;
            border-left: 3px solid var(--vscode-textLink-foreground);
        }

        .workflow-summary.completed {
            border-left-color: var(--vscode-testing-iconPassed);
        }

        .workflow-summary.failed {
            border-left-color: var(--vscode-testing-iconFailed);
        }

        .workflow-metrics {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 12px;
            margin-top: 8px;
        }

        .workflow-metric {
            text-align: center;
        }

        .workflow-metric-value {
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .workflow-metric-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            margin-top: 2px;
        }

        /* Enhanced Tool Representation Styles */
        .action-indicator {
            margin: 8px 0;
            padding: 12px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            transition: all 0.2s ease;
        }

        .action-indicator:hover {
            background-color: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
        }

        .action-indicator.error {
            border-color: var(--vscode-errorForeground);
        }

        .action-header {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            margin-bottom: 8px;
        }

        .action-icon {
            font-size: 18px;
            min-width: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .action-info {
            flex: 1;
            min-width: 0;
        }

        .action-tool-name {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
            flex-wrap: wrap;
        }

        .tool-name {
            font-weight: 600;
            color: var(--vscode-foreground);
            font-size: 13px;
        }

        .tool-category {
            font-size: 10px;
            font-weight: 500;
            padding: 2px 6px;
            border-radius: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            white-space: nowrap;
        }

        .action-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
            line-height: 1.4;
        }

        .tool-complexity {
            font-size: 9px;
            font-weight: 600;
            padding: 1px 4px;
            border-radius: 6px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            align-self: flex-start;
        }

        .tool-complexity.complexity-medium {
            background-color: var(--vscode-testing-iconQueued);
            color: var(--vscode-editor-background);
        }

        .tool-complexity.complexity-high {
            background-color: var(--vscode-testing-iconFailed);
            color: var(--vscode-editor-background);
        }

        .action-result {
            display: flex;
            align-items: flex-start;
            gap: 6px;
            padding: 8px 10px;
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.4;
            margin-top: 8px;
        }

        .action-result.success-result {
            background-color: rgba(0, 128, 0, 0.1);
            border: 1px solid rgba(0, 128, 0, 0.3);
        }

        .action-result.error-result {
            background-color: rgba(255, 0, 0, 0.1);
            border: 1px solid var(--vscode-errorForeground);
        }

        .result-icon {
            font-size: 12px;
            min-width: 14px;
            margin-top: 1px;
        }

        .result-text {
            flex: 1;
            word-break: break-word;
        }

        .error-result .result-text {
            color: var(--vscode-errorForeground);
        }

        .success-result .result-text {
            color: var(--vscode-foreground);
        }

        /* Tool Usage Statistics Styles */
        .tool-usage-stats {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 4px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }

        .usage-count {
            background-color: var(--vscode-button-secondaryBackground);
            padding: 1px 4px;
            border-radius: 6px;
            font-weight: 500;
        }

        .success-rate {
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="chat-header">
        <div class="chat-title">🦙 Ollama Agent Chat</div>
        
        <div class="agent-selector-container">
            <div class="agent-selector">
                <select id="agentSelect" class="agent-dropdown" onchange="changeAgent(this.value)">
                    <!-- Agents will be populated dynamically -->
                </select>
            </div>
            <div class="auto-agent-toggle">
                <input type="checkbox" id="autoAgentToggle" onchange="toggleAutoAgentSelection(this.checked)" checked>
                <label for="autoAgentToggle">Auto-select agent</label>
            </div>
        </div>

        
        <div class="chat-actions">
            <button class="action-button" onclick="openDocumentation()" title="Open Documentation Hub">
                📚 Docs
            </button>
            <button class="action-button" onclick="toggleSettings()" title="Toggle Settings">
                ⚙️ Settings
            </button>
            <button class="action-button" onclick="openProjectContext()" title="Open Project Context">
                📁 Context
            </button>
            <button class="action-button" onclick="openFoundationModels()" title="Configure Foundation Agent Models">
                🧠 Models
            </button>
            <button class="action-button" onclick="exportChat()" title="Export Chat">
                📤 Export
            </button>
            <button class="action-button" onclick="clearChat()" title="Clear Chat">
                🗑️ Clear
            </button>
        </div>
    </div>

    <!-- Settings Overlay -->
    <div id="settingsOverlay" class="settings-overlay" style="display: none;">
        <div class="settings-modal">
            <div class="settings-header">
                <h2>⚙️ Settings</h2>
                <button class="close-button" onclick="toggleSettings()" title="Close Settings">
                    ✖️
                </button>
            </div>
            <div class="settings-content">
                <div class="settings-section">
                    <h3>Connection</h3>
                    <div class="setting-item">
                        <label for="settingsOllamaUrl">Ollama Server URL</label>
                        <input type="text" id="settingsOllamaUrl" data-setting="ollamaUrl" placeholder="http://localhost:11434">
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>Model Configuration</h3>
                    <div class="setting-item">
                        <label for="settingsModel">Current Model</label>
                        <select id="settingsModel" data-setting="model">
                            <option value="">Loading models...</option>
                        </select>
                        <button class="refresh-models-btn" onclick="loadModelsForSettings()" title="Refresh Models">
                            <span class="codicon codicon-refresh"></span>
                        </button>
                    </div>
                    
                    <div class="setting-item">
                        <label for="settingsTemperature">Temperature</label>
                        <div class="slider-container">
                            <input type="range" id="settingsTemperature" data-setting="temperature" 
                                   min="0" max="2" step="0.1" value="0.7">
                            <span class="slider-value">0.7</span>
                        </div>
                        <p class="setting-description">Controls randomness: 0 = deterministic, 2 = very creative</p>
                    </div>
                    
                    <div class="setting-item">
                        <label for="settingsMaxIterations">Max Iterations</label>
                        <input type="number" id="settingsMaxIterations" data-setting="maxIterations" 
                               min="1" max="50" value="10">
                        <p class="setting-description">Maximum number of agent reasoning steps</p>
                    </div>
                </div>

                <!-- LMDeploy Configuration Section -->
                <div class="settings-section" id="lmdeploySection">
                    <h3>🚀 LMDeploy Integration (Superior Performance)</h3>
                    
                    <div class="setting-item">
                        <div class="checkbox-container">
                            <input type="checkbox" id="settingsLMDeployEnabled" data-setting="lmdeploy.enabled">
                            <label for="settingsLMDeployEnabled">Enable LMDeploy Support</label>
                        </div>
                        <p class="setting-description">Enable LMDeploy integration for 1.8x superior performance compared to vLLM</p>
                    </div>
                    
                    <div class="lmdeploy-settings" id="lmdeployAdvancedSettings" style="display: none;">
                        <div class="setting-item">
                            <label for="settingsLMDeployUrl">LMDeploy Server URL</label>
                            <input type="text" id="settingsLMDeployUrl" data-setting="lmdeploy.serverUrl" 
                                   placeholder="http://localhost:11435">
                            <p class="setting-description">URL of the LMDeploy server (default: Ollama port + 1)</p>
                        </div>
                        
                        <div class="setting-item">
                            <label for="settingsLMDeployModel">LMDeploy Model</label>
                            <input type="text" id="settingsLMDeployModel" data-setting="lmdeploy.model" 
                                   placeholder="internlm/internlm2_5-7b-chat">
                            <p class="setting-description">Model to use with LMDeploy server</p>
                        </div>
                        
                        <div class="setting-item">
                            <label for="settingsLMDeploySessionLen">Session Length</label>
                            <input type="number" id="settingsLMDeploySessionLen" data-setting="lmdeploy.sessionLen" 
                                   min="512" max="32768" value="2048">
                            <p class="setting-description">Maximum session length for LMDeploy model</p>
                        </div>
                        
                        <div class="setting-item">
                            <label for="settingsLMDeployBatchSize">Max Batch Size</label>
                            <input type="number" id="settingsLMDeployBatchSize" data-setting="lmdeploy.maxBatchSize" 
                                   min="1" max="32" value="8">
                            <p class="setting-description">Maximum batch size for inference optimization</p>
                        </div>
                        
                        <div class="setting-item">
                            <label for="settingsLMDeployTensorParallel">Tensor Parallel Size</label>
                            <input type="number" id="settingsLMDeployTensorParallel" data-setting="lmdeploy.tensorParallelSize" 
                                   min="1" max="8" value="1">
                            <p class="setting-description">Number of GPUs for tensor parallelism</p>
                        </div>
                        
                        <div class="setting-item">
                            <label for="settingsLMDeployCache">Cache Max Entry Count</label>
                            <div class="slider-container">
                                <input type="range" id="settingsLMDeployCache" data-setting="lmdeploy.cacheMaxEntryCount" 
                                       min="0.1" max="1.0" step="0.05" value="0.8">
                                <span class="slider-value">0.80</span>
                            </div>
                            <p class="setting-description">GPU memory utilization ratio for KV cache (0.1-1.0)</p>
                        </div>
                        
                        <div class="setting-item">
                            <label for="settingsLMDeployEngine">Inference Engine</label>
                            <select id="settingsLMDeployEngine" data-setting="lmdeploy.engineType">
                                <option value="turbomind" selected>TurboMind (Recommended)</option>
                                <option value="pytorch">PyTorch</option>
                            </select>
                            <p class="setting-description">LMDeploy inference engine (TurboMind optimized for performance)</p>
                        </div>
                    </div>
                </div>

                <!-- Routing Configuration Section -->
                <div class="settings-section" id="routingSection">
                    <h3>🎯 Provider Routing</h3>
                    
                    <div class="setting-item">
                        <label for="settingsRoutingChat">Chat Preference</label>
                        <select id="settingsRoutingChat" data-setting="routing.chatPreference">
                            <option value="auto" selected>Auto (Intelligent)</option>
                            <option value="ollama">Ollama</option>
                            <option value="lmdeploy">LMDeploy</option>
                        </select>
                        <p class="setting-description">Preferred provider for chat interactions</p>
                    </div>
                    
                    <div class="setting-item">
                        <label for="settingsRoutingEmbedding">Embedding Preference</label>
                        <select id="settingsRoutingEmbedding" data-setting="routing.embeddingPreference">
                            <option value="auto">Auto (Intelligent)</option>
                            <option value="ollama">Ollama</option>
                            <option value="lmdeploy" selected>LMDeploy (Recommended)</option>
                        </select>
                        <p class="setting-description">Preferred provider for embeddings and similarity tasks</p>
                    </div>
                    
                    <div class="setting-item">
                        <label for="settingsRoutingTools">Tool Calling Preference</label>
                        <select id="settingsRoutingTools" data-setting="routing.toolCallingPreference">
                            <option value="auto">Auto (Intelligent)</option>
                            <option value="ollama" selected>Ollama (Recommended)</option>
                            <option value="lmdeploy">LMDeploy</option>
                        </select>
                        <p class="setting-description">Preferred provider for structured tool calling</p>
                    </div>
                    
                    <div class="setting-item">
                        <label for="settingsRoutingBatch">Batch Processing Preference</label>
                        <select id="settingsRoutingBatch" data-setting="routing.batchProcessingPreference">
                            <option value="auto">Auto (Intelligent)</option>
                            <option value="ollama">Ollama</option>
                            <option value="lmdeploy" selected>LMDeploy (Recommended)</option>
                        </select>
                        <p class="setting-description">Preferred provider for batch and parallel operations</p>
                    </div>
                    
                    <div class="setting-item">
                        <div class="checkbox-container">
                            <input type="checkbox" id="settingsRoutingSpeed" data-setting="routing.preferSpeed" checked>
                            <label for="settingsRoutingSpeed">Prefer Speed Over Accuracy</label>
                        </div>
                        <p class="setting-description">Prioritize faster responses in routing decisions</p>
                    </div>
                    
                    <div class="setting-item">
                        <div class="checkbox-container">
                            <input type="checkbox" id="settingsRoutingFallback" data-setting="routing.enableFallback" checked>
                            <label for="settingsRoutingFallback">Enable Provider Fallback</label>
                        </div>
                        <p class="setting-description">Automatically try alternative provider if primary fails</p>
                    </div>
                    
                    <div class="setting-item">
                        <label for="settingsRoutingTimeout">Fallback Timeout (ms)</label>
                        <input type="number" id="settingsRoutingTimeout" data-setting="routing.fallbackTimeout" 
                               min="1000" max="60000" step="1000" value="10000">
                        <p class="setting-description">Timeout before switching to fallback provider</p>
                    </div>
                </div>

                <!-- Foundation Pipeline Section -->
                <div class="settings-section" id="foundationSection">
                    <h3>🧠 Foundation Pipeline</h3>
                    
                    <div class="setting-item">
                        <div class="checkbox-container">
                            <input type="checkbox" id="settingsFoundationLMDeploy" data-setting="foundation.enableLMDeployOptimization" checked>
                            <label for="settingsFoundationLMDeploy">Enable LMDeploy Pipeline Optimization</label>
                        </div>
                        <p class="setting-description">Use LMDeploy for optimized foundation pipeline stages (1.8x performance improvement)</p>
                    </div>
                </div>

                <div class="settings-section">
                    <h3>Debug</h3>
                    <div class="setting-item">
                        <label for="settingsLogLevel">Log Level</label>
                        <select id="settingsLogLevel" data-setting="logLevel">
                            <option value="debug">Debug</option>
                            <option value="info" selected>Info</option>
                            <option value="warn">Warning</option>
                            <option value="error">Error</option>
                        </select>
                    </div>
                    
                    <div class="setting-item">
                        <div class="checkbox-container">
                            <input type="checkbox" id="settingsVerbose" data-setting="verbose">
                            <label for="settingsVerbose">Verbose Logging</label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="chat-container" id="chatContainer">
        <div class="empty-state" id="emptyState">
            <h3>Welcome to Ollama Agent Chat!</h3>
            <p>Start a conversation with your AI coding assistant.</p>
        </div>
        <div class="thinking-indicator" id="thinkingIndicator">
            <div class="message-header">Assistant</div>
            <div class="message-content">
                Thinking<span class="thinking-dots"></span>
            </div>
        </div>
    </div>

    <div class="input-container">
        <textarea 
            class="message-input" 
            id="messageInput" 
            placeholder="Type your message here... (Shift+Enter for new line, Enter to send)"
            rows="1"></textarea>
        <button class="send-button" id="sendButton" onclick="sendMessage()">Send</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let messages = ${messagesJson};
        let agentDisplayInfo = ${agentInfoJson};
        let currentAgentInfo = ${currentAgentInfo};
        let useAutoAgentSelection = ${JSON.stringify(this._useAutoAgentSelection)};
        let selectedAgentType = ${JSON.stringify(this._selectedAgentType)};

        const messageInput = document.getElementById('messageInput');
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        function sendMessage() {
            const input = document.getElementById('messageInput');
            const text = input.value.trim();
            
            if (!text) return;
            
            vscode.postMessage({
                command: 'sendMessage',
                text: text
            });
            
            input.value = '';
            input.style.height = 'auto';
        }

        function clearChat() {
            vscode.postMessage({
                command: 'clearChat'
            });
        }

        function openDocumentation() {
            vscode.postMessage({
                command: 'openDocumentation'
            });
        }

        function exportChat() {
            vscode.postMessage({
                command: 'exportChat'
            });
        }

        function openSettings() {
            vscode.postMessage({
                command: 'openSettings'
            });
        }

        function openProjectContext() {
            vscode.postMessage({
                command: 'openProjectContext'
            });
        }
        function openFoundationModels() {
            vscode.postMessage({
                command: 'openFoundationModels'
            });
        }


        function changeAgent(agentType) {
            vscode.postMessage({
                command: 'changeAgent',
                agentType: agentType
            });
        }

        function toggleAutoAgentSelection(enabled) {
            vscode.postMessage({
                command: 'toggleAutoAgentSelection',
                enabled: enabled
            });
            
            // Update UI state
            useAutoAgentSelection = enabled;
            const agentSelect = document.getElementById('agentSelect');
            agentSelect.disabled = enabled;
            
            if (enabled) {
                agentSelect.title = "Automatic agent selection enabled - agents are chosen based on task analysis";
            } else {
                agentSelect.title = "Manual agent selection - choose which agent to use";
            }
        }

        function toggleSettings() {
            const overlay = document.getElementById('settingsOverlay');
            if (overlay.style.display === 'none' || overlay.style.display === '') {
                openSettings();
            } else {
                closeSettings();
            }
        }

        function openSettings() {
            const overlay = document.getElementById('settingsOverlay');
            overlay.style.display = 'flex';
            loadCurrentSettings();
            
            // Focus the overlay for keyboard events
            overlay.focus();
        }

        function closeSettings() {
            const overlay = document.getElementById('settingsOverlay');
            overlay.style.display = 'none';
        }

        function loadCurrentSettings() {
            // Load current VS Code configuration values
            const settings = {
                // Basic settings
                ollamaUrl: '${this._getVSCodeConfig("ollamaUrl")}',
                model: '${this._getVSCodeConfig("model")}',
                temperature: '${this._getVSCodeConfig("temperature")}',
                maxIterations: '${this._getVSCodeConfig("maxIterations")}',
                logLevel: '${this._getVSCodeConfig("logLevel")}',
                verbose: ${this._getVSCodeConfig("verbose")},
                
                // LMDeploy settings
                'lmdeploy.enabled': ${this._getVSCodeConfig("lmdeploy.enabled")},
                'lmdeploy.serverUrl': '${this._getVSCodeConfig("lmdeploy.serverUrl")}',
                'lmdeploy.model': '${this._getVSCodeConfig("lmdeploy.model")}',
                'lmdeploy.sessionLen': '${this._getVSCodeConfig("lmdeploy.sessionLen")}',
                'lmdeploy.maxBatchSize': '${this._getVSCodeConfig("lmdeploy.maxBatchSize")}',
                'lmdeploy.tensorParallelSize': '${this._getVSCodeConfig("lmdeploy.tensorParallelSize")}',
                'lmdeploy.cacheMaxEntryCount': '${this._getVSCodeConfig("lmdeploy.cacheMaxEntryCount")}',
                'lmdeploy.engineType': '${this._getVSCodeConfig("lmdeploy.engineType")}',
                
                // Routing settings
                'routing.chatPreference': '${this._getVSCodeConfig("routing.chatPreference")}',
                'routing.embeddingPreference': '${this._getVSCodeConfig("routing.embeddingPreference")}',
                'routing.toolCallingPreference': '${this._getVSCodeConfig("routing.toolCallingPreference")}',
                'routing.batchProcessingPreference': '${this._getVSCodeConfig("routing.batchProcessingPreference")}',
                'routing.preferSpeed': ${this._getVSCodeConfig("routing.preferSpeed")},
                'routing.enableFallback': ${this._getVSCodeConfig("routing.enableFallback")},
                'routing.fallbackTimeout': '${this._getVSCodeConfig("routing.fallbackTimeout")}',
                
                // Foundation settings
                'foundation.enableLMDeployOptimization': ${this._getVSCodeConfig("foundation.enableLMDeployOptimization")}
            };

            // Populate form fields - Basic settings
            document.getElementById('settingsOllamaUrl').value = settings.ollamaUrl;
            document.getElementById('settingsTemperature').value = settings.temperature;
            document.getElementById('settingsMaxIterations').value = settings.maxIterations;
            document.getElementById('settingsLogLevel').value = settings.logLevel;
            document.getElementById('settingsVerbose').checked = settings.verbose;

            // Populate LMDeploy settings
            document.getElementById('settingsLMDeployEnabled').checked = settings['lmdeploy.enabled'];
            document.getElementById('settingsLMDeployUrl').value = settings['lmdeploy.serverUrl'];
            document.getElementById('settingsLMDeployModel').value = settings['lmdeploy.model'];
            document.getElementById('settingsLMDeploySessionLen').value = settings['lmdeploy.sessionLen'];
            document.getElementById('settingsLMDeployBatchSize').value = settings['lmdeploy.maxBatchSize'];
            document.getElementById('settingsLMDeployTensorParallel').value = settings['lmdeploy.tensorParallelSize'];
            document.getElementById('settingsLMDeployCache').value = settings['lmdeploy.cacheMaxEntryCount'];
            document.getElementById('settingsLMDeployEngine').value = settings['lmdeploy.engineType'];

            // Populate routing settings
            document.getElementById('settingsRoutingChat').value = settings['routing.chatPreference'];
            document.getElementById('settingsRoutingEmbedding').value = settings['routing.embeddingPreference'];
            document.getElementById('settingsRoutingTools').value = settings['routing.toolCallingPreference'];
            document.getElementById('settingsRoutingBatch').value = settings['routing.batchProcessingPreference'];
            document.getElementById('settingsRoutingSpeed').checked = settings['routing.preferSpeed'];
            document.getElementById('settingsRoutingFallback').checked = settings['routing.enableFallback'];
            document.getElementById('settingsRoutingTimeout').value = settings['routing.fallbackTimeout'];

            // Populate foundation settings
            document.getElementById('settingsFoundationLMDeploy').checked = settings['foundation.enableLMDeployOptimization'];

            // Update slider displays
            const tempSlider = document.getElementById('settingsTemperature');
            const tempValue = tempSlider.parentElement.querySelector('.slider-value');
            if (tempValue) tempValue.textContent = tempSlider.value;
            
            const cacheSlider = document.getElementById('settingsLMDeployCache');
            const cacheValue = cacheSlider.parentElement.querySelector('.slider-value');
            if (cacheValue) cacheValue.textContent = parseFloat(cacheSlider.value).toFixed(2);

            // Show/hide LMDeploy advanced settings based on enabled state
            toggleLMDeployAdvancedSettings(settings['lmdeploy.enabled']);

            // Load models for settings
            loadModelsForSettings();
        }

        function loadModelsForSettings() {
            vscode.postMessage({
                command: 'loadModels'
            });
        }

        function updateSettingValue(element) {
            const key = element.dataset.setting;
            let value = element.value;
            
            // Handle different input types
            if (element.type === 'checkbox') {
                value = element.checked;
                
                // Special handling for LMDeploy enabled checkbox
                if (key === 'lmdeploy.enabled') {
                    toggleLMDeployAdvancedSettings(value);
                }
            } else if (element.type === 'number' || element.type === 'range') {
                value = parseFloat(value);
            }

            vscode.postMessage({
                command: 'updateSetting',
                key: key,
                value: value
            });
        }

        function toggleLMDeployAdvancedSettings(enabled) {
            const advancedSettings = document.getElementById('lmdeployAdvancedSettings');
            const routingSection = document.getElementById('routingSection');
            const foundationSection = document.getElementById('foundationSection');
            
            if (enabled) {
                advancedSettings.style.display = 'block';
                routingSection.style.display = 'block';
                foundationSection.style.display = 'block';
            } else {
                advancedSettings.style.display = 'none';
                // Keep routing and foundation sections visible but with reduced functionality
                routingSection.style.opacity = '0.6';
                foundationSection.style.opacity = '0.6';
            }
        }


        function populateAgentSelect() {
            const select = document.getElementById('agentSelect');
            select.innerHTML = '';
            
            agentDisplayInfo.forEach(agent => {
                const option = document.createElement('option');
                option.value = agent.specialization;
                option.textContent = agent.icon + ' ' + agent.displayName;
                option.selected = agent.specialization === selectedAgentType;
                option.title = agent.description;
                select.appendChild(option);
            });
            
            // Set initial state
            select.disabled = useAutoAgentSelection;
            if (useAutoAgentSelection) {
                select.title = "Automatic agent selection enabled - agents are chosen based on task analysis";
            } else {
                select.title = "Manual agent selection - choose which agent to use";
            }
        }

        function updateMessages(newMessages) {
            console.log('Updating messages:', newMessages.length, newMessages);
            messages = newMessages;
            renderMessages();
        }

        function renderMessages() {
            console.log('Rendering messages:', messages.length);
            const container = document.getElementById('chatContainer');
            const emptyState = document.getElementById('emptyState');
            const thinkingIndicator = document.getElementById('thinkingIndicator');
            
            // Instead of clearing all messages, update incrementally
            const existingMessages = container.querySelectorAll('.message');
            const existingMessageIds = Array.from(existingMessages).map(msg => msg.dataset.messageId);
            
            if (messages.length === 0) {
                // Clear all messages if we have none
                existingMessages.forEach(msg => msg.remove());
                emptyState.style.display = 'block';
            } else {
                emptyState.style.display = 'none';
                
                // Add/update messages
                messages.forEach((message, index) => {
                    let messageEl = container.querySelector('[data-message-id="' + message.id + '"]');
                    
                    if (!messageEl) {
                        // Create new message element
                        messageEl = document.createElement('div');
                        messageEl.className = 'message ' + message.role + (message.isError ? ' error' : '');
                        messageEl.dataset.messageId = message.id;
                        
                        // Insert in correct position
                        const nextMessage = messages[index + 1];
                        if (nextMessage) {
                            const nextEl = container.querySelector('[data-message-id="' + nextMessage.id + '"]');
                            if (nextEl) {
                                container.insertBefore(messageEl, nextEl);
                            } else {
                                container.appendChild(messageEl);
                            }
                        } else {
                            container.appendChild(messageEl);
                        }
                    }
                    
                    // Update message content (always update to reflect changes)
                    updateMessageElement(messageEl, message);
                });
                
                // Remove any messages that no longer exist
                const currentMessageIds = messages.map(m => m.id);
                existingMessages.forEach(msgEl => {
                    if (!currentMessageIds.includes(msgEl.dataset.messageId)) {
                        msgEl.remove();
                    }
                });
            }
            
            // Auto-scroll to bottom if user is near bottom
            const isNearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 100;
            if (isNearBottom) {
                container.scrollTop = container.scrollHeight;
            }
        }
        
        function updateMessageElement(messageEl, message) {
            const timestamp = new Date(message.timestamp).toLocaleTimeString();
            const modelInfo = message.model ? ' (' + message.model + ')' : '';
            
            let content = '';
            
            if (message.role === 'assistant' && message.workflow) {
                // Render workflow visualization
                content = renderWorkflowVisualization(message.workflow);
            } else if (message.role === 'assistant' && message.actions && message.actions.length > 0) {
                // Render agent flow with thinking, actions, and final response
                content = renderAgentFlow(message);
            } else {
                // Regular message rendering
                content = message.role === 'assistant' ? 
                    renderMarkdown(message.content) : 
                    escapeHtml(message.content);
            }
            
            messageEl.innerHTML = 
                '<div class="message-header">' + message.role + modelInfo + ' • ' + timestamp + '</div>' +
                '<div class="message-content">' + content + '</div>';
            
            // Add click handlers for thinking sections and workflow interactions
            setupThinkingToggles();
            setupWorkflowInteractions();
        }

        function renderAgentFlow(message) {
            let html = '<div class="agent-flow">';
            
            // Render each action (thinking + tool call)
            message.actions.forEach((action, index) => {
                // Thinking section (collapsible)
                if (action.thought) {
                    html += '<div class="thinking-section">';
                    html += '<div class="thinking-header" onclick="toggleThinking(this)">';
                    html += '<span class="thinking-toggle">▶</span>';
                    html += '<span>🤔 Agent Thinking</span>';
                    html += '</div>';
                    html += '<div class="thinking-content">';
                    html += escapeHtml(action.thought);
                    html += '</div>';
                    html += '</div>';
                }
                
                // Action indicator with enhanced tool representation
                if (action.toolCall) {
                    const hasError = action.toolCall.error;
                    const icon = getToolIcon(action.toolCall.toolName);
                    const metadata = getToolMetadata(action.toolCall.toolName);
                    const categoryInfo = metadata ? TOOL_CATEGORIES[metadata.category] : null;
                    const usageStats = this._toolUsageTracker.getToolStats(action.toolCall.toolName);
                    
                    html += '<div class="action-indicator' + (hasError ? ' error' : '') + '">';
                    html += '<div class="action-header">';
                    html += '<span class="action-icon">' + icon + '</span>';
                    html += '<div class="action-info">';
                    html += '<div class="action-tool-name">';
                    html += '<span class="tool-name">' + (metadata ? metadata.displayName : action.toolCall.toolName) + '</span>';
                    if (categoryInfo) {
                        html += '<span class="tool-category" style="background-color: ' + categoryInfo.color + '20; color: ' + categoryInfo.color + '">';
                        html += categoryInfo.displayName;
                        html += '</span>';
                    }
                    html += '</div>';
                    html += '<div class="action-description">' + getToolDescription(action.toolCall) + '</div>';
                    if (metadata && metadata.complexity !== 'low') {
                        html += '<div class="tool-complexity complexity-' + metadata.complexity + '">';
                        html += metadata.complexity.toUpperCase();
                        html += '</div>';
                    }
                    
                    // Add usage statistics if available
                    if (usageStats && usageStats.usageCount > 0) {
                        const successRate = Math.round((usageStats.successCount / usageStats.usageCount) * 100);
                        html += '<div class="tool-usage-stats">';
                        html += '<span class="usage-count">Used ' + usageStats.usageCount + ' times</span>';
                        if (successRate < 100) {
                            html += '<span class="success-rate" style="color: ' + (successRate >= 80 ? 'var(--vscode-testing-iconPassed)' : successRate >= 60 ? 'var(--vscode-testing-iconQueued)' : 'var(--vscode-testing-iconFailed)') + '">';
                            html += successRate + '% success';
                            html += '</span>';
                        }
                        html += '</div>';
                    }
                    html += '</div>';
                    html += '</div>';
                    
                    // Show result or error
                    if (hasError) {
                        html += '<div class="action-result error-result">';
                        html += '<span class="result-icon">❌</span>';
                        html += '<span class="result-text">Error: ' + escapeHtml(action.toolCall.error) + '</span>';
                        html += '</div>';
                    } else if (action.toolCall.output) {
                        html += '<div class="action-result success-result">';
                        html += '<span class="result-icon">✅</span>';
                        html += '<span class="result-text">' + truncateText(escapeHtml(action.toolCall.output), 200) + '</span>';
                        html += '</div>';
                    }
                    
                    html += '</div>';
                }
            });
            
            // Final response
            if (message.content && message.content.trim()) {
                html += '<div class="final-response">';
                html += '<div class="response-label">🎯 Final Response</div>';
                html += '<div class="response-content">' + renderMarkdown(message.content) + '</div>';
                html += '</div>';
            }
            
            html += '</div>';
            return html;
        }

        function getToolIcon(toolName) {
            const metadata = getToolMetadata(toolName);
            if (metadata) {
                return metadata.icon;
            }
            
            // Fallback for unknown tools
            const fallbackIcons = {
                'file_read': '📖',
                'file_write': '✏️',
                'file_list': '📁',
                'run_shell': '⚡',
                'open_file': '📄',
                'vscode_command': '🔧'
            };
            return fallbackIcons[toolName] || '🔧';
        }

        function getToolDescription(toolCall) {
            const metadata = getToolMetadata(toolCall.toolName);
            
            if (metadata) {
                // Use metadata for enhanced descriptions with context
                switch (toolCall.toolName) {
                    case 'file_read':
                        return 'Reading file: ' + (toolCall.input.filePath || toolCall.input.path || 'unknown');
                    case 'file_write':
                        return 'Writing to file: ' + (toolCall.input.filePath || toolCall.input.path || 'unknown');
                    case 'file_list':
                        return 'Listing directory: ' + (toolCall.input.dirPath || toolCall.input.path || 'current');
                    case 'run_shell':
                        return 'Running command: ' + (toolCall.input.command || 'unknown');
                    case 'open_file':
                        return 'Opening file: ' + (toolCall.input.filePath || toolCall.input.path || 'unknown');
                    case 'vscode_command':
                        return 'VS Code command: ' + (toolCall.input.command || 'unknown');
                    case 'git_status':
                        return 'Checking git repository status';
                    case 'git_add':
                        return 'Staging files: ' + (toolCall.input.files || 'all changes');
                    case 'git_commit':
                        return 'Creating commit: ' + (toolCall.input.message || 'with message');
                    case 'test_runner':
                        return 'Running tests: ' + (toolCall.input.testPath || 'all tests');
                    case 'eslint':
                        return 'Analyzing code quality: ' + (toolCall.input.files || 'project files');
                    case 'package_install':
                        return 'Installing package: ' + (toolCall.input.package || 'dependencies');
                    default:
                        return metadata.displayName + ': ' + metadata.description;
                }
            }
            
            // Fallback for unknown tools
            const fallbackDescriptions = {
                'file_read': 'Reading file: ' + (toolCall.input.filePath || toolCall.input.path || 'unknown'),
                'file_write': 'Writing to file: ' + (toolCall.input.filePath || toolCall.input.path || 'unknown'),
                'file_list': 'Listing directory: ' + (toolCall.input.dirPath || toolCall.input.path || 'current'),
                'run_shell': 'Running command: ' + (toolCall.input.command || 'unknown'),
                'open_file': 'Opening file: ' + (toolCall.input.filePath || toolCall.input.path || 'unknown'),
                'vscode_command': 'VS Code command: ' + (toolCall.input.command || 'unknown')
            };
            return fallbackDescriptions[toolCall.toolName] || 'Executing ' + toolCall.toolName;
        }

        function truncateText(text, maxLength) {
            if (text.length <= maxLength) return text;
            return text.substring(0, maxLength) + '...';
        }

        function toggleThinking(header) {
            const toggle = header.querySelector('.thinking-toggle');
            const content = header.nextElementSibling;
            
            if (content.classList.contains('expanded')) {
                content.classList.remove('expanded');
                toggle.classList.remove('expanded');
            } else {
                content.classList.add('expanded');
                toggle.classList.add('expanded');
            }
        }

        function setupThinkingToggles() {
            // This function is called after rendering to ensure event handlers are properly set up
            // The onclick handlers are already set in the HTML, so this is just a placeholder
            // for any additional setup if needed
        }

        function renderWorkflowVisualization(workflow) {
            let html = '<div class="workflow-visualization">';
            
            // Workflow header with basic info
            html += '<div class="workflow-header">';
            html += '<div class="workflow-title">';
            html += '<span class="workflow-icon">🔄</span>';
            html += '<span class="workflow-label">Multi-Agent Workflow</span>';
            html += '<span class="workflow-complexity ' + workflow.complexity + '">' + workflow.complexity.toUpperCase() + '</span>';
            html += '</div>';
            html += '<div class="workflow-original-task">' + escapeHtml(workflow.originalTask) + '</div>';
            html += '</div>';
            
            // Task dependency graph visualization
            html += '<div class="workflow-graph">';
            html += '<div class="graph-title">Task Execution Flow</div>';
            html += '<div class="task-graph">';
            
            // Group tasks by priority/dependencies for layout
            const taskLayers = [];
            const processedTasks = new Set();
            
            // Find root tasks (no dependencies)
            const rootTasks = workflow.tasks.filter(task => task.dependencies.length === 0);
            if (rootTasks.length > 0) {
                taskLayers.push([...rootTasks]);
                rootTasks.forEach(task => processedTasks.add(task.id));
            }
            
            // Build subsequent layers
            while (processedTasks.size < workflow.tasks.length) {
                const nextLayer = workflow.tasks.filter(task => 
                    !processedTasks.has(task.id) && 
                    task.dependencies.every(depId => processedTasks.has(depId))
                );
                
                if (nextLayer.length === 0) break; // Prevent infinite loop
                
                taskLayers.push([...nextLayer]);
                nextLayer.forEach(task => processedTasks.add(task.id));
            }
            
            // Render task layers
            taskLayers.forEach((layer, layerIndex) => {
                html += '<div class="task-layer">';
                layer.forEach(task => {
                    const statusClass = task.status === 'completed' ? 'completed' : 
                                      task.status === 'running' ? 'running' : 
                                      task.status === 'failed' ? 'failed' : 'pending';
                    
                    html += '<div class="task-node ' + statusClass + '" data-task-id="' + task.id + '">';
                    html += '<div class="task-agent-icon">' + getAgentIcon(task.agentType) + '</div>';
                    html += '<div class="task-content">';
                    html += '<div class="task-description">' + escapeHtml(task.description) + '</div>';
                    html += '<div class="task-agent-type">' + task.agentType.replace('_', ' ') + '</div>';
                    html += '<div class="task-status">';
                    
                    if (task.status === 'completed' && task.duration) {
                        html += '✅ ' + Math.round(task.duration / 1000) + 's';
                    } else if (task.status === 'running' && task.progress) {
                        html += '⏳ ' + Math.round(task.progress * 100) + '%';
                    } else if (task.status === 'failed') {
                        html += '❌ Failed';
                    } else {
                        html += '⏸️ Pending';
                    }
                    
                    html += '</div>';
                    html += '</div>';
                    html += '</div>';
                });
                html += '</div>';
                
                // Add connecting lines between layers (simple implementation)
                if (layerIndex < taskLayers.length - 1) {
                    html += '<div class="layer-connector"></div>';
                }
            });
            
            html += '</div>'; // task-graph
            html += '</div>'; // workflow-graph
            
            // Workflow statistics and summary
            html += '<div class="workflow-summary">';
            const completedTasks = workflow.tasks.filter(t => t.status === 'completed').length;
            const failedTasks = workflow.tasks.filter(t => t.status === 'failed').length;
            const totalTasks = workflow.tasks.length;
            
            html += '<div class="workflow-stats">';
            html += '<div class="stat-item">';
            html += '<span class="stat-label">Progress:</span>';
            html += '<span class="stat-value">' + completedTasks + '/' + totalTasks + ' tasks</span>';
            html += '</div>';
            
            if (workflow.successRate !== undefined) {
                html += '<div class="stat-item">';
                html += '<span class="stat-label">Success Rate:</span>';
                html += '<span class="stat-value">' + Math.round(workflow.successRate * 100) + '%</span>';
                html += '</div>';
            }
            
            if (workflow.endTime) {
                const duration = new Date(workflow.endTime) - new Date(workflow.startTime);
                html += '<div class="stat-item">';
                html += '<span class="stat-label">Duration:</span>';
                html += '<span class="stat-value">' + Math.round(duration / 1000) + 's</span>';
                html += '</div>';
            }
            
            html += '</div>'; // workflow-stats
            html += '</div>'; // workflow-summary
            
            html += '</div>'; // workflow-visualization
            return html;
        }

        function getAgentIcon(agentType) {
            const icons = {
                'general': '🤖',
                'code_review': '🔍',
                'test_automation': '🧪',
                'devops': '⚙️',
                'documentation': '📝',
                'refactoring': '✨'
            };
            return icons[agentType] || '🤖';
        }

        function setupWorkflowInteractions() {
            // Add click handlers for task nodes to show detailed information
            document.querySelectorAll('.task-node').forEach(node => {
                node.addEventListener('click', function() {
                    const taskId = this.getAttribute('data-task-id');
                    // For now, just highlight the clicked task
                    document.querySelectorAll('.task-node').forEach(n => n.classList.remove('selected'));
                    this.classList.add('selected');
                    
                    // TODO: Show task details panel or tooltip
                    console.log('Task clicked:', taskId);
                });
            });
            
            // Add hover effects for better UX
            document.querySelectorAll('.task-node').forEach(node => {
                node.addEventListener('mouseenter', function() {
                    this.classList.add('hovered');
                });
                
                node.addEventListener('mouseleave', function() {
                    this.classList.remove('hovered');
                });
            });
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = String(text);
            return div.innerHTML.replace(/\\n/g, '<br>');
        }

        function renderMarkdown(text) {
            if (!text) return '';
            
            // For now, just return escaped HTML with better line breaks
            // We'll enhance this later once the basic pipeline is working
            let html = escapeHtml(text);
            
            // Convert double line breaks to paragraphs
            html = html.replace(/\\n\\n/g, '</p><p>');
            html = '<p>' + html + '</p>';
            
            // Clean up empty paragraphs
            html = html.replace(/<p><\\/p>/g, '');
            
            return html;
        }

        function showThinking(show) {
            const indicator = document.getElementById('thinkingIndicator');
            indicator.className = show ? 'thinking-indicator show' : 'thinking-indicator';
            
            if (show) {
                const container = document.getElementById('chatContainer');
                container.scrollTop = container.scrollHeight;
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateMessages':
                    updateMessages(message.messages);
                    break;
                case 'showThinking':
                    showThinking(message.show);
                    break;
                case 'toggleSettingsView':
                    toggleSettings();
                    break;
                case 'settingUpdated':
                    if (message.success) {
                        console.log('Setting updated:', message.key, '=', message.value);
                    } else {
                        alert('Failed to update setting: ' + message.error);
                    }
                    break;
                case 'modelsLoadedForSettings':
                    populateSettingsModels(message.models);
                    break;
                case 'modelsErrorForSettings':
                    handleSettingsModelsError(message.error);
                    break;
                case 'agentChanged':
                    selectedAgentType = message.agentType;
                    currentAgentInfo = message.agentInfo;
                    useAutoAgentSelection = message.autoSelection;
                    populateAgentSelect();
                    break;
                case 'autoAgentSelectionChanged':
                    useAutoAgentSelection = message.enabled;
                    const autoToggle = document.getElementById('autoAgentToggle');
                    if (autoToggle) autoToggle.checked = message.enabled;
                    populateAgentSelect();
                    break;
            }
        });


        function populateSettingsModels(models) {
            const select = document.getElementById('settingsModel');
            select.innerHTML = '';
            
            if (!models || models.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'No models available';
                option.disabled = true;
                select.appendChild(option);
                return;
            }
            
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                // No selection needed - will use VS Code configuration
                select.appendChild(option);
            });
        }

        function handleSettingsModelsError(error) {
            const select = document.getElementById('settingsModel');
            select.innerHTML = '<option value="" disabled>Error loading models: ' + error + '</option>';
        }

        // Initialize the UI
        populateAgentSelect();
        renderMessages();

        // Add event listeners for settings inputs and overlay controls
        document.addEventListener('DOMContentLoaded', function() {
            // Settings input event listeners
            document.querySelectorAll('#settingsOverlay [data-setting]').forEach(element => {
                element.addEventListener('change', function() {
                    updateSettingValue(this);
                });

                // For range inputs, also update on input for real-time feedback
                if (element.type === 'range') {
                    element.addEventListener('input', function() {
                        const sliderValue = this.parentElement.querySelector('.slider-value');
                        if (sliderValue) {
                            sliderValue.textContent = this.value;
                        }
                    });
                }
            });

            // Global keyboard event listener for ESC key
            document.addEventListener('keydown', function(event) {
                if (event.key === 'Escape' || event.keyCode === 27) {
                    const overlay = document.getElementById('settingsOverlay');
                    if (overlay && overlay.style.display === 'flex') {
                        closeSettings();
                        event.preventDefault();
                        event.stopPropagation();
                    }
                }
            });

            // Click outside to close settings
            document.getElementById('settingsOverlay').addEventListener('click', function(event) {
                // Only close if clicking the overlay background, not the modal content
                if (event.target === this) {
                    closeSettings();
                }
            });

            // Prevent closing when clicking inside the modal
            document.querySelector('.settings-modal').addEventListener('click', function(event) {
                event.stopPropagation();
            });
        });
    </script>
</body>
</html>`;
  }

  private _generateId(): string {
    return Math.random().toString(36).substring(2, 11);
  }

  /**
   * Get VS Code configuration value
   */
  private _getVSCodeConfig(key: string): any {
    const config = vscode.workspace.getConfiguration("ollamaAgent");
    return config.get(key);
  }


  /**
   * Change the selected agent type
   */
  private _changeSelectedAgent(agentType: AgentSpecialization): void {
    this._selectedAgentType = agentType;
    this._useAutoAgentSelection = false; // Disable auto-selection when manually selecting
    
    const agentInfo = getAgentDisplayInfo(agentType);
    logger.info(`Changed selected agent to: ${agentInfo.displayName}`);
    
    // Notify the webview of the agent change
    this._panel.webview.postMessage({
      command: "agentChanged",
      agentType: agentType,
      agentInfo: agentInfo,
      autoSelection: this._useAutoAgentSelection
    });
    
    vscode.window.showInformationMessage(`Switched to ${agentInfo.displayName}`);
  }

  /**
   * Toggle automatic agent selection
   */
  private _toggleAutoAgentSelection(enabled: boolean): void {
    this._useAutoAgentSelection = enabled;
    
    logger.info(`Auto agent selection ${enabled ? 'enabled' : 'disabled'}`);
    
    // Notify the webview
    this._panel.webview.postMessage({
      command: "autoAgentSelectionChanged",
      enabled: enabled,
      currentAgent: this._selectedAgentType
    });
    
    const message = enabled ? 
      "Automatic agent selection enabled - agents will be chosen based on task analysis" :
      "Manual agent selection enabled - using selected agent type";
    vscode.window.showInformationMessage(message);
  }

  /**
   * Create a new workflow visualization for a message
   */
  private _createWorkflowVisualization(
    messageId: string, 
    originalTask: string, 
    taskPlan: any[], 
    complexity: string
  ): void {
    const workflowId = `workflow_${Date.now()}`;
    
    const tasks: WorkflowTask[] = taskPlan.map(task => ({
      id: task.id,
      description: task.description,
      agentType: task.agentType,
      dependencies: task.dependencies || [],
      priority: task.priority || 1,
      estimatedDuration: task.estimatedDuration || 30000,
      status: "pending",
      progress: 0
    }));

    const workflow: WorkflowVisualization = {
      id: workflowId,
      originalTask,
      complexity,
      tasks,
      startTime: new Date(),
      isActive: true
    };

    this._activeWorkflows.set(messageId, workflow);
    
    // Update the message with workflow data
    const messageIndex = this._messages.findIndex(m => m.id === messageId);
    if (messageIndex >= 0) {
      this._messages[messageIndex].workflow = workflow;
      this._updateMessages();
    }
  }

  /**
   * Update a specific task in a workflow
   */
  private _updateWorkflowTask(
    messageId: string, 
    taskId: string, 
    updates: Partial<WorkflowTask>
  ): void {
    const workflow = this._activeWorkflows.get(messageId);
    if (!workflow) return;

    const taskIndex = workflow.tasks.findIndex(t => t.id === taskId);
    if (taskIndex >= 0) {
      workflow.tasks[taskIndex] = { ...workflow.tasks[taskIndex], ...updates };
      
      // Update the message
      const messageIndex = this._messages.findIndex(m => m.id === messageId);
      if (messageIndex >= 0) {
        this._messages[messageIndex].workflow = workflow;
        this._updateMessages();
      }
    }
  }

  /**
   * Complete a workflow visualization
   */
  private _completeWorkflowVisualization(
    messageId: string, 
    results: any[], 
    successRate: number
  ): void {
    const workflow = this._activeWorkflows.get(messageId);
    if (!workflow) return;

    workflow.endTime = new Date();
    workflow.successRate = successRate;
    workflow.isActive = false;

    // Update the message
    const messageIndex = this._messages.findIndex(m => m.id === messageId);
    if (messageIndex >= 0) {
      this._messages[messageIndex].workflow = workflow;
      this._updateMessages();
    }
  }

  /**
   * Clean up model name by removing ":latest" suffix if present
   */
  private _cleanModelName(modelName: string | undefined): string {
    if (!modelName || typeof modelName !== "string") {
      return "";
    }

    // Remove ":latest" suffix if it exists
    return modelName.endsWith(":latest") ? modelName.slice(0, -7) : modelName;
  }
}
