import { AgentSpecialization, AgentCapability } from "./IAgent";

export interface AgentDisplayInfo {
  specialization: AgentSpecialization;
  displayName: string;
  description: string;
  icon: string;
  capabilities: AgentCapability[];
  primaryTools: string[];
  useCases: string[];
  color: string;
}

export const AGENT_METADATA: Record<AgentSpecialization, AgentDisplayInfo> = {
  [AgentSpecialization.GENERAL]: {
    specialization: AgentSpecialization.GENERAL,
    displayName: "General Agent",
    description: "Versatile AI assistant for general coding tasks and queries",
    icon: "🤖",
    capabilities: [
      {
        name: "General Programming",
        description: "Handle diverse coding tasks across languages and frameworks",
        toolsRequired: ["file_read", "file_write", "run_shell"],
        confidenceThreshold: 0.5
      },
      {
        name: "Problem Solving",
        description: "Analyze and solve complex programming problems",
        toolsRequired: ["code_analysis", "file_list"],
        confidenceThreshold: 0.6
      },
      {
        name: "Tool Coordination",
        description: "Intelligently use available tools to complete tasks",
        toolsRequired: ["*"],
        confidenceThreshold: 0.7
      }
    ],
    primaryTools: ["file_read", "file_write", "file_list", "run_shell", "vscode_command"],
    useCases: [
      "General coding assistance",
      "Code explanation and debugging",
      "File operations and management",
      "Command line operations",
      "Cross-domain tasks"
    ],
    color: "#007ACC"
  },

  [AgentSpecialization.CODE_REVIEW]: {
    specialization: AgentSpecialization.CODE_REVIEW,
    displayName: "Code Review Agent",
    description: "Specialized in code quality, security analysis, and best practices",
    icon: "🔍",
    capabilities: [
      {
        name: "Code Quality Analysis",
        description: "Identify code quality issues and suggest improvements",
        toolsRequired: ["eslint", "complexity_analyzer"],
        confidenceThreshold: 0.8
      },
      {
        name: "Security Scanning",
        description: "Detect security vulnerabilities and potential threats",
        toolsRequired: ["security_analyzer", "dependency_analyzer"],
        confidenceThreshold: 0.85
      },
      {
        name: "Best Practices Review",
        description: "Ensure code follows established patterns and conventions",
        toolsRequired: ["typescript_analyzer", "prettier"],
        confidenceThreshold: 0.8
      }
    ],
    primaryTools: ["eslint", "prettier", "typescript_analyzer", "complexity_analyzer", "security_analyzer"],
    useCases: [
      "Code review and quality assessment",
      "Security vulnerability scanning",
      "Best practices enforcement",
      "Dependency analysis",
      "Refactoring recommendations"
    ],
    color: "#FF6B6B"
  },

  [AgentSpecialization.TEST_AUTOMATION]: {
    specialization: AgentSpecialization.TEST_AUTOMATION,
    displayName: "Test Automation Agent",
    description: "Expert in test generation, TDD workflows, and coverage analysis",
    icon: "🧪",
    capabilities: [
      {
        name: "Test Generation",
        description: "Generate comprehensive unit and integration tests",
        toolsRequired: ["test_generator", "file_write"],
        confidenceThreshold: 0.8
      },
      {
        name: "Test Execution",
        description: "Run test suites and analyze results",
        toolsRequired: ["test_runner", "test_coverage"],
        confidenceThreshold: 0.85
      },
      {
        name: "TDD Workflow",
        description: "Guide test-driven development processes",
        toolsRequired: ["test_generator", "test_runner", "file_write"],
        confidenceThreshold: 0.8
      }
    ],
    primaryTools: ["test_runner", "test_generator", "test_coverage"],
    useCases: [
      "Unit test generation",
      "Integration test setup",
      "Test coverage analysis",
      "TDD workflow guidance",
      "Test suite optimization"
    ],
    color: "#4ECDC4"
  },

  [AgentSpecialization.DEVOPS]: {
    specialization: AgentSpecialization.DEVOPS,
    displayName: "DevOps Agent",
    description: "Specialized in Git operations, CI/CD, and deployment workflows",
    icon: "⚙️",
    capabilities: [
      {
        name: "Git Operations",
        description: "Advanced Git workflow management and operations",
        toolsRequired: ["git_status", "git_commit", "git_branch"],
        confidenceThreshold: 0.8
      },
      {
        name: "CI/CD Pipeline",
        description: "Setup and manage continuous integration and deployment",
        toolsRequired: ["docker_container", "docker_compose"],
        confidenceThreshold: 0.75
      },
      {
        name: "Environment Management",
        description: "Configure and manage deployment environments",
        toolsRequired: ["environment_variable", "docker_image"],
        confidenceThreshold: 0.8
      }
    ],
    primaryTools: ["git_status", "git_commit", "git_branch", "docker_container", "docker_compose", "environment_variable"],
    useCases: [
      "Git workflow automation",
      "Branch management",
      "CI/CD pipeline setup",
      "Docker containerization",
      "Environment configuration"
    ],
    color: "#45B7D1"
  },

  [AgentSpecialization.DOCUMENTATION]: {
    specialization: AgentSpecialization.DOCUMENTATION,
    displayName: "Documentation Agent",
    description: "Expert in creating and managing project documentation",
    icon: "📚",
    capabilities: [
      {
        name: "Documentation Generation",
        description: "Create comprehensive project documentation",
        toolsRequired: ["file_write", "doc_search", "tech_stack_analyzer"],
        confidenceThreshold: 0.8
      },
      {
        name: "API Documentation",
        description: "Generate API documentation from code",
        toolsRequired: ["file_read", "typescript_analyzer"],
        confidenceThreshold: 0.85
      },
      {
        name: "Knowledge Management",
        description: "Organize and maintain project knowledge base",
        toolsRequired: ["knowledge_add", "knowledge_query", "doc_index"],
        confidenceThreshold: 0.8
      }
    ],
    primaryTools: ["doc_search", "doc_update", "doc_index", "knowledge_add", "knowledge_query", "tech_stack_analyzer"],
    useCases: [
      "README generation",
      "API documentation",
      "Changelog management",
      "Knowledge base creation",
      "Documentation maintenance"
    ],
    color: "#96CEB4"
  },

  [AgentSpecialization.REFACTORING]: {
    specialization: AgentSpecialization.REFACTORING,
    displayName: "Refactoring Agent",
    description: "Specialized in code improvement and architecture optimization",
    icon: "🔧",
    capabilities: [
      {
        name: "Code Refactoring",
        description: "Improve code structure and maintainability",
        toolsRequired: ["file_read", "file_write", "complexity_analyzer"],
        confidenceThreshold: 0.8
      },
      {
        name: "Performance Optimization",
        description: "Optimize code performance and efficiency",
        toolsRequired: ["node_profiler", "bundle_analyzer"],
        confidenceThreshold: 0.85
      },
      {
        name: "Architecture Improvement",
        description: "Enhance overall code architecture and patterns",
        toolsRequired: ["typescript_analyzer", "dependency_analyzer"],
        confidenceThreshold: 0.8
      }
    ],
    primaryTools: ["complexity_analyzer", "node_profiler", "bundle_analyzer", "typescript_analyzer", "dependency_analyzer"],
    useCases: [
      "Code structure improvement",
      "Performance optimization",
      "Design pattern implementation",
      "Architecture refactoring",
      "Legacy code modernization"
    ],
    color: "#FECA57"
  },

  // Foundation agent specializations (internal agents)
  [AgentSpecialization.QUERY_REWRITER]: {
    specialization: AgentSpecialization.QUERY_REWRITER,
    displayName: "Query Rewriter",
    description: "Internal agent for query optimization and expansion",
    icon: "🔍",
    capabilities: [],
    primaryTools: [],
    useCases: [],
    color: "#6366f1"
  },

  [AgentSpecialization.RETRIEVER]: {
    specialization: AgentSpecialization.RETRIEVER,
    displayName: "Retriever Agent",
    description: "Internal agent for semantic content retrieval",
    icon: "📚",
    capabilities: [],
    primaryTools: [],
    useCases: [],
    color: "#8b5cf6"
  },

  [AgentSpecialization.RERANKER]: {
    specialization: AgentSpecialization.RERANKER,
    displayName: "Reranker Agent",
    description: "Internal agent for content relevance scoring",
    icon: "📊",
    capabilities: [],
    primaryTools: [],
    useCases: [],
    color: "#a855f7"
  },

  [AgentSpecialization.CHUNK_SCORER]: {
    specialization: AgentSpecialization.CHUNK_SCORER,
    displayName: "Chunk Scorer",
    description: "Internal agent for chunk relevance scoring",
    icon: "🎯",
    capabilities: [],
    primaryTools: [],
    useCases: [],
    color: "#c084fc"
  },

  [AgentSpecialization.TASK_PLANNER]: {
    specialization: AgentSpecialization.TASK_PLANNER,
    displayName: "Task Planner",
    description: "Internal agent for task decomposition and planning",
    icon: "📋",
    capabilities: [],
    primaryTools: [],
    useCases: [],
    color: "#ec4899"
  },

  [AgentSpecialization.TOOL_SELECTOR]: {
    specialization: AgentSpecialization.TOOL_SELECTOR,
    displayName: "Tool Selector",
    description: "Internal agent for intelligent tool selection",
    icon: "🔧",
    capabilities: [],
    primaryTools: [],
    useCases: [],
    color: "#f97316"
  },

  [AgentSpecialization.COT_GENERATOR]: {
    specialization: AgentSpecialization.COT_GENERATOR,
    displayName: "CoT Generator",
    description: "Internal agent for chain-of-thought reasoning",
    icon: "🧠",
    capabilities: [],
    primaryTools: [],
    useCases: [],
    color: "#eab308"
  },

  [AgentSpecialization.ACTION_CALLER]: {
    specialization: AgentSpecialization.ACTION_CALLER,
    displayName: "Action Caller",
    description: "Internal agent for action execution",
    icon: "⚡",
    capabilities: [],
    primaryTools: [],
    useCases: [],
    color: "#22c55e"
  },

  [AgentSpecialization.CRITIC]: {
    specialization: AgentSpecialization.CRITIC,
    displayName: "Critic Agent",
    description: "Internal agent for quality evaluation and feedback",
    icon: "🎭",
    capabilities: [],
    primaryTools: [],
    useCases: [],
    color: "#dc2626"
  },

  [AgentSpecialization.EMBEDDER]: {
    specialization: AgentSpecialization.EMBEDDER,
    displayName: "Embedder Agent",
    description: "Internal agent for vector operations and embeddings",
    icon: "🔢",
    capabilities: [],
    primaryTools: [],
    useCases: [],
    color: "#0891b2"
  }
};

export function getAgentDisplayInfo(specialization: AgentSpecialization): AgentDisplayInfo {
  return AGENT_METADATA[specialization];
}

export function getAllAgentDisplayInfo(): AgentDisplayInfo[] {
  return Object.values(AGENT_METADATA);
}

export function getAgentIcon(specialization: AgentSpecialization): string {
  return AGENT_METADATA[specialization]?.icon || "🤖";
}

export function getAgentColor(specialization: AgentSpecialization): string {
  return AGENT_METADATA[specialization]?.color || "#007ACC";
}