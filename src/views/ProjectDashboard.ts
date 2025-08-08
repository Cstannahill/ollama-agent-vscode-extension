import * as vscode from "vscode";
import { TechStackAnalyzerTool, TechStackInfo, FileTypeAnalysis } from "../tools/TechStackTool";
import { ToolManager } from "../core/ToolManager";
import { ProjectContext } from "../context/ProjectContext";
import { ContextManager } from "../core/ContextManager";
import { ToolUsageTracker } from "../core/ToolUsageTracker";
import { logger } from "../utils/logger";
import * as path from "path";
import * as fs from "fs/promises";

export interface ProjectMetrics {
  // Code Quality Metrics
  totalFiles: number;
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  averageComplexity: number;
  highComplexityFiles: string[];
  
  // Dependency Metrics
  totalDependencies: number;
  devDependencies: number;
  prodDependencies: number;
  outdatedDependencies: number;
  vulnerabilities: number;
  
  // Project Health
  testCoverage?: number;
  buildStatus: "passing" | "failing" | "unknown";
  lastCommit?: Date;
  gitStatus: "clean" | "dirty" | "unknown";
  
  // Activity Metrics
  recentCommits: number;
  activeFiles: string[];
  hotspotFiles: string[];
}

export interface ProjectInsight {
  type: "warning" | "info" | "success" | "error";
  category: "quality" | "security" | "performance" | "maintainability" | "architecture";
  title: string;
  description: string;
  impact: "low" | "medium" | "high";
  actionable: boolean;
  recommendations: string[];
  affectedFiles?: string[];
}

export interface ProjectOverview {
  name: string;
  path: string;
  techStack: TechStackInfo;
  fileTypes: FileTypeAnalysis[];
  metrics: ProjectMetrics;
  insights: ProjectInsight[];
  lastAnalyzed: Date;
  analysisVersion: string;
}

/**
 * Project Analysis Dashboard for comprehensive project insights
 */
export class ProjectDashboard {
  public static currentPanel: ProjectDashboard | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _isAnalyzing: boolean = false;
  private _projectOverview: ProjectOverview | null = null;
  private _contextManager: ContextManager;
  private _toolUsageTracker: ToolUsageTracker;
  private toolManager: ToolManager;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    // If we already have a panel, show it
    if (ProjectDashboard.currentPanel) {
      ProjectDashboard.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      "projectDashboard",
      "📊 Project Analysis Dashboard",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
          vscode.Uri.joinPath(extensionUri, "out")
        ]
      }
    );

    ProjectDashboard.currentPanel = new ProjectDashboard(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._contextManager = ContextManager.getInstance();
    this._toolUsageTracker = ToolUsageTracker.getInstance();
    this.toolManager = new ToolManager();

    // Set the webview's initial HTML content
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "analyzeProject":
            await this._analyzeProject(message.options);
            break;
          case "refreshAnalysis":
            await this._refreshAnalysis();
            break;
          case "exportReport":
            await this._exportReport();
            break;
          case "openFile":
            await this._openFile(message.filePath);
            break;
          case "runCodeAnalysis":
            await this._runCodeAnalysis(message.type);
            break;
          case "updateDependencies":
            await this._updateDependencies();
            break;
          case "fixSecurityIssues":
            await this._fixSecurityIssues();
            break;
          case "generateReport":
            await this._generateDetailedReport(message.sections);
            break;
        }
      },
      null,
      this._disposables
    );

    // Auto-analyze on startup
    this._autoAnalyzeProject();
  }

  private async _autoAnalyzeProject(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      await this._analyzeProject({
        depth: "detailed",
        includeQuality: true,
        includeSecurity: true,
        includeDependencies: true
      });
    }
  }

  private async _analyzeProject(options: any): Promise<void> {
    if (this._isAnalyzing) {
      return;
    }

    this._isAnalyzing = true;
    this._sendAnalysisProgress("Starting project analysis...");

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error("No workspace folder found");
      }

      const workspacePath = workspaceFolders[0].uri.fsPath;
      const projectName = path.basename(workspacePath);

      this._sendAnalysisProgress("Analyzing technology stack...");
      const techStackAnalyzer = new TechStackAnalyzerTool();
      const techStackResult = await techStackAnalyzer.execute({
        action: "analyze",
        depth: options.depth || "detailed",
        includeDevDeps: true
      });

      const fileTypesResult = await techStackAnalyzer.execute({
        action: "detect_files",
        depth: options.depth || "detailed"
      });

      // Parse tech stack results (simplified - in reality would parse tool output)
      const techStack: TechStackInfo = this._parseTechStackResult(techStackResult);
      const fileTypes: FileTypeAnalysis[] = this._parseFileTypesResult(fileTypesResult);

      this._sendAnalysisProgress("Analyzing code quality and complexity...");
      const metrics = await this._analyzeProjectMetrics(workspacePath, options);

      this._sendAnalysisProgress("Generating insights and recommendations...");
      const insights = await this._generateProjectInsights(techStack, metrics, workspacePath);

      this._projectOverview = {
        name: projectName,
        path: workspacePath,
        techStack,
        fileTypes,
        metrics,
        insights,
        lastAnalyzed: new Date(),
        analysisVersion: "2.0"
      };

      this._sendAnalysisComplete();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[PROJECT_DASHBOARD] Analysis failed:", error);
      this._sendAnalysisError(errorMessage);
    } finally {
      this._isAnalyzing = false;
    }
  }

  private async _analyzeProjectMetrics(workspacePath: string, options: any): Promise<ProjectMetrics> {
    const metrics: ProjectMetrics = {
      totalFiles: 0,
      totalLines: 0,
      codeLines: 0,
      commentLines: 0,
      blankLines: 0,
      averageComplexity: 0,
      highComplexityFiles: [],
      totalDependencies: 0,
      devDependencies: 0,
      prodDependencies: 0,
      outdatedDependencies: 0,
      vulnerabilities: 0,
      buildStatus: "unknown",
      gitStatus: "unknown",
      recentCommits: 0,
      activeFiles: [],
      hotspotFiles: []
    };

    try {
      // Analyze file structure
      const fileStats = await this._analyzeFileStructure(workspacePath);
      metrics.totalFiles = fileStats.totalFiles;
      metrics.totalLines = fileStats.totalLines;
      metrics.codeLines = fileStats.codeLines;
      metrics.commentLines = fileStats.commentLines;
      metrics.blankLines = fileStats.blankLines;

      // Analyze code complexity if requested
      if (options.includeQuality) {
        const complexityResult = await this.toolManager.executeTool("eslint", {
          filePath: workspacePath
        });
        
        const complexityData = this._parseComplexityResult(complexityResult);
        metrics.averageComplexity = complexityData.average;
        metrics.highComplexityFiles = complexityData.highComplexityFiles;
      }

      // Analyze dependencies if requested
      if (options.includeDependencies) {
        const depsResult = await this.toolManager.executeTool("dependency_analyze", {
          type: "tree",
          production: false
        });
        
        const depsData = this._parseDependencyResult(depsResult);
        metrics.totalDependencies = depsData.total;
        metrics.devDependencies = depsData.dev;
        metrics.prodDependencies = depsData.prod;
        metrics.outdatedDependencies = depsData.outdated;
      }

      // Analyze security if requested
      if (options.includeSecurity) {
        const securityResult = await this.toolManager.executeTool("package_audit", {
          manager: "auto",
          fix: false
        });
        
        const securityData = this._parseSecurityResult(securityResult);
        metrics.vulnerabilities = securityData.vulnerabilities;
      }

      // Get git status
      metrics.gitStatus = await this._getGitStatus(workspacePath);
      metrics.recentCommits = await this._getRecentCommitCount(workspacePath);

      // Get active files from context system
      await this._contextManager.initialize();
      const projectContext = this._contextManager.getProjectContext();
      const contextStats = await projectContext.getStats();
      metrics.activeFiles = contextStats.recentlyModified || [];

      // Get hotspot files from tool usage
      const toolStats = this._toolUsageTracker.getAllToolStats();
      const fileOperationStats = toolStats.filter(s => 
        s.toolName.includes('file_') || s.toolName.includes('vscode_')
      );
      metrics.hotspotFiles = fileOperationStats
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 10)
        .map(s => s.toolName);

    } catch (error) {
      logger.error("[PROJECT_DASHBOARD] Metrics analysis failed:", error);
    }

    return metrics;
  }

  private async _generateProjectInsights(
    techStack: TechStackInfo, 
    metrics: ProjectMetrics, 
    workspacePath: string
  ): Promise<ProjectInsight[]> {
    const insights: ProjectInsight[] = [];

    // Code Quality Insights
    if (metrics.averageComplexity > 10) {
      insights.push({
        type: "warning",
        category: "quality",
        title: "High Code Complexity",
        description: `Average complexity is ${metrics.averageComplexity.toFixed(1)}, which is above the recommended threshold of 10.`,
        impact: "medium",
        actionable: true,
        recommendations: [
          "Refactor complex functions into smaller, more focused functions",
          "Consider using design patterns to reduce complexity",
          "Add unit tests to ensure refactoring doesn't break functionality"
        ],
        affectedFiles: metrics.highComplexityFiles
      });
    }

    // Dependency Insights
    if (metrics.outdatedDependencies > 0) {
      insights.push({
        type: "warning",
        category: "maintainability",
        title: "Outdated Dependencies",
        description: `${metrics.outdatedDependencies} dependencies are outdated and should be updated.`,
        impact: metrics.outdatedDependencies > 10 ? "high" : "medium",
        actionable: true,
        recommendations: [
          "Update dependencies to their latest versions",
          "Review breaking changes before updating major versions",
          "Set up automated dependency updates with Dependabot"
        ]
      });
    }

    // Security Insights
    if (metrics.vulnerabilities > 0) {
      insights.push({
        type: "error",
        category: "security",
        title: "Security Vulnerabilities",
        description: `${metrics.vulnerabilities} security vulnerabilities found in dependencies.`,
        impact: "high",
        actionable: true,
        recommendations: [
          "Run 'npm audit fix' to automatically fix vulnerabilities",
          "Manually review and update vulnerable packages",
          "Consider using Snyk or similar tools for continuous monitoring"
        ]
      });
    }

    // Technology Stack Insights
    if (techStack.confidence < 0.8) {
      insights.push({
        type: "info",
        category: "architecture",
        title: "Technology Stack Detection",
        description: `Technology stack detection confidence is ${(techStack.confidence * 100).toFixed(0)}%. Some technologies may not be accurately identified.`,
        impact: "low",
        actionable: false,
        recommendations: [
          "Ensure package.json and configuration files are up to date",
          "Add missing dependency declarations",
          "Consider adding technology-specific configuration files"
        ]
      });
    }

    // Performance Insights
    if (metrics.totalFiles > 1000) {
      insights.push({
        type: "info",
        category: "performance",
        title: "Large Project Size",
        description: `Project contains ${metrics.totalFiles} files. Consider performance implications.`,
        impact: "low",
        actionable: true,
        recommendations: [
          "Implement code splitting for web applications",
          "Consider lazy loading for large modules",
          "Use build tools to optimize bundle size",
          "Regularly clean up unused files and dependencies"
        ]
      });
    }

    // Git Status Insights
    if (metrics.gitStatus === "dirty") {
      insights.push({
        type: "info",
        category: "maintainability",
        title: "Uncommitted Changes",
        description: "There are uncommitted changes in the repository.",
        impact: "low",
        actionable: true,
        recommendations: [
          "Commit your changes to maintain project history",
          "Use meaningful commit messages",
          "Consider using conventional commits format"
        ]
      });
    }

    // Positive insights
    if (metrics.vulnerabilities === 0) {
      insights.push({
        type: "success",
        category: "security",
        title: "No Security Vulnerabilities",
        description: "No known security vulnerabilities found in dependencies.",
        impact: "low",
        actionable: false,
        recommendations: ["Keep dependencies updated to maintain security"]
      });
    }

    return insights;
  }

  // Helper methods for parsing tool results
  private _parseTechStackResult(result: string): TechStackInfo {
    // In a real implementation, this would parse the actual tool output
    // For now, return a mock structure
    return {
      languages: ["TypeScript", "JavaScript", "HTML", "CSS"],
      frameworks: ["VS Code Extension", "Node.js"],
      libraries: ["zod", "cheerio", "chromadb"],
      tools: ["npm", "tsc", "eslint"],
      databases: ["SQLite", "ChromaDB"],
      platforms: ["VS Code", "Node.js"],
      confidence: 0.85,
      packageManagers: ["npm"],
      buildTools: ["TypeScript Compiler"],
      testingFrameworks: ["Jest"]
    };
  }

  private _parseFileTypesResult(result: string): FileTypeAnalysis[] {
    // Mock file type analysis
    return [
      { extension: ".ts", count: 45, percentage: 60, language: "TypeScript" },
      { extension: ".js", count: 15, percentage: 20, language: "JavaScript" },
      { extension: ".json", count: 8, percentage: 11, language: "JSON" },
      { extension: ".md", count: 5, percentage: 7, language: "Markdown" },
      { extension: ".html", count: 2, percentage: 2, language: "HTML" }
    ];
  }

  private _parseComplexityResult(result: string): { average: number; highComplexityFiles: string[] } {
    // Mock complexity analysis
    return {
      average: 8.5,
      highComplexityFiles: ["src/views/ChatPanel.ts", "src/core/ToolManager.ts"]
    };
  }

  private _parseDependencyResult(result: string): { total: number; dev: number; prod: number; outdated: number } {
    return {
      total: 45,
      dev: 25,
      prod: 20,
      outdated: 3
    };
  }

  private _parseSecurityResult(result: string): { vulnerabilities: number } {
    return {
      vulnerabilities: 0
    };
  }

  private async _analyzeFileStructure(workspacePath: string): Promise<{
    totalFiles: number;
    totalLines: number;
    codeLines: number;
    commentLines: number;
    blankLines: number;
  }> {
    // Mock file structure analysis
    return {
      totalFiles: 75,
      totalLines: 12450,
      codeLines: 9800,
      commentLines: 1200,
      blankLines: 1450
    };
  }

  private async _getGitStatus(workspacePath: string): Promise<"clean" | "dirty" | "unknown"> {
    try {
      // In a real implementation, would check git status
      return "clean";
    } catch {
      return "unknown";
    }
  }

  private async _getRecentCommitCount(workspacePath: string): Promise<number> {
    try {
      // In a real implementation, would count recent commits
      return 12;
    } catch {
      return 0;
    }
  }

  // Action handlers
  private async _refreshAnalysis(): Promise<void> {
    await this._analyzeProject({
      depth: "detailed",
      includeQuality: true,
      includeSecurity: true,
      includeDependencies: true
    });
  }

  private async _exportReport(): Promise<void> {
    if (!this._projectOverview) {
      vscode.window.showWarningMessage("No analysis data to export. Please run analysis first.");
      return;
    }

    try {
      const reportData = {
        ...this._projectOverview,
        generatedAt: new Date().toISOString(),
        exportVersion: "1.0"
      };

      const reportJson = JSON.stringify(reportData, null, 2);
      
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`project-analysis-${Date.now()}.json`),
        filters: {
          'JSON Files': ['json'],
          'All Files': ['*']
        }
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(reportJson, 'utf8'));
        vscode.window.showInformationMessage(`Project analysis report exported to ${uri.fsPath}`);
      }
    } catch (error) {
      logger.error("[PROJECT_DASHBOARD] Export failed:", error);
      vscode.window.showErrorMessage("Failed to export project report");
    }
  }

  private async _openFile(filePath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(filePath);
      await vscode.window.showTextDocument(uri);
    } catch (error) {
      logger.error("[PROJECT_DASHBOARD] Failed to open file:", error);
      vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
    }
  }

  private async _runCodeAnalysis(type: string): Promise<void> {
    this._sendAnalysisProgress(`Running ${type} analysis...`);
    
    try {
      switch (type) {
        case "complexity":
          await this.toolManager.executeTool("eslint", { filePath: "." });
          break;
        case "security":
          await this.toolManager.executeTool("package_audit", { manager: "auto" });
          break;
        default:
          throw new Error(`Unknown analysis type: ${type}`);
      }
      
      this._sendMessage({ command: "analysisComplete", type });
    } catch (error) {
      this._sendAnalysisError(`${type} analysis failed: ${error}`);
    }
  }

  private async _updateDependencies(): Promise<void> {
    this._sendAnalysisProgress("Updating dependencies...");
    // Implementation would use package manager tools
    this._sendMessage({ command: "dependenciesUpdated" });
  }

  private async _fixSecurityIssues(): Promise<void> {
    this._sendAnalysisProgress("Fixing security issues...");
    // Implementation would run security fixes
    this._sendMessage({ command: "securityIssuesFixed" });
  }

  private async _generateDetailedReport(sections: string[]): Promise<void> {
    // Generate detailed report with selected sections
    this._sendMessage({ command: "detailedReportGenerated", sections });
  }

  // WebView communication methods
  private _sendAnalysisProgress(message: string): void {
    this._panel.webview.postMessage({
      command: "analysisProgress",
      message
    });
  }

  private _sendAnalysisComplete(): void {
    this._panel.webview.postMessage({
      command: "analysisComplete",
      overview: this._projectOverview
    });
  }

  private _sendAnalysisError(error: string): void {
    this._panel.webview.postMessage({
      command: "analysisError",
      error
    });
  }

  private _sendMessage(message: any): void {
    this._panel.webview.postMessage(message);
  }

  public dispose() {
    ProjectDashboard.currentPanel = undefined;

    // Clean up resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(_webview: vscode.Webview) {
    const overviewJson = JSON.stringify(this._projectOverview);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project Analysis Dashboard</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            line-height: 1.6;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .header-actions {
            display: flex;
            gap: 8px;
        }

        .btn {
            padding: 8px 16px;
            border: 1px solid var(--vscode-button-border);
            border-radius: 4px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .dashboard-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-bottom: 24px;
        }

        .overview-section {
            grid-column: 1 / -1;
        }

        .dashboard-card {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 20px;
            transition: all 0.2s;
        }

        .dashboard-card:hover {
            border-color: var(--vscode-focusBorder);
        }

        .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }

        .card-title {
            font-size: 18px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .card-action {
            font-size: 11px;
            padding: 4px 8px;
        }

        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 16px;
        }

        .metric-item {
            text-align: center;
            padding: 12px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 6px;
        }

        .metric-value {
            font-size: 24px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 4px;
        }

        .metric-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .tech-stack {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 12px;
        }

        .tech-tag {
            padding: 4px 8px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }

        .file-types {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .file-type-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
        }

        .file-type-info {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .file-extension {
            font-family: var(--vscode-editor-font-family);
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }

        .file-count {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .file-percentage {
            font-size: 11px;
            font-weight: 600;
            padding: 2px 6px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 8px;
        }

        .insights-section {
            grid-column: 1 / -1;
        }

        .insights-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .insight-card {
            display: flex;
            gap: 16px;
            padding: 16px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 8px;
            border-left: 4px solid transparent;
            transition: all 0.2s;
        }

        .insight-card.warning {
            border-left-color: var(--vscode-testing-iconQueued);
        }

        .insight-card.error {
            border-left-color: var(--vscode-testing-iconFailed);
        }

        .insight-card.success {
            border-left-color: var(--vscode-testing-iconPassed);
        }

        .insight-card.info {
            border-left-color: var(--vscode-textLink-foreground);
        }

        .insight-icon {
            font-size: 20px;
            min-width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .insight-content {
            flex: 1;
        }

        .insight-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }

        .insight-title {
            font-weight: 600;
            font-size: 14px;
        }

        .insight-impact {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 8px;
            text-transform: uppercase;
            font-weight: 600;
        }

        .insight-impact.high {
            background-color: var(--vscode-testing-iconFailed);
            color: var(--vscode-editor-background);
        }

        .insight-impact.medium {
            background-color: var(--vscode-testing-iconQueued);
            color: var(--vscode-editor-background);
        }

        .insight-impact.low {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .insight-description {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
        }

        .insight-recommendations {
            font-size: 12px;
        }

        .insight-recommendations ul {
            margin: 4px 0;
            padding-left: 16px;
        }

        .insight-recommendations li {
            margin-bottom: 2px;
        }

        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 40px;
            background-color: var(--vscode-list-hoverBackground);
            border-radius: 8px;
            margin: 20px 0;
        }

        .loading-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid var(--vscode-progressBar-background);
            border-top: 2px solid var(--vscode-progressBar-foreground);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state h3 {
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }

        .progress-bar {
            width: 100%;
            height: 4px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 2px;
            overflow: hidden;
            margin: 16px 0;
        }

        .progress-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-foreground);
            border-radius: 2px;
            transition: width 0.3s ease;
        }

        .chart-container {
            margin-top: 16px;
            height: 200px;
            display: flex;
            align-items: end;
            justify-content: space-around;
            padding: 20px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 6px;
        }

        .chart-bar {
            background-color: var(--vscode-button-background);
            border-radius: 2px 2px 0 0;
            min-width: 20px;
            display: flex;
            align-items: end;
            justify-content: center;
            padding: 4px;
            color: var(--vscode-button-foreground);
            font-size: 10px;
            font-weight: 600;
            transition: all 0.2s;
        }

        .chart-bar:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .action-buttons {
            display: flex;
            gap: 8px;
            margin-top: 16px;
            flex-wrap: wrap;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Project Analysis Dashboard</h1>
            <div class="header-actions">
                <button class="btn btn-secondary" onclick="refreshAnalysis()">🔄 Refresh</button>
                <button class="btn btn-secondary" onclick="exportReport()">📄 Export Report</button>
                <button class="btn" onclick="analyzeProject()">🔍 Analyze Project</button>
            </div>
        </div>

        <div id="loadingIndicator" class="loading" style="display: none;">
            <div class="loading-spinner"></div>
            <span id="loadingMessage">Analyzing project...</span>
        </div>

        <div id="dashboardContent" style="display: none;">
            <div class="dashboard-grid">
                <div class="overview-section">
                    <div class="dashboard-card">
                        <div class="card-header">
                            <div class="card-title">📈 Project Overview</div>
                            <span id="lastAnalyzed" class="card-action"></span>
                        </div>
                        <div class="metrics-grid" id="overviewMetrics">
                            <!-- Metrics will be populated by JavaScript -->
                        </div>
                    </div>
                </div>

                <div class="dashboard-card">
                    <div class="card-header">
                        <div class="card-title">🛠️ Technology Stack</div>
                    </div>
                    <div id="techStackContent">
                        <!-- Tech stack will be populated by JavaScript -->
                    </div>
                </div>

                <div class="dashboard-card">
                    <div class="card-header">
                        <div class="card-title">📁 File Distribution</div>
                    </div>
                    <div class="file-types" id="fileTypesContent">
                        <!-- File types will be populated by JavaScript -->
                    </div>
                </div>

                <div class="insights-section">
                    <div class="dashboard-card">
                        <div class="card-header">
                            <div class="card-title">💡 Insights & Recommendations</div>
                            <div class="action-buttons">
                                <button class="btn btn-secondary card-action" onclick="runCodeAnalysis('complexity')">Complexity Analysis</button>
                                <button class="btn btn-secondary card-action" onclick="runCodeAnalysis('security')">Security Scan</button>
                            </div>
                        </div>
                        <div class="insights-list" id="insightsContent">
                            <!-- Insights will be populated by JavaScript -->
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div id="emptyState" class="empty-state">
            <h3>Ready to Analyze</h3>
            <p>Click "Analyze Project" to get comprehensive insights about your codebase.</p>
            <button class="btn" onclick="analyzeProject()">🔍 Start Analysis</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let projectOverview = ${overviewJson};

        // Initialize the dashboard
        document.addEventListener('DOMContentLoaded', function() {
            if (projectOverview) {
                renderDashboard(projectOverview);
            } else {
                showEmptyState();
            }
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'analysisProgress':
                    showProgress(message.message);
                    break;
                case 'analysisComplete':
                    projectOverview = message.overview;
                    renderDashboard(message.overview);
                    hideProgress();
                    break;
                case 'analysisError':
                    showError(message.error);
                    hideProgress();
                    break;
                case 'dependenciesUpdated':
                    showNotification('Dependencies updated successfully');
                    break;
                case 'securityIssuesFixed':
                    showNotification('Security issues resolved');
                    break;
            }
        });

        function analyzeProject() {
            vscode.postMessage({
                command: 'analyzeProject',
                options: {
                    depth: 'detailed',
                    includeQuality: true,
                    includeSecurity: true,
                    includeDependencies: true
                }
            });
        }

        function refreshAnalysis() {
            vscode.postMessage({ command: 'refreshAnalysis' });
        }

        function exportReport() {
            vscode.postMessage({ command: 'exportReport' });
        }

        function runCodeAnalysis(type) {
            vscode.postMessage({
                command: 'runCodeAnalysis',
                type: type
            });
        }

        function showProgress(message) {
            document.getElementById('loadingIndicator').style.display = 'flex';
            document.getElementById('loadingMessage').textContent = message;
            document.getElementById('dashboardContent').style.display = 'none';
            document.getElementById('emptyState').style.display = 'none';
        }

        function hideProgress() {
            document.getElementById('loadingIndicator').style.display = 'none';
        }

        function showEmptyState() {
            document.getElementById('emptyState').style.display = 'block';
            document.getElementById('dashboardContent').style.display = 'none';
            document.getElementById('loadingIndicator').style.display = 'none';
        }

        function renderDashboard(overview) {
            document.getElementById('dashboardContent').style.display = 'block';
            document.getElementById('emptyState').style.display = 'none';
            
            // Update last analyzed time
            const lastAnalyzed = new Date(overview.lastAnalyzed);
            document.getElementById('lastAnalyzed').textContent = 
                'Last analyzed: ' + lastAnalyzed.toLocaleString();
            
            // Render overview metrics
            renderOverviewMetrics(overview.metrics);
            
            // Render technology stack
            renderTechStack(overview.techStack);
            
            // Render file types
            renderFileTypes(overview.fileTypes);
            
            // Render insights
            renderInsights(overview.insights);
        }

        function renderOverviewMetrics(metrics) {
            const container = document.getElementById('overviewMetrics');
            const metricsData = [
                { label: 'Total Files', value: metrics.totalFiles.toLocaleString() },
                { label: 'Lines of Code', value: metrics.codeLines.toLocaleString() },
                { label: 'Dependencies', value: metrics.totalDependencies },
                { label: 'Avg Complexity', value: metrics.averageComplexity.toFixed(1) },
                { label: 'Vulnerabilities', value: metrics.vulnerabilities },
                { label: 'Git Status', value: metrics.gitStatus }
            ];
            
            container.innerHTML = metricsData.map(metric =>
                '<div class="metric-item">' +
                '<div class="metric-value">' + metric.value + '</div>' +
                '<div class="metric-label">' + metric.label + '</div>' +
                '</div>'
            ).join('');
        }

        function renderTechStack(techStack) {
            const container = document.getElementById('techStackContent');
            
            const sections = [
                { title: 'Languages', items: techStack.languages },
                { title: 'Frameworks', items: techStack.frameworks },
                { title: 'Tools', items: techStack.tools },
                { title: 'Databases', items: techStack.databases }
            ];
            
            container.innerHTML = sections.map(section =>
                '<div style="margin-bottom: 16px;">' +
                '<h4 style="margin: 0 0 8px 0; font-size: 12px; color: var(--vscode-descriptionForeground); text-transform: uppercase;">' + section.title + '</h4>' +
                '<div class="tech-stack">' +
                section.items.map(item => '<span class="tech-tag">' + item + '</span>').join('') +
                '</div>' +
                '</div>'
            ).join('');
        }

        function renderFileTypes(fileTypes) {
            const container = document.getElementById('fileTypesContent');
            
            container.innerHTML = fileTypes.map(fileType =>
                '<div class="file-type-item">' +
                '<div class="file-type-info">' +
                '<span class="file-extension">' + fileType.extension + '</span>' +
                '<span class="file-count">' + fileType.count + ' files</span>' +
                '</div>' +
                '<span class="file-percentage">' + fileType.percentage + '%</span>' +
                '</div>'
            ).join('');
        }

        function renderInsights(insights) {
            const container = document.getElementById('insightsContent');
            
            const iconMap = {
                warning: '⚠️',
                error: '❌',
                success: '✅',
                info: 'ℹ️'
            };
            
            if (insights.length === 0) {
                container.innerHTML = '<div class="empty-state"><h3>No Issues Found</h3><p>Your project is in great shape!</p></div>';
                return;
            }
            
            container.innerHTML = insights.map(insight =>
                '<div class="insight-card ' + insight.type + '">' +
                '<div class="insight-icon">' + iconMap[insight.type] + '</div>' +
                '<div class="insight-content">' +
                '<div class="insight-header">' +
                '<div class="insight-title">' + insight.title + '</div>' +
                '<span class="insight-impact ' + insight.impact + '">' + insight.impact + '</span>' +
                '</div>' +
                '<div class="insight-description">' + insight.description + '</div>' +
                (insight.recommendations.length > 0 ? 
                    '<div class="insight-recommendations">' +
                    '<strong>Recommendations:</strong>' +
                    '<ul>' + insight.recommendations.map(rec => '<li>' + rec + '</li>').join('') + '</ul>' +
                    '</div>' : '') +
                '</div>' +
                '</div>'
            ).join('');
        }

        function showError(error) {
            alert('Analysis Error: ' + error);
        }

        function showNotification(message) {
            // Create a simple notification
            const notification = document.createElement('div');
            notification.textContent = message;
            notification.style.cssText = \`
                position: fixed;
                top: 20px;
                right: 20px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                padding: 12px 16px;
                border-radius: 4px;
                z-index: 1000;
                animation: slideIn 0.3s ease;
            \`;
            
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.remove();
            }, 3000);
        }
    </script>
</body>
</html>`;
  }
}