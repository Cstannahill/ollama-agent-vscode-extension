import { PromptTemplate } from "@langchain/core/prompts";
import { ToolManager } from "./ToolManager";
import { IntelligentToolSelector } from "./IntelligentToolSelector";
import { logger } from "../utils/logger";

/**
 * Builds prompts for the Ollama agent using LangChain prompt templates
 */
export class PromptBuilder {
  private toolManager: ToolManager;

  constructor(toolManager: ToolManager) {
    this.toolManager = toolManager;
  }

  /**
   * Create a system prompt template for the agent
   */
  createSystemPrompt(): PromptTemplate {
    const systemTemplate = `You are an intelligent coding assistant agent working within VS Code. You have access to tools that allow you to:

1. Read and write files in the workspace
2. Execute shell commands
3. Open files in the editor
4. List directory contents
5. Run VS Code commands

## Available Tools:
{tools}

## Instructions:
- Always think step by step about what you need to do
- Use the available tools to gather information before making changes
- Be precise and careful with file operations
- Explain your reasoning for each action
- If you encounter errors, analyze them and try alternative approaches
- Complete the task efficiently without repeating the same actions
- Ask for clarification if the user's request is ambiguous

## Response Format:
You MUST follow this exact format when using tools. This is CRITICAL for the system to work:

THOUGHT: [Your reasoning about what tool to use and why]
ACTION: [exact_tool_name_from_list_above]
ACTION_INPUT: {{"parameter": "value"}}

## CRITICAL FORMATTING RULES:
1. ALWAYS include ACTION_INPUT when using ACTION
2. ACTION_INPUT must be valid JSON on a single line
3. ACTION_INPUT must contain ONLY the JSON object, no explanations
4. Stop immediately after the JSON - do not add any text after ACTION_INPUT
5. Use exact parameter names from the tool schema
6. If no action is needed, provide your final answer without ACTION/ACTION_INPUT
7. Do NOT include reasoning or explanations after ACTION_INPUT
8. Do NOT wrap JSON in markdown code blocks
9. Do NOT leave ACTION_INPUT empty - always provide required parameters

## Examples:
THOUGHT: I need to read the contents of the README.md file to understand the project.
ACTION: file_read
ACTION_INPUT: {{"filePath": "README.md"}}

THOUGHT: I need to create a new file called ollama-agent.md with project documentation.
ACTION: file_write
ACTION_INPUT: {{"filePath": "ollama-agent.md", "content": "# Ollama Agent\\n\\nThis is a VS Code extension..."}}

THOUGHT: I need to list files in the current directory to see the project structure.
ACTION: file_list
ACTION_INPUT: {{"dirPath": "."}}

## WRONG Examples (DO NOT DO THIS):
❌ ACTION_INPUT: {{"filePath": "README.md"}}
   Let me read this file to understand the context...

❌ ACTION_INPUT: (with code blocks)
   {{"filePath": "README.md"}}

❌ ACTION: file_read
   ACTION_INPUT:

❌ ACTION_INPUT: {{"filePath": "README.md", "explanation": "I want to read the file"}}

❌ ACTION_INPUT: {{}}

Always start your response with THOUGHT: to show your reasoning.
Never leave ACTION_INPUT empty or without required parameters.`;

    logger.debug("[PROMPT BUILDER] Creating system prompt template", {
      templateLength: systemTemplate.length,
      hasToolsPlaceholder: systemTemplate.includes("{tools}"),
    });

    try {
      const promptTemplate = PromptTemplate.fromTemplate(systemTemplate);
      logger.debug(
        "[PROMPT BUILDER] System prompt template created successfully"
      );
      return promptTemplate;
    } catch (error) {
      logger.error(
        "[PROMPT BUILDER] Failed to create system prompt template:",
        error
      );
      throw error;
    }
  }

  /**
   * Create a prompt template for ReAct-style reasoning
   */
  createReActPrompt(): PromptTemplate {
    const reactTemplate = `{system_prompt}

## Current Task:
{task}

## Workspace Context:
{workspace_context}

## Previous Actions:
{previous_actions}

## Current Observation:
{current_observation}

Now, what is your next step? Remember to start with THOUGHT: and then ACTION: and ACTION_INPUT: if you need to use a tool.`;

    return PromptTemplate.fromTemplate(reactTemplate);
  }

  /**
   * Create a prompt for analyzing errors and planning recovery
   */
  createErrorAnalysisPrompt(): PromptTemplate {
    const errorTemplate = `An error occurred while executing the previous action:

## Error Details:
{error_message}

## Previous Action:
Tool: {tool_name}
Input: {tool_input}

## Context:
{context}

Please analyze this error and determine the best way to proceed. Consider:
1. What went wrong?
2. Can this be fixed with a different approach?
3. Do you need more information?
4. Should you try a different tool or modify the parameters?

Start your response with THOUGHT: to analyze the error, then provide your next ACTION if appropriate.`;

    return PromptTemplate.fromTemplate(errorTemplate);
  }

  /**
   * Create a prompt for task completion summary
   */
  createSummaryPrompt(): PromptTemplate {
    const summaryTemplate = `## Task Completion Summary

Original Request: {original_request}

## Actions Taken:
{actions_summary}

## Final Result:
{final_result}

## Files Modified:
{modified_files}

Please provide a clear summary of what was accomplished, any issues encountered, and recommendations for the user.`;

    return PromptTemplate.fromTemplate(summaryTemplate);
  }

  /**
   * Get formatted tools description for prompts with intelligent selection
   */
  async getToolsDescription(task?: string): Promise<string> {
    try {
      const allTools = this.toolManager.getAllTools();
      const allToolsMap = new Map(allTools.map((tool) => [tool.name, tool]));

      // Use intelligent tool selection if task is provided and we have enough tools
      let selectedTools = allTools;
      if (task && allTools.length > 8) {
        const toolSelector = new IntelligentToolSelector();
        selectedTools = toolSelector.selectRelevantTools(task, allToolsMap, 8);

        // Log context savings
        const savings = toolSelector.estimateContextSavings(
          selectedTools.length,
          allTools.length,
          500 // Average tool description length
        );

        logger.debug("[PROMPT BUILDER] Intelligent tool selection applied", {
          originalToolCount: allTools.length,
          selectedToolCount: selectedTools.length,
          savedTokens: savings.savedTokens,
          savedPercentage: savings.savedPercentage.toFixed(1) + "%",
        });
      }

      logger.debug("[PROMPT BUILDER] Generating tools description for", {
        toolCount: selectedTools.length,
        toolNames: selectedTools.map((t) => t.name),
      });

      const toolDescriptions = selectedTools.map((tool) => {
        try {
          const schemaExample = this.generateSchemaExample(tool.schema);
          const schemaStr = JSON.stringify(tool.schema, null, 2)
            .replace(/\{/g, "{{")
            .replace(/\}/g, "}}");
          const description = `### ${tool.name}
Description: ${tool.description}
Parameters: ${schemaStr}
Example: ${schemaExample}`;

          logger.debug(
            `[PROMPT BUILDER] Generated description for tool: ${tool.name}`,
            {
              descriptionLength: description.length,
              hasValidSchema: !!tool.schema,
            }
          );

          return description;
        } catch (toolError) {
          logger.error(
            `[PROMPT BUILDER] Failed to generate description for tool ${tool.name}:`,
            toolError
          );
          return `### ${tool.name}
Description: ${tool.description}
Parameters: Error generating schema
Example: {{{}}}`;
        }
      });

      const result = toolDescriptions.join("\n\n");
      logger.debug("[PROMPT BUILDER] Tools description completed", {
        totalLength: result.length,
        toolCount: toolDescriptions.length,
      });

      return result;
    } catch (error) {
      logger.error(
        "[PROMPT BUILDER] Failed to generate tools description:",
        error
      );
      throw error;
    }
  }

  /**
   * Generate an example usage for a tool schema
   */
  private generateSchemaExample(schema: any): string {
    try {
      const properties = schema.shape || schema._def?.shape || {};
      const example: any = {};

      for (const [key, value] of Object.entries(properties)) {
        if (typeof value === "object" && value !== null) {
          const type = (value as any)._def?.typeName || "unknown";

          // Generate realistic examples based on parameter names
          if (key === "filePath") {
            example[key] = "README.md";
          } else if (key === "dirPath") {
            example[key] = ".";
          } else if (key === "command") {
            example[key] = "ls -la";
          } else if (key === "content") {
            example[key] = "file content here";
          } else if (key === "encoding") {
            example[key] = "utf8";
          } else if (key === "recursive") {
            example[key] = false;
          } else {
            // Default type-based examples
            switch (type) {
              case "ZodString":
                example[key] = `example_${key}`;
                break;
              case "ZodNumber":
                example[key] = 42;
                break;
              case "ZodBoolean":
                example[key] = true;
                break;
              case "ZodArray":
                example[key] = ["example_item"];
                break;
              default:
                example[key] = `example_${key}`;
            }
          }
        }
      }

      return JSON.stringify(example, null, 2)
        .replace(/\{/g, "{{")
        .replace(/\}/g, "}}");
    } catch (error) {
      logger.warn("Failed to generate schema example:", error);
      return "{{{}}}";
    }
  }

  /**
   * Build a complete prompt for the agent with intelligent tool selection
   */
  async buildAgentPrompt(
    task: string,
    workspaceContext: string = "",
    previousActions: string = "",
    currentObservation: string = ""
  ): Promise<string> {
    const systemPrompt = this.createSystemPrompt();
    const reactPrompt = this.createReActPrompt();
    const toolsDescription = await this.getToolsDescription(task);

    const systemPromptText = await systemPrompt.format({
      tools: toolsDescription,
    });

    const fullPrompt = await reactPrompt.format({
      system_prompt: systemPromptText,
      task,
      workspace_context: workspaceContext,
      previous_actions: previousActions,
      current_observation: currentObservation,
    });

    logger.debug("Built agent prompt with intelligent tool selection", {
      task,
      promptLength: fullPrompt.length,
      previousActionsLength: previousActions.length,
      previousActionsPreview:
        previousActions.substring(0, 300) +
        (previousActions.length > 300 ? "..." : ""),
    });

    return fullPrompt;
  }

  /**
   * Build an error recovery prompt
   */
  async buildErrorPrompt(
    errorMessage: string,
    toolName: string,
    toolInput: any,
    context: string
  ): Promise<string> {
    const errorPrompt = this.createErrorAnalysisPrompt();

    return await errorPrompt.format({
      error_message: errorMessage,
      tool_name: toolName,
      tool_input: JSON.stringify(toolInput, null, 2),
      context,
    });
  }

  /**
   * Build a task summary prompt
   */
  async buildSummaryPrompt(
    originalRequest: string,
    actionsSummary: string,
    finalResult: string,
    modifiedFiles: string[]
  ): Promise<string> {
    const summaryPrompt = this.createSummaryPrompt();

    return await summaryPrompt.format({
      original_request: originalRequest,
      actions_summary: actionsSummary,
      final_result: finalResult,
      modified_files: modifiedFiles.join("\n"),
    });
  }
}
