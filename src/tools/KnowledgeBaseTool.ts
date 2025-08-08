import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import { logger } from "../utils/logger";
import { VectorDatabase, DocumentChunk } from "../documentation/VectorDatabase";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";

// Knowledge Base Query Tool
export class KnowledgeQueryTool extends BaseTool {
  name = "knowledge_query";
  description = "Query custom knowledge base with project-specific information and notes";
  
  schema = z.object({
    query: z.string().describe("Search query for knowledge base"),
    category: z.string().optional().describe("Filter by knowledge category (e.g., 'notes', 'decisions', 'patterns')"),
    author: z.string().optional().describe("Filter by content author"),
    dateRange: z.object({
      start: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      end: z.string().optional().describe("End date (YYYY-MM-DD)")
    }).optional().describe("Filter by date range"),
    limit: z.number().optional().describe("Maximum number of results (default: 5)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { query, category, author, dateRange, limit = 5 } = params;
      
      logger.info(`[KNOWLEDGE_QUERY] Searching knowledge base for: "${query}"`);

      const vectorDb = VectorDatabase.getInstance();
      await vectorDb.initialize();

      // Build filters
      const filters: Record<string, any> = {
        source: "knowledge_base",
      };

      if (category) filters.category = category;
      if (author) filters.author = author;
      if (dateRange) {
        // Date range filtering would need to be implemented in the vector DB
        // For now, we'll handle it post-search
      }

      const results = await vectorDb.search(query, {
        limit: limit * 2, // Get more results for filtering
        threshold: 0.6,
        filter: filters,
        includeMetadata: true,
      });

      // Apply date filtering if specified
      let filteredResults = results;
      if (dateRange) {
        filteredResults = results.filter(result => {
          const itemDate = new Date(result.document.metadata.lastUpdated);
          const startDate = dateRange.start ? new Date(dateRange.start) : new Date(0);
          const endDate = dateRange.end ? new Date(dateRange.end) : new Date();
          return itemDate >= startDate && itemDate <= endDate;
        });
      }

      // Limit results
      filteredResults = filteredResults.slice(0, limit);

      if (filteredResults.length === 0) {
        return `No knowledge base entries found for query: "${query}"\n\nTry:\n• Using different keywords\n• Reducing filters\n• Adding content with \`knowledge_add\``;
      }

      let response = `Found ${filteredResults.length} knowledge base result(s) for "${query}":\n\n`;

      filteredResults.forEach((result, index) => {
        const { document, score } = result;
        const { metadata } = document;
        
        response += `## ${index + 1}. ${metadata.title}\n`;
        response += `**Category:** ${metadata.category || "General"}\n`;
        if (metadata.author) response += `**Author:** ${metadata.author}\n`;
        response += `**Created:** ${new Date(metadata.lastUpdated).toLocaleDateString()}\n`;
        response += `**Relevance:** ${Math.round(score * 100)}%\n\n`;
        response += `${document.content}\n`;
        if (metadata.tags) {
          response += `\n**Tags:** ${Array.isArray(metadata.tags) ? metadata.tags.join(', ') : metadata.tags}\n`;
        }
        response += `\n---\n\n`;
      });

      logger.info(`[KNOWLEDGE_QUERY] Returned ${filteredResults.length} results`);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[KNOWLEDGE_QUERY] Failed:", error);
      throw new Error(`Knowledge base query failed: ${errorMessage}`);
    }
  }
}

// Knowledge Base Add Tool
export class KnowledgeAddTool extends BaseTool {
  name = "knowledge_add";
  description = "Add custom knowledge, notes, decisions, or patterns to the knowledge base";
  
  schema = z.object({
    title: z.string().describe("Title of the knowledge entry"),
    content: z.string().describe("Content of the knowledge entry"),
    category: z.string().optional().describe("Category (e.g., 'notes', 'decisions', 'patterns', 'troubleshooting')"),
    tags: z.array(z.string()).optional().describe("Tags for better organization"),
    author: z.string().optional().describe("Author of the content"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Priority level (default: medium)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { title, content, category = "notes", tags = [], author, priority = "medium" } = params;
      
      logger.info(`[KNOWLEDGE_ADD] Adding knowledge entry: "${title}"`);

      const vectorDb = VectorDatabase.getInstance();
      await vectorDb.initialize();

      // Create document chunk
      const timestamp = new Date().toISOString();
      const id = `kb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const documentChunk: DocumentChunk = {
        id,
        content: `# ${title}\n\n${content}`,
        metadata: {
          source: "knowledge_base",
          title,
          category,
          author: author || "Unknown",
          priority,
          tags: tags.join(", "),
          lastUpdated: timestamp,
          chunkIndex: 0,
          totalChunks: 1,
        },
      };

      await vectorDb.addDocuments([documentChunk]);

      let response = `✅ Knowledge entry added successfully!\n\n`;
      response += `**Title:** ${title}\n`;
      response += `**Category:** ${category}\n`;
      response += `**Priority:** ${priority}\n`;
      if (author) response += `**Author:** ${author}\n`;
      if (tags.length > 0) response += `**Tags:** ${tags.join(", ")}\n`;
      response += `**ID:** ${id}\n\n`;
      response += `The entry is now searchable using \`knowledge_query\`.`;

      logger.info(`[KNOWLEDGE_ADD] Added knowledge entry: ${id}`);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[KNOWLEDGE_ADD] Failed:", error);
      throw new Error(`Failed to add knowledge entry: ${errorMessage}`);
    }
  }
}

// Knowledge Base Update Tool
export class KnowledgeUpdateTool extends BaseTool {
  name = "knowledge_update";
  description = "Update existing knowledge base entries";
  
  schema = z.object({
    id: z.string().describe("ID of the knowledge entry to update"),
    title: z.string().optional().describe("New title"),
    content: z.string().optional().describe("New content"),
    category: z.string().optional().describe("New category"),
    tags: z.array(z.string()).optional().describe("New tags"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("New priority level"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { id, title, content, category, tags, priority } = params;
      
      logger.info(`[KNOWLEDGE_UPDATE] Updating knowledge entry: ${id}`);

      const vectorDb = VectorDatabase.getInstance();
      await vectorDb.initialize();

      // First, try to find the existing entry
      const existingResults = await vectorDb.search(id, {
        limit: 1,
        threshold: 0.1,
        filter: { source: "knowledge_base" },
      });

      if (existingResults.length === 0) {
        return `❌ Knowledge entry with ID "${id}" not found.\n\nUse \`knowledge_list\` to see available entries.`;
      }

      const existing = existingResults[0].document;
      
      // Create updated document
      const updatedMetadata = { ...existing.metadata };
      if (title) updatedMetadata.title = title;
      if (category) updatedMetadata.category = category;
      if (tags) updatedMetadata.tags = tags.join(", ");
      if (priority) updatedMetadata.priority = priority;
      updatedMetadata.lastUpdated = new Date().toISOString();

      const updatedContent = content ? `# ${title || updatedMetadata.title}\n\n${content}` : existing.content;

      const updatedDocument: DocumentChunk = {
        id: existing.id,
        content: updatedContent,
        metadata: updatedMetadata as DocumentChunk["metadata"],
      };

      await vectorDb.updateDocument(updatedDocument);

      let response = `✅ Knowledge entry updated successfully!\n\n`;
      response += `**ID:** ${id}\n`;
      response += `**Title:** ${updatedMetadata.title}\n`;
      response += `**Category:** ${updatedMetadata.category}\n`;
      response += `**Priority:** ${updatedMetadata.priority}\n`;
      response += `**Last Updated:** ${new Date(updatedMetadata.lastUpdated).toLocaleString()}\n`;

      logger.info(`[KNOWLEDGE_UPDATE] Updated knowledge entry: ${id}`);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[KNOWLEDGE_UPDATE] Failed:", error);
      throw new Error(`Failed to update knowledge entry: ${errorMessage}`);
    }
  }
}

// Knowledge Base List Tool
export class KnowledgeListTool extends BaseTool {
  name = "knowledge_list";
  description = "List and browse knowledge base entries";
  
  schema = z.object({
    category: z.string().optional().describe("Filter by category"),
    author: z.string().optional().describe("Filter by author"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Filter by priority"),
    limit: z.number().optional().describe("Maximum number of entries to show (default: 10)"),
    sortBy: z.enum(["date", "title", "priority"]).optional().describe("Sort by field (default: date)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { category, author, priority, limit = 10, sortBy = "date" } = params;
      
      logger.info(`[KNOWLEDGE_LIST] Listing knowledge base entries`);

      const vectorDb = VectorDatabase.getInstance();
      await vectorDb.initialize();

      // Get all knowledge base entries
      const results = await vectorDb.search("", {
        limit: 100, // Get many results for filtering/sorting
        threshold: 0.0, // Very low threshold to get all entries
        filter: { source: "knowledge_base" },
        includeMetadata: true,
      });

      if (results.length === 0) {
        return `No knowledge base entries found.\n\nAdd entries using \`knowledge_add\`.`;
      }

      // Apply filters
      let filteredResults = results;

      if (category) {
        filteredResults = filteredResults.filter(r => 
          r.document.metadata.category?.toLowerCase().includes(category.toLowerCase())
        );
      }

      if (author) {
        filteredResults = filteredResults.filter(r => 
          r.document.metadata.author?.toLowerCase().includes(author.toLowerCase())
        );
      }

      if (priority) {
        filteredResults = filteredResults.filter(r => 
          r.document.metadata.priority === priority
        );
      }

      // Sort results
      filteredResults.sort((a, b) => {
        switch (sortBy) {
          case "title":
            return (a.document.metadata.title || "").localeCompare(b.document.metadata.title || "");
          case "priority":
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            return (priorityOrder[b.document.metadata.priority as keyof typeof priorityOrder] || 0) - 
                   (priorityOrder[a.document.metadata.priority as keyof typeof priorityOrder] || 0);
          case "date":
          default:
            return new Date(b.document.metadata.lastUpdated).getTime() - 
                   new Date(a.document.metadata.lastUpdated).getTime();
        }
      });

      // Limit results
      const limitedResults = filteredResults.slice(0, limit);

      let response = `# Knowledge Base Entries (${limitedResults.length})\n\n`;

      if (category || author || priority) {
        response += `**Filters Applied:**`;
        if (category) response += ` Category: ${category}`;
        if (author) response += ` Author: ${author}`;
        if (priority) response += ` Priority: ${priority}`;
        response += `\n\n`;
      }

      limitedResults.forEach((result, index) => {
        const { document } = result;
        const { metadata } = document;
        
        const priorityEmoji = metadata.priority === "high" ? "🔥" : 
                             metadata.priority === "medium" ? "⚡" : "📝";
        
        response += `${index + 1}. ${priorityEmoji} **${metadata.title}**\n`;
        response += `   Category: ${metadata.category || "General"} | `;
        response += `Author: ${metadata.author || "Unknown"} | `;
        response += `Updated: ${new Date(metadata.lastUpdated).toLocaleDateString()}\n`;
        response += `   ID: \`${document.id}\`\n`;
        if (metadata.tags && metadata.tags.trim()) {
          response += `   Tags: ${metadata.tags}\n`;
        }
        response += `\n`;
      });

      if (filteredResults.length > limit) {
        response += `\n*Showing ${limit} of ${filteredResults.length} entries. Use limit parameter to see more.*`;
      }

      logger.info(`[KNOWLEDGE_LIST] Listed ${limitedResults.length} entries`);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[KNOWLEDGE_LIST] Failed:", error);
      throw new Error(`Failed to list knowledge entries: ${errorMessage}`);
    }
  }
}

// Knowledge Base Delete Tool
export class KnowledgeDeleteTool extends BaseTool {
  name = "knowledge_delete";
  description = "Delete knowledge base entries";
  
  schema = z.object({
    id: z.string().describe("ID of the knowledge entry to delete"),
    confirm: z.boolean().optional().describe("Confirm deletion (required for safety)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { id, confirm = false } = params;
      
      if (!confirm) {
        return `⚠️  Deletion requires confirmation.\n\nTo delete entry "${id}", use:\n\`knowledge_delete id:"${id}" confirm:true\``;
      }

      logger.info(`[KNOWLEDGE_DELETE] Deleting knowledge entry: ${id}`);

      const vectorDb = VectorDatabase.getInstance();
      await vectorDb.initialize();

      // Check if entry exists
      const existingResults = await vectorDb.search(id, {
        limit: 1,
        threshold: 0.1,
        filter: { source: "knowledge_base" },
      });

      if (existingResults.length === 0) {
        return `❌ Knowledge entry with ID "${id}" not found.\n\nUse \`knowledge_list\` to see available entries.`;
      }

      const entry = existingResults[0].document;
      await vectorDb.deleteDocument(id);

      let response = `✅ Knowledge entry deleted successfully!\n\n`;
      response += `**Deleted Entry:**\n`;
      response += `• Title: ${entry.metadata.title}\n`;
      response += `• Category: ${entry.metadata.category}\n`;
      response += `• ID: ${id}\n`;

      logger.info(`[KNOWLEDGE_DELETE] Deleted knowledge entry: ${id}`);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[KNOWLEDGE_DELETE] Failed:", error);
      throw new Error(`Failed to delete knowledge entry: ${errorMessage}`);
    }
  }
}

// Knowledge Base Import Tool
export class KnowledgeImportTool extends BaseTool {
  name = "knowledge_import";
  description = "Import knowledge from local files (markdown, text) into the knowledge base";
  
  schema = z.object({
    filePath: z.string().describe("Path to file to import (relative to workspace)"),
    category: z.string().optional().describe("Category for imported content"),
    author: z.string().optional().describe("Author to assign to imported content"),
    splitSections: z.boolean().optional().describe("Split file by sections/headers (default: true)"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Priority level (default: medium)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { filePath, category = "imported", author, splitSections = true, priority = "medium" } = params;
      
      logger.info(`[KNOWLEDGE_IMPORT] Importing file: ${filePath}`);

      const workspacePath = this.getWorkspaceRoot();
      const fullPath = path.resolve(workspacePath, filePath);

      // Check if file exists
      try {
        await fs.access(fullPath);
      } catch (error) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = await fs.readFile(fullPath, "utf-8");
      const fileName = path.basename(filePath, path.extname(filePath));

      const vectorDb = VectorDatabase.getInstance();
      await vectorDb.initialize();

      const documents: DocumentChunk[] = [];

      if (splitSections && content.includes("#")) {
        // Split by markdown headers
        const sections = this.splitByHeaders(content);
        
        sections.forEach((section, index) => {
          const sectionTitle = this.extractTitle(section) || `${fileName} - Section ${index + 1}`;
          const id = `kb-import-${Date.now()}-${index}`;
          
          documents.push({
            id,
            content: section,
            metadata: {
              source: "knowledge_base",
              title: sectionTitle,
              category,
              author: author || "Imported",
              priority,
              tags: `imported, ${fileName}`,
              lastUpdated: new Date().toISOString(),
              chunkIndex: index,
              totalChunks: sections.length,
              originalFile: filePath,
            },
          });
        });
      } else {
        // Import as single document
        const id = `kb-import-${Date.now()}`;
        documents.push({
          id,
          content,
          metadata: {
            source: "knowledge_base",
            title: fileName,
            category,
            author: author || "Imported",
            priority,
            tags: `imported, ${fileName}`,
            lastUpdated: new Date().toISOString(),
            chunkIndex: 0,
            totalChunks: 1,
            originalFile: filePath,
          },
        });
      }

      await vectorDb.addDocuments(documents);

      let response = `✅ Successfully imported ${documents.length} knowledge entries from "${filePath}"!\n\n`;
      response += `**Import Summary:**\n`;
      response += `• File: ${filePath}\n`;
      response += `• Entries created: ${documents.length}\n`;
      response += `• Category: ${category}\n`;
      response += `• Priority: ${priority}\n`;
      if (author) response += `• Author: ${author}\n`;
      
      response += `\n**Created Entries:**\n`;
      documents.forEach((doc, index) => {
        response += `${index + 1}. ${doc.metadata.title} (ID: ${doc.id})\n`;
      });

      response += `\nAll entries are now searchable using \`knowledge_query\`.`;

      logger.info(`[KNOWLEDGE_IMPORT] Successfully imported ${documents.length} entries from ${filePath}`);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[KNOWLEDGE_IMPORT] Failed:", error);
      throw new Error(`Failed to import knowledge: ${errorMessage}`);
    }
  }

  private splitByHeaders(content: string): string[] {
    const sections: string[] = [];
    const lines = content.split('\n');
    let currentSection: string[] = [];

    for (const line of lines) {
      if (line.match(/^#{1,6}\s/)) {
        // New header found
        if (currentSection.length > 0) {
          sections.push(currentSection.join('\n').trim());
          currentSection = [];
        }
      }
      currentSection.push(line);
    }

    // Add the last section
    if (currentSection.length > 0) {
      sections.push(currentSection.join('\n').trim());
    }

    return sections.filter(section => section.trim().length > 0);
  }

  private extractTitle(content: string): string | null {
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^#+\s+(.+)$/);
      if (match) {
        return match[1].trim();
      }
    }
    return null;
  }
}