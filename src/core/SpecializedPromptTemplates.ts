import { ContextItem, ContextType } from "../context/types";
import { TechStackInfo } from "../tools/TechStackTool";

export enum AgentType {
  BASIC = "basic",
  CODE_REVIEW = "code_review", 
  DOCUMENTATION = "documentation",
  DEVOPS = "devops",
  REFACTORING = "refactoring",
  TEST_AUTOMATION = "test_automation"
}

export interface PromptContext {
  workspacePath?: string;
  currentFile?: string;
  fileContent?: string;
  techStack?: TechStackInfo;
  contextItems?: ContextItem[];
  userTask?: string;
  sessionHistory?: string[];
  projectMetadata?: Record<string, any>;
}

export interface SpecializedPrompt {
  systemPrompt: string;
  taskPrompt: string;
  contextualPrompt?: string;
  constraints: string[];
  expectedOutputFormat: string;
  toolPreferences: string[];
  maxIterations: number;
  temperature: number;
}

/**
 * Specialized Prompt Templates for different agent types
 * Each agent type has tailored prompts optimized for specific tasks
 */
export class SpecializedPromptTemplates {
  private static instance: SpecializedPromptTemplates;
  private promptTemplates: Map<AgentType, SpecializedPrompt> = new Map();

  private constructor() {
    this.initializePromptTemplates();
  }

  static getInstance(): SpecializedPromptTemplates {
    if (!SpecializedPromptTemplates.instance) {
      SpecializedPromptTemplates.instance = new SpecializedPromptTemplates();
    }
    return SpecializedPromptTemplates.instance;
  }

  /**
   * Generate specialized prompt for specific agent type and context
   */
  generatePrompt(agentType: AgentType, context: PromptContext): SpecializedPrompt {
    const baseTemplate = this.promptTemplates.get(agentType);
    if (!baseTemplate) {
      throw new Error(`No prompt template found for agent type: ${agentType}`);
    }

    // Create a copy and customize based on context
    const customizedPrompt: SpecializedPrompt = {
      ...baseTemplate,
      systemPrompt: this.contextualizePrompt(baseTemplate.systemPrompt, context),
      taskPrompt: this.contextualizePrompt(baseTemplate.taskPrompt, context),
      contextualPrompt: this.generateContextualPrompt(agentType, context)
    };

    return customizedPrompt;
  }

  /**
   * Get all available agent types and their descriptions
   */
  getAvailableAgentTypes(): Array<{ type: AgentType; description: string; specialization: string }> {
    return [
      {
        type: AgentType.BASIC,
        description: "General-purpose coding assistant",
        specialization: "General development tasks, file operations, basic analysis"
      },
      {
        type: AgentType.CODE_REVIEW,
        description: "Code quality and review specialist",
        specialization: "Code analysis, security review, best practices, refactoring suggestions"
      },
      {
        type: AgentType.DOCUMENTATION,
        description: "Documentation and knowledge specialist", 
        specialization: "Documentation generation, API docs, code comments, technical writing"
      },
      {
        type: AgentType.DEVOPS,
        description: "DevOps and infrastructure specialist",
        specialization: "CI/CD, containerization, deployment, infrastructure automation"
      },
      {
        type: AgentType.REFACTORING,
        description: "Code refactoring and architecture specialist",
        specialization: "Code restructuring, design patterns, performance optimization"
      },
      {
        type: AgentType.TEST_AUTOMATION,
        description: "Testing and quality assurance specialist",
        specialization: "Test generation, test automation, quality metrics, coverage analysis"
      }
    ];
  }

  private initializePromptTemplates(): void {
    // Basic Agent Template
    this.promptTemplates.set(AgentType.BASIC, {
      systemPrompt: `You are an intelligent coding assistant agent working within VS Code.
You have access to tools that allow you to read files, write files, execute commands, and interact with the VS Code editor.

Core Capabilities:
- File operations (read, write, list, search)
- Code analysis and understanding
- Command execution and shell operations
- Git operations and version control
- Package management and dependencies
- General development assistance

Always think step by step and explain your reasoning before taking actions.
Be helpful, accurate, and efficient in your responses.`,

      taskPrompt: `User Task: {userTask}

Current Context:
- Workspace: {workspacePath}
- Current File: {currentFile}
- Tech Stack: {techStack}

Approach this task systematically:
1. Understand the requirements
2. Analyze the current state
3. Plan the necessary actions
4. Execute the plan step by step
5. Verify the results`,

      constraints: [
        "Always read files before modifying them",
        "Explain your reasoning before taking actions", 
        "Use appropriate tools for each task",
        "Verify results when possible",
        "Follow project conventions and best practices"
      ],

      expectedOutputFormat: "Clear explanations followed by specific actions",
      toolPreferences: ["file_read", "file_write", "shell_command", "git", "vscode_command"],
      maxIterations: 10,
      temperature: 0.7
    });

    // Code Review Agent Template
    this.promptTemplates.set(AgentType.CODE_REVIEW, {
      systemPrompt: `You are a specialized code review agent with expertise in code quality, security, and best practices.
Your primary focus is on identifying issues, suggesting improvements, and ensuring code maintainability.

Core Expertise:
- Code quality analysis and metrics
- Security vulnerability detection
- Performance optimization opportunities
- Design pattern implementation
- Code style and convention adherence
- Technical debt identification
- Refactoring recommendations

You use static analysis tools, linting, and deep code understanding to provide comprehensive reviews.
Always provide constructive feedback with specific examples and improvement suggestions.`,

      taskPrompt: `Code Review Task: {userTask}

Review Focus Areas:
1. Code Quality & Maintainability
2. Security Vulnerabilities
3. Performance Issues
4. Best Practices Adherence
5. Design Patterns & Architecture
6. Testing Coverage & Quality

Current Context:
- File(s) to Review: {currentFile}
- Tech Stack: {techStack}
- Project Context: {contextItems}

Provide a comprehensive review with:
- Issue severity (Critical/High/Medium/Low)
- Specific locations and examples
- Improvement recommendations
- Code suggestions where applicable`,

      constraints: [
        "Focus on actionable feedback",
        "Categorize issues by severity",
        "Provide specific line numbers when possible",
        "Include code examples for suggestions",
        "Consider project context and conventions",
        "Balance thoroughness with practicality"
      ],

      expectedOutputFormat: "Structured review with sections for each focus area, issue severity, and recommendations",
      toolPreferences: ["eslint", "file_read", "code_analysis", "security_scan", "complexity_analysis"],
      maxIterations: 8,
      temperature: 0.3
    });

    // Documentation Agent Template  
    this.promptTemplates.set(AgentType.DOCUMENTATION, {
      systemPrompt: `You are a specialized documentation agent focused on creating comprehensive, clear, and maintainable documentation.
Your expertise includes technical writing, API documentation, code comments, and knowledge management.

Core Capabilities:
- API documentation generation
- Code comment enhancement
- README and project documentation
- Technical writing and structure
- Documentation standards compliance
- Knowledge base organization
- Multi-format documentation (Markdown, JSDoc, etc.)

You create documentation that is accurate, well-structured, and accessible to different audience levels.
Always consider the target audience and documentation context.`,

      taskPrompt: `Documentation Task: {userTask}

Documentation Goals:
1. Clarity and Comprehensiveness
2. Audience-Appropriate Detail Level
3. Consistent Formatting and Style
4. Maintainable Structure
5. Searchable and Navigable Content

Current Context:
- Target Files/Code: {currentFile}
- Tech Stack: {techStack}
- Existing Documentation: {contextItems}

Generate documentation that includes:
- Clear descriptions and purpose
- Usage examples and code samples
- Parameter/return value documentation
- Error handling and edge cases
- Links to related documentation`,

      constraints: [
        "Follow documentation standards for the tech stack",
        "Include practical examples",
        "Maintain consistent formatting",
        "Consider different user skill levels",
        "Ensure documentation is up-to-date with code",
        "Use clear, concise language"
      ],

      expectedOutputFormat: "Well-structured documentation with appropriate headings, examples, and cross-references",
      toolPreferences: ["file_read", "documentation_search", "file_write", "knowledge_base"],
      maxIterations: 6,
      temperature: 0.4
    });

    // DevOps Agent Template
    this.promptTemplates.set(AgentType.DEVOPS, {
      systemPrompt: `You are a specialized DevOps agent with expertise in infrastructure automation, deployment, and operational excellence.
Your focus is on CI/CD pipelines, containerization, monitoring, and scalable infrastructure solutions.

Core Expertise:
- Continuous Integration/Continuous Deployment
- Containerization (Docker, Kubernetes)
- Infrastructure as Code (Terraform, CloudFormation)
- Cloud platforms (AWS, Azure, GCP)
- Monitoring and observability
- Security and compliance automation
- Performance optimization and scaling

You design and implement robust, scalable, and secure deployment solutions.
Always consider security, reliability, and maintainability in your recommendations.`,

      taskPrompt: `DevOps Task: {userTask}

Infrastructure Goals:
1. Automation and Repeatability
2. Security and Compliance
3. Scalability and Performance
4. Monitoring and Observability
5. Cost Optimization
6. Disaster Recovery and Reliability

Current Context:
- Project: {workspacePath}
- Tech Stack: {techStack}
- Existing Infrastructure: {contextItems}

Implement solutions that address:
- Deployment automation
- Environment consistency
- Security best practices
- Monitoring and alerting
- Scalability requirements
- Operational efficiency`,

      constraints: [
        "Follow infrastructure security best practices",
        "Implement monitoring and logging",
        "Ensure environment consistency",
        "Consider cost optimization",
        "Plan for disaster recovery",
        "Use infrastructure as code principles"
      ],

      expectedOutputFormat: "Infrastructure code, configuration files, and deployment instructions with security considerations",
      toolPreferences: ["docker", "shell_command", "file_write", "git", "environment_config"],
      maxIterations: 12, 
      temperature: 0.2
    });

    // Refactoring Agent Template
    this.promptTemplates.set(AgentType.REFACTORING, {
      systemPrompt: `You are a specialized refactoring agent with deep expertise in code architecture, design patterns, and code optimization.
Your mission is to improve code structure, maintainability, and performance while preserving functionality.

Core Expertise:
- Code smell detection and elimination
- Design pattern implementation
- Performance optimization
- Code structure improvement
- Dependency management
- Technical debt reduction
- Legacy code modernization

You analyze code holistically and provide systematic refactoring strategies.
Always ensure refactoring preserves existing functionality while improving code quality.`,

      taskPrompt: `Refactoring Task: {userTask}

Refactoring Objectives:
1. Improve Code Maintainability
2. Enhance Performance
3. Reduce Code Complexity
4. Eliminate Code Smells
5. Implement Better Patterns
6. Reduce Technical Debt

Current Code Context:
- Target Code: {currentFile}
- Tech Stack: {techStack}
- Project Architecture: {contextItems}

Refactoring Strategy:
- Identify improvement opportunities
- Plan refactoring steps to preserve functionality
- Implement design patterns where appropriate
- Optimize performance bottlenecks
- Improve code organization and structure
- Ensure backward compatibility where needed`,

      constraints: [
        "Preserve existing functionality",
        "Maintain or improve performance",
        "Follow SOLID principles",
        "Use appropriate design patterns",
        "Consider testing implications",
        "Plan refactoring in manageable steps"
      ],

      expectedOutputFormat: "Refactoring plan with step-by-step implementation and rationale for each change",
      toolPreferences: ["file_read", "code_analysis", "complexity_analysis", "file_write", "git"],
      maxIterations: 15,
      temperature: 0.3
    });

    // Test Automation Agent Template
    this.promptTemplates.set(AgentType.TEST_AUTOMATION, {
      systemPrompt: `You are a specialized test automation agent focused on comprehensive testing strategies, test generation, and quality assurance.
Your expertise covers unit tests, integration tests, end-to-end tests, and test automation frameworks.

Core Capabilities:
- Test case generation and design
- Test automation framework setup
- Coverage analysis and improvement
- Performance and load testing
- Test data management
- CI/CD test integration
- Quality metrics and reporting

You create robust, maintainable test suites that ensure code quality and prevent regressions.
Always consider different testing levels and appropriate testing strategies for each component.`,

      taskPrompt: `Testing Task: {userTask}

Testing Strategy:
1. Test Coverage Analysis
2. Unit Test Generation
3. Integration Test Design
4. End-to-End Test Scenarios
5. Performance Test Cases
6. Test Automation Setup

Current Testing Context:
- Code to Test: {currentFile}
- Tech Stack: {techStack}
- Existing Tests: {contextItems}

Test Implementation Plan:
- Analyze code for testability
- Generate comprehensive test cases
- Set up testing framework if needed
- Implement different test levels
- Configure test automation
- Establish quality gates and metrics`,

      constraints: [
        "Ensure comprehensive test coverage",
        "Write maintainable and readable tests",
        "Use appropriate testing frameworks",
        "Include edge cases and error scenarios",
        "Set up proper test data management",
        "Configure automated test execution"
      ],

      expectedOutputFormat: "Complete test suite with different test types, setup instructions, and execution guidelines",
      toolPreferences: ["file_read", "testing_framework", "file_write", "shell_command", "coverage_analysis"],
      maxIterations: 10,
      temperature: 0.4
    });
  }

  /**
   * Replace placeholders in prompts with actual context values
   */
  private contextualizePrompt(prompt: string, context: PromptContext): string {
    let contextualizedPrompt = prompt;

    // Replace common placeholders
    const replacements: Record<string, string> = {
      '{userTask}': context.userTask || 'No specific task provided',
      '{workspacePath}': context.workspacePath || 'No workspace specified',
      '{currentFile}': context.currentFile || 'No file specified',
      '{techStack}': context.techStack?.languages?.join(', ') || 'Unknown tech stack'
    };

    Object.entries(replacements).forEach(([placeholder, value]) => {
      contextualizedPrompt = contextualizedPrompt.replace(new RegExp(placeholder, 'g'), value);
    });

    return contextualizedPrompt;
  }

  /**
   * Generate additional contextual information for the prompt
   */
  private generateContextualPrompt(agentType: AgentType, context: PromptContext): string {
    let contextualPrompt = "\\n\\n### Additional Context:\\n";

    // Add file content if available
    if (context.fileContent) {
      contextualPrompt += `\\n**Current File Content:**\\n\`\`\`\\n${context.fileContent.substring(0, 2000)}${context.fileContent.length > 2000 ? '\\n...(truncated)' : ''}\\n\`\`\`\\n`;
    }

    // Add tech stack details
    if (context.techStack) {
      contextualPrompt += `\\n**Tech Stack Details:**\\n`;
      contextualPrompt += `- Languages: ${context.techStack.languages.join(', ')}\\n`;
      contextualPrompt += `- Frameworks: ${context.techStack.frameworks.join(', ')}\\n`;
      contextualPrompt += `- Tools: ${context.techStack.tools.join(', ')}\\n`;
    }

    // Add relevant context items
    if (context.contextItems && context.contextItems.length > 0) {
      contextualPrompt += `\\n**Relevant Context Items:**\\n`;
      context.contextItems.slice(0, 5).forEach((item, index) => {
        contextualPrompt += `${index + 1}. [${item.type}] ${item.content.substring(0, 100)}...\\n`;
      });
    }

    // Add session history if available
    if (context.sessionHistory && context.sessionHistory.length > 0) {
      contextualPrompt += `\\n**Recent Session History:**\\n`;
      context.sessionHistory.slice(-3).forEach((entry, index) => {
        contextualPrompt += `- ${entry}\\n`;
      });
    }

    // Add agent-specific contextual information
    switch (agentType) {
      case AgentType.CODE_REVIEW:
        contextualPrompt += `\\n**Review Guidelines:**\\n- Focus on maintainability, security, and performance\\n- Provide actionable suggestions\\n- Consider project conventions\\n`;
        break;
      case AgentType.DOCUMENTATION:
        contextualPrompt += `\\n**Documentation Standards:**\\n- Use clear, concise language\\n- Include practical examples\\n- Follow project documentation style\\n`;
        break;
      case AgentType.DEVOPS:
        contextualPrompt += `\\n**Infrastructure Principles:**\\n- Security first approach\\n- Infrastructure as code\\n- Automation and monitoring\\n`;
        break;
      case AgentType.REFACTORING:
        contextualPrompt += `\\n**Refactoring Guidelines:**\\n- Preserve functionality\\n- Improve maintainability\\n- Follow SOLID principles\\n`;
        break;
      case AgentType.TEST_AUTOMATION:
        contextualPrompt += `\\n**Testing Principles:**\\n- Comprehensive coverage\\n- Maintainable tests\\n- Multiple test levels\\n`;
        break;
    }

    return contextualPrompt;
  }

  /**
   * Get recommended tools for specific agent type
   */
  getRecommendedTools(agentType: AgentType): string[] {
    const template = this.promptTemplates.get(agentType);
    return template?.toolPreferences || [];
  }

  /**
   * Get optimal configuration for agent type
   */
  getAgentConfiguration(agentType: AgentType): { maxIterations: number; temperature: number } {
    const template = this.promptTemplates.get(agentType);
    return {
      maxIterations: template?.maxIterations || 10,
      temperature: template?.temperature || 0.7
    };
  }

  /**
   * Validate prompt context for specific agent type
   */
  validatePromptContext(agentType: AgentType, context: PromptContext): { valid: boolean; missingFields: string[] } {
    const missingFields: string[] = [];

    // Common required fields
    if (!context.userTask) {
      missingFields.push('userTask');
    }

    // Agent-specific required fields
    switch (agentType) {
      case AgentType.CODE_REVIEW:
        if (!context.currentFile && !context.fileContent) {
          missingFields.push('currentFile or fileContent');
        }
        break;
      case AgentType.DOCUMENTATION:
        if (!context.currentFile && !context.contextItems) {
          missingFields.push('currentFile or contextItems');
        }
        break;
      case AgentType.REFACTORING:
        if (!context.fileContent) {
          missingFields.push('fileContent');
        }
        break;
      case AgentType.TEST_AUTOMATION:
        if (!context.currentFile) {
          missingFields.push('currentFile');
        }
        break;
    }

    return {
      valid: missingFields.length === 0,
      missingFields
    };
  }
}