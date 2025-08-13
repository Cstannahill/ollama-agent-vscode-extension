import axios from "axios";
import { BaseLLM } from "@langchain/core/language_models/llms";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  CallbackManagerForLLMRun,
  CallbackManagerForLLMRun as CallbackManagerForChatModelRun,
} from "@langchain/core/callbacks/manager";
import { LLMResult, ChatResult } from "@langchain/core/outputs";
import {
  BaseMessage,
  AIMessage,
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

export interface VLLMConfig extends OllamaConfig {
  baseUrl: string;
  model: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  numPredict?: number;
  // vLLM-specific options
  maxModelLen?: number;
  tensorParallelSize?: number;
  gpuMemoryUtilization?: number;
}

/**
 * LangChain-compatible vLLM LLM wrapper
 * Maintains the same interface as OllamaLLM for seamless integration
 */
export class VLLMLLM extends BaseLLM {
  lc_serializable = true;

  private config: VLLMConfig;

  constructor(config: VLLMConfig) {
    super({});
    this.config = config;
  }

  _llmType(): string {
    return "vllm";
  }

  async _generate(
    prompts: string[],
    options?: any,
    runManager?: CallbackManagerForLLMRun
  ): Promise<LLMResult> {
    const generations = [];

    for (const prompt of prompts) {
      try {
        const response = await this.generateText(prompt);
        generations.push([{ text: response }]);
      } catch (error) {
        logger.error(chalk.red("Failed to generate text with vLLM:"), error);
        throw error;
      }
    }

    return { generations };
  }

  /**
   * Generate text using vLLM's generate endpoint with streaming support
   */
  async generateTextStreaming(
    prompt: string,
    streamingOptions?: StreamingOptions
  ): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      try {
        logger.debug(
          chalk.magenta(
            `🔥 [vLLM] GENERATE_STREAM → ${this.config.baseUrl}/api/generate | Model: ${this.config.model} | Provider: vLLM`
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
              num_predict: this.config.numPredict || -1,
            },
          },
          {
            responseType: 'stream',
          }
        );

        let fullText = '';
        let buffer = '';

        response.data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.trim() === '') continue;

            try {
              const data: OllamaResponse = JSON.parse(line);
              if (data.response) {
                fullText += data.response;
                streamingOptions?.onChunk?.(data.response);
                streamingOptions?.onProgress?.({
                  text: fullText,
                  isComplete: data.done || false,
                });
              }

              if (data.done) {
                streamingOptions?.onComplete?.(fullText);
                resolve(fullText);
                return;
              }
            } catch (parseError) {
              logger.debug('[VLLM] Failed to parse streaming chunk:', parseError);
            }
          }
        });

        response.data.on('end', () => {
          if (fullText) {
            streamingOptions?.onComplete?.(fullText);
            resolve(fullText);
          } else {
            reject(new Error('No response received from vLLM stream'));
          }
        });

        response.data.on('error', (error: Error) => {
          streamingOptions?.onError?.(error);
          reject(error);
        });
      } catch (error) {
        streamingOptions?.onError?.(error as Error);
        reject(error);
      }
    });
  }

  /**
   * Generate text using vLLM's generate endpoint
   */
  async generateText(prompt: string): Promise<string> {
    try {
      logger.info(
        chalk.magenta(
          `🔥 [vLLM] GENERATE → ${this.config.baseUrl}/api/generate | Model: ${this.config.model} | Provider: vLLM`
        )
      );

      const response = await axios.post<OllamaResponse>(
        `${this.config.baseUrl}/api/generate`,
        {
          model: this.config.model,
          prompt,
          stream: false,
          options: {
            temperature: this.config.temperature || 0.7,
            top_p: this.config.topP || 0.9,
            top_k: this.config.topK || 40,
            num_predict: this.config.numPredict || -1,
          },
        }
      );

      return response.data.response;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        const responseData = error.response?.data;

        logger.error(
          chalk.red(`[VLLM] Request failed - Status: ${status} ${statusText}`)
        );
        logger.error(
          chalk.yellow(`[VLLM] URL: ${this.config.baseUrl}/api/generate`)
        );
        logger.error(chalk.yellow(`[VLLM] Model: ${this.config.model}`));
        logger.error(chalk.yellow(`[VLLM] Response data:`), responseData);

        if (status === 404) {
          if (error.config?.url?.includes("/api/generate")) {
            throw new Error(
              `Model '${this.config.model}' not found on vLLM server. Please check if the model is loaded.`
            );
          } else {
            throw new Error(
              `vLLM API endpoint not found. Please check if vLLM server is running at ${this.config.baseUrl}`
            );
          }
        } else if (status === 500) {
          throw new Error(
            `vLLM server error: ${
              responseData?.error || "Internal server error"
            }`
          );
        } else if (status === 503) {
          throw new Error(
            `vLLM service unavailable: ${
              responseData?.detail || "vLLM not available"
            }`
          );
        } else {
          throw new Error(
            `vLLM request failed: ${status} ${statusText} - ${
              responseData?.error || error.message
            }`
          );
        }
      } else {
        logger.error(chalk.red("vLLM generate request failed:"), error);
        throw new Error(`Failed to generate text: ${error}`);
      }
    }
  }

  /**
   * Chat with vLLM using the chat endpoint with streaming support
   */
  async chatStreaming(
    messages: OllamaChatMessage[],
    streamingOptions?: StreamingOptions
  ): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      try {
        logger.debug(
          chalk.magenta(
            `🔥 [vLLM] CHAT_STREAM → ${this.config.baseUrl}/api/chat | Model: ${this.config.model} | Provider: vLLM`
          )
        );

        const response = await axios.post(
          `${this.config.baseUrl}/api/chat`,
          {
            model: this.config.model,
            messages,
            stream: true,
            options: {
              temperature: this.config.temperature || 0.7,
              top_p: this.config.topP || 0.9,
              top_k: this.config.topK || 40,
              num_predict: this.config.numPredict || -1,
            },
          },
          {
            responseType: 'stream',
          }
        );

        let fullText = '';
        let buffer = '';

        response.data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.trim() === '') continue;

            try {
              const data: OllamaChatResponse = JSON.parse(line);
              if (data.message?.content) {
                const newContent = data.message.content;
                fullText += newContent;
                streamingOptions?.onChunk?.(newContent);
                streamingOptions?.onProgress?.({
                  text: fullText,
                  isComplete: data.done || false,
                });
              }

              if (data.done) {
                streamingOptions?.onComplete?.(fullText);
                resolve(fullText);
                return;
              }
            } catch (parseError) {
              logger.debug('[VLLM] Failed to parse streaming chunk:', parseError);
            }
          }
        });

        response.data.on('end', () => {
          if (fullText) {
            streamingOptions?.onComplete?.(fullText);
            resolve(fullText);
          } else {
            reject(new Error('No response received from vLLM stream'));
          }
        });

        response.data.on('error', (error: Error) => {
          streamingOptions?.onError?.(error);
          reject(error);
        });
      } catch (error) {
        streamingOptions?.onError?.(error as Error);
        reject(error);
      }
    });
  }

  /**
   * Chat with vLLM using the chat endpoint
   */
  async chat(messages: OllamaChatMessage[]): Promise<string> {
    try {
      const response = await axios.post<OllamaChatResponse>(
        `${this.config.baseUrl}/api/chat`,
        {
          model: this.config.model,
          messages,
          stream: false,
          options: {
            temperature: this.config.temperature || 0.7,
            top_p: this.config.topP || 0.9,
            top_k: this.config.topK || 40,
            num_predict: this.config.numPredict || -1,
          },
        }
      );

      return response.data.message.content;
    } catch (error) {
      logger.error("vLLM chat request failed:", error);
      throw new Error(`Failed to chat: ${error}`);
    }
  }

  /**
   * Check if vLLM server is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      logger.info(
        chalk.blue(
          `🔥 [vLLM] AVAILABILITY_CHECK → ${this.config.baseUrl}/api/tags | Provider: vLLM`
        )
      );
      const response = await axios.get(`${this.config.baseUrl}/api/tags`);
      logger.info(
        chalk.green(
          `🔥 [vLLM] ✅ AVAILABLE | Models: ${response.data.models?.length || 0} | Provider: vLLM`
        )
      );
      return true;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          chalk.red(
            `[VLLM] Server check failed - Status: ${error.response?.status} ${error.response?.statusText}`
          )
        );
        logger.error(
          chalk.yellow(`[VLLM] URL: ${this.config.baseUrl}/api/tags`)
        );
      } else {
        logger.error(chalk.red("vLLM server check failed:"), error);
      }
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/tags`);
      return response.data.models.map((model: any) => model.name);
    } catch (error) {
      logger.error("Failed to list vLLM models:", error);
      throw new Error(`Failed to list models: ${error}`);
    }
  }

  /**
   * Check if a specific model is available
   */
  async isModelAvailable(modelName: string): Promise<boolean> {
    try {
      const models = await this.listModels();
      const available = models.includes(modelName);
      logger.debug(
        chalk.blue(`[VLLM] Model ${modelName} availability: ${available}`)
      );
      if (!available) {
        logger.info(
          chalk.yellow(`[VLLM] Available models: ${models.join(", ")}`)
        );
      }
      return available;
    } catch (error) {
      logger.error(
        chalk.red(
          `[VLLM] Failed to check model availability for ${modelName}:`
        ),
        error
      );
      return false;
    }
  }

  /**
   * Get server status (vLLM-specific)
   */
  async getServerStatus(): Promise<any> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/status`);
      return response.data;
    } catch (error) {
      logger.error("Failed to get vLLM server status:", error);
      throw new Error(`Failed to get server status: ${error}`);
    }
  }

  /**
   * Load a model on the vLLM server
   */
  async loadModel(modelName: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.config.baseUrl}/api/models/load/${modelName}`
      );
      logger.info(chalk.green(`[VLLM] Loaded model: ${modelName}`));
      return true;
    } catch (error) {
      logger.error(chalk.red(`[VLLM] Failed to load model ${modelName}:`), error);
      return false;
    }
  }

  /**
   * Unload a model from the vLLM server
   */
  async unloadModel(modelName: string): Promise<boolean> {
    try {
      const response = await axios.delete(
        `${this.config.baseUrl}/api/models/unload/${modelName}`
      );
      logger.info(chalk.green(`[VLLM] Unloaded model: ${modelName}`));
      return true;
    } catch (error) {
      logger.error(chalk.red(`[VLLM] Failed to unload model ${modelName}:`), error);
      return false;
    }
  }
}

/**
 * LangChain-compatible vLLM Chat Model wrapper for tool calling
 * Uses the same interface as OllamaChatModel
 */
export class VLLMChatModel extends BaseChatModel {
  lc_serializable = true;

  private config: VLLMConfig;
  private boundTools: StructuredToolInterface[] = [];
  private toolSystemPromptCache: Map<string, string> = new Map(); // Cache for tool system prompts

  constructor(config: VLLMConfig) {
    super({});
    this.config = config;
  }

  _llmType(): string {
    return "vllm-chat";
  }

  _identifyingParams() {
    return {
      model: this.config.model,
      baseUrl: this.config.baseUrl,
    };
  }

  /**
   * Bind tools to the model for function calling
   */
  bindTools(tools: StructuredToolInterface[], _kwargs?: any): this {
    logger.debug(
      chalk.blue(
        `[VLLM CHAT] Binding ${tools.length} tools to VLLMChatModel`
      )
    );
    const newInstance = new (this.constructor as any)(this.config) as this;
    (newInstance as any).boundTools = [...tools];
    return newInstance;
  }

  async _generate(
    messages: BaseMessage[],
    options?: any,
    runManager?: CallbackManagerForChatModelRun
  ): Promise<ChatResult> {
    try {
      // Convert LangChain messages to Ollama format (compatible with vLLM server)
      let ollamaMessages = messages.map((msg) => this.messageToOllama(msg));

      // Add structured tool calling system prompt if tools are bound
      if (this.boundTools.length > 0) {
        const toolSystemPrompt = this.createToolCallingSystemPrompt();

        // Find existing system message or create one
        const systemMessageIndex = ollamaMessages.findIndex(
          (msg) => msg.role === "system"
        );
        if (systemMessageIndex >= 0) {
          // Append to existing system message
          ollamaMessages[systemMessageIndex].content +=
            "\n\n" + toolSystemPrompt;
        } else {
          // Add new system message at the beginning
          ollamaMessages.unshift({
            role: "system",
            content: toolSystemPrompt,
          });
        }
      }

      logger.info(
        chalk.magenta(
          `🔥 [vLLM] CHAT → ${this.config.baseUrl}/api/chat | Model: ${this.config.model} | Provider: vLLM`
        )
      );

      const response = await axios.post<OllamaChatResponse>(
        `${this.config.baseUrl}/api/chat`,
        {
          model: this.config.model,
          messages: ollamaMessages,
          stream: false,
          options: {
            temperature: this.config.temperature || 0.7,
            top_p: this.config.topP || 0.9,
            top_k: this.config.topK || 40,
            num_predict: this.config.numPredict || -1,
          },
        }
      );

      const responseContent = response.data.message.content;

      // Parse tool calls from the response (same logic as Ollama)
      const toolCalls = this.parseToolCalls(responseContent);

      let aiMessage: AIMessage;
      if (toolCalls.length > 0) {
        // Create AI message with tool calls
        aiMessage = new AIMessage({
          content: responseContent,
          tool_calls: toolCalls,
        });
      } else {
        // Regular AI message
        aiMessage = new AIMessage(responseContent);
      }

      return {
        generations: [
          {
            text: responseContent,
            message: aiMessage,
          },
        ],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        const responseData = error.response?.data;

        logger.error(
          chalk.red(
            `[VLLM CHAT] Request failed - Status: ${status} ${statusText}`
          )
        );
        logger.error(
          chalk.yellow(`[VLLM CHAT] URL: ${this.config.baseUrl}/api/chat`)
        );
        logger.error(chalk.yellow(`[VLLM CHAT] Model: ${this.config.model}`));
        logger.error(
          chalk.yellow(`[VLLM CHAT] Response data:`),
          responseData
        );

        if (status === 404) {
          throw new Error(
            `Model '${this.config.model}' not found on vLLM server. Please check if the model is loaded.`
          );
        } else if (status === 500) {
          throw new Error(
            `vLLM server error: ${
              responseData?.error || "Internal server error"
            }`
          );
        } else if (status === 503) {
          throw new Error(
            `vLLM service unavailable: ${
              responseData?.detail || "vLLM not available"
            }`
          );
        } else {
          throw new Error(
            `vLLM request failed: ${status} ${statusText} - ${
              responseData?.error || error.message
            }`
          );
        }
      } else {
        logger.error(chalk.red("vLLM chat request failed:"), error);
        throw error;
      }
    }
  }

  // Use the same message conversion and tool calling logic as OllamaChatModel
  private messageToOllama(message: BaseMessage): OllamaChatMessage {
    if (message instanceof HumanMessage) {
      return { role: "user", content: message.content.toString() };
    } else if (message instanceof AIMessage) {
      return { role: "assistant", content: message.content.toString() };
    } else if (message instanceof SystemMessage) {
      return { role: "system", content: message.content.toString() };
    } else if (message instanceof ToolMessage) {
      // Tool messages are converted to user messages with special formatting
      return {
        role: "user",
        content: `TOOL_RESULT[${
          message.tool_call_id
        }]: ${message.content.toString()}`,
      };
    } else {
      return { role: "user", content: message.content.toString() };
    }
  }

  private createToolCallingSystemPrompt(): string {
    // Create cache key based on bound tools (for cache hit)
    const toolNamesHash = this.boundTools.map(t => t.name).sort().join('|');
    const cacheKey = `tools_${toolNamesHash}_${this.boundTools.length}`;
    
    // Check cache first (avoids expensive 170KB+ generation)
    const cached = this.toolSystemPromptCache.get(cacheKey);
    if (cached) {
      logger.debug(`[VLLM_CHAT] Tool system prompt cache hit for ${this.boundTools.length} tools`);
      return cached;
    }

    logger.debug(`[VLLM_CHAT] Generating tool system prompt for ${this.boundTools.length} tools (cache miss)`);
    
    // Generate tool descriptions (expensive operation)
    const toolsJson = this.boundTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    }));

    const systemPrompt = `# Tool Calling Instructions

You have access to the following tools. When you need to use a tool, respond with a JSON object in this exact format:

\`\`\`json
{
  "tool_calls": [
    {
      "id": "call_<unique_id>",
      "type": "function",
      "function": {
        "name": "<tool_name>",
        "arguments": "<json_string_of_parameters>"
      }
    }
  ]
}
\`\`\`

Available Tools:
${JSON.stringify(toolsJson, null, 2)}

Rules:
1. Each tool call must have a unique ID starting with "call_"
2. Arguments must be a valid JSON string
3. You can make multiple tool calls in one response
4. Only use tools when necessary to complete the user's request
5. After receiving tool results, provide a helpful response to the user

If you don't need to use any tools, respond normally without the JSON format.`;

    // Cache the result for future use (improves performance significantly)
    this.toolSystemPromptCache.set(cacheKey, systemPrompt);
    
    // Limit cache size to prevent memory leaks
    if (this.toolSystemPromptCache.size > 10) {
      const firstKey = this.toolSystemPromptCache.keys().next().value;
      if (firstKey) {
        this.toolSystemPromptCache.delete(firstKey);
      }
    }
    
    const promptSize = Math.round(systemPrompt.length / 1024);
    logger.info(`[VLLM_CHAT] Cached tool system prompt (${promptSize}KB) for ${this.boundTools.length} tools`);
    
    return systemPrompt;
  }

  private parseToolCalls(content: string): LangChainToolCall[] {
    const toolCalls: LangChainToolCall[] = [];

    try {
      // Look for JSON blocks with tool_calls (same logic as Ollama)
      const jsonMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        const jsonContent = jsonMatch[1];
        const parsed = JSON.parse(jsonContent);

        if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
          for (const call of parsed.tool_calls) {
            if (call.id && call.function && call.function.name) {
              try {
                const args = JSON.parse(call.function.arguments || "{}");
                toolCalls.push({
                  id: call.id,
                  name: call.function.name,
                  args: args,
                });
              } catch (parseError) {
                logger.warn(
                  `Failed to parse tool arguments for ${call.function.name}:`,
                  parseError
                );
              }
            }
          }
        }
      }
    } catch (error) {
      logger.warn("Failed to parse tool calls from vLLM response:", error);
      logger.debug("Response content:", content);
    }

    return toolCalls;
  }

  /**
   * Check if vLLM server is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      logger.debug(
        `Checking vLLM availability at: ${this.config.baseUrl}/api/tags`
      );
      const response = await axios.get(`${this.config.baseUrl}/api/tags`);
      logger.debug(
        `vLLM server is available. Found ${
          response.data.models?.length || 0
        } models`
      );
      return true;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          `vLLM server check failed - Status: ${error.response?.status} ${error.response?.statusText}`
        );
        logger.error(`URL: ${this.config.baseUrl}/api/tags`);
      } else {
        logger.error("vLLM server check failed:", error);
      }
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/tags`);
      return response.data.models.map((model: any) => model.name);
    } catch (error) {
      logger.error("Failed to list vLLM models:", error);
      throw new Error(`Failed to list models: ${error}`);
    }
  }

  /**
   * Check if a specific model is available
   */
  async isModelAvailable(modelName: string): Promise<boolean> {
    try {
      const models = await this.listModels();
      const available = models.includes(modelName);
      logger.debug(`vLLM Model ${modelName} availability: ${available}`);
      if (!available) {
        logger.info(`Available vLLM models: ${models.join(", ")}`);
      }
      return available;
    } catch (error) {
      logger.error(
        `Failed to check vLLM model availability for ${modelName}:`,
        error
      );
      return false;
    }
  }
}

/**
 * Factory function to create a vLLM LLM instance
 */
export function createVLLMLLM(config: VLLMConfig): VLLMLLM {
  return new VLLMLLM(config);
}

/**
 * Factory function to create a vLLM Chat Model instance
 */
export function createVLLMChatModel(config: VLLMConfig): VLLMChatModel {
  return new VLLMChatModel(config);
}