/**
 * Context Indexer for Project Analysis
 * 
 * Analyzes project files, extracts context, chunks content, and indexes
 * it in ChromaDB for semantic retrieval by foundation agents.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { logger } from '../../utils/logger';
import { ChromaContextDB } from '../storage/ChromaContextDB';
import {
  ContextItem,
  ContextType,
  ContextSource,
  ContextPriority,
  ProjectMetadata,
} from '../types';

interface FileAnalysis {
  filePath: string;
  language: string;
  size: number;
  lines: number;
  imports: string[];
  exports: string[];
  functions: string[];
  classes: string[];
  interfaces: string[];
  types: string[];
  complexity: number;
  documentation: string[];
}

interface IndexingOptions {
  includePatterns: string[];
  excludePatterns: string[];
  maxFileSize: number; // bytes
  chunkSize: number;
  enableCodeAnalysis: boolean;
  enableDocumentationExtraction: boolean;
  respectGitignore: boolean;
}

/**
 * Intelligent context indexer for project analysis and semantic search
 */
export class ContextIndexer {
  private contextDB: ChromaContextDB;
  private workspaceRoot: string;
  private options: IndexingOptions;
  private indexingProgress?: vscode.Progress<{ message?: string; increment?: number }>;

  constructor(
    contextDB: ChromaContextDB,
    workspaceRoot: string,
    options: Partial<IndexingOptions> = {}
  ) {
    this.contextDB = contextDB;
    this.workspaceRoot = workspaceRoot;
    this.options = {
      includePatterns: [
        '**/*.ts',
        '**/*.js',
        '**/*.tsx',
        '**/*.jsx',
        '**/*.py',
        '**/*.java',
        '**/*.c',
        '**/*.cpp',
        '**/*.cs',
        '**/*.go',
        '**/*.rs',
        '**/*.php',
        '**/*.rb',
        '**/*.swift',
        '**/*.kt',
        '**/*.scala',
        '**/*.md',
        '**/*.txt',
        '**/README*',
        '**/CHANGELOG*',
        '**/LICENSE*',
        '**/package.json',
        '**/tsconfig.json',
        '**/Cargo.toml',
        '**/pom.xml',
        '**/build.gradle',
        '**/requirements.txt',
        '**/Gemfile',
        '**/composer.json',
      ],
      excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/target/**',
        '**/.git/**',
        '**/.svn/**',
        '**/.hg/**',
        '**/coverage/**',
        '**/.nyc_output/**',
        '**/logs/**',
        '**/*.log',
        '**/*.tmp',
        '**/*.cache',
        '**/tmp/**',
        '**/temp/**',
      ],
      maxFileSize: 1024 * 1024, // 1MB
      chunkSize: 1000,
      enableCodeAnalysis: true,
      enableDocumentationExtraction: true,
      respectGitignore: true,
      ...options,
    };
  }

  /**
   * Index entire project with progress reporting
   */
  public async indexProject(
    projectId: string,
    progressCallback?: (progress: { message: string; percentage: number }) => void
  ): Promise<{ totalFiles: number; indexedFiles: number; skippedFiles: number; errors: string[] }> {
    const startTime = Date.now();
    logger.info(`[CONTEXT_INDEXER] Starting project indexing: ${projectId}`);

    const results = {
      totalFiles: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      errors: [] as string[],
    };

    try {
      // Initialize ChromaDB if needed
      await this.contextDB.initialize();

      // Discover files to index
      progressCallback?.({ message: 'Discovering project files...', percentage: 5 });
      const filesToIndex = await this.discoverFiles();
      results.totalFiles = filesToIndex.length;

      logger.info(`[CONTEXT_INDEXER] Found ${filesToIndex.length} files to index`);

      if (filesToIndex.length === 0) {
        logger.warn('[CONTEXT_INDEXER] No files found to index');
        return results;
      }

      // Index files in batches
      const batchSize = 10;
      for (let i = 0; i < filesToIndex.length; i += batchSize) {
        const batch = filesToIndex.slice(i, i + batchSize);
        const progress = Math.round((i / filesToIndex.length) * 80) + 10; // 10-90%
        
        progressCallback?.({ 
          message: `Indexing files... (${i + 1}-${Math.min(i + batchSize, filesToIndex.length)} of ${filesToIndex.length})`, 
          percentage: progress 
        });

        const batchPromises = batch.map(async (filePath) => {
          try {
            await this.indexFile(filePath, projectId);
            results.indexedFiles++;
            logger.debug(`[CONTEXT_INDEXER] Indexed: ${path.relative(this.workspaceRoot, filePath)}`);
          } catch (error) {
            results.skippedFiles++;
            const errorMessage = `Failed to index ${path.relative(this.workspaceRoot, filePath)}: ${
              error instanceof Error ? error.message : String(error)
            }`;
            results.errors.push(errorMessage);
            logger.warn(`[CONTEXT_INDEXER] ${errorMessage}`);
          }
        });

        await Promise.allSettled(batchPromises);
      }

      // Generate and store project metadata
      progressCallback?.({ message: 'Generating project metadata...', percentage: 95 });
      await this.generateProjectMetadata(projectId, results);

      const duration = Date.now() - startTime;
      logger.info(
        `[CONTEXT_INDEXER] Project indexing completed in ${duration}ms: ` +
        `${results.indexedFiles}/${results.totalFiles} files indexed, ${results.skippedFiles} skipped`
      );

      progressCallback?.({ message: 'Indexing complete!', percentage: 100 });
      return results;

    } catch (error) {
      logger.error('[CONTEXT_INDEXER] Project indexing failed:', error);
      results.errors.push(`Project indexing failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Index a single file and extract context
   */
  public async indexFile(filePath: string, projectId: string): Promise<void> {
    try {
      // Check file size
      const stats = await fs.promises.stat(filePath);
      if (stats.size > this.options.maxFileSize) {
        logger.debug(`[CONTEXT_INDEXER] Skipping large file: ${filePath} (${stats.size} bytes)`);
        return;
      }

      // Read file content
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const relativePath = path.relative(this.workspaceRoot, filePath);
      const extension = path.extname(filePath).toLowerCase();
      const language = this.detectLanguage(extension, filePath);

      // Analyze file if it's code
      let analysis: FileAnalysis | null = null;
      if (this.options.enableCodeAnalysis && this.isCodeFile(extension)) {
        analysis = await this.analyzeFile(filePath, content, language);
      }

      // Create context items based on file type
      if (this.isDocumentationFile(filePath)) {
        await this.indexDocumentationFile(filePath, content, projectId, relativePath);
      } else if (this.isConfigurationFile(filePath)) {
        await this.indexConfigurationFile(filePath, content, projectId, relativePath);
      } else if (this.isCodeFile(extension)) {
        await this.indexCodeFile(filePath, content, projectId, relativePath, analysis);
      } else {
        await this.indexGenericFile(filePath, content, projectId, relativePath);
      }

    } catch (error) {
      logger.error(`[CONTEXT_INDEXER] Failed to index file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Discover files to index based on patterns
   */
  private async discoverFiles(): Promise<string[]> {
    const files: string[] = [];
    
    try {
      // Use VS Code's glob pattern matching for consistent behavior
      const includePattern = `{${this.options.includePatterns.join(',')}}`;
      const excludePattern = `{${this.options.excludePatterns.join(',')}}`;

      const foundFiles = await vscode.workspace.findFiles(
        includePattern,
        excludePattern,
        10000 // max results
      );

      for (const fileUri of foundFiles) {
        const filePath = fileUri.fsPath;
        
        // Additional filtering
        if (await this.shouldIndexFile(filePath)) {
          files.push(filePath);
        }
      }

      return files.sort();
    } catch (error) {
      logger.error('[CONTEXT_INDEXER] Failed to discover files:', error);
      return [];
    }
  }

  /**
   * Check if a file should be indexed
   */
  private async shouldIndexFile(filePath: string): Promise<boolean> {
    try {
      // Check if file exists and is readable
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) return false;

      // Check size limits
      if (stats.size === 0 || stats.size > this.options.maxFileSize) return false;

      // Check if it's a binary file (simple heuristic)
      if (await this.isBinaryFile(filePath)) return false;

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Simple binary file detection
   */
  private async isBinaryFile(filePath: string): Promise<boolean> {
    try {
      const buffer = await fs.promises.readFile(filePath, { encoding: null });
      const sample = buffer.subarray(0, Math.min(8000, buffer.length));
      
      // Check for null bytes (common in binary files)
      for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0) return true;
      }

      return false;
    } catch (error) {
      return true; // Assume binary if can't read
    }
  }

  /**
   * Detect programming language from file extension and path
   */
  private detectLanguage(extension: string, filePath: string): string {
    const basename = path.basename(filePath).toLowerCase();
    
    // Check specific filenames first
    const filenameMapping: Record<string, string> = {
      'package.json': 'json',
      'tsconfig.json': 'json',
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
      'cargo.toml': 'toml',
      'pom.xml': 'xml',
      'build.gradle': 'gradle',
    };

    if (filenameMapping[basename]) {
      return filenameMapping[basename];
    }

    // Check extensions
    const extensionMapping: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.cc': 'cpp',
      '.cxx': 'cpp',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.php': 'php',
      '.rb': 'ruby',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.md': 'markdown',
      '.txt': 'text',
      '.json': 'json',
      '.xml': 'xml',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.toml': 'toml',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.sh': 'bash',
      '.sql': 'sql',
    };

    return extensionMapping[extension] || 'text';
  }

  /**
   * Analyze code file for structure and metadata
   */
  private async analyzeFile(filePath: string, content: string, language: string): Promise<FileAnalysis> {
    const lines = content.split('\n');
    
    const analysis: FileAnalysis = {
      filePath,
      language,
      size: content.length,
      lines: lines.length,
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      interfaces: [],
      types: [],
      complexity: 0,
      documentation: [],
    };

    try {
      // Language-specific analysis
      switch (language) {
        case 'typescript':
        case 'javascript':
          this.analyzeTypeScriptJavaScript(content, analysis);
          break;
        case 'python':
          this.analyzePython(content, analysis);
          break;
        case 'java':
          this.analyzeJava(content, analysis);
          break;
        default:
          this.analyzeGeneric(content, analysis);
      }

      // Calculate basic complexity
      analysis.complexity = this.calculateComplexity(content, language);
    } catch (error) {
      logger.warn(`[CONTEXT_INDEXER] Failed to analyze ${filePath}:`, error);
    }

    return analysis;
  }

  /**
   * Analyze TypeScript/JavaScript files
   */
  private analyzeTypeScriptJavaScript(content: string, analysis: FileAnalysis): void {
    // Import/export patterns
    const importRegex = /import\s+(?:.*?from\s+)?['"`]([^'"`]+)['"`]/g;
    const exportRegex = /export\s+(?:default\s+)?(?:class|function|interface|type|const|let|var)\s+(\w+)/g;
    
    // Function patterns
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
    
    // Class patterns
    const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
    
    // Interface patterns  
    const interfaceRegex = /(?:export\s+)?interface\s+(\w+)/g;
    
    // Type patterns
    const typeRegex = /(?:export\s+)?type\s+(\w+)/g;

    // Documentation patterns
    const docRegex = /\/\*\*([\s\S]*?)\*\//g;

    this.extractMatches(content, importRegex, analysis.imports, 1);
    this.extractMatches(content, exportRegex, analysis.exports, 1);
    this.extractMatches(content, functionRegex, analysis.functions, [1, 2]);
    this.extractMatches(content, classRegex, analysis.classes, 1);
    this.extractMatches(content, interfaceRegex, analysis.interfaces, 1);
    this.extractMatches(content, typeRegex, analysis.types, 1);
    this.extractMatches(content, docRegex, analysis.documentation, 1);
  }

  /**
   * Analyze Python files
   */
  private analyzePython(content: string, analysis: FileAnalysis): void {
    const importRegex = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g;
    const functionRegex = /def\s+(\w+)\s*\(/g;
    const classRegex = /class\s+(\w+)\s*(?:\([^)]*\))?:/g;
    const docRegex = /"""([\s\S]*?)"""|'''([\s\S]*?)'''/g;

    this.extractMatches(content, importRegex, analysis.imports, [1, 2]);
    this.extractMatches(content, functionRegex, analysis.functions, 1);
    this.extractMatches(content, classRegex, analysis.classes, 1);
    this.extractMatches(content, docRegex, analysis.documentation, [1, 2]);
  }

  /**
   * Analyze Java files
   */
  private analyzeJava(content: string, analysis: FileAnalysis): void {
    const importRegex = /import\s+(?:static\s+)?([^;]+);/g;
    const functionRegex = /(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*\{/g;
    const classRegex = /(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/g;
    const interfaceRegex = /(?:public\s+)?interface\s+(\w+)/g;
    const docRegex = /\/\*\*([\s\S]*?)\*\//g;

    this.extractMatches(content, importRegex, analysis.imports, 1);
    this.extractMatches(content, functionRegex, analysis.functions, 1);
    this.extractMatches(content, classRegex, analysis.classes, 1);
    this.extractMatches(content, interfaceRegex, analysis.interfaces, 1);
    this.extractMatches(content, docRegex, analysis.documentation, 1);
  }

  /**
   * Generic analysis for other languages
   */
  private analyzeGeneric(content: string, analysis: FileAnalysis): void {
    // Look for common patterns across languages
    const functionRegex = /(?:function|def|fn)\s+(\w+)/g;
    const classRegex = /(?:class|struct)\s+(\w+)/g;
    
    this.extractMatches(content, functionRegex, analysis.functions, 1);
    this.extractMatches(content, classRegex, analysis.classes, 1);
  }

  /**
   * Extract matches from regex patterns
   */
  private extractMatches(content: string, regex: RegExp, target: string[], groups: number | number[]): void {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const groupsArray = Array.isArray(groups) ? groups : [groups];
      
      for (const groupIndex of groupsArray) {
        const value = match[groupIndex];
        if (value && value.trim() && !target.includes(value.trim())) {
          target.push(value.trim());
        }
      }
    }
  }

  /**
   * Calculate basic code complexity
   */
  private calculateComplexity(content: string, language: string): number {
    let complexity = 1; // Base complexity

    // Count control flow keywords
    const controlFlowPatterns = [
      /\bif\b/g,
      /\belse\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bswitch\b/g,
      /\bcatch\b/g,
      /\btry\b/g,
    ];

    for (const pattern of controlFlowPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  /**
   * Check if file is a code file
   */
  private isCodeFile(extension: string): boolean {
    const codeExtensions = [
      '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.c', '.cpp', '.cs',
      '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.scala'
    ];
    return codeExtensions.includes(extension);
  }

  /**
   * Check if file is documentation
   */
  private isDocumentationFile(filePath: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    const extension = path.extname(filePath).toLowerCase();
    
    return extension === '.md' || 
           basename.startsWith('readme') ||
           basename.startsWith('changelog') ||
           basename.includes('license') ||
           basename.includes('contributing');
  }

  /**
   * Check if file is configuration
   */
  private isConfigurationFile(filePath: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    const configFiles = [
      'package.json', 'tsconfig.json', 'cargo.toml', 'pom.xml', 
      'build.gradle', 'requirements.txt', 'gemfile', 'composer.json'
    ];
    
    return configFiles.includes(basename) || basename.endsWith('.config.js');
  }

  /**
   * Index documentation file
   */
  private async indexDocumentationFile(
    filePath: string, 
    content: string, 
    projectId: string, 
    relativePath: string
  ): Promise<void> {
    const contextItem: ContextItem = {
      id: `doc_${Buffer.from(filePath).toString('base64')}`,
      type: ContextType.DOCUMENTATION,
      source: ContextSource.FILE_SYSTEM,
      content,
      metadata: {
        filePath: relativePath,
        fileType: 'documentation',
        language: 'markdown',
        size: content.length,
        lines: content.split('\n').length,
      },
      relevanceScore: 0.9,
      priority: ContextPriority.HIGH,
      timestamp: new Date(),
      tags: ['documentation', 'readme'],
      projectId,
    };

    await this.contextDB.store(contextItem);
  }

  /**
   * Index configuration file
   */
  private async indexConfigurationFile(
    filePath: string, 
    content: string, 
    projectId: string, 
    relativePath: string
  ): Promise<void> {
    const contextItem: ContextItem = {
      id: `config_${Buffer.from(filePath).toString('base64')}`,
      type: ContextType.PROJECT,
      source: ContextSource.FILE_SYSTEM,
      content,
      metadata: {
        filePath: relativePath,
        fileType: 'configuration',
        configType: path.basename(filePath),
        size: content.length,
      },
      relevanceScore: 0.8,
      priority: ContextPriority.HIGH,
      timestamp: new Date(),
      tags: ['configuration', 'project'],
      projectId,
    };

    await this.contextDB.store(contextItem);
  }

  /**
   * Index code file with analysis
   */
  private async indexCodeFile(
    filePath: string, 
    content: string, 
    projectId: string, 
    relativePath: string,
    analysis: FileAnalysis | null
  ): Promise<void> {
    const contextItem: ContextItem = {
      id: `code_${Buffer.from(filePath).toString('base64')}`,
      type: ContextType.CODE,
      source: ContextSource.FILE_SYSTEM,
      content,
      metadata: {
        filePath: relativePath,
        fileType: 'code',
        ...analysis,
      },
      relevanceScore: 0.7,
      priority: ContextPriority.MEDIUM,
      timestamp: new Date(),
      tags: ['code', analysis?.language || 'unknown'],
      projectId,
    };

    await this.contextDB.store(contextItem);
  }

  /**
   * Index generic file
   */
  private async indexGenericFile(
    filePath: string, 
    content: string, 
    projectId: string, 
    relativePath: string
  ): Promise<void> {
    const contextItem: ContextItem = {
      id: `file_${Buffer.from(filePath).toString('base64')}`,
      type: ContextType.PROJECT,
      source: ContextSource.FILE_SYSTEM,
      content,
      metadata: {
        filePath: relativePath,
        fileType: 'generic',
        extension: path.extname(filePath),
        size: content.length,
      },
      relevanceScore: 0.5,
      priority: ContextPriority.LOW,
      timestamp: new Date(),
      tags: ['file'],
      projectId,
    };

    await this.contextDB.store(contextItem);
  }

  /**
   * Generate project metadata from indexed files
   */
  private async generateProjectMetadata(
    projectId: string, 
    indexingResults: { totalFiles: number; indexedFiles: number; skippedFiles: number }
  ): Promise<void> {
    try {
      const stats = await this.contextDB.getStats();
      const projectPath = this.workspaceRoot;
      const projectName = path.basename(projectPath);

      // Analyze languages and frameworks from indexed files
      const languages = new Set<string>();
      const frameworks = new Set<string>();
      
      // Simple heuristics based on common patterns
      if (await this.fileExists(path.join(projectPath, 'package.json'))) {
        frameworks.add('Node.js');
        if (await this.fileExists(path.join(projectPath, 'tsconfig.json'))) {
          languages.add('TypeScript');
        } else {
          languages.add('JavaScript');
        }
      }

      if (await this.fileExists(path.join(projectPath, 'Cargo.toml'))) {
        languages.add('Rust');
      }

      if (await this.fileExists(path.join(projectPath, 'pom.xml'))) {
        languages.add('Java');
        frameworks.add('Maven');
      }

      if (await this.fileExists(path.join(projectPath, 'requirements.txt'))) {
        languages.add('Python');
      }

      const metadata: ProjectMetadata = {
        projectId,
        name: projectName,
        path: projectPath,
        language: Array.from(languages),
        framework: Array.from(frameworks),
        dependencies: [], // Could be extracted from package files
        lastAnalyzed: new Date(),
        fileCount: indexingResults.indexedFiles,
        codebaseSize: 0, // Could be calculated from file sizes
      };

      await this.contextDB.storeProjectMetadata(metadata);
      logger.info(`[CONTEXT_INDEXER] Generated project metadata for: ${projectName}`);
    } catch (error) {
      logger.error('[CONTEXT_INDEXER] Failed to generate project metadata:', error);
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}