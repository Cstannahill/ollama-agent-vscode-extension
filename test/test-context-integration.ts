/**
 * End-to-End Context Integration Test
 *
 * Tests the complete flow: Query → Expand → Retrieve → Rerank → Score → Plan → Reason → Generate Actions → Validate → Evaluate
 * with enhanced context system integration throughout the pipeline.
 */

import { FoundationPipeline } from "../src/core/foundation/FoundationPipeline";
import { FoundationAgentFactory } from "../src/core/foundation/FoundationAgentFactory";
import { ContextManager } from "../src/core/ContextManager";
import { VectorDatabase } from "../src/documentation/VectorDatabase";
import { SemanticWorkflowEngine } from "../src/core/SemanticWorkflowEngine";
import { logger } from "../src/utils/logger";

interface ContextIntegrationTestResult {
  testName: string;
  success: boolean;
  pipelineResult?: any;
  contextInsights?: any;
  error?: string;
  metrics: {
    contextItemsRetrieved: number;
    semanticContextInitialized: boolean;
    contextConfidenceScore: number;
    stagesCompleted: number;
    totalDuration: number;
  };
}

/**
 * Comprehensive Context Integration Test Suite
 */
export class ContextIntegrationTest {
  private contextManager: ContextManager;
  private vectorDatabase: VectorDatabase;
  private semanticWorkflow: SemanticWorkflowEngine;
  private foundationPipeline?: FoundationPipeline;

  constructor() {
    this.contextManager = ContextManager.getInstance();
    this.vectorDatabase = VectorDatabase.getInstance();
    this.semanticWorkflow = SemanticWorkflowEngine.getInstance();
  }

  /**
   * Initialize test environment
   */
  async initialize(): Promise<void> {
    try {
      logger.info(
        "[CONTEXT_TEST] Initializing context integration test environment..."
      );

      // Initialize core systems
      await this.contextManager.initialize();
      await this.vectorDatabase.initialize();
      await this.semanticWorkflow.initialize();

      // Create foundation pipeline with context dependencies
      const factory = new FoundationAgentFactory({
        ollamaUrl: "http://localhost:11434",
        model: "llama3.2:3b",
        contextManager: this.contextManager,
        vectorDatabase: this.vectorDatabase,
      });

      const agents = await factory.createAgents();
      await factory.initializeAgents();

      this.foundationPipeline = new FoundationPipeline(agents, {
        enableParallelProcessing: true,
        maxConcurrency: 3,
        timeoutMs: 30000,
        retryAttempts: 1,
        // Agent configs with reasonable defaults for testing
        retriever: {
          modelSize: "0.1-1B",
          temperature: 0.1,
          maxTokens: 1000,
          timeout: 15000,
        },
        reranker: {
          modelSize: "1-3B",
          temperature: 0.05,
          maxTokens: 100,
          timeout: 10000,
        },
        toolSelector: {
          modelSize: "1-7B",
          temperature: 0.2,
          maxTokens: 500,
          timeout: 15000,
        },
        critic: {
          modelSize: "1-3B",
          temperature: 0.3,
          maxTokens: 800,
          timeout: 20000,
        },
        taskPlanner: {
          modelSize: "1-7B",
          temperature: 0.4,
          maxTokens: 1500,
          timeout: 25000,
        },
        queryRewriter: {
          modelSize: "0.5-2B",
          temperature: 0.3,
          maxTokens: 400,
          timeout: 10000,
        },
        cotGenerator: {
          modelSize: "1-3B",
          temperature: 0.4,
          maxTokens: 1200,
          timeout: 20000,
        },
        chunkScorer: {
          modelSize: "0.5-2B",
          temperature: 0.1,
          maxTokens: 200,
          timeout: 10000,
        },
        actionCaller: {
          modelSize: "1-3B",
          temperature: 0.2,
          maxTokens: 600,
          timeout: 15000,
        },
        embedder: {
          modelSize: "0.1-1B",
          temperature: 0.0,
          maxTokens: 1,
          timeout: 5000,
        },
      });

      await this.foundationPipeline.initialize();

      logger.info("[CONTEXT_TEST] Test environment initialized successfully");
    } catch (error) {
      logger.error(
        "[CONTEXT_TEST] Failed to initialize test environment:",
        error
      );
      throw error;
    }
  }

  /**
   * Run comprehensive context integration tests
   */
  async runTests(): Promise<ContextIntegrationTestResult[]> {
    const results: ContextIntegrationTestResult[] = [];

    // Wait for initialization
    if (!this.foundationPipeline) {
      await this.initialize();
    }

    const testCases = [
      {
        name: "Basic Context Integration",
        query: "Analyze the code structure and suggest improvements",
        workspaceContext: {
          language: "typescript",
          projectType: "vscode-extension",
        },
      },
      {
        name: "Documentation-Enhanced Reasoning",
        query:
          "How should I implement error handling in this TypeScript project?",
        workspaceContext: { hasErrorHandling: false, usesPromises: true },
      },
      {
        name: "Multi-Context Task Planning",
        query: "Create a comprehensive test suite for the agent system",
        workspaceContext: { testFramework: "jest", hasExistingTests: true },
      },
      {
        name: "Semantic Context Retrieval",
        query:
          "Optimize the memory usage and performance of the context manager",
        workspaceContext: {
          performanceIssues: ["memory", "search"],
          currentOptimizations: [],
        },
      },
    ];

    for (const testCase of testCases) {
      try {
        logger.info(`[CONTEXT_TEST] Running test: ${testCase.name}`);
        const result = await this.runSingleTest(
          testCase.name,
          testCase.query,
          testCase.workspaceContext
        );
        results.push(result);

        // Brief pause between tests
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`[CONTEXT_TEST] Test failed: ${testCase.name}:`, error);
        results.push({
          testName: testCase.name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          metrics: {
            contextItemsRetrieved: 0,
            semanticContextInitialized: false,
            contextConfidenceScore: 0,
            stagesCompleted: 0,
            totalDuration: 0,
          },
        });
      }
    }

    return results;
  }

  /**
   * Run a single context integration test
   */
  private async runSingleTest(
    testName: string,
    query: string,
    workspaceContext: any
  ): Promise<ContextIntegrationTestResult> {
    const startTime = Date.now();

    try {
      // Test semantic workflow integration
      const semanticResult =
        await this.semanticWorkflow.executeWithFoundationPipeline(
          query,
          this.foundationPipeline!,
          workspaceContext,
          this.getMockAvailableTools()
        );

      const duration = Date.now() - startTime;

      // Analyze results
      const success = this.evaluateTestSuccess(semanticResult);

      return {
        testName,
        success,
        pipelineResult: semanticResult.pipelineResult,
        contextInsights: semanticResult.contextInsights,
        metrics: {
          contextItemsRetrieved:
            semanticResult.workflowResult.contextItems.length,
          semanticContextInitialized:
            semanticResult.pipelineResult.confidence > 0.1,
          contextConfidenceScore: semanticResult.pipelineResult.confidence,
          stagesCompleted: semanticResult.pipelineResult.stagesCompleted.length,
          totalDuration: duration,
        },
      };
    } catch (error) {
      return {
        testName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metrics: {
          contextItemsRetrieved: 0,
          semanticContextInitialized: false,
          contextConfidenceScore: 0,
          stagesCompleted: 0,
          totalDuration: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Evaluate whether a test was successful
   */
  private evaluateTestSuccess(semanticResult: any): boolean {
    const { pipelineResult, workflowResult, contextInsights } = semanticResult;

    // Success criteria
    const criteria = {
      minConfidence: 0.4,
      minStagesCompleted: 6,
      minContextItems: 1,
      maxErrors: 2,
      maxDuration: 60000, // 60 seconds
    };

    const checks = [
      pipelineResult.confidence >= criteria.minConfidence,
      pipelineResult.stagesCompleted.length >= criteria.minStagesCompleted,
      workflowResult.contextItems.length >= criteria.minContextItems,
      pipelineResult.errors.length <= criteria.maxErrors,
      pipelineResult.duration <= criteria.maxDuration,
    ];

    const passed = checks.filter((check) => check).length;
    const passRate = passed / checks.length;

    logger.debug(
      `[CONTEXT_TEST] Test success evaluation: ${passed}/${
        checks.length
      } criteria passed (${(passRate * 100).toFixed(1)}%)`
    );

    return passRate >= 0.6; // 60% pass rate required
  }

  /**
   * Get mock available tools for testing
   */
  private getMockAvailableTools(): any[] {
    return [
      { id: "file_read", name: "File Reader", category: "file_operations" },
      { id: "file_write", name: "File Writer", category: "file_operations" },
      {
        id: "shell_execute",
        name: "Shell Executor",
        category: "shell_commands",
      },
      { id: "git_status", name: "Git Status", category: "git_operations" },
      {
        id: "content_search",
        name: "Content Search",
        category: "search_operations",
      },
      { id: "lint_check", name: "Lint Checker", category: "code_analysis" },
      { id: "test_run", name: "Test Runner", category: "code_analysis" },
      {
        id: "doc_generate",
        name: "Documentation Generator",
        category: "documentation",
      },
    ];
  }

  /**
   * Generate test report
   */
  generateReport(results: ContextIntegrationTestResult[]): string {
    const totalTests = results.length;
    const passedTests = results.filter((r) => r.success).length;
    const failedTests = totalTests - passedTests;

    const avgConfidence =
      results
        .filter((r) => r.success)
        .reduce((sum, r) => sum + r.metrics.contextConfidenceScore, 0) /
      (passedTests || 1);

    const avgStages =
      results
        .filter((r) => r.success)
        .reduce((sum, r) => sum + r.metrics.stagesCompleted, 0) /
      (passedTests || 1);

    const avgDuration =
      results.reduce((sum, r) => sum + r.metrics.totalDuration, 0) / totalTests;

    let report = `
📊 **Context Integration Test Report**
=====================================

**Overall Results:**
- Total Tests: ${totalTests}
- Passed: ${passedTests} ✅
- Failed: ${failedTests} ❌
- Pass Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%

**Performance Metrics:**
- Average Confidence: ${avgConfidence.toFixed(3)}
- Average Stages Completed: ${avgStages.toFixed(1)}
- Average Duration: ${avgDuration.toFixed(0)}ms

**Detailed Results:**
`;

    results.forEach((result, index) => {
      const status = result.success ? "✅ PASS" : "❌ FAIL";
      report += `
${index + 1}. **${result.testName}** - ${status}
   - Context Items: ${result.metrics.contextItemsRetrieved}
   - Confidence: ${result.metrics.contextConfidenceScore.toFixed(3)}
   - Stages: ${result.metrics.stagesCompleted}
   - Duration: ${result.metrics.totalDuration}ms`;

      if (result.error) {
        report += `\n   - Error: ${result.error}`;
      }
    });

    report += `

**Context System Status:**
- Context Manager: ${this.contextManager ? "✅ Active" : "❌ Inactive"}
- Vector Database: ${this.vectorDatabase ? "✅ Active" : "❌ Inactive"}
- Foundation Pipeline: ${this.foundationPipeline ? "✅ Active" : "❌ Inactive"}
- Semantic Workflow: ${this.semanticWorkflow ? "✅ Active" : "❌ Inactive"}

**Recommendations:**
${this.generateRecommendations(results)}
`;

    return report;
  }

  /**
   * Generate recommendations based on test results
   */
  private generateRecommendations(
    results: ContextIntegrationTestResult[]
  ): string {
    const recommendations: string[] = [];

    const avgConfidence =
      results
        .filter((r) => r.success)
        .reduce((sum, r) => sum + r.metrics.contextConfidenceScore, 0) /
      results.length;

    if (avgConfidence < 0.6) {
      recommendations.push(
        "• Consider enhancing context retrieval algorithms for better relevance"
      );
    }

    const avgContextItems =
      results.reduce((sum, r) => sum + r.metrics.contextItemsRetrieved, 0) /
      results.length;

    if (avgContextItems < 3) {
      recommendations.push(
        "• Expand context sources or improve search strategies"
      );
    }

    const failedTests = results.filter((r) => !r.success);
    if (failedTests.length > 0) {
      recommendations.push("• Investigate failed tests for systematic issues");
    }

    if (recommendations.length === 0) {
      recommendations.push(
        "• Context integration is performing well - consider advanced optimizations"
      );
    }

    return recommendations.join("\n");
  }
}

/**
 * Run context integration tests
 */
export async function runContextIntegrationTests(): Promise<void> {
  try {
    logger.info(
      "[CONTEXT_TEST] Starting comprehensive context integration tests..."
    );

    const tester = new ContextIntegrationTest();
    const results = await tester.runTests();
    const report = tester.generateReport(results);

    console.log(report);
    logger.info("[CONTEXT_TEST] Context integration tests completed");
  } catch (error) {
    logger.error("[CONTEXT_TEST] Context integration tests failed:", error);
    throw error;
  }
}

// Types and test runner are exported above
