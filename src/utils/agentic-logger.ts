/**
 * Enhanced Agentic Flow Logger
 *
 * Provides detailed logging of the agentic pipeline including:
 * - Agent identification and specialization
 * - Model usage and routing decisions
 * - Action execution and responses
 * - Pipeline stage progression
 * - Performance metrics and confidence scores
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getConfig } from "../config";
import chalk from "chalk";
import { logger as baseLogger } from "./logger";

export enum AgenticLogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
}

export interface AgentLogContext {
  agentName: string;
  agentType: string;
  specialization?: string;
  model: string;
  provider?: string; // ollama, vllm, etc.
  stage?: string;
  pipelineId?: string;
  sessionId?: string;
}

export interface ActionLogEntry {
  actionType:
    | "thought"
    | "tool_call"
    | "observation"
    | "reasoning"
    | "planning"
    | "validation";
  actionName?: string;
  input?: any;
  output?: any;
  duration?: number;
  confidence?: number;
  success?: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export interface StageLogEntry {
  stageName: string;
  stageType: "pipeline_stage" | "agent_execution" | "tool_execution";
  startTime: Date;
  endTime?: Date;
  duration?: number;
  success?: boolean;
  confidence?: number;
  input?: any;
  output?: any;
  error?: string;
  subStages?: StageLogEntry[];
}

export interface PipelineLogEntry {
  pipelineId: string;
  query: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  agentFlow: AgentFlowEntry[];
  stagesCompleted: string[];
  stagesFailed: string[];
  overallConfidence?: number;
  success?: boolean;
  error?: string;
}

export interface AgentFlowEntry {
  timestamp: Date;
  agent: AgentLogContext;
  action: ActionLogEntry;
  stage?: StageLogEntry;
}

class AgenticLogger {
  private outputChannel: vscode.OutputChannel;
  private logLevel: AgenticLogLevel = AgenticLogLevel.INFO;
  private currentPipeline: PipelineLogEntry | null = null;
  private activeSessions: Map<string, PipelineLogEntry> = new Map();
  private logDirectory: string;
  private currentLogFile: string | null = null;
  private currentLogDate: string | null = null;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel(
      "Ollama Agent - Agentic Flow"
    );
    this.logDirectory = this.initializeLogDirectory();
    this.updateLogLevel();

    // Log successful initialization
    this.outputChannel.appendLine(
      `[AGENTIC_LOGGER] Initialized with log directory: ${this.logDirectory}`
    );
  }

  /**
   * Initialize the logs directory
   */
  private initializeLogDirectory(): string {
    try {
      // Get the workspace folder or use a default directory
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const baseDir = workspaceFolder
        ? workspaceFolder.uri.fsPath
        : require("os").homedir();
      const logsDir = path.join(
        baseDir,
        ".ollama-agent-vscode-extension",
        "logs"
      );

      // Create the logs directory if it doesn't exist
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      return logsDir;
    } catch (error) {
      const errorMsg = `Failed to initialize log directory: ${error}`;
      console.error(errorMsg);
      // Also log to output channel once it's available
      if (this.outputChannel) {
        this.outputChannel.appendLine(`[AGENTIC_LOGGER ERROR] ${errorMsg}`);
      }
      // Fallback to temp directory
      const tempDir = require("os").tmpdir();
      const fallbackDir = path.join(tempDir, "ollama-agent-logs");
      if (!fs.existsSync(fallbackDir)) {
        fs.mkdirSync(fallbackDir, { recursive: true });
      }
      return fallbackDir;
    }
  }

  /**
   * Get the current log file path based on date
   */
  private getCurrentLogFile(): string {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD format

    // Check if we need to rotate to a new log file
    if (this.currentLogDate !== dateStr) {
      this.currentLogDate = dateStr;
      this.currentLogFile = path.join(
        this.logDirectory,
        `agentic-flow-${dateStr}.log`
      );
    }

    return this.currentLogFile!;
  }

  /**
   * Write log entry to file
   */
  private writeToFile(logMessage: string): void {
    try {
      const logFile = this.getCurrentLogFile();
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${logMessage}\n`;
      
      // Ensure log directory exists before writing
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }
      
      // Append to file (create if doesn't exist)
      fs.appendFileSync(logFile, logEntry, "utf8");
      
      // Verify write was successful by checking file exists
      if (!fs.existsSync(logFile)) {
        throw new Error(`Log file was not created: ${logFile}`);
      }
      
    } catch (error) {
      // Enhanced error reporting with more details
      const errorDetails = {
        error: error instanceof Error ? error.message : String(error),
        logDirectory: this.logDirectory,
        currentLogFile: this.currentLogFile,
        directoryExists: fs.existsSync(this.logDirectory),
        canWriteToDirectory: this.canWriteToDirectory()
      };
      
      // Log error to VS Code output channel for visibility
      this.outputChannel.appendLine(
        `[AGENTIC_LOGGER ERROR] Failed to write to agentic log file: ${JSON.stringify(errorDetails, null, 2)}`
      );
      console.error("Failed to write to agentic log file:", errorDetails);
      
      // Also try to log to base logger as fallback
      if (baseLogger) {
        baseLogger.error("Agentic logger file write failed:", errorDetails);
      }
    }
  }
  
  /**
   * Check if we can write to the log directory
   */
  private canWriteToDirectory(): boolean {
    try {
      const testFile = path.join(this.logDirectory, 'test_write.tmp');
      fs.writeFileSync(testFile, 'test', 'utf8');
      fs.unlinkSync(testFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up old log files (keep last 30 days)
   */
  private cleanupOldLogs(): void {
    try {
      const files = fs.readdirSync(this.logDirectory);
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (file.startsWith("agentic-flow-") && file.endsWith(".log")) {
          const filePath = path.join(this.logDirectory, file);
          const stats = fs.statSync(filePath);

          if (now - stats.mtime.getTime() > thirtyDaysMs) {
            fs.unlinkSync(filePath);
            console.log(`Cleaned up old agentic log file: ${file}`);
          }
        }
      }
    } catch (error) {
      console.error("Failed to cleanup old log files:", error);
    }
  }

  public updateLogLevel() {
    const config = getConfig();
    switch (config.logLevel) {
      case "debug":
        this.logLevel = AgenticLogLevel.DEBUG;
        break;
      case "info":
        this.logLevel = AgenticLogLevel.INFO;
        break;
      case "warn":
        this.logLevel = AgenticLogLevel.WARN;
        break;
      case "error":
        this.logLevel = AgenticLogLevel.ERROR;
        break;
      default:
        this.logLevel = AgenticLogLevel.INFO;
    }

    // Perform cleanup periodically (every time log level is updated)
    // This happens when extension starts or config changes
    this.cleanupOldLogs();
  }

  /**
   * Start logging a new pipeline execution
   */
  public startPipeline(
    pipelineId: string,
    query: string,
    sessionId?: string
  ): void {
    const pipelineEntry: PipelineLogEntry = {
      pipelineId,
      query: query.length > 100 ? `${query.substring(0, 100)}...` : query,
      startTime: new Date(),
      agentFlow: [],
      stagesCompleted: [],
      stagesFailed: [],
      success: false,
    };

    this.activeSessions.set(sessionId || pipelineId, pipelineEntry);
    this.currentPipeline = pipelineEntry;

    this.logPipelineEvent(
      AgenticLogLevel.INFO,
      `🚀 PIPELINE_START`,
      `Pipeline ${pipelineId} started`,
      { pipelineId, query: pipelineEntry.query, sessionId }
    );
  }

  /**
   * End pipeline execution
   */
  public endPipeline(
    pipelineId: string,
    success: boolean,
    error?: string,
    overallConfidence?: number,
    sessionId?: string
  ): void {
    const pipeline = this.activeSessions.get(sessionId || pipelineId);
    if (pipeline) {
      pipeline.endTime = new Date();
      pipeline.duration =
        pipeline.endTime.getTime() - pipeline.startTime.getTime();
      pipeline.success = success;
      pipeline.error = error;
      pipeline.overallConfidence = overallConfidence;

      this.logPipelineEvent(
        success ? AgenticLogLevel.INFO : AgenticLogLevel.ERROR,
        `🏁 PIPELINE_END`,
        `Pipeline ${pipelineId} ${success ? "completed" : "failed"}`,
        {
          pipelineId,
          duration: pipeline.duration,
          stagesCompleted: pipeline.stagesCompleted.length,
          stagesFailed: pipeline.stagesFailed.length,
          overallConfidence,
          success,
          error,
        }
      );

      // Clean up
      this.activeSessions.delete(sessionId || pipelineId);
      if (this.currentPipeline?.pipelineId === pipelineId) {
        this.currentPipeline = null;
      }
    }
  }

  /**
   * Log agent action within the pipeline
   */
  public logAgentAction(
    agentContext: AgentLogContext,
    action: ActionLogEntry,
    stage?: StageLogEntry,
    sessionId?: string
  ): void {
    const pipeline =
      this.currentPipeline || this.activeSessions.get(sessionId || "");

    const flowEntry: AgentFlowEntry = {
      timestamp: new Date(),
      agent: agentContext,
      action,
      stage,
    };

    if (pipeline) {
      pipeline.agentFlow.push(flowEntry);
    }

    // Format the log message
    const agentInfo = `${agentContext.agentName}(${agentContext.model})`;
    const stageInfo = stage ? `[${stage.stageName}]` : "";
    const actionInfo = action.actionName || action.actionType;

    let message = `${agentInfo} ${stageInfo} → ${actionInfo}`;
    if (action.confidence) {
      message += ` (${(action.confidence * 100).toFixed(1)}% confident)`;
    }

    const level =
      action.success === false
        ? AgenticLogLevel.ERROR
        : action.actionType === "thought"
        ? AgenticLogLevel.DEBUG
        : AgenticLogLevel.INFO;

    this.logPipelineEvent(level, `🤖 AGENT_ACTION`, message, {
      agent: agentContext.agentName,
      model: agentContext.model,
      provider: agentContext.provider,
      stage: stage?.stageName,
      action: actionInfo,
      duration: action.duration,
      confidence: action.confidence,
      success: action.success,
      input: this.truncateForLog(action.input),
      output: this.truncateForLog(action.output),
      error: action.error,
    });
  }

  /**
   * Log stage start
   */
  public logStageStart(
    stageName: string,
    stageType: "pipeline_stage" | "agent_execution" | "tool_execution",
    input?: any,
    agentContext?: AgentLogContext,
    sessionId?: string
  ): void {
    // Note: pipeline tracking handled by logPipelineEvent internally

    this.logPipelineEvent(
      AgenticLogLevel.INFO,
      `📍 STAGE_START`,
      `Starting ${stageName} (${stageType})`,
      {
        stage: stageName,
        type: stageType,
        agent: agentContext?.agentName,
        model: agentContext?.model,
        provider: agentContext?.provider,
        input: this.truncateForLog(input),
      }
    );
  }

  /**
   * Log stage completion
   */
  public logStageEnd(
    stageName: string,
    success: boolean,
    duration?: number,
    confidence?: number,
    output?: any,
    error?: string,
    agentContext?: AgentLogContext,
    sessionId?: string
  ): void {
    const pipeline =
      this.currentPipeline || this.activeSessions.get(sessionId || "");

    if (pipeline) {
      if (success) {
        pipeline.stagesCompleted.push(stageName);
      } else {
        pipeline.stagesFailed.push(stageName);
      }
    }

    const statusIcon = success ? "✅" : "❌";
    let message = `${statusIcon} ${stageName} ${
      success ? "completed" : "failed"
    }`;
    if (duration) {
      message += ` (${duration}ms)`;
    }
    if (confidence) {
      message += ` [${(confidence * 100).toFixed(1)}% confident]`;
    }

    this.logPipelineEvent(
      success ? AgenticLogLevel.INFO : AgenticLogLevel.ERROR,
      `📊 STAGE_END`,
      message,
      {
        stage: stageName,
        success,
        duration,
        confidence,
        agent: agentContext?.agentName,
        model: agentContext?.model,
        provider: agentContext?.provider,
        output: this.truncateForLog(output),
        error,
      }
    );
  }

  /**
   * Log model routing decision
   */
  public logModelRouting(
    stage: string,
    originalProvider: string,
    selectedProvider: string,
    model: string,
    reason: string,
    confidence?: number,
    metrics?: Record<string, any>
  ): void {
    const routingInfo =
      originalProvider !== selectedProvider
        ? `${originalProvider} → ${selectedProvider}`
        : selectedProvider;

    this.logPipelineEvent(
      AgenticLogLevel.INFO,
      `🧠 MODEL_ROUTING`,
      `${stage}: ${routingInfo} (${model}) - ${reason}`,
      {
        stage,
        originalProvider,
        selectedProvider,
        model,
        reason,
        confidence,
        metrics,
      }
    );
  }

  /**
   * Log provider performance metrics
   */
  public logProviderMetrics(
    provider: string,
    model: string,
    metrics: {
      latency?: number;
      success?: boolean;
      throughput?: number;
      tokensPerSecond?: number;
      errorRate?: number;
    }
  ): void {
    this.logPipelineEvent(
      AgenticLogLevel.DEBUG,
      `📈 PROVIDER_METRICS`,
      `${provider}(${model}) metrics updated`,
      {
        provider,
        model,
        ...metrics,
      }
    );
  }

  /**
   * Log tool execution details
   */
  public logToolExecution(
    toolName: string,
    agent: AgentLogContext,
    input: any,
    output?: any,
    duration?: number,
    success?: boolean,
    error?: string
  ): void {
    const statusIcon = success ? "🔧" : "⚠️";
    let message = `${statusIcon} ${agent.agentName} executed ${toolName}`;
    if (duration) {
      message += ` (${duration}ms)`;
    }

    this.logPipelineEvent(
      success ? AgenticLogLevel.INFO : AgenticLogLevel.WARN,
      `🛠️ TOOL_EXECUTION`,
      message,
      {
        tool: toolName,
        agent: agent.agentName,
        model: agent.model,
        duration,
        success,
        input: this.truncateForLog(input),
        output: this.truncateForLog(output),
        error,
      }
    );
  }

  /**
   * Log reasoning steps and chain of thought
   */
  public logReasoning(
    agent: AgentLogContext,
    reasoningType:
      | "chain_of_thought"
      | "task_planning"
      | "critique"
      | "validation",
    steps: string[],
    confidence?: number,
    duration?: number
  ): void {
    this.logPipelineEvent(
      AgenticLogLevel.DEBUG,
      `🧠 REASONING`,
      `${agent.agentName} performing ${reasoningType}`,
      {
        agent: agent.agentName,
        model: agent.model,
        reasoningType,
        steps: steps.slice(0, 3), // Limit to first 3 steps for brevity
        totalSteps: steps.length,
        confidence,
        duration,
      }
    );
  }

  /**
   * Get pipeline statistics
   */
  public getPipelineStatistics(sessionId?: string): any {
    const pipelineEntry =
      this.currentPipeline || this.activeSessions.get(sessionId || "");
    if (!pipelineEntry) {
      return null;
    }

    const agentUsage = new Map<string, number>();
    const modelUsage = new Map<string, number>();
    const actionTypes = new Map<string, number>();

    for (const flow of pipelineEntry.agentFlow) {
      // Track agent usage
      const agentKey = `${flow.agent.agentName}(${flow.agent.model})`;
      agentUsage.set(agentKey, (agentUsage.get(agentKey) || 0) + 1);

      // Track model usage
      const modelKey = flow.agent.provider
        ? `${flow.agent.model}@${flow.agent.provider}`
        : flow.agent.model;
      modelUsage.set(modelKey, (modelUsage.get(modelKey) || 0) + 1);

      // Track action types
      actionTypes.set(
        flow.action.actionType,
        (actionTypes.get(flow.action.actionType) || 0) + 1
      );
    }

    return {
      pipelineId: pipelineEntry.pipelineId,
      duration: pipelineEntry.duration,
      stagesCompleted: pipelineEntry.stagesCompleted.length,
      stagesFailed: pipelineEntry.stagesFailed.length,
      totalActions: pipelineEntry.agentFlow.length,
      agentUsage: Object.fromEntries(agentUsage),
      modelUsage: Object.fromEntries(modelUsage),
      actionTypes: Object.fromEntries(actionTypes),
      overallConfidence: pipelineEntry.overallConfidence,
      success: pipelineEntry.success,
    };
  }

  /**
   * Core logging method with structured formatting
   */
  private logPipelineEvent(
    level: AgenticLogLevel,
    eventType: string,
    message: string,
    data?: Record<string, any>
  ): void {
    if (level < this.logLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelStr = AgenticLogLevel[level];

    // Color coding by event type
    let coloredEventType = eventType;
    if (eventType.includes("PIPELINE_START")) {
      coloredEventType = chalk.green.bold(eventType);
    } else if (eventType.includes("PIPELINE_END")) {
      coloredEventType = chalk.blue.bold(eventType);
    } else if (eventType.includes("AGENT_ACTION")) {
      coloredEventType = chalk.cyan(eventType);
    } else if (eventType.includes("STAGE_")) {
      coloredEventType = chalk.yellow(eventType);
    } else if (eventType.includes("MODEL_ROUTING")) {
      coloredEventType = chalk.magenta(eventType);
    } else if (eventType.includes("TOOL_EXECUTION")) {
      coloredEventType = chalk.white(eventType);
    } else if (eventType.includes("REASONING")) {
      coloredEventType = chalk.gray(eventType);
    }

    // Format the main message
    let coloredMessage = message;
    switch (level) {
      case AgenticLogLevel.DEBUG:
        coloredMessage = chalk.blue(message);
        break;
      case AgenticLogLevel.INFO:
        coloredMessage = chalk.green(message);
        break;
      case AgenticLogLevel.WARN:
        coloredMessage = chalk.yellow(message);
        break;
      case AgenticLogLevel.ERROR:
        coloredMessage = chalk.red(message);
        break;
    }

    const formattedMessage = `[${timestamp}] [${levelStr}] ${coloredEventType} | ${coloredMessage}`;

    // Log to agentic channel
    let outputMessage: string;
    if (data && Object.keys(data).length > 0) {
      outputMessage = `${formattedMessage}\n  └─ ${JSON.stringify(
        data,
        null,
        2
      )}`;
      this.outputChannel.appendLine(`${formattedMessage}`);
      this.outputChannel.appendLine(`  └─ ${JSON.stringify(data, null, 2)}`);
    } else {
      outputMessage = formattedMessage;
      this.outputChannel.appendLine(formattedMessage);
    }

    // Write to daily log file
    this.writeToFile(outputMessage);

    // Also log to base logger for consolidated logging
    baseLogger.debug(`${eventType} | ${message}`, data);
  }

  /**
   * Truncate large objects for logging
   */
  private truncateForLog(obj: any, maxLength: number = 200): any {
    if (obj === null || obj === undefined) return obj;

    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
    if (str.length <= maxLength) return obj;

    return str.substring(0, maxLength) + "...";
  }

  /**
   * Show the agentic logger output channel
   */
  public show(): void {
    this.outputChannel.show();
  }

  /**
   * Clear all active sessions (for debugging)
   */
  public clearActiveSessions(): void {
    this.activeSessions.clear();
    this.currentPipeline = null;
  }

  /**
   * Export current session data
   */
  public exportSessionData(sessionId?: string): PipelineLogEntry | null {
    return (
      this.currentPipeline || this.activeSessions.get(sessionId || "") || null
    );
  }

  /**
   * Get log directory information
   */
  public getLogInfo(): {
    logDirectory: string;
    currentLogFile: string | null;
    currentLogDate: string | null;
  } {
    return {
      logDirectory: this.logDirectory,
      currentLogFile: this.currentLogFile,
      currentLogDate: this.currentLogDate,
    };
  }

  /**
   * Get list of available log files
   */
  public getLogFiles(): string[] {
    try {
      const files = fs.readdirSync(this.logDirectory);
      return files
        .filter(
          (file) => file.startsWith("agentic-flow-") && file.endsWith(".log")
        )
        .sort()
        .reverse(); // Most recent first
    } catch (error) {
      console.error("Failed to read log directory:", error);
      return [];
    }
  }

  /**
   * Read content from a specific log file
   */
  public readLogFile(filename: string): string | null {
    try {
      const filePath = path.join(this.logDirectory, filename);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf8");
      }
      return null;
    } catch (error) {
      console.error(`Failed to read log file ${filename}:`, error);
      return null;
    }
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.outputChannel.dispose();
    this.activeSessions.clear();
  }
}

// Export singleton instance
export const agenticLogger = new AgenticLogger();

// Helper functions for common logging patterns
export const logPipelineStart = (
  pipelineId: string,
  query: string,
  sessionId?: string
) => agenticLogger.startPipeline(pipelineId, query, sessionId);

export const logPipelineEnd = (
  pipelineId: string,
  success: boolean,
  error?: string,
  confidence?: number,
  sessionId?: string
) =>
  agenticLogger.endPipeline(pipelineId, success, error, confidence, sessionId);

export const logAgentAction = (
  agent: AgentLogContext,
  action: ActionLogEntry,
  stage?: StageLogEntry,
  sessionId?: string
) => agenticLogger.logAgentAction(agent, action, stage, sessionId);

export const logStageStart = (
  stageName: string,
  stageType: "pipeline_stage" | "agent_execution" | "tool_execution",
  input?: any,
  agent?: AgentLogContext,
  sessionId?: string
) => agenticLogger.logStageStart(stageName, stageType, input, agent, sessionId);

export const logStageEnd = (
  stageName: string,
  success: boolean,
  duration?: number,
  confidence?: number,
  output?: any,
  error?: string,
  agent?: AgentLogContext,
  sessionId?: string
) =>
  agenticLogger.logStageEnd(
    stageName,
    success,
    duration,
    confidence,
    output,
    error,
    agent,
    sessionId
  );

export const logModelRouting = (
  stage: string,
  originalProvider: string,
  selectedProvider: string,
  model: string,
  reason: string,
  confidence?: number,
  metrics?: Record<string, any>
) =>
  agenticLogger.logModelRouting(
    stage,
    originalProvider,
    selectedProvider,
    model,
    reason,
    confidence,
    metrics
  );

export const logToolExecution = (
  toolName: string,
  agent: AgentLogContext,
  input: any,
  output?: any,
  duration?: number,
  success?: boolean,
  error?: string
) =>
  agenticLogger.logToolExecution(
    toolName,
    agent,
    input,
    output,
    duration,
    success,
    error
  );

export const logReasoning = (
  agent: AgentLogContext,
  reasoningType:
    | "chain_of_thought"
    | "task_planning"
    | "critique"
    | "validation",
  steps: string[],
  confidence?: number,
  duration?: number
) =>
  agenticLogger.logReasoning(agent, reasoningType, steps, confidence, duration);

// Helper functions for log management
export const getLogInfo = () => agenticLogger.getLogInfo();
export const getLogFiles = () => agenticLogger.getLogFiles();
export const readLogFile = (filename: string) =>
  agenticLogger.readLogFile(filename);
export const showAgenticLogs = () => agenticLogger.show();
