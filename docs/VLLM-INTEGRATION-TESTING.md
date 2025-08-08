# vLLM Integration Testing & Verification Guide

## Overview

The vLLM integration has been successfully implemented with comprehensive logging to make testing and verification straightforward. This document explains how to verify the integration is working correctly by monitoring the VS Code Output channel.

## Key Features Implemented

✅ **Complete vLLM Integration Architecture**
- FastAPI Python server with Ollama-compatible API endpoints
- TypeScript client maintaining identical interface to OllamaLLM  
- Intelligent LLM router for automatic provider selection
- Provider-specific optimizations for foundation pipeline stages
- Comprehensive performance monitoring and health checks

## Verification Through Logging

### 1. Enable Logging

Set your logging level to capture vLLM operations:
```json
{
  "ollamaAgent.logLevel": "info"
}
```

### 2. Log Patterns to Watch For

The integration uses distinctive emojis and prefixes to make verification easy:

#### vLLM Operations
- 🔥 `[vLLM]` - All vLLM server operations
- 🎯 `[LLM_ROUTER]` - Routing decisions between providers
- 🔧 `[PROVIDER_OPTIMIZER]` - Stage-specific provider optimizations  
- 🧠 `[FOUNDATION_PIPELINE]` - Pipeline stage routing
- 📊 `[PERF_MONITOR]` - Performance metrics

#### Ollama Operations (for comparison)
- 🦙 `[Ollama]` - All Ollama operations

### 3. Example Log Messages

**vLLM Server Request:**
```
🔥 [vLLM] GENERATE → http://localhost:11435/api/generate | Model: microsoft/DialoGPT-medium | Provider: vLLM
```

**Router Decision:**
```
🎯 [LLM_ROUTER] ROUTED_LLM → VLLM | Task: batch_processing | Model: default | Reason: batch/embedding tasks favor vLLM | Confidence: 0.85
```

**Provider Optimization:**
```
🔧 [PROVIDER_OPTIMIZER] STAGE_ROUTING | Stage: retrieval → VLLM | Reason: Embedding generation and similarity scoring optimized for vLLM's batch processing | Confidence: 0.90 | Batching: ON
```

**Performance Monitoring:**
```
📊 [PERF_MONITOR] METRIC | Provider: VLLM | Operation: foundation_pipeline | Duration: 1250ms | Success: ✅ | Tokens: 156
```

## Testing Scenarios

### 1. Basic Availability Test
1. Enable vLLM in settings: `"ollamaAgent.vllm.enabled": true`
2. Open VS Code Output Panel → "Ollama Agent"
3. Use any agent feature (F2 to open chat)
4. Look for: `🔥 [vLLM] AVAILABILITY_CHECK → http://localhost:11435/api/tags`

### 2. Router Functionality Test
1. Ensure both Ollama and vLLM are available
2. Perform different types of tasks:
   - Interactive chat (should prefer Ollama)
   - Batch processing tasks (should prefer vLLM)
   - Tool calling operations (should prefer Ollama)
3. Look for routing decisions in logs: `🎯 [LLM_ROUTER] ROUTED_*`

### 3. Foundation Pipeline Optimization Test
1. Perform complex operations that use the foundation pipeline
2. Look for stage optimization logs: `🧠 [FOUNDATION_PIPELINE] STAGE_OPTIMIZATION`
3. Verify different stages route to appropriate providers:
   - Retrieval/Embedding stages → vLLM
   - Tool selection/Action generation → Ollama

### 4. Performance Monitoring Test
1. Perform multiple operations with both providers
2. Check for performance metrics: `📊 [PERF_MONITOR] METRIC`
3. Verify metrics show provider-specific performance data

## Configuration Options for Testing

### vLLM Server Configuration
```json
{
  "ollamaAgent.vllm.enabled": true,
  "ollamaAgent.vllm.serverUrl": "http://localhost:11435",
  "ollamaAgent.vllm.model": "microsoft/DialoGPT-medium"
}
```

### Routing Preferences
```json
{
  "ollamaAgent.routing.chatPreference": "auto",
  "ollamaAgent.routing.embeddingPreference": "vllm", 
  "ollamaAgent.routing.toolCallingPreference": "ollama",
  "ollamaAgent.routing.batchProcessingPreference": "vllm",
  "ollamaAgent.routing.preferSpeed": true,
  "ollamaAgent.routing.enableFallback": true
}
```

### Foundation Pipeline Optimization
```json
{
  "ollamaAgent.foundation.enableVLLMOptimization": true
}
```

## Troubleshooting

### Common Issues

1. **No vLLM logs appearing**
   - Check if vLLM server is running on configured port
   - Verify `ollamaAgent.vllm.enabled` is set to `true`
   - Check log level is set to `info` or `debug`

2. **Always routing to Ollama**
   - Verify vLLM server availability
   - Check routing preferences in settings
   - Look for fallback messages in logs

3. **No optimization logs**
   - Ensure `ollamaAgent.foundation.enableVLLMOptimization` is `true`
   - Verify you're using features that trigger the foundation pipeline

### Log Filters

To focus on specific components in VS Code Output:
- vLLM operations: Filter by `🔥 [vLLM]`
- Routing decisions: Filter by `🎯 [LLM_ROUTER]`
- Performance data: Filter by `📊 [PERF_MONITOR]`

## Success Indicators

✅ **Integration Working Correctly When You See:**
1. Both `🔥 [vLLM]` and `🦙 [Ollama]` log messages
2. Router making intelligent decisions: `🎯 [LLM_ROUTER] ROUTED_* → VLLM` and `→ OLLAMA`
3. Stage optimizations routing appropriately: `🧠 [FOUNDATION_PIPELINE] STAGE_OPTIMIZATION`
4. Performance metrics for both providers: `📊 [PERF_MONITOR] METRIC | Provider: VLLM` and `Provider: OLLAMA`

## Python Server Setup (if needed)

If you need to set up the vLLM Python server:

1. **Install Dependencies:**
   ```bash
   cd src/vllm-server
   pip install -r requirements.txt
   ```

2. **Start Server:**
   ```bash
   python server.py
   ```

3. **Verify Server:**
   ```bash
   curl http://localhost:11435/api/tags
   ```

The server provides Ollama-compatible endpoints at `localhost:11435` by default.

---

**Note:** The comprehensive logging system ensures you can easily verify that vLLM integration is working correctly without complex testing frameworks. Simply monitor the VS Code Output channel while using the extension to see real-time provider routing and performance data.