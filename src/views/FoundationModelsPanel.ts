/**
 * Foundation Models Panel
 * 
 * Provides a dedicated interface for configuring models for each of the
 * 10 specialized foundation agents, allowing fine-grained control over
 * the foundation pipeline's model assignments.
 */

import * as vscode from "vscode";
import { logger } from "../utils/logger";
import { getConfig, ExtensionConfig } from "../config";

export interface FoundationAgentModelConfig {
  agentName: string;
  displayName: string;
  description: string;
  recommendedModels: string[];
  currentModel: string;
  configKey: string;
}

export class FoundationModelsPanel {
  public static currentPanel: FoundationModelsPanel | undefined;
  public static readonly viewType = "ollamaAgent.foundationModels";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _availableModels: string[] = [];
  private _foundationAgents: FoundationAgentModelConfig[] = [];
  private _extensionConfig: ExtensionConfig;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._extensionConfig = getConfig();
    this._initializeFoundationAgents();

    // Set the webview's initial HTML content
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
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
          case "optimizeModels":
            await this._optimizeModelAssignments();
            break;
        }
      },
      null,
      this._disposables
    );

    // Load models on initialization
    this._loadAvailableModels();
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.ViewColumn.One;

    // If we already have a panel, show it
    if (FoundationModelsPanel.currentPanel) {
      FoundationModelsPanel.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      FoundationModelsPanel.viewType,
      "🧠 Foundation Agent Models",
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

    FoundationModelsPanel.currentPanel = new FoundationModelsPanel(panel, extensionUri);
  }

  public dispose() {
    FoundationModelsPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }


  private _initializeFoundationAgents(): void {
    this._foundationAgents = [
      {
        agentName: "retriever",
        displayName: "🔍 Retriever Agent",
        description: "Semantic search and content retrieval using BGE/E5/GTE techniques",
        recommendedModels: ["qwen3:1.7b", "llama3.2:3b", "deepseek-r1:1.5b"],
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.retriever") || "",
        configKey: "foundation.models.retriever"
      },
      {
        agentName: "reranker", 
        displayName: "📊 Reranker Agent",
        description: "Cross-encoder document scoring and ranking",
        recommendedModels: ["gemma3:1b", "deepseek-r1:1.5b", "qwen3:1.7b"],
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.reranker") || "",
        configKey: "foundation.models.reranker"
      },
      {
        agentName: "toolSelector",
        displayName: "🔧 Tool Selector Agent", 
        description: "DPO-style intelligent tool classification and selection",
        recommendedModels: ["gemma3:1b", "qwen3:1.7b", "llama3.2:3b"],
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.toolSelector") || "",
        configKey: "foundation.models.toolSelector"
      },
      {
        agentName: "critic",
        displayName: "🎯 Critic/Evaluator Agent",
        description: "HH-RLHF style quality assessment and improvement suggestions",
        recommendedModels: ["deepseek-r1:latest", "codellama:7b", "llama3.2:3b"],
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.critic") || "",
        configKey: "foundation.models.critic"
      },
      {
        agentName: "taskPlanner",
        displayName: "📋 Task Planner Agent",
        description: "CAMEL-AI/AutoGPT style task decomposition and planning",
        recommendedModels: ["deepseek-r1:latest", "codellama:7b", "llama3.2:3b"],
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.taskPlanner") || "",
        configKey: "foundation.models.taskPlanner"
      },
      {
        agentName: "queryRewriter",
        displayName: "✏️ Query Rewriter Agent",
        description: "Search-optimized query expansion and enhancement",
        recommendedModels: ["qwen3:1.7b", "gemma3:1b", "deepseek-r1:1.5b"],
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.queryRewriter") || "",
        configKey: "foundation.models.queryRewriter"
      },
      {
        agentName: "cotGenerator",
        displayName: "🧠 Chain-of-Thought Generator",
        description: "Flan-CoT style reasoning generation and logical thinking",
        recommendedModels: ["deepseek-r1:latest", "codellama:7b", "llama3.2:3b"],
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.cotGenerator") || "",
        configKey: "foundation.models.cotGenerator"
      },
      {
        agentName: "chunkScorer",
        displayName: "📈 Chunk Scorer Agent",
        description: "Content relevance and quality scoring specialist",
        recommendedModels: ["gemma3:1b", "deepseek-r1:1.5b", "qwen3:1.7b"],
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.chunkScorer") || "",
        configKey: "foundation.models.chunkScorer"
      },
      {
        agentName: "actionCaller",
        displayName: "⚡ Action Caller Agent",
        description: "Function-call tuned action generation and parameter validation",
        recommendedModels: ["codellama:7b", "deepseek-r1:latest", "llama3.2:3b"],
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.actionCaller") || "",
        configKey: "foundation.models.actionCaller"
      },
      {
        agentName: "embedder",
        displayName: "🔗 Embedder Agent",
        description: "Vector operations and semantic similarity calculations",
        recommendedModels: ["nomic-embed-text:latest", "qwen3:1.7b", "gemma3:1b"],
        currentModel: vscode.workspace.getConfiguration("ollamaAgent").get<string>("foundation.models.embedder") || "",
        configKey: "foundation.models.embedder"
      }
    ];
  }

  private async _loadAvailableModels(): Promise<void> {
    try {
      const config = getConfig();
      const response = await fetch(`${config.ollamaUrl}/api/tags`);
      const data = await response.json();
      
      this._availableModels = data.models?.map((model: any) => model.name) || [];
      
      // Send models to webview
      this._panel.webview.postMessage({
        command: "modelsLoaded",
        models: this._availableModels,
        foundationAgents: this._foundationAgents
      });
      
      logger.info(`[FOUNDATION_MODELS] Loaded ${this._availableModels.length} available models`);
    } catch (error) {
      logger.error("[FOUNDATION_MODELS] Failed to load models:", error);
      this._panel.webview.postMessage({
        command: "modelsError",
        error: "Failed to load models from Ollama server"
      });
    }
  }

  private async _updateAgentModel(agentName: string, model: string): Promise<void> {
    try {
      const agent = this._foundationAgents.find(a => a.agentName === agentName);
      if (!agent) {
        logger.error(`[FOUNDATION_MODELS] Unknown agent: ${agentName}`);
        return;
      }

      const config = vscode.workspace.getConfiguration("ollamaAgent");
      await config.update(agent.configKey, model, vscode.ConfigurationTarget.Workspace);
      
      // Update local state
      agent.currentModel = model;
      
      logger.info(`[FOUNDATION_MODELS] Updated ${agent.displayName} model to: ${model}`);
      
      // Send success message
      this._panel.webview.postMessage({
        command: "modelUpdated",
        agentName: agentName,
        model: model,
        success: true
      });
    } catch (error) {
      logger.error(`[FOUNDATION_MODELS] Failed to update model for ${agentName}:`, error);
      this._panel.webview.postMessage({
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
      const config = vscode.workspace.getConfiguration("ollamaAgent");
      
      for (const agent of this._foundationAgents) {
        await config.update(agent.configKey, "", vscode.ConfigurationTarget.Workspace);
        agent.currentModel = "";
      }
      
      logger.info("[FOUNDATION_MODELS] Reset all agent models to defaults");
      
      this._panel.webview.postMessage({
        command: "defaultsReset",
        foundationAgents: this._foundationAgents
      });
    } catch (error) {
      logger.error("[FOUNDATION_MODELS] Failed to reset to defaults:", error);
    }
  }

  private async _optimizeModelAssignments(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration("ollamaAgent");
      const optimizedAssignments = this._getOptimizedModelAssignments();
      
      for (const [agentName, model] of Object.entries(optimizedAssignments)) {
        const agent = this._foundationAgents.find(a => a.agentName === agentName);
        if (agent && this._availableModels.includes(model)) {
          await config.update(agent.configKey, model, vscode.ConfigurationTarget.Workspace);
          agent.currentModel = model;
        }
      }
      
      logger.info("[FOUNDATION_MODELS] Applied optimized model assignments");
      
      this._panel.webview.postMessage({
        command: "modelsOptimized",
        foundationAgents: this._foundationAgents
      });
    } catch (error) {
      logger.error("[FOUNDATION_MODELS] Failed to optimize models:", error);
    }
  }

  private _getOptimizedModelAssignments(): Record<string, string> {
    // Smart model assignment based on task requirements and available models
    const assignments: Record<string, string> = {};
    
    // Prefer smaller, faster models for scoring and quick operations
    const quickOperationAgents = ["chunkScorer", "queryRewriter", "reranker"];
    const quickModel = this._findBestModel(["llama3.2:1b", "phi3:3.8b", "qwen2.5:1.5b"]);
    
    // Use medium models for reasoning and planning
    const reasoningAgents = ["cotGenerator", "taskPlanner", "critic"];
    const reasoningModel = this._findBestModel(["llama3.2:3b", "qwen2.5:3b", "qwen2.5:7b"]);
    
    // Use specialized models for tool operations
    const toolAgents = ["toolSelector", "actionCaller"];
    const toolModel = this._findBestModel(["llama3.2:3b", "qwen2.5:7b", "mistral:7b"]);
    
    // Use embedding models for vector operations
    const embeddingAgents = ["retriever", "embedder"];
    const embeddingModel = this._findBestModel(["nomic-embed-text", "mxbai-embed-large", "all-minilm"]);
    
    // Apply assignments
    quickOperationAgents.forEach(agent => assignments[agent] = quickModel);
    reasoningAgents.forEach(agent => assignments[agent] = reasoningModel);
    toolAgents.forEach(agent => assignments[agent] = toolModel);
    embeddingAgents.forEach(agent => assignments[agent] = embeddingModel);
    
    return assignments;
  }

  private _findBestModel(preferences: string[]): string {
    for (const model of preferences) {
      if (this._availableModels.includes(model)) {
        return model;
      }
      // Try with different tag variations
      const modelBase = model.split(':')[0];
      const availableVariant = this._availableModels.find(m => m.startsWith(modelBase));
      if (availableVariant) {
        return availableVariant;
      }
    }
    // Fallback to first available model or empty string
    return this._availableModels[0] || "";
  }

  public refresh(): void {
    this._initializeFoundationAgents();
    this._loadAvailableModels();
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Foundation Agent Models</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
            margin: 0;
        }

        .header {
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h2 {
            margin: 0 0 8px 0;
            color: var(--vscode-foreground);
            font-size: 18px;
        }

        .header-description {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
            line-height: 1.4;
        }

        .controls {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }

        .control-button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            min-height: 28px;
        }

        .control-button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .control-button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .control-button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .agent-card {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 16px;
        }

        .agent-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }

        .agent-title {
            font-weight: 600;
            font-size: 14px;
            color: var(--vscode-foreground);
            margin: 0;
        }

        .agent-description {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            line-height: 1.4;
            margin-bottom: 12px;
        }

        .model-selection {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .model-select {
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            min-height: 24px;
        }

        .model-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .recommended-models {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .recommended-models strong {
            color: var(--vscode-foreground);
        }

        .status-message {
            padding: 8px 12px;
            border-radius: 4px;
            margin-bottom: 16px;
            font-size: 12px;
        }

        .status-success {
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            color: var(--vscode-inputValidation-infoForeground);
        }

        .status-error {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-inputValidation-errorForeground);
        }

        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
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
    </style>
</head>
<body>
    <div class="header">
        <h2>🧠 Foundation Agent Models</h2>
        <div class="header-description">
            Configure specialized models for each of the 10 foundation agents. Each agent has recommended models optimized for its specific role in the pipeline.
        </div>
    </div>

    <div class="controls">
        <button class="control-button" onclick="loadModels()">🔄 Refresh Models</button>
        <button class="control-button secondary" onclick="optimizeModels()">✨ Auto-Optimize</button>
        <button class="control-button secondary" onclick="resetToDefaults()">🔧 Reset to Defaults</button>
    </div>

    <div id="statusMessage" style="display: none;"></div>
    <div id="loadingIndicator" class="loading" style="display: none;">Loading models...</div>
    <div id="agentsList"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let availableModels = [];
        let foundationAgents = [];

        // Load models on initialization
        loadModels();

        function loadModels() {
            showLoading(true);
            vscode.postMessage({ command: 'loadModels' });
        }

        function optimizeModels() {
            vscode.postMessage({ command: 'optimizeModels' });
            showStatus('Optimizing model assignments...', 'info');
        }

        function resetToDefaults() {
            vscode.postMessage({ command: 'resetToDefaults' });
            showStatus('Resetting to defaults...', 'info');
        }

        function updateAgentModel(agentName, model) {
            vscode.postMessage({
                command: 'updateAgentModel',
                agentName: agentName,
                model: model
            });
            showStatus(\`Updating \${agentName} model to \${model}...\`, 'info');
        }

        function showStatus(message, type) {
            const statusEl = document.getElementById('statusMessage');
            statusEl.textContent = message;
            statusEl.className = \`status-message status-\${type}\`;
            statusEl.style.display = 'block';
            
            if (type === 'info') {
                setTimeout(() => {
                    statusEl.style.display = 'none';
                }, 3000);
            }
        }

        function showLoading(show) {
            document.getElementById('loadingIndicator').style.display = show ? 'block' : 'none';
        }

        function renderAgents() {
            const agentsListEl = document.getElementById('agentsList');
            
            if (foundationAgents.length === 0) {
                agentsListEl.innerHTML = \`
                    <div class="empty-state">
                        <h3>No Foundation Agents</h3>
                        <p>Foundation agents are not configured. Please check your extension setup.</p>
                    </div>
                \`;
                return;
            }

            agentsListEl.innerHTML = foundationAgents.map(agent => \`
                <div class="agent-card">
                    <div class="agent-header">
                        <h3 class="agent-title">\${agent.displayName}</h3>
                    </div>
                    <div class="agent-description">\${agent.description}</div>
                    <div class="model-selection">
                        <select class="model-select" 
                                onchange="updateAgentModel('\${agent.agentName}', this.value)"
                                data-agent="\${agent.agentName}">
                            <option value="">Use Default Model</option>
                            \${availableModels.map(model => \`
                                <option value="\${model}" \${model === agent.currentModel ? 'selected' : ''}>
                                    \${model}
                                </option>
                            \`).join('')}
                        </select>
                        <div class="recommended-models">
                            <strong>Recommended:</strong> \${agent.recommendedModels.join(', ')}
                        </div>
                    </div>
                </div>
            \`).join('');
            
            showLoading(false);
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'modelsLoaded':
                    availableModels = message.models || [];
                    foundationAgents = message.foundationAgents || [];
                    renderAgents();
                    showStatus(\`Loaded \${availableModels.length} models\`, 'success');
                    break;
                    
                case 'modelsError':
                    showLoading(false);
                    showStatus(\`Error: \${message.error}\`, 'error');
                    break;
                    
                case 'modelUpdated':
                    if (message.success) {
                        showStatus(\`Updated \${message.agentName} model\`, 'success');
                        // Update the UI state
                        const agent = foundationAgents.find(a => a.agentName === message.agentName);
                        if (agent) {
                            agent.currentModel = message.model;
                        }
                    } else {
                        showStatus(\`Failed to update model: \${message.error}\`, 'error');
                    }
                    break;
                    
                case 'defaultsReset':
                    foundationAgents = message.foundationAgents;
                    renderAgents();
                    showStatus('Reset all models to defaults', 'success');
                    break;
                    
                case 'modelsOptimized':
                    foundationAgents = message.foundationAgents;
                    renderAgents();
                    showStatus('Applied optimized model assignments', 'success');
                    break;
            }
        });
    </script>
</body>
</html>`;
  }
}