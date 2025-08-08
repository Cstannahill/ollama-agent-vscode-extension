import { BaseAgent, IAgent, AgentSpecialization, AgentCapability, TaskAnalysis, AgentResponse, ProgressCallback } from "./IAgent";
import { ChatSession, AgentAction } from "../core/ChatSession";
import { ToolManager } from "../core/ToolManager";
import { ContextManager } from "../core/ContextManager";
import { OllamaLLM } from "../api/ollama";
import { PromptBuilder } from "../core/PromptBuilder";
import { logger } from "../utils/logger";
import { AgentConfig } from "./BasicAgent";

export interface RefactoringConfig {
  preserveAPI: boolean;
  maintainTests: boolean;
  enableBigRefactorings: boolean;
  maxComplexityThreshold: number;
  preferredPatterns: string[];
  excludePatterns: string[];
  backupBeforeRefactor: boolean;
  validateAfterRefactor: boolean;
}

/**
 * Specialized agent for code refactoring and architecture improvements
 */
export class RefactoringAgent extends BaseAgent {
  private llm: OllamaLLM;
  private toolManager: ToolManager;
  private contextManager?: ContextManager;
  private promptBuilder: PromptBuilder;
  private refactorConfig: RefactoringConfig;

  constructor(
    private agentConfig: AgentConfig,
    toolManager: ToolManager,
    contextManager?: ContextManager,
    refactorConfig?: Partial<RefactoringConfig>
  ) {
    super(AgentSpecialization.REFACTORING);
    
    this.toolManager = toolManager;
    this.contextManager = contextManager;
    this.promptBuilder = new PromptBuilder(toolManager);
    
    this.refactorConfig = {
      preserveAPI: true,
      maintainTests: true,
      enableBigRefactorings: false,
      maxComplexityThreshold: 15,
      preferredPatterns: ["DRY", "SOLID", "composition"],
      excludePatterns: ["node_modules", ".git", "dist"],
      backupBeforeRefactor: true,
      validateAfterRefactor: true,
      ...refactorConfig
    };

    this.llm = new OllamaLLM({
      baseUrl: agentConfig.ollamaUrl,
      model: agentConfig.model,
      temperature: 0.2, // Low temperature for consistent refactoring
    });
  }

  protected initializeCapabilities(): void {
    this.capabilities = [
      {
        name: "code_structure_improvement",
        description: "Improve code organization, reduce complexity, and enhance maintainability",
        toolsRequired: ["file_read", "file_write", "complexity_analyzer"],
        confidenceThreshold: 0.85
      },
      {
        name: "design_pattern_implementation",
        description: "Apply design patterns and architectural improvements",
        toolsRequired: ["file_read", "file_write", "typescript_analyzer"],
        confidenceThreshold: 0.8
      },
      {
        name: "duplicate_code_elimination",
        description: "Identify and eliminate code duplication",
        toolsRequired: ["file_read", "file_write", "file_list"],
        confidenceThreshold: 0.9
      },
      {
        name: "performance_optimization",
        description: "Optimize code for better performance and efficiency",
        toolsRequired: ["file_read", "file_write", "complexity_analyzer"],
        confidenceThreshold: 0.75
      },
      {
        name: "legacy_code_modernization",
        description: "Modernize legacy code with current best practices",
        toolsRequired: ["file_read", "file_write", "typescript_analyzer"],
        confidenceThreshold: 0.8
      },
      {
        name: "test_driven_refactoring",
        description: "Refactor code while maintaining test coverage",
        toolsRequired: ["file_read", "file_write", "run_tests"],
        confidenceThreshold: 0.85
      }
    ];
  }

  public async canHandle(task: string, context?: any): Promise<TaskAnalysis> {
    const lowerTask = task.toLowerCase();
    
    const refactorKeywords = [
      "refactor", "refactoring", "restructure", "improve", "optimize",
      "clean up", "modernize", "simplify", "reorganize"
    ];

    const architectureKeywords = [
      "architecture", "design pattern", "solid", "dry", "composition",
      "inheritance", "abstraction", "encapsulation"
    ];

    const performanceKeywords = [
      "performance", "optimize", "efficiency", "speed up", "memory",
      "algorithm", "complexity", "bottleneck"
    ];

    const qualityKeywords = [
      "code quality", "maintainability", "readability", "technical debt",
      "code smell", "anti-pattern", "best practices"
    ];

    let confidence = 0.0;
    const reasoningSteps: string[] = [];
    const requiredCapabilities: string[] = [];

    // Check for explicit refactoring requests
    if (lowerTask.includes("refactor") || lowerTask.includes("refactoring")) {
      confidence += 0.6;
      reasoningSteps.push("Explicit refactoring request detected");
      requiredCapabilities.push("code_structure_improvement");
    }

    // Check for general refactoring keywords
    const refactorMatches = refactorKeywords.filter(keyword => lowerTask.includes(keyword));
    if (refactorMatches.length > 0) {
      confidence += Math.min(refactorMatches.length * 0.15, 0.4);
      reasoningSteps.push(`Refactoring keywords found: ${refactorMatches.join(", ")}`);
      if (!requiredCapabilities.includes("code_structure_improvement")) {
        requiredCapabilities.push("code_structure_improvement");
      }
    }

    // Check for architecture improvement requests
    const archMatches = architectureKeywords.filter(keyword => lowerTask.includes(keyword));
    if (archMatches.length > 0) {
      confidence += Math.min(archMatches.length * 0.2, 0.3);
      reasoningSteps.push(`Architecture keywords found: ${archMatches.join(", ")}`);
      requiredCapabilities.push("design_pattern_implementation");
    }

    // Check for performance optimization requests
    const perfMatches = performanceKeywords.filter(keyword => lowerTask.includes(keyword));
    if (perfMatches.length > 0) {
      confidence += Math.min(perfMatches.length * 0.15, 0.25);
      reasoningSteps.push(`Performance keywords found: ${perfMatches.join(", ")}`);
      requiredCapabilities.push("performance_optimization");
    }

    // Check for code quality requests
    const qualityMatches = qualityKeywords.filter(keyword => lowerTask.includes(keyword));
    if (qualityMatches.length > 0) {
      confidence += Math.min(qualityMatches.length * 0.1, 0.2);
      reasoningSteps.push(`Code quality keywords found: ${qualityMatches.join(", ")}`);
      if (!requiredCapabilities.includes("code_structure_improvement")) {
        requiredCapabilities.push("code_structure_improvement");
      }
    }

    // Check for duplicate code requests
    if (lowerTask.includes("duplicate") || lowerTask.includes("dry") || lowerTask.includes("repetition")) {
      confidence += 0.3;
      reasoningSteps.push("Duplicate code elimination request detected");
      requiredCapabilities.push("duplicate_code_elimination");
    }

    // Check for legacy modernization requests
    if (lowerTask.includes("legacy") || lowerTask.includes("modernize") || lowerTask.includes("update")) {
      confidence += 0.25;
      reasoningSteps.push("Legacy modernization request detected");
      requiredCapabilities.push("legacy_code_modernization");
    }

    // Check for source file context
    if (context?.filePath && (context.filePath.endsWith('.ts') || context.filePath.endsWith('.js'))) {
      confidence += 0.2;
      reasoningSteps.push("Source code context detected");
    }

    // Determine complexity
    let complexity: "low" | "medium" | "high" = "medium";
    if (requiredCapabilities.length <= 1) {
      complexity = "low";
    } else if (requiredCapabilities.length >= 3 || requiredCapabilities.includes("design_pattern_implementation")) {
      complexity = "high";
    }

    return {
      primaryDomain: AgentSpecialization.REFACTORING,
      confidence: Math.min(confidence, 1.0),
      reasoningSteps,
      requiredCapabilities,
      complexity,
      estimatedDuration: complexity === "low" ? 30000 : complexity === "medium" ? 60000 : 120000
    };
  }

  public async executeTask(
    task: string,
    session?: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse> {
    const chatSession = session || new ChatSession();
    const actions: AgentAction[] = [];
    
    try {
      logger.info(`[REFACTORING_AGENT] Starting refactoring task: ${task}`);
      
      progressCallback?.onThought?.("Analyzing refactoring requirements and code structure...");
      
      const refactorPlan = await this.createRefactoringPlan(task);
      progressCallback?.onThought?.(`Refactoring plan created: ${refactorPlan.phases.length} phases identified`);

      // Placeholder implementation for refactoring execution
      const summary = `Refactoring analysis completed for ${task}. Identified ${refactorPlan.phases.length} improvement phases.`;
      const recommendations = [
        "Backup code before implementing changes",
        "Run tests after each refactoring step",
        "Focus on one improvement at a time",
        "Maintain API compatibility where possible"
      ];

      const response: AgentResponse = {
        content: summary,
        actions,
        success: true,
        agentType: AgentSpecialization.REFACTORING,
        confidence: 0.8,
        suggestions: recommendations,
        metadata: {
          refactorPlan,
          capabilities: this.getCapabilities().map(c => c.name)
        }
      };

      progressCallback?.onComplete?.(response);
      return response;

    } catch (error) {
      const errorMessage = `Refactoring failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.error("[REFACTORING_AGENT] Task execution failed:", error);

      const response: AgentResponse = {
        content: errorMessage,
        actions,
        success: false,
        error: errorMessage,
        agentType: AgentSpecialization.REFACTORING,
        confidence: 0
      };

      progressCallback?.onComplete?.(response);
      return response;
    }
  }

  private async createRefactoringPlan(task: string): Promise<{
    phases: string[];
    preserveTests: boolean;
    targetFiles: string[];
    refactoringType: string;
  }> {
    const lowerTask = task.toLowerCase();
    
    return {
      phases: ["Analysis", "Planning", "Implementation", "Validation"],
      preserveTests: this.refactorConfig.maintainTests,
      targetFiles: [],
      refactoringType: lowerTask.includes("performance") ? "performance" : 
                     lowerTask.includes("structure") ? "structural" : "general"
    };
  }

  public getPromptTemplates(): Record<string, string> {
    return {
      codeRefactoring: `You are a senior software engineer specializing in code refactoring.
        Apply refactoring techniques to improve:
        1. Code readability and maintainability
        2. Performance and efficiency
        3. Adherence to SOLID principles
        4. Elimination of code smells and anti-patterns
        5. Test coverage and reliability
        
        Ensure refactoring preserves functionality and improves code quality.`,
      
      architectureImprovement: `You are a software architect improving system design.
        Focus on:
        1. Applying appropriate design patterns
        2. Improving separation of concerns
        3. Enhancing modularity and reusability
        4. Reducing coupling and increasing cohesion
        5. Ensuring scalability and maintainability
        
        Provide clear rationale for architectural decisions.`,
      
      performanceOptimization: `You are a performance optimization specialist.
        Optimize code for:
        1. Algorithmic efficiency and complexity
        2. Memory usage and allocation patterns
        3. I/O and network performance
        4. Caching and memoization opportunities
        5. Parallelization and concurrency
        
        Measure and validate performance improvements.`
    };
  }
}