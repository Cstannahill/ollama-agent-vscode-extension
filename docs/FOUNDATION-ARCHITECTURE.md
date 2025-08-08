# Foundation Agentic Architecture

## Overview

The VS Code Ollama Agent Extension features a sophisticated **Foundation Agentic Architecture** that implements a multi-stage pipeline with 10 specialized AI agents. This architecture serves as the core intelligence layer, processing every user request through a comprehensive **Query → Expand → Retrieve → Rerank → Score → Plan → Reason → Generate Actions → Validate → Evaluate** flow.

## Core Pipeline Flow

The foundation pipeline executes the following stages sequentially, with each stage powered by a specialized agent:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Query     │───▶│   Expand    │───▶│  Retrieve   │───▶│   Rerank    │
│ (Original)  │    │ (Enhanced)  │    │ (Context)   │    │ (Scored)    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                  │                  │                  │
       ▼                  ▼                  ▼                  ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    Score    │───▶│    Plan     │───▶│   Reason    │───▶│ Generate    │
│ (Relevance) │    │  (Steps)    │    │  (CoT)      │    │ (Actions)   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                  │                  │                  │
       ▼                  ▼                  ▼                  ▼
┌─────────────┐    ┌─────────────┐
│  Validate   │───▶│  Evaluate   │
│ (Actions)   │    │ (Quality)   │
└─────────────┘    └─────────────┘
```

## Foundation Agents

### 1. **Retriever Agent** (BGE/E5/GTE Style)
- **Model Size**: 0.1–1B parameters
- **Purpose**: Semantic content retrieval with positive/negative example learning
- **Capabilities**:
  - Context-aware search across multiple sources
  - Vector database integration (ChromaDB)
  - Positive/negative example-based learning
  - Multi-source content aggregation
  - Relevance-based ranking

### 2. **Reranker Agent** (Cross-encoder)
- **Model Size**: 1–3B parameters  
- **Purpose**: Document scoring and reranking with cross-encoder architecture
- **Capabilities**:
  - Query-document relevance assessment
  - Cross-encoder style scoring
  - Content quality evaluation
  - Contextual relevance ranking

### 3. **Tool Selector Agent** (DPO Classifier)
- **Model Size**: 1–7B parameters
- **Purpose**: Intelligent tool selection using DPO-style classification
- **Capabilities**:
  - Task-to-tool mapping
  - Confidence-based tool ranking
  - Multi-tool workflow planning
  - Tool dependency analysis

### 4. **Critic/Evaluator Agent** (HH-RLHF Style)
- **Model Size**: 1–3B parameters
- **Purpose**: Quality assessment and critique using HH-RLHF patterns
- **Capabilities**:
  - Multi-criteria evaluation
  - Confidence scoring
  - Quality feedback generation
  - Improvement suggestions

### 5. **Task Planner Agent** (CAMEL-AI/AutoGPT Style)
- **Model Size**: 1–7B parameters
- **Purpose**: Complex task decomposition and planning
- **Capabilities**:
  - CAMEL-AI style task breakdown
  - AutoGPT workflow planning
  - Dependency analysis
  - Resource estimation
  - Success criteria definition

### 6. **Query Rewriter Agent** (Search Tuning)
- **Model Size**: 1–3B parameters
- **Purpose**: Query expansion and enhancement for improved search
- **Capabilities**:
  - Short→Expanded query transformation
  - Search optimization
  - Multiple query variations
  - Context-aware expansion

### 7. **CoT Generator Agent** (Flan-CoT/Self-Instruct)
- **Model Size**: 1–3B parameters
- **Purpose**: Chain-of-thought reasoning generation
- **Capabilities**:
  - Step-by-step logical reasoning
  - Flan-CoT style thinking
  - Self-instruction patterns
  - Reasoning validation

### 8. **Chunk Scorer Agent** (Custom Classifier)
- **Model Size**: 0.5–2B parameters
- **Purpose**: Content relevance and ranking specialist
- **Capabilities**:
  - Multi-criteria chunk evaluation
  - Relevance scoring
  - Content quality assessment
  - Context-aware ranking

### 9. **Action Caller Agent** (Function-call Tuned)
- **Model Size**: 1–3B parameters
- **Purpose**: Plan→API call JSON transformation and execution
- **Capabilities**:
  - Function calling with parameter validation
  - Plan-to-action translation
  - API call generation
  - Execution orchestration

### 10. **Embedder Agent**
- **Model Size**: Variable
- **Purpose**: Vector operations and similarity calculations
- **Capabilities**:
  - Text embedding generation
  - Similarity calculations
  - Vector caching
  - Semantic search support

## Architecture Components

### Foundation Pipeline (`FoundationPipeline.ts`)
The central orchestrator that manages the 10-stage execution flow:

```typescript
export class FoundationPipeline {
  async execute(
    query: string,
    workspaceContext?: any,
    availableTools?: any[],
    progressCallback?: ProgressCallback
  ): Promise<FoundationPipelineResult>
}
```

**Key Features**:
- **Dependency Management**: Ensures proper stage execution order
- **Parallel Processing**: Runs independent operations concurrently
- **Error Recovery**: Graceful degradation with fallback mechanisms
- **Progress Tracking**: Real-time progress callbacks
- **Result Synthesis**: Combines outputs from multiple agents

### Foundation Agent Factory (`FoundationAgentFactory.ts`)
Centralized creation and management of all foundation agents:

```typescript
export class FoundationAgentFactory {
  async createAgents(): Promise<FoundationAgents>
  async initializeAgents(): Promise<void>
  getInitializationStatus(): any
  getCapabilitiesSummary(): any
  async healthCheck(): Promise<any>
}
```

### Enhanced Basic Agent (`FoundationBasicAgent.ts`)
The primary agent that integrates the foundation pipeline into the baseline workflow:

```typescript
export class FoundationBasicAgent implements IAgent {
  async executeTask(
    task: string,
    session?: ChatSession,
    progressCallback?: ProgressCallback
  ): Promise<AgentResponse>
  
  async executeWithFoundationPipeline(): Promise<AgentResponse>
}
```

## Integration Points

### Agent Factory Integration
The `AgentFactory` now creates a `FoundationBasicAgent` as the primary general-purpose agent:

```typescript
// Create foundation-enhanced BasicAgent as primary general agent
const foundationBasicAgent = new FoundationBasicAgent({
  ollamaUrl: this.agentConfig.ollamaUrl,
  model: this.agentConfig.model,
  temperature: 0.3,
  enableFoundationPipeline: true
}, this.toolManager, this.contextManager!);

this.agents.set(AgentSpecialization.GENERAL, foundationBasicAgent);
```

### Context System Integration
The foundation agents integrate seamlessly with the existing context system:

- **ContextManager**: Provides workspace and project context
- **VectorDatabase**: ChromaDB integration for semantic search
- **DocumentationContext**: Documentation-aware context retrieval
- **LongTermMemory**: Persistent memory storage and retrieval

### Tool System Integration
All foundation agents can access the full 53-tool ecosystem:

- **File Operations**: Read, write, create, analyze files
- **Shell Commands**: Execute system commands and VS Code operations
- **Git Operations**: Version control and repository management
- **Testing Tools**: Test generation, execution, and coverage
- **Code Analysis**: Linting, security scanning, complexity analysis
- **Package Management**: Dependency installation and auditing
- **Documentation Tools**: API docs, README generation, knowledge base

## Execution Flow Details

### Stage 1: Query Processing
1. **Input**: Raw user query
2. **Query Rewriter**: Expands and enhances the query
3. **Output**: Enhanced query with multiple variations

### Stage 2: Information Retrieval
1. **Retriever**: Searches across context, vector DB, and documentation
2. **Input**: Enhanced query + positive/negative examples
3. **Output**: Relevant content chunks with confidence scores

### Stage 3: Content Ranking
1. **Reranker**: Cross-encoder scoring of retrieved content
2. **Chunk Scorer**: Multi-criteria relevance evaluation
3. **Output**: Ranked and scored content chunks

### Stage 4: Task Planning
1. **Task Planner**: CAMEL-AI/AutoGPT style decomposition
2. **Input**: Query + ranked content + workspace context
3. **Output**: Structured task plan with steps and dependencies

### Stage 5: Tool Selection
1. **Tool Selector**: DPO-style tool classification
2. **Input**: Task plan + available tools
3. **Output**: Ranked tool selections with confidence scores

### Stage 6: Reasoning Generation
1. **CoT Generator**: Chain-of-thought reasoning
2. **Input**: Task plan + selected tools + context
3. **Output**: Step-by-step reasoning chain

### Stage 7: Action Generation
1. **Action Caller**: Function-call tuned action generation
2. **Input**: Reasoning chain + tool selections
3. **Output**: Executable action calls with parameters

### Stage 8: Validation & Execution
1. **Validation**: Parameter and dependency checking
2. **Execution**: Tool execution through ToolManager
3. **Output**: Action results and observations

### Stage 9: Quality Evaluation
1. **Critic/Evaluator**: HH-RLHF style quality assessment
2. **Input**: Complete execution trace + results
3. **Output**: Quality scores, confidence ratings, improvement suggestions

## Configuration and Customization

### Pipeline Configuration
```typescript
interface FoundationPipelineConfig {
  enableParallelExecution: boolean;
  maxConcurrency: number;
  timeoutMs: number;
  enableFallbacks: boolean;
  retryAttempts: number;
  confidenceThresholds: Record<string, number>;
  agentConfigs: Record<string, any>;
}
```

### Agent-Specific Configuration
Each foundation agent supports customizable parameters:
- **Model Size**: Configurable quantization levels
- **Temperature**: Creativity vs consistency tuning
- **Timeout**: Execution time limits
- **Confidence Thresholds**: Quality gates
- **Retry Logic**: Error recovery strategies

## Performance Characteristics

### Latency Optimization
- **Parallel Execution**: Independent stages run concurrently
- **Caching**: Vector embeddings and context results cached
- **Model Quantization**: Smaller models for speed-critical stages
- **Early Termination**: Skip stages below confidence thresholds

### Quality Assurance
- **Multi-Stage Validation**: Each stage validates previous outputs
- **Confidence Scoring**: Every result includes confidence metrics
- **Fallback Mechanisms**: Graceful degradation to simpler approaches
- **Human-in-the-Loop**: Optional manual validation points

### Scalability
- **Modular Design**: Agents can be added/removed independently
- **Resource Management**: Configurable memory and compute limits
- **Load Balancing**: Distribute requests across available resources
- **Monitoring**: Comprehensive telemetry and health checks

## Development Guidelines

### Adding New Foundation Agents
1. Implement the `IFoundationAgent` interface
2. Add agent to `FoundationAgentFactory`
3. Integrate into `FoundationPipeline` execution flow
4. Update documentation and tests

### Extending the Pipeline
1. Define new pipeline stages in `IFoundationAgent.ts`
2. Implement stage logic in `FoundationPipeline.ts`
3. Add dependency management and error handling
4. Update progress callbacks and telemetry

### Customizing Agent Behavior
1. Modify agent-specific configurations
2. Adjust confidence thresholds and fallback logic
3. Implement custom prompt templates
4. Add domain-specific validation rules

## Monitoring and Debugging

### Pipeline Statistics
```typescript
interface PipelineStatistics {
  executionTime: number;
  stagesCompleted: string[];
  confidenceScores: Record<string, number>;
  errorCounts: Record<string, number>;
  toolExecutions: number;
  fallbacksTriggered: string[];
}
```

### Health Checks
- **Agent Availability**: Verify all agents are initialized
- **Model Connectivity**: Test LLM connections
- **Resource Usage**: Monitor memory and compute utilization
- **Performance Metrics**: Track latency and throughput

### Debug Capabilities
- **Verbose Logging**: Detailed execution traces
- **Stage Isolation**: Run individual pipeline stages
- **Result Inspection**: Examine intermediate outputs
- **Error Analysis**: Comprehensive error reporting

## Future Enhancements

### Advanced Features
- **Adaptive Pipeline**: Dynamic stage selection based on query complexity
- **Learning System**: Improve agent performance over time
- **Multi-Modal Support**: Handle images, audio, and other media types
- **Federated Learning**: Share improvements across instances

### Integration Opportunities
- **External APIs**: Connect to cloud-based AI services
- **Enterprise Features**: SSO, audit logging, compliance tools
- **Custom Models**: Support for fine-tuned domain-specific models
- **Plugin Ecosystem**: Third-party agent extensions

---

This foundation architecture represents a significant advancement in agentic AI systems, providing sophisticated multi-stage reasoning while maintaining modularity, performance, and extensibility. The **Query → Expand → Retrieve → Rerank → Score → Plan → Reason → Generate Actions → Validate → Evaluate** pipeline ensures comprehensive processing of every user request through specialized AI agents optimized for their specific tasks.