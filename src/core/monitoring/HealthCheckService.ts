/**
 * Health Check Service for LMDeploy Integration
 * 
 * Provides comprehensive health monitoring for both Ollama and LMDeploy providers,
 * including connectivity checks, performance benchmarks, and alerting.
 */

import { logger } from "../../utils/logger";
import { OllamaLLM } from "../../api/ollama";
import { LMDeployLLM } from "../../api/lmdeploy";
import { LLMRouter } from "../../api/llm-router";
import { PerformanceMonitor, HealthCheckResult } from "./PerformanceMonitor";
import chalk from "chalk";

export interface ServiceHealth {
  provider: 'ollama' | 'lmdeploy';
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  checks: {
    connectivity: HealthCheckResult;
    performance: HealthCheckResult;
    modelAccess: HealthCheckResult;
    resourceUsage?: HealthCheckResult;
  };
  summary: string;
  recommendations?: string[];
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  services: ServiceHealth[];
  timestamp: Date;
  uptime: number;
  alerts: HealthAlert[];
}

export interface HealthAlert {
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: Date;
  provider?: 'ollama' | 'lmdeploy';
  resolved?: boolean;
}

/**
 * Comprehensive health monitoring service
 */
export class HealthCheckService {
  private ollamaLLM?: OllamaLLM;
  private lmdeployLLM?: LMDeployLLM;
  private router?: LLMRouter;
  private performanceMonitor?: PerformanceMonitor;
  
  private alerts: HealthAlert[] = [];
  private startTime: Date = new Date();
  private maxAlertsHistory = 100;
  
  private isRunning = false;
  private checkInterval?: NodeJS.Timeout;
  private checkIntervalMs = 60000; // 1 minute

  constructor(
    ollamaLLM?: OllamaLLM,
    lmdeployLLM?: LMDeployLLM,
    router?: LLMRouter,
    performanceMonitor?: PerformanceMonitor
  ) {
    this.ollamaLLM = ollamaLLM;
    this.lmdeployLLM = lmdeployLLM;
    this.router = router;
    this.performanceMonitor = performanceMonitor;
  }

  /**
   * Start continuous health monitoring
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("[HEALTH_CHECK] Service is already running");
      return;
    }

    logger.info(chalk.green("[HEALTH_CHECK] Starting health check service"));
    this.isRunning = true;
    this.startTime = new Date();

    // Perform initial health check
    this.performHealthCheck();

    // Set up periodic checks
    this.checkInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.checkIntervalMs);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info(chalk.yellow("[HEALTH_CHECK] Stopping health check service"));
    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  /**
   * Get current system health status
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const services: ServiceHealth[] = [];
    
    // Check Ollama health
    if (this.ollamaLLM) {
      const ollamaHealth = await this.checkServiceHealth('ollama', this.ollamaLLM);
      services.push(ollamaHealth);
    }

    // Check vLLM health
    if (this.lmdeployLLM) {
      const lmdeployHealth = await this.checkServiceHealth('lmdeploy', this.lmdeployLLM);
      services.push(lmdeployHealth);
    }

    // Determine overall health
    const healthyServices = services.filter(s => s.status === 'healthy').length;
    const unhealthyServices = services.filter(s => s.status === 'unhealthy').length;
    
    let overall: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthyServices === 0) {
      overall = 'healthy';
    } else if (healthyServices > 0) {
      overall = 'degraded';
    } else {
      overall = 'unhealthy';
    }

    return {
      overall,
      services,
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime(),
      alerts: this.getRecentAlerts(10)
    };
  }

  /**
   * Check health of a specific service
   */
  private async checkServiceHealth(
    provider: 'ollama' | 'lmdeploy', 
    service: OllamaLLM | LMDeployLLM
  ): Promise<ServiceHealth> {
    const checks: ServiceHealth['checks'] = {
      connectivity: await this.checkConnectivity(provider, service),
      performance: await this.checkPerformance(provider, service),
      modelAccess: await this.checkModelAccess(provider, service)
    };

    // Add resource usage check for vLLM (if supported)
    if (provider === 'lmdeploy' && service instanceof LMDeployLLM) {
      try {
        checks.resourceUsage = await this.checkResourceUsage(service);
      } catch (error) {
        logger.debug("[HEALTH_CHECK] Resource usage check not supported for LMDeploy");
      }
    }

    // Determine overall service status
    const failedChecks = Object.values(checks).filter(check => !check.available).length;
    const totalChecks = Object.values(checks).length;
    
    let status: ServiceHealth['status'];
    let summary: string;
    const recommendations: string[] = [];

    if (failedChecks === 0) {
      status = 'healthy';
      summary = `${provider.toUpperCase()} is operating normally`;
    } else if (failedChecks === 1) {
      status = 'degraded';
      summary = `${provider.toUpperCase()} is experiencing minor issues`;
      recommendations.push("Monitor the degraded service closely");
    } else if (failedChecks < totalChecks) {
      status = 'degraded';
      summary = `${provider.toUpperCase()} has multiple issues but is partially functional`;
      recommendations.push("Investigate service configuration and connectivity");
    } else {
      status = 'unhealthy';
      summary = `${provider.toUpperCase()} is not responding`;
      recommendations.push("Check service availability and restart if necessary");
    }

    // Add specific recommendations based on failed checks
    if (!checks.connectivity.available) {
      recommendations.push(`Check ${provider} server connectivity and configuration`);
    }
    if (!checks.performance.available) {
      recommendations.push(`${provider} performance issues detected - investigate server load`);
    }
    if (!checks.modelAccess.available) {
      recommendations.push(`Model access issues with ${provider} - verify model availability`);
    }

    return {
      provider,
      status,
      checks,
      summary,
      recommendations: recommendations.length > 0 ? recommendations : undefined
    };
  }

  /**
   * Check basic connectivity
   */
  private async checkConnectivity(
    provider: 'ollama' | 'lmdeploy',
    service: OllamaLLM | LMDeployLLM
  ): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const available = await service.isAvailable();
      const latency = Date.now() - startTime;
      
      return {
        provider,
        available,
        latency,
        lastCheck: new Date(),
        consecutiveFailures: available ? 0 : 1
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      return {
        provider,
        available: false,
        latency,
        error: error instanceof Error ? error.message : String(error),
        lastCheck: new Date(),
        consecutiveFailures: 1
      };
    }
  }

  /**
   * Check performance with a test request
   */
  private async checkPerformance(
    provider: 'ollama' | 'lmdeploy',
    service: OllamaLLM | LMDeployLLM
  ): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Simple test prompt
      const testPrompt = "Test";
      const result = await service.generateText(testPrompt);
      const latency = Date.now() - startTime;
      
      const available = result.length > 0 && latency < 10000; // 10 second timeout
      
      if (this.performanceMonitor) {
        this.performanceMonitor.recordMetric({
          provider,
          operation: 'health_check',
          duration: latency,
          success: available,
          tokenCount: result.length
        });
      }
      
      return {
        provider,
        available,
        latency,
        lastCheck: new Date(),
        consecutiveFailures: available ? 0 : 1
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      if (this.performanceMonitor) {
        this.performanceMonitor.recordMetric({
          provider,
          operation: 'health_check',
          duration: latency,
          success: false,
          errorType: error instanceof Error ? error.constructor.name : 'UnknownError'
        });
      }
      
      return {
        provider,
        available: false,
        latency,
        error: error instanceof Error ? error.message : String(error),
        lastCheck: new Date(),
        consecutiveFailures: 1
      };
    }
  }

  /**
   * Check model access and availability
   */
  private async checkModelAccess(
    provider: 'ollama' | 'lmdeploy',
    service: OllamaLLM | LMDeployLLM
  ): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const models = await service.listModels();
      const latency = Date.now() - startTime;
      const available = models.length > 0;
      
      if (!available) {
        this.addAlert({
          severity: 'warning',
          message: `No models available for ${provider}`,
          timestamp: new Date(),
          provider
        });
      }
      
      return {
        provider,
        available,
        latency,
        lastCheck: new Date(),
        consecutiveFailures: available ? 0 : 1,
        error: available ? undefined : 'No models available'
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      this.addAlert({
        severity: 'error',
        message: `Model access failed for ${provider}: ${error}`,
        timestamp: new Date(),
        provider
      });
      
      return {
        provider,
        available: false,
        latency,
        error: error instanceof Error ? error.message : String(error),
        lastCheck: new Date(),
        consecutiveFailures: 1
      };
    }
  }

  /**
   * Check resource usage (LMDeploy specific)
   */
  private async checkResourceUsage(service: LMDeployLLM): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // This would require LMDeploy server to expose resource usage endpoints
      const status = await service.getServerStatus();
      const latency = Date.now() - startTime;
      
      // Basic check - if we get status, resources are accessible
      const available = status !== undefined;
      
      return {
        provider: 'lmdeploy',
        available,
        latency,
        lastCheck: new Date(),
        consecutiveFailures: available ? 0 : 1
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      return {
        provider: 'lmdeploy',
        available: false,
        latency,
        error: error instanceof Error ? error.message : String(error),
        lastCheck: new Date(),
        consecutiveFailures: 1
      };
    }
  }

  /**
   * Perform periodic health check
   */
  private async performHealthCheck(): Promise<void> {
    try {
      logger.debug("[HEALTH_CHECK] Performing periodic health check");
      
      const systemHealth = await this.getSystemHealth();
      
      // Check for critical issues
      if (systemHealth.overall === 'unhealthy') {
        this.addAlert({
          severity: 'critical',
          message: 'System is unhealthy - multiple services are down',
          timestamp: new Date()
        });
      } else if (systemHealth.overall === 'degraded') {
        this.addAlert({
          severity: 'warning',
          message: 'System is degraded - some services are experiencing issues',
          timestamp: new Date()
        });
      }

      // Log health status
      const healthColor = systemHealth.overall === 'healthy' ? chalk.green :
                         systemHealth.overall === 'degraded' ? chalk.yellow : chalk.red;
      
      logger.debug(
        healthColor(`[HEALTH_CHECK] System health: ${systemHealth.overall.toUpperCase()}`)
      );

    } catch (error) {
      logger.error("[HEALTH_CHECK] Health check failed:", error);
      
      this.addAlert({
        severity: 'error',
        message: `Health check failed: ${error}`,
        timestamp: new Date()
      });
    }
  }

  /**
   * Add a health alert
   */
  private addAlert(alert: HealthAlert): void {
    this.alerts.push(alert);
    
    // Maintain alerts history limit
    if (this.alerts.length > this.maxAlertsHistory) {
      this.alerts = this.alerts.slice(-this.maxAlertsHistory);
    }

    // Log alert based on severity
    const logFn = alert.severity === 'critical' || alert.severity === 'error' ? logger.error :
                  alert.severity === 'warning' ? logger.warn : logger.info;
    
    const colorFn = alert.severity === 'critical' || alert.severity === 'error' ? chalk.red :
                    alert.severity === 'warning' ? chalk.yellow : chalk.blue;
    
    logFn(colorFn(`[HEALTH_ALERT] ${alert.message}`));
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit?: number): HealthAlert[] {
    return limit ? this.alerts.slice(-limit) : [...this.alerts];
  }

  /**
   * Clear resolved alerts
   */
  clearResolvedAlerts(): void {
    const unresolvedCount = this.alerts.filter(alert => !alert.resolved).length;
    this.alerts = this.alerts.filter(alert => !alert.resolved);
    
    logger.info(
      chalk.blue(`[HEALTH_CHECK] Cleared resolved alerts, ${unresolvedCount} unresolved remaining`)
    );
  }

  /**
   * Mark alert as resolved
   */
  resolveAlert(index: number): void {
    if (index >= 0 && index < this.alerts.length) {
      this.alerts[index].resolved = true;
      logger.info(chalk.green(`[HEALTH_CHECK] Marked alert ${index} as resolved`));
    }
  }

  /**
   * Get service uptime
   */
  getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }

  /**
   * Export health data for reporting
   */
  async exportHealthReport(): Promise<any> {
    const systemHealth = await this.getSystemHealth();
    
    return {
      ...systemHealth,
      uptime: this.getUptime(),
      allAlerts: this.alerts,
      configuration: {
        checkIntervalMs: this.checkIntervalMs,
        maxAlertsHistory: this.maxAlertsHistory
      },
      generatedAt: new Date().toISOString()
    };
  }
}