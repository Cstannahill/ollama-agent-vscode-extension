import { BaseAgent, IAgent, AgentSpecialization, AgentCapability, TaskAnalysis, AgentResponse, ProgressCallback } from "./IAgent";
import { ChatSession, AgentAction } from "../core/ChatSession";
import { ToolManager } from "../core/ToolManager";
import { ContextManager } from "../core/ContextManager";
import { OllamaLLM } from "../api/ollama";
import { PromptBuilder } from "../core/PromptBuilder";
import { logger } from "../utils/logger";
import { AgentConfig } from "./BasicAgent";

export interface DocumentationConfig {
  defaultFormat: "markdown" | "rst" | "asciidoc" | "html";
  includeCodeExamples: boolean;
  generateTOC: boolean;
  autoLinkReferences: boolean;
  includeApiDocs: boolean;
  documentationStyle: "technical" | "user-friendly" | "mixed";
  outputDirectory: string;
  templateDirectory?: string;
  includeVersionInfo: boolean;
}

export interface DocumentationStructure {
  title: string;
  sections: DocumentationSection[];
  metadata: {
    author?: string;
    version?: string;
    lastUpdated: Date;
    tags: string[];
  };
}

export interface DocumentationSection {
  title: string;
  content: string;
  subsections?: DocumentationSection[];
  codeExamples?: CodeExample[];
  apiReferences?: ApiReference[];
}

export interface CodeExample {
  language: string;
  code: string;
  description?: string;
  output?: string;
}

export interface ApiReference {
  name: string;
  type: "function" | "class" | "interface" | "type" | "constant";
  signature: string;
  description: string;
  parameters?: Parameter[];
  returns?: string;
  examples?: CodeExample[];
}

export interface Parameter {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
  defaultValue?: string;
}

/**
 * Specialized agent for documentation creation, maintenance, and management
 */
export class DocumentationAgent extends BaseAgent {
  private llm: OllamaLLM;
  private toolManager: ToolManager;
  private contextManager?: ContextManager;
  private promptBuilder: PromptBuilder;
  private docConfig: DocumentationConfig;

  constructor(
    private agentConfig: AgentConfig,
    toolManager: ToolManager,
    contextManager?: ContextManager,
    docConfig?: Partial<DocumentationConfig>
  ) {
    super(AgentSpecialization.DOCUMENTATION);
    
    this.toolManager = toolManager;
    this.contextManager = contextManager;
    this.promptBuilder = new PromptBuilder(toolManager);
    
    this.docConfig = {
      defaultFormat: "markdown",
      includeCodeExamples: true,
      generateTOC: true,
      autoLinkReferences: true,
      includeApiDocs: true,
      documentationStyle: "mixed",
      outputDirectory: "./docs",
      includeVersionInfo: true,
      ...docConfig
    };

    this.llm = new OllamaLLM({
      baseUrl: agentConfig.ollamaUrl,
      model: agentConfig.model,
      temperature: 0.4, // Moderate temperature for creative but consistent documentation
    });
  }

  protected initializeCapabilities(): void {
    this.capabilities = [
      {
        name: "readme_generation",
        description: "Generate comprehensive README files with project overview, setup, and usage",
        toolsRequired: ["file_read", "file_write"],
        confidenceThreshold: 0.95
      },
      {
        name: "api_documentation",
        description: "Extract and document APIs from source code with examples",
        toolsRequired: ["file_read", "typescript_analyzer", "file_write"],
        confidenceThreshold: 0.9
      },
      {
        name: "changelog_maintenance",
        description: "Generate and maintain changelog files from Git history",
        toolsRequired: ["git_log", "file_write", "file_read"],
        confidenceThreshold: 0.85
      },
      {
        name: "code_documentation",
        description: "Add inline documentation and improve code comments",
        toolsRequired: ["file_read", "file_write", "typescript_analyzer"],
        confidenceThreshold: 0.8
      },
      {
        name: "user_guide_creation",
        description: "Create user guides and tutorials with step-by-step instructions",
        toolsRequired: ["file_read", "file_write"],
        confidenceThreshold: 0.85
      },
      {
        name: "architecture_documentation",
        description: "Document system architecture and design decisions",
        toolsRequired: ["file_read", "file_write", "file_list"],
        confidenceThreshold: 0.8
      },
      {
        name: "documentation_maintenance",
        description: "Update and maintain existing documentation for accuracy",
        toolsRequired: ["file_read", "file_write", "git_diff"],
        confidenceThreshold: 0.9
      }
    ];
  }

  public async canHandle(task: string, context?: any): Promise<TaskAnalysis> {
    const lowerTask = task.toLowerCase();
    
    // Documentation keywords and patterns
    const docKeywords = [
      "document", "documentation", "readme", "docs", "guide", "manual",
      "tutorial", "walkthrough", "instructions", "how-to"
    ];

    const specificDocTypes = [
      "readme", "changelog", "api docs", "user guide", "architecture",
      "getting started", "installation", "setup", "configuration"
    ];

    const docFormats = [
      "markdown", "md", "rst", "asciidoc", "html", "wiki"
    ];

    const apiDocKeywords = [
      "api", "jsdoc", "typedoc", "swagger", "openapi", "interface",
      "function docs", "class docs"
    ];

    let confidence = 0.0;
    const reasoningSteps: string[] = [];
    const requiredCapabilities: string[] = [];

    // Check for explicit documentation requests
    if (lowerTask.includes("create documentation") || lowerTask.includes("generate docs")) {
      confidence += 0.5;
      reasoningSteps.push("Explicit documentation creation request detected");
      requiredCapabilities.push("readme_generation");
    }

    // Check for specific document types
    const docTypeMatches = specificDocTypes.filter(type => lowerTask.includes(type));
    if (docTypeMatches.length > 0) {
      confidence += Math.min(docTypeMatches.length * 0.2, 0.4);
      reasoningSteps.push(`Specific document types found: ${docTypeMatches.join(", ")}`);
      
      if (docTypeMatches.some(type => type.includes("readme"))) {
        requiredCapabilities.push("readme_generation");
      }
      if (docTypeMatches.some(type => type.includes("changelog"))) {
        requiredCapabilities.push("changelog_maintenance");
      }
      if (docTypeMatches.some(type => type.includes("api"))) {
        requiredCapabilities.push("api_documentation");
      }
      if (docTypeMatches.some(type => type.includes("guide") || type.includes("tutorial"))) {
        requiredCapabilities.push("user_guide_creation");
      }
      if (docTypeMatches.some(type => type.includes("architecture"))) {
        requiredCapabilities.push("architecture_documentation");
      }
    }

    // Check for general documentation keywords
    const docMatches = docKeywords.filter(keyword => lowerTask.includes(keyword));
    if (docMatches.length > 0) {
      confidence += Math.min(docMatches.length * 0.15, 0.3);
      reasoningSteps.push(`Documentation keywords found: ${docMatches.join(", ")}`);
      if (requiredCapabilities.length === 0) {
        requiredCapabilities.push("readme_generation");
      }
    }

    // Check for API documentation requests
    const apiMatches = apiDocKeywords.filter(keyword => lowerTask.includes(keyword));
    if (apiMatches.length > 0) {
      confidence += Math.min(apiMatches.length * 0.2, 0.3);
      reasoningSteps.push(`API documentation keywords found: ${apiMatches.join(", ")}`);
      requiredCapabilities.push("api_documentation");
    }

    // Check for documentation format requests
    const formatMatches = docFormats.filter(format => lowerTask.includes(format));
    if (formatMatches.length > 0) {
      confidence += Math.min(formatMatches.length * 0.1, 0.2);
      reasoningSteps.push(`Documentation formats found: ${formatMatches.join(", ")}`);
    }

    // Check for update/maintenance requests
    if (lowerTask.includes("update") && (lowerTask.includes("doc") || lowerTask.includes("readme"))) {
      confidence += 0.3;
      reasoningSteps.push("Documentation update request detected");
      requiredCapabilities.push("documentation_maintenance");
    }

    // Check for inline documentation requests
    if (lowerTask.includes("comment") || lowerTask.includes("inline doc") || lowerTask.includes("jsdoc")) {
      confidence += 0.25;
      reasoningSteps.push("Inline documentation request detected");
      requiredCapabilities.push("code_documentation");
    }

    // Check for project context
    if (context?.projectPath || lowerTask.includes("project")) {
      confidence += 0.1;
      reasoningSteps.push("Project context detected");
    }

    // Check for source file context
    if (context?.filePath && (context.filePath.endsWith('.ts') || context.filePath.endsWith('.js'))) {
      confidence += 0.15;
      reasoningSteps.push("Source code context detected - suitable for API documentation");
      if (!requiredCapabilities.includes("api_documentation")) {
        requiredCapabilities.push("api_documentation");
      }
    }

    // Check for tool availability
    const requiredTools = ["file_read", "file_write"];
    const availableTools = this.toolManager.getToolNames();
    const hasRequiredTools = requiredTools.every(tool => availableTools.includes(tool));
    
    if (!hasRequiredTools) {
      confidence *= 0.7; // Reduce confidence if basic file tools unavailable
      reasoningSteps.push("Basic file tools may not be available");
    }

    // Determine complexity
    let complexity: "low" | "medium" | "high" = "medium";
    if (requiredCapabilities.length <= 1 && !requiredCapabilities.includes("architecture_documentation")) {
      complexity = "low";
    } else if (requiredCapabilities.length >= 3 || requiredCapabilities.includes("api_documentation")) {
      complexity = "high";
    }

    return {
      primaryDomain: AgentSpecialization.DOCUMENTATION,
      confidence: Math.min(confidence, 1.0),
      reasoningSteps,
      requiredCapabilities,
      complexity,
      estimatedDuration: complexity === "low" ? 20000 : complexity === "medium" ? 40000 : 80000
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
      logger.info(`[DOCUMENTATION_AGENT] Starting documentation task: ${task}`);
      
      // Phase 1: Analyze the task and determine documentation strategy
      progressCallback?.onThought?.("Analyzing documentation requirements and project structure...");
      
      const docPlan = await this.createDocumentationPlan(task);
      progressCallback?.onThought?.(`Documentation plan created: ${docPlan.documentTypes.join(", ")} - ${docPlan.phases.length} phases`);

      let documentationResults = {
        projectAnalysis: null as any,
        generatedDocs: [] as any[],
        updatedFiles: [] as string[],
        structure: null as DocumentationStructure | null
      };

      // Phase 2: Analyze project structure
      if (docPlan.includeProjectAnalysis) {
        progressCallback?.onAction?.("file_list", { dirPath: "." });
        
        try {
          const projectFiles = await this.toolManager.executeTool("file_list", {
            dirPath: ".",
            recursive: true
          });
          
          documentationResults.projectAnalysis = await this.analyzeProjectStructure(projectFiles);
          progressCallback?.onActionResult?.("Project structure analyzed");
          
          actions.push({
            thought: "Analyzed project structure and identified documentation needs",
            toolCall: chatSession.recordToolCall("file_list", { dirPath: "." }, projectFiles),
            observation: "Project analysis completed successfully",
            timestamp: new Date()
          });
        } catch (error) {
          logger.warn("[DOCUMENTATION_AGENT] Project analysis failed:", error);
          progressCallback?.onActionResult?.("", `Project analysis failed: ${error}`);
        }
      }

      // Phase 3: Generate README if requested
      if (docPlan.includeReadme) {
        await this.generateReadme(docPlan, documentationResults, actions, chatSession, progressCallback);
      }

      // Phase 4: Generate API documentation if requested
      if (docPlan.includeApiDocs) {
        await this.generateApiDocumentation(docPlan, documentationResults, actions, chatSession, progressCallback);
      }

      // Phase 5: Generate changelog if requested
      if (docPlan.includeChangelog) {
        await this.generateChangelog(docPlan, documentationResults, actions, chatSession, progressCallback);
      }

      // Phase 6: Create user guide if requested
      if (docPlan.includeUserGuide) {
        await this.generateUserGuide(docPlan, documentationResults, actions, chatSession, progressCallback);
      }

      // Phase 7: Update inline documentation if requested
      if (docPlan.includeInlineDocs) {
        await this.updateInlineDocumentation(docPlan, documentationResults, actions, chatSession, progressCallback);
      }

      // Phase 8: Create documentation index
      if (docPlan.createIndex && documentationResults.generatedDocs.length > 1) {
        await this.createDocumentationIndex(documentationResults, actions, chatSession, progressCallback);
      }

      // Phase 9: Generate documentation report
      progressCallback?.onThought?.("Generating documentation completion report...");
      
      const docReport = await this.generateDocumentationReport(task, documentationResults, docPlan);
      
      const response: AgentResponse = {
        content: docReport.summary,
        actions,
        success: true,
        agentType: AgentSpecialization.DOCUMENTATION,
        confidence: 0.9,
        suggestions: docReport.recommendations,
        metadata: {
          docPlan,
          generatedFiles: documentationResults.updatedFiles,
          documentTypes: docPlan.documentTypes,
          format: docPlan.format
        }
      };

      progressCallback?.onComplete?.(response);
      return response;

    } catch (error) {
      const errorMessage = `Documentation generation failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.error("[DOCUMENTATION_AGENT] Task execution failed:", error);

      const response: AgentResponse = {
        content: errorMessage,
        actions,
        success: false,
        error: errorMessage,
        agentType: AgentSpecialization.DOCUMENTATION,
        confidence: 0
      };

      progressCallback?.onComplete?.(response);
      return response;
    }
  }

  private async createDocumentationPlan(task: string): Promise<{
    documentTypes: string[];
    format: string;
    phases: string[];
    includeProjectAnalysis: boolean;
    includeReadme: boolean;
    includeApiDocs: boolean;
    includeChangelog: boolean;
    includeUserGuide: boolean;
    includeInlineDocs: boolean;
    createIndex: boolean;
    targetFiles?: string[];
    outputDirectory: string;
  }> {
    const lowerTask = task.toLowerCase();
    
    // Determine format
    let format = this.docConfig.defaultFormat;
    if (lowerTask.includes("markdown") || lowerTask.includes("md")) format = "markdown";
    else if (lowerTask.includes("rst")) format = "rst";
    else if (lowerTask.includes("html")) format = "html";

    // Extract target files if specified
    const fileMatch = task.match(/files?[:\s]+([^\n]+)/i);
    const targetFiles = fileMatch ? fileMatch[1].split(/[,\s]+/).filter(f => f.trim().length > 0) : undefined;

    const plan = {
      documentTypes: [] as string[],
      format,
      phases: [] as string[],
      includeProjectAnalysis: true, // Always analyze project first
      includeReadme: lowerTask.includes("readme") || (!lowerTask.includes("api") && !lowerTask.includes("changelog")),
      includeApiDocs: lowerTask.includes("api") || lowerTask.includes("jsdoc") || lowerTask.includes("typedoc"),
      includeChangelog: lowerTask.includes("changelog") || lowerTask.includes("change log"),
      includeUserGuide: lowerTask.includes("guide") || lowerTask.includes("tutorial"),
      includeInlineDocs: lowerTask.includes("comment") || lowerTask.includes("inline"),
      createIndex: lowerTask.includes("index") || lowerTask.includes("comprehensive"),
      targetFiles,
      outputDirectory: this.docConfig.outputDirectory
    };

    // Build document types list
    if (plan.includeReadme) plan.documentTypes.push("README");
    if (plan.includeApiDocs) plan.documentTypes.push("API Documentation");
    if (plan.includeChangelog) plan.documentTypes.push("Changelog");
    if (plan.includeUserGuide) plan.documentTypes.push("User Guide");
    if (plan.includeInlineDocs) plan.documentTypes.push("Inline Documentation");

    // Build phase list
    if (plan.includeProjectAnalysis) plan.phases.push("Project Analysis");
    if (plan.includeReadme) plan.phases.push("README Generation");
    if (plan.includeApiDocs) plan.phases.push("API Documentation");
    if (plan.includeChangelog) plan.phases.push("Changelog Generation");
    if (plan.includeUserGuide) plan.phases.push("User Guide Creation");
    if (plan.includeInlineDocs) plan.phases.push("Inline Documentation");
    if (plan.createIndex) plan.phases.push("Index Creation");

    return plan;
  }

  private async analyzeProjectStructure(projectFiles: string): Promise<{
    projectType: string;
    mainFiles: string[];
    sourceStructure: any;
    dependencies: string[];
    frameworks: string[];
  }> {
    const files = projectFiles.split('\n').filter(f => f.trim().length > 0);
    
    const analysis = {
      projectType: "unknown",
      mainFiles: [] as string[],
      sourceStructure: {},
      dependencies: [] as string[],
      frameworks: [] as string[]
    };

    // Detect project type
    if (files.some(f => f.includes("package.json"))) {
      analysis.projectType = "Node.js";
      analysis.mainFiles.push("package.json");
    }
    if (files.some(f => f.includes("tsconfig.json"))) {
      analysis.projectType = "TypeScript";
      analysis.mainFiles.push("tsconfig.json");
    }
    if (files.some(f => f.includes("requirements.txt") || f.includes("setup.py"))) {
      analysis.projectType = "Python";
    }

    // Identify key files
    const keyFiles = ["README.md", "index.js", "index.ts", "main.py", "app.js", "server.js"];
    analysis.mainFiles.push(...files.filter(f => keyFiles.some(key => f.includes(key))));

    return analysis;
  }

  private async generateReadme(
    plan: any,
    results: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    try {
      progressCallback?.onAction?.("file_write", { filePath: "README.md" });
      
      // Check if README already exists
      let existingReadme = "";
      try {
        existingReadme = await this.toolManager.executeTool("file_read", { filePath: "README.md" });
      } catch {
        // README doesn't exist, which is fine
      }

      const readmeContent = await this.createReadmeContent(results.projectAnalysis, existingReadme);
      
      await this.toolManager.executeTool("file_write", {
        filePath: "README.md",
        content: readmeContent
      });
      
      results.generatedDocs.push({ type: "README", content: readmeContent });
      results.updatedFiles.push("README.md");
      
      progressCallback?.onActionResult?.("README.md generated successfully");
      
      actions.push({
        thought: "Generated comprehensive README documentation",
        toolCall: chatSession.recordToolCall("file_write", { filePath: "README.md" }, "README.md created"),
        observation: "README generation completed successfully",
        timestamp: new Date()
      });
    } catch (error) {
      logger.warn("[DOCUMENTATION_AGENT] README generation failed:", error);
      progressCallback?.onActionResult?.("", `README generation failed: ${error}`);
    }
  }

  private async createReadmeContent(projectAnalysis: any, existingReadme: string): Promise<string> {
    const projectName = "Project"; // Could be extracted from package.json
    const timestamp = new Date().toISOString().split('T')[0];
    
    let content = `# ${projectName}\n\n`;
    
    // Add project description
    content += `## Description\n\n`;
    content += `[Add a brief description of your project here]\n\n`;
    
    // Add features section
    content += `## Features\n\n`;
    content += `- [Feature 1]\n`;
    content += `- [Feature 2]\n`;
    content += `- [Feature 3]\n\n`;
    
    // Add installation section
    content += `## Installation\n\n`;
    if (projectAnalysis?.projectType === "Node.js" || projectAnalysis?.projectType === "TypeScript") {
      content += `\`\`\`bash\nnpm install\n\`\`\`\n\n`;
    } else if (projectAnalysis?.projectType === "Python") {
      content += `\`\`\`bash\npip install -r requirements.txt\n\`\`\`\n\n`;
    } else {
      content += `[Add installation instructions here]\n\n`;
    }
    
    // Add usage section
    content += `## Usage\n\n`;
    content += `[Add usage examples here]\n\n`;
    
    // Add API section if applicable
    if (this.docConfig.includeApiDocs) {
      content += `## API Documentation\n\n`;
      content += `[Link to API documentation]\n\n`;
    }
    
    // Add contributing section
    content += `## Contributing\n\n`;
    content += `1. Fork the repository\n`;
    content += `2. Create a feature branch\n`;
    content += `3. Make your changes\n`;
    content += `4. Submit a pull request\n\n`;
    
    // Add license section
    content += `## License\n\n`;
    content += `[Specify your license here]\n\n`;
    
    // Add generation note
    content += `---\n\n`;
    content += `*Documentation generated on ${timestamp}*\n`;
    
    return content;
  }

  private async generateApiDocumentation(
    plan: any,
    results: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    logger.info("[DOCUMENTATION_AGENT] API documentation generation - placeholder implementation");
  }

  private async generateChangelog(
    plan: any,
    results: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    try {
      progressCallback?.onAction?.("git_log", { maxCount: 50 });
      
      const gitLog = await this.toolManager.executeTool("git_log", {
        maxCount: 50,
        format: "oneline"
      });
      
      const changelogContent = await this.createChangelogContent(gitLog);
      
      progressCallback?.onAction?.("file_write", { filePath: "CHANGELOG.md" });
      
      await this.toolManager.executeTool("file_write", {
        filePath: "CHANGELOG.md",
        content: changelogContent
      });
      
      results.generatedDocs.push({ type: "Changelog", content: changelogContent });
      results.updatedFiles.push("CHANGELOG.md");
      
      progressCallback?.onActionResult?.("CHANGELOG.md generated successfully");
      
      actions.push({
        thought: "Generated changelog from Git history",
        toolCall: chatSession.recordToolCall("file_write", { filePath: "CHANGELOG.md" }, "CHANGELOG.md created"),
        observation: "Changelog generation completed successfully",
        timestamp: new Date()
      });
    } catch (error) {
      logger.warn("[DOCUMENTATION_AGENT] Changelog generation failed:", error);
      progressCallback?.onActionResult?.("", `Changelog generation failed: ${error}`);
    }
  }

  private async createChangelogContent(gitLog: string): Promise<string> {
    const timestamp = new Date().toISOString().split('T')[0];
    const commits = gitLog.split('\n').filter(line => line.trim().length > 0);
    
    let content = `# Changelog\n\n`;
    content += `All notable changes to this project will be documented in this file.\n\n`;
    content += `## [Unreleased]\n\n`;
    
    // Process recent commits
    content += `### Recent Changes\n\n`;
    commits.slice(0, 10).forEach(commit => {
      const message = commit.replace(/^[a-f0-9]+\s+/, '');
      content += `- ${message}\n`;
    });
    
    content += `\n---\n\n`;
    content += `*Changelog generated on ${timestamp}*\n`;
    
    return content;
  }

  private async generateUserGuide(
    plan: any,
    results: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    logger.info("[DOCUMENTATION_AGENT] User guide generation - placeholder implementation");
  }

  private async updateInlineDocumentation(
    plan: any,
    results: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    logger.info("[DOCUMENTATION_AGENT] Inline documentation update - placeholder implementation");
  }

  private async createDocumentationIndex(
    results: any,
    actions: AgentAction[],
    chatSession: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    logger.info("[DOCUMENTATION_AGENT] Documentation index creation - placeholder implementation");
  }

  private async generateDocumentationReport(
    task: string,
    results: any,
    plan: any
  ): Promise<{
    summary: string;
    recommendations: string[];
  }> {
    let summary = `Documentation generation completed. `;
    const recommendations: string[] = [];

    if (results.updatedFiles.length > 0) {
      summary += `Created/updated ${results.updatedFiles.length} documentation file${results.updatedFiles.length > 1 ? 's' : ''}: ${results.updatedFiles.join(", ")}. `;
    }

    // Add recommendations based on what was generated
    if (plan.includeReadme) {
      recommendations.push("Review and customize the generated README content");
      recommendations.push("Add specific examples and use cases");
    }

    if (plan.includeApiDocs) {
      recommendations.push("Keep API documentation updated with code changes");
    }

    if (plan.includeChangelog) {
      recommendations.push("Follow semantic versioning for changelog entries");
    }

    recommendations.push("Set up automated documentation updates in CI/CD");
    recommendations.push("Regular documentation reviews ensure accuracy");

    return { summary, recommendations };
  }

  public getPromptTemplates(): Record<string, string> {
    return {
      readmeGeneration: `You are a technical writer creating comprehensive README documentation.
        Create clear, well-structured documentation that includes:
        1. Project overview and purpose
        2. Installation and setup instructions
        3. Usage examples and code snippets
        4. Configuration options and requirements
        5. Contributing guidelines and development setup
        
        Write for both technical and non-technical audiences.`,
      
      apiDocumentation: `You are an API documentation specialist.
        Extract and document APIs with:
        1. Clear function/method signatures
        2. Parameter descriptions and types
        3. Return value documentation
        4. Usage examples and code samples
        5. Error handling and edge cases
        
        Follow industry standards for API documentation.`,
      
      userGuideCreation: `You are creating user-friendly guides and tutorials.
        Structure content with:
        1. Step-by-step instructions
        2. Screenshots and visual aids where helpful
        3. Common troubleshooting scenarios
        4. Progressive complexity (beginner to advanced)
        5. Real-world examples and use cases
        
        Focus on user success and clear communication.`
    };
  }
}