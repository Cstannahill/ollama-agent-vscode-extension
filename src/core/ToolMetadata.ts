/**
 * Tool Metadata System for Enhanced Tool Representation
 * Provides categorization, icons, and usage information for all tools
 */

export enum ToolCategory {
  FILE_OPERATIONS = "file_operations",
  CODE_ANALYSIS = "code_analysis",
  VERSION_CONTROL = "version_control",
  TESTING = "testing",
  PACKAGE_MANAGEMENT = "package_management",
  NETWORK = "network",
  ENVIRONMENT = "environment",
  CODE_GENERATION = "code_generation",
  CONTAINERIZATION = "containerization",
  PERFORMANCE = "performance",
  DOCUMENTATION = "documentation",
  KNOWLEDGE_BASE = "knowledge_base",
  SYSTEM = "system"
}

export interface ToolMetadata {
  name: string;
  displayName: string;
  category: ToolCategory;
  icon: string;
  description: string;
  usageExamples: string[];
  frequencyScore: number; // 0-100, higher means more commonly used
  complexity: "low" | "medium" | "high";
  tags: string[];
  requiredPermissions?: string[];
  relatedTools?: string[];
}

export interface ToolCategoryInfo {
  name: string;
  displayName: string;
  icon: string;
  description: string;
  color: string;
  tools: string[];
}

/**
 * Comprehensive tool metadata registry
 */
export const TOOL_METADATA_REGISTRY: Record<string, ToolMetadata> = {
  // File Operations (High frequency, fundamental)
  "file_read": {
    name: "file_read",
    displayName: "Read File",
    category: ToolCategory.FILE_OPERATIONS,
    icon: "📖",
    description: "Read contents of files in the workspace",
    usageExamples: ["Read configuration files", "Examine source code", "Check log files"],
    frequencyScore: 95,
    complexity: "low",
    tags: ["io", "basic", "essential"],
    relatedTools: ["file_write", "file_list"]
  },
  "file_write": {
    name: "file_write",
    displayName: "Write File",
    category: ToolCategory.FILE_OPERATIONS,
    icon: "✏️",
    description: "Create or modify files in the workspace",
    usageExamples: ["Create new components", "Update configuration", "Generate documentation"],
    frequencyScore: 90,
    complexity: "low",
    tags: ["io", "creation", "essential"],
    requiredPermissions: ["workspace.write"],
    relatedTools: ["file_read", "file_append"]
  },
  "file_list": {
    name: "file_list",
    displayName: "List Files",
    category: ToolCategory.FILE_OPERATIONS,
    icon: "📁",
    description: "List files and directories in the workspace",
    usageExamples: ["Explore project structure", "Find specific files", "Audit workspace"],
    frequencyScore: 85,
    complexity: "low",
    tags: ["io", "navigation", "exploration"],
    relatedTools: ["file_read", "directory_create"]
  },
  "file_append": {
    name: "file_append",
    displayName: "Append to File",
    category: ToolCategory.FILE_OPERATIONS,
    icon: "📝",
    description: "Append content to existing files",
    usageExamples: ["Add to logs", "Extend configuration", "Update documentation"],
    frequencyScore: 70,
    complexity: "low",
    tags: ["io", "modification"],
    relatedTools: ["file_write", "file_read"]
  },
  "directory_create": {
    name: "directory_create",
    displayName: "Create Directory",
    category: ToolCategory.FILE_OPERATIONS,
    icon: "📂",
    description: "Create new directories in the workspace",
    usageExamples: ["Setup project structure", "Organize files", "Create feature folders"],
    frequencyScore: 60,
    complexity: "low",
    tags: ["io", "structure", "organization"],
    relatedTools: ["file_list", "file_write"]
  },

  // Version Control (High frequency, essential for development)
  "git_status": {
    name: "git_status",
    displayName: "Git Status",
    category: ToolCategory.VERSION_CONTROL,
    icon: "📊",
    description: "Check current git repository status",
    usageExamples: ["Review changes", "Check branch status", "Pre-commit validation"],
    frequencyScore: 95,
    complexity: "low",
    tags: ["git", "status", "essential"],
    relatedTools: ["git_add", "git_commit"]
  },
  "git_add": {
    name: "git_add",
    displayName: "Git Add",
    category: ToolCategory.VERSION_CONTROL,
    icon: "➕",
    description: "Stage files for git commit",
    usageExamples: ["Stage modified files", "Add new files", "Selective staging"],
    frequencyScore: 90,
    complexity: "low",
    tags: ["git", "staging"],
    relatedTools: ["git_status", "git_commit"]
  },
  "git_commit": {
    name: "git_commit",
    displayName: "Git Commit",
    category: ToolCategory.VERSION_CONTROL,
    icon: "💾",
    description: "Create git commits with messages",
    usageExamples: ["Save progress", "Create checkpoint", "Document changes"],
    frequencyScore: 85,
    complexity: "medium",
    tags: ["git", "commit", "versioning"],
    relatedTools: ["git_add", "git_log"]
  },
  "git_branch": {
    name: "git_branch",
    displayName: "Git Branch",
    category: ToolCategory.VERSION_CONTROL,
    icon: "🌿",
    description: "Manage git branches",
    usageExamples: ["Create feature branches", "Switch branches", "List branches"],
    frequencyScore: 75,
    complexity: "medium",
    tags: ["git", "branching"],
    relatedTools: ["git_status", "git_log"]
  },
  "git_log": {
    name: "git_log",
    displayName: "Git Log",
    category: ToolCategory.VERSION_CONTROL,
    icon: "📜",
    description: "View git commit history",
    usageExamples: ["Review commit history", "Find specific changes", "Track progress"],
    frequencyScore: 70,
    complexity: "low",
    tags: ["git", "history"],
    relatedTools: ["git_diff", "git_status"]
  },
  "git_diff": {
    name: "git_diff",
    displayName: "Git Diff",
    category: ToolCategory.VERSION_CONTROL,
    icon: "🔍",
    description: "Show differences between commits, files, or branches",
    usageExamples: ["Review changes", "Compare versions", "Debug modifications"],
    frequencyScore: 80,
    complexity: "medium",
    tags: ["git", "comparison"],
    relatedTools: ["git_status", "git_log"]
  },
  "git_stash": {
    name: "git_stash",
    displayName: "Git Stash",
    category: ToolCategory.VERSION_CONTROL,
    icon: "📦",
    description: "Temporarily save uncommitted changes",
    usageExamples: ["Save work in progress", "Switch contexts", "Clean working directory"],
    frequencyScore: 50,
    complexity: "medium",
    tags: ["git", "temporary"],
    relatedTools: ["git_status", "git_branch"]
  },
  "git_remote": {
    name: "git_remote",
    displayName: "Git Remote",
    category: ToolCategory.VERSION_CONTROL,
    icon: "🌐",
    description: "Manage git remote repositories",
    usageExamples: ["Push changes", "Pull updates", "Sync with remote"],
    frequencyScore: 65,
    complexity: "medium",
    tags: ["git", "remote", "sync"],
    relatedTools: ["git_branch", "git_status"]
  },

  // System/Shell Operations (High frequency, versatile)
  "run_shell": {
    name: "run_shell",
    displayName: "Run Shell Command",
    category: ToolCategory.SYSTEM,
    icon: "⚡",
    description: "Execute shell commands and scripts",
    usageExamples: ["Run build scripts", "Execute tests", "System operations"],
    frequencyScore: 88,
    complexity: "medium",
    tags: ["shell", "execution", "system"],
    requiredPermissions: ["system.execute"],
    relatedTools: ["vscode_command", "environment_variable"]
  },
  "vscode_command": {
    name: "vscode_command",
    displayName: "VS Code Command",
    category: ToolCategory.SYSTEM,
    icon: "🔧",
    description: "Execute VS Code editor commands",
    usageExamples: ["Format code", "Open files", "Navigate workspace"],
    frequencyScore: 75,
    complexity: "medium",
    tags: ["vscode", "editor", "automation"],
    relatedTools: ["open_file", "run_shell"]
  },
  "open_file": {
    name: "open_file",
    displayName: "Open File",
    category: ToolCategory.SYSTEM,
    icon: "📄",
    description: "Open files in VS Code editor",
    usageExamples: ["Open source files", "View documentation", "Navigate to definitions"],
    frequencyScore: 80,
    complexity: "low",
    tags: ["navigation", "editor"],
    relatedTools: ["file_read", "vscode_command"]
  },

  // Code Analysis (Medium-high frequency, quality focused)
  "eslint": {
    name: "eslint",
    displayName: "ESLint Analysis",
    category: ToolCategory.CODE_ANALYSIS,
    icon: "🔍",
    description: "Analyze JavaScript/TypeScript code for style and errors",
    usageExamples: ["Code quality checks", "Find syntax errors", "Enforce standards"],
    frequencyScore: 70,
    complexity: "medium",
    tags: ["linting", "quality", "javascript"],
    relatedTools: ["prettier", "typescript_analyzer"]
  },
  "prettier": {
    name: "prettier",
    displayName: "Prettier Format",
    category: ToolCategory.CODE_ANALYSIS,
    icon: "✨",
    description: "Format code according to style guidelines",
    usageExamples: ["Format code", "Fix indentation", "Standardize style"],
    frequencyScore: 65,
    complexity: "low",
    tags: ["formatting", "style"],
    relatedTools: ["eslint", "typescript_analyzer"]
  },
  "typescript_analyzer": {
    name: "typescript_analyzer",
    displayName: "TypeScript Analyzer",
    category: ToolCategory.CODE_ANALYSIS,
    icon: "🔷",
    description: "Analyze TypeScript code for type errors and issues",
    usageExamples: ["Type checking", "Interface validation", "Generic analysis"],
    frequencyScore: 75,
    complexity: "medium",
    tags: ["typescript", "types", "analysis"],
    relatedTools: ["eslint", "complexity_analyzer"]
  },
  "complexity_analyzer": {
    name: "complexity_analyzer",
    displayName: "Complexity Analyzer",
    category: ToolCategory.CODE_ANALYSIS,
    icon: "📊",
    description: "Analyze code complexity and maintainability metrics",
    usageExamples: ["Measure complexity", "Identify refactoring targets", "Quality metrics"],
    frequencyScore: 45,
    complexity: "high",
    tags: ["metrics", "complexity", "quality"],
    relatedTools: ["security_analyzer", "typescript_analyzer"]
  },
  "security_analyzer": {
    name: "security_analyzer",
    displayName: "Security Analyzer",
    category: ToolCategory.CODE_ANALYSIS,
    icon: "🔒",
    description: "Scan code for security vulnerabilities and issues",
    usageExamples: ["Security audit", "Vulnerability scanning", "Best practices"],
    frequencyScore: 55,
    complexity: "high",
    tags: ["security", "vulnerabilities", "audit"],
    relatedTools: ["complexity_analyzer", "package_audit"]
  },

  // Testing (Medium frequency, quality assurance)
  "test_runner": {
    name: "test_runner",
    displayName: "Test Runner",
    category: ToolCategory.TESTING,
    icon: "🧪",
    description: "Execute test suites and individual tests",
    usageExamples: ["Run unit tests", "Execute integration tests", "Continuous testing"],
    frequencyScore: 80,
    complexity: "medium",
    tags: ["testing", "execution", "validation"],
    relatedTools: ["test_generator", "test_coverage"]
  },
  "test_generator": {
    name: "test_generator",
    displayName: "Test Generator",
    category: ToolCategory.TESTING,
    icon: "⚗️",
    description: "Generate test cases and test scaffolding",
    usageExamples: ["Create unit tests", "Generate test templates", "Mock setup"],
    frequencyScore: 60,
    complexity: "high",
    tags: ["generation", "scaffolding", "automation"],
    relatedTools: ["test_runner", "component_generator"]
  },
  "test_coverage": {
    name: "test_coverage",
    displayName: "Test Coverage",
    category: ToolCategory.TESTING,
    icon: "📈",
    description: "Analyze test coverage metrics and reports",
    usageExamples: ["Coverage reports", "Identify untested code", "Quality metrics"],
    frequencyScore: 55,
    complexity: "medium",
    tags: ["coverage", "metrics", "quality"],
    relatedTools: ["test_runner", "complexity_analyzer"]
  },

  // Package Management (Medium frequency, dependency management)
  "package_install": {
    name: "package_install",
    displayName: "Package Install",
    category: ToolCategory.PACKAGE_MANAGEMENT,
    icon: "📦",
    description: "Install npm packages and dependencies",
    usageExamples: ["Add dependencies", "Install dev tools", "Package setup"],
    frequencyScore: 70,
    complexity: "low",
    tags: ["npm", "dependencies", "installation"],
    relatedTools: ["package_update", "dependency_analyzer"]
  },
  "package_update": {
    name: "package_update",
    displayName: "Package Update",
    category: ToolCategory.PACKAGE_MANAGEMENT,
    icon: "🔄",
    description: "Update packages to latest versions",
    usageExamples: ["Update dependencies", "Security updates", "Version management"],
    frequencyScore: 50,
    complexity: "medium",
    tags: ["npm", "updates", "maintenance"],
    relatedTools: ["package_install", "package_audit"]
  },
  "package_audit": {
    name: "package_audit",
    displayName: "Package Audit",
    category: ToolCategory.PACKAGE_MANAGEMENT,
    icon: "🛡️",
    description: "Audit packages for security vulnerabilities",
    usageExamples: ["Security audit", "Vulnerability scanning", "Dependency health"],
    frequencyScore: 45,
    complexity: "medium",
    tags: ["security", "audit", "vulnerabilities"],
    relatedTools: ["package_update", "security_analyzer"]
  },
  "dependency_analyzer": {
    name: "dependency_analyzer",
    displayName: "Dependency Analyzer",
    category: ToolCategory.PACKAGE_MANAGEMENT,
    icon: "🕸️",
    description: "Analyze project dependencies and relationships",
    usageExamples: ["Dependency trees", "Unused packages", "Circular dependencies"],
    frequencyScore: 40,
    complexity: "high",
    tags: ["analysis", "dependencies", "optimization"],
    relatedTools: ["package_install", "bundle_analyzer"]
  },

  // Network Tools (Lower frequency, specialized)
  "http_request": {
    name: "http_request",
    displayName: "HTTP Request",
    category: ToolCategory.NETWORK,
    icon: "🌐",
    description: "Make HTTP requests to APIs and services",
    usageExamples: ["Test APIs", "Fetch data", "Integration testing"],
    frequencyScore: 55,
    complexity: "medium",
    tags: ["http", "api", "networking"],
    relatedTools: ["api_test", "health_check"]
  },
  "api_test": {
    name: "api_test",
    displayName: "API Test",
    category: ToolCategory.NETWORK,
    icon: "🧪",
    description: "Test API endpoints and responses",
    usageExamples: ["API validation", "Response testing", "Integration checks"],
    frequencyScore: 50,
    complexity: "medium",
    tags: ["api", "testing", "validation"],
    relatedTools: ["http_request", "test_runner"]
  },
  "health_check": {
    name: "health_check",
    displayName: "Health Check",
    category: ToolCategory.NETWORK,
    icon: "💓",
    description: "Check health and status of services",
    usageExamples: ["Service monitoring", "Uptime checks", "System status"],
    frequencyScore: 35,
    complexity: "low",
    tags: ["monitoring", "health", "status"],
    relatedTools: ["http_request", "port_scan"]
  },
  "port_scan": {
    name: "port_scan",
    displayName: "Port Scanner",
    category: ToolCategory.NETWORK,
    icon: "🔍",
    description: "Scan network ports and services",
    usageExamples: ["Network discovery", "Port availability", "Service detection"],
    frequencyScore: 25,
    complexity: "medium",
    tags: ["networking", "scanning", "discovery"],
    relatedTools: ["health_check", "http_request"]
  },

  // Environment Management (Medium frequency, configuration)
  "environment_variable": {
    name: "environment_variable",
    displayName: "Environment Variables",
    category: ToolCategory.ENVIRONMENT,
    icon: "🌍",
    description: "Manage environment variables and configuration",
    usageExamples: ["Set config values", "Manage secrets", "Environment setup"],
    frequencyScore: 60,
    complexity: "low",
    tags: ["config", "environment", "variables"],
    relatedTools: ["environment_validator", "process_environment"]
  },
  "environment_validator": {
    name: "environment_validator",
    displayName: "Environment Validator",
    category: ToolCategory.ENVIRONMENT,
    icon: "✅",
    description: "Validate environment configuration and requirements",
    usageExamples: ["Config validation", "Requirement checks", "Setup verification"],
    frequencyScore: 40,
    complexity: "medium",
    tags: ["validation", "config", "requirements"],
    relatedTools: ["environment_variable", "health_check"]
  },
  "process_environment": {
    name: "process_environment",
    displayName: "Process Environment",
    category: ToolCategory.ENVIRONMENT,
    icon: "⚙️",
    description: "Manage process-level environment settings",
    usageExamples: ["Process config", "Runtime settings", "System integration"],
    frequencyScore: 35,
    complexity: "medium",
    tags: ["process", "runtime", "system"],
    relatedTools: ["environment_variable", "run_shell"]
  },

  // Code Generation (Medium-low frequency, productivity)
  "component_generator": {
    name: "component_generator",
    displayName: "Component Generator",
    category: ToolCategory.CODE_GENERATION,
    icon: "🏗️",
    description: "Generate code components and boilerplate",
    usageExamples: ["Create React components", "Generate classes", "Boilerplate code"],
    frequencyScore: 50,
    complexity: "high",
    tags: ["generation", "components", "scaffolding"],
    relatedTools: ["project_scaffold", "test_generator"]
  },
  "project_scaffold": {
    name: "project_scaffold",
    displayName: "Project Scaffold",
    category: ToolCategory.CODE_GENERATION,
    icon: "🏗️",
    description: "Generate complete project structures and templates",
    usageExamples: ["New project setup", "Template creation", "Architecture scaffolding"],
    frequencyScore: 30,
    complexity: "high",
    tags: ["scaffolding", "templates", "architecture"],
    relatedTools: ["component_generator", "directory_create"]
  },

  // Performance Tools (Lower frequency, optimization)
  "node_profiler": {
    name: "node_profiler",
    displayName: "Node.js Profiler",
    category: ToolCategory.PERFORMANCE,
    icon: "📊",
    description: "Profile Node.js application performance",
    usageExamples: ["Performance analysis", "Memory profiling", "CPU optimization"],
    frequencyScore: 30,
    complexity: "high",
    tags: ["profiling", "performance", "nodejs"],
    relatedTools: ["bundle_analyzer", "lighthouse_performance"]
  },
  "bundle_analyzer": {
    name: "bundle_analyzer",
    displayName: "Bundle Analyzer",
    category: ToolCategory.PERFORMANCE,
    icon: "📦",
    description: "Analyze JavaScript bundle size and composition",
    usageExamples: ["Bundle optimization", "Size analysis", "Dependency tracking"],
    frequencyScore: 35,
    complexity: "medium",
    tags: ["bundling", "optimization", "analysis"],
    relatedTools: ["dependency_analyzer", "node_profiler"]
  },
  "lighthouse_performance": {
    name: "lighthouse_performance",
    displayName: "Lighthouse Performance",
    category: ToolCategory.PERFORMANCE,
    icon: "🚨",
    description: "Run Lighthouse performance audits",
    usageExamples: ["Web performance", "SEO analysis", "Accessibility audit"],
    frequencyScore: 25,
    complexity: "medium",
    tags: ["lighthouse", "performance", "web"],
    relatedTools: ["bundle_analyzer", "node_profiler"]
  },

  // Documentation Tools (Medium-low frequency, documentation)
  "doc_search": {
    name: "doc_search",
    displayName: "Documentation Search",
    category: ToolCategory.DOCUMENTATION,
    icon: "🔍",
    description: "Search through project documentation",
    usageExamples: ["Find documentation", "Search guides", "Locate references"],
    frequencyScore: 45,
    complexity: "low",
    tags: ["search", "documentation", "reference"],
    relatedTools: ["doc_update", "knowledge_query"]
  },
  "doc_update": {
    name: "doc_update",
    displayName: "Documentation Update",
    category: ToolCategory.DOCUMENTATION,
    icon: "📝",
    description: "Update and maintain project documentation",
    usageExamples: ["Update README", "Modify guides", "Documentation maintenance"],
    frequencyScore: 40,
    complexity: "medium",
    tags: ["documentation", "maintenance", "writing"],
    relatedTools: ["doc_search", "doc_index"]
  },
  "doc_index": {
    name: "doc_index",
    displayName: "Documentation Index",
    category: ToolCategory.DOCUMENTATION,
    icon: "📚",
    description: "Index and organize documentation structure",
    usageExamples: ["Create indexes", "Organize docs", "Structure documentation"],
    frequencyScore: 30,
    complexity: "medium",
    tags: ["indexing", "organization", "structure"],
    relatedTools: ["doc_search", "doc_summary"]
  },
  "doc_summary": {
    name: "doc_summary",
    displayName: "Documentation Summary",
    category: ToolCategory.DOCUMENTATION,
    icon: "📄",
    description: "Generate summaries of documentation content",
    usageExamples: ["Create summaries", "Extract key points", "Documentation overview"],
    frequencyScore: 35,
    complexity: "medium",
    tags: ["summary", "extraction", "overview"],
    relatedTools: ["doc_search", "knowledge_add"]
  },

  // Containerization (Lower frequency, DevOps)
  "docker_container": {
    name: "docker_container",
    displayName: "Docker Container",
    category: ToolCategory.CONTAINERIZATION,
    icon: "🐳",
    description: "Manage Docker containers",
    usageExamples: ["Start containers", "Container management", "Runtime operations"],
    frequencyScore: 40,
    complexity: "medium",
    tags: ["docker", "containers", "runtime"],
    relatedTools: ["docker_image", "docker_compose"]
  },
  "docker_image": {
    name: "docker_image",
    displayName: "Docker Image",
    category: ToolCategory.CONTAINERIZATION,
    icon: "📦",
    description: "Manage Docker images and builds",
    usageExamples: ["Build images", "Image management", "Registry operations"],
    frequencyScore: 35,
    complexity: "medium",
    tags: ["docker", "images", "building"],
    relatedTools: ["docker_container", "docker_compose"]
  },
  "docker_compose": {
    name: "docker_compose",
    displayName: "Docker Compose",
    category: ToolCategory.CONTAINERIZATION,
    icon: "🏗️",
    description: "Manage multi-container Docker applications",
    usageExamples: ["Multi-container apps", "Service orchestration", "Development environments"],
    frequencyScore: 30,
    complexity: "high",
    tags: ["docker", "compose", "orchestration"],
    relatedTools: ["docker_container", "docker_image"]
  },

  // Knowledge Base (Lower frequency, specialized)
  "knowledge_query": {
    name: "knowledge_query",
    displayName: "Knowledge Query",
    category: ToolCategory.KNOWLEDGE_BASE,
    icon: "🧠",
    description: "Query the knowledge base for information",
    usageExamples: ["Search knowledge", "Find solutions", "Retrieve information"],
    frequencyScore: 50,
    complexity: "low",
    tags: ["knowledge", "search", "query"],
    relatedTools: ["knowledge_add", "doc_search"]
  },
  "knowledge_add": {
    name: "knowledge_add",
    displayName: "Knowledge Add",
    category: ToolCategory.KNOWLEDGE_BASE,
    icon: "➕",
    description: "Add new information to the knowledge base",
    usageExamples: ["Store solutions", "Add documentation", "Capture knowledge"],
    frequencyScore: 35,
    complexity: "medium",
    tags: ["knowledge", "storage", "documentation"],
    relatedTools: ["knowledge_query", "knowledge_update"]
  },
  "knowledge_update": {
    name: "knowledge_update",
    displayName: "Knowledge Update",
    category: ToolCategory.KNOWLEDGE_BASE,
    icon: "🔄",
    description: "Update existing knowledge base entries",
    usageExamples: ["Update information", "Refine knowledge", "Maintain accuracy"],
    frequencyScore: 25,
    complexity: "medium",
    tags: ["knowledge", "maintenance", "updates"],
    relatedTools: ["knowledge_add", "knowledge_delete"]
  },
  "knowledge_list": {
    name: "knowledge_list",
    displayName: "Knowledge List",
    category: ToolCategory.KNOWLEDGE_BASE,
    icon: "📋",
    description: "List and browse knowledge base entries",
    usageExamples: ["Browse knowledge", "List entries", "Explore content"],
    frequencyScore: 30,
    complexity: "low",
    tags: ["knowledge", "browsing", "navigation"],
    relatedTools: ["knowledge_query", "knowledge_delete"]
  },
  "knowledge_delete": {
    name: "knowledge_delete",
    displayName: "Knowledge Delete",
    category: ToolCategory.KNOWLEDGE_BASE,
    icon: "🗑️",
    description: "Remove entries from the knowledge base",
    usageExamples: ["Clean up knowledge", "Remove outdated info", "Maintain quality"],
    frequencyScore: 20,
    complexity: "low",
    tags: ["knowledge", "cleanup", "maintenance"],
    relatedTools: ["knowledge_list", "knowledge_update"]
  },
  "knowledge_import": {
    name: "knowledge_import",
    displayName: "Knowledge Import",
    category: ToolCategory.KNOWLEDGE_BASE,
    icon: "📥",
    description: "Import external knowledge into the knowledge base",
    usageExamples: ["Import documentation", "Bulk knowledge addition", "External integration"],
    frequencyScore: 15,
    complexity: "high",
    tags: ["knowledge", "import", "integration"],
    relatedTools: ["knowledge_add", "doc_index"]
  },

  // Specialized Tools
  "tech_stack_analyzer": {
    name: "tech_stack_analyzer",
    displayName: "Tech Stack Analyzer",
    category: ToolCategory.CODE_ANALYSIS,
    icon: "🔬",
    description: "Analyze project technology stack and dependencies",
    usageExamples: ["Stack analysis", "Technology audit", "Architecture review"],
    frequencyScore: 35,
    complexity: "high",
    tags: ["analysis", "technology", "architecture"],
    relatedTools: ["dependency_analyzer", "complexity_analyzer"]
  }
};

/**
 * Category information for grouping and display
 */
export const TOOL_CATEGORIES: Record<ToolCategory, ToolCategoryInfo> = {
  [ToolCategory.FILE_OPERATIONS]: {
    name: ToolCategory.FILE_OPERATIONS,
    displayName: "File Operations",
    icon: "📁",
    description: "File and directory management tools",
    color: "#4CAF50",
    tools: ["file_read", "file_write", "file_list", "file_append", "directory_create"]
  },
  [ToolCategory.VERSION_CONTROL]: {
    name: ToolCategory.VERSION_CONTROL,
    displayName: "Version Control",
    icon: "🌿",
    description: "Git and version management tools",
    color: "#FF9800",
    tools: ["git_status", "git_add", "git_commit", "git_branch", "git_log", "git_diff", "git_stash", "git_remote"]
  },
  [ToolCategory.CODE_ANALYSIS]: {
    name: ToolCategory.CODE_ANALYSIS,
    displayName: "Code Analysis",
    icon: "🔍",
    description: "Code quality, linting, and analysis tools",
    color: "#2196F3",
    tools: ["eslint", "prettier", "typescript_analyzer", "complexity_analyzer", "security_analyzer", "tech_stack_analyzer"]
  },
  [ToolCategory.TESTING]: {
    name: ToolCategory.TESTING,
    displayName: "Testing",
    icon: "🧪",
    description: "Test execution, generation, and coverage tools",
    color: "#9C27B0",
    tools: ["test_runner", "test_generator", "test_coverage"]
  },
  [ToolCategory.PACKAGE_MANAGEMENT]: {
    name: ToolCategory.PACKAGE_MANAGEMENT,
    displayName: "Package Management",
    icon: "📦",
    description: "Package installation, updates, and dependency management",
    color: "#795548",
    tools: ["package_install", "package_update", "package_audit", "dependency_analyzer"]
  },
  [ToolCategory.NETWORK]: {
    name: ToolCategory.NETWORK,
    displayName: "Network & API",
    icon: "🌐",
    description: "HTTP requests, API testing, and network tools",
    color: "#00BCD4",
    tools: ["http_request", "api_test", "health_check", "port_scan"]
  },
  [ToolCategory.ENVIRONMENT]: {
    name: ToolCategory.ENVIRONMENT,
    displayName: "Environment",
    icon: "🌍",
    description: "Environment variables and configuration management",
    color: "#8BC34A",
    tools: ["environment_variable", "environment_validator", "process_environment"]
  },
  [ToolCategory.CODE_GENERATION]: {
    name: ToolCategory.CODE_GENERATION,
    displayName: "Code Generation",
    icon: "🏗️",
    description: "Code scaffolding and generation tools",
    color: "#673AB7",
    tools: ["component_generator", "project_scaffold"]
  },
  [ToolCategory.CONTAINERIZATION]: {
    name: ToolCategory.CONTAINERIZATION,
    displayName: "Containerization",
    icon: "🐳",
    description: "Docker and container management tools",
    color: "#607D8B",
    tools: ["docker_container", "docker_image", "docker_compose"]
  },
  [ToolCategory.PERFORMANCE]: {
    name: ToolCategory.PERFORMANCE,
    displayName: "Performance",
    icon: "📊",
    description: "Performance analysis and optimization tools",
    color: "#E91E63",
    tools: ["node_profiler", "bundle_analyzer", "lighthouse_performance"]
  },
  [ToolCategory.DOCUMENTATION]: {
    name: ToolCategory.DOCUMENTATION,
    displayName: "Documentation",
    icon: "📚",
    description: "Documentation management and generation tools",
    color: "#3F51B5",
    tools: ["doc_search", "doc_update", "doc_index", "doc_summary"]
  },
  [ToolCategory.KNOWLEDGE_BASE]: {
    name: ToolCategory.KNOWLEDGE_BASE,
    displayName: "Knowledge Base",
    icon: "🧠",
    description: "Knowledge storage and retrieval tools",
    color: "#009688",
    tools: ["knowledge_query", "knowledge_add", "knowledge_update", "knowledge_list", "knowledge_delete", "knowledge_import"]
  },
  [ToolCategory.SYSTEM]: {
    name: ToolCategory.SYSTEM,
    displayName: "System",
    icon: "⚙️",
    description: "System commands and VS Code integration",
    color: "#FFC107",
    tools: ["run_shell", "vscode_command", "open_file"]
  }
};

/**
 * Get metadata for a specific tool
 */
export function getToolMetadata(toolName: string): ToolMetadata | undefined {
  return TOOL_METADATA_REGISTRY[toolName];
}

/**
 * Get all tools in a specific category
 */
export function getToolsByCategory(category: ToolCategory): ToolMetadata[] {
  return Object.values(TOOL_METADATA_REGISTRY).filter(tool => tool.category === category);
}

/**
 * Get tools sorted by frequency score
 */
export function getToolsByFrequency(limit?: number): ToolMetadata[] {
  const sorted = Object.values(TOOL_METADATA_REGISTRY)
    .sort((a, b) => b.frequencyScore - a.frequencyScore);
  
  return limit ? sorted.slice(0, limit) : sorted;
}

/**
 * Search tools by tags or description
 */
export function searchTools(query: string): ToolMetadata[] {
  const lowerQuery = query.toLowerCase();
  return Object.values(TOOL_METADATA_REGISTRY).filter(tool => 
    tool.name.toLowerCase().includes(lowerQuery) ||
    tool.displayName.toLowerCase().includes(lowerQuery) ||
    tool.description.toLowerCase().includes(lowerQuery) ||
    tool.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Get category information
 */
export function getCategoryInfo(category: ToolCategory): ToolCategoryInfo {
  return TOOL_CATEGORIES[category];
}

/**
 * Get all categories with their tool counts
 */
export function getAllCategoriesWithCounts(): Array<ToolCategoryInfo & { toolCount: number }> {
  return Object.values(TOOL_CATEGORIES).map(category => ({
    ...category,
    toolCount: getToolsByCategory(category.name as ToolCategory).length
  }));
}