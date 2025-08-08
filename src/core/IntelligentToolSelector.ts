import { BaseTool } from "./BaseTool";
import { logger } from "../utils/logger";

export interface ToolRelevanceScore {
  toolName: string;
  score: number;
  reason: string;
}

export interface ToolSelectionStrategy {
  name: string;
  selectTools(
    task: string,
    availableTools: Map<string, BaseTool>,
    maxTools?: number
  ): ToolRelevanceScore[];
}

/**
 * Intelligently selects relevant tools based on task content to minimize prompt size
 */
export class IntelligentToolSelector {
  private strategies: Map<string, ToolSelectionStrategy> = new Map();
  private toolUsageHistory: Map<string, number> = new Map();
  
  constructor() {
    this.registerDefaultStrategies();
  }

  /**
   * Select the most relevant tools for a given task
   */
  public selectRelevantTools(
    task: string,
    availableTools: Map<string, BaseTool>,
    maxTools: number = 8
  ): BaseTool[] {
    const strategy = this.selectBestStrategy(task);
    const relevantTools = strategy.selectTools(task, availableTools, maxTools);
    
    // Log selection for debugging
    logger.debug(
      `[TOOL_SELECTOR] Selected ${relevantTools.length} tools using ${strategy.name} strategy`,
      { 
        selectedTools: relevantTools.map(t => t.toolName),
        scores: relevantTools.map(t => `${t.toolName}:${t.score.toFixed(2)}`)
      }
    );

    // Update usage history
    relevantTools.forEach(tool => {
      const current = this.toolUsageHistory.get(tool.toolName) || 0;
      this.toolUsageHistory.set(tool.toolName, current + 1);
    });

    return relevantTools
      .map(scored => availableTools.get(scored.toolName))
      .filter((tool): tool is BaseTool => tool !== undefined);
  }

  /**
   * Estimate context savings from tool selection
   */
  public estimateContextSavings(
    selectedToolCount: number,
    totalToolCount: number,
    averageToolDescriptionLength: number
  ): { savedTokens: number; savedPercentage: number } {
    const savedTools = totalToolCount - selectedToolCount;
    const savedTokens = savedTools * (averageToolDescriptionLength / 4); // Rough token estimate
    const savedPercentage = (savedTools / totalToolCount) * 100;
    
    return { savedTokens, savedPercentage };
  }

  private selectBestStrategy(task: string): ToolSelectionStrategy {
    // Simple strategy selection based on task content
    const taskLower = task.toLowerCase();
    
    if (taskLower.includes('git') || taskLower.includes('commit') || taskLower.includes('branch')) {
      return this.strategies.get('git-focused')!;
    }
    
    if (taskLower.includes('test') || taskLower.includes('coverage') || taskLower.includes('jest')) {
      return this.strategies.get('testing-focused')!;
    }
    
    if (taskLower.includes('lint') || taskLower.includes('format') || taskLower.includes('analysis') || taskLower.includes('security') || taskLower.includes('complexity')) {
      return this.strategies.get('analysis-focused')!;
    }
    
    if (taskLower.includes('file') || taskLower.includes('read') || taskLower.includes('write')) {
      return this.strategies.get('file-focused')!;
    }
    
    return this.strategies.get('keyword-based')!;
  }

  private registerDefaultStrategies(): void {
    // Keyword-based strategy (most general)
    this.strategies.set('keyword-based', new KeywordBasedStrategy());
    
    // File-focused strategy
    this.strategies.set('file-focused', new FileFocusedStrategy());
    
    // Git-focused strategy
    this.strategies.set('git-focused', new GitFocusedStrategy());
    
    // Testing-focused strategy
    this.strategies.set('testing-focused', new TestingFocusedStrategy());
    
    // Code analysis-focused strategy
    this.strategies.set('analysis-focused', new AnalysisFocusedStrategy());
    
    // Frequency-based strategy
    this.strategies.set('frequency-based', new FrequencyBasedStrategy(this.toolUsageHistory));
  }
}

/**
 * Selects tools based on keyword matching
 */
class KeywordBasedStrategy implements ToolSelectionStrategy {
  name = "keyword-based";

  private readonly toolKeywords: { [toolName: string]: string[] } = {
    // File operations
    'file_read': ['read', 'view', 'show', 'display', 'examine', 'check', 'look', 'see', 'content'],
    'file_write': ['write', 'create', 'save', 'generate', 'make', 'build', 'implement'],
    'file_append': ['append', 'add to', 'extend', 'update'],
    'file_list': ['list', 'ls', 'directory', 'folder', 'files', 'structure'],
    'directory_create': ['mkdir', 'create directory', 'create folder', 'make directory'],
    
    // Shell operations
    'run_shell': ['run', 'execute', 'command', 'shell', 'bash', 'npm', 'node', 'install'],
    'vscode_command': ['vscode', 'editor', 'format', 'organize'],
    'open_file': ['open', 'edit', 'goto', 'navigate'],
    
    // Git operations
    'git_status': ['git status', 'git', 'status', 'changes', 'modified'],
    'git_add': ['git add', 'stage', 'staging'],
    'git_commit': ['commit', 'git commit', 'save changes'],
    'git_branch': ['branch', 'git branch', 'checkout', 'switch'],
    'git_log': ['git log', 'history', 'commits', 'log'],
    'git_diff': ['diff', 'git diff', 'changes', 'differences'],
    'git_stash': ['stash', 'git stash', 'temporary'],
    'git_remote': ['remote', 'git remote', 'origin', 'upstream'],
    
    // Testing operations
    'run_tests': ['test', 'tests', 'testing', 'jest', 'mocha', 'vitest', 'pytest'],
    'generate_test': ['generate test', 'create test', 'test generation'],
    'test_coverage': ['coverage', 'test coverage', 'coverage report'],
    
    // Code analysis and linting operations
    'eslint': ['eslint', 'lint', 'linting', 'code quality', 'style guide', 'formatting'],
    'prettier': ['prettier', 'format', 'formatting', 'code style', 'beautify'],
    'typescript_check': ['typescript', 'tsc', 'type check', 'compilation', 'type error'],
    'analyze_complexity': ['complexity', 'cyclomatic', 'maintainability', 'code metrics'],
    'security_scan': ['security', 'vulnerability', 'security scan', 'security audit', 'vulnerable'],
  };

  selectTools(
    task: string,
    availableTools: Map<string, BaseTool>,
    maxTools: number = 8
  ): ToolRelevanceScore[] {
    const taskLower = task.toLowerCase();
    const scores: ToolRelevanceScore[] = [];

    for (const [toolName, tool] of availableTools.entries()) {
      const keywords = this.toolKeywords[toolName] || [];
      let score = 0;
      let matchedKeywords: string[] = [];

      // Check for keyword matches
      for (const keyword of keywords) {
        if (taskLower.includes(keyword.toLowerCase())) {
          score += this.getKeywordWeight(keyword);
          matchedKeywords.push(keyword);
        }
      }

      // Boost essential tools
      if (this.isEssentialTool(toolName)) {
        score += 0.3;
      }

      // Add base relevance for core tools
      if (this.isCoreFileOperation(toolName)) {
        score += 0.2;
      }

      if (score > 0) {
        scores.push({
          toolName,
          score,
          reason: `Keywords: ${matchedKeywords.join(', ') || 'essential/core tool'}`
        });
      }
    }

    // Always include file_read as it's commonly needed
    if (!scores.find(s => s.toolName === 'file_read')) {
      scores.push({
        toolName: 'file_read',
        score: 0.5,
        reason: 'Essential file operation'
      });
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, maxTools);
  }

  private getKeywordWeight(keyword: string): number {
    // Longer, more specific keywords get higher weights
    if (keyword.length > 10) return 1.0;
    if (keyword.length > 6) return 0.8;
    return 0.6;
  }

  private isEssentialTool(toolName: string): boolean {
    return ['file_read', 'file_write', 'run_shell'].includes(toolName);
  }

  private isCoreFileOperation(toolName: string): boolean {
    return ['file_read', 'file_write', 'file_list', 'file_append'].includes(toolName);
  }
}

/**
 * Strategy focused on file operations
 */
class FileFocusedStrategy implements ToolSelectionStrategy {
  name = "file-focused";

  selectTools(
    task: string,
    availableTools: Map<string, BaseTool>,
    maxTools: number = 8
  ): ToolRelevanceScore[] {
    const priorities = [
      { toolName: 'file_read', score: 1.0, reason: 'Primary file operation' },
      { toolName: 'file_write', score: 0.9, reason: 'Primary file operation' },
      { toolName: 'file_list', score: 0.8, reason: 'File exploration' },
      { toolName: 'file_append', score: 0.7, reason: 'File modification' },
      { toolName: 'directory_create', score: 0.6, reason: 'File system operation' },
      { toolName: 'open_file', score: 0.5, reason: 'File navigation' },
      { toolName: 'vscode_command', score: 0.4, reason: 'Editor integration' },
      { toolName: 'run_shell', score: 0.3, reason: 'System commands' },
    ];

    return priorities
      .filter(p => availableTools.has(p.toolName))
      .slice(0, maxTools);
  }
}

/**
 * Strategy focused on Git operations
 */
class GitFocusedStrategy implements ToolSelectionStrategy {
  name = "git-focused";

  selectTools(
    task: string,
    availableTools: Map<string, BaseTool>,
    maxTools: number = 8
  ): ToolRelevanceScore[] {
    const priorities = [
      { toolName: 'git_status', score: 1.0, reason: 'Git workflow essential' },
      { toolName: 'git_add', score: 0.9, reason: 'Staging changes' },
      { toolName: 'git_commit', score: 0.9, reason: 'Committing changes' },
      { toolName: 'git_diff', score: 0.8, reason: 'Viewing changes' },
      { toolName: 'git_branch', score: 0.7, reason: 'Branch management' },
      { toolName: 'git_log', score: 0.6, reason: 'History viewing' },
      { toolName: 'file_read', score: 0.5, reason: 'File examination' },
      { toolName: 'file_write', score: 0.4, reason: 'File modification' },
    ];

    return priorities
      .filter(p => availableTools.has(p.toolName))
      .slice(0, maxTools);
  }
}

/**
 * Strategy focused on testing operations
 */
class TestingFocusedStrategy implements ToolSelectionStrategy {
  name = "testing-focused";

  selectTools(
    task: string,
    availableTools: Map<string, BaseTool>,
    maxTools: number = 8
  ): ToolRelevanceScore[] {
    const priorities = [
      { toolName: 'run_tests', score: 1.0, reason: 'Primary testing operation' },
      { toolName: 'test_coverage', score: 0.9, reason: 'Coverage analysis' },
      { toolName: 'generate_test', score: 0.8, reason: 'Test generation' },
      { toolName: 'file_read', score: 0.7, reason: 'Reading source files' },
      { toolName: 'file_write', score: 0.6, reason: 'Writing test files' },
      { toolName: 'file_list', score: 0.5, reason: 'Finding test files' },
      { toolName: 'run_shell', score: 0.4, reason: 'Running test commands' },
      { toolName: 'open_file', score: 0.3, reason: 'Navigating to files' },
    ];

    return priorities
      .filter(p => availableTools.has(p.toolName))
      .slice(0, maxTools);
  }
}

/**
 * Strategy focused on code analysis and linting operations
 */
class AnalysisFocusedStrategy implements ToolSelectionStrategy {
  name = "analysis-focused";

  selectTools(
    task: string,
    availableTools: Map<string, BaseTool>,
    maxTools: number = 8
  ): ToolRelevanceScore[] {
    const priorities = [
      { toolName: 'eslint', score: 1.0, reason: 'Primary linting tool' },
      { toolName: 'typescript_check', score: 0.9, reason: 'Type checking' },
      { toolName: 'prettier', score: 0.8, reason: 'Code formatting' },
      { toolName: 'analyze_complexity', score: 0.7, reason: 'Code complexity analysis' },
      { toolName: 'security_scan', score: 0.6, reason: 'Security vulnerability scan' },
      { toolName: 'file_read', score: 0.5, reason: 'Reading source files' },
      { toolName: 'file_write', score: 0.4, reason: 'Writing fixed files' },
      { toolName: 'file_list', score: 0.3, reason: 'Finding files to analyze' },
    ];

    return priorities
      .filter(p => availableTools.has(p.toolName))
      .slice(0, maxTools);
  }
}

/**
 * Strategy based on historical usage frequency
 */
class FrequencyBasedStrategy implements ToolSelectionStrategy {
  name = "frequency-based";

  constructor(private usageHistory: Map<string, number>) {}

  selectTools(
    task: string,
    availableTools: Map<string, BaseTool>,
    maxTools: number = 8
  ): ToolRelevanceScore[] {
    const scores: ToolRelevanceScore[] = [];

    for (const [toolName] of availableTools.entries()) {
      const usage = this.usageHistory.get(toolName) || 0;
      const score = Math.min(usage / 10, 1.0); // Normalize to 0-1 range

      scores.push({
        toolName,
        score,
        reason: `Used ${usage} times`
      });
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, maxTools);
  }
}