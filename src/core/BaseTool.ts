import { z } from "zod";
import * as vscode from "vscode";

/**
 * Simple tool interface for our agent (without LangChain dependency)
 */
export interface SimpleTool {
  name: string;
  description: string;
  schema: z.ZodSchema<any>;
  execute(input: any): Promise<string>;
}

/**
 * Base class for simple tools
 */
export abstract class BaseTool implements SimpleTool {
  abstract name: string;
  abstract description: string;
  abstract schema: z.ZodSchema<any>;

  abstract execute(input: any): Promise<string>;

  /**
   * Validate input against schema
   */
  validateInput(input: any): boolean {
    try {
      this.schema.parse(input);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get formatted tool description for prompts
   */
  getDescription(): string {
    return `Tool: ${this.name}
Description: ${this.description}
Parameters: ${JSON.stringify(this.schema, null, 2)}`;
  }

  /**
   * Get the workspace root path
   */
  protected getWorkspaceRoot(): string {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error("No workspace folder is open");
      }
      return workspaceFolders[0].uri.fsPath;
    } catch (error) {
      // Fallback for when called outside VS Code context
      return process.cwd();
    }
  }
}
