import * as vscode from "vscode";
import {
  VectorDatabase,
  DocumentChunk,
  SearchResult,
} from "../documentation/VectorDatabase";
import {
  DocumentationScraper,
  ScrapingConfig,
} from "../documentation/DocumentationScraper";
import { logger } from "../utils/logger";

export interface DocumentationSource {
  name: string;
  displayName: string;
  icon: string;
  url: string;
  description: string;
  category: string;
  lastUpdated?: Date;
  documentCount?: number;
  isEnabled: boolean;
}

/**
 * Documentation Integration Panel for searching and managing documentation
 */
export class DocumentationPanel {
  public static currentPanel: DocumentationPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _vectorDb: VectorDatabase;
  private _sources: DocumentationSource[] = [];
  private _searchHistory: Array<{
    query: string;
    timestamp: Date;
    resultCount: number;
  }> = [];
  private _isLoading: boolean = false;
  private _statsRefreshInterval: NodeJS.Timeout | undefined;
  private _lastStatsRefresh: Date | undefined;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    // If we already have a panel, show it and refresh stats
    if (DocumentationPanel.currentPanel) {
      DocumentationPanel.currentPanel._panel.reveal(column);
      // Auto-refresh stats when panel is revealed
      DocumentationPanel.currentPanel._refreshStatsOnShow();
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      "documentationPanel",
      "📚 Documentation Hub",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
          vscode.Uri.joinPath(extensionUri, "out"),
        ],
      }
    );

    DocumentationPanel.currentPanel = new DocumentationPanel(
      panel,
      extensionUri
    );
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._vectorDb = VectorDatabase.getInstance();

    // Initialize documentation sources
    this._initializeSources();

    // Set the webview's initial HTML content
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Listen for when the panel becomes visible
    this._panel.onDidChangeViewState(
      (event) => {
        if (event.webviewPanel.visible) {
          this._onPanelVisible();
        }
      },
      null,
      this._disposables
    );

    // Start periodic stats refresh
    this._startPeriodicStatsRefresh();

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "searchDocumentation":
            await this._handleSearchDocumentation(
              message.query,
              message.filters
            );
            break;
          case "updateDocumentation":
            await this._handleUpdateDocumentation(
              message.sources,
              message.forceRefresh
            );
            break;
          case "toggleSource":
            await this._handleToggleSource(message.sourceName, message.enabled);
            break;
          case "clearSearchHistory":
            this._clearSearchHistory();
            break;
          case "exportResults":
            await this._handleExportResults(message.results);
            break;
          case "getSourceStats":
            await this._handleGetSourceStats();
            break;
          case "customScrape":
            await this._handleCustomScrape(message.url, message.config);
            break;
          case "debugCollection":
            await this._handleDebugCollection();
            break;
          case "forceReinitializeDB":
            await this._handleForceReinitializeDB();
            break;
          case "testCloudAccess":
            await this._handleTestCloudAccess();
            break;
          case "toggleCategory":
            await this._handleToggleCategory(message.category, message.enabled);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private async _initializeSources(): Promise<void> {
    // Initialize with categorized documentation sources
    this._sources = [
      // Frontend Development
      {
        name: "MDN",
        displayName: "MDN Web Docs",
        icon: "🌐",
        url: "https://developer.mozilla.org",
        description: "Web standards and browser APIs",
        category: "Frontend",
        isEnabled: true,
      },
      {
        name: "React",
        displayName: "React",
        icon: "⚛️",
        url: "https://react.dev",
        description: "React library documentation",
        category: "Frontend",
        isEnabled: true,
      },
      {
        name: "TailwindCSS",
        displayName: "TailwindCSS",
        icon: "🎨",
        url: "https://tailwindcss.com/docs",
        description: "TailwindCSS utility-first CSS framework",
        category: "Frontend",
        isEnabled: true,
      },
      {
        name: "Vite",
        displayName: "Vite",
        icon: "⚡",
        url: "https://vitejs.dev",
        description: "Vite fast build tool and dev server",
        category: "Frontend",
        isEnabled: true,
      },

      // Backend & Languages
      {
        name: "Node.js",
        displayName: "Node.js",
        icon: "🟢",
        url: "https://nodejs.org/docs",
        description: "Node.js runtime documentation",
        category: "Backend",
        isEnabled: true,
      },
      {
        name: "TypeScript",
        displayName: "TypeScript",
        icon: "🔷",
        url: "https://www.typescriptlang.org/docs",
        description: "TypeScript language documentation",
        category: "Backend",
        isEnabled: true,
      },
      {
        name: "Python",
        displayName: "Python",
        icon: "🐍",
        url: "https://docs.python.org/3/",
        description: "Python standard library documentation",
        category: "Backend",
        isEnabled: true,
      },
      {
        name: "Express.js",
        displayName: "Express.js",
        icon: "🚀",
        url: "https://expressjs.com",
        description: "Express.js web framework",
        category: "Backend",
        isEnabled: true,
      },
      {
        name: "FastAPI",
        displayName: "FastAPI",
        icon: "⚡",
        url: "https://fastapi.tiangolo.com",
        description: "FastAPI modern Python web framework",
        category: "Backend",
        isEnabled: true,
      },

      // DevOps & Tools
      {
        name: "VS Code API",
        displayName: "VS Code API",
        icon: "🆚",
        url: "https://code.visualstudio.com/api",
        description: "VS Code extension API",
        category: "DevOps",
        isEnabled: true,
      },
      {
        name: "GitHub API",
        displayName: "GitHub API",
        icon: "🐙",
        url: "https://docs.github.com",
        description: "GitHub REST API documentation",
        category: "DevOps",
        isEnabled: true,
      },
      {
        name: "Docker",
        displayName: "Docker",
        icon: "🐳",
        url: "https://docs.docker.com",
        description: "Docker containerization docs",
        category: "DevOps",
        isEnabled: true,
      },

      // AI/ML Core
      {
        name: "PyTorch",
        displayName: "PyTorch",
        icon: "🔥",
        url: "https://pytorch.org/docs",
        description: "PyTorch machine learning framework",
        category: "AI/ML Core",
        isEnabled: true,
      },
      {
        name: "Transformers",
        displayName: "Transformers",
        icon: "🤗",
        url: "https://huggingface.co/docs/transformers",
        description: "Hugging Face Transformers library",
        category: "AI/ML Core",
        isEnabled: true,
      },
      {
        name: "Hugging Face Hub",
        displayName: "Hugging Face Hub",
        icon: "🤗",
        url: "https://huggingface.co/docs/huggingface_hub",
        description: "Hugging Face Hub Python library",
        category: "AI/ML Core",
        isEnabled: true,
      },

      // AI/ML Tools & Optimization
      {
        name: "PEFT",
        displayName: "PEFT",
        icon: "🔧",
        url: "https://huggingface.co/docs/peft",
        description: "Parameter-Efficient Fine-Tuning methods",
        category: "AI/ML Tools",
        isEnabled: true,
      },
      {
        name: "Accelerate",
        displayName: "Accelerate",
        icon: "🚀",
        url: "https://huggingface.co/docs/accelerate",
        description: "Multi-GPU & distributed training library",
        category: "AI/ML Tools",
        isEnabled: true,
      },
      {
        name: "BitsAndBytes",
        displayName: "BitsAndBytes",
        icon: "🔢",
        url: "https://github.com/TimDettmers/bitsandbytes",
        description: "8-bit & 16-bit optimizers and quantization",
        category: "AI/ML Tools",
        isEnabled: true,
      },
      {
        name: "Tokenizers",
        displayName: "Tokenizers",
        icon: "🔤",
        url: "https://huggingface.co/docs/tokenizers",
        description: "Fast tokenizers for NLP models",
        category: "AI/ML Tools",
        isEnabled: true,
      },
      {
        name: "SentencePiece",
        displayName: "SentencePiece",
        icon: "📝",
        url: "https://github.com/google/sentencepiece",
        description: "Unsupervised text tokenizer",
        category: "AI/ML Tools",
        isEnabled: true,
      },

      // AI/ML Applications
      {
        name: "LangChain",
        displayName: "LangChain",
        icon: "🔗",
        url: "https://python.langchain.com/docs/introduction/",
        description: "LangChain framework for LLM applications",
        category: "AI/ML Apps",
        isEnabled: true,
      },
      {
        name: "LangChain Core",
        displayName: "LangChain Core",
        icon: "🔗",
        url: "https://python.langchain.com/docs/langchain_core/",
        description: "LangChain core abstractions and interfaces",
        category: "AI/ML Apps",
        isEnabled: true,
      },
      {
        name: "LangChain Community",
        displayName: "LangChain Community",
        icon: "🔗",
        url: "https://python.langchain.com/docs/langchain_community/",
        description: "Community-contributed LangChain integrations",
        category: "AI/ML Apps",
        isEnabled: true,
      },
      {
        name: "ChromaDB",
        displayName: "ChromaDB",
        icon: "🎨",
        url: "https://docs.trychroma.com",
        description: "Open-source embedding database",
        category: "AI/ML Apps",
        isEnabled: true,
      },
      {
        name: "Ollama",
        displayName: "Ollama",
        icon: "🦙",
        url: "https://github.com/ollama/ollama",
        description: "Ollama local LLM runner API documentation",
        category: "AI/ML Apps",
        isEnabled: true,
      },
      {
        name: "Unsloth",
        displayName: "Unsloth",
        icon: "🚀",
        url: "https://docs.unsloth.ai/",
        description: "Unsloth fast LLM fine-tuning framework",
        category: "AI/ML Tools",
        isEnabled: true,
      },
      {
        name: "LMDeploy",
        displayName: "LMDeploy",
        icon: "🚀",
        url: "https://lmdeploy.readthedocs.io/en/latest/",
        description: "LMDeploy - Superior LLM serving engine with 1.8x better performance than vLLM",
        category: "AI/ML Tools",
        isEnabled: true,
      },
    ];

    // Load source statistics
    await this._loadSourceStats();
  }

  private async _loadSourceStats(): Promise<void> {
    try {
      await this._vectorDb.initialize();

      for (const source of this._sources) {
        try {
          const stats = await this._vectorDb.getSourceStats(source.name);
          source.documentCount = stats.documentCount;
          source.lastUpdated = stats.lastUpdated;
          logger.debug(
            `[DOC_PANEL] Source ${source.name}: ${stats.documentCount} documents`
          );
        } catch (error) {
          // Source not indexed yet
          source.documentCount = 0;
          logger.debug(`[DOC_PANEL] Source ${source.name}: no documents found`);
        }
      }

      // Send updated source stats to frontend
      this._sendSourceStats();
    } catch (error) {
      logger.error("[DOC_PANEL] Failed to load source stats:", error);
    }
  }

  private async _handleSearchDocumentation(
    query: string,
    filters: any
  ): Promise<void> {
    if (!query.trim()) {
      return;
    }

    this._isLoading = true;
    this._updateLoadingState();

    try {
      await this._vectorDb.initialize();

      const searchOptions = {
        limit: filters.limit || 10,
        threshold: filters.threshold || 0.05,
        filter: this._buildSearchFilter(filters),
        includeMetadata: true,
      };

      const results = await this._vectorDb.search(query, searchOptions);

      // Add to search history
      this._searchHistory.unshift({
        query,
        timestamp: new Date(),
        resultCount: results.length,
      });

      // Keep only last 20 searches
      if (this._searchHistory.length > 20) {
        this._searchHistory = this._searchHistory.slice(0, 20);
      }

      this._sendSearchResults(query, results, filters);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[DOC_PANEL] Search failed:", error);
      this._sendError(`Search failed: ${errorMessage}`);
    } finally {
      this._isLoading = false;
      this._updateLoadingState();
    }
  }

  private async _handleUpdateDocumentation(
    sources: string[],
    forceRefresh: boolean
  ): Promise<void> {
    this._isLoading = true;
    this._updateLoadingState();

    try {
      const scraper = new DocumentationScraper();
      const allConfigs = DocumentationScraper.getCommonConfigs();

      let configs: ScrapingConfig[] = [];
      if (sources.length > 0) {
        configs = allConfigs.filter((config) =>
          sources.some((source) =>
            config.metadata.source.toLowerCase().includes(source.toLowerCase())
          )
        );
      } else {
        // Update only enabled sources
        const enabledSources = this._sources
          .filter((s) => s.isEnabled)
          .map((s) => s.name);
        configs = allConfigs.filter((config) =>
          enabledSources.some((source) =>
            config.metadata.source.toLowerCase().includes(source.toLowerCase())
          )
        );
      }

      let totalProcessed = 0;
      let totalErrors = 0;

      for (const config of configs) {
        try {
          this._sendUpdateProgress(`Updating ${config.metadata.source}...`);

          const result = await scraper.scrapeDocumentation(config);

          if (result.chunks.length > 0) {
            await this._vectorDb.addDocuments(result.chunks);
            totalProcessed += result.chunks.length;
          }

          totalErrors += result.errors.length;
        } catch (error) {
          logger.error(
            `[DOC_PANEL] Failed to update ${config.metadata.source}:`,
            error
          );
          totalErrors++;
        }
      }

      // Refresh source stats
      await this._loadSourceStats();

      this._sendUpdateComplete(totalProcessed, totalErrors);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[DOC_PANEL] Update failed:", error);
      this._sendError(`Documentation update failed: ${errorMessage}`);
    } finally {
      this._isLoading = false;
      this._updateLoadingState();
    }
  }

  private async _handleToggleSource(
    sourceName: string,
    enabled: boolean
  ): Promise<void> {
    const source = this._sources.find((s) => s.name === sourceName);
    if (source) {
      source.isEnabled = enabled;
      this._sendSourceToggled(sourceName, enabled);
    }
  }

  private async _handleToggleCategory(
    category: string,
    enabled: boolean
  ): Promise<void> {
    // Find all sources in the category and toggle them
    const categorySources = this._sources.filter((s) => s.category === category);
    
    for (const source of categorySources) {
      source.isEnabled = enabled;
    }

    // Send update to webview
    this._sendCategoryToggled(category, enabled, categorySources.length);
    
    logger.info(`[DOC_PANEL] Toggled category ${category}: ${enabled ? 'enabled' : 'disabled'} ${categorySources.length} sources`);
  }

  private async _handleDebugCollection(): Promise<void> {
    try {
      await this._vectorDb.debugCollection();
    } catch (error) {
      logger.error("[DOC_PANEL] Failed to debug collection:", error);
    }
  }

  private async _handleForceReinitializeDB(): Promise<void> {
    try {
      logger.info("[DOC_PANEL] Force reinitializing VectorDatabase...");
      await this._vectorDb.forceReinitialize();
      await this._loadSourceStats();
      this._sendSourceStats();
      this._sendUpdateComplete(0, 0); // Signal UI that operation is complete
    } catch (error) {
      logger.error("[DOC_PANEL] Failed to force reinitialize database:", error);
      this._sendError("Failed to reinitialize database connection");
    }
  }

  private async _handleTestCloudAccess(): Promise<void> {
    try {
      logger.info("[DOC_PANEL] Testing cloud ChromaDB access...");
      await this._vectorDb.testCloudAccess();
      await this._loadSourceStats(); // Refresh stats after test
      this._sendSourceStats();
      this._sendUpdateComplete(0, 0); // Signal UI that operation is complete
    } catch (error) {
      logger.error("[DOC_PANEL] Failed to test cloud access:", error);
      this._sendError("Failed to test cloud access");
    }
  }

  private async _handleCustomScrape(url: string, config: any): Promise<void> {
    this._isLoading = true;
    this._updateLoadingState();

    try {
      const scraper = new DocumentationScraper();
      const scrapingConfig: ScrapingConfig = {
        url,
        selectors: config.selectors || {
          content: "main, .content, .documentation, body",
          title: "h1, title",
          exclude: ["nav", "footer", ".sidebar", ".header"],
        },
        metadata: {
          source: config.source || "Custom",
          ...config.metadata,
        },
        options: {
          followLinks: config.followLinks || false,
          maxDepth: config.maxDepth || 1,
          delay: config.delay || 1000,
        },
      };

      this._sendUpdateProgress(`Scraping ${url}...`);

      const result = await scraper.scrapeDocumentation(scrapingConfig);

      if (result.chunks.length > 0) {
        await this._vectorDb.addDocuments(result.chunks);
      }

      this._sendCustomScrapeComplete(
        result.chunks.length,
        result.errors.length
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[DOC_PANEL] Custom scrape failed:", error);
      this._sendError(`Custom scrape failed: ${errorMessage}`);
    } finally {
      this._isLoading = false;
      this._updateLoadingState();
    }
  }

  private async _handleGetSourceStats(): Promise<void> {
    await this._loadSourceStats();
    this._sendSourceStats();
  }

  private async _handleExportResults(results: SearchResult[]): Promise<void> {
    try {
      const exportData = {
        timestamp: new Date().toISOString(),
        resultCount: results.length,
        results: results.map((result) => ({
          title: result.document.metadata.title,
          source: result.document.metadata.source,
          url: result.document.metadata.url,
          score: result.score,
          content: result.document.content.substring(0, 500) + "...",
        })),
      };

      const exportJson = JSON.stringify(exportData, null, 2);

      // Save to file
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`documentation-search-${Date.now()}.json`),
        filters: {
          "JSON Files": ["json"],
          "All Files": ["*"],
        },
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(exportJson, "utf8")
        );
        vscode.window.showInformationMessage(
          `Search results exported to ${uri.fsPath}`
        );
      }
    } catch (error) {
      logger.error("[DOC_PANEL] Export failed:", error);
      vscode.window.showErrorMessage("Failed to export search results");
    }
  }

  private _buildSearchFilter(filters: any): Record<string, any> | undefined {
    const filter: Record<string, any> = {};

    if (filters.source) filter.source = filters.source;
    if (filters.language) filter.language = filters.language;
    if (filters.framework) filter.framework = filters.framework;
    if (filters.version) filter.version = filters.version;
    if (filters.category) filter.category = filters.category;

    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  private _clearSearchHistory(): void {
    this._searchHistory = [];
    this._sendSearchHistoryCleared();
  }

  // WebView communication methods
  private _sendSearchResults(
    query: string,
    results: SearchResult[],
    filters: any
  ): void {
    this._panel.webview.postMessage({
      command: "searchResults",
      query,
      results,
      filters,
      timestamp: new Date().toISOString(),
    });
  }

  private _sendError(message: string): void {
    this._panel.webview.postMessage({
      command: "error",
      message,
    });
  }

  private _sendUpdateProgress(message: string): void {
    this._panel.webview.postMessage({
      command: "updateProgress",
      message,
    });
  }

  private _sendUpdateComplete(processed: number, errors: number): void {
    this._panel.webview.postMessage({
      command: "updateComplete",
      processed,
      errors,
    });
  }

  private _sendCustomScrapeComplete(processed: number, errors: number): void {
    this._panel.webview.postMessage({
      command: "customScrapeComplete",
      processed,
      errors,
    });
  }

  private _sendSourceToggled(sourceName: string, enabled: boolean): void {
    this._panel.webview.postMessage({
      command: "sourceToggled",
      sourceName,
      enabled,
    });
  }

  private _sendSourceStats(): void {
    this._panel.webview.postMessage({
      command: "sourceStats",
      sources: this._sources,
    });
  }

  private _sendSearchHistoryCleared(): void {
    this._panel.webview.postMessage({
      command: "searchHistoryCleared",
    });
  }

  private _sendCategoryToggled(category: string, enabled: boolean, affectedCount: number): void {
    this._panel.webview.postMessage({
      command: "categoryToggled",
      category,
      enabled,
      affectedCount,
      sources: this._sources, // Send updated sources
    });
  }

  private _updateLoadingState(): void {
    this._panel.webview.postMessage({
      command: "loadingState",
      isLoading: this._isLoading,
    });
  }

  private async _refreshStatsOnShow(): Promise<void> {
    // Only refresh if it's been more than 30 seconds since last refresh
    const now = new Date();
    if (
      this._lastStatsRefresh &&
      now.getTime() - this._lastStatsRefresh.getTime() < 30000
    ) {
      return;
    }

    logger.debug("[DOC_PANEL] Auto-refreshing stats on panel show");
    await this._loadSourceStats();
    this._sendSourceStats();
    this._lastStatsRefresh = now;
  }

  private _onPanelVisible(): void {
    // Auto-refresh stats when panel becomes visible
    this._refreshStatsOnShow().catch((error) => {
      logger.error(
        "[DOC_PANEL] Failed to refresh stats on panel visible:",
        error
      );
    });
  }

  private _startPeriodicStatsRefresh(): void {
    // Refresh stats every 5 minutes when panel is visible
    this._statsRefreshInterval = setInterval(async () => {
      if (this._panel.visible) {
        try {
          logger.debug("[DOC_PANEL] Periodic stats refresh");
          await this._loadSourceStats();
          this._sendSourceStats();
          this._lastStatsRefresh = new Date();
        } catch (error) {
          logger.error("[DOC_PANEL] Periodic stats refresh failed:", error);
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  private _stopPeriodicStatsRefresh(): void {
    if (this._statsRefreshInterval) {
      clearInterval(this._statsRefreshInterval);
      this._statsRefreshInterval = undefined;
    }
  }

  public dispose() {
    DocumentationPanel.currentPanel = undefined;

    // Stop periodic stats refresh
    this._stopPeriodicStatsRefresh();

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
    const sourcesJson = JSON.stringify(this._sources);
    const searchHistoryJson = JSON.stringify(this._searchHistory);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Documentation Hub</title>
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
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
        }

        .header-actions {
            margin-left: auto;
            display: flex;
            gap: 8px;
        }

        .btn {
            padding: 6px 12px;
            border: 1px solid var(--vscode-button-border);
            border-radius: 4px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
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

        .search-section {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 24px;
        }

        .search-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
        }

        .search-header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        }

        .search-form {
            display: grid;
            gap: 16px;
        }

        .search-input-row {
            display: flex;
            gap: 12px;
            align-items: flex-end;
        }

        .search-input {
            flex: 1;
        }

        .search-input input {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 14px;
        }

        .search-input input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .search-filters {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
        }

        .filter-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .filter-group label {
            font-size: 12px;
            font-weight: 500;
            color: var(--vscode-foreground);
        }

        .filter-group select,
        .filter-group input {
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 12px;
        }

        .sources-section {
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 24px;
        }

        .sources-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
            flex-wrap: wrap;
            gap: 8px;
        }

        .sources-header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        }

        .sources-actions {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .auto-refresh-indicator {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.8;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .refresh-status {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            background-color: var(--vscode-button-secondaryBackground);
        }

        .category-section {
            margin-bottom: 24px;
        }

        .category-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            padding: 8px 12px;
            background-color: var(--vscode-button-secondaryBackground);
            border-radius: 6px;
        }

        .category-toggle {
            margin-left: 8px;
        }

        .category-header h3 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
        }

        .category-count {
            margin-left: auto;
            font-size: 11px;
            opacity: 0.8;
        }

        .sources-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 10px;
        }

        .source-card {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 16px;
            transition: all 0.2s;
        }

        .source-card:hover {
            border-color: var(--vscode-focusBorder);
        }

        .source-card.disabled {
            opacity: 0.6;
        }

        .source-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }

        .source-icon {
            font-size: 18px;
        }

        .source-name {
            font-weight: 600;
            font-size: 14px;
        }

        .source-toggle {
            margin-left: auto;
        }

        .source-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
        }

        .source-stats {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .results-section {
            margin-top: 24px;
        }

        .results-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }

        .results-header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        }

        .result-card {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 12px;
            transition: all 0.2s;
        }

        .result-card:hover {
            border-color: var(--vscode-focusBorder);
        }

        .result-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: 8px;
        }

        .result-title {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 4px;
        }

        .result-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .result-score {
            background-color: var(--vscode-button-secondaryBackground);
            padding: 2px 6px;
            border-radius: 10px;
            font-weight: 500;
        }

        .result-content {
            font-size: 13px;
            line-height: 1.5;
            margin-top: 8px;
            white-space: pre-wrap;
        }

        .result-url {
            margin-top: 8px;
            font-size: 11px;
        }

        .result-url a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }

        .result-url a:hover {
            text-decoration: underline;
        }

        .loading {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 16px;
            background-color: var(--vscode-list-hoverBackground);
            border-radius: 4px;
            margin: 16px 0;
        }

        .loading-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--vscode-progressBar-background);
            border-top: 2px solid var(--vscode-progressBar-foreground);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .history-section {
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 24px;
        }

        .history-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }

        .history-header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        }

        .history-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background-color: var(--vscode-input-background);
            border-radius: 4px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .history-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .history-query {
            font-weight: 500;
        }

        .history-meta {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state h3 {
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }

        .custom-scrape {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 16px;
            margin-top: 16px;
        }

        .custom-scrape h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            font-weight: 600;
        }

        .custom-scrape-form {
            display: grid;
            gap: 12px;
        }

        .custom-url-input {
            display: flex;
            gap: 8px;
        }

        .custom-url-input input {
            flex: 1;
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 12px;
        }

        .toggle-switch {
            position: relative;
            display: inline-block;
            width: 40px;
            height: 20px;
        }

        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: var(--vscode-input-border);
            transition: .4s;
            border-radius: 20px;
        }

        .toggle-slider:before {
            position: absolute;
            content: "";
            height: 16px;
            width: 16px;
            left: 2px;
            bottom: 2px;
            background-color: var(--vscode-input-background);
            transition: .4s;
            border-radius: 50%;
        }

        input:checked + .toggle-slider {
            background-color: var(--vscode-button-background);
        }

        input:checked + .toggle-slider:before {
            transform: translateX(20px);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📚 Documentation Hub</h1>
            <div class="header-actions">
                <button class="btn btn-secondary" onclick="refreshStats()">Refresh Stats</button>
                <button class="btn btn-secondary" onclick="debugCollection()">Debug Collection</button>
                <button class="btn btn-secondary" onclick="forceReinitializeDB()">Reinit DB</button>
                <button class="btn btn-secondary" onclick="testCloudAccess()">Test Cloud</button>
                <button class="btn" onclick="updateAllSources()">Update All</button>
            </div>
        </div>

        <div class="search-section">
            <div class="search-header">
                <h2>🔍 Search Documentation</h2>
            </div>
            <div class="search-form">
                <div class="search-input-row">
                    <div class="search-input">
                        <input type="text" id="searchQuery" placeholder="Search documentation..." onkeypress="handleSearchKeyPress(event)">
                    </div>
                    <button class="btn" onclick="searchDocumentation()">Search</button>
                </div>
                <div class="search-filters">
                    <div class="filter-group">
                        <label>Source</label>
                        <select id="sourceFilter">
                            <option value="">All Sources</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>Language</label>
                        <select id="languageFilter">
                            <option value="">All Languages</option>
                            <option value="javascript">JavaScript</option>
                            <option value="typescript">TypeScript</option>
                            <option value="python">Python</option>
                            <option value="html">HTML</option>
                            <option value="css">CSS</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>Results</label>
                        <select id="limitFilter">
                            <option value="5">5 results</option>
                            <option value="10" selected>10 results</option>
                            <option value="20">20 results</option>
                            <option value="50">50 results</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>Relevance</label>
                        <select id="thresholdFilter">
                            <option value="0.05" selected>Very Low (5%)</option>
                            <option value="0.1">Low (10%)</option>
                            <option value="0.3">Medium (30%)</option>
                            <option value="0.5">High (50%)</option>
                            <option value="0.7">Very High (70%)</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>

        <div class="sources-section">
            <div class="sources-header">
                <h2>📋 Documentation Sources</h2>
                <div class="sources-actions">
                    <div class="auto-refresh-indicator" id="refreshIndicator">
                        <span>🔄</span>
                        <span class="refresh-status" id="refreshStatus">Auto-refresh active</span>
                    </div>
                    <button class="btn btn-secondary" onclick="toggleCustomScrape()">Add Custom URL</button>
                </div>
            </div>
            <div id="sourcesContainer">
                <!-- Categorized sources will be populated by JavaScript -->
            </div>
            <div class="custom-scrape" id="customScrape" style="display: none;">
                <h3>Add Custom Documentation</h3>
                <div class="custom-scrape-form">
                    <div class="custom-url-input">
                        <input type="text" id="customUrl" placeholder="https://docs.example.com">
                        <button class="btn" onclick="scrapeCustomUrl()">Scrape</button>
                    </div>
                </div>
            </div>
        </div>

        <div class="history-section" id="historySection" style="display: none;">
            <div class="history-header">
                <h2>🕒 Search History</h2>
                <button class="btn btn-secondary" onclick="clearHistory()">Clear History</button>
            </div>
            <div id="historyList">
                <!-- History items will be populated by JavaScript -->
            </div>
        </div>

        <div id="loadingIndicator" class="loading" style="display: none;">
            <div class="loading-spinner"></div>
            <span id="loadingMessage">Loading...</span>
        </div>

        <div class="results-section" id="resultsSection" style="display: none;">
            <div class="results-header">
                <h2 id="resultsTitle">Search Results</h2>
                <div>
                    <button class="btn btn-secondary" onclick="exportResults()">Export</button>
                </div>
            </div>
            <div id="resultsList">
                <!-- Results will be populated by JavaScript -->
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let sources = ${sourcesJson};
        let searchHistory = ${searchHistoryJson};
        let currentResults = [];

        // Initialize the UI
        document.addEventListener('DOMContentLoaded', function() {
            renderSources();
            renderSearchHistory();
            populateSourceFilter();
            startAutoRefreshTimer();
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'searchResults':
                    handleSearchResults(message);
                    break;
                case 'error':
                    showError(message.message);
                    break;
                case 'loadingState':
                    updateLoadingState(message.isLoading);
                    break;
                case 'updateProgress':
                    showProgress(message.message);
                    break;
                case 'updateComplete':
                    showUpdateComplete(message.processed, message.errors);
                    break;
                case 'sourceStats':
                    sources = message.sources;
                    renderSources();
                    populateSourceFilter();
                    onStatsUpdated();
                    break;
                case 'sourceToggled':
                    updateSourceToggle(message.sourceName, message.enabled);
                    break;
                case 'searchHistoryCleared':
                    searchHistory = [];
                    renderSearchHistory();
                    break;
                case 'categoryToggled':
                    sources = message.sources;
                    renderSources();
                    populateSourceFilter();
                    showCategoryToggleSuccess(message.category, message.enabled, message.affectedCount);
                    break;
            }
        });

        function renderSources() {
            const container = document.getElementById('sourcesContainer');
            
            // Group sources by category
            const categories = {};
            sources.forEach(source => {
                if (!categories[source.category]) {
                    categories[source.category] = [];
                }
                categories[source.category].push(source);
            });

            // Define category order and icons
            const categoryOrder = ['Frontend', 'Backend', 'DevOps', 'AI/ML Core', 'AI/ML Tools', 'AI/ML Apps'];
            const categoryIcons = {
                'Frontend': '🎨',
                'Backend': '🔧',
                'DevOps': '🚀',
                'AI/ML Core': '🧠',
                'AI/ML Tools': '⚙️',
                'AI/ML Apps': '🤖'
            };

            container.innerHTML = categoryOrder.map(categoryName => {
                const categorySources = categories[categoryName] || [];
                if (categorySources.length === 0) return '';

                const enabledCount = categorySources.filter(s => s.isEnabled).length;
                const totalDocs = categorySources.reduce((sum, s) => sum + (s.documentCount || 0), 0);
                const allEnabled = enabledCount === categorySources.length;

                return '<div class="category-section">' +
                    '<div class="category-header">' +
                    '<span>' + (categoryIcons[categoryName] || '📁') + '</span>' +
                    '<h3>' + categoryName + '</h3>' +
                    '<label class="toggle-switch category-toggle" title="Toggle all sources in ' + categoryName + '">' +
                    '<input type="checkbox" ' + (allEnabled ? 'checked' : '') + ' onchange="toggleCategory(\\'' + categoryName + '\\', this.checked)">' +
                    '<span class="toggle-slider"></span>' +
                    '</label>' +
                    '<span class="category-count">' + enabledCount + '/' + categorySources.length + ' active • ' + totalDocs + ' docs</span>' +
                    '</div>' +
                    '<div class="sources-grid">' +
                    categorySources.map(source => 
                        '<div class="source-card' + (source.isEnabled ? '' : ' disabled') + '">' +
                        '<div class="source-header">' +
                        '<span class="source-icon">' + source.icon + '</span>' +
                        '<span class="source-name">' + source.displayName + '</span>' +
                        '<label class="toggle-switch source-toggle">' +
                        '<input type="checkbox" ' + (source.isEnabled ? 'checked' : '') + ' onchange="toggleSource(\\'' + source.name + '\\', this.checked)">' +
                        '<span class="toggle-slider"></span>' +
                        '</label>' +
                        '</div>' +
                        '<div class="source-description">' + source.description + '</div>' +
                        '<div class="source-stats">' +
                        '<span>' + (source.documentCount || 0) + ' documents</span>' +
                        '<span>' + (source.lastUpdated ? formatDate(new Date(source.lastUpdated)) : 'Never updated') + '</span>' +
                        '</div>' +
                        '</div>'
                    ).join('') +
                    '</div>' +
                    '</div>';
            }).join('');
        }

        function renderSearchHistory() {
            const historySection = document.getElementById('historySection');
            const historyList = document.getElementById('historyList');
            
            if (searchHistory.length === 0) {
                historySection.style.display = 'none';
                return;
            }
            
            historySection.style.display = 'block';
            historyList.innerHTML = searchHistory.map(item =>
                '<div class="history-item" onclick="searchFromHistory(\\'' + escapeHtml(item.query) + '\\'))">' +
                '<div class="history-query">' + escapeHtml(item.query) + '</div>' +
                '<div class="history-meta">' + item.resultCount + ' results • ' + formatDate(new Date(item.timestamp)) + '</div>' +
                '</div>'
            ).join('');
        }

        function populateSourceFilter() {
            const filter = document.getElementById('sourceFilter');
            const currentValue = filter.value;
            
            filter.innerHTML = '<option value="">All Sources</option>' +
                sources.filter(s => s.isEnabled).map(source =>
                    '<option value="' + source.name + '">' + source.displayName + '</option>'
                ).join('');
                
            filter.value = currentValue;
        }

        function searchDocumentation() {
            const query = document.getElementById('searchQuery').value.trim();
            if (!query) return;

            const filters = {
                source: document.getElementById('sourceFilter').value,
                language: document.getElementById('languageFilter').value,
                limit: parseInt(document.getElementById('limitFilter').value),
                threshold: parseFloat(document.getElementById('thresholdFilter').value)
            };

            vscode.postMessage({
                command: 'searchDocumentation',
                query: query,
                filters: filters
            });
        }

        function handleSearchKeyPress(event) {
            if (event.key === 'Enter') {
                searchDocumentation();
            }
        }

        function searchFromHistory(query) {
            document.getElementById('searchQuery').value = query;
            searchDocumentation();
        }

        function handleSearchResults(data) {
            currentResults = data.results;
            
            const resultsSection = document.getElementById('resultsSection');
            const resultsTitle = document.getElementById('resultsTitle');
            const resultsList = document.getElementById('resultsList');
            
            resultsTitle.textContent = 'Search Results for "' + data.query + '" (' + data.results.length + ')';
            
            if (data.results.length === 0) {
                resultsList.innerHTML = 
                    '<div class="empty-state">' +
                    '<h3>No results found</h3>' +
                    '<p>Try adjusting your search terms or filters</p>' +
                    '</div>';
            } else {
                resultsList.innerHTML = data.results.map((result, index) =>
                    '<div class="result-card">' +
                    '<div class="result-header">' +
                    '<div>' +
                    '<div class="result-title">' + escapeHtml(result.document.metadata.title) + '</div>' +
                    '<div class="result-meta">' +
                    '<span>' + result.document.metadata.source + '</span>' +
                    (result.document.metadata.framework ? '<span>' + result.document.metadata.framework + '</span>' : '') +
                    '<span class="result-score">' + Math.round(result.score * 100) + '%</span>' +
                    '</div>' +
                    '</div>' +
                    '</div>' +
                    '<div class="result-content">' + escapeHtml(result.document.content.substring(0, 300)) + '...</div>' +
                    (result.document.metadata.url ? 
                        '<div class="result-url"><a href="' + result.document.metadata.url + '" target="_blank">' + result.document.metadata.url + '</a></div>' : 
                        '') +
                    '</div>'
                ).join('');
            }
            
            resultsSection.style.display = 'block';
            renderSearchHistory();
        }

        function toggleSource(sourceName, enabled) {
            vscode.postMessage({
                command: 'toggleSource',
                sourceName: sourceName,
                enabled: enabled
            });
        }

        function toggleCategory(category, enabled) {
            vscode.postMessage({
                command: 'toggleCategory',
                category: category,
                enabled: enabled
            });
        }

        function updateSourceToggle(sourceName, enabled) {
            const source = sources.find(s => s.name === sourceName);
            if (source) {
                source.isEnabled = enabled;
                renderSources();
                populateSourceFilter();
            }
        }

        function updateAllSources() {
            vscode.postMessage({
                command: 'updateDocumentation',
                sources: [],
                forceRefresh: false
            });
        }

        function refreshStats() {
            vscode.postMessage({
                command: 'getSourceStats'
            });
        }

        function debugCollection() {
            vscode.postMessage({
                command: 'debugCollection'
            });
        }

        function forceReinitializeDB() {
            vscode.postMessage({
                command: 'forceReinitializeDB'
            });
        }

        function testCloudAccess() {
            vscode.postMessage({
                command: 'testCloudAccess'
            });
        }

        function clearHistory() {
            vscode.postMessage({
                command: 'clearSearchHistory'
            });
        }

        function exportResults() {
            if (currentResults.length === 0) {
                alert('No results to export');
                return;
            }
            
            vscode.postMessage({
                command: 'exportResults',
                results: currentResults
            });
        }

        function toggleCustomScrape() {
            const customScrape = document.getElementById('customScrape');
            customScrape.style.display = customScrape.style.display === 'none' ? 'block' : 'none';
        }

        function scrapeCustomUrl() {
            const url = document.getElementById('customUrl').value.trim();
            if (!url) return;
            
            vscode.postMessage({
                command: 'customScrape',
                url: url,
                config: {
                    source: 'Custom',
                    followLinks: false,
                    maxDepth: 1
                }
            });
            
            document.getElementById('customUrl').value = '';
            toggleCustomScrape();
        }

        function updateLoadingState(isLoading) {
            const indicator = document.getElementById('loadingIndicator');
            indicator.style.display = isLoading ? 'flex' : 'none';
        }

        function showProgress(message) {
            const indicator = document.getElementById('loadingIndicator');
            const messageEl = document.getElementById('loadingMessage');
            
            indicator.style.display = 'flex';
            messageEl.textContent = message;
        }

        function showUpdateComplete(processed, errors) {
            const message = 'Update complete: ' + processed + ' documents processed';
            if (errors > 0) {
                message += ', ' + errors + ' errors';
            }
            
            alert(message);
            refreshStats();
        }

        function showError(message) {
            alert('Error: ' + message);
        }

        function showCategoryToggleSuccess(category, enabled, affectedCount) {
            const action = enabled ? 'enabled' : 'disabled';
            const message = action + ' ' + affectedCount + ' sources in ' + category + ' category';
            
            // Show a temporary success message
            const indicator = document.getElementById('refreshIndicator');
            indicator.innerHTML = '<span>✅</span><span class="refresh-status">' + message + '</span>';
            indicator.style.opacity = '1';
            
            setTimeout(function() {
                indicator.innerHTML = '<span>🔄</span><span class="refresh-status" id="refreshStatus">Auto-refresh active</span>';
                indicator.style.opacity = '0.8';
            }, 3000);
        }

        function formatDate(date) {
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        let autoRefreshTimer = null;
        let lastRefreshTime = null;

        function startAutoRefreshTimer() {
            // Update refresh status every 10 seconds
            autoRefreshTimer = setInterval(updateRefreshStatus, 10000);
            updateRefreshStatus();
        }

        function updateRefreshStatus() {
            const refreshStatus = document.getElementById('refreshStatus');
            const now = new Date();
            
            if (lastRefreshTime) {
                const elapsed = Math.floor((now - lastRefreshTime) / 1000);
                const minutes = Math.floor(elapsed / 60);
                const seconds = elapsed % 60;
                
                if (elapsed < 60) {
                    refreshStatus.textContent = 'Updated ' + seconds + 's ago';
                } else if (minutes < 5) {
                    refreshStatus.textContent = 'Updated ' + minutes + 'm ago';
                } else {
                    refreshStatus.textContent = 'Refreshing...';
                }
            } else {
                refreshStatus.textContent = 'Loading...';
            }
        }

        function onStatsUpdated() {
            lastRefreshTime = new Date();
            updateRefreshStatus();
            
            // Add visual feedback
            const indicator = document.getElementById('refreshIndicator');
            indicator.style.opacity = '1';
            setTimeout(() => {
                indicator.style.opacity = '0.8';
            }, 1000);
        }

        window.addEventListener('beforeunload', function() {
            if (autoRefreshTimer) {
                clearInterval(autoRefreshTimer);
            }
        });
    </script>
</body>
</html>`;
  }
}
