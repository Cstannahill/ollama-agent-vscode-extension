import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { OllamaChatMessage } from "../api/ollama";
import { logger } from "../utils/logger";

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

/**
 * Manages chat session state, message history, and agent actions
 */
export class ChatSession {
  private messages: BaseMessage[] = [];
  private actions: AgentAction[] = [];
  private sessionId: string;
  private workspaceContext: string = "";

  constructor(sessionId?: string) {
    this.sessionId = sessionId || this.generateSessionId();
    logger.info(`Created new chat session: ${this.sessionId}`);
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Add a system message to the session
   */
  addSystemMessage(content: string): void {
    this.messages.push(new SystemMessage(content));
    logger.debug("Added system message to session");
  }

  /**
   * Add a human message to the session
   */
  addHumanMessage(content: string): void {
    this.messages.push(new HumanMessage(content));
    logger.debug("Added human message to session");
  }

  /**
   * Add an AI message to the session
   */
  addAIMessage(content: string): void {
    this.messages.push(new AIMessage(content));
    logger.debug("Added AI message to session");
  }

  /**
   * Add an agent action (thought + tool call + observation)
   */
  addAction(action: AgentAction): void {
    this.actions.push(action);
    logger.debug(
      `Added action to session: ${action.toolCall?.toolName || "thought-only"}`
    );
  }

  /**
   * Record a tool call
   */
  recordToolCall(
    toolName: string,
    input: any,
    output?: string,
    error?: string
  ): ToolCall {
    const toolCall: ToolCall = {
      id: this.generateToolCallId(),
      toolName,
      input,
      output,
      error,
      timestamp: new Date(),
    };

    logger.debug(`Recorded tool call: ${toolName}`, { success: !error });
    return toolCall;
  }

  /**
   * Get all messages in LangChain format
   */
  getMessages(): BaseMessage[] {
    return [...this.messages];
  }

  /**
   * Get messages in Ollama format
   */
  getOllamaMessages(): OllamaChatMessage[] {
    return this.messages.map((msg) => ({
      role: this.mapRoleToOllama(msg._getType()),
      content: msg.content.toString(),
    }));
  }

  /**
   * Get all actions taken in this session
   */
  getActions(): AgentAction[] {
    return [...this.actions];
  }

  /**
   * Get formatted actions summary for prompts
   */
  getActionsSummary(): string {
    if (this.actions.length === 0) {
      return "No previous actions taken.";
    }

    return this.actions
      .map((action, index) => {
        let summary = `${index + 1}. THOUGHT: ${action.thought}`;

        if (action.toolCall) {
          summary += `\n   ACTION: ${action.toolCall.toolName}`;
          summary += `\n   INPUT: ${JSON.stringify(action.toolCall.input)}`;

          if (action.toolCall.error) {
            summary += `\n   ERROR: ${action.toolCall.error}`;
          } else if (action.toolCall.output) {
            summary += `\n   RESULT: ${action.toolCall.output}`;
          }
        }

        if (action.observation) {
          summary += `\n   OBSERVATION: ${action.observation}`;
        }

        return summary;
      })
      .join("\n\n");
  }

  /**
   * Get list of files that were modified in this session
   */
  getModifiedFiles(): string[] {
    const modifiedFiles = new Set<string>();

    for (const action of this.actions) {
      if (
        action.toolCall?.toolName === "file_write" ||
        action.toolCall?.toolName === "file_append"
      ) {
        const filePath = action.toolCall.input?.filePath;
        if (filePath) {
          modifiedFiles.add(filePath);
        }
      }
    }

    return Array.from(modifiedFiles);
  }

  /**
   * Set workspace context information
   */
  setWorkspaceContext(context: string): void {
    this.workspaceContext = context;
  }

  /**
   * Get workspace context
   */
  getWorkspaceContext(): string {
    return this.workspaceContext;
  }

  /**
   * Clear the session
   */
  clear(): void {
    this.messages = [];
    this.actions = [];
    this.workspaceContext = "";
    logger.info(`Cleared chat session: ${this.sessionId}`);
  }

  /**
   * Export session data for persistence
   */
  export(): any {
    return {
      sessionId: this.sessionId,
      messages: this.messages.map((msg) => ({
        type: msg._getType(),
        content: msg.content,
      })),
      actions: this.actions,
      workspaceContext: this.workspaceContext,
      timestamp: new Date(),
    };
  }

  /**
   * Import session data from persistence
   */
  static import(data: any): ChatSession {
    const session = new ChatSession(data.sessionId);

    // Restore messages
    for (const msgData of data.messages || []) {
      switch (msgData.type) {
        case "system":
          session.addSystemMessage(msgData.content);
          break;
        case "human":
          session.addHumanMessage(msgData.content);
          break;
        case "ai":
          session.addAIMessage(msgData.content);
          break;
      }
    }

    // Restore actions
    session.actions = data.actions || [];
    session.workspaceContext = data.workspaceContext || "";

    logger.info(`Imported chat session: ${session.sessionId}`);
    return session;
  }

  /**
   * Get session statistics
   */
  getStats(): any {
    return {
      sessionId: this.sessionId,
      messageCount: this.messages.length,
      actionCount: this.actions.length,
      modifiedFileCount: this.getModifiedFiles().length,
      toolCallCount: this.actions.filter((a) => a.toolCall).length,
      errorCount: this.actions.filter((a) => a.toolCall?.error).length,
    };
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateToolCallId(): string {
    return `tool_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  private mapRoleToOllama(role: string): "system" | "user" | "assistant" {
    switch (role) {
      case "system":
        return "system";
      case "human":
        return "user";
      case "ai":
        return "assistant";
      default:
        return "user";
    }
  }
}
