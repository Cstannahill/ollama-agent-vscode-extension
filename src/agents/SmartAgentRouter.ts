import {
  IAgent,
  AgentSpecialization,
  TaskAnalysis,
  AgentResponse,
  ProgressCallback,
} from "./IAgent";
import { AgentFactory } from "./AgentFactory";
import { OllamaLLM } from "../api/ollama";
import { logger } from "../utils/logger";
import { robustJSON } from "../utils/RobustJSONParser";

export interface AgentCapabilityDescription {
  specialization: AgentSpecialization;
  displayName: string;
  capabilities: string[];
  bestFor: string[];
  limitations: string[];
  confidenceFactors: string[];
}

export interface RouterDecision {
  selectedAgent: AgentSpecialization;
  confidence: number;
  reasoning: string[];
  alternatives: Array<{
    agent: AgentSpecialization;
    confidence: number;
    reason: string;
  }>;
  shouldUseMultiAgent: boolean;
  coordinationStrategy?: string;
}

/**
 * Intelligent agent router that uses LLM reasoning to select the best agent
 * for a given task, replacing keyword-based matching with smart analysis
 */
export class SmartAgentRouter {
  private llm: OllamaLLM;
  private agentCapabilities: Map<
    AgentSpecialization,
    AgentCapabilityDescription
  >;

  constructor(
    ollamaUrl: string,
    model: string,
    private agentFactory: AgentFactory
  ) {
    this.llm = new OllamaLLM({
      baseUrl: ollamaUrl,
      model: model,
      temperature: 0.1, // Low temperature for consistent routing decisions
    });

    this.agentCapabilities = new Map();
    this.initializeAgentCapabilities();
  }

  /**
   * Route a task to the most appropriate agent using LLM reasoning
   */
  async routeTask(
    task: string,
    context?: any,
    progressCallback?: ProgressCallback
  ): Promise<RouterDecision> {
    const timeoutMs = 15000; // 15 second timeout
    const startTime = Date.now();
    try {
      logger.info(`[SMART_ROUTER] Routing task: ${task.substring(0, 100)}...`);
      progressCallback?.onThought?.(
        "🧠 Analyzing task with smart agent router..."
      );

      const routerPrompt = this.buildRouterPrompt(task, context);
      logger.info(`[SMART_ROUTER] Router prompt sent to LLM:\n${routerPrompt}`);

      // Add timeout to LLM call
      const llmResponsePromise = this.llm.generateText(routerPrompt);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Router timeout")), timeoutMs);
      });

      progressCallback?.onThought?.("⏳ Waiting for LLM routing decision...");
      let llmResponse: string;
      try {
        llmResponse = await Promise.race([llmResponsePromise, timeoutPromise]);
      } catch (err) {
        const duration = Date.now() - startTime;
        logger.error(
          `[SMART_ROUTER] LLM call failed or timed out after ${duration}ms:`,
          err
        );
        throw err;
      }

      const duration = Date.now() - startTime;
      logger.info(
        `[SMART_ROUTER] LLM response received in ${duration}ms:\n${llmResponse}`
      );
      progressCallback?.onThought?.("📝 Parsing routing decision...");

      let decision: RouterDecision | null = null;
      try {
        decision = this.parseRouterDecision(llmResponse);
      } catch (parseErr) {
        logger.error(`[SMART_ROUTER] Error parsing router decision:`, parseErr);
        logger.error(
          `[SMART_ROUTER] Raw LLM response for debugging:\n${llmResponse}`
        );
      }

      if (!decision) {
        logger.warn(
          "[SMART_ROUTER] Failed to parse LLM decision, using fallback"
        );
        logger.error(
          `[SMART_ROUTER] Fallback reason: Decision parsing failed. Raw response:\n${llmResponse}`
        );
        progressCallback?.onThought?.(
          "⚠️ Router parsing failed, using keyword fallback..."
        );
        return this.getFallbackDecision(task);
      }

      logger.info(
        `[SMART_ROUTER] Selected ${decision.selectedAgent} with confidence ${decision.confidence}`
      );
      progressCallback?.onThought?.(
        `✅ Selected ${decision.selectedAgent} agent (confidence: ${Math.round(
          decision.confidence * 100
        )}%)`
      );
      return decision;
    } catch (error) {
      const duration = Date.now() - startTime;
      if (error instanceof Error && error.message === "Router timeout") {
        logger.warn(
          `[SMART_ROUTER] Router timed out after ${duration}ms, using fallback`
        );
        logger.error(
          `[SMART_ROUTER] Fallback reason: Timeout after ${duration}ms`
        );
        progressCallback?.onThought?.(
          "⏰ Router timed out, using fast keyword fallback..."
        );
      } else {
        logger.error(
          `[SMART_ROUTER] Routing failed after ${duration}ms:`,
          error
        );
        logger.error(
          `[SMART_ROUTER] Fallback reason: Exception thrown during routing.`
        );
        progressCallback?.onThought?.(
          "❌ Router failed, using keyword fallback..."
        );
      }
      return this.getFallbackDecision(task);
    }
  }

  /**
   * Get the best agent based on router decision
   */
  async getBestAgent(
    task: string,
    context?: any,
    progressCallback?: ProgressCallback
  ): Promise<{
    agent: IAgent;
    analysis: TaskAnalysis;
    decision: RouterDecision;
  }> {
    const decision = await this.routeTask(task, context, progressCallback);

    // Get the selected agent
    const agent = this.agentFactory.getAgentSync(decision.selectedAgent);
    if (!agent) {
      throw new Error(`Agent ${decision.selectedAgent} not available`);
    }

    // Get task analysis from the selected agent
    const analysis = await agent.canHandle(task, context);

    // Boost confidence based on router decision
    const boostedAnalysis: TaskAnalysis = {
      ...analysis,
      confidence: Math.max(analysis.confidence, decision.confidence),
      reasoningSteps: [...decision.reasoning, ...analysis.reasoningSteps],
    };

    return {
      agent,
      analysis: boostedAnalysis,
      decision,
    };
  }

  /**
   * Build the routing prompt for the LLM
   */
  private buildRouterPrompt(task: string, context?: any): string {
    const agentDescriptions = Array.from(this.agentCapabilities.values())
      .map(
        (desc) => `
**${desc.displayName} (${desc.specialization})**
- Capabilities: ${desc.capabilities.join(", ")}
- Best for: ${desc.bestFor.join(", ")}
- Limitations: ${desc.limitations.join(", ")}
- High confidence when: ${desc.confidenceFactors.join(", ")}
`
      )
      .join("\n");

    const contextInfo = context
      ? `
**Context Information:**
- File path: ${context.filePath || "None"}
- Project type: ${context.projectType || "Unknown"}
- Additional context: ${JSON.stringify(context, null, 2)}
`
      : "";

    return `You are an expert AI agent router. Your job is to analyze a task and select the most appropriate specialized agent to handle it.

**Available Agents:**
${agentDescriptions}

**Task to Route:**
"${task}"
${contextInfo}

**Instructions:**
Analyze the task carefully and determine:
1. Which agent is best suited for this task
2. Your confidence level (0-1)
3. Whether multiple agents might be needed
4. Your reasoning process

Respond with ONLY a JSON object in this exact format:
{
  "selectedAgent": "agent_specialization_here",
  "confidence": 0.85,
  "reasoning": [
    "Specific reason 1",
    "Specific reason 2", 
    "Specific reason 3"
  ],
  "alternatives": [
    {
      "agent": "alternative_agent",
      "confidence": 0.6,
      "reason": "Why this could also work"
    }
  ],
  "shouldUseMultiAgent": false,
  "coordinationStrategy": "sequential|parallel|conditional|none"
}

Focus on:
- The primary action requested (create, analyze, test, deploy, etc.)
- The domain/technology involved (files, git, code quality, etc.) 
- The complexity and scope of the task
- Any specific tools or expertise required

Choose the agent with the highest likelihood of successfully completing the task.`;
  }

  /**
   * Parse the LLM's routing decision
   */
  private parseRouterDecision(response: string): RouterDecision | null {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true,
      logLevel: "debug",
    });

    if (!parseResult.success) {
      logger.warn(
        `[SMART_ROUTER] Failed to parse LLM decision: ${parseResult.error}`
      );
      return null;
    }

    const data = parseResult.data;

    // Validate required fields
    if (!data.selectedAgent || typeof data.confidence !== "number") {
      logger.warn("[SMART_ROUTER] Invalid decision format from LLM");
      return null;
    }

    // Validate agent exists
    if (!this.agentCapabilities.has(data.selectedAgent)) {
      logger.warn(
        `[SMART_ROUTER] Unknown agent selected: ${data.selectedAgent}`
      );
      return null;
    }

    return {
      selectedAgent: data.selectedAgent,
      confidence: Math.max(0, Math.min(1, data.confidence)),
      reasoning: Array.isArray(data.reasoning)
        ? data.reasoning
        : ["LLM routing decision"],
      alternatives: Array.isArray(data.alternatives) ? data.alternatives : [],
      shouldUseMultiAgent: Boolean(data.shouldUseMultiAgent),
      coordinationStrategy: data.coordinationStrategy || "none",
    };
  }

  /**
   * Get fallback decision when LLM routing fails
   */
  private getFallbackDecision(task: string): RouterDecision {
    const taskLower = task.toLowerCase();

    // Simple heuristics as fallback
    let selectedAgent = AgentSpecialization.GENERAL;
    let confidence = 0.3;

    if (taskLower.includes("test")) {
      selectedAgent = AgentSpecialization.TEST_AUTOMATION;
      confidence = 0.6;
    } else if (taskLower.includes("git") || taskLower.includes("deploy")) {
      selectedAgent = AgentSpecialization.DEVOPS;
      confidence = 0.6;
    } else if (
      taskLower.includes("refactor") ||
      taskLower.includes("improve")
    ) {
      selectedAgent = AgentSpecialization.REFACTORING;
      confidence = 0.6;
    } else if (taskLower.includes("review") || taskLower.includes("analyze")) {
      selectedAgent = AgentSpecialization.CODE_REVIEW;
      confidence = 0.6;
    } else if (taskLower.includes("document") || taskLower.includes("readme")) {
      selectedAgent = AgentSpecialization.DOCUMENTATION;
      confidence = 0.6;
    }

    return {
      selectedAgent,
      confidence,
      reasoning: ["Fallback heuristic routing due to LLM parsing failure"],
      alternatives: [],
      shouldUseMultiAgent: false,
    };
  }

  /**
   * Initialize agent capability descriptions
   */
  private initializeAgentCapabilities(): void {
    this.agentCapabilities.set(AgentSpecialization.GENERAL, {
      specialization: AgentSpecialization.GENERAL,
      displayName: "General Purpose Agent",
      capabilities: [
        "General programming tasks",
        "File operations",
        "Basic analysis",
        "Multi-domain problem solving",
      ],
      bestFor: [
        "Mixed tasks requiring multiple skills",
        "Exploratory programming",
        "General file manipulation",
        "Tasks that don't fit specific domains",
      ],
      limitations: [
        "May lack deep specialization",
        "Less optimized for specific workflows",
      ],
      confidenceFactors: [
        "Task involves multiple domains",
        "General programming requested",
        "No specific expertise required",
      ],
    });

    this.agentCapabilities.set(AgentSpecialization.CODE_REVIEW, {
      specialization: AgentSpecialization.CODE_REVIEW,
      displayName: "Code Review Agent",
      capabilities: [
        "Code quality analysis",
        "Security vulnerability detection",
        "Performance optimization suggestions",
        "Best practices enforcement",
        "Architectural review",
      ],
      bestFor: [
        "Code quality assessment",
        "Security audits",
        "Performance analysis",
        "Architecture evaluation",
        "Code review workflows",
      ],
      limitations: [
        "Doesn't write new code",
        "Focus on analysis over implementation",
      ],
      confidenceFactors: [
        "Task mentions 'review', 'analyze', 'check', 'audit'",
        "Security or quality concerns",
        "Code evaluation needed",
      ],
    });

    this.agentCapabilities.set(AgentSpecialization.TEST_AUTOMATION, {
      specialization: AgentSpecialization.TEST_AUTOMATION,
      displayName: "Test Automation Agent",
      capabilities: [
        "Test case generation",
        "Test automation setup",
        "Coverage analysis",
        "TDD workflows",
        "Test debugging",
      ],
      bestFor: [
        "Creating unit tests",
        "Integration testing",
        "Test coverage improvement",
        "TDD implementation",
        "Test framework setup",
      ],
      limitations: [
        "Focused on testing, not production code",
        "May not handle complex business logic",
      ],
      confidenceFactors: [
        "Task mentions 'test', 'testing', 'coverage'",
        "TDD or testing workflow requested",
        "Test automation needed",
      ],
    });

    this.agentCapabilities.set(AgentSpecialization.DEVOPS, {
      specialization: AgentSpecialization.DEVOPS,
      displayName: "DevOps Agent",
      capabilities: [
        "Git operations",
        "CI/CD pipeline setup",
        "Deployment automation",
        "Infrastructure management",
        "Build optimization",
      ],
      bestFor: [
        "Git workflows",
        "Deployment processes",
        "CI/CD configuration",
        "Build systems",
        "Infrastructure tasks",
      ],
      limitations: [
        "Limited application logic understanding",
        "Focus on operations over development",
      ],
      confidenceFactors: [
        "Task involves git, deploy, build, CI/CD",
        "Infrastructure or operations focus",
        "Deployment or release management",
      ],
    });

    this.agentCapabilities.set(AgentSpecialization.DOCUMENTATION, {
      specialization: AgentSpecialization.DOCUMENTATION,
      displayName: "Documentation Agent",
      capabilities: [
        "README generation",
        "API documentation",
        "Code commenting",
        "User guides creation",
        "Technical writing",
      ],
      bestFor: [
        "Creating documentation",
        "README files",
        "API documentation",
        "User guides",
        "Code commenting",
      ],
      limitations: [
        "Doesn't implement features",
        "Focus on documentation over code",
      ],
      confidenceFactors: [
        "Task mentions 'document', 'readme', 'docs'",
        "Documentation creation needed",
        "Writing or explanation focus",
      ],
    });

    this.agentCapabilities.set(AgentSpecialization.REFACTORING, {
      specialization: AgentSpecialization.REFACTORING,
      displayName: "Refactoring Agent",
      capabilities: [
        "Code structure improvement",
        "Performance optimization",
        "Design pattern implementation",
        "Code cleanup",
        "Architecture enhancement",
      ],
      bestFor: [
        "Code refactoring",
        "Performance improvements",
        "Code cleanup",
        "Architecture changes",
        "Legacy code modernization",
      ],
      limitations: [
        "May require extensive testing",
        "Risk of breaking existing functionality",
      ],
      confidenceFactors: [
        "Task mentions 'refactor', 'improve', 'optimize'",
        "Code quality improvement needed",
        "Architecture changes requested",
      ],
    });

    logger.info(
      `[SMART_ROUTER] Initialized ${this.agentCapabilities.size} agent capability descriptions`
    );
  }

  /**
   * Get all available agent capabilities
   */
  getAgentCapabilities(): AgentCapabilityDescription[] {
    return Array.from(this.agentCapabilities.values());
  }

  /**
   * Update agent capabilities (for dynamic learning)
   */
  updateAgentCapabilities(
    updates: Partial<
      Record<AgentSpecialization, Partial<AgentCapabilityDescription>>
    >
  ): void {
    for (const [specialization, update] of Object.entries(updates)) {
      const existing = this.agentCapabilities.get(
        specialization as AgentSpecialization
      );
      if (existing && update) {
        this.agentCapabilities.set(specialization as AgentSpecialization, {
          ...existing,
          ...update,
        });
      }
    }
  }
}
