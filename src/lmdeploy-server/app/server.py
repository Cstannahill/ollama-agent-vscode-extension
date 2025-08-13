"""
LMDeploy FastAPI Server
Compatible with Ollama API endpoints for seamless integration
Provides superior performance and throughput compared to vLLM
"""

import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Dict, List, Optional, AsyncGenerator

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import uvicorn

try:
    import lmdeploy
    from lmdeploy import pipeline, GenerationConfig

    LMDEPLOY_AVAILABLE = True
except ImportError:
    GenerationConfig = None
    LMDEPLOY_AVAILABLE = False

from .config import config, ModelConfig
from .model_manager import model_manager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="LMDeploy Server",
    description="LMDeploy server with Ollama-compatible API",
    version="1.0.0",
)


# Pydantic models for request/response validation
class GenerateRequest(BaseModel):
    model: str
    prompt: str
    stream: bool = False
    options: Optional[Dict] = Field(default_factory=dict)


class ChatMessage(BaseModel):
    role: str  # "system", "user", "assistant"
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    stream: bool = False
    options: Optional[Dict] = Field(default_factory=dict)


class GenerateResponse(BaseModel):
    model: str
    created_at: str
    response: str
    done: bool
    context: Optional[List[int]] = None
    total_duration: Optional[int] = None
    load_duration: Optional[int] = None
    prompt_eval_count: Optional[int] = None
    prompt_eval_duration: Optional[int] = None
    eval_count: Optional[int] = None
    eval_duration: Optional[int] = None


class ChatResponse(BaseModel):
    model: str
    created_at: str
    message: ChatMessage
    done: bool
    total_duration: Optional[int] = None
    load_duration: Optional[int] = None
    prompt_eval_count: Optional[int] = None
    prompt_eval_duration: Optional[int] = None
    eval_count: Optional[int] = None
    eval_duration: Optional[int] = None


class ModelInfo(BaseModel):
    name: str
    modified_at: str
    size: int
    digest: str


class ModelsResponse(BaseModel):
    models: List[ModelInfo]


from typing import Any


def create_generation_config(options: Any) -> Optional[Any]:
    """Create LMDeploy GenerationConfig from Ollama-style options"""
    if not LMDEPLOY_AVAILABLE or GenerationConfig is None:
        return None
    # Ensure options is always a dict
    if options is None:
        options = {}
    return GenerationConfig(
        temperature=options.get("temperature", 0.7),
        top_p=options.get("top_p", 0.9),
        top_k=options.get("top_k", 40),
        max_new_tokens=options.get("num_predict", 512),
        stop_words=options.get("stop", []),
    )


def format_prompt_from_messages(messages: List[ChatMessage]) -> str:
    """Convert chat messages to a single prompt string"""
    prompt_parts = []

    for message in messages:
        if message.role == "system":
            prompt_parts.append(f"System: {message.content}")
        elif message.role == "user":
            prompt_parts.append(f"User: {message.content}")
        elif message.role == "assistant":
            prompt_parts.append(f"Assistant: {message.content}")

    return "\n".join(prompt_parts) + "\nAssistant: "


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "LMDeploy Server - Ollama Compatible API",
        "version": "1.0.0",
        "lmdeploy_available": LMDEPLOY_AVAILABLE,
    }


@app.get("/api/tags")
async def list_models():
    """List available models (Ollama compatible)"""
    try:
        supported_models = ModelConfig.list_supported_models()

        models = []
        for model_name in supported_models:
            model_config = ModelConfig.get_model_config(model_name)
            models.append(
                ModelInfo(
                    name=model_name,
                    modified_at=datetime.now().isoformat(),
                    size=1000000000,  # Placeholder size
                    digest=f"sha256:{hash(model_name)}",
                )
            )

        return ModelsResponse(models=models)

    except Exception as e:
        logger.error(f"Failed to list models: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate")
async def generate(request: GenerateRequest):
    """Generate text (Ollama compatible)"""
    if not LMDEPLOY_AVAILABLE:
        raise HTTPException(status_code=503, detail="LMDeploy not available")

    start_time = time.time()

    try:
        generation_config = create_generation_config(
            request.options if request.options is not None else {}
        )
        if request.stream:
            return StreamingResponse(
                generate_stream(
                    request.model, request.prompt, generation_config, start_time
                ),
                media_type="application/json",
            )
        else:
            # Non-streaming generation
            response_text = await model_manager.generate_text(
                request.model, request.prompt, generation_config
            )
            if response_text is None:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to generate text with model {request.model}",
                )
            total_duration = int(
                (time.time() - start_time) * 1000
            )  # Convert to milliseconds
            return GenerateResponse(
                model=request.model,
                created_at=datetime.now().isoformat(),
                response=response_text,
                done=True,
                total_duration=total_duration,
                eval_count=len(response_text.split()),  # Rough token count
                eval_duration=total_duration,
            )
    except Exception as e:
        logger.error(f"Generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def generate_stream(
    model_name: str, prompt: str, generation_config, start_time: float
) -> AsyncGenerator[str, None]:
    """Stream generation responses"""
    try:
        stream = await model_manager.generate_stream(
            model_name, prompt, generation_config
        )

        if stream is None:
            error_response = GenerateResponse(
                model=model_name,
                created_at=datetime.now().isoformat(),
                response="",
                done=True,
                total_duration=0,
            )
            yield f"{error_response.json()}\n"
            return

        full_response = ""
        async for chunk in stream:
            full_response += chunk

            response = GenerateResponse(
                model=model_name,
                created_at=datetime.now().isoformat(),
                response=chunk,
                done=False,
            )
            yield f"{response.json()}\n"

        # Final response
        total_duration = int((time.time() - start_time) * 1000)
        final_response = GenerateResponse(
            model=model_name,
            created_at=datetime.now().isoformat(),
            response="",
            done=True,
            total_duration=total_duration,
            eval_count=len(full_response.split()),
            eval_duration=total_duration,
        )
        yield f"{final_response.json()}\n"

    except Exception as e:
        logger.error(f"Streaming failed: {str(e)}")
        error_response = GenerateResponse(
            model=model_name,
            created_at=datetime.now().isoformat(),
            response=f"Error: {str(e)}",
            done=True,
            total_duration=0,
        )
        yield f"{error_response.json()}\n"


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Chat endpoint (Ollama compatible)"""
    if not LMDEPLOY_AVAILABLE:
        raise HTTPException(status_code=503, detail="LMDeploy not available")

    start_time = time.time()

    try:
        # Convert messages to prompt
        prompt = format_prompt_from_messages(request.messages)
        generation_config = create_generation_config(
            request.options if request.options is not None else {}
        )
        if request.stream:
            return StreamingResponse(
                chat_stream(request.model, prompt, generation_config, start_time),
                media_type="application/json",
            )
        else:
            # Non-streaming chat
            response_text = await model_manager.generate_text(
                request.model, prompt, generation_config
            )
            if response_text is None:
                raise HTTPException(
                    status_code=500, detail=f"Failed to chat with model {request.model}"
                )
            total_duration = int((time.time() - start_time) * 1000)
            return ChatResponse(
                model=request.model,
                created_at=datetime.now().isoformat(),
                message=ChatMessage(role="assistant", content=response_text),
                done=True,
                total_duration=total_duration,
                eval_count=len(response_text.split()),
                eval_duration=total_duration,
            )
    except Exception as e:
        logger.error(f"Chat failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def chat_stream(
    model_name: str, prompt: str, generation_config, start_time: float
) -> AsyncGenerator[str, None]:
    """Stream chat responses"""
    try:
        stream = await model_manager.generate_stream(
            model_name, prompt, generation_config
        )

        if stream is None:
            error_response = ChatResponse(
                model=model_name,
                created_at=datetime.now().isoformat(),
                message=ChatMessage(role="assistant", content=""),
                done=True,
                total_duration=0,
            )
            yield f"{error_response.json()}\n"
            return

        full_response = ""
        async for chunk in stream:
            full_response += chunk

            response = ChatResponse(
                model=model_name,
                created_at=datetime.now().isoformat(),
                message=ChatMessage(role="assistant", content=chunk),
                done=False,
            )
            yield f"{response.json()}\n"

        # Final response
        total_duration = int((time.time() - start_time) * 1000)
        final_response = ChatResponse(
            model=model_name,
            created_at=datetime.now().isoformat(),
            message=ChatMessage(role="assistant", content=""),
            done=True,
            total_duration=total_duration,
            eval_count=len(full_response.split()),
            eval_duration=total_duration,
        )
        yield f"{final_response.json()}\n"

    except Exception as e:
        logger.error(f"Chat streaming failed: {str(e)}")
        error_response = ChatResponse(
            model=model_name,
            created_at=datetime.now().isoformat(),
            message=ChatMessage(role="assistant", content=f"Error: {str(e)}"),
            done=True,
            total_duration=0,
        )
        yield f"{error_response.json()}\n"


@app.get("/api/status")
async def get_status():
    """Get server status"""
    return model_manager.get_system_status()


@app.post("/api/models/load/{model_name}")
async def load_model(model_name: str):
    """Manually load a model"""
    try:
        pipe = await model_manager.load_model(model_name)
        if pipe:
            return {
                "status": "success",
                "message": f"Model {model_name} loaded successfully",
            }
        else:
            raise HTTPException(
                status_code=500, detail=f"Failed to load model {model_name}"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/models/unload/{model_name}")
async def unload_model(model_name: str):
    """Manually unload a model"""
    try:
        success = model_manager.unload_model(model_name)
        if success:
            return {
                "status": "success",
                "message": f"Model {model_name} unloaded successfully",
            }
        else:
            raise HTTPException(status_code=404, detail=f"Model {model_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.on_event("startup")
async def startup_event():
    """Server startup event"""
    logger.info("LMDeploy Server starting up...")
    logger.info(f"Server will run on {config.host}:{config.port}")
    logger.info(f"LMDeploy available: {LMDEPLOY_AVAILABLE}")

    # Optionally preload default model
    if LMDEPLOY_AVAILABLE and config.default_model:
        try:
            await model_manager.load_model(config.default_model)
            logger.info(f"Preloaded default model: {config.default_model}")
        except Exception as e:
            logger.warning(f"Failed to preload default model: {str(e)}")


@app.on_event("shutdown")
async def shutdown_event():
    """Server shutdown event"""
    logger.info("LMDeploy Server shutting down...")

    # Cleanup loaded models
    for model_name in model_manager.list_loaded_models():
        model_manager.unload_model(model_name)

    logger.info("LMDeploy Server shutdown complete")


if __name__ == "__main__":
    uvicorn.run(
        "server:app", host=config.host, port=config.port, reload=True, log_level="info"
    )
