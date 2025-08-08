/**
 * Task Planner Agent - CAMEL-AI, AutoGPT-style task planning and decomposition
 * 
 * Implements sophisticated task planning using CAMEL-AI and AutoGPT patterns
 * for breaking down complex tasks into executable steps with dependencies.
 */

import { logger } from "../../../utils/logger";
import { OllamaLLM } from "../../../api/ollama";
import { ContextManager } from "../../ContextManager";
import { VectorDatabase } from "../../../documentation/VectorDatabase";
import { robustJSON } from "../../../utils/RobustJSONParser";
import {
  ITaskPlannerAgent,
  TaskPlan,
  TaskStep,
  Workflow,
  PlanningContext,
  FoundationAgentConfig
} from "../IFoundationAgent";

export class TaskPlannerAgent implements ITaskPlannerAgent {
  public readonly name = "TaskPlannerAgent";
  public readonly modelSize = "1-7B";

  private llm: OllamaLLM;
  private contextManager?: ContextManager;
  private vectorDB?: VectorDatabase;
  private initialized = false;
  private config: FoundationAgentConfig;

  constructor(
    ollamaUrl: string,
    model: string,
    contextManager?: ContextManager,
    vectorDB?: VectorDatabase,
    config?: Partial<FoundationAgentConfig>
  ) {
    this.config = {
      modelSize: '1-7B',
      temperature: 0.4, // Moderate temperature for creative planning
      maxTokens: 2000,
      timeout: 45000,
      ...config
    };

    this.contextManager = contextManager;
    this.vectorDB = vectorDB;

    this.llm = new OllamaLLM({
      baseUrl: ollamaUrl,
      model: model,
      temperature: this.config.temperature,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      logger.info("[TASK_PLANNER_AGENT] Initializing task planner agent...");
      
      // Test LLM connection with timeout and graceful fallback
      try {
        const testResponse = await Promise.race([
          this.llm.generateText("Create a simple 2-step plan for organizing files"),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("LLM test timeout")), 5000)
          )
        ]);
        logger.debug("[TASK_PLANNER_AGENT] LLM connection test successful");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 
          (typeof error === 'object' && error !== null) ? JSON.stringify(error) : String(error);
        logger.warn(`[TASK_PLANNER_AGENT] LLM test failed, continuing with degraded functionality: ${errorMessage}`);
        // Don't throw here - allow the agent to initialize with limited functionality
      }
      
      this.initialized = true;
      logger.info("[TASK_PLANNER_AGENT] Task planner agent initialized successfully");
    } catch (error) {
      logger.error("[TASK_PLANNER_AGENT] Failed to initialize:", error);
      // Still mark as initialized to prevent blocking the pipeline
      this.initialized = true;
      logger.warn("[TASK_PLANNER_AGENT] Marked as initialized with degraded functionality");
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCapabilities(): string[] {
    return [
      "CAMEL-AI style task decomposition",
      "AutoGPT workflow planning",
      "Dependency analysis and resolution",
      "Risk assessment and mitigation",
      "Success criteria definition",
      "Hierarchical task structuring"
    ];
  }

  /**
   * Plan a task using CAMEL-AI and AutoGPT patterns
   */
  async planTask(prompt: string, context?: PlanningContext): Promise<TaskPlan> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`[TASK_PLANNER_AGENT] Planning task: ${prompt.substring(0, 100)}...`);

      // Enhanced context-aware planning
      const enhancedContext = await this.enrichPlanningContext(prompt, context);
      const planningPrompt = this.buildPlanningPrompt(prompt, enhancedContext);
      const response = await this.llm.generateText(planningPrompt);

      const taskPlan = this.parsePlanningResponse(response, prompt);
      
      // Validate and enhance the plan using context
      const validatedPlan = await this.validateAndEnhancePlan(taskPlan, enhancedContext);
      
      logger.debug(`[TASK_PLANNER_AGENT] Generated context-aware plan with ${validatedPlan.steps.length} steps`);
      return validatedPlan;

    } catch (error) {
      logger.error("[TASK_PLANNER_AGENT] Task planning failed:", error);
      
      return {
        goal: prompt,
        steps: [{
          id: "fallback_step",
          description: `Complete task: ${prompt}`,
          action: "manual_execution",
          parameters: { task: prompt },
          dependencies: [],
          estimatedTime: 30,
          priority: 'medium',
          validation: "Task completion verification"
        }],
        estimatedDuration: 30,
        dependencies: [],
        riskFactors: [`Planning failed: ${error instanceof Error ? error.message : String(error)}`],
        successCriteria: ["Task completed successfully"]
      };
    }
  }

  /**
   * Decompose a task into executable steps
   */
  async decomposeTask(task: string, maxSteps: number = 10): Promise<TaskStep[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const decompositionPrompt = this.buildDecompositionPrompt(task, maxSteps);
      const response = await this.llm.generateText(decompositionPrompt);

      return this.parseDecompositionResponse(response, task);

    } catch (error) {
      logger.error("[TASK_PLANNER_AGENT] Task decomposition failed:", error);
      
      return [{
        id: "fallback_decomposition",
        description: `Execute task: ${task}`,
        action: "direct_execution",
        parameters: { originalTask: task },
        dependencies: [],
        estimatedTime: 20,
        priority: 'medium'
      }];
    }
  }

  /**
   * Generate a workflow for a specific goal
   */
  async generateWorkflow(goal: string, constraints?: string[]): Promise<Workflow> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const workflowPrompt = this.buildWorkflowPrompt(goal, constraints);
      const response = await this.llm.generateText(workflowPrompt);

      return this.parseWorkflowResponse(response, goal);

    } catch (error) {
      logger.error("[TASK_PLANNER_AGENT] Workflow generation failed:", error);
      
      return {
        name: `Workflow for ${goal}`,
        description: `Auto-generated workflow to achieve: ${goal}`,
        steps: [{
          id: "workflow_step_1",
          description: `Execute goal: ${goal}`,
          action: "goal_execution",
          parameters: { goal },
          dependencies: [],
          estimatedTime: 30,
          priority: 'high'
        }],
        triggers: ["manual_start"],
        outputs: ["goal_achieved"]
      };
    }
  }

  /**
   * Build comprehensive planning prompt using CAMEL-AI patterns
   */
  private buildPlanningPrompt(prompt: string, context?: PlanningContext): string {
    const contextInfo = context ? `
**Available Tools:** ${context.availableTools?.join(', ') || 'Not specified'}
**Workspace Info:** ${JSON.stringify(context.workspaceInfo || {}, null, 2)}
**Previous Results:** ${context.previousResults?.length || 0} previous results available
**Time Constraints:** ${context.timeConstraints || 'No specific constraints'}` : '';

    return `You are an expert task planner using CAMEL-AI and AutoGPT methodologies. Create a comprehensive execution plan.

**Task to Plan:** "${prompt}"
${contextInfo}

**Planning Framework (CAMEL-AI Style):**

1. **Goal Analysis**: Break down the main objective
2. **Step Decomposition**: Identify all necessary sub-tasks
3. **Dependency Mapping**: Determine execution order and prerequisites
4. **Resource Assessment**: Consider available tools and constraints
5. **Risk Analysis**: Identify potential failure points
6. **Success Metrics**: Define clear completion criteria

**AutoGPT Planning Principles:**
- Each step should be atomic and verifiable
- Include clear action types and parameters
- Estimate realistic timeframes
- Consider parallel execution opportunities
- Plan for error handling and recovery

**Respond in JSON format:**
{
  "goal": "Clear statement of the main objective",
  "steps": [
    {
      "id": "unique_step_id",
      "description": "What this step accomplishes",
      "action": "specific_action_type",
      "parameters": {
        "key": "value",
        "details": "execution_specifics"
      },
      "dependencies": ["list_of_prerequisite_step_ids"],
      "estimatedTime": 15,
      "priority": "high|medium|low",
      "validation": "How to verify completion"
    }
  ],
  "estimatedDuration": 120,
  "dependencies": ["external_requirements"],
  "riskFactors": [
    "Potential issue 1",
    "Potential issue 2"
  ],
  "successCriteria": [
    "Measurable outcome 1",
    "Measurable outcome 2"
  ],
  "executionStrategy": "sequential|parallel|hybrid",
  "fallbackOptions": ["alternative approaches"]
}`;
  }

  /**
   * Build task decomposition prompt
   */
  private buildDecompositionPrompt(task: string, maxSteps: number): string {
    return `Decompose this complex task into ${maxSteps} or fewer executable steps.

**Task:** "${task}"

**Decomposition Guidelines:**
- Each step should be specific and actionable
- Steps should build logically toward the goal
- Include clear dependencies between steps
- Estimate realistic completion times
- Assign appropriate priorities

**Respond with JSON array of steps:**
[
  {
    "id": "step_1",
    "description": "First actionable step",
    "action": "action_type",
    "parameters": {"param": "value"},
    "dependencies": [],
    "estimatedTime": 10,
    "priority": "high"
  }
]`;
  }

  /**
   * Build workflow generation prompt
   */
  private buildWorkflowPrompt(goal: string, constraints?: string[]): string {
    const constraintsList = constraints?.length ? `
**Constraints:**
${constraints.map(c => `- ${c}`).join('\n')}` : '';

    return `Create a reusable workflow to achieve this goal.

**Goal:** "${goal}"
${constraintsList}

**Workflow Design:**
- Define clear triggers for workflow initiation
- Structure steps for reusability and maintainability
- Include outputs and success indicators
- Consider automation opportunities

**Respond in JSON format:**
{
  "name": "Workflow Name",
  "description": "What this workflow accomplishes",
  "steps": [
    {
      "id": "workflow_step_id",
      "description": "Step description",
      "action": "action_type",
      "parameters": {},
      "dependencies": [],
      "estimatedTime": 15,
      "priority": "medium"
    }
  ],
  "triggers": ["trigger_condition_1", "trigger_condition_2"],
  "outputs": ["expected_output_1", "expected_output_2"],
  "metadata": {
    "version": "1.0",
    "category": "workflow_category"
  }
}`;
  }

  /**
   * Parse planning response from LLM
   */
  private parsePlanningResponse(response: string, originalPrompt: string): TaskPlan {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        goal: data.goal || originalPrompt,
        steps: this.normalizeSteps(data.steps),
        estimatedDuration: parseInt(data.estimatedDuration) || 60,
        dependencies: Array.isArray(data.dependencies) ? data.dependencies : [],
        riskFactors: Array.isArray(data.riskFactors) ? data.riskFactors : [],
        successCriteria: Array.isArray(data.successCriteria) ? data.successCriteria : ["Task completed"]
      };
    }

    // Fallback parsing
    return this.fallbackParsePlan(response, originalPrompt);
  }

  /**
   * Parse decomposition response
   */
  private parseDecompositionResponse(response: string, originalTask: string): TaskStep[] {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      const steps = Array.isArray(data) ? data : (Array.isArray(data.steps) ? data.steps : []);
      return this.normalizeSteps(steps);
    }

    // Fallback: create simple steps
    return [{
      id: "decomp_step_1",
      description: `Break down and execute: ${originalTask}`,
      action: "task_analysis",
      parameters: { task: originalTask },
      dependencies: [],
      estimatedTime: 30,
      priority: 'medium'
    }];
  }

  /**
   * Parse workflow response
   */
  private parseWorkflowResponse(response: string, originalGoal: string): Workflow {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        name: data.name || `Workflow for ${originalGoal}`,
        description: data.description || `Generated workflow to achieve: ${originalGoal}`,
        steps: this.normalizeSteps(data.steps),
        triggers: Array.isArray(data.triggers) ? data.triggers : ["manual_start"],
        outputs: Array.isArray(data.outputs) ? data.outputs : ["workflow_completed"]
      };
    }

    // Fallback workflow
    return {
      name: `Workflow: ${originalGoal}`,
      description: `Auto-generated workflow for: ${originalGoal}`,
      steps: [{
        id: "workflow_main",
        description: originalGoal,
        action: "execute_goal",
        parameters: { goal: originalGoal },
        dependencies: [],
        estimatedTime: 45,
        priority: 'high'
      }],
      triggers: ["manual_trigger"],
      outputs: ["goal_completion"]
    };
  }

  /**
   * Validate and enhance the generated plan
   */
  private async validateAndEnhancePlan(plan: TaskPlan, context?: PlanningContext): Promise<TaskPlan> {
    try {
      // Add step IDs if missing
      const enhancedSteps = plan.steps.map((step, index) => ({
        ...step,
        id: step.id || `step_${index + 1}`
      }));

      // Validate dependencies
      const validatedSteps = this.validateDependencies(enhancedSteps);

      // Calculate realistic duration
      const totalDuration = validatedSteps.reduce((sum, step) => sum + (step.estimatedTime || 15), 0);

      return {
        ...plan,
        steps: validatedSteps,
        estimatedDuration: Math.max(plan.estimatedDuration, totalDuration),
        riskFactors: [
          ...plan.riskFactors,
          ...(validatedSteps.length > 10 ? ["High complexity - many steps"] : []),
          ...(totalDuration > 180 ? ["Long execution time"] : [])
        ]
      };

    } catch (error) {
      logger.warn("[TASK_PLANNER_AGENT] Plan validation failed:", error);
      return plan; // Return unvalidated plan
    }
  }

  /**
   * Normalize and validate task steps
   */
  private normalizeSteps(steps: any[]): TaskStep[] {
    if (!Array.isArray(steps)) return [];

    return steps.map((step, index) => ({
      id: step.id || `step_${index + 1}`,
      description: step.description || `Task step ${index + 1}`,
      action: step.action || "manual_action",
      parameters: step.parameters || {},
      dependencies: Array.isArray(step.dependencies) ? step.dependencies : [],
      estimatedTime: Math.max(1, parseInt(step.estimatedTime) || 15),
      priority: this.normalizePriority(step.priority),
      validation: step.validation || "Manual verification required"
    }));
  }

  /**
   * Validate step dependencies
   */
  private validateDependencies(steps: TaskStep[]): TaskStep[] {
    const stepIds = new Set(steps.map(step => step.id));
    
    return steps.map(step => ({
      ...step,
      dependencies: step.dependencies.filter(depId => stepIds.has(depId))
    }));
  }

  /**
   * Normalize priority values
   */
  private normalizePriority(priority: any): 'low' | 'medium' | 'high' {
    if (!priority) return 'medium';
    
    const p = priority.toString().toLowerCase();
    if (p.includes('high') || p.includes('critical') || p.includes('urgent')) return 'high';
    if (p.includes('low') || p.includes('minor')) return 'low';
    return 'medium';
  }

  /**
   * Fallback plan parser
   */
  private fallbackParsePlan(response: string, originalPrompt: string): TaskPlan {
    // Try to extract steps from response text
    const lines = response.split('\n').filter(line => line.trim().length > 0);
    const steps: TaskStep[] = [];

    let stepId = 1;
    for (const line of lines) {
      if (line.match(/^\d+\.|\-|\*/) && line.length > 10) {
        steps.push({
          id: `fallback_step_${stepId}`,
          description: line.replace(/^\d+\.|\-|\*/, '').trim(),
          action: "manual_execution",
          parameters: {},
          dependencies: stepId > 1 ? [`fallback_step_${stepId - 1}`] : [],
          estimatedTime: 20,
          priority: 'medium'
        });
        stepId++;
      }
    }

    if (steps.length === 0) {
      steps.push({
        id: "fallback_single_step",
        description: originalPrompt,
        action: "complete_task",
        parameters: { task: originalPrompt },
        dependencies: [],
        estimatedTime: 30,
        priority: 'high'
      });
    }

    return {
      goal: originalPrompt,
      steps,
      estimatedDuration: steps.reduce((sum, step) => sum + step.estimatedTime, 0),
      dependencies: [],
      riskFactors: ["Fallback plan generation - may need refinement"],
      successCriteria: ["Task objective achieved"]
    };
  }

  /**
   * Enrich planning context with workspace knowledge and similar task patterns
   */
  private async enrichPlanningContext(prompt: string, context?: PlanningContext): Promise<PlanningContext> {
    const enrichedContext: PlanningContext = {
      availableTools: context?.availableTools || [],
      workspaceInfo: context?.workspaceInfo || {},
      projectStructure: context?.projectStructure || {},
      availableResources: context?.availableResources || [],
      constraints: context?.constraints || [],
      userPreferences: context?.userPreferences || {},
      previousResults: context?.previousResults,
      timeConstraints: context?.timeConstraints
    };

    try {
      // Enhance with context manager information
      if (this.contextManager) {
        try {
          const contextResults = await this.contextManager.searchContext({
            query: prompt,
            maxResults: 10
          });

          // Only process if we actually have results
          if (contextResults.items && contextResults.items.length > 0) {
            // Extract relevant context information
            const relevantContext = contextResults.items
              .filter(item => item.relevanceScore > 0.5)
              .map(item => ({
                type: item.type,
                content: item.content,
                relevance: item.relevanceScore
              }));

            enrichedContext.contextualInfo = relevantContext;

            // Add project structure information
            if (contextResults.items.some(item => item.type === 'project')) {
              enrichedContext.projectStructure = {
                ...enrichedContext.projectStructure,
                hasProjectContext: true,
                contextItems: relevantContext.length
              };
            }
            
            logger.debug(`[TASK_PLANNER_AGENT] Enhanced context with ${relevantContext.length} relevant items`);
          } else {
            logger.debug("[TASK_PLANNER_AGENT] No context items found, using basic context");
          }
        } catch (contextError) {
          logger.warn("[TASK_PLANNER_AGENT] Context search failed, continuing with basic context:", contextError);
          // Continue without context enhancement
        }
      }

      // Enhance with vector database patterns
      if (this.vectorDB) {
        const similarTasks = await this.vectorDB.search(prompt, {
          limit: 5,
          threshold: 0.3
        });

        if (similarTasks.length > 0) {
          enrichedContext.similarTaskPatterns = similarTasks.map(result => ({
            task: result.document.metadata.title || 'Similar task',
            approach: result.document.content.substring(0, 200),
            confidence: result.score,
            source: result.document.metadata.source
          }));
        }
      }

      logger.debug(`[TASK_PLANNER_AGENT] Enhanced context with ${enrichedContext.contextualInfo?.length || 0} context items and ${enrichedContext.similarTaskPatterns?.length || 0} similar patterns`);
      
    } catch (error) {
      logger.warn("[TASK_PLANNER_AGENT] Context enrichment failed:", error);
      // Continue with basic context
    }

    return enrichedContext;
  }
}