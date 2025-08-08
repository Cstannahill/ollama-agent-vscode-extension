# Foundation Agent Initialization Optimization

## Current State Analysis

### Performance Metrics
- **Full pipeline initialization**: ~40 seconds
- **Agent count**: 10 specialized foundation agents
- **Initialization pattern**: Lazy (on first use)
- **Impact**: Every general task waits 40s on first run

### Usage Patterns
- Foundation pipeline used for ALL general tasks (90%+ of requests)
- Multiple models involved (qwen3:1.7b, gemma3:1b, deepseek-r1:latest, etc.)
- Agents are typically used together, not individually

## Optimization Strategies

### 1. Eager Initialization (Recommended)
**Implementation**: Initialize foundation agents during extension activation

**Benefits**:
- Zero delay on first user interaction
- Better user experience
- Predictable performance

**Trade-offs**:
- Slower extension startup (~40s)
- Resource usage even if not used immediately

### 2. Background Initialization
**Implementation**: Start initialization in background after extension loads

**Benefits**:
- Non-blocking extension startup
- Agents ready by the time user typically uses them
- Best of both worlds

### 3. Selective Initialization
**Implementation**: Initialize core agents (retriever, tool selector) first

**Benefits**:
- Partial functionality available quickly
- Progressive enhancement
- Reduced initial load

### 4. Cached Initialization State
**Implementation**: Persist agent state between sessions

**Benefits**:
- Even faster startup after first use
- Reduced model loading overhead

## Recommended Implementation

### Phase 1: Background Initialization
```typescript
// In extension.ts activate()
setTimeout(async () => {
  try {
    logger.info("Starting background foundation agent initialization...");
    const factory = new FoundationAgentFactory(dependencies);
    await factory.initializeAgents();
    logger.info("Background foundation agent initialization complete");
  } catch (error) {
    logger.warn("Background initialization failed, will fallback to lazy init:", error);
  }
}, 2000); // 2s delay to let extension fully load
```

### Phase 2: Smart Caching
- Cache successful agent instances
- Implement agent health checks
- Refresh only failed agents

### Phase 3: Selective Loading
- Core agents first (retriever, tool selector, task planner)
- Specialized agents on demand
- Progressive pipeline enhancement

## Implementation Priority

1. **High Priority**: Background initialization - immediate UX improvement
2. **Medium Priority**: Selective loading - optimization for edge cases  
3. **Low Priority**: Persistent caching - advanced optimization

## Configuration Options

Add settings to control initialization strategy:
```json
{
  "ollamaAgent.initialization.strategy": "background|lazy|eager",
  "ollamaAgent.initialization.backgroundDelay": 2000,
  "ollamaAgent.initialization.coreAgentsFirst": true
}
```