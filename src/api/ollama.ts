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
import { Runnable } from "@langchain/core/runnables";
import { BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import { logger } from "../utils/logger";
import chalk from "chalk";

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  numPredict?: number;
}

export interface StreamingOptions {
  onChunk?: (chunk: string) => void;
  onProgress?: (progress: { text: string; isComplete: boolean }) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaChatMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// LangChain-compatible tool call format
export interface LangChainToolCall {
  name: string;
  args: any;
  id: string;
}

export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  toolInput: any;
  toolOutput: string;
  error?: string;
}

export interface OllamaEmbeddingResponse {
  embedding: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
}

export interface OllamaEmbeddingRequest {
  model: string;
  prompt: string;
  options?: {
    temperature?: number;
  };
}

/**
 * LangChain-compatible Ollama LLM wrapper
 */
export class OllamaLLM extends BaseLLM {
  /**
   * Check if the current model is embedding-only (e.g., nomic-embed-text)
   */
  private isEmbeddingOnlyModel(): boolean {
    // Add more embedding-only models here as needed
    const embeddingOnlyModels = [
      "nomic-embed-text",
      "nomic-embed-text:latest",
      "nomic-embed-text:8k",
      "nomic-embed-text:32k",
    ];
    return embeddingOnlyModels.some((name) =>
      this.config.model.startsWith(name)
    );
  }
  lc_serializable = true;

  private config: OllamaConfig;

  constructor(config: OllamaConfig) {
    super({});
    this.config = config;
  }

  _llmType(): string {
    return "ollama";
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
        logger.error(chalk.red("Failed to generate text:"), error);
        throw error;
      }
    }

    return { generations };
  }

  /**
   * Generate text using Ollama's generate endpoint with streaming support
   */
  async generateTextStreaming(
    prompt: string,
    streamingOptions?: StreamingOptions
  ): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      try {
        logger.debug(
          chalk.cyan(
            `🦙 [Ollama] GENERATE_STREAM → ${this.config.baseUrl}/api/generate | Model: ${this.config.model} | Provider: Ollama`
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
            responseType: "stream",
          }
        );

        let fullText = "";
        let buffer = "";

        response.data.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.trim() === "") continue;

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
              logger.debug("Failed to parse streaming chunk:", parseError);
            }
          }
        });

        response.data.on("end", () => {
          if (fullText) {
            streamingOptions?.onComplete?.(fullText);
            resolve(fullText);
          } else {
            reject(new Error("No response received from stream"));
          }
        });

        response.data.on("error", (error: Error) => {
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
   * Generate text using Ollama's generate endpoint
   */
  async generateText(prompt: string): Promise<string> {
    if (this.isEmbeddingOnlyModel()) {
      const msg = `Model '${this.config.model}' is embedding-only and does not support text generation.`;
      logger.warn(`[OLLAMA] ${msg}`);
      throw new Error(msg);
    }
    try {
      logger.debug(
        chalk.cyan(
          `🦙 [Ollama] GENERATE → ${this.config.baseUrl}/api/generate | Model: ${this.config.model} | Provider: Ollama`
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
          chalk.red(`[OLLAMA] Request failed - Status: ${status} ${statusText}`)
        );
        logger.error(
          chalk.yellow(`[OLLAMA] URL: ${this.config.baseUrl}/api/generate`)
        );
        logger.error(chalk.yellow(`[OLLAMA] Model: ${this.config.model}`));
        logger.error(chalk.yellow(`[OLLAMA] Response data:`), responseData);
        if (status === 404) {
          if (error.config?.url?.includes("/api/generate")) {
            throw new Error(
              `Model '${this.config.model}' not found. Please check if the model is installed with: ollama pull ${this.config.model}`
            );
          } else {
            throw new Error(
              `Ollama API endpoint not found. Please check if Ollama is running at ${this.config.baseUrl}`
            );
          }
        } else if (status === 500) {
          throw new Error(
            `Ollama server error: ${
              responseData?.error || "Internal server error"
            }`
          );
        } else {
          throw new Error(
            `Ollama request failed: ${status} ${statusText} - ${
              responseData?.error || error.message
            }`
          );
        }
      } else {
        logger.error(chalk.red("Ollama generate request failed:"), error);
        throw new Error(`Failed to generate text: ${error}`);
      }
    }
  }

  /**
   * Chat with Ollama using the chat endpoint with streaming support
   */
  async chatStreaming(
    messages: OllamaChatMessage[],
    streamingOptions?: StreamingOptions
  ): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      try {
        logger.debug(
          chalk.cyan(
            `[OLLAMA CHAT STREAM] Request to: ${this.config.baseUrl}/api/chat with model: ${this.config.model}`
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
            responseType: "stream",
          }
        );

        let fullText = "";
        let buffer = "";

        response.data.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.trim() === "") continue;

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
              logger.debug("Failed to parse streaming chunk:", parseError);
            }
          }
        });

        response.data.on("end", () => {
          if (fullText) {
            streamingOptions?.onComplete?.(fullText);
            resolve(fullText);
          } else {
            reject(new Error("No response received from stream"));
          }
        });

        response.data.on("error", (error: Error) => {
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
   * Chat with Ollama using the chat endpoint
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
      logger.error("Ollama chat request failed:", error);
      throw new Error(`Failed to chat: ${error}`);
    }
  }

  /**
   * Check if Ollama server is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      logger.debug(
        chalk.magenta(
          `[OLLAMA] Checking availability at: ${this.config.baseUrl}/api/tags`
        )
      );
      const response = await axios.get(`${this.config.baseUrl}/api/tags`);
      logger.debug(
        chalk.green(
          `[OLLAMA] Server available. Found ${
            response.data.models?.length || 0
          } models`
        )
      );
      return true;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          chalk.red(
            `[OLLAMA] Server check failed - Status: ${error.response?.status} ${error.response?.statusText}`
          )
        );
        logger.error(
          chalk.yellow(`[OLLAMA] URL: ${this.config.baseUrl}/api/tags`)
        );
      } else {
        logger.error(chalk.red("Ollama server check failed:"), error);
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
      logger.error("Failed to list models:", error);
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
        chalk.blue(`[OLLAMA] Model ${modelName} availability: ${available}`)
      );
      if (!available) {
        logger.info(
          chalk.yellow(`[OLLAMA] Available models: ${models.join(", ")}`)
        );
      }
      return available;
    } catch (error) {
      logger.error(
        chalk.red(
          `[OLLAMA] Failed to check model availability for ${modelName}:`
        ),
        error
      );
      return false;
    }
  }

  /**
   * Generate embeddings using Ollama's embedding endpoint
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      logger.debug(
        chalk.cyan(
          `🧠 [Ollama] EMBEDDING → ${this.config.baseUrl}/api/embeddings | Model: ${this.config.model}`
        )
      );

      const response = await axios.post(
        `${this.config.baseUrl}/api/embeddings`,
        {
          model: this.config.model,
          prompt: text,
          options: {
            temperature: 0.0, // No randomness for embeddings
          },
        },
        {
          timeout: 30000,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data && response.data.embedding) {
        logger.debug(
          chalk.green(
            `🧠 [Ollama] Embedding generated successfully (${response.data.embedding.length} dimensions)`
          )
        );
        return response.data.embedding;
      } else {
        throw new Error("Invalid embedding response format");
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          chalk.red(
            `[OLLAMA] Embedding request failed - Status: ${error.response?.status} ${error.response?.statusText}`
          )
        );
        logger.error(
          chalk.yellow(`[OLLAMA] URL: ${this.config.baseUrl}/api/embeddings`)
        );
        logger.error(chalk.yellow(`[OLLAMA] Model: ${this.config.model}`));

        if (error.response?.data) {
          logger.error(
            chalk.red(`[OLLAMA] Response data:`),
            error.response.data
          );
        }
      }

      throw new Error(
        `Failed to generate embedding: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Check if the model supports embeddings by testing with the embeddings endpoint
   */
  async supportsEmbeddings(): Promise<boolean> {
    try {
      await this.generateEmbedding("test");
      return true;
    } catch (error) {
      logger.debug(
        `[OLLAMA] Model ${this.config.model} does not support embeddings:`,
        error
      );
      return false;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    try {
      logger.debug(
        chalk.cyan(
          `🧠 [Ollama] Generating batch embeddings for ${texts.length} texts`
        )
      );

      const embeddings = await Promise.all(
        texts.map(async (text) => {
          try {
            return await this.generateEmbedding(text);
          } catch (error) {
            logger.warn(
              `[OLLAMA] Failed to generate embedding for text: ${text.substring(
                0,
                50
              )}...`
            );
            throw error;
          }
        })
      );

      return embeddings;
    } catch (error) {
      throw new Error(`Failed to generate batch embeddings: ${error}`);
    }
  }
}

/**
 * LangChain-compatible Ollama Chat Model wrapper for tool calling
 */
export class OllamaChatModel extends BaseChatModel {
  lc_serializable = true;

  private config: OllamaConfig;
  private boundTools: StructuredToolInterface[] = [];

  constructor(config: OllamaConfig) {
    super({});
    this.config = config;
  }

  _llmType(): string {
    return "ollama-chat";
  }

  _identifyingParams() {
    return {
      model: this.config.model,
      baseUrl: this.config.baseUrl,
    };
  }

  /**
   * Bind tools to the model for function calling
   * This method is required by LangChain's createToolCallingAgent
   */
  bindTools(tools: StructuredToolInterface[], _kwargs?: any): this {
    logger.debug(
      chalk.magenta(
        `[OLLAMA CHAT] Binding ${tools.length} tools to OllamaChatModel`
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
      // Convert LangChain messages to Ollama format
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

      logger.debug(
        chalk.cyan(
          `[OLLAMA CHAT] Request to: ${this.config.baseUrl}/api/chat with model: ${this.config.model}`
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

      // Parse tool calls from the response
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
            `[OLLAMA CHAT] Request failed - Status: ${status} ${statusText}`
          )
        );
        logger.error(
          chalk.yellow(`[OLLAMA CHAT] URL: ${this.config.baseUrl}/api/chat`)
        );
        logger.error(chalk.yellow(`[OLLAMA CHAT] Model: ${this.config.model}`));
        logger.error(
          chalk.yellow(`[OLLAMA CHAT] Response data:`),
          responseData
        );

        if (status === 404) {
          throw new Error(
            `Model '${this.config.model}' not found. Please check if the model is installed with: ollama pull ${this.config.model}`
          );
        } else if (status === 500) {
          throw new Error(
            `Ollama server error: ${
              responseData?.error || "Internal server error"
            }`
          );
        } else {
          throw new Error(
            `Ollama request failed: ${status} ${statusText} - ${
              responseData?.error || error.message
            }`
          );
        }
      } else {
        logger.error(chalk.red("Ollama chat request failed:"), error);
        throw error;
      }
    }
  }

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

  /**
   * Create a structured system prompt for tool calling
   */
  private createToolCallingSystemPrompt(): string {
    const toolsJson = this.boundTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    }));

    return `# Tool Calling Instructions

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
  }

  /**
   * Parse tool calls from model response
   */
  private parseToolCalls(content: string): LangChainToolCall[] {
    const toolCalls: LangChainToolCall[] = [];

    try {
      // Look for JSON blocks with tool_calls
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
      logger.warn("Failed to parse tool calls from response:", error);
      logger.debug("Response content:", content);
    }

    return toolCalls;
  }

  /**
   * Check if Ollama server is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      logger.debug(
        `Checking Ollama availability at: ${this.config.baseUrl}/api/tags`
      );
      const response = await axios.get(`${this.config.baseUrl}/api/tags`);
      logger.debug(
        `Ollama server is available. Found ${
          response.data.models?.length || 0
        } models`
      );
      return true;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          `Ollama server check failed - Status: ${error.response?.status} ${error.response?.statusText}`
        );
        logger.error(`URL: ${this.config.baseUrl}/api/tags`);
      } else {
        logger.error("Ollama server check failed:", error);
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
      logger.error("Failed to list models:", error);
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
      logger.debug(`Model ${modelName} availability: ${available}`);
      if (!available) {
        logger.info(`Available models: ${models.join(", ")}`);
      }
      return available;
    } catch (error) {
      logger.error(
        `Failed to check model availability for ${modelName}:`,
        error
      );
      return false;
    }
  }
}

/**
 * Factory function to create an Ollama LLM instance
 */
export function createOllamaLLM(config: OllamaConfig): OllamaLLM {
  return new OllamaLLM(config);
}

/**
 * Factory function to create an Ollama Chat Model instance
 */
export function createOllamaChatModel(config: OllamaConfig): OllamaChatModel {
  return new OllamaChatModel(config);
}
