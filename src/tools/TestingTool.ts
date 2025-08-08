import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";

const execAsync = promisify(exec);

// Test Runner Tool
export class TestRunnerTool extends BaseTool {
  name = "run_tests";
  description = "Run tests using various testing frameworks";
  
  schema = z.object({
    framework: z.enum(["jest", "mocha", "vitest", "pytest", "npm", "yarn", "pnpm", "auto"])
      .optional().describe("Testing framework to use (auto-detect if not specified)"),
    testPath: z.string().optional().describe("Specific test file or directory to run"),
    pattern: z.string().optional().describe("Test name pattern to match"),
    watch: z.boolean().optional().describe("Run tests in watch mode"),
    coverage: z.boolean().optional().describe("Generate coverage report"),
    verbose: z.boolean().optional().describe("Verbose output"),
    bail: z.boolean().optional().describe("Stop on first failure"),
    timeout: z.number().optional().describe("Test timeout in milliseconds"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      
      // Auto-detect framework if not specified
      const framework = params.framework === "auto" || !params.framework 
        ? await this.detectTestFramework(workspacePath)
        : params.framework;

      const command = await this.buildTestCommand(framework, params, workspacePath);
      
      logger.info(`[TEST_RUNNER] Running: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspacePath,
        timeout: params.timeout || 120000, // 2 minutes default
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large test outputs
      });

      const output = stdout + (stderr ? `\n\nErrors:\n${stderr}` : "");
      logger.info(`[TEST_RUNNER] Tests completed`);
      
      return output;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[TEST_RUNNER] Failed:", error);
      
      // Include the command output in error for debugging
      if (error && typeof error === 'object' && 'stdout' in error) {
        const execError = error as any;
        return `Test execution failed: ${errorMessage}\n\nOutput:\n${execError.stdout}\n\nErrors:\n${execError.stderr}`;
      }
      
      throw new Error(`Test execution failed: ${errorMessage}`);
    }
  }

  private async detectTestFramework(workspacePath: string): Promise<string> {
    try {
      // Check package.json for test frameworks
      const packageJsonPath = path.join(workspacePath, "package.json");
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
      
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      // Check for common test frameworks
      if (dependencies.vitest) return "vitest";
      if (dependencies.jest) return "jest";
      if (dependencies.mocha) return "mocha";
      
      // Check for Python testing
      const pythonFiles = await this.findFiles(workspacePath, "**/*.py");
      if (pythonFiles.length > 0) {
        return "pytest";
      }
      
      // Check scripts in package.json
      if (packageJson.scripts?.test) {
        const testScript = packageJson.scripts.test;
        if (testScript.includes("vitest")) return "vitest";
        if (testScript.includes("jest")) return "jest";
        if (testScript.includes("mocha")) return "mocha";
        return "npm"; // Use npm test script
      }

      // Default fallback
      return "npm";
    } catch (error) {
      logger.debug("[TEST_RUNNER] Framework detection failed, defaulting to npm");
      return "npm";
    }
  }

  private async buildTestCommand(
    framework: string,
    params: any,
    workspacePath: string
  ): Promise<string> {
    let command = "";
    
    switch (framework) {
      case "jest":
        command = "npx jest";
        if (params.testPath) command += ` "${params.testPath}"`;
        if (params.pattern) command += ` --testNamePattern="${params.pattern}"`;
        if (params.watch) command += " --watch";
        if (params.coverage) command += " --coverage";
        if (params.verbose) command += " --verbose";
        if (params.bail) command += " --bail";
        break;

      case "vitest":
        command = "npx vitest run";
        if (params.testPath) command += ` "${params.testPath}"`;
        if (params.pattern) command += ` --grep="${params.pattern}"`;
        if (params.watch) command = "npx vitest"; // Remove 'run' for watch mode
        if (params.coverage) command += " --coverage";
        if (params.bail) command += " --bail";
        break;

      case "mocha":
        command = "npx mocha";
        if (params.testPath) command += ` "${params.testPath}"`;
        if (params.pattern) command += ` --grep="${params.pattern}"`;
        if (params.watch) command += " --watch";
        if (params.bail) command += " --bail";
        if (params.timeout) command += ` --timeout ${params.timeout}`;
        break;

      case "pytest":
        command = "python -m pytest";
        if (params.testPath) command += ` "${params.testPath}"`;
        if (params.pattern) command += ` -k "${params.pattern}"`;
        if (params.coverage) command += " --cov";
        if (params.verbose) command += " -v";
        if (params.bail) command += " -x";
        break;

      case "npm":
      case "yarn":
      case "pnpm":
        command = `${framework} test`;
        break;

      default:
        throw new Error(`Unsupported test framework: ${framework}`);
    }

    return command;
  }

  private async findFiles(dir: string, pattern: string): Promise<string[]> {
    // Simple file finding implementation - for now just return empty
    // In a real implementation, this would use a glob library or fs.readdir
    return [];
  }

}

// Test Generator Tool
export class TestGeneratorTool extends BaseTool {
  name = "generate_test";
  description = "Generate test files and test cases for existing code";
  
  schema = z.object({
    filePath: z.string().describe("Path to the source file to generate tests for"),
    testType: z.enum(["unit", "integration", "e2e"]).optional().describe("Type of test to generate"),
    framework: z.enum(["jest", "vitest", "mocha", "pytest"]).optional().describe("Testing framework"),
    includeSetup: z.boolean().optional().describe("Include setup and teardown methods"),
    mockDependencies: z.boolean().optional().describe("Generate mocks for dependencies"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const sourceFilePath = path.resolve(workspacePath, params.filePath);
      
      // Detect framework if not specified
      const framework = params.framework || await this.detectTestFramework(workspacePath);
      
      // Read source file
      const sourceContent = await fs.readFile(sourceFilePath, "utf-8");
      
      // Generate test file path
      const testFilePath = this.generateTestFilePath(sourceFilePath, framework);
      
      // Generate test content
      const testContent = await this.generateTestContent(
        sourceContent,
        params,
        framework,
        path.basename(sourceFilePath)
      );
      
      // Ensure test directory exists
      await fs.mkdir(path.dirname(testFilePath), { recursive: true });
      
      // Write test file
      await fs.writeFile(testFilePath, testContent, "utf-8");
      
      logger.info(`[TEST_GENERATOR] Generated test file: ${testFilePath}`);
      
      return `Test file generated successfully: ${testFilePath}\n\nTest content:\n${testContent}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[TEST_GENERATOR] Failed:", error);
      throw new Error(`Test generation failed: ${errorMessage}`);
    }
  }

  private generateTestFilePath(sourceFilePath: string, framework: string): string {
    const dir = path.dirname(sourceFilePath);
    const basename = path.basename(sourceFilePath, path.extname(sourceFilePath));
    const ext = framework === "pytest" ? ".py" : 
                path.extname(sourceFilePath) || ".js";
    
    // Different naming conventions for different frameworks
    if (framework === "pytest") {
      return path.join(dir, `test_${basename}${ext}`);
    } else {
      return path.join(dir, `${basename}.test${ext}`);
    }
  }

  private async generateTestContent(
    sourceContent: string,
    params: any,
    framework: string,
    sourceFileName: string
  ): Promise<string> {
    const functions = this.extractFunctions(sourceContent);
    const classes = this.extractClasses(sourceContent);
    
    switch (framework) {
      case "jest":
      case "vitest":
        return this.generateJestVitestTests(functions, classes, params, sourceFileName);
      case "mocha":
        return this.generateMochaTests(functions, classes, params, sourceFileName);
      case "pytest":
        return this.generatePytestTests(functions, classes, params, sourceFileName);
      default:
        throw new Error(`Unsupported framework for test generation: ${framework}`);
    }
  }

  private generateJestVitestTests(
    functions: string[],
    classes: string[],
    params: any,
    sourceFileName: string
  ): string {
    const importPath = `./${sourceFileName.replace(/\.(ts|js|tsx|jsx)$/, "")}`;
    
    let content = `import { ${functions.concat(classes).join(", ")} } from "${importPath}";\n\n`;
    
    if (params.includeSetup) {
      content += `describe("${sourceFileName}", () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

`;
    } else {
      content += `describe("${sourceFileName}", () => {\n`;
    }

    // Generate tests for functions
    for (const func of functions) {
      content += `  describe("${func}", () => {
    it("should work correctly", () => {
      // TODO: Implement test for ${func}
      expect(${func}).toBeDefined();
    });

    it("should handle edge cases", () => {
      // TODO: Add edge case tests
    });
  });

`;
    }

    // Generate tests for classes
    for (const cls of classes) {
      content += `  describe("${cls}", () => {
    it("should instantiate correctly", () => {
      // TODO: Implement instantiation test
      expect(${cls}).toBeDefined();
    });

    it("should have required methods", () => {
      // TODO: Test class methods
    });
  });

`;
    }

    content += "});\n";
    return content;
  }

  private generateMochaTests(
    functions: string[],
    classes: string[],
    params: any,
    sourceFileName: string
  ): string {
    const importPath = `./${sourceFileName.replace(/\.(ts|js|tsx|jsx)$/, "")}`;
    
    let content = `const { ${functions.concat(classes).join(", ")} } = require("${importPath}");\nconst { expect } = require("chai");\n\n`;
    
    content += `describe("${sourceFileName}", function() {\n`;
    
    if (params.includeSetup) {
      content += `  beforeEach(function() {
    // Setup before each test
  });

  afterEach(function() {
    // Cleanup after each test
  });

`;
    }

    for (const func of functions) {
      content += `  describe("${func}", function() {
    it("should work correctly", function() {
      // TODO: Implement test for ${func}
      expect(${func}).to.exist;
    });
  });

`;
    }

    content += "});\n";
    return content;
  }

  private generatePytestTests(
    functions: string[],
    classes: string[],
    params: any,
    sourceFileName: string
  ): string {
    const moduleName = sourceFileName.replace(/\.py$/, "");
    
    let content = `import pytest\nfrom ${moduleName} import ${functions.concat(classes).join(", ")}\n\n`;
    
    if (params.includeSetup) {
      content += `@pytest.fixture
def setup():
    """Setup fixture for tests"""
    # Setup code here
    yield
    # Teardown code here

`;
    }

    for (const func of functions) {
      content += `def test_${func}():
    """Test ${func} function"""
    # TODO: Implement test for ${func}
    assert ${func} is not None

`;
    }

    for (const cls of classes) {
      content += `def test_${cls.toLowerCase()}_instantiation():
    """Test ${cls} class instantiation"""
    # TODO: Implement instantiation test
    assert ${cls} is not None

`;
    }

    return content;
  }

  private extractFunctions(content: string): string[] {
    const functions: string[] = [];
    
    // JavaScript/TypeScript function patterns
    const jsFunctionPatterns = [
      /function\s+(\w+)/g,
      /const\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)\s*=>|\([^)]*\)\s*\{)/g,
      /(\w+)\s*:\s*(?:async\s+)?(?:\([^)]*\)\s*=>|\([^)]*\)\s*\{)/g,
    ];

    // Python function pattern
    const pyFunctionPattern = /def\s+(\w+)/g;
    
    for (const pattern of jsFunctionPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        functions.push(match[1]);
      }
    }

    // Try Python pattern
    let match;
    while ((match = pyFunctionPattern.exec(content)) !== null) {
      functions.push(match[1]);
    }

    return [...new Set(functions)]; // Remove duplicates
  }

  private extractClasses(content: string): string[] {
    const classes: string[] = [];
    
    // JavaScript/TypeScript class pattern
    const jsClassPattern = /class\s+(\w+)/g;
    
    // Python class pattern
    const pyClassPattern = /class\s+(\w+)/g;
    
    let match;
    while ((match = jsClassPattern.exec(content)) !== null) {
      classes.push(match[1]);
    }

    // Reset regex and try Python pattern
    pyClassPattern.lastIndex = 0;
    while ((match = pyClassPattern.exec(content)) !== null) {
      classes.push(match[1]);
    }

    return [...new Set(classes)]; // Remove duplicates
  }

  private async detectTestFramework(workspacePath: string): Promise<string> {
    try {
      const packageJsonPath = path.join(workspacePath, "package.json");
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
      
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      if (dependencies.vitest) return "vitest";
      if (dependencies.jest) return "jest";
      if (dependencies.mocha) return "mocha";
      
      return "jest"; // Default fallback
    } catch (error) {
      return "jest";
    }
  }

}

// Test Coverage Tool
export class TestCoverageTool extends BaseTool {
  name = "test_coverage";
  description = "Generate and analyze test coverage reports";
  
  schema = z.object({
    format: z.enum(["lcov", "html", "text", "json"]).optional().describe("Coverage report format"),
    threshold: z.number().optional().describe("Minimum coverage threshold percentage"),
    includeUncovered: z.boolean().optional().describe("Show uncovered lines"),
    outputDir: z.string().optional().describe("Output directory for coverage reports"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const workspacePath = this.getWorkspaceRoot();
      const framework = await this.detectTestFramework(workspacePath);
      
      let command = "";
      
      switch (framework) {
        case "jest":
          command = "npx jest --coverage";
          if (params.format && params.format !== "lcov") {
            command += ` --coverageReporters=${params.format}`;
          }
          if (params.outputDir) {
            command += ` --coverageDirectory="${params.outputDir}"`;
          }
          break;

        case "vitest":
          command = "npx vitest run --coverage";
          if (params.format) {
            command += ` --coverage.reporter=${params.format}`;
          }
          break;

        case "pytest":
          command = "python -m pytest --cov";
          if (params.format === "html") {
            command += " --cov-report=html";
          } else if (params.format === "text") {
            command += " --cov-report=xml";
          }
          break;

        default:
          throw new Error(`Coverage not supported for framework: ${framework}`);
      }

      logger.info(`[TEST_COVERAGE] Running: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 120000, // 2 minutes
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      const output = stdout + (stderr ? `\n\nWarnings:\n${stderr}` : "");
      
      // Parse coverage results if threshold is specified
      if (params.threshold) {
        const coveragePercentage = this.extractCoveragePercentage(output);
        if (coveragePercentage !== null && coveragePercentage < params.threshold) {
          throw new Error(
            `Coverage ${coveragePercentage}% is below threshold ${params.threshold}%`
          );
        }
      }

      logger.info(`[TEST_COVERAGE] Coverage analysis completed`);
      return output;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[TEST_COVERAGE] Failed:", error);
      throw new Error(`Coverage analysis failed: ${errorMessage}`);
    }
  }

  private extractCoveragePercentage(output: string): number | null {
    // Try to extract coverage percentage from common formats
    const patterns = [
      /All files\s+\|\s+[\d.]+\s+\|\s+[\d.]+\s+\|\s+[\d.]+\s+\|\s+([\d.]+)/,
      /TOTAL\s+\d+\s+\d+\s+([\d.]+)%/,
      /coverage:\s+([\d.]+)%/i,
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        return parseFloat(match[1]);
      }
    }

    return null;
  }

  private async detectTestFramework(workspacePath: string): Promise<string> {
    try {
      const packageJsonPath = path.join(workspacePath, "package.json");
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
      
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      if (dependencies.vitest) return "vitest";
      if (dependencies.jest) return "jest";
      
      // Check for Python files
      const pythonFiles = await this.findFiles(workspacePath, "**/*.py");
      if (pythonFiles.length > 0) return "pytest";
      
      return "jest"; // Default fallback
    } catch (error) {
      return "jest";
    }
  }

  private async findFiles(dir: string, pattern: string): Promise<string[]> {
    // Simple file finding implementation - for now just return empty
    // In a real implementation, this would use a glob library or fs.readdir
    return [];
  }

}