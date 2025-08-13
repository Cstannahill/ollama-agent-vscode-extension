import * as vscode from "vscode";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  registerCommands,
  reinitializeAgent,
  setContextManager,
  setSidebarProvider,
} from "./commands/registerCommands";

// Load environment variables early in extension activation
try {
  const envPath = path.resolve(__dirname, '../.env');
  console.log('[EXTENSION] Attempting to load .env from:', envPath);
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error('[EXTENSION] dotenv config error:', result.error);
  } else {
    console.log('[EXTENSION] dotenv config successful, parsed:', Object.keys(result.parsed || {}));
  }
  
  console.log('[EXTENSION] Current working directory:', process.cwd());
  console.log('[EXTENSION] Extension __dirname:', __dirname);
  console.log('[EXTENSION] Resolved env path:', envPath);
  
  // Check if .env file exists
  const fs = require('fs');
  try {
    fs.accessSync(envPath, fs.constants.F_OK);
    console.log('[EXTENSION] .env file exists at:', envPath);
  } catch (fsError) {
    console.error('[EXTENSION] .env file does not exist at:', envPath);
  }
  
  console.log('[EXTENSION] Cloud ChromaDB env vars:', {
    hasApiKey: !!process.env.CHROMA_API_KEY,
    hasTenant: !!process.env.CHROMA_TENANT,
    hasDatabase: !!process.env.CHROMA_DATABASE,
    apiKeyValue: process.env.CHROMA_API_KEY ? process.env.CHROMA_API_KEY.substring(0, 10) + '...' : 'NOT SET',
    tenantValue: process.env.CHROMA_TENANT || 'NOT SET',
    databaseValue: process.env.CHROMA_DATABASE || 'NOT SET'
  });
} catch (error) {
  console.warn('[EXTENSION] Failed to load .env file:', error);
}
import { getToolManager } from "./core/ToolManager";
import { ContextManager } from "./core/ContextManager";
import { logger } from "./utils/logger";
import { CONSTANTS } from "./config";
import { SidebarProvider } from "./views/SidebarProvider";
import { FoundationModelsSidebarProvider } from "./views/FoundationModelsSidebarProvider";
import { extensionContextProvider } from "./utils/ExtensionContextProvider";
import { FoundationAgentFactory } from "./core/foundation/FoundationAgentFactory";
import { OptimizedFoundationAgentFactory } from "./core/foundation/OptimizedFoundationAgentFactory";
import { AgentPreloader } from "./core/foundation/AgentPreloader";
import { getConfig } from "./config";
import { CacheManager } from "./core/cache/CacheManager";
import { CacheWarmer } from "./core/cache/CacheWarmer";
import { CacheHealthMonitor } from "./core/cache/CacheHealthMonitor";
import { LMDeployServerManager } from "./services/LMDeployServerManager";

/**
 * Extension activation function
 */
export function activate(context: vscode.ExtensionContext) {
  logger.info("Ollama Agent extension is activating...");

  try {
    // Set the extension context for global access
    extensionContextProvider.setContext(context);

    // Initialize the tool manager (this sets up all the LangChain tools)
    const toolManager = getToolManager();
    logger.info(
      `Tool manager initialized with ${toolManager.getToolNames().length} tools`
    );

    // Initialize the context manager
    const contextManager = ContextManager.getInstance(context);
    logger.info("Context manager initialized");

    // Initialize cache management system with health monitoring
    const cacheManager = CacheManager.getInstance();
    const cacheWarmer = CacheWarmer.getInstance();
    const cacheHealthMonitor = CacheHealthMonitor.getInstance();
    logger.info("Cache management system initialized with health monitoring");

    // Initialize LMDeploy server manager and start auto-startup
    const lmdeployServerManager = LMDeployServerManager.getInstance(context.extensionPath);
    context.subscriptions.push({
      dispose: () => lmdeployServerManager.dispose()
    });
    
    // Auto-startup disabled - server must be started manually
    logger.info("[EXTENSION] LMDeploy auto-startup disabled. Use Command Palette 'Start LMDeploy Server' to start manually.");

    // Initialize context manager first, then perform health check
    setTimeout(async () => {
      try {
        // Ensure context manager is fully initialized
        await contextManager.initialize();

        const healthCheck = await contextManager.getContextDB().healthCheck();
        logger.info(
          `[EXTENSION] Context DB Health: ${
            healthCheck.isHealthy ? "Healthy" : "Degraded"
          } (${healthCheck.itemCount} items)`
        );
        if (healthCheck.error) {
          logger.warn(`[EXTENSION] Context DB Error: ${healthCheck.error}`);
        }

        // Start cache warming after context initialization
        await cacheWarmer.warmupAll(toolManager, {
          enableToolCache: true,
          enableAgentCache: true,
          enableEmbeddingCache: true,
          maxWarmupTimeMs: 3000
        });

        // Start cache maintenance schedule
        cacheWarmer.startMaintenanceSchedule();

      } catch (error) {
        logger.warn(
          "[EXTENSION] Failed to perform context health check:",
          error
        );
      }
    }, 3000); // Longer delay to allow full initialization

    // Register all commands
    registerCommands(context);

    // Set the context manager for agent initialization
    setContextManager(contextManager);

    // Register sidebar provider
    const sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        SidebarProvider.viewType,
        sidebarProvider
      )
    );

    // Register Foundation Models sidebar provider
    const foundationModelsSidebarProvider = new FoundationModelsSidebarProvider(
      context.extensionUri
    );
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        FoundationModelsSidebarProvider.viewType,
        foundationModelsSidebarProvider
      )
    );

    // Set the sidebar provider for agent initialization
    setSidebarProvider(sidebarProvider);

    // Listen for configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration("ollamaAgent")) {
          logger.info("Configuration changed, reinitializing agent");
          logger.updateLogLevel();
          reinitializeAgent();
          
          // Handle LMDeploy server configuration changes (auto-restart disabled)
          if (event.affectsConfiguration("ollamaAgent.lmdeploy")) {
            logger.info("LMDeploy configuration changed. Auto-restart disabled - please restart server manually if needed.");
          }
        }
      })
    );

    // Register status bar item
    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    statusBarItem.text = "$(robot) Ollama Agent";
    statusBarItem.tooltip = "Click to open Ollama Agent chat";
    statusBarItem.command = CONSTANTS.COMMANDS.OPEN_CHAT;
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Show welcome message on first activation
    const isFirstActivation = context.globalState.get(
      "ollamaAgent.firstActivation",
      true
    );
    if (isFirstActivation) {
      showWelcomeMessage();
      context.globalState.update("ollamaAgent.firstActivation", false);
    }

    // Start background initialization of foundation agents for better UX
    startBackgroundFoundationInitialization(context);

    logger.info("Ollama Agent extension activated successfully");
  } catch (error) {
    logger.error("Failed to activate extension:", error);
    vscode.window.showErrorMessage(`Failed to activate Ollama Agent: ${error}`);
  }
}

/**
 * Extension deactivation function
 */
export function deactivate() {
  logger.info("Ollama Agent extension is deactivating...");
  
  try {
    // Cleanup cache management system
    const cacheManager = CacheManager.getInstance();
    const cacheWarmer = CacheWarmer.getInstance();
    const cacheHealthMonitor = CacheHealthMonitor.getInstance();
    
    // Stop health monitoring first
    cacheHealthMonitor.stopMonitoring();
    
    // Stop maintenance schedule and cleanup caches
    cacheWarmer.performMaintenance();
    cacheManager.destroyAll();
    logger.info("Cache management system cleaned up successfully");
  } catch (error) {
    logger.warn("Failed to cleanup cache management system:", error);
  }

  try {
    const contextManager =
      require("./core/ContextManager").ContextManager.getInstance();
    if (contextManager && typeof contextManager.getContextDB === "function") {
      contextManager.getContextDB().close();
      logger.info("ContextDB closed successfully on shutdown.");
    }
  } catch (error) {
    logger.warn("Failed to close ContextDB on shutdown:", error);
  }

  try {
    // Cleanup tool manager caches
    const toolManager = require("./core/ToolManager").getToolManager();
    if (toolManager && typeof toolManager.destroy === "function") {
      toolManager.destroy();
      logger.info("ToolManager cleaned up successfully");
    }
  } catch (error) {
    logger.warn("Failed to cleanup ToolManager:", error);
  }

  logger.info("Ollama Agent extension deactivated successfully");
}

/**
 * Show welcome message to new users
 */
function showWelcomeMessage(): void {
  vscode.window
    .showInformationMessage(
      "Welcome to Ollama Agent! An intelligent coding assistant powered by local LLMs.",
      "Open Chat",
      "Open Settings",
      "Configure",
      "Learn More"
    )
    .then((selection) => {
      switch (selection) {
        case "Open Chat":
          vscode.commands.executeCommand(CONSTANTS.COMMANDS.OPEN_CHAT);
          break;
        case "Open Settings":
          vscode.commands.executeCommand(CONSTANTS.COMMANDS.OPEN_SETTINGS);
          break;
        case "Configure":
          vscode.commands.executeCommand(CONSTANTS.COMMANDS.SHOW_CONFIG);
          break;
        case "Learn More":
          vscode.env.openExternal(
            vscode.Uri.parse("https://github.com/ollama/ollama")
          );
          break;
      }
    });
}

/**
 * Start optimized background initialization of foundation agents for dramatically improved UX
 */
function startBackgroundFoundationInitialization(
  context: vscode.ExtensionContext
) {
  const config = getConfig();

  // Check if background initialization is enabled
  const initStrategy = config.initialization?.strategy || "background";
  if (initStrategy === "lazy") {
    logger.info(
      "[EXTENSION] Background initialization disabled, using lazy initialization"
    );
    return;
  }

  const delay = config.initialization?.backgroundDelay || 1000; // Reduced delay for faster startup

  setTimeout(async () => {
    try {
      logger.info(
        "[EXTENSION] Starting optimized foundation agent initialization..."
      );

      // Get existing managers
      const toolManager = getToolManager();
      const contextManager = ContextManager.getInstance(context);

      // Create optimized factory with advanced caching and performance monitoring (using singleton)
      const optimizedFactory = OptimizedFoundationAgentFactory.getInstance({
        ollamaUrl: config.ollamaUrl,
        model: config.model,
        toolManager,
        contextManager,
        extensionConfig: config,
      }, {}, {
        enableCache: config.cache?.enabled !== false, // Default enabled
        enablePerformanceMonitoring: true,
        enablePreWarming: true,
        enableParallelInitialization: true,
        initializationStrategy: 'hybrid',
        cacheConfig: {
          enabled: true,
          maxAge: config.cache?.maxAge || 24 * 60 * 60 * 1000, // 24 hours
          persistToDisk: true,
          warmupEnabled: true,
          precomputeEmbeddings: true,
          validateOnLoad: false
        }
      });

      // Create intelligent preloader
      const preloader = new AgentPreloader(optimizedFactory, {
        enabled: config.preload?.enabled !== false, // Default enabled
        strategy: config.preload?.strategy || 'balanced',
        backgroundDelay: 500, // Start preloading quickly
        adaptiveLoading: true
      });

      // Start preloading process
      const startTime = Date.now();
      
      // Initialize critical agents first, then start preloading others
      await Promise.all([
        optimizedFactory.createAgents(), // This will use cache if available
        preloader.startPreloading()      // This preloads remaining agents
      ]);

      const initTime = Date.now() - startTime;

      logger.info(
        `[EXTENSION] Optimized foundation agent initialization completed in ${initTime}ms`
      );

      // Log optimization statistics
      const stats = optimizedFactory.getOptimizationStats();
      logger.info(`[EXTENSION] Cache hit rate: ${(stats.cacheMetrics.hitRate * 100).toFixed(1)}%`);
      logger.info(`[EXTENSION] Average init time: ${Math.round(stats.performanceMetrics.averageInitTime)}ms`);

      // Show enhanced notification with performance info
      if (config.initialization?.showCompletionNotification) {
        const cacheBonus = stats.cacheMetrics.hitRate > 0.5 ? " ⚡" : "";
        const timeBonus = initTime < 5000 ? " 🚀" : "";
        vscode.window.setStatusBarMessage(
          `🦙 Foundation agents ready in ${Math.round(initTime/1000*10)/10}s${cacheBonus}${timeBonus}`, 
          4000
        );
      }

      // Store factory and preloader globally for debugging/monitoring
      (global as any).foundationFactory = optimizedFactory;
      (global as any).agentPreloader = preloader;

    } catch (error) {
      logger.warn(
        "[EXTENSION] Optimized foundation initialization failed (will fallback to basic init):",
        error
      );

      // Fallback to basic factory initialization
      try {
        const toolManager = getToolManager();
        const contextManager = ContextManager.getInstance(context);
        
        const basicFactory = FoundationAgentFactory.getInstance({
          ollamaUrl: config.ollamaUrl,
          model: config.model,
          toolManager,
          contextManager,
          extensionConfig: config,
        });

        await basicFactory.initializeAgents();
        logger.info("[EXTENSION] Fallback basic initialization succeeded");
      } catch (fallbackError) {
        logger.error("[EXTENSION] Both optimized and basic initialization failed:", fallbackError);
      }
    }
  }, delay);
}
