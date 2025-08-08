/**
 * Performance Monitoring System for Foundation Agents
 * 
 * Tracks initialization times, cache performance, and optimization opportunities
 */

import { logger } from '../../../utils/logger';
import { FoundationAgents } from '../FoundationAgentFactory';

export interface InitializationMetrics {
  agentType: keyof FoundationAgents;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string;
  cacheHit: boolean;
  memoryUsage?: number;
}

export interface PerformanceSnapshot {
  timestamp: number;
  totalInitTime: number;
  averageInitTime: number;
  cacheHitRate: number;
  failureRate: number;
  memoryUsage: number;
  activeAgents: number;
}

export interface OptimizationRecommendation {
  type: 'cache' | 'model' | 'config' | 'resource';
  priority: 'low' | 'medium' | 'high';
  description: string;
  impact: string;
  implementation: string;
}

/**
 * Monitors and analyzes foundation agent performance
 */
export class PerformanceMonitor {
  private metrics: InitializationMetrics[] = [];
  private snapshots: PerformanceSnapshot[] = [];
  private maxMetricsHistory = 1000;
  private maxSnapshotHistory = 100;

  /**
   * Record agent initialization metrics
   */
  recordInitialization(metrics: InitializationMetrics): void {
    this.metrics.push(metrics);
    
    // Trim old metrics
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }

    // Log performance issues
    if (metrics.duration > 10000) { // > 10 seconds
      logger.warn(`[PERF_MONITOR] Slow initialization detected: ${metrics.agentType} took ${metrics.duration}ms`);
    }

    // Periodic snapshot
    if (this.metrics.length % 10 === 0) {
      this.takeSnapshot();
    }
  }

  /**
   * Start timing an agent initialization
   */
  startTiming(agentType: keyof FoundationAgents): number {
    return Date.now();
  }

  /**
   * End timing and record metrics
   */
  endTiming(
    agentType: keyof FoundationAgents,
    startTime: number,
    success: boolean,
    cacheHit: boolean,
    error?: string
  ): InitializationMetrics {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    const metrics: InitializationMetrics = {
      agentType,
      startTime,
      endTime,
      duration,
      success,
      error,
      cacheHit,
      memoryUsage: this.getCurrentMemoryUsage()
    };

    this.recordInitialization(metrics);
    return metrics;
  }

  /**
   * Take performance snapshot
   */
  private takeSnapshot(): void {
    const recent = this.metrics.slice(-50); // Last 50 initializations
    if (recent.length === 0) return;

    const totalInitTime = recent.reduce((sum, m) => sum + m.duration, 0);
    const averageInitTime = totalInitTime / recent.length;
    const cacheHits = recent.filter(m => m.cacheHit).length;
    const failures = recent.filter(m => !m.success).length;

    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      totalInitTime,
      averageInitTime,
      cacheHitRate: cacheHits / recent.length,
      failureRate: failures / recent.length,
      memoryUsage: this.getCurrentMemoryUsage(),
      activeAgents: this.getUniqueAgentTypes(recent).length
    };

    this.snapshots.push(snapshot);
    
    // Trim old snapshots
    if (this.snapshots.length > this.maxSnapshotHistory) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshotHistory);
    }
  }

  /**
   * Get current memory usage
   */
  private getCurrentMemoryUsage(): number {
    try {
      if (typeof process !== 'undefined' && process.memoryUsage) {
        return process.memoryUsage().heapUsed;
      }
    } catch (error) {
      // Browser environment or other limitation
    }
    return 0;
  }

  /**
   * Get unique agent types from metrics
   */
  private getUniqueAgentTypes(metrics: InitializationMetrics[]): string[] {
    return [...new Set(metrics.map(m => m.agentType))];
  }

  /**
   * Analyze performance and generate recommendations
   */
  generateRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    const recent = this.metrics.slice(-100);
    
    if (recent.length < 10) {
      return recommendations; // Not enough data
    }

    // Analyze cache performance
    const cacheHitRate = recent.filter(m => m.cacheHit).length / recent.length;
    if (cacheHitRate < 0.5) {
      recommendations.push({
        type: 'cache',
        priority: 'high',
        description: `Low cache hit rate (${(cacheHitRate * 100).toFixed(1)}%)`,
        impact: 'Significantly reduce initialization time',
        implementation: 'Increase cache expiration time or improve cache key generation'
      });
    }

    // Analyze slow agents
    const slowAgents = this.getSlowAgents(recent);
    for (const [agentType, avgTime] of slowAgents) {
      if (avgTime > 15000) { // > 15 seconds
        recommendations.push({
          type: 'model',
          priority: 'high',
          description: `${agentType} agent is very slow (${(avgTime/1000).toFixed(1)}s average)`,
          impact: 'Reduce user wait time significantly',
          implementation: 'Consider using a smaller, faster model for this agent'
        });
      } else if (avgTime > 8000) { // > 8 seconds
        recommendations.push({
          type: 'config',
          priority: 'medium',
          description: `${agentType} agent initialization is slow (${(avgTime/1000).toFixed(1)}s average)`,
          impact: 'Improve user experience',
          implementation: 'Reduce timeout values or optimize configuration'
        });
      }
    }

    // Analyze failure rate
    const failureRate = recent.filter(m => !m.success).length / recent.length;
    if (failureRate > 0.1) { // > 10% failure rate
      recommendations.push({
        type: 'resource',
        priority: 'high',
        description: `High initialization failure rate (${(failureRate * 100).toFixed(1)}%)`,
        impact: 'Improve system reliability',
        implementation: 'Check Ollama server status and model availability'
      });
    }

    // Analyze memory usage
    const avgMemory = recent.reduce((sum, m) => sum + (m.memoryUsage || 0), 0) / recent.length;
    if (avgMemory > 500 * 1024 * 1024) { // > 500MB
      recommendations.push({
        type: 'resource',
        priority: 'medium',
        description: `High memory usage during initialization (${Math.round(avgMemory / 1024 / 1024)}MB average)`,
        impact: 'Reduce resource consumption',
        implementation: 'Implement agent unloading or optimize memory usage patterns'
      });
    }

    return recommendations;
  }

  /**
   * Get agents with slow average initialization times
   */
  private getSlowAgents(metrics: InitializationMetrics[]): Map<keyof FoundationAgents, number> {
    const agentTimes = new Map<keyof FoundationAgents, number[]>();
    
    // Group times by agent type
    for (const metric of metrics) {
      if (!agentTimes.has(metric.agentType)) {
        agentTimes.set(metric.agentType, []);
      }
      agentTimes.get(metric.agentType)!.push(metric.duration);
    }

    // Calculate averages
    const averages = new Map<keyof FoundationAgents, number>();
    for (const [agentType, times] of agentTimes) {
      const average = times.reduce((sum, time) => sum + time, 0) / times.length;
      averages.set(agentType, average);
    }

    // Filter slow agents (> 5 seconds average)
    const slowAgents = new Map<keyof FoundationAgents, number>();
    for (const [agentType, avgTime] of averages) {
      if (avgTime > 5000) {
        slowAgents.set(agentType, avgTime);
      }
    }

    return slowAgents;
  }

  /**
   * Get performance summary
   */
  getSummary(): {
    totalInitializations: number;
    averageInitTime: number;
    cacheHitRate: number;
    failureRate: number;
    slowestAgent: { type: keyof FoundationAgents; time: number } | null;
    recommendations: OptimizationRecommendation[];
  } {
    const recent = this.metrics.slice(-100);
    
    if (recent.length === 0) {
      return {
        totalInitializations: 0,
        averageInitTime: 0,
        cacheHitRate: 0,
        failureRate: 0,
        slowestAgent: null,
        recommendations: []
      };
    }

    const totalTime = recent.reduce((sum, m) => sum + m.duration, 0);
    const cacheHits = recent.filter(m => m.cacheHit).length;
    const failures = recent.filter(m => !m.success).length;
    
    // Find slowest agent
    const agentTimes = new Map<keyof FoundationAgents, number>();
    for (const metric of recent) {
      const current = agentTimes.get(metric.agentType) || 0;
      if (metric.duration > current) {
        agentTimes.set(metric.agentType, metric.duration);
      }
    }

    let slowestAgent: { type: keyof FoundationAgents; time: number } | null = null;
    let maxTime = 0;
    for (const [agentType, time] of agentTimes) {
      if (time > maxTime) {
        maxTime = time;
        slowestAgent = { type: agentType, time };
      }
    }

    return {
      totalInitializations: recent.length,
      averageInitTime: totalTime / recent.length,
      cacheHitRate: cacheHits / recent.length,
      failureRate: failures / recent.length,
      slowestAgent,
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Get detailed metrics for a specific agent type
   */
  getAgentMetrics(agentType: keyof FoundationAgents): {
    totalInitializations: number;
    averageTime: number;
    medianTime: number;
    minTime: number;
    maxTime: number;
    cacheHitRate: number;
    failureRate: number;
    recentTrend: 'improving' | 'stable' | 'degrading';
  } | null {
    const agentMetrics = this.metrics.filter(m => m.agentType === agentType);
    
    if (agentMetrics.length === 0) {
      return null;
    }

    const times = agentMetrics.map(m => m.duration).sort((a, b) => a - b);
    const cacheHits = agentMetrics.filter(m => m.cacheHit).length;
    const failures = agentMetrics.filter(m => !m.success).length;

    // Calculate trend
    const recent = agentMetrics.slice(-10);
    const older = agentMetrics.slice(-20, -10);
    let trend: 'improving' | 'stable' | 'degrading' = 'stable';
    
    if (recent.length >= 5 && older.length >= 5) {
      const recentAvg = recent.reduce((sum, m) => sum + m.duration, 0) / recent.length;
      const olderAvg = older.reduce((sum, m) => sum + m.duration, 0) / older.length;
      
      if (recentAvg < olderAvg * 0.9) {
        trend = 'improving';
      } else if (recentAvg > olderAvg * 1.1) {
        trend = 'degrading';
      }
    }

    return {
      totalInitializations: agentMetrics.length,
      averageTime: times.reduce((sum, time) => sum + time, 0) / times.length,
      medianTime: times[Math.floor(times.length / 2)],
      minTime: times[0],
      maxTime: times[times.length - 1],
      cacheHitRate: cacheHits / agentMetrics.length,
      failureRate: failures / agentMetrics.length,
      recentTrend: trend
    };
  }

  /**
   * Export metrics for analysis
   */
  exportMetrics(): {
    metrics: InitializationMetrics[];
    snapshots: PerformanceSnapshot[];
    summary: ReturnType<PerformanceMonitor['getSummary']>;
    timestamp: number;
  } {
    return {
      metrics: this.metrics,
      snapshots: this.snapshots,
      summary: this.getSummary(),
      timestamp: Date.now()
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
    this.snapshots = [];
    logger.info('[PERF_MONITOR] Performance metrics cleared');
  }

  /**
   * Log performance summary
   */
  logSummary(): void {
    const summary = this.getSummary();
    
    logger.info('=== Foundation Agent Performance Summary ===');
    logger.info(`Total Initializations: ${summary.totalInitializations}`);
    logger.info(`Average Init Time: ${Math.round(summary.averageInitTime)}ms`);
    logger.info(`Cache Hit Rate: ${(summary.cacheHitRate * 100).toFixed(1)}%`);
    logger.info(`Failure Rate: ${(summary.failureRate * 100).toFixed(1)}%`);
    
    if (summary.slowestAgent) {
      logger.info(`Slowest Agent: ${summary.slowestAgent.type} (${Math.round(summary.slowestAgent.time)}ms)`);
    }

    if (summary.recommendations.length > 0) {
      logger.info('\n=== Performance Recommendations ===');
      summary.recommendations.forEach((rec, index) => {
        logger.info(`${index + 1}. [${rec.priority.toUpperCase()}] ${rec.description}`);
        logger.info(`   Impact: ${rec.impact}`);
        logger.info(`   Solution: ${rec.implementation}`);
      });
    }

    logger.info('===========================================');
  }
}