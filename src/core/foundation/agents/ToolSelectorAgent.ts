/**
 * Tool Selector Agent - DPO-style classifier for intelligent tool selection
 * 
 * Implements sophisticated tool selection using DPO (Direct Preference Optimization)
 * patterns to choose the most appropriate tools for a given task.
 */

import { logger } from "../../../utils/logger";
import { OllamaLLM } from "../../../api/ollama";
import { ToolManager } from "../../ToolManager";
import { robustJSON } from "../../../utils/RobustJSONParser";
import {
  IToolSelectorAgent,
  ToolMetadata,
  ToolSelectionResult,
  ToolRanking,
  ValidationResult,
  FoundationAgentConfig
} from "../IFoundationAgent";

export class ToolSelectorAgent implements IToolSelectorAgent {
  public readonly name = "ToolSelectorAgent";
  public readonly modelSize = "1-7B";

  private llm: OllamaLLM;
  private toolManager?: ToolManager;
  private initialized = false;
  private config: FoundationAgentConfig;
  private toolMetadataCache: Map<string, ToolMetadata> = new Map();

  constructor(
    ollamaUrl: string,
    model: string,
    toolManager?: ToolManager,
    config?: Partial<FoundationAgentConfig>
  ) {
    this.config = {
      modelSize: '1-7B',
      temperature: 0.2, // Low temperature for consistent tool selection
      maxTokens: 1000,
      timeout: 25000,
      ...config
    };

    this.llm = new OllamaLLM({
      baseUrl: ollamaUrl,
      model: model,
      temperature: this.config.temperature,
    });

    this.toolManager = toolManager;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      logger.info("[TOOL_SELECTOR_AGENT] Initializing tool selector agent...");
      
      // Load tool metadata first
      if (this.toolManager) {
        try {
          await this.loadToolMetadata();
          logger.debug(`[TOOL_SELECTOR_AGENT] Loaded ${this.toolMetadataCache.size} tool metadata entries`);
        } catch (error) {
          logger.warn("[TOOL_SELECTOR_AGENT] Failed to load tool metadata:", error);
        }
      }
      
      // Skip LLM test during initialization to prevent timeouts - test on first use instead
      logger.debug("[TOOL_SELECTOR_AGENT] LLM connection will be tested on first use");
      
      this.initialized = true;
      logger.info(`[TOOL_SELECTOR_AGENT] Tool selector initialized with ${this.toolMetadataCache.size} tools`);
    } catch (error) {
      logger.error("[TOOL_SELECTOR_AGENT] Failed to initialize:", error);
      // Still mark as initialized to prevent blocking the pipeline
      this.initialized = true;
      logger.warn("[TOOL_SELECTOR_AGENT] Marked as initialized with degraded functionality");
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCapabilities(): string[] {
    return [
      "DPO-style tool classification",
      "Multi-criteria tool ranking",
      "Context-aware tool selection",
      "Tool combination optimization",
      "Validation and feasibility checking",
      "Dynamic tool discovery"
    ];
  }

  /**
   * Select tools for a given task using DPO-style classification
   */
  async selectTools(task: string, availableTools: ToolMetadata[]): Promise<ToolSelectionResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`[TOOL_SELECTOR_AGENT] Selecting tools for task: ${task.substring(0, 100)}...`);

      // Use cached metadata or provided tools
      const tools = availableTools.length > 0 ? availableTools : Array.from(this.toolMetadataCache.values());
      
      if (tools.length === 0) {
        return {
          selectedTools: [],
          confidence: 0,
          reasoning: ["No tools available for selection"],
          alternatives: []
        };
      }

      // Phase 1: Initial tool ranking
      const rankedTools = await this.rankTools(task, tools);
      
      // Phase 2: Filter out non-existent tools
      const existingTools = rankedTools.filter(ranking => {
        const exists = this.toolMetadataCache.has(ranking.toolId);
        if (!exists) {
          logger.warn(`[TOOL_SELECTOR_AGENT] Filtered out non-existent tool: ${ranking.toolId}`);
        }
        return exists;
      });
      
      // Phase 3: DPO-style preference optimization
      const optimizedSelection = await this.optimizeSelection(task, existingTools);
      
      // Phase 4: Validation
      const validation = await this.validateToolSelection(task, optimizedSelection.selectedTools);
      
      // Adjust confidence based on validation
      const finalConfidence = optimizedSelection.confidence * (validation.confidence || 0.8);
      
      const result: ToolSelectionResult = {
        selectedTools: optimizedSelection.selectedTools,
        confidence: finalConfidence,
        reasoning: [
          ...optimizedSelection.reasoning,
          ...(validation.issues.length > 0 ? [`Validation concerns: ${validation.issues.join(', ')}`] : [])
        ],
        alternatives: rankedTools.slice(optimizedSelection.selectedTools.length, optimizedSelection.selectedTools.length + 3)
          .map(ranking => ({
            toolId: ranking.toolId,
            score: ranking.score,
            reason: ranking.reasoning
          }))
      };

      logger.debug(`[TOOL_SELECTOR_AGENT] Selected ${result.selectedTools.length} tools with confidence ${result.confidence.toFixed(2)}`);
      return result;

    } catch (error) {
      logger.error("[TOOL_SELECTOR_AGENT] Tool selection failed:", error);
      
      return {
        selectedTools: [],
        confidence: 0,
        reasoning: [`Tool selection failed: ${error instanceof Error ? error.message : String(error)}`],
        alternatives: []
      };
    }
  }

  /**
   * Rank tools based on task relevance
   */
  async rankTools(task: string, tools: ToolMetadata[]): Promise<ToolRanking[]> {
    try {
      // Process tools in batches to avoid overwhelming the LLM
      const batchSize = 8;
      const allRankings: ToolRanking[] = [];

      for (let i = 0; i < tools.length; i += batchSize) {
        const batch = tools.slice(i, i + batchSize);
        const batchRankings = await this.rankToolBatch(task, batch);
        allRankings.push(...batchRankings);
      }

      // Sort by score and assign final ranks
      const sortedRankings = allRankings.sort((a, b) => b.score - a.score);
      return sortedRankings.map((ranking, index) => ({
        ...ranking,
        rank: index + 1
      }));

    } catch (error) {
      logger.error("[TOOL_SELECTOR_AGENT] Tool ranking failed:", error);
      
      // Fallback ranking based on simple heuristics
      return tools.map((tool, index) => ({
        toolId: tool.id,
        rank: index + 1,
        score: Math.max(0.1, 1.0 - (index * 0.1)),
        reasoning: "Fallback ranking due to error"
      }));
    }
  }

  /**
   * Validate tool selection for feasibility and effectiveness
   */
  async validateToolSelection(task: string, selectedTools: string[]): Promise<ValidationResult> {
    if (selectedTools.length === 0) {
      return {
        isValid: false,
        confidence: 0,
        issues: ["No tools selected"],
        suggestions: ["Select at least one appropriate tool"]
      };
    }

    try {
      const toolDetails = selectedTools.map(toolId => 
        this.toolMetadataCache.get(toolId)
      ).filter(tool => tool !== undefined) as ToolMetadata[];

      const validationPrompt = this.buildValidationPrompt(task, toolDetails);
      const response = await this.llm.generateText(validationPrompt);

      return this.parseValidationResponse(response);

    } catch (error) {
      logger.warn("[TOOL_SELECTOR_AGENT] Validation failed:", error);
      
      return {
        isValid: true, // Assume valid if validation fails
        confidence: 0.5,
        issues: [`Validation error: ${error instanceof Error ? error.message : String(error)}`],
        suggestions: []
      };
    }
  }

  /**
   * Load tool metadata from ToolManager
   */
  private async loadToolMetadata(): Promise<void> {
    if (!this.toolManager) return;

    try {
      const tools = this.toolManager.getAllTools();
      
      for (const tool of tools) {
        const metadata: ToolMetadata = {
          id: tool.name,
          name: tool.name,
          description: tool.description,
          category: this.categorizeToolByName(tool.name),
          parameters: {}, // Tool schema would go here
          examples: this.generateToolExamples(tool.name, tool.description),
          prerequisites: this.inferPrerequisites(tool.name)
        };
        
        this.toolMetadataCache.set(tool.name, metadata);
      }

      logger.debug(`[TOOL_SELECTOR_AGENT] Loaded ${this.toolMetadataCache.size} tool metadata entries`);
      logger.debug(`[TOOL_SELECTOR_AGENT] Available tools: ${Array.from(this.toolMetadataCache.keys()).join(', ')}`);
    } catch (error) {
      logger.warn("[TOOL_SELECTOR_AGENT] Failed to load tool metadata:", error);
    }
  }

  /**
   * Rank a batch of tools
   */
  private async rankToolBatch(task: string, tools: ToolMetadata[]): Promise<ToolRanking[]> {
    const rankingPrompt = this.buildRankingPrompt(task, tools);
    
    try {
      const response = await this.llm.generateText(rankingPrompt);
      logger.debug(`[TOOL_SELECTOR_AGENT] LLM response for ranking (first 200 chars): ${response.substring(0, 200)}...`);

      return this.parseRankingResponse(response, tools);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 
        (typeof error === 'object' && error !== null) ? JSON.stringify(error) : String(error);
      logger.warn(`[TOOL_SELECTOR_AGENT] Batch ranking failed: ${errorMessage}`);
      
      // Fallback: simple heuristic ranking
      return tools.map((tool, index) => ({
        toolId: tool.id,
        rank: index + 1,
        score: this.calculateHeuristicScore(task, tool),
        reasoning: "Heuristic ranking due to LLM failure"
      }));
    }
  }

  /**
   * Build tool ranking prompt
   */
  private buildRankingPrompt(task: string, tools: ToolMetadata[]): string {
    const toolDescriptions = tools.map((tool, index) => 
      `${index + 1}. **${tool.name}** (${tool.category}): ${tool.description}`
    ).join('\n');

    return `You are an expert tool selector. Rank these tools by their relevance and usefulness for the given task.

**Task:** "${task}"

**Available Tools:**
${toolDescriptions}

**Instructions:**
- Consider task requirements, tool capabilities, and execution feasibility
- Score each tool from 0.0 (completely irrelevant) to 1.0 (perfect match)
- Provide brief reasoning for each score

**Respond in JSON format:**
{
  "rankings": [
    {
      "toolId": "tool_name",
      "score": 0.85,
      "reasoning": "Explanation for this score"
    }
  ]
}`;
  }

  /**
   * Build validation prompt
   */
  private buildValidationPrompt(task: string, tools: ToolMetadata[]): string {
    const toolList = tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n');

    return `Validate this tool selection for the given task.

**Task:** "${task}"

**Selected Tools:**
${toolList}

**Validation Criteria:**
- Can these tools actually accomplish the task?
- Are there any missing essential tools?
- Are there any conflicting or redundant tools?
- Is the selection practical and executable?

**Respond in JSON format:**
{
  "isValid": true/false,
  "confidence": 0.85,
  "issues": ["list of issues if any"],
  "suggestions": ["improvement suggestions"]
}`;
  }

  /**
   * Parse ranking response from LLM
   */
  private parseRankingResponse(response: string, tools: ToolMetadata[]): ToolRanking[] {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success && parseResult.data.rankings) {
      const rankings = parseResult.data.rankings;
      
      // Validate that rankings is an array
      if (!Array.isArray(rankings)) {
        logger.warn(`[TOOL_SELECTOR_AGENT] Expected rankings array, got ${typeof rankings}:`, rankings);
        return this.fallbackParseRanking(response, tools);
      }
      
      return rankings.map((ranking: any) => ({
        toolId: ranking.toolId || ranking.tool_id || ranking.name,
        rank: 0, // Will be set later
        score: Math.max(0, Math.min(1, parseFloat(ranking.score) || 0)),
        reasoning: ranking.reasoning || "No reasoning provided"
      })).filter((ranking: ToolRanking) => 
        tools.some(tool => tool.id === ranking.toolId)
      );
    }

    logger.debug(`[TOOL_SELECTOR_AGENT] JSON parsing failed or no rankings found, using fallback. Parse success: ${parseResult.success}, data:`, parseResult.data);
    
    // Fallback parsing
    return this.fallbackParseRanking(response, tools);
  }

  /**
   * Parse validation response from LLM
   */
  private parseValidationResponse(response: string): ValidationResult {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      return {
        isValid: Boolean(data.isValid || data.is_valid),
        confidence: Math.max(0, Math.min(1, parseFloat(data.confidence) || 0.5)),
        issues: Array.isArray(data.issues) ? data.issues : [],
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : []
      };
    }

    // Fallback validation
    const lowerResponse = response.toLowerCase();
    return {
      isValid: !lowerResponse.includes('invalid') && !lowerResponse.includes('not suitable'),
      confidence: 0.6,
      issues: [],
      suggestions: []
    };
  }

  /**
   * Optimize tool selection using DPO-style preference learning
   */
  private async optimizeSelection(task: string, rankedTools: ToolRanking[]): Promise<{
    selectedTools: string[];
    confidence: number;
    reasoning: string[];
  }> {
    try {
      const topTools = rankedTools.slice(0, Math.min(10, rankedTools.length));
      
      const optimizationPrompt = `Given this task and tool rankings, select the optimal combination of tools.

**Task:** "${task}"

**Ranked Tools:**
${topTools.map((tool, index) => 
  `${index + 1}. ${tool.toolId} (score: ${tool.score.toFixed(2)}) - ${tool.reasoning}`
).join('\n')}

**Selection Guidelines:**
- Choose 1-4 tools that work well together
- Avoid redundant tools
- Ensure essential functionality is covered  
- Consider execution order and dependencies

**Respond in JSON:**
{
  "selectedTools": ["tool1", "tool2"],
  "confidence": 0.85,
  "reasoning": ["reason1", "reason2"]
}`;

      const response = await this.llm.generateText(optimizationPrompt);

      const parseResult = robustJSON.parse(response, {
        fixCommonErrors: true,
        fallbackToKeyValue: true
      });

      if (parseResult.success) {
        const data = parseResult.data;
        return {
          selectedTools: Array.isArray(data.selectedTools) ? data.selectedTools : [topTools[0]?.toolId].filter(Boolean),
          confidence: Math.max(0, Math.min(1, parseFloat(data.confidence) || 0.7)),
          reasoning: Array.isArray(data.reasoning) ? data.reasoning : ["Optimized tool selection"]
        };
      }

      // Fallback: select top 2-3 tools
      return {
        selectedTools: topTools.slice(0, Math.min(3, topTools.length)).map(tool => tool.toolId),
        confidence: 0.6,
        reasoning: ["Fallback selection of top-ranked tools"]
      };

    } catch (error) {
      logger.warn("[TOOL_SELECTOR_AGENT] Selection optimization failed:", error);
      
      // Emergency fallback
      return {
        selectedTools: rankedTools.slice(0, 2).map(tool => tool.toolId),
        confidence: 0.4,
        reasoning: ["Emergency fallback selection"]
      };
    }
  }

  /**
   * Fallback ranking parser
   */
  private fallbackParseRanking(response: string, tools: ToolMetadata[]): ToolRanking[] {
    const rankings: ToolRanking[] = [];
    
    // Look for tool names and scores in the response
    for (const tool of tools) {
      const toolIndex = response.toLowerCase().indexOf(tool.name.toLowerCase());
      if (toolIndex !== -1) {
        // Try to find a score near the tool name
        const afterTool = response.substring(toolIndex);
        const scoreMatch = afterTool.match(/(\d+\.?\d*)/);
        const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0.5;
        
        rankings.push({
          toolId: tool.id,
          rank: 0,
          score: score > 1 ? score / 100 : score,
          reasoning: "Fallback parsing"
        });
      }
    }
    
    return rankings.length > 0 ? rankings : tools.map(tool => ({
      toolId: tool.id,
      rank: 0,
      score: 0.5,
      reasoning: "Default fallback"
    }));
  }

  /**
   * Calculate heuristic score for fallback ranking
   */
  private calculateHeuristicScore(task: string, tool: ToolMetadata): number {
    const taskLower = task.toLowerCase();
    const toolLower = tool.name.toLowerCase();
    const descLower = tool.description.toLowerCase();
    
    let score = 0.3; // Base score
    
    // Direct name match
    if (taskLower.includes(toolLower)) {
      score += 0.4;
    }
    
    // Category match
    if (taskLower.includes(tool.category.toLowerCase())) {
      score += 0.2;
    }
    
    // Description keyword match
    const taskWords = taskLower.split(' ');
    const matchingWords = taskWords.filter(word => 
      word.length > 3 && descLower.includes(word)
    );
    score += (matchingWords.length / taskWords.length) * 0.3;
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Utility methods for tool metadata
   */
  private categorizeToolByName(toolName: string): string {
    const name = toolName.toLowerCase();
    
    if (name.includes('file') || name.includes('read') || name.includes('write')) return 'file';
    if (name.includes('git') || name.includes('commit')) return 'version_control';
    if (name.includes('test') || name.includes('debug')) return 'testing';
    if (name.includes('shell') || name.includes('command')) return 'system';
    if (name.includes('search') || name.includes('find')) return 'search';
    if (name.includes('doc') || name.includes('documentation')) return 'documentation';
    if (name.includes('build') || name.includes('compile')) return 'build';
    
    return 'general';
  }

  private generateToolExamples(toolName: string, description: string): string[] {
    // Generate simple examples based on tool name and description
    const examples = [];
    
    if (toolName.includes('file')) {
      examples.push("Read configuration file", "Write output to file");
    } else if (toolName.includes('git')) {
      examples.push("Commit changes", "Check repository status");
    } else if (toolName.includes('search')) {
      examples.push("Find function definition", "Search for error patterns");
    }
    
    return examples.length > 0 ? examples : [`Use ${toolName} for ${description.substring(0, 50)}...`];
  }

  private inferPrerequisites(toolName: string): string[] {
    const name = toolName.toLowerCase();
    
    if (name.includes('git')) return ['git_repository'];
    if (name.includes('npm') || name.includes('node')) return ['node_project'];
    if (name.includes('python')) return ['python_environment'];
    if (name.includes('test')) return ['test_framework'];
    
    return [];
  }
}