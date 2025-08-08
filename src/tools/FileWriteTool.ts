import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";

/**
 * Tool for writing files in the VS Code workspace
 */
export class FileWriteTool extends BaseTool {
  name = "file_write";
  description =
    "Create or overwrite a file in the VS Code workspace. Use this to create new files or modify existing ones with new content.";

  schema = z.object({
    filePath: z
      .string()
      .describe("The relative path to the file from the workspace root"),
    content: z.string().describe("The content to write to the file"),
    encoding: z.string().optional().describe("File encoding (default: utf8)"),
  });

  async execute(input: z.infer<typeof this.schema>): Promise<string> {
    const { filePath, content, encoding = "utf8" } = input;

    try {
      // Validate required parameters
      if (!filePath || typeof filePath !== "string") {
        throw new Error(
          `filePath parameter is required and must be a string. Received: ${typeof filePath} (${filePath})`
        );
      }
      if (content === undefined || content === null) {
        throw new Error(
          `content parameter is required. Received: ${typeof content} (${content})`
        );
      }

      // Get the workspace folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error("No workspace folder found");
      }

      // Resolve the full path
      const fullPath = path.resolve(workspaceFolder.uri.fsPath, filePath);

      // Security check: ensure the file is within the workspace
      const workspacePath = workspaceFolder.uri.fsPath;
      if (!fullPath.startsWith(workspacePath)) {
        throw new Error("Access denied: File is outside workspace");
      }

      // Create directory if it doesn't exist
      const directory = path.dirname(fullPath);
      await fs.mkdir(directory, { recursive: true });

      // Write the file
      await fs.writeFile(fullPath, content, { encoding: encoding as any });

      // Open the file in VS Code editor
      const document = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(document);

      logger.info(
        `Successfully wrote file: ${filePath} (${content.length} characters)`
      );

      return `File ${filePath} has been created/updated successfully with ${content.length} characters.`;
    } catch (error) {
      const errorMessage = `Failed to write file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }
}

/**
 * Tool for appending content to an existing file
 */
export class FileAppendTool extends BaseTool {
  name = "file_append";
  description =
    "Append content to an existing file in the VS Code workspace. Use this to add content to the end of a file without overwriting existing content.";

  schema = z.object({
    filePath: z
      .string()
      .describe("The relative path to the file from the workspace root"),
    content: z.string().describe("The content to append to the file"),
    encoding: z.string().optional().describe("File encoding (default: utf8)"),
  });

  async execute(input: z.infer<typeof this.schema>): Promise<string> {
    const { filePath, content, encoding = "utf8" } = input;

    try {
      // Validate required parameters
      if (!filePath || typeof filePath !== "string") {
        throw new Error(
          `filePath parameter is required and must be a string. Received: ${typeof filePath} (${filePath})`
        );
      }
      if (content === undefined || content === null) {
        throw new Error(
          `content parameter is required. Received: ${typeof content} (${content})`
        );
      }

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error("No workspace folder found");
      }

      const fullPath = path.resolve(workspaceFolder.uri.fsPath, filePath);

      // Security check
      const workspacePath = workspaceFolder.uri.fsPath;
      if (!fullPath.startsWith(workspacePath)) {
        throw new Error("Access denied: File is outside workspace");
      }

      // Check if file exists
      try {
        await fs.access(fullPath);
      } catch {
        throw new Error(`File does not exist: ${filePath}`);
      }

      // Append to the file
      await fs.appendFile(fullPath, content, { encoding: encoding as any });

      logger.info(
        `Successfully appended to file: ${filePath} (${content.length} characters added)`
      );

      return `Content appended to ${filePath} successfully (${content.length} characters added).`;
    } catch (error) {
      const errorMessage = `Failed to append to file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }
}

/**
 * Tool for creating directories
 */
export class DirectoryCreateTool extends BaseTool {
  name = "directory_create";
  description =
    "Create a new directory in the VS Code workspace. Use this to organize files into folders.";

  schema = z.object({
    dirPath: z
      .string()
      .describe("The relative directory path from workspace root"),
    recursive: z
      .boolean()
      .optional()
      .describe(
        "Create parent directories if they don't exist (default: true)"
      ),
  });

  async execute(input: z.infer<typeof this.schema>): Promise<string> {
    const { dirPath, recursive = true } = input;

    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error("No workspace folder found");
      }

      const fullPath = path.resolve(workspaceFolder.uri.fsPath, dirPath);

      // Security check
      const workspacePath = workspaceFolder.uri.fsPath;
      if (!fullPath.startsWith(workspacePath)) {
        throw new Error("Access denied: Directory is outside workspace");
      }

      // Create the directory
      await fs.mkdir(fullPath, { recursive });

      logger.info(`Successfully created directory: ${dirPath}`);

      return `Directory ${dirPath} has been created successfully.`;
    } catch (error) {
      const errorMessage = `Failed to create directory ${dirPath}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }
}
