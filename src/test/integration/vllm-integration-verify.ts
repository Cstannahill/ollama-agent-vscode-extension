/**
 * vLLM Integration Verification Script
 * 
 * Simple verification script to test the complete vLLM integration
 * without requiring a full test framework setup.
 */

import { VLLMLLM } from '../../api/vllm';
import { OllamaLLM } from '../../api/ollama';
import { LLMRouter, ProviderConfig, RoutingPreferences } from '../../api/llm-router';
import { ProviderOptimizer } from '../../core/foundation/adapters/ProviderOptimizer';
import { PerformanceMonitor } from '../../core/monitoring/PerformanceMonitor';
import { HealthCheckService } from '../../core/monitoring/HealthCheckService';
import { MonitoringManager } from '../../core/monitoring/MonitoringManager';
import { logger } from '../../utils/logger';

// Test configuration
const TEST_CONFIG = {
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2:3b'
  },
  vllm: {
    baseUrl: 'http://localhost:11435',
    model: 'microsoft/DialoGPT-medium'
  }
};

interface TestResult {
  name: string;
  success: boolean;
  message: string;
  duration?: number;
}

class VLLMIntegrationVerifier {
  private results: TestResult[] = [];
  private ollamaLLM: OllamaLLM;
  private vllmLLM: VLLMLLM;
  private router?: LLMRouter;
  private optimizer?: ProviderOptimizer;
  private monitoringManager?: MonitoringManager;

  constructor() {
    this.ollamaLLM = new OllamaLLM(TEST_CONFIG.ollama);
    this.vllmLLM = new VLLMLLM(TEST_CONFIG.vllm);
  }

  async runVerification(): Promise<TestResult[]> {
    console.log('🚀 Starting vLLM Integration Verification...\n');

    // Basic service availability tests
    await this.testOllamaAvailability();
    await this.testVLLMAvailability();

    // Only continue if at least one service is available
    const serviceAvailable = this.results.some(r => r.success && r.name.includes('Availability'));
    
    if (serviceAvailable) {
      await this.setupRouter();
      await this.testRouterFunctionality();
      await this.testProviderOptimization();
      await this.testMonitoringSystem();
      await this.testEndToEndWorkflow();
    } else {
      this.addResult({
        name: 'Service Setup',
        success: false,
        message: 'Neither Ollama nor vLLM services are available - skipping advanced tests'
      });
    }

    this.printSummary();
    return this.results;
  }

  private async testOllamaAvailability(): Promise<void> {
    const startTime = Date.now();
    try {
      const available = await this.ollamaLLM.isAvailable();
      const duration = Date.now() - startTime;
      
      this.addResult({
        name: 'Ollama Availability',
        success: available,
        message: available ? 'Ollama server is responsive' : 'Ollama server is not available',
        duration
      });

      if (available) {
        try {
          const models = await this.ollamaLLM.listModels();
          this.addResult({
            name: 'Ollama Models',
            success: models.length > 0,
            message: `Found ${models.length} models: ${models.slice(0, 3).join(', ')}`
          });
        } catch (error) {
          this.addResult({
            name: 'Ollama Models',
            success: false,
            message: `Failed to list models: ${error}`
          });
        }
      }
    } catch (error) {
      this.addResult({
        name: 'Ollama Availability',
        success: false,
        message: `Connection failed: ${error}`,
        duration: Date.now() - startTime
      });
    }
  }

  private async testVLLMAvailability(): Promise<void> {
    const startTime = Date.now();
    try {
      const available = await this.vllmLLM.isAvailable();
      const duration = Date.now() - startTime;
      
      this.addResult({
        name: 'vLLM Availability',
        success: available,
        message: available ? 'vLLM server is responsive' : 'vLLM server is not available',
        duration
      });

      if (available) {
        try {
          const models = await this.vllmLLM.listModels();
          this.addResult({
            name: 'vLLM Models',
            success: models.length > 0,
            message: `Found ${models.length} models: ${models.slice(0, 3).join(', ')}`
          });
        } catch (error) {
          this.addResult({
            name: 'vLLM Models',
            success: false,
            message: `Failed to list models: ${error}`
          });
        }
      }
    } catch (error) {
      this.addResult({
        name: 'vLLM Availability',
        success: false,
        message: `Connection failed: ${error}`,
        duration: Date.now() - startTime
      });
    }
  }

  private async setupRouter(): Promise<void> {
    try {
      const providerConfig: ProviderConfig = {
        ollama: TEST_CONFIG.ollama,
        vllm: TEST_CONFIG.vllm
      };

      const routingPreferences: RoutingPreferences = {
        chatPreference: 'ollama',
        embeddingPreference: 'vllm',
        toolCallingPreference: 'ollama',
        batchProcessingPreference: 'vllm',
        preferSpeed: true,
        preferAccuracy: false,
        smallModelThreshold: '7b',
        largeModelThreshold: '13b',
        enableFallback: true,
        fallbackTimeout: 10000
      };

      this.router = new LLMRouter(providerConfig, routingPreferences);
      this.optimizer = new ProviderOptimizer(this.router);

      const performanceMonitor = new PerformanceMonitor(this.router, this.optimizer);
      this.monitoringManager = new MonitoringManager(
        this.ollamaLLM, 
        this.vllmLLM, 
        this.router, 
        this.optimizer
      );

      await this.monitoringManager.initialize();

      this.addResult({
        name: 'Router Setup',
        success: true,
        message: 'LLM Router and monitoring systems initialized successfully'
      });
    } catch (error) {
      this.addResult({
        name: 'Router Setup',
        success: false,
        message: `Failed to setup router: ${error}`
      });
    }
  }

  private async testRouterFunctionality(): Promise<void> {
    if (!this.router) {
      this.addResult({
        name: 'Router Functionality',
        success: false,
        message: 'Router not available for testing'
      });
      return;
    }

    try {
      // Test chat routing
      const { provider: chatProvider, decision: chatDecision } = await this.router.getChatModel('interactive_chat');
      this.addResult({
        name: 'Chat Routing',
        success: !!chatProvider,
        message: `Routed to ${chatDecision.provider}: ${chatDecision.reason} (confidence: ${chatDecision.confidence.toFixed(2)})`
      });

      // Test generation routing
      const { provider: genProvider, decision: genDecision } = await this.router.getLLM('batch_processing');
      this.addResult({
        name: 'Generation Routing',
        success: !!genProvider,
        message: `Routed to ${genDecision.provider}: ${genDecision.reason} (confidence: ${genDecision.confidence.toFixed(2)})`
      });

      // Test provider status
      const providerStatus = await this.router.getProviderStatus();
      const statusEntries = Array.from(providerStatus.entries());
      this.addResult({
        name: 'Provider Status',
        success: statusEntries.length > 0,
        message: `Provider status: ${statusEntries.map(([p, s]) => `${p}=${s}`).join(', ')}`
      });

    } catch (error) {
      this.addResult({
        name: 'Router Functionality',
        success: false,
        message: `Router tests failed: ${error}`
      });
    }
  }

  private async testProviderOptimization(): Promise<void> {
    if (!this.optimizer) {
      this.addResult({
        name: 'Provider Optimization',
        success: false,
        message: 'Optimizer not available for testing'
      });
      return;
    }

    try {
      // Test stage optimization
      const retrievalOpt = this.optimizer.getStageOptimization('retrieval');
      this.addResult({
        name: 'Stage Optimization',
        success: !!retrievalOpt,
        message: retrievalOpt 
          ? `Retrieval stage → ${retrievalOpt.recommendedProvider} (${retrievalOpt.reason})`
          : 'No optimization found for retrieval stage'
      });

      // Test batch optimization
      const stages = ['retrieval', 'reranking', 'tool_selection'];
      const optimizations = await this.optimizer.optimizeBatch(stages);
      this.addResult({
        name: 'Batch Optimization',
        success: optimizations.size === stages.length,
        message: `Optimized ${optimizations.size}/${stages.length} stages`
      });

      // Test performance insights
      const insights = this.optimizer.getPerformanceInsights();
      this.addResult({
        name: 'Performance Insights',
        success: !!insights,
        message: `Generated ${insights.recommendations.length} recommendations, ${insights.bottlenecks.length} bottlenecks identified`
      });

    } catch (error) {
      this.addResult({
        name: 'Provider Optimization',
        success: false,
        message: `Optimization tests failed: ${error}`
      });
    }
  }

  private async testMonitoringSystem(): Promise<void> {
    if (!this.monitoringManager) {
      this.addResult({
        name: 'Monitoring System',
        success: false,
        message: 'Monitoring manager not available for testing'
      });
      return;
    }

    try {
      // Test monitoring status
      const status = await this.monitoringManager.getMonitoringStatus();
      this.addResult({
        name: 'Monitoring Status',
        success: !!status,
        message: `Performance monitoring: ${status.performanceMonitoring.active ? 'ON' : 'OFF'}, Health checks: ${status.healthChecking.active ? 'ON' : 'OFF'}`
      });

      // Test system health
      const systemHealth = await this.monitoringManager.getSystemHealth();
      this.addResult({
        name: 'System Health',
        success: !!systemHealth,
        message: `Overall health: ${systemHealth.overall}, Services: ${systemHealth.services.length}, Alerts: ${systemHealth.alerts.length}`
      });

      // Test performance insights
      const performanceInsights = this.monitoringManager.getPerformanceInsights();
      this.addResult({
        name: 'Performance Insights',
        success: !!performanceInsights,
        message: `Overall health: ${performanceInsights.overallHealth}, Recommendations: ${performanceInsights.recommendations.length}`
      });

    } catch (error) {
      this.addResult({
        name: 'Monitoring System',
        success: false,
        message: `Monitoring tests failed: ${error}`
      });
    }
  }

  private async testEndToEndWorkflow(): Promise<void> {
    if (!this.router) {
      this.addResult({
        name: 'End-to-End Workflow',
        success: false,
        message: 'Router not available for end-to-end test'
      });
      return;
    }

    try {
      const startTime = Date.now();
      const testPrompt = "Hello, this is a test prompt for integration verification.";

      // Get provider through router
      const { provider: llmProvider, decision } = await this.router.getLLM('test_generation');
      
      // Generate text
      const result = await llmProvider.generateText(testPrompt);
      const duration = Date.now() - startTime;

      // Record performance metric
      if (this.monitoringManager) {
        this.monitoringManager.recordPerformanceMetric(
          decision.provider,
          'integration_test',
          duration,
          true,
          { tokenCount: result.length }
        );
      }

      this.addResult({
        name: 'End-to-End Workflow',
        success: result.length > 0,
        message: `Generated ${result.length} characters via ${decision.provider} in ${duration}ms`,
        duration
      });

    } catch (error) {
      this.addResult({
        name: 'End-to-End Workflow',
        success: false,
        message: `End-to-end test failed: ${error}`
      });
    }
  }

  private addResult(result: TestResult): void {
    this.results.push(result);
    const status = result.success ? '✅' : '❌';
    const duration = result.duration ? ` (${result.duration}ms)` : '';
    console.log(`${status} ${result.name}: ${result.message}${duration}`);
  }

  private printSummary(): void {
    const successful = this.results.filter(r => r.success).length;
    const total = this.results.length;
    
    console.log('\n📊 Verification Summary:');
    console.log(`✅ Successful: ${successful}/${total}`);
    console.log(`❌ Failed: ${total - successful}/${total}`);
    console.log(`📈 Success Rate: ${((successful / total) * 100).toFixed(1)}%`);
    
    if (total - successful > 0) {
      console.log('\n⚠️  Failed Tests:');
      this.results
        .filter(r => !r.success)
        .forEach(r => console.log(`   • ${r.name}: ${r.message}`));
    }
    
    console.log('\n🎯 Integration Verification Complete!');
  }
}

// Export for use in other contexts
export { VLLMIntegrationVerifier, TestResult };

// Run verification if this file is executed directly
if (require.main === module) {
  const verifier = new VLLMIntegrationVerifier();
  verifier.runVerification().catch(error => {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  });
}