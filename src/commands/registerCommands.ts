import * as vscode from "vscode";
import { BasicAgent } from "../agents/BasicAgent";
import { AgentFactory } from "../agents/AgentFactory";
import { AgentCoordinator } from "../agents/AgentCoordinator";
import { getToolManager } from "../core/ToolManager";
import { ContextManager } from "../core/ContextManager";
import { ChatSession } from "../core/ChatSession";
import { QuantizedModelManager } from "../core/QuantizedModelManager";
import { getConfig, CONSTANTS } from "../config";
import { logger } from "../utils/logger";
import { ChatPanel } from "../views/ChatPanel";
import { SettingsPanel } from "../views/SettingsPanel";
import { DocumentationPanel } from "../views/DocumentationPanel";
import { ProjectDashboard } from "../views/ProjectDashboard";
import { ContextVisualizationPanel } from "../views/ContextVisualizationPanel";
import { ProjectContextPanel } from "../views/ProjectContextPanel";
import { ProjectContextManager } from "../context/ProjectContextManager";
import { FoundationModelsPanel } from "../views/FoundationModelsPanel";
import { FoundationModelsSidebarProvider } from "../views/FoundationModelsSidebarProvider";
import { LMDeployServerManager } from "../services/LMDeployServerManager";

let globalAgent: BasicAgent | null = null;
let globalAgentFactory: AgentFactory | null = null;
let globalAgentCoordinator: AgentCoordinator | null = null;
let globalContextManager: ContextManager | null = null;
let globalSidebarProvider: any = null;
let globalProjectContextManager: ProjectContextManager | null = null;
let currentChatSession: ChatSession | null = null;
let isInitializing = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Set the global context manager instance
 */
export function setContextManager(contextManager: ContextManager): void {
  globalContextManager = contextManager;
  logger.info("Global context manager set");
}

/**
 * Set the global sidebar provider instance
 */
export function setSidebarProvider(sidebarProvider: any): void {
  globalSidebarProvider = sidebarProvider;
  logger.info("Global sidebar provider set");
}

/**
 * Register all extension commands
 */
export function registerCommands(context: vscode.ExtensionContext): void {
  // Start agent initialization
  initializationPromise = initializeAgent();

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CONSTANTS.COMMANDS.RUN_AGENT,
      runAgentOnCurrentFile
    ),
    vscode.commands.registerCommand(CONSTANTS.COMMANDS.OPEN_CHAT, () =>
      openAgentChat(context)
    ),
    vscode.commands.registerCommand(CONSTANTS.COMMANDS.CLEAR_CHAT, clearChat),
    vscode.commands.registerCommand(
      CONSTANTS.COMMANDS.SHOW_CONFIG,
      showConfiguration
    ),
    vscode.commands.registerCommand(CONSTANTS.COMMANDS.OPEN_SETTINGS, () =>
      openSettings(context)
    ),
    vscode.commands.registerCommand(CONSTANTS.COMMANDS.OPEN_DOCUMENTATION, () =>
      openDocumentation(context)
    ),
    vscode.commands.registerCommand(CONSTANTS.COMMANDS.OPEN_PROJECT_DASHBOARD, () =>
      openProjectDashboard(context)
    ),
    vscode.commands.registerCommand(CONSTANTS.COMMANDS.OPEN_CONTEXT_VISUALIZATION, () =>
      openContextVisualization(context)
    ),
    vscode.commands.registerCommand(CONSTANTS.COMMANDS.OPEN_PROJECT_CONTEXT, () =>
      openProjectContext(context)
    ),
    vscode.commands.registerCommand(CONSTANTS.COMMANDS.OPEN_FOUNDATION_MODELS, () =>
      openFoundationModels(context)
    ),
    vscode.commands.registerCommand("ollamaAgent.analyzeWorkspace", analyzeWorkspace),
    // Debug commands for foundation models
    vscode.commands.registerCommand("ollamaAgent.debugFoundationModels", async () => {
      try {
        const config = getConfig();
        const foundationModels = config.foundation?.models || {};
        
        const message = `Foundation Models Configuration:
${JSON.stringify(foundationModels, null, 2)}

Cache Status:
- Factory initialized: ${globalAgentFactory ? 'Yes' : 'No'}

To clear caches and force reinitialization, run the "Clear Foundation Caches" command.`;
        
        vscode.window.showInformationMessage("Foundation Models Debug", { modal: true, detail: message });
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to debug foundation models: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    vscode.commands.registerCommand("ollamaAgent.clearFoundationCaches", async () => {
      try {
        // Import FoundationBasicAgent here to avoid circular dependencies
        const { FoundationBasicAgent } = await import('../agents/FoundationBasicAgent');
        FoundationBasicAgent.clearFoundationCaches();
        vscode.window.showInformationMessage("Foundation system caches cleared. Next agent execution will use updated models.");
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to clear caches: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    // LMDeploy server management commands
    vscode.commands.registerCommand("ollamaAgent.lmdeployStatus", () => {
      try {
        const lmdeployManager = LMDeployServerManager.getInstance(context.extensionPath);
        lmdeployManager.showServerStatus();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to access LMDeploy server: ${error}`);
      }
    }),
    vscode.commands.registerCommand("ollamaAgent.lmdeployStart", async () => {
      try {
        const lmdeployManager = LMDeployServerManager.getInstance(context.extensionPath);
        await lmdeployManager.startServer();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to start LMDeploy server: ${error}`);
      }
    }),
    vscode.commands.registerCommand("ollamaAgent.lmdeployStop", async () => {
      try {
        const lmdeployManager = LMDeployServerManager.getInstance(context.extensionPath);
        await lmdeployManager.stopServer();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to stop LMDeploy server: ${error}`);
      }
    }),
    vscode.commands.registerCommand("ollamaAgent.lmdeployRestart", async () => {
      try {
        const lmdeployManager = LMDeployServerManager.getInstance(context.extensionPath);
        await lmdeployManager.restartServer();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to restart LMDeploy server: ${error}`);
      }
    })
  );

  logger.info("Extension commands registered successfully");
}

/**
 * Initialize the agent with current configuration
 */
async function initializeAgent(): Promise<void> {
  if (isInitializing) {
    return initializationPromise!;
  }

  isInitializing = true;

  try {
    logger.info("Starting agent initialization...");
    const config = getConfig();
    const toolManager = getToolManager();

    // Initialize context manager if not already done
    if (globalContextManager) {
      await globalContextManager.initialize();
      logger.info("Context manager initialized");
    }

    // Get performance configuration
    const perfConfig = vscode.workspace.getConfiguration("ollamaAgent.performance");
    const modelConfig = vscode.workspace.getConfiguration("ollamaAgent.model");
    const quantizedManager = QuantizedModelManager.getInstance();
    
    // Apply quantization if enabled
    const optimizedModel = await quantizedManager.applyQuantization(config.model);

    const agentConfig = {
      ollamaUrl: config.ollamaUrl,
      model: optimizedModel,
      temperature: config.temperature,
      maxIterations: config.maxIterations,
      verbose: config.verbose,
      enableOptimizedExecution: perfConfig.get<boolean>("enableOptimizedExecution") ?? true,
      maxConcurrency: perfConfig.get<number>("maxConcurrency") ?? 3,
      enableParallelExecution: perfConfig.get<boolean>("enableParallelExecution") ?? true,
      enableResponseStreaming: perfConfig.get<boolean>("enableResponseStreaming") ?? true,
      quantizedModel: modelConfig.get<boolean>("quantized") ?? false,
    };

    // Initialize the AgentFactory with all specialized agents
    globalAgentFactory = new AgentFactory(
      agentConfig,
      toolManager,
      globalContextManager || undefined,
      undefined, // factoryConfig
      config // Pass full ExtensionConfig for vLLM support
    );

    // Initialize the AgentCoordinator for multi-agent workflows
    globalAgentCoordinator = new AgentCoordinator(
      globalAgentFactory,
      agentConfig,
      {
        enableParallelExecution: perfConfig.get<boolean>("enableParallelExecution") ?? true,
        maxConcurrency: perfConfig.get<number>("maxConcurrency") ?? 3,
      }
    );

    // Keep the BasicAgent for backward compatibility
    globalAgent = new BasicAgent(
      agentConfig,
      toolManager,
      globalContextManager || undefined
    );

    await globalAgent.initialize();
    
    // Update sidebar provider with agent components
    if (globalSidebarProvider) {
      globalSidebarProvider.setAgent(globalAgent);
      globalSidebarProvider.setAgentFactory(globalAgentFactory);
      globalSidebarProvider.setAgentCoordinator(globalAgentCoordinator);
      logger.info("Sidebar provider updated with agent components");
    }
    
    logger.info("Agent system initialized successfully (BasicAgent + Factory + Coordinator)");
  } catch (error) {
    logger.error("Failed to initialize agent:", error);
    globalAgent = null;
    vscode.window.showErrorMessage(
      "Failed to initialize Ollama Agent. Please check your configuration."
    );
    throw error;
  } finally {
    isInitializing = false;
  }
}

/**
 * Ensure agent is initialized before use
 */
async function ensureAgentInitialized(): Promise<BasicAgent> {
  if (initializationPromise) {
    await initializationPromise;
  }

  if (!globalAgent) {
    // Try to initialize if not already done
    await initializeAgent();
  }

  if (!globalAgent) {
    throw new Error("Agent could not be initialized");
  }

  return globalAgent;
}

/**
 * Run agent on the currently active file
 */
async function runAgentOnCurrentFile(): Promise<void> {
  let agent: BasicAgent;
  try {
    agent = await ensureAgentInitialized();
  } catch (error) {
    vscode.window.showErrorMessage("Agent not initialized: " + error);
    return;
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    vscode.window.showWarningMessage("No active file to work with");
    return;
  }

  try {
    // Check if Ollama is available
    const isAvailable = await agent.isOllamaAvailable();
    if (!isAvailable) {
      vscode.window
        .showErrorMessage(
          "Ollama server is not available. Please make sure Ollama is running.",
          "Open Settings"
        )
        .then((selection) => {
          if (selection === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "ollamaAgent"
            );
          }
        });
      return;
    }

    // Check if the configured model is available
    const isModelAvailable = await agent.isModelAvailable();
    if (!isModelAvailable) {
      const config = getConfig();
      const availableModels = await agent.getAvailableModels().catch(() => []);
      const modelList =
        availableModels.length > 0 ? availableModels.join(", ") : "none";

      vscode.window
        .showErrorMessage(
          `Model '${config.model}' is not available. Available models: ${modelList}`,
          "Pull Model",
          "Open Settings"
        )
        .then((selection) => {
          if (selection === "Pull Model") {
            vscode.window.showInformationMessage(
              `Run this command in terminal: ollama pull ${config.model}`
            );
          } else if (selection === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "ollamaAgent.model"
            );
          }
        });
      return;
    }

    const document = activeEditor.document;
    const fileName = document.fileName;
    const fileContent = document.getText();

    // Get user input for what to do with the file
    const task = await vscode.window.showInputBox({
      prompt: "What would you like the agent to do with this file?",
      placeHolder:
        'e.g., "Add comments to this code", "Fix syntax errors", "Refactor this function"',
      value: "",
    });

    if (!task) {
      return; // User cancelled
    }

    // Show progress
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Ollama Agent is working...",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Analyzing file and planning actions..." });

        // Create a new chat session for this task
        const session = new ChatSession();
        currentChatSession = session;

        // Build context-aware task
        const contextualTask = `${task}

Current file: ${fileName}
File content:
\`\`\`
${fileContent}
\`\`\``;

        progress.report({ message: "Executing agent tasks..." });

        // Execute the task
        const response = await agent.executeTask(contextualTask, session);
        progress.report({ message: "Task completed" });

        // Show results
        if (response.success) {
          const actions = response.actions.length;
          vscode.window
            .showInformationMessage(
              `Agent task completed successfully! ${actions} actions taken.`,
              "Show Details",
              "Show Chat"
            )
            .then((selection) => {
              if (selection === "Show Details") {
                showTaskResults(response);
              } else if (selection === "Show Chat") {
                openAgentChat();
              }
            });
        } else {
          vscode.window
            .showErrorMessage(
              `Agent task failed: ${response.error}`,
              "Show Details"
            )
            .then((selection) => {
              if (selection === "Show Details") {
                showTaskResults(response);
              }
            });
        }
      }
    );
  } catch (error) {
    logger.error("Failed to run agent on current file:", error);
    vscode.window.showErrorMessage(`Agent execution failed: ${error}`);
  }
}

/**
 * Open the agent chat interface
 */
async function openAgentChat(context?: vscode.ExtensionContext): Promise<void> {
  let agent: BasicAgent;
  try {
    agent = await ensureAgentInitialized();
  } catch (error) {
    vscode.window.showErrorMessage("Agent not initialized: " + error);
    return;
  }

  try {
    // Check if Ollama is available before opening chat
    const isAvailable = await agent.isOllamaAvailable();
    if (!isAvailable) {
      vscode.window
        .showErrorMessage(
          "Ollama server is not available. Please make sure Ollama is running.",
          "Open Settings"
        )
        .then((selection) => {
          if (selection === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "ollamaAgent"
            );
          }
        });
      return;
    }

    // Check if the configured model is available
    const isModelAvailable = await agent.isModelAvailable();
    if (!isModelAvailable) {
      const config = getConfig();
      const availableModels = await agent.getAvailableModels().catch(() => []);
      const modelList =
        availableModels.length > 0 ? availableModels.join(", ") : "none";

      vscode.window
        .showErrorMessage(
          `Model '${config.model}' is not available. Available models: ${modelList}`,
          "Pull Model",
          "Open Settings"
        )
        .then((selection) => {
          if (selection === "Pull Model") {
            vscode.window.showInformationMessage(
              `Run this command in terminal: ollama pull ${config.model}`
            );
          } else if (selection === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "ollamaAgent.model"
            );
          }
        });
      return;
    }

    // Create or show the chat panel
    const extensionUri =
      context?.extensionUri ||
      vscode.extensions.getExtension("ollama-agent-vscode")?.extensionUri;
    if (!extensionUri) {
      logger.error("Could not determine extension URI");
      vscode.window.showErrorMessage(
        "Failed to open chat: Extension URI not found"
      );
      return;
    }

    ChatPanel.createOrShow(extensionUri, agent, globalAgentFactory || undefined, globalAgentCoordinator || undefined);
    logger.info("Chat panel opened successfully");
  } catch (error) {
    logger.error("Chat failed:", error);
    vscode.window.showErrorMessage(`Chat failed: ${error}`);
  }
}

/**
 * Clear the current chat session
 */
function clearChat(): void {
  currentChatSession = null;

  // If there's an active chat panel, clear it
  if (ChatPanel.currentPanel) {
    // The panel will handle its own clearing via the clearChat message
    ChatPanel.currentPanel.dispose();
  }

  vscode.window.showInformationMessage("Chat session cleared");
  logger.info("Chat session cleared");
}

/**
 * Show configuration settings
 */
function showConfiguration(): void {
  vscode.commands.executeCommand(
    "workbench.action.openSettings",
    "ollamaAgent"
  );
}

/**
 * Show detailed task results
 */
function showTaskResults(response: any): void {
  const panel = vscode.window.createWebviewPanel(
    "agentResults",
    "Agent Task Results",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = generateResultsHTML(response);
}

/**
 * Generate HTML for results display
 */
function generateResultsHTML(response: any): string {
  const actionsHtml = response.actions
    .map(
      (action: any, index: number) => `
    <div class="action">
      <h3>Action ${index + 1}</h3>
      <p><strong>Thought:</strong> ${action.thought}</p>
      ${
        action.toolCall
          ? `
        <p><strong>Tool:</strong> ${action.toolCall.toolName}</p>
        <p><strong>Input:</strong></p>
        <pre>${JSON.stringify(action.toolCall.input, null, 2)}</pre>
        ${
          action.toolCall.output
            ? `
          <p><strong>Result:</strong></p>
          <pre>${action.toolCall.output}</pre>
        `
            : ""
        }
        ${
          action.toolCall.error
            ? `
          <p><strong>Error:</strong></p>
          <pre class="error">${action.toolCall.error}</pre>
        `
            : ""
        }
      `
          : ""
      }
    </div>
  `
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Agent Results</title>
        <style>
            body { font-family: var(--vscode-font-family); padding: 20px; }
            .action { border: 1px solid var(--vscode-panel-border); margin: 10px 0; padding: 15px; border-radius: 5px; }
            pre { background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 3px; overflow-x: auto; }
            .error { color: var(--vscode-errorForeground); }
            h2 { color: var(--vscode-foreground); }
            h3 { color: var(--vscode-textLink-foreground); }
        </style>
    </head>
    <body>
        <h2>Agent Task Results</h2>
        <p><strong>Status:</strong> ${
          response.success ? "✅ Success" : "❌ Failed"
        }</p>
        <p><strong>Content:</strong></p>
        <pre>${response.content}</pre>
        
        <h2>Actions Taken (${response.actions.length})</h2>
        ${actionsHtml}
    </body>
    </html>
  `;
}

/**
 * Reinitialize agent when configuration changes
 */
export function reinitializeAgent(): void {
  logger.info("Reinitializing agent due to configuration change");

  // Reset global state
  globalAgent = null;
  isInitializing = false;

  // Start new initialization
  initializationPromise = initializeAgent();
  initializationPromise.catch((error) => {
    logger.error("Failed to reinitialize agent:", error);
  });
}

/**
 * Open the settings panel
 */
async function openSettings(context: vscode.ExtensionContext): Promise<void> {
  try {
    SettingsPanel.createOrShow(context.extensionUri);
    logger.info("Settings panel opened successfully");
  } catch (error) {
    logger.error("Failed to open settings panel:", error);
    vscode.window.showErrorMessage(`Failed to open settings: ${error}`);
  }
}

/**
 * Open the documentation panel
 */
async function openDocumentation(context: vscode.ExtensionContext): Promise<void> {
  try {
    DocumentationPanel.createOrShow(context.extensionUri);
    logger.info("Documentation panel opened successfully");
  } catch (error) {
    logger.error("Failed to open documentation panel:", error);
    vscode.window.showErrorMessage(`Failed to open documentation: ${error}`);
  }
}

/**
 * Open the project dashboard panel
 */
async function openProjectDashboard(context: vscode.ExtensionContext): Promise<void> {
  try {
    ProjectDashboard.createOrShow(context.extensionUri);
    logger.info("Project dashboard opened successfully");
  } catch (error) {
    logger.error("Failed to open project dashboard:", error);
    vscode.window.showErrorMessage(`Failed to open project dashboard: ${error}`);
  }
}

/**
 * Open the context visualization panel
 */
async function openContextVisualization(context: vscode.ExtensionContext): Promise<void> {
  try {
    ContextVisualizationPanel.createOrShow(context.extensionUri);
    logger.info("Context visualization opened successfully");
  } catch (error) {
    logger.error("Failed to open context visualization:", error);
    vscode.window.showErrorMessage(`Failed to open context visualization: ${error}`);
  }
}

/**
 * Analyze current workspace with context system
 */
async function analyzeWorkspace(): Promise<void> {
  try {
    if (!globalContextManager) {
      vscode.window.showErrorMessage("Context manager not initialized");
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showWarningMessage("No workspace folder is open");
      return;
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;
    const projectId = `project_${Date.now()}`;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Analyzing workspace with context system...",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Initializing context system..." });
        await globalContextManager!.initialize();

        progress.report({ message: "Indexing project files..." });
        const projectContext = globalContextManager!.getProjectContext();
        await projectContext.indexCurrentProject();

        progress.report({ message: "Getting context statistics..." });
        const stats = await globalContextManager!.getStats();
        
        vscode.window.showInformationMessage(
          `Workspace analysis complete! Database: ${stats.database.totalItems || 0} items, ` +
          `Project: ${stats.project.totalFiles || 0} files, ` +
          `Context system ready.`
        );
      }
    );
  } catch (error) {
    logger.error("Failed to analyze workspace:", error);
    vscode.window.showErrorMessage(`Workspace analysis failed: ${error}`);
  }
}

/**
 * Execute task using intelligent agent selection
 */
async function executeWithAgentFactory(task: string, context?: any): Promise<void> {
  if (!globalAgentFactory) {
    vscode.window.showErrorMessage("Agent system not initialized");
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Analyzing task and selecting best agent...",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Selecting specialized agent..." });
        
        const { agent, analysis } = await globalAgentFactory!.selectBestAgent(task, context);
        
        progress.report({ 
          message: `Using ${agent.getSpecialization()} agent (${Math.round(analysis.confidence * 100)}% confidence)` 
        });

        const result = await agent.executeTask(task, undefined, {
          onThought: (thought) => progress.report({ message: `Thinking: ${thought.substring(0, 50)}...` }),
          onAction: (action, input) => progress.report({ message: `Executing: ${action}` }),
          onActionResult: (output, error) => {
            if (error) {
              progress.report({ message: `Error: ${error.substring(0, 50)}...` });
            } else {
              progress.report({ message: `Completed action` });
            }
          }
        });

        if (result.success) {
          vscode.window.showInformationMessage(
            `Task completed by ${agent.getSpecialization()} agent: ${result.content.substring(0, 100)}...`
          );
        } else {
          vscode.window.showErrorMessage(`Task failed: ${result.error}`);
        }
      }
    );
  } catch (error) {
    logger.error("Agent factory execution failed:", error);
    vscode.window.showErrorMessage(`Task execution failed: ${error}`);
  }
}

/**
 * Execute complex task using agent coordinator
 */
async function executeWithAgentCoordinator(complexTask: string, context?: any): Promise<void> {
  if (!globalAgentCoordinator) {
    vscode.window.showErrorMessage("Agent coordinator not initialized");
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Orchestrating multi-agent workflow...",
        cancellable: false,
      },
      async (progress) => {
        const result = await globalAgentCoordinator!.orchestrateTask(complexTask, context, {
          onThought: (thought) => progress.report({ message: thought.substring(0, 60) }),
          onAction: (action, input) => progress.report({ message: `${action}: ${JSON.stringify(input).substring(0, 40)}...` }),
          onComplete: (response) => {
            progress.report({ message: "Workflow completed" });
          }
        });

        if (result.success) {
          const agentsUsed = result.metadata?.agentsUsed || [];
          vscode.window.showInformationMessage(
            `Multi-agent workflow completed using: ${agentsUsed.join(", ")}`
          );
        } else {
          vscode.window.showErrorMessage(`Workflow failed: ${result.error}`);
        }
      }
    );
  } catch (error) {
    logger.error("Agent coordinator execution failed:", error);
    vscode.window.showErrorMessage(`Workflow execution failed: ${error}`);
  }
}

/**
 * Get factory and coordinator for external access
 */
export function getAgentFactory(): AgentFactory | null {
  return globalAgentFactory;
}

export function getAgentCoordinator(): AgentCoordinator | null {
  return globalAgentCoordinator;
}

/**
 * Open the foundation models panel
 */
async function openFoundationModels(context: vscode.ExtensionContext): Promise<void> {
  try {
    FoundationModelsPanel.createOrShow(context.extensionUri);
    logger.info("Foundation models panel opened successfully");
  } catch (error) {
    logger.error("Failed to open foundation models panel:", error);
    vscode.window.showErrorMessage(`Failed to open foundation models: ${error}`);
  }
}

/**
 * Open the project context panel
 */
async function openProjectContext(context: vscode.ExtensionContext): Promise<void> {
  try {
    // Initialize project context manager if not already done
    if (!globalProjectContextManager) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage("No workspace folder is open");
        return;
      }

      const config = getConfig();
      const workspacePath = workspaceFolders[0].uri.fsPath;
      
      globalProjectContextManager = ProjectContextManager.getInstance({
        workspacePath,
        maxFileSize: 1024 * 1024, // 1MB
        excludePatterns: [
          // Version control
          '**/.git/**',
          '**/.svn/**',
          '**/.hg/**',
          
          // Node.js
          '**/node_modules/**',
          
          // Python virtual environments
          '**/venv/**',
          '**/env/**',
          '**/.venv/**',
          '**/__pycache__/**',
          '**/site-packages/**',
          
          // Build outputs
          '**/build/**',
          '**/dist/**',
          '**/out/**',
          '**/target/**',
          
          // Rust specific
          '**/target/**',
          '**/Cargo.lock',
          '**/*.pdb',
          '**/*.exe',
          '**/*.dll',
          
          // Framework specific
          '**/.next/**',
          '.next/**',
          '**/.nuxt/**',
          
          // Package managers
          '**/vendor/**',
          '**/Pods/**',
          
          // Caches
          '**/.cache/**',
          '**/coverage/**',
          '**/logs/**',
          '**/.tmp/**',
          '**/temp/**',
          
          // IDE and system files  
          '**/.gradle/**',
          '**/gradle/**',
          '**/cmake-build-*/**',
          '**/DerivedData/**',
          '**/.dart_tool/**',
          '**/packages/**',
          '**/.pub-cache/**',
          '**/bin/**',
          '**/obj/**',
          
          // Log files
          '**/*.log',
          
          // Hidden files (but allow important config files)
          '**/.*',
          '!**/.env.example',
          '!**/.gitignore',
          '!**/.eslintrc*',
          '!**/.prettierrc*'
        ],
        includePatterns: ['**/*.ts', '**/*.js', '**/*.json', '**/*.md', '**/*.css', '**/*.html'],
        maxConcurrency: 3,
        ollamaUrl: config.ollamaUrl,
        model: config.model,
        chromaCollections: {
          files: 'project_files',
          dependencies: 'project_dependencies',
          features: 'project_features',
          overview: 'project_overview'
        }
      });

      await globalProjectContextManager.initialize();
    }

    ProjectContextPanel.createOrShow(context.extensionUri, globalProjectContextManager);
    logger.info("Project context panel opened successfully");
  } catch (error) {
    logger.error("Failed to open project context panel:", error);
    vscode.window.showErrorMessage(`Failed to open project context: ${error}`);
  }
}
