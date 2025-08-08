import * as vscode from "vscode";

export interface ExtensionConfig {
  ollamaUrl: string;
  model: string;
  logLevel: "debug" | "info" | "warn" | "error";
  temperature: number;
  maxIterations: number;
  verbose: boolean;
  
  // vLLM configuration
  vllm: {
    enabled: boolean;
    serverUrl: string;
    model: string;
    maxModelLen: number;
    tensorParallelSize: number;
    gpuMemoryUtilization: number;
  };
  
  // Routing configuration
  routing: {
    chatPreference: "ollama" | "vllm" | "auto";
    embeddingPreference: "ollama" | "vllm" | "auto";
    toolCallingPreference: "ollama" | "vllm" | "auto";
    batchProcessingPreference: "ollama" | "vllm" | "auto";
    preferSpeed: boolean;
    enableFallback: boolean;
    fallbackTimeout: number;
  };
  
  // Foundation pipeline optimization
  foundation: {
    enableVLLMOptimization: boolean;
    models: {
      retriever: string;
      reranker: string;
      toolSelector: string;
      critic: string;
      taskPlanner: string;
      queryRewriter: string;
      cotGenerator: string;
      chunkScorer: string;
      actionCaller: string;
      embedder: string;
    };
  };
  
  // Initialization optimization settings
  initialization?: {
    strategy?: "lazy" | "background" | "eager";
    backgroundDelay?: number;
    showCompletionNotification?: boolean;
  };
  
  // Cache optimization settings
  cache?: {
    enabled?: boolean;
    maxAge?: number;
    persistToDisk?: boolean;
    warmupEnabled?: boolean;
    precomputeEmbeddings?: boolean;
    validateOnLoad?: boolean;
  };
  
  // Preloader optimization settings
  preload?: {
    enabled?: boolean;
    strategy?: "aggressive" | "balanced" | "conservative";
    maxConcurrentPreloads?: number;
    backgroundDelay?: number;
    adaptiveLoading?: boolean;
    memoryThreshold?: number;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp?: Date;
}

export interface AgentResponse {
  content: string;
  finished: boolean;
  toolCalls?: any[];
}

/**
 * Get the current extension configuration
 */
export function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("ollamaAgent");

  return {
    ollamaUrl: config.get<string>("ollamaUrl") || "http://localhost:11434",
    model: config.get<string>("model") || "llama3.2",
    logLevel:
      config.get<"debug" | "info" | "warn" | "error">("logLevel") || "debug",
    temperature: config.get<number>("temperature") || 0.7,
    maxIterations: config.get<number>("maxIterations") || 10,
    verbose: config.get<boolean>("verbose") || false,
    
    // vLLM configuration
    vllm: {
      enabled: config.get<boolean>("vllm.enabled") || false,
      serverUrl: config.get<string>("vllm.serverUrl") || "http://localhost:11435",
      model: config.get<string>("vllm.model") || "microsoft/DialoGPT-medium",
      maxModelLen: config.get<number>("vllm.maxModelLen") || 2048,
      tensorParallelSize: config.get<number>("vllm.tensorParallelSize") || 1,
      gpuMemoryUtilization: config.get<number>("vllm.gpuMemoryUtilization") || 0.9,
    },
    
    // Routing configuration
    routing: {
      chatPreference: config.get<"ollama" | "vllm" | "auto">("routing.chatPreference") || "auto",
      embeddingPreference: config.get<"ollama" | "vllm" | "auto">("routing.embeddingPreference") || "vllm",
      toolCallingPreference: config.get<"ollama" | "vllm" | "auto">("routing.toolCallingPreference") || "ollama",
      batchProcessingPreference: config.get<"ollama" | "vllm" | "auto">("routing.batchProcessingPreference") || "vllm",
      preferSpeed: config.get<boolean>("routing.preferSpeed") || true,
      enableFallback: config.get<boolean>("routing.enableFallback") || true,
      fallbackTimeout: config.get<number>("routing.fallbackTimeout") || 10000,
    },
    
    // Foundation pipeline optimization
    foundation: {
      enableVLLMOptimization: config.get<boolean>("foundation.enableVLLMOptimization") || true,
      models: {
        retriever: config.get<string>("foundation.models.retriever") || "",
        reranker: config.get<string>("foundation.models.reranker") || "",
        toolSelector: config.get<string>("foundation.models.toolSelector") || "",
        critic: config.get<string>("foundation.models.critic") || "",
        taskPlanner: config.get<string>("foundation.models.taskPlanner") || "",
        queryRewriter: config.get<string>("foundation.models.queryRewriter") || "",
        cotGenerator: config.get<string>("foundation.models.cotGenerator") || "",
        chunkScorer: config.get<string>("foundation.models.chunkScorer") || "",
        actionCaller: config.get<string>("foundation.models.actionCaller") || "",
        embedder: config.get<string>("foundation.models.embedder") || "",
      },
    },
    
    // Initialization optimization settings
    initialization: {
      strategy: config.get<"lazy" | "background" | "eager">("initialization.strategy") || "background",
      backgroundDelay: config.get<number>("initialization.backgroundDelay") || 2000,
      showCompletionNotification: config.get<boolean>("initialization.showCompletionNotification") || false,
    },
    
    // Cache optimization settings
    cache: {
      enabled: config.get<boolean>("cache.enabled") !== false, // Default true
      maxAge: config.get<number>("cache.maxAge") || 24 * 60 * 60 * 1000, // 24 hours
      persistToDisk: config.get<boolean>("cache.persistToDisk") !== false, // Default true
      warmupEnabled: config.get<boolean>("cache.warmupEnabled") !== false, // Default true
      precomputeEmbeddings: config.get<boolean>("cache.precomputeEmbeddings") !== false, // Default true
      validateOnLoad: config.get<boolean>("cache.validateOnLoad") || false, // Default false
    },
    
    // Preloader optimization settings  
    preload: {
      enabled: config.get<boolean>("preload.enabled") !== false, // Default true
      strategy: config.get<"aggressive" | "balanced" | "conservative">("preload.strategy") || "balanced",
      maxConcurrentPreloads: config.get<number>("preload.maxConcurrentPreloads") || 3,
      backgroundDelay: config.get<number>("preload.backgroundDelay") || 500,
      adaptiveLoading: config.get<boolean>("preload.adaptiveLoading") !== false, // Default true
      memoryThreshold: config.get<number>("preload.memoryThreshold") || 512, // 512MB
    },
  };
}

/**
 * Update configuration value
 */
export async function updateConfig(
  key: string,
  value: any,
  isGlobal: boolean = false
): Promise<void> {
  const config = vscode.workspace.getConfiguration("ollamaAgent");
  await config.update(key, value, isGlobal);
}

/**
 * Constants used throughout the extension
 */
export const CONSTANTS = {
  EXTENSION_ID: "ollama-agent-vscode",
  OUTPUT_CHANNEL_NAME: "Ollama Agent",
  CHAT_VIEW_TYPE: "ollamaAgent.chatView",

  // Command IDs
  COMMANDS: {
    RUN_AGENT: "ollamaAgent.run",
    OPEN_CHAT: "ollamaAgent.chat",
    CLEAR_CHAT: "ollamaAgent.clearChat",
    SHOW_CONFIG: "ollamaAgent.showConfig",
    OPEN_SETTINGS: "ollamaAgent.openSettings",
    OPEN_DOCUMENTATION: "ollamaAgent.documentation",
    OPEN_PROJECT_DASHBOARD: "ollamaAgent.projectDashboard",
    OPEN_CONTEXT_VISUALIZATION: "ollamaAgent.contextVisualization",
    OPEN_PROJECT_CONTEXT: "ollamaAgent.projectContext",
    OPEN_FOUNDATION_MODELS: "ollamaAgent.foundationModels",
  },

  // Default prompts
  SYSTEM_PROMPT: `You are an intelligent coding assistant agent working within VS Code. 
You have access to tools that allow you to read files, write files, execute commands, and interact with the VS Code editor.
Always think step by step and explain your reasoning before taking actions.`,

  // File patterns to exclude from workspace scanning
  EXCLUDE_PATTERNS: [
    "**/node_modules/**",
    "**/.*",
    "**/*.git/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/*.log",
    "**/coverage/**",
  ],
} as const;
