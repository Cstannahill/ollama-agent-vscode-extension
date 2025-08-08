# Project Context System

## Overview

The Project Context System provides comprehensive, systematic project analysis and indexing capabilities through specialized AI agents. It creates a rich, structured understanding of your codebase that can be visualized through an interactive webview panel and manually triggered for complete project indexing.

## Features

### 🚀 **Systematic Agentic Indexing**
- **Multi-stage Pipeline**: 12-stage indexing process from file discovery to feature extraction
- **Specialized Agents**: Dedicated agents for project analysis, dependency mapping, feature extraction, and code quality assessment
- **Parallel Processing**: Configurable concurrency for efficient large project analysis
- **Progress Tracking**: Real-time progress updates with stage-by-stage completion status

### 🗂️ **Chroma Collections for Project Knowledge**
- **Structured Storage**: Organized knowledge collections for files, dependencies, features, and overview
- **Semantic Search**: Vector-based search across all project components
- **Persistent Storage**: ChromaDB-based storage for long-term knowledge retention
- **Metadata-Rich**: Comprehensive metadata for enhanced search and filtering

### 📊 **Interactive Project Visualization**
- **File Tree with Context**: Enhanced file tree showing analysis status, importance, and relationships
- **Project Overview**: High-level project summary with architecture, patterns, and recommendations  
- **Feature Tracking**: Visual feature status with completion percentages and priorities
- **Status Dashboard**: Real-time project health metrics and quality assessments
- **Collection Management**: View and manage knowledge collections with statistics

### 🎯 **Manual Indexing Control**
- **One-Click Indexing**: Manual trigger button for complete project analysis
- **Progress Monitoring**: Live progress tracking with stage details and file processing
- **Error Handling**: Comprehensive error reporting with recovery suggestions
- **Export Capabilities**: Export project context data for external analysis

## Architecture

### Core Components

```
ProjectContextSystem/
├── ProjectContextManager        # Main orchestration and indexing logic
├── ProjectContextPanel         # Interactive webview interface  
├── ProjectContextTypes         # Comprehensive type definitions
├── Specialized Agents/
│   ├── ProjectAnalysisAgent    # Overall structure and architecture analysis
│   ├── DependencyAnalysisAgent # File relationships and coupling analysis
│   ├── FeatureExtractionAgent  # Feature identification and tracking
│   └── CodeQualityAgent        # Quality assessment and technical debt
└── Chroma Collections/
    ├── project_files           # File-level analysis and embeddings
    ├── project_dependencies    # Dependency relationships
    ├── project_features        # Feature definitions and status
    └── project_overview        # High-level insights and metrics
```

### 12-Stage Indexing Pipeline

1. **Initialization** - Set up project structure and collections
2. **File Discovery** - Recursive project scanning with filtering
3. **Structure Analysis** - Project architecture and organization analysis
4. **Content Analysis** - Individual file content and purpose analysis
5. **Dependency Mapping** - Import/export and usage relationship mapping
6. **Relationship Analysis** - Cross-file relationships and coupling analysis
7. **Embedding Generation** - Vector embeddings for semantic search
8. **Collection Storage** - Structured storage in Chroma collections
9. **Overview Generation** - High-level project summary and insights
10. **Feature Extraction** - Feature identification and categorization
11. **Status Assessment** - Project health and quality metrics
12. **Finalization** - Cleanup and result compilation

## Usage

### Opening Project Context Panel

**Method 1: Command Palette**
```
Ctrl+Shift+P → "Ollama Agent: Open Project Context"
```

**Method 2: Direct Command**
```typescript
vscode.commands.executeCommand('ollamaAgent.projectContext');
```

### Manual Project Indexing

1. Open the Project Context panel
2. Click the **"🚀 Start Indexing"** button
3. Monitor progress through the real-time progress bar
4. View results in the organized sections below

### Viewing Project Data

The panel provides several organized sections:

- **📊 Project Overview**: High-level project summary and recommendations
- **📁 File Tree**: Interactive file structure with analysis status
- **🎯 Features**: Feature tracking with completion status and priorities  
- **📈 Project Status**: Health metrics and quality assessments
- **🗂️ Knowledge Collections**: Chroma collection statistics and management

## Configuration

### Project Context Manager Configuration

```typescript
interface ProjectContextManagerConfig {
  workspacePath: string;           // Root workspace path
  maxFileSize: number;            // Maximum file size to analyze (bytes)
  excludePatterns: string[];      // File patterns to exclude
  includePatterns: string[];      // File patterns to include
  maxConcurrency: number;         // Parallel processing limit
  
  // Agent configuration
  ollamaUrl: string;              // Ollama server URL
  model: string;                  // LLM model for analysis
  
  // Chroma configuration
  chromaCollections: {
    files: string;                // Files collection name
    dependencies: string;         // Dependencies collection name
    features: string;             // Features collection name
    overview: string;             // Overview collection name
  };
}
```

### Default Configuration

```typescript
const defaultConfig = {
  maxFileSize: 1024 * 1024,       // 1MB
  excludePatterns: [
    '**/node_modules/**',
    '**/.*',
    '**/*.git/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/*.log',
    '**/coverage/**'
  ],
  includePatterns: [
    '**/*.ts', '**/*.js', '**/*.json', 
    '**/*.md', '**/*.css', '**/*.html'
  ],
  maxConcurrency: 3,
  chromaCollections: {
    files: 'project_files',
    dependencies: 'project_dependencies', 
    features: 'project_features',
    overview: 'project_overview'
  }
};
```

## Data Structures

### Project Structure

```typescript
interface ProjectStructure {
  root: string;                   // Project root path
  files: Map<string, ProjectFile>; // All analyzed files
  directories: Map<string, DirectoryInfo>; // Directory information
  tree: FileTreeNode;             // Hierarchical file tree
  
  // Analysis results
  overview: ProjectOverview;      // High-level project summary
  features: ProjectFeature[];     // Identified features
  status: ProjectStatus;          // Current project status
  metrics: ProjectMetrics;        // Quality and complexity metrics
  
  // Metadata
  lastIndexed: Date;              // Last indexing timestamp
  version: string;                // Data structure version
  indexingProgress: IndexingProgress; // Current indexing state
}
```

### Project File Analysis

```typescript
interface ProjectFile {
  path: string;                   // File path
  name: string;                   // File name
  extension: string;              // File extension
  size: number;                   // File size in bytes
  lastModified: Date;             // Last modification time
  type: 'file' | 'directory';     // File type
  content?: string;               // File content (if loaded)
  
  // Analysis results
  analysis?: FileAnalysis;        // Detailed file analysis
  dependencies?: FileDependency[]; // File dependencies
  relationships?: FileRelationship[]; // Relationships to other files
  embedding?: number[];           // Vector embedding
  
  // Metadata
  language?: string;              // Programming language
  framework?: string;             // Detected framework  
  category?: FileCategory;        // File categorization
  complexity?: ComplexityMetrics; // Complexity assessment
}
```

### Project Features

```typescript
interface ProjectFeature {
  id: string;                     // Unique feature identifier
  name: string;                   // Feature name
  description: string;            // Feature description
  status: FeatureStatus;          // Current status
  priority: 'critical' | 'high' | 'medium' | 'low';
  
  // Implementation details
  files: string[];                // Associated files
  dependencies: string[];         // Feature dependencies
  estimatedComplexity: string;    // Complexity assessment
  
  // Progress tracking
  completionPercentage: number;   // Completion (0-100)
  tasks: FeatureTask[];          // Individual tasks
  issues: AnalysisIssue[];       // Identified issues
  
  // Timeline
  createdDate?: Date;             // Feature creation date
  startDate?: Date;               // Development start date
  estimatedCompletionDate?: Date;  // Estimated completion
  actualCompletionDate?: Date;     // Actual completion date
}
```

## API Reference

### ProjectContextManager

```typescript
class ProjectContextManager {
  // Initialization
  static getInstance(config?: ProjectContextManagerConfig): ProjectContextManager;
  async initialize(): Promise<void>;
  
  // Indexing operations
  async triggerProjectIndexing(progressCallback?: (progress: IndexingProgress) => void): Promise<ProjectStructure>;
  
  // Data access
  getProjectStructure(): ProjectStructure | undefined;
  getIndexingProgress(): IndexingProgress | undefined;
  getChromaCollections(): Map<string, ChromaCollectionInfo>;
}
```

### ProjectContextPanel

```typescript
class ProjectContextPanel {
  // Panel management
  static createOrShow(extensionUri: vscode.Uri, projectContextManager: ProjectContextManager): ProjectContextPanel;
  
  // Message handling
  private handleMessage(message: ProjectContextPanelMessage): Promise<void>;
  
  // Data operations
  private triggerIndexing(): Promise<void>;
  private refreshData(): Promise<void>;
  private exportData(): Promise<void>;
}
```

## Integration with Extension

### Command Registration

The Project Context system is integrated into the main extension through:

```typescript
// In package.json
"commands": [
  {
    "command": "ollamaAgent.projectContext",
    "title": "Open Project Context",
    "category": "Ollama Agent",
    "icon": "$(folder-library)"
  }
]

// In registerCommands.ts
vscode.commands.registerCommand(
  CONSTANTS.COMMANDS.OPEN_PROJECT_CONTEXT, 
  () => openProjectContext(context)
);
```

### Extension Dependencies

The Project Context system leverages existing extension infrastructure:

- **ContextManager**: For workspace context and search capabilities
- **VectorDatabase**: For document storage and semantic search
- **AgentFactory**: For specialized analysis agents
- **ToolManager**: For file operations and analysis tools

## Performance Considerations

### Indexing Performance

- **File Filtering**: Efficient exclude/include pattern matching
- **Parallel Processing**: Configurable concurrency (default: 3 parallel operations)
- **Progressive Updates**: Real-time progress reporting every 100ms
- **Memory Management**: Streaming file processing for large projects
- **Incremental Updates**: Smart re-indexing of changed files only

### Resource Usage

- **Memory**: ~50-100MB for typical project (1000 files)
- **Storage**: ~10-50MB ChromaDB storage per project
- **CPU**: Scales with project size and configured concurrency
- **Network**: Ollama API calls for LLM analysis (configurable endpoint)

### Optimization Strategies

- **Smart Caching**: Cache analysis results with file modification timestamps
- **Selective Indexing**: Focus on important files (source, config, docs)
- **Background Processing**: Non-blocking indexing with progress reporting
- **Error Recovery**: Graceful handling of individual file failures

## Error Handling

### Common Issues and Solutions

**Issue: "No workspace folder is open"**
- **Solution**: Open a folder in VS Code before accessing Project Context

**Issue: "Ollama server not accessible"**
- **Solution**: Ensure Ollama is running at configured URL (default: http://localhost:11434)

**Issue: "ChromaDB initialization failed"**
- **Solution**: Check write permissions in workspace folder, restart VS Code

**Issue: "Memory issues with large projects"**
- **Solution**: Reduce maxConcurrency, add more exclude patterns, increase VS Code memory limit

### Error Recovery

The system includes comprehensive error recovery:

- **Stage-level Recovery**: Individual stage failures don't stop the entire pipeline
- **File-level Recovery**: Individual file failures are logged but don't stop indexing
- **Progressive Degradation**: System continues with reduced functionality if agents fail
- **Retry Logic**: Automatic retry for transient failures (network, file locks)

## Extensibility

### Adding Custom Analysis Agents

```typescript
// Create specialized agent
class CustomAnalysisAgent implements IAgent {
  async analyzeFile(file: ProjectFile): Promise<FileAnalysis> {
    // Custom analysis logic
  }
}

// Register with ProjectContextManager
projectContextManager.registerAnalysisAgent('custom', new CustomAnalysisAgent());
```

### Custom Data Export Formats

```typescript
// Add export format
projectContextManager.addExportFormat('xml', (structure: ProjectStructure) => {
  return convertToXML(structure);
});
```

### Integration with External Tools

The Project Context system can integrate with:

- **Static Analysis Tools**: ESLint, TSLint, SonarQube integration
- **Documentation Generators**: JSDoc, TypeDoc integration  
- **Project Management**: Jira, GitHub Issues integration
- **CI/CD Systems**: Jenkins, GitHub Actions integration

## Future Enhancements

### Planned Features

1. **Incremental Indexing**: Smart updates for changed files only
2. **Cross-Project Analysis**: Multi-workspace project relationships
3. **AI-Powered Insights**: Advanced pattern detection and recommendations
4. **Integration Dashboard**: Unified view across all extension features
5. **Export Formats**: JSON, XML, Markdown, and PDF export options
6. **Real-time Collaboration**: Shared project context across team members

### API Extensions

- **Webhook Support**: External triggers for indexing
- **REST API**: HTTP endpoints for external tool integration
- **GraphQL Schema**: Query interface for complex data retrieval
- **Plugin Architecture**: Third-party extension support

## Conclusion

The Project Context System provides a comprehensive solution for understanding and visualizing project structure through systematic AI-powered analysis. It combines the power of specialized agents with interactive visualization to create a rich, actionable understanding of your codebase.

Key benefits:
- **Complete Project Understanding**: Systematic analysis of all project components
- **Visual Interface**: Interactive, intuitive project exploration
- **Actionable Insights**: Specific recommendations for improvement
- **Extensible Architecture**: Easy integration with existing tools and workflows
- **Performance Optimized**: Efficient processing for projects of all sizes

The system is designed to grow with your project, providing increasingly sophisticated insights as your codebase evolves.