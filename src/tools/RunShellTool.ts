import { z } from "zod";
import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/logger";
import { BaseTool } from "../core/BaseTool";

const execAsync = promisify(exec);

/**
 * Tool for running shell commands in the VS Code workspace
 */
export class RunShellTool extends BaseTool {
  name = "run_shell";
  description =
    "Execute a shell command in the VS Code workspace terminal. Use this to run build scripts, tests, git commands, or other command-line operations. Be careful with destructive commands.";

  schema = z.object({
    command: z.string().describe("The shell command to execute"),
    workingDir: z
      .string()
      .optional()
      .describe(
        "Working directory relative to workspace root (default: workspace root)"
      ),
    timeout: z
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 30000)"),
  });

  async execute(input: z.infer<typeof this.schema>): Promise<string> {
    const { command, workingDir = ".", timeout = 30000 } = input;

    try {
      // Get the workspace folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error("No workspace folder found");
      }

      // Determine working directory
      const cwd =
        workingDir === "."
          ? workspaceFolder.uri.fsPath
          : `${workspaceFolder.uri.fsPath}/${workingDir}`;

      // Security checks
      const dangerousCommands = [
        "rm -rf /",
        "sudo rm",
        "format",
        "del /s /q",
        "rd /s /q",
      ];

      const isDangerous = dangerousCommands.some((dangerous) =>
        command.toLowerCase().includes(dangerous.toLowerCase())
      );

      if (isDangerous) {
        throw new Error("Dangerous command detected and blocked for safety");
      }

      logger.info(`Executing command: ${command} in ${cwd}`);

      // Show the command execution in a VS Code terminal for transparency
      const terminal = vscode.window.createTerminal({
        name: "Ollama Agent",
        cwd: cwd,
      });
      terminal.show();
      terminal.sendText(command);

      // Execute the command and capture output
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB buffer
      });

      const result =
        stdout || stderr || "Command executed successfully with no output";

      logger.info(`Command completed: ${command}`);
      logger.debug(`Command output: ${result}`);

      return result;
    } catch (error) {
      const errorMessage = `Failed to execute command "${command}": ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }
}

/**
 * Tool for running VS Code commands
 */
export class VSCodeCommandTool extends BaseTool {
  name = "vscode_command";
  description =
    "Execute a VS Code command. Use this to trigger VS Code functionality like opening files, running tasks, or invoking extensions.";

  schema = z.object({
    command: z.string().describe("The VS Code command ID to execute"),
    args: z
      .array(z.any())
      .optional()
      .describe("Arguments to pass to the command"),
  });

  async execute(input: z.infer<typeof this.schema>): Promise<string> {
    const { command, args = [] } = input;

    try {
      logger.info(`Executing VS Code command: ${command}`);

      const result = await vscode.commands.executeCommand(command, ...args);

      const resultString = result
        ? JSON.stringify(result, null, 2)
        : "Command executed successfully";

      logger.info(`VS Code command completed: ${command}`);

      return resultString;
    } catch (error) {
      const errorMessage = `Failed to execute VS Code command "${command}": ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }
}

/**
 * Tool for opening files in the VS Code editor for user viewing or editing
 */
export class OpenFileTool extends BaseTool {
  name = "open_file";
  description =
    "Open a file in the VS Code editor for the user to view or edit. This displays the file in a new editor tab and optionally navigates to a specific line. Use this when you want the user to see or interact with a file, NOT for reading file contents - use file_read tool instead for reading contents.";

  schema = z.object({
    filePath: z
      .string()
      .describe("The relative path to the file from the workspace root"),
    line: z
      .number()
      .optional()
      .describe("Line number to navigate to (1-based)"),
    column: z
      .number()
      .optional()
      .describe("Column number to navigate to (1-based)"),
  });

  async execute(input: z.infer<typeof this.schema>): Promise<string> {
    const { filePath, line, column } = input;

    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error("No workspace folder found");
      }

      const uri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);

      // Create position if line/column specified
      const options: vscode.TextDocumentShowOptions = {};
      if (line !== undefined) {
        options.selection = new vscode.Range(
          line - 1,
          column ? column - 1 : 0,
          line - 1,
          column ? column - 1 : 0
        );
      }

      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, options);

      logger.info(`Opened file: ${filePath}${line ? ` at line ${line}` : ""}`);

      return `File ${filePath} has been opened in the editor${
        line ? ` at line ${line}` : ""
      }.`;
    } catch (error) {
      const errorMessage = `Failed to open file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }
}
