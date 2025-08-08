import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import { logger } from "../utils/logger";
import { VectorDatabase, SearchOptions } from "../documentation/VectorDatabase";
import { DocumentationScraper, ScrapingConfig } from "../documentation/DocumentationScraper";
import * as vscode from "vscode";

// Documentation Search Tool
export class DocSearchTool extends BaseTool {
  name = "doc_search";
  description = "Search through indexed documentation using semantic search";
  
  schema = z.object({
    query: z.string().describe("Search query for documentation"),
    filters: z.object({
      source: z.string().optional().describe("Filter by documentation source (e.g., 'MDN', 'React', 'Node.js')"),
      language: z.string().optional().describe("Filter by programming language"),
      framework: z.string().optional().describe("Filter by framework or library"),
      version: z.string().optional().describe("Filter by version"),
    }).optional().describe("Filters to narrow search results"),
    limit: z.number().optional().describe("Maximum number of results to return (default: 5)"),
    threshold: z.number().optional().describe("Minimum similarity score (0-1, default: 0.05)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { query, filters = {}, limit = 5, threshold = 0.05 } = params;
      
      logger.info(`[DOC_SEARCH] Searching for: "${query}"`);

      const vectorDb = VectorDatabase.getInstance();
      await vectorDb.initialize();

      const searchOptions: SearchOptions = {
        limit,
        threshold,
        filter: this.buildFilter(filters),
        includeMetadata: true,
      };

      const results = await vectorDb.search(query, searchOptions);

      if (results.length === 0) {
        return `No documentation found for query: "${query}"\n\nTry:\n• Using different keywords\n• Reducing filters\n• Lowering the similarity threshold\n• Running doc_update to refresh documentation`;
      }

      let response = `Found ${results.length} documentation result(s) for "${query}":\n\n`;

      results.forEach((result, index) => {
        const { document, score } = result;
        const { metadata } = document;
        
        response += `## ${index + 1}. ${metadata.title}\n`;
        response += `**Source:** ${metadata.source}`;
        if (metadata.framework) response += ` (${metadata.framework})`;
        if (metadata.version) response += ` v${metadata.version}`;
        response += `\n`;
        response += `**Section:** ${metadata.section}\n`;
        response += `**Relevance:** ${Math.round(score * 100)}%\n`;
        if (metadata.url) response += `**URL:** ${metadata.url}\n`;
        response += `\n${document.content}\n`;
        response += `\n---\n\n`;
      });

      logger.info(`[DOC_SEARCH] Returned ${results.length} results`);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[DOC_SEARCH] Failed:", error);
      throw new Error(`Documentation search failed: ${errorMessage}`);
    }
  }

  private buildFilter(filters: Record<string, string | undefined>): Record<string, any> | undefined {
    const filter: Record<string, any> = {};
    
    if (filters.source) filter.source = filters.source;
    if (filters.language) filter.language = filters.language;
    if (filters.framework) filter.framework = filters.framework;
    if (filters.version) filter.version = filters.version;

    return Object.keys(filter).length > 0 ? filter : undefined;
  }
}

// Documentation Update Tool
export class DocUpdateTool extends BaseTool {
  name = "doc_update";
  description = "Update documentation index by scraping fresh content from documentation sources";
  
  schema = z.object({
    sources: z.array(z.string()).optional().describe("Specific sources to update (e.g., ['MDN', 'React']). If not provided, updates all configured sources"),
    forceRefresh: z.boolean().optional().describe("Force refresh even if content was recently updated (default: false)"),
    maxDepth: z.number().optional().describe("Maximum depth for link following (default: 2)"),
    customUrl: z.string().optional().describe("Custom URL to scrape (for one-off documentation)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { sources, forceRefresh = false, maxDepth = 2, customUrl } = params;
      
      logger.info("[DOC_UPDATE] Starting documentation update");

      const vectorDb = VectorDatabase.getInstance();
      await vectorDb.initialize();

      const scraper = new DocumentationScraper();
      let configs: ScrapingConfig[] = [];

      if (customUrl) {
        // Handle custom URL
        configs = [{
          url: customUrl,
          selectors: {
            content: "main, .content, .documentation, body",
            title: "h1, title",
            exclude: ["nav", "footer", ".sidebar", ".header"],
          },
          metadata: {
            source: "Custom",
          },
          options: {
            followLinks: false,
            maxDepth: 1,
            delay: 1000,
          },
        }];
      } else {
        // Use predefined configurations
        const allConfigs = DocumentationScraper.getCommonConfigs();
        
        if (sources && sources.length > 0) {
          configs = allConfigs.filter(config => 
            sources.some(source => config.metadata.source.toLowerCase().includes(source.toLowerCase()))
          );
        } else {
          configs = allConfigs;
        }

        // Update maxDepth if specified
        configs.forEach(config => {
          config.options.maxDepth = maxDepth;
        });
      }

      if (configs.length === 0) {
        return `No matching documentation sources found. Available sources: ${DocumentationScraper.getCommonConfigs().map(c => c.metadata.source).join(", ")}`;
      }

      let totalChunks = 0;
      let totalErrors = 0;
      const updatedSources: string[] = [];

      for (const config of configs) {
        try {
          logger.info(`[DOC_UPDATE] Updating ${config.metadata.source}`);

          // Clear existing content for this source if force refresh
          if (forceRefresh) {
            const deleted = await vectorDb.deleteByFilter({ source: config.metadata.source });
            logger.info(`[DOC_UPDATE] Removed ${deleted} existing documents for ${config.metadata.source}`);
          }

          const result = await scraper.scrapeDocumentation(config);
          
          if (result.chunks.length > 0) {
            await vectorDb.addDocuments(result.chunks);
            totalChunks += result.chunks.length;
            updatedSources.push(config.metadata.source);
            logger.info(`[DOC_UPDATE] Added ${result.chunks.length} chunks for ${config.metadata.source}`);
          }

          totalErrors += result.errors.length;
          if (result.errors.length > 0) {
            logger.warn(`[DOC_UPDATE] ${result.errors.length} errors for ${config.metadata.source}:`, result.errors);
          }

          // Small delay between sources to be respectful
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          logger.error(`[DOC_UPDATE] Failed to update ${config.metadata.source}:`, error);
          totalErrors++;
        }
      }

      const stats = await vectorDb.getCollectionStats();

      let response = `Documentation update complete!\n\n`;
      response += `**Updated Sources:** ${updatedSources.join(", ")}\n`;
      response += `**New Chunks Added:** ${totalChunks}\n`;
      response += `**Total Documents:** ${stats.count}\n`;
      response += `**Errors:** ${totalErrors}\n\n`;
      
      if (stats.sources.length > 0) {
        response += `**Available Sources:** ${stats.sources.join(", ")}\n`;
      }
      
      if (stats.frameworks.length > 0) {
        response += `**Available Frameworks:** ${stats.frameworks.join(", ")}\n`;
      }

      response += `\nYou can now search the updated documentation using the doc_search tool.`;

      logger.info(`[DOC_UPDATE] Update complete: ${totalChunks} chunks added, ${totalErrors} errors`);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[DOC_UPDATE] Failed:", error);
      throw new Error(`Documentation update failed: ${errorMessage}`);
    }
  }
}

// Documentation Index Tool
export class DocIndexTool extends BaseTool {
  name = "doc_index";
  description = "Manage documentation index and view statistics";
  
  schema = z.object({
    action: z.enum(["stats", "list_sources", "clear", "clear_source"]).describe("Action to perform"),
    source: z.string().optional().describe("Specific source to act on (required for clear_source)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { action, source } = params;
      
      logger.info(`[DOC_INDEX] Performing action: ${action}`);

      const vectorDb = VectorDatabase.getInstance();
      await vectorDb.initialize();

      switch (action) {
        case "stats":
          return await this.getStats(vectorDb);
        case "list_sources":
          return await this.listSources(vectorDb);
        case "clear":
          return await this.clearIndex(vectorDb);
        case "clear_source":
          if (!source) {
            throw new Error("Source parameter is required for clear_source action");
          }
          return await this.clearSource(vectorDb, source);
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[DOC_INDEX] Failed:", error);
      throw new Error(`Documentation index operation failed: ${errorMessage}`);
    }
  }

  private async getStats(vectorDb: VectorDatabase): Promise<string> {
    const stats = await vectorDb.getCollectionStats();
    
    let response = `Documentation Index Statistics:\n\n`;
    response += `**Total Documents:** ${stats.count.toLocaleString()}\n`;
    response += `**Sources (${stats.sources.length}):** ${stats.sources.join(", ")}\n`;
    response += `**Languages (${stats.languages.length}):** ${stats.languages.join(", ")}\n`;
    response += `**Frameworks (${stats.frameworks.length}):** ${stats.frameworks.join(", ")}\n\n`;
    
    if (stats.count === 0) {
      response += `**Note:** No documentation is currently indexed. Run \`doc_update\` to populate the index.`;
    } else {
      response += `Use \`doc_search\` to search through the indexed documentation.`;
    }

    return response;
  }

  private async listSources(vectorDb: VectorDatabase): Promise<string> {
    const stats = await vectorDb.getCollectionStats();
    
    if (stats.sources.length === 0) {
      return "No documentation sources are currently indexed.\n\nRun `doc_update` to index documentation from common sources.";
    }

    let response = `Available Documentation Sources:\n\n`;
    
    stats.sources.forEach((source, index) => {
      response += `${index + 1}. **${source}**\n`;
    });

    response += `\nUse filters in \`doc_search\` to search within specific sources.`;
    return response;
  }

  private async clearIndex(vectorDb: VectorDatabase): Promise<string> {
    await vectorDb.clearCollection();
    return "Documentation index has been completely cleared.\n\nRun `doc_update` to re-populate the index.";
  }

  private async clearSource(vectorDb: VectorDatabase, source: string): Promise<string> {
    const deleted = await vectorDb.deleteByFilter({ source });
    
    if (deleted === 0) {
      return `No documents found for source "${source}".\n\nAvailable sources can be viewed with \`doc_index list_sources\`.`;
    }

    return `Removed ${deleted} documents for source "${source}".\n\nRun \`doc_update sources:["${source}"]\` to re-index this source.`;
  }
}

// Documentation Summary Tool
export class DocSummaryTool extends BaseTool {
  name = "doc_summarize";
  description = "Generate concise summaries of documentation sections";
  
  schema = z.object({
    query: z.string().describe("Topic or concept to summarize from documentation"),
    sources: z.array(z.string()).optional().describe("Limit summary to specific sources"),
    maxLength: z.enum(["brief", "detailed", "comprehensive"]).optional().describe("Summary length (default: detailed)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { query, sources, maxLength = "detailed" } = params;
      
      logger.info(`[DOC_SUMMARY] Generating ${maxLength} summary for: "${query}"`);

      const vectorDb = VectorDatabase.getInstance();
      await vectorDb.initialize();

      const searchOptions: SearchOptions = {
        limit: maxLength === "brief" ? 3 : maxLength === "detailed" ? 6 : 10,
        threshold: 0.6,
        filter: sources ? { source: { $in: sources } } : undefined,
        includeMetadata: true,
      };

      const results = await vectorDb.search(query, searchOptions);

      if (results.length === 0) {
        return `No documentation found for "${query}" to summarize.\n\nTry searching with \`doc_search\` first or updating documentation with \`doc_update\`.`;
      }

      // Group results by source for better organization
      const groupedResults = this.groupBySource(results);

      let response = `# Documentation Summary: ${query}\n\n`;
      
      if (maxLength === "brief") {
        response += this.generateBriefSummary(groupedResults);
      } else if (maxLength === "detailed") {
        response += this.generateDetailedSummary(groupedResults);
      } else {
        response += this.generateComprehensiveSummary(groupedResults);
      }

      response += `\n\n---\n*Summary generated from ${results.length} documentation sources*`;

      logger.info(`[DOC_SUMMARY] Generated ${maxLength} summary from ${results.length} sources`);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[DOC_SUMMARY] Failed:", error);
      throw new Error(`Documentation summary failed: ${errorMessage}`);
    }
  }

  private groupBySource(results: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    
    results.forEach(result => {
      const source = result.document.metadata.source;
      if (!grouped[source]) {
        grouped[source] = [];
      }
      grouped[source].push(result);
    });

    return grouped;
  }

  private generateBriefSummary(groupedResults: Record<string, any[]>): string {
    let summary = "";

    Object.entries(groupedResults).forEach(([source, results]) => {
      const topResult = results[0];
      const content = topResult.document.content;
      
      // Extract first paragraph or first 200 characters
      const firstParagraph = content.split('\n\n')[0] || content.substring(0, 200);
      
      summary += `**${source}:** ${firstParagraph}...\n\n`;
    });

    return summary;
  }

  private generateDetailedSummary(groupedResults: Record<string, any[]>): string {
    let summary = "";

    Object.entries(groupedResults).forEach(([source, results]) => {
      summary += `## ${source}\n\n`;
      
      results.slice(0, 2).forEach(result => {
        const { document } = result;
        const content = document.content.split('\n\n').slice(0, 2).join('\n\n');
        
        summary += `**${document.metadata.section}**\n${content}\n\n`;
      });
    });

    return summary;
  }

  private generateComprehensiveSummary(groupedResults: Record<string, any[]>): string {
    let summary = "";

    Object.entries(groupedResults).forEach(([source, results]) => {
      summary += `## ${source}\n\n`;
      
      results.forEach(result => {
        const { document } = result;
        
        summary += `### ${document.metadata.section}\n`;
        summary += `${document.content}\n\n`;
        if (document.metadata.url) {
          summary += `*Source: ${document.metadata.url}*\n\n`;
        }
      });
    });

    return summary;
  }
}