import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";

const execAsync = promisify(exec);

// Environment Variable Manager Tool
export class EnvironmentVariableTool extends BaseTool {
  name = "env_var";
  description = "Manage environment variables in .env files and system environment";
  
  schema = z.object({
    action: z.enum(["get", "set", "list", "delete", "load"]).describe("Action to perform"),
    key: z.string().optional().describe("Environment variable name"),
    value: z.string().optional().describe("Environment variable value (for set action)"),
    file: z.string().optional().describe("Path to .env file (default: .env)"),
    system: z.boolean().optional().describe("Work with system environment instead of .env file"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { action, key, value, file = ".env", system = false } = params;
      
      logger.info(`[ENV_VAR] Performing ${action} operation`);

      switch (action) {
        case "get":
          return await this.getEnvironmentVariable(key!, system, file);
        case "set":
          return await this.setEnvironmentVariable(key!, value!, system, file);
        case "list":
          return await this.listEnvironmentVariables(system, file);
        case "delete":
          return await this.deleteEnvironmentVariable(key!, system, file);
        case "load":
          return await this.loadEnvironmentFile(file);
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[ENV_VAR] Failed:", error);
      throw new Error(`Environment variable operation failed: ${errorMessage}`);
    }
  }

  private async getEnvironmentVariable(key: string, system: boolean, file: string): Promise<string> {
    if (system) {
      const value = process.env[key];
      return value ? `${key}=${value}` : `Environment variable '${key}' not found`;
    } else {
      const envVars = await this.readEnvFile(file);
      const value = envVars[key];
      return value ? `${key}=${value}` : `Environment variable '${key}' not found in ${file}`;
    }
  }

  private async setEnvironmentVariable(key: string, value: string, system: boolean, file: string): Promise<string> {
    if (system) {
      process.env[key] = value;
      return `System environment variable '${key}' set successfully`;
    } else {
      await this.updateEnvFile(file, key, value);
      return `Environment variable '${key}' set in ${file}`;
    }
  }

  private async listEnvironmentVariables(system: boolean, file: string): Promise<string> {
    if (system) {
      const envVars = Object.entries(process.env)
        .filter(([key, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
      
      return `System Environment Variables (${envVars.length}):\n\n` +
        envVars.map(([key, value]) => `${key}=${value}`).join('\n');
    } else {
      const envVars = await this.readEnvFile(file);
      const entries = Object.entries(envVars).sort(([a], [b]) => a.localeCompare(b));
      
      return `Environment Variables in ${file} (${entries.length}):\n\n` +
        entries.map(([key, value]) => `${key}=${value}`).join('\n');
    }
  }

  private async deleteEnvironmentVariable(key: string, system: boolean, file: string): Promise<string> {
    if (system) {
      if (process.env[key]) {
        delete process.env[key];
        return `System environment variable '${key}' deleted successfully`;
      } else {
        return `System environment variable '${key}' not found`;
      }
    } else {
      const envVars = await this.readEnvFile(file);
      if (envVars[key]) {
        delete envVars[key];
        await this.writeEnvFile(file, envVars);
        return `Environment variable '${key}' deleted from ${file}`;
      } else {
        return `Environment variable '${key}' not found in ${file}`;
      }
    }
  }

  private async loadEnvironmentFile(file: string): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const filePath = path.resolve(workspacePath, file);
      
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      
      let loaded = 0;
      for (const line of lines) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const [, key, value] = match;
          process.env[key.trim()] = value.trim();
          loaded++;
        }
      }
      
      return `Loaded ${loaded} environment variables from ${file} into current process`;
    } catch (error) {
      throw new Error(`Failed to load environment file ${file}: ${error}`);
    }
  }

  private async readEnvFile(file: string): Promise<Record<string, string>> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const filePath = path.resolve(workspacePath, file);
      
      const content = await fs.readFile(filePath, "utf-8");
      const envVars: Record<string, string> = {};
      
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const match = trimmed.match(/^([^=]+)=(.*)$/);
          if (match) {
            const [, key, value] = match;
            envVars[key.trim()] = value.trim();
          }
        }
      }
      
      return envVars;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async writeEnvFile(file: string, envVars: Record<string, string>): Promise<void> {
    const workspacePath = this.getWorkspaceRoot();
    const filePath = path.resolve(workspacePath, file);
    
    const content = Object.entries(envVars)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n';
    
    await fs.writeFile(filePath, content, "utf-8");
  }

  private async updateEnvFile(file: string, key: string, value: string): Promise<void> {
    const envVars = await this.readEnvFile(file);
    envVars[key] = value;
    await this.writeEnvFile(file, envVars);
  }
}

// Environment Validator Tool
export class EnvironmentValidatorTool extends BaseTool {
  name = "env_validate";
  description = "Validate environment setup and check for required environment variables";
  
  schema = z.object({
    requiredVars: z.array(z.string()).describe("List of required environment variable names"),
    file: z.string().optional().describe("Path to .env file to validate (default: .env)"),
    strict: z.boolean().optional().describe("Fail validation if any required var is missing"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { requiredVars, file = ".env", strict = false } = params;
      
      logger.info(`[ENV_VALIDATE] Validating ${requiredVars.length} environment variables`);

      const results = await this.validateEnvironmentVariables(requiredVars, file);
      const missing = results.filter(r => !r.found);
      const present = results.filter(r => r.found);

      let report = `Environment Validation Report:\n\n`;
      report += `✅ Present (${present.length}):\n`;
      present.forEach(r => {
        report += `  • ${r.name}: ${r.source}\n`;
      });

      if (missing.length > 0) {
        report += `\n❌ Missing (${missing.length}):\n`;
        missing.forEach(r => {
          report += `  • ${r.name}\n`;
        });
      }

      report += `\nOverall Status: ${missing.length === 0 ? '✅ All required variables present' : `⚠️  ${missing.length} variables missing`}`;

      if (strict && missing.length > 0) {
        throw new Error(`Environment validation failed: ${missing.length} required variables missing`);
      }

      return report;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[ENV_VALIDATE] Failed:", error);
      throw new Error(`Environment validation failed: ${errorMessage}`);
    }
  }

  private async validateEnvironmentVariables(
    requiredVars: string[], 
    file: string
  ): Promise<Array<{name: string; found: boolean; source?: string}>> {
    const results = [];
    
    // Read .env file
    const envFileVars = await this.readEnvFile(file);
    
    for (const varName of requiredVars) {
      let found = false;
      let source = "";
      
      // Check system environment first
      if (process.env[varName]) {
        found = true;
        source = "system environment";
      } else if (envFileVars[varName]) {
        found = true;
        source = `${file} file`;
      }
      
      results.push({ name: varName, found, source });
    }
    
    return results;
  }

  private async readEnvFile(file: string): Promise<Record<string, string>> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const filePath = path.resolve(workspacePath, file);
      
      const content = await fs.readFile(filePath, "utf-8");
      const envVars: Record<string, string> = {};
      
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const match = trimmed.match(/^([^=]+)=(.*)$/);
          if (match) {
            const [, key, value] = match;
            envVars[key.trim()] = value.trim();
          }
        }
      }
      
      return envVars;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }
}

// Process Environment Tool
export class ProcessEnvironmentTool extends BaseTool {
  name = "process_env";
  description = "Get information about the current process environment and runtime";
  
  schema = z.object({
    info: z.enum(["node", "platform", "memory", "versions", "paths", "all"]).describe("Type of environment information to retrieve"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { info } = params;
      
      logger.info(`[PROCESS_ENV] Getting ${info} information`);

      switch (info) {
        case "node":
          return this.getNodeInfo();
        case "platform":
          return this.getPlatformInfo();
        case "memory":
          return this.getMemoryInfo();
        case "versions":
          return this.getVersionInfo();
        case "paths":
          return this.getPathInfo();
        case "all":
          return this.getAllInfo();
        default:
          throw new Error(`Unsupported info type: ${info}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[PROCESS_ENV] Failed:", error);
      throw new Error(`Process environment query failed: ${errorMessage}`);
    }
  }

  private getNodeInfo(): string {
    return `Node.js Information:
• Version: ${process.version}
• Architecture: ${process.arch}
• Platform: ${process.platform}
• Process ID: ${process.pid}
• Uptime: ${Math.floor(process.uptime())} seconds`;
  }

  private getPlatformInfo(): string {
    const os = require('os');
    return `Platform Information:
• Operating System: ${os.type()} ${os.release()}
• Architecture: ${os.arch()}
• CPU Count: ${os.cpus().length}
• Hostname: ${os.hostname()}
• User: ${os.userInfo().username}
• Home Directory: ${os.homedir()}`;
  }

  private getMemoryInfo(): string {
    const memUsage = process.memoryUsage();
    const os = require('os');
    
    return `Memory Information:
• Process RSS: ${Math.round(memUsage.rss / 1024 / 1024)} MB
• Process Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)} MB
• Process Heap Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)} MB
• Process External: ${Math.round(memUsage.external / 1024 / 1024)} MB
• System Total: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB
• System Free: ${Math.round(os.freemem() / 1024 / 1024 / 1024)} GB`;
  }

  private getVersionInfo(): string {
    return `Version Information:
${Object.entries(process.versions)
  .map(([key, value]) => `• ${key}: ${value}`)
  .join('\n')}`;
  }

  private getPathInfo(): string {
    return `Path Information:
• Current Working Directory: ${process.cwd()}
• Executable Path: ${process.execPath}
• Node Path: ${process.env.NODE_PATH || 'Not set'}
• PATH: ${process.env.PATH?.split(path.delimiter).slice(0, 10).join('\n  ')}${(process.env.PATH?.split(path.delimiter).length || 0) > 10 ? '\n  ...' : ''}`;
  }

  private getAllInfo(): string {
    return `Complete Environment Information:

${this.getNodeInfo()}

${this.getPlatformInfo()}

${this.getMemoryInfo()}

${this.getVersionInfo()}

${this.getPathInfo()}`;
  }
}