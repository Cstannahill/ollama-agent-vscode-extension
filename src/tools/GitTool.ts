import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Git Status Tool
export class GitStatusTool extends BaseTool {
  name = "git_status";
  description = "Get the current git status of the workspace";
  
  schema = z.object({
    path: z.string().optional().describe("Path to check status (defaults to workspace root)"),
    porcelain: z.boolean().optional().describe("Use porcelain output format"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = params.path || getWorkspaceRoot();
      const porcelainFlag = params.porcelain ? "--porcelain" : "";
      
      const { stdout } = await execAsync(`git status ${porcelainFlag}`, {
        cwd: workspacePath,
        timeout: 10000,
      });

      logger.debug(`[GIT_STATUS] Executed in ${workspacePath}`);
      return stdout.trim() || "Working tree clean";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[GIT_STATUS] Failed:", error);
      throw new Error(`Git status failed: ${errorMessage}`);
    }
  }

}

// Git Add Tool
export class GitAddTool extends BaseTool {
  name = "git_add";
  description = "Add files to git staging area";
  
  schema = z.object({
    files: z.union([
      z.string(),
      z.array(z.string())
    ]).describe("File path(s) to add (use '.' for all files)"),
    force: z.boolean().optional().describe("Force add ignored files"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = getWorkspaceRoot();
      const files = Array.isArray(params.files) ? params.files.join(" ") : params.files;
      const forceFlag = params.force ? "--force" : "";
      
      const { stdout, stderr } = await execAsync(`git add ${forceFlag} ${files}`, {
        cwd: workspacePath,
        timeout: 10000,
      });

      logger.debug(`[GIT_ADD] Added files: ${files}`);
      return stdout.trim() || `Successfully added: ${files}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[GIT_ADD] Failed:", error);
      throw new Error(`Git add failed: ${errorMessage}`);
    }
  }
}

// Git Commit Tool
export class GitCommitTool extends BaseTool {
  name = "git_commit";
  description = "Commit staged changes with a message";
  
  schema = z.object({
    message: z.string().describe("Commit message"),
    amend: z.boolean().optional().describe("Amend the last commit"),
    addAll: z.boolean().optional().describe("Add all changes before committing"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = getWorkspaceRoot();
      
      // Add all files if requested
      if (params.addAll) {
        await execAsync("git add .", { cwd: workspacePath });
      }
      
      const amendFlag = params.amend ? "--amend" : "";
      const { stdout } = await execAsync(
        `git commit ${amendFlag} -m "${params.message.replace(/"/g, '\\"')}"`,
        {
          cwd: workspacePath,
          timeout: 15000,
        }
      );

      logger.info(`[GIT_COMMIT] Committed with message: ${params.message}`);
      return stdout.trim();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[GIT_COMMIT] Failed:", error);
      throw new Error(`Git commit failed: ${errorMessage}`);
    }
  }
}

// Git Branch Tool
export class GitBranchTool extends BaseTool {
  name = "git_branch";
  description = "List, create, or switch git branches";
  
  schema = z.object({
    action: z.enum(["list", "create", "switch", "delete"]).describe("Action to perform"),
    branchName: z.string().optional().describe("Branch name (required for create/switch/delete)"),
    createFromCurrent: z.boolean().optional().describe("Create branch from current HEAD"),
    force: z.boolean().optional().describe("Force operation (for delete)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = getWorkspaceRoot();
      let command = "git branch";
      
      switch (params.action) {
        case "list":
          command = "git branch -a";
          break;
          
        case "create":
          if (!params.branchName) {
            throw new Error("Branch name is required for create action");
          }
          command = `git branch ${params.branchName}`;
          break;
          
        case "switch":
          if (!params.branchName) {
            throw new Error("Branch name is required for switch action");
          }
          command = `git checkout ${params.branchName}`;
          break;
          
        case "delete":
          if (!params.branchName) {
            throw new Error("Branch name is required for delete action");
          }
          const deleteFlag = params.force ? "-D" : "-d";
          command = `git branch ${deleteFlag} ${params.branchName}`;
          break;
      }

      const { stdout } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 10000,
      });

      logger.debug(`[GIT_BRANCH] Executed: ${command}`);
      return stdout.trim();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[GIT_BRANCH] Failed:", error);
      throw new Error(`Git branch operation failed: ${errorMessage}`);
    }
  }
}

// Git Log Tool
export class GitLogTool extends BaseTool {
  name = "git_log";
  description = "Show git commit history";
  
  schema = z.object({
    count: z.number().optional().describe("Number of commits to show (default: 10)"),
    oneline: z.boolean().optional().describe("Show one line per commit"),
    graph: z.boolean().optional().describe("Show commit graph"),
    author: z.string().optional().describe("Filter by author"),
    since: z.string().optional().describe("Show commits since date (e.g., '2 weeks ago')"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = getWorkspaceRoot();
      let command = "git log";
      
      if (params.count) {
        command += ` -${params.count}`;
      } else {
        command += " -10"; // Default to 10 commits
      }
      
      if (params.oneline) {
        command += " --oneline";
      }
      
      if (params.graph) {
        command += " --graph";
      }
      
      if (params.author) {
        command += ` --author="${params.author}"`;
      }
      
      if (params.since) {
        command += ` --since="${params.since}"`;
      }

      const { stdout } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 10000,
      });

      logger.debug(`[GIT_LOG] Executed: ${command}`);
      return stdout.trim();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[GIT_LOG] Failed:", error);
      throw new Error(`Git log failed: ${errorMessage}`);
    }
  }
}

// Git Diff Tool
export class GitDiffTool extends BaseTool {
  name = "git_diff";
  description = "Show differences between commits, working tree, or staged changes";
  
  schema = z.object({
    staged: z.boolean().optional().describe("Show staged changes"),
    file: z.string().optional().describe("Show diff for specific file"),
    commit: z.string().optional().describe("Compare with specific commit"),
    nameOnly: z.boolean().optional().describe("Show only changed file names"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = getWorkspaceRoot();
      let command = "git diff";
      
      if (params.staged) {
        command += " --staged";
      }
      
      if (params.nameOnly) {
        command += " --name-only";
      }
      
      if (params.commit) {
        command += ` ${params.commit}`;
      }
      
      if (params.file) {
        command += ` -- "${params.file}"`;
      }

      const { stdout } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 15000,
      });

      logger.debug(`[GIT_DIFF] Executed: ${command}`);
      return stdout.trim() || "No differences found";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[GIT_DIFF] Failed:", error);
      throw new Error(`Git diff failed: ${errorMessage}`);
    }
  }
}

// Git Stash Tool
export class GitStashTool extends BaseTool {
  name = "git_stash";
  description = "Stash or apply stashed changes";
  
  schema = z.object({
    action: z.enum(["save", "list", "apply", "pop", "drop", "clear"]).describe("Stash action"),
    message: z.string().optional().describe("Stash message (for save action)"),
    stashIndex: z.number().optional().describe("Stash index (for apply/pop/drop)"),
    includeUntracked: z.boolean().optional().describe("Include untracked files when stashing"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = getWorkspaceRoot();
      let command = "git stash";
      
      switch (params.action) {
        case "save":
          command += " push";
          if (params.includeUntracked) {
            command += " -u";
          }
          if (params.message) {
            command += ` -m "${params.message.replace(/"/g, '\\"')}"`;
          }
          break;
          
        case "list":
          command += " list";
          break;
          
        case "apply":
          command += " apply";
          if (params.stashIndex !== undefined) {
            command += ` stash@{${params.stashIndex}}`;
          }
          break;
          
        case "pop":
          command += " pop";
          if (params.stashIndex !== undefined) {
            command += ` stash@{${params.stashIndex}}`;
          }
          break;
          
        case "drop":
          command += " drop";
          if (params.stashIndex !== undefined) {
            command += ` stash@{${params.stashIndex}}`;
          }
          break;
          
        case "clear":
          command += " clear";
          break;
      }

      const { stdout } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 10000,
      });

      logger.debug(`[GIT_STASH] Executed: ${command}`);
      return stdout.trim() || `Stash ${params.action} completed successfully`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[GIT_STASH] Failed:", error);
      throw new Error(`Git stash ${params.action} failed: ${errorMessage}`);
    }
  }
}

// Git Remote Tool
export class GitRemoteTool extends BaseTool {
  name = "git_remote";
  description = "Manage git remotes";
  
  schema = z.object({
    action: z.enum(["list", "add", "remove", "set-url"]).describe("Remote action"),
    name: z.string().optional().describe("Remote name"),
    url: z.string().optional().describe("Remote URL"),
    verbose: z.boolean().optional().describe("Show URLs for list action"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = getWorkspaceRoot();
      let command = "git remote";
      
      switch (params.action) {
        case "list":
          command += params.verbose ? " -v" : "";
          break;
          
        case "add":
          if (!params.name || !params.url) {
            throw new Error("Remote name and URL are required for add action");
          }
          command += ` add ${params.name} ${params.url}`;
          break;
          
        case "remove":
          if (!params.name) {
            throw new Error("Remote name is required for remove action");
          }
          command += ` remove ${params.name}`;
          break;
          
        case "set-url":
          if (!params.name || !params.url) {
            throw new Error("Remote name and URL are required for set-url action");
          }
          command += ` set-url ${params.name} ${params.url}`;
          break;
      }

      const { stdout } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 10000,
      });

      logger.debug(`[GIT_REMOTE] Executed: ${command}`);
      return stdout.trim() || `Remote ${params.action} completed successfully`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[GIT_REMOTE] Failed:", error);
      throw new Error(`Git remote ${params.action} failed: ${errorMessage}`);
    }
  }
}

// Helper method for workspace root
function getWorkspaceRoot(): string {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error("No workspace folder is open");
  }
  return workspaceFolders[0].uri.fsPath;
}