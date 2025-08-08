import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';
import {
  ContextItem,
  ContextType,
  ContextSource,
  ContextPriority,
  ProjectMetadata
} from './types';
import { ChromaContextDB } from './storage/ChromaContextDB';
import { ProjectIndexer } from './ProjectIndexer';

/**
 * Manages project-specific context including project knowledge,
 * file relationships, documentation, and project patterns
 */
export class ProjectContext {
  private contextDB: ChromaContextDB;
  private projectIndexer: ProjectIndexer;
  private currentProject: ProjectMetadata | null = null;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private initialized = false;

  constructor(contextDB: ChromaContextDB) {
    this.contextDB = contextDB;
    this.projectIndexer = new ProjectIndexer(contextDB);
  }

  /**
   * Initialize project context system
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('[PROJECT_CONTEXT] Already initialized');
      return;
    }

    try {
      logger.info('[PROJECT_CONTEXT] Initializing project context system...');
      
      // Initialize project indexer
      await this.projectIndexer.initialize();
      
      // Load current workspace project
      await this.loadCurrentProject();
      
      // Setup file system watchers
      this.setupFileWatchers();
      
      this.initialized = true;
      logger.info('[PROJECT_CONTEXT] Project context system initialized');

    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Index the current workspace project
   */
  public async indexCurrentProject(): Promise<void> {
    try {
      if (!this.currentProject) {
        logger.warn('[PROJECT_CONTEXT] No current project to index');
        return;
      }

      logger.info(`[PROJECT_CONTEXT] Indexing project: ${this.currentProject.name}`);
      
      await this.projectIndexer.indexProject(this.currentProject.path, this.currentProject.projectId);
      
      // Update project metadata
      this.currentProject.lastAnalyzed = new Date();
      await this.contextDB.storeProjectMetadata(this.currentProject);

      logger.info(`[PROJECT_CONTEXT] Project indexing completed: ${this.currentProject.name}`);

    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to index project:', error);
      throw error;
    }
  }

  /**
   * Get project-specific context
   */
  public async getProjectContext(query?: string): Promise<ContextItem[]> {
    try {
      if (!this.currentProject) {
        logger.debug('[PROJECT_CONTEXT] No current project for context');
        return [];
      }

      logger.debug(`[PROJECT_CONTEXT] Getting project context: ${query || 'all'}`);

      const contextItems = await this.contextDB.search({
        query: query || '',
        types: [ContextType.PROJECT],
        projectId: this.currentProject.projectId,
        maxResults: 50
      });

      return contextItems;

    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to get project context:', error);
      return [];
    }
  }

  /**
   * Add project-specific context
   */
  public async addProjectContext(content: string, source: ContextSource, metadata: any = {}): Promise<void> {
    try {
      if (!this.currentProject) {
        logger.warn('[PROJECT_CONTEXT] No current project to add context to');
        return;
      }

      const contextItem: ContextItem = {
        id: `project_${this.currentProject.projectId}_${Date.now()}`,
        type: ContextType.PROJECT,
        source,
        content,
        metadata: {
          ...metadata,
          projectName: this.currentProject.name,
          projectPath: this.currentProject.path
        },
        relevanceScore: 0.8,
        priority: ContextPriority.MEDIUM,
        timestamp: new Date(),
        tags: this.generateProjectTags(content, source),
        projectId: this.currentProject.projectId
      };

      await this.contextDB.store(contextItem);
      logger.debug(`[PROJECT_CONTEXT] Added project context: ${contextItem.id}`);

    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to add project context:', error);
      throw error;
    }
  }

  /**
   * Analyze file for project context
   */
  public async analyzeFile(filePath: string): Promise<void> {
    try {
      if (!this.currentProject) {
        logger.debug('[PROJECT_CONTEXT] No current project for file analysis');
        return;
      }

      logger.debug(`[PROJECT_CONTEXT] Analyzing file: ${filePath}`);

      const analysis = await this.projectIndexer.analyzeFile(filePath);
      if (!analysis) return;

      // Store file analysis as project context
      const contextItem: ContextItem = {
        id: `file_analysis_${this.generateFileId(filePath)}`,
        type: ContextType.PROJECT,
        source: ContextSource.CODE_ANALYSIS,
        content: analysis.summary,
        metadata: {
          filePath,
          language: analysis.language,
          functions: analysis.functions,
          classes: analysis.classes,
          imports: analysis.imports,
          complexity: analysis.complexity
        },
        relevanceScore: 0.7,
        priority: ContextPriority.MEDIUM,
        timestamp: new Date(),
        tags: this.generateFileTags(filePath, analysis),
        projectId: this.currentProject.projectId
      };

      await this.contextDB.store(contextItem);

    } catch (error) {
      logger.error(`[PROJECT_CONTEXT] Failed to analyze file ${filePath}:`, error);
    }
  }

  /**
   * Get file relationships and dependencies
   */
  public async getFileRelationships(filePath: string): Promise<ContextItem[]> {
    try {
      if (!this.currentProject) {
        return [];
      }

      logger.debug(`[PROJECT_CONTEXT] Getting file relationships: ${filePath}`);

      // Search for files that import or reference this file
      const fileName = path.basename(filePath);
      const fileNameWithoutExt = path.basename(filePath, path.extname(filePath));

      const relationships = await this.contextDB.search({
        query: `${fileName} ${fileNameWithoutExt}`,
        types: [ContextType.PROJECT],
        sources: [ContextSource.CODE_ANALYSIS],
        projectId: this.currentProject.projectId,
        maxResults: 20
      });

      return relationships;

    } catch (error) {
      logger.error(`[PROJECT_CONTEXT] Failed to get file relationships:`, error);
      return [];
    }
  }

  /**
   * Add context item to project context
   */
  public async addContext(item: ContextItem): Promise<void> {
    try {
      logger.debug(`[PROJECT_CONTEXT] Adding context item: ${item.id}`);
      await this.contextDB.store(item);
    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to add context:', error);
      throw error;
    }
  }

  /**
   * Get project context statistics
   */
  public async getStats(): Promise<any> {
    try {
      const hasProject = this.currentProject !== null;
      const projectFiles = hasProject ? await this.getProjectFileCount() : 0;

      return {
        hasProject,
        projectName: this.currentProject?.name || null,
        projectPath: this.currentProject?.path || null,
        projectFiles,
        lastIndexed: this.currentProject?.lastAnalyzed || null,
        initialized: this.initialized
      };
    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to get stats:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async loadCurrentProject(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      logger.debug('[PROJECT_CONTEXT] No workspace folder found');
      return;
    }

    const projectPath = workspaceFolder.uri.fsPath;
    const projectName = workspaceFolder.name;
    const projectId = this.generateProjectId(projectPath);

    // Analyze project structure
    const { language, framework, dependencies } = await this.analyzeProjectStructure(projectPath);
    const fileCount = await this.getProjectFileCount();

    this.currentProject = {
      projectId,
      name: projectName,
      path: projectPath,
      language,
      framework,
      dependencies,
      lastAnalyzed: new Date(),
      fileCount,
      codebaseSize: await this.calculateCodebaseSize(projectPath)
    };

    // Store project metadata
    await this.contextDB.storeProjectMetadata(this.currentProject);

    logger.info(`[PROJECT_CONTEXT] Loaded project: ${projectName} (${language.join(', ')})`);
  }

  private setupFileWatchers(): void {
    if (!this.currentProject) return;

    // Watch for file changes in the project
    const pattern = new vscode.RelativePattern(this.currentProject.path, '**/*');
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.fileWatcher.onDidCreate(async (uri) => {
      logger.debug(`[PROJECT_CONTEXT] File created: ${uri.fsPath}`);
      await this.analyzeFile(uri.fsPath);
    });

    this.fileWatcher.onDidChange(async (uri) => {
      logger.debug(`[PROJECT_CONTEXT] File changed: ${uri.fsPath}`);
      await this.analyzeFile(uri.fsPath);
    });

    this.fileWatcher.onDidDelete((uri) => {
      logger.debug(`[PROJECT_CONTEXT] File deleted: ${uri.fsPath}`);
      // Could remove related context items
    });

    logger.debug('[PROJECT_CONTEXT] File watchers setup completed');
  }

  private async analyzeProjectStructure(projectPath: string): Promise<{
    language: string[];
    framework: string[];
    dependencies: string[];
  }> {
    const result = {
      language: [] as string[],
      framework: [] as string[],
      dependencies: [] as string[]
    };

    try {
      // Check for common project files
      const files = fs.readdirSync(projectPath);
      logger.debug(`[PROJECT_CONTEXT] Analyzing project files: ${files.join(', ')}`);
      
      // Language detection by project files
      if (files.includes('package.json')) {
        result.language.push('javascript', 'typescript');
        try {
          const packageJson = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
          result.dependencies = Object.keys(packageJson.dependencies || {});
          
          // Framework detection
          if (result.dependencies.includes('react')) result.framework.push('react');
          if (result.dependencies.includes('vue')) result.framework.push('vue');
          if (result.dependencies.includes('angular')) result.framework.push('angular');
          if (result.dependencies.includes('express')) result.framework.push('express');
        } catch (error) {
          logger.warn(`[PROJECT_CONTEXT] Failed to parse package.json:`, error);
        }
      }
      
      if (files.includes('requirements.txt') || files.includes('setup.py') || files.includes('pyproject.toml')) {
        result.language.push('python');
        
        // Python framework detection
        if (files.includes('requirements.txt')) {
          try {
            const requirements = fs.readFileSync(path.join(projectPath, 'requirements.txt'), 'utf8');
            if (requirements.includes('fastapi')) result.framework.push('fastapi');
            if (requirements.includes('flask')) result.framework.push('flask');
            if (requirements.includes('django')) result.framework.push('django');
            if (requirements.includes('vllm')) result.framework.push('vllm');
            result.dependencies = requirements.split('\n').filter(line => line.trim() && !line.startsWith('#'));
          } catch (error) {
            logger.warn(`[PROJECT_CONTEXT] Failed to parse requirements.txt:`, error);
          }
        }
      }

      // Language detection by file extensions if no project files found
      if (result.language.length === 0) {
        const allFiles = this.getAllFilesRecursive(projectPath);
        const extensions = allFiles.map(file => path.extname(file).toLowerCase());
        
        if (extensions.some(ext => ['.py'].includes(ext))) {
          result.language.push('python');
        }
        if (extensions.some(ext => ['.js', '.ts', '.jsx', '.tsx'].includes(ext))) {
          result.language.push('javascript', 'typescript');
        }
        if (extensions.some(ext => ['.java'].includes(ext))) {
          result.language.push('java');
        }
        if (extensions.some(ext => ['.cpp', '.c', '.h'].includes(ext))) {
          result.language.push('c++');
        }
        if (extensions.some(ext => ['.go'].includes(ext))) {
          result.language.push('go');
        }
        if (extensions.some(ext => ['.rs'].includes(ext))) {
          result.language.push('rust');
        }
        
        logger.debug(`[PROJECT_CONTEXT] Detected languages by file extensions: ${result.language.join(', ')}`);
      }
      
      if (files.includes('Cargo.toml')) {
        result.language.push('rust');
      }
      
      if (files.includes('go.mod')) {
        result.language.push('go');
      }

    } catch (error) {
      logger.debug('[PROJECT_CONTEXT] Failed to analyze project structure:', error);
    }

    return result;
  }

  private async getProjectFileCount(): Promise<number> {
    if (!this.currentProject) return 0;
    
    try {
      // Simple file count - could be optimized
      const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 1000);
      return files.length;
    } catch {
      return 0;
    }
  }

  private async calculateCodebaseSize(projectPath: string): Promise<number> {
    try {
      const stats = fs.statSync(projectPath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  private generateProjectId(projectPath: string): string {
    // Create a consistent ID based on project path
    return Buffer.from(projectPath).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
  }

  private generateFileId(filePath: string): string {
    return Buffer.from(filePath).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 12);
  }

  private generateProjectTags(content: string, source: ContextSource): string[] {
    const tags = ['project'];
    
    tags.push(`source:${source}`);
    
    // Add language-specific tags
    if (this.currentProject) {
      tags.push(...this.currentProject.language.map(lang => `lang:${lang}`));
      tags.push(...this.currentProject.framework.map(fw => `framework:${fw}`));
    }
    
    return tags;
  }

  private generateFileTags(filePath: string, analysis: any): string[] {
    const tags = ['file', 'code'];
    
    const ext = path.extname(filePath);
    if (ext) {
      tags.push(`ext:${ext.substring(1)}`);
    }
    
    if (analysis.language) {
      tags.push(`lang:${analysis.language}`);
    }
    
    if (analysis.functions && analysis.functions.length > 0) {
      tags.push('functions');
    }
    
    if (analysis.classes && analysis.classes.length > 0) {
      tags.push('classes');
    }
    
    return tags;
  }

  private getAllFilesRecursive(dir: string): string[] {
    const result: string[] = [];
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        if (item.startsWith('.')) continue; // Skip hidden files/folders
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          if (!['node_modules', '.git', '__pycache__', '.venv', 'venv'].includes(item)) {
            result.push(...this.getAllFilesRecursive(fullPath));
          }
        } else {
          result.push(fullPath);
        }
      }
    } catch (error) {
      logger.warn(`[PROJECT_CONTEXT] Failed to read directory ${dir}:`, error);
    }
    return result;
  }
}