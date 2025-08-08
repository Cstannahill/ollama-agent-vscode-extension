import * as vscode from "vscode";
import { getConfig } from "../config";
import { logger } from "../utils/logger";

interface FoundationAgentModel {
  agentName: string;
  displayName: string;
  description: string;
  currentModel: string;
  configKey: string;
  icon: string;
}

export class FoundationModelsSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "ollama-agent-foundation-models";

  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _availableModels: string[] = [];
  private _foundationAgents: FoundationAgentModel[] = [];

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
    this._initializeFoundationAgents();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Load models on initialization
    this._loadAvailableModels();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "updateAgentModel":
          await this._updateAgentModel(message.agentName, message.model);
          break;
        case "loadModels":
          await this._loadAvailableModels();
          break;
        case "resetToDefaults":
          await this._resetToDefaults();
          break;
        case "openFullPanel":
          // Open the full Foundation Models Panel for advanced management
          vscode.commands.executeCommand("ollamaAgent.foundationModels");
          break;
      }
    });
  }

  private _initializeFoundationAgents(): void {
    this._foundationAgents = [
      {
        agentName: "retriever",
        displayName: "🔍 Retriever",
        description: "Semantic search and content retrieval",
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.retriever") || "",
        configKey: "foundation.models.retriever",
        icon: "🔍"
      },
      {
        agentName: "reranker",
        displayName: "📊 Reranker", 
        description: "Document scoring and ranking",
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.reranker") || "",
        configKey: "foundation.models.reranker",
        icon: "📊"
      },
      {
        agentName: "toolSelector",
        displayName: "🔧 Tool Selector",
        description: "Intelligent tool classification",
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.toolSelector") || "",
        configKey: "foundation.models.toolSelector",
        icon: "🔧"
      },
      {
        agentName: "critic",
        displayName: "🎯 Critic",
        description: "Quality assessment and evaluation",
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.critic") || "",
        configKey: "foundation.models.critic",
        icon: "🎯"
      },
      {
        agentName: "taskPlanner",
        displayName: "📋 Task Planner",
        description: "Task decomposition and planning",
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.taskPlanner") || "",
        configKey: "foundation.models.taskPlanner",
        icon: "📋"
      },
      {
        agentName: "queryRewriter",
        displayName: "✏️ Query Rewriter",
        description: "Search query optimization",
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.queryRewriter") || "",
        configKey: "foundation.models.queryRewriter",
        icon: "✏️"
      },
      {
        agentName: "cotGenerator",
        displayName: "🧠 CoT Generator",
        description: "Chain-of-thought reasoning",
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.cotGenerator") || "",
        configKey: "foundation.models.cotGenerator",
        icon: "🧠"
      },
      {
        agentName: "chunkScorer",
        displayName: "📈 Chunk Scorer",
        description: "Content relevance scoring",
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.chunkScorer") || "",
        configKey: "foundation.models.chunkScorer",
        icon: "📈"
      },
      {
        agentName: "actionCaller",
        displayName: "⚡ Action Caller",
        description: "Function-call operations",
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.actionCaller") || "",
        configKey: "foundation.models.actionCaller",
        icon: "⚡"
      },
      {
        agentName: "embedder",
        displayName: "🔗 Embedder",
        description: "Vector operations",
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.embedder") || "",
        configKey: "foundation.models.embedder",
        icon: "🔗"
      }
    ];
  }

  private async _loadAvailableModels(): Promise<void> {
    try {
      const config = getConfig();
      logger.info("[FOUNDATION_MODELS_SIDEBAR] Loading available models from Ollama");
      
      const response = await fetch(`${config.ollamaUrl}/api/tags`);
      const data = await response.json();
      
      this._availableModels = data.models?.map((model: any) => model.name) || [];
      
      // Send models to webview
      this._view?.webview.postMessage({
        command: "modelsLoaded",
        models: this._availableModels,
        foundationAgents: this._foundationAgents
      });
      
      logger.info(`[FOUNDATION_MODELS_SIDEBAR] Loaded ${this._availableModels.length} available models`);
    } catch (error) {
      logger.error("[FOUNDATION_MODELS_SIDEBAR] Failed to load models:", error);
      this._view?.webview.postMessage({
        command: "modelsError",
        error: "Failed to load models from Ollama server"
      });
    }
  }

  private async _updateAgentModel(agentName: string, model: string): Promise<void> {
    try {
      const agent = this._foundationAgents.find(a => a.agentName === agentName);
      if (!agent) {
        throw new Error(`Agent not found: ${agentName}`);
      }

      // Update VS Code configuration
      await vscode.workspace.getConfiguration("ollamaAgent").update(agent.configKey, model, vscode.ConfigurationTarget.Global);
      
      // Update local state
      agent.currentModel = model;
      
      logger.info(`[FOUNDATION_MODELS_SIDEBAR] Updated ${agent.displayName} model to: ${model}`);
      
      // Send success message
      this._view?.webview.postMessage({
        command: "modelUpdated",
        agentName: agentName,
        model: model,
        success: true
      });
    } catch (error) {
      logger.error(`[FOUNDATION_MODELS_SIDEBAR] Failed to update model for ${agentName}:`, error);
      this._view?.webview.postMessage({
        command: "modelUpdated",
        agentName: agentName,
        model: model,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async _resetToDefaults(): Promise<void> {
    try {
      const defaults = {
        "foundation.models.retriever": "qwen3:1.7b",
        "foundation.models.reranker": "gemma3:1b",
        "foundation.models.toolSelector": "gemma3:1b",
        "foundation.models.critic": "deepseek-r1:latest",
        "foundation.models.taskPlanner": "deepseek-r1:latest",
        "foundation.models.queryRewriter": "qwen3:1.7b",
        "foundation.models.cotGenerator": "deepseek-r1:latest",
        "foundation.models.chunkScorer": "gemma3:1b",
        "foundation.models.actionCaller": "codellama:7b",
        "foundation.models.embedder": "nomic-embed-text:latest"
      };

      for (const [key, value] of Object.entries(defaults)) {
        await vscode.workspace.getConfiguration("ollamaAgent").update(key, value, vscode.ConfigurationTarget.Global);
      }

      // Update local state
      this._foundationAgents.forEach(agent => {
        const defaultModel = defaults[agent.configKey as keyof typeof defaults];
        if (defaultModel) {
          agent.currentModel = defaultModel;
        }
      });
      
      logger.info("[FOUNDATION_MODELS_SIDEBAR] Reset all agent models to optimized defaults");
      
      this._view?.webview.postMessage({
        command: "defaultsReset",
        foundationAgents: this._foundationAgents
      });
    } catch (error) {
      logger.error("[FOUNDATION_MODELS_SIDEBAR] Failed to reset to defaults:", error);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Foundation Models</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sidebar-background);
            margin: 0;
            padding: 12px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 12px;
        }
        
        .title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 4px;
        }
        
        .description {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
        }
        
        .agent-item {
            margin-bottom: 12px;
            padding: 8px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
            border: 1px solid var(--vscode-widget-border);
        }
        
        .agent-header {
            display: flex;
            align-items: center;
            margin-bottom: 4px;
        }
        
        .agent-name {
            font-size: 12px;
            font-weight: 500;
            margin-left: 4px;
        }
        
        .agent-description {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
        }
        
        .model-select {
            width: 100%;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 4px;
            color: var(--vscode-input-foreground);
            font-size: 11px;
        }
        
        .model-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        
        .actions {
            margin-top: 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .action-button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            padding: 8px 12px;
            font-size: 12px;
            cursor: pointer;
            width: 100%;
        }
        
        .action-button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .action-button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .action-button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .status {
            font-size: 11px;
            padding: 8px;
            border-radius: 3px;
            margin: 8px 0;
            text-align: center;
        }
        
        .status.success {
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            color: var(--vscode-inputValidation-infoForeground);
        }
        
        .status.error {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-inputValidation-errorForeground);
        }
        
        .loading {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
        
        .compact-view {
            font-size: 11px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">🧠 Foundation Models</div>
        <div class="description">Configure models for foundation agents</div>
    </div>
    
    <div id="content">
        <div class="loading">Loading models...</div>
    </div>
    
    <div class="actions">
        <button class="action-button secondary" onclick="loadModels()">🔄 Refresh Models</button>
        <button class="action-button secondary" onclick="resetToDefaults()">↺ Reset to Defaults</button>
        <button class="action-button" onclick="openFullPanel()">⚙️ Advanced Settings</button>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let availableModels = [];
        let foundationAgents = [];
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'modelsLoaded':
                    availableModels = message.models;
                    foundationAgents = message.foundationAgents;
                    renderAgents();
                    break;
                case 'modelsError':
                    showStatus('Failed to load models: ' + message.error, 'error');
                    break;
                case 'modelUpdated':
                    if (message.success) {
                        showStatus('Model updated successfully', 'success');
                        updateAgentModel(message.agentName, message.model);
                    } else {
                        showStatus('Failed to update model: ' + message.error, 'error');
                    }
                    break;
                case 'defaultsReset':
                    foundationAgents = message.foundationAgents;
                    renderAgents();
                    showStatus('Reset to optimized defaults', 'success');
                    break;
            }
        });
        
        function renderAgents() {
            const content = document.getElementById('content');
            
            if (foundationAgents.length === 0) {
                content.innerHTML = '<div class="loading">No agents configured</div>';
                return;
            }
            
            let html = '';
            foundationAgents.forEach(agent => {
                html += \`
                    <div class="agent-item">
                        <div class="agent-header">
                            <span>\${agent.icon}</span>
                            <span class="agent-name">\${agent.displayName}</span>
                        </div>
                        <div class="agent-description">\${agent.description}</div>
                        <select class="model-select" onchange="updateModel('\${agent.agentName}', this.value)">
                            <option value="">Select model...</option>
                            \${availableModels.map(model => 
                                \`<option value="\${model}" \${model === agent.currentModel ? 'selected' : ''}>\${model}</option>\`
                            ).join('')}
                        </select>
                    </div>
                \`;
            });
            
            content.innerHTML = html;
        }
        
        function updateModel(agentName, model) {
            if (model) {
                vscode.postMessage({
                    command: 'updateAgentModel',
                    agentName: agentName,
                    model: model
                });
            }
        }
        
        function updateAgentModel(agentName, model) {
            const agent = foundationAgents.find(a => a.agentName === agentName);
            if (agent) {
                agent.currentModel = model;
            }
        }
        
        function loadModels() {
            document.getElementById('content').innerHTML = '<div class="loading">Loading models...</div>';
            vscode.postMessage({ command: 'loadModels' });
        }
        
        function resetToDefaults() {
            vscode.postMessage({ command: 'resetToDefaults' });
        }
        
        function openFullPanel() {
            vscode.postMessage({ command: 'openFullPanel' });
        }
        
        function showStatus(message, type) {
            const existingStatus = document.querySelector('.status');
            if (existingStatus) {
                existingStatus.remove();
            }
            
            const status = document.createElement('div');
            status.className = \`status \${type}\`;
            status.textContent = message;
            
            const content = document.getElementById('content');
            content.appendChild(status);
            
            setTimeout(() => {
                status.remove();
            }, 3000);
        }
        
        // Load models on startup
        loadModels();
    </script>
</body>
</html>`;
  }
}