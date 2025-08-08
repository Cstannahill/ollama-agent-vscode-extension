import { BaseAgent, IAgent, AgentSpecialization, AgentCapability, TaskAnalysis, AgentResponse, ProgressCallback } from "./IAgent";
import { ChatSession, AgentAction } from "../core/ChatSession";
import { ToolManager } from "../core/ToolManager";
import { ContextManager } from "../core/ContextManager";
import { OllamaLLM } from "../api/ollama";
import { PromptBuilder } from "../core/PromptBuilder";
import { logger } from "../utils/logger";
import { AgentConfig } from "./BasicAgent";

export interface DevOpsConfig {
  defaultBranch: string;
  requirePullRequests: boolean;
  enforceConventionalCommits: boolean;
  autoCreateReleases: boolean;
  cicdPlatform: "github" | "gitlab" | "jenkins" | "azure" | "auto";
  deploymentStrategy: "rolling" | "blue-green" | "canary" | "recreate";
  enableHotfixes: boolean;
  releaseTagPattern: string;
  commitMessageTemplate: string;
  enableFoundationPipeline?: boolean;
}

export interface GitWorkflow {
  type: "gitflow" | "github-flow" | "gitlab-flow" | "custom";
  branches: {
    main: string;
    develop?: string;
    feature: string;
    release?: string;
    hotfix?: string;
  };
  enforceLinearHistory: boolean;
  squashMerges: boolean;
}

/**
 * Specialized agent for DevOps, Git workflows, CI/CD, and deployment automation
 */
export class DevOpsAgent extends BaseAgent {
  private llm: OllamaLLM;
  private toolManager: ToolManager;
  private contextManager?: ContextManager;
  private promptBuilder: PromptBuilder;
  private devopsConfig: DevOpsConfig;
  private gitWorkflow: GitWorkflow;

  constructor(
    private agentConfig: AgentConfig,
    toolManager: ToolManager,
    contextManager?: ContextManager,
    devopsConfig?: Partial<DevOpsConfig>,
    gitWorkflow?: Partial<GitWorkflow>
  ) {
    super(AgentSpecialization.DEVOPS);
    
    this.toolManager = toolManager;
    this.contextManager = contextManager;
    this.promptBuilder = new PromptBuilder(toolManager);
    
    this.devopsConfig = {
      defaultBranch: "main",
      requirePullRequests: true,
      enforceConventionalCommits: true,
      autoCreateReleases: false,
      cicdPlatform: "auto",
      deploymentStrategy: "rolling",
      enableHotfixes: true,
      releaseTagPattern: "v{major}.{minor}.{patch}",
      commitMessageTemplate: "{type}({scope}): {description}",
      ...devopsConfig
    };

    this.gitWorkflow = {
      type: "github-flow",
      branches: {
        main: "main",
        feature: "feature/*",
        hotfix: "hotfix/*"
      },
      enforceLinearHistory: false,
      squashMerges: true,
      ...gitWorkflow
    };

    this.llm = new OllamaLLM({
      baseUrl: agentConfig.ollamaUrl,
      model: agentConfig.model,
      temperature: 0.1, // Very low temperature for consistent DevOps operations
    });
  }

  protected initializeCapabilities(): void {
    this.capabilities = [
      {
        name: "git_workflow_management",
        description: "Manage Git workflows including branching, merging, and release strategies",
        toolsRequired: ["git_status", "git_branch", "git_add", "git_commit"],
        confidenceThreshold: 0.95
      },
      {
        name: "repository_maintenance",
        description: "Maintain repository health with automated cleanup and optimization",
        toolsRequired: ["git_status", "git_log", "git_remote"],
        confidenceThreshold: 0.9
      },
      {
        name: "release_automation",
        description: "Automate release processes including tagging, changelog generation, and deployment",
        toolsRequired: ["git_log", "git_branch", "file_write"],
        confidenceThreshold: 0.85
      },
      {
        name: "cicd_pipeline_creation",
        description: "Create and configure CI/CD pipelines for various platforms",
        toolsRequired: ["file_write", "file_read"],
        confidenceThreshold: 0.8
      },
      {
        name: "deployment_automation",
        description: "Automate deployment processes and environment management",
        toolsRequired: ["run_shell", "file_write", "file_read"],
        confidenceThreshold: 0.8
      },
      {
        name: "hotfix_management",
        description: "Manage emergency hotfix workflows and rapid deployments",
        toolsRequired: ["git_branch", "git_add", "git_commit", "git_status"],
        confidenceThreshold: 0.9
      },
      {
        name: "merge_conflict_resolution",
        description: "Assist with merge conflict detection and resolution strategies",
        toolsRequired: ["git_status", "git_diff", "file_read"],
        confidenceThreshold: 0.75
      }
    ];
  }

  public async canHandle(task: string, context?: any): Promise<TaskAnalysis> {
    const lowerTask = task.toLowerCase();
    
    // Git workflow keywords
    const gitKeywords = [
      "git", "commit", "push", "pull", "merge", "branch", "checkout", "rebase",
      "stash", "cherry-pick", "reset", "revert", "tag", "remote"
    ];

    const devopsKeywords = [
      "deploy", "deployment", "release", "pipeline", "ci", "cd", "build",
      "publish", "infrastructure", "docker", "kubernetes", "helm"
    ];

    const workflowKeywords = [
      "workflow", "gitflow", "github flow", "feature branch", "hotfix",
      "pull request", "merge request", "code review"
    ];

    const releaseKeywords = [
      "release", "version", "tag", "changelog", "semantic versioning",
      "major", "minor", "patch", "alpha", "beta", "rc"
    ];

    let confidence = 0.0;
    const reasoningSteps: string[] = [];
    const requiredCapabilities: string[] = [];

    // Check for explicit Git commands
    const gitCommands = ["git commit", "git push", "git pull", "git merge", "git branch"];
    const gitCommandMatches = gitCommands.filter(cmd => lowerTask.includes(cmd));
    if (gitCommandMatches.length > 0) {
      confidence += 0.6;
      reasoningSteps.push(`Git commands detected: ${gitCommandMatches.join(", ")}`);
      requiredCapabilities.push("git_workflow_management");
    }

    // Check for general Git keywords
    const gitMatches = gitKeywords.filter(keyword => lowerTask.includes(keyword));
    if (gitMatches.length > 0) {
      confidence += Math.min(gitMatches.length * 0.1, 0.4);
      reasoningSteps.push(`Git keywords found: ${gitMatches.join(", ")}`);
      if (!requiredCapabilities.includes("git_workflow_management")) {
        requiredCapabilities.push("git_workflow_management");
      }
    }

    // Check for DevOps keywords
    const devopsMatches = devopsKeywords.filter(keyword => lowerTask.includes(keyword));
    if (devopsMatches.length > 0) {
      confidence += Math.min(devopsMatches.length * 0.15, 0.3);
      reasoningSteps.push(`DevOps keywords found: ${devopsMatches.join(", ")}`);
      
      if (lowerTask.includes("deploy") || lowerTask.includes("deployment")) {
        requiredCapabilities.push("deployment_automation");
      }
      if (lowerTask.includes("pipeline") || lowerTask.includes("ci") || lowerTask.includes("cd")) {
        requiredCapabilities.push("cicd_pipeline_creation");
      }
    }

    // Check for workflow management requests
    const workflowMatches = workflowKeywords.filter(keyword => lowerTask.includes(keyword));
    if (workflowMatches.length > 0) {
      confidence += Math.min(workflowMatches.length * 0.2, 0.3);
      reasoningSteps.push(`Workflow keywords found: ${workflowMatches.join(", ")}`);
      requiredCapabilities.push("git_workflow_management");
    }

    // Check for release management requests
    const releaseMatches = releaseKeywords.filter(keyword => lowerTask.includes(keyword));
    if (releaseMatches.length > 0) {
      confidence += Math.min(releaseMatches.length * 0.15, 0.25);
      reasoningSteps.push(`Release keywords found: ${releaseMatches.join(", ")}`);
      requiredCapabilities.push("release_automation");
    }

    // Check for hotfix requests
    if (lowerTask.includes("hotfix") || lowerTask.includes("emergency") || lowerTask.includes("urgent fix")) {
      confidence += 0.3;
      reasoningSteps.push("Hotfix request detected");
      requiredCapabilities.push("hotfix_management");
    }

    // Check for merge conflict assistance
    if (lowerTask.includes("merge conflict") || lowerTask.includes("conflict resolution")) {
      confidence += 0.4;
      reasoningSteps.push("Merge conflict assistance requested");
      requiredCapabilities.push("merge_conflict_resolution");
    }

    // Check for repository context
    if (context?.repository || lowerTask.includes("repo") || lowerTask.includes("repository")) {
      confidence += 0.1;
      reasoningSteps.push("Repository context detected");
    }

    // Check for tool availability
    const requiredTools = ["git_status", "git_add", "git_commit", "git_branch"];
    const availableTools = this.toolManager.getToolNames();
    const hasRequiredTools = requiredTools.every(tool => availableTools.includes(tool));
    
    if (!hasRequiredTools) {
      confidence *= 0.5; // Significantly reduce confidence if Git tools unavailable
      reasoningSteps.push("Git tools may not be available");
    }

    // Determine complexity
    let complexity: "low" | "medium" | "high" = "medium";
    if (requiredCapabilities.length <= 1 && !requiredCapabilities.includes("cicd_pipeline_creation")) {
      complexity = "low";
    } else if (requiredCapabilities.length >= 3 || requiredCapabilities.includes("deployment_automation")) {
      complexity = "high";
    }

    return {
      primaryDomain: AgentSpecialization.DEVOPS,
      confidence: Math.min(confidence, 1.0),
      reasoningSteps,
      requiredCapabilities,
      complexity,
      estimatedDuration: complexity === "low" ? 10000 : complexity === "medium" ? 25000 : 60000
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
      logger.info(`[DEVOPS_AGENT] Starting DevOps task: ${task}`);
      
      // Phase 1: Analyze the task and determine DevOps strategy
      progressCallback?.onThought?.("Analyzing DevOps requirements and repository state...");
      
      const devopsPlan = await this.createDevOpsPlan(task);
      progressCallback?.onThought?.(`DevOps plan created: ${devopsPlan.phases.length} phases identified`);

      let devopsResults = {
        gitStatus: null as any,
        workflowAction: null as any,
        releaseInfo: null as any,
        pipelineCreated: false,
        deploymentStatus: null as any
      };

      // Phase 2: Check current Git status
      if (devopsPlan.includeStatusCheck) {
        progressCallback?.onAction?.("git_status", {});
        
        try {
          const gitStatusResult = await this.toolManager.executeTool("git_status", {});
          devopsResults.gitStatus = this.parseGitStatus(gitStatusResult);
          progressCallback?.onActionResult?.(`Repository status: ${devopsResults.gitStatus.summary}`);
          
          actions.push({
            thought: "Checked current Git repository status",
            toolCall: chatSession.recordToolCall("git_status", {}, gitStatusResult),
            observation: "Git status retrieved successfully",
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn("[DEVOPS_AGENT] Git status check failed:", error);
          progressCallback?.onActionResult?.("", `Git status check failed: ${error}`);
        }
      }

      // Phase 3: Execute Git workflow actions
      if (devopsPlan.includeGitWorkflow) {
        await this.executeGitWorkflow(devopsPlan, actions, chatSession, progressCallback);
      }

      // Phase 4: Handle release automation
      if (devopsPlan.includeRelease) {
        await this.executeReleaseAutomation(devopsPlan, actions, chatSession, progressCallback);
      }

      // Phase 5: Create CI/CD pipeline if requested
      if (devopsPlan.includePipeline) {
        await this.createCICDPipeline(devopsPlan, actions, chatSession, progressCallback);
        devopsResults.pipelineCreated = true;
      }

      // Phase 6: Handle deployment automation
      if (devopsPlan.includeDeployment) {
        await this.executeDeployment(devopsPlan, actions, chatSession, progressCallback);
      }

      // Phase 7: Generate DevOps report
      progressCallback?.onThought?.("Generating DevOps operation report...");
      
      const devopsReport = await this.generateDevOpsReport(task, devopsResults, devopsPlan);
      
      const response: AgentResponse = {
        content: devopsReport.summary,
        actions,
        success: true,
        agentType: AgentSpecialization.DEVOPS,
        confidence: 0.9,
        suggestions: devopsReport.recommendations,
        metadata: {
          devopsPlan,
          gitStatus: devopsResults.gitStatus,
          workflowType: this.gitWorkflow.type,
          pipelineCreated: devopsResults.pipelineCreated
        }
      };

      progressCallback?.onComplete?.(response);
      return response;

    } catch (error) {
      const errorMessage = `DevOps operation failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.error("[DEVOPS_AGENT] Task execution failed:", error);

      const response: AgentResponse = {
        content: errorMessage,
        actions,
        success: false,
        error: errorMessage,
        agentType: AgentSpecialization.DEVOPS,
        confidence: 0
      };

      progressCallback?.onComplete?.(response);
      return response;
    }
  }

  private async createDevOpsPlan(task: string): Promise<{
    action: string;
    phases: string[];
    includeStatusCheck: boolean;
    includeGitWorkflow: boolean;
    includeRelease: boolean;
    includePipeline: boolean;
    includeDeployment: boolean;
    workflowType: string;
    targetBranch?: string;
    commitMessage?: string;
    releaseVersion?: string;
    files?: string[];
  }> {
    const lowerTask = task.toLowerCase();
    
    // Determine primary action
    let action = "status";
    if (lowerTask.includes("commit")) action = "commit";
    else if (lowerTask.includes("merge")) action = "merge";
    else if (lowerTask.includes("branch")) action = "branch";
    else if (lowerTask.includes("release")) action = "release";
    else if (lowerTask.includes("deploy")) action = "deploy";
    else if (lowerTask.includes("pipeline")) action = "pipeline";

    // Extract specific parameters
    const branchMatch = task.match(/branch[:\s]+([^\s]+)/i);
    const targetBranch = branchMatch ? branchMatch[1] : undefined;
    
    const messageMatch = task.match(/message[:\s]+"([^"]+)"/i) || task.match(/message[:\s]+([^\n]+)/i);
    const commitMessage = messageMatch ? messageMatch[1] : undefined;
    
    const versionMatch = task.match(/version[:\s]+([^\s]+)/i) || task.match(/v(\d+\.\d+\.\d+)/i);
    const releaseVersion = versionMatch ? versionMatch[1] : undefined;

    const plan = {
      action,
      phases: [] as string[],
      includeStatusCheck: true, // Always check status first
      includeGitWorkflow: ["commit", "merge", "branch"].includes(action),
      includeRelease: action === "release" || lowerTask.includes("tag"),
      includePipeline: action === "pipeline" || lowerTask.includes("ci") || lowerTask.includes("cd"),
      includeDeployment: action === "deploy" || lowerTask.includes("deployment"),
      workflowType: this.gitWorkflow.type,
      targetBranch,
      commitMessage,
      releaseVersion,
      files: this.extractFilesList(task)
    };

    // Build phase list
    if (plan.includeStatusCheck) plan.phases.push("Status Check");
    if (plan.includeGitWorkflow) plan.phases.push("Git Workflow");
    if (plan.includeRelease) plan.phases.push("Release Automation");
    if (plan.includePipeline) plan.phases.push("Pipeline Creation");
    if (plan.includeDeployment) plan.phases.push("Deployment");

    return plan;
  }

  private extractFilesList(task: string): string[] {
    const fileMatches = task.match(/files?[:\s]+([^\n]+)/i);
    if (fileMatches) {
      return fileMatches[1].split(/[,\s]+/).filter(f => f.trim().length > 0);
    }
    return [];
  }

  private parseGitStatus(statusOutput: string): {
    summary: string;
    staged: string[];
    modified: string[];
    untracked: string[];
    clean: boolean;
    branch: string;
    ahead: number;
    behind: number;
  } {
    const lines = statusOutput.split('\n');
    const result = {
      summary: "",
      staged: [] as string[],
      modified: [] as string[],
      untracked: [] as string[],
      clean: false,
      branch: "unknown",
      ahead: 0,
      behind: 0
    };

    for (const line of lines) {
      if (line.includes('On branch')) {
        const branchMatch = line.match(/On branch (.+)/);
        if (branchMatch) result.branch = branchMatch[1];
      }
      
      if (line.includes('ahead')) {
        const aheadMatch = line.match(/ahead (\d+)/);
        if (aheadMatch) result.ahead = parseInt(aheadMatch[1]);
      }
      
      if (line.includes('behind')) {
        const behindMatch = line.match(/behind (\d+)/);
        if (behindMatch) result.behind = parseInt(behindMatch[1]);
      }

      if (line.startsWith('\tmodified:')) {
        result.modified.push(line.trim().replace('modified:', '').trim());
      } else if (line.startsWith('\tnew file:')) {
        result.staged.push(line.trim().replace('new file:', '').trim());
      } else if (line.startsWith('\t') && !line.includes(':')) {
        result.untracked.push(line.trim());
      }
    }

    result.clean = result.staged.length === 0 && result.modified.length === 0 && result.untracked.length === 0;
    result.summary = result.clean ? 
      `Clean working tree on ${result.branch}` : 
      `${result.modified.length + result.staged.length + result.untracked.length} changes on ${result.branch}`;

    return result;
  }

  private async executeGitWorkflow(
    plan: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    switch (plan.action) {
      case "commit":
        await this.executeCommitWorkflow(plan, actions, chatSession, progressCallback);
        break;
      case "merge":
        await this.executeMergeWorkflow(plan, actions, chatSession, progressCallback);
        break;
      case "branch":
        await this.executeBranchWorkflow(plan, actions, chatSession, progressCallback);
        break;
    }
  }

  private async executeCommitWorkflow(
    plan: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    try {
      // Add files if specified
      if (plan.files && plan.files.length > 0) {
        progressCallback?.onAction?.("git_add", { files: plan.files });
        
        const addResult = await this.toolManager.executeTool("git_add", {
          files: plan.files
        });
        
        actions.push({
          thought: `Added files to staging: ${plan.files.join(", ")}`,
          toolCall: chatSession.recordToolCall("git_add", { files: plan.files }, addResult),
          observation: "Files staged successfully",
          timestamp: new Date()
        });
      } else {
        // Add all changes
        progressCallback?.onAction?.("git_add", { files: ["."] });
        
        const addResult = await this.toolManager.executeTool("git_add", {
          files: ["."]
        });
        
        actions.push({
          thought: "Added all changes to staging",
          toolCall: chatSession.recordToolCall("git_add", { files: ["."] }, addResult),
          observation: "All changes staged successfully",
          timestamp: new Date()
        });
      }

      // Create commit
      const commitMessage = plan.commitMessage || "feat: automated commit via DevOps agent";
      progressCallback?.onAction?.("git_commit", { message: commitMessage });
      
      const commitResult = await this.toolManager.executeTool("git_commit", {
        message: commitMessage
      });
      
      progressCallback?.onActionResult?.("Commit created successfully");
      
      actions.push({
        thought: "Created commit with staged changes",
        toolCall: chatSession.recordToolCall("git_commit", { message: commitMessage }, commitResult),
        observation: "Commit created successfully",
        timestamp: new Date()
      });

    } catch (error) {
      logger.warn("[DEVOPS_AGENT] Commit workflow failed:", error);
      progressCallback?.onActionResult?.("", `Commit workflow failed: ${error}`);
    }
  }

  private async executeMergeWorkflow(
    plan: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    // Implementation for merge workflow
    logger.info("[DEVOPS_AGENT] Merge workflow execution - placeholder implementation");
  }

  private async executeBranchWorkflow(
    plan: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    try {
      if (plan.targetBranch) {
        progressCallback?.onAction?.("git_branch", { branchName: plan.targetBranch });
        
        const branchResult = await this.toolManager.executeTool("git_branch", {
          branchName: plan.targetBranch,
          checkout: true
        });
        
        progressCallback?.onActionResult?.(`Switched to branch: ${plan.targetBranch}`);
        
        actions.push({
          thought: `Created and switched to branch: ${plan.targetBranch}`,
          toolCall: chatSession.recordToolCall("git_branch", { branchName: plan.targetBranch }, branchResult),
          observation: "Branch operation completed successfully",
          timestamp: new Date()
        });
      }
    } catch (error) {
      logger.warn("[DEVOPS_AGENT] Branch workflow failed:", error);
      progressCallback?.onActionResult?.("", `Branch workflow failed: ${error}`);
    }
  }

  private async executeReleaseAutomation(
    plan: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    logger.info("[DEVOPS_AGENT] Release automation - placeholder implementation");
  }

  private async createCICDPipeline(
    plan: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    logger.info("[DEVOPS_AGENT] CI/CD pipeline creation - placeholder implementation");
  }

  private async executeDeployment(
    plan: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    logger.info("[DEVOPS_AGENT] Deployment execution - placeholder implementation");
  }

  private async generateDevOpsReport(
    task: string,
    results: any,
    plan: any
  ): Promise<{
    summary: string;
    recommendations: string[];
  }> {
    let summary = `DevOps operation completed: ${plan.action}. `;
    const recommendations: string[] = [];

    if (results.gitStatus) {
      if (results.gitStatus.clean) {
        summary += "Repository is clean. ";
        recommendations.push("Consider setting up automated workflows for consistency");
      } else {
        summary += `${results.gitStatus.modified.length + results.gitStatus.staged.length} changes processed. `;
        recommendations.push("Maintain regular commit practices");
      }
    }

    if (plan.includeRelease) {
      recommendations.push("Follow semantic versioning for releases");
      recommendations.push("Generate automated changelogs");
    }

    if (plan.includePipeline) {
      recommendations.push("Set up automated testing in CI/CD pipeline");
      recommendations.push("Implement deployment safeguards and rollback procedures");
    }

    return { summary, recommendations };
  }

  public getPromptTemplates(): Record<string, string> {
    return {
      gitWorkflow: `You are a DevOps engineer managing Git workflows and version control.
        Follow best practices for:
        1. Branching strategies and merge policies
        2. Commit message conventions
        3. Code review processes
        4. Release management
        5. Repository maintenance
        
        Ensure operations are safe and follow established workflows.`,
      
      cicdPipeline: `You are a CI/CD specialist creating automated pipelines.
        Design pipelines that include:
        1. Automated testing and quality gates
        2. Security scanning and compliance checks
        3. Build optimization and caching
        4. Deployment automation with rollback capabilities
        5. Monitoring and alerting integration
        
        Focus on reliability, speed, and maintainability.`,
      
      deployment: `You are a deployment automation expert.
        Implement safe deployment strategies:
        1. Zero-downtime deployment techniques
        2. Environment parity and configuration management
        3. Health checks and monitoring
        4. Rollback and disaster recovery procedures
        5. Security and compliance requirements
        
        Prioritize safety and reliability over speed.`
    };
  }
}