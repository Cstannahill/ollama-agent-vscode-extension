import { ContextStrategy, ContextItem, ContextQuery, ContextSearchResult, ContextType, ContextPriority, ContextSource } from "./types";
import { VectorDatabase, SearchOptions } from "../documentation/VectorDatabase";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";

/**
 * Documentation context strategy that provides documentation-based context
 * Integrates with the vector database to provide relevant documentation
 */
export class DocumentationContextStrategy implements ContextStrategy {
  name = "documentation";
  priority = 3; // High priority for documentation context
  
  private vectorDb: VectorDatabase;
  private initialized = false;

  constructor() {
    this.vectorDb = VectorDatabase.getInstance();
  }

  canHandle(query: ContextQuery): boolean {
    // Handle queries that might benefit from documentation
    if (query.types?.includes(ContextType.DOCUMENTATION)) {
      return true;
    }
    
    // Handle queries with technical terms or programming languages
    const text = query.text || query.query || "";
    const technicalTerms = [
      "function", "class", "method", "api", "library", "framework",
      "javascript", "typescript", "python", "react", "vue", "node",
      "error", "exception", "documentation", "docs", "help"
    ];
    
    return technicalTerms.some(term => text.toLowerCase().includes(term));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.vectorDb.initialize();
      this.initialized = true;
      logger.info("[DOC_CONTEXT] Documentation context strategy initialized");
    } catch (error) {
      logger.error("[DOC_CONTEXT] Failed to initialize:", error);
      throw error;
    }
  }

  async search(query: ContextQuery): Promise<ContextSearchResult> {
    await this.ensureInitialized();

    try {
      const enhancedQuery = await this.enhanceQuery(query);
      const searchOptions = this.buildSearchOptions(query);
      
      logger.debug(`[DOC_CONTEXT] Searching documentation for: "${enhancedQuery}"`);

      const results = await this.vectorDb.search(enhancedQuery, searchOptions);
      
      const contextItems = results.map(result => this.convertToContextItem(result, query));
      
      // Filter and rank based on relevance
      const filteredItems = this.filterAndRankResults(contextItems, query);

      logger.debug(`[DOC_CONTEXT] Found ${filteredItems.length} relevant documentation context items`);

      return {
        items: filteredItems,
        totalCount: results.length,
        query: enhancedQuery,
        strategy: "documentation",
        metadata: {
          searchTime: Date.now(),
          sources: this.extractSources(filteredItems),
          frameworks: this.extractFrameworks(filteredItems),
        },
      };
    } catch (error) {
      logger.error("[DOC_CONTEXT] Search failed:", error);
      return {
        items: [],
        totalCount: 0,
        query: query.text || "",
        strategy: "documentation",
        metadata: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  async addContext(item: ContextItem): Promise<void> {
    // Documentation context is read-only, managed by doc_update tool
    logger.debug("[DOC_CONTEXT] Documentation context is read-only");
  }

  async updateContext(item: ContextItem): Promise<void> {
    // Documentation context is read-only, managed by doc_update tool
    logger.debug("[DOC_CONTEXT] Documentation context is read-only");
  }

  async deleteContext(id: string): Promise<void> {
    // Documentation context is read-only, managed by doc_update tool
    logger.debug("[DOC_CONTEXT] Documentation context is read-only");
  }

  async getStats(): Promise<{
    totalItems: number;
    sources: string[];
    frameworks: string[];
    lastUpdated?: string;
  }> {
    await this.ensureInitialized();

    try {
      const stats = await this.vectorDb.getCollectionStats();
      return {
        totalItems: stats.count,
        sources: stats.sources,
        frameworks: stats.frameworks,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("[DOC_CONTEXT] Failed to get stats:", error);
      return {
        totalItems: 0,
        sources: [],
        frameworks: [],
      };
    }
  }

  private async enhanceQuery(query: ContextQuery): Promise<string> {
    let enhancedQuery = query.text || query.query || "";

    // Add context from workspace if available
    if (query.includeWorkspace) {
      const workspaceContext = await this.getWorkspaceContext();
      if (workspaceContext) {
        enhancedQuery += ` ${workspaceContext}`;
      }
    }

    // Add file type context
    if (query.fileTypes && query.fileTypes.length > 0) {
      const fileTypeContext = query.fileTypes.map(type => {
        switch (type) {
          case ".ts":
          case ".tsx":
            return "TypeScript";
          case ".js":
          case ".jsx":
            return "JavaScript";
          case ".py":
            return "Python";
          case ".rs":
            return "Rust";
          case ".go":
            return "Go";
          case ".java":
            return "Java";
          case ".cs":
            return "C# .NET";
          default:
            return type.replace(".", "");
        }
      }).join(" ");
      enhancedQuery += ` ${fileTypeContext}`;
    }

    return enhancedQuery.trim();
  }

  private buildSearchOptions(query: ContextQuery): SearchOptions {
    const options: SearchOptions = {
      limit: query.maxResults || 5,
      threshold: 0.05,
      includeMetadata: true,
    };

    // Build filters from query context
    const filters: Record<string, any> = {};

    if (query.fileTypes && query.fileTypes.length > 0) {
      // Map file types to languages/frameworks
      const languages = new Set<string>();
      const frameworks = new Set<string>();

      query.fileTypes.forEach(type => {
        switch (type) {
          case ".ts":
          case ".tsx":
            languages.add("typescript");
            if (type === ".tsx") frameworks.add("react");
            break;
          case ".js":
          case ".jsx":
            languages.add("javascript");
            if (type === ".jsx") frameworks.add("react");
            break;
          case ".py":
            languages.add("python");
            break;
          case ".rs":
            languages.add("rust");
            break;
          case ".go":
            languages.add("go");
            break;
          case ".java":
            languages.add("java");
            break;
          case ".cs":
            languages.add("csharp");
            break;
        }
      });

      if (languages.size > 0) {
        filters.language = { $in: Array.from(languages) };
      }
      if (frameworks.size > 0) {
        filters.framework = { $in: Array.from(frameworks) };
      }
    }

    if (Object.keys(filters).length > 0) {
      options.filter = filters;
    }

    return options;
  }

  private convertToContextItem(searchResult: any, query: ContextQuery): ContextItem {
    const { document, score } = searchResult;
    const { metadata } = document;

    return {
      id: document.id,
      type: ContextType.DOCUMENTATION,
      source: ContextSource.DOCUMENTATION,
      content: document.content,
      relevanceScore: score,
      priority: this.calculatePriority(score, metadata, query),
      metadata: {
        title: metadata.title,
        source: metadata.source,
        url: metadata.url,
        framework: metadata.framework,
        language: metadata.language,
        version: metadata.version,
        section: metadata.section,
        relevanceScore: score,
        lastUpdated: metadata.lastUpdated,
      },
      timestamp: new Date(),
      tags: this.generateTags(metadata),
    };
  }

  private calculatePriority(score: number, metadata: any, query: ContextQuery): ContextPriority {
    // Higher priority for exact matches and popular frameworks
    if (score > 0.9) return ContextPriority.HIGH;
    if (score > 0.8) return ContextPriority.MEDIUM;
    if (score > 0.7) return ContextPriority.LOW;
    return ContextPriority.VERY_LOW;
  }

  private generateTags(metadata: any): string[] {
    const tags: string[] = [];

    if (metadata.source) tags.push(`source:${metadata.source.toLowerCase()}`);
    if (metadata.framework) tags.push(`framework:${metadata.framework.toLowerCase()}`);
    if (metadata.language) tags.push(`language:${metadata.language.toLowerCase()}`);
    if (metadata.version) tags.push(`version:${metadata.version}`);

    return tags;
  }

  private filterAndRankResults(items: ContextItem[], query: ContextQuery): ContextItem[] {
    let filtered = items;

    // Apply priority filtering
    if (query.minPriority) {
      const minPriorityValue = this.getPriorityValue(query.minPriority);
      filtered = filtered.filter(item => 
        this.getPriorityValue(item.priority) >= minPriorityValue
      );
    }

    // Sort by relevance score and priority
    filtered.sort((a, b) => {
      const scoreA = (a.metadata?.relevanceScore as number) || 0;
      const scoreB = (b.metadata?.relevanceScore as number) || 0;
      const priorityA = this.getPriorityValue(a.priority);
      const priorityB = this.getPriorityValue(b.priority);

      // First by priority, then by score
      if (priorityA !== priorityB) return priorityB - priorityA;
      return scoreB - scoreA;
    });

    // Limit results
    const maxResults = query.maxResults || 5;
    return filtered.slice(0, maxResults);
  }

  private getPriorityValue(priority: ContextPriority): number {
    switch (priority) {
      case ContextPriority.CRITICAL: return 5;
      case ContextPriority.HIGH: return 4;
      case ContextPriority.MEDIUM: return 3;
      case ContextPriority.LOW: return 2;
      case ContextPriority.VERY_LOW: return 1;
      default: return 0;
    }
  }

  private extractSources(items: ContextItem[]): string[] {
    const sources = new Set<string>();
    items.forEach(item => {
      if (item.metadata?.source) {
        sources.add(item.metadata.source as string);
      }
    });
    return Array.from(sources);
  }

  private extractFrameworks(items: ContextItem[]): string[] {
    const frameworks = new Set<string>();
    items.forEach(item => {
      if (item.metadata?.framework) {
        frameworks.add(item.metadata.framework as string);
      }
    });
    return Array.from(frameworks);
  }

  private async getWorkspaceContext(): Promise<string | null> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      
      // Try to detect framework from package.json
      const packageJsonPath = path.join(rootPath, "package.json");
      try {
        const packageContent = await fs.readFile(packageJsonPath, "utf-8");
        const packageJson = JSON.parse(packageContent);
        
        const frameworks: string[] = [];
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        if (dependencies.react) frameworks.push("React");
        if (dependencies.vue) frameworks.push("Vue");
        if (dependencies.angular || dependencies["@angular/core"]) frameworks.push("Angular");
        if (dependencies.svelte) frameworks.push("Svelte");
        if (dependencies.next) frameworks.push("Next.js");
        if (dependencies.nuxt) frameworks.push("Nuxt.js");
        if (dependencies.express) frameworks.push("Express");
        if (dependencies.fastify) frameworks.push("Fastify");
        if (dependencies.typescript) frameworks.push("TypeScript");

        if (frameworks.length > 0) {
          return frameworks.join(" ");
        }
      } catch (error) {
        // Package.json doesn't exist or is invalid, continue
      }

      // Try to detect from file extensions
      // This is a simplified detection, could be expanded
      return null;
    } catch (error) {
      logger.debug("[DOC_CONTEXT] Failed to get workspace context:", error);
      return null;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}