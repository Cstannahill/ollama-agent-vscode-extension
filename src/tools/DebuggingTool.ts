import { z } from "zod";
import { BaseTool } from "../core/BaseTool";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import * as path from "path";

/**
 * Tool for managing VS Code breakpoints
 */
export class BreakpointManagerTool extends BaseTool {
  name = "breakpoint_manager";
  description = "Manage VS Code debugging breakpoints - add, remove, list, and analyze breakpoint coverage";

  schema = z.object({
    action: z.enum(["add", "remove", "list", "clear_all", "analyze_coverage"]).describe("Action to perform"),
    filePath: z.string().optional().describe("File path for breakpoint operations"),
    lineNumber: z.number().optional().describe("Line number for breakpoint (1-based)"),
    condition: z.string().optional().describe("Conditional expression for conditional breakpoints"),
    logMessage: z.string().optional().describe("Log message for logpoint breakpoints"),
    enabled: z.boolean().optional().describe("Whether breakpoint should be enabled"),
  });

  async execute(args: z.infer<typeof this.schema>) {
    try {
      const { action, filePath, lineNumber, condition, logMessage, enabled = true } = args;

      switch (action) {
        case "add":
          return await this.addBreakpoint(filePath!, lineNumber!, condition, logMessage, enabled);
        
        case "remove":
          return await this.removeBreakpoint(filePath!, lineNumber!);
        
        case "list":
          return await this.listBreakpoints(filePath);
        
        case "clear_all":
          return await this.clearAllBreakpoints();
        
        case "analyze_coverage":
          return await this.analyzeBreakpointCoverage();
        
        default:
          return `Unknown breakpoint action: ${action}`;
      }
    } catch (error) {
      return `Breakpoint management failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async addBreakpoint(
    filePath: string, 
    lineNumber: number, 
    condition?: string, 
    logMessage?: string, 
    enabled: boolean = true
  ): Promise<string> {
    // Note: VS Code API doesn't currently provide direct programmatic breakpoint creation
    // This would typically require using the Debug Adapter Protocol or command palette
    return `⚠️ Programmatic breakpoint creation not fully supported by VS Code API.\n` +
           `💡 To add breakpoint at ${filePath}:${lineNumber}:\n` +
           `   1. Open the file in VS Code\n` +
           `   2. Click in the gutter at line ${lineNumber}\n` +
           `   3. Or use F9 keyboard shortcut\n` +
           `${condition ? `   4. Right-click → Edit Breakpoint → Add condition: "${condition}"\n` : ''}` +
           `${logMessage ? `   4. Right-click → Edit Breakpoint → Add logpoint: "${logMessage}"\n` : ''}`;
  }

  private async removeBreakpoint(filePath: string, lineNumber: number): Promise<string> {
    try {
      const breakpoints = vscode.debug.breakpoints;
      
      if (breakpoints.length === 0) {
        return `❌ No breakpoints currently set to remove`;
      }

      // For now, we can list breakpoints but direct removal by line requires different approach
      return `💡 To remove breakpoint at ${filePath}:${lineNumber}:\n` +
             `   1. Open the file in VS Code\n` +
             `   2. Click on the breakpoint in the gutter at line ${lineNumber}\n` +
             `   3. Or use F9 to toggle breakpoint off\n` +
             `   4. Or use "Debug: Remove All Breakpoints" command\n\n` +
             `📍 Current breakpoints: ${breakpoints.length} total`;
    } catch (error) {
      return `Failed to remove breakpoint: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async listBreakpoints(filePath?: string): Promise<string> {
    try {
      const breakpoints = vscode.debug.breakpoints;
      
      if (breakpoints.length === 0) {
        return "📍 No breakpoints currently set";
      }

      let result = `📍 Current Breakpoints (${breakpoints.length}):\n\n`;
      
      breakpoints.forEach((bp, index) => {
        const status = bp.enabled ? "🟢" : "🔴";
        
        // Handle different breakpoint types
        if ((bp as any).location) {
          // Source breakpoint with location
          const sourceBreakpoint = bp as any;
          try {
            const relativePath = path.relative(this.getWorkspaceRoot(), sourceBreakpoint.location.uri.fsPath);
            const line = sourceBreakpoint.location.range?.start?.line ? sourceBreakpoint.location.range.start.line + 1 : 'unknown';
            
            // Filter by file if specified
            if (filePath && !relativePath.includes(filePath)) {
              return;
            }
            
            result += `${status} ${relativePath}:${line}`;
            
            if (sourceBreakpoint.condition) {
              result += ` [CONDITION: ${sourceBreakpoint.condition}]`;
            }
            
            if (sourceBreakpoint.logMessage) {
              result += ` [LOGPOINT: ${sourceBreakpoint.logMessage}]`;
            }
            
            result += `\n`;
          } catch (locError) {
            result += `${status} Breakpoint ${index + 1} (location parsing error)\n`;
          }
        } else if ((bp as any).functionName) {
          // Function breakpoint
          const funcBreakpoint = bp as any;
          result += `${status} Function: ${funcBreakpoint.functionName}`;
          if (funcBreakpoint.condition) {
            result += ` [CONDITION: ${funcBreakpoint.condition}]`;
          }
          result += `\n`;
        } else {
          // Generic breakpoint
          result += `${status} Breakpoint ${index + 1} (type: ${bp.constructor.name})\n`;
        }
      });
      
      return result;
    } catch (error) {
      return `Failed to list breakpoints: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async clearAllBreakpoints(): Promise<string> {
    try {
      const breakpoints = vscode.debug.breakpoints;
      const count = breakpoints.length;
      
      if (count === 0) {
        return "📍 No breakpoints to clear";
      }
      
      vscode.debug.removeBreakpoints(breakpoints);
      return `✅ Cleared all ${count} breakpoints`;
    } catch (error) {
      return `Failed to clear breakpoints: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async analyzeBreakpointCoverage(): Promise<string> {
    try {
      const breakpoints = vscode.debug.breakpoints;
      
      if (breakpoints.length === 0) {
        return "📊 No breakpoints to analyze";
      }

      const fileBreakpoints = new Map<string, number>();
      const enabledCount = breakpoints.filter(bp => bp.enabled).length;
      const disabledCount = breakpoints.length - enabledCount;
      
      let conditionalCount = 0;
      let logpointCount = 0;
      let functionBreakpoints = 0;
      
      breakpoints.forEach(bp => {
        // Count different types of breakpoints
        if ((bp as any).location) {
          // Source breakpoint with location
          const sourceBreakpoint = bp as any;
          try {
            const relativePath = path.relative(this.getWorkspaceRoot(), sourceBreakpoint.location.uri.fsPath);
            fileBreakpoints.set(relativePath, (fileBreakpoints.get(relativePath) || 0) + 1);
            
            if (sourceBreakpoint.logMessage) {
              logpointCount++;
            } else if (sourceBreakpoint.condition) {
              conditionalCount++;
            }
          } catch (error) {
            // Skip if can't parse location
          }
        } else if ((bp as any).functionName) {
          functionBreakpoints++;
          if ((bp as any).condition) {
            conditionalCount++;
          }
        }
      });

      let result = `📊 Breakpoint Coverage Analysis:\n\n`;
      result += `📈 Summary:\n`;
      result += `  • Total breakpoints: ${breakpoints.length}\n`;
      result += `  • Enabled: ${enabledCount} (${Math.round(enabledCount/breakpoints.length*100)}%)\n`;
      result += `  • Disabled: ${disabledCount} (${Math.round(disabledCount/breakpoints.length*100)}%)\n`;
      result += `  • Conditional: ${conditionalCount}\n`;
      result += `  • Logpoints: ${logpointCount}\n`;
      result += `  • Function breakpoints: ${functionBreakpoints}\n`;
      result += `  • Files covered: ${fileBreakpoints.size}\n\n`;
      
      if (fileBreakpoints.size > 0) {
        result += `📁 Breakpoints by File:\n`;
        Array.from(fileBreakpoints.entries())
          .sort((a, b) => b[1] - a[1])
          .forEach(([file, count]) => {
            result += `  • ${file}: ${count} breakpoint${count > 1 ? 's' : ''}\n`;
          });
      }
      
      return result;
    } catch (error) {
      return `Failed to analyze breakpoint coverage: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

/**
 * Tool for analyzing stack traces and debugging information
 */
export class StackTraceAnalyzerTool extends BaseTool {
  name = "stack_trace_analyzer";
  description = "Analyze stack traces, debug call stacks, and provide debugging insights";

  schema = z.object({
    action: z.enum(["analyze_trace", "get_call_stack", "analyze_variables", "suggest_fixes"]).describe("Analysis action"),
    stackTrace: z.string().optional().describe("Stack trace text to analyze"),
    errorMessage: z.string().optional().describe("Error message to analyze"),
    context: z.string().optional().describe("Additional context or code snippets"),
  });

  async execute(args: z.infer<typeof this.schema>) {
    try {
      const { action, stackTrace, errorMessage, context } = args;

      switch (action) {
        case "analyze_trace":
          return await this.analyzeStackTrace(stackTrace || "", errorMessage);
        
        case "get_call_stack":
          return await this.getCurrentCallStack();
        
        case "analyze_variables":
          return await this.analyzeVariables(context);
        
        case "suggest_fixes":
          return await this.suggestFixes(stackTrace || "", errorMessage || "", context);
        
        default:
          return `Unknown stack trace analysis action: ${action}`;
      }
    } catch (error) {
      return `Stack trace analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async analyzeStackTrace(stackTrace: string, errorMessage?: string): Promise<string> {
    if (!stackTrace.trim()) {
      return "❌ No stack trace provided to analyze";
    }

    try {
      let result = `🔍 Stack Trace Analysis:\n\n`;
      
      if (errorMessage) {
        result += `❌ Error: ${errorMessage}\n\n`;
      }

      // Parse stack trace lines
      const lines = stackTrace.split('\n').filter(line => line.trim());
      const stackFrames: Array<{
        function: string;
        file: string;
        line?: number;
        column?: number;
      }> = [];

      // Common stack trace patterns
      const patterns = [
        // Node.js/JavaScript: "at functionName (file:line:column)"
        /at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/,
        // Node.js/JavaScript: "at file:line:column"
        /at\s+(.+?):(\d+):(\d+)/,
        // TypeScript: "at Object.functionName (file:line:column)"
        /at\s+Object\.(.+?)\s+\((.+?):(\d+):(\d+)\)/,
      ];

      lines.forEach(line => {
        for (const pattern of patterns) {
          const match = line.match(pattern);
          if (match) {
            if (match.length >= 4) {
              stackFrames.push({
                function: match[1],
                file: match[2],
                line: parseInt(match[3]),
                column: parseInt(match[4])
              });
            } else if (match.length >= 3) {
              stackFrames.push({
                function: 'anonymous',
                file: match[1],
                line: parseInt(match[2]),
                column: parseInt(match[3])
              });
            }
            break;
          }
        }
      });

      if (stackFrames.length > 0) {
        result += `📚 Call Stack (${stackFrames.length} frames):\n`;
        stackFrames.forEach((frame, index) => {
          const relativePath = frame.file.includes(this.getWorkspaceRoot()) 
            ? path.relative(this.getWorkspaceRoot(), frame.file)
            : path.basename(frame.file);
          
          result += `  ${index + 1}. ${frame.function} at ${relativePath}`;
          if (frame.line) {
            result += `:${frame.line}`;
            if (frame.column) {
              result += `:${frame.column}`;
            }
          }
          result += `\n`;
        });

        // Identify root cause
        const topFrame = stackFrames[0];
        const userCodeFrames = stackFrames.filter(frame => 
          frame.file.includes(this.getWorkspaceRoot()) && 
          !frame.file.includes('node_modules')
        );

        result += `\n🎯 Analysis:\n`;
        result += `  • Error occurred in: ${topFrame.function}\n`;
        result += `  • User code frames: ${userCodeFrames.length}\n`;
        result += `  • External library frames: ${stackFrames.length - userCodeFrames.length}\n`;

        if (userCodeFrames.length > 0) {
          const primaryFrame = userCodeFrames[0];
          result += `  • Primary issue location: ${path.relative(this.getWorkspaceRoot(), primaryFrame.file)}:${primaryFrame.line}\n`;
        }
      } else {
        result += `⚠️ Could not parse stack trace format. Raw trace:\n${stackTrace}\n`;
      }

      return result;
    } catch (error) {
      return `Failed to analyze stack trace: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async getCurrentCallStack(): Promise<string> {
    try {
      const session = vscode.debug.activeDebugSession;
      
      if (!session) {
        return "❌ No active debug session. Start debugging to get call stack information.";
      }

      // Note: VS Code API doesn't directly expose call stack retrieval
      // This would require debug adapter protocol communication
      return `🔄 Active debug session: ${session.name} (${session.type})\n` +
             `📍 Use VS Code's Call Stack view for detailed stack information during debugging.`;
    } catch (error) {
      return `Failed to get call stack: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async analyzeVariables(context?: string): Promise<string> {
    try {
      if (!context) {
        return "❌ No code context provided for variable analysis";
      }

      let result = `🔬 Variable Analysis:\n\n`;

      // Simple variable detection (could be enhanced with AST parsing)
      const variablePatterns = [
        /let\s+(\w+)/g,
        /const\s+(\w+)/g,
        /var\s+(\w+)/g,
        /function\s+(\w+)/g,
        /class\s+(\w+)/g,
      ];

      const variables = new Set<string>();
      variablePatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(context)) !== null) {
          variables.add(match[1]);
        }
      });

      if (variables.size > 0) {
        result += `📝 Variables found: ${Array.from(variables).join(', ')}\n\n`;
        
        result += `💡 Debugging suggestions:\n`;
        result += `  • Add console.log statements for key variables\n`;
        result += `  • Set breakpoints at variable assignments\n`;
        result += `  • Use VS Code's variable inspection during debugging\n`;
        result += `  • Consider adding type annotations for better error detection\n`;
      } else {
        result += `❌ No variables detected in provided context\n`;
      }

      return result;
    } catch (error) {
      return `Failed to analyze variables: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async suggestFixes(stackTrace: string, errorMessage: string, context?: string): Promise<string> {
    let result = `🛠️ Debugging Suggestions:\n\n`;

    // Common error patterns and fixes
    const errorPatterns = [
      {
        pattern: /cannot read propert/i,
        suggestion: "• Check for null/undefined values\n• Add optional chaining (?.)\n• Validate object properties before access"
      },
      {
        pattern: /is not a function/i,
        suggestion: "• Verify the variable is actually a function\n• Check import/export statements\n• Ensure proper function binding"
      },
      {
        pattern: /module not found/i,
        suggestion: "• Check file paths and import statements\n• Verify package is installed\n• Check package.json dependencies"
      },
      {
        pattern: /syntax error/i,
        suggestion: "• Check for missing brackets, parentheses, or semicolons\n• Verify proper quote matching\n• Use a linter like ESLint"
      },
      {
        pattern: /type.*error/i,
        suggestion: "• Add type annotations\n• Check TypeScript configuration\n• Verify variable types match expected usage"
      }
    ];

    let suggestionsFound = false;
    errorPatterns.forEach(({ pattern, suggestion }) => {
      if (pattern.test(errorMessage)) {
        result += `${suggestion}\n\n`;
        suggestionsFound = true;
      }
    });

    if (!suggestionsFound) {
      result += `🔍 General debugging steps:\n`;
      result += `• Add breakpoints at error location\n`;
      result += `• Use console.log to trace variable values\n`;
      result += `• Check for typos in variable/function names\n`;
      result += `• Verify all dependencies are properly imported\n`;
      result += `• Review recent code changes\n\n`;
    }

    // Stack trace specific suggestions
    if (stackTrace.includes('node_modules')) {
      result += `📦 External library involved:\n`;
      result += `• Check library documentation\n`;
      result += `• Verify library version compatibility\n`;
      result += `• Look for known issues or updates\n\n`;
    }

    result += `🎯 Next steps:\n`;
    result += `• Set breakpoints using breakpoint_manager tool\n`;
    result += `• Use VS Code debugger to step through code\n`;
    result += `• Run tests to isolate the issue\n`;
    result += `• Check error logs for additional context\n`;

    return result;
  }
}

/**
 * Tool for debug session management
 */
export class DebugSessionTool extends BaseTool {
  name = "debug_session";
  description = "Manage VS Code debug sessions - start, stop, and monitor debugging";

  schema = z.object({
    action: z.enum(["start", "stop", "restart", "status", "list_configs"]).describe("Debug session action"),
    configuration: z.string().optional().describe("Launch configuration name"),
    program: z.string().optional().describe("Program to debug"),
    args: z.array(z.string()).optional().describe("Program arguments"),
  });

  async execute(args: z.infer<typeof this.schema>) {
    try {
      const { action, configuration, program, args: programArgs } = args;

      switch (action) {
        case "start":
          return await this.startDebugSession(configuration, program, programArgs);
        
        case "stop":
          return await this.stopDebugSession();
        
        case "restart":
          return await this.restartDebugSession();
        
        case "status":
          return await this.getDebugStatus();
        
        case "list_configs":
          return await this.listDebugConfigurations();
        
        default:
          return `Unknown debug session action: ${action}`;
      }
    } catch (error) {
      return `Debug session management failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async startDebugSession(configuration?: string, program?: string, programArgs?: string[]): Promise<string> {
    try {
      let debugConfig: vscode.DebugConfiguration;

      if (configuration) {
        // Use existing launch configuration
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          return "❌ No workspace folder available";
        }

        debugConfig = {
          name: configuration,
          type: 'node',
          request: 'launch',
          program: program || '${workspaceFolder}/dist/extension.js',
          args: programArgs || []
        };
      } else if (program) {
        // Create ad-hoc debug configuration
        debugConfig = {
          name: 'Debug Program',
          type: 'node',
          request: 'launch',
          program: program,
          args: programArgs || [],
          console: 'integratedTerminal',
          internalConsoleOptions: 'neverOpen'
        };
      } else {
        return "❌ Either configuration name or program path must be provided";
      }

      const success = await vscode.debug.startDebugging(
        vscode.workspace.workspaceFolders?.[0],
        debugConfig
      );

      if (success) {
        return `✅ Started debug session: ${debugConfig.name}`;
      } else {
        return `❌ Failed to start debug session`;
      }
    } catch (error) {
      return `Failed to start debug session: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async stopDebugSession(): Promise<string> {
    try {
      const activeSession = vscode.debug.activeDebugSession;
      
      if (!activeSession) {
        return "❌ No active debug session to stop";
      }

      await vscode.debug.stopDebugging(activeSession);
      return `✅ Stopped debug session: ${activeSession.name}`;
    } catch (error) {
      return `Failed to stop debug session: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async restartDebugSession(): Promise<string> {
    try {
      const activeSession = vscode.debug.activeDebugSession;
      
      if (!activeSession) {
        return "❌ No active debug session to restart";
      }

      await vscode.debug.stopDebugging(activeSession);
      
      // Wait a moment for the session to fully stop
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const success = await vscode.debug.startDebugging(
        activeSession.workspaceFolder,
        activeSession.configuration
      );

      if (success) {
        return `✅ Restarted debug session: ${activeSession.name}`;
      } else {
        return `❌ Failed to restart debug session`;
      }
    } catch (error) {
      return `Failed to restart debug session: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async getDebugStatus(): Promise<string> {
    try {
      const activeSession = vscode.debug.activeDebugSession;
      
      if (!activeSession) {
        return "📍 No active debug session";
      }

      let result = `🐛 Debug Session Status:\n\n`;
      result += `📝 Session: ${activeSession.name}\n`;
      result += `🔧 Type: ${activeSession.type}\n`;
      result += `📁 Workspace: ${activeSession.workspaceFolder?.name || 'None'}\n`;
      
      // Get breakpoint information
      const breakpoints = vscode.debug.breakpoints;
      result += `📍 Breakpoints: ${breakpoints.length} set\n`;
      
      const enabledBreakpoints = breakpoints.filter(bp => bp.enabled).length;
      result += `✅ Enabled: ${enabledBreakpoints}\n`;
      result += `❌ Disabled: ${breakpoints.length - enabledBreakpoints}\n`;

      return result;
    } catch (error) {
      return `Failed to get debug status: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async listDebugConfigurations(): Promise<string> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return "❌ No workspace folder available";
      }

      // Try to read launch.json
      const launchJsonPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'launch.json');
      
      try {
        const document = await vscode.workspace.openTextDocument(launchJsonPath);
        const content = document.getText();
        
        // Parse launch.json
        const launchConfig = JSON.parse(content);
        
        if (!launchConfig.configurations || launchConfig.configurations.length === 0) {
          return "📝 No debug configurations found in launch.json";
        }

        let result = `📝 Debug Configurations (${launchConfig.configurations.length}):\n\n`;
        
        launchConfig.configurations.forEach((config: any, index: number) => {
          result += `${index + 1}. ${config.name}\n`;
          result += `   Type: ${config.type}\n`;
          result += `   Request: ${config.request}\n`;
          if (config.program) {
            result += `   Program: ${config.program}\n`;
          }
          if (config.args && config.args.length > 0) {
            result += `   Args: ${config.args.join(' ')}\n`;
          }
          result += `\n`;
        });

        return result;
      } catch (fileError) {
        return "📝 No launch.json found. Use VS Code's Run and Debug view to create debug configurations.";
      }
    } catch (error) {
      return `Failed to list debug configurations: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}