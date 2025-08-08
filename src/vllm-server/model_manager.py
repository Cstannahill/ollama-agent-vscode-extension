"""
vLLM Model Manager
Handles model loading, caching, and lifecycle management
"""

import asyncio
import logging
import time
from typing import Dict, List, Optional, AsyncGenerator
from contextlib import asynccontextmanager

try:
    from vllm import LLM, SamplingParams
    from vllm.engine.async_llm_engine import AsyncLLMEngine
    from vllm.engine.arg_utils import AsyncEngineArgs
    VLLM_AVAILABLE = True
except ImportError:
    VLLM_AVAILABLE = False

from .config import config, ModelConfig

logger = logging.getLogger(__name__)


class ModelManager:
    """Manages vLLM model instances with caching and lifecycle management"""
    
    def __init__(self):
        self._models: Dict[str, AsyncLLMEngine] = {}
        self._model_configs: Dict[str, Dict] = {}
        self._last_used: Dict[str, float] = {}
        self._loading_locks: Dict[str, asyncio.Lock] = {}
        
        if not VLLM_AVAILABLE:
            logger.warning("vLLM not available. Running in compatibility mode.")
    
    async def load_model(self, model_name: str, **kwargs) -> Optional[AsyncLLMEngine]:
        """Load a model asynchronously with caching"""
        
        if not VLLM_AVAILABLE:
            logger.error("vLLM not available. Cannot load model.")
            return None
        
        # Return cached model if available
        if model_name in self._models:
            self._last_used[model_name] = time.time()
            logger.info(f"Using cached model: {model_name}")
            return self._models[model_name]
        
        # Ensure only one loading process per model
        if model_name not in self._loading_locks:
            self._loading_locks[model_name] = asyncio.Lock()
        
        async with self._loading_locks[model_name]:
            # Double-check after acquiring lock
            if model_name in self._models:
                self._last_used[model_name] = time.time()
                return self._models[model_name]
            
            logger.info(f"Loading model: {model_name}")
            
            try:
                # Get model-specific configuration
                model_config = ModelConfig.get_model_config(model_name)
                
                # Merge with any provided kwargs
                engine_args = AsyncEngineArgs(
                    model=model_name,
                    max_model_len=kwargs.get('max_model_len', model_config.get('max_model_len', config.max_model_len)),
                    max_num_seqs=kwargs.get('max_num_seqs', config.max_num_seqs),
                    tensor_parallel_size=kwargs.get('tensor_parallel_size', model_config.get('tensor_parallel_size', config.tensor_parallel_size)),
                    gpu_memory_utilization=kwargs.get('gpu_memory_utilization', config.gpu_memory_utilization),
                    **kwargs
                )
                
                # Create async engine
                engine = AsyncLLMEngine.from_engine_args(engine_args)
                
                # Cache the model
                self._models[model_name] = engine
                self._model_configs[model_name] = model_config
                self._last_used[model_name] = time.time()
                
                logger.info(f"Successfully loaded model: {model_name}")
                return engine
                
            except Exception as e:
                logger.error(f"Failed to load model {model_name}: {str(e)}")
                return None
    
    def unload_model(self, model_name: str) -> bool:
        """Unload a model from memory"""
        if model_name in self._models:
            # vLLM doesn't have explicit cleanup, but we can remove our reference
            del self._models[model_name]
            del self._model_configs[model_name]
            del self._last_used[model_name]
            logger.info(f"Unloaded model: {model_name}")
            return True
        return False
    
    async def generate_text(
        self, 
        model_name: str, 
        prompt: str, 
        sampling_params: Optional[SamplingParams] = None,
        **kwargs
    ) -> Optional[str]:
        """Generate text using the specified model"""
        
        if not VLLM_AVAILABLE:
            logger.error("vLLM not available")
            return None
        
        engine = await self.load_model(model_name, **kwargs)
        if not engine:
            return None
        
        if sampling_params is None:
            sampling_params = SamplingParams(
                temperature=0.7,
                top_p=0.9,
                max_tokens=512
            )
        
        try:
            # Generate response
            results = engine.generate(prompt, sampling_params)
            async for request_output in results:
                if request_output.finished:
                    return request_output.outputs[0].text
            
        except Exception as e:
            logger.error(f"Generation failed for model {model_name}: {str(e)}")
            return None
    
    async def generate_stream(
        self,
        model_name: str,
        prompt: str,
        sampling_params: Optional[SamplingParams] = None,
        **kwargs
    ) -> Optional[AsyncGenerator[str, None]]:
        """Generate text with streaming response"""
        
        if not VLLM_AVAILABLE:
            logger.error("vLLM not available")
            return None
        
        engine = await self.load_model(model_name, **kwargs)
        if not engine:
            return None
        
        if sampling_params is None:
            sampling_params = SamplingParams(
                temperature=0.7,
                top_p=0.9,
                max_tokens=512
            )
        
        try:
            results = engine.generate(prompt, sampling_params)
            
            async def stream_generator():
                async for request_output in results:
                    if request_output.outputs:
                        # Yield incremental text
                        for output in request_output.outputs:
                            if output.text:
                                yield output.text
                    
                    if request_output.finished:
                        break
            
            return stream_generator()
            
        except Exception as e:
            logger.error(f"Streaming failed for model {model_name}: {str(e)}")
            return None
    
    def list_loaded_models(self) -> List[str]:
        """List currently loaded models"""
        return list(self._models.keys())
    
    def get_model_info(self, model_name: str) -> Optional[Dict]:
        """Get information about a loaded model"""
        if model_name in self._model_configs:
            return {
                "name": model_name,
                "config": self._model_configs[model_name],
                "last_used": self._last_used[model_name],
                "loaded": True
            }
        return None
    
    def get_system_status(self) -> Dict:
        """Get system status information"""
        return {
            "vllm_available": VLLM_AVAILABLE,
            "loaded_models": len(self._models),
            "model_list": self.list_loaded_models(),
            "supported_models": ModelConfig.list_supported_models()
        }
    
    async def cleanup_unused_models(self, max_idle_time: int = 3600):
        """Clean up models that haven't been used recently"""
        current_time = time.time()
        to_unload = []
        
        for model_name, last_used in self._last_used.items():
            if current_time - last_used > max_idle_time:
                to_unload.append(model_name)
        
        for model_name in to_unload:
            self.unload_model(model_name)
            logger.info(f"Cleaned up unused model: {model_name}")


# Global model manager instance
model_manager = ModelManager()