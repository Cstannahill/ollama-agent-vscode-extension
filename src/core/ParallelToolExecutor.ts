import { ToolManager } from "./ToolManager";
import { AgentAction } from "./ChatSession";
import { logger } from "../utils/logger";

export interface ToolExecutionPlan {
  id: string;
  toolName: string;
  input: any;
  priority: number;
  dependencies: string[]; // IDs of tools that must complete first
  canRunInParallel: boolean;
}

export interface ToolExecutionResult {
  id: string;
  toolName: string;
  input: any;
  output?: string;
  error?: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  success: boolean;
}

export interface ParallelExecutionResult {
  results: ToolExecutionResult[];
  totalDuration: number;
  successCount: number;
  errorCount: number;
  parallelizationGain: number; // How much time was saved vs sequential
}

/**
 * Manages parallel execution of tools with dependency resolution
 */
export class ParallelToolExecutor {
  private toolManager: ToolManager;
  private maxConcurrency: number;
  private executionTimeout: number;

  constructor(
    toolManager: ToolManager,
    options: {
      maxConcurrency?: number;
      executionTimeout?: number;
    } = {}
  ) {
    this.toolManager = toolManager;
    this.maxConcurrency = options.maxConcurrency || 3; // Conservative default
    this.executionTimeout = options.executionTimeout || 30000; // 30 seconds
  }

  /**
   * Analyze action pattern to determine if tools can be executed in parallel
   */
  public analyzeParallelizationOpportunities(
    actions: { action: string; input: any }[]
  ): ToolExecutionPlan[] {
    const plans: ToolExecutionPlan[] = [];
    const fileReadOperations = new Set<string>();
    const fileWriteOperations = new Set<string>();

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const plan: ToolExecutionPlan = {
        id: `task_${i}`,
        toolName: action.action,
        input: action.input,
        priority: this.calculatePriority(action.action),
        dependencies: [],
        canRunInParallel: true,
      };

      // Analyze dependencies based on tool types and file operations
      if (this.isFileReadOperation(action.action)) {
        const filePath = this.extractFilePath(action.input);
        if (filePath) {
          fileReadOperations.add(filePath);
          // File reads depend on any previous writes to the same file
          const dependentWrites = plans.filter(
            (p) =>
              this.isFileWriteOperation(p.toolName) &&
              this.extractFilePath(p.input) === filePath
          );
          plan.dependencies = dependentWrites.map((p) => p.id);
        }
      } else if (this.isFileWriteOperation(action.action)) {
        const filePath = this.extractFilePath(action.input);
        if (filePath) {
          fileWriteOperations.add(filePath);
          // File writes depend on all previous operations on the same file
          const dependentOps = plans.filter((p) => {
            const pFilePath = this.extractFilePath(p.input);
            return pFilePath === filePath;
          });
          plan.dependencies = dependentOps.map((p) => p.id);
          
          // Multiple writes to same file cannot be parallel
          plan.canRunInParallel = !plans.some(
            (p) =>
              this.isFileWriteOperation(p.toolName) &&
              this.extractFilePath(p.input) === filePath
          );
        }
      } else if (this.isShellOperation(action.action)) {
        // Shell operations often have hidden dependencies
        plan.canRunInParallel = this.canShellRunInParallel(action.input);
        
        // Shell operations depend on any file operations that might affect their context
        const dependentFileOps = plans.filter((p) =>
          this.isFileOperation(p.toolName)
        );
        plan.dependencies = dependentFileOps.map((p) => p.id);
      }

      plans.push(plan);
    }

    return plans;
  }

  /**
   * Execute tools according to their execution plan with parallel optimization
   */
  public async executeParallel(
    plans: ToolExecutionPlan[]
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();
    const results: ToolExecutionResult[] = [];
    const completedTasks = new Set<string>();
    const runningTasks = new Map<string, Promise<ToolExecutionResult>>();

    logger.info(
      `[PARALLEL] Starting parallel execution of ${plans.length} tools (max concurrency: ${this.maxConcurrency})`
    );

    // Calculate sequential execution time for comparison
    const estimatedSequentialTime = plans.reduce(
      (total, plan) => total + this.estimateToolDuration(plan.toolName),
      0
    );

    try {
      while (completedTasks.size < plans.length) {
        // Find tasks that can run now (dependencies satisfied, not running)
        const readyTasks = plans.filter(
          (plan) =>
            !completedTasks.has(plan.id) &&
            !runningTasks.has(plan.id) &&
            plan.dependencies.every((dep) => completedTasks.has(dep)) &&
            runningTasks.size < this.maxConcurrency
        );

        // Prioritize parallel-safe tasks and sort by priority
        const parallelTasks = readyTasks
          .filter((task) => task.canRunInParallel)
          .sort((a, b) => b.priority - a.priority);

        const sequentialTasks = readyTasks
          .filter((task) => !task.canRunInParallel)
          .sort((a, b) => b.priority - a.priority);

        // Start parallel tasks first
        for (const task of parallelTasks) {
          if (runningTasks.size >= this.maxConcurrency) break;
          
          const executionPromise = this.executeToolWithTiming(task);
          runningTasks.set(task.id, executionPromise);
          
          logger.debug(
            `[PARALLEL] Started parallel task ${task.id}: ${task.toolName}`
          );
        }

        // Start sequential tasks if no parallel tasks or capacity allows
        if (parallelTasks.length === 0 || runningTasks.size === 0) {
          for (const task of sequentialTasks) {
            if (runningTasks.size >= 1) break; // Sequential tasks run one at a time
            
            const executionPromise = this.executeToolWithTiming(task);
            runningTasks.set(task.id, executionPromise);
            
            logger.debug(
              `[PARALLEL] Started sequential task ${task.id}: ${task.toolName}`
            );
          }
        }

        // Wait for at least one task to complete
        if (runningTasks.size > 0) {
          const completed = await Promise.race(runningTasks.values());
          results.push(completed);
          completedTasks.add(completed.id);
          runningTasks.delete(completed.id);

          if (completed.success) {
            logger.info(
              `[PARALLEL] Completed task ${completed.id}: ${completed.toolName} (${completed.duration}ms)`
            );
          } else {
            logger.error(
              `[PARALLEL] Failed task ${completed.id}: ${completed.toolName} - ${completed.error}`
            );
          }
        } else {
          // No tasks can run - might be a dependency cycle
          logger.error("[PARALLEL] No tasks can run - possible dependency cycle");
          break;
        }
      }

      const totalDuration = Date.now() - startTime;
      const successCount = results.filter((r) => r.success).length;
      const errorCount = results.filter((r) => !r.success).length;
      const parallelizationGain = Math.max(
        0,
        (estimatedSequentialTime - totalDuration) / estimatedSequentialTime
      );

      logger.info(
        `[PARALLEL] Execution completed - ${successCount} success, ${errorCount} errors, ${Math.round(
          parallelizationGain * 100
        )}% time saved`
      );

      return {
        results,
        totalDuration,
        successCount,
        errorCount,
        parallelizationGain,
      };
    } catch (error) {
      logger.error("[PARALLEL] Parallel execution failed:", error);
      throw error;
    }
  }

  /**
   * Execute a single tool with timing and error handling
   */
  private async executeToolWithTiming(
    plan: ToolExecutionPlan
  ): Promise<ToolExecutionResult> {
    const startTime = new Date();
    
    try {
      // Add timeout to tool execution
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tool execution timeout (${this.executionTimeout}ms)`)),
          this.executionTimeout
        )
      );

      const executionPromise = this.toolManager.executeTool(
        plan.toolName,
        plan.input
      );

      const output = await Promise.race([executionPromise, timeoutPromise]);
      const endTime = new Date();

      return {
        id: plan.id,
        toolName: plan.toolName,
        input: plan.input,
        output,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        success: true,
      };
    } catch (error) {
      const endTime = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        id: plan.id,
        toolName: plan.toolName,
        input: plan.input,
        error: errorMessage,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        success: false,
      };
    }
  }

  /**
   * Calculate priority for tool execution order
   */
  private calculatePriority(toolName: string): number {
    const priorities: { [key: string]: number } = {
      // File operations - higher priority
      file_read: 90,
      file_list: 85,
      file_write: 80,
      file_append: 75,
      directory_create: 70,
      
      // VS Code operations - medium priority
      vscode_command: 60,
      open_file: 55,
      
      // Shell operations - lower priority (potentially destructive)
      run_shell: 40,
    };

    return priorities[toolName] || 50;
  }

  /**
   * Estimate tool execution duration for planning
   */
  private estimateToolDuration(toolName: string): number {
    const estimates: { [key: string]: number } = {
      file_read: 500,
      file_write: 800,
      file_append: 600,
      file_list: 300,
      directory_create: 200,
      vscode_command: 400,
      open_file: 300,
      run_shell: 2000, // More variable, conservative estimate
    };

    return estimates[toolName] || 1000;
  }

  private isFileOperation(toolName: string): boolean {
    return ['file_read', 'file_write', 'file_append', 'file_list', 'directory_create'].includes(toolName);
  }

  private isFileReadOperation(toolName: string): boolean {
    return ['file_read', 'file_list'].includes(toolName);
  }

  private isFileWriteOperation(toolName: string): boolean {
    return ['file_write', 'file_append', 'directory_create'].includes(toolName);
  }

  private isShellOperation(toolName: string): boolean {
    return toolName === 'run_shell';
  }

  private extractFilePath(input: any): string | null {
    if (!input || typeof input !== 'object') return null;
    
    // Common file path parameter names
    const pathKeys = ['filePath', 'file_path', 'path', 'dirPath', 'dir_path'];
    
    for (const key of pathKeys) {
      if (input[key] && typeof input[key] === 'string') {
        return input[key];
      }
    }
    
    return null;
  }

  private canShellRunInParallel(input: any): boolean {
    if (!input?.command) return false;
    
    const command = input.command.toLowerCase();
    
    // Commands that are generally safe to run in parallel
    const safeCommands = [
      'ls', 'cat', 'head', 'tail', 'grep', 'find', 'which', 'echo',
      'pwd', 'date', 'whoami', 'ps', 'top', 'df', 'du', 'wc'
    ];
    
    // Commands that should not run in parallel
    const unsafeCommands = [
      'rm', 'mv', 'cp', 'mkdir', 'rmdir', 'chmod', 'chown',
      'npm install', 'npm run', 'git', 'make', 'cargo', 'go build'
    ];
    
    // Check if command starts with any unsafe command
    if (unsafeCommands.some(unsafe => command.startsWith(unsafe))) {
      return false;
    }
    
    // Check if command starts with any safe command
    if (safeCommands.some(safe => command.startsWith(safe))) {
      return true;
    }
    
    // Default to sequential for unknown commands
    return false;
  }
}