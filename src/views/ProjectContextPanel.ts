/**
 * Project Context Panel - Interactive webview for project analysis and context
 * 
 * Provides comprehensive project visualization including file tree, overview,
 * features, status tracking, and manual indexing controls.
 */

import * as vscode from 'vscode';
import { Disposable } from 'vscode';
import { logger } from '../utils/logger';
import { ProjectContextManager } from '../context/ProjectContextManager';
import { 
  ProjectStructure, 
  IndexingProgress, 
  FileTreeNode, 
  ProjectFeature,
  ChromaCollectionInfo 
} from '../context/ProjectContextTypes';

export interface ProjectContextPanelMessage {
  type: 'trigger-indexing' | 'refresh-data' | 'export-data' | 'file-selected' | 'feature-selected';
  data?: any;
}

export interface ProjectContextPanelState {
  projectStructure?: ProjectStructure;
  indexingProgress?: IndexingProgress;
  isIndexing: boolean;
  selectedFile?: string;
  selectedFeature?: string;
  chromaCollections: ChromaCollectionInfo[];
  error?: string;
}

/**
 * Manages the Project Context webview panel
 */
export class ProjectContextPanel implements Disposable {
  public static readonly viewType = 'ollamaAgent.projectContext';
  
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: Disposable[] = [];
  private _projectContextManager: ProjectContextManager;
  private _state: ProjectContextPanelState;

  public static createOrShow(extensionUri: vscode.Uri, projectContextManager: ProjectContextManager): ProjectContextPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    const existingPanel = ProjectContextPanel._currentPanel;
    if (existingPanel) {
      existingPanel._panel.reveal(column);
      return existingPanel;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      ProjectContextPanel.viewType,
      'Project Context',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
          vscode.Uri.joinPath(extensionUri, 'out')
        ],
        retainContextWhenHidden: true
      }
    );

    return new ProjectContextPanel(panel, extensionUri, projectContextManager);
  }

  private static _currentPanel: ProjectContextPanel | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    projectContextManager: ProjectContextManager
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._projectContextManager = projectContextManager;
    this._state = {
      isIndexing: false,
      chromaCollections: [],
      error: undefined
    };

    ProjectContextPanel._currentPanel = this;

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message: ProjectContextPanelMessage) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables
    );

    // Initial data load
    this._loadInitialData();
  }

  /**
   * Handle messages from webview
   */
  private async _handleMessage(message: ProjectContextPanelMessage): Promise<void> {
    try {
      logger.debug(`[PROJECT_CONTEXT_PANEL] Received message: ${message.type}`);

      switch (message.type) {
        case 'trigger-indexing':
          await this._triggerIndexing();
          break;

        case 'refresh-data':
          await this._refreshData();
          break;

        case 'export-data':
          await this._exportData();
          break;

        case 'file-selected':
          this._state.selectedFile = message.data?.filePath;
          await this._update();
          break;

        case 'feature-selected':
          this._state.selectedFeature = message.data?.featureId;
          await this._update();
          break;

        default:
          logger.warn(`[PROJECT_CONTEXT_PANEL] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      logger.error('[PROJECT_CONTEXT_PANEL] Error handling message:', error);
      this._state.error = error instanceof Error ? error.message : String(error);
      await this._update();
    }
  }

  /**
   * Trigger project indexing
   */
  private async _triggerIndexing(): Promise<void> {
    try {
      this._state.isIndexing = true;
      this._state.error = undefined;
      await this._update();

      const progressCallback = async (progress: IndexingProgress) => {
        this._state.indexingProgress = progress;
        await this._update();
      };

      const projectStructure = await this._projectContextManager.triggerProjectIndexing(progressCallback);
      
      this._state.projectStructure = projectStructure;
      this._state.isIndexing = false;
      this._state.indexingProgress = this._projectContextManager.getIndexingProgress();
      
      await this._update();

      vscode.window.showInformationMessage('Project indexing completed successfully!');

    } catch (error) {
      logger.error('[PROJECT_CONTEXT_PANEL] Indexing failed:', error);
      this._state.isIndexing = false;
      this._state.error = error instanceof Error ? error.message : String(error);
      await this._update();
      
      vscode.window.showErrorMessage(`Project indexing failed: ${this._state.error}`);
    }
  }

  /**
   * Refresh current data
   */
  private async _refreshData(): Promise<void> {
    try {
      this._state.projectStructure = this._projectContextManager.getProjectStructure();
      this._state.indexingProgress = this._projectContextManager.getIndexingProgress();
      this._state.chromaCollections = Array.from(this._projectContextManager.getChromaCollections().values());
      await this._update();
    } catch (error) {
      logger.error('[PROJECT_CONTEXT_PANEL] Data refresh failed:', error);
      this._state.error = error instanceof Error ? error.message : String(error);
      await this._update();
    }
  }

  /**
   * Export project data
   */
  private async _exportData(): Promise<void> {
    try {
      if (!this._state.projectStructure) {
        vscode.window.showWarningMessage('No project data to export. Please run indexing first.');
        return;
      }

      const exportData = {
        projectStructure: this._state.projectStructure,
        chromaCollections: this._state.chromaCollections,
        exportedAt: new Date().toISOString()
      };

      const exportJson = JSON.stringify(exportData, null, 2);
      
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`project-context-${Date.now()}.json`),
        filters: {
          'JSON files': ['json']
        }
      });

      if (saveUri) {
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(exportJson, 'utf8'));
        vscode.window.showInformationMessage(`Project context exported to ${saveUri.fsPath}`);
      }

    } catch (error) {
      logger.error('[PROJECT_CONTEXT_PANEL] Export failed:', error);
      vscode.window.showErrorMessage(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load initial data
   */
  private async _loadInitialData(): Promise<void> {
    try {
      this._state.projectStructure = this._projectContextManager.getProjectStructure();
      this._state.indexingProgress = this._projectContextManager.getIndexingProgress();
      this._state.chromaCollections = Array.from(this._projectContextManager.getChromaCollections().values());
      await this._update();
    } catch (error) {
      logger.error('[PROJECT_CONTEXT_PANEL] Initial data load failed:', error);
      this._state.error = error instanceof Error ? error.message : String(error);
      await this._update();
    }
  }

  /**
   * Update the webview content
   */
  private async _update(): Promise<void> {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  /**
   * Generate HTML for webview
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Get URIs for resources
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'project-context.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'project-context.css'));
    
    // Use a nonce to prevent XSS attacks
    const nonce = this._getNonce();
    
    const stateJson = JSON.stringify(this._state);

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
        <link href="${styleUri}" rel="stylesheet">
        <title>Project Context</title>
    </head>
    <body>
        <div id="app">
            <!-- Header -->
            <div class="header">
                <h1>📊 Project Context</h1>
                <div class="header-actions">
                    <button id="refresh-btn" class="btn-secondary" title="Refresh Data">
                        🔄 Refresh
                    </button>
                    <button id="export-btn" class="btn-secondary" title="Export Data">
                        💾 Export
                    </button>
                    <button id="index-btn" class="btn-primary" ${this._state.isIndexing ? 'disabled' : ''}>
                        ${this._state.isIndexing ? '⏳ Indexing...' : '🚀 Start Indexing'}
                    </button>
                </div>
            </div>

            <!-- Error Display -->
            ${this._state.error ? `
            <div class="error-banner">
                <span class="error-icon">⚠️</span>
                <span class="error-message">${this._state.error}</span>
                <button class="error-close" onclick="dismissError()">×</button>
            </div>
            ` : ''}

            <!-- Progress Display -->
            ${this._state.indexingProgress ? this._renderIndexingProgress() : ''}

            <!-- Main Content -->
            <div class="main-content">
                ${this._state.projectStructure ? this._renderProjectContent() : this._renderEmptyState()}
            </div>
        </div>

        <script nonce="${nonce}">
            window.initialState = ${stateJson};
        </script>
        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }

  /**
   * Render indexing progress
   */
  private _renderIndexingProgress(): string {
    if (!this._state.indexingProgress) return '';

    const progress = this._state.indexingProgress;
    const overallProgress = (progress.stagesCompleted.length / 12) * 100;

    return `
    <div class="progress-container">
        <div class="progress-header">
            <h3>Indexing Progress</h3>
            <span class="progress-percentage">${overallProgress.toFixed(1)}%</span>
        </div>
        
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${overallProgress}%"></div>
        </div>
        
        <div class="progress-details">
            <div class="progress-stage">
                <strong>Current Stage:</strong> ${progress.stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </div>
            
            ${progress.currentFile ? `
            <div class="progress-file">
                <strong>Processing:</strong> ${progress.currentFile}
            </div>
            ` : ''}
            
            <div class="progress-stats">
                <span>Files: ${progress.processedFiles}/${progress.totalFiles}</span>
                <span>Elapsed: ${Math.round(progress.elapsedTime / 1000)}s</span>
                <span>Errors: ${progress.errors.length}</span>
            </div>
        </div>

        ${progress.errors.length > 0 ? `
        <div class="progress-errors">
            <details>
                <summary>Errors (${progress.errors.length})</summary>
                <ul>
                    ${progress.errors.map(error => `
                    <li class="error-item">
                        <strong>${error.stage}:</strong> ${error.error}
                        <small>(${error.severity})</small>
                    </li>
                    `).join('')}
                </ul>
            </details>
        </div>
        ` : ''}
    </div>`;
  }

  /**
   * Render main project content
   */
  private _renderProjectContent(): string {
    if (!this._state.projectStructure) return '';

    return `
    <div class="content-grid">
        <!-- Project Overview -->
        <div class="content-section overview-section">
            ${this._renderProjectOverview()}
        </div>

        <!-- File Tree -->
        <div class="content-section file-tree-section">
            ${this._renderFileTree()}
        </div>

        <!-- Features -->
        <div class="content-section features-section">
            ${this._renderFeatures()}
        </div>

        <!-- Status & Metrics -->
        <div class="content-section status-section">
            ${this._renderStatus()}
        </div>

        <!-- Chroma Collections -->
        <div class="content-section collections-section">
            ${this._renderChromaCollections()}
        </div>
    </div>`;
  }

  /**
   * Render empty state
   */
  private _renderEmptyState(): string {
    return `
    <div class="empty-state">
        <div class="empty-icon">📁</div>
        <h2>No Project Context Available</h2>
        <p>Click "Start Indexing" to analyze your project and generate comprehensive context.</p>
        <div class="empty-features">
            <h3>What you'll get:</h3>
            <ul>
                <li>📊 Complete project structure analysis</li>
                <li>🔗 File dependency mapping</li>
                <li>🎯 Feature extraction and tracking</li>
                <li>📈 Code quality assessment</li>
                <li>🗂️ Searchable knowledge collections</li>
            </ul>
        </div>
    </div>`;
  }

  // Additional rendering methods would be implemented here...
  private _renderProjectOverview(): string { return '<!-- Project Overview -->'; }
  private _renderFileTree(): string { return '<!-- File Tree -->'; }
  private _renderFeatures(): string { return '<!-- Features -->'; }
  private _renderStatus(): string { return '<!-- Status -->'; }
  private _renderChromaCollections(): string { return '<!-- Collections -->'; }

  private _getNonce(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  public dispose(): void {
    ProjectContextPanel._currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}