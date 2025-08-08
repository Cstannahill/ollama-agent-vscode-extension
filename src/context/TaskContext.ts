import { logger } from '../utils/logger';
import {
  ContextItem,
  ContextType,
  ContextSource,
  ContextPriority,
  TaskMetadata
} from './types';
import { ChromaContextDB } from './storage/ChromaContextDB';

/**
 * Manages task-specific context including current task progression,
 * failed attempts, solutions, and task-specific learned patterns
 */
export class TaskContext {
  private contextDB: ChromaContextDB;
  private activeTasks: Map<string, ActiveTask> = new Map();
  private initialized = false;

  constructor(contextDB: ChromaContextDB) {
    this.contextDB = contextDB;
  }

  /**
   * Initialize task context system
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('[TASK_CONTEXT] Already initialized');
      return;
    }

    try {
      logger.info('[TASK_CONTEXT] Initializing task context system...');
      
      // Load active tasks from storage
      await this.loadActiveTasks();
      
      this.initialized = true;
      logger.info('[TASK_CONTEXT] Task context system initialized');

    } catch (error) {
      logger.error('[TASK_CONTEXT] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Start a new task
   */
  public async startTask(taskId: string, description: string, sessionId?: string): Promise<void> {
    try {
      logger.debug(`[TASK_CONTEXT] Starting task: ${taskId}`);

      const task = new ActiveTask(taskId, description, sessionId);
      this.activeTasks.set(taskId, task);

      // Store initial task metadata
      await this.contextDB.storeTaskMetadata({
        taskId,
        description,
        startTime: new Date(),
        status: 'active',
        attempts: 0
      });

      // Add task start context
      await this.addTaskContext(taskId, {
        id: `task_start_${taskId}`,
        type: ContextType.TASK,
        source: ContextSource.USER_INPUT,
        content: `Task started: ${description}`,
        metadata: {
          action: 'task_start',
          description,
          sessionId
        },
        relevanceScore: 1.0,
        priority: ContextPriority.HIGH,
        timestamp: new Date(),
        tags: ['task_start', 'active'],
        taskId,
        sessionId
      });

    } catch (error) {
      logger.error('[TASK_CONTEXT] Failed to start task:', error);
      throw error;
    }
  }

  /**
   * Record a task attempt
   */
  public async recordAttempt(taskId: string, attempt: TaskAttempt): Promise<void> {
    try {
      const task = this.activeTasks.get(taskId);
      if (!task) {
        logger.warn(`[TASK_CONTEXT] Task not found: ${taskId}`);
        return;
      }

      logger.debug(`[TASK_CONTEXT] Recording attempt for task ${taskId}: ${attempt.success ? 'success' : 'failure'}`);

      task.addAttempt(attempt);

      // Store attempt as context
      const contextItem: ContextItem = {
        id: `attempt_${taskId}_${attempt.id}`,
        type: ContextType.TASK,
        source: attempt.success ? ContextSource.SUCCESS_PATTERN : ContextSource.ERROR_RECOVERY,
        content: attempt.description,
        metadata: {
          action: 'task_attempt',
          success: attempt.success,
          error: attempt.error,
          solution: attempt.solution,
          tools: attempt.toolsUsed,
          duration: attempt.duration,
          attemptNumber: task.getAttemptCount()
        },
        relevanceScore: attempt.success ? 0.9 : 0.7,
        priority: attempt.success ? ContextPriority.HIGH : ContextPriority.MEDIUM,
        timestamp: attempt.timestamp,
        tags: this.generateAttemptTags(attempt),
        taskId,
        sessionId: task.sessionId
      };

      await this.contextDB.store(contextItem);

      // Update task metadata
      await this.updateTaskMetadata(task);

      // Check for patterns in failed attempts
      if (!attempt.success) {
        await this.analyzeFailurePatterns(task);
      }

    } catch (error) {
      logger.error('[TASK_CONTEXT] Failed to record attempt:', error);
      throw error;
    }
  }

  /**
   * Complete a task
   */
  public async completeTask(taskId: string, finalSolution?: string): Promise<void> {
    try {
      const task = this.activeTasks.get(taskId);
      if (!task) {
        logger.warn(`[TASK_CONTEXT] Task not found: ${taskId}`);
        return;
      }

      logger.debug(`[TASK_CONTEXT] Completing task: ${taskId}`);

      task.complete(finalSolution);

      // Store completion context
      await this.addTaskContext(taskId, {
        id: `task_complete_${taskId}`,
        type: ContextType.TASK,
        source: ContextSource.SUCCESS_PATTERN,
        content: `Task completed: ${task.description}${finalSolution ? `\n\nSolution: ${finalSolution}` : ''}`,
        metadata: {
          action: 'task_complete',
          attempts: task.getAttemptCount(),
          duration: task.getDuration(),
          solution: finalSolution,
          successPattern: this.extractSuccessPattern(task)
        },
        relevanceScore: 1.0,
        priority: ContextPriority.CRITICAL,
        timestamp: new Date(),
        tags: ['task_complete', 'success', 'pattern'],
        taskId,
        sessionId: task.sessionId
      });

      // Update task metadata
      await this.updateTaskMetadata(task);

      // Extract learning patterns
      await this.extractLearningPatterns(task);

      // Remove from active tasks
      this.activeTasks.delete(taskId);

    } catch (error) {
      logger.error('[TASK_CONTEXT] Failed to complete task:', error);
      throw error;
    }
  }

  /**
   * Abandon a task
   */
  public async abandonTask(taskId: string, reason?: string): Promise<void> {
    try {
      const task = this.activeTasks.get(taskId);
      if (!task) {
        logger.warn(`[TASK_CONTEXT] Task not found: ${taskId}`);
        return;
      }

      logger.debug(`[TASK_CONTEXT] Abandoning task: ${taskId}`);

      task.abandon(reason);

      // Store abandonment context
      await this.addTaskContext(taskId, {
        id: `task_abandon_${taskId}`,
        type: ContextType.TASK,
        source: ContextSource.ERROR_RECOVERY,
        content: `Task abandoned: ${task.description}${reason ? `\n\nReason: ${reason}` : ''}`,
        metadata: {
          action: 'task_abandon',
          attempts: task.getAttemptCount(),
          reason,
          failurePatterns: this.extractFailurePatterns(task)
        },
        relevanceScore: 0.5,
        priority: ContextPriority.MEDIUM,
        timestamp: new Date(),
        tags: ['task_abandon', 'failure'],
        taskId,
        sessionId: task.sessionId
      });

      // Update task metadata
      await this.updateTaskMetadata(task);

      // Remove from active tasks
      this.activeTasks.delete(taskId);

    } catch (error) {
      logger.error('[TASK_CONTEXT] Failed to abandon task:', error);
      throw error;
    }
  }

  /**
   * Get task context for a specific task
   */
  public async getTaskContext(taskId: string): Promise<ContextItem[]> {
    try {
      logger.debug(`[TASK_CONTEXT] Getting context for task: ${taskId}`);

      return await this.contextDB.search({
        query: '',
        types: [ContextType.TASK],
        taskId,
        maxResults: 50
      });

    } catch (error) {
      logger.error('[TASK_CONTEXT] Failed to get task context:', error);
      return [];
    }
  }

  /**
   * Get similar failed attempts for learning
   */
  public async getSimilarFailures(taskDescription: string, error: string): Promise<ContextItem[]> {
    try {
      logger.debug(`[TASK_CONTEXT] Getting similar failures for: ${taskDescription}`);

      // Search for similar error patterns
      const errorResults = await this.contextDB.search({
        query: error,
        types: [ContextType.TASK],
        sources: [ContextSource.ERROR_RECOVERY],
        maxResults: 10
      });

      // Search for similar task descriptions
      const taskResults = await this.contextDB.search({
        query: taskDescription,
        types: [ContextType.TASK],
        sources: [ContextSource.ERROR_RECOVERY],
        maxResults: 10
      });

      // Combine and deduplicate
      const allResults = [...errorResults, ...taskResults];
      const uniqueResults = allResults.filter((item, index, array) =>
        array.findIndex(i => i.id === item.id) === index
      );

      return uniqueResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

    } catch (error) {
      logger.error('[TASK_CONTEXT] Failed to get similar failures:', error);
      return [];
    }
  }

  /**
   * Get successful patterns for similar tasks
   */
  public async getSuccessPatterns(taskDescription: string): Promise<ContextItem[]> {
    try {
      logger.debug(`[TASK_CONTEXT] Getting success patterns for: ${taskDescription}`);

      return await this.contextDB.search({
        query: taskDescription,
        types: [ContextType.TASK],
        sources: [ContextSource.SUCCESS_PATTERN],
        maxResults: 10
      });

    } catch (error) {
      logger.error('[TASK_CONTEXT] Failed to get success patterns:', error);
      return [];
    }
  }

  /**
   * Add context item to task context
   */
  public async addContext(item: ContextItem): Promise<void> {
    try {
      logger.debug(`[TASK_CONTEXT] Adding context item: ${item.id}`);
      await this.contextDB.store(item);
    } catch (error) {
      logger.error('[TASK_CONTEXT] Failed to add context:', error);
      throw error;
    }
  }

  /**
   * Get task context statistics
   */
  public async getStats(): Promise<any> {
    try {
      const activeTasks = this.activeTasks.size;
      const totalAttempts = Array.from(this.activeTasks.values())
        .reduce((sum, task) => sum + task.getAttemptCount(), 0);

      return {
        activeTasks,
        totalAttempts,
        averageAttemptsPerTask: activeTasks > 0 ? totalAttempts / activeTasks : 0,
        initialized: this.initialized
      };
    } catch (error) {
      logger.error('[TASK_CONTEXT] Failed to get stats:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async loadActiveTasks(): Promise<void> {
    // Implementation would load incomplete tasks from database
    logger.debug('[TASK_CONTEXT] Loading active tasks (starting fresh)');
  }

  private async addTaskContext(taskId: string, item: ContextItem): Promise<void> {
    await this.contextDB.store(item);
  }

  private async updateTaskMetadata(task: ActiveTask): Promise<void> {
    try {
      await this.contextDB.storeTaskMetadata({
        taskId: task.taskId,
        description: task.description,
        startTime: task.startTime,
        endTime: task.endTime,
        status: task.status,
        attempts: task.getAttemptCount(),
        lastError: task.getLastError(),
        successPattern: task.getSuccessPattern()
      });
    } catch (error) {
      logger.error('[TASK_CONTEXT] Failed to update task metadata:', error);
    }
  }

  private async analyzeFailurePatterns(task: ActiveTask): Promise<void> {
    const attempts = task.getAttempts();
    const failures = attempts.filter(a => !a.success);
    
    if (failures.length >= 2) {
      // Look for common patterns in failures
      const commonErrors = this.findCommonErrors(failures);
      const commonTools = this.findCommonToolUsage(failures);
      
      if (commonErrors.length > 0 || commonTools.length > 0) {
        logger.debug(`[TASK_CONTEXT] Detected failure patterns in task ${task.taskId}`);
        
        await this.addTaskContext(task.taskId, {
          id: `failure_pattern_${task.taskId}_${Date.now()}`,
          type: ContextType.TASK,
          source: ContextSource.ERROR_RECOVERY,
          content: `Failure pattern detected: ${commonErrors.join(', ')}`,
          metadata: {
            action: 'failure_pattern',
            commonErrors,
            commonTools,
            failureCount: failures.length
          },
          relevanceScore: 0.8,
          priority: ContextPriority.HIGH,
          timestamp: new Date(),
          tags: ['failure_pattern', 'warning'],
          taskId: task.taskId,
          sessionId: task.sessionId
        });
      }
    }
  }

  private extractSuccessPattern(task: ActiveTask): string | undefined {
    const successfulAttempts = task.getAttempts().filter(a => a.success);
    if (successfulAttempts.length === 0) return undefined;
    
    const lastSuccess = successfulAttempts[successfulAttempts.length - 1];
    return `Tools: ${lastSuccess.toolsUsed?.join(', ')}. Solution: ${lastSuccess.solution}`;
  }

  private extractFailurePatterns(task: ActiveTask): string[] {
    const failures = task.getAttempts().filter(a => !a.success);
    return this.findCommonErrors(failures);
  }

  private async extractLearningPatterns(task: ActiveTask): Promise<void> {
    const attempts = task.getAttempts();
    if (attempts.length === 0) return;
    
    const successfulAttempts = attempts.filter(a => a.success);
    const failedAttempts = attempts.filter(a => !a.success);
    
    // Extract successful patterns
    for (const attempt of successfulAttempts) {
      if (attempt.solution) {
        await this.contextDB.storeLearningPattern({
          id: `success_pattern_${task.taskId}_${attempt.id}`,
          pattern: attempt.solution,
          context: task.description,
          category: 'success',
          frequency: 1,
          lastSeen: new Date(),
          projects: [],
          tags: ['success', 'task'],
          confidence: 0.8
        });
      }
    }
    
    // Extract failure patterns to avoid
    const commonErrors = this.findCommonErrors(failedAttempts);
    for (const error of commonErrors) {
      await this.contextDB.storeLearningPattern({
        id: `failure_pattern_${task.taskId}_${Date.now()}`,
        pattern: error,
        context: task.description,
        category: 'failure',
        frequency: failedAttempts.filter(a => a.error?.includes(error)).length,
        lastSeen: new Date(),
        projects: [],
        tags: ['failure', 'error', 'task'],
        confidence: 0.9
      });
    }
  }

  private findCommonErrors(attempts: TaskAttempt[]): string[] {
    const errorCounts = new Map<string, number>();
    
    attempts.forEach(attempt => {
      if (attempt.error) {
        // Extract key error phrases
        const errorKeywords = attempt.error.toLowerCase()
          .split(/\s+/)
          .filter(word => word.length > 3);
        
        errorKeywords.forEach(keyword => {
          errorCounts.set(keyword, (errorCounts.get(keyword) || 0) + 1);
        });
      }
    });
    
    // Return errors that appear in multiple attempts
    return Array.from(errorCounts.entries())
      .filter(([_, count]) => count > 1)
      .map(([error, _]) => error);
  }

  private findCommonToolUsage(attempts: TaskAttempt[]): string[] {
    const toolCounts = new Map<string, number>();
    
    attempts.forEach(attempt => {
      attempt.toolsUsed?.forEach(tool => {
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
      });
    });
    
    // Return tools used in multiple failed attempts
    return Array.from(toolCounts.entries())
      .filter(([_, count]) => count > 1)
      .map(([tool, _]) => tool);
  }

  private generateAttemptTags(attempt: TaskAttempt): string[] {
    const tags = ['attempt'];
    
    if (attempt.success) {
      tags.push('success');
    } else {
      tags.push('failure');
    }
    
    if (attempt.toolsUsed) {
      tags.push(...attempt.toolsUsed.map(tool => `tool:${tool}`));
    }
    
    if (attempt.error) {
      tags.push('error');
    }
    
    return tags;
  }
}

/**
 * Represents an active task being tracked
 */
class ActiveTask {
  public taskId: string;
  public description: string;
  public sessionId?: string;
  public startTime: Date = new Date();
  public endTime?: Date;
  public status: 'active' | 'completed' | 'failed' | 'abandoned' = 'active';
  private attempts: TaskAttempt[] = [];

  constructor(taskId: string, description: string, sessionId?: string) {
    this.taskId = taskId;
    this.description = description;
    this.sessionId = sessionId;
  }

  public addAttempt(attempt: TaskAttempt): void {
    this.attempts.push(attempt);
  }

  public complete(solution?: string): void {
    this.status = 'completed';
    this.endTime = new Date();
    
    if (solution && this.attempts.length > 0) {
      const lastAttempt = this.attempts[this.attempts.length - 1];
      lastAttempt.solution = solution;
      lastAttempt.success = true;
    }
  }

  public abandon(reason?: string): void {
    this.status = 'abandoned';
    this.endTime = new Date();
  }

  public getAttemptCount(): number {
    return this.attempts.length;
  }

  public getAttempts(): TaskAttempt[] {
    return [...this.attempts];
  }

  public getDuration(): number {
    const endTime = this.endTime || new Date();
    return endTime.getTime() - this.startTime.getTime();
  }

  public getLastError(): string | undefined {
    const failedAttempts = this.attempts.filter(a => !a.success && a.error);
    return failedAttempts.length > 0 ? failedAttempts[failedAttempts.length - 1].error : undefined;
  }

  public getSuccessPattern(): string | undefined {
    const successfulAttempts = this.attempts.filter(a => a.success && a.solution);
    return successfulAttempts.length > 0 ? successfulAttempts[successfulAttempts.length - 1].solution : undefined;
  }
}

/**
 * Represents a single task attempt
 */
interface TaskAttempt {
  id: string;
  description: string;
  success: boolean;
  error?: string;
  solution?: string;
  toolsUsed?: string[];
  duration: number;
  timestamp: Date;
}