"""
LMDeploy Model Manager
Handles model loading, caching, and lifecycle management
Superior performance compared to vLLM for high-throughput scenarios
"""

from typing import Any

import asyncio
import logging
import time
from typing import Dict, List, Optional, AsyncGenerator
from contextlib import asynccontextmanager

try:
    import lmdeploy
    from lmdeploy import pipeline, GenerationConfig, TurbomindEngineConfig

    LMDEPLOY_AVAILABLE = True
except ImportError:
    pipeline = None
    GenerationConfig = None
    TurbomindEngineConfig = None
    LMDEPLOY_AVAILABLE = False

from .config import config, ModelConfig

logger = logging.getLogger(__name__)


class ModelManager:
    """Manages LMDeploy model instances with caching and lifecycle management"""

    def __init__(self):
        self._models: Dict[str, Any] = {}  # Store pipeline instances
        self._model_configs: Dict[str, Dict] = {}
        self._last_used: Dict[str, float] = {}
        self._loading_locks: Dict[str, asyncio.Lock] = {}

        if not LMDEPLOY_AVAILABLE:
            logger.warning("LMDeploy not available. Running in compatibility mode.")

    async def load_model(self, model_name: str, **kwargs) -> Optional[Any]:
        """Load a model asynchronously with caching"""

        if not LMDEPLOY_AVAILABLE:
            logger.error("LMDeploy not available. Cannot load model.")
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

                if LMDEPLOY_AVAILABLE:
                    if TurbomindEngineConfig is None:
                        logger.error("TurbomindEngineConfig is not available.")
                        return None
                    engine_config = TurbomindEngineConfig(
                        session_len=kwargs.get(
                            "max_model_len",
                            model_config.get("max_model_len", config.max_model_len),
                        ),
                        max_batch_size=kwargs.get("max_num_seqs", config.max_num_seqs),
                        tp=kwargs.get(
                            "tensor_parallel_size",
                            model_config.get(
                                "tensor_parallel_size", config.tensor_parallel_size
                            ),
                        ),
                        cache_max_entry_count=kwargs.get(
                            "cache_max_entry_count", 0.8
                        ),  # Use 80% of GPU memory
                    )

                    if pipeline is None:
                        logger.error("pipeline is not available. Cannot load model.")
                        return None

                    loop = asyncio.get_event_loop()
                    # Only call pipeline if it is not None
                    try:

                        def safe_pipeline():
                            if pipeline is None:
                                logger.error(
                                    "pipeline is not available (inside lambda). Cannot load model."
                                )
                                return None
                            return pipeline(
                                model_name,
                                backend_config=engine_config,
                            )

                        pipe = await loop.run_in_executor(None, safe_pipeline)
                        if pipe is None:
                            logger.error("Pipeline returned None. Model not loaded.")
                            return None
                    except Exception as e:
                        logger.error(f"Error calling pipeline: {str(e)}")
                        return None

                    # Cache the model
                    self._models[model_name] = pipe
                    self._model_configs[model_name] = model_config
                    self._last_used[model_name] = time.time()

                    logger.info(f"Successfully loaded model: {model_name}")
                    return pipe
                else:
                    logger.error(
                        "LMDeploy not available. Cannot create engine or pipeline."
                    )
                    return None

            except Exception as e:
                logger.error(f"Failed to load model {model_name}: {str(e)}")
                return None

    def unload_model(self, model_name: str) -> bool:
        """Unload a model from memory"""
        if model_name in self._models:
            pipe = self._models[model_name]
            try:
                # LMDeploy pipelines cleanup automatically when deleted
                # But we can try to call close if it exists
                if hasattr(pipe, "close"):
                    pipe.close()
            except Exception as e:
                logger.warning(f"Error during model cleanup: {str(e)}")

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
        generation_config: Optional[Any] = None,
        **kwargs,
    ) -> Optional[str]:
        """Generate text using the specified model"""

        if not LMDEPLOY_AVAILABLE:
            logger.error("LMDeploy not available")
            return None

        pipe = await self.load_model(model_name, **kwargs)
        if not pipe:
            return None

        if generation_config is None:
            if LMDEPLOY_AVAILABLE:
                if GenerationConfig is None:
                    logger.error("GenerationConfig is not available.")
                    return None
                generation_config = GenerationConfig(
                    temperature=0.7, top_p=0.9, max_new_tokens=512
                )
            else:
                generation_config = None

        try:
            # Generate response (run in thread pool for async compatibility)
            loop = asyncio.get_event_loop()

            # LMDeploy expects a list of prompts and returns a list of responses
            def sync_generate():
                results = pipe([prompt], gen_config=generation_config)
                return results

            results = await loop.run_in_executor(None, sync_generate)

            # Extract text from first result
            if results and len(results) > 0:
                # LMDeploy results have a .text attribute
                result = results[0]
                if hasattr(result, "text"):
                    return result.text
                elif isinstance(result, str):
                    return result
                else:
                    # Fallback: convert to string
                    return str(result)

            return None

        except Exception as e:
            logger.error(f"Generation failed for model {model_name}: {str(e)}")
            return None

    async def generate_stream(
        self,
        model_name: str,
        prompt: str,
        generation_config: Optional[Any] = None,
        **kwargs,
    ) -> Optional[AsyncGenerator[str, None]]:
        """Generate text with streaming response"""

        if not LMDEPLOY_AVAILABLE:
            logger.error("LMDeploy not available")
            return None

        pipe = await self.load_model(model_name, **kwargs)
        if not pipe:
            return None

        if generation_config is None:
            if LMDEPLOY_AVAILABLE:
                if GenerationConfig is None:
                    logger.error("GenerationConfig is not available.")
                    return None
                generation_config = GenerationConfig(
                    temperature=0.7, top_p=0.9, max_new_tokens=512
                )
            else:
                generation_config = None

        try:

            async def stream_generator():
                # LMDeploy streaming support
                loop = asyncio.get_event_loop()

                def sync_stream():
                    """Synchronous streaming generator"""
                    try:
                        for output in pipe.stream_infer(
                            [prompt], gen_config=generation_config
                        ):
                            if output and len(output) > 0:
                                result = output[0]
                                if hasattr(result, "text"):
                                    yield result.text
                                elif isinstance(result, str):
                                    yield result
                                else:
                                    yield str(result)
                    except Exception as e:
                        logger.error(f"Stream generator error: {str(e)}")
                        return

                # Run synchronous streaming in executor
                import concurrent.futures
                import queue
                import threading

                result_queue = queue.Queue()
                exception_container: List[Any] = [None]

                def run_stream():
                    try:
                        for chunk in sync_stream():
                            result_queue.put(("chunk", chunk))
                        result_queue.put(("done", None))
                    except Exception as e:
                        exception_container[0] = str(e)
                        result_queue.put(("error", str(e)))

                # Start streaming in background thread
                stream_thread = threading.Thread(target=run_stream)
                stream_thread.start()

                try:
                    while True:
                        # Get next item from queue (blocking)
                        item_type, item_value = await loop.run_in_executor(
                            None, result_queue.get
                        )

                        if item_type == "chunk":
                            yield item_value
                        elif item_type == "done":
                            break
                        elif item_type == "error":
                            logger.error(f"Streaming error: {item_value}")
                            break

                finally:
                    stream_thread.join(timeout=1.0)  # Wait for thread to finish

            return stream_generator()

        except Exception as e:
            logger.error(f"Streaming setup failed for model {model_name}: {str(e)}")
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
                "loaded": True,
            }
        return None

    def get_system_status(self) -> Dict:
        """Get system status information"""
        return {
            "lmdeploy_available": LMDEPLOY_AVAILABLE,
            "loaded_models": len(self._models),
            "model_list": self.list_loaded_models(),
            "supported_models": ModelConfig.list_supported_models(),
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
