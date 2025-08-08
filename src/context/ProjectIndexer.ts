import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';
import {
  ContextItem,
  ContextType,
  ContextSource,
  ContextPriority
} from './types';
import { ChromaContextDB } from './storage/ChromaContextDB';

export interface FileAnalysis {
  filePath: string;
  language: string;
  summary: string;
  functions: string[];
  classes: string[];
  imports: string[];
  exports: string[];
  complexity: number;
  lineCount: number;
  dependencies: string[];
}

export interface ProjectStructure {
  totalFiles: number;
  languages: { [key: string]: number };
  frameworks: string[];
  dependencies: string[];
  entryPoints: string[];
  configFiles: string[];
}

/**
 * Indexes and analyzes project files to build context knowledge base
 */
export class ProjectIndexer {
  private contextDB: ChromaContextDB;
  private initialized = false;
  private supportedExtensions = new Set([
    '.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.cpp', '.c', '.cs',
    '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.scala', '.vue',
    '.json', '.yaml', '.yml', '.md', '.txt', '.html', '.css', '.scss'
  ]);

  constructor(contextDB: ChromaContextDB) {
    this.contextDB = contextDB;
  }

  /**
   * Initialize the project indexer
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('[PROJECT_INDEXER] Already initialized');
      return;
    }

    try {
      logger.info('[PROJECT_INDEXER] Initializing project indexer...');
      this.initialized = true;
      logger.info('[PROJECT_INDEXER] Project indexer initialized');
    } catch (error) {
      logger.error('[PROJECT_INDEXER] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Index an entire project
   */
  public async indexProject(projectPath: string, projectId: string): Promise<void> {
    try {
      logger.info(`[PROJECT_INDEXER] Starting project indexing: ${projectPath}`);

      // Get all relevant files
      const files = await this.getAllProjectFiles(projectPath);
      logger.info(`[PROJECT_INDEXER] Found ${files.length} files to analyze`);

      // Analyze files in batches to avoid overwhelming the system
      const batchSize = 10;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (filePath) => {
            try {
              await this.analyzeAndStoreFile(filePath, projectId);
            } catch (error) {
              logger.debug(`[PROJECT_INDEXER] Failed to analyze ${filePath}:`, error);
            }
          })
        );

        // Small delay between batches to prevent overwhelming
        if (i + batchSize < files.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Analyze project structure
      await this.analyzeProjectStructure(projectPath, projectId);

      logger.info(`[PROJECT_INDEXER] Completed project indexing: ${projectPath}`);

    } catch (error) {
      logger.error(`[PROJECT_INDEXER] Failed to index project ${projectPath}:`, error);
      throw error;
    }
  }

  /**
   * Analyze a single file and return analysis results
   */
  public async analyzeFile(filePath: string): Promise<FileAnalysis | null> {
    try {
      if (!fs.existsSync(filePath)) {
        logger.debug(`[PROJECT_INDEXER] File not found: ${filePath}`);
        return null;
      }

      const ext = path.extname(filePath).toLowerCase();
      if (!this.supportedExtensions.has(ext)) {
        logger.debug(`[PROJECT_INDEXER] Unsupported file type: ${filePath}`);
        return null;
      }

      logger.debug(`[PROJECT_INDEXER] Analyzing file: ${filePath}`);

      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      const analysis: FileAnalysis = {
        filePath,
        language: this.detectLanguage(filePath, content),
        summary: this.generateFileSummary(filePath, content),
        functions: this.extractFunctions(content, ext),
        classes: this.extractClasses(content, ext),
        imports: this.extractImports(content, ext),
        exports: this.extractExports(content, ext),
        complexity: this.calculateComplexity(content),
        lineCount: lines.length,
        dependencies: this.extractDependencies(content, ext)
      };

      return analysis;

    } catch (error) {
      logger.error(`[PROJECT_INDEXER] Failed to analyze file ${filePath}:`, error);
      return null;
    }
  }

  private async getAllProjectFiles(projectPath: string): Promise<string[]> {
    try {
      const files: string[] = [];
      const pattern = new vscode.RelativePattern(projectPath, '**/*');
      
      // Comprehensive exclude patterns for all major ecosystems
      const excludePatterns = [
        '**/node_modules/**',     // Node.js
        '**/venv/**',             // Python virtual env
        '**/env/**',              // Python virtual env
        '**/.venv/**',            // Python virtual env
        '**/target/**',           // Rust/Maven
        '**/build/**',            // Various build outputs
        '**/dist/**',             // Distribution folders
        '**/out/**',              // Output folders
        '**/.next/**',            // Next.js
        '**/.nuxt/**',            // Nuxt.js
        '**/vendor/**',           // PHP/Go dependencies
        '**/Pods/**',             // iOS CocoaPods
        '**/site-packages/**',    // Python packages
        '**/__pycache__/**',      // Python cache
        '**/bin/**',              // Binary folders
        '**/obj/**',              // Object files
        '**/.gradle/**',          // Gradle cache
        '**/gradle/**',           // Gradle wrapper
        '**/cmake-build-*/**',    // CMake build
        '**/DerivedData/**',      // Xcode
        '**/.dart_tool/**',       // Dart/Flutter
        '**/packages/**',         // Dart/Flutter packages
        '**/.pub-cache/**',       // Dart pub cache
        '**/coverage/**',         // Coverage reports
        '**/logs/**',             // Log files
        '**/.cache/**',           // Various caches
        '**/.tmp/**',             // Temporary files
        '**/temp/**',             // Temporary files
        '**/.git/**',             // Git internals
        '**/.svn/**',             // SVN internals
        '**/.hg/**',              // Mercurial internals
      ].join(',');
      
      const uris = await vscode.workspace.findFiles(pattern, `{${excludePatterns}}`, 2000);
      
      for (const uri of uris) {
        const filePath = uri.fsPath;
        const ext = path.extname(filePath).toLowerCase();
        
        // Additional file-level filtering
        const fileName = path.basename(filePath).toLowerCase();
        const relativePath = path.relative(projectPath, filePath);
        
        // Skip hidden files and system files
        if (fileName.startsWith('.') && !this.isImportantDotFile(fileName)) {
          continue;
        }
        
        // Skip lock files and generated files
        if (this.isGeneratedOrLockFile(fileName)) {
          continue;
        }
        
        // Skip files in deeply nested cache/temp directories
        if (this.isInIgnoredDirectory(relativePath)) {
          continue;
        }
        
        if (this.supportedExtensions.has(ext)) {
          files.push(filePath);
        }
      }

      return files;

    } catch (error) {
      logger.error('[PROJECT_INDEXER] Failed to get project files:', error);
      return [];
    }
  }

  private async analyzeAndStoreFile(filePath: string, projectId: string): Promise<void> {
    const analysis = await this.analyzeFile(filePath);
    if (!analysis) return;

    // Store file analysis as context
    const contextItem: ContextItem = {
      id: `file_${this.generateFileId(filePath)}`,
      type: ContextType.PROJECT,
      source: ContextSource.CODE_ANALYSIS,
      content: analysis.summary,
      metadata: {
        filePath: analysis.filePath,
        language: analysis.language,
        functions: analysis.functions,
        classes: analysis.classes,
        imports: analysis.imports,
        exports: analysis.exports,
        complexity: analysis.complexity,
        lineCount: analysis.lineCount,
        dependencies: analysis.dependencies
      },
      relevanceScore: 0.7,
      priority: ContextPriority.MEDIUM,
      timestamp: new Date(),
      tags: this.generateFileTags(analysis),
      projectId
    };

    await this.contextDB.store(contextItem);
  }

  private async analyzeProjectStructure(projectPath: string, projectId: string): Promise<void> {
    try {
      const structure = await this.getProjectStructure(projectPath);
      
      // Detect actual project features
      const projectFeatures = await this.detectProjectFeatures(projectPath, structure);
      
      // Store project structure as context
      const contextItem: ContextItem = {
        id: `project_structure_${projectId}`,
        type: ContextType.PROJECT,
        source: ContextSource.PROJECT_ANALYSIS,
        content: this.generateProjectSummary(structure),
        metadata: {
          structure,
          features: projectFeatures,
          projectPath,
          analyzedAt: new Date()
        },
        relevanceScore: 0.9,
        priority: ContextPriority.HIGH,
        timestamp: new Date(),
        tags: ['project', 'structure', 'overview', ...structure.frameworks.map(f => `framework:${f}`), ...projectFeatures.map(f => `feature:${f.id}`)],
        projectId
      };

      await this.contextDB.store(contextItem);

      // Store individual features as separate context items
      for (const feature of projectFeatures) {
        const featureContextItem: ContextItem = {
          id: `project_feature_${projectId}_${feature.id}`,
          type: ContextType.PROJECT,
          source: ContextSource.PROJECT_ANALYSIS,
          content: `${feature.name}: ${feature.description}`,
          metadata: {
            feature,
            projectPath,
            confidence: feature.confidence,
            evidence: feature.evidence,
            analyzedAt: new Date()
          },
          relevanceScore: feature.confidence,
          priority: feature.confidence > 0.8 ? ContextPriority.HIGH : ContextPriority.MEDIUM,
          timestamp: new Date(),
          tags: ['project', 'feature', feature.id, `status:${feature.status}`, `confidence:${Math.round(feature.confidence * 100)}`],
          projectId
        };

        await this.contextDB.store(featureContextItem);
      }

    } catch (error) {
      logger.error('[PROJECT_INDEXER] Failed to analyze project structure:', error);
    }
  }

  private async getProjectStructure(projectPath: string): Promise<ProjectStructure> {
    const structure: ProjectStructure = {
      totalFiles: 0,
      languages: {},
      frameworks: [],
      dependencies: [],
      entryPoints: [],
      configFiles: []
    };

    try {
      const files = await this.getAllProjectFiles(projectPath);
      structure.totalFiles = files.length;

      // Analyze each file for language detection
      for (const filePath of files) {
        const ext = path.extname(filePath).toLowerCase();
        const language = this.getLanguageFromExtension(ext);
        
        if (language) {
          structure.languages[language] = (structure.languages[language] || 0) + 1;
        }

        // Check for entry points and config files
        const fileName = path.basename(filePath).toLowerCase();
        if (['index.js', 'index.ts', 'main.py', 'main.go', 'main.java'].includes(fileName)) {
          structure.entryPoints.push(filePath);
        }

        if (['package.json', 'requirements.txt', 'cargo.toml', 'go.mod', 'pom.xml'].includes(fileName)) {
          structure.configFiles.push(filePath);
          
          // Extract dependencies from config files
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const deps = this.extractDependenciesFromConfig(content, fileName);
            structure.dependencies.push(...deps);
          } catch (error) {
            logger.debug(`[PROJECT_INDEXER] Failed to read config file ${filePath}:`, error);
          }
        }
      }

      // Detect frameworks from dependencies
      structure.frameworks = this.detectFrameworks(structure.dependencies);

    } catch (error) {
      logger.error('[PROJECT_INDEXER] Failed to get project structure:', error);
    }

    return structure;
  }

  private detectLanguage(filePath: string, content: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return this.getLanguageFromExtension(ext) || 'unknown';
  }

  private getLanguageFromExtension(ext: string): string | null {
    const languageMap: { [key: string]: string } = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.jsx': 'javascript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.php': 'php',
      '.rb': 'ruby',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.vue': 'vue',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss'
    };

    return languageMap[ext] || null;
  }

  private generateFileSummary(filePath: string, content: string): string {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath);
    const lines = content.split('\n');
    const nonEmptyLines = lines.filter(line => line.trim().length > 0).length;

    // Extract first comment or docstring as description
    let description = '';
    const firstLines = lines.slice(0, 10).join('\n');
    
    if (ext === '.py') {
      const docstringMatch = firstLines.match(/"""([\s\S]*?)"""/);
      if (docstringMatch) description = docstringMatch[1].trim();
    } else if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
      const commentMatch = firstLines.match(/\/\*\*([\s\S]*?)\*\//);
      if (commentMatch) description = commentMatch[1].replace(/\*/g, '').trim();
    }

    return `${fileName}: ${description || `${nonEmptyLines} lines of code`}`;
  }

  private extractFunctions(content: string, ext: string): string[] {
    const functions: string[] = [];

    try {
      if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        // Match function declarations and expressions
        const functionRegex = /(?:function\s+(\w+)|(\w+)\s*[=:]\s*(?:async\s+)?(?:\([^)]*\)\s*=>|\([^)]*\)\s*\{|function))/g;
        let match;
        while ((match = functionRegex.exec(content)) !== null) {
          const funcName = match[1] || match[2];
          if (funcName && !functions.includes(funcName)) {
            functions.push(funcName);
          }
        }
      } else if (ext === '.py') {
        // Match Python function definitions
        const functionRegex = /def\s+(\w+)\s*\(/g;
        let match;
        while ((match = functionRegex.exec(content)) !== null) {
          if (!functions.includes(match[1])) {
            functions.push(match[1]);
          }
        }
      }
    } catch (error) {
      logger.debug(`[PROJECT_INDEXER] Failed to extract functions from ${ext}:`, error);
    }

    return functions;
  }

  private extractClasses(content: string, ext: string): string[] {
    const classes: string[] = [];

    try {
      if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        // Match class declarations
        const classRegex = /class\s+(\w+)/g;
        let match;
        while ((match = classRegex.exec(content)) !== null) {
          if (!classes.includes(match[1])) {
            classes.push(match[1]);
          }
        }
      } else if (ext === '.py') {
        // Match Python class definitions
        const classRegex = /class\s+(\w+)/g;
        let match;
        while ((match = classRegex.exec(content)) !== null) {
          if (!classes.includes(match[1])) {
            classes.push(match[1]);
          }
        }
      }
    } catch (error) {
      logger.debug(`[PROJECT_INDEXER] Failed to extract classes from ${ext}:`, error);
    }

    return classes;
  }

  private extractImports(content: string, ext: string): string[] {
    const imports: string[] = [];

    try {
      if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        // Match import statements
        const importRegex = /import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          if (!imports.includes(match[1])) {
            imports.push(match[1]);
          }
        }
      } else if (ext === '.py') {
        // Match Python imports
        const importRegex = /(?:from\s+(\w+(?:\.\w+)*)|import\s+(\w+(?:\.\w+)*))/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          const importName = match[1] || match[2];
          if (importName && !imports.includes(importName)) {
            imports.push(importName);
          }
        }
      }
    } catch (error) {
      logger.debug(`[PROJECT_INDEXER] Failed to extract imports from ${ext}:`, error);
    }

    return imports;
  }

  private extractExports(content: string, ext: string): string[] {
    const exports: string[] = [];

    try {
      if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        // Match export statements
        const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var)?\s*(\w+)?/g;
        let match;
        while ((match = exportRegex.exec(content)) !== null) {
          if (match[1] && !exports.includes(match[1])) {
            exports.push(match[1]);
          }
        }
      }
    } catch (error) {
      logger.debug(`[PROJECT_INDEXER] Failed to extract exports from ${ext}:`, error);
    }

    return exports;
  }

  private extractDependencies(content: string, ext: string): string[] {
    const dependencies: string[] = [];

    try {
      if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        // Extract module imports that might be dependencies
        const importRegex = /import\s+[^'"]*from\s+['"]([^'"./][^'"]*)['"]/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          const dep = match[1].split('/')[0]; // Get package name
          if (!dependencies.includes(dep)) {
            dependencies.push(dep);
          }
        }
      }
    } catch (error) {
      logger.debug(`[PROJECT_INDEXER] Failed to extract dependencies from ${ext}:`, error);
    }

    return dependencies;
  }

  private calculateComplexity(content: string): number {
    // Simple complexity metric based on control structures
    const complexityPatterns = [
      /if\s*\(/g,
      /while\s*\(/g,
      /for\s*\(/g,
      /switch\s*\(/g,
      /catch\s*\(/g,
      /\?\s*:/g, // ternary operator
    ];

    let complexity = 1; // Base complexity
    for (const pattern of complexityPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  private extractDependenciesFromConfig(content: string, fileName: string): string[] {
    const dependencies: string[] = [];

    try {
      if (fileName === 'package.json') {
        const packageJson = JSON.parse(content);
        const deps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies
        };
        dependencies.push(...Object.keys(deps));
      } else if (fileName === 'requirements.txt') {
        const lines = content.split('\n');
        for (const line of lines) {
          const dep = line.trim().split(/[>=<]/)[0];
          if (dep) dependencies.push(dep);
        }
      }
    } catch (error) {
      logger.debug(`[PROJECT_INDEXER] Failed to parse ${fileName}:`, error);
    }

    return dependencies;
  }

  private detectFrameworks(dependencies: string[]): string[] {
    const frameworks: string[] = [];
    const frameworkMap: { [key: string]: string } = {
      'react': 'React',
      'vue': 'Vue.js',
      'angular': 'Angular',
      'express': 'Express.js',
      'fastify': 'Fastify',
      'django': 'Django',
      'flask': 'Flask',
      'spring': 'Spring',
      'hibernate': 'Hibernate'
    };

    for (const dep of dependencies) {
      const framework = frameworkMap[dep.toLowerCase()];
      if (framework && !frameworks.includes(framework)) {
        frameworks.push(framework);
      }
    }

    return frameworks;
  }

  /**
   * Detect actual project features based on comprehensive analysis
   */
  private async detectProjectFeatures(projectPath: string, structure: ProjectStructure): Promise<{ id: string; name: string; description: string; status: string; confidence: number; evidence: string[] }[]> {
    const features: { id: string; name: string; description: string; status: string; confidence: number; evidence: string[] }[] = [];

    try {
      // Web Development Features
      await this.detectWebFeatures(projectPath, structure, features);
      
      // API Features
      await this.detectAPIFeatures(projectPath, structure, features);
      
      // Database Features
      await this.detectDatabaseFeatures(projectPath, structure, features);
      
      // Testing Features
      await this.detectTestingFeatures(projectPath, structure, features);
      
      // Build & Deployment Features
      await this.detectBuildDeploymentFeatures(projectPath, structure, features);
      
      // Authentication & Security Features
      await this.detectAuthSecurityFeatures(projectPath, structure, features);
      
      // Development Tools Features
      await this.detectDevelopmentToolsFeatures(projectPath, structure, features);
      
      // UI/UX Features
      await this.detectUIUXFeatures(projectPath, structure, features);

    } catch (error) {
      logger.error('[PROJECT_INDEXER] Failed to detect project features:', error);
    }

    return features;
  }

  private async detectWebFeatures(projectPath: string, structure: ProjectStructure, features: any[]): Promise<void> {
    const evidence: string[] = [];
    
    // Check for React
    if (structure.dependencies.includes('react')) {
      evidence.push('React dependency found');
      
      // Check for specific React patterns
      if (structure.dependencies.includes('react-router') || structure.dependencies.includes('react-router-dom')) {
        evidence.push('React Router for navigation');
      }
      if (structure.dependencies.includes('redux') || structure.dependencies.includes('@reduxjs/toolkit')) {
        evidence.push('Redux state management');
      }
      if (structure.dependencies.includes('react-query') || structure.dependencies.includes('@tanstack/react-query')) {
        evidence.push('React Query for data fetching');
      }
      
      features.push({
        id: 'react-app',
        name: 'React Application',
        description: 'Modern React-based web application with component architecture',
        status: 'implemented',
        confidence: 0.9,
        evidence: [...evidence]
      });
    }

    // Check for Vue.js
    if (structure.dependencies.includes('vue')) {
      const vueEvidence = ['Vue.js dependency found'];
      if (structure.dependencies.includes('vue-router')) vueEvidence.push('Vue Router');
      if (structure.dependencies.includes('vuex') || structure.dependencies.includes('pinia')) vueEvidence.push('State management');
      
      features.push({
        id: 'vue-app',
        name: 'Vue.js Application',
        description: 'Vue.js-based single page application',
        status: 'implemented',
        confidence: 0.9,
        evidence: vueEvidence
      });
    }

    // Check for Next.js
    if (structure.dependencies.includes('next')) {
      features.push({
        id: 'nextjs-app',
        name: 'Next.js Application',
        description: 'Full-stack React framework with SSR/SSG capabilities',
        status: 'implemented',
        confidence: 0.95,
        evidence: ['Next.js dependency found', 'Server-side rendering capability']
      });
    }

    // Check for Progressive Web App features
    const hasServiceWorker = fs.existsSync(path.join(projectPath, 'public', 'sw.js')) || 
                            fs.existsSync(path.join(projectPath, 'src', 'sw.js'));
    const hasManifest = fs.existsSync(path.join(projectPath, 'public', 'manifest.json'));
    
    if (hasServiceWorker || hasManifest || structure.dependencies.includes('workbox-webpack-plugin')) {
      const pwaEvidence = [];
      if (hasServiceWorker) pwaEvidence.push('Service Worker detected');
      if (hasManifest) pwaEvidence.push('Web App Manifest found');
      if (structure.dependencies.includes('workbox-webpack-plugin')) pwaEvidence.push('Workbox for PWA features');
      
      features.push({
        id: 'pwa-features',
        name: 'Progressive Web App',
        description: 'Progressive Web App capabilities with offline support',
        status: 'implemented',
        confidence: 0.8,
        evidence: pwaEvidence
      });
    }
  }

  private async detectAPIFeatures(projectPath: string, structure: ProjectStructure, features: any[]): Promise<void> {
    const apiEvidence: string[] = [];
    
    // Check for Express.js API
    if (structure.dependencies.includes('express')) {
      apiEvidence.push('Express.js server framework');
      
      if (structure.dependencies.includes('cors')) apiEvidence.push('CORS middleware');
      if (structure.dependencies.includes('helmet')) apiEvidence.push('Security middleware (Helmet)');
      if (structure.dependencies.includes('morgan')) apiEvidence.push('Request logging');
      
      features.push({
        id: 'express-api',
        name: 'Express.js API',
        description: 'RESTful API built with Express.js framework',
        status: 'implemented',
        confidence: 0.9,
        evidence: apiEvidence
      });
    }

    // Check for GraphQL
    if (structure.dependencies.some(dep => dep.includes('graphql'))) {
      const graphqlEvidence = ['GraphQL dependency found'];
      if (structure.dependencies.includes('apollo-server')) graphqlEvidence.push('Apollo Server');
      if (structure.dependencies.includes('@apollo/client')) graphqlEvidence.push('Apollo Client');
      
      features.push({
        id: 'graphql-api',
        name: 'GraphQL API',
        description: 'GraphQL-based API with flexible query capabilities',
        status: 'implemented',
        confidence: 0.85,
        evidence: graphqlEvidence
      });
    }

    // Check for REST API patterns
    const hasApiRoutes = fs.existsSync(path.join(projectPath, 'src', 'routes')) ||
                        fs.existsSync(path.join(projectPath, 'routes')) ||
                        fs.existsSync(path.join(projectPath, 'api'));
    
    if (hasApiRoutes && apiEvidence.length === 0) { // Only if Express wasn't detected
      features.push({
        id: 'rest-api',
        name: 'REST API',
        description: 'RESTful API with organized route structure',
        status: 'implemented',
        confidence: 0.7,
        evidence: ['API route structure detected']
      });
    }
  }

  private async detectDatabaseFeatures(projectPath: string, structure: ProjectStructure, features: any[]): Promise<void> {
    const dbDeps = structure.dependencies.filter(dep => 
      ['mongoose', 'sequelize', 'typeorm', 'knex', 'prisma', 'pg', 'mysql2', 'sqlite3', 'mongodb'].includes(dep)
    );

    if (dbDeps.length > 0) {
      const dbEvidence = dbDeps.map(dep => `${dep} database library`);
      
      // Check for specific database types
      let dbType = 'Database';
      if (dbDeps.some(dep => ['mongoose', 'mongodb'].includes(dep))) dbType = 'MongoDB';
      else if (dbDeps.some(dep => ['pg', 'postgresql'].includes(dep))) dbType = 'PostgreSQL';
      else if (dbDeps.some(dep => ['mysql2', 'mysql'].includes(dep))) dbType = 'MySQL';
      else if (dbDeps.includes('sqlite3')) dbType = 'SQLite';

      // Check for migrations
      const hasMigrations = fs.existsSync(path.join(projectPath, 'migrations')) ||
                          fs.existsSync(path.join(projectPath, 'src', 'migrations')) ||
                          fs.existsSync(path.join(projectPath, 'prisma', 'migrations'));
      
      if (hasMigrations) dbEvidence.push('Database migrations detected');

      features.push({
        id: 'database-integration',
        name: `${dbType} Integration`,
        description: `${dbType} database integration with ORM/ODM`,
        status: 'implemented',
        confidence: 0.9,
        evidence: dbEvidence
      });
    }
  }

  private async detectTestingFeatures(projectPath: string, structure: ProjectStructure, features: any[]): Promise<void> {
    const testingDeps = structure.dependencies.filter(dep => 
      ['jest', 'mocha', 'chai', 'vitest', 'cypress', 'playwright', 'testing-library', '@testing-library/react'].includes(dep)
    );

    if (testingDeps.length > 0) {
      const testEvidence = testingDeps.map(dep => `${dep} testing framework`);
      
      // Check for test directories
      const hasTestDir = fs.existsSync(path.join(projectPath, 'test')) ||
                        fs.existsSync(path.join(projectPath, 'tests')) ||
                        fs.existsSync(path.join(projectPath, '__tests__')) ||
                        fs.existsSync(path.join(projectPath, 'src', 'test'));
      
      if (hasTestDir) testEvidence.push('Test directory structure');

      let testType = 'Unit Testing';
      if (testingDeps.some(dep => ['cypress', 'playwright'].includes(dep))) {
        testType = 'End-to-End Testing';
      } else if (testingDeps.includes('@testing-library/react')) {
        testType = 'Component Testing';
      }

      features.push({
        id: 'testing-suite',
        name: testType,
        description: `Comprehensive testing setup with ${testingDeps.join(', ')}`,
        status: 'implemented',
        confidence: 0.85,
        evidence: testEvidence
      });
    }
  }

  private async detectBuildDeploymentFeatures(projectPath: string, structure: ProjectStructure, features: any[]): Promise<void> {
    // Check for build tools
    const buildDeps = structure.dependencies.filter(dep => 
      ['webpack', 'vite', 'rollup', 'parcel', 'esbuild', 'turbo'].includes(dep)
    );

    if (buildDeps.length > 0) {
      features.push({
        id: 'modern-build',
        name: 'Modern Build System',
        description: `Optimized build pipeline using ${buildDeps.join(', ')}`,
        status: 'implemented',
        confidence: 0.9,
        evidence: buildDeps.map(dep => `${dep} build tool`)
      });
    }

    // Check for Docker
    const hasDockerfile = fs.existsSync(path.join(projectPath, 'Dockerfile')) ||
                         fs.existsSync(path.join(projectPath, 'docker-compose.yml'));
    
    if (hasDockerfile) {
      features.push({
        id: 'containerization',
        name: 'Docker Containerization',
        description: 'Application containerized with Docker for consistent deployments',
        status: 'implemented',
        confidence: 0.95,
        evidence: ['Docker configuration files detected']
      });
    }

    // Check for CI/CD
    const hasCICD = fs.existsSync(path.join(projectPath, '.github', 'workflows')) ||
                   fs.existsSync(path.join(projectPath, '.gitlab-ci.yml')) ||
                   fs.existsSync(path.join(projectPath, 'azure-pipelines.yml'));
    
    if (hasCICD) {
      features.push({
        id: 'cicd-pipeline',
        name: 'CI/CD Pipeline',
        description: 'Automated continuous integration and deployment pipeline',
        status: 'implemented',
        confidence: 0.9,
        evidence: ['CI/CD configuration detected']
      });
    }
  }

  private async detectAuthSecurityFeatures(projectPath: string, structure: ProjectStructure, features: any[]): Promise<void> {
    const authDeps = structure.dependencies.filter(dep => 
      ['passport', 'jsonwebtoken', 'bcrypt', 'bcryptjs', 'auth0', 'firebase-auth', 'next-auth'].includes(dep)
    );

    if (authDeps.length > 0) {
      features.push({
        id: 'authentication',
        name: 'User Authentication',
        description: `User authentication system using ${authDeps.join(', ')}`,
        status: 'implemented',
        confidence: 0.9,
        evidence: authDeps.map(dep => `${dep} authentication library`)
      });
    }

    // Security features
    const securityDeps = structure.dependencies.filter(dep => 
      ['helmet', 'cors', 'express-rate-limit', 'csurf', 'hpp'].includes(dep)
    );

    if (securityDeps.length > 0) {
      features.push({
        id: 'security-middleware',
        name: 'Security Middleware',
        description: 'Security-hardened application with protection middleware',
        status: 'implemented',
        confidence: 0.8,
        evidence: securityDeps.map(dep => `${dep} security middleware`)
      });
    }
  }

  private async detectDevelopmentToolsFeatures(projectPath: string, structure: ProjectStructure, features: any[]): Promise<void> {
    // Linting
    const lintingDeps = structure.dependencies.filter(dep => 
      ['eslint', 'prettier', 'stylelint', 'tslint'].includes(dep)
    );

    if (lintingDeps.length > 0) {
      features.push({
        id: 'code-quality',
        name: 'Code Quality Tools',
        description: `Code linting and formatting with ${lintingDeps.join(', ')}`,
        status: 'implemented',
        confidence: 0.85,
        evidence: lintingDeps.map(dep => `${dep} code quality tool`)
      });
    }

    // TypeScript
    if (structure.dependencies.includes('typescript') || fs.existsSync(path.join(projectPath, 'tsconfig.json'))) {
      features.push({
        id: 'typescript',
        name: 'TypeScript Integration',
        description: 'Type-safe development with TypeScript',
        status: 'implemented',
        confidence: 0.95,
        evidence: ['TypeScript configuration detected']
      });
    }

    // Hot reloading
    const hasHotReload = structure.dependencies.some(dep => 
      ['webpack-dev-server', 'vite', 'next'].includes(dep)
    );

    if (hasHotReload) {
      features.push({
        id: 'hot-reload',
        name: 'Hot Module Replacement',
        description: 'Development server with hot reloading for faster iteration',
        status: 'implemented',
        confidence: 0.8,
        evidence: ['Hot reloading development server']
      });
    }
  }

  private async detectUIUXFeatures(projectPath: string, structure: ProjectStructure, features: any[]): Promise<void> {
    // UI Libraries
    const uiDeps = structure.dependencies.filter(dep => 
      ['material-ui', '@mui/material', 'antd', 'react-bootstrap', 'semantic-ui-react', 'chakra-ui', 'mantine'].includes(dep)
    );

    if (uiDeps.length > 0) {
      features.push({
        id: 'ui-component-library',
        name: 'UI Component Library',
        description: `Professional UI components using ${uiDeps.join(', ')}`,
        status: 'implemented',
        confidence: 0.9,
        evidence: uiDeps.map(dep => `${dep} UI library`)
      });
    }

    // Styling solutions
    const stylingDeps = structure.dependencies.filter(dep => 
      ['styled-components', 'emotion', 'tailwindcss', 'sass', 'less'].includes(dep)
    );

    if (stylingDeps.length > 0) {
      features.push({
        id: 'advanced-styling',
        name: 'Advanced Styling System',
        description: `Modern CSS architecture with ${stylingDeps.join(', ')}`,
        status: 'implemented',
        confidence: 0.85,
        evidence: stylingDeps.map(dep => `${dep} styling solution`)
      });
    }

    // Animation libraries
    const animationDeps = structure.dependencies.filter(dep => 
      ['framer-motion', 'react-spring', 'lottie-react', 'gsap'].includes(dep)
    );

    if (animationDeps.length > 0) {
      features.push({
        id: 'animations',
        name: 'Interactive Animations',
        description: `Rich animations and interactions using ${animationDeps.join(', ')}`,
        status: 'implemented',
        confidence: 0.8,
        evidence: animationDeps.map(dep => `${dep} animation library`)
      });
    }
  }

  private generateProjectSummary(structure: ProjectStructure): string {
    const languageList = Object.entries(structure.languages)
      .sort(([,a], [,b]) => b - a)
      .map(([lang, count]) => `${lang} (${count} files)`)
      .join(', ');

    const frameworkList = structure.frameworks.join(', ');
    
    return `Project with ${structure.totalFiles} files. Languages: ${languageList || 'none detected'}. ${
      frameworkList ? `Frameworks: ${frameworkList}.` : ''
    } ${structure.entryPoints.length} entry points, ${structure.configFiles.length} config files.`;
  }

  private generateFileTags(analysis: FileAnalysis): string[] {
    const tags = ['file', 'code'];
    
    tags.push(`lang:${analysis.language}`);
    
    const ext = path.extname(analysis.filePath);
    if (ext) {
      tags.push(`ext:${ext.substring(1)}`);
    }
    
    if (analysis.functions.length > 0) {
      tags.push('functions');
    }
    
    if (analysis.classes.length > 0) {
      tags.push('classes');
    }
    
    if (analysis.complexity > 10) {
      tags.push('complex');
    }
    
    // Add function and class names as tags
    analysis.functions.forEach(func => tags.push(`func:${func}`));
    analysis.classes.forEach(cls => tags.push(`class:${cls}`));
    
    return tags;
  }

  private generateFileId(filePath: string): string {
    return Buffer.from(filePath).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 12);
  }

  /**
   * Check if a dot file is important enough to include in indexing
   */
  private isImportantDotFile(fileName: string): boolean {
    const importantDotFiles = [
      '.gitignore', '.gitattributes', '.editorconfig', '.env.example',
      '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintignore',
      '.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierignore',
      '.babelrc', '.babelrc.js', '.babelrc.json',
      '.dockerignore', '.dockerfile',
      '.nvmrc', '.node-version',
      '.python-version', '.ruby-version',
      '.env.template', '.env.sample'
    ];
    
    return importantDotFiles.includes(fileName) || fileName.endsWith('rc.js') || fileName.endsWith('rc.json');
  }

  /**
   * Check if a file is generated or a lock file that should be excluded
   */
  private isGeneratedOrLockFile(fileName: string): boolean {
    const patterns = [
      'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
      'poetry.lock', 'pipfile.lock', 'pdm.lock',
      'cargo.lock', 'go.sum',
      'composer.lock', 'mix.lock',
      'pubspec.lock', 'flutter.lock',
      'gradle.lockfile', 'gradlew', 'gradlew.bat',
      'mvnw', 'mvnw.cmd',
      '*.min.js', '*.min.css', '*.bundle.js',
      '*.d.ts.map', '*.js.map', '*.css.map',
      'thumbs.db', 'desktop.ini', '.ds_store'
    ];
    
    return patterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return regex.test(fileName);
      }
      return fileName === pattern;
    });
  }

  /**
   * Check if a file path contains ignored directory patterns
   */
  private isInIgnoredDirectory(relativePath: string): boolean {
    const ignoredDirPatterns = [
      'node_modules', 'venv', 'env', '.venv', 'target', 'build', 'dist', 'out',
      '.next', '.nuxt', 'vendor', 'pods', 'site-packages', '__pycache__',
      'bin', 'obj', '.gradle', 'gradle', 'cmake-build', 'deriveddata',
      '.dart_tool', 'packages', '.pub-cache', 'coverage', 'logs',
      '.cache', '.tmp', 'temp', '.git', '.svn', '.hg',
      // Additional nested patterns
      'test_output', 'test-output', 'test_results', 'test-results',
      'artifacts', 'reports', 'documentation/generated',
      'docs/generated', 'api-docs', 'typedocs'
    ];
    
    const pathSegments = relativePath.split(path.sep).map(seg => seg.toLowerCase());
    
    return pathSegments.some(segment => 
      ignoredDirPatterns.includes(segment) ||
      segment.startsWith('.') && segment.length > 4 // Long hidden directories
    );
  }
}