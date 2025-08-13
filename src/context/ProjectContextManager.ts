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
    // But still pass the full extension config for foundation models access
    const { getConfig } = require('../config');
    const extensionConfig = getConfig();
    
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
      },
      extensionConfig // Pass full extension config for foundation models access
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
      
      // Try to load existing project data from previous indexing
      await this.loadExistingProjectData();
      
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
      const generalAgent = await this.agentFactory.getAgent(AgentSpecialization.GENERAL);
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
    
    // Handle patterns like **/.git/** (directory anywhere with all contents)
    if (normalizedPattern.startsWith('**/') && normalizedPattern.endsWith('/**')) {
      const dirName = normalizedPattern.slice(3, -3); // Remove **/ and /**
      return normalizedPath.includes('/' + dirName + '/') || 
             normalizedPath.startsWith(dirName + '/') ||
             normalizedPath === dirName;
    }
    
    // Handle patterns starting with **/ but not ending with /**
    if (normalizedPattern.startsWith('**/')) {
      const suffix = normalizedPattern.substring(3); // Remove **/
      if (suffix.startsWith('*.')) {
        const extension = suffix.substring(1); // Remove *
        return normalizedPath.endsWith(extension);
      }
      // Match directory or file anywhere in path
      return normalizedPath.includes('/' + suffix) || 
             normalizedPath.startsWith(suffix) ||
             normalizedPath.endsWith('/' + suffix);
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
    
    // Handle simple patterns without directory separators
    if (!normalizedPattern.includes('/')) {
      return normalizedPath.includes('/' + normalizedPattern + '/') ||
             normalizedPath.startsWith(normalizedPattern + '/') ||
             normalizedPath.endsWith('/' + normalizedPattern) ||
             normalizedPath === normalizedPattern;
    }
    
    // Fallback to simple string matching for exact patterns
    return normalizedPath === normalizedPattern;
  }

  private async createProjectFile(filePath: string): Promise<ProjectFile> {
    // Implementation for creating ProjectFile from file path
    const stats = await fs.stat(filePath);
    const extension = path.extname(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      extension: extension,
      size: stats.size,
      lastModified: stats.mtime,
      type: 'file',
      language: this.getLanguageFromExtension(extension)
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
    try {
      logger.info('[PROJECT_CONTEXT] Starting ChromaDB storage process...');
      
      if (!this.projectStructure) {
        logger.warn('[PROJECT_CONTEXT] No project structure to store');
        return;
      }

      // Store project files in project_documentation collection
      await this.storeProjectFiles();
      
      // Store project structure in project_structure collection  
      await this.storeProjectStructureData();
      
      // Store project features in project_features collection
      await this.storeProjectFeatures(this.projectStructure.features);
      
      // Update collection information with actual document counts
      await this.updateCollectionCounts();
      
      logger.info('[PROJECT_CONTEXT] Successfully stored all data in ChromaDB collections');
      
    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to store data in Chroma collections:', error);
      throw error;
    }
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
    try {
      if (!features || features.length === 0) {
        logger.warn('[PROJECT_CONTEXT] No features to store');
        return;
      }
      
      logger.info(`[PROJECT_CONTEXT] Storing ${features.length} features in ChromaDB...`);
      
      const projectId = path.basename(this.config.workspacePath);
      const documents = features.map(feature => ({
        id: `${projectId}_feature_${feature.id}`,
        content: `Feature: ${feature.name}\n\nDescription: ${feature.description}\n\nStatus: ${feature.status}\n\nPriority: ${feature.priority}\n\nComplexity: ${feature.estimatedComplexity}\n\nCompletion: ${feature.completionPercentage}%\n\nFiles: ${feature.files.join(', ')}`,
        metadata: {
          feature_id: feature.id,
          feature_name: feature.name,
          status: feature.status,
          confidence: feature.priority === 'critical' ? '0.95' : feature.priority === 'high' ? '0.85' : feature.priority === 'medium' ? '0.70' : '0.50',
          evidence_count: feature.files.length.toString(),
          project_id: projectId,
          type: 'project_feature',
          complexity: feature.estimatedComplexity,
          completion: feature.completionPercentage.toString()
        }
      }));
      
      // Store in the vector database using the project_features collection concept
      const vectorDocuments = documents.map(doc => ({
        id: doc.id,
        content: doc.content,
        metadata: {
          source: 'project_analysis',
          title: doc.metadata.feature_name,
          language: 'feature',
          lastUpdated: new Date().toISOString(),
          chunkIndex: 0,
          totalChunks: 1,
          category: 'project_feature',
          ...doc.metadata
        }
      }));
      
      await this.vectorDB.addDocuments(vectorDocuments);
      
      // Update the collection info
      const existingInfo = this.chromaCollections.get('project_features');
      if (existingInfo) {
        existingInfo.documentCount = features.length;
        existingInfo.lastUpdated = new Date();
        this.chromaCollections.set('project_features', existingInfo);
      }
      
      logger.info(`[PROJECT_CONTEXT] Successfully stored ${features.length} features`);
      
    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to store project features:', error);
      throw error;
    }
  }

  /**
   * Store project files in ChromaDB
   */
  private async storeProjectFiles(): Promise<void> {
    try {
      if (!this.projectStructure || this.projectStructure.files.size === 0) {
        logger.warn('[PROJECT_CONTEXT] No project files to store');
        return;
      }
      
      logger.info(`[PROJECT_CONTEXT] Storing ${this.projectStructure.files.size} files in ChromaDB...`);
      
      const projectId = path.basename(this.config.workspacePath);
      const files = Array.from(this.projectStructure.files.values());
      
      const documents = await Promise.all(
        files.slice(0, 100).map(async (file) => { // Limit to first 100 files for performance
          try {
            let content = '';
            if (file.size < 50000) { // Only read smaller files
              try {
                content = await fs.readFile(file.path, 'utf8');
              } catch (error) {
                content = `[Binary or unreadable file: ${file.name}]`;
              }
            } else {
              content = `[Large file: ${file.name} (${this.formatFileSize(file.size)})]`;
            }
            
            return {
              id: `${projectId}_file_${Buffer.from(file.path).toString('base64')}`,
              content: `File: ${file.name}\nPath: ${file.path}\nType: ${file.extension}\nSize: ${this.formatFileSize(file.size)}\n\n${content}`,
              metadata: {
                file_path: file.path,
                file_type: file.extension,
                language: this.getLanguageFromExtension(file.extension),
                purpose: 'source_code',
                confidence: '0.8',
                project_id: projectId,
                last_modified: file.lastModified.toISOString()
              }
            };
          } catch (error) {
            logger.warn(`[PROJECT_CONTEXT] Failed to process file ${file.path}:`, error);
            return null;
          }
        })
      );
      
      const validDocuments = documents.filter(doc => doc !== null);
      
      if (validDocuments.length > 0) {
        const vectorDocuments = validDocuments.map(doc => ({
          id: doc.id,
          content: doc.content,
          metadata: {
            source: 'project_files',
            title: doc.metadata.file_path,
            lastUpdated: doc.metadata.last_modified,
            chunkIndex: 0,
            totalChunks: 1,
            category: 'project_file',
            originalFile: doc.metadata.file_path,
            ...doc.metadata
          }
        }));
        
        await this.vectorDB.addDocuments(vectorDocuments);
        
        // Update collection info
        const existingInfo = this.chromaCollections.get('project_documentation');
        if (existingInfo) {
          existingInfo.documentCount = validDocuments.length;
          existingInfo.lastUpdated = new Date();
          this.chromaCollections.set('project_documentation', existingInfo);
        }
      }
      
      logger.info(`[PROJECT_CONTEXT] Successfully stored ${validDocuments.length} files`);
      
    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to store project files:', error);
      throw error;
    }
  }
  
  /**
   * Store project structure in ChromaDB
   */
  private async storeProjectStructureData(): Promise<void> {
    try {
      if (!this.projectStructure) {
        logger.warn('[PROJECT_CONTEXT] No project structure to store');
        return;
      }
      
      logger.info('[PROJECT_CONTEXT] Storing project structure in ChromaDB...');
      
      const projectId = path.basename(this.config.workspacePath);
      const structureData = {
        overview: this.projectStructure.overview,
        metrics: this.projectStructure.metrics,
        status: this.projectStructure.status,
        directories: Array.from(this.projectStructure.directories.keys()),
        totalFiles: this.projectStructure.files.size
      };
      
      const document = {
        id: `${projectId}_structure`,
        content: `Project Structure Analysis\n\nName: ${structureData.overview.name}\nType: ${structureData.overview.type}\nPrimary Language: ${structureData.overview.primaryLanguage}\nTotal Files: ${structureData.totalFiles}\nDirectories: ${structureData.directories.length}\n\nOverview: ${structureData.overview.description}\nPurpose: ${structureData.overview.purpose}\n\nStrengths: ${structureData.overview.strengths?.join(', ')}\nWeaknesses: ${structureData.overview.weaknesses?.join(', ')}`,
        metadata: {
          structure_type: 'project_overview',
          component_type: 'root',
          importance: 'high',
          project_id: projectId,
          analysis_date: new Date().toISOString()
        }
      };
      
      const vectorDocument = {
        id: document.id,
        content: document.content,
        metadata: {
          source: 'structure_analysis',
          title: `${structureData.overview?.name || path.basename(this.config.workspacePath)} Structure`,
          language: structureData.overview.primaryLanguage,
          lastUpdated: new Date().toISOString(),
          chunkIndex: 0,
          totalChunks: 1,
          category: 'project_structure',
          ...document.metadata
        }
      };
      
      await this.vectorDB.addDocuments([vectorDocument]);
      
      // Update collection info
      const existingInfo = this.chromaCollections.get('project_structure');
      if (existingInfo) {
        existingInfo.documentCount = 1;
        existingInfo.lastUpdated = new Date();
        this.chromaCollections.set('project_structure', existingInfo);
      }
      
      logger.info('[PROJECT_CONTEXT] Successfully stored project structure');
      
    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to store project structure:', error);
      throw error;
    }
  }
  
  /**
   * Update collection document counts from ChromaDB
   */
  private async updateCollectionCounts(): Promise<void> {
    try {
      logger.info('[PROJECT_CONTEXT] Updating collection document counts...');
      
      // Map collection names to their actual source metadata values
      const collectionSourceMap: { [key: string]: string } = {
        'project_documentation': 'project_files',
        'project_dependencies': 'dependency_analysis', 
        'project_features': 'project_analysis',
        'project_structure': 'structure_analysis'
      };
      
      for (const [collectionName, collectionInfo] of this.chromaCollections.entries()) {
        try {
          const sourceToSearch = collectionSourceMap[collectionName] || collectionName;
          const stats = await this.vectorDB.getSourceStats(sourceToSearch);
          collectionInfo.documentCount = stats.documentCount || 0;
          collectionInfo.lastUpdated = new Date();
          this.chromaCollections.set(collectionName, collectionInfo);
          
          logger.debug(`[PROJECT_CONTEXT] Updated '${collectionName}' (source: '${sourceToSearch}'): ${collectionInfo.documentCount} documents`);
        } catch (error) {
          logger.debug(`[PROJECT_CONTEXT] Failed to get stats for '${collectionName}':`, error);
        }
      }
      
      const totalDocs = Array.from(this.chromaCollections.values())
        .reduce((sum, info) => sum + info.documentCount, 0);
      logger.info(`[PROJECT_CONTEXT] Collection update complete: ${totalDocs} total documents`);
      
    } catch (error) {
      logger.error('[PROJECT_CONTEXT] Failed to update collection counts:', error);
      // Don't throw - this is not critical
    }
  }

  // Feature detection methods with actual logic
  private async detectWebFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    try {
      // Check for webview usage in VS Code extension
      const webviewFiles = await this.findFilesWithPattern(projectPath, /webview|html|\.vue|\.svelte/i);
      if (webviewFiles.length > 0) {
        features.push({
          id: 'web-ui',
          name: 'Web UI Components',
          description: `Project includes web-based UI components and webviews (${webviewFiles.length} files)`,
          status: 'implemented',
          confidence: 0.9,
          evidence: webviewFiles.map(f => path.basename(f))
        });
      }
      
      // Check for web technologies in package.json
      const packageFile = path.join(projectPath, 'package.json');
      try {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageData = JSON.parse(packageContent);
        
        const allDeps = {...(packageData.dependencies || {}), ...(packageData.devDependencies || {})};
        const webDeps = Object.keys(allDeps)
          .filter(dep => /react|vue|angular|svelte|webpack|vite|rollup/.test(dep));
        
        if (webDeps.length > 0) {
          features.push({
            id: 'web-framework',
            name: 'Web Framework Integration',
            description: `Uses web frameworks and build tools: ${webDeps.slice(0, 3).join(', ')}${webDeps.length > 3 ? ` and ${webDeps.length - 3} more` : ''}`,
            status: 'implemented',
            confidence: 0.85,
            evidence: webDeps
          });
        }
      } catch (error) {
        // Package.json not found or invalid, ignore
      }
    } catch (error) {
      logger.warn('[PROJECT_CONTEXT] Failed to detect web features:', error);
    }
  }

  private async detectAPIFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    try {
      // Check for API-related patterns in the codebase
      const apiFiles = await this.findFilesWithContent(projectPath, /api|endpoint|route|controller|service/i);
      if (apiFiles.length > 0) {
        features.push({
          id: 'api-integration',
          name: 'API Integration',
          description: `Project includes API integration and service layers (${apiFiles.length} files)`,
          status: 'implemented',
          confidence: 0.8,
          evidence: apiFiles.map(f => path.basename(f))
        });
      }
      
      // Check for HTTP client libraries
      const packageFile = path.join(projectPath, 'package.json');
      try {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageData = JSON.parse(packageContent);
        
        const allDeps = {...(packageData.dependencies || {}), ...(packageData.devDependencies || {})};
        const apiDeps = Object.keys(allDeps)
          .filter(dep => /axios|fetch|request|http|express|fastify|koa/.test(dep));
        
        if (apiDeps.length > 0) {
          features.push({
            id: 'http-client',
            name: 'HTTP Client Libraries',
            description: `Uses HTTP client libraries: ${apiDeps.join(', ')}`,
            status: 'implemented',
            confidence: 0.9,
            evidence: apiDeps
          });
        }
      } catch (error) {
        // Package.json not found or invalid, ignore
      }
    } catch (error) {
      logger.warn('[PROJECT_CONTEXT] Failed to detect API features:', error);
    }
  }

  private async detectDatabaseFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    try {
      // Check for database-related files and patterns
      const dbFiles = await this.findFilesWithPattern(projectPath, /database|db|sql|mongo|redis|sqlite/i);
      if (dbFiles.length > 0) {
        features.push({
          id: 'database-integration',
          name: 'Database Integration',
          description: `Project includes database integration (${dbFiles.length} files)`,
          status: 'implemented',
          confidence: 0.85,
          evidence: dbFiles.map(f => path.basename(f))
        });
      }
      
      // Check for database dependencies
      const packageFile = path.join(projectPath, 'package.json');
      try {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageData = JSON.parse(packageContent);
        
        const allDeps = {...(packageData.dependencies || {}), ...(packageData.devDependencies || {})};
        const dbDeps = Object.keys(allDeps)
          .filter(dep => /sqlite|postgres|mysql|mongodb|redis|chromadb|typeorm|sequelize|prisma/.test(dep));
        
        if (dbDeps.length > 0) {
          features.push({
            id: 'database-libraries',
            name: 'Database Libraries',
            description: `Uses database libraries: ${dbDeps.join(', ')}`,
            status: 'implemented',
            confidence: 0.9,
            evidence: dbDeps
          });
        }
      } catch (error) {
        // Package.json not found or invalid, ignore
      }
    } catch (error) {
      logger.warn('[PROJECT_CONTEXT] Failed to detect database features:', error);
    }
  }

  private async detectTestingFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    try {
      // Find test files
      const testFiles = await this.findFilesWithPattern(projectPath, /test|spec|\.test\.|\.spec\./i);
      if (testFiles.length > 0) {
        features.push({
          id: 'test-suite',
          name: 'Test Suite',
          description: `Project includes comprehensive testing (${testFiles.length} test files)`,
          status: 'implemented',
          confidence: 0.95,
          evidence: testFiles.slice(0, 5).map(f => path.basename(f))
        });
      }
      
      // Check for testing frameworks
      const packageFile = path.join(projectPath, 'package.json');
      try {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageData = JSON.parse(packageContent);
        
        const allDeps = {...(packageData.dependencies || {}), ...(packageData.devDependencies || {})};
        const testDeps = Object.keys(allDeps)
          .filter(dep => /jest|mocha|chai|jasmine|vitest|ava|tape|cypress|playwright|puppeteer/.test(dep));
        
        if (testDeps.length > 0) {
          features.push({
            id: 'test-frameworks',
            name: 'Testing Frameworks',
            description: `Uses testing frameworks: ${testDeps.join(', ')}`,
            status: 'implemented',
            confidence: 0.9,
            evidence: testDeps
          });
        }
      } catch (error) {
        // Package.json not found or invalid, ignore
      }
    } catch (error) {
      logger.warn('[PROJECT_CONTEXT] Failed to detect testing features:', error);
    }
  }

  private async detectBuildDeploymentFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    try {
      // Check for build configuration files
      const buildFiles = [
        'webpack.config.js', 'vite.config.js', 'rollup.config.js', 
        'tsconfig.json', 'babel.config.js', 'esbuild.config.js',
        '.github/workflows', 'Dockerfile', 'docker-compose.yml'
      ];
      
      const foundBuildFiles = [];
      for (const buildFile of buildFiles) {
        try {
          await fs.access(path.join(projectPath, buildFile));
          foundBuildFiles.push(buildFile);
        } catch (error) {
          // File doesn't exist, continue
        }
      }
      
      if (foundBuildFiles.length > 0) {
        features.push({
          id: 'build-system',
          name: 'Build & Deployment System',
          description: `Project includes build and deployment configuration: ${foundBuildFiles.join(', ')}`,
          status: 'implemented',
          confidence: 0.9,
          evidence: foundBuildFiles
        });
      }
      
      // Check for CI/CD directories
      const ciDirs = ['.github', '.gitlab-ci.yml', 'azure-pipelines.yml', '.travis.yml'];
      for (const ciDir of ciDirs) {
        try {
          const stat = await fs.stat(path.join(projectPath, ciDir));
          if (stat.isDirectory() || stat.isFile()) {
            features.push({
              id: 'ci-cd',
              name: 'CI/CD Integration',
              description: `Project includes continuous integration/deployment with ${ciDir}`,
              status: 'implemented',
              confidence: 0.85,
              evidence: [ciDir]
            });
            break;
          }
        } catch (error) {
          // Directory doesn't exist, continue
        }
      }
    } catch (error) {
      logger.warn('[PROJECT_CONTEXT] Failed to detect build/deployment features:', error);
    }
  }

  private async detectAuthSecurityFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    try {
      // Check for authentication/security related files
      const authFiles = await this.findFilesWithContent(projectPath, /auth|security|token|login|password|encrypt|decrypt/i);
      if (authFiles.length > 0) {
        features.push({
          id: 'authentication',
          name: 'Authentication & Security',
          description: `Project includes authentication and security features (${authFiles.length} files)`,
          status: 'implemented',
          confidence: 0.8,
          evidence: authFiles.slice(0, 5).map(f => path.basename(f))
        });
      }
      
      // Check for security-related dependencies
      const packageFile = path.join(projectPath, 'package.json');
      try {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageData = JSON.parse(packageContent);
        
        const allDeps = {...(packageData.dependencies || {}), ...(packageData.devDependencies || {})};
        const securityDeps = Object.keys(allDeps)
          .filter(dep => /crypto|bcrypt|jwt|passport|oauth|auth0|helmet|cors|express-rate-limit/.test(dep));
        
        if (securityDeps.length > 0) {
          features.push({
            id: 'security-libraries',
            name: 'Security Libraries',
            description: `Uses security libraries: ${securityDeps.join(', ')}`,
            status: 'implemented',
            confidence: 0.9,
            evidence: securityDeps
          });
        }
      } catch (error) {
        // Package.json not found or invalid, ignore
      }
    } catch (error) {
      logger.warn('[PROJECT_CONTEXT] Failed to detect auth/security features:', error);
    }
  }

  private async detectDevelopmentToolsFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    try {
      // Check for development tool files
      const devFiles = [
        '.eslintrc.js', '.eslintrc.json', '.prettierrc', 'jsconfig.json', 
        'tsconfig.json', '.editorconfig', '.gitignore', '.npmrc'
      ];
      
      const foundDevFiles = [];
      for (const devFile of devFiles) {
        try {
          await fs.access(path.join(projectPath, devFile));
          foundDevFiles.push(devFile);
        } catch (error) {
          // File doesn't exist, continue
        }
      }
      
      if (foundDevFiles.length > 0) {
        features.push({
          id: 'dev-tools',
          name: 'Development Tools',
          description: `Project includes development tools and configuration: ${foundDevFiles.join(', ')}`,
          status: 'implemented',
          confidence: 0.9,
          evidence: foundDevFiles
        });
      }
      
      // Check for development dependencies
      const packageFile = path.join(projectPath, 'package.json');
      try {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageData = JSON.parse(packageContent);
        
        const devDeps = Object.keys(packageData.devDependencies || {})
          .filter(dep => /eslint|prettier|husky|lint-staged|nodemon|concurrently/.test(dep));
        
        if (devDeps.length > 0) {
          features.push({
            id: 'dev-dependencies',
            name: 'Development Dependencies',
            description: `Uses development tools: ${devDeps.slice(0, 5).join(', ')}${devDeps.length > 5 ? ` and ${devDeps.length - 5} more` : ''}`,
            status: 'implemented',
            confidence: 0.85,
            evidence: devDeps
          });
        }
      } catch (error) {
        // Package.json not found or invalid, ignore
      }
    } catch (error) {
      logger.warn('[PROJECT_CONTEXT] Failed to detect development tools features:', error);
    }
  }

  private async detectUIUXFeatures(projectPath: string, structure: any, features: any[]): Promise<void> {
    try {
      // Check for UI framework files and patterns
      const uiFiles = await this.findFilesWithPattern(projectPath, /component|ui|style|css|scss|less/i);
      if (uiFiles.length > 0) {
        features.push({
          id: 'ui-components',
          name: 'UI Component System',
          description: `Project includes UI components and styling (${uiFiles.length} files)`,
          status: 'implemented',
          confidence: 0.8,
          evidence: uiFiles.slice(0, 5).map(f => path.basename(f))
        });
      }
      
      // Check for VS Code specific UI features
      const vscodeUIFiles = await this.findFilesWithPattern(projectPath, /webview|panel|sidebar|statusbar|command/i);
      if (vscodeUIFiles.length > 0) {
        features.push({
          id: 'vscode-ui',
          name: 'VS Code UI Integration',
          description: `Project includes VS Code UI integrations (${vscodeUIFiles.length} files)`,
          status: 'implemented',
          confidence: 0.9,
          evidence: vscodeUIFiles.map(f => path.basename(f))
        });
      }
      
      // Check for UI/design dependencies
      const packageFile = path.join(projectPath, 'package.json');
      try {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageData = JSON.parse(packageContent);
        
        const allDeps = {...(packageData.dependencies || {}), ...(packageData.devDependencies || {})};
        const uiDeps = Object.keys(allDeps)
          .filter(dep => /material|bootstrap|tailwind|styled-components|emotion|chakra/.test(dep));
        
        if (uiDeps.length > 0) {
          features.push({
            id: 'ui-frameworks',
            name: 'UI Frameworks',
            description: `Uses UI frameworks: ${uiDeps.join(', ')}`,
            status: 'implemented',
            confidence: 0.9,
            evidence: uiDeps
          });
        }
      } catch (error) {
        // Package.json not found or invalid, ignore
      }
    } catch (error) {
      logger.warn('[PROJECT_CONTEXT] Failed to detect UI/UX features:', error);
    }
  }
  
  // Helper methods for file discovery
  private async findFilesWithPattern(projectPath: string, pattern: RegExp): Promise<string[]> {
    const matchingFiles: string[] = [];
    
    if (!this.projectStructure) return matchingFiles;
    
    for (const [filePath, file] of this.projectStructure.files.entries()) {
      if (pattern.test(path.basename(filePath)) || pattern.test(filePath)) {
        matchingFiles.push(filePath);
      }
    }
    
    return matchingFiles;
  }
  
  private async findFilesWithContent(projectPath: string, pattern: RegExp): Promise<string[]> {
    const matchingFiles: string[] = [];
    
    if (!this.projectStructure) return matchingFiles;
    
    // Only check files that are likely to contain the pattern
    const relevantFiles = Array.from(this.projectStructure.files.values())
      .filter(file => file.size < 100000 && // Limit to smaller files for performance
                     ['.js', '.ts', '.json', '.md', '.txt', '.yml', '.yaml'].includes(file.extension.toLowerCase()));
    
    for (const file of relevantFiles.slice(0, 50)) { // Limit to first 50 relevant files for performance
      try {
        const content = await fs.readFile(file.path, 'utf8');
        if (pattern.test(content)) {
          matchingFiles.push(file.path);
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }
    
    return matchingFiles;
  }
  
  /**
   * Load existing project data from ChromaDB if available
   */
  private async loadExistingProjectData(): Promise<void> {
    try {
      logger.info('[PROJECT_CONTEXT] Attempting to load existing project data...');
      
      const projectId = path.basename(this.config.workspacePath);
      
      // Try to load project structure from vector database
      const structureQuery = `Project Structure Analysis ${projectId}`;
      const structureResults = await this.vectorDB.search(structureQuery, {
        limit: 1,
        filter: { project_id: projectId }
      });
      
      if (structureResults.length > 0) {
        logger.info(`[PROJECT_CONTEXT] Found existing project structure data`);
        await this.reconstructProjectStructureFromStorage(structureResults[0]);
      }
      
      // Try to load project features with simplified search to avoid ChromaValueError
      const featureQuery = `Features ${projectId}`;
      let featureResults: any[] = [];
      try {
        featureResults = await this.vectorDB.search(featureQuery, {
          limit: 20,
          filter: { project_id: projectId }
        });
      } catch (error) {
        logger.warn('[PROJECT_CONTEXT] Feature search with filter failed, trying without filter:', error);
        try {
          // Fallback to search without filter
          featureResults = await this.vectorDB.search(featureQuery, {
            limit: 20
          });
        } catch (fallbackError) {
          logger.warn('[PROJECT_CONTEXT] Feature search completely failed:', fallbackError);
          featureResults = [];
        }
      }
      
      if (featureResults.length > 0) {
        logger.info(`[PROJECT_CONTEXT] Found ${featureResults.length} existing project features`);
        await this.reconstructFeaturesFromStorage(featureResults);
      }
      
      // Update collection counts to reflect actual stored data
      await this.updateCollectionCounts();
      
      logger.info('[PROJECT_CONTEXT] Existing project data loaded successfully');
      
    } catch (error) {
      logger.warn('[PROJECT_CONTEXT] Failed to load existing project data:', error);
      // Don't throw - this is not critical, we can always re-index
    }
  }
  
  /**
   * Reconstruct project structure from stored data
   */
  private async reconstructProjectStructureFromStorage(structureResult: any): Promise<void> {
    try {
      const metadata = structureResult.document.metadata;
      
      // Create basic project structure if not exists
      if (!this.projectStructure) {
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
          overview: {} as any,
          features: [],
          status: {} as any,
          metrics: {} as any,
          lastIndexed: new Date(metadata.analysis_date),
          version: '1.0.0',
          indexingProgress: {
            stage: 'finalization',
            processedFiles: 0,
            totalFiles: 0,
            stagesCompleted: [],
            currentStageProgress: 100,
            startTime: new Date(),
            elapsedTime: 0,
            errors: [],
            warnings: [],
            collectionsCreated: []
          }
        };
      }
      
      // Parse the stored structure data from content
      const content = structureResult.document.content;
      const lines = content.split('\n');
      
      // Extract basic info from the stored content
      let totalFiles = 0;
      let directories = 0;
      
      lines.forEach((line: string) => {
        if (line.includes('Total Files:')) {
          totalFiles = parseInt(line.split(':')[1]?.trim() || '0');
        }
        if (line.includes('Directories:')) {
          directories = parseInt(line.split(':')[1]?.trim() || '0');
        }
      });
      
      // Create basic overview from stored data
      this.projectStructure!.overview = {
        name: path.basename(this.config.workspacePath),
        description: 'Loaded from previous analysis',
        type: 'extension',
        primaryLanguage: metadata.language || 'TypeScript',
        frameworks: [],
        architecturalPatterns: [],
        purpose: 'VS Code extension project',
        mainFeatures: [`Previously analyzed with ${totalFiles} files`],
        codeQuality: {
          score: 75,
          factors: {
            codeStyle: 80,
            complexity: 70,
            maintainability: 75,
            testability: 60,
            documentation: 65
          },
          recommendations: []
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
          missingAreas: []
        },
        testCoverage: {
          overall: 0,
          byFile: new Map(),
          byCategory: new Map(),
          uncoveredFiles: [],
          testFiles: [],
          testTypes: []
        },
        strengths: ['Previously analyzed structure'],
        weaknesses: [],
        recommendations: [],
        lastUpdated: new Date()
      };
      
      logger.debug(`[PROJECT_CONTEXT] Reconstructed project structure with ${totalFiles} files`);
      
    } catch (error) {
      logger.warn('[PROJECT_CONTEXT] Failed to reconstruct project structure:', error);
    }
  }
  
  /**
   * Reconstruct features from stored data
   */
  private async reconstructFeaturesFromStorage(featureResults: any[]): Promise<void> {
    try {
      if (!this.projectStructure) return;
      
      const features: any[] = [];
      
      featureResults.forEach(result => {
        const metadata = result.document.metadata;
        const content = result.document.content;
        
        // Parse feature information from metadata
        features.push({
          id: metadata.feature_id || `feature_${features.length}`,
          name: metadata.feature_name || 'Unknown Feature',
          description: content.split('Description:')[1]?.split('\n')[0]?.trim() || 'No description available',
          status: metadata.status || 'implemented',
          priority: this.mapConfidenceToTextPriority(parseFloat(metadata.confidence || '0.5')),
          files: [],
          dependencies: [],
          estimatedComplexity: metadata.complexity || 'moderate',
          completionPercentage: parseInt(metadata.completion || '100'),
          tasks: [],
          issues: []
        });
      });
      
      this.projectStructure.features = features;
      logger.debug(`[PROJECT_CONTEXT] Reconstructed ${features.length} features from storage`);
      
    } catch (error) {
      logger.warn('[PROJECT_CONTEXT] Failed to reconstruct features:', error);
    }
  }
  
  /**
   * Map confidence score to text priority
   */
  private mapConfidenceToTextPriority(confidence: number): 'critical' | 'high' | 'medium' | 'low' {
    if (confidence > 0.9) return 'critical';
    if (confidence > 0.7) return 'high';
    if (confidence > 0.5) return 'medium';
    return 'low';
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