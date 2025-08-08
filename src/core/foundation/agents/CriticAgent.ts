/**
 * Critic/Evaluator Agent - HH-RLHF style evaluation and critique
 * 
 * Implements sophisticated evaluation using Human-Human RLHF patterns
 * to assess quality, provide feedback, and suggest improvements.
 */

import { logger } from "../../../utils/logger";
import { OllamaLLM } from "../../../api/ollama";
import { robustJSON } from "../../../utils/RobustJSONParser";
import {
  ICriticAgent,
  EvaluationResult,
  EvaluationCriteria,
  CritiqueResult,
  QualityScore,
  FoundationAgentConfig
} from "../IFoundationAgent";

export class CriticAgent implements ICriticAgent {
  public readonly name = "CriticAgent";
  public readonly modelSize = "1-3B";

  private llm: OllamaLLM;
  private initialized = false;
  private config: FoundationAgentConfig;

  constructor(
    ollamaUrl: string,
    model: string,
    config?: Partial<FoundationAgentConfig>
  ) {
    this.config = {
      modelSize: '1-3B',
      temperature: 0.3, // Moderate temperature for balanced critique
      maxTokens: 1500,
      timeout: 30000,
      ...config
    };

    this.llm = new OllamaLLM({
      baseUrl: ollamaUrl,
      model: model,
      temperature: this.config.temperature,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      logger.info("[CRITIC_AGENT] Initializing critic agent...");
      
      // Mark as initialized first to prevent recursive calls
      this.initialized = true;
      
      // Test LLM connection with a simple evaluation
      await this.evaluate("test prompt", "test answer");
      
      logger.info("[CRITIC_AGENT] Critic agent initialized successfully");
    } catch (error) {
      // Reset initialization state on failure
      this.initialized = false;
      logger.error("[CRITIC_AGENT] Failed to initialize:", error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCapabilities(): string[] {
    return [
      "HH-RLHF style evaluation",
      "Multi-criteria assessment",
      "Constructive feedback generation",
      "Quality scoring across domains",
      "Bias and fairness evaluation",
      "Improvement recommendations"
    ];
  }

  /**
   * Evaluate a prompt-answer pair using HH-RLHF style assessment
   */
  async evaluate(prompt: string, answer: string): Promise<EvaluationResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      logger.debug(`[CRITIC_AGENT] Evaluating answer for prompt: ${prompt.substring(0, 100)}...`);

      const evaluationPrompt = this.buildEvaluationPrompt(prompt, answer);
      const response = await this.llm.generateText(evaluationPrompt);

      const evaluation = this.parseEvaluationResponse(response);
      
      logger.debug(`[CRITIC_AGENT] Evaluation completed with score ${evaluation.score.toFixed(2)}`);
      return evaluation;

    } catch (error) {
      logger.error("[CRITIC_AGENT] Evaluation failed:", error);
      
      return {
        score: 0.5,
        rating: 'fair',
        strengths: [],
        weaknesses: [`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`],
        suggestions: ["Unable to provide suggestions due to evaluation error"],
        confidence: 0.1
      };
    }
  }

  /**
   * Provide detailed critique based on specific criteria
   */
  async critique(response: string, criteria: EvaluationCriteria): Promise<CritiqueResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const critiquePrompt = this.buildCritiquePrompt(response, criteria);
      const llmResponse = await this.llm.generateText(critiquePrompt);

      return this.parseCritiqueResponse(llmResponse, criteria);

    } catch (error) {
      logger.error("[CRITIC_AGENT] Critique failed:", error);
      
      return {
        overallScore: 0.5,
        criteriaScores: criteria,
        feedback: `Critique failed: ${error instanceof Error ? error.message : String(error)}`,
        improvements: ["Unable to provide improvements due to critique error"]
      };
    }
  }

  /**
   * Score quality for different content types
   */
  async scoreQuality(content: string, type: 'code' | 'text' | 'reasoning'): Promise<QualityScore> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const qualityPrompt = this.buildQualityPrompt(content, type);
      const response = await this.llm.generateText(qualityPrompt);

      return this.parseQualityResponse(response, type);

    } catch (error) {
      logger.error("[CRITIC_AGENT] Quality scoring failed:", error);
      
      return {
        score: 0.5,
        aspects: {
          correctness: 0.5,
          efficiency: 0.5,
          readability: 0.5,
          maintainability: 0.5
        },
        issues: [{
          severity: 'high',
          message: `Quality scoring failed: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  }

  /**
   * Build evaluation prompt using HH-RLHF patterns
   */
  private buildEvaluationPrompt(prompt: string, answer: string): string {
    return `You are an expert evaluator trained on human preference data. Evaluate this answer using the same standards humans would apply.

**Original Prompt:**
"${prompt}"

**Answer to Evaluate:**
"${answer}"

**Evaluation Framework:**
Rate the answer on these dimensions (0.0-1.0 scale):
- **Accuracy**: Is the information correct and factual?
- **Completeness**: Does it fully address the prompt?
- **Clarity**: Is it clear and well-structured? 
- **Helpfulness**: Would this genuinely help the user?
- **Safety**: Is it safe and appropriate?

**Human Preference Factors:**
- Prefer comprehensive yet concise answers
- Value practical, actionable information
- Appreciate clear explanations and examples
- Expect appropriate tone and professionalism
- Want accurate, up-to-date information

**Respond in JSON format:**
{
  "score": 0.85,
  "rating": "excellent|good|fair|poor",
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1", "weakness2"], 
  "suggestions": ["improvement1", "improvement2"],
  "confidence": 0.90,
  "detailed_scores": {
    "accuracy": 0.9,
    "completeness": 0.8,
    "clarity": 0.85,
    "helpfulness": 0.9,
    "safety": 1.0
  }
}`;
  }

  /**
   * Build critique prompt for detailed analysis
   */
  private buildCritiquePrompt(response: string, criteria: EvaluationCriteria): string {
    return `Provide detailed critique of this response based on the specified criteria weights.

**Response to Critique:**
"${response.substring(0, 1500)}${response.length > 1500 ? '...' : ''}"

**Criteria Weights:**
- Accuracy: ${criteria.accuracy} (${(criteria.accuracy * 100).toFixed(0)}% importance)
- Completeness: ${criteria.completeness} (${(criteria.completeness * 100).toFixed(0)}% importance)  
- Clarity: ${criteria.clarity} (${(criteria.clarity * 100).toFixed(0)}% importance)
- Helpfulness: ${criteria.helpfulness} (${(criteria.helpfulness * 100).toFixed(0)}% importance)
- Safety: ${criteria.safety} (${(criteria.safety * 100).toFixed(0)}% importance)

**Instructions:**
1. Score each criterion individually (0.0-1.0)
2. Weight the scores according to the specified importance
3. Provide specific, actionable feedback
4. Suggest concrete improvements

**Respond in JSON format:**
{
  "criteriaScores": {
    "accuracy": 0.85,
    "completeness": 0.75,
    "clarity": 0.90,
    "helpfulness": 0.80,
    "safety": 1.0
  },
  "overallScore": 0.83,
  "feedback": "Detailed analysis of the response...",
  "improvements": [
    "Specific improvement 1",
    "Specific improvement 2"
  ],
  "priority_issues": ["most important issues to address"]
}`;
  }

  /**
   * Build quality scoring prompt for different content types
   */
  private buildQualityPrompt(content: string, type: 'code' | 'text' | 'reasoning'): string {
    const typeSpecificGuidelines = {
      code: {
        aspects: "correctness, efficiency, readability, maintainability",
        criteria: `
- **Correctness**: Does the code work as intended? Are there bugs or errors?
- **Efficiency**: Is it performant? Good time/space complexity?
- **Readability**: Is it clean, well-formatted, and understandable?
- **Maintainability**: Is it modular, well-structured, and extensible?`
      },
      text: {
        aspects: "clarity, coherence, accuracy, engagement",
        criteria: `
- **Clarity**: Is the writing clear and easy to understand?
- **Coherence**: Does it flow logically and stay on topic?
- **Accuracy**: Is the information correct and well-sourced?
- **Engagement**: Is it interesting and appropriate for the audience?`
      },
      reasoning: {
        aspects: "logic, completeness, validity, clarity",
        criteria: `
- **Logic**: Are the reasoning steps sound and well-connected?
- **Completeness**: Are all necessary steps included?
- **Validity**: Are the conclusions properly supported?
- **Clarity**: Is the reasoning easy to follow and understand?`
      }
    };

    const guidelines = typeSpecificGuidelines[type];

    return `Evaluate the quality of this ${type} content across multiple dimensions.

**Content to Evaluate:**
\`\`\`
${content.substring(0, 2000)}${content.length > 2000 ? '\n...[truncated]' : ''}
\`\`\`

**Quality Assessment Framework for ${type.toUpperCase()}:**
${guidelines.criteria}

**Identify Issues:**
- High severity: Critical problems that must be fixed
- Medium severity: Important improvements needed
- Low severity: Minor enhancements or style issues

**Respond in JSON format:**
{
  "score": 0.78,
  "aspects": {
    "correctness": 0.85,
    "efficiency": 0.70,
    "readability": 0.80,
    "maintainability": 0.75
  },
  "issues": [
    {
      "severity": "high|medium|low",
      "message": "Description of the issue",
      "line": 42
    }
  ],
  "strengths": ["What works well"],
  "recommendations": ["Specific improvements"]
}`;
  }

  /**
   * Parse evaluation response from LLM
   */
  private parseEvaluationResponse(response: string): EvaluationResult {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        score: Math.max(0, Math.min(1, parseFloat(data.score) || 0.5)),
        rating: this.normalizeRating(data.rating),
        strengths: Array.isArray(data.strengths) ? data.strengths : [],
        weaknesses: Array.isArray(data.weaknesses) ? data.weaknesses : [],
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        confidence: Math.max(0, Math.min(1, parseFloat(data.confidence) || 0.7))
      };
    }

    // Fallback parsing
    return this.fallbackParseEvaluation(response);
  }

  /**
   * Parse critique response from LLM
   */
  private parseCritiqueResponse(response: string, originalCriteria: EvaluationCriteria): CritiqueResult {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        overallScore: Math.max(0, Math.min(1, parseFloat(data.overallScore) || 0.5)),
        criteriaScores: this.normalizeCriteriaScores(data.criteriaScores, originalCriteria),
        feedback: data.feedback || "No detailed feedback available",
        improvements: Array.isArray(data.improvements) ? data.improvements : 
                     Array.isArray(data.priority_issues) ? data.priority_issues : []
      };
    }

    // Fallback
    return {
      overallScore: 0.5,
      criteriaScores: originalCriteria,
      feedback: "Fallback critique analysis",
      improvements: ["Unable to parse detailed improvements"]
    };
  }

  /**
   * Parse quality response from LLM
   */
  private parseQualityResponse(response: string, type: 'code' | 'text' | 'reasoning'): QualityScore {
    const parseResult = robustJSON.parse(response, {
      fixCommonErrors: true,
      fallbackToKeyValue: true
    });

    if (parseResult.success) {
      const data = parseResult.data;
      
      return {
        score: Math.max(0, Math.min(1, parseFloat(data.score) || 0.5)),
        aspects: this.normalizeAspects(data.aspects, type),
        issues: this.normalizeIssues(data.issues)
      };
    }

    // Fallback quality score
    return {
      score: 0.5,
      aspects: {
        correctness: 0.5,
        efficiency: 0.5,
        readability: 0.5,
        maintainability: 0.5
      },
      issues: [{
        severity: 'medium',
        message: 'Unable to perform detailed quality analysis'
      }]
    };
  }

  /**
   * Utility methods for normalization and fallbacks
   */
  private normalizeRating(rating: string): 'excellent' | 'good' | 'fair' | 'poor' {
    if (!rating) return 'fair';
    
    const r = rating.toLowerCase();
    if (r.includes('excellent') || r.includes('outstanding')) return 'excellent';
    if (r.includes('good') || r.includes('strong')) return 'good';
    if (r.includes('poor') || r.includes('bad') || r.includes('weak')) return 'poor';
    return 'fair';
  }

  private normalizeCriteriaScores(scores: any, fallback: EvaluationCriteria): EvaluationCriteria {
    return {
      accuracy: Math.max(0, Math.min(1, parseFloat(scores?.accuracy) || fallback.accuracy)),
      completeness: Math.max(0, Math.min(1, parseFloat(scores?.completeness) || fallback.completeness)),
      clarity: Math.max(0, Math.min(1, parseFloat(scores?.clarity) || fallback.clarity)),
      helpfulness: Math.max(0, Math.min(1, parseFloat(scores?.helpfulness) || fallback.helpfulness)),
      safety: Math.max(0, Math.min(1, parseFloat(scores?.safety) || fallback.safety))
    };
  }

  private normalizeAspects(aspects: any, type: string): QualityScore['aspects'] {
    const defaults = {
      correctness: 0.5,
      efficiency: 0.5,
      readability: 0.5,
      maintainability: 0.5
    };

    if (!aspects) return defaults;

    return {
      correctness: Math.max(0, Math.min(1, parseFloat(aspects.correctness) || defaults.correctness)),
      efficiency: Math.max(0, Math.min(1, parseFloat(aspects.efficiency) || defaults.efficiency)),
      readability: Math.max(0, Math.min(1, parseFloat(aspects.readability) || defaults.readability)),
      maintainability: Math.max(0, Math.min(1, parseFloat(aspects.maintainability) || defaults.maintainability))
    };
  }

  private normalizeIssues(issues: any): QualityScore['issues'] {
    if (!Array.isArray(issues)) return [];

    return issues.map(issue => ({
      severity: this.normalizeSeverity(issue.severity),
      message: issue.message || "No description provided",
      line: issue.line ? parseInt(issue.line) : undefined
    }));
  }

  private normalizeSeverity(severity: string): 'low' | 'medium' | 'high' {
    if (!severity) return 'medium';
    
    const s = severity.toLowerCase();
    if (s.includes('high') || s.includes('critical') || s.includes('major')) return 'high';
    if (s.includes('low') || s.includes('minor')) return 'low';
    return 'medium';
  }

  private fallbackParseEvaluation(response: string): EvaluationResult {
    const lowerResponse = response.toLowerCase();
    
    // Try to extract a score
    const scoreMatch = response.match(/(\d+\.?\d*)/);
    let score = 0.5;
    if (scoreMatch) {
      const extractedScore = parseFloat(scoreMatch[1]);
      score = extractedScore > 1 ? extractedScore / 100 : extractedScore;
    }

    // Determine rating from sentiment
    let rating: EvaluationResult['rating'] = 'fair';
    if (lowerResponse.includes('excellent') || lowerResponse.includes('outstanding')) {
      rating = 'excellent';
    } else if (lowerResponse.includes('good') || lowerResponse.includes('strong')) {
      rating = 'good';
    } else if (lowerResponse.includes('poor') || lowerResponse.includes('weak')) {
      rating = 'poor';
    }

    return {
      score: Math.max(0, Math.min(1, score)),
      rating,
      strengths: ["Fallback evaluation - unable to parse detailed strengths"],
      weaknesses: ["Fallback evaluation - unable to parse detailed weaknesses"],
      suggestions: ["Improve response parsing for better evaluation"],
      confidence: 0.3
    };
  }
}