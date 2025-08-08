import * as vscode from "vscode";
import { logger } from "../utils/logger";

export interface QuantizationConfig {
  enabled: boolean;
  level: "q4_0" | "q4_1" | "q5_0" | "q5_1" | "q8_0" | "f16" | "f32";
  contextWindow: number;
  adaptiveQuantization: boolean;
}

export interface ModelPerformanceProfile {
  modelName: string;
  quantizationLevel: string;
  avgResponseTime: number;
  memoryUsage: number;
  qualityScore: number; // Subjective quality assessment
  recommendedForTasks: string[];
}

/**
 * Manages quantized model configurations and performance optimization
 */
export class QuantizedModelManager {
  private static instance: QuantizedModelManager;
  private performanceProfiles: Map<string, ModelPerformanceProfile> = new Map();
  private currentConfig: QuantizationConfig;

  private constructor() {
    this.currentConfig = this.loadConfiguration();
    this.initializePerformanceProfiles();
  }

  public static getInstance(): QuantizedModelManager {
    if (!QuantizedModelManager.instance) {
      QuantizedModelManager.instance = new QuantizedModelManager();
    }
    return QuantizedModelManager.instance;
  }

  /**
   * Get optimized model name with quantization suffix
   */
  public getOptimizedModelName(baseModel: string): string {
    if (!this.currentConfig.enabled) {
      return baseModel;
    }

    // Check if model already has quantization suffix
    if (this.hasQuantizationSuffix(baseModel)) {
      return baseModel;
    }

    // Add quantization suffix
    return `${baseModel}:${this.currentConfig.level}`;
  }

  /**
   * Recommend optimal quantization level based on system resources and task
   */
  public recommendQuantization(
    baseModel: string,
    taskType: "coding" | "analysis" | "general" | "complex"
  ): QuantizationConfig {
    const systemInfo = this.getSystemInfo();
    
    let recommendedLevel: QuantizationConfig["level"] = "q4_0";
    
    // Adjust based on available memory
    if (systemInfo.availableMemoryGB > 16) {
      // High memory system - can use less aggressive quantization
      recommendedLevel = taskType === "complex" ? "q5_1" : "q4_1";
    } else if (systemInfo.availableMemoryGB > 8) {
      // Medium memory system
      recommendedLevel = taskType === "complex" ? "q4_1" : "q4_0";
    } else {
      // Low memory system - more aggressive quantization
      recommendedLevel = "q4_0";
    }

    // Adjust context window based on quantization level
    const contextWindow = this.getOptimalContextWindow(recommendedLevel, taskType);

    logger.info(
      `[QUANTIZED_MODEL] Recommended ${recommendedLevel} for ${baseModel} (${taskType} task)`
    );

    return {
      enabled: true,
      level: recommendedLevel,
      contextWindow,
      adaptiveQuantization: true,
    };
  }

  /**
   * Apply quantization configuration to model
   */
  public async applyQuantization(
    modelName: string,
    config?: Partial<QuantizationConfig>
  ): Promise<string> {
    const finalConfig = { ...this.currentConfig, ...config };
    
    if (!finalConfig.enabled) {
      return modelName;
    }

    const quantizedModel = this.getOptimizedModelName(modelName);
    
    // Verify model availability
    try {
      await this.verifyModelAvailability(quantizedModel);
      logger.info(`[QUANTIZED_MODEL] Using quantized model: ${quantizedModel}`);
      return quantizedModel;
    } catch (error) {
      logger.warn(
        `[QUANTIZED_MODEL] Quantized model ${quantizedModel} not available, falling back to base model`
      );
      return modelName;
    }
  }

  /**
   * Record performance metrics for a model configuration
   */
  public recordPerformance(
    modelName: string,
    responseTime: number,
    memoryUsage: number,
    qualityScore?: number
  ): void {
    const profile: ModelPerformanceProfile = {
      modelName,
      quantizationLevel: this.extractQuantizationLevel(modelName),
      avgResponseTime: responseTime,
      memoryUsage,
      qualityScore: qualityScore || 0,
      recommendedForTasks: this.determineRecommendedTasks(responseTime, memoryUsage, qualityScore),
    };

    this.performanceProfiles.set(modelName, profile);
    logger.debug(`[QUANTIZED_MODEL] Recorded performance for ${modelName}`);
  }

  /**
   * Get performance comparison between different quantization levels
   */
  public getPerformanceComparison(baseModel: string): ModelPerformanceProfile[] {
    const comparisons: ModelPerformanceProfile[] = [];
    
    for (const [modelName, profile] of this.performanceProfiles.entries()) {
      if (modelName.startsWith(baseModel.split(":")[0])) {
        comparisons.push(profile);
      }
    }

    return comparisons.sort((a, b) => a.avgResponseTime - b.avgResponseTime);
  }

  /**
   * Auto-tune quantization based on usage patterns
   */
  public async autoTuneQuantization(
    _baseModel: string,
    recentTasks: string[]
  ): Promise<QuantizationConfig> {
    const taskAnalysis = this.analyzeTaskComplexity(recentTasks);
    const systemLoad = await this.getSystemLoad();
    
    let optimalLevel: QuantizationConfig["level"] = this.currentConfig.level;
    
    // Adjust based on task complexity
    if (taskAnalysis.averageComplexity > 0.8) {
      // High complexity tasks - use better quality quantization
      optimalLevel = this.upgradeQuantization(this.currentConfig.level);
    } else if (taskAnalysis.averageComplexity < 0.3) {
      // Simple tasks - can use more aggressive quantization
      optimalLevel = this.downgradeQuantization(this.currentConfig.level);
    }

    // Adjust based on system load
    if (systemLoad.cpuUsage > 0.8 || systemLoad.memoryUsage > 0.9) {
      optimalLevel = this.downgradeQuantization(optimalLevel);
    }

    const tunedConfig: QuantizationConfig = {
      enabled: true,
      level: optimalLevel,
      contextWindow: this.getOptimalContextWindow(optimalLevel, "general"),
      adaptiveQuantization: true,
    };

    logger.info(
      `[QUANTIZED_MODEL] Auto-tuned to ${optimalLevel} based on usage patterns`
    );

    return tunedConfig;
  }

  /**
   * Get current configuration from VS Code settings
   */
  private loadConfiguration(): QuantizationConfig {
    const config = vscode.workspace.getConfiguration("ollamaAgent");
    
    return {
      enabled: config.get<boolean>("model.quantized") || false,
      level: config.get<QuantizationConfig["level"]>("model.quantization") || "q4_0",
      contextWindow: config.get<number>("model.contextWindow") || 4096,
      adaptiveQuantization: true,
    };
  }

  /**
   * Initialize known performance profiles for common models
   */
  private initializePerformanceProfiles(): void {
    // Add default profiles for common models and quantization levels
    const defaultProfiles: ModelPerformanceProfile[] = [
      {
        modelName: "llama3.2:3b:q4_0",
        quantizationLevel: "q4_0",
        avgResponseTime: 1500,
        memoryUsage: 2048,
        qualityScore: 0.85,
        recommendedForTasks: ["coding", "general"],
      },
      {
        modelName: "llama3.2:3b:q5_1",
        quantizationLevel: "q5_1",
        avgResponseTime: 2000,
        memoryUsage: 3072,
        qualityScore: 0.92,
        recommendedForTasks: ["analysis", "complex"],
      },
      {
        modelName: "codellama:7b:q4_0",
        quantizationLevel: "q4_0",
        avgResponseTime: 2500,
        memoryUsage: 4096,
        qualityScore: 0.88,
        recommendedForTasks: ["coding", "analysis"],
      },
    ];

    for (const profile of defaultProfiles) {
      this.performanceProfiles.set(profile.modelName, profile);
    }
  }

  private hasQuantizationSuffix(modelName: string): boolean {
    const quantizationLevels = ["q4_0", "q4_1", "q5_0", "q5_1", "q8_0", "f16", "f32"];
    return quantizationLevels.some(level => modelName.endsWith(`:${level}`));
  }

  private getOptimalContextWindow(
    quantizationLevel: QuantizationConfig["level"],
    taskType: string
  ): number {
    const baseWindows = {
      q4_0: 4096,
      q4_1: 4096,
      q5_0: 8192,
      q5_1: 8192,
      q8_0: 16384,
      f16: 32768,
      f32: 32768,
    };

    let contextWindow = baseWindows[quantizationLevel];

    // Adjust based on task type
    if (taskType === "complex" || taskType === "analysis") {
      contextWindow = Math.min(contextWindow * 2, 32768);
    }

    return contextWindow;
  }

  private async verifyModelAvailability(modelName: string): Promise<void> {
    try {
      // This would typically check with Ollama API
      // For now, we'll assume the model is available
      logger.debug(`[QUANTIZED_MODEL] Verifying model availability: ${modelName}`);
    } catch (error) {
      throw new Error(`Model ${modelName} not available`);
    }
  }

  private extractQuantizationLevel(modelName: string): string {
    const parts = modelName.split(":");
    return parts.length > 2 ? parts[parts.length - 1] : "none";
  }

  private determineRecommendedTasks(
    responseTime: number,
    memoryUsage: number,
    qualityScore?: number
  ): string[] {
    const tasks: string[] = [];
    
    if (responseTime < 2000) {
      tasks.push("general", "coding");
    }
    
    if (memoryUsage < 4096 && responseTime < 3000) {
      tasks.push("analysis");
    }
    
    if (qualityScore && qualityScore > 0.9) {
      tasks.push("complex");
    }

    return tasks;
  }

  private getSystemInfo(): { availableMemoryGB: number; cpuCores: number } {
    // This would typically get actual system info
    // For now, return reasonable defaults
    return {
      availableMemoryGB: 8, // Assume 8GB as baseline
      cpuCores: 4,
    };
  }

  private analyzeTaskComplexity(tasks: string[]): { averageComplexity: number } {
    // Simple complexity analysis based on task keywords
    const complexityScores = tasks.map(task => {
      if (task.includes("complex") || task.includes("analysis")) return 0.9;
      if (task.includes("coding") || task.includes("debug")) return 0.7;
      return 0.4; // General tasks
    });

    const averageComplexity = complexityScores.reduce((a, b) => a + b, 0) / complexityScores.length;
    return { averageComplexity };
  }

  private async getSystemLoad(): Promise<{ cpuUsage: number; memoryUsage: number }> {
    // This would typically get actual system load
    // For now, return moderate load
    return {
      cpuUsage: 0.5,
      memoryUsage: 0.6,
    };
  }

  private upgradeQuantization(current: QuantizationConfig["level"]): QuantizationConfig["level"] {
    const hierarchy: QuantizationConfig["level"][] = ["q4_0", "q4_1", "q5_0", "q5_1", "q8_0", "f16"];
    const currentIndex = hierarchy.indexOf(current);
    return currentIndex < hierarchy.length - 1 ? hierarchy[currentIndex + 1] : current;
  }

  private downgradeQuantization(current: QuantizationConfig["level"]): QuantizationConfig["level"] {
    const hierarchy: QuantizationConfig["level"][] = ["q4_0", "q4_1", "q5_0", "q5_1", "q8_0", "f16"];
    const currentIndex = hierarchy.indexOf(current);
    return currentIndex > 0 ? hierarchy[currentIndex - 1] : current;
  }

  /**
   * Update configuration and save to VS Code settings
   */
  public async updateConfiguration(config: Partial<QuantizationConfig>): Promise<void> {
    this.currentConfig = { ...this.currentConfig, ...config };
    
    const vscodeConfig = vscode.workspace.getConfiguration("ollamaAgent");
    
    if (config.enabled !== undefined) {
      await vscodeConfig.update("model.quantized", config.enabled);
    }
    
    if (config.level !== undefined) {
      await vscodeConfig.update("model.quantization", config.level);
    }
    
    if (config.contextWindow !== undefined) {
      await vscodeConfig.update("model.contextWindow", config.contextWindow);
    }

    logger.info("[QUANTIZED_MODEL] Configuration updated");
  }

  /**
   * Get current configuration
   */
  public getCurrentConfig(): QuantizationConfig {
    return { ...this.currentConfig };
  }
}