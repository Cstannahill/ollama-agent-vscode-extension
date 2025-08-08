/**
 * Project Context Types and Interfaces
 * 
 * Defines comprehensive types for systematic project analysis and indexing
 */

export interface ProjectFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  lastModified: Date;
  type: 'file' | 'directory';
  content?: string;
  
  // Analysis results
  analysis?: FileAnalysis;
  dependencies?: FileDependency[];
  relationships?: FileRelationship[];
  embedding?: number[];
  
  // Metadata
  language?: string;
  framework?: string;
  category?: FileCategory;
  complexity?: ComplexityMetrics;
}

export interface FileAnalysis {
  summary: string;
  purpose: string;
  functionality: string[];
  features: string[];
  patterns: string[];
  issues: AnalysisIssue[];
  suggestions: string[];
  confidence: number;
  analysisDate: Date;
}

export interface FileDependency {
  type: 'import' | 'export' | 'require' | 'reference' | 'usage';
  target: string;
  source: string;
  confidence: number;
  context: string;
}

export interface FileRelationship {
  type: 'parent' | 'child' | 'sibling' | 'dependency' | 'consumer' | 'interface' | 'implementation';
  relatedFile: string;
  strength: number;
  description: string;
  bidirectional: boolean;
}

export interface AnalysisIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'performance' | 'security' | 'maintainability' | 'complexity' | 'documentation';
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

export interface ComplexityMetrics {
  cyclomaticComplexity: number;
  linesOfCode: number;
  maintainabilityIndex: number;
  cognitiveComplexity: number;
  technicalDebt: number;
}

export type FileCategory = 
  | 'source' | 'test' | 'config' | 'documentation' | 'build' 
  | 'asset' | 'data' | 'schema' | 'template' | 'component'
  | 'service' | 'utility' | 'model' | 'view' | 'controller';

export interface ProjectStructure {
  root: string;
  files: Map<string, ProjectFile>;
  directories: Map<string, DirectoryInfo>;
  tree: FileTreeNode;
  
  // Analysis results
  overview: ProjectOverview;
  features: ProjectFeature[];
  status: ProjectStatus;
  metrics: ProjectMetrics;
  
  // Indexing metadata
  lastIndexed: Date;
  version: string;
  indexingProgress: IndexingProgress;
}

export interface DirectoryInfo {
  path: string;
  name: string;
  files: string[];
  subdirectories: string[];
  purpose: string;
  category: DirectoryCategory;
  metrics: DirectoryMetrics;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  
  // Enhanced context
  analysis?: FileAnalysis;
  status?: 'completed' | 'in-progress' | 'todo' | 'issue';
  importance?: 'critical' | 'high' | 'medium' | 'low';
  lastModified?: Date;
  size?: number;
}

export interface ProjectOverview {
  name: string;
  description: string;
  type: ProjectType;
  primaryLanguage: string;
  frameworks: string[];
  architecturalPatterns: string[];
  
  // High-level analysis
  purpose: string;
  mainFeatures: string[];
  codeQuality: QualityAssessment;
  documentation: DocumentationAssessment;
  testCoverage: TestCoverageInfo;
  
  // Context insights
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  
  lastUpdated: Date;
}

export interface ProjectFeature {
  id: string;
  name: string;
  description: string;
  status: FeatureStatus;
  priority: 'critical' | 'high' | 'medium' | 'low';
  
  // Implementation details
  files: string[];
  dependencies: string[];
  estimatedComplexity: 'simple' | 'moderate' | 'complex' | 'very-complex';
  
  // Progress tracking
  completionPercentage: number;
  tasks: FeatureTask[];
  issues: AnalysisIssue[];
  
  // Timeline
  createdDate?: Date;
  startDate?: Date;
  estimatedCompletionDate?: Date;
  actualCompletionDate?: Date;
}

export interface FeatureTask {
  id: string;
  description: string;
  status: TaskStatus;
  assignedFiles: string[];
  estimatedHours?: number;
  actualHours?: number;
  dependencies: string[];
}

export interface ProjectStatus {
  overall: 'healthy' | 'warning' | 'critical';
  completedFeatures: number;
  inProgressFeatures: number;
  todoFeatures: number;
  
  // Code health
  codeQuality: number; // 0-100
  testCoverage: number; // 0-100
  documentation: number; // 0-100
  maintainability: number; // 0-100
  
  // Recent activity
  recentChanges: RecentChange[];
  nextMilestones: Milestone[];
  blockers: Blocker[];
}

export interface ProjectMetrics {
  totalFiles: number;
  totalLines: number;
  totalSize: number;
  
  // By category
  filesByCategory: Map<FileCategory, number>;
  filesByLanguage: Map<string, number>;
  
  // Complexity
  averageComplexity: number;
  hotspots: ComplexityHotspot[];
  
  // Dependencies
  totalDependencies: number;
  externalDependencies: string[];
  internalCoupling: CouplingMetric[];
  
  // Quality
  issuesByType: Map<string, number>;
  issuesBySeverity: Map<string, number>;
  
  lastCalculated: Date;
}

export interface ChromaCollectionInfo {
  name: string;
  description: string;
  documentCount: number;
  lastUpdated: Date;
  
  // Collection-specific metadata
  metadataSchema: Record<string, string>;
  embeddingDimensions: number;
  indexingStrategy: 'file-based' | 'chunk-based' | 'semantic-blocks';
}

export interface IndexingProgress {
  stage: IndexingStage;
  currentFile?: string;
  processedFiles: number;
  totalFiles: number;
  
  // Stage progress
  stagesCompleted: IndexingStage[];
  currentStageProgress: number; // 0-100
  
  // Time estimates
  startTime: Date;
  estimatedCompletion?: Date;
  elapsedTime: number;
  
  // Results
  errors: IndexingError[];
  warnings: string[];
  collectionsCreated: string[];
}

export type IndexingStage = 
  | 'initialization'
  | 'file_discovery' 
  | 'structure_analysis'
  | 'content_analysis'
  | 'dependency_mapping'
  | 'relationship_analysis'
  | 'embedding_generation'
  | 'collection_storage'
  | 'overview_generation'
  | 'feature_extraction'
  | 'status_assessment'
  | 'finalization';

export interface IndexingError {
  stage: IndexingStage;
  file?: string;
  error: string;
  severity: 'warning' | 'error' | 'critical';
  timestamp: Date;
  context?: any;
}

// Enums and additional types
export type ProjectType = 
  | 'web-application' | 'desktop-application' | 'mobile-application'
  | 'library' | 'framework' | 'cli-tool' | 'api-service'
  | 'extension' | 'plugin' | 'component-library'
  | 'microservice' | 'monolith' | 'unknown';

export type DirectoryCategory = 
  | 'source' | 'tests' | 'documentation' | 'configuration'
  | 'build' | 'assets' | 'data' | 'tools' | 'scripts'
  | 'components' | 'services' | 'models' | 'views'
  | 'utilities' | 'types' | 'constants' | 'resources';

export type FeatureStatus = 
  | 'planned' | 'in-progress' | 'completed' | 'deprecated' 
  | 'blocked' | 'testing' | 'review' | 'deployed';

export type TaskStatus = 
  | 'not-started' | 'in-progress' | 'completed' 
  | 'blocked' | 'cancelled' | 'needs-review';

export interface QualityAssessment {
  score: number; // 0-100
  factors: {
    codeStyle: number;
    complexity: number;
    maintainability: number;
    testability: number;
    documentation: number;
  };
  recommendations: string[];
}

export interface DocumentationAssessment {
  coverage: number; // 0-100
  quality: number; // 0-100
  types: {
    readme: boolean;
    apiDocs: boolean;
    codeComments: number; // percentage
    examples: number;
    tutorials: number;
  };
  missingAreas: string[];
}

export interface TestCoverageInfo {
  overall: number; // 0-100
  byFile: Map<string, number>;
  byCategory: Map<string, number>;
  uncoveredFiles: string[];
  testFiles: string[];
  testTypes: ('unit' | 'integration' | 'e2e' | 'performance')[];
}

export interface RecentChange {
  type: 'file-added' | 'file-modified' | 'file-deleted' | 'feature-completed';
  description: string;
  timestamp: Date;
  files: string[];
  impact: 'low' | 'medium' | 'high';
}

export interface Milestone {
  id: string;
  name: string;
  description: string;
  targetDate: Date;
  progress: number; // 0-100
  dependencies: string[];
  status: 'on-track' | 'at-risk' | 'delayed' | 'completed';
}

export interface Blocker {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedFeatures: string[];
  estimatedResolutionTime: number; // hours
  possibleSolutions: string[];
  createdDate: Date;
}

export interface ComplexityHotspot {
  file: string;
  function?: string;
  complexity: number;
  type: 'cyclomatic' | 'cognitive' | 'maintainability';
  line?: number;
  suggestions: string[];
}

export interface CouplingMetric {
  source: string;
  target: string;
  strength: number; // 0-1
  type: 'data' | 'control' | 'common' | 'content';
  bidirectional: boolean;
}

export interface DirectoryMetrics {
  fileCount: number;
  totalSize: number;
  averageComplexity: number;
  lastModified: Date;
  primaryLanguages: string[];
  purposeConfidence: number;
}