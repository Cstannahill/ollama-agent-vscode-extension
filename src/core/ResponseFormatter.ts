import { OllamaLLM } from "../api/ollama";
import { logger } from "../utils/logger";
import { AgentAction } from "../core/ChatSession";

// Import AgentResponse from BasicAgent since that's where it's defined
export interface AgentResponse {
  content: string;
  actions: AgentAction[];
  success: boolean;
  error?: string;
}

export interface FormattingConfig {
  ollamaUrl: string;
  model: string;
  temperature?: number;
}

export interface FormattedResponse {
  summary: string;
  details?: string;
  actions?: string[];
  files?: string[];
  error?: string;
}

/**
 * ResponseFormatter handles post-processing of agent responses to create
 * clean, structured output suitable for user consumption
 */
export class ResponseFormatter {
  private llm: OllamaLLM;
  private config: FormattingConfig;

  constructor(config: FormattingConfig) {
    this.config = config;
    this.llm = new OllamaLLM({
      baseUrl: config.ollamaUrl,
      model: config.model,
      temperature: config.temperature || 0.3, // Lower temperature for consistent formatting
    });
  }

  /**
   * Format an agent response into a clean, structured summary
   */
  async formatResponse(
    originalRequest: string,
    agentResponse: AgentResponse,
    rawOutput?: string
  ): Promise<FormattedResponse> {
    try {
      logger.debug("[FORMATTER] Starting response formatting", {
        originalRequest: originalRequest.substring(0, 100),
        success: agentResponse.success,
        actionsCount: agentResponse.actions?.length || 0,
        contentLength: agentResponse.content?.length || 0,
      });

      // If there's an error, return formatted error response
      if (!agentResponse.success || agentResponse.error) {
        return this.formatErrorResponse(agentResponse);
      }

      // Extract information from actions
      const actionsSummary = this.extractActionsSummary(agentResponse.actions || []);
      const modifiedFiles = this.extractModifiedFiles(agentResponse.actions || []);

      // Determine the appropriate formatting strategy
      const strategy = this.determineFormattingStrategy(originalRequest, agentResponse);
      
      let formattedSummary: string;
      
      switch (strategy) {
        case "file_analysis":
          formattedSummary = await this.formatFileAnalysis(
            originalRequest,
            agentResponse.content,
            rawOutput,
            actionsSummary
          );
          break;
        case "code_generation":
          formattedSummary = await this.formatCodeGeneration(
            originalRequest,
            agentResponse.content,
            actionsSummary,
            modifiedFiles
          );
          break;
        case "project_overview":
          formattedSummary = await this.formatProjectOverview(
            originalRequest,
            agentResponse.content,
            actionsSummary
          );
          break;
        case "task_completion":
        default:
          formattedSummary = await this.formatTaskCompletion(
            originalRequest,
            agentResponse.content,
            actionsSummary,
            modifiedFiles
          );
          break;
      }

      return {
        summary: formattedSummary,
        actions: actionsSummary,
        files: modifiedFiles,
      };
    } catch (error) {
      logger.error("[FORMATTER] Failed to format response:", error);
      
      // Fallback to original content if formatting fails
      return {
        summary: agentResponse.content || "Task completed",
        error: `Formatting failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Format error responses
   */
  private formatErrorResponse(agentResponse: AgentResponse): FormattedResponse {
    const errorMessage = agentResponse.error || "An unknown error occurred";
    
    return {
      summary: `❌ **Task Failed**\n\n${errorMessage}`,
      error: errorMessage,
    };
  }

  /**
   * Extract a summary of actions taken
   */
  private extractActionsSummary(actions: AgentAction[]): string[] {
    return actions
      .filter(action => action.toolCall)
      .map(action => {
        const tool = action.toolCall!;
        const toolName = tool.toolName;
        
        switch (toolName) {
          case "file_read":
            return `📖 Read file: ${tool.input?.filePath || 'unknown'}`;
          case "file_write":
            return `✏️ Wrote to file: ${tool.input?.filePath || 'unknown'}`;
          case "file_list":
            return `📁 Listed directory: ${tool.input?.dirPath || '.'}`;
          case "run_shell":
            return `⚡ Executed: ${tool.input?.command || 'unknown command'}`;
          case "open_file":
            return `📄 Opened file: ${tool.input?.filePath || 'unknown'}`;
          default:
            return `🔧 ${toolName}: ${JSON.stringify(tool.input || {})}`;
        }
      });
  }

  /**
   * Extract list of modified files
   */
  private extractModifiedFiles(actions: AgentAction[]): string[] {
    const files = new Set<string>();
    
    actions
      .filter(action => action.toolCall)
      .forEach((action: AgentAction) => {
        const tool = action.toolCall!;
        if (tool.toolName === "file_write" && tool.input?.filePath) {
          files.add(tool.input.filePath);
        }
      });
    
    return Array.from(files);
  }

  /**
   * Determine the best formatting strategy based on the request and response
   */
  private determineFormattingStrategy(
    request: string,
    response: AgentResponse
  ): "file_analysis" | "code_generation" | "project_overview" | "task_completion" {
    const requestLower = request.toLowerCase();
    const hasFileActions = response.actions?.some(a => 
      a.toolCall?.toolName === "file_read" || a.toolCall?.toolName === "file_write"
    );
    
    if (requestLower.includes("read") || requestLower.includes("analyze") || 
        requestLower.includes("summarize") || requestLower.includes("explain")) {
      return "file_analysis";
    }
    
    if (requestLower.includes("create") || requestLower.includes("write") || 
        requestLower.includes("generate") || requestLower.includes("implement")) {
      return "code_generation";
    }
    
    if (requestLower.includes("project") || requestLower.includes("overview") || 
        requestLower.includes("structure")) {
      return "project_overview";
    }
    
    return "task_completion";
  }

  /**
   * Format file analysis responses
   */
  private async formatFileAnalysis(
    request: string,
    content: string,
    rawOutput?: string,
    actions?: string[]
  ): Promise<string> {
    const formatPrompt = `You are a technical documentation specialist. Your task is to create a clean, well-structured summary from raw technical content.

Original Request: "${request}"

Raw Content to Format:
${rawOutput || content}

Actions Taken:
${actions?.join('\n') || 'None'}

Please create a clear, concise summary that:
1. Provides a brief overview of what was analyzed
2. Highlights key findings or important information
3. Uses proper markdown formatting (headers, lists, code blocks)
4. Is easy to read and professionally formatted
5. Removes any raw data dumps or verbose technical details
6. Focuses on actionable insights or important takeaways

Format your response as a professional technical summary. Use markdown formatting for better readability.`;

    const formattedResponse = await this.llm.generateText(formatPrompt);
    return formattedResponse;
  }

  /**
   * Format code generation responses
   */
  private async formatCodeGeneration(
    request: string,
    content: string,
    actions?: string[],
    modifiedFiles?: string[]
  ): Promise<string> {
    const formatPrompt = `You are a software development documentation specialist. Create a clear summary of code generation/modification work.

Original Request: "${request}"

Raw Response: "${content}"

Actions Taken:
${actions?.join('\n') || 'None'}

Files Modified:
${modifiedFiles?.join('\n') || 'None'}

Please create a professional summary that:
1. Briefly describes what was implemented or modified
2. Lists the key changes made
3. Mentions any important technical decisions
4. Uses markdown formatting for clarity
5. Focuses on what the user accomplished, not the process details

Format as a concise development summary with proper markdown.`;

    const formattedResponse = await this.llm.generateText(formatPrompt);
    return formattedResponse;
  }

  /**
   * Format project overview responses
   */
  private async formatProjectOverview(
    request: string,
    content: string,
    actions?: string[]
  ): Promise<string> {
    const formatPrompt = `You are a project documentation specialist. Create a well-organized project overview from raw technical data.

Original Request: "${request}"

Raw Content: "${content}"

Actions Taken:
${actions?.join('\n') || 'None'}

Please create a structured project overview that:
1. Provides a clear project summary
2. Organizes information using proper headings and sections
3. Uses markdown formatting for better structure
4. Highlights important project characteristics
5. Removes verbose technical output and focuses on key insights
6. Makes the information accessible to both technical and non-technical readers

Format as a professional project documentation with proper markdown structure.`;

    const formattedResponse = await this.llm.generateText(formatPrompt);
    return formattedResponse;
  }

  /**
   * Format general task completion responses
   */
  private async formatTaskCompletion(
    request: string,
    content: string,
    actions?: string[],
    modifiedFiles?: string[]
  ): Promise<string> {
    const formatPrompt = `You are a technical communication specialist. Create a clear, professional summary of completed work.

Original Request: "${request}"

Raw Response: "${content}"

Actions Taken:
${actions?.join('\n') || 'None'}

Files Modified:
${modifiedFiles?.join('\n') || 'None'}

Please create a professional task completion summary that:
1. Clearly states what was accomplished
2. Summarizes the key actions taken
3. Mentions any important outcomes or results
4. Uses proper markdown formatting
5. Is concise but informative
6. Avoids technical jargon where possible

Format as a clear, professional task completion report with markdown formatting.`;

    const formattedResponse = await this.llm.generateText(formatPrompt);
    return formattedResponse;
  }

  /**
   * Update the formatter's model
   */
  updateModel(newModel: string): void {
    this.config.model = newModel;
    this.llm = new OllamaLLM({
      baseUrl: this.config.ollamaUrl,
      model: newModel,
      temperature: this.config.temperature || 0.3,
    });
    
    logger.info(`[FORMATTER] Updated model to: ${newModel}`);
  }
}