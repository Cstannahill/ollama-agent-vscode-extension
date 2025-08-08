/**
 * Tool Usage Tracking System
 * Tracks tool usage frequency and provides analytics
 */

export interface ToolUsageStats {
  toolName: string;
  usageCount: number;
  lastUsed: Date;
  successCount: number;
  errorCount: number;
  averageExecutionTime: number;
  totalExecutionTime: number;
}

export interface ToolUsageSession {
  toolName: string;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  error?: string;
  executionTime?: number;
}

/**
 * Tracks tool usage patterns and provides analytics
 */
export class ToolUsageTracker {
  private static instance: ToolUsageTracker;
  private usageStats: Map<string, ToolUsageStats> = new Map();
  private activeSessions: Map<string, ToolUsageSession> = new Map();
  private sessionHistory: ToolUsageSession[] = [];
  private maxHistorySize = 1000;

  private constructor() {
    // Load usage stats from storage if available
    this.loadUsageStats();
  }

  public static getInstance(): ToolUsageTracker {
    if (!ToolUsageTracker.instance) {
      ToolUsageTracker.instance = new ToolUsageTracker();
    }
    return ToolUsageTracker.instance;
  }

  /**
   * Start tracking a tool usage session
   */
  public startToolUsage(toolName: string, sessionId: string): void {
    const session: ToolUsageSession = {
      toolName,
      startTime: new Date(),
      success: false
    };

    this.activeSessions.set(sessionId, session);
  }

  /**
   * End a tool usage session
   */
  public endToolUsage(sessionId: string, success: boolean, error?: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return;
    }

    const endTime = new Date();
    session.endTime = endTime;
    session.success = success;
    session.error = error;
    session.executionTime = endTime.getTime() - session.startTime.getTime();

    // Update usage stats
    this.updateUsageStats(session);

    // Add to session history
    this.addToSessionHistory(session);

    // Remove from active sessions
    this.activeSessions.delete(sessionId);

    // Save updated stats
    this.saveUsageStats();
  }

  /**
   * Update usage statistics for a tool
   */
  private updateUsageStats(session: ToolUsageSession): void {
    let stats = this.usageStats.get(session.toolName);
    
    if (!stats) {
      stats = {
        toolName: session.toolName,
        usageCount: 0,
        lastUsed: session.startTime,
        successCount: 0,
        errorCount: 0,
        averageExecutionTime: 0,
        totalExecutionTime: 0
      };
      this.usageStats.set(session.toolName, stats);
    }

    // Update statistics
    stats.usageCount++;
    stats.lastUsed = session.endTime || session.startTime;
    
    if (session.success) {
      stats.successCount++;
    } else {
      stats.errorCount++;
    }

    if (session.executionTime) {
      stats.totalExecutionTime += session.executionTime;
      stats.averageExecutionTime = stats.totalExecutionTime / stats.usageCount;
    }
  }

  /**
   * Add session to history (with size limit)
   */
  private addToSessionHistory(session: ToolUsageSession): void {
    this.sessionHistory.push(session);
    
    // Maintain history size limit
    if (this.sessionHistory.length > this.maxHistorySize) {
      this.sessionHistory = this.sessionHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get usage statistics for a specific tool
   */
  public getToolStats(toolName: string): ToolUsageStats | undefined {
    return this.usageStats.get(toolName);
  }

  /**
   * Get all tool usage statistics
   */
  public getAllToolStats(): ToolUsageStats[] {
    return Array.from(this.usageStats.values());
  }

  /**
   * Get most frequently used tools
   */
  public getMostUsedTools(limit: number = 10): ToolUsageStats[] {
    return Array.from(this.usageStats.values())
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  /**
   * Get recently used tools
   */
  public getRecentlyUsedTools(limit: number = 10): ToolUsageStats[] {
    return Array.from(this.usageStats.values())
      .sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime())
      .slice(0, limit);
  }

  /**
   * Get tools with highest success rate
   */
  public getMostReliableTools(limit: number = 10): ToolUsageStats[] {
    return Array.from(this.usageStats.values())
      .filter(stats => stats.usageCount >= 3) // Only consider tools used at least 3 times
      .sort((a, b) => {
        const aSuccessRate = a.successCount / a.usageCount;
        const bSuccessRate = b.successCount / b.usageCount;
        return bSuccessRate - aSuccessRate;
      })
      .slice(0, limit);
  }

  /**
   * Get tools with performance issues (high error rate or slow execution)
   */
  public getProblematicTools(): ToolUsageStats[] {
    return Array.from(this.usageStats.values())
      .filter(stats => {
        const errorRate = stats.errorCount / stats.usageCount;
        const avgTimeInSeconds = stats.averageExecutionTime / 1000;
        return stats.usageCount >= 3 && (errorRate > 0.2 || avgTimeInSeconds > 10);
      })
      .sort((a, b) => {
        const aErrorRate = a.errorCount / a.usageCount;
        const bErrorRate = b.errorCount / b.usageCount;
        return bErrorRate - aErrorRate;
      });
  }

  /**
   * Get usage analytics summary
   */
  public getUsageAnalytics(): {
    totalToolsUsed: number;
    totalExecutions: number;
    totalSuccessfulExecutions: number;
    totalFailedExecutions: number;
    overallSuccessRate: number;
    averageExecutionTime: number;
    mostUsedTool: string | null;
    leastUsedTool: string | null;
  } {
    const stats = Array.from(this.usageStats.values());
    const totalExecutions = stats.reduce((sum, stat) => sum + stat.usageCount, 0);
    const totalSuccessful = stats.reduce((sum, stat) => sum + stat.successCount, 0);
    const totalFailed = stats.reduce((sum, stat) => sum + stat.errorCount, 0);
    const totalTime = stats.reduce((sum, stat) => sum + stat.totalExecutionTime, 0);

    const sortedByUsage = stats.sort((a, b) => b.usageCount - a.usageCount);

    return {
      totalToolsUsed: stats.length,
      totalExecutions,
      totalSuccessfulExecutions: totalSuccessful,
      totalFailedExecutions: totalFailed,
      overallSuccessRate: totalExecutions > 0 ? totalSuccessful / totalExecutions : 0,
      averageExecutionTime: totalExecutions > 0 ? totalTime / totalExecutions : 0,
      mostUsedTool: sortedByUsage.length > 0 ? sortedByUsage[0].toolName : null,
      leastUsedTool: sortedByUsage.length > 0 ? sortedByUsage[sortedByUsage.length - 1].toolName : null
    };
  }

  /**
   * Get recent tool usage sessions
   */
  public getRecentSessions(limit: number = 20): ToolUsageSession[] {
    return this.sessionHistory
      .slice(-limit)
      .reverse();
  }

  /**
   * Clear all usage statistics
   */
  public clearStats(): void {
    this.usageStats.clear();
    this.sessionHistory = [];
    this.saveUsageStats();
  }

  /**
   * Load usage stats from storage (placeholder for future implementation)
   */
  private loadUsageStats(): void {
    // TODO: Implement loading from VS Code global state or file system
    // For now, start with empty stats
  }

  /**
   * Save usage stats to storage (placeholder for future implementation)  
   */
  private saveUsageStats(): void {
    // TODO: Implement saving to VS Code global state or file system
    // For now, stats are only kept in memory
  }

  /**
   * Export usage statistics as JSON
   */
  public exportStats(): string {
    const data = {
      usageStats: Array.from(this.usageStats.entries()),
      sessionHistory: this.sessionHistory.slice(-100), // Export last 100 sessions
      analytics: this.getUsageAnalytics(),
      exportedAt: new Date().toISOString()
    };
    
    return JSON.stringify(data, null, 2);
  }

  /**
   * Import usage statistics from JSON
   */
  public importStats(jsonData: string): boolean {
    try {
      const data = JSON.parse(jsonData);
      
      if (data.usageStats && Array.isArray(data.usageStats)) {
        this.usageStats = new Map(data.usageStats);
      }
      
      if (data.sessionHistory && Array.isArray(data.sessionHistory)) {
        this.sessionHistory = data.sessionHistory.map((session: any) => ({
          ...session,
          startTime: new Date(session.startTime),
          endTime: session.endTime ? new Date(session.endTime) : undefined
        }));
      }
      
      this.saveUsageStats();
      return true;
    } catch (error) {
      console.error('Failed to import tool usage stats:', error);
      return false;
    }
  }
}