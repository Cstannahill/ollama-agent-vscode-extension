/**
 * Provider-Specific Optimization for Foundation Pipeline
 * 
 * Optimizes pipeline execution based on provider capabilities and characteristics.
 * Routes different stages to the most suitable provider (Ollama vs vLLM).
 */

import { logger } from "../../../utils/logger";
import { LLMRouter, LLMProvider, RoutingDecision } from "../../../api/llm-router";
import { IFoundationAgent, FoundationPipelineConfig } from "../IFoundationAgent";
import chalk from "chalk";

export interface ProviderCapabilities {
  provider: LLMProvider;
  strengths: string[];
  weaknesses: string[];
  optimalTasks: string[];
  performance: {
    avgLatency: number;
    throughput: number;
    batchSize: number;
    memoryEfficiency: number;
  };
}

export interface PipelineOptimization {
  stage: string;
  recommendedProvider: LLMProvider;
  reason: string;
  confidence: number;
  fallbackProvider?: LLMProvider;
  batchingEnabled: boolean;
  parallelization: boolean;
}

/**
 * Provider-specific optimizer for foundation pipeline stages
 */
export class ProviderOptimizer {
  private router: LLMRouter;
  private capabilities: Map<LLMProvider, ProviderCapabilities> = new Map();
  private optimizations: Map<string, PipelineOptimization> = new Map();

  constructor(router: LLMRouter) {
    this.router = router;
    this.initializeCapabilities();
    this.generateOptimizations();
  }

  /**
   * Initialize known provider capabilities
   */
  private initializeCapabilities(): void {
    // Ollama capabilities
    this.capabilities.set("ollama", {
      provider: "ollama",
      strengths: [
        "Tool calling and structured output",
        "Interactive conversations",
        "Reliable response formatting",
        "Local deployment flexibility",
        "Model switching efficiency"
      ],
      weaknesses: [
        "Limited batch processing",
        "Higher latency for large models",
        "Memory usage per request",
        "Sequential processing bottlenecks"
      ],
      optimalTasks: [
        "tool_calling",
        "interactive_chat",
        "structured_output",
        "reasoning_chains",
        "planning"
      ],
      performance: {
        avgLatency: 1200, // milliseconds
        throughput: 5, // requests per second
        batchSize: 1, // typically sequential
        memoryEfficiency: 0.7 // relative efficiency
      }
    });

    // vLLM capabilities
    this.capabilities.set("vllm", {
      provider: "vllm",
      strengths: [
        "High-throughput batch processing",
        "Optimized GPU utilization",
        "Lower inference latency",
        "Efficient memory management",
        "Parallel request handling"
      ],
      weaknesses: [
        "Less flexible structured output",
        "Complex tool calling setup",
        "Model loading overhead",
        "Dependency management"
      ],
      optimalTasks: [
        "embedding_generation",
        "text_classification",
        "batch_processing",
        "content_analysis",
        "summarization"
      ],
      performance: {
        avgLatency: 800, // milliseconds
        throughput: 15, // requests per second
        batchSize: 8, // optimal batch size
        memoryEfficiency: 0.9 // higher efficiency
      }
    });
  }

  /**
   * Generate optimizations for each pipeline stage
   */
  private generateOptimizations(): void {
    // Stage 1: Query Expansion (Light computational load, benefits from speed)
    this.optimizations.set("query_expansion", {
      stage: "query_expansion",
      recommendedProvider: "vllm",
      reason: "Fast text generation for query expansion benefits from vLLM's optimized inference",
      confidence: 0.8,
      fallbackProvider: "ollama",
      batchingEnabled: true,
      parallelization: false
    });

    // Stage 2: Retrieval (Embedding-heavy, perfect for vLLM)
    this.optimizations.set("retrieval", {
      stage: "retrieval",
      recommendedProvider: "vllm",
      reason: "Embedding generation and similarity scoring optimized for vLLM's batch processing",
      confidence: 0.9,
      fallbackProvider: "ollama",
      batchingEnabled: true,
      parallelization: true
    });

    // Stage 3: Reranking (Batch processing benefits)
    this.optimizations.set("reranking", {
      stage: "reranking",
      recommendedProvider: "vllm",
      reason: "Cross-encoder reranking benefits from vLLM's efficient batch inference",
      confidence: 0.85,
      fallbackProvider: "ollama",
      batchingEnabled: true,
      parallelization: false
    });

    // Stage 4: Tool Selection (Structured output, Ollama's strength)
    this.optimizations.set("tool_selection", {
      stage: "tool_selection",
      recommendedProvider: "ollama",
      reason: "Tool selection requires structured JSON output, Ollama's strength",
      confidence: 0.9,
      fallbackProvider: "vllm",
      batchingEnabled: false,
      parallelization: false
    });

    // Stage 5: Planning (Complex reasoning, Ollama's reliability)
    this.optimizations.set("task_planning", {
      stage: "task_planning",
      recommendedProvider: "ollama",
      reason: "Complex task planning benefits from Ollama's reliable reasoning chains",
      confidence: 0.85,
      fallbackProvider: "vllm",
      batchingEnabled: false,
      parallelization: false
    });

    // Stage 6: Chain-of-Thought Generation (Mixed - depends on complexity)
    this.optimizations.set("cot_generation", {
      stage: "cot_generation",
      recommendedProvider: "ollama",
      reason: "Chain-of-thought reasoning requires reliable step-by-step processing",
      confidence: 0.75,
      fallbackProvider: "vllm",
      batchingEnabled: false,
      parallelization: false
    });

    // Stage 7: Chunk Scoring (Batch-friendly, vLLM advantage)
    this.optimizations.set("chunk_scoring", {
      stage: "chunk_scoring",
      recommendedProvider: "vllm",
      reason: "Scoring multiple chunks benefits from vLLM's batch processing efficiency",
      confidence: 0.8,
      fallbackProvider: "ollama",
      batchingEnabled: true,
      parallelization: true
    });

    // Stage 8: Action Generation (Tool calling, Ollama's domain)
    this.optimizations.set("action_generation", {
      stage: "action_generation",
      recommendedProvider: "ollama",
      reason: "Action generation with tool calls requires structured output reliability",
      confidence: 0.9,
      fallbackProvider: "vllm",
      batchingEnabled: false,
      parallelization: false
    });

    // Stage 9: Evaluation (Analysis task, balanced approach)
    this.optimizations.set("evaluation", {
      stage: "evaluation",
      recommendedProvider: "vllm",
      reason: "Evaluation and critique can benefit from vLLM's faster inference",
      confidence: 0.7,
      fallbackProvider: "ollama",
      batchingEnabled: false,
      parallelization: false
    });

    // Stage 10: Final Response (Interactive, Ollama's strength)
    this.optimizations.set("response_generation", {
      stage: "response_generation",
      recommendedProvider: "ollama",
      reason: "Final response generation benefits from Ollama's conversational strengths",
      confidence: 0.8,
      fallbackProvider: "vllm",
      batchingEnabled: false,
      parallelization: false
    });
  }

  /**
   * Get optimization recommendation for a specific stage
   */
  getStageOptimization(stageName: string): PipelineOptimization | null {
    return this.optimizations.get(stageName) || null;
  }

  /**
   * Get optimized provider for a foundation pipeline stage
   */
  async getOptimizedProvider(
    stageName: string, 
    context?: any
  ): Promise<{ provider: LLMProvider; decision: RoutingDecision }> {
    const optimization = this.getStageOptimization(stageName);
    
    if (!optimization) {
      logger.warn(chalk.yellow(`[PROVIDER_OPTIMIZER] No optimization found for stage: ${stageName}`));
      // Fall back to router's default decision
      const decision = await this.router.routeRequest("generate", { 
        taskType: stageName,
        ...context 
      });
      return { provider: decision.provider, decision };
    }

    // Check if recommended provider is available
    const providerStatus = await this.router.getProviderStatus();
    const recommendedAvailable = providerStatus.get(optimization.recommendedProvider);
    
    if (recommendedAvailable) {
      logger.info(
        chalk.green(
          `🔧 [PROVIDER_OPTIMIZER] STAGE_ROUTING | Stage: ${stageName} → ${optimization.recommendedProvider.toUpperCase()} | Reason: ${optimization.reason} | Confidence: ${optimization.confidence.toFixed(2)} | Batching: ${optimization.batchingEnabled ? 'ON' : 'OFF'}`
        )
      );
      
      return {
        provider: optimization.recommendedProvider,
        decision: {
          provider: optimization.recommendedProvider,
          reason: `Optimized: ${optimization.reason}`,
          confidence: optimization.confidence,
          fallback: optimization.fallbackProvider
        }
      };
    }

    // Use fallback if available
    if (optimization.fallbackProvider && providerStatus.get(optimization.fallbackProvider)) {
      logger.info(
        chalk.blue(
          `[PROVIDER_OPTIMIZER] Recommended provider unavailable, using fallback ${optimization.fallbackProvider} for ${stageName}`
        )
      );
      
      return {
        provider: optimization.fallbackProvider,
        decision: {
          provider: optimization.fallbackProvider,
          reason: `Fallback for ${stageName}: primary provider unavailable`,
          confidence: optimization.confidence * 0.8, // Reduced confidence for fallback
          fallback: undefined
        }
      };
    }

    // Last resort: use router's decision
    logger.warn(
      chalk.yellow(
        `[PROVIDER_OPTIMIZER] No optimized providers available for ${stageName}, falling back to router`
      )
    );
    
    const decision = await this.router.routeRequest("generate", { 
      taskType: stageName,
      ...context 
    });
    
    return { provider: decision.provider, decision };
  }

  /**
   * Optimize a batch of stages for parallel execution
   */
  async optimizeBatch(stages: string[]): Promise<Map<string, { provider: LLMProvider; decision: RoutingDecision }>> {
    const results = new Map<string, { provider: LLMProvider; decision: RoutingDecision }>();
    
    // Group stages by recommended provider for potential batching
    const providerGroups = new Map<LLMProvider, string[]>();
    
    for (const stage of stages) {
      const optimization = this.getStageOptimization(stage);
      if (optimization && optimization.batchingEnabled) {
        const group = providerGroups.get(optimization.recommendedProvider) || [];
        group.push(stage);
        providerGroups.set(optimization.recommendedProvider, group);
      }
    }

    // Process each stage
    for (const stage of stages) {
      const result = await this.getOptimizedProvider(stage);
      results.set(stage, result);
    }

    // Log batching opportunities
    for (const [provider, stageList] of providerGroups) {
      if (stageList.length > 1) {
        logger.info(
          chalk.cyan(
            `[PROVIDER_OPTIMIZER] Batching opportunity for ${provider}: ${stageList.join(", ")}`
          )
        );
      }
    }

    return results;
  }

  /**
   * Get performance recommendations for the current pipeline configuration
   */
  getPerformanceInsights(): {
    recommendations: string[];
    bottlenecks: string[];
    optimizations: string[];
  } {
    const recommendations: string[] = [];
    const bottlenecks: string[] = [];
    const optimizations: string[] = [];

    // Analyze current optimizations
    const ollamaStages = Array.from(this.optimizations.values())
      .filter(opt => opt.recommendedProvider === "ollama")
      .map(opt => opt.stage);
    
    const vllmStages = Array.from(this.optimizations.values())
      .filter(opt => opt.recommendedProvider === "vllm")
      .map(opt => opt.stage);

    // Provider balance analysis
    if (ollamaStages.length > vllmStages.length * 2) {
      recommendations.push(
        "Consider enabling vLLM for more stages to improve overall throughput"
      );
    }

    // Batching opportunities
    const batchableStages = Array.from(this.optimizations.values())
      .filter(opt => opt.batchingEnabled)
      .length;
    
    if (batchableStages >= 3) {
      optimizations.push(
        `${batchableStages} stages can benefit from batch processing optimization`
      );
    }

    // Sequential bottlenecks
    const sequentialStages = Array.from(this.optimizations.values())
      .filter(opt => !opt.parallelization && opt.recommendedProvider === "ollama")
      .length;
    
    if (sequentialStages >= 4) {
      bottlenecks.push(
        "Multiple sequential Ollama stages may create processing bottlenecks"
      );
    }

    return { recommendations, bottlenecks, optimizations };
  }

  /**
   * Update optimization based on runtime performance metrics
   */
  updateOptimization(
    stageName: string, 
    provider: LLMProvider, 
    performanceMetrics: {
      latency: number;
      success: boolean;
      throughput?: number;
    }
  ): void {
    const optimization = this.optimizations.get(stageName);
    if (!optimization) return;

    // Adjust confidence based on performance
    if (!performanceMetrics.success) {
      optimization.confidence *= 0.9; // Reduce confidence on failure
    } else if (performanceMetrics.latency < 500) { // Very fast
      optimization.confidence = Math.min(optimization.confidence * 1.1, 1.0);
    }

    // Consider switching providers if performance is consistently poor
    if (performanceMetrics.success && provider !== optimization.recommendedProvider) {
      logger.info(
        chalk.blue(
          `[PROVIDER_OPTIMIZER] Considering provider switch for ${stageName}: ${provider} performing well`
        )
      );
    }

    this.optimizations.set(stageName, optimization);
  }

  /**
   * Export current optimization configuration
   */
  exportConfiguration(): any {
    return {
      capabilities: Array.from(this.capabilities.entries()),
      optimizations: Array.from(this.optimizations.entries()),
      timestamp: new Date().toISOString()
    };
  }
}