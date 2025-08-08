import * as vscode from "vscode";
import { getConfig, updateConfig } from "../config";
import { logger } from "../utils/logger";
import { OllamaLLM } from "../api/ollama";

export interface SettingsTabData {
  id: string;
  title: string;
  content: string;
  icon?: string;
}

export class SettingsPanel {
  public static currentPanel: SettingsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _currentTab: string = "general";

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set the webview's initial HTML content
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "switchTab":
            this._currentTab = message.tabId;
            this._update();
            break;
          case "updateSetting":
            await this._updateSetting(
              message.key,
              message.value,
              message.isGlobal
            );
            break;
          case "resetSettings":
            await this._resetSettings();
            break;
          case "exportSettings":
            await this._exportSettings();
            break;
          case "importSettings":
            await this._importSettings();
            break;
          case "loadModels":
            await this._loadModels();
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.ViewColumn.One;

    // If we already have a panel, show it
    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      "ollamaAgentSettings",
      "Ollama Agent Settings",
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

    SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri);
  }

  public dispose() {
    SettingsPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async _updateSetting(
    key: string,
    value: any,
    isGlobal: boolean = false
  ) {
    try {
      await updateConfig(key, value, isGlobal);

      // Show success message
      this._panel.webview.postMessage({
        command: "settingUpdated",
        key,
        value,
        success: true,
      });

      logger.info(`Setting updated: ${key} = ${value}`);
    } catch (error) {
      logger.error(`Failed to update setting ${key}:`, error);

      // Show error message
      this._panel.webview.postMessage({
        command: "settingUpdated",
        key,
        value,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async _resetSettings() {
    try {
      const config = vscode.workspace.getConfiguration("ollamaAgent");
      const keys = [
        "ollamaUrl",
        "model",
        "logLevel",
        "temperature",
        "maxIterations",
        "verbose",
      ];

      for (const key of keys) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
      }

      vscode.window.showInformationMessage("Settings reset to defaults");
      this._update(); // Refresh the UI
    } catch (error) {
      logger.error("Failed to reset settings:", error);
      vscode.window.showErrorMessage("Failed to reset settings");
    }
  }

  private async _exportSettings() {
    try {
      const config = getConfig();
      const settings = JSON.stringify(config, null, 2);

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file("ollama-agent-settings.json"),
        filters: {
          "JSON Files": ["json"],
          "All Files": ["*"],
        },
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(settings, "utf8"));
        vscode.window.showInformationMessage("Settings exported successfully");
      }
    } catch (error) {
      logger.error("Failed to export settings:", error);
      vscode.window.showErrorMessage("Failed to export settings");
    }
  }

  private async _importSettings() {
    try {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          "JSON Files": ["json"],
          "All Files": ["*"],
        },
      });

      if (uris && uris.length > 0) {
        const content = await vscode.workspace.fs.readFile(uris[0]);
        const settings = JSON.parse(content.toString());

        // Validate and apply settings
        for (const [key, value] of Object.entries(settings)) {
          if (typeof value !== "undefined") {
            await updateConfig(key, value, true);
          }
        }

        vscode.window.showInformationMessage("Settings imported successfully");
        this._update(); // Refresh the UI
      }
    } catch (error) {
      logger.error("Failed to import settings:", error);
      vscode.window.showErrorMessage("Failed to import settings");
    }
  }

  private async _loadModels() {
    try {
      const config = getConfig();
      const ollama = new OllamaLLM({
        baseUrl: config.ollamaUrl,
        model: config.model // This is just for initialization
      });

      // Send loading message to webview
      this._panel.webview.postMessage({
        command: 'modelsLoading'
      });

      // Load models from Ollama
      const models = await ollama.listModels();
      
      // Send models to webview
      this._panel.webview.postMessage({
        command: 'modelsLoaded',
        models: models
      });

      logger.info(`Loaded ${models.length} models from Ollama`);
    } catch (error) {
      logger.error("Failed to load models:", error);
      
      // Send error to webview
      this._panel.webview.postMessage({
        command: 'modelsError',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private _getTabs(): SettingsTabData[] {
    return [
      {
        id: "general",
        title: "General",
        icon: "gear",
        content: this._getGeneralTabContent(),
      },
      {
        id: "model",
        title: "Model",
        icon: "hubot",
        content: this._getModelTabContent(),
      },
      {
        id: "advanced",
        title: "Advanced",
        icon: "settings-gear",
        content: this._getAdvancedTabContent(),
      },
      {
        id: "tools",
        title: "Tools",
        icon: "tools",
        content: this._getToolsTabContent(),
      },
      {
        id: "debug",
        title: "Debug",
        icon: "bug",
        content: this._getDebugTabContent(),
      },
    ];
  }

  private _getGeneralTabContent(): string {
    const config = getConfig();

    return `
      <div class="settings-section">
        <h3>Connection Settings</h3>
        
        <div class="setting-item">
          <label for="ollamaUrl">Ollama Server URL</label>
          <input 
            type="text" 
            id="ollamaUrl" 
            value="${config.ollamaUrl}" 
            placeholder="http://localhost:11434"
            data-setting="ollamaUrl"
          />
          <p class="setting-description">The URL where your Ollama server is running</p>
        </div>

        <div class="setting-item">
          <label for="verbose">Verbose Logging</label>
          <div class="checkbox-container">
            <input 
              type="checkbox" 
              id="verbose" 
              ${config.verbose ? "checked" : ""}
              data-setting="verbose"
            />
            <span class="checkbox-label">Enable detailed logging output</span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>Workspace Settings</h3>
        
        <div class="setting-item">
          <label>Auto-start Agent</label>
          <div class="checkbox-container">
            <input type="checkbox" id="autoStart" />
            <span class="checkbox-label">Start agent automatically when VS Code opens</span>
          </div>
        </div>

        <div class="setting-item">
          <label>Show Welcome Message</label>
          <div class="checkbox-container">
            <input type="checkbox" id="showWelcome" checked />
            <span class="checkbox-label">Show welcome message for new users</span>
          </div>
        </div>
      </div>
    `;
  }

  private _getModelTabContent(): string {
    const config = getConfig();

    return `
      <div class="settings-section">
        <h3>Model Configuration</h3>
        
        <div class="setting-item">
          <label for="model">Current Model</label>
          <input 
            type="text" 
            id="model" 
            value="${config.model}" 
            placeholder="llama3.2"
            data-setting="model"
          />
          <p class="setting-description">The Ollama model to use for conversations</p>
        </div>

        <div class="setting-item">
          <label for="temperature">Temperature</label>
          <div class="slider-container">
            <input 
              type="range" 
              id="temperature" 
              min="0" 
              max="2" 
              step="0.1" 
              value="${config.temperature}"
              data-setting="temperature"
            />
            <span class="slider-value">${config.temperature}</span>
          </div>
          <p class="setting-description">Controls randomness: 0 = deterministic, 2 = very creative</p>
        </div>

        <div class="setting-item">
          <label for="maxIterations">Max Iterations</label>
          <input 
            type="number" 
            id="maxIterations" 
            value="${config.maxIterations}" 
            min="1" 
            max="50"
            data-setting="maxIterations"
          />
          <p class="setting-description">Maximum number of agent reasoning steps</p>
        </div>
      </div>

      <div class="settings-section">
        <h3>Model Management</h3>
        
        <div class="button-group">
          <button class="secondary-button" onclick="refreshModels()">
            <span class="codicon codicon-refresh"></span>
            Refresh Available Models
          </button>
          <button class="secondary-button" onclick="testConnection()">
            <span class="codicon codicon-pulse"></span>
            Test Connection
          </button>
        </div>

        <div id="available-models" class="models-list">
          <p>Loading available models...</p>
        </div>
      </div>
    `;
  }

  private _getAdvancedTabContent(): string {
    const config = getConfig();

    return `
      <div class="settings-section">
        <h3>Performance Settings</h3>
        
        <div class="setting-item">
          <label>Context Window Size</label>
          <select data-setting="contextWindow">
            <option value="2048">2K tokens</option>
            <option value="4096" selected>4K tokens</option>
            <option value="8192">8K tokens</option>
            <option value="16384">16K tokens</option>
            <option value="32768">32K tokens</option>
          </select>
          <p class="setting-description">Maximum context length for conversations</p>
        </div>

        <div class="setting-item">
          <label>Request Timeout</label>
          <input type="number" value="30" min="5" max="300" data-setting="timeout" />
          <span class="input-suffix">seconds</span>
          <p class="setting-description">Timeout for model requests</p>
        </div>

        <div class="setting-item">
          <label>Retry Attempts</label>
          <input type="number" value="3" min="1" max="10" data-setting="retryAttempts" />
          <p class="setting-description">Number of retry attempts for failed requests</p>
        </div>
      </div>

      <div class="settings-section">
        <h3>Security Settings</h3>
        
        <div class="setting-item">
          <label>Allow Shell Commands</label>
          <div class="checkbox-container">
            <input type="checkbox" id="allowShell" checked data-setting="allowShell" />
            <span class="checkbox-label">Allow agent to execute shell commands</span>
          </div>
          <p class="setting-description warning">⚠️ Only enable for trusted environments</p>
        </div>

        <div class="setting-item">
          <label>Confirm Destructive Operations</label>
          <div class="checkbox-container">
            <input type="checkbox" id="confirmDestructive" checked data-setting="confirmDestructive" />
            <span class="checkbox-label">Ask for confirmation before file deletion or modification</span>
          </div>
        </div>
      </div>
    `;
  }

  private _getToolsTabContent(): string {
    return `
      <div class="settings-section">
        <h3>Available Tools</h3>
        
        <div class="tools-grid">
          <div class="tool-card">
            <div class="tool-icon">📄</div>
            <div class="tool-info">
              <h4>File Operations</h4>
              <p>Read, write, and manage files in your workspace</p>
              <div class="tool-status enabled">Enabled</div>
            </div>
          </div>

          <div class="tool-card">
            <div class="tool-icon">💻</div>
            <div class="tool-info">
              <h4>Shell Commands</h4>
              <p>Execute terminal commands and scripts</p>
              <div class="tool-status enabled">Enabled</div>
            </div>
          </div>

          <div class="tool-card">
            <div class="tool-icon">🔧</div>
            <div class="tool-info">
              <h4>VS Code Commands</h4>
              <p>Interact with VS Code editor and extensions</p>
              <div class="tool-status enabled">Enabled</div>
            </div>
          </div>

          <div class="tool-card">
            <div class="tool-icon">📁</div>
            <div class="tool-info">
              <h4>Directory Listing</h4>
              <p>Browse and explore workspace structure</p>
              <div class="tool-status enabled">Enabled</div>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>Tool Configuration</h3>
        
        <div class="setting-item">
          <label>Tool Execution Timeout</label>
          <input type="number" value="30" min="5" max="300" />
          <span class="input-suffix">seconds</span>
        </div>

        <div class="setting-item">
          <label>Maximum File Size</label>
          <input type="number" value="10" min="1" max="100" />
          <span class="input-suffix">MB</span>
          <p class="setting-description">Maximum size for files that can be read/written</p>
        </div>

        <div class="setting-item">
          <label>Excluded File Patterns</label>
          <textarea rows="3" placeholder="node_modules/**, *.log, .git/**">node_modules/**
*.log
.git/**
dist/**
out/**</textarea>
          <p class="setting-description">Patterns for files to exclude from operations</p>
        </div>
      </div>
    `;
  }

  private _getDebugTabContent(): string {
    const config = getConfig();

    return `
      <div class="settings-section">
        <h3>Logging Configuration</h3>
        
        <div class="setting-item">
          <label for="logLevel">Log Level</label>
          <select id="logLevel" data-setting="logLevel">
            <option value="debug" ${
              config.logLevel === "debug" ? "selected" : ""
            }>Debug</option>
            <option value="info" ${
              config.logLevel === "info" ? "selected" : ""
            }>Info</option>
            <option value="warn" ${
              config.logLevel === "warn" ? "selected" : ""
            }>Warning</option>
            <option value="error" ${
              config.logLevel === "error" ? "selected" : ""
            }>Error</option>
          </select>
          <p class="setting-description">Minimum level for log messages</p>
        </div>

        <div class="setting-item">
          <label>Log to File</label>
          <div class="checkbox-container">
            <input type="checkbox" id="logToFile" />
            <span class="checkbox-label">Save logs to file in workspace</span>
          </div>
        </div>

        <div class="setting-item">
          <label>Show Tool Calls</label>
          <div class="checkbox-container">
            <input type="checkbox" id="showToolCalls" checked />
            <span class="checkbox-label">Display tool calls in chat interface</span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>Debug Actions</h3>
        
        <div class="button-group">
          <button class="secondary-button" onclick="clearLogs()">
            <span class="codicon codicon-clear-all"></span>
            Clear Logs
          </button>
          <button class="secondary-button" onclick="exportLogs()">
            <span class="codicon codicon-export"></span>
            Export Logs
          </button>
          <button class="secondary-button" onclick="showSystemInfo()">
            <span class="codicon codicon-info"></span>
            System Info
          </button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Diagnostic Information</h3>
        
        <div class="diagnostic-info">
          <div class="diagnostic-item">
            <span class="diagnostic-label">Extension Version:</span>
            <span class="diagnostic-value">1.0.0</span>
          </div>
          <div class="diagnostic-item">
            <span class="diagnostic-label">VS Code Version:</span>
            <span class="diagnostic-value" id="vscodeVersion">Loading...</span>
          </div>
          <div class="diagnostic-item">
            <span class="diagnostic-label">Node.js Version:</span>
            <span class="diagnostic-value" id="nodeVersion">Loading...</span>
          </div>
          <div class="diagnostic-item">
            <span class="diagnostic-label">Platform:</span>
            <span class="diagnostic-value" id="platform">Loading...</span>
          </div>
        </div>
      </div>
    `;
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const tabs = this._getTabs();
    const currentTabContent =
      tabs.find((tab) => tab.id === this._currentTab)?.content ||
      tabs[0].content;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ollama Agent Settings</title>
    <style>
        ${this._getStyles()}
    </style>
</head>
<body>
    <div class="settings-container">
        <header class="settings-header">
            <h1>
                <span class="codicon codicon-settings-gear"></span>
                Ollama Agent Settings
            </h1>
            <div class="header-actions">
                <button class="secondary-button" onclick="exportSettings()">
                    <span class="codicon codicon-export"></span>
                    Export
                </button>
                <button class="secondary-button" onclick="importSettings()">
                    <span class="codicon codicon-import"></span>
                    Import
                </button>
                <button class="danger-button" onclick="resetSettings()">
                    <span class="codicon codicon-refresh"></span>
                    Reset All
                </button>
            </div>
        </header>

        <div class="settings-content">
            <nav class="settings-tabs">
                ${tabs
                  .map(
                    (tab) => `
                    <button 
                        class="tab-button ${
                          tab.id === this._currentTab ? "active" : ""
                        }"
                        onclick="switchTab('${tab.id}')"
                    >
                        <span class="codicon codicon-${
                          tab.icon || "gear"
                        }"></span>
                        ${tab.title}
                    </button>
                `
                  )
                  .join("")}
            </nav>

            <main class="settings-main">
                <div class="tab-content">
                    ${currentTabContent}
                </div>
            </main>
        </div>
    </div>

    <script>
        ${this._getJavaScript()}
    </script>
</body>
</html>`;
  }

  private _getStyles(): string {
    return `
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            line-height: 1.5;
        }

        .settings-container {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .settings-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-panel-background);
        }

        .settings-header h1 {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 24px;
            font-weight: 600;
        }

        .header-actions {
            display: flex;
            gap: 8px;
        }

        .settings-content {
            display: flex;
            flex: 1;
        }

        .settings-tabs {
            width: 200px;
            background: var(--vscode-sideBar-background);
            border-right: 1px solid var(--vscode-panel-border);
            padding: 12px 0;
        }

        .tab-button {
            width: 100%;
            padding: 12px 20px;
            background: none;
            border: none;
            color: var(--vscode-sideBar-foreground);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            transition: background-color 0.2s;
        }

        .tab-button:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .tab-button.active {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .settings-main {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
        }

        .settings-section {
            margin-bottom: 32px;
        }

        .settings-section h3 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--vscode-foreground);
        }

        .setting-item {
            margin-bottom: 20px;
        }

        .setting-item label {
            display: block;
            font-weight: 500;
            margin-bottom: 6px;
        }

        .setting-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }

        .setting-description.warning {
            color: var(--vscode-errorForeground);
        }

        input[type="text"], 
        input[type="number"], 
        textarea, 
        select {
            width: 100%;
            max-width: 400px;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-family: inherit;
            font-size: inherit;
        }

        input:focus, 
        textarea:focus, 
        select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .checkbox-container {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .checkbox-label {
            font-size: 14px;
        }

        .slider-container {
            display: flex;
            align-items: center;
            gap: 12px;
            max-width: 400px;
        }

        .slider-container input[type="range"] {
            flex: 1;
        }

        .slider-value {
            font-weight: 500;
            min-width: 40px;
        }

        .input-suffix {
            margin-left: 8px;
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }

        .button-group {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        .secondary-button, 
        .danger-button {
            padding: 8px 16px;
            border: 1px solid var(--vscode-button-border);
            border-radius: 3px;
            cursor: pointer;
            font-family: inherit;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }

        .secondary-button {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .secondary-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .danger-button {
            background: var(--vscode-errorForeground);
            color: var(--vscode-errorBackground);
        }

        .danger-button:hover {
            opacity: 0.9;
        }

        .tools-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }

        .tool-card {
            background: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
            display: flex;
            gap: 12px;
        }

        .tool-icon {
            font-size: 24px;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
            background: var(--vscode-button-background);
        }

        .tool-info h4 {
            margin-bottom: 4px;
            font-size: 16px;
        }

        .tool-info p {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
        }

        .tool-status {
            font-size: 12px;
            padding: 2px 8px;
            border-radius: 12px;
            font-weight: 500;
        }

        .tool-status.enabled {
            background: var(--vscode-terminal-ansiGreen);
            color: var(--vscode-editor-background);
        }

        .models-list {
            background: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
            margin-top: 12px;
        }

        .models-grid {
            display: grid;
            gap: 8px;
            margin-top: 12px;
        }

        .model-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
        }

        .model-name {
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }

        .model-select-btn {
            padding: 4px 12px;
            font-size: 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }

        .model-select-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .diagnostic-info {
            background: var(--vscode-editor-widget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
        }

        .diagnostic-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .diagnostic-item:last-child {
            border-bottom: none;
        }

        .diagnostic-label {
            font-weight: 500;
        }

        .diagnostic-value {
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-descriptionForeground);
        }

        .codicon {
            font-family: codicon;
        }
    `;
  }

  private _getJavaScript(): string {
    return `
        const vscode = acquireVsCodeApi();

        function switchTab(tabId) {
            vscode.postMessage({
                command: 'switchTab',
                tabId: tabId
            });
            
            // Use setTimeout to ensure tab switching completes first
            setTimeout(() => {
                // Auto-load models when switching to model tab
                if (tabId === 'model') {
                    refreshModels();
                }
            }, 100);
        }

        function updateSetting(element) {
            const key = element.dataset.setting;
            let value = element.value;
            
            // Handle different input types
            if (element.type === 'checkbox') {
                value = element.checked;
            } else if (element.type === 'number' || element.type === 'range') {
                value = parseFloat(value);
            }

            vscode.postMessage({
                command: 'updateSetting',
                key: key,
                value: value,
                isGlobal: true
            });
        }

        function resetSettings() {
            if (confirm('Are you sure you want to reset all settings to their defaults?')) {
                vscode.postMessage({
                    command: 'resetSettings'
                });
            }
        }

        function exportSettings() {
            vscode.postMessage({
                command: 'exportSettings'
            });
        }

        function importSettings() {
            vscode.postMessage({
                command: 'importSettings'
            });
        }

        function refreshModels() {
            // Request models from the backend
            vscode.postMessage({
                command: 'loadModels'
            });
        }

        function testConnection() {
            // Implementation for testing connection
            alert('Testing connection...');
        }

        function clearLogs() {
            if (confirm('Are you sure you want to clear all logs?')) {
                // Implementation for clearing logs
                alert('Logs cleared');
            }
        }

        function exportLogs() {
            // Implementation for exporting logs
            alert('Exporting logs...');
        }

        function showSystemInfo() {
            // Implementation for showing system info
            alert('System information displayed');
        }

        // Auto-save settings when inputs change
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('[data-setting]').forEach(element => {
                element.addEventListener('change', function() {
                    updateSetting(this);
                });

                // For range inputs, also update on input for real-time feedback
                if (element.type === 'range') {
                    element.addEventListener('input', function() {
                        const sliderValue = this.parentElement.querySelector('.slider-value');
                        if (sliderValue) {
                            sliderValue.textContent = this.value;
                        }
                    });
                }
            });
        });

        // Auto-load models if we're on the model tab
        if (window.location.hash === '#model') {
            refreshModels();
        }

        // Handle messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'settingUpdated':
                    if (message.success) {
                        // Show brief success indicator
                        console.log('Setting updated:', message.key);
                    } else {
                        alert('Failed to update setting: ' + message.error);
                    }
                    break;
                case 'modelsLoading':
                    const modelsContainer = document.getElementById('available-models');
                    if (modelsContainer) {
                        modelsContainer.innerHTML = '<p>Loading available models...</p>';
                    }
                    break;
                case 'modelsLoaded':
                    handleModelsLoaded(message.models);
                    break;
                case 'modelsError':
                    handleModelsError(message.error);
                    break;
            }
        });

        function handleModelsLoaded(models) {
            const modelsContainer = document.getElementById('available-models');
            if (!modelsContainer) return;

            if (!models || models.length === 0) {
                modelsContainer.innerHTML = '<p>No models found. Make sure Ollama is running and has models installed.</p>';
                return;
            }

            let html = '<h4>Available Models (' + models.length + '):</h4>';
            html += '<div class="models-grid">';
            
            models.forEach(model => {
                html += '<div class="model-item">';
                html += '<span class="model-name">' + model + '</span>';
                html += '<button class="model-select-btn" onclick="selectModel(\'' + model + '\')">Select</button>';
                html += '</div>';
            });
            
            html += '</div>';
            modelsContainer.innerHTML = html;
        }

        function handleModelsError(error) {
            const modelsContainer = document.getElementById('available-models');
            if (modelsContainer) {
                modelsContainer.innerHTML = '<p style="color: var(--vscode-errorForeground);">Error loading models: ' + error + '</p>';
            }
        }

        function selectModel(modelName) {
            const modelInput = document.getElementById('model');
            if (modelInput) {
                modelInput.value = modelName;
                updateSetting(modelInput);
            }
        }
    `;
  }
}
