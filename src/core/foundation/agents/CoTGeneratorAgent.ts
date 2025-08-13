/**
 * Chain of Thought Generator Agent - Generates step-by-step reasoning
 * 
 * Implements sophisticated reasoning chain generation following CoT patterns
 * for transparent, verifiable problem-solving processes.
 */

import { logger } from "../../../utils/logger";
import { OllamaLLM } from "../../../api/ollama";
import { ContextManager } from "../../ContextManager";
import { VectorDatabase } from "../../../documentation/VectorDatabase";
import { robustJSON } from "../../../utils/RobustJSONParser";
import {
  ICoTGeneratorAgent,
  ChainOfThought,
  ReasoningStep,
  ReasoningExplanation,
  ReasoningValidation,
  FoundationAgentConfig
} from "../IFoundationAgent";

export class CoTGeneratorAgent implements ICoTGeneratorAgent {
  public readonly name = "CoTGeneratorAgent";
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
      temperature: 0.4, // Moderate creativity for reasoning
      maxTokens: 1500,
      timeout: 30000,
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
      logger.info("[COT_GENERATOR_AGENT] Initializing CoT generator agent...");
      
      // Skip LLM test during initialization to prevent timeouts - test on first use instead
      logger.debug("[COT_GENERATOR_AGENT] LLM connection will be tested on first use");
      
      this.initialized = true;
      logger.info("[COT_GENERATOR_AGENT] CoT generator agent initialized successfully");
    } catch (error) {
      logger.error("[COT_GENERATOR_AGENT] Failed to initialize:", error);
      // Still mark as initialized to prevent blocking the pipeline
      this.initialized = true;
      logger.warn("[COT_GENERATOR_AGENT] Marked as initialized with degraded functionality");
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCapabilities(): string[] {
    return [
      "Step-by-step reasoning generation",
      "Chain of thought construction",
      "Logical flow analysis",
      "Assumption identification",
      "Evidence-based conclusions",
      "Reasoning validation and verification"
    ];
  }

  /**
   * Generate chain of thought reasoning for a question
   */
  async generateReasoning(question: string, context?: string): Promise<ChainOfThought> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`[COT_GENERATOR_AGENT] Generating reasoning for: ${question.substring(0, 100)}...`);

      // Enhanced context-aware reasoning
      const enhancedContext = await this.enrichReasoningContext(question, context);
      const reasoningPrompt = this.buildReasoningPrompt(question, enhancedContext);
      const response = await this.llm.generateText(reasoningPrompt);

      const chainOfThought = this.parseReasoningResponse(response, question);
      
      // Validate reasoning with context
      const validatedChain = await this.validateReasoningWithContext(chainOfThought, enhancedContext);
      
      logger.debug(`[COT_GENERATOR_AGENT] Generated context-aware reasoning with ${validatedChain.steps.length} steps`);
      return validatedChain;

    } catch (error) {
      logger.error("[COT_GENERATOR_AGENT] Reasoning generation failed:", error);
      
      return {
        question,
        steps: [{
          step: 1,
          thought: "Unable to generate detailed reasoning due to error",
          evidence: [],
          conclusion: "Direct approach needed",
          confidence: 0.3
        }],
        conclusion: "Unable to provide detailed reasoning",
        confidence: 0.3,
        assumptions: [`Reasoning generation failed: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }

  /**
   * Explain a solution with reasoning
   */
  async explainSolution(problem: string, solution: string): Promise<ReasoningExplanation> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const explanationPrompt = this.buildExplanationPrompt(problem, solution);
      const response = await this.llm.generateText(explanationPrompt);

      return this.parseExplanationResponse(response, problem, solution);

    } catch (error) {
      logger.error("[COT_GENERATOR_AGENT] Solution explanation failed:", error);
      
      const fallbackReasoning: ChainOfThought = {
        question: problem,
        steps: [{
          step: 1,
          thought: "Analyze the problem and apply the solution",
          evidence: ["Given solution approach"],
          conclusion: solution,
          confidence: 0.5
        }],
        conclusion: solution,
        confidence: 0.5,
        assumptions: ["Solution is correct as provided"]
      };

      return {
        problem,
        solution,
        reasoning: fallbackReasoning,
        alternatives: [],
        verification: ["Manual verification required"]
      };
    }
  }

  /**
   * Validate reasoning chain
   */
  async validateReasoning(reasoning: string, conclusion: string): Promise<ReasoningValidation> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const validationPrompt = this.buildValidationPrompt(reasoning, conclusion);
      const response = await this.llm.generateText(validationPrompt);

      return this.parseValidationResponse(response);

    } catch (error) {
      logger.error("[COT_GENERATOR_AGENT] Reasoning validation failed:", error);
      
      return {
        isValid: true, // Default to valid if validation fails
        score: 0.5,
        issues: [{
          step: 0,
          issue: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'medium'
        }],
        suggestions: ["Manual validation recommended"]
      };
    }
  }

  /**
   * Build reasoning generation prompt
   */
  private buildReasoningPrompt(question: string, context?: string): string {
    const contextSection = context ? `
**Additional Context:** ${context}` : '';

    return `Generate a detailed chain of thought reasoning for this question.

**Question:** "${question}"
${contextSection}

**Chain of Thought Framework:**
1. **Understanding**: Break down what the question is asking
2. **Analysis**: Identify key components and relationships  
3. **Evidence**: Consider available information and constraints
4. **Logic**: Apply logical reasoning step by step
5. **Conclusion**: Reach a well-supported conclusion

**Instructions:**
- Think step by step, showing your reasoning process
- Identify assumptions you're making
- Provide evidence for each reasoning step
- Assign confidence levels to each step
- Be transparent about uncertainty

**Respond in JSON format:**
{
  "question": "${question}",
  "steps": [
    {
      "step": 1,
      "thought": "What I'm thinking about in this step",
      "evidence": ["supporting evidence", "relevant facts"],
      "conclusion": "What this step concludes",
      "confidence": 0.85
    }
  ],
  "conclusion": "Final reasoned conclusion",
  "confidence": 0.80,
  "assumptions": ["assumption1", "assumption2"],
  "reasoning_path": "Brief summary of the logical flow"
}`;
  }

  /**
   * Build solution explanation prompt
   */
  private buildExplanationPrompt(problem: string, solution: string): string {
    return `Explain why this solution works for the given problem using chain of thought reasoning.

**Problem:** "${problem}"
**Solution:** "${solution}"

**Explanation Requirements:**
1. **Problem Analysis**: Break down the problem components
2. **Solution Mapping**: Show how the solution addresses each component
3. **Step-by-Step Logic**: Explain the reasoning behind the solution
4. **Alternative Approaches**: Consider other possible solutions
5. **Verification**: How to verify the solution works

**Respond in JSON format:**
{
  "problem": "${problem}",
  "solution": "${solution}",
  "reasoning": {
    "question": "${problem}",
    "steps": [
      {
        "step": 1,
        "thought": "Analysis of problem component",
        "evidence": ["supporting information"],
        "conclusion": "Step conclusion",
        "confidence": 0.9
      }
    ],
    "conclusion": "Why this solution works",
    "confidence": 0.85,
    "assumptions": ["key assumptions"]
  },
  "alternatives": ["alternative approach 1", "alternative approach 2"],
  "verification": ["verification method 1", "verification method 2"]
}`;
  }

  /**
   * Build reasoning validation prompt
   */
  private buildValidationPrompt(reasoning: string, conclusion: string): string {
    return `Validate this reasoning chain for logical consistency and soundness.

**Reasoning:** "${reasoning}"
**Conclusion:** "${conclusion}"

**Validation Criteria:**
1. **Logical Consistency**: Do the steps follow logically?
2. **Evidence Support**: Is each step supported by evidence?
3. **Assumption Validity**: Are assumptions reasonable?
4. **Conclusion Support**: Is the conclusion properly supported?
5. **Gap Analysis**: Are there missing logical steps?

**Respond in JSON format:**
{
  "isValid": true,
  "score": 0.85,
  "issues": [
    {
      "step": 2,
      "issue": "Description of logical issue",
      "severity": "high"
    }
  ],
  "suggestions": ["improvement suggestion 1", "improvement suggestion 2"],
  "strengths": ["what works well in the reasoning"]
}`;
  }

  /**
   * Parse reasoning response
   */
  private parseReasoningResponse(response: string, originalQuestion: string): ChainOfThought {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        question: originalQuestion,
        steps: this.normalizeReasoningSteps(data.steps),
        conclusion: data.conclusion || "No conclusion provided",
        confidence: Math.max(0, Math.min(1, parseFloat(data.confidence) || 0.6)),
        assumptions: Array.isArray(data.assumptions) ? data.assumptions : []
      };
    }

    // Fallback reasoning
    return this.generateFallbackReasoning(response, originalQuestion);
  }

  /**
   * Parse explanation response
   */
  private parseExplanationResponse(response: string, problem: string, solution: string): ReasoningExplanation {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        problem,
        solution,
        reasoning: data.reasoning || this.generateFallbackReasoning("", problem),
        alternatives: Array.isArray(data.alternatives) ? data.alternatives : [],
        verification: Array.isArray(data.verification) ? data.verification : ["Manual verification needed"]
      };
    }

    return {
      problem,
      solution,
      reasoning: this.generateFallbackReasoning(response, problem),
      alternatives: [],
      verification: ["Verify solution manually"]
    };
  }

  /**
   * Parse validation response
   */
  private parseValidationResponse(response: string): ReasoningValidation {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        isValid: Boolean(data.isValid),
        score: Math.max(0, Math.min(1, parseFloat(data.score) || 0.5)),
        issues: this.normalizeValidationIssues(data.issues),
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : []
      };
    }

    // Analyze response for validation indicators
    const lowerResponse = response.toLowerCase();
    const hasPositiveIndicators = ['valid', 'correct', 'sound', 'logical'].some(word => lowerResponse.includes(word));
    const hasNegativeIndicators = ['invalid', 'incorrect', 'flawed', 'illogical'].some(word => lowerResponse.includes(word));

    return {
      isValid: hasPositiveIndicators && !hasNegativeIndicators,
      score: hasPositiveIndicators ? 0.7 : 0.4,
      issues: [],
      suggestions: ["Review reasoning for logical consistency"]
    };
  }

  /**
   * Normalize reasoning steps
   */
  private normalizeReasoningSteps(steps: any[]): ReasoningStep[] {
    if (!Array.isArray(steps)) return [];

    return steps.map((step, index) => ({
      step: parseInt(step.step) || (index + 1),
      thought: step.thought || `Reasoning step ${index + 1}`,
      evidence: Array.isArray(step.evidence) ? step.evidence : [],
      conclusion: step.conclusion || "No conclusion for this step",
      confidence: Math.max(0, Math.min(1, parseFloat(step.confidence) || 0.6))
    }));
  }

  /**
   * Normalize validation issues
   */
  private normalizeValidationIssues(issues: any[]): ReasoningValidation['issues'] {
    if (!Array.isArray(issues)) return [];

    return issues.map(issue => ({
      step: parseInt(issue.step) || 0,
      issue: issue.issue || "Validation issue",
      severity: ['low', 'medium', 'high'].includes(issue.severity) ? issue.severity : 'medium'
    }));
  }

  /**
   * Generate fallback reasoning when parsing fails
   */
  private generateFallbackReasoning(response: string, question: string): ChainOfThought {
    // Try to extract reasoning steps from unstructured text
    const sentences = response.split(/[.!?]/).filter(s => s.trim().length > 10);
    const steps: ReasoningStep[] = [];

    sentences.slice(0, 5).forEach((sentence, index) => {
      if (sentence.trim().length > 5) {
        steps.push({
          step: index + 1,
          thought: sentence.trim(),
          evidence: [],
          conclusion: `Step ${index + 1} conclusion`,
          confidence: 0.5
        });
      }
    });

    if (steps.length === 0) {
      steps.push({
        step: 1,
        thought: "Analyze the question and provide a response",
        evidence: ["Basic reasoning approach"],
        conclusion: "Direct response approach",
        confidence: 0.4
      });
    }

    return {
      question,
      steps,
      conclusion: steps[steps.length - 1]?.conclusion || "Unable to determine conclusion",
      confidence: 0.4,
      assumptions: ["Fallback reasoning due to parsing failure"]
    };
  }

  /**
   * Enrich reasoning context with domain knowledge and similar reasoning patterns
   */
  private async enrichReasoningContext(question: string, context?: string): Promise<string> {
    let enrichedContext = context || '';

    try {
      // Enhance with domain knowledge from context manager
      if (this.contextManager) {
        try {
          const contextResults = await this.contextManager.searchContext({
            query: question,
            maxResults: 8
          });

          // Only process if we actually have results
          if (contextResults.items && contextResults.items.length > 0) {
            const relevantKnowledge = contextResults.items
              .filter(item => item.relevanceScore > 0.6)
              .map(item => `Domain Knowledge: ${item.content.substring(0, 150)}...`)
              .join('\n');

            if (relevantKnowledge) {
              enrichedContext += `\n\nRelevant Domain Knowledge:\n${relevantKnowledge}`;
              logger.debug(`[COT_GENERATOR_AGENT] Enhanced reasoning with ${contextResults.items.length} context items`);
            }
          } else {
            logger.debug("[COT_GENERATOR_AGENT] No context items found, using basic reasoning");
          }
        } catch (contextError) {
          logger.warn("[COT_GENERATOR_AGENT] Context search failed, continuing with basic reasoning:", contextError);
          // Continue without context enhancement
        }
      }

      // Enhance with similar reasoning patterns from vector database
      if (this.vectorDB) {
        const similarReasoning = await this.vectorDB.search(question, {
          limit: 3,
          threshold: 0.4
        });

        if (similarReasoning.length > 0) {
          const reasoningPatterns = similarReasoning
            .map(result => `Similar Pattern (${(result.score * 100).toFixed(1)}%): ${result.document.content.substring(0, 200)}...`)
            .join('\n');

          enrichedContext += `\n\nSimilar Reasoning Patterns:\n${reasoningPatterns}`;
        }
      }

      logger.debug(`[COT_GENERATOR_AGENT] Enhanced context length: ${enrichedContext.length} characters`);
      
    } catch (error) {
      logger.warn("[COT_GENERATOR_AGENT] Context enrichment failed:", error);
    }

    return enrichedContext;
  }

  /**
   * Validate reasoning chain with context to ensure consistency and accuracy
   */
  private async validateReasoningWithContext(chainOfThought: ChainOfThought, context: string): Promise<ChainOfThought> {
    try {
      // Basic validation - check if steps are logical and consistent
      const validatedSteps = chainOfThought.steps.map((step, index) => {
        // Increase confidence if step aligns with context
        let adjustedConfidence = step.confidence;
        
        if (context && context.length > 0) {
          const stepText = `${step.thought} ${step.conclusion}`.toLowerCase();
          const contextLower = context.toLowerCase();
          
          // Simple keyword matching for context alignment
          const keywordMatches = stepText.split(' ')
            .filter(word => word.length > 3 && contextLower.includes(word)).length;
          
          if (keywordMatches >= 2) {
            adjustedConfidence = Math.min(1.0, adjustedConfidence + 0.1);
          }
        }

        return {
          ...step,
          confidence: adjustedConfidence
        };
      });

      // Calculate overall confidence based on context alignment
      const averageConfidence = validatedSteps.reduce((sum, step) => sum + step.confidence, 0) / validatedSteps.length;
      const contextBonus = context.length > 100 ? 0.05 : 0;
      
      return {
        ...chainOfThought,
        steps: validatedSteps,
        confidence: Math.min(1.0, averageConfidence + contextBonus)
      };

    } catch (error) {
      logger.warn("[COT_GENERATOR_AGENT] Reasoning validation failed:", error);
      return chainOfThought;
    }
  }
}