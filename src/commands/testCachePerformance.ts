/**
 * Test command to validate cache performance and optimization
 */

import * as vscode from "vscode";
import { logger } from "../utils/logger";
import { getConfig } from "../config";
import { OptimizedFoundationAgentFactory } from "../core/foundation/OptimizedFoundationAgentFactory";
import { CacheValidator } from "../core/foundation/cache/CacheValidator";
import { getToolManager } from "../core/ToolManager";
import { ContextManager } from "../core/ContextManager";

/**
 * Test the caching system performance and generate a report
 */
export async function testCachePerformance(): Promise<void> {
  try {
    logger.info('[CACHE_TEST] Starting cache performance test...');
    
    vscode.window.showInformationMessage('🧪 Testing foundation agent cache performance...');
    
    const config = getConfig();
    const context = vscode.workspace.workspaceFolders?.[0];
    
    if (!context) {
      vscode.window.showErrorMessage('No workspace folder found for testing');
      return;
    }

    // Get managers
    const toolManager = getToolManager();
    const contextManager = ContextManager.getInstance({ 
      globalStorageUri: context.uri,
      workspaceState: {
        get: () => undefined,
        update: () => Promise.resolve()
      }
    } as any);

    // Create optimized factory (using singleton)
    const optimizedFactory = OptimizedFoundationAgentFactory.getInstance({
      ollamaUrl: config.ollamaUrl,
      model: config.model,
      toolManager,
      contextManager,
      extensionConfig: config,
    }, {}, {
      enableCache: true,
      enablePerformanceMonitoring: true,
      enablePreWarming: true,
      enableParallelInitialization: true,
      initializationStrategy: 'hybrid',
    });

    // Run performance tests
    const startTime = Date.now();
    
    // First run - should be slow (no cache)
    logger.info('[CACHE_TEST] First run (no cache expected)...');
    await optimizedFactory.createAgents();
    const firstRunTime = Date.now() - startTime;
    
    // Clear and run again for cache test
    await optimizedFactory.clearOptimizationCache();
    
    // Second run - should use cache
    logger.info('[CACHE_TEST] Second run (should use cache)...');
    const secondStartTime = Date.now();
    await optimizedFactory.createAgents();
    const secondRunTime = Date.now() - secondStartTime;
    
    // Get performance statistics
    const stats = optimizedFactory.getOptimizationStats();
    
    // Create validator and run tests
    const validator = new CacheValidator(
      (optimizedFactory as any).cache,
      (optimizedFactory as any).performanceMonitor
    );
    
    const report = await validator.generatePerformanceReport();
    const healthCheck = await validator.healthCheck();
    
    // Display results
    const improvement = firstRunTime > 0 ? ((firstRunTime - secondRunTime) / firstRunTime) * 100 : 0;
    
    let resultMessage = `🎯 Cache Performance Test Results:\n\n`;
    resultMessage += `📊 First Run: ${Math.round(firstRunTime)}ms\n`;
    resultMessage += `⚡ Second Run: ${Math.round(secondRunTime)}ms\n`;
    resultMessage += `🚀 Improvement: ${improvement.toFixed(1)}%\n\n`;
    resultMessage += `💾 Cache Hit Rate: ${(stats.cacheMetrics.hitRate * 100).toFixed(1)}%\n`;
    resultMessage += `📈 Cache Size: ${stats.cacheMetrics.cacheSize} entries\n\n`;
    resultMessage += `🏥 Health: ${healthCheck.healthy ? '✅ Healthy' : '❌ Issues found'}\n`;
    resultMessage += `📝 Details: ${healthCheck.message}`;

    logger.info(`[CACHE_TEST] Results:\n${resultMessage}`);
    
    // Show results to user
    const selection = await vscode.window.showInformationMessage(
      `Cache test completed! Improvement: ${improvement.toFixed(1)}%`,
      'View Full Report',
      'View Details'
    );

    if (selection === 'View Full Report') {
      // Create a new document with the full report
      const doc = await vscode.workspace.openTextDocument({
        content: report,
        language: 'markdown'
      });
      vscode.window.showTextDocument(doc);
    } else if (selection === 'View Details') {
      vscode.window.showInformationMessage(resultMessage, { modal: true });
    }

    // Log recommendations if any
    if (stats.performanceMetrics.recommendations.length > 0) {
      logger.info('[CACHE_TEST] Performance Recommendations:');
      stats.performanceMetrics.recommendations.forEach((rec, i) => {
        logger.info(`  ${i + 1}. [${rec.priority.toUpperCase()}] ${rec.description}`);
      });
    }

    logger.info('[CACHE_TEST] Cache performance test completed successfully');

  } catch (error) {
    const errorMessage = `Cache performance test failed: ${error instanceof Error ? error.message : String(error)}`;
    logger.error('[CACHE_TEST]', error);
    vscode.window.showErrorMessage(errorMessage);
  }
}

/**
 * Command to clear cache and reset performance metrics
 */
export async function clearAgentCache(): Promise<void> {
  try {
    // Access global factory if available
    const factory = (global as any).foundationFactory;
    
    if (!factory) {
      vscode.window.showWarningMessage('No foundation factory found. Cache may already be empty.');
      return;
    }

    await factory.clearOptimizationCache();
    
    vscode.window.showInformationMessage('🧹 Agent cache cleared successfully');
    logger.info('[CACHE_CLEAR] Agent cache cleared by user request');

  } catch (error) {
    const errorMessage = `Failed to clear cache: ${error instanceof Error ? error.message : String(error)}`;
    logger.error('[CACHE_CLEAR]', error);
    vscode.window.showErrorMessage(errorMessage);
  }
}

/**
 * Command to show current cache statistics
 */
export async function showCacheStats(): Promise<void> {
  try {
    // Access global factory if available
    const factory = (global as any).foundationFactory;
    const preloader = (global as any).agentPreloader;
    
    if (!factory) {
      vscode.window.showInformationMessage('Foundation agents not yet initialized. Try again after initialization completes.');
      return;
    }

    const stats = factory.getOptimizationStats();
    const preloaderStatus = preloader?.getStatus() || null;
    
    let message = `📊 Foundation Agent Cache Statistics:\n\n`;
    message += `💾 Cache Entries: ${stats.cacheMetrics.cacheSize}\n`;
    message += `🎯 Hit Rate: ${(stats.cacheMetrics.hitRate * 100).toFixed(1)}%\n`;
    message += `📈 Total Requests: ${stats.cacheMetrics.totalCacheHits + stats.cacheMetrics.totalCacheMisses}\n`;
    message += `⚡ Average Init Time: ${Math.round(stats.performanceMetrics.averageInitTime)}ms\n`;
    message += `📊 Total Initializations: ${stats.performanceMetrics.totalInitializations}\n\n`;
    
    if (preloaderStatus) {
      message += `🚀 Preloader Status:\n`;
      message += `  Strategy: ${preloaderStatus.strategy}\n`;
      message += `  Preloaded Agents: ${preloaderStatus.preloadedAgents.length}\n`;
      message += `  Est. Time Saved: ${Math.round(preloaderStatus.metrics.userBenefit)}ms\n\n`;
    }

    if (stats.performanceMetrics.slowestAgent) {
      message += `🐌 Slowest Agent: ${stats.performanceMetrics.slowestAgent.type} (${Math.round(stats.performanceMetrics.slowestAgent.time)}ms)\n`;
    }

    vscode.window.showInformationMessage(message, { modal: true });
    logger.info('[CACHE_STATS] Cache statistics displayed to user');

  } catch (error) {
    const errorMessage = `Failed to show cache stats: ${error instanceof Error ? error.message : String(error)}`;
    logger.error('[CACHE_STATS]', error);
    vscode.window.showErrorMessage(errorMessage);
  }
}