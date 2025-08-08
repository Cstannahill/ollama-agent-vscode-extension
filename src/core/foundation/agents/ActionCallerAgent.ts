/**
 * Action Caller Agent - Plan to API call transformation and execution
 * 
 * Implements sophisticated action generation from task plans and handles
 * function calling, parameter validation, and execution coordination.
 */

import { logger } from "../../../utils/logger";
import { OllamaLLM } from "../../../api/ollama";
import { ContextManager } from "../../ContextManager";
import { VectorDatabase } from "../../../documentation/VectorDatabase";
import { robustJSON } from "../../../utils/RobustJSONParser";
import {
  IActionCallerAgent,
  ActionCall,
  ActionValidation,
  ActionResult,
  TaskStep,
  FoundationAgentConfig
} from "../IFoundationAgent";

export class ActionCallerAgent implements IActionCallerAgent {
  public readonly name = "ActionCallerAgent";
  public readonly modelSize = "1-3B";

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
      modelSize: '1-3B',
      temperature: 0.2, // Low temperature for precise action generation
      maxTokens: 800,
      timeout: 25000,
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
      logger.info("[ACTION_CALLER_AGENT] Initializing action caller agent...");
      
      // Mark as initialized first to prevent recursive calls
      this.initialized = true;
      
      // Test with simple action generation
      const testStep: TaskStep = {
        id: "test",
        description: "test action",
        action: "test",
        parameters: {},
        dependencies: [],
        estimatedTime: 1,
        priority: 'low'
      };
      await this.generateActionCall(testStep);
      
      logger.info("[ACTION_CALLER_AGENT] Action caller agent initialized successfully");
    } catch (error) {
      // Reset initialization state on failure
      this.initialized = false;
      logger.error("[ACTION_CALLER_AGENT] Failed to initialize:", error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCapabilities(): string[] {
    return [
      "Task step to action call transformation",
      "Function call parameter generation",
      "Action validation and verification",
      "Execution orchestration",
      "Error handling and recovery",
      "Alternative action suggestion"
    ];
  }

  /**
   * Generate executable action call from task step
   */
  async generateActionCall(plan: TaskStep, context?: any): Promise<ActionCall> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`[ACTION_CALLER_AGENT] Generating action call for step: ${plan.id}`);

      const actionPrompt = this.buildActionPrompt(plan, context);
      const response = await this.llm.generateText(actionPrompt);

      const actionCall = this.parseActionResponse(response, plan);
      
      logger.debug(`[ACTION_CALLER_AGENT] Generated action call for tool: ${actionCall.toolId}`);
      return actionCall;

    } catch (error) {
      logger.error("[ACTION_CALLER_AGENT] Action call generation failed:", error);
      
      return {
        toolId: plan.action || "manual_execution",
        functionName: plan.action || "execute",
        parameters: plan.parameters || { description: plan.description },
        metadata: {
          reasoning: `Fallback action generation due to error: ${error instanceof Error ? error.message : String(error)}`,
          confidence: 0.3,
          alternatives: []
        }
      };
    }
  }

  /**
   * Validate an action call before execution
   */
  async validateActionCall(actionCall: ActionCall): Promise<ActionValidation> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const validationPrompt = this.buildValidationPrompt(actionCall);
      const response = await this.llm.generateText(validationPrompt);

      return this.parseValidationResponse(response);

    } catch (error) {
      logger.error("[ACTION_CALLER_AGENT] Action validation failed:", error);
      
      return {
        isValid: true, // Default to valid if validation fails
        issues: [`Validation failed: ${error instanceof Error ? error.message : String(error)}`],
        suggestions: ["Manual validation recommended"],
        confidence: 0.5
      };
    }
  }

  /**
   * Execute an action call (simulation - actual execution would integrate with ToolManager)
   */
  async executeAction(actionCall: ActionCall): Promise<ActionResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    try {
      logger.debug(`[ACTION_CALLER_AGENT] Simulating execution of ${actionCall.toolId}.${actionCall.functionName}`);

      // This is a simulation - in real implementation, this would:
      // 1. Look up the actual tool in ToolManager
      // 2. Call the tool with the provided parameters  
      // 3. Handle the actual execution and results
      
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulate execution time

      return {
        success: true,
        result: {
          toolId: actionCall.toolId,
          functionName: actionCall.functionName,
          parameters: actionCall.parameters,
          simulatedResult: "Action executed successfully (simulated)"
        },
        duration: Date.now() - startTime,
        metadata: {
          actionCallId: `${actionCall.toolId}_${Date.now()}`,
          timestamp: new Date().toISOString()
        }
      };

    } catch (error) {
      logger.error("[ACTION_CALLER_AGENT] Action execution failed:", error);
      
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        metadata: {
          failureReason: "Execution error",
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  /**
   * Build action generation prompt
   */
  private buildActionPrompt(plan: TaskStep, context?: any): string {
    const contextInfo = context ? `
**Context Information:**
${JSON.stringify(context, null, 2)}` : '';

    return `Generate an executable action call from this task step.

**Task Step:**
- ID: ${plan.id}
- Description: ${plan.description}
- Action: ${plan.action}
- Parameters: ${JSON.stringify(plan.parameters)}
- Priority: ${plan.priority}
${contextInfo}

**Action Call Requirements:**
1. **Tool Selection**: Choose the most appropriate tool for this action
2. **Function Mapping**: Map the action to a specific function/method
3. **Parameter Generation**: Create proper parameters for the function call
4. **Reasoning**: Explain why this action call achieves the task step

**Available Tool Categories:**
- file_operations: file_read, file_write, file_search, directory_list
- git_operations: git_status, git_commit, git_branch, git_push
- shell_commands: shell_execute, command_run
- code_analysis: lint_check, type_check, test_run
- search_operations: content_search, pattern_match
- documentation: doc_generate, doc_update

**Respond in JSON format:**
{
  "toolId": "appropriate_tool_name",
  "functionName": "specific_function_to_call",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  },
  "metadata": {
    "reasoning": "Why this action call achieves the task step",
    "confidence": 0.85,
    "alternatives": [
      {
        "toolId": "alternative_tool",
        "functionName": "alternative_function",
        "reasoning": "Alternative approach"
      }
    ]
  }
}`;
  }

  /**
   * Build validation prompt
   */
  private buildValidationPrompt(actionCall: ActionCall): string {
    return `Validate this action call for correctness and feasibility.

**Action Call:**
- Tool: ${actionCall.toolId}
- Function: ${actionCall.functionName}
- Parameters: ${JSON.stringify(actionCall.parameters, null, 2)}

**Validation Criteria:**
1. **Tool Appropriateness**: Is this the right tool for the task?
2. **Function Correctness**: Is the function name valid and appropriate?
3. **Parameter Validity**: Are all required parameters provided with correct types?
4. **Execution Feasibility**: Can this action call be executed successfully?
5. **Safety Check**: Are there any potential issues or risks?

**Respond in JSON format:**
{
  "isValid": true,
  "issues": [
    "Issue description if any problems found"
  ],
  "suggestions": [
    "Suggestion for improvement if needed"
  ],
  "confidence": 0.90,
  "riskLevel": "low|medium|high"
}`;
  }

  /**
   * Parse action generation response
   */
  private parseActionResponse(response: string, originalPlan: TaskStep): ActionCall {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        toolId: data.toolId || this.inferToolFromAction(originalPlan.action),
        functionName: data.functionName || originalPlan.action || "execute",
        parameters: data.parameters || originalPlan.parameters || {},
        metadata: {
          reasoning: data.metadata?.reasoning || "Generated from task step",
          confidence: Math.max(0, Math.min(1, parseFloat(data.metadata?.confidence) || 0.7)),
          alternatives: Array.isArray(data.metadata?.alternatives) ? data.metadata.alternatives : []
        }
      };
    }

    // Fallback action call
    return this.generateFallbackActionCall(response, originalPlan);
  }

  /**
   * Parse validation response
   */
  private parseValidationResponse(response: string): ActionValidation {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        isValid: Boolean(data.isValid),
        issues: Array.isArray(data.issues) ? data.issues : [],
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        confidence: Math.max(0, Math.min(1, parseFloat(data.confidence) || 0.7))
      };
    }

    // Fallback validation
    const lowerResponse = response.toLowerCase();
    const hasIssues = ['invalid', 'error', 'problem', 'issue'].some(word => lowerResponse.includes(word));
    
    return {
      isValid: !hasIssues,
      issues: hasIssues ? ["Response indicates potential issues"] : [],
      suggestions: [],
      confidence: 0.5
    };
  }

  /**
   * Infer tool from action name
   */
  private inferToolFromAction(action: string): string {
    const actionMap: { [key: string]: string } = {
      'read': 'file_read',
      'write': 'file_write',
      'search': 'content_search',
      'execute': 'shell_execute',
      'git': 'git_status',
      'test': 'test_run',
      'lint': 'lint_check',
      'compile': 'shell_execute',
      'build': 'shell_execute'
    };

    for (const [keyword, tool] of Object.entries(actionMap)) {
      if (action.toLowerCase().includes(keyword)) {
        return tool;
      }
    }

    return 'manual_execution';
  }

  /**
   * Generate fallback action call
   */
  private generateFallbackActionCall(response: string, originalPlan: TaskStep): ActionCall {
    // Try to extract tool/function info from response
    const lowerResponse = response.toLowerCase();
    let toolId = this.inferToolFromAction(originalPlan.action);
    let functionName = originalPlan.action || "execute";

    // Look for tool mentions in response
    const toolKeywords = ['file', 'git', 'shell', 'search', 'test', 'lint'];
    for (const keyword of toolKeywords) {
      if (lowerResponse.includes(keyword)) {
        toolId = `${keyword}_operations`;
        break;
      }
    }

    return {
      toolId,
      functionName,
      parameters: {
        ...originalPlan.parameters,
        description: originalPlan.description,
        fallbackReason: "Generated from fallback parsing"
      },
      metadata: {
        reasoning: "Fallback action call generation due to parsing failure",
        confidence: 0.4,
        alternatives: []
      }
    };
  }
}