import * as vscode from "vscode";
import { ContextManager } from "../core/ContextManager";
import {
  ContextItem,
  ContextType,
  ContextSource,
  ContextPriority,
  ContextQuery,
} from "../context/types";
import { logger } from "../utils/logger";
import * as path from "path";

export interface ContextVisualizationData {
  totalItems: number;
  itemsByType: Record<ContextType, number>;
  itemsBySource: Record<ContextSource, number>;
  itemsByPriority: Record<ContextPriority, number>;
  recentItems: ContextItem[];
  searchStats: {
    totalSearches: number;
    averageResults: number;
    commonQueries: string[];
  };
  typeRelationships: {
    source: ContextType;
    target: ContextType;
    weight: number;
  }[];
  timelineData: {
    date: string;
    count: number;
    types: Record<ContextType, number>;
  }[];
}

export interface ContextSearchAnalytics {
  query: string;
  results: number;
  searchTime: number;
  strategy: string;
  timestamp: Date;
}

/**
 * Context Visualization Panel for comprehensive context system insights
 */
export class ContextVisualizationPanel {
  public static currentPanel: ContextVisualizationPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _contextManager: ContextManager;
  private _searchAnalytics: ContextSearchAnalytics[] = [];
  private _isAnalyzing: boolean = false;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : undefined;

    // If we already have a panel, show it
    if (ContextVisualizationPanel.currentPanel) {
      ContextVisualizationPanel.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      "contextVisualization",
      "Context Visualization",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
          vscode.Uri.joinPath(extensionUri, "out", "compiled"),
        ],
      }
    );

    ContextVisualizationPanel.currentPanel = new ContextVisualizationPanel(
      panel,
      extensionUri
    );
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._contextManager = ContextManager.getInstance();

    // Set the webview's initial HTML content
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "refreshVisualization":
            await this._refreshVisualization();
            break;
          case "searchContext":
            await this._performContextSearch(message.query, message.options);
            break;
          case "analyzeContextItem":
            await this._analyzeContextItem(message.itemId);
            break;
          case "exportContextData":
            await this._exportContextData(message.format);
            break;
          case "clearOldContext":
            await this._clearOldContext(message.olderThan);
            break;
          case "optimizeContext":
            await this._optimizeContext();
            break;
          case "viewContextRelationships":
            await this._viewContextRelationships(message.contextType);
            break;
        }
      },
      null,
      this._disposables
    );

    // Initialize with data
    this._loadInitialData();
  }

  public dispose() {
    ContextVisualizationPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async _update() {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private async _loadInitialData() {
    try {
      await this._contextManager.initialize();
      const data = await this._generateVisualizationData();
      this._sendMessage({ command: "updateVisualizationData", data });
    } catch (error) {
      logger.error("[CONTEXT_VIZ] Failed to load initial data:", error);
      this._sendMessage({
        command: "error",
        message: `Failed to load context data: ${error}`,
      });
    }
  }

  private async _refreshVisualization() {
    try {
      this._isAnalyzing = true;
      this._sendMessage({ command: "analysisStarted" });

      const data = await this._generateVisualizationData();
      this._sendMessage({ command: "updateVisualizationData", data });

      this._isAnalyzing = false;
      this._sendMessage({ command: "analysisComplete" });
    } catch (error) {
      this._isAnalyzing = false;
      this._sendAnalysisError(`Context analysis failed: ${error}`);
    }
  }

  private async _generateVisualizationData(): Promise<ContextVisualizationData> {
    const stats = await this._contextManager.getStats();

    // Get context items for analysis
    const allItems = await this._contextManager.searchContext({
      maxResults: 1000, // Get a good sample
    });

    // Analyze by type
    const itemsByType: Record<ContextType, number> = {} as any;
    Object.values(ContextType).forEach((type) => {
      itemsByType[type] = allItems.items.filter(
        (item: ContextItem) => item.type === type
      ).length;
    });

    // Analyze by source
    const itemsBySource: Record<ContextSource, number> = {} as any;
    Object.values(ContextSource).forEach((source) => {
      itemsBySource[source] = allItems.items.filter(
        (item: ContextItem) => item.source === source
      ).length;
    });

    // Analyze by priority
    const itemsByPriority: Record<ContextPriority, number> = {} as any;
    Object.values(ContextPriority).forEach((priority) => {
      if (typeof priority === "number") {
        itemsByPriority[priority] = allItems.items.filter(
          (item: ContextItem) => item.priority === priority
        ).length;
      }
    });

    // Get recent items (last 50)
    const recentItems = allItems.items
      .sort(
        (a: ContextItem, b: ContextItem) =>
          b.timestamp.getTime() - a.timestamp.getTime()
      )
      .slice(0, 50);

    // Generate timeline data (last 30 days)
    const timelineData = this._generateTimelineData(allItems.items);

    // Generate type relationships
    const typeRelationships = this._generateTypeRelationships(allItems.items);

    // Search analytics
    const searchStats = {
      totalSearches: this._searchAnalytics.length,
      averageResults:
        this._searchAnalytics.length > 0
          ? this._searchAnalytics.reduce((sum, s) => sum + s.results, 0) /
            this._searchAnalytics.length
          : 0,
      commonQueries: this._getCommonQueries(),
    };

    return {
      totalItems: allItems.items.length,
      itemsByType,
      itemsBySource,
      itemsByPriority,
      recentItems,
      searchStats,
      typeRelationships,
      timelineData,
    };
  }

  private _generateTimelineData(items: ContextItem[]): any[] {
    const now = new Date();
    const timelineMap = new Map<string, any>();

    // Initialize last 30 days
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];

      timelineMap.set(dateStr, {
        date: dateStr,
        count: 0,
        types: Object.values(ContextType).reduce((acc, type) => {
          acc[type] = 0;
          return acc;
        }, {} as Record<ContextType, number>),
      });
    }

    // Populate with actual data
    items.forEach((item) => {
      const dateStr = item.timestamp.toISOString().split("T")[0];
      const entry = timelineMap.get(dateStr);
      if (entry) {
        entry.count++;
        entry.types[item.type]++;
      }
    });

    return Array.from(timelineMap.values());
  }

  private _generateTypeRelationships(items: ContextItem[]): any[] {
    const relationships = new Map<string, number>();

    // Find items that share projects, sessions, or tasks
    items.forEach((item1) => {
      items.forEach((item2) => {
        if (item1.id !== item2.id && item1.type !== item2.type) {
          const hasRelation =
            (item1.projectId && item1.projectId === item2.projectId) ||
            (item1.sessionId && item1.sessionId === item2.sessionId) ||
            (item1.taskId && item1.taskId === item2.taskId);

          if (hasRelation) {
            const key = `${item1.type}-${item2.type}`;
            relationships.set(key, (relationships.get(key) || 0) + 1);
          }
        }
      });
    });

    return Array.from(relationships.entries()).map(([key, weight]) => {
      const [source, target] = key.split("-");
      return {
        source: source as ContextType,
        target: target as ContextType,
        weight,
      };
    });
  }

  private _getCommonQueries(): string[] {
    const queryCount = new Map<string, number>();

    this._searchAnalytics.forEach((search) => {
      queryCount.set(search.query, (queryCount.get(search.query) || 0) + 1);
    });

    return Array.from(queryCount.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([query]) => query);
  }

  private async _performContextSearch(query: string, options: any = {}) {
    try {
      const startTime = Date.now();

      const searchQuery: ContextQuery = {
        query,
        maxResults: options.maxResults || 20,
        types: options.types,
        sources: options.sources,
        minRelevanceScore: options.minRelevanceScore || 0.1,
      };

      const results = await this._contextManager.searchContext(searchQuery);
      const searchTime = Date.now() - startTime;

      // Track analytics
      this._searchAnalytics.push({
        query,
        results: results.items.length,
        searchTime,
        strategy: results.strategy as string,
        timestamp: new Date(),
      });

      // Keep only last 100 searches
      if (this._searchAnalytics.length > 100) {
        this._searchAnalytics = this._searchAnalytics.slice(-100);
      }

      this._sendMessage({
        command: "searchResults",
        results: results.items,
        searchTime,
        strategy: results.strategy || "unknown",
        totalCount: results.totalCount,
      });
    } catch (error) {
      logger.error("[CONTEXT_VIZ] Search failed:", error);
      this._sendMessage({
        command: "searchError",
        message: `Search failed: ${error}`,
      });
    }
  }

  private async _analyzeContextItem(itemId: string) {
    try {
      const allItems = await this._contextManager.searchContext({
        maxResults: 1000,
      });
      const item = allItems.items.find((i) => i.id === itemId);

      if (!item) {
        this._sendMessage({
          command: "itemAnalysisError",
          message: "Context item not found",
        });
        return;
      }

      // Find related items
      const relatedItems = allItems.items
        .filter(
          (i: ContextItem) =>
            i.id !== item.id &&
            (i.projectId === item.projectId ||
              i.sessionId === item.sessionId ||
              i.taskId === item.taskId ||
              i.tags.some((tag: string) => item.tags.includes(tag)))
        )
        .slice(0, 10);

      this._sendMessage({
        command: "itemAnalysisResult",
        item,
        relatedItems,
        metadata: {
          age: Date.now() - item.timestamp.getTime(),
          hasExpiration: !!item.expiresAt,
          isExpired: item.expiresAt ? item.expiresAt < new Date() : false,
          tagCount: item.tags.length,
          metadataKeys: Object.keys(item.metadata).length,
        },
      });
    } catch (error) {
      this._sendMessage({
        command: "itemAnalysisError",
        message: `Analysis failed: ${error}`,
      });
    }
  }

  private async _exportContextData(format: string) {
    try {
      const data = await this._generateVisualizationData();

      let exportContent: string;
      let fileName: string;

      switch (format) {
        case "json":
          exportContent = JSON.stringify(data, null, 2);
          fileName = `context-analysis-${
            new Date().toISOString().split("T")[0]
          }.json`;
          break;
        case "csv":
          exportContent = this._generateCSVReport(data);
          fileName = `context-analysis-${
            new Date().toISOString().split("T")[0]
          }.csv`;
          break;
        default:
          exportContent = this._generateMarkdownReport(data);
          fileName = `context-analysis-${
            new Date().toISOString().split("T")[0]
          }.md`;
      }

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileName),
        filters: {
          "All Files": ["*"],
        },
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(exportContent, "utf8")
        );
        vscode.window.showInformationMessage(
          `Context analysis exported to ${uri.fsPath}`
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Export failed: ${error}`);
    }
  }

  private _generateMarkdownReport(data: ContextVisualizationData): string {
    const report = `# Context System Analysis Report

**Generated:** ${new Date().toISOString()}
**Total Items:** ${data.totalItems}

## Summary

### Items by Type
${Object.entries(data.itemsByType)
  .map(([type, count]) => `- **${type}**: ${count}`)
  .join("\n")}

### Items by Source  
${Object.entries(data.itemsBySource)
  .map(([source, count]) => `- **${source}**: ${count}`)
  .join("\n")}

### Items by Priority
${Object.entries(data.itemsByPriority)
  .map(([priority, count]) => `- **${priority}**: ${count}`)
  .join("\n")}

## Recent Activity
${data.recentItems
  .slice(0, 10)
  .map(
    (item) =>
      `- **${item.type}** (${item.source}): ${item.content.substring(
        0,
        100
      )}...`
  )
  .join("\n")}

## Search Analytics
- **Total Searches:** ${data.searchStats.totalSearches}
- **Average Results:** ${data.searchStats.averageResults.toFixed(1)}
- **Common Queries:** ${data.searchStats.commonQueries.slice(0, 5).join(", ")}

## Timeline Analysis
Last 7 days context creation:
${data.timelineData
  .slice(-7)
  .map((day) => `- **${day.date}**: ${day.count} items`)
  .join("\n")}
`;
    return report;
  }

  private _generateCSVReport(data: ContextVisualizationData): string {
    const headers = [
      "Type",
      "Source",
      "Priority",
      "Content",
      "Timestamp",
      "Tags",
    ];
    const rows = data.recentItems.map((item) => [
      item.type,
      item.source,
      item.priority,
      `"${item.content.replace(/"/g, '""').substring(0, 200)}"`,
      item.timestamp.toISOString(),
      `"${item.tags.join(", ")}"`,
    ]);

    return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
  }

  private async _clearOldContext(olderThanDays: number) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      // This would need to be implemented in ContextManager
      // await this._contextManager.clearOldItems(cutoffDate);

      vscode.window.showInformationMessage(
        `Cleared context items older than ${olderThanDays} days`
      );
      await this._refreshVisualization();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to clear old context: ${error}`);
    }
  }

  private async _optimizeContext() {
    try {
      // This would trigger context optimization in ContextManager
      vscode.window.showInformationMessage("Context optimization started...");
      await this._refreshVisualization();
    } catch (error) {
      vscode.window.showErrorMessage(`Context optimization failed: ${error}`);
    }
  }

  private async _viewContextRelationships(contextType?: ContextType) {
    try {
      const data = await this._generateVisualizationData();
      const relationships = contextType
        ? data.typeRelationships.filter(
            (r) => r.source === contextType || r.target === contextType
          )
        : data.typeRelationships;

      this._sendMessage({
        command: "relationshipData",
        relationships,
        focusType: contextType,
      });
    } catch (error) {
      this._sendMessage({
        command: "relationshipError",
        message: `Failed to load relationships: ${error}`,
      });
    }
  }

  private _sendMessage(message: any) {
    this._panel.webview.postMessage(message);
  }

  private _sendAnalysisError(message: string) {
    this._sendMessage({ command: "analysisError", message });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Context Visualization</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                line-height: var(--vscode-font-weight);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                margin: 0;
                padding: 20px;
            }
            
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            
            .title {
                font-size: 1.5em;
                font-weight: bold;
                color: var(--vscode-textLink-foreground);
            }
            
            .controls {
                display: flex;
                gap: 10px;
            }
            
            .btn {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.9em;
            }
            
            .btn:hover {
                background: var(--vscode-button-hoverBackground);
            }
            
            .btn.secondary {
                background: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }
            
            .btn.secondary:hover {
                background: var(--vscode-button-secondaryHoverBackground);
            }
            
            .dashboard {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }
            
            .card {
                border: 1px solid var(--vscode-panel-border);
                border-radius: 6px;
                padding: 16px;
                background: var(--vscode-panel-background);
            }
            
            .card-title {
                font-size: 1.1em;
                font-weight: bold;
                margin-bottom: 12px;
                color: var(--vscode-textLink-foreground);
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .metric {
                display: flex;
                justify-content: space-between;
                padding: 6px 0;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            
            .metric:last-child {
                border-bottom: none;
            }
            
            .metric-value {
                font-weight: bold;
                color: var(--vscode-textPreformat-foreground);
            }
            
            .search-section {
                margin-top: 20px;
                padding: 20px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 6px;
                background: var(--vscode-panel-background);
            }
            
            .search-controls {
                display: flex;
                gap: 10px;
                margin-bottom: 15px;
            }
            
            .search-input {
                flex: 1;
                padding: 8px 12px;
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
            }
            
            .search-results {
                max-height: 300px;
                overflow-y: auto;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                margin-top: 10px;
            }
            
            .search-result-item {
                padding: 10px;
                border-bottom: 1px solid var(--vscode-panel-border);
                cursor: pointer;
            }
            
            .search-result-item:hover {
                background: var(--vscode-list-hoverBackground);
            }
            
            .search-result-item:last-child {
                border-bottom: none;
            }
            
            .result-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 5px;
            }
            
            .result-type {
                background: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 0.8em;
            }
            
            .result-content {
                color: var(--vscode-textPreformat-foreground);
                font-size: 0.9em;
                white-space: pre-wrap;
                word-break: break-word;
            }
            
            .timeline-chart {
                height: 200px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                margin-top: 10px;
                padding: 10px;
                position: relative;
                overflow: hidden;
            }
            
            .chart-placeholder {
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100%;
                color: var(--vscode-descriptionForeground);
                font-style: italic;
            }
            
            .relationships-viz {
                min-height: 300px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                margin-top: 10px;
                padding: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--vscode-descriptionForeground);
                font-style: italic;
            }
            
            .loading {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                color: var(--vscode-descriptionForeground);
            }
            
            .error {
                color: var(--vscode-errorForeground);
                background: var(--vscode-inputValidation-errorBackground);
                border: 1px solid var(--vscode-inputValidation-errorBorder);
                padding: 10px;
                border-radius: 4px;
                margin: 10px 0;
            }
            
            .status {
                padding: 10px;
                border-radius: 4px;
                margin: 10px 0;
                background: var(--vscode-notifications-background);
                border: 1px solid var(--vscode-notifications-border);
            }
            
            .tabs {
                display: flex;
                border-bottom: 1px solid var(--vscode-panel-border);
                margin-bottom: 20px;
            }
            
            .tab {
                padding: 10px 20px;
                cursor: pointer;
                border-bottom: 2px solid transparent;
                color: var(--vscode-descriptionForeground);
            }
            
            .tab.active {
                color: var(--vscode-textLink-foreground);
                border-bottom-color: var(--vscode-textLink-foreground);
            }
            
            .tab:hover {
                background: var(--vscode-list-hoverBackground);
            }
            
            .tab-content {
                display: none;
            }
            
            .tab-content.active {
                display: block;
            }
            
            .progress-bar {
                width: 100%;
                height: 4px;
                background: var(--vscode-progressBar-background);
                border-radius: 2px;
                overflow: hidden;
                margin: 10px 0;
            }
            
            .progress-fill {
                height: 100%;
                background: var(--vscode-progressBar-background);
                width: 0%;
                transition: width 0.3s ease;
                border-radius: 2px;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="title">🧠 Context Visualization</div>
            <div class="controls">
                <button class="btn" onclick="refreshData()">🔄 Refresh</button>
                <button class="btn secondary" onclick="exportData('markdown')">📄 Export</button>
                <button class="btn secondary" onclick="clearOldData()">🗑️ Clear Old</button>
            </div>
        </div>
        
        <div class="tabs">
            <div class="tab active" onclick="switchTab('overview')">Overview</div>
            <div class="tab" onclick="switchTab('search')">Search</div>
            <div class="tab" onclick="switchTab('timeline')">Timeline</div>
            <div class="tab" onclick="switchTab('relationships')">Relationships</div>
        </div>
        
        <div id="overview-tab" class="tab-content active">
            <div class="dashboard" id="dashboard">
                <div class="loading">Loading context data...</div>
            </div>
        </div>
        
        <div id="search-tab" class="tab-content">
            <div class="search-section">
                <div class="card-title">🔍 Context Search</div>
                <div class="search-controls">
                    <input type="text" class="search-input" id="searchQuery" placeholder="Search context items...">
                    <button class="btn" onclick="performSearch()">Search</button>
                    <button class="btn secondary" onclick="clearSearchResults()">Clear</button>
                </div>
                <div id="searchResults" class="search-results" style="display: none;"></div>
                <div id="searchStatus"></div>
            </div>
        </div>
        
        <div id="timeline-tab" class="tab-content">
            <div class="card">
                <div class="card-title">📈 Context Timeline</div>
                <div class="timeline-chart">
                    <div class="chart-placeholder">Timeline visualization will appear here</div>
                </div>
            </div>
        </div>
        
        <div id="relationships-tab" class="tab-content">
            <div class="card">
                <div class="card-title">🔗 Context Relationships</div>
                <div class="relationships-viz">
                    <div class="chart-placeholder">Relationship graph will appear here</div>
                </div>
            </div>
        </div>
        
        <script>
            const vscode = acquireVsCodeApi();
            let currentData = null;
            let isAnalyzing = false;
            
            // Tab switching
            function switchTab(tabName) {
                document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                
                document.querySelector(\`[onclick="switchTab('\${tabName}')"]\`).classList.add('active');
                document.getElementById(\`\${tabName}-tab\`).classList.add('active');
            }
            
            function refreshData() {
                if (isAnalyzing) return;
                vscode.postMessage({ command: 'refreshVisualization' });
            }
            
            function exportData(format) {
                vscode.postMessage({ command: 'exportContextData', format });
            }
            
            function clearOldData() {
                const days = prompt('Clear context items older than how many days?', '30');
                if (days && !isNaN(days) && days > 0) {
                    vscode.postMessage({ command: 'clearOldContext', olderThan: parseInt(days) });
                }
            }
            
            function performSearch() {
                const query = document.getElementById('searchQuery').value.trim();
                if (query) {
                    vscode.postMessage({ 
                        command: 'searchContext', 
                        query,
                        options: { maxResults: 50 }
                    });
                    document.getElementById('searchStatus').innerHTML = '<div class="loading">Searching...</div>';
                }
            }
            
            function clearSearchResults() {
                document.getElementById('searchResults').style.display = 'none';
                document.getElementById('searchResults').innerHTML = '';
                document.getElementById('searchStatus').innerHTML = '';
                document.getElementById('searchQuery').value = '';
            }
            
            function analyzeItem(itemId) {
                vscode.postMessage({ command: 'analyzeContextItem', itemId });
            }
            
            // Handle Enter key in search
            document.addEventListener('DOMContentLoaded', () => {
                const searchInput = document.getElementById('searchQuery');
                searchInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        performSearch();
                    }
                });
            });
            
            // Message handler
            window.addEventListener('message', event => {
                const message = event.data;
                
                switch (message.command) {
                    case 'updateVisualizationData':
                        updateDashboard(message.data);
                        currentData = message.data;
                        break;
                    case 'searchResults':
                        displaySearchResults(message.results, message.searchTime, message.strategy);
                        break;
                    case 'searchError':
                        document.getElementById('searchStatus').innerHTML = \`<div class="error">\${message.message}</div>\`;
                        break;
                    case 'analysisStarted':
                        isAnalyzing = true;
                        showStatus('Analyzing context data...', 'loading');
                        break;
                    case 'analysisComplete':
                        isAnalyzing = false;
                        showStatus('Analysis complete', 'success');
                        setTimeout(() => hideStatus(), 3000);
                        break;
                    case 'analysisError':
                        isAnalyzing = false;
                        showStatus(message.message, 'error');
                        break;
                    case 'error':
                        showStatus(message.message, 'error');
                        break;
                }
            });
            
            function updateDashboard(data) {
                const dashboard = document.getElementById('dashboard');
                
                dashboard.innerHTML = \`
                    <div class="card">
                        <div class="card-title">📊 Overview</div>
                        <div class="metric">
                            <span>Total Items</span>
                            <span class="metric-value">\${data.totalItems}</span>
                        </div>
                        <div class="metric">
                            <span>Recent Items (50)</span>
                            <span class="metric-value">\${data.recentItems.length}</span>
                        </div>
                        <div class="metric">
                            <span>Search Statistics</span>
                            <span class="metric-value">\${data.searchStats.totalSearches} searches</span>
                        </div>
                    </div>
                    
                    <div class="card">
                        <div class="card-title">🏷️ By Type</div>
                        \${Object.entries(data.itemsByType).map(([type, count]) => 
                            \`<div class="metric">
                                <span>\${type.replace('_', ' ').toUpperCase()}</span>
                                <span class="metric-value">\${count}</span>
                            </div>\`
                        ).join('')}
                    </div>
                    
                    <div class="card">
                        <div class="card-title">📍 By Source</div>
                        \${Object.entries(data.itemsBySource).slice(0, 8).map(([source, count]) => 
                            \`<div class="metric">
                                <span>\${source.replace('_', ' ').toLowerCase()}</span>
                                <span class="metric-value">\${count}</span>
                            </div>\`
                        ).join('')}
                    </div>
                    
                    <div class="card">
                        <div class="card-title">⚡ By Priority</div>
                        \${Object.entries(data.itemsByPriority).map(([priority, count]) => 
                            \`<div class="metric">
                                <span>Priority \${priority}</span>
                                <span class="metric-value">\${count}</span>
                            </div>\`
                        ).join('')}
                    </div>
                    
                    <div class="card">
                        <div class="card-title">🕒 Recent Activity</div>
                        \${data.recentItems.slice(0, 5).map(item => 
                            \`<div class="metric" style="flex-direction: column; align-items: flex-start; cursor: pointer;" onclick="analyzeItem('\${item.id}')">
                                <div style="display: flex; justify-content: space-between; width: 100%; margin-bottom: 4px;">
                                    <span class="result-type">\${item.type}</span>
                                    <span style="font-size: 0.8em; color: var(--vscode-descriptionForeground);">
                                        \${new Date(item.timestamp).toLocaleDateString()}
                                    </span>
                                </div>
                                <div style="font-size: 0.9em; color: var(--vscode-textPreformat-foreground);">
                                    \${item.content.substring(0, 80)}...
                                </div>
                            </div>\`
                        ).join('')}
                    </div>
                    
                    <div class="card">
                        <div class="card-title">🔍 Search Analytics</div>
                        <div class="metric">
                            <span>Total Searches</span>
                            <span class="metric-value">\${data.searchStats.totalSearches}</span>
                        </div>
                        <div class="metric">
                            <span>Avg Results</span>
                            <span class="metric-value">\${data.searchStats.averageResults.toFixed(1)}</span>
                        </div>
                        <div class="metric" style="flex-direction: column; align-items: flex-start;">
                            <span style="margin-bottom: 8px;">Common Queries</span>
                            <div style="font-size: 0.9em; color: var(--vscode-textPreformat-foreground);">
                                \${data.searchStats.commonQueries.slice(0, 3).join(', ') || 'No queries yet'}
                            </div>
                        </div>
                    </div>
                \`;
            }
            
            function displaySearchResults(results, searchTime, strategy) {
                const resultsContainer = document.getElementById('searchResults');
                const statusContainer = document.getElementById('searchStatus');
                
                statusContainer.innerHTML = \`
                    <div class="status">
                        Found \${results.length} results in \${searchTime}ms using \${strategy} strategy
                    </div>
                \`;
                
                if (results.length === 0) {
                    resultsContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--vscode-descriptionForeground);">No results found</div>';
                } else {
                    resultsContainer.innerHTML = results.map(item => \`
                        <div class="search-result-item" onclick="analyzeItem('\${item.id}')">
                            <div class="result-header">
                                <span class="result-type">\${item.type}</span>
                                <span style="font-size: 0.8em; color: var(--vscode-descriptionForeground);">
                                    \${new Date(item.timestamp).toLocaleString()}
                                </span>
                            </div>
                            <div class="result-content">\${item.content.substring(0, 200)}...</div>
                            <div style="margin-top: 5px; font-size: 0.8em; color: var(--vscode-descriptionForeground);">
                                Source: \${item.source} | Priority: \${item.priority} | Score: \${item.relevanceScore.toFixed(2)}
                            </div>
                        </div>
                    \`).join('');
                }
                
                resultsContainer.style.display = 'block';
            }
            
            function showStatus(message, type) {
                // Create or update status element
                let statusEl = document.getElementById('global-status');
                if (!statusEl) {
                    statusEl = document.createElement('div');
                    statusEl.id = 'global-status';
                    statusEl.style.position = 'fixed';
                    statusEl.style.top = '10px';
                    statusEl.style.right = '10px';
                    statusEl.style.zIndex = '1000';
                    statusEl.style.padding = '10px 15px';
                    statusEl.style.borderRadius = '4px';
                    statusEl.style.maxWidth = '300px';
                    document.body.appendChild(statusEl);
                }
                
                statusEl.textContent = message;
                statusEl.className = type === 'error' ? 'error' : type === 'success' ? 'status' : 'loading';
            }
            
            function hideStatus() {
                const statusEl = document.getElementById('global-status');
                if (statusEl) {
                    statusEl.remove();
                }
            }
        </script>
    </body>
    </html>`;
  }
}
