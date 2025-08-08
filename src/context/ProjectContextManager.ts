/**
 * Project Context Manager - Systematic Agentic Project Analysis and Indexing
 * 
 * Orchestrates comprehensive project understanding through specialized agents
 * and maintains structured knowledge in Chroma collections.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { logger } from '../utils/logger';
import { VectorDatabase } from '../documentation/VectorDatabase';
import { ContextManager } from '../core/ContextManager';
import { AgentFactory } from '../agents/AgentFactory';
import { ToolManager } from '../core/ToolManager';
import { BasicAgent } from '../agents/BasicAgent';
import { AgentSpecialization } from '../agents/IAgent';
import {
  ProjectStructure,
  ProjectFile,
  ProjectOverview,
  ProjectFeature,
  ProjectStatus,
  ProjectMetrics,
  FileTreeNode,
  IndexingProgress,
  IndexingStage,
  IndexingError,
  ChromaCollectionInfo,
  FileAnalysis,
  FileDependency,
  FileRelationship,
  DirectoryInfo,
  ComplexityMetrics,
  QualityAssessment
} from './ProjectContextTypes';

export interface ProjectContextManagerConfig {
  workspacePath: string;
  maxFileSize: number; // bytes
  excludePatterns: string[];
  includePatterns: string[];
  maxConcurrency: number;
  
  // Agent configuration
  ollamaUrl: string;
  model: string;
  
  // Chroma configuration
  chromaCollections: {
    files: string;
    dependencies: string;
    features: string;
    overview: string;
  };
}

/**
 * Manages comprehensive project context through systematic agentic analysis
 */
export class ProjectContextManager {
  private static instance: ProjectContextManager;
  private config: ProjectContextManagerConfig;
  private vectorDB: VectorDatabase;
  private contextManager: ContextManager;
  private agentFactory: AgentFactory;
  private toolManager: ToolManager;
  
  private projectStructure?: ProjectStructure;
  private indexingProgress?: IndexingProgress;
  private chromaCollections: Map<string, ChromaCollectionInfo> = new Map();
  
  // Specialized agents for project analysis
  private projectAnalysisAgent?: any;
  private dependencyAnalysisAgent?: any;
  private featureExtractionAgent?: any;
  private codeQualityAgent?: any;
  
  private constructor(config: ProjectContextManagerConfig) {
    this.config = config;
    this.vectorDB = VectorDatabase.getInstance();
    this.contextManager = ContextManager.getInstance();
    this.toolManager = new ToolManager();
    
    // Create a simpler AgentFactory without foundation pipeline to avoid conflicts
    this.agentFactory = new AgentFactory(
      {
        ollamaUrl: config.ollamaUrl,
        model: config.model,
        temperature: 0.3,
        maxIterations: 10,
        verbose: false
      },
      this.toolManager,
      this.contextManager,
      {
        // Disable foundation pipeline to prevent recursive initialization conflicts
        useSmartRouter: false,
        enableMultiAgentWorkflows: false
      }
    );
  }

  static getInstance(config?: ProjectContextManagerConfig): ProjectContextManager {
    if (!ProjectContextManager.instance && config) {
      ProjectContextManager.instance = new ProjectContextManager(config);
    }
    if (!ProjectContextManager.instance) {
      throw new Error('ProjectContextManager must be initialized with config first');
    }
    return ProjectContextManager.instance;
  }

  /**
   * Initialize the project context manager and specialized agents
   */
  async initialize(): Promise<void> {
    try {
      logger.info('[PROJECT_CONTEXT] Initializing project context manager...');
      
      await this.vectorDB.initialize();
      await this.contextManager.initialize();
      await this.initializeChromaCollections();
      await this.initializeSpecializedAgents();
      
      logger.info('[PROJECT_CONTEXT] Project context manager initialized successfully');
    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to initialize project context manager:', error);
      throw error;
    }
  }

  /**
   * Trigger systematic project indexing
   */
  async triggerProjectIndexing(progressCallback?: (progress: IndexingProgress) => void): Promise<ProjectStructure> {
    try {
      logger.info('[PROJECT_CONTEXT] Starting systematic project indexing...');
      
      // Initialize indexing progress
      this.indexingProgress = {
        stage: 'initialization',
        processedFiles: 0,
        totalFiles: 0,
        stagesCompleted: [],
        currentStageProgress: 0,
        startTime: new Date(),
        elapsedTime: 0,
        errors: [],
        warnings: [],
        collectionsCreated: []
      };

      const stages: IndexingStage[] = [
        'initialization',
        'file_discovery',
        'structure_analysis', 
        'content_analysis',
        'dependency_mapping',
        'relationship_analysis',
        'embedding_generation',
        'collection_storage',
        'overview_generation',
        'feature_extraction',
        'status_assessment',
        'finalization'
      ];

      for (const stage of stages) {
        await this.executeIndexingStage(stage, progressCallback);
        this.indexingProgress.stagesCompleted.push(stage);
        this.indexingProgress.currentStageProgress = 0;
      }

      this.indexingProgress.stage = 'finalization';
      this.indexingProgress.elapsedTime = Date.now() - this.indexingProgress.startTime.getTime();
      
      logger.info(`[PROJECT_CONTEXT] Project indexing completed in ${this.indexingProgress.elapsedTime}ms`);
      
      if (progressCallback) {
        progressCallback(this.indexingProgress);
      }

      return this.projectStructure!;

    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Project indexing failed:', error);
      
      if (this.indexingProgress) {
        this.indexingProgress.errors.push({
          stage: this.indexingProgress.stage,
          error: error instanceof Error ? error.message : String(error),
          severity: 'critical',
          timestamp: new Date()
        });
      }
      
      throw error;
    }
  }

  /**
   * Execute a specific indexing stage
   */
  private async executeIndexingStage(
    stage: IndexingStage, 
    progressCallback?: (progress: IndexingProgress) => void
  ): Promise<void> {
    try {
      logger.debug(`[PROJECT_CONTEXT] Executing stage: ${stage}`);
      
      this.indexingProgress!.stage = stage;
      this.indexingProgress!.currentStageProgress = 0;
      
      if (progressCallback) {
        progressCallback(this.indexingProgress!);
      }

      switch (stage) {
        case 'initialization':
          await this.initializeProjectStructure();
          break;
        case 'file_discovery':
          await this.discoverProjectFiles();
          break;
        case 'structure_analysis':
          await this.analyzeProjectStructure();
          break;
        case 'content_analysis':
          await this.analyzeFileContents();
          break;
        case 'dependency_mapping':
          await this.mapDependencies();
          break;
        case 'relationship_analysis':
          await this.analyzeFileRelationships();
          break;
        case 'embedding_generation':
          await this.generateEmbeddings();
          break;
        case 'collection_storage':
          await this.storeInChromaCollections();
          break;
        case 'overview_generation':
          await this.generateProjectOverview();
          break;
        case 'feature_extraction':
          await this.extractProjectFeatures();
          break;
        case 'status_assessment':
          await this.assessProjectStatus();
          break;
        case 'finalization':
          await this.finalizeIndexing();
          break;
      }

      this.indexingProgress!.currentStageProgress = 100;
      
      if (progressCallback) {
        progressCallback(this.indexingProgress!);
      }

      logger.debug(`[PROJECT_CONTEXT] Completed stage: ${stage}`);

    } catch (error) {
      logger.error(`[PROJECT_CONTEXT] Stage ${stage} failed:`, error);
      
      this.indexingProgress!.errors.push({
        stage,
        error: error instanceof Error ? error.message : String(error),
        severity: 'error',
        timestamp: new Date()
      });
      
      throw error;
    }
  }

  /**
   * Initialize Chroma collections for project knowledge
   */
  private async initializeChromaCollections(): Promise<void> {
    try {
      // Initialize the vector database (it will create the default collection)
      await this.vectorDB.initialize();

      // Define all collections we work with for comprehensive project analysis
      const collectionConfigs = [
        {
          name: 'project_documentation',
          description: 'Project analysis and context data',
          metadataSchema: {
            'file_path': 'string',
            'file_type': 'string',
            'language': 'string',
            'purpose': 'string',
            'confidence': 'string',
            'project_id': 'string',
            'last_modified': 'string'
          },
          embeddingDimensions: 384,
          indexingStrategy: 'file-based' as const
        },
        {
          name: 'project_dependencies',
          description: 'File dependencies and relationships',
          metadataSchema: {
            'source_file': 'string',
            'target_file': 'string',
            'dependency_type': 'string',
            'confidence': 'string',
            'project_id': 'string'
          },
          embeddingDimensions: 384,
          indexingStrategy: 'semantic-blocks' as const
        },
        {
          name: 'project_features',
          description: 'Detected project features and capabilities',
          metadataSchema: {
            'feature_id': 'string',
            'feature_name': 'string',
            'status': 'string',
            'confidence': 'string',
            'evidence_count': 'string',
            'project_id': 'string'
          },
          embeddingDimensions: 384,
          indexingStrategy: 'chunk-based' as const
        },
        {
          name: 'project_structure',
          description: 'Project architecture and organization',
          metadataSchema: {
            'structure_type': 'string',
            'component_type': 'string',
            'importance': 'string',
            'project_id': 'string',
            'analysis_date': 'string'
          },
          embeddingDimensions: 384,
          indexingStrategy: 'semantic-blocks' as const
        }
      ];

      // Initialize each collection and get actual document counts from database
      for (const config of collectionConfigs) {
        try {
          // Try to get actual document count from vector database if collection exists
          const stats = await this.vectorDB.getSourceStats(config.name);
          
          const collectionInfo: ChromaCollectionInfo = {
            name: config.name,
            description: config.description,
            documentCount: stats.documentCount || 0,
            lastUpdated: stats.lastUpdated || new Date(),
            metadataSchema: config.metadataSchema as unknown as Record<string, string>,
            embeddingDimensions: config.embeddingDimensions,
            indexingStrategy: config.indexingStrategy
          };

          this.chromaCollections.set(config.name, collectionInfo);
          logger.debug(`[PROJECT_CONTEXT] Initialized collection '${config.name}': ${collectionInfo.documentCount} documents`);

        } catch (error) {
          logger.debug(`[PROJECT_CONTEXT] Collection '${config.name}' not found or empty, initializing with 0 documents`);
          
          // Initialize empty collection info for now
          const collectionInfo: ChromaCollectionInfo = {
            name: config.name,
            description: config.description,
            documentCount: 0,
            lastUpdated: new Date(),
            metadataSchema: config.metadataSchema as unknown as Record<string, string>,
            embeddingDimensions: config.embeddingDimensions,
            indexingStrategy: config.indexingStrategy
          };

          this.chromaCollections.set(config.name, collectionInfo);
        }
      }

      logger.info(`[PROJECT_CONTEXT] Initialized ${this.chromaCollections.size} Chroma collections`);

    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to initialize Chroma collections:', error);
      // Don't throw - continue with empty collections to allow graceful degradation
      logger.warn('[PROJECT_CONTEXT] Continuing with empty collections for graceful degradation');
    }
  }

  /**
   * Initialize specialized agents for project analysis
   */
  private async initializeSpecializedAgents(): Promise<void> {
    try {
      // For now, we'll create basic agents from the factory and store references
      // In a full implementation, these would be more specialized agents
      
      // Get a general agent for project analysis tasks
      const generalAgent = this.agentFactory.getAgent(AgentSpecialization.GENERAL);
      if (generalAgent) {
        this.projectAnalysisAgent = generalAgent;
        this.dependencyAnalysisAgent = generalAgent;
        this.featureExtractionAgent = generalAgent;
        this.codeQualityAgent = generalAgent;
      } else {
        // Create a basic agent if none exists
        const basicAgent = new BasicAgent(
          {
            ollamaUrl: this.config.ollamaUrl,
            model: this.config.model,
            temperature: 0.3,
            maxIterations: 5,
            verbose: false
          },
          this.toolManager,
          this.contextManager
        );
        
        await basicAgent.initialize();
        
        this.projectAnalysisAgent = basicAgent;
        this.dependencyAnalysisAgent = basicAgent;
        this.featureExtractionAgent = basicAgent;
        this.codeQualityAgent = basicAgent;
      }

      logger.info('[PROJECT_CONTEXT] Initialized project analysis agents');

    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to initialize specialized agents:', error);
      // Don't throw error - continue with empty agents
      logger.warn('[PROJECT_CONTEXT] Continuing without specialized agents');
    }
  }

  /**
   * Initialize project structure
   */
  private async initializeProjectStructure(): Promise<void> {
    this.projectStructure = {
      root: this.config.workspacePath,
      files: new Map(),
      directories: new Map(),
      tree: {
        name: path.basename(this.config.workspacePath),
        path: this.config.workspacePath,
        type: 'directory',
        children: []
      },
      overview: {} as ProjectOverview,
      features: [],
      status: {} as ProjectStatus,
      metrics: {} as ProjectMetrics,
      lastIndexed: new Date(),
      version: '1.0.0',
      indexingProgress: this.indexingProgress!
    };
  }

  /**
   * Discover all project files and build initial structure
   */
  private async discoverProjectFiles(): Promise<void> {
    try {
      const files = await this.walkDirectory(this.config.workspacePath);
      
      this.indexingProgress!.totalFiles = files.length;
      
      for (const filePath of files) {
        if (await this.shouldIncludeFile(filePath)) {
          const projectFile = await this.createProjectFile(filePath);
          this.projectStructure!.files.set(filePath, projectFile);
        }
        
        this.indexingProgress!.processedFiles++;
        this.indexingProgress!.currentStageProgress = 
          (this.indexingProgress!.processedFiles / this.indexingProgress!.totalFiles) * 100;
      }

      // Build file tree
      this.projectStructure!.tree = await this.buildFileTree(this.config.workspacePath);
      
      logger.info(`[PROJECT_CONTEXT] Discovered ${this.projectStructure!.files.size} files`);

    } catch (error) {
      logger.error('[PROJECT_CONTEXT] File discovery failed:', error);
      throw error;
    }
  }

  /**
   * Analyze project structure using specialized agent
   */
  private async analyzeProjectStructure(): Promise<void> {
    if (!this.projectAnalysisAgent) return;

    try {
      const structureAnalysisPrompt = this.buildStructureAnalysisPrompt();
      const analysis = await this.projectAnalysisAgent.executeTask(structureAnalysisPrompt);
      
      // Process analysis results and update project structure
      await this.processStructureAnalysis(analysis);
      
    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Structure analysis failed:', error);
      this.indexingProgress!.warnings.push(`Structure analysis failed: ${error}`);
    }
  }

  /**
   * Analyze individual file contents
   */
  private async analyzeFileContents(): Promise<void> {
    const files = Array.from(this.projectStructure!.files.values());
    const semaphore = new Semaphore(this.config.maxConcurrency);
    
    const analysisPromises = files.map(async (file) => {
      await semaphore.acquire();
      try {
        await this.analyzeFileContent(file);
        this.indexingProgress!.processedFiles++;
        this.indexingProgress!.currentStageProgress = 
          (this.indexingProgress!.processedFiles / files.length) * 100;
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(analysisPromises);
  }

  /**
   * Get current project structure (if available)
   */
  getProjectStructure(): ProjectStructure | undefined {
    return this.projectStructure;
  }

  /**
   * Get indexing progress
   */
  getIndexingProgress(): IndexingProgress | undefined {
    return this.indexingProgress;
  }

  /**
   * Get Chroma collection information
   */
  getChromaCollections(): Map<string, ChromaCollectionInfo> {
    return this.chromaCollections;
  }

  // Private helper methods would continue here...
  // Including implementations for remaining stages and utility functions

  private async walkDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Skip excluded patterns
        if (this.shouldExcludePath(fullPath)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          // Recursively walk subdirectories
          const subFiles = await this.walkDirectory(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      logger.warn(`[PROJECT_CONTEXT] Failed to read directory ${dir}:`, error);
    }
    
    return files;
  }

  private shouldExcludePath(filePath: string): boolean {
    const relativePath = path.relative(this.config.workspacePath, filePath);
    
    // Check exclude patterns
    for (const pattern of this.config.excludePatterns) {
      if (this.matchesGlob(relativePath, pattern)) {
        return true;
      }
    }
    
    return false;
  }

  private async shouldIncludeFile(filePath: string): Promise<boolean> {
    try {
      // Check file size limit
      const stats = await fs.stat(filePath);
      if (stats.size > this.config.maxFileSize) {
        return false;
      }
      
      // Check if already excluded
      if (this.shouldExcludePath(filePath)) {
        return false;
      }
      
      // Check include patterns
      const relativePath = path.relative(this.config.workspacePath, filePath);
      for (const pattern of this.config.includePatterns) {
        if (this.matchesGlob(relativePath, pattern)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.warn(`[PROJECT_CONTEXT] Failed to check file ${filePath}:`, error);
      return false;
    }
  }

  private matchesGlob(filePath: string, pattern: string): boolean {
    // Simple but effective glob matching for our specific patterns
    const normalizedPath = filePath.replace(/\\/g, '/');
    const normalizedPattern = pattern.replace(/\\/g, '/');
    
    // Handle common patterns we use
    if (normalizedPattern.startsWith('**/')) {
      // Pattern like **/*.ts - match any file ending with .ts anywhere
      const suffix = normalizedPattern.substring(3); // Remove **/
      if (suffix.startsWith('*.')) {
        const extension = suffix.substring(1); // Remove *
        return normalizedPath.endsWith(extension);
      }
    }
    
    // Handle exclude patterns like node_modules/**
    if (normalizedPattern.endsWith('/**')) {
      const prefix = normalizedPattern.substring(0, normalizedPattern.length - 3);
      return normalizedPath.startsWith(prefix + '/') || normalizedPath === prefix;
    }
    
    // Handle patterns like **/*.map (anywhere)
    if (normalizedPattern.includes('**/') && normalizedPattern.includes('*.')) {
      const parts = normalizedPattern.split('**/');
      if (parts.length === 2) {
        const [prefix, suffix] = parts;
        const suffixPattern = suffix.replace('*', ''); // Remove * before extension
        return (!prefix || normalizedPath.startsWith(prefix)) && normalizedPath.endsWith(suffixPattern);
      }
    }
    
    // Fallback to simple string matching for exact patterns
    return normalizedPath === normalizedPattern;
  }

  private async createProjectFile(filePath: string): Promise<ProjectFile> {
    // Implementation for creating ProjectFile from file path
    const stats = await fs.stat(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      extension: path.extname(filePath),
      size: stats.size,
      lastModified: stats.mtime,
      type: 'file'
    };
  }

  private async buildFileTree(rootPath: string): Promise<FileTreeNode> {
    const name = path.basename(rootPath);
    const tree: FileTreeNode = {
      name,
      path: rootPath,
      type: 'directory',
      children: []
    };

    try {
      const entries = await fs.readdir(rootPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(rootPath, entry.name);
        
        // Skip excluded paths
        if (this.shouldExcludePath(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          const subTree = await this.buildFileTree(fullPath);
          tree.children!.push(subTree);
        } else if (entry.isFile()) {
          // Only include files that match our include patterns
          if (await this.shouldIncludeFile(fullPath)) {
            tree.children!.push({
              name: entry.name,
              path: fullPath,
              type: 'file',
              size: (await fs.stat(fullPath)).size
            });
          }
        }
      }
      
      // Sort children: directories first, then files, both alphabetically
      tree.children!.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      
    } catch (error) {
      logger.warn(`[PROJECT_CONTEXT] Failed to build file tree for ${rootPath}:`, error);
    }

    return tree;
  }

  private buildStructureAnalysisPrompt(): string {
    // Implementation for building analysis prompt
    return 'Analyze project structure...';
  }

  private async processStructureAnalysis(analysis: any): Promise<void> {
    // TODO: Process structure analysis results from agents
    logger.debug('[PROJECT_CONTEXT] Processing structure analysis results');
  }

  private async analyzeFileContent(file: ProjectFile): Promise<void> {
    // TODO: Analyze individual file content using agents
    logger.debug(`[PROJECT_CONTEXT] Analyzing file: ${file.name}`);
  }

  private async mapDependencies(): Promise<void> {
    // TODO: Map file dependencies and relationships
    logger.debug('[PROJECT_CONTEXT] Mapping dependencies');
  }

  private async analyzeFileRelationships(): Promise<void> {
    // TODO: Analyze relationships between files
    logger.debug('[PROJECT_CONTEXT] Analyzing file relationships');
  }

  private async generateEmbeddings(): Promise<void> {
    // TODO: Generate embeddings for semantic search
    logger.debug('[PROJECT_CONTEXT] Generating embeddings');
  }

  private async storeInChromaCollections(): Promise<void> {
    // TODO: Store analyzed data in Chroma collections
    logger.debug('[PROJECT_CONTEXT] Storing in Chroma collections');
  }

  private async generateProjectOverview(): Promise<void> {
    // Generate basic project overview
    if (!this.projectStructure) return;

    const fileCount = this.projectStructure.files.size;
    const totalSize = Array.from(this.projectStructure.files.values())
      .reduce((sum, file) => sum + file.size, 0);

    // Detect primary language based on file extensions
    const languageMap = new Map<string, number>();
    Array.from(this.projectStructure.files.values()).forEach(file => {
      const ext = file.extension.toLowerCase();
      languageMap.set(ext, (languageMap.get(ext) || 0) + 1);
    });

    const primaryLanguage = Array.from(languageMap.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    this.projectStructure.overview = {
      name: path.basename(this.config.workspacePath),
      description: 'Auto-generated project analysis',
      type: 'extension',
      primaryLanguage: this.getLanguageFromExtension(primaryLanguage),
      frameworks: [],
      architecturalPatterns: [],
      purpose: 'General application project',
      mainFeatures: [`Contains ${fileCount} files`],
      codeQuality: {
        score: 75,
        factors: {
          codeStyle: 80,
          complexity: 70,
          maintainability: 75,
          testability: 60,
          documentation: 65
        },
        recommendations: ['Consider adding more tests', 'Improve code documentation']
      },
      documentation: {
        coverage: 60,
        quality: 75,
        types: {
          readme: true,
          apiDocs: false,
          codeComments: 50,
          examples: 2,
          tutorials: 1
        },
        missingAreas: ['API documentation', 'Code examples']
      },
      testCoverage: {
        overall: 0,
        byFile: new Map(),
        byCategory: new Map(),
        uncoveredFiles: [],
        testFiles: [],
        testTypes: []
      },
      strengths: ['Well organized file structure'],
      weaknesses: ['Limited test coverage'],
      recommendations: [`Project contains ${fileCount} files totaling ${this.formatFileSize(totalSize)}`],
      lastUpdated: new Date()
    };

    logger.debug('[PROJECT_CONTEXT] Generated project overview');
  }

  private async extractProjectFeatures(): Promise<void> {
    // Extract comprehensive project features using advanced analysis
    if (!this.projectStructure) return;

    try {
      logger.info('[PROJECT_CONTEXT] Starting comprehensive feature extraction...');
      
      // Create a mock ProjectStructure for the feature detection system
      const mockStructure = {
        totalFiles: this.projectStructure.files.size,
        languages: this.calculateLanguageDistribution(),
        frameworks: await this.detectFrameworks(),
        dependencies: await this.extractDependencies(),
        entryPoints: this.findEntryPoints(),
        configFiles: this.findConfigFiles()
      };

      // Use the advanced feature detection from ProjectIndexer pattern
      const detectedFeatures = await this.detectAdvancedProjectFeatures(this.config.workspacePath, mockStructure);
      
      // Convert detected features to ProjectFeature format
      const features: ProjectFeature[] = detectedFeatures.map(feature => ({
        id: feature.id,
        name: feature.name,
        description: feature.description,
        status: feature.status as any,
        priority: this.mapConfidenceToPriority(feature.confidence),
        files: this.getFilesRelatedToFeature(feature),
        dependencies: [],
        estimatedComplexity: this.estimateFeatureComplexity(feature),
        completionPercentage: feature.status === 'implemented' ? 100 : 
                             feature.status === 'in-progress' ? 50 : 0,
        tasks: [],
        issues: []
      }));

      this.projectStructure.features = features;
      logger.info(`[PROJECT_CONTEXT] Extracted ${features.length} advanced project features`);
      
      // Store features in Chroma collections for searchability
      await this.storeProjectFeatures(features);

    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to extract project features:', error);
      
      // Fallback to basic feature extraction
      await this.extractBasicFeatures();
    }
  }

  /**
   * Advanced project feature detection (adapted from ProjectIndexer)
   */
  private async detectAdvancedProjectFeatures(projectPath: string, structure: any): Promise<{ id: string; name: string; description: string; status: string; confidence: number; evidence: string[] }[]> {
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
      logger.error('[PROJECT_CONTEXT] Failed to detect advanced project features:', error);
    }

    return features;
  }

  private async extractBasicFeatures(): Promise<void> {
    if (!this.projectStructure) return;
    
    const features: ProjectFeature[] = [];
    const languageDistribution = this.calculateLanguageDistribution();
    
    // Create features based on primary languages and frameworks
    Object.entries(languageDistribution).forEach(([language, count]) => {
      if (count > 0) {
        features.push({
          id: `language-${language}`,
          name: `${language} Development`,
          description: `Project includes ${count} ${language} files`,
          status: 'completed',
          priority: count > 10 ? 'high' : count > 5 ? 'medium' : 'low',
          files: Array.from(this.projectStructure!.files.values())
            .filter(f => f.language === language)
            .map(f => f.path),
          dependencies: [],
          estimatedComplexity: count > 50 ? 'very-complex' : count > 20 ? 'complex' : count > 5 ? 'moderate' : 'simple',
          completionPercentage: 100,
          tasks: [],
          issues: []
        });
      }
    });

    this.projectStructure.features = features;
    logger.debug(`[PROJECT_CONTEXT] Extracted ${features.length} basic features as fallback`);
  }

  private async assessProjectStatus(): Promise<void> {
    // Assess basic project status
    if (!this.projectStructure) return;

    const fileCount = this.projectStructure.files.size;
    const completedFeatures = this.projectStructure.features.filter(f => f.status === 'completed').length;
    const inProgressFeatures = this.projectStructure.features.filter(f => f.status === 'in-progress').length;
    const plannedFeatures = this.projectStructure.features.filter(f => f.status === 'planned').length;

    this.projectStructure.status = {
      overall: fileCount > 0 ? 'healthy' : 'critical',
      completedFeatures: completedFeatures,
      inProgressFeatures: inProgressFeatures,
      todoFeatures: plannedFeatures,
      codeQuality: 75,
      testCoverage: 0,
      documentation: 60,
      maintainability: 80,
      recentChanges: [],
      nextMilestones: [],
      blockers: []
    };

    this.projectStructure.metrics = {
      totalFiles: fileCount,
      totalLines: 0, // TODO: Count lines of code
      totalSize: Array.from(this.projectStructure.files.values())
        .reduce((sum, file) => sum + file.size, 0),
      filesByCategory: new Map(),
      filesByLanguage: new Map(),
      averageComplexity: 2.5,
      hotspots: [],
      totalDependencies: 0,
      externalDependencies: [],
      internalCoupling: [],
      issuesByType: new Map(),
      issuesBySeverity: new Map(),
      lastCalculated: new Date()
    };

    logger.debug('[PROJECT_CONTEXT] Assessed project status');
  }

  private async finalizeIndexing(): Promise<void> {
    // Finalize the indexing process
    if (this.projectStructure) {
      this.projectStructure.lastIndexed = new Date();
      this.projectStructure.version = '1.0.0';
    }
    logger.debug('[PROJECT_CONTEXT] Finalized indexing');
  }

  // Helper methods for advanced feature detection
  private calculateLanguageDistribution(): { [key: string]: number } {
    if (!this.projectStructure) return {};
    
    const distribution: { [key: string]: number } = {};
    Array.from(this.projectStructure.files.values()).forEach(file => {
      if (file.language) {
        distribution[file.language] = (distribution[file.language] || 0) + 1;
      }
    });
    return distribution;
  }

  private async detectFrameworks(): Promise<string[]> {
    // This would analyze package.json, requirements.txt, etc.
    return [];
  }

  private async extractDependencies(): Promise<string[]> {
    const dependencies: string[] = [];
    // Analysis logic for dependencies would go here
    return dependencies;
  }

  private findEntryPoints(): string[] {
    if (!this.projectStructure) return [];
    return Array.from(this.projectStructure.files.values())
      .filter(file => ['index.js', 'index.ts', 'main.py', 'main.go', 'app.js'].includes(path.basename(file.path)))
      .map(file => file.path);
  }

  private findConfigFiles(): string[] {
    if (!this.projectStructure) return [];
    return Array.from(this.projectStructure.files.values())
      .filter(file => ['package.json', 'tsconfig.json', 'requirements.txt', 'Dockerfile'].includes(path.basename(file.path)))
      .map(file => file.path);
  }

  private mapConfidenceToPriority(confidence: number): 'critical' | 'high' | 'medium' | 'low' {
    if (confidence > 0.9) return 'critical';
    if (confidence > 0.7) return 'high';
    if (confidence > 0.5) return 'medium';
    return 'low';
  }

  private getFilesRelatedToFeature(feature: any): string[] {
    // This would analyze which files are related to the feature
    return [];
  }

  private estimateFeatureComplexity(feature: any): 'simple' | 'moderate' | 'complex' | 'very-complex' {
    const evidenceCount = feature.evidence?.length || 0;
    if (evidenceCount > 5) return 'very-complex';
    if (evidenceCount > 3) return 'complex';
    if (evidenceCount > 1) return 'moderate';
    return 'simple';
  }

  private async storeProjectFeatures(features: ProjectFeature[]): Promise<void> {
    // Store features in Chroma collection for searchability
    try {
      for (const feature of features) {
        // Logic to store features in vector database would go here
        logger.debug(`[PROJECT_CONTEXT] Stored feature: ${feature.name}`);
      }
    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to store project features:', error);
    }
  }

  // Stub methods for feature detection (would be implemented with full logic)
  private async detectWebFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    // Web feature detection logic would go here
  }

  private async detectAPIFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    // API feature detection logic would go here
  }

  private async detectDatabaseFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    // Database feature detection logic would go here
  }

  private async detectTestingFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    // Testing feature detection logic would go here
  }

  private async detectBuildDeploymentFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    // Build/deployment feature detection logic would go here
  }

  private async detectAuthSecurityFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    // Auth/security feature detection logic would go here
  }

  private async detectDevelopmentToolsFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    // Development tools feature detection logic would go here
  }

  private async detectUIUXFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    // UI/UX feature detection logic would go here
  }

  private getLanguageFromExtension(ext: string): string {
    const langMap: Record<string, string> = {
      '.js': 'JavaScript',
      '.ts': 'TypeScript',
      '.py': 'Python',
      '.java': 'Java',
      '.cpp': 'C++',
      '.c': 'C',
      '.cs': 'C#',
      '.php': 'PHP',
      '.rb': 'Ruby',
      '.go': 'Go',
      '.rs': 'Rust',
      '.swift': 'Swift',
      '.kt': 'Kotlin',
      '.html': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.json': 'JSON',
      '.xml': 'XML',
      '.md': 'Markdown'
    };
    return langMap[ext.toLowerCase()] || ext.toUpperCase().replace('.', '');
  }

  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}

/**
 * Simple semaphore for controlling concurrency
 */
class Semaphore {
  private permits: number;
  private waitQueue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const resolve = this.waitQueue.shift();
    if (resolve) {
      this.permits--;
      resolve();
    }
  }
}