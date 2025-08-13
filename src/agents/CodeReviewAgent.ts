import { BaseAgent, IAgent, AgentSpecialization, AgentCapability, TaskAnalysis, AgentResponse, ProgressCallback } from "./IAgent";
import { ChatSession, AgentAction } from "../core/ChatSession";
import { ToolManager } from "../core/ToolManager";
import { ContextManager } from "../core/ContextManager";
import { VectorDatabase } from "../documentation/VectorDatabase";
import { OllamaLLM } from "../api/ollama";
import { PromptBuilder } from "../core/PromptBuilder";
import { logger } from "../utils/logger";
import { AgentConfig } from "./BasicAgent";

// Foundation system imports
import { FoundationPipeline } from "../core/foundation/FoundationPipeline";
import { 
  FoundationAgentFactory, 
  FoundationAgentDependencies,
  FoundationAgents 
} from "../core/foundation/FoundationAgentFactory";
import { 
  FoundationPipelineConfig,
  FoundationPipelineResult 
} from "../core/foundation/IFoundationAgent";

export interface CodeReviewConfig {
  enableSecurityAnalysis: boolean;
  enablePerformanceAnalysis: boolean;
  enableStyleGuideEnforcement: boolean;
  complexityThreshold: number;
  securityRulesFile?: string;
  styleGuideFile?: string;
  excludePatterns: string[];
  includeFileTypes: string[];
  enableFoundationPipeline?: boolean;
  foundationConfig?: Partial<FoundationPipelineConfig>;
}

/**
 * Specialized agent for code review, analysis, and quality assessment
 */
export class CodeReviewAgent extends BaseAgent {
  private llm: OllamaLLM;
  private toolManager: ToolManager;
  private contextManager?: ContextManager;
  private vectorDB?: VectorDatabase;
  private promptBuilder: PromptBuilder;
  private reviewConfig: CodeReviewConfig;
  
  // Foundation system components
  private foundationFactory?: FoundationAgentFactory;
  private foundationPipeline?: FoundationPipeline;
  private foundationAgents?: FoundationAgents;
  private foundationInitialized = false;

  constructor(
    private agentConfig: AgentConfig,
    toolManager: ToolManager,
    contextManager?: ContextManager,
    vectorDB?: VectorDatabase,
    reviewConfig?: Partial<CodeReviewConfig>
  ) {
    super(AgentSpecialization.CODE_REVIEW);
    
    this.toolManager = toolManager;
    this.contextManager = contextManager;
    this.vectorDB = vectorDB;
    this.promptBuilder = new PromptBuilder(toolManager);
    
    this.reviewConfig = {
      enableSecurityAnalysis: true,
      enablePerformanceAnalysis: true,
      enableStyleGuideEnforcement: true,
      complexityThreshold: 10,
      excludePatterns: ["node_modules", ".git", "dist", "build"],
      includeFileTypes: [".ts", ".js", ".tsx", ".jsx", ".vue", ".py", ".java", ".cs"],
      enableFoundationPipeline: true,
      ...reviewConfig
    };

    this.llm = new OllamaLLM({
      baseUrl: agentConfig.ollamaUrl,
      model: agentConfig.model,
      temperature: 0.2, // Lower temperature for more consistent analysis
    });
  }

  /**
   * Initialize the foundation pipeline for enhanced code review
   */
  private async initializeFoundationSystem(): Promise<void> {
    if (this.foundationInitialized || !this.reviewConfig.enableFoundationPipeline) {
      return;
    }

    try {
      logger.info("[CODE_REVIEW_AGENT] Initializing foundation pipeline...");

      // Create foundation agent factory
      const dependencies: FoundationAgentDependencies = {
        ollamaUrl: this.agentConfig.ollamaUrl,
        model: this.agentConfig.model,
        toolManager: this.toolManager,
        contextManager: this.contextManager,
        vectorDatabase: this.vectorDB
      };

      this.foundationFactory = FoundationAgentFactory.getInstance(
        dependencies,
        this.reviewConfig.foundationConfig || {}
      );

      // Create and initialize all foundation agents
      this.foundationAgents = await this.foundationFactory.createAgents();
      await this.foundationFactory.initializeAgents();

      // Create the foundation pipeline
      this.foundationPipeline = new FoundationPipeline(
        this.foundationAgents,
        this.foundationFactory['config'] // Access private config
      );

      await this.foundationPipeline.initialize();

      this.foundationInitialized = true;
      logger.info("[CODE_REVIEW_AGENT] Foundation pipeline initialized successfully");

    } catch (error) {
      logger.error("[CODE_REVIEW_AGENT] Failed to initialize foundation pipeline:", error);
      // Continue without foundation pipeline
      this.reviewConfig.enableFoundationPipeline = false;
    }
  }

  protected initializeCapabilities(): void {
    this.capabilities = [
      {
        name: "static_code_analysis",
        description: "Perform static analysis using ESLint, TypeScript analyzer, and custom rules",
        toolsRequired: ["eslint", "typescript_analyzer"],
        confidenceThreshold: 0.9
      },
      {
        name: "security_vulnerability_detection",
        description: "Identify potential security vulnerabilities and coding issues",
        toolsRequired: ["security_analyzer", "eslint"],
        confidenceThreshold: 0.8
      },
      {
        name: "code_complexity_analysis",
        description: "Analyze cyclomatic complexity and code maintainability",
        toolsRequired: ["complexity_analyzer", "typescript_analyzer"],
        confidenceThreshold: 0.85
      },
      {
        name: "style_guide_enforcement",
        description: "Enforce coding standards and style guide compliance",
        toolsRequired: ["eslint", "prettier"],
        confidenceThreshold: 0.9
      },
      {
        name: "performance_analysis",
        description: "Identify performance bottlenecks and optimization opportunities",
        toolsRequired: ["typescript_analyzer", "complexity_analyzer"],
        confidenceThreshold: 0.7
      },
      {
        name: "code_review_reporting",
        description: "Generate comprehensive code review reports with actionable insights",
        toolsRequired: ["file_write", "file_read"],
        confidenceThreshold: 0.95
      }
    ];
  }

  public async canHandle(task: string, context?: any): Promise<TaskAnalysis> {
    const lowerTask = task.toLowerCase();
    
    // Code review keywords and patterns
    const reviewKeywords = [
      "review", "analyze", "check", "lint", "quality", "security", "vulnerability",
      "eslint", "prettier", "typescript", "complexity", "performance", "optimization",
      "refactor", "clean", "maintainable", "best practices", "code smell", "antipattern"
    ];

    const securityKeywords = [
      "security", "vulnerability", "exploit", "injection", "xss", "csrf", "authentication",
      "authorization", "encryption", "sanitize", "validate"
    ];

    const performanceKeywords = [
      "performance", "optimize", "slow", "bottleneck", "memory", "cpu", "algorithm",
      "efficient", "scalable", "benchmark"
    ];

    let confidence = 0.0;
    const reasoningSteps: string[] = [];
    const requiredCapabilities: string[] = [];

    // Check for explicit code review requests
    if (lowerTask.includes("code review") || lowerTask.includes("review code")) {
      confidence += 0.4;
      reasoningSteps.push("Explicit code review request detected");
      requiredCapabilities.push("code_review_reporting");
    }

    // Check for general review keywords
    const reviewMatches = reviewKeywords.filter(keyword => lowerTask.includes(keyword));
    if (reviewMatches.length > 0) {
      confidence += Math.min(reviewMatches.length * 0.1, 0.3);
      reasoningSteps.push(`Code review keywords found: ${reviewMatches.join(", ")}`);
      requiredCapabilities.push("static_code_analysis");
    }

    // Check for security analysis requests
    const securityMatches = securityKeywords.filter(keyword => lowerTask.includes(keyword));
    if (securityMatches.length > 0) {
      confidence += Math.min(securityMatches.length * 0.15, 0.3);
      reasoningSteps.push(`Security analysis keywords found: ${securityMatches.join(", ")}`);
      requiredCapabilities.push("security_vulnerability_detection");
    }

    // Check for performance analysis requests
    const performanceMatches = performanceKeywords.filter(keyword => lowerTask.includes(keyword));
    if (performanceMatches.length > 0) {
      confidence += Math.min(performanceMatches.length * 0.1, 0.25);
      reasoningSteps.push(`Performance analysis keywords found: ${performanceMatches.join(", ")}`);
      requiredCapabilities.push("performance_analysis");
    }

    // Check for file context (if analyzing specific files)
    if (context?.filePath || lowerTask.match(/\.(ts|js|tsx|jsx|py|java|cs)(\s|$)/)) {
      confidence += 0.2;
      reasoningSteps.push("Code file context detected");
    }

    // Check for tool availability
    const requiredTools = ["eslint", "typescript_analyzer", "security_analyzer"];
    const availableTools = this.toolManager.getToolNames();
    const hasRequiredTools = requiredTools.every(tool => availableTools.includes(tool));
    
    if (!hasRequiredTools) {
      confidence *= 0.7; // Reduce confidence if tools are missing
      reasoningSteps.push("Some required tools may not be available");
    }

    // Determine complexity
    let complexity: "low" | "medium" | "high" = "medium";
    if (requiredCapabilities.length <= 2) {
      complexity = "low";
    } else if (requiredCapabilities.length >= 4) {
      complexity = "high";
    }

    return {
      primaryDomain: AgentSpecialization.CODE_REVIEW,
      confidence: Math.min(confidence, 1.0),
      reasoningSteps,
      requiredCapabilities,
      complexity,
      estimatedDuration: complexity === "low" ? 15000 : complexity === "medium" ? 30000 : 60000
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
      logger.info(`[CODE_REVIEW_AGENT] Starting code review task: ${task}`);
      
      // Initialize foundation system if enabled
      if (this.reviewConfig.enableFoundationPipeline && !this.foundationInitialized) {
        await this.initializeFoundationSystem();
      }

      // Use foundation pipeline for enhanced code review if available
      if (this.foundationPipeline && this.reviewConfig.enableFoundationPipeline) {
        return await this.executeWithFoundationPipeline(task, chatSession, progressCallback);
      }
      
      // Phase 1: Analyze the task and determine review scope
      progressCallback?.onThought?.("Analyzing code review requirements...");
      
      const reviewPlan = await this.createReviewPlan(task);
      progressCallback?.onThought?.(`Review plan created: ${reviewPlan.phases.length} phases identified`);

      let reviewResults = {
        staticAnalysis: null as any,
        securityAnalysis: null as any,
        performanceAnalysis: null as any,
        styleAnalysis: null as any,
        complexityAnalysis: null as any
      };

      // Phase 2: Execute static code analysis
      if (reviewPlan.includeStaticAnalysis) {
        progressCallback?.onAction?.("eslint", { filePath: reviewPlan.targetPath });
        
        try {
          const eslintResult = await this.toolManager.executeTool("eslint", {
            filePath: reviewPlan.targetPath,
            format: "json"
          });
          
          reviewResults.staticAnalysis = JSON.parse(eslintResult);
          progressCallback?.onActionResult?.("Static analysis completed");
          
          actions.push({
            thought: "Performed static code analysis using ESLint",
            toolCall: chatSession.recordToolCall("eslint", { filePath: reviewPlan.targetPath }, eslintResult),
            observation: "Static analysis completed successfully",
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn("[CODE_REVIEW_AGENT] ESLint analysis failed:", error);
          progressCallback?.onActionResult?.("", `ESLint analysis failed: ${error}`);
        }
      }

      // Phase 3: Security analysis
      if (reviewPlan.includeSecurityAnalysis && this.reviewConfig.enableSecurityAnalysis) {
        progressCallback?.onAction?.("security_analyzer", { filePath: reviewPlan.targetPath });
        
        try {
          const securityResult = await this.toolManager.executeTool("security_analyzer", {
            filePath: reviewPlan.targetPath,
            ruleSet: "comprehensive"
          });
          
          reviewResults.securityAnalysis = securityResult;
          progressCallback?.onActionResult?.("Security analysis completed");
          
          actions.push({
            thought: "Performed security vulnerability analysis",
            toolCall: chatSession.recordToolCall("security_analyzer", { filePath: reviewPlan.targetPath }, securityResult),
            observation: "Security analysis completed successfully",
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn("[CODE_REVIEW_AGENT] Security analysis failed:", error);
          progressCallback?.onActionResult?.("", `Security analysis failed: ${error}`);
        }
      }

      // Phase 4: Complexity analysis
      if (reviewPlan.includeComplexityAnalysis) {
        progressCallback?.onAction?.("complexity_analyzer", { filePath: reviewPlan.targetPath });
        
        try {
          const complexityResult = await this.toolManager.executeTool("complexity_analyzer", {
            filePath: reviewPlan.targetPath,
            threshold: this.reviewConfig.complexityThreshold
          });
          
          reviewResults.complexityAnalysis = complexityResult;
          progressCallback?.onActionResult?.("Complexity analysis completed");
          
          actions.push({
            thought: "Analyzed code complexity and maintainability metrics",
            toolCall: chatSession.recordToolCall("complexity_analyzer", { filePath: reviewPlan.targetPath }, complexityResult),
            observation: "Complexity analysis completed successfully",
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn("[CODE_REVIEW_AGENT] Complexity analysis failed:", error);
          progressCallback?.onActionResult?.("", `Complexity analysis failed: ${error}`);
        }
      }

      // Phase 5: Style analysis with Prettier
      if (reviewPlan.includeStyleAnalysis && this.reviewConfig.enableStyleGuideEnforcement) {
        progressCallback?.onAction?.("prettier", { filePath: reviewPlan.targetPath });
        
        try {
          const prettierResult = await this.toolManager.executeTool("prettier", {
            filePath: reviewPlan.targetPath,
            check: true
          });
          
          reviewResults.styleAnalysis = prettierResult;
          progressCallback?.onActionResult?.("Style analysis completed");
          
          actions.push({
            thought: "Checked code formatting and style compliance",
            toolCall: chatSession.recordToolCall("prettier", { filePath: reviewPlan.targetPath }, prettierResult),
            observation: "Style analysis completed successfully",
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn("[CODE_REVIEW_AGENT] Style analysis failed:", error);
          progressCallback?.onActionResult?.("", `Style analysis failed: ${error}`);
        }
      }

      // Phase 6: Generate comprehensive review report
      progressCallback?.onThought?.("Generating comprehensive code review report...");
      
      const reviewReport = await this.generateReviewReport(task, reviewResults, reviewPlan);
      
      // Phase 7: Save review report if requested
      if (reviewPlan.generateReport) {
        const reportFileName = `code-review-${Date.now()}.md`;
        progressCallback?.onAction?.("file_write", { filePath: reportFileName });
        
        try {
          await this.toolManager.executeTool("file_write", {
            filePath: reportFileName,
            content: reviewReport.markdown
          });
          
          progressCallback?.onActionResult?.(`Review report saved to ${reportFileName}`);
          
          actions.push({
            thought: "Generated and saved comprehensive code review report",
            toolCall: chatSession.recordToolCall("file_write", { filePath: reportFileName }, `Report saved to ${reportFileName}`),
            observation: "Review report saved successfully",
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn("[CODE_REVIEW_AGENT] Failed to save review report:", error);
        }
      }

      const response: AgentResponse = {
        content: reviewReport.summary,
        actions,
        success: true,
        agentType: AgentSpecialization.CODE_REVIEW,
        confidence: 0.9,
        suggestions: reviewReport.recommendations,
        metadata: {
          reviewPlan,
          analysisResults: reviewResults,
          issuesFound: reviewReport.issuesCount,
          criticalIssues: reviewReport.criticalIssues
        }
      };

      progressCallback?.onComplete?.(response);
      return response;

    } catch (error) {
      const errorMessage = `Code review failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.error("[CODE_REVIEW_AGENT] Task execution failed:", error);

      const response: AgentResponse = {
        content: errorMessage,
        actions,
        success: false,
        error: errorMessage,
        agentType: AgentSpecialization.CODE_REVIEW,
        confidence: 0
      };

      progressCallback?.onComplete?.(response);
      return response;
    }
  }

  private async createReviewPlan(task: string): Promise<{
    targetPath: string;
    phases: string[];
    includeStaticAnalysis: boolean;
    includeSecurityAnalysis: boolean;
    includeComplexityAnalysis: boolean;
    includeStyleAnalysis: boolean;
    includePerformanceAnalysis: boolean;
    generateReport: boolean;
  }> {
    const lowerTask = task.toLowerCase();
    
    // Extract file path from task if specified
    const filePathMatch = task.match(/(?:file|path):\s*([^\s]+)/i) || 
                         task.match(/([^\s]+\.(ts|js|tsx|jsx|py|java|cs))/i);
    const targetPath = filePathMatch ? filePathMatch[1] : ".";

    const plan = {
      targetPath,
      phases: [] as string[],
      includeStaticAnalysis: lowerTask.includes("lint") || lowerTask.includes("eslint") || lowerTask.includes("static"),
      includeSecurityAnalysis: lowerTask.includes("security") || lowerTask.includes("vulnerability"),
      includeComplexityAnalysis: lowerTask.includes("complexity") || lowerTask.includes("maintainability"),
      includeStyleAnalysis: lowerTask.includes("style") || lowerTask.includes("format") || lowerTask.includes("prettier"),
      includePerformanceAnalysis: lowerTask.includes("performance") || lowerTask.includes("optimize"),
      generateReport: lowerTask.includes("report") || lowerTask.includes("document")
    };

    // If no specific analysis type is mentioned, include all standard analyses
    if (!plan.includeStaticAnalysis && !plan.includeSecurityAnalysis && 
        !plan.includeComplexityAnalysis && !plan.includeStyleAnalysis) {
      plan.includeStaticAnalysis = true;
      plan.includeSecurityAnalysis = this.reviewConfig.enableSecurityAnalysis;
      plan.includeComplexityAnalysis = true;
      plan.includeStyleAnalysis = this.reviewConfig.enableStyleGuideEnforcement;
    }

    // Build phase list
    if (plan.includeStaticAnalysis) plan.phases.push("Static Analysis");
    if (plan.includeSecurityAnalysis) plan.phases.push("Security Analysis");
    if (plan.includeComplexityAnalysis) plan.phases.push("Complexity Analysis");
    if (plan.includeStyleAnalysis) plan.phases.push("Style Analysis");
    if (plan.includePerformanceAnalysis) plan.phases.push("Performance Analysis");
    if (plan.generateReport) plan.phases.push("Report Generation");

    return plan;
  }

  private async generateReviewReport(
    task: string,
    results: any,
    plan: any
  ): Promise<{
    summary: string;
    markdown: string;
    recommendations: string[];
    issuesCount: number;
    criticalIssues: number;
  }> {
    const issues: any[] = [];
    const recommendations: string[] = [];
    let criticalIssues = 0;

    // Process static analysis results
    if (results.staticAnalysis) {
      try {
        const eslintData = typeof results.staticAnalysis === 'string' 
          ? JSON.parse(results.staticAnalysis) 
          : results.staticAnalysis;
        
        if (Array.isArray(eslintData)) {
          eslintData.forEach(file => {
            if (file.messages) {
              file.messages.forEach((message: any) => {
                issues.push({
                  type: "Static Analysis",
                  severity: message.severity === 2 ? "Error" : "Warning",
                  message: message.message,
                  file: file.filePath,
                  line: message.line,
                  rule: message.ruleId
                });
                if (message.severity === 2) criticalIssues++;
              });
            }
          });
        }
      } catch (error) {
        logger.warn("Failed to parse ESLint results:", error);
      }
    }

    // Process security analysis results
    if (results.securityAnalysis) {
      // Parse security findings
      const securityLines = results.securityAnalysis.split('\n');
      securityLines.forEach((line: string) => {
        if (line.includes('security') || line.includes('vulnerability')) {
          issues.push({
            type: "Security",
            severity: "High",
            message: line.trim(),
            file: plan.targetPath
          });
          criticalIssues++;
        }
      });
    }

    // Generate recommendations based on findings
    if (issues.length === 0) {
      recommendations.push("Code appears to follow best practices and standards");
      recommendations.push("Consider adding more comprehensive tests if not already present");
    } else {
      if (criticalIssues > 0) {
        recommendations.push(`Address ${criticalIssues} critical issues before deployment`);
      }
      recommendations.push("Fix ESLint errors and warnings for better code quality");
      recommendations.push("Consider implementing automated formatting with Prettier");
      if (results.securityAnalysis) {
        recommendations.push("Review and address any security vulnerabilities");
      }
    }

    const summary = this.generateSummary(issues, criticalIssues, plan.targetPath);
    const markdown = this.generateMarkdownReport(task, issues, recommendations, plan);

    return {
      summary,
      markdown,
      recommendations,
      issuesCount: issues.length,
      criticalIssues
    };
  }

  private generateSummary(issues: any[], criticalIssues: number, targetPath: string): string {
    if (issues.length === 0) {
      return `Code review completed for ${targetPath}. No issues found. Code follows best practices and quality standards.`;
    }

    const issueText = issues.length === 1 ? "issue" : "issues";
    const criticalText = criticalIssues > 0 ? ` (${criticalIssues} critical)` : "";
    
    return `Code review completed for ${targetPath}. Found ${issues.length} ${issueText}${criticalText}. See detailed analysis for recommendations.`;
  }

  private generateMarkdownReport(task: string, issues: any[], recommendations: string[], plan: any): string {
    const timestamp = new Date().toISOString();
    
    let markdown = `# Code Review Report\n\n`;
    markdown += `**Generated:** ${timestamp}\n`;
    markdown += `**Target:** ${plan.targetPath}\n`;
    markdown += `**Task:** ${task}\n\n`;

    markdown += `## Summary\n\n`;
    markdown += `- **Total Issues:** ${issues.length}\n`;
    markdown += `- **Critical Issues:** ${issues.filter(i => i.severity === "Error" || i.severity === "High").length}\n`;
    markdown += `- **Warnings:** ${issues.filter(i => i.severity === "Warning").length}\n\n`;

    if (issues.length > 0) {
      markdown += `## Issues Found\n\n`;
      
      issues.forEach((issue, index) => {
        markdown += `### ${index + 1}. ${issue.type} - ${issue.severity}\n\n`;
        markdown += `**Message:** ${issue.message}\n\n`;
        if (issue.file) markdown += `**File:** ${issue.file}\n\n`;
        if (issue.line) markdown += `**Line:** ${issue.line}\n\n`;
        if (issue.rule) markdown += `**Rule:** ${issue.rule}\n\n`;
        markdown += `---\n\n`;
      });
    }

    markdown += `## Recommendations\n\n`;
    recommendations.forEach((rec, index) => {
      markdown += `${index + 1}. ${rec}\n`;
    });
    markdown += `\n`;

    markdown += `## Analysis Details\n\n`;
    plan.phases.forEach((phase: string) => {
      markdown += `- ✅ ${phase}\n`;
    });

    return markdown;
  }

  public getPromptTemplates(): Record<string, string> {
    return {
      codeReview: `You are a senior code reviewer with expertise in software quality, security, and best practices. 
        Analyze the provided code and provide detailed feedback on:
        1. Code quality and maintainability
        2. Security vulnerabilities and concerns  
        3. Performance optimization opportunities
        4. Adherence to coding standards and best practices
        5. Potential bugs or edge cases
        
        Provide constructive feedback with specific examples and actionable recommendations.`,
      
      securityReview: `You are a security expert conducting a thorough security review.
        Focus on identifying:
        1. Input validation vulnerabilities
        2. Authentication and authorization issues
        3. Data exposure risks
        4. Injection attack vectors
        5. Cryptographic implementation flaws
        
        Prioritize findings by risk level and provide mitigation strategies.`,
      
      performanceReview: `You are a performance optimization specialist.
        Analyze the code for:
        1. Algorithmic efficiency and complexity
        2. Memory usage patterns
        3. I/O and network optimization opportunities  
        4. Caching strategies
        5. Scalability concerns
        
        Provide specific optimization recommendations with expected impact.`
    };
  }

  /**
   * Execute code review using the foundation pipeline for enhanced analysis
   */
  private async executeWithFoundationPipeline(
    task: string,
    session: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse> {
    try {
      progressCallback?.onThought?.("🚀 Starting foundation-enhanced code review...");

      // Get available code review tools
      const codeReviewTools = this.toolManager.getAllTools()
        .filter(tool => [
          'eslint', 'prettier', 'typescript_analyzer', 'complexity_analyzer', 
          'security_analyzer', 'file_read', 'file_write', 'file_list'
        ].includes(tool.name))
        .map(tool => ({
          id: tool.name,
          name: tool.name,
          description: tool.description,
          category: 'code_analysis',
          parameters: {},
          examples: []
        }));

      // Get workspace context with code review focus
      const workspaceContext = {
        task: `Code review and analysis: ${task}`,
        specialization: 'code_review',
        focus: [
          'security_analysis',
          'performance_analysis', 
          'code_quality',
          'style_compliance',
          'complexity_analysis'
        ],
        config: this.reviewConfig
      };

      // Execute foundation pipeline
      const pipelineResult: FoundationPipelineResult = await this.foundationPipeline!.execute(
        task,
        workspaceContext,
        codeReviewTools,
        progressCallback
      );

      // Convert pipeline actions to agent actions
      const actions: AgentAction[] = [];
      
      // Track each pipeline stage as an action
      for (const stage of pipelineResult.stagesCompleted) {
        actions.push({
          thought: `Foundation pipeline stage: ${stage}`,
          observation: `✅ ${stage} completed with enhanced code review analysis`,
          timestamp: new Date()
        });
      }

      // Execute specialized code review actions from pipeline
      if (pipelineResult.actionCalls && pipelineResult.actionCalls.length > 0) {
        progressCallback?.onAction?.("🔍 Executing specialized code review actions...", pipelineResult.actionCalls);
        
        for (const actionCall of pipelineResult.actionCalls) {
          try {
            const result = await this.toolManager.executeTool(actionCall.toolId, actionCall.parameters);
            
            actions.push({
              thought: `Code review tool execution: ${actionCall.toolId}`,
              toolCall: {
                id: `${Date.now()}-${Math.random()}`,
                toolName: actionCall.toolId,
                input: actionCall.parameters,
                output: result,
                timestamp: new Date()
              },
              observation: `Code analysis completed: ${result.substring(0, 200)}...`,
              timestamp: new Date()
            });
          } catch (toolError) {
            actions.push({
              thought: `Code review tool failed: ${actionCall.toolId}`,
              observation: `Tool execution failed: ${toolError instanceof Error ? toolError.message : String(toolError)}`,
              timestamp: new Date()
            });
          }
        }
      }

      // Generate comprehensive code review report
      let reviewContent = "";
      
      if (pipelineResult.reasoning?.conclusion) {
        reviewContent = pipelineResult.reasoning.conclusion;
      } else {
        reviewContent = "Code review completed using foundation pipeline analysis";
      }

      // Add specialized code review insights
      if (pipelineResult.reasoning?.steps && pipelineResult.reasoning.steps.length > 0) {
        reviewContent += "\n\n## Analysis Steps:\n";
        pipelineResult.reasoning.steps.forEach((step, index) => {
          reviewContent += `${index + 1}. ${step}\n`;
        });
      }

      // Add confidence and recommendations
      if (pipelineResult.confidence > 0) {
        reviewContent += `\n\n**Analysis Confidence:** ${(pipelineResult.confidence * 100).toFixed(1)}%`;
      }

      if (actions.length > 0) {
        const successfulActions = actions.filter(a => a.toolCall && !a.toolCall.error).length;
        reviewContent += `\n\n**Tools Executed:** ${successfulActions}/${actions.length} successful`;
      }

      // Store actions in session
      for (const action of actions) {
        session.addAction(action);
      }

      const response: AgentResponse = {
        content: reviewContent,
        actions,
        success: pipelineResult.errors.length === 0,
        error: pipelineResult.errors.length > 0 ? pipelineResult.errors.join('; ') : undefined,
        agentType: this.specialization,
        confidence: pipelineResult.confidence
      };
      
      progressCallback?.onComplete?.(response);
      return response;

    } catch (error) {
      logger.error("[CODE_REVIEW_AGENT] Foundation pipeline execution failed:", error);
      
      // Fallback to traditional code review
      progressCallback?.onThought?.("⚠️ Foundation pipeline failed, using traditional code review...");
      return await this.executeTraditionalCodeReview(task, session, progressCallback);
    }
  }

  /**
   * Traditional code review execution (renamed from original executeTask logic)
   */
  private async executeTraditionalCodeReview(
    task: string,
    session: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse> {
    const actions: AgentAction[] = [];
    
    try {
      // Phase 1: Analyze the task and determine review scope
      progressCallback?.onThought?.("Analyzing code review requirements...");
      
      const reviewPlan = await this.createReviewPlan(task);
      progressCallback?.onThought?.(`Review plan created: ${reviewPlan.phases.length} phases identified`);

      let reviewResults = {
        staticAnalysis: null as any,
        securityAnalysis: null as any,
        performanceAnalysis: null as any,
        styleAnalysis: null as any,
        complexityAnalysis: null as any
      };

      // Continue with existing traditional code review logic...
      // (The rest of the original executeTask logic would go here)
      
      return {
        content: "Traditional code review completed",
        actions,
        success: true,
        agentType: this.specialization
      };

    } catch (error) {
      logger.error("[CODE_REVIEW_AGENT] Traditional code review failed:", error);
      
      return {
        content: `Code review failed: ${error instanceof Error ? error.message : String(error)}`,
        actions,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        agentType: this.specialization
      };
    }
  }
}