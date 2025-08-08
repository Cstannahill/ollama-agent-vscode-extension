# vLLM Server for Ollama Agent VS Code Extension

This is a companion Python server that provides vLLM inference capabilities with an Ollama-compatible API.

## Features

- **Ollama-Compatible API**: Drop-in replacement for Ollama endpoints
- **Streaming Support**: Real-time text generation
- **Model Caching**: Intelligent model loading and unloading
- **Performance Optimized**: Built on vLLM's high-performance inference engine
- **Experimental Integration**: Easy toggle on/off from VS Code settings

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
- `VLLM_HOST`: Server host (default: 127.0.0.1)
- `VLLM_PORT`: Server port (default: 11435)
- `VLLM_DEFAULT_MODEL`: Default model to preload
- `VLLM_MAX_MODEL_LEN`: Maximum context length (default: 2048)
- `VLLM_GPU_MEMORY_UTILIZATION`: GPU memory usage ratio (default: 0.9)

## API Endpoints

### Compatible with Ollama:
- `POST /api/generate` - Generate text
- `POST /api/chat` - Chat completion
- `GET /api/tags` - List available models

### vLLM-specific:
- `GET /api/status` - Server status
- `POST /api/models/load/{model_name}` - Load specific model
- `DELETE /api/models/unload/{model_name}` - Unload model

## Supported Models

The server supports any vLLM-compatible model. Pre-configured models include:
- `microsoft/DialoGPT-medium`
- `meta-llama/Llama-2-7b-chat-hf`
- `mistralai/Mistral-7B-Instruct-v0.1`
- `codellama/CodeLlama-7b-Python-hf`

## Usage with VS Code Extension

The extension will automatically detect and use the vLLM server when:
1. The server is running on the configured port
2. vLLM integration is enabled in VS Code settings
3. A compatible model is available

The extension intelligently routes requests between Ollama and vLLM based on:
- Model capabilities
- Request type (embedding, chat, tool calling)
- Performance characteristics
- User preferences