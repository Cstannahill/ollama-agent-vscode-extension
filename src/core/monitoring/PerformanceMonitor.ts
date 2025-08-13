/**
 * Performance Monitor for vLLM Integration
 * 
 * Tracks performance metrics, health status, and provides monitoring
 * capabilities for both Ollama and vLLM providers.
 */

import { logger } from "../../utils/logger";
import { LLMRouter, LLMProvider, ProviderPerformance } from "../../api/llm-router";
import { ProviderOptimizer } from "../foundation/adapters/ProviderOptimizer";
import chalk from "chalk";

export interface MetricSnapshot {
  timestamp: Date;
  provider: LLMProvider;
  operation: string;
  duration: number;
  success: boolean;
  tokenCount?: number;
  throughput?: number;
  errorType?: string;
  contextSize?: number;
}

export interface HealthCheckResult {
  provider: LLMProvider;
  available: boolean;
  latency: number;
  error?: string;
  lastCheck: Date;
  consecutiveFailures: number;
}

export interface PerformanceInsights {
  recommendations: string[];
  bottlenecks: string[];
  optimizations: string[];
  providerComparison: {
    ollama: ProviderStats;
    lmdeploy: ProviderStats;
  };
  overallHealth: 'excellent' | 'good' | 'fair' | 'poor';
}

export interface ProviderStats {
  avgLatency: number;
  successRate: number;
  totalRequests: number;
  throughput: number;
  availability: number;
  lastFailure?: Date;
}

/**
 * Comprehensive performance monitoring system
 */
export class PerformanceMonitor {
  private metrics: MetricSnapshot[] = [];
  private healthChecks: Map<LLMProvider, HealthCheckResult> = new Map();
  private router?: LLMRouter;
  private optimizer?: ProviderOptimizer;
  
  private maxMetricsHistory = 1000; // Keep last 1000 metrics
  private healthCheckInterval = 30000; // 30 seconds
  private alertThresholds = {
    latencyWarning: 2000, // 2 seconds
    latencyError: 5000, // 5 seconds
    successRateWarning: 0.9, // 90%
    successRateError: 0.7 // 70%
  };
  
  private intervalId?: NodeJS.Timeout;
  private isMonitoring = false;

  constructor(router?: LLMRouter, optimizer?: ProviderOptimizer) {
    this.router = router;
    this.optimizer = optimizer;
    
    // Initialize health check results
    this.healthChecks.set('ollama', {
      provider: 'ollama',
      available: false,
      latency: 0,
      lastCheck: new Date(),
      consecutiveFailures: 0
    });
    
    this.healthChecks.set('lmdeploy', {
      provider: 'lmdeploy',
      available: false,
      latency: 0,
      lastCheck: new Date(),
      consecutiveFailures: 0
    });
  }

  /**
   * Start continuous performance monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      logger.warn("[PERF_MONITOR] Monitoring is already active");
      return;
    }

    logger.info(chalk.green("[PERF_MONITOR] Starting performance monitoring"));
    this.isMonitoring = true;

    // Perform initial health check
    this.performHealthCheck();

    // Set up periodic health checks
    this.intervalId = setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckInterval);
  }

  /**
   * Stop performance monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    logger.info(chalk.yellow("[PERF_MONITOR] Stopping performance monitoring"));
    this.isMonitoring = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Record a performance metric
   */
  recordMetric(metric: Omit<MetricSnapshot, 'timestamp'>): void {
    const snapshot: MetricSnapshot = {
      ...metric,
      timestamp: new Date()
    };

    this.metrics.push(snapshot);

    // Maintain metrics history limit
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }

    // Check for performance alerts
    this.checkAlerts(snapshot);

    logger.info(
      chalk.cyan(
        `📊 [PERF_MONITOR] METRIC | Provider: ${metric.provider.toUpperCase()} | Operation: ${metric.operation} | Duration: ${metric.duration}ms | Success: ${metric.success ? '✅' : '❌'}${metric.tokenCount ? ` | Tokens: ${metric.tokenCount}` : ''}`
      )
    );
  }

  /**
   * Perform health checks on all providers
   */
  private async performHealthCheck(): Promise<void> {
    if (!this.router) {
      logger.debug("[PERF_MONITOR] No router available for health checks");
      return;
    }

    try {
      logger.debug("[PERF_MONITOR] Performing health checks...");
      
      const providerStatus = await this.router.getProviderStatus();
      
      for (const [provider, available] of providerStatus) {
        const startTime = Date.now();
        const latency = Date.now() - startTime;
        
        const previousCheck = this.healthChecks.get(provider);
        const consecutiveFailures = available 
          ? 0 
          : (previousCheck?.consecutiveFailures || 0) + 1;

        const healthResult: HealthCheckResult = {
          provider,
          available,
          latency,
          lastCheck: new Date(),
          consecutiveFailures,
          error: available ? undefined : 'Provider unavailable'
        };

        this.healthChecks.set(provider, healthResult);

        // Log health changes
        if (previousCheck && previousCheck.available !== available) {
          const statusMsg = available ? 'became available' : 'became unavailable';
          logger.info(
            chalk.blue(
              `[PERF_MONITOR] Provider ${provider} ${statusMsg} (failures: ${consecutiveFailures})`
            )
          );
        }
      }

    } catch (error) {
      logger.error("[PERF_MONITOR] Health check failed:", error);
    }
  }

  /**
   * Check for performance alerts
   */
  private checkAlerts(metric: MetricSnapshot): void {
    // Latency alerts
    if (metric.duration > this.alertThresholds.latencyError) {
      logger.error(
        chalk.red(
          `[PERF_ALERT] High latency detected: ${metric.provider} ${metric.operation} took ${metric.duration}ms`
        )
      );
    } else if (metric.duration > this.alertThresholds.latencyWarning) {
      logger.warn(
        chalk.yellow(
          `[PERF_ALERT] Elevated latency: ${metric.provider} ${metric.operation} took ${metric.duration}ms`
        )
      );
    }

    // Calculate recent success rate for the provider
    const recentMetrics = this.getRecentMetrics(metric.provider, 10);
    if (recentMetrics.length >= 5) {
      const successCount = recentMetrics.filter(m => m.success).length;
      const successRate = successCount / recentMetrics.length;

      if (successRate < this.alertThresholds.successRateError) {
        logger.error(
          chalk.red(
            `[PERF_ALERT] Low success rate: ${metric.provider} success rate is ${(successRate * 100).toFixed(1)}%`
          )
        );
      } else if (successRate < this.alertThresholds.successRateWarning) {
        logger.warn(
          chalk.yellow(
            `[PERF_ALERT] Declining success rate: ${metric.provider} success rate is ${(successRate * 100).toFixed(1)}%`
          )
        );
      }
    }
  }

  /**
   * Get recent metrics for a provider
   */
  private getRecentMetrics(provider: LLMProvider, limit: number): MetricSnapshot[] {
    return this.metrics
      .filter(m => m.provider === provider)
      .slice(-limit);
  }

  /**
   * Generate performance insights and recommendations
   */
  generateInsights(): PerformanceInsights {
    const ollamaStats = this.calculateProviderStats('ollama');
    const lmdeployStats = this.calculateProviderStats('lmdeploy');
    
    const recommendations: string[] = [];
    const bottlenecks: string[] = [];
    const optimizations: string[] = [];

    // Performance analysis
    if (ollamaStats.avgLatency > lmdeployStats.avgLatency * 1.5) {
      recommendations.push("Consider routing more tasks to LMDeploy for better latency");
    } else if (lmdeployStats.avgLatency > ollamaStats.avgLatency * 1.5) {
      recommendations.push("Consider routing more tasks to Ollama for better latency");
    }

    if (ollamaStats.successRate < 0.9) {
      bottlenecks.push("Ollama experiencing reliability issues");
    }
    
    if (lmdeployStats.successRate < 0.9) {
      bottlenecks.push("LMDeploy experiencing reliability issues");
    }

    // Throughput optimizations
    if (lmdeployStats.throughput > ollamaStats.throughput * 2) {
      optimizations.push("Use LMDeploy for batch processing and high-throughput tasks");
    }

    if (ollamaStats.successRate > lmdeployStats.successRate) {
      optimizations.push("Use Ollama for critical tasks requiring high reliability");
    }

    // Add optimizer insights if available
    if (this.optimizer) {
      const optimizerInsights = this.optimizer.getPerformanceInsights();
      recommendations.push(...optimizerInsights.recommendations);
      bottlenecks.push(...optimizerInsights.bottlenecks);
      optimizations.push(...optimizerInsights.optimizations);
    }

    // Calculate overall health
    const avgSuccessRate = (ollamaStats.successRate + lmdeployStats.successRate) / 2;
    const avgLatency = (ollamaStats.avgLatency + lmdeployStats.avgLatency) / 2;
    const avgAvailability = (ollamaStats.availability + lmdeployStats.availability) / 2;
    
    let overallHealth: 'excellent' | 'good' | 'fair' | 'poor';
    if (avgSuccessRate > 0.95 && avgLatency < 1000 && avgAvailability > 0.95) {
      overallHealth = 'excellent';
    } else if (avgSuccessRate > 0.9 && avgLatency < 2000 && avgAvailability > 0.9) {
      overallHealth = 'good';
    } else if (avgSuccessRate > 0.8 && avgLatency < 5000 && avgAvailability > 0.8) {
      overallHealth = 'fair';
    } else {
      overallHealth = 'poor';
    }

    return {
      recommendations,
      bottlenecks,
      optimizations,
      providerComparison: {
        ollama: ollamaStats,
        lmdeploy: lmdeployStats
      },
      overallHealth
    };
  }

  /**
   * Calculate statistics for a provider
   */
  private calculateProviderStats(provider: LLMProvider): ProviderStats {
    const providerMetrics = this.metrics.filter(m => m.provider === provider);
    const healthCheck = this.healthChecks.get(provider);
    
    if (providerMetrics.length === 0) {
      return {
        avgLatency: 0,
        successRate: 0,
        totalRequests: 0,
        throughput: 0,
        availability: healthCheck?.available ? 1 : 0,
        lastFailure: undefined
      };
    }

    const successful = providerMetrics.filter(m => m.success);
    const failed = providerMetrics.filter(m => !m.success);
    
    const avgLatency = successful.length > 0 
      ? successful.reduce((sum, m) => sum + m.duration, 0) / successful.length
      : 0;

    const successRate = successful.length / providerMetrics.length;
    
    // Calculate throughput (requests per second over last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentMetrics = providerMetrics.filter(m => m.timestamp > fiveMinutesAgo);
    const throughput = recentMetrics.length / 300; // 5 minutes in seconds

    const lastFailure = failed.length > 0 
      ? failed[failed.length - 1].timestamp
      : undefined;

    return {
      avgLatency,
      successRate,
      totalRequests: providerMetrics.length,
      throughput,
      availability: healthCheck?.available ? 1 : 0,
      lastFailure
    };
  }

  /**
   * Get current health status
   */
  getHealthStatus(): Map<LLMProvider, HealthCheckResult> {
    return new Map(this.healthChecks);
  }

  /**
   * Get recent metrics
   */
  getMetrics(limit?: number): MetricSnapshot[] {
    return limit ? this.metrics.slice(-limit) : [...this.metrics];
  }

  /**
   * Export monitoring data
   */
  exportMonitoringData(): any {
    return {
      metrics: this.metrics.slice(-100), // Last 100 metrics
      healthChecks: Array.from(this.healthChecks.entries()),
      insights: this.generateInsights(),
      configuration: {
        maxMetricsHistory: this.maxMetricsHistory,
        healthCheckInterval: this.healthCheckInterval,
        alertThresholds: this.alertThresholds
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Clear all stored metrics and reset health checks
   */
  reset(): void {
    logger.info("[PERF_MONITOR] Resetting performance monitoring data");
    this.metrics = [];
    this.performHealthCheck();
  }

  /**
   * Update monitoring configuration
   */
  updateConfiguration(config: {
    maxMetricsHistory?: number;
    healthCheckInterval?: number;
    alertThresholds?: Partial<{
      latencyWarning: number;
      latencyError: number;
      successRateWarning: number;
      successRateError: number;
    }>;
  }): void {
    if (config.maxMetricsHistory) {
      this.maxMetricsHistory = config.maxMetricsHistory;
    }

    if (config.healthCheckInterval) {
      this.healthCheckInterval = config.healthCheckInterval;
      
      // Restart monitoring with new interval if currently active
      if (this.isMonitoring) {
        this.stopMonitoring();
        this.startMonitoring();
      }
    }

    if (config.alertThresholds) {
      this.alertThresholds = { ...this.alertThresholds, ...config.alertThresholds };
    }

    logger.info("[PERF_MONITOR] Updated monitoring configuration");
  }
}