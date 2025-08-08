import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";

export interface TechStackInfo {
  languages: string[];
  frameworks: string[];
  libraries: string[];
  tools: string[];
  databases: string[];
  platforms: string[];
  confidence: number;
  packageManagers: string[];
  buildTools: string[];
  testingFrameworks: string[];
}

export interface FileTypeAnalysis {
  extension: string;
  count: number;
  percentage: number;
  language: string;
}

// Technology Stack Analyzer Tool
export class TechStackAnalyzerTool extends BaseTool {
  name = "tech_stack_analyzer";
  description = "Analyze workspace to detect technology stack, frameworks, and dependencies";
  
  schema = z.object({
    action: z.enum(["analyze", "detect_files", "dependencies", "summary"]).describe("Type of analysis to perform"),
    includeDevDeps: z.boolean().optional().describe("Include development dependencies in analysis (default: true)"),
    depth: z.enum(["basic", "detailed", "comprehensive"]).optional().describe("Analysis depth (default: detailed)"),
    excludeDirs: z.array(z.string()).optional().describe("Directories to exclude from analysis (default: node_modules, dist, build)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { action, includeDevDeps = true, depth = "detailed", excludeDirs = [] } = params;
      
      logger.info(`[TECH_STACK] Performing ${action} analysis with ${depth} depth`);

      const workspacePath = this.getWorkspaceRoot();
      const defaultExcludes = ["node_modules", "dist", "build", ".git", ".vscode", "out", "target"];
      const allExcludes = [...defaultExcludes, ...excludeDirs];

      switch (action) {
        case "analyze":
          return await this.analyzeFullStack(workspacePath, includeDevDeps, depth, allExcludes);
        case "detect_files":
          return await this.detectFileTypes(workspacePath, allExcludes);
        case "dependencies":
          return await this.analyzeDependencies(workspacePath, includeDevDeps);
        case "summary":
          return await this.generateSummary(workspacePath, includeDevDeps, allExcludes);
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[TECH_STACK] Analysis failed:", error);
      throw new Error(`Technology stack analysis failed: ${errorMessage}`);
    }
  }

  private async analyzeFullStack(
    workspacePath: string, 
    includeDevDeps: boolean, 
    depth: string, 
    excludeDirs: string[]
  ): Promise<string> {
    const analysis: TechStackInfo = {
      languages: [],
      frameworks: [],
      libraries: [],
      tools: [],
      databases: [],
      platforms: [],
      confidence: 0,
      packageManagers: [],
      buildTools: [],
      testingFrameworks: [],
    };

    // Analyze file types
    const fileAnalysis = await this.analyzeFileTypes(workspacePath, excludeDirs);
    analysis.languages = this.extractLanguagesFromFiles(fileAnalysis);

    // Analyze package files
    await this.analyzePackageFiles(workspacePath, analysis, includeDevDeps);

    // Analyze configuration files
    await this.analyzeConfigFiles(workspacePath, analysis);

    // Analyze project structure
    if (depth === "detailed" || depth === "comprehensive") {
      await this.analyzeProjectStructure(workspacePath, analysis, excludeDirs);
    }

    // Calculate confidence score
    analysis.confidence = this.calculateConfidence(analysis, fileAnalysis);

    let response = `# Technology Stack Analysis\n\n`;
    response += `**Confidence Score:** ${Math.round(analysis.confidence * 100)}%\n\n`;

    response += `## 🔤 Languages (${analysis.languages.length})\n`;
    response += analysis.languages.length > 0 ? 
      analysis.languages.map(lang => `• ${lang}`).join('\n') + '\n\n' : '• None detected\n\n';

    response += `## 🚀 Frameworks (${analysis.frameworks.length})\n`;
    response += analysis.frameworks.length > 0 ? 
      analysis.frameworks.map(fw => `• ${fw}`).join('\n') + '\n\n' : '• None detected\n\n';

    response += `## 📚 Libraries (${analysis.libraries.length})\n`;
    response += analysis.libraries.length > 0 ? 
      analysis.libraries.slice(0, 10).map(lib => `• ${lib}`).join('\n') + 
      (analysis.libraries.length > 10 ? `\n• ... and ${analysis.libraries.length - 10} more` : '') + '\n\n' : '• None detected\n\n';

    response += `## 🛠️ Tools & Build Systems (${analysis.tools.length + analysis.buildTools.length})\n`;
    const allTools = [...analysis.tools, ...analysis.buildTools, ...analysis.packageManagers];
    response += allTools.length > 0 ? 
      allTools.map(tool => `• ${tool}`).join('\n') + '\n\n' : '• None detected\n\n';

    if (analysis.testingFrameworks.length > 0) {
      response += `## 🧪 Testing Frameworks (${analysis.testingFrameworks.length})\n`;
      response += analysis.testingFrameworks.map(test => `• ${test}`).join('\n') + '\n\n';
    }

    if (analysis.databases.length > 0) {
      response += `## 🗄️ Databases (${analysis.databases.length})\n`;
      response += analysis.databases.map(db => `• ${db}`).join('\n') + '\n\n';
    }

    if (analysis.platforms.length > 0) {
      response += `## ☁️ Platforms (${analysis.platforms.length})\n`;
      response += analysis.platforms.map(platform => `• ${platform}`).join('\n') + '\n\n';
    }

    // Add file type breakdown
    response += `## 📁 File Types Distribution\n`;
    fileAnalysis.slice(0, 8).forEach(file => {
      response += `• ${file.language}: ${file.count} files (${file.percentage.toFixed(1)}%)\n`;
    });

    response += `\n## 💡 Recommendations\n`;
    response += this.generateRecommendations(analysis);

    return response;
  }

  private async detectFileTypes(workspacePath: string, excludeDirs: string[]): Promise<string> {
    const fileAnalysis = await this.analyzeFileTypes(workspacePath, excludeDirs);
    
    let response = `# File Type Analysis\n\n`;
    response += `**Total Files Analyzed:** ${fileAnalysis.reduce((sum, f) => sum + f.count, 0)}\n\n`;

    response += `| Language | Files | Percentage |\n`;
    response += `|----------|-------|------------|\n`;
    
    fileAnalysis.forEach(file => {
      response += `| ${file.language} | ${file.count} | ${file.percentage.toFixed(1)}% |\n`;
    });

    return response;
  }

  private async analyzeDependencies(workspacePath: string, includeDevDeps: boolean): Promise<string> {
    const dependencies = await this.extractDependencies(workspacePath, includeDevDeps);
    
    let response = `# Dependency Analysis\n\n`;
    
    if (dependencies.package) {
      response += `## Package.json Dependencies\n`;
      response += `**Production:** ${Object.keys(dependencies.package.prod || {}).length}\n`;
      response += `**Development:** ${Object.keys(dependencies.package.dev || {}).length}\n\n`;
      
      if (Object.keys(dependencies.package.prod || {}).length > 0) {
        response += `### Production Dependencies\n`;
        Object.entries(dependencies.package.prod || {}).slice(0, 15).forEach(([name, version]) => {
          response += `• ${name}@${version}\n`;
        });
        response += '\n';
      }
    }

    if (dependencies.python) {
      response += `## Python Dependencies\n`;
      response += `**Requirements:** ${dependencies.python.length}\n\n`;
      dependencies.python.slice(0, 15).forEach((dep: string) => {
        response += `• ${dep}\n`;
      });
      response += '\n';
    }

    if (dependencies.rust) {
      response += `## Rust Dependencies\n`;
      response += `**Crates:** ${Object.keys(dependencies.rust || {}).length}\n\n`;
      Object.entries(dependencies.rust || {}).slice(0, 15).forEach(([name, version]) => {
        response += `• ${name} = "${version}"\n`;
      });
    }

    return response;
  }

  private async generateSummary(workspacePath: string, includeDevDeps: boolean, excludeDirs: string[]): Promise<string> {
    const fileAnalysis = await this.analyzeFileTypes(workspacePath, excludeDirs);
    const primaryLanguage = fileAnalysis[0]?.language || "Unknown";
    
    const analysis: TechStackInfo = {
      languages: [],
      frameworks: [],
      libraries: [],
      tools: [],
      databases: [],
      platforms: [],
      confidence: 0,
      packageManagers: [],
      buildTools: [],
      testingFrameworks: [],
    };

    await this.analyzePackageFiles(workspacePath, analysis, includeDevDeps);
    
    let response = `# Project Summary\n\n`;
    response += `**Primary Language:** ${primaryLanguage}\n`;
    response += `**Main Framework:** ${analysis.frameworks[0] || "None detected"}\n`;
    response += `**Package Manager:** ${analysis.packageManagers[0] || "None detected"}\n`;
    response += `**Build Tool:** ${analysis.buildTools[0] || "None detected"}\n`;
    response += `**Testing Framework:** ${analysis.testingFrameworks[0] || "None detected"}\n\n`;

    response += `**Project Type:** ${this.inferProjectType(analysis, fileAnalysis)}\n`;
    response += `**Complexity:** ${this.assessComplexity(analysis, fileAnalysis)}\n`;

    return response;
  }

  private async analyzeFileTypes(workspacePath: string, excludeDirs: string[]): Promise<FileTypeAnalysis[]> {
    const fileTypeCounts: Record<string, number> = {};
    
    await this.walkDirectory(workspacePath, excludeDirs, (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext && ext !== '.') {
        fileTypeCounts[ext] = (fileTypeCounts[ext] || 0) + 1;
      }
    });

    const totalFiles = Object.values(fileTypeCounts).reduce((sum, count) => sum + count, 0);
    
    const analysis: FileTypeAnalysis[] = Object.entries(fileTypeCounts)
      .map(([ext, count]) => ({
        extension: ext,
        count,
        percentage: (count / totalFiles) * 100,
        language: this.extensionToLanguage(ext),
      }))
      .sort((a, b) => b.count - a.count);

    return analysis;
  }

  private async analyzePackageFiles(workspacePath: string, analysis: TechStackInfo, includeDevDeps: boolean): Promise<void> {
    // Node.js/JavaScript
    await this.analyzePackageJson(workspacePath, analysis, includeDevDeps);
    
    // Python
    await this.analyzePythonDeps(workspacePath, analysis);
    
    // Rust
    await this.analyzeCargoToml(workspacePath, analysis);
    
    // Go
    await this.analyzeGoMod(workspacePath, analysis);
    
    // Java
    await this.analyzeJavaDeps(workspacePath, analysis);
    
    // .NET
    await this.analyzeDotNetDeps(workspacePath, analysis);
  }

  private async analyzePackageJson(workspacePath: string, analysis: TechStackInfo, includeDevDeps: boolean): Promise<void> {
    try {
      const packagePath = path.join(workspacePath, "package.json");
      const content = await fs.readFile(packagePath, "utf-8");
      const packageJson = JSON.parse(content);

      analysis.packageManagers.push("npm");
      
      const deps = packageJson.dependencies || {};
      const devDeps = includeDevDeps ? (packageJson.devDependencies || {}) : {};
      const allDeps = { ...deps, ...devDeps };

      // Detect frameworks
      this.detectJavaScriptFrameworks(allDeps, analysis);
      
      // Detect libraries
      analysis.libraries.push(...Object.keys(deps));
      
      // Detect tools
      this.detectJavaScriptTools(allDeps, analysis);
      
      // Detect testing frameworks
      this.detectTestingFrameworks(allDeps, analysis);

      // Check for yarn/pnpm
      try {
        await fs.access(path.join(workspacePath, "yarn.lock"));
        if (!analysis.packageManagers.includes("yarn")) {
          analysis.packageManagers.push("yarn");
        }
      } catch {}

      try {
        await fs.access(path.join(workspacePath, "pnpm-lock.yaml"));
        if (!analysis.packageManagers.includes("pnpm")) {
          analysis.packageManagers.push("pnpm");
        }
      } catch {}

    } catch (error) {
      // No package.json found
    }
  }

  private async analyzePythonDeps(workspacePath: string, analysis: TechStackInfo): Promise<void> {
    const files = ["requirements.txt", "Pipfile", "pyproject.toml", "setup.py"];
    
    for (const file of files) {
      try {
        const filePath = path.join(workspacePath, file);
        await fs.access(filePath);
        
        if (!analysis.packageManagers.includes("pip")) {
          analysis.packageManagers.push("pip");
        }
        
        if (file === "Pipfile") {
          analysis.packageManagers.push("pipenv");
        } else if (file === "pyproject.toml") {
          analysis.packageManagers.push("poetry");
        }
        
        if (analysis.languages.includes("Python")) {
          this.detectPythonFrameworks(analysis);
        }
        break;
      } catch {}
    }
  }

  private async analyzeCargoToml(workspacePath: string, analysis: TechStackInfo): Promise<void> {
    try {
      const cargoPath = path.join(workspacePath, "Cargo.toml");
      await fs.access(cargoPath);
      
      analysis.packageManagers.push("cargo");
      analysis.buildTools.push("cargo");
      
      // Read dependencies
      const content = await fs.readFile(cargoPath, "utf-8");
      // Simple parsing - could be enhanced with a TOML parser
      if (content.includes("serde")) analysis.libraries.push("serde");
      if (content.includes("tokio")) analysis.frameworks.push("Tokio");
      if (content.includes("actix-web")) analysis.frameworks.push("Actix Web");
      if (content.includes("warp")) analysis.frameworks.push("Warp");
      
    } catch (error) {
      // No Cargo.toml found
    }
  }

  private async analyzeGoMod(workspacePath: string, analysis: TechStackInfo): Promise<void> {
    try {
      const goModPath = path.join(workspacePath, "go.mod");
      await fs.access(goModPath);
      
      analysis.packageManagers.push("go modules");
      analysis.buildTools.push("go build");
      
    } catch (error) {
      // No go.mod found
    }
  }

  private async analyzeJavaDeps(workspacePath: string, analysis: TechStackInfo): Promise<void> {
    const files = ["pom.xml", "build.gradle", "build.gradle.kts"];
    
    for (const file of files) {
      try {
        await fs.access(path.join(workspacePath, file));
        
        if (file === "pom.xml") {
          analysis.buildTools.push("Maven");
        } else if (file.includes("gradle")) {
          analysis.buildTools.push("Gradle");
        }
        break;
      } catch {}
    }
  }

  private async analyzeDotNetDeps(workspacePath: string, analysis: TechStackInfo): Promise<void> {
    const patterns = ["*.csproj", "*.sln", "*.fsproj", "*.vbproj"];
    
    for (const pattern of patterns) {
      try {
        // Simple check for common .NET files
        const files = await this.findFilesWithPattern(workspacePath, pattern);
        if (files.length > 0) {
          analysis.buildTools.push("dotnet");
          analysis.packageManagers.push("NuGet");
          break;
        }
      } catch {}
    }
  }

  private async analyzeConfigFiles(workspacePath: string, analysis: TechStackInfo): Promise<void> {
    const configFiles = [
      { file: "webpack.config.js", tool: "Webpack" },
      { file: "vite.config.js", tool: "Vite" },
      { file: "rollup.config.js", tool: "Rollup" },
      { file: "tsconfig.json", tool: "TypeScript" },
      { file: "babel.config.js", tool: "Babel" },
      { file: "eslint.config.js", tool: "ESLint" },
      { file: ".eslintrc.js", tool: "ESLint" },
      { file: "prettier.config.js", tool: "Prettier" },
      { file: "docker-compose.yml", tool: "Docker Compose" },
      { file: "Dockerfile", tool: "Docker" },
      { file: "Makefile", tool: "Make" },
    ];

    for (const { file, tool } of configFiles) {
      try {
        await fs.access(path.join(workspacePath, file));
        if (!analysis.tools.includes(tool)) {
          analysis.tools.push(tool);
        }
      } catch {}
    }
  }

  private async analyzeProjectStructure(workspacePath: string, analysis: TechStackInfo, excludeDirs: string[]): Promise<void> {
    // Detect common project patterns
    const structures = [
      { dir: "src", indicator: "Standard source structure" },
      { dir: "public", indicator: "Web frontend" },
      { dir: "pages", indicator: "Next.js or similar" },
      { dir: "components", indicator: "Component-based architecture" },
      { dir: "api", indicator: "API backend" },
      { dir: "migrations", indicator: "Database migrations" },
      { dir: "tests", indicator: "Test suite" },
      { dir: "__tests__", indicator: "Jest tests" },
      { dir: "cypress", indicator: "Cypress E2E testing" },
    ];

    for (const { dir, indicator } of structures) {
      try {
        const dirPath = path.join(workspacePath, dir);
        const stat = await fs.stat(dirPath);
        if (stat.isDirectory()) {
          // Could add more sophisticated analysis here
        }
      } catch {}
    }
  }

  private extractLanguagesFromFiles(fileAnalysis: FileTypeAnalysis[]): string[] {
    return fileAnalysis
      .filter(f => f.percentage > 1) // Only languages with >1% of files
      .map(f => f.language)
      .filter(lang => lang !== "Other");
  }

  private extensionToLanguage(ext: string): string {
    const mapping: Record<string, string> = {
      ".js": "JavaScript",
      ".jsx": "JavaScript",
      ".ts": "TypeScript",
      ".tsx": "TypeScript",
      ".py": "Python",
      ".rs": "Rust",
      ".go": "Go",
      ".java": "Java",
      ".cs": "C#",
      ".cpp": "C++",
      ".c": "C",
      ".php": "PHP",
      ".rb": "Ruby",
      ".swift": "Swift",
      ".kt": "Kotlin",
      ".dart": "Dart",
      ".scala": "Scala",
      ".html": "HTML",
      ".css": "CSS",
      ".scss": "SCSS",
      ".less": "LESS",
      ".vue": "Vue",
      ".svelte": "Svelte",
      ".json": "JSON",
      ".yaml": "YAML",
      ".yml": "YAML",
      ".toml": "TOML",
      ".xml": "XML",
      ".md": "Markdown",
      ".sh": "Shell",
      ".ps1": "PowerShell",
    };

    return mapping[ext] || "Other";
  }

  private detectJavaScriptFrameworks(deps: Record<string, string>, analysis: TechStackInfo): void {
    const frameworkMap: Record<string, string> = {
      "react": "React",
      "vue": "Vue.js",
      "@angular/core": "Angular",
      "svelte": "Svelte",
      "next": "Next.js",
      "nuxt": "Nuxt.js",
      "gatsby": "Gatsby",
      "express": "Express.js",
      "fastify": "Fastify",
      "koa": "Koa.js",
      "nestjs": "NestJS",
      "@nestjs/core": "NestJS",
      "electron": "Electron",
      "react-native": "React Native",
    };

    for (const [dep, framework] of Object.entries(frameworkMap)) {
      if (deps[dep] && !analysis.frameworks.includes(framework)) {
        analysis.frameworks.push(framework);
      }
    }
  }

  private detectJavaScriptTools(deps: Record<string, string>, analysis: TechStackInfo): void {
    const toolMap: Record<string, string> = {
      "webpack": "Webpack",
      "vite": "Vite",
      "rollup": "Rollup",
      "parcel": "Parcel",
      "babel": "Babel",
      "@babel/core": "Babel",
      "eslint": "ESLint",
      "prettier": "Prettier",
      "typescript": "TypeScript",
      "sass": "Sass",
      "less": "Less",
      "postcss": "PostCSS",
    };

    for (const [dep, tool] of Object.entries(toolMap)) {
      if (deps[dep] && !analysis.tools.includes(tool)) {
        analysis.tools.push(tool);
      }
    }
  }

  private detectTestingFrameworks(deps: Record<string, string>, analysis: TechStackInfo): void {
    const testingMap: Record<string, string> = {
      "jest": "Jest",
      "mocha": "Mocha",
      "jasmine": "Jasmine",
      "vitest": "Vitest",
      "cypress": "Cypress",
      "playwright": "Playwright",
      "@testing-library/react": "React Testing Library",
      "@testing-library/vue": "Vue Testing Library",
      "enzyme": "Enzyme",
    };

    for (const [dep, framework] of Object.entries(testingMap)) {
      if (deps[dep] && !analysis.testingFrameworks.includes(framework)) {
        analysis.testingFrameworks.push(framework);
      }
    }
  }

  private detectPythonFrameworks(analysis: TechStackInfo): void {
    // This could be enhanced by reading actual requirements files
    const common = ["Django", "Flask", "FastAPI", "Tornado"];
    // For now, just add placeholder - would need to read actual files
  }

  private calculateConfidence(analysis: TechStackInfo, fileAnalysis: FileTypeAnalysis[]): number {
    let confidence = 0;
    
    // File type diversity
    if (fileAnalysis.length > 0) confidence += 0.3;
    
    // Package manager detected
    if (analysis.packageManagers.length > 0) confidence += 0.2;
    
    // Frameworks detected
    if (analysis.frameworks.length > 0) confidence += 0.3;
    
    // Build tools detected
    if (analysis.buildTools.length > 0) confidence += 0.2;
    
    return Math.min(confidence, 1.0);
  }

  private inferProjectType(analysis: TechStackInfo, fileAnalysis: FileTypeAnalysis[]): string {
    if (analysis.frameworks.includes("React") || analysis.frameworks.includes("Vue.js") || analysis.frameworks.includes("Angular")) {
      return "Web Frontend Application";
    }
    
    if (analysis.frameworks.includes("Express.js") || analysis.frameworks.includes("Fastify") || analysis.frameworks.includes("NestJS")) {
      return "Web Backend API";
    }
    
    if (analysis.frameworks.includes("Next.js") || analysis.frameworks.includes("Nuxt.js")) {
      return "Full-Stack Web Application";
    }
    
    if (analysis.frameworks.includes("React Native") || analysis.frameworks.includes("Flutter")) {
      return "Mobile Application";
    }
    
    if (analysis.frameworks.includes("Electron")) {
      return "Desktop Application";
    }
    
    const primaryLang = fileAnalysis[0]?.language;
    if (primaryLang === "Python") return "Python Application";
    if (primaryLang === "Rust") return "Rust Application";
    if (primaryLang === "Go") return "Go Application";
    if (primaryLang === "Java") return "Java Application";
    
    return "General Application";
  }

  private assessComplexity(analysis: TechStackInfo, fileAnalysis: FileTypeAnalysis[]): string {
    const totalFrameworks = analysis.frameworks.length + analysis.tools.length + analysis.buildTools.length;
    const totalFiles = fileAnalysis.reduce((sum, f) => sum + f.count, 0);
    
    if (totalFrameworks > 8 || totalFiles > 1000) return "High";
    if (totalFrameworks > 4 || totalFiles > 200) return "Medium";
    return "Low";
  }

  private generateRecommendations(analysis: TechStackInfo): string {
    const recommendations: string[] = [];
    
    if (analysis.testingFrameworks.length === 0) {
      recommendations.push("• Consider adding a testing framework for better code quality");
    }
    
    if (!analysis.tools.includes("ESLint") && analysis.languages.includes("JavaScript")) {
      recommendations.push("• Add ESLint for JavaScript code linting");
    }
    
    if (!analysis.tools.includes("TypeScript") && analysis.languages.includes("JavaScript")) {
      recommendations.push("• Consider migrating to TypeScript for better type safety");
    }
    
    if (analysis.frameworks.length === 0 && analysis.languages.includes("JavaScript")) {
      recommendations.push("• Consider using a framework like React, Vue, or Express for better structure");
    }
    
    if (recommendations.length === 0) {
      recommendations.push("• Your project appears to be well-structured with appropriate tooling");
    }
    
    return recommendations.join('\n');
  }

  private async walkDirectory(
    dirPath: string, 
    excludeDirs: string[], 
    callback: (filePath: string) => void
  ): Promise<void> {
    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        if (excludeDirs.some(exclude => item.includes(exclude))) {
          continue;
        }
        
        const fullPath = path.join(dirPath, item);
        const stat = await fs.stat(fullPath);
        
        if (stat.isDirectory()) {
          await this.walkDirectory(fullPath, excludeDirs, callback);
        } else {
          callback(fullPath);
        }
      }
    } catch (error) {
      // Directory not accessible, skip
    }
  }

  private async extractDependencies(workspacePath: string, includeDevDeps: boolean): Promise<any> {
    const result: any = {};
    
    // Package.json
    try {
      const packagePath = path.join(workspacePath, "package.json");
      const content = await fs.readFile(packagePath, "utf-8");
      const packageJson = JSON.parse(content);
      
      result.package = {
        prod: packageJson.dependencies || {},
        dev: includeDevDeps ? (packageJson.devDependencies || {}) : {},
      };
    } catch {}
    
    // Python requirements
    try {
      const reqPath = path.join(workspacePath, "requirements.txt");
      const content = await fs.readFile(reqPath, "utf-8");
      result.python = content.split('\n').filter((line: string) => line.trim() && !line.startsWith('#'));
    } catch {}
    
    // Rust Cargo.toml
    try {
      const cargoPath = path.join(workspacePath, "Cargo.toml");
      const content = await fs.readFile(cargoPath, "utf-8");
      // Simple TOML parsing for dependencies section
      const depsMatch = content.match(/\[dependencies\]([\s\S]*?)(\[|$)/);
      if (depsMatch) {
        const depsSection = depsMatch[1];
        const deps: Record<string, string> = {};
        depsSection.split('\n').forEach((line: string) => {
          const match = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
          if (match) {
            deps[match[1]] = match[2];
          }
        });
        result.rust = deps;
      }
    } catch {}
    
    return result;
  }

  private async findFilesWithPattern(dirPath: string, pattern: string): Promise<string[]> {
    // Simplified glob matching - could use a proper glob library
    const files: string[] = [];
    const ext = pattern.replace('*.', '.');
    
    await this.walkDirectory(dirPath, [], (filePath) => {
      if (path.extname(filePath) === ext) {
        files.push(filePath);
      }
    });
    
    return files;
  }
}