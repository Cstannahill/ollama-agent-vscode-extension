import * as vscode from "vscode";
import { ChatPanel } from "./ChatPanel";
import { BasicAgent } from "../agents/BasicAgent";
import { AgentFactory } from "../agents/AgentFactory";
import { AgentCoordinator } from "../agents/AgentCoordinator";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "ollama-agent-chat";

  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _agent?: BasicAgent;
  private _agentFactory?: AgentFactory;
  private _agentCoordinator?: AgentCoordinator;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  public setAgent(agent: BasicAgent) {
    this._agent = agent;
  }

  public setAgentFactory(factory: AgentFactory) {
    this._agentFactory = factory;
  }

  public setAgentCoordinator(coordinator: AgentCoordinator) {
    this._agentCoordinator = coordinator;
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

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "openChat": {
          if (this._agent) {
            ChatPanel.createOrShow(this._extensionUri, this._agent, this._agentFactory, this._agentCoordinator);
          } else {
            vscode.window.showErrorMessage("Agent not initialized");
          }
          break;
        }
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ollama Agent</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sidebar-background);
            margin: 0;
            padding: 16px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 20px;
        }
        
        .title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .description {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 20px;
        }
        
        .chat-button {
            width: 100%;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            padding: 12px 16px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 12px;
        }
        
        .chat-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .features {
            margin-top: 20px;
        }
        
        .feature {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
            font-size: 13px;
        }
        
        .feature-icon {
            margin-right: 8px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">>� Ollama Agent</div>
        <div class="description">Your AI coding assistant</div>
    </div>
    
    <button class="chat-button" onclick="openChat()">
        =� Open Chat Window
    </button>
    
    <div class="features">
        <div class="feature">
            <span class="feature-icon">='</span>
            Tool-powered assistance
        </div>
        <div class="feature">
            <span class="feature-icon">=�</span>
            File operations
        </div>
        <div class="feature">
            <span class="feature-icon">=�</span>
            Command execution
        </div>
        <div class="feature">
            <span class="feature-icon">=�</span>
            Code analysis
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function openChat() {
            vscode.postMessage({
                type: 'openChat'
            });
        }
    </script>
</body>
</html>`;
  }
}