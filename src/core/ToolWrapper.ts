import {
  DynamicStructuredTool,
  StructuredToolInterface,
} from "@langchain/core/tools";
import { BaseTool } from "./BaseTool";
import { z } from "zod";

/**
 * Wrapper to convert BaseTool instances to LangChain-compatible tools
 */
export class ToolWrapper {
  /**
   * Convert a BaseTool to a LangChain DynamicStructuredTool
   */
  static toLangChainTool(baseTool: BaseTool): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: baseTool.name,
      description: baseTool.description,
      schema: baseTool.schema as z.ZodObject<any>,
      func: async (input: any) => {
        return await baseTool.execute(input);
      },
    });
  }

  /**
   * Convert an array of BaseTool instances to LangChain tools
   */
  static toLangChainTools(baseTools: BaseTool[]): StructuredToolInterface[] {
    return baseTools.map((tool) => this.toLangChainTool(tool));
  }
}
