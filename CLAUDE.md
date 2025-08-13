# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Build/Compile**: `npm run compile` or `tsc -p ./`
- **Watch mode**: `npm run watch` - compiles TypeScript automatically on changes  
- **Lint**: `npm run lint` - runs ESLint on src files
- **Test**: `npm run test` - runs all tests (requires pretest compilation and linting)
- **Package for publishing**: `npm run vscode:prepublish`

The extension uses TypeScript and compiles to the `out/` directory. **Use pnpm for package management** to avoid dependency conflicts with ChromaDB and other dependencies.

## Critical System Architecture Patterns

### Singleton Factories with Thread Safety
Both `FoundationAgentFactory` and `OptimizedFoundationAgentFactory` implement singleton patterns with thread-safe creation locks to prevent race conditions and infinite initialization loops:

```typescript
// Thread-safe singleton with instance key validation
public static getInstance(dependencies?: FoundationAgentDependencies): FoundationAgentFactory {
  const newKey = dependencies ? `${dependencies.ollamaUrl}|${dependencies.model}` : 'default';
  if (FoundationAgentFactory.instance && FoundationAgentFactory.instanceKey === newKey) {
    return FoundationAgentFactory.instance;
  }
  // Create new instance with configuration validation
}
```

### Parameter Enhancement System  
The `ActionCallerAgent` includes sophisticated parameter enhancement to fix undefined/missing tool parameters:

```typescript
// Context-aware parameter inference for tools like file_write
private enhanceParameters(toolId: string, parameters: any, originalPlan: TaskStep): any {
  if (toolId === 'file_write' && !parameters.filePath) {
    parameters.filePath = this.inferFilePathFromTask(originalPlan);
  }
  if (!parameters.content && toolId === 'file_write') {
    parameters.content = this.inferContentFromTask(originalPlan);  
  }
}
```

### Pipeline Dependency Management
The foundation pipeline uses strict stage dependencies to ensure proper execution order:

```typescript
this.stages.set('tool_selection', {
  dependencies: ['expand'], // Depends on query expansion stage
  // NOT ['query_rewriting'] - this was causing pipeline failures
});
```

## Architecture Overview

This is a VS Code extension that provides an intelligent coding agent powered by Ollama (local LLMs). The architecture follows a modular design with clear separation of concerns:

### Core Components

**Agent System** (`src/agents/`):

- **Foundation Agentic Architecture**: 10-agent foundation system implementing **Query → Expand → Retrieve → Rerank → Score → Plan → Reason → Generate Actions → Validate → Evaluate** pipeline (see [FOUNDATION-ARCHITECTURE.md](./FOUNDATION-ARCHITECTURE.md))
- **FoundationBasicAgent**: Primary general-purpose agent with integrated foundation pipeline
- **Agent Architecture**: Modular agent system with `IAgent` interface and specialized agent types
- **AgentFactory**: Intelligent agent selection using keyword analysis and confidence scoring (now creates FoundationBasicAgent as default)
- **AgentCoordinator**: Multi-agent workflow orchestration with dependency resolution and parallel execution
- **BasicAgent.ts**: Fallback ReAct-style agent using LangChain and Ollama with dual execution modes
- **Specialized Agents**: CodeReviewAgent, TestAutomationAgent, DevOpsAgent, DocumentationAgent, RefactoringAgent
- **OptimizedReActEngine.ts**: High-performance ReAct engine with parallel execution and streaming
- Prioritizes manual ReAct loops (reliable with Ollama) over LangChain AgentExecutor
- Enhanced response parsing for THOUGHT/ACTION/ACTION_INPUT patterns
- Handles multi-step task execution with proper action tracking
- Supports workspace context and comprehensive error recovery
- Features both traditional and optimized execution paths with configurable performance settings

**Foundation Pipeline System** (`src/core/foundation/`):

- **10 Specialized Foundation Agents**: Retriever (BGE/E5/GTE), Reranker (Cross-encoder), Tool Selector (DPO), Critic/Evaluator (HH-RLHF), Task Planner (CAMEL-AI/AutoGPT), Query Rewriter, CoT Generator (Flan-CoT), Chunk Scorer, Action Caller, Embedder
- **FoundationPipeline**: Orchestrates the complete 10-stage pipeline with dependency management and parallel execution
- **FoundationAgentFactory**: Centralized creation and management of all foundation agents
- **Multi-Stage Processing**: Every user request processed through sophisticated reasoning pipeline
- **Confidence Scoring**: Each stage provides confidence metrics and quality assessment
- **Fallback Mechanisms**: Graceful degradation to simpler approaches when foundation agents fail

**Tool System** (`src/tools/` + `src/core/ToolManager.ts`):

- Extensible tool system where each tool extends `BaseTool`
- `ToolManager`: Central registry and executor for all tools (53 total tools across categories)
- **Tool Categories**: File operations, shell/VS Code commands, Git operations, testing, code analysis, package management, networking, environment management, Docker, performance analysis, documentation, tech stack analysis, knowledge base management
- `ParallelToolExecutor`: High-performance parallel tool execution with intelligent scheduling
- `IntelligentToolSelector`: AI-powered tool selection and optimization
- Tools use Zod schemas for validation and support parallel execution with configurable concurrency limits

**Chat & Session Management** (`src/core/ChatSession.ts`):

- Manages conversation history and agent actions
- Tracks tool calls, observations, and modified files
- Supports session persistence and statistics
- Converts between LangChain and Ollama message formats

**Context & Memory System** (`src/context/`):

- `ContextManager`: Intelligent context aggregation and management
- `LongTermMemory`: Persistent memory storage with SQLite backend
- `ProjectContext`: Project-wide context analysis and indexing
- `TaskContext`: Task-specific context tracking and optimization
- `DocumentationContext`: Documentation-aware context with vector database integration
- `MemoryConsolidator`: Context consolidation and relevance scoring
- Multiple context strategies: Relevance, Recency, Project, Task, and Documentation-based
- Configurable context window management and semantic search capabilities

**Documentation & Knowledge System** (`src/documentation/`):

- `VectorDatabase`: ChromaDB-based local vector storage for documentation
- `DocumentationScraper`: Automated scraping of documentation sources (MDN, React, Node.js, etc.)
- **Documentation Tools**: DocSearchTool, DocUpdateTool, DocIndexTool, DocSummaryTool
- **Knowledge Base Tools**: Custom documentation storage and retrieval (6 tools)
- **Technology Analysis**: TechStackAnalyzerTool for comprehensive workspace analysis
- Semantic search with filtering by language, framework, and source
- Supports both public documentation access and private knowledge management

**LLM Provider System** (`src/api/`):

- **Ollama Integration** (`ollama.ts`): Local Ollama server communication with tool calling support
- **LMDeploy Integration** (`lmdeploy.ts`): High-performance LMDeploy server integration for enhanced throughput (1.8x faster than vLLM)
- **LLM Router** (`llm-router.ts`): Intelligent provider routing with task-specific preferences:
  - Chat tasks: Auto-routing based on performance (LMDeploy preferred for high throughput)
  - Embeddings: Prefers LMDeploy for batch processing  
  - Tool calling: Prefers Ollama for reliability
  - Foundation pipeline: Prefers LMDeploy for concurrent inference
  - Fallback mechanisms with configurable timeouts
- **QuantizedModelManager**: Advanced model management with quantization support
- **LMDeployServerManager** (`src/services/`): Auto-startup and lifecycle management for LMDeploy Python server
- Support for multiple quantization levels (q4_0, q4_1, q5_0, q5_1, q8_0, f16, f32)

**UI System** (`src/views/`):

- **`ChatPanel.ts`**: Advanced webview-based chat interface with structured agentic flow display
  - Collapsible thinking sections with muted styling
  - Action indicators with tool icons, descriptions, and status results
  - Progressive message updates and real-time action streaming
  - Export and clear chat functionality
- **`SidebarProvider.ts`**: Activity bar integration with multiple specialized views
- **`FoundationModelsPanel.ts`**: Foundation agent model configuration interface
- **`DocumentationPanel.ts`**: Documentation hub for knowledge base management
- **`ProjectDashboard.ts`**: Project analysis and context visualization
- **`ContextVisualizationPanel.ts`**: Interactive context and memory visualization
- **`ProjectContextPanel.ts`**: Workspace context analysis and management
- **`SettingsPanel.ts`**: Extension configuration and preferences

**VS Code Integration** (`src/extension.ts`, `src/commands/`):

- Extension lifecycle management and command registration
- Status bar integration and welcome messages
- Configuration change handling
- Webview panel and sidebar view registration

### Key Patterns

- **Tool Registration**: Tools are automatically registered in `ToolManager` constructor
- **Prompt Building**: `PromptBuilder` creates context-aware prompts with workspace info
- **Error Handling**: Comprehensive error recovery at multiple levels
- **Configuration**: Uses VS Code settings (`ollamaAgent.*`) for model, URL, log level, and performance settings
- **Agentic Flow Display**: Structured rendering of thinking → actions → results → final response
- **Progressive Updates**: Real-time action streaming and message state management
- **Parallel Execution**: Intelligent parallel tool execution with dependency analysis
- **Context Management**: Multi-strategy context retrieval with semantic search and relevance scoring
- **Memory Persistence**: SQLite-based long-term memory with consolidation strategies

## LMDeploy Server Integration

### Architecture
The extension integrates with a companion Python server (`src/lmdeploy-server/`) that provides LMDeploy inference with an Ollama-compatible API. This server offers 1.8x higher throughput than vLLM and is optimized for foundation agent concurrent workloads.

### Critical Implementation Details

**Auto-Startup System**: `LMDeployServerManager` automatically manages the Python server lifecycle:
- **Virtual Environment**: Must use `.venv/bin/python` from the lmdeploy-server directory
- **Uvicorn Command**: Spawns `uvicorn app.server:app --port 11435 --host 0.0.0.0`
- **Extension Context**: Requires `context.extensionPath` for proper path resolution
- **Health Monitoring**: Status bar integration with 30-second health checks
- **Configuration Reactive**: Auto-restart when settings change

**Server Structure**:
```
src/lmdeploy-server/
├── .venv/                    # Virtual environment (required)
├── app/
│   ├── server.py            # FastAPI application with Ollama-compatible API
│   ├── model_manager.py     # LMDeploy model loading and caching
│   └── config.py           # Server configuration with pydantic-settings
├── requirements.txt         # Python dependencies
└── README.md               # Server documentation
```

**Server Commands**:
- Start: `source .venv/bin/activate && uvicorn app.server:app --port 11435`
- Install deps: `pip install -r requirements.txt`
- Environment setup: Set `LMDEPLOY_*` environment variables for configuration

### Extension Points

To add new capabilities:

1. **New Tool**: Create class extending `BaseTool` in `src/tools/`, register in `ToolManager`
2. **New Agent**: Create in `src/agents/`, wire up in command handlers
3. **New Command**: Add to `package.json` contributes.commands, implement in `src/commands/`
4. **New Chat UI Feature**: Extend `ChatPanel.ts` with new message types or interactions
5. **New View**: Add to `package.json` views/viewsContainers, implement provider in `src/views/`
6. **LMDeploy Server**: Modify `app/server.py` for new endpoints, ensure virtual environment compatibility

### Important Files

**Foundation Architecture:**
- `docs/FOUNDATION-ARCHITECTURE.md`: Complete foundation system documentation
- `src/agents/FoundationBasicAgent.ts`: Primary agent with integrated foundation pipeline
- `src/core/foundation/FoundationPipeline.ts`: 10-stage pipeline orchestrator with singleton patterns
- `src/core/foundation/FoundationAgentFactory.ts`: Thread-safe singleton factory for foundation agents
- `src/core/foundation/OptimizedFoundationAgentFactory.ts`: Performance-optimized factory with caching
- `src/core/foundation/IFoundationAgent.ts`: Foundation agent interfaces and types
- `src/core/foundation/agents/RetrieverAgent.ts`: BGE/E5/GTE style semantic retrieval
- `src/core/foundation/agents/RerankerAgent.ts`: Cross-encoder document scoring
- `src/core/foundation/agents/TaskPlannerAgent.ts`: CAMEL-AI/AutoGPT task planning
- `src/core/foundation/agents/CoTGeneratorAgent.ts`: Chain-of-thought reasoning
- `src/core/foundation/agents/ActionCallerAgent.ts`: Function-call tuned action generation with parameter enhancement
- `src/core/foundation/agents/ToolSelectorAgent.ts`: DPO-style tool classification with intelligent ranking
- `src/core/foundation/agents/EmbedderAgent.ts`: Vector operations with deterministic embedding generation

**Core System:**
- `src/extension.ts`: Extension entry point and activation
- `src/core/ToolManager.ts`: Tool registry and execution (53 tools)
- `src/agents/BasicAgent.ts`: Fallback agent implementation with enhanced ReAct parsing
- `src/agents/AgentFactory.ts`: Intelligent agent selection and routing (creates FoundationBasicAgent)
- `src/agents/AgentCoordinator.ts`: Multi-agent workflow orchestration and coordination
- `src/agents/IAgent.ts`: Core agent interface and contracts
- `src/core/OptimizedReActEngine.ts`: High-performance parallel execution engine
- `src/core/ChatSession.ts`: Session and conversation management
- `src/core/ContextManager.ts`: Context aggregation and management
- `src/context/LongTermMemory.ts`: Persistent memory storage
- `src/context/DocumentationContext.ts`: Documentation-aware context strategy
- `src/documentation/VectorDatabase.ts`: ChromaDB vector storage
- `src/documentation/DocumentationScraper.ts`: Automated documentation scraping
- `src/tools/TechStackTool.ts`: Comprehensive technology stack analysis
- `src/core/ParallelToolExecutor.ts`: Parallel tool execution with intelligent scheduling
- `src/views/ChatPanel.ts`: Advanced chat interface with agentic flow visualization
- `src/views/SidebarProvider.ts`: Activity bar sidebar integration
- `src/api/ollama.ts`: Ollama server communication with tool calling support  
- `src/api/lmdeploy.ts`: LMDeploy server integration for superior performance (1.8x faster than vLLM)
- `src/api/llm-router.ts`: Intelligent LLM provider routing with fallback mechanisms
- `src/services/LMDeployServerManager.ts`: Auto-startup and lifecycle management for LMDeploy Python server
- `package.json`: Extension manifest with commands, views, and configuration

## Agent Specialization System

The extension features a sophisticated multi-agent architecture with intelligent task routing:

### Agent Types

- **FoundationBasicAgent** (Primary General): Enhanced agent with integrated 10-stage foundation pipeline for sophisticated reasoning
- **BasicAgent** (Fallback General): Simplified ReAct-style agent for basic tasks and error recovery
- **CodeReviewAgent**: Code analysis, security scanning, quality assessment
- **TestAutomationAgent**: Test generation, TDD workflows, coverage analysis
- **DevOpsAgent**: Git operations, CI/CD, deployment workflows
- **DocumentationAgent**: README generation, API docs, changelog management
- **RefactoringAgent**: Code improvement, architecture optimization, pattern application

**Foundation Agents (Internal)**: 10 specialized micro-agents within the foundation pipeline:
- **Retriever**: BGE/E5/GTE style semantic search and content retrieval
- **Reranker**: Cross-encoder document scoring and ranking
- **Tool Selector**: DPO-style intelligent tool classification and selection
- **Critic/Evaluator**: HH-RLHF style quality assessment and improvement suggestions
- **Task Planner**: CAMEL-AI/AutoGPT style task decomposition and planning
- **Query Rewriter**: Search-optimized query expansion and enhancement
- **CoT Generator**: Flan-CoT style chain-of-thought reasoning generation
- **Chunk Scorer**: Content relevance and quality scoring specialist
- **Action Caller**: Function-call tuned action generation and parameter validation
- **Embedder**: Vector operations and semantic similarity calculations

### Task Routing

The `AgentFactory` analyzes tasks using:
- **Keyword Analysis**: Matches task content against agent specializations
- **Confidence Scoring**: Determines best agent fit with threshold-based selection
- **Context Awareness**: Considers file types, project structure, and workspace context
- **Fallback Strategy**: Routes to BasicAgent when no specialized agent meets confidence threshold

### Multi-Agent Orchestration

The `AgentCoordinator` handles complex workflows requiring multiple specialized agents:

**Key Features:**
- **Task Complexity Analysis**: Determines if tasks need multi-agent coordination
- **Intelligent Decomposition**: Breaks complex tasks into specialized subtasks
- **Dependency Resolution**: Manages task dependencies and execution order
- **Parallel Execution**: Runs independent tasks concurrently (configurable concurrency)
- **Result Synthesis**: Combines outputs from multiple agents into cohesive responses
- **Failure Handling**: Retry mechanisms and graceful degradation

**Workflow Types:**
- Complete development workflows (docs → tests → review → deploy)
- Cross-domain tasks requiring multiple specializations
- Pipeline-based workflows with dependencies

### Usage Patterns

```typescript
// Single agent selection
const factory = new AgentFactory(config, toolManager, contextManager);
const { agent, analysis } = await factory.selectBestAgent(task, context);
const response = await agent.executeTask(task, session);

// Multi-agent orchestration
const coordinator = new AgentCoordinator(factory, config);
const response = await coordinator.orchestrateTask(complexTask, context, progressCallback);
```

## Recent Enhancements (Latest Updates)

### 🎯 Enhanced Agentic Flow Display

The chat interface now provides a sophisticated visualization of the agent's reasoning process:

**Structured Message Flow:**

- **🤔 Thinking Sections**: Collapsible, muted sections showing agent reasoning
- **🔧 Action Indicators**: Visual tool execution with icons, descriptions, and results
- **🎯 Final Response**: Prominently displayed final answer separate from process steps

**Visual Example:**

```
┌─ 🤔 Agent Thinking (click to expand)
│   "To summarize the README.md file, I need to read it first..."
└─

┌─ 📖 file_read
│   Reading file: /path/to/README.md
│   ✅ File content loaded successfully
└─

┌─ 🎯 Final Response
│   Here's a summary of the README.md file: [actual summary]
└─
```

**Key Features:**

- **Interactive UI**: Click to expand/collapse thinking sections
- **Tool-Specific Icons**: Different icons for file operations, shell commands, etc.
- **Status Indicators**: Success/error states with truncated output display
- **Progressive Updates**: Actions appear as they complete (infrastructure ready)

### 🔧 Enhanced Agent Processing

**ReAct Loop Prioritization:**

- Switched from unreliable LangChain executor to robust manual ReAct loop
- Enhanced regex-based parsing for THOUGHT/ACTION/ACTION_INPUT patterns
- Improved multi-line JSON handling for complex tool inputs
- Better error recovery and debugging capabilities

**Response Structure:**

```typescript
interface AgentResponse {
  content: string; // Final response to user
  actions: AgentAction[]; // Array of thinking/tool steps
  success: boolean; // Execution status
  error?: string; // Error details if failed
}
```

### 🎨 Chat Interface Features

**User Experience:**

- Modern chat UI with VS Code theming
- Auto-resizing text input with keyboard shortcuts
- Export chat functionality to text files
- Clear chat with session reset
- Proper error handling and recovery

**Technical Implementation:**

- Webview-based with secure message passing
- Structured data flow from agent to UI
- Collapsible sections with smooth animations
- Responsive design for different panel sizes

### 🚀 Usage Instructions

**Access Methods:**

1. **Keyboard Shortcut**: `F2` (Windows/Linux) or `Cmd+F2` (macOS)
2. **Command Palette**: `Ctrl+Shift+P` → "Ollama Agent: Open Agent Chat"
3. **Status Bar**: Click the "🦙 Ollama Agent" item
4. **Activity Bar**: Click robot icon → "💬 Open Chat Window"

**Configuration:**

- `ollamaAgent.ollamaUrl`: Ollama server URL (default: http://localhost:11434)
- `ollamaAgent.model`: Model to use (default: llama3.2:3b)
- `ollamaAgent.logLevel`: Logging verbosity (debug/info/warn/error)
- `ollamaAgent.context.maxContextWindow`: Maximum context window size (default: 8000)
- `ollamaAgent.context.enableSemanticSearch`: Enable semantic search (default: true)
- `ollamaAgent.performance.enableOptimizedExecution`: Enable optimized ReAct execution (default: true)
- `ollamaAgent.performance.maxConcurrency`: Maximum parallel tool executions (default: 3)
- `ollamaAgent.model.quantized`: Use quantized model variant (default: false)
- `ollamaAgent.model.quantization`: Quantization level (q4_0, q4_1, q5_0, q5_1, q8_0, f16, f32)
- `ollamaAgent.lmdeploy.enabled`: Enable LMDeploy integration for superior performance (default: false)
- `ollamaAgent.lmdeploy.serverUrl`: LMDeploy server URL (default: http://localhost:11435)
- `ollamaAgent.lmdeploy.model`: LMDeploy model path/name for inference
- `ollamaAgent.lmdeploy.engineType`: Engine type ('turbomind' for performance, 'pytorch' for compatibility)
- `ollamaAgent.routing.chatPreference`: Preferred provider for chat (ollama/lmdeploy/auto)
- `ollamaAgent.routing.embeddingPreference`: Preferred provider for embeddings (lmdeploy recommended for batch processing)
- `ollamaAgent.routing.enableFallback`: Enable fallback to alternative provider (default: true)
- `ollamaAgent.foundation.models.*`: Per-agent model configuration for all 10 foundation agents

## 🧠 General Principles

All agents, copilots, and LLM tools assisting in code generation or modification must adhere to the following standards and practices. These ensure maintainability, correctness, and long-term scalability of the codebase.

---

## 🧱 1. **Modular, Extensible Design — Always**

**DO:**

- Create discrete, single-purpose modules or components.
- Separate concerns into clearly defined files and directories.
- Follow the _open/closed principle_: open for extension, closed for modification.
- Default to composition over inheritance or large conditional structures.

**DO NOT:**

- Write monolithic files or functions with multiple responsibilities.
- Hardcode values or logic that prevents extension later.
- Flatten complex logic into one place for "simplicity."

> ✅ _Goal: Maximize reuse, testing ease, and flexibility across evolving features._

---

## 🧪 2. **Fix Errors Correctly — Not Lazily**

**DO:**

- Resolve bugs or exceptions using idiomatic, standards-compliant solutions for the language/framework in use.
- Ensure the fix is aligned with the library’s or language’s intended design patterns.

**DO NOT:**

- “Patch” errors by removing or simplifying code in a way that bypasses the original design intent.
- Replace specific logic with generalized code just to make an error disappear.

> ✅ _Correctness > Convenience. Avoid masking issues; resolve them robustly._

---

## 🌐 3. **Use Documentation When in Doubt**

If an error is not resolved after **two distinct attempts**, follow this process:

**Step 1:**
Search the official documentation or trusted technical references (e.g., language docs, library guides, source repos, etc.).

**Step 2:**
If applicable, include comments with the source (URL or doc version) and rationale for the fix.

**Step 3:**
Retry the fix using the documented, verified approach.

> ✅ _Use knowledge, not guesswork. Search beats speculation._

---

## 📝 4. **Maintain Documentation — As You Code**

**DO:**

- Update existing documentation when modifying functionality.
- Add clear comments or docstrings for new modules, functions, or significant logic.
- If creating new features or patterns, ensure relevant markdown files (e.g., `README.md`, `CONTRIBUTING.md`, API docs) are also updated.

**DO NOT:**

- Leave outdated or misleading documentation in place.
- Rely solely on code to communicate complex behavior or architecture.

> ✅ _Documentation is part of the product — treat it as a first-class citizen._

---

## 📎 Suggested Tools/Resources

When searching for documentation or references, prefer:

- [devdocs.io](https://devdocs.io)
- Official package repositories (npmjs.com, crates.io, nuget.org, etc.)
- Official framework documentation (e.g., react.dev, doc.rust-lang.org)
- GitHub Issues and Discussions from the official project
- StackOverflow (only for supported answers with citations or high votes)

---

## 🔁 Summary

| Rule          | What to Do                              | What to Avoid                                    |
| ------------- | --------------------------------------- | ------------------------------------------------ |
| Modular Code  | Break logic into small, focused modules | Don’t write large, dense files                   |
| Correct Fixes | Use idiomatic and well-documented fixes | Don’t suppress or bypass errors lazily           |
| Use Docs      | Look up errors if 2 fixes fail          | Don’t continue guessing past two failed attempts |
| Documentation | Keep docs current with code changes     | Don’t leave stale or missing documentation       |

---

## ✅ Agent Checkpoints

Before finalizing a task, confirm:

- [ ] Is the code modular and logically separated?
- [ ] Have all errors been resolved using correct implementations?
- [ ] Have at least two good-faith fixes been attempted before searching?
- [ ] If documentation was consulted, was it cited?
- [ ] Are relevant comments, docstrings, or markdown files updated or added?
