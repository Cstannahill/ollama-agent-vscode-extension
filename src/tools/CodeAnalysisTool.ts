import { z } from "zod";
import { BaseTool } from "../core/BaseTool";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import * as path from "path";
import { promises as fs } from "fs";

/**
 * Tool for running ESLint on specified files or directories
 */
export class EslintTool extends BaseTool {
  name = "eslint";
  description = "Run ESLint to analyze JavaScript/TypeScript code for potential issues and style violations";

  schema = z.object({
    filePath: z.string().describe("Path to file or directory to lint"),
    fix: z.boolean().optional().describe("Whether to automatically fix fixable issues"),
    configFile: z.string().optional().describe("Path to ESLint config file"),
    format: z.enum(["stylish", "json", "compact", "unix"]).optional().describe("Output format"),
  });

  async execute(args: z.infer<typeof this.schema>) {
    try {
      const { filePath, fix = false, configFile, format = "stylish" } = args;
      const workspaceRoot = this.getWorkspaceRoot();
      const fullPath = path.resolve(workspaceRoot, filePath);

      // Check if file/directory exists
      try {
        await fs.access(fullPath);
      } catch (error) {
        return `Error: File or directory '${filePath}' does not exist`;
      }

      // Build ESLint command
      const eslintCommand = [
        "npx", "eslint",
        fix ? "--fix" : "",
        format !== "stylish" ? `--format ${format}` : "",
        configFile ? `--config ${configFile}` : "",
        `"${fullPath}"`
      ].filter(Boolean).join(" ");

      logger.debug(`[ESLINT] Running command: ${eslintCommand}`);

      // Execute ESLint
      const { spawn } = require("child_process");
      return new Promise<string>((resolve) => {
        const eslint = spawn("npx", [
          "eslint",
          ...(fix ? ["--fix"] : []),
          ...(format !== "stylish" ? ["--format", format] : []),
          ...(configFile ? ["--config", configFile] : []),
          fullPath
        ], {
          cwd: workspaceRoot,
          shell: true
        });

        let output = "";
        let errorOutput = "";

        eslint.stdout.on("data", (data: Buffer) => {
          output += data.toString();
        });

        eslint.stderr.on("data", (data: Buffer) => {
          errorOutput += data.toString();
        });

        eslint.on("close", (code: number) => {
          if (code === 0) {
            resolve(output || "✅ No ESLint issues found");
          } else if (code === 1) {
            // ESLint found issues but executed successfully
            resolve(`ESLint found issues:\n${output}`);
          } else {
            resolve(`ESLint error (exit code ${code}):\n${errorOutput || output}`);
          }
        });

        eslint.on("error", (error: Error) => {
          resolve(`Failed to run ESLint: ${error.message}`);
        });
      });
    } catch (error) {
      return `ESLint execution failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

}

/**
 * Tool for running Prettier to format code
 */
export class PrettierTool extends BaseTool {
  name = "prettier";
  description = "Format code using Prettier for consistent code style";

  schema = z.object({
    filePath: z.string().describe("Path to file to format"),
    write: z.boolean().optional().describe("Whether to write formatted output to file"),
    parser: z.enum(["typescript", "javascript", "json", "markdown", "css", "html"]).optional().describe("Parser to use"),
  });

  async execute(args: z.infer<typeof this.schema>) {
    try {
      const { filePath, write = false, parser } = args;
      const workspaceRoot = this.getWorkspaceRoot();
      const fullPath = path.resolve(workspaceRoot, filePath);

      // Check if file exists
      try {
        await fs.access(fullPath);
      } catch (error) {
        return `Error: File '${filePath}' does not exist`;
      }

      // Build Prettier command
      const prettierArgs = [
        "npx", "prettier",
        parser ? `--parser ${parser}` : "",
        write ? "--write" : "--check",
        `"${fullPath}"`
      ].filter(Boolean).join(" ");

      logger.debug(`[PRETTIER] Running command: ${prettierArgs}`);

      // Execute Prettier
      const { spawn } = require("child_process");
      return new Promise<string>((resolve) => {
        const prettier = spawn("npx", [
          "prettier",
          ...(parser ? ["--parser", parser] : []),
          write ? "--write" : "--check",
          fullPath
        ], {
          cwd: workspaceRoot,
          shell: true
        });

        let output = "";
        let errorOutput = "";

        prettier.stdout.on("data", (data: Buffer) => {
          output += data.toString();
        });

        prettier.stderr.on("data", (data: Buffer) => {
          errorOutput += data.toString();
        });

        prettier.on("close", (code: number) => {
          if (code === 0) {
            if (write) {
              resolve(`✅ File formatted successfully: ${filePath}`);
            } else {
              resolve(output || `✅ File is already formatted: ${filePath}`);
            }
          } else {
            resolve(`Prettier error (exit code ${code}):\n${errorOutput || output}`);
          }
        });

        prettier.on("error", (error: Error) => {
          resolve(`Failed to run Prettier: ${error.message}`);
        });
      });
    } catch (error) {
      return `Prettier execution failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

}

/**
 * Tool for analyzing TypeScript types and compilation issues
 */
export class TypeScriptAnalyzerTool extends BaseTool {
  name = "typescript_check";
  description = "Run TypeScript compiler to check for type errors and compilation issues";

  schema = z.object({
    filePath: z.string().optional().describe("Specific file to check (if not provided, checks entire project)"),
    noEmit: z.boolean().optional().describe("Only check types without emitting files"),
    strict: z.boolean().optional().describe("Enable strict type checking"),
  });

  async execute(args: z.infer<typeof this.schema>) {
    try {
      const { filePath, noEmit = true, strict } = args;
      const workspaceRoot = this.getWorkspaceRoot();

      // Build TypeScript compiler command
      const tscArgs = [
        "npx", "tsc",
        noEmit ? "--noEmit" : "",
        strict ? "--strict" : "",
        filePath ? `"${path.resolve(workspaceRoot, filePath)}"` : ""
      ].filter(Boolean).join(" ");

      logger.debug(`[TSC] Running command: ${tscArgs}`);

      // Execute TypeScript compiler
      const { spawn } = require("child_process");
      return new Promise<string>((resolve) => {
        const tsc = spawn("npx", [
          "tsc",
          ...(noEmit ? ["--noEmit"] : []),
          ...(strict ? ["--strict"] : []),
          ...(filePath ? [path.resolve(workspaceRoot, filePath)] : [])
        ], {
          cwd: workspaceRoot,
          shell: true
        });

        let output = "";
        let errorOutput = "";

        tsc.stdout.on("data", (data: Buffer) => {
          output += data.toString();
        });

        tsc.stderr.on("data", (data: Buffer) => {
          errorOutput += data.toString();
        });

        tsc.on("close", (code: number) => {
          if (code === 0) {
            resolve("✅ No TypeScript compilation errors found");
          } else {
            const issues = errorOutput || output;
            resolve(`TypeScript compilation issues found:\n${issues}`);
          }
        });

        tsc.on("error", (error: Error) => {
          resolve(`Failed to run TypeScript compiler: ${error.message}`);
        });
      });
    } catch (error) {
      return `TypeScript analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

}

/**
 * Tool for code complexity analysis
 */
export class ComplexityAnalyzerTool extends BaseTool {
  name = "analyze_complexity";
  description = "Analyze code complexity metrics like cyclomatic complexity, lines of code, and maintainability";

  schema = z.object({
    filePath: z.string().describe("Path to file to analyze"),
    threshold: z.number().optional().describe("Complexity threshold for warnings (default: 10)"),
  });

  async execute(args: z.infer<typeof this.schema>) {
    try {
      const { filePath, threshold = 10 } = args;
      const workspaceRoot = this.getWorkspaceRoot();
      const fullPath = path.resolve(workspaceRoot, filePath);

      // Check if file exists
      try {
        await fs.access(fullPath);
      } catch (error) {
        return `Error: File '${filePath}' does not exist`;
      }

      // Read and analyze file content
      const content = await fs.readFile(fullPath, "utf-8");
      const analysis = this.analyzeComplexity(content, fullPath, threshold);

      return analysis;
    } catch (error) {
      return `Complexity analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private analyzeComplexity(content: string, filePath: string, threshold: number): string {
    const lines = content.split("\n");
    const nonEmptyLines = lines.filter(line => line.trim().length > 0);
    const codeLines = nonEmptyLines.filter(line => !line.trim().startsWith("//") && !line.trim().startsWith("/*"));
    
    // Count cyclomatic complexity indicators
    const complexityKeywords = [
      "if", "else", "for", "while", "switch", "case", "catch", "&&", "||", "?", ":"
    ];
    
    let cyclomaticComplexity = 1; // Base complexity
    const functionMatches = content.match(/function\s+\w+|=>\s*{|=>\s*\(/g) || [];
    
    for (const keyword of complexityKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "g");
      const matches = content.match(regex) || [];
      cyclomaticComplexity += matches.length;
    }

    // Calculate maintainability metrics
    const totalLines = lines.length;
    const commentLines = lines.filter(line => 
      line.trim().startsWith("//") || 
      line.trim().startsWith("/*") || 
      line.trim().startsWith("*")
    ).length;
    
    const commentRatio = commentLines / totalLines;
    const averageLineLength = codeLines.reduce((sum, line) => sum + line.length, 0) / codeLines.length || 0;

    // Generate report
    let report = `📊 Code Complexity Analysis for ${path.basename(filePath)}:\n\n`;
    report += `📏 Lines of Code:\n`;
    report += `  • Total lines: ${totalLines}\n`;
    report += `  • Code lines: ${codeLines.length}\n`;
    report += `  • Comment lines: ${commentLines}\n`;
    report += `  • Comment ratio: ${(commentRatio * 100).toFixed(1)}%\n\n`;
    
    report += `🔧 Complexity Metrics:\n`;
    report += `  • Cyclomatic complexity: ${cyclomaticComplexity}\n`;
    report += `  • Functions/methods: ${functionMatches.length}\n`;
    report += `  • Average line length: ${averageLineLength.toFixed(1)} characters\n\n`;
    
    // Warnings and recommendations
    if (cyclomaticComplexity > threshold) {
      report += `⚠️  Warning: High cyclomatic complexity (${cyclomaticComplexity} > ${threshold})\n`;
      report += `   Consider breaking down complex functions into smaller ones.\n\n`;
    }
    
    if (commentRatio < 0.1) {
      report += `⚠️  Warning: Low comment ratio (${(commentRatio * 100).toFixed(1)}%)\n`;
      report += `   Consider adding more documentation comments.\n\n`;
    }
    
    if (averageLineLength > 100) {
      report += `⚠️  Warning: Long average line length (${averageLineLength.toFixed(1)} chars)\n`;
      report += `   Consider breaking long lines for better readability.\n\n`;
    }
    
    // Overall assessment
    if (cyclomaticComplexity <= threshold && commentRatio >= 0.1 && averageLineLength <= 100) {
      report += `✅ Overall: Code quality looks good!`;
    } else {
      report += `🔍 Overall: Consider refactoring to improve maintainability.`;
    }

    return report;
  }

}

/**
 * Tool for security analysis using common security linters
 */
export class SecurityAnalyzerTool extends BaseTool {
  name = "security_scan";
  description = "Scan code for security vulnerabilities and potential security issues";

  schema = z.object({
    filePath: z.string().describe("Path to file or directory to scan"),
    checkDependencies: z.boolean().optional().describe("Also check for vulnerable dependencies"),
  });

  async execute(args: z.infer<typeof this.schema>) {
    try {
      const { filePath, checkDependencies = false } = args;
      const workspaceRoot = this.getWorkspaceRoot();
      const fullPath = path.resolve(workspaceRoot, filePath);

      let results = "";

      // Basic security pattern analysis
      try {
        await fs.access(fullPath);
        const content = await fs.readFile(fullPath, "utf-8");
        const securityIssues = this.analyzeSecurityPatterns(content, filePath);
        results += securityIssues;
      } catch (error) {
        results += `Error analyzing file '${filePath}': ${error}\n`;
      }

      // Check for vulnerable dependencies if requested
      if (checkDependencies) {
        try {
          results += "\n" + await this.checkVulnerableDependencies(workspaceRoot);
        } catch (error) {
          results += `\nDependency check failed: ${error}\n`;
        }
      }

      return results || "✅ No obvious security issues found";
    } catch (error) {
      return `Security analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private analyzeSecurityPatterns(content: string, filePath: string): string {
    const securityPatterns = [
      {
        pattern: /eval\s*\(/gi,
        message: "Use of eval() can lead to code injection vulnerabilities",
        severity: "HIGH"
      },
      {
        pattern: /innerHTML\s*=/gi,
        message: "Direct innerHTML assignment can lead to XSS vulnerabilities",
        severity: "MEDIUM"
      },
      {
        pattern: /document\.write\s*\(/gi,
        message: "document.write() can lead to XSS vulnerabilities",
        severity: "MEDIUM"
      },
      {
        pattern: /crypto\.createHash\s*\(\s*['"`]md5['"`]/gi,
        message: "MD5 is cryptographically broken and should not be used",
        severity: "HIGH"
      },
      {
        pattern: /crypto\.createHash\s*\(\s*['"`]sha1['"`]/gi,
        message: "SHA1 is cryptographically weak and should be avoided",
        severity: "MEDIUM"
      },
      {
        pattern: /password\s*=\s*['"`][^'"`]+['"`]/gi,
        message: "Hardcoded password detected",
        severity: "HIGH"
      },
      {
        pattern: /api[_-]?key\s*=\s*['"`][^'"`]+['"`]/gi,
        message: "Hardcoded API key detected",
        severity: "HIGH"
      },
      {
        pattern: /Math\.random\s*\(\s*\)/gi,
        message: "Math.random() is not cryptographically secure",
        severity: "LOW"
      }
    ];

    const lines = content.split("\n");
    const issues: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { pattern, message, severity } of securityPatterns) {
        if (pattern.test(line)) {
          const emoji = severity === "HIGH" ? "🚨" : severity === "MEDIUM" ? "⚠️" : "ℹ️";
          issues.push(`${emoji} ${severity}: Line ${i + 1}: ${message}`);
        }
      }
    }

    if (issues.length > 0) {
      return `🔒 Security Analysis for ${path.basename(filePath)}:\n\n${issues.join("\n")}\n`;
    }

    return "";
  }

  private async checkVulnerableDependencies(workspaceRoot: string): Promise<string> {
    // Try to run npm audit for dependency vulnerabilities
    const { spawn } = require("child_process");
    return new Promise<string>((resolve) => {
      const audit = spawn("npm", ["audit", "--audit-level", "moderate", "--json"], {
        cwd: workspaceRoot,
        shell: true
      });

      let output = "";
      let errorOutput = "";

      audit.stdout.on("data", (data: Buffer) => {
        output += data.toString();
      });

      audit.stderr.on("data", (data: Buffer) => {
        errorOutput += data.toString();
      });

      audit.on("close", (code: number) => {
        if (code === 0) {
          resolve("✅ No known vulnerabilities in dependencies");
        } else {
          try {
            const auditResult = JSON.parse(output);
            if (auditResult.vulnerabilities) {
              const vulnCount = Object.keys(auditResult.vulnerabilities).length;
              resolve(`🚨 Found ${vulnCount} vulnerable dependencies. Run 'npm audit' for details.`);
            } else {
              resolve("✅ No known vulnerabilities in dependencies");
            }
          } catch (parseError) {
            resolve(`Dependency audit completed with warnings. Check 'npm audit' for details.`);
          }
        }
      });

      audit.on("error", (error: Error) => {
        resolve(`Could not run dependency audit: ${error.message}`);
      });
    });
  }

}