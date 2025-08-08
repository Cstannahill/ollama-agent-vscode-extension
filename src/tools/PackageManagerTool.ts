import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";

const execAsync = promisify(exec);

// Package Install Tool
export class PackageInstallTool extends BaseTool {
  name = "package_install";
  description = "Install packages using npm, yarn, or pnpm";
  
  schema = z.object({
    packages: z.union([z.string(), z.array(z.string())]).describe("Package name(s) to install"),
    manager: z.enum(["npm", "yarn", "pnpm", "auto"]).optional().describe("Package manager to use (auto-detect if not specified)"),
    dev: z.boolean().optional().describe("Install as dev dependency"),
    global: z.boolean().optional().describe("Install globally"),
    exact: z.boolean().optional().describe("Install exact version"),
    save: z.boolean().optional().describe("Save to package.json"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      
      // Auto-detect package manager if not specified
      const manager = params.manager === "auto" || !params.manager 
        ? await this.detectPackageManager(workspacePath)
        : params.manager;

      const packages = Array.isArray(params.packages) ? params.packages : [params.packages];
      const command = await this.buildInstallCommand(manager, packages, params);
      
      logger.info(`[PACKAGE_INSTALL] Running: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 300000, // 5 minutes for package installation
        maxBuffer: 1024 * 1024 * 50, // 50MB buffer for large outputs
      });

      const output = stdout + (stderr ? `\n\nWarnings/Info:\n${stderr}` : "");
      logger.info(`[PACKAGE_INSTALL] Installation completed`);
      
      return `Successfully installed packages: ${packages.join(", ")}\n\n${output}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[PACKAGE_INSTALL] Failed:", error);
      
      if (error && typeof error === 'object' && 'stdout' in error) {
        const execError = error as any;
        return `Package installation failed: ${errorMessage}\n\nOutput:\n${execError.stdout}\n\nErrors:\n${execError.stderr}`;
      }
      
      throw new Error(`Package installation failed: ${errorMessage}`);
    }
  }

  private async detectPackageManager(workspacePath: string): Promise<"npm" | "yarn" | "pnpm"> {
    try {
      // Check for lock files to determine package manager
      const files = await fs.readdir(workspacePath);
      
      if (files.includes("pnpm-lock.yaml")) {
        return "pnpm";
      } else if (files.includes("yarn.lock")) {
        return "yarn";
      } else {
        return "npm"; // Default fallback
      }
    } catch (error) {
      logger.debug("Failed to detect package manager, defaulting to npm:", error);
      return "npm";
    }
  }

  private async buildInstallCommand(
    manager: string, 
    packages: string[], 
    params: any
  ): Promise<string> {
    const packageList = packages.join(" ");
    
    switch (manager) {
      case "npm":
        let npmCmd = `npm install ${packageList}`;
        if (params.dev) npmCmd += " --save-dev";
        if (params.global) npmCmd += " --global";
        if (params.exact) npmCmd += " --save-exact";
        return npmCmd;
        
      case "yarn":
        let yarnCmd = `yarn add ${packageList}`;
        if (params.dev) yarnCmd += " --dev";
        if (params.global) yarnCmd = `yarn global add ${packageList}`;
        if (params.exact) yarnCmd += " --exact";
        return yarnCmd;
        
      case "pnpm":
        let pnpmCmd = `pnpm add ${packageList}`;
        if (params.dev) pnpmCmd += " --save-dev";
        if (params.global) pnpmCmd += " --global";
        if (params.exact) pnpmCmd += " --save-exact";
        return pnpmCmd;
        
      default:
        throw new Error(`Unsupported package manager: ${manager}`);
    }
  }
}

// Package Update Tool
export class PackageUpdateTool extends BaseTool {
  name = "package_update";
  description = "Update packages to their latest versions";
  
  schema = z.object({
    packages: z.union([z.string(), z.array(z.string())]).optional().describe("Specific package(s) to update (update all if not specified)"),
    manager: z.enum(["npm", "yarn", "pnpm", "auto"]).optional().describe("Package manager to use"),
    latest: z.boolean().optional().describe("Update to latest version (not just semver compatible)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const manager = params.manager === "auto" || !params.manager 
        ? await this.detectPackageManager(workspacePath)
        : params.manager;

      const command = this.buildUpdateCommand(manager, params);
      
      logger.info(`[PACKAGE_UPDATE] Running: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 300000,
        maxBuffer: 1024 * 1024 * 50,
      });

      return `Package update completed:\n\n${stdout}${stderr ? `\n\nWarnings:\n${stderr}` : ""}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[PACKAGE_UPDATE] Failed:", error);
      throw new Error(`Package update failed: ${errorMessage}`);
    }
  }

  private async detectPackageManager(workspacePath: string): Promise<"npm" | "yarn" | "pnpm"> {
    // Same detection logic as PackageInstallTool
    try {
      const files = await fs.readdir(workspacePath);
      if (files.includes("pnpm-lock.yaml")) return "pnpm";
      if (files.includes("yarn.lock")) return "yarn";
      return "npm";
    } catch {
      return "npm";
    }
  }

  private buildUpdateCommand(manager: string, params: any): string {
    const packages = params.packages 
      ? (Array.isArray(params.packages) ? params.packages.join(" ") : params.packages)
      : "";

    switch (manager) {
      case "npm":
        return packages 
          ? `npm update ${packages}` 
          : "npm update";
          
      case "yarn":
        return packages 
          ? `yarn upgrade ${packages}${params.latest ? " --latest" : ""}` 
          : "yarn upgrade";
          
      case "pnpm":
        return packages 
          ? `pnpm update ${packages}${params.latest ? " --latest" : ""}` 
          : "pnpm update";
          
      default:
        throw new Error(`Unsupported package manager: ${manager}`);
    }
  }
}

// Package Audit Tool
export class PackageAuditTool extends BaseTool {
  name = "package_audit";
  description = "Audit packages for security vulnerabilities";
  
  schema = z.object({
    manager: z.enum(["npm", "yarn", "pnpm", "auto"]).optional().describe("Package manager to use"),
    fix: z.boolean().optional().describe("Automatically fix vulnerabilities"),
    level: z.enum(["info", "low", "moderate", "high", "critical"]).optional().describe("Minimum severity level to report"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const manager = params.manager === "auto" || !params.manager 
        ? await this.detectPackageManager(workspacePath)
        : params.manager;

      const command = this.buildAuditCommand(manager, params);
      
      logger.info(`[PACKAGE_AUDIT] Running: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 10,
      });

      return `Security audit results:\n\n${stdout}${stderr ? `\n\nAdditional info:\n${stderr}` : ""}`;
    } catch (error) {
      // Audit might return non-zero exit code when vulnerabilities are found
      if (error && typeof error === 'object' && 'stdout' in error) {
        const execError = error as any;
        return `Security audit completed with findings:\n\n${execError.stdout}${execError.stderr ? `\n\nErrors:\n${execError.stderr}` : ""}`;
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[PACKAGE_AUDIT] Failed:", error);
      throw new Error(`Package audit failed: ${errorMessage}`);
    }
  }

  private async detectPackageManager(workspacePath: string): Promise<"npm" | "yarn" | "pnpm"> {
    try {
      const files = await fs.readdir(workspacePath);
      if (files.includes("pnpm-lock.yaml")) return "pnpm";
      if (files.includes("yarn.lock")) return "yarn";
      return "npm";
    } catch {
      return "npm";
    }
  }

  private buildAuditCommand(manager: string, params: any): string {
    switch (manager) {
      case "npm":
        let cmd = "npm audit";
        if (params.fix) cmd += " --fix";
        if (params.level) cmd += ` --audit-level=${params.level}`;
        return cmd;
        
      case "yarn":
        return params.fix ? "yarn audit --fix" : "yarn audit";
        
      case "pnpm":
        return "pnpm audit";
        
      default:
        throw new Error(`Unsupported package manager: ${manager}`);
    }
  }
}

// Dependency Analyzer Tool
export class DependencyAnalyzerTool extends BaseTool {
  name = "dependency_analyze";
  description = "Analyze project dependencies and their relationships";
  
  schema = z.object({
    type: z.enum(["tree", "outdated", "licenses", "size"]).describe("Type of dependency analysis"),
    depth: z.number().optional().describe("Maximum depth for dependency tree"),
    production: z.boolean().optional().describe("Only analyze production dependencies"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const manager = await this.detectPackageManager(workspacePath);
      const command = this.buildAnalysisCommand(manager, params);
      
      logger.info(`[DEPENDENCY_ANALYZE] Running: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 60000,
        maxBuffer: 1024 * 1024 * 20,
      });

      return `Dependency analysis (${params.type}):\n\n${stdout}${stderr ? `\n\nAdditional info:\n${stderr}` : ""}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[DEPENDENCY_ANALYZE] Failed:", error);
      throw new Error(`Dependency analysis failed: ${errorMessage}`);
    }
  }

  private async detectPackageManager(workspacePath: string): Promise<"npm" | "yarn" | "pnpm"> {
    try {
      const files = await fs.readdir(workspacePath);
      if (files.includes("pnpm-lock.yaml")) return "pnpm";
      if (files.includes("yarn.lock")) return "yarn";
      return "npm";
    } catch {
      return "npm";
    }
  }

  private buildAnalysisCommand(manager: string, params: any): string {
    const prodFlag = params.production ? "--production" : "";
    
    switch (params.type) {
      case "tree":
        switch (manager) {
          case "npm":
            return `npm list ${prodFlag}${params.depth ? ` --depth=${params.depth}` : ""}`;
          case "yarn":
            return `yarn list ${params.depth ? `--depth=${params.depth}` : ""}`;
          case "pnpm":
            return `pnpm list ${prodFlag}${params.depth ? ` --depth=${params.depth}` : ""}`;
        }
        break;
        
      case "outdated":
        switch (manager) {
          case "npm":
            return "npm outdated";
          case "yarn":
            return "yarn outdated";
          case "pnpm":
            return "pnpm outdated";
        }
        break;
        
      case "licenses":
        // This might require additional packages like license-checker
        return "npx license-checker --summary";
        
      case "size":
        // This might require additional packages like bundlephobia-cli
        return "npx bundle-phobia-cli";
        
      default:
        throw new Error(`Unsupported analysis type: ${params.type}`);
    }
    
    throw new Error(`Command building failed for ${manager} and ${params.type}`);
  }
}