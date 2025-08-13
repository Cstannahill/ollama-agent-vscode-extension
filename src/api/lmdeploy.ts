import axios from "axios";
import { BaseLLM } from "@langchain/core/language_models/llms";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  CallbackManagerForLLMRun,
  CallbackManagerForLLMRun as CallbackManagerForChatModelRun,
} from "@langchain/core/callbacks/manager";
import { LLMResult, ChatResult, GenerationChunk, ChatGenerationChunk } from "@langchain/core/outputs";
import {
  BaseMessage,
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { StructuredToolInterface } from "@langchain/core/tools";
import { logger } from "../utils/logger";
import chalk from "chalk";

// Import types from ollama.ts to maintain interface compatibility
import {
  OllamaConfig,
  StreamingOptions,
  OllamaResponse,
  OllamaChatMessage,
  OllamaChatResponse,
  OllamaToolCall,
  LangChainToolCall,
  ToolCallResult,
} from "./ollama";

export interface LMDeployConfig extends OllamaConfig {
  baseUrl: string;
  model: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  numPredict?: number;
  // LMDeploy-specific options
  sessionLen?: number;
  maxBatchSize?: number;
  tensorParallelSize?: number;
  cacheMaxEntryCount?: number;
  engineType?: 'turbomind' | 'pytorch';
}

/**
 * LangChain-compatible LMDeploy LLM wrapper
 * Maintains the same interface as OllamaLLM for seamless integration
 * Provides superior performance with 1.8x higher throughput than vLLM
 */
export class LMDeployLLM extends BaseLLM {
  lc_serializable = true;

  private config: LMDeployConfig;

  constructor(config: LMDeployConfig) {
    super({});
    this.config = config;
  }

  _llmType(): string {
    return "lmdeploy";
  }

  /**
   * Generate text using LMDeploy's high-performance inference
   */
  async _generate(
    prompts: string[],
    options?: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<LLMResult> {
    const generations = [];

    for (const prompt of prompts) {
      try {
        logger.debug(
          chalk.magenta(
            `🚀 [LMDeploy] GENERATE → ${this.config.baseUrl}/api/generate | Model: ${this.config.model} | Provider: LMDeploy`
          )
        );

        const response = await axios.post(
          `${this.config.baseUrl}/api/generate`,
          {
            model: this.config.model,
            prompt,
            stream: false,
            options: {
              temperature: this.config.temperature || 0.7,
              top_p: this.config.topP || 0.9,
              top_k: this.config.topK || 40,
              num_predict: this.config.numPredict || 512,
            },
          },
          {
            timeout: options?.timeout || 60000,
          }
        );

        const responseData = response.data;

        if (responseData.response) {
          generations.push([
            {
              text: responseData.response,
              generationInfo: {
                model: this.config.model,
                provider: "lmdeploy",
                total_duration: responseData.total_duration,
                eval_count: responseData.eval_count,
                eval_duration: responseData.eval_duration,
              },
            },
          ]);
        } else {
          throw new Error("No response text received from LMDeploy");
        }
      } catch (error: any) {
        logger.error(chalk.yellow(`[LMDeploy] URL: ${this.config.baseUrl}/api/generate`));
        logger.error(chalk.yellow(`[LMDeploy] Model: ${this.config.model}`));
        logger.error(chalk.yellow(`[LMDeploy] Response data:`), error.response?.data);

        const { status } = error.response || {};
        if (status === 404) {
          if (error.config?.url?.includes("/api/generate")) {
            throw new Error(
              `Model '${this.config.model}' not found on LMDeploy server. Please check if the model is loaded.`
            );
          } else {
            throw new Error("LMDeploy server not found. Is it running?");
          }
        } else if (status === 503) {
          throw new Error(
            "LMDeploy server is not available. Please check server status."
          );
        } else {
          throw new Error(
            `LMDeploy generation failed: ${error.response?.data?.detail || error.message}`
          );
        }
      }
    }

    return {
      generations,
      llmOutput: {
        model: this.config.model,
        provider: "lmdeploy",
      },
    };
  }

  /**
   * Stream text generation with LMDeploy's optimized streaming
   */
  async *_streamResponseChunks(
    prompt: string,
    options?: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<GenerationChunk> {
    try {
      logger.debug(
        chalk.magenta(
          `🚀 [LMDeploy] GENERATE_STREAM → ${this.config.baseUrl}/api/generate | Model: ${this.config.model} | Provider: LMDeploy`
        )
      );

      const response = await axios.post(
        `${this.config.baseUrl}/api/generate`,
        {
          model: this.config.model,
          prompt,
          stream: true,
          options: {
            temperature: this.config.temperature || 0.7,
            top_p: this.config.topP || 0.9,
            top_k: this.config.topK || 40,
            num_predict: this.config.numPredict || 512,
          },
        },
        {
          responseType: "stream",
          timeout: options?.timeout || 60000,
        }
      );

      let buffer = "";
      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              if (data.response) {
                yield new GenerationChunk({
                  text: data.response,
                  generationInfo: {
                    model: this.config.model,
                    provider: "lmdeploy",
                    done: data.done || false,
                  },
                });
              }
              if (data.done) {
                return;
              }
            } catch (parseError) {
              logger.warn(`[LMDeploy] Failed to parse stream chunk: ${line}`);
            }
          }
        }
      }
    } catch (error: any) {
      logger.error(chalk.red(`[LMDeploy] Streaming failed: ${error.message}`));
      throw error;
    }
  }

  /**
   * Check if LMDeploy server is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/`, {
        timeout: 5000,
      });
      return response.status === 200 && response.data?.lmdeploy_available === true;
    } catch (error) {
      logger.debug(`[LMDeploy] Availability check failed: ${error}`);
      return false;
    }
  }

  /**
   * Generate text using simple interface (compatibility with Ollama)
   */
  async generateText(prompt: string): Promise<string> {
    const result = await this._generate([prompt]);
    return result.generations[0][0].text;
  }

  /**
   * List models (compatibility with Ollama)
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/tags`);
      return response.data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      logger.error(`[LMDeploy] Failed to list models: ${error}`);
      return [];
    }
  }

  /**
   * Get server status (compatibility with Ollama)
   */
  async getServerStatus(): Promise<any> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/status`);
      return response.data;
    } catch (error) {
      logger.error(`[LMDeploy] Failed to get server status: ${error}`);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  _identifyingParams() {
    return {
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      provider: "lmdeploy",
    };
  }
}

/**
 * LangChain-compatible LMDeploy Chat Model wrapper
 * Optimized for chat completions and foundation agent interactions
 */
export class LMDeployChatModel extends BaseChatModel {
  lc_serializable = true;

  private config: LMDeployConfig;

  constructor(config: LMDeployConfig) {
    super({});
    this.config = config;
  }

  _llmType(): string {
    return "lmdeploy-chat";
  }

  /**
   * Convert LangChain messages to LMDeploy format
   */
  private convertMessages(messages: BaseMessage[]): OllamaChatMessage[] {
    return messages.map((message) => {
      if (message instanceof SystemMessage) {
        return { role: "system", content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) };
      } else if (message instanceof HumanMessage) {
        return { role: "user", content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) };
      } else if (message instanceof AIMessage) {
        return { role: "assistant", content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) };
      } else if (message instanceof ToolMessage) {
        // Convert tool message to assistant role since OllamaChatMessage doesn't support tool role
        return { role: "assistant", content: `Tool result: ${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}` };
      } else {
        throw new Error(`Unsupported message type: ${message.constructor.name}`);
      }
    });
  }

  /**
   * Generate chat completion using LMDeploy
   */
  async _generate(
    messages: BaseMessage[],
    options?: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const lmdeployMessages = this.convertMessages(messages);

    try {
      logger.info(
        chalk.magenta(
          `🚀 [LMDeploy] CHAT → ${this.config.baseUrl}/api/chat | Model: ${this.config.model} | Provider: LMDeploy`
        )
      );

      const response = await axios.post(
        `${this.config.baseUrl}/api/chat`,
        {
          model: this.config.model,
          messages: lmdeployMessages,
          stream: false,
          options: {
            temperature: this.config.temperature || 0.7,
            top_p: this.config.topP || 0.9,
            top_k: this.config.topK || 40,
            num_predict: this.config.numPredict || 512,
          },
        },
        {
          timeout: options?.timeout || 60000,
        }
      );

      const responseData = response.data;

      if (responseData.message && responseData.message.content) {
        return {
          generations: [
            {
              message: new AIMessage(responseData.message.content),
              text: responseData.message.content,
              generationInfo: {
                model: this.config.model,
                provider: "lmdeploy",
                total_duration: responseData.total_duration,
                eval_count: responseData.eval_count,
                eval_duration: responseData.eval_duration,
              },
            },
          ],
        };
      } else {
        throw new Error("No response content received from LMDeploy");
      }
    } catch (error: any) {
      logger.error(
        chalk.yellow(`[LMDeploy CHAT] URL: ${this.config.baseUrl}/api/chat`)
      );
      logger.error(chalk.yellow(`[LMDeploy CHAT] Model: ${this.config.model}`));
      logger.error(
        chalk.yellow(`[LMDeploy CHAT] Response data:`),
        error.response?.data
      );

      const { status } = error.response || {};
      if (status === 404) {
        throw new Error(
          `Model '${this.config.model}' not found on LMDeploy server. Please check if the model is loaded.`
        );
      } else if (status === 500) {
        throw new Error(
          `LMDeploy server error: ${error.response?.data?.detail || "Internal server error"}`
        );
      } else {
        throw new Error(
          `LMDeploy chat failed: ${error.response?.data?.detail || error.message}`
        );
      }
    }
  }

  /**
   * Stream chat completion with LMDeploy's optimized streaming
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options?: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    const lmdeployMessages = this.convertMessages(messages);

    try {
      logger.debug(
        chalk.magenta(
          `🚀 [LMDeploy] CHAT_STREAM → ${this.config.baseUrl}/api/chat | Model: ${this.config.model} | Provider: LMDeploy`
        )
      );

      const response = await axios.post(
        `${this.config.baseUrl}/api/chat`,
        {
          model: this.config.model,
          messages: lmdeployMessages,
          stream: true,
          options: {
            temperature: this.config.temperature || 0.7,
            top_p: this.config.topP || 0.9,
            top_k: this.config.topK || 40,
            num_predict: this.config.numPredict || 512,
          },
        },
        {
          responseType: "stream",
          timeout: options?.timeout || 60000,
        }
      );

      let buffer = "";
      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              if (data.message && data.message.content) {
                yield new ChatGenerationChunk({
                  text: data.message.content,
                  message: new AIMessageChunk({ content: data.message.content }),
                  generationInfo: {
                    model: this.config.model,
                    provider: "lmdeploy",
                    done: data.done || false,
                  },
                });
              }
              if (data.done) {
                return;
              }
            } catch (parseError) {
              logger.warn(`[LMDeploy] Failed to parse chat stream chunk: ${line}`);
            }
          }
        }
      }
    } catch (error: any) {
      logger.error(chalk.red(`[LMDeploy] Chat streaming failed: ${error.message}`));
      throw error;
    }
  }

  /**
   * Check if LMDeploy server is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/`, {
        timeout: 5000,
      });
      return response.status === 200 && response.data?.lmdeploy_available === true;
    } catch (error) {
      logger.debug(`[LMDeploy] Availability check failed: ${error}`);
      return false;
    }
  }

  /**
   * List models (compatibility with Ollama)
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/tags`);
      return response.data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      logger.error(`[LMDeploy] Failed to list models: ${error}`);
      return [];
    }
  }

  /**
   * Get available models from LMDeploy server
   */
  async getModels(): Promise<string[]> {
    return this.listModels();
  }

  /**
   * Get server status (compatibility with Ollama)
   */
  async getServerStatus(): Promise<any> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/status`);
      return response.data;
    } catch (error) {
      logger.error(`[LMDeploy] Failed to get server status: ${error}`);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  _identifyingParams() {
    return {
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      provider: "lmdeploy",
    };
  }
}