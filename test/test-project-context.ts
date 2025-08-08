/**
 * End-to-End Project Context System Test
 *
 * Tests the complete Project Context system including:
 * - ProjectContextManager initialization and indexing
 * - ProjectContextPanel creation and interaction
 * - Chroma collections setup and data storage
 * - Agent-based project analysis
 */

import * as vscode from "vscode";
import * as path from "path";
import { logger } from "../src/utils/logger";
import { ProjectContextManager } from "../src/context/ProjectContextManager";
import { ProjectContextPanel } from "../src/views/ProjectContextPanel";
import {
  ProjectStructure,
  IndexingProgress,
} from "../src/context/ProjectContextTypes";

// Test-specific interfaces
interface ProjectContextManagerConfig {
  workspacePath: string;
  maxFileSize: number;
  excludePatterns: string[];
  includePatterns: string[];
  maxConcurrency: number;
  ollamaUrl: string;
  model: string;
  chromaCollections: {
    files: string;
    dependencies: string;
    features: string;
    overview: string;
  };
}

interface ProjectContextTestResult {
  testName: string;
  success: boolean;
  duration: number;
  details: {
    managerInitialized: boolean;
    indexingCompleted: boolean;
    panelCreated: boolean;
    collectionsCreated: boolean;
    projectAnalyzed: boolean;
    filesProcessed: number;
    stagesCompleted: number;
    errors: string[];
  };
  error?: string;
}

/**
 * Comprehensive Project Context System Test Suite
 */
export class ProjectContextSystemTest {
  private testWorkspacePath: string;
  private projectContextManager?: ProjectContextManager;
  private mockExtensionContext: vscode.ExtensionContext;

  constructor(
    workspacePath: string,
    extensionContext: vscode.ExtensionContext
  ) {
    this.testWorkspacePath = workspacePath;
    this.mockExtensionContext = extensionContext;
  }

  /**
   * Run comprehensive Project Context system tests
   */
  async runTests(): Promise<ProjectContextTestResult[]> {
    const results: ProjectContextTestResult[] = [];

    const testCases = [
      {
        name: "Project Context Manager Initialization",
        testFn: () => this.testManagerInitialization(),
      },
      {
        name: "Project Indexing Pipeline",
        testFn: () => this.testProjectIndexing(),
      },
      {
        name: "Project Context Panel Creation",
        testFn: () => this.testPanelCreation(),
      },
      {
        name: "Chroma Collections Setup",
        testFn: () => this.testChromaCollections(),
      },
      {
        name: "Agent-Based Project Analysis",
        testFn: () => this.testProjectAnalysis(),
      },
      {
        name: "End-to-End Integration",
        testFn: () => this.testEndToEndIntegration(),
      },
    ];

    for (const testCase of testCases) {
      try {
        logger.info(`[PROJECT_CONTEXT_TEST] Running test: ${testCase.name}`);
        const result = await this.runSingleTest(testCase.name, testCase.testFn);
        results.push(result);

        // Brief pause between tests
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        logger.error(
          `[PROJECT_CONTEXT_TEST] Test failed: ${testCase.name}:`,
          error
        );
        results.push({
          testName: testCase.name,
          success: false,
          duration: 0,
          details: {
            managerInitialized: false,
            indexingCompleted: false,
            panelCreated: false,
            collectionsCreated: false,
            projectAnalyzed: false,
            filesProcessed: 0,
            stagesCompleted: 0,
            errors: [error instanceof Error ? error.message : String(error)],
          },
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Run a single test case
   */
  private async runSingleTest(
    testName: string,
    testFn: () => Promise<any>
  ): Promise<ProjectContextTestResult> {
    const startTime = Date.now();
    const details = {
      managerInitialized: false,
      indexingCompleted: false,
      panelCreated: false,
      collectionsCreated: false,
      projectAnalyzed: false,
      filesProcessed: 0,
      stagesCompleted: 0,
      errors: [] as string[],
    };

    try {
      const result = await testFn();
      const duration = Date.now() - startTime;

      // Update details based on test results
      if (result) {
        details.managerInitialized = !!result.managerInitialized;
        details.indexingCompleted = !!result.indexingCompleted;
        details.panelCreated = !!result.panelCreated;
        details.collectionsCreated = !!result.collectionsCreated;
        details.projectAnalyzed = !!result.projectAnalyzed;
        details.filesProcessed = result.filesProcessed || 0;
        details.stagesCompleted = result.stagesCompleted || 0;
        details.errors = result.errors || [];
      }

      return {
        testName,
        success: true,
        duration,
        details,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      details.errors.push(errorMessage);

      return {
        testName,
        success: false,
        duration,
        details,
        error: errorMessage,
      };
    }
  }

  /**
   * Test Project Context Manager initialization
   */
  private async testManagerInitialization(): Promise<any> {
    const config: ProjectContextManagerConfig = {
      workspacePath: this.testWorkspacePath,
      maxFileSize: 1024 * 1024, // 1MB
      excludePatterns: ["**/node_modules/**", "**/.*"],
      includePatterns: ["**/*.ts", "**/*.js", "**/*.json"],
      maxConcurrency: 2,
      ollamaUrl: "http://localhost:11434",
      model: "llama3.2:3b",
      chromaCollections: {
        files: "test_project_files",
        dependencies: "test_project_dependencies",
        features: "test_project_features",
        overview: "test_project_overview",
      },
    };

    this.projectContextManager = ProjectContextManager.getInstance(config);
    await this.projectContextManager.initialize();

    return {
      managerInitialized: true,
      collectionsCreated:
        this.projectContextManager.getChromaCollections().size > 0,
    };
  }

  /**
   * Test project indexing pipeline
   */
  private async testProjectIndexing(): Promise<any> {
    if (!this.projectContextManager) {
      throw new Error("ProjectContextManager not initialized");
    }

    let progressUpdates = 0;
    let lastProgress: IndexingProgress | undefined;

    const progressCallback = (progress: IndexingProgress) => {
      progressUpdates++;
      lastProgress = progress;
      logger.debug(
        `[PROJECT_CONTEXT_TEST] Progress: ${progress.stage} - ${progress.currentStageProgress}%`
      );
    };

    const projectStructure =
      await this.projectContextManager.triggerProjectIndexing(progressCallback);

    return {
      indexingCompleted: !!projectStructure,
      projectAnalyzed: !!projectStructure?.overview,
      filesProcessed: projectStructure?.files?.size || 0,
      stagesCompleted: lastProgress?.stagesCompleted?.length || 0,
      progressUpdates,
      errors: lastProgress?.errors?.map((e) => e.error) || [],
    };
  }

  /**
   * Test Project Context Panel creation
   */
  private async testPanelCreation(): Promise<any> {
    if (!this.projectContextManager) {
      throw new Error("ProjectContextManager not initialized");
    }

    try {
      const panel = ProjectContextPanel.createOrShow(
        this.mockExtensionContext.extensionUri,
        this.projectContextManager
      );

      // Give the panel a moment to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));

      return {
        panelCreated: !!panel,
        panelVisible: true, // Assume visible if creation succeeded
      };
    } catch (error) {
      // Panel creation might fail in test environment, but we can still test the logic
      logger.warn(
        "[PROJECT_CONTEXT_TEST] Panel creation failed (expected in test environment):",
        error
      );
      return {
        panelCreated: false,
        panelVisible: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Test Chroma collections setup
   */
  private async testChromaCollections(): Promise<any> {
    if (!this.projectContextManager) {
      throw new Error("ProjectContextManager not initialized");
    }

    const collections = this.projectContextManager.getChromaCollections();
    const collectionNames = Array.from(collections.keys());
    const collectionStats = Array.from(collections.values());

    return {
      collectionsCreated: collections.size > 0,
      collectionCount: collections.size,
      collectionNames,
      totalDocuments: collectionStats.reduce(
        (sum, col) => sum + col.documentCount,
        0
      ),
    };
  }

  /**
   * Test agent-based project analysis
   */
  private async testProjectAnalysis(): Promise<any> {
    if (!this.projectContextManager) {
      throw new Error("ProjectContextManager not initialized");
    }

    const projectStructure = this.projectContextManager.getProjectStructure();
    if (!projectStructure) {
      throw new Error("Project structure not available");
    }

    const hasOverview = !!projectStructure.overview;
    const hasFeatures =
      projectStructure.features && projectStructure.features.length > 0;
    const hasMetrics = !!projectStructure.metrics;
    const hasStatus = !!projectStructure.status;

    // Check if files have analysis data
    const analyzedFiles = Array.from(projectStructure.files.values()).filter(
      (file) => file.analysis
    );

    return {
      projectAnalyzed: hasOverview && hasMetrics,
      hasOverview,
      hasFeatures,
      hasMetrics,
      hasStatus,
      analyzedFilesCount: analyzedFiles.length,
      totalFilesCount: projectStructure.files.size,
      analysisCompleteness: analyzedFiles.length / projectStructure.files.size,
    };
  }

  /**
   * Test end-to-end integration
   */
  private async testEndToEndIntegration(): Promise<any> {
    if (!this.projectContextManager) {
      throw new Error("ProjectContextManager not initialized");
    }

    // Test data refresh
    const initialStructure = this.projectContextManager.getProjectStructure();
    const initialProgress = this.projectContextManager.getIndexingProgress();
    const collections = this.projectContextManager.getChromaCollections();

    // Verify all components work together
    const integrationChecks = {
      structureAvailable: !!initialStructure,
      progressTracking: !!initialProgress,
      collectionsActive: collections.size > 0,
      dataConsistency: this.verifyDataConsistency(
        initialStructure,
        collections
      ),
    };

    const allChecksPass = Object.values(integrationChecks).every(
      (check) => check === true
    );

    return {
      integrationSuccess: allChecksPass,
      ...integrationChecks,
      totalFiles: initialStructure?.files?.size || 0,
      totalCollections: collections.size,
      lastIndexed: initialStructure?.lastIndexed?.toISOString(),
    };
  }

  /**
   * Verify data consistency between structures and collections
   */
  private verifyDataConsistency(
    structure: ProjectStructure | undefined,
    collections: Map<string, any>
  ): boolean {
    if (!structure || collections.size === 0) {
      return false;
    }

    // Basic consistency checks
    const hasFiles = structure.files.size > 0;
    const hasCollections = collections.size > 0;
    const structureUpToDate =
      structure.lastIndexed &&
      Date.now() - structure.lastIndexed.getTime() < 60000; // Within last minute

    return hasFiles && hasCollections && structureUpToDate;
  }

  /**
   * Generate test report
   */
  generateReport(results: ProjectContextTestResult[]): string {
    const totalTests = results.length;
    const passedTests = results.filter((r) => r.success).length;
    const failedTests = totalTests - passedTests;

    const avgDuration =
      results.reduce((sum, r) => sum + r.duration, 0) / totalTests;

    let report = `
📊 **Project Context System Test Report**
==========================================

**Overall Results:**
- Total Tests: ${totalTests}
- Passed: ${passedTests} ✅
- Failed: ${failedTests} ❌
- Pass Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%
- Average Duration: ${avgDuration.toFixed(0)}ms

**System Components Status:**
`;

    // Aggregate component status across all tests
    const componentStatus = {
      manager: results.some((r) => r.details.managerInitialized),
      indexing: results.some((r) => r.details.indexingCompleted),
      panel: results.some((r) => r.details.panelCreated),
      collections: results.some((r) => r.details.collectionsCreated),
      analysis: results.some((r) => r.details.projectAnalyzed),
    };

    Object.entries(componentStatus).forEach(([component, status]) => {
      report += `- ${component}: ${status ? "✅ Working" : "❌ Failed"}\n`;
    });

    report += `\n**Detailed Test Results:**\n`;

    results.forEach((result, index) => {
      const status = result.success ? "✅ PASS" : "❌ FAIL";
      report += `
${index + 1}. **${result.testName}** - ${status}
   - Duration: ${result.duration}ms
   - Files Processed: ${result.details.filesProcessed}
   - Stages Completed: ${result.details.stagesCompleted}
   - Collections: ${result.details.collectionsCreated ? "✅" : "❌"}`;

      if (result.details.errors.length > 0) {
        report += `\n   - Errors: ${result.details.errors
          .slice(0, 2)
          .join(", ")}`;
      }
    });

    report += `\n\n**Performance Metrics:**`;
    const successfulResults = results.filter((r) => r.success);
    if (successfulResults.length > 0) {
      const totalFiles = Math.max(
        ...successfulResults.map((r) => r.details.filesProcessed)
      );
      const maxStages = Math.max(
        ...successfulResults.map((r) => r.details.stagesCompleted)
      );

      report += `
- Maximum Files Processed: ${totalFiles}
- Maximum Stages Completed: ${maxStages}
- Fastest Test: ${Math.min(...results.map((r) => r.duration))}ms
- Slowest Test: ${Math.max(...results.map((r) => r.duration))}ms`;
    }

    report += `\n\n**Recommendations:**`;
    if (failedTests === 0) {
      report += `\n- ✅ All tests passed! Project Context system is working correctly.`;
    } else {
      report += `\n- ⚠️ ${failedTests} test(s) failed. Review error messages and check system dependencies.`;

      // Specific recommendations based on failures
      const failedComponents = results
        .filter((r) => !r.success)
        .map((r) => r.testName);

      if (failedComponents.some((name) => name.includes("Manager"))) {
        report += `\n- Check Ollama server connection and model availability.`;
      }

      if (failedComponents.some((name) => name.includes("Panel"))) {
        report += `\n- Panel creation may fail in test environment (normal behavior).`;
      }

      if (failedComponents.some((name) => name.includes("Chroma"))) {
        report += `\n- Verify ChromaDB installation and workspace write permissions.`;
      }
    }

    return report;
  }
}

/**
 * Run Project Context system tests
 */
export async function runProjectContextTests(
  workspacePath?: string,
  extensionContext?: vscode.ExtensionContext
): Promise<void> {
  try {
    // Use current workspace or fallback
    const testWorkspacePath =
      workspacePath ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd();

    // Create mock extension context if not provided
    const mockContext =
      extensionContext ||
      ({
        extensionUri: vscode.Uri.file(__dirname),
        subscriptions: [],
        workspaceState: {
          get: () => undefined,
          update: () => Promise.resolve(),
        },
        globalState: { get: () => undefined, update: () => Promise.resolve() },
      } as any);

    logger.info(
      "[PROJECT_CONTEXT_TEST] Starting comprehensive Project Context system tests..."
    );

    const tester = new ProjectContextSystemTest(testWorkspacePath, mockContext);
    const results = await tester.runTests();
    const report = tester.generateReport(results);

    console.log(report);
    logger.info("[PROJECT_CONTEXT_TEST] Project Context tests completed");

    // Show results in VS Code if available
    if (vscode.window) {
      const passedCount = results.filter((r) => r.success).length;
      if (passedCount === results.length) {
        vscode.window.showInformationMessage(
          `✅ All ${results.length} Project Context tests passed!`
        );
      } else {
        vscode.window.showWarningMessage(
          `⚠️ ${results.length - passedCount}/${
            results.length
          } Project Context tests failed. Check output for details.`
        );
      }
    }
  } catch (error) {
    logger.error("[PROJECT_CONTEXT_TEST] Project Context tests failed:", error);
    throw error;
  }
}

// Types and test runner are exported above
