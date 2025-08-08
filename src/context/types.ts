/**
 * Core types and interfaces for the context system
 */

export enum ContextType {
  LONG_TERM = "long_term",
  PROJECT = "project", 
  TASK = "task",
  CHAT = "chat",
  SESSION = "session",
  DOCUMENTATION = "documentation",
  CODE = "code",
  DEPENDENCY = "dependency",
  CONVERSATION = "conversation",
  LEARNING = "learning"
}

export enum ContextPriority {
  VERY_LOW = 0,
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4
}

export enum ContextSource {
  USER_INPUT = "user_input",
  CODE_ANALYSIS = "code_analysis", 
  DOCUMENTATION = "documentation",
  ERROR_RECOVERY = "error_recovery",
  SUCCESS_PATTERN = "success_pattern",
  FILE_SYSTEM = "file_system",
  GIT_HISTORY = "git_history",
  CONVERSATION = "conversation",
  USER_MESSAGE = "user_message",
  AGENT_ACTION = "agent_action", 
  TOOL_USAGE = "tool_usage",
  PROJECT_ANALYSIS = "project_analysis",
  CHAT_MESSAGE = "chat_message",
  TASK_ATTEMPT = "task_attempt",
  SESSION_STATE = "session_state",
  LEARNING = "learning",
  CONSOLIDATED_LEARNING = "consolidated_learning",
  SYSTEM = "system",
  CHAT = "chat"
}

export interface ContextItem {
  id: string;
  type: ContextType;
  source: ContextSource;
  content: string;
  metadata: Record<string, any>;
  relevanceScore: number;
  priority: ContextPriority;
  timestamp: Date;
  expiresAt?: Date;
  tags: string[];
  projectId?: string;
  sessionId?: string;
  taskId?: string;
  chatId?: string;
}

export interface ContextQuery {
  query?: string;
  text?: string;
  types?: ContextType[];
  sources?: ContextSource[];
  projectId?: string;
  sessionId?: string;
  taskId?: string;
  chatId?: string;
  maxResults?: number;
  minRelevanceScore?: number;
  minPriority?: ContextPriority;
  timeRange?: {
    start: Date;
    end: Date;
  };
  tags?: string[];
  fileTypes?: string[];
  includeWorkspace?: boolean;
}

export interface ContextSearchResult {
  items: ContextItem[];
  totalCount: number;
  searchTime?: number;
  strategy?: string;
  query?: string;
  metadata?: Record<string, any>;
  error?: string;
}

export interface ContextStrategy {
  name: string;
  priority: number;
  canHandle(query: ContextQuery): boolean;
  search(query: ContextQuery): Promise<ContextSearchResult>;
}

export interface ContextConfig {
  maxContextWindow: number;
  defaultStrategy: string;
  enableSemanticSearch: boolean;
  vectorDimensions: number;
  cacheSize: number;
  cleanupInterval: number;
  retentionPeriod: number;
}

export interface ProjectMetadata {
  projectId: string;
  name: string;
  path: string;
  language: string[];
  framework: string[];
  dependencies: string[];
  lastAnalyzed: Date;
  fileCount: number;
  codebaseSize: number;
}

export interface TaskMetadata {
  taskId: string;
  description: string;
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'completed' | 'failed' | 'abandoned';
  attempts: number;
  lastError?: string;
  successPattern?: string;
}

export interface ChatMetadata {
  chatId: string;
  sessionId: string;
  messageCount: number;
  participants: string[];
  topic?: string;
  lastActivity: Date;
  conversationFlow: ConversationTurn[];
}

export interface ConversationTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  intent?: string;
  entities?: Record<string, any>;
  references?: string[];
}

export interface LearningPattern {
  id: string;
  pattern: string;
  category: 'success' | 'failure' | 'technique' | 'antipattern';
  context: string;
  frequency: number;
  lastSeen: Date;
  projects: string[];
  tags: string[];
  confidence: number;
}

export interface ContextEvent {
  type: 'add' | 'update' | 'remove' | 'search' | 'consolidate';
  contextId?: string;
  query?: ContextQuery;
  result?: ContextSearchResult;
  error?: Error;
  timestamp: Date;
  duration?: number;
}

export type ContextEventHandler = (event: ContextEvent) => void;