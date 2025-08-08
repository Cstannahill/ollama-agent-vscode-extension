import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";

const execAsync = promisify(exec);

// Node.js Performance Profiler Tool
export class NodeProfilerTool extends BaseTool {
  name = "node_profiler";
  description = "Profile Node.js applications for performance analysis";
  
  schema = z.object({
    action: z.enum(["profile", "analyze", "benchmark", "memory", "cpu"]).describe("Type of profiling to perform"),
    script: z.string().describe("Path to the script to profile"),
    duration: z.number().optional().describe("Profiling duration in seconds (default: 30)"),
    outputDir: z.string().optional().describe("Output directory for profile data (default: .profiles)"),
    samplingInterval: z.number().optional().describe("Sampling interval in microseconds (default: 1000)"),
    format: z.enum(["json", "html", "flamegraph"]).optional().describe("Output format (default: json)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { action, script, duration = 30, outputDir = ".profiles", samplingInterval = 1000, format = "json" } = params;
      
      logger.info(`[NODE_PROFILER] Starting ${action} profiling for ${script}`);

      const workspacePath = this.getWorkspaceRoot();
      const scriptPath = path.resolve(workspacePath, script);
      const profileDir = path.resolve(workspacePath, outputDir);
      
      // Ensure output directory exists
      await fs.mkdir(profileDir, { recursive: true });

      // Check if script exists
      try {
        await fs.access(scriptPath);
      } catch (error) {
        throw new Error(`Script not found: ${scriptPath}`);
      }

      switch (action) {
        case "profile":
          return await this.profileApplication(scriptPath, profileDir, duration, samplingInterval, format);
        case "analyze":
          return await this.analyzeProfile(profileDir);
        case "benchmark":
          return await this.benchmarkApplication(scriptPath, duration);
        case "memory":
          return await this.profileMemory(scriptPath, profileDir, duration);
        case "cpu":
          return await this.profileCPU(scriptPath, profileDir, duration, samplingInterval);
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[NODE_PROFILER] Failed:", error);
      throw new Error(`Node.js profiling failed: ${errorMessage}`);
    }
  }

  private async profileApplication(
    scriptPath: string, 
    profileDir: string, 
    duration: number, 
    samplingInterval: number, 
    format: string
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const profileFile = path.join(profileDir, `profile-${timestamp}.cpuprofile`);
    
    try {
      // Use Node.js built-in profiler
      const command = `node --cpu-prof --cpu-prof-dir="${profileDir}" --cpu-prof-name="profile-${timestamp}.cpuprofile" "${scriptPath}"`;
      
      const { stdout, stderr } = await execAsync(command, {
        timeout: (duration + 10) * 1000, // Add 10 seconds buffer
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      // Generate report
      const report = await this.generateProfileReport(profileFile, format);
      
      return `Profiling completed for ${path.basename(scriptPath)}:\n\n` +
        `Profile saved to: ${profileFile}\n` +
        `Duration: ${duration} seconds\n` +
        `Output:\n${stdout}\n` +
        (stderr ? `Errors:\n${stderr}\n` : "") +
        `\n${report}`;
    } catch (error) {
      throw new Error(`Failed to profile application: ${error}`);
    }
  }

  private async analyzeProfile(profileDir: string): Promise<string> {
    try {
      const files = await fs.readdir(profileDir);
      const profileFiles = files.filter(f => f.endsWith('.cpuprofile'));
      
      if (profileFiles.length === 0) {
        return `No profile files found in ${profileDir}`;
      }

      let analysis = `Profile Analysis Summary:\n\n`;
      analysis += `Found ${profileFiles.length} profile file(s):\n`;
      
      for (const file of profileFiles.slice(0, 5)) { // Analyze up to 5 most recent files
        const filePath = path.join(profileDir, file);
        const stats = await fs.stat(filePath);
        analysis += `• ${file} (${Math.round(stats.size / 1024)}KB, ${stats.mtime.toISOString()})\n`;
        
        try {
          const profileData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
          const summary = this.analyzeProfileData(profileData);
          analysis += `  ${summary}\n`;
        } catch (error) {
          analysis += `  Error analyzing profile: ${error}\n`;
        }
      }

      return analysis;
    } catch (error) {
      throw new Error(`Failed to analyze profiles: ${error}`);
    }
  }

  private async benchmarkApplication(scriptPath: string, duration: number): Promise<string> {
    try {
      const startTime = Date.now();
      const startUsage = process.cpuUsage();
      const startMemory = process.memoryUsage();

      // Run the script
      const { stdout, stderr } = await execAsync(`node "${scriptPath}"`, {
        timeout: duration * 1000,
        maxBuffer: 1024 * 1024 * 10,
      });

      const endTime = Date.now();
      const endUsage = process.cpuUsage(startUsage);
      const endMemory = process.memoryUsage();

      const executionTime = endTime - startTime;
      const cpuUsage = (endUsage.user + endUsage.system) / 1000; // Convert to milliseconds
      const memoryDelta = {
        rss: endMemory.rss - startMemory.rss,
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        heapTotal: endMemory.heapTotal - startMemory.heapTotal,
        external: endMemory.external - startMemory.external,
      };

      return `Benchmark Results for ${path.basename(scriptPath)}:\n\n` +
        `Execution Time: ${executionTime}ms\n` +
        `CPU Time: ${cpuUsage.toFixed(2)}ms\n` +
        `Memory Usage:\n` +
        `  RSS: ${this.formatBytes(memoryDelta.rss)}\n` +
        `  Heap Used: ${this.formatBytes(memoryDelta.heapUsed)}\n` +
        `  Heap Total: ${this.formatBytes(memoryDelta.heapTotal)}\n` +
        `  External: ${this.formatBytes(memoryDelta.external)}\n\n` +
        `Output:\n${stdout}\n` +
        (stderr ? `Errors:\n${stderr}` : "");
    } catch (error) {
      throw new Error(`Failed to benchmark application: ${error}`);
    }
  }

  private async profileMemory(scriptPath: string, profileDir: string, duration: number): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const heapSnapshotFile = path.join(profileDir, `heap-${timestamp}.heapsnapshot`);
    
    try {
      // Use Node.js heap profiler
      const command = `node --heap-prof --heap-prof-dir="${profileDir}" --heap-prof-name="heap-${timestamp}.heapprofile" "${scriptPath}"`;
      
      const { stdout, stderr } = await execAsync(command, {
        timeout: (duration + 10) * 1000,
        maxBuffer: 1024 * 1024 * 10,
      });

      return `Memory profiling completed for ${path.basename(scriptPath)}:\n\n` +
        `Heap profile saved to: ${profileDir}\n` +
        `Duration: ${duration} seconds\n` +
        `Output:\n${stdout}\n` +
        (stderr ? `Errors:\n${stderr}` : "");
    } catch (error) {
      throw new Error(`Failed to profile memory: ${error}`);
    }
  }

  private async profileCPU(scriptPath: string, profileDir: string, duration: number, samplingInterval: number): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    try {
      const command = `node --cpu-prof --cpu-prof-interval=${samplingInterval} --cpu-prof-dir="${profileDir}" "${scriptPath}"`;
      
      const { stdout, stderr } = await execAsync(command, {
        timeout: (duration + 10) * 1000,
        maxBuffer: 1024 * 1024 * 10,
      });

      return `CPU profiling completed for ${path.basename(scriptPath)}:\n\n` +
        `Profile saved to: ${profileDir}\n` +
        `Sampling interval: ${samplingInterval}μs\n` +
        `Duration: ${duration} seconds\n` +
        `Output:\n${stdout}\n` +
        (stderr ? `Errors:\n${stderr}` : "");
    } catch (error) {
      throw new Error(`Failed to profile CPU: ${error}`);
    }
  }

  private analyzeProfileData(profileData: any): string {
    try {
      const totalSamples = profileData.samples?.length || 0;
      const totalTime = profileData.endTime - profileData.startTime;
      const nodes = profileData.nodes || [];
      
      return `${totalSamples} samples, ${totalTime}μs total, ${nodes.length} nodes`;
    } catch (error) {
      return "Unable to analyze profile data";
    }
  }

  private async generateProfileReport(profileFile: string, format: string): Promise<string> {
    try {
      // Basic profile analysis
      const profileData = JSON.parse(await fs.readFile(profileFile, 'utf-8'));
      
      return `Profile Report:\n` +
        `• Start Time: ${new Date(profileData.startTime / 1000).toISOString()}\n` +
        `• End Time: ${new Date(profileData.endTime / 1000).toISOString()}\n` +
        `• Duration: ${((profileData.endTime - profileData.startTime) / 1000).toFixed(2)}ms\n` +
        `• Samples: ${profileData.samples?.length || 0}\n` +
        `• Nodes: ${profileData.nodes?.length || 0}`;
    } catch (error) {
      return "Unable to generate profile report";
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    const sign = bytes < 0 ? '-' : '';
    return sign + parseFloat((Math.abs(bytes) / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Bundle Analyzer Tool
export class BundleAnalyzerTool extends BaseTool {
  name = "bundle_analyzer";
  description = "Analyze JavaScript/TypeScript bundle size and dependencies";
  
  schema = z.object({
    action: z.enum(["analyze", "compare", "dependencies", "duplicates", "treemap"]).describe("Type of analysis"),
    bundlePath: z.string().describe("Path to the bundle file or build directory"),
    format: z.enum(["webpack", "rollup", "vite", "auto"]).optional().describe("Bundle format (default: auto)"),
    outputFormat: z.enum(["json", "html", "text"]).optional().describe("Output format (default: text)"),
    threshold: z.number().optional().describe("Size threshold in KB for reporting (default: 10)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { action, bundlePath, format = "auto", outputFormat = "text", threshold = 10 } = params;
      
      logger.info(`[BUNDLE_ANALYZER] Analyzing bundle: ${bundlePath}`);

      const workspacePath = this.getWorkspaceRoot();
      const fullBundlePath = path.resolve(workspacePath, bundlePath);
      
      // Check if bundle exists
      try {
        await fs.access(fullBundlePath);
      } catch (error) {
        throw new Error(`Bundle not found: ${fullBundlePath}`);
      }

      switch (action) {
        case "analyze":
          return await this.analyzeBundle(fullBundlePath, threshold);
        case "compare":
          return await this.compareBundles(fullBundlePath);
        case "dependencies":
          return await this.analyzeDependencies(fullBundlePath);
        case "duplicates":
          return await this.findDuplicates(fullBundlePath);
        case "treemap":
          return await this.generateTreemap(fullBundlePath);
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[BUNDLE_ANALYZER] Failed:", error);
      throw new Error(`Bundle analysis failed: ${errorMessage}`);
    }
  }

  private async analyzeBundle(bundlePath: string, threshold: number): Promise<string> {
    try {
      const stats = await fs.stat(bundlePath);
      const content = await fs.readFile(bundlePath, 'utf-8');
      
      // Basic size analysis
      const rawSize = stats.size;
      const gzipSize = await this.estimateGzipSize(content);
      const lines = content.split('\n').length;
      
      // Analyze imports/requires
      const imports = this.extractImports(content);
      const largeFiles = await this.findLargeFiles(path.dirname(bundlePath), threshold);
      
      return `Bundle Analysis: ${path.basename(bundlePath)}\n\n` +
        `📊 Size Information:\n` +
        `• Raw size: ${this.formatBytes(rawSize)}\n` +
        `• Estimated gzip: ${this.formatBytes(gzipSize)}\n` +
        `• Lines of code: ${lines.toLocaleString()}\n\n` +
        `📦 Dependencies:\n` +
        `• Total imports: ${imports.length}\n` +
        `• Unique modules: ${new Set(imports).size}\n\n` +
        `🔍 Large Files (>${threshold}KB):\n` +
        (largeFiles.length > 0 ? largeFiles.map(f => `• ${f.name}: ${this.formatBytes(f.size)}`).join('\n') : '• None found') +
        `\n\n📈 Recommendations:\n` +
        this.generateRecommendations(rawSize, gzipSize, imports);
    } catch (error) {
      throw new Error(`Failed to analyze bundle: ${error}`);
    }
  }

  private async compareBundles(bundlePath: string): Promise<string> {
    // This would compare with previous builds if available
    return `Bundle comparison feature - would compare with previous builds`;
  }

  private async analyzeDependencies(bundlePath: string): Promise<string> {
    try {
      const content = await fs.readFile(bundlePath, 'utf-8');
      const imports = this.extractImports(content);
      
      // Group by module
      const moduleCount: Record<string, number> = {};
      imports.forEach(imp => {
        moduleCount[imp] = (moduleCount[imp] || 0) + 1;
      });

      const sortedModules = Object.entries(moduleCount)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 20); // Top 20

      return `Dependency Analysis:\n\n` +
        `Total dependencies: ${Object.keys(moduleCount).length}\n` +
        `Total imports: ${imports.length}\n\n` +
        `Top Dependencies:\n` +
        sortedModules.map(([module, count]) => `• ${module}: ${count} imports`).join('\n');
    } catch (error) {
      throw new Error(`Failed to analyze dependencies: ${error}`);
    }
  }

  private async findDuplicates(bundlePath: string): Promise<string> {
    try {
      const content = await fs.readFile(bundlePath, 'utf-8');
      
      // Look for potential duplicates (simplified)
      const chunks = content.split('\n').filter(line => line.trim().length > 50);
      const duplicates: Record<string, number> = {};
      
      chunks.forEach(chunk => {
        const hash = this.simpleHash(chunk.trim());
        duplicates[hash] = (duplicates[hash] || 0) + 1;
      });

      const actualDuplicates = Object.entries(duplicates)
        .filter(([, count]) => count > 1)
        .sort(([,a], [,b]) => b - a);

      return `Duplicate Code Analysis:\n\n` +
        `Total chunks analyzed: ${chunks.length}\n` +
        `Potential duplicates found: ${actualDuplicates.length}\n\n` +
        (actualDuplicates.length > 0 ? 
          `Top duplicates:\n` + 
          actualDuplicates.slice(0, 10).map(([hash, count]) => `• Hash ${hash.slice(0, 8)}: ${count} occurrences`).join('\n')
          : '• No significant duplicates found');
    } catch (error) {
      throw new Error(`Failed to find duplicates: ${error}`);
    }
  }

  private async generateTreemap(bundlePath: string): Promise<string> {
    // This would generate a visual treemap representation
    return `Treemap generation feature - would create visual bundle breakdown`;
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];
    
    // Extract ES6 imports
    const es6ImportRegex = /import\s+.*?\s+from\s+['"`]([^'"`]+)['"`]/g;
    let match;
    while ((match = es6ImportRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    
    // Extract CommonJS requires
    const requireRegex = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    
    return imports;
  }

  private async findLargeFiles(directory: string, thresholdKB: number): Promise<Array<{name: string; size: number}>> {
    try {
      const files = await fs.readdir(directory);
      const largeFiles: Array<{name: string; size: number}> = [];
      
      for (const file of files) {
        const filePath = path.join(directory, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isFile() && stats.size > thresholdKB * 1024) {
          largeFiles.push({ name: file, size: stats.size });
        }
      }
      
      return largeFiles.sort((a, b) => b.size - a.size);
    } catch (error) {
      return [];
    }
  }

  private async estimateGzipSize(content: string): Promise<number> {
    // Rough estimation - actual gzip would be more accurate
    return Math.round(content.length * 0.3); // Assume ~70% compression
  }

  private generateRecommendations(rawSize: number, gzipSize: number, imports: string[]): string {
    const recommendations: string[] = [];
    
    if (rawSize > 1024 * 1024) { // > 1MB
      recommendations.push("• Consider code splitting to reduce bundle size");
    }
    
    if (imports.length > 100) {
      recommendations.push("• High number of imports - consider dependency consolidation");
    }
    
    if (gzipSize / rawSize > 0.8) {
      recommendations.push("• Poor compression ratio - check for repeated code");
    }
    
    const uniqueImports = new Set(imports).size;
    if (imports.length > uniqueImports * 2) {
      recommendations.push("• Many duplicate imports - consider import optimization");
    }
    
    return recommendations.length > 0 ? recommendations.join('\n') : '• Bundle looks optimized!';
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Lighthouse Performance Tool
export class LighthousePerformanceTool extends BaseTool {
  name = "lighthouse_audit";
  description = "Run Lighthouse performance audits on web applications";
  
  schema = z.object({
    url: z.string().describe("URL to audit"),
    categories: z.array(z.enum(["performance", "accessibility", "best-practices", "seo", "pwa"])).optional().describe("Categories to audit (default: all)"),
    device: z.enum(["mobile", "desktop"]).optional().describe("Device type (default: mobile)"),
    outputFormat: z.enum(["json", "html", "csv"]).optional().describe("Output format (default: json)"),
    outputDir: z.string().optional().describe("Output directory (default: .lighthouse)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { url, categories = ["performance", "accessibility", "best-practices", "seo"], device = "mobile", outputFormat = "json", outputDir = ".lighthouse" } = params;
      
      logger.info(`[LIGHTHOUSE] Auditing ${url}`);

      // Check if Lighthouse is available
      try {
        await execAsync("lighthouse --version");
      } catch (error) {
        throw new Error("Lighthouse CLI is not installed. Install with: npm install -g @lighthouse-ci/cli");
      }

      const workspacePath = this.getWorkspaceRoot();
      const auditDir = path.resolve(workspacePath, outputDir);
      
      // Ensure output directory exists
      await fs.mkdir(auditDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputFile = path.join(auditDir, `lighthouse-${timestamp}.${outputFormat}`);
      
      // Build Lighthouse command
      let command = `lighthouse "${url}"`;
      command += ` --only-categories=${categories.join(',')}`;
      command += ` --form-factor=${device}`;
      command += ` --output=${outputFormat}`;
      command += ` --output-path="${outputFile}"`;
      command += ` --quiet`;

      const { stdout, stderr } = await execAsync(command, {
        timeout: 120000, // 2 minutes timeout
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      // Parse results if JSON format
      let results = "";
      if (outputFormat === "json") {
        try {
          const auditData = JSON.parse(await fs.readFile(outputFile, 'utf-8'));
          results = this.formatLighthouseResults(auditData);
        } catch (error) {
          results = "Could not parse Lighthouse results";
        }
      }

      return `Lighthouse Audit Complete:\n\n` +
        `URL: ${url}\n` +
        `Device: ${device}\n` +
        `Categories: ${categories.join(', ')}\n` +
        `Report saved to: ${outputFile}\n\n` +
        (results || `Check the ${outputFormat} report for detailed results`) +
        `\n\nOutput:\n${stdout}` +
        (stderr ? `\nWarnings:\n${stderr}` : "");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[LIGHTHOUSE] Failed:", error);
      throw new Error(`Lighthouse audit failed: ${errorMessage}`);
    }
  }

  private formatLighthouseResults(auditData: any): string {
    try {
      const categories = auditData.categories;
      let results = "Lighthouse Scores:\n";
      
      Object.entries(categories).forEach(([key, category]: [string, any]) => {
        const score = Math.round(category.score * 100);
        const emoji = score >= 90 ? "🟢" : score >= 50 ? "🟡" : "🔴";
        results += `${emoji} ${category.title}: ${score}/100\n`;
      });

      // Add performance metrics if available
      if (categories.performance) {
        results += "\nKey Metrics:\n";
        const audits = auditData.audits;
        
        const metrics = [
          { key: 'first-contentful-paint', name: 'First Contentful Paint' },
          { key: 'largest-contentful-paint', name: 'Largest Contentful Paint' },
          { key: 'cumulative-layout-shift', name: 'Cumulative Layout Shift' },
          { key: 'total-blocking-time', name: 'Total Blocking Time' }
        ];

        metrics.forEach(({ key, name }) => {
          if (audits[key] && audits[key].displayValue) {
            results += `• ${name}: ${audits[key].displayValue}\n`;
          }
        });
      }

      return results;
    } catch (error) {
      return "Could not format Lighthouse results";
    }
  }
}