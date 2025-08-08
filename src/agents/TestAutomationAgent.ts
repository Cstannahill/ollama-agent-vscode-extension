import { BaseAgent, IAgent, AgentSpecialization, AgentCapability, TaskAnalysis, AgentResponse, ProgressCallback } from "./IAgent";
import { ChatSession, AgentAction } from "../core/ChatSession";
import { ToolManager } from "../core/ToolManager";
import { ContextManager } from "../core/ContextManager";
import { OllamaLLM } from "../api/ollama";
import { PromptBuilder } from "../core/PromptBuilder";
import { logger } from "../utils/logger";
import { AgentConfig } from "./BasicAgent";

export interface TestAutomationConfig {
  preferredFramework: "jest" | "mocha" | "vitest" | "pytest" | "auto";
  generateCoverageReports: boolean;
  testFileNamingPattern: string;
  minCoverageThreshold: number;
  enableE2ETesting: boolean;
  enableUnitTesting: boolean;
  enableIntegrationTesting: boolean;
  testTimeout: number;
  parallelExecution: boolean;
  enableFoundationPipeline?: boolean;
}

export interface TestSuite {
  name: string;
  type: "unit" | "integration" | "e2e";
  files: string[];
  coverage: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

/**
 * Specialized agent for test automation, TDD workflows, and test management
 */
export class TestAutomationAgent extends BaseAgent {
  private llm: OllamaLLM;
  private toolManager: ToolManager;
  private contextManager?: ContextManager;
  private promptBuilder: PromptBuilder;
  private testConfig: TestAutomationConfig;

  constructor(
    private agentConfig: AgentConfig,
    toolManager: ToolManager,
    contextManager?: ContextManager,
    testConfig?: Partial<TestAutomationConfig>
  ) {
    super(AgentSpecialization.TEST_AUTOMATION);
    
    this.toolManager = toolManager;
    this.contextManager = contextManager;
    this.promptBuilder = new PromptBuilder(toolManager);
    
    this.testConfig = {
      preferredFramework: "auto",
      generateCoverageReports: true,
      testFileNamingPattern: "*.test.{ts,js}",
      minCoverageThreshold: 80,
      enableE2ETesting: true,
      enableUnitTesting: true,
      enableIntegrationTesting: true,
      testTimeout: 30000,
      parallelExecution: true,
      ...testConfig
    };

    this.llm = new OllamaLLM({
      baseUrl: agentConfig.ollamaUrl,
      model: agentConfig.model,
      temperature: 0.3, // Moderate temperature for creative test generation
    });
  }

  protected initializeCapabilities(): void {
    this.capabilities = [
      {
        name: "test_execution",
        description: "Execute various types of tests (unit, integration, e2e) using multiple frameworks",
        toolsRequired: ["run_tests"],
        confidenceThreshold: 0.95
      },
      {
        name: "test_generation",
        description: "Generate comprehensive test suites based on code analysis",
        toolsRequired: ["test_generator", "file_read", "file_write"],
        confidenceThreshold: 0.85
      },
      {
        name: "coverage_analysis",
        description: "Analyze test coverage and identify gaps",
        toolsRequired: ["test_coverage", "run_tests"],
        confidenceThreshold: 0.9
      },
      {
        name: "test_maintenance",
        description: "Maintain and refactor existing test suites",
        toolsRequired: ["file_read", "file_write", "test_generator"],
        confidenceThreshold: 0.8
      },
      {
        name: "tdd_workflow",
        description: "Guide test-driven development workflows",
        toolsRequired: ["test_generator", "run_tests", "file_write"],
        confidenceThreshold: 0.85
      },
      {
        name: "test_reporting",
        description: "Generate comprehensive test reports and analytics",
        toolsRequired: ["test_coverage", "run_tests", "file_write"],
        confidenceThreshold: 0.9
      },
      {
        name: "flaky_test_detection",
        description: "Identify and help fix flaky or unreliable tests",
        toolsRequired: ["run_tests", "file_read"],
        confidenceThreshold: 0.75
      }
    ];
  }

  public async canHandle(task: string, context?: any): Promise<TaskAnalysis> {
    const lowerTask = task.toLowerCase();
    
    // Test-related keywords and patterns
    const testKeywords = [
      "test", "testing", "unit test", "integration test", "e2e", "end-to-end",
      "jest", "mocha", "vitest", "pytest", "spec", "describe", "it should"
    ];

    const tddKeywords = [
      "tdd", "test-driven", "red-green-refactor", "test first", "behavior-driven", "bdd"
    ];

    const coverageKeywords = [
      "coverage", "test coverage", "code coverage", "lcov", "istanbul", "nyc"
    ];

    const testMaintenanceKeywords = [
      "flaky", "flaky test", "test maintenance", "test refactor", "test fix",
      "test improvement", "test optimization"
    ];

    let confidence = 0.0;
    const reasoningSteps: string[] = [];
    const requiredCapabilities: string[] = [];

    // Check for explicit test requests
    if (lowerTask.includes("run test") || lowerTask.includes("execute test")) {
      confidence += 0.5;
      reasoningSteps.push("Explicit test execution request detected");
      requiredCapabilities.push("test_execution");
    }

    if (lowerTask.includes("generate test") || lowerTask.includes("create test") || lowerTask.includes("write test")) {
      confidence += 0.4;
      reasoningSteps.push("Test generation request detected");
      requiredCapabilities.push("test_generation");
    }

    // Check for general test keywords
    const testMatches = testKeywords.filter(keyword => lowerTask.includes(keyword));
    if (testMatches.length > 0) {
      confidence += Math.min(testMatches.length * 0.15, 0.4);
      reasoningSteps.push(`Test keywords found: ${testMatches.join(", ")}`);
      if (!requiredCapabilities.includes("test_execution")) {
        requiredCapabilities.push("test_execution");
      }
    }

    // Check for TDD workflow requests
    const tddMatches = tddKeywords.filter(keyword => lowerTask.includes(keyword));
    if (tddMatches.length > 0) {
      confidence += Math.min(tddMatches.length * 0.2, 0.3);
      reasoningSteps.push(`TDD workflow keywords found: ${tddMatches.join(", ")}`);
      requiredCapabilities.push("tdd_workflow");
    }

    // Check for coverage analysis requests
    const coverageMatches = coverageKeywords.filter(keyword => lowerTask.includes(keyword));
    if (coverageMatches.length > 0) {
      confidence += Math.min(coverageMatches.length * 0.2, 0.3);
      reasoningSteps.push(`Coverage analysis keywords found: ${coverageMatches.join(", ")}`);
      requiredCapabilities.push("coverage_analysis");
    }

    // Check for test maintenance requests
    const maintenanceMatches = testMaintenanceKeywords.filter(keyword => lowerTask.includes(keyword));
    if (maintenanceMatches.length > 0) {
      confidence += Math.min(maintenanceMatches.length * 0.15, 0.25);
      reasoningSteps.push(`Test maintenance keywords found: ${maintenanceMatches.join(", ")}`);
      requiredCapabilities.push("test_maintenance");
    }

    // Check for test file context
    if (context?.filePath && (context.filePath.includes(".test.") || context.filePath.includes(".spec."))) {
      confidence += 0.3;
      reasoningSteps.push("Test file context detected");
    }

    // Check for source file that might need tests
    if (context?.filePath && !context.filePath.includes("test") && !context.filePath.includes("spec")) {
      confidence += 0.1;
      reasoningSteps.push("Source file context detected - may need tests");
      requiredCapabilities.push("test_generation");
    }

    // Check for tool availability
    const requiredTools = ["run_tests", "test_generator", "test_coverage"];
    const availableTools = this.toolManager.getToolNames();
    const hasRequiredTools = requiredTools.some(tool => availableTools.includes(tool));
    
    if (!hasRequiredTools) {
      confidence *= 0.6; // Significantly reduce confidence if no test tools available
      reasoningSteps.push("Limited test tools available");
    }

    // Determine complexity based on capabilities needed
    let complexity: "low" | "medium" | "high" = "medium";
    if (requiredCapabilities.length <= 1) {
      complexity = "low";
    } else if (requiredCapabilities.length >= 3) {
      complexity = "high";
    }

    return {
      primaryDomain: AgentSpecialization.TEST_AUTOMATION,
      confidence: Math.min(confidence, 1.0),
      reasoningSteps,
      requiredCapabilities,
      complexity,
      estimatedDuration: complexity === "low" ? 20000 : complexity === "medium" ? 45000 : 90000
    };
  }

  public async executeTask(
    task: string,
    session?: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse> {
    const chatSession = session || new ChatSession();
    const actions: AgentAction[] = [];
    
    try {
      logger.info(`[TEST_AUTOMATION_AGENT] Starting test automation task: ${task}`);
      
      // Phase 1: Analyze the task and determine testing strategy
      progressCallback?.onThought?.("Analyzing testing requirements and strategy...");
      
      const testPlan = await this.createTestPlan(task);
      progressCallback?.onThought?.(`Test plan created: ${testPlan.phases.length} phases, targeting ${testPlan.testTypes.join(", ")} tests`);

      let testResults = {
        execution: null as any,
        coverage: null as any,
        generated: null as any,
        framework: testPlan.framework
      };

      // Phase 2: Execute existing tests if requested
      if (testPlan.includeExecution) {
        progressCallback?.onAction?.("run_tests", { 
          framework: testPlan.framework,
          testPath: testPlan.targetPath,
          coverage: testPlan.includeCoverage
        });
        
        try {
          const testExecutionResult = await this.toolManager.executeTool("run_tests", {
            framework: testPlan.framework,
            testPath: testPlan.targetPath,
            coverage: testPlan.includeCoverage,
            verbose: true,
            timeout: this.testConfig.testTimeout
          });
          
          testResults.execution = this.parseTestResults(testExecutionResult);
          progressCallback?.onActionResult?.(`Tests executed: ${testResults.execution.summary}`);
          
          actions.push({
            thought: `Executed ${testPlan.framework} tests`,
            toolCall: chatSession.recordToolCall("run_tests", { framework: testPlan.framework }, testExecutionResult),
            observation: "Test execution completed successfully",
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn("[TEST_AUTOMATION_AGENT] Test execution failed:", error);
          progressCallback?.onActionResult?.("", `Test execution failed: ${error}`);
          
          actions.push({
            thought: "Test execution encountered issues",
            toolCall: chatSession.recordToolCall("run_tests", { framework: testPlan.framework }, undefined, String(error)),
            timestamp: new Date()
          });
        }
      }

      // Phase 3: Generate new tests if requested
      if (testPlan.includeGeneration) {
        progressCallback?.onAction?.("test_generator", { 
          filePath: testPlan.sourceFile,
          framework: testPlan.framework,
          testTypes: testPlan.testTypes
        });
        
        try {
          const testGenerationResult = await this.toolManager.executeTool("test_generator", {
            filePath: testPlan.sourceFile,
            framework: testPlan.framework,
            testTypes: testPlan.testTypes.join(","),
            coverage: true
          });
          
          testResults.generated = testGenerationResult;
          progressCallback?.onActionResult?.("Test generation completed");
          
          actions.push({
            thought: `Generated ${testPlan.testTypes.join(" and ")} tests`,
            toolCall: chatSession.recordToolCall("test_generator", { filePath: testPlan.sourceFile }, testGenerationResult),
            observation: "Test generation completed successfully",
            timestamp: new Date()
          });

          // Save generated tests to file
          if (testPlan.saveGeneratedTests && testResults.generated) {
            const testFileName = this.generateTestFileName(testPlan.sourceFile || "default", testPlan.framework);
            
            progressCallback?.onAction?.("file_write", { filePath: testFileName });
            
            try {
              await this.toolManager.executeTool("file_write", {
                filePath: testFileName,
                content: testResults.generated
              });
              
              progressCallback?.onActionResult?.(`Generated tests saved to ${testFileName}`);
              
              actions.push({
                thought: "Saved generated tests to file",
                toolCall: chatSession.recordToolCall("file_write", { filePath: testFileName }, `Tests saved to ${testFileName}`),
                observation: "Generated tests saved successfully",
                timestamp: new Date()
              });
            } catch (error) {
              logger.warn("[TEST_AUTOMATION_AGENT] Failed to save generated tests:", error);
            }
          }
        } catch (error) {
          logger.warn("[TEST_AUTOMATION_AGENT] Test generation failed:", error);
          progressCallback?.onActionResult?.("", `Test generation failed: ${error}`);
        }
      }

      // Phase 4: Analyze test coverage if requested
      if (testPlan.includeCoverage) {
        progressCallback?.onAction?.("test_coverage", { 
          testPath: testPlan.targetPath,
          format: "summary"
        });
        
        try {
          const coverageResult = await this.toolManager.executeTool("test_coverage", {
            testPath: testPlan.targetPath,
            format: "detailed",
            threshold: this.testConfig.minCoverageThreshold
          });
          
          testResults.coverage = this.parseCoverageResults(coverageResult);
          progressCallback?.onActionResult?.(`Coverage analysis completed: ${testResults.coverage.percentage}%`);
          
          actions.push({
            thought: "Analyzed test coverage and identified gaps",
            toolCall: chatSession.recordToolCall("test_coverage", { testPath: testPlan.targetPath }, coverageResult),
            observation: "Coverage analysis completed successfully",
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn("[TEST_AUTOMATION_AGENT] Coverage analysis failed:", error);
          progressCallback?.onActionResult?.("", `Coverage analysis failed: ${error}`);
        }
      }

      // Phase 5: Generate comprehensive test report
      progressCallback?.onThought?.("Generating comprehensive test automation report...");
      
      const testReport = await this.generateTestReport(task, testResults, testPlan);
      
      // Phase 6: Save test report if requested
      if (testPlan.generateReport) {
        const reportFileName = `test-report-${Date.now()}.md`;
        progressCallback?.onAction?.("file_write", { filePath: reportFileName });
        
        try {
          await this.toolManager.executeTool("file_write", {
            filePath: reportFileName,
            content: testReport.markdown
          });
          
          progressCallback?.onActionResult?.(`Test report saved to ${reportFileName}`);
          
          actions.push({
            thought: "Generated and saved comprehensive test report",
            toolCall: chatSession.recordToolCall("file_write", { filePath: reportFileName }, `Report saved to ${reportFileName}`),
            observation: "Test report saved successfully",
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn("[TEST_AUTOMATION_AGENT] Failed to save test report:", error);
        }
      }

      const response: AgentResponse = {
        content: testReport.summary,
        actions,
        success: true,
        agentType: AgentSpecialization.TEST_AUTOMATION,
        confidence: 0.9,
        suggestions: testReport.recommendations,
        metadata: {
          testPlan,
          testResults,
          framework: testPlan.framework,
          coverage: testResults.coverage?.percentage || 0,
          testsGenerated: !!testResults.generated
        }
      };

      progressCallback?.onComplete?.(response);
      return response;

    } catch (error) {
      const errorMessage = `Test automation failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.error("[TEST_AUTOMATION_AGENT] Task execution failed:", error);

      const response: AgentResponse = {
        content: errorMessage,
        actions,
        success: false,
        error: errorMessage,
        agentType: AgentSpecialization.TEST_AUTOMATION,
        confidence: 0
      };

      progressCallback?.onComplete?.(response);
      return response;
    }
  }

  private async createTestPlan(task: string): Promise<{
    framework: string;
    targetPath: string;
    sourceFile?: string;
    testTypes: string[];
    phases: string[];
    includeExecution: boolean;
    includeGeneration: boolean;
    includeCoverage: boolean;
    saveGeneratedTests: boolean;
    generateReport: boolean;
  }> {
    const lowerTask = task.toLowerCase();
    
    // Detect framework from task or use auto-detection
    let framework = this.testConfig.preferredFramework;
    if (lowerTask.includes("jest")) framework = "jest";
    else if (lowerTask.includes("mocha")) framework = "mocha";
    else if (lowerTask.includes("vitest")) framework = "vitest";
    else if (lowerTask.includes("pytest")) framework = "pytest";

    // Extract file paths from task
    const filePathMatch = task.match(/(?:file|path|test):\s*([^\s]+)/i) || 
                         task.match(/([^\s]+\.(ts|js|tsx|jsx|py))/i);
    const sourceFile = filePathMatch ? filePathMatch[1] : undefined;
    const targetPath = sourceFile || ".";

    // Determine test types
    const testTypes: string[] = [];
    if (lowerTask.includes("unit") || (!lowerTask.includes("integration") && !lowerTask.includes("e2e"))) {
      testTypes.push("unit");
    }
    if (lowerTask.includes("integration")) {
      testTypes.push("integration");
    }
    if (lowerTask.includes("e2e") || lowerTask.includes("end-to-end")) {
      testTypes.push("e2e");
    }
    if (testTypes.length === 0) {
      testTypes.push("unit"); // Default to unit tests
    }

    const plan = {
      framework,
      targetPath,
      sourceFile,
      testTypes,
      phases: [] as string[],
      includeExecution: lowerTask.includes("run") || lowerTask.includes("execute") || !lowerTask.includes("generate"),
      includeGeneration: lowerTask.includes("generate") || lowerTask.includes("create") || lowerTask.includes("write"),
      includeCoverage: lowerTask.includes("coverage") || this.testConfig.generateCoverageReports,
      saveGeneratedTests: lowerTask.includes("generate") || lowerTask.includes("create"),
      generateReport: lowerTask.includes("report") || lowerTask.includes("summary")
    };

    // Build phase list
    if (plan.includeExecution) plan.phases.push("Test Execution");
    if (plan.includeGeneration) plan.phases.push("Test Generation");
    if (plan.includeCoverage) plan.phases.push("Coverage Analysis");
    if (plan.generateReport) plan.phases.push("Report Generation");

    return plan;
  }

  private parseTestResults(testOutput: string): {
    summary: string;
    passed: number;
    failed: number;
    skipped: number;
    total: number;
    duration: number;
    details: string[];
  } {
    const lines = testOutput.split('\n');
    let passed = 0, failed = 0, skipped = 0, duration = 0;
    const details: string[] = [];

    // Parse Jest/Vitest style output
    for (const line of lines) {
      if (line.includes('passed') && line.includes('total')) {
        const passedMatch = line.match(/(\d+) passed/);
        const failedMatch = line.match(/(\d+) failed/);
        const skippedMatch = line.match(/(\d+) skipped/);
        
        if (passedMatch) passed = parseInt(passedMatch[1]);
        if (failedMatch) failed = parseInt(failedMatch[1]);
        if (skippedMatch) skipped = parseInt(skippedMatch[1]);
      }
      
      if (line.includes('Time:')) {
        const timeMatch = line.match(/Time:\s*(\d+\.?\d*)/);
        if (timeMatch) duration = parseFloat(timeMatch[1]) * 1000; // Convert to ms
      }

      if (line.includes('FAIL') || line.includes('PASS') || line.includes('●')) {
        details.push(line.trim());
      }
    }

    const total = passed + failed + skipped;
    const summary = `${passed}/${total} tests passed${failed > 0 ? `, ${failed} failed` : ''}${skipped > 0 ? `, ${skipped} skipped` : ''}`;

    return { summary, passed, failed, skipped, total, duration, details };
  }

  private parseCoverageResults(coverageOutput: string): {
    percentage: number;
    lines: { covered: number; total: number };
    branches: { covered: number; total: number };
    functions: { covered: number; total: number };
    statements: { covered: number; total: number };
  } {
    const lines = coverageOutput.split('\n');
    const result = {
      percentage: 0,
      lines: { covered: 0, total: 0 },
      branches: { covered: 0, total: 0 },
      functions: { covered: 0, total: 0 },
      statements: { covered: 0, total: 0 }
    };

    for (const line of lines) {
      // Parse coverage percentages
      const percentMatch = line.match(/All files.*?(\d+\.?\d*)%/);
      if (percentMatch) {
        result.percentage = parseFloat(percentMatch[1]);
      }

      // Parse detailed coverage data
      const detailMatch = line.match(/(\w+).*?(\d+)\/(\d+).*?(\d+\.?\d*)%/);
      if (detailMatch) {
        const [, type, covered, total] = detailMatch;
        const coveredNum = parseInt(covered);
        const totalNum = parseInt(total);
        
        switch (type.toLowerCase()) {
          case 'lines':
            result.lines = { covered: coveredNum, total: totalNum };
            break;
          case 'branches':
            result.branches = { covered: coveredNum, total: totalNum };
            break;
          case 'functions':
            result.functions = { covered: coveredNum, total: totalNum };
            break;
          case 'statements':
            result.statements = { covered: coveredNum, total: totalNum };
            break;
        }
      }
    }

    return result;
  }

  private generateTestFileName(sourceFile: string, framework: string): string {
    const baseName = sourceFile.replace(/\.(ts|js|tsx|jsx|py)$/, '');
    const extension = sourceFile.match(/\.(ts|tsx)$/) ? 'ts' : 
                     sourceFile.match(/\.(jsx)$/) ? 'jsx' :
                     sourceFile.match(/\.py$/) ? 'py' : 'js';
    
    if (framework === "pytest") {
      return `test_${baseName.split('/').pop()}.py`;
    }
    
    return `${baseName}.test.${extension}`;
  }

  private async generateTestReport(
    task: string,
    results: any,
    plan: any
  ): Promise<{
    summary: string;
    markdown: string;
    recommendations: string[];
  }> {
    const recommendations: string[] = [];
    let summary = "";

    // Generate summary based on results
    if (results.execution) {
      const exec = results.execution;
      summary += `Test execution completed: ${exec.summary}. `;
      
      if (exec.failed > 0) {
        recommendations.push(`Fix ${exec.failed} failing test${exec.failed > 1 ? 's' : ''}`);
      }
      if (exec.skipped > 0) {
        recommendations.push(`Review ${exec.skipped} skipped test${exec.skipped > 1 ? 's' : ''}`);
      }
    }

    if (results.coverage) {
      const cov = results.coverage;
      summary += `Test coverage: ${cov.percentage}%. `;
      
      if (cov.percentage < this.testConfig.minCoverageThreshold) {
        recommendations.push(`Improve test coverage to meet ${this.testConfig.minCoverageThreshold}% threshold`);
        recommendations.push("Focus on uncovered lines and branches");
      }
    }

    if (results.generated) {
      summary += "New tests generated successfully. ";
      recommendations.push("Review generated tests and customize as needed");
      recommendations.push("Run generated tests to ensure they pass");
    }

    if (recommendations.length === 0) {
      recommendations.push("Tests are in good shape!");
      recommendations.push("Consider adding edge case tests for better coverage");
    }

    const markdown = this.generateMarkdownReport(task, results, plan, recommendations);

    return { summary, markdown, recommendations };
  }

  private generateMarkdownReport(task: string, results: any, plan: any, recommendations: string[]): string {
    const timestamp = new Date().toISOString();
    
    let markdown = `# Test Automation Report\n\n`;
    markdown += `**Generated:** ${timestamp}\n`;
    markdown += `**Framework:** ${plan.framework}\n`;
    markdown += `**Target:** ${plan.targetPath}\n`;
    markdown += `**Task:** ${task}\n\n`;

    // Test execution results
    if (results.execution) {
      markdown += `## Test Execution Results\n\n`;
      markdown += `- **Passed:** ${results.execution.passed}\n`;
      markdown += `- **Failed:** ${results.execution.failed}\n`;
      markdown += `- **Skipped:** ${results.execution.skipped}\n`;
      markdown += `- **Total:** ${results.execution.total}\n`;
      markdown += `- **Duration:** ${results.execution.duration}ms\n\n`;

      if (results.execution.details.length > 0) {
        markdown += `### Test Details\n\n`;
        markdown += `\`\`\`\n${results.execution.details.slice(0, 10).join('\n')}\n\`\`\`\n\n`;
      }
    }

    // Coverage results
    if (results.coverage) {
      markdown += `## Coverage Analysis\n\n`;
      markdown += `- **Overall Coverage:** ${results.coverage.percentage}%\n`;
      markdown += `- **Lines:** ${results.coverage.lines.covered}/${results.coverage.lines.total}\n`;
      markdown += `- **Branches:** ${results.coverage.branches.covered}/${results.coverage.branches.total}\n`;
      markdown += `- **Functions:** ${results.coverage.functions.covered}/${results.coverage.functions.total}\n\n`;
    }

    // Generated tests
    if (results.generated) {
      markdown += `## Generated Tests\n\n`;
      markdown += `New tests were generated for the specified source files.\n\n`;
      markdown += `### Test Types Generated\n\n`;
      plan.testTypes.forEach((type: string) => {
        markdown += `- ${type.charAt(0).toUpperCase() + type.slice(1)} tests\n`;
      });
      markdown += `\n`;
    }

    // Recommendations
    markdown += `## Recommendations\n\n`;
    recommendations.forEach((rec, index) => {
      markdown += `${index + 1}. ${rec}\n`;
    });
    markdown += `\n`;

    // Test plan summary
    markdown += `## Test Plan Executed\n\n`;
    plan.phases.forEach((phase: string) => {
      markdown += `- ✅ ${phase}\n`;
    });

    return markdown;
  }

  public getPromptTemplates(): Record<string, string> {
    return {
      testGeneration: `You are a senior test automation engineer creating comprehensive test suites.
        Generate thorough tests that cover:
        1. Happy path scenarios and edge cases
        2. Error handling and boundary conditions
        3. Integration points and dependencies
        4. Performance and scalability concerns
        5. Security considerations where applicable
        
        Follow testing best practices and generate maintainable, readable tests.`,
      
      tddWorkflow: `You are guiding a test-driven development workflow.
        Help implement the Red-Green-Refactor cycle:
        1. Write failing tests first (Red)
        2. Write minimal code to make tests pass (Green)  
        3. Refactor code while keeping tests green (Refactor)
        
        Focus on incremental development and continuous validation.`,
      
      testMaintenance: `You are a test maintenance specialist.
        Analyze and improve existing test suites by:
        1. Identifying flaky or unreliable tests
        2. Improving test performance and reliability
        3. Reducing test duplication and improving DRY principles
        4. Enhancing test readability and maintainability
        5. Updating tests for code changes
        
        Provide specific actionable improvements.`
    };
  }
}