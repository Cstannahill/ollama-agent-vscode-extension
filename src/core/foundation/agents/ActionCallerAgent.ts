/**
 * Action Caller Agent - Plan to API call transformation and execution
 * 
 * Implements sophisticated action generation from task plans and handles
 * function calling, parameter validation, and execution coordination.
 */

import { logger } from "../../../utils/logger";
import { OllamaLLM } from "../../../api/ollama";
import { ContextManager } from "../../ContextManager";
import { ToolManager } from "../../ToolManager";
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
  private toolManager?: ToolManager;
  private initialized = false;
  private config: FoundationAgentConfig;

  constructor(
    ollamaUrl: string,
    model: string,
    contextManager?: ContextManager,
    vectorDB?: VectorDatabase,
    toolManager?: ToolManager,
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
    this.toolManager = toolManager;

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
   * Get available tools description for prompts
   */
  private getAvailableToolsDescription(): string {
    if (!this.toolManager) {
      return "- Tools unavailable (ToolManager not provided)";
    }

    try {
      const tools = this.toolManager.getAllTools();
      let description = tools.map(tool => 
        `- ${tool.name}: ${tool.description}`
      ).join('\n');
      
      // Add key parameter examples for common tools
      description += `

**Common Tool Parameter Examples:**
- file_write: {"filePath": "path/to/file.py", "content": "file content here"}
- file_read: {"filePath": "path/to/file.py"}
- shell_exec: {"command": "npm install", "workingDirectory": "."}
- git_status: {"showUntrackedFiles": true}`;

      return description;
    } catch (error) {
      logger.warn("[ACTION_CALLER_AGENT] Failed to get tool descriptions:", error);
      return "- Tool information unavailable";
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

**Available Tools:**
${this.getAvailableToolsDescription()}

**IMPORTANT: Tool Selection Rules**
- You MUST only select tools from the available tools list above
- Do NOT invent or hallucinate tool names
- If unsure, use 'manual_execution' as fallback
- Verify the tool name exists in the available tools list

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
      
      let toolId = data.toolId || this.inferToolFromAction(originalPlan.action);
      
      // Validate that the selected tool actually exists
      const availableTools = this.getAvailableToolNames();
      if (!availableTools.includes(toolId)) {
        logger.warn(`[ACTION_CALLER_AGENT] Invalid tool selected: ${toolId}, falling back to inference`);
        toolId = this.inferToolFromAction(originalPlan.action);
        
        // Double-check the inferred tool
        if (!availableTools.includes(toolId)) {
          logger.warn(`[ACTION_CALLER_AGENT] Inferred tool also invalid: ${toolId}, using manual_execution`);
          toolId = 'manual_execution';
        }
      }
      
      const parameters = data.parameters || originalPlan.parameters || {};
      
      // Enhance parameters with context if missing key fields
      const enhancedParameters = this.enhanceParameters(toolId, parameters, originalPlan);
      
      return {
        toolId: toolId,
        functionName: data.functionName || originalPlan.action || "execute",
        parameters: enhancedParameters,
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
   * Infer tool from action name using available tools
   */
  private inferToolFromAction(action: string): string {
    // First, get actual available tools from ToolManager
    const availableTools = this.getAvailableToolNames();
    
    const actionLower = action.toLowerCase();
    
    // Direct matches with available tools
    for (const toolName of availableTools) {
      if (actionLower.includes(toolName.toLowerCase().replace('_', ' ')) || 
          actionLower.includes(toolName.toLowerCase())) {
        return toolName;
      }
    }
    
    // Common action patterns mapped to likely tool names
    const actionMap: { [key: string]: string[] } = {
      'read': ['file_read', 'read_file', 'file_reader', 'text_reader'],
      'write': ['file_write', 'write_file', 'file_writer', 'text_writer'],
      'create': ['file_write', 'write_file', 'create_file', 'file_creator'],
      'directory': ['create_directory', 'mkdir', 'directory_create'],
      'search': ['content_search', 'file_search', 'search_content', 'grep'],
      'execute': ['shell_execute', 'command_execute', 'run_command', 'exec'],
      'git': ['git_status', 'git_command', 'version_control'],
      'test': ['test_run', 'run_tests', 'test_execute'],
      'lint': ['lint_check', 'code_lint', 'style_check'],
      'compile': ['shell_execute', 'compile_code', 'build_project'],
      'build': ['shell_execute', 'build_project', 'compile_code']
    };

    // Find matching tools from available tools
    for (const [keyword, possibleTools] of Object.entries(actionMap)) {
      if (actionLower.includes(keyword)) {
        for (const toolName of possibleTools) {
          if (availableTools.includes(toolName)) {
            return toolName;
          }
        }
      }
    }
    
    // Fallback: try to find any reasonable match
    if (actionLower.includes('file') && availableTools.some(t => t.includes('file'))) {
      return availableTools.find(t => t.includes('file')) || 'manual_execution';
    }
    
    if (actionLower.includes('shell') && availableTools.some(t => t.includes('shell'))) {
      return availableTools.find(t => t.includes('shell')) || 'manual_execution';
    }

    return 'manual_execution';
  }

  /**
   * Get available tool names from ToolManager
   */
  private getAvailableToolNames(): string[] {
    if (!this.toolManager) {
      return [];
    }
    
    try {
      return this.toolManager.getAllTools().map(tool => tool.name);
    } catch (error) {
      logger.debug("[ACTION_CALLER_AGENT] Could not get tool names:", error);
      return [];
    }
  }

  /**
   * Enhance parameters with context-aware fixes for missing/undefined values
   */
  private enhanceParameters(toolId: string, parameters: any, originalPlan: TaskStep): any {
    const enhanced = { ...parameters };
    
    try {
      // Get tool schema information if available
      const toolSchema = this.getToolSchema(toolId);
      
      switch (toolId) {
        case 'file_write':
        case 'write_file':
          // Ensure filePath is provided for file_write operations
          if (!enhanced.filePath || enhanced.filePath === 'undefined') {
            enhanced.filePath = this.inferFilePathFromTask(originalPlan);
          }
          // Ensure content is provided
          if (!enhanced.content && !enhanced.code) {
            enhanced.content = this.inferContentFromTask(originalPlan);
          }
          // Ensure directory creation if path includes directories
          if (enhanced.filePath && enhanced.filePath.includes('/')) {
            enhanced.createDirectories = true;
          }
          break;
          
        case 'file_read':
          if (!enhanced.filePath || enhanced.filePath === 'undefined') {
            enhanced.filePath = this.inferFilePathFromTask(originalPlan);
          }
          break;
          
        case 'shell_exec':
        case 'shell_execute':
          if (!enhanced.command) {
            enhanced.command = originalPlan.action || originalPlan.description;
          }
          if (!enhanced.workingDirectory) {
            enhanced.workingDirectory = '.';
          }
          break;
          
        case 'git_status':
        case 'git_commit':
          if (enhanced.showUntrackedFiles === undefined) {
            enhanced.showUntrackedFiles = true;
          }
          break;
          
        default:
          // Generic parameter enhancement
          this.enhanceGenericParameters(enhanced, originalPlan, toolSchema);
          break;
      }
      
      logger.debug(`[ACTION_CALLER_AGENT] Enhanced parameters for ${toolId}:`, enhanced);
      return enhanced;
      
    } catch (error) {
      logger.warn(`[ACTION_CALLER_AGENT] Parameter enhancement failed for ${toolId}:`, error);
      return parameters; // Return original if enhancement fails
    }
  }

  /**
   * Infer file path from task description and context
   */
  private inferFilePathFromTask(task: TaskStep): string {
    const desc = task.description.toLowerCase();
    
    // First, look for complete path structures (directory + file)
    const pathMatches = task.description.match(/(?:at|in|to)\s+([\w\-_/.]+)\/([a-zA-Z0-9_\-]+\.[a-zA-Z]+)/i);
    if (pathMatches && pathMatches[1] && pathMatches[2]) {
      return `${pathMatches[1]}/${pathMatches[2]}`;
    }
    
    // Look for explicit directory + file mentions
    const dirFileMatches = task.description.match(/([\w\-_/]+(?:\/[\w\-_]+)*)\s+(?:called|named)\s+([a-zA-Z0-9_\-]+)\s*,?\s*(?:create|file)?\s*([a-zA-Z0-9_\-]+\.[a-zA-Z]+)/i);
    if (dirFileMatches && dirFileMatches[1] && dirFileMatches[3]) {
      const dir = dirFileMatches[1];
      const filename = dirFileMatches[3];
      return `${dir}/${dirFileMatches[2] || 'folder'}/${filename}`;
    }
    
    // Look for directory creation followed by file creation pattern
    const combinedMatches = task.description.match(/directory\s+(?:at\s+)?([\w\-_/]+)\s+called\s+([\w\-_]+).*?file\s+([\w\-_.]+)/i);
    if (combinedMatches && combinedMatches[1] && combinedMatches[2] && combinedMatches[3]) {
      return `${combinedMatches[1]}/${combinedMatches[2]}/${combinedMatches[3]}`;
    }
    
    // Look for explicit file mentions
    const fileMatches = task.description.match(/(?:file|path|create|write)\s+([^\s]+\.(py|js|ts|tsx|json|md|txt|html|css|java|cpp|c|go|rs|rb))/i);
    if (fileMatches && fileMatches[1]) {
      return fileMatches[1];
    }
    
    // Look for filename patterns
    const filenameMatches = task.description.match(/([a-zA-Z0-9_\-]+\.(py|js|ts|tsx|json|md|txt|html|css|java|cpp|c|go|rs|rb))/i);
    if (filenameMatches && filenameMatches[0]) {
      return filenameMatches[0];
    }
    
    // Infer from task type and context
    if (desc.includes('main.py') || desc.includes('python')) {
      return 'main.py';
    }
    if (desc.includes('index.js') || desc.includes('javascript')) {
      return 'index.js';
    }
    if (desc.includes('readme') || desc.includes('documentation')) {
      return 'README.md';
    }
    if (desc.includes('config') || desc.includes('configuration')) {
      return 'config.json';
    }
    
    // Default based on task action
    if (task.action?.includes('python') || desc.includes('python')) {
      return 'main.py';
    }
    if (task.action?.includes('javascript') || desc.includes('javascript')) {
      return 'index.js';
    }
    
    // Fallback to generic filename
    return 'output.txt';
  }

  /**
   * Infer content from task description
   */
  private inferContentFromTask(task: TaskStep): string {
    const desc = task.description.toLowerCase();
    
    // Look for quoted content first
    const quotedMatch = task.description.match(/"([^"]+)"/);
    if (quotedMatch && quotedMatch[1]) {
      return quotedMatch[1];
    }
    
    const singleQuotedMatch = task.description.match(/'([^']+)'/);
    if (singleQuotedMatch && singleQuotedMatch[1]) {
      return singleQuotedMatch[1];
    }
    
    // Check for specific page types and frameworks
    if (desc.includes('registration') && desc.includes('page')) {
      if (desc.includes('tailwind') || desc.includes('styled')) {
        return this.generateRegistrationPageContent(task.description);
      }
    }
    
    if (desc.includes('login') && desc.includes('page')) {
      if (desc.includes('tailwind')) {
        return this.generateLoginPageContent();
      }
    }
    
    // Look for React/Next.js component patterns
    if (desc.includes('page.tsx') || (desc.includes('react') && desc.includes('component'))) {
      return this.generateReactPageContent(task.description);
    }
    
    // Look for code-like content
    if (desc.includes('function')) {
      const functionMatch = task.description.match(/function\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      const funcName = functionMatch ? functionMatch[1] : 'myFunction';
      
      if (desc.includes('python')) {
        return `def ${funcName}():\n    # TODO: Implement function\n    pass\n`;
      } else if (desc.includes('javascript') || desc.includes('typescript')) {
        return `function ${funcName}() {\n    // TODO: Implement function\n}\n`;
      }
    }
    
    // Look for specific patterns like "logs Hello"
    const logMatch = task.description.match(/logs?\s+"([^"]+)"/i);
    if (logMatch && logMatch[1]) {
      if (desc.includes('python')) {
        return `print("${logMatch[1]}")`;
      } else if (desc.includes('javascript') || desc.includes('typescript')) {
        return `console.log("${logMatch[1]}");`;
      }
    }
    
    // Generic content generation
    if (desc.includes('hello') || desc.includes('Hello')) {
      if (desc.includes('python')) {
        return 'print("Hello, World!")';
      } else if (desc.includes('javascript') || desc.includes('typescript')) {
        return 'console.log("Hello, World!");';
      } else {
        return 'Hello, World!';
      }
    }
    
    // Fallback content
    return `# Content generated for: ${task.description}\n# TODO: Replace with actual implementation`;
  }

  /**
   * Generate registration page content with Tailwind styling
   */
  private generateRegistrationPageContent(description: string): string {
    return `'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    name: ''
  });
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      alert('Passwords do not match');
      return;
    }
    
    setLoading(true);
    try {
      // TODO: Implement registration logic
      console.log('Registration data:', formData);
      // router.push('/dashboard');
    } catch (error) {
      console.error('Registration failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Create your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Or{' '}
            <a href="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
              sign in to your existing account
            </a>
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="name" className="sr-only">
                Full name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Full name"
                value={formData.name}
                onChange={handleChange}
              />
            </div>
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Email address"
                value={formData.email}
                onChange={handleChange}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Password"
                value={formData.password}
                onChange={handleChange}
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="sr-only">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Confirm password"
                value={formData.confirmPassword}
                onChange={handleChange}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}`;
  }

  /**
   * Generate login page content with Tailwind styling
   */
  private generateLoginPageContent(): string {
    return `'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // TODO: Implement login logic
      console.log('Login data:', formData);
    } catch (error) {
      console.error('Login failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <h2 className="text-3xl font-extrabold text-center">Sign In</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <input
            type="email"
            placeholder="Email"
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
            value={formData.email}
            onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
            required
          />
          <input
            type="password"
            placeholder="Password"
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
            value={formData.password}
            onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}`;
  }

  /**
   * Generate React page content
   */
  private generateReactPageContent(description: string): string {
    const componentName = description.match(/(\w+)\.tsx/)?.[1] || 'Page';
    
    return `export default function ${componentName}() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">${componentName}</h1>
      <p className="text-gray-600">
        This is the ${componentName.toLowerCase()} component.
      </p>
    </div>
  );
}`;
  }

  /**
   * Get tool schema information from ToolManager
   */
  private getToolSchema(toolId: string): any {
    if (!this.toolManager) {
      return null;
    }
    
    try {
      const tool = this.toolManager.getTool(toolId);
      return tool?.schema || null;
    } catch (error) {
      logger.debug(`[ACTION_CALLER_AGENT] Could not get schema for ${toolId}:`, error);
      return null;
    }
  }

  /**
   * Enhance generic parameters using tool schema
   */
  private enhanceGenericParameters(parameters: any, task: TaskStep, schema: any): void {
    if (!schema || !schema.properties) {
      return;
    }
    
    // Fill in missing required parameters with sensible defaults
    for (const [paramName, paramDef] of Object.entries(schema.properties)) {
      const def = paramDef as any;
      
      if (!parameters[paramName] || parameters[paramName] === 'undefined') {
        // Try to infer from task description
        const inferred = this.inferParameterFromDescription(paramName, task.description, def);
        if (inferred !== null) {
          parameters[paramName] = inferred;
        }
      }
    }
  }

  /**
   * Infer parameter value from task description
   */
  private inferParameterFromDescription(paramName: string, description: string, paramDef: any): any {
    const desc = description.toLowerCase();
    const name = paramName.toLowerCase();
    
    // Common parameter patterns
    if (name.includes('path') || name.includes('file')) {
      return this.inferFilePathFromTask({ description, action: '', parameters: {}, dependencies: [], estimatedTime: 1, priority: 'medium', id: 'temp' });
    }
    
    if (name.includes('content') || name.includes('text') || name.includes('code')) {
      return this.inferContentFromTask({ description, action: '', parameters: {}, dependencies: [], estimatedTime: 1, priority: 'medium', id: 'temp' });
    }
    
    if (name.includes('command')) {
      const cmdMatch = description.match(/(?:run|execute|command)\s+([^\s]+)/i);
      return cmdMatch ? cmdMatch[1] : description;
    }
    
    if (name.includes('directory') || name.includes('dir')) {
      return '.';
    }
    
    // Type-based defaults
    if (paramDef.type === 'boolean') {
      return true;
    }
    
    if (paramDef.type === 'number') {
      return 0;
    }
    
    if (paramDef.type === 'array') {
      return [];
    }
    
    return null;
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