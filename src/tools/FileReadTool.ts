import { z } from "zod";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";
import { BaseTool } from "../core/BaseTool";

/**
 * Tool for reading files in the VS Code workspace
 */
export class FileReadTool extends BaseTool {
  name = "file_read";
  description =
    "Read and return the contents of a SINGLE FILE in the VS Code workspace. Use this to examine existing code, configuration files, or any text-based files when you need to analyze or process the file contents. Requires 'filePath' parameter (NOT 'dirPath'). For listing directory contents, use 'file_list' tool instead. This returns the file content as text, NOT for opening files in the editor - use open_file tool for that.";

  schema = z.object({
    filePath: z
      .string()
      .describe("The relative path to the file from the workspace root"),
    encoding: z.string().optional().describe("File encoding (default: utf8)"),
  });

  async execute(input: z.infer<typeof this.schema>): Promise<string> {
    const { filePath, encoding = "utf8" } = input;

    try {
      // Enhanced parameter validation with detailed logging
      if (!filePath || typeof filePath !== "string") {
        const errorDetails = {
          received: input,
          filePathType: typeof filePath,
          filePathValue: filePath,
          allKeys: Object.keys(input || {}),
        };
        logger.error(`FileReadTool parameter validation failed:`, errorDetails);

        // Check for common parameter mistakes
        const hasDirectoryPath = "dirPath" in (input as any);
        const hasRecursive = "recursive" in (input as any);

        let errorMsg = `filePath parameter is required and must be a string. Received: ${typeof filePath} (${filePath}). Input keys: [${Object.keys(
          input || {}
        ).join(", ")}]`;

        if (hasDirectoryPath) {
          errorMsg += `. NOTE: file_read requires 'filePath' parameter, not 'dirPath'. Use 'file_list' tool to list directory contents.`;
        }

        if (hasRecursive) {
          errorMsg += `. NOTE: file_read reads individual files, not directories. Use 'file_list' with recursive option to explore directories.`;
        }

        throw new Error(errorMsg);
      }

      if (filePath.trim() === "") {
        throw new Error("filePath parameter cannot be empty");
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

      // Check if file exists
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
      }

      // Read the file
      const content = await fs.readFile(fullPath, {
        encoding: "utf8",
      });

      logger.debug(
        `Successfully read file: ${filePath} (${content.length} characters)`
      );

      return content;
    } catch (error) {
      const errorMessage = `Failed to read file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }
}

/**
 * Tool for listing files in a directory
 */
export class FileListTool extends BaseTool {
  name = "file_list";
  description =
    "List files and directories in a workspace directory. Use this to explore the project structure and discover what files exist. Requires 'dirPath' parameter (NOT 'filePath'). Use recursive=true to explore subdirectories. For reading actual file contents, use 'file_read' tool instead.";

  schema = z.object({
    dirPath: z
      .string()
      .describe(
        'The relative directory path from workspace root (use "." for root)'
      ),
    recursive: z
      .boolean()
      .optional()
      .describe("Whether to list files recursively (default: false)"),
  });

  async execute(input: z.infer<typeof this.schema>): Promise<string> {
    const { dirPath, recursive = false } = input;

    try {
      // Validate required parameters
      if (!dirPath || typeof dirPath !== "string") {
        throw new Error(
          `dirPath parameter is required and must be a string. Received: ${typeof dirPath} (${dirPath})`
        );
      }

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

      const files = await listDirectory(fullPath, recursive, workspacePath);

      logger.debug(`Listed ${files.length} items in ${dirPath}`);

      return files.join("\n");
    } catch (error) {
      const errorMessage = `Failed to list directory ${dirPath}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }
}

async function listDirectory(
  dirPath: string,
  recursive: boolean,
  workspaceRoot: string
): Promise<string[]> {
  const items: string[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(workspaceRoot, fullPath);

      if (entry.isDirectory()) {
        items.push(`📁 ${relativePath}/`);

        if (recursive) {
          const subItems = await listDirectory(
            fullPath,
            recursive,
            workspaceRoot
          );
          items.push(...subItems);
        }
      } else {
        items.push(`📄 ${relativePath}`);
      }
    }
  } catch (error) {
    // If we can't read a directory, note it but continue
    const relativePath = path.relative(workspaceRoot, dirPath);
    items.push(`❌ ${relativePath}/ (access denied)`);
  }

  return items.sort();
}
