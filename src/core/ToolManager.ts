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
import { CacheManager, SmartCache } from "./cache/CacheManager";
import { PersistentCache } from "./cache/PersistentCache";

/**
 * Central manager for all tools available to the agent
 */
export class ToolManager {
  private tools: Map<string, BaseTool> = new Map();
  private cache: SmartCache<any>;
  private cacheManager: CacheManager;
  private persistentCache: PersistentCache;

  constructor() {
    this.cacheManager = CacheManager.getInstance();
    this.persistentCache = PersistentCache.getInstance();
    this.cache = this.cacheManager.getCache('tools', {
      maxSize: 200, // Increased capacity for more tools
      maxMemoryMB: 20, // More memory for tool descriptions (170KB+)
      defaultTTLMs: 3600000, // 1 hour (was 5 minutes causing churn)
      enableLRU: true,
      enableStats: true
    });
    
    this.registerDefaultTools();
    logger.info("[TOOL_MANAGER] Initialized with smart caching and persistence system");
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
    // Invalidate relevant caches when tools change
    this.cache.delete('tool_descriptions');
    this.cache.delete('tool_names');
    this.cache.delete('tool_count');
    logger.debug(`Registered tool: ${tool.name}`);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(toolName: string): boolean {
    const removed = this.tools.delete(toolName);
    if (removed) {
      // Invalidate relevant caches when tools change
      this.cache.delete('tool_descriptions');
      this.cache.delete('tool_names');
      this.cache.delete('tool_count');
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
   * Get tool names (cached)
   */
  getToolNames(): string[] {
    const cached = this.cache.get('tool_names');
    if (cached !== null) {
      return cached as string[];
    }

    const names = Array.from(this.tools.keys());
    logger.debug(`[TOOL_MANAGER] Generated tool names cache (${names.length} tools)`);
    this.cache.set('tool_names', names);
    return names;
  }

  /**
   * Get tool descriptions for prompting (smart cached)
   */
  getToolDescriptions(): Array<{
    name: string;
    description: string;
    schema: any;
  }> {
    const cached = this.cache.get('tool_descriptions');
    if (cached !== null) {
      return cached as Array<{ name: string; description: string; schema: any; }>;
    }

    const descriptions = this.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
    }));
    
    logger.debug(`[TOOL_MANAGER] Generated tool descriptions cache (${descriptions.length} tools)`);
    this.cache.set('tool_descriptions', descriptions);
    return descriptions;
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
   * Get formatted tool information for LLM prompts (lazy-loaded full set with persistence)
   */
  async getToolsForPromptAsync(): Promise<string> {
    const cacheKey = 'full_tools_for_prompt';
    
    // Use persistent cache to avoid regenerating 170KB+ prompt across sessions
    return await this.persistentCache.getOrCompute(
      cacheKey,
      () => {
        logger.info("[TOOL_MANAGER] Generating full tools prompt (170KB+) - expensive operation");
        return this.generateFullToolsPrompt();
      },
      14400000 // 4 hours persistent TTL
    );
  }

  /**
   * Synchronous version (lazy-loaded, cached in memory + persistent)
   */
  getToolsForPrompt(): string {
    const cached = this.cache.get('tools_for_prompt');
    if (cached !== null) {
      return cached as string;
    }

    logger.info("[TOOL_MANAGER] Lazy-loading full tools prompt (170KB+) - first use only");
    
    const prompt = this.generateFullToolsPrompt();
    
    // Cache both in memory and persistent storage
    this.cache.set('tools_for_prompt', prompt, 14400000);
    this.persistentCache.set('full_tools_for_prompt', prompt, 14400000);
    
    return prompt;
  }

  private generateFullToolsPrompt(): string {
    const tools = this.getAllTools();
    const prompt = tools
      .map((tool) => {
        const schemaString = JSON.stringify(tool.schema, null, 2);
        return `Tool: ${tool.name}
Description: ${tool.description}
Schema: ${schemaString}
---`;
      })
      .join("\n");
    
    const promptSize = Math.round(prompt.length / 1024);
    logger.info(`[TOOL_MANAGER] Generated full tools prompt (${tools.length} tools, ${promptSize}KB)`);
    return prompt;
  }

  /**
   * Get tool count (cached)
   */
  getToolCount(): number {
    const cached = this.cache.get('tool_count');
    if (cached !== null) {
      return cached as number;
    }

    const count = this.tools.size;
    logger.debug(`[TOOL_MANAGER] Generated tool count cache (${count} tools)`);
    this.cache.set('tool_count', count);
    return count;
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.clear();
    logger.info("[TOOL_MANAGER] Cleared all tool caches");
  }

  /**
   * Warm up caches with core tools only (avoid 170KB+ prompt generation)
   */
  warmupCache(): void {
    // Only precompute lightweight data on startup
    this.getToolNames();
    this.getToolCount();
    
    // Generate core tools prompt (not all 57 tools)
    this.getCoreToolsForPrompt();
    
    logger.info("[TOOL_MANAGER] Cache warmed up with core tools (lazy-loading extended tools)");
  }

  /**
   * Get core essential tools for immediate use (persistent cached)
   */
  async getCoreToolsForPromptAsync(): Promise<string> {
    const cacheKey = 'core_tools_for_prompt';
    
    // Try persistent cache first (survives VS Code restarts)
    return await this.persistentCache.getOrCompute(
      cacheKey,
      () => this.generateCoreToolsPrompt(),
      14400000 // 4 hours persistent TTL
    );
  }

  /**
   * Synchronous version for backward compatibility
   */
  getCoreToolsForPrompt(): string {
    const cached = this.cache.get('core_tools_for_prompt');
    if (cached !== null) {
      return cached as string;
    }

    const prompt = this.generateCoreToolsPrompt();
    
    // Cache both in memory and persistent storage
    this.cache.set('core_tools_for_prompt', prompt, 14400000);
    this.persistentCache.set('core_tools_for_prompt', prompt, 14400000);
    
    return prompt;
  }

  private generateCoreToolsPrompt(): string {
    // Core tools that should be immediately available
    const coreToolNames = [
      'file_read', 'file_write', 'file_list', 'file_append',
      'run_shell', 'vscode_command', 'open_file',
      'git_status', 'git_add', 'git_commit', 'git_diff',
      'test_runner', 'eslint', 'prettier',
      'package_install', 'http_request'
    ];

    const coreTools = coreToolNames
      .map(name => this.getTool(name))
      .filter(tool => tool !== undefined) as BaseTool[];

    const prompt = coreTools
      .map((tool) => {
        const schemaString = JSON.stringify(tool.schema, null, 2);
        return `Tool: ${tool.name}
Description: ${tool.description}
Schema: ${schemaString}
---`;
      })
      .join("\n");
    
    const promptSize = Math.round(prompt.length / 1024);
    logger.info(`[TOOL_MANAGER] Generated core tools prompt (${coreTools.length}/${this.tools.size} tools, ${promptSize}KB)`);
    return prompt;
  }

  /**
   * Get tools for prompt based on context (core vs full)
   */
  getToolsForPromptByContext(context: 'startup' | 'core' | 'full' = 'full'): string {
    switch (context) {
      case 'startup':
      case 'core':
        return this.getCoreToolsForPrompt();
      case 'full':
        return this.getToolsForPrompt();
      default:
        return this.getCoreToolsForPrompt();
    }
  }

  /**
   * Cleanup and destroy resources
   */
  destroy(): void {
    this.cache.destroy();
    logger.info("[TOOL_MANAGER] Destroyed tool manager and caches");
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
