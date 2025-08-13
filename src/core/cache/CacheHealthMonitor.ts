/**
 * Cache Health Monitoring System
 * 
 * Monitors cache performance, tracks hit rates, detects churn issues,
 * and provides alerts when cache efficiency drops below thresholds.
 */

import { logger } from "../../utils/logger";
import { CacheManager } from "./CacheManager";
import { PersistentCache } from "./PersistentCache";

export interface CacheHealthMetrics {
  cacheId: string;
  hitRate: number;
  missRate: number;
  evictionRate: number;
  churnRate: number; // entries per minute being recreated
  memoryEfficiency: number; // % of allocated memory used
  avgResponseTime: number;
  totalOperations: number;
  healthy: boolean;
  issues: string[];
}

export interface HealthAlert {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  cacheId: string;
  message: string;
  metric: string;
  threshold: number;
  actualValue: number;
  timestamp: number;
  traceId?: string;
}

export class CacheHealthMonitor {
  private static instance: CacheHealthMonitor;
  private cacheManager: CacheManager;
  private persistentCache: PersistentCache;
  private alerts: Map<string, HealthAlert> = new Map();
  private metrics: Map<string, CacheHealthMetrics> = new Map();
  private monitoringEnabled = true;
  private monitoringTimer?: NodeJS.Timeout;
  
  // Health thresholds
  private readonly THRESHOLDS = {
    hitRate: {
      critical: 0.2,  // <20% hit rate is critical
      high: 0.4,      // <40% hit rate is high concern
      medium: 0.6,    // <60% hit rate needs attention
      low: 0.8        // <80% hit rate is suboptimal
    },
    churnRate: {
      critical: 10,   // >10 recreations/min is critical
      high: 5,        // >5 recreations/min is high concern
      medium: 2,      // >2 recreations/min needs attention
      low: 1          // >1 recreation/min is suboptimal
    },
    memoryEfficiency: {
      critical: 0.05, // <5% memory usage suggests oversized cache
      low: 0.2        // <20% memory usage might be oversized
    }
  };

  private constructor() {
    this.cacheManager = CacheManager.getInstance();
    this.persistentCache = PersistentCache.getInstance();
    this.startMonitoring();
  }

  static getInstance(): CacheHealthMonitor {
    if (!CacheHealthMonitor.instance) {
      CacheHealthMonitor.instance = new CacheHealthMonitor();
    }
    return CacheHealthMonitor.instance;
  }

  /**
   * Start health monitoring with configurable interval
   */
  startMonitoring(intervalMs: number = 300000): void { // 5 minutes
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }

    this.monitoringTimer = setInterval(() => {
      this.performHealthCheck();
    }, intervalMs);

    logger.info(`[CACHE_HEALTH] Started cache health monitoring (${intervalMs/1000}s interval)`);
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = undefined;
    }
    this.monitoringEnabled = false;
    logger.info("[CACHE_HEALTH] Stopped cache health monitoring");
  }

  /**
   * Perform comprehensive health check on all caches
   */
  performHealthCheck(traceId?: string): CacheHealthMetrics[] {
    if (!this.monitoringEnabled) {
      return [];
    }

    const healthMetrics: CacheHealthMetrics[] = [];
    const globalStats = this.cacheManager.getGlobalStats();

    for (const [cacheId, stats] of Object.entries(globalStats)) {
      const metrics = this.analyzeCacheHealth(cacheId, stats, traceId);
      this.metrics.set(cacheId, metrics);
      healthMetrics.push(metrics);

      // Check for alerts
      this.checkAndRaiseAlerts(metrics, traceId);
    }

    // Also check persistent cache health
    const persistentStats = this.persistentCache.getStats();
    const persistentMetrics = this.analyzePersistentCacheHealth(persistentStats, traceId);
    this.metrics.set('persistent', persistentMetrics);
    healthMetrics.push(persistentMetrics);
    this.checkAndRaiseAlerts(persistentMetrics, traceId);

    // Log summary if any issues found
    const unhealthyCaches = healthMetrics.filter(m => !m.healthy);
    if (unhealthyCaches.length > 0) {
      logger.warn(`[CACHE_HEALTH] Found ${unhealthyCaches.length} unhealthy caches`, {
        unhealthyCaches: unhealthyCaches.map(c => c.cacheId),
        traceId
      });
    }

    return healthMetrics;
  }

  /**
   * Analyze cache health based on statistics
   */
  private analyzeCacheHealth(cacheId: string, stats: any, traceId?: string): CacheHealthMetrics {
    const hitRate = stats.hits + stats.misses > 0 ? stats.hits / (stats.hits + stats.misses) : 0;
    const missRate = 1 - hitRate;
    const evictionRate = stats.evictions / Math.max(stats.sets, 1);
    
    // Calculate churn rate (approximation based on sets vs size)
    const churnRate = stats.sets > stats.size ? (stats.sets - stats.size) / 5 : 0; // per 5min window
    
    // Memory efficiency
    const memoryEfficiency = stats.memoryUsageMB / 50; // Assuming 50MB typical allocation
    
    const issues: string[] = [];
    let healthy = true;

    // Check hit rate health
    if (hitRate < this.THRESHOLDS.hitRate.critical) {
      issues.push(`Critical hit rate: ${(hitRate * 100).toFixed(1)}%`);
      healthy = false;
    } else if (hitRate < this.THRESHOLDS.hitRate.high) {
      issues.push(`Low hit rate: ${(hitRate * 100).toFixed(1)}%`);
      healthy = false;
    }

    // Check churn rate
    if (churnRate > this.THRESHOLDS.churnRate.critical) {
      issues.push(`High churn rate: ${churnRate.toFixed(1)} recreations/5min`);
      healthy = false;
    }

    // Check memory efficiency
    if (memoryEfficiency < this.THRESHOLDS.memoryEfficiency.critical) {
      issues.push(`Low memory utilization: ${(memoryEfficiency * 100).toFixed(1)}%`);
    }

    return {
      cacheId,
      hitRate,
      missRate,
      evictionRate,
      churnRate,
      memoryEfficiency,
      avgResponseTime: 0, // TODO: Add timing tracking
      totalOperations: stats.hits + stats.misses + stats.sets,
      healthy,
      issues
    };
  }

  /**
   * Analyze persistent cache health
   */
  private analyzePersistentCacheHealth(stats: any, traceId?: string): CacheHealthMetrics {
    const issues: string[] = [];
    let healthy = true;

    // Check for stale data (entries older than 24 hours)
    const now = Date.now();
    const oldestAge = stats.oldestEntry > 0 ? (now - stats.oldestEntry) / 1000 / 60 / 60 : 0; // hours

    if (oldestAge > 48) { // 48 hours
      issues.push(`Very old cache entries: ${oldestAge.toFixed(1)} hours`);
    }

    // Check cache size growth
    if (stats.totalSizeMB > 100) { // >100MB persistent cache
      issues.push(`Large persistent cache: ${stats.totalSizeMB.toFixed(1)}MB`);
    }

    return {
      cacheId: 'persistent',
      hitRate: 0.8, // Assume good hit rate for persistent cache
      missRate: 0.2,
      evictionRate: 0,
      churnRate: 0,
      memoryEfficiency: Math.min(stats.totalSizeMB / 50, 1),
      avgResponseTime: 0,
      totalOperations: stats.totalEntries,
      healthy,
      issues
    };
  }

  /**
   * Check metrics and raise alerts if thresholds exceeded
   */
  private checkAndRaiseAlerts(metrics: CacheHealthMetrics, traceId?: string): void {
    const alertId = `${metrics.cacheId}_health`;

    // Hit rate alert
    if (metrics.hitRate < this.THRESHOLDS.hitRate.critical) {
      this.raiseAlert({
        id: `${alertId}_hitrate_critical`,
        severity: 'critical',
        cacheId: metrics.cacheId,
        message: `Cache hit rate critically low`,
        metric: 'hitRate',
        threshold: this.THRESHOLDS.hitRate.critical,
        actualValue: metrics.hitRate,
        timestamp: Date.now(),
        traceId
      });
    } else if (metrics.hitRate < this.THRESHOLDS.hitRate.high) {
      this.raiseAlert({
        id: `${alertId}_hitrate_high`,
        severity: 'high',
        cacheId: metrics.cacheId,
        message: `Cache hit rate below optimal`,
        metric: 'hitRate',
        threshold: this.THRESHOLDS.hitRate.high,
        actualValue: metrics.hitRate,
        timestamp: Date.now(),
        traceId
      });
    }

    // Churn rate alert
    if (metrics.churnRate > this.THRESHOLDS.churnRate.critical) {
      this.raiseAlert({
        id: `${alertId}_churn_critical`,
        severity: 'critical',
        cacheId: metrics.cacheId,
        message: `High cache churn detected`,
        metric: 'churnRate',
        threshold: this.THRESHOLDS.churnRate.critical,
        actualValue: metrics.churnRate,
        timestamp: Date.now(),
        traceId
      });
    }
  }

  /**
   * Raise health alert
   */
  private raiseAlert(alert: HealthAlert): void {
    // Check if we already have this alert (avoid spam)
    const existingAlert = this.alerts.get(alert.id);
    if (existingAlert && Date.now() - existingAlert.timestamp < 300000) { // 5 min cooldown
      return;
    }

    this.alerts.set(alert.id, alert);

    const severityEmoji = {
      low: '⚠️',
      medium: '🟡',
      high: '🟠', 
      critical: '🚨'
    };

    logger.warn(`${severityEmoji[alert.severity]} [CACHE_HEALTH] ${alert.message}`, {
      cacheId: alert.cacheId,
      metric: alert.metric,
      threshold: alert.threshold,
      actual: alert.actualValue,
      traceId: alert.traceId
    });
  }

  /**
   * Get current health status for all caches
   */
  getHealthStatus(): { 
    overall: 'healthy' | 'degraded' | 'unhealthy';
    metrics: CacheHealthMetrics[];
    activeAlerts: HealthAlert[];
  } {
    const metrics = Array.from(this.metrics.values());
    const activeAlerts = Array.from(this.alerts.values())
      .filter(alert => Date.now() - alert.timestamp < 3600000); // Last hour

    const unhealthyCount = metrics.filter(m => !m.healthy).length;
    const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical').length;

    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (criticalAlerts > 0 || unhealthyCount > metrics.length / 2) {
      overall = 'unhealthy';
    } else if (unhealthyCount > 0) {
      overall = 'degraded';
    }

    return { overall, metrics, activeAlerts };
  }

  /**
   * Generate health report
   */
  generateHealthReport(): string {
    const status = this.getHealthStatus();
    const lines: string[] = [];

    lines.push(`Cache Health Report - Overall Status: ${status.overall.toUpperCase()}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    // Summary stats
    lines.push('Cache Performance Summary:');
    for (const metric of status.metrics) {
      const healthIcon = metric.healthy ? '✅' : '❌';
      lines.push(`  ${healthIcon} ${metric.cacheId}: ${(metric.hitRate * 100).toFixed(1)}% hit rate, ${metric.totalOperations} ops`);
      
      if (metric.issues.length > 0) {
        metric.issues.forEach(issue => lines.push(`    ⚠️  ${issue}`));
      }
    }

    // Active alerts
    if (status.activeAlerts.length > 0) {
      lines.push('');
      lines.push('Active Alerts:');
      for (const alert of status.activeAlerts) {
        lines.push(`  🚨 ${alert.severity.toUpperCase()}: ${alert.message} (${alert.cacheId})`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Clear expired alerts
   */
  clearExpiredAlerts(): number {
    const now = Date.now();
    const expiredAlerts: string[] = [];

    for (const [alertId, alert] of this.alerts.entries()) {
      if (now - alert.timestamp > 3600000) { // 1 hour expiration
        expiredAlerts.push(alertId);
      }
    }

    expiredAlerts.forEach(alertId => this.alerts.delete(alertId));
    
    if (expiredAlerts.length > 0) {
      logger.debug(`[CACHE_HEALTH] Cleared ${expiredAlerts.length} expired alerts`);
    }

    return expiredAlerts.length;
  }
}