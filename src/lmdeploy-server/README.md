# LMDeploy Server for Ollama Agent VS Code Extension

This is a companion Python server that provides LMDeploy inference capabilities with an Ollama-compatible API. LMDeploy offers superior performance and throughput compared to vLLM, making it ideal for high-concurrency foundation agent workloads.

## Features

- **Ollama-Compatible API**: Drop-in replacement for Ollama endpoints
- **Streaming Support**: Real-time text generation with superior performance
- **Model Caching**: Intelligent model loading and unloading
- **Performance Optimized**: Built on LMDeploy's TurboMind engine with 1.8x higher throughput than vLLM
- **Foundation Agent Ready**: Optimized for multi-agent concurrent inference
- **Dual Engine Support**: TurboMind for performance, PyTorch for compatibility

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Run the server:
```bash
python server.py
```

The server will start on `http://127.0.0.1:11435` by default (Ollama port + 1).

## Configuration

Environment variables:
- `LMDEPLOY_HOST`: Server host (default: 127.0.0.1)
- `LMDEPLOY_PORT`: Server port (default: 11435)
- `LMDEPLOY_DEFAULT_MODEL`: Default model to preload
- `LMDEPLOY_MAX_MODEL_LEN`: Maximum context length (default: 2048)
- `LMDEPLOY_GPU_MEMORY_UTILIZATION`: GPU memory usage ratio (default: 0.8)
- `LMDEPLOY_ENGINE`: Engine type - 'turbomind' (default) or 'pytorch'

## API Endpoints

### Compatible with Ollama:
- `POST /api/generate` - Generate text
- `POST /api/chat` - Chat completion
- `GET /api/tags` - List available models

### LMDeploy-specific:
- `GET /api/status` - Server status
- `POST /api/models/load/{model_name}` - Load specific model
- `DELETE /api/models/unload/{model_name}` - Unload model

## Supported Models

The server supports any LMDeploy-compatible model. Pre-configured models include:
- `internlm/internlm2_5-7b-chat` (recommended for chat)
- `internlm/internlm2-chat-20b` (high performance)
- `meta-llama/Llama-2-7b-chat-hf`
- `mistralai/Mistral-7B-Instruct-v0.1`
- `codellama/CodeLlama-7b-Python-hf`

## Performance Benefits

LMDeploy provides significant advantages over vLLM:
- **1.8x higher throughput** on concurrent requests
- **Lower Time to First Token** for interactive applications
- **Superior quantization support** (4-bit inference 2.4x faster)
- **Chat history management** for multi-turn conversations
- **Foundation agent optimization** for concurrent model inference

## Usage with VS Code Extension

The extension will automatically detect and use the LMDeploy server when:
1. The server is running on the configured port
2. LMDeploy integration is enabled in VS Code settings
3. A compatible model is available

The extension intelligently routes requests between Ollama and LMDeploy based on:
- Model capabilities and size
- Request type (embedding, chat, tool calling, foundation pipeline)
- Performance characteristics (LMDeploy preferred for high-throughput tasks)
- User preferences and fallback configuration