/**
 * Monitoring Manager for vLLM Integration
 * 
 * Centralized monitoring system that coordinates performance monitoring
 * and health checks for the entire vLLM integration.
 */

import { logger } from "../../utils/logger";
import { OllamaLLM } from "../../api/ollama";
import { VLLMLLM } from "../../api/vllm";
import { LLMRouter } from "../../api/llm-router";
import { ProviderOptimizer } from "../foundation/adapters/ProviderOptimizer";
import { PerformanceMonitor, PerformanceInsights } from "./PerformanceMonitor";
import { HealthCheckService, SystemHealth } from "./HealthCheckService";
import chalk from "chalk";

export interface MonitoringConfig {
  enablePerformanceMonitoring: boolean;
  enableHealthChecks: boolean;
  performanceMetricsLimit: number;
  healthCheckInterval: number;
  alertThresholds: {
    latencyWarning: number;
    latencyError: number;
    successRateWarning: number;
    successRateError: number;
  };
}

export interface MonitoringStatus {
  performanceMonitoring: {
    active: boolean;
    metricsCount: number;
    insights: PerformanceInsights;
  };
  healthChecking: {
    active: boolean;
    systemHealth: SystemHealth;
    alertsCount: number;
  };
  uptime: number;
  timestamp: Date;
}

/**
 * Centralized monitoring management system
 */
export class MonitoringManager {
  private performanceMonitor: PerformanceMonitor;
  private healthCheckService: HealthCheckService;
  private config: MonitoringConfig;
  
  private startTime: Date = new Date();
  private isInitialized = false;

  constructor(
    ollamaLLM?: OllamaLLM,
    vllmLLM?: VLLMLLM,
    router?: LLMRouter,
    optimizer?: ProviderOptimizer,
    config?: Partial<MonitoringConfig>
  ) {
    // Default configuration
    this.config = {
      enablePerformanceMonitoring: true,
      enableHealthChecks: true,
      performanceMetricsLimit: 1000,
      healthCheckInterval: 60000, // 1 minute
      alertThresholds: {
        latencyWarning: 2000,
        latencyError: 5000,
        successRateWarning: 0.9,
        successRateError: 0.7
      },
      ...config
    };

    // Initialize monitoring services
    this.performanceMonitor = new PerformanceMonitor(router, optimizer);
    this.healthCheckService = new HealthCheckService(
      ollamaLLM, 
      vllmLLM, 
      router, 
      this.performanceMonitor
    );

    // Configure performance monitor
    this.performanceMonitor.updateConfiguration({
      maxMetricsHistory: this.config.performanceMetricsLimit,
      alertThresholds: this.config.alertThresholds
    });

    logger.info(chalk.green("[MONITORING_MANAGER] Monitoring manager initialized"));
  }

  /**
   * Initialize and start all monitoring services
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn("[MONITORING_MANAGER] Already initialized");
      return;
    }

    try {
      logger.info(chalk.green("[MONITORING_MANAGER] Starting monitoring services..."));
      this.startTime = new Date();

      // Start performance monitoring if enabled
      if (this.config.enablePerformanceMonitoring) {
        this.performanceMonitor.startMonitoring();
        logger.info(chalk.blue("[MONITORING_MANAGER] Performance monitoring started"));
      }

      // Start health check service if enabled
      if (this.config.enableHealthChecks) {
        this.healthCheckService.start();
        logger.info(chalk.blue("[MONITORING_MANAGER] Health check service started"));
      }

      this.isInitialized = true;
      
      // Perform initial status check
      const status = await this.getMonitoringStatus();
      logger.info(
        chalk.green(
          `[MONITORING_MANAGER] Monitoring initialized - Performance: ${status.performanceMonitoring.active ? 'ON' : 'OFF'}, Health: ${status.healthChecking.active ? 'ON' : 'OFF'}`
        )
      );

    } catch (error) {
      logger.error("[MONITORING_MANAGER] Failed to initialize monitoring:", error);
      throw error;
    }
  }

  /**
   * Stop all monitoring services
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    logger.info(chalk.yellow("[MONITORING_MANAGER] Shutting down monitoring services..."));

    try {
      // Stop performance monitoring
      this.performanceMonitor.stopMonitoring();
      
      // Stop health check service
      this.healthCheckService.stop();

      this.isInitialized = false;
      
      logger.info(chalk.green("[MONITORING_MANAGER] Monitoring services stopped"));

    } catch (error) {
      logger.error("[MONITORING_MANAGER] Error during monitoring shutdown:", error);
    }
  }

  /**
   * Get comprehensive monitoring status
   */
  async getMonitoringStatus(): Promise<MonitoringStatus> {
    const systemHealth = await this.healthCheckService.getSystemHealth();
    const insights = this.performanceMonitor.generateInsights();
    const metrics = this.performanceMonitor.getMetrics();
    const alerts = this.healthCheckService.getRecentAlerts();

    return {
      performanceMonitoring: {
        active: this.isInitialized && this.config.enablePerformanceMonitoring,
        metricsCount: metrics.length,
        insights
      },
      healthChecking: {
        active: this.isInitialized && this.config.enableHealthChecks,
        systemHealth,
        alertsCount: alerts.filter(alert => !alert.resolved).length
      },
      uptime: this.getUptime(),
      timestamp: new Date()
    };
  }

  /**
   * Record a performance metric
   */
  recordPerformanceMetric(
    provider: 'ollama' | 'vllm',
    operation: string,
    duration: number,
    success: boolean,
    options?: {
      tokenCount?: number;
      throughput?: number;
      errorType?: string;
      contextSize?: number;
    }
  ): void {
    if (!this.config.enablePerformanceMonitoring) {
      return;
    }

    this.performanceMonitor.recordMetric({
      provider,
      operation,
      duration,
      success,
      ...options
    });
  }

  /**
   * Get performance insights
   */
  getPerformanceInsights(): PerformanceInsights {
    return this.performanceMonitor.generateInsights();
  }

  /**
   * Get system health
   */
  async getSystemHealth(): Promise<SystemHealth> {
    return this.healthCheckService.getSystemHealth();
  }

  /**
   * Generate comprehensive monitoring report
   */
  async generateMonitoringReport(): Promise<any> {
    const status = await this.getMonitoringStatus();
    const healthReport = await this.healthCheckService.exportHealthReport();
    const performanceData = this.performanceMonitor.exportMonitoringData();
    
    return {
      summary: {
        uptime: this.getUptime(),
        overallHealth: status.healthChecking.systemHealth.overall,
        performanceGrade: status.performanceMonitoring.insights.overallHealth,
        activeAlerts: status.healthChecking.alertsCount,
        totalMetrics: status.performanceMonitoring.metricsCount
      },
      performance: performanceData,
      health: healthReport,
      configuration: this.config,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Update monitoring configuration
   */
  updateConfiguration(newConfig: Partial<MonitoringConfig>): void {
    const previousConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };
    
    // Apply configuration changes
    if (newConfig.performanceMetricsLimit || newConfig.alertThresholds) {
      this.performanceMonitor.updateConfiguration({
        maxMetricsHistory: this.config.performanceMetricsLimit,
        alertThresholds: this.config.alertThresholds
      });
    }

    // Handle service enabling/disabling
    if (this.isInitialized) {
      if (newConfig.enablePerformanceMonitoring !== undefined) {
        if (newConfig.enablePerformanceMonitoring && !previousConfig.enablePerformanceMonitoring) {
          this.performanceMonitor.startMonitoring();
          logger.info(chalk.green("[MONITORING_MANAGER] Performance monitoring enabled"));
        } else if (!newConfig.enablePerformanceMonitoring && previousConfig.enablePerformanceMonitoring) {
          this.performanceMonitor.stopMonitoring();
          logger.info(chalk.yellow("[MONITORING_MANAGER] Performance monitoring disabled"));
        }
      }

      if (newConfig.enableHealthChecks !== undefined) {
        if (newConfig.enableHealthChecks && !previousConfig.enableHealthChecks) {
          this.healthCheckService.start();
          logger.info(chalk.green("[MONITORING_MANAGER] Health checks enabled"));
        } else if (!newConfig.enableHealthChecks && previousConfig.enableHealthChecks) {
          this.healthCheckService.stop();
          logger.info(chalk.yellow("[MONITORING_MANAGER] Health checks disabled"));
        }
      }
    }

    logger.info(chalk.blue("[MONITORING_MANAGER] Configuration updated"));
  }

  /**
   * Reset all monitoring data
   */
  resetMonitoringData(): void {
    logger.info(chalk.yellow("[MONITORING_MANAGER] Resetting monitoring data"));
    
    this.performanceMonitor.reset();
    this.healthCheckService.clearResolvedAlerts();
    
    logger.info(chalk.green("[MONITORING_MANAGER] Monitoring data reset complete"));
  }

  /**
   * Get diagnostic information
   */
  getDiagnostics(): any {
    const healthStatus = this.healthCheckService.getRecentAlerts(5);
    const recentMetrics = this.performanceMonitor.getMetrics(10);
    
    return {
      services: {
        performanceMonitor: {
          active: this.isInitialized && this.config.enablePerformanceMonitoring,
          metricsCount: recentMetrics.length,
          lastMetric: recentMetrics[recentMetrics.length - 1]
        },
        healthCheck: {
          active: this.isInitialized && this.config.enableHealthChecks,
          alertsCount: healthStatus.length,
          lastAlert: healthStatus[healthStatus.length - 1]
        }
      },
      configuration: this.config,
      uptime: this.getUptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check if monitoring is healthy
   */
  isMonitoringHealthy(): boolean {
    // Basic health check for monitoring services themselves
    return this.isInitialized && 
           (!this.config.enablePerformanceMonitoring || this.performanceMonitor !== null) &&
           (!this.config.enableHealthChecks || this.healthCheckService !== null);
  }

  /**
   * Get uptime in milliseconds
   */
  private getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }

  /**
   * Get uptime formatted as human-readable string
   */
  getUptimeFormatted(): string {
    const uptimeMs = this.getUptime();
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}