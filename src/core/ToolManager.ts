import { BaseTool } from "./BaseTool";
import { FileReadTool, FileListTool } from "../tools/FileReadTool";
import {
  FileWriteTool,
  FileAppendTool,
  DirectoryCreateTool,
} from "../tools/FileWriteTool";
import {
  RunShellTool,
  VSCodeCommandTool,
  OpenFileTool,
} from "../tools/RunShellTool";
import {
  GitStatusTool,
  GitAddTool,
  GitCommitTool,
  GitBranchTool,
  GitLogTool,
  GitDiffTool,
  GitStashTool,
  GitRemoteTool,
} from "../tools/GitTool";
import {
  TestRunnerTool,
  TestGeneratorTool,
  TestCoverageTool,
} from "../tools/TestingTool";
import {
  EslintTool,
  PrettierTool,
  TypeScriptAnalyzerTool,
  ComplexityAnalyzerTool,
  SecurityAnalyzerTool,
} from "../tools/CodeAnalysisTool";
import {
  PackageInstallTool,
  PackageUpdateTool,
  PackageAuditTool,
  DependencyAnalyzerTool,
} from "../tools/PackageManagerTool";
import {
  HttpRequestTool,
  ApiTestTool,
  HealthCheckTool,
  PortScanTool,
} from "../tools/NetworkTool";
import {
  EnvironmentVariableTool,
  EnvironmentValidatorTool,
  ProcessEnvironmentTool,
} from "../tools/EnvironmentTool";
import {
  ComponentGeneratorTool,
  ProjectScaffoldTool,
} from "../tools/TemplateGeneratorTool";
import {
  DockerContainerTool,
  DockerImageTool,
  DockerComposeTool,
} from "../tools/DockerTool";
import {
  NodeProfilerTool,
  BundleAnalyzerTool,
  LighthousePerformanceTool,
} from "../tools/PerformanceTool";
import {
  DocSearchTool,
  DocUpdateTool,
  DocIndexTool,
  DocSummaryTool,
} from "../tools/DocumentationTool";
import {
  TechStackAnalyzerTool,
} from "../tools/TechStackTool";
import {
  KnowledgeQueryTool,
  KnowledgeAddTool,
  KnowledgeUpdateTool,
  KnowledgeListTool,
  KnowledgeDeleteTool,
  KnowledgeImportTool,
} from "../tools/KnowledgeBaseTool";
import {
  BreakpointManagerTool,
  StackTraceAnalyzerTool,
  DebugSessionTool,
} from "../tools/DebuggingTool";
import { logger } from "../utils/logger";

/**
 * Central manager for all tools available to the agent
 */
export class ToolManager {
  private tools: Map<string, BaseTool> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  /**
   * Register default tools that come with the extension
   */
  private registerDefaultTools(): void {
    // File operations
    this.registerTool(new FileReadTool());
    this.registerTool(new FileListTool());
    this.registerTool(new FileWriteTool());
    this.registerTool(new FileAppendTool());
    this.registerTool(new DirectoryCreateTool());

    // Shell and VS Code operations
    this.registerTool(new RunShellTool());
    this.registerTool(new VSCodeCommandTool());
    this.registerTool(new OpenFileTool());

    // Git operations
    this.registerTool(new GitStatusTool());
    this.registerTool(new GitAddTool());
    this.registerTool(new GitCommitTool());
    this.registerTool(new GitBranchTool());
    this.registerTool(new GitLogTool());
    this.registerTool(new GitDiffTool());
    this.registerTool(new GitStashTool());
    this.registerTool(new GitRemoteTool());

    // Testing operations
    this.registerTool(new TestRunnerTool());
    this.registerTool(new TestGeneratorTool());
    this.registerTool(new TestCoverageTool());

    // Code analysis and linting tools
    this.registerTool(new EslintTool());
    this.registerTool(new PrettierTool());
    this.registerTool(new TypeScriptAnalyzerTool());
    this.registerTool(new ComplexityAnalyzerTool());
    this.registerTool(new SecurityAnalyzerTool());

    // Package management tools
    this.registerTool(new PackageInstallTool());
    this.registerTool(new PackageUpdateTool());
    this.registerTool(new PackageAuditTool());
    this.registerTool(new DependencyAnalyzerTool());

    // Network and HTTP tools
    this.registerTool(new HttpRequestTool());
    this.registerTool(new ApiTestTool());
    this.registerTool(new HealthCheckTool());
    this.registerTool(new PortScanTool());

    // Environment management tools
    this.registerTool(new EnvironmentVariableTool());
    this.registerTool(new EnvironmentValidatorTool());
    this.registerTool(new ProcessEnvironmentTool());

    // Code generation and scaffolding tools
    this.registerTool(new ComponentGeneratorTool());
    this.registerTool(new ProjectScaffoldTool());

    // Docker and containerization tools
    this.registerTool(new DockerContainerTool());
    this.registerTool(new DockerImageTool());
    this.registerTool(new DockerComposeTool());

    // Performance analysis tools
    this.registerTool(new NodeProfilerTool());
    this.registerTool(new BundleAnalyzerTool());
    this.registerTool(new LighthousePerformanceTool());

    // Documentation and knowledge management tools
    this.registerTool(new DocSearchTool());
    this.registerTool(new DocUpdateTool());
    this.registerTool(new DocIndexTool());
    this.registerTool(new DocSummaryTool());

    // Technology stack analysis tools
    this.registerTool(new TechStackAnalyzerTool());

    // Knowledge base management tools
    this.registerTool(new KnowledgeQueryTool());
    this.registerTool(new KnowledgeAddTool());
    this.registerTool(new KnowledgeUpdateTool());
    this.registerTool(new KnowledgeListTool());
    this.registerTool(new KnowledgeDeleteTool());
    this.registerTool(new KnowledgeImportTool());

    // Debugging and development tools
    this.registerTool(new BreakpointManagerTool());
    this.registerTool(new StackTraceAnalyzerTool());
    this.registerTool(new DebugSessionTool());

    logger.info(`Registered ${this.tools.size} default tools`);
  }

  /**
   * Register a new tool
   */
  registerTool(tool: BaseTool): void {
    if (this.tools.has(tool.name)) {
      logger.warn(`Tool ${tool.name} is already registered, overwriting`);
    }

    this.tools.set(tool.name, tool);
    logger.debug(`Registered tool: ${tool.name}`);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(toolName: string): boolean {
    const removed = this.tools.delete(toolName);
    if (removed) {
      logger.debug(`Unregistered tool: ${toolName}`);
    }
    return removed;
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get tool descriptions for prompting
   */
  getToolDescriptions(): Array<{
    name: string;
    description: string;
    schema: any;
  }> {
    return this.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
    }));
  }

  /**
   * Execute a tool by name with given arguments
   */
  async executeTool(toolName: string, args: any): Promise<string> {
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    try {
      logger.debug(`Executing tool: ${toolName} with args:`, args);
      const result = await tool.execute(args);
      logger.debug(`Tool ${toolName} completed successfully`);
      return result;
    } catch (error) {
      const errorMessage = `Tool ${toolName} failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * Get tool schema for function calling
   */
  getToolSchema(toolName: string): any {
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    return tool.schema;
  }

  /**
   * Validate tool arguments against schema
   */
  validateToolArgs(toolName: string, args: any): boolean {
    const tool = this.getTool(toolName);
    if (!tool) {
      return false;
    }

    try {
      tool.schema.parse(args);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get formatted tool information for LLM prompts
   */
  getToolsForPrompt(): string {
    const tools = this.getAllTools();

    return tools
      .map((tool) => {
        const schemaString = JSON.stringify(tool.schema, null, 2);
        return `Tool: ${tool.name}
Description: ${tool.description}
Schema: ${schemaString}
---`;
      })
      .join("\n");
  }
}

// Singleton instance
let toolManagerInstance: ToolManager | null = null;

/**
 * Get the global tool manager instance
 */
export function getToolManager(): ToolManager {
  if (!toolManagerInstance) {
    toolManagerInstance = new ToolManager();
  }
  return toolManagerInstance;
}
