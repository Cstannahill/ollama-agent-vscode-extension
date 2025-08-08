import { logger } from "../utils/logger";
import chalk from "chalk";
import { OllamaLLM, OllamaChatModel, OllamaConfig } from "./ollama";
import { VLLMLLM, VLLMChatModel, VLLMConfig } from "./vllm";

export type LLMProvider = "ollama" | "vllm";

export interface ProviderConfig {
  ollama: OllamaConfig;
  vllm: VLLMConfig;
  vllmEnabled?: boolean;
}

export interface RoutingPreferences {
  // Task-specific routing
  chatPreference: LLMProvider;
  embeddingPreference: LLMProvider;
  toolCallingPreference: LLMProvider;
  batchProcessingPreference: LLMProvider;
  
  // Performance-based routing
  preferSpeed: boolean;
  preferAccuracy: boolean;
  maxLatencyMs?: number;
  
  // Model-specific routing
  smallModelThreshold: string; // e.g., "7b"
  largeModelThreshold: string; // e.g., "13b"
  
  // Fallback behavior
  enableFallback: boolean;
  fallbackTimeout: number; // milliseconds
}

export interface RoutingDecision {
  provider: LLMProvider;
  reason: string;
  confidence: number;
  fallback?: LLMProvider;
}

export interface ProviderPerformance {
  provider: LLMProvider;
  avgLatency: number;
  successRate: number;
  lastUpdated: Date;
  requestCount: number;
}

/**
 * Intelligent LLM Router
 * Routes requests between Ollama and vLLM based on task characteristics,
 * model capabilities, performance metrics, and user preferences
 */
export class LLMRouter {
  private providers: Map<LLMProvider, { llm: OllamaLLM | VLLMLLM; chatModel: OllamaChatModel | VLLMChatModel }> = new Map();
  private preferences: RoutingPreferences;
  private performanceMetrics: Map<LLMProvider, ProviderPerformance> = new Map();
  private availabilityCache: Map<LLMProvider, { available: boolean; lastCheck: Date }> = new Map();
  private cacheTimeout = 30000; // 30 seconds
  private vllmEnabled: boolean;

  constructor(config: ProviderConfig, preferences: RoutingPreferences) {
    this.preferences = preferences;
    this.vllmEnabled = config.vllmEnabled || false;
    this.initializeProviders(config);
    this.initializePerformanceMetrics();
  }

  private initializeProviders(config: ProviderConfig): void {
    // Initialize Ollama provider (always available)
    const ollamaLLM = new OllamaLLM(config.ollama);
    const ollamaChatModel = new OllamaChatModel(config.ollama);
    this.providers.set("ollama", { llm: ollamaLLM, chatModel: ollamaChatModel });

    // Initialize vLLM provider only if enabled
    if (config.vllmEnabled) {
      const vllmLLM = new VLLMLLM(config.vllm);
      const vllmChatModel = new VLLMChatModel(config.vllm);
      this.providers.set("vllm", { llm: vllmLLM, chatModel: vllmChatModel });
      logger.info(chalk.green("🔥 [LLM_ROUTER] Initialized both Ollama and vLLM providers"));
    } else {
      logger.info(chalk.yellow("🦙 [LLM_ROUTER] Initialized Ollama provider only (vLLM disabled)"));
    }
  }

  private initializePerformanceMetrics(): void {
    this.performanceMetrics.set("ollama", {
      provider: "ollama",
      avgLatency: 1000, // Initial estimate
      successRate: 0.95,
      lastUpdated: new Date(),
      requestCount: 0
    });

    // Only initialize vLLM metrics if vLLM is enabled
    if (this.vllmEnabled) {
      this.performanceMetrics.set("vllm", {
        provider: "vllm",
        avgLatency: 800, // vLLM typically faster
        successRate: 0.90, // Might be less stable initially
        lastUpdated: new Date(),
        requestCount: 0
      });
    }
  }

  /**
   * Get the best LLM provider for a task
   */
  async getLLM(taskType?: string, modelName?: string): Promise<{ provider: OllamaLLM | VLLMLLM; decision: RoutingDecision }> {
    const decision = await this.routeRequest("generate", { taskType, modelName });
    const providerInfo = this.providers.get(decision.provider);

    if (!providerInfo) {
      throw new Error(`Provider ${decision.provider} not initialized`);
    }

    logger.info(chalk.cyan(`🎯 [LLM_ROUTER] ROUTED_LLM → ${decision.provider.toUpperCase()} | Task: ${taskType || 'general'} | Model: ${modelName || 'default'} | Reason: ${decision.reason} | Confidence: ${decision.confidence.toFixed(2)}`));

    return {
      provider: providerInfo.llm,
      decision
    };
  }

  /**
   * Get the best Chat Model provider for a task
   */
  async getChatModel(taskType?: string, modelName?: string, hasTools?: boolean): Promise<{ provider: OllamaChatModel | VLLMChatModel; decision: RoutingDecision }> {
    const decision = await this.routeRequest("chat", { taskType, modelName, hasTools });
    const providerInfo = this.providers.get(decision.provider);

    if (!providerInfo) {
      throw new Error(`Provider ${decision.provider} not initialized`);
    }

    logger.info(chalk.cyan(`🎯 [LLM_ROUTER] ROUTED_CHAT → ${decision.provider.toUpperCase()} | Task: ${taskType || 'general'} | Model: ${modelName || 'default'} | Tools: ${hasTools ? 'YES' : 'NO'} | Reason: ${decision.reason} | Confidence: ${decision.confidence.toFixed(2)}`));

    return {
      provider: providerInfo.chatModel,
      decision
    };
  }

  /**
   * Route request based on task characteristics
   */
  async routeRequest(requestType: "generate" | "chat", context: any): Promise<RoutingDecision> {
    const { taskType, modelName, hasTools } = context;

    // Check provider availability
    const ollamaAvailable = await this.isProviderAvailable("ollama");
    const vllmAvailable = this.vllmEnabled && await this.isProviderAvailable("vllm");

    if (!ollamaAvailable && !vllmAvailable) {
      throw new Error("No LLM providers available");
    }

    // Single provider scenarios
    if (!vllmAvailable) {
      return {
        provider: "ollama",
        reason: this.vllmEnabled ? "vLLM unavailable, using Ollama" : "vLLM disabled, using Ollama",
        confidence: 1.0
      };
    }

    if (!ollamaAvailable) {
      return {
        provider: "vllm",
        reason: "Ollama unavailable, using vLLM",
        confidence: 1.0,
        fallback: undefined
      };
    }

    // Intelligent routing based on task characteristics
    return this.intelligentRoute(requestType, context);
  }

  private intelligentRoute(requestType: "generate" | "chat", context: any): RoutingDecision {
    const { taskType, modelName, hasTools } = context;
    let score = { ollama: 0, vllm: 0 };
    let reasons: string[] = [];

    // 1. Tool calling preference (Ollama generally better at structured output)
    if (hasTools) {
      if (this.preferences.toolCallingPreference === "ollama") {
        score.ollama += 30;
        reasons.push("tool calling favors Ollama");
      } else {
        score.vllm += 30;
        reasons.push("tool calling preference: vLLM");
      }
    }

    // 2. Task type analysis
    switch (taskType) {
      case "embedding":
      case "reranking":
      case "batch_processing":
        score.vllm += 20;
        reasons.push("batch/embedding tasks favor vLLM");
        break;
      
      case "interactive_chat":
      case "tool_calling":
        score.ollama += 15;
        reasons.push("interactive tasks favor Ollama");
        break;
      
      case "code_generation":
      case "analysis":
        // Check model size - larger models might benefit from vLLM's optimization
        if (this.isLargeModel(modelName)) {
          score.vllm += 15;
          reasons.push("large model benefits from vLLM optimization");
        } else {
          score.ollama += 10;
          reasons.push("code generation works well on both");
        }
        break;
    }

    // 3. Performance-based routing
    const ollamaPerf = this.performanceMetrics.get("ollama")!;
    const vllmPerf = this.performanceMetrics.get("vllm")!;

    if (this.preferences.preferSpeed) {
      if (vllmPerf.avgLatency < ollamaPerf.avgLatency) {
        score.vllm += 15;
        reasons.push("vLLM has lower average latency");
      } else {
        score.ollama += 15;
        reasons.push("Ollama has lower average latency");
      }
    }

    // 4. Success rate consideration
    if (ollamaPerf.successRate > vllmPerf.successRate + 0.05) { // 5% threshold
      score.ollama += 10;
      reasons.push("Ollama has higher success rate");
    } else if (vllmPerf.successRate > ollamaPerf.successRate + 0.05) {
      score.vllm += 10;
      reasons.push("vLLM has higher success rate");
    }

    // 5. Model size considerations
    if (this.isSmallModel(modelName)) {
      score.ollama += 5;
      reasons.push("small models work well on Ollama");
    } else if (this.isLargeModel(modelName)) {
      score.vllm += 10;
      reasons.push("large models benefit from vLLM optimization");
    }

    // 6. User preferences
    if (requestType === "chat" && this.preferences.chatPreference === "ollama") {
      score.ollama += 20;
      reasons.push("user prefers Ollama for chat");
    } else if (requestType === "chat" && this.preferences.chatPreference === "vllm") {
      score.vllm += 20;
      reasons.push("user prefers vLLM for chat");
    }

    // 7. Foundation pipeline optimizations
    if (taskType === "foundation_pipeline") {
      score.vllm += 25;
      reasons.push("foundation pipeline optimized for vLLM");
    }

    // Determine winner
    const winner = score.ollama > score.vllm ? "ollama" : "vllm";
    const confidence = Math.abs(score.ollama - score.vllm) / Math.max(score.ollama, score.vllm);
    const fallback = winner === "ollama" ? "vllm" : "ollama";

    return {
      provider: winner,
      reason: reasons.join(", "),
      confidence: Math.min(confidence, 1.0),
      fallback: this.preferences.enableFallback ? fallback : undefined
    };
  }

  /**
   * Execute with fallback support
   */
  async executeWithFallback<T>(
    operation: (provider: any) => Promise<T>,
    decision: RoutingDecision
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      const primaryProvider = this.providers.get(decision.provider);
      if (!primaryProvider) {
        throw new Error(`Provider ${decision.provider} not available`);
      }

      const result = await Promise.race([
        operation(decision.provider === "ollama" ? primaryProvider.llm : primaryProvider.llm),
        this.createTimeout(this.preferences.fallbackTimeout)
      ]);

      // Update performance metrics
      this.updatePerformanceMetrics(decision.provider, Date.now() - startTime, true);

      return result as T;

    } catch (error) {
      logger.warn(chalk.yellow(`[LLM_ROUTER] Primary provider ${decision.provider} failed: ${error}`));
      
      // Update failure metrics
      this.updatePerformanceMetrics(decision.provider, Date.now() - startTime, false);

      // Try fallback if enabled
      if (decision.fallback && this.preferences.enableFallback) {
        logger.info(chalk.blue(`[LLM_ROUTER] Attempting fallback to ${decision.fallback}`));
        
        try {
          const fallbackProvider = this.providers.get(decision.fallback);
          if (fallbackProvider) {
            const result = await operation(decision.fallback === "ollama" ? fallbackProvider.llm : fallbackProvider.llm);
            this.updatePerformanceMetrics(decision.fallback, Date.now() - startTime, true);
            return result as T;
          }
        } catch (fallbackError) {
          logger.error(chalk.red(`[LLM_ROUTER] Fallback also failed: ${fallbackError}`));
          this.updatePerformanceMetrics(decision.fallback!, Date.now() - startTime, false);
        }
      }

      throw error;
    }
  }

  private async isProviderAvailable(provider: LLMProvider): Promise<boolean> {
    const cached = this.availabilityCache.get(provider);
    
    if (cached && Date.now() - cached.lastCheck.getTime() < this.cacheTimeout) {
      return cached.available;
    }

    const providerInfo = this.providers.get(provider);
    if (!providerInfo) {
      return false;
    }

    try {
      const available = await providerInfo.llm.isAvailable();
      this.availabilityCache.set(provider, {
        available,
        lastCheck: new Date()
      });
      return available;
    } catch (error) {
      logger.debug(`[LLM_ROUTER] Provider ${provider} availability check failed:`, error);
      this.availabilityCache.set(provider, {
        available: false,
        lastCheck: new Date()
      });
      return false;
    }
  }

  private isSmallModel(modelName?: string): boolean {
    if (!modelName) return false;
    
    const smallModelPatterns = [
      /1b/i, /3b/i, /7b/i,
      /small/i, /mini/i, /light/i
    ];
    
    return smallModelPatterns.some(pattern => pattern.test(modelName));
  }

  private isLargeModel(modelName?: string): boolean {
    if (!modelName) return false;
    
    const largeModelPatterns = [
      /13b/i, /20b/i, /30b/i, /70b/i,
      /large/i, /xl/i, /xxl/i
    ];
    
    return largeModelPatterns.some(pattern => pattern.test(modelName));
  }

  private updatePerformanceMetrics(provider: LLMProvider, latency: number, success: boolean): void {
    const metrics = this.performanceMetrics.get(provider);
    if (!metrics) return;

    // Update metrics with exponential smoothing
    const alpha = 0.1; // Smoothing factor
    metrics.avgLatency = metrics.avgLatency * (1 - alpha) + latency * alpha;
    metrics.successRate = metrics.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
    metrics.requestCount++;
    metrics.lastUpdated = new Date();

    this.performanceMetrics.set(provider, metrics);
  }

  private createTimeout(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): Map<LLMProvider, ProviderPerformance> {
    return new Map(this.performanceMetrics);
  }

  /**
   * Get provider availability status
   */
  async getProviderStatus(): Promise<Map<LLMProvider, boolean>> {
    const status = new Map<LLMProvider, boolean>();
    
    for (const provider of this.providers.keys()) {
      status.set(provider, await this.isProviderAvailable(provider));
    }
    
    return status;
  }

  /**
   * Update routing preferences
   */
  updatePreferences(newPreferences: Partial<RoutingPreferences>): void {
    this.preferences = { ...this.preferences, ...newPreferences };
    logger.info(chalk.green("[LLM_ROUTER] Updated routing preferences"));
  }

  /**
   * Clear performance metrics and caches
   */
  resetMetrics(): void {
    this.initializePerformanceMetrics();
    this.availabilityCache.clear();
    logger.info(chalk.green("[LLM_ROUTER] Reset performance metrics"));
  }
}