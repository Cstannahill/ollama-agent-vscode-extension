import { logger } from "./logger";

export interface ParseResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  originalInput: string;
  method: string;
}

export interface ParseOptions {
  allowPartial?: boolean;
  stripComments?: boolean;
  fixCommonErrors?: boolean;
  maxRetries?: number;
  fallbackToKeyValue?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'none';
}

/**
 * Comprehensive, robust JSON parser that handles malformed JSON, 
 * LLM-generated content, and provides multiple fallback strategies
 */
export class RobustJSONParser {
  private static instance: RobustJSONParser;
  
  static getInstance(): RobustJSONParser {
    if (!RobustJSONParser.instance) {
      RobustJSONParser.instance = new RobustJSONParser();
    }
    return RobustJSONParser.instance;
  }

  /**
   * Main parsing method with comprehensive fallback strategies
   */
  parse<T = any>(input: string, options: ParseOptions = {}): ParseResult<T> {
    const opts: Required<ParseOptions> = {
      allowPartial: false,
      stripComments: true,
      fixCommonErrors: true,
      maxRetries: 3,
      fallbackToKeyValue: true,
      logLevel: 'debug',
      ...options
    };

    const originalInput = input;
    let attempts: Array<{ method: string, error?: string, result?: T }> = [];

    // Method 1: Standard JSON.parse
    try {
      const result = JSON.parse(input);
      this.log(opts.logLevel, `[ROBUST_JSON] Standard JSON.parse succeeded`);
      return { success: true, data: result, originalInput, method: 'standard' };
    } catch (error) {
      attempts.push({ 
        method: 'standard', 
        error: error instanceof Error ? error.message : String(error) 
      });
    }

    // Method 2: Clean and fix common issues
    if (opts.fixCommonErrors) {
      try {
        const cleaned = this.cleanJSON(input, opts);
        const result = JSON.parse(cleaned);
        this.log(opts.logLevel, `[ROBUST_JSON] Cleaned JSON parse succeeded`);
        return { success: true, data: result, originalInput, method: 'cleaned' };
      } catch (error) {
        attempts.push({ 
          method: 'cleaned', 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }

    // Method 3: Extract JSON from mixed content
    try {
      const extracted = this.extractJSON(input);
      if (extracted) {
        const result = JSON.parse(extracted);
        this.log(opts.logLevel, `[ROBUST_JSON] JSON extraction succeeded`);
        return { success: true, data: result, originalInput, method: 'extracted' };
      }
    } catch (error) {
      attempts.push({ 
        method: 'extracted', 
        error: error instanceof Error ? error.message : String(error) 
      });
    }

    // Method 4: Progressive parsing (find largest valid JSON)
    if (opts.allowPartial) {
      try {
        const partial = this.parsePartialJSON(input);
        if (partial) {
          this.log(opts.logLevel, `[ROBUST_JSON] Partial JSON parse succeeded`);
          return { success: true, data: partial, originalInput, method: 'partial' };
        }
      } catch (error) {
        attempts.push({ 
          method: 'partial', 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }

    // Method 5: Repair malformed JSON
    try {
      const repaired = this.repairJSON(input);
      if (repaired) {
        const result = JSON.parse(repaired);
        this.log(opts.logLevel, `[ROBUST_JSON] Repaired JSON parse succeeded`);
        return { success: true, data: result, originalInput, method: 'repaired' };
      }
    } catch (error) {
      attempts.push({ 
        method: 'repaired', 
        error: error instanceof Error ? error.message : String(error) 
      });
    }

    // Method 6: Key-value parsing fallback
    if (opts.fallbackToKeyValue) {
      try {
        const kvResult = this.parseAsKeyValue(input);
        if (kvResult && Object.keys(kvResult).length > 0) {
          this.log(opts.logLevel, `[ROBUST_JSON] Key-value parsing succeeded`);
          return { success: true, data: kvResult as T, originalInput, method: 'key-value' };
        }
      } catch (error) {
        attempts.push({ 
          method: 'key-value', 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }

    // Method 7: LLM response pattern parsing
    try {
      const llmResult = this.parseLLMResponse(input);
      if (llmResult) {
        this.log(opts.logLevel, `[ROBUST_JSON] LLM response parsing succeeded`);
        return { success: true, data: llmResult, originalInput, method: 'llm-pattern' };
      }
    } catch (error) {
      attempts.push({ 
        method: 'llm-pattern', 
        error: error instanceof Error ? error.message : String(error) 
      });
    }

    // All methods failed
    const errorSummary = attempts.map(a => `${a.method}: ${a.error}`).join('; ');
    this.log(opts.logLevel, `[ROBUST_JSON] All parsing methods failed: ${errorSummary}`);
    
    return { 
      success: false, 
      error: `All parsing methods failed. Attempts: ${errorSummary}`, 
      originalInput, 
      method: 'none' 
    };
  }

  /**
   * Clean JSON by fixing common formatting issues
   */
  private cleanJSON(input: string, options: ParseOptions): string {
    let cleaned = input.trim();

    // Remove comments if requested
    if (options.stripComments) {
      cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, ''); // Block comments
      cleaned = cleaned.replace(/\/\/.*$/gm, ''); // Line comments
    }

    // Fix common LLM JSON issues
    cleaned = cleaned
      // Fix unescaped quotes inside strings
      .replace(/: "([^"]*)"([^",}\]\s])/g, ': "$1\\"$2')
      // Fix missing quotes around keys
      .replace(/(\w+):/g, '"$1":')
      // Fix trailing commas
      .replace(/,\s*([}\]])/g, '$1')
      // Fix single quotes to double quotes
      .replace(/'/g, '"')
      // Fix escaped quotes that shouldn't be escaped
      .replace(/\\"/g, '\uE000') // Temporarily replace
      .replace(/"/g, '"')
      .replace(/\uE000/g, '\\"') // Restore properly escaped quotes
      // Remove extra commas
      .replace(/,+/g, ',')
      // Fix missing commas between objects/arrays
      .replace(/}\s*{/g, '},{')
      .replace(/]\s*\[/g, '],[')
      // Fix malformed nested quotes like {"key": "value": "value2"}
      .replace(/:\s*"([^"]*)":\s*"([^"]*)"/g, ': "$1$2"');

    return cleaned;
  }

  /**
   * Extract JSON from mixed content (markdown, text, etc.)
   */
  private extractJSON(input: string): string | null {
    // Try to find JSON in code blocks
    const codeBlockMatch = input.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Find JSON objects
    const jsonMatch = input.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0].trim();
    }

    // Find JSON arrays
    const arrayMatch = input.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return arrayMatch[0].trim();
    }

    return null;
  }

  /**
   * Parse partial JSON by finding the largest valid JSON substring
   */
  private parsePartialJSON(input: string): any {
    const trimmed = input.trim();
    
    // Try progressively smaller substrings
    for (let i = trimmed.length; i > 0; i--) {
      const substring = trimmed.substring(0, i);
      
      // Try to balance braces and complete the JSON
      const balanced = this.balanceJSON(substring);
      
      try {
        return JSON.parse(balanced);
      } catch (error) {
        continue;
      }
    }
    
    return null;
  }

  /**
   * Balance JSON by adding missing closing braces/brackets
   */
  private balanceJSON(input: string): string {
    let result = input;
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (inString) continue;
      
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
    }

    // Add missing closing characters
    while (braceCount > 0) {
      result += '}';
      braceCount--;
    }
    
    while (bracketCount > 0) {
      result += ']';
      bracketCount--;
    }

    return result;
  }

  /**
   * Repair malformed JSON using common patterns
   */
  private repairJSON(input: string): string | null {
    let repaired = input.trim();

    // Common repairs
    const repairs = [
      // Fix malformed quotes like {\"key\": \"value\"}
      { pattern: /\{\\?"([^"]+)\\?":\s*\\?"([^"]+)\\?"\}/g, replacement: '{"$1": "$2"}' },
      
      // Fix missing quotes around string values
      { pattern: /:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*([,}])/g, replacement: ': "$1"$2' },
      
      // Fix missing quotes around keys that are already quoted weirdly
      { pattern: /\{([^"{\[].*?):/g, replacement: '{"$1":' },
      
      // Fix double-escaped quotes
      { pattern: /\\\\"/g, replacement: '\\"' },
      
      // Fix weird nested quote patterns
      { pattern: /"\s*{\s*"([^"]+)"\s*:\s*"([^"]+)"\s*}\s*"/g, replacement: '{"$1": "$2"}' },
      
      // Fix array-like structures that aren't arrays
      { pattern: /\[([^[\]]+)\]/g, replacement: (match: string, content: string) => {
        if (content.includes(':')) return match; // Already an object
        return `["${content.split(',').map((s: string) => s.trim()).join('", "')}"]`;
      }},
    ];

    for (const repair of repairs) {
      repaired = repaired.replace(repair.pattern, repair.replacement as string);
    }

    // Try parsing the repaired version
    try {
      JSON.parse(repaired);
      return repaired;
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse input as key-value pairs
   */
  private parseAsKeyValue(input: string): Record<string, any> | null {
    const result: Record<string, any> = {};
    const lines = input.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

      // Try different key-value patterns
      const patterns = [
        /^"?([^":\s]+)"?\s*:\s*"?([^"]*)"?$/,  // key: value
        /^([^=\s]+)\s*=\s*(.*)$/,              // key=value
        /^"?([^":\s]+)"?\s*->\s*"?([^"]*)"?$/, // key -> value
      ];

      for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (match) {
          let key = match[1].trim();
          let value = match[2].trim();

          // Remove quotes from key and value
          key = key.replace(/^["']|["']$/g, '');
          value = value.replace(/^["']|["']$/g, '');

          // Try to parse value as JSON, number, or boolean
          try {
            if (value === 'true') result[key] = true;
            else if (value === 'false') result[key] = false;
            else if (value === 'null') result[key] = null;
            else if (/^\d+$/.test(value)) result[key] = parseInt(value);
            else if (/^\d+\.\d+$/.test(value)) result[key] = parseFloat(value);
            else result[key] = value;
          } catch (error) {
            result[key] = value;
          }
          break;
        }
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Parse LLM response patterns
   */
  private parseLLMResponse(input: string): any {
    // Common LLM patterns
    const patterns = [
      // ACTION_INPUT: {...}
      /ACTION_INPUT:\s*(\{[\s\S]*?\})/i,
      
      // INPUT: {...}
      /INPUT:\s*(\{[\s\S]*?\})/i,
      
      // Parameters: {...}
      /Parameters:\s*(\{[\s\S]*?\})/i,
      
      // Args: {...}
      /Args:\s*(\{[\s\S]*?\})/i,
    ];

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch (error) {
          // Try cleaning this specific match
          try {
            const cleaned = this.cleanJSON(match[1], { fixCommonErrors: true });
            return JSON.parse(cleaned);
          } catch (cleanError) {
            continue;
          }
        }
      }
    }

    return null;
  }

  /**
   * Validate JSON structure
   */
  isValidJSON(input: string): boolean {
    try {
      JSON.parse(input);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Safe stringify with circular reference handling
   */
  stringify(obj: any, space?: number): string {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular Reference]';
        }
        seen.add(value);
      }
      return value;
    }, space);
  }

  /**
   * Parse with schema validation
   */
  parseWithSchema<T>(input: string, validator: (obj: any) => obj is T, options?: ParseOptions): ParseResult<T> {
    const result = this.parse(input, options);
    
    if (!result.success) {
      return result as ParseResult<T>;
    }

    if (validator(result.data)) {
      return result as ParseResult<T>;
    }

    return {
      success: false,
      error: 'Parsed data does not match expected schema',
      originalInput: input,
      method: result.method
    };
  }

  private log(level: string, message: string): void {
    if (level === 'none') return;
    
    switch (level) {
      case 'debug':
        logger.debug(message);
        break;
      case 'info':
        logger.info(message);
        break;
      case 'warn':
        logger.warn(message);
        break;
      case 'error':
        logger.error(message);
        break;
    }
  }
}

// Export singleton instance
export const robustJSON = RobustJSONParser.getInstance();