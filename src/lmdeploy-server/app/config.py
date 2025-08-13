"""
LMDeploy Server Configuration
Manages model configurations and server settings for the LMDeploy integration
"""

from typing import Dict, List
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


class LMDeployServerConfig(BaseSettings):
    """LMDeploy Server configuration settings"""

    # Server settings
    host: str = Field(default="127.0.0.1", description="Server host")
    port: int = Field(default=11435, description="Server port (Ollama + 1)")

    # Model settings
    default_model: str = Field(
        default="TheBloke/deepseek-coder-1.3b-instruct-AWQ",
        description="Default model to load",
    )
    max_model_len: int = Field(default=2048, description="Maximum model length")
    max_num_seqs: int = Field(default=256, description="Maximum number of sequences")

    # Performance settings
    tensor_parallel_size: int = Field(default=1, description="Tensor parallel size")
    gpu_memory_utilization: float = Field(
        default=0.9, description="GPU memory utilization ratio"
    )

    # API settings
    api_timeout: int = Field(default=300, description="API request timeout in seconds")
    enable_streaming: bool = Field(
        default=True, description="Enable streaming responses"
    )

    # Experimental features
    enable_batching: bool = Field(default=True, description="Enable request batching")
    batch_size: int = Field(default=8, description="Maximum batch size")

    model_config = {
        "env_prefix": "VLLM_",
        "case_sensitive": False,
    }


class ModelConfig:
    """Model-specific configuration"""

    SUPPORTED_MODELS = {
        "microsoft/DialoGPT-medium": {
            "max_model_len": 1024,
            "tensor_parallel_size": 1,
            "use_case": "chat",
            "description": "Microsoft DialoGPT medium model for conversation",
        },
        "TheBloke/deepseek-coder-1.3b-instruct-AWQ": {
            "max_model_len": 2048,
            "tensor_parallel_size": 1,
            "use_case": "code",
            "description": "DeepSeek Coder 1.3B model for code generation",
        },
        "meta-llama/Llama-2-7b-chat-hf": {
            "max_model_len": 4096,
            "tensor_parallel_size": 1,
            "use_case": "chat",
            "description": "Llama 2 7B chat model",
        },
        "mistralai/Mistral-7B-Instruct-v0.1": {
            "max_model_len": 8192,
            "tensor_parallel_size": 1,
            "use_case": "instruction",
            "description": "Mistral 7B instruction-following model",
        },
        "codellama/CodeLlama-7b-Python-hf": {
            "max_model_len": 4096,
            "tensor_parallel_size": 1,
            "use_case": "code",
            "description": "Code Llama 7B Python specialist",
        },
    }

    @classmethod
    def get_model_config(cls, model_name: str) -> Dict:
        """Get configuration for a specific model"""
        return cls.SUPPORTED_MODELS.get(
            model_name,
            {
                "max_model_len": 2048,
                "tensor_parallel_size": 1,
                "use_case": "general",
                "description": f"Custom model: {model_name}",
            },
        )

    @classmethod
    def list_supported_models(cls) -> List[str]:
        """List all supported model names"""
        return list(cls.SUPPORTED_MODELS.keys())


# Global configuration instance
config = LMDeployServerConfig()
