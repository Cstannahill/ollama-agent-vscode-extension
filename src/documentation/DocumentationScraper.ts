import fetch, { Response } from "node-fetch";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { JSDOM } from "jsdom";
import { logger } from "../utils/logger";
import { DocumentChunk } from "./VectorDatabase";

export interface ScrapingConfig {
  url: string;
  selectors: {
    content?: string;
    title?: string;
    navigation?: string;
    codeBlocks?: string;
    exclude?: string[];
  };
  metadata: {
    source: string;
    language?: string;
    framework?: string;
    version?: string;
  };
  options: {
    followLinks?: boolean;
    maxDepth?: number;
    delay?: number;
    userAgent?: string;
    respectRobots?: boolean;
    timeout?: number; // Timeout in milliseconds
    retries?: number; // Number of retries on failure
  };
}

export interface ScrapingResult {
  chunks: DocumentChunk[];
  errors: string[];
  urls: string[];
}

/**
 * Documentation scraper for fetching and processing documentation from various sources
 */
export class DocumentationScraper {
  private turndownService: TurndownService;
  private visitedUrls: Set<string> = new Set();

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      fence: "```",
    });

    // Custom rules for better markdown conversion
    this.turndownService.addRule("codeBlock", {
      filter: ["pre"],
      replacement: (content: string, node: any) => {
        const element = node as HTMLElement;
        const code = element.querySelector("code");
        if (code) {
          const language = this.extractLanguage(code);
          return `\n\`\`\`${language}\n${code.textContent}\n\`\`\`\n\n`;
        }
        return `\n\`\`\`\n${content}\n\`\`\`\n\n`;
      },
    });

    this.turndownService.addRule("inlineCode", {
      filter: ["code"],
      replacement: (content: string) => `\`${content}\``,
    });
  }

  /**
   * Fetch with timeout and retry logic
   */
  private async fetchWithTimeout(
    url: string,
    config: ScrapingConfig,
    attempt: number = 1
  ): Promise<Response> {
    const timeout = config.options.timeout || 10000; // Default 10 seconds
    const maxRetries = config.options.retries || 2; // Default 2 retries
    const userAgent = config.options.userAgent || "Documentation Scraper Bot 1.0";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate",
          "DNT": "1",
          "Connection": "keep-alive",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Check if it's a timeout or network error that we can retry
      const isRetryable = 
        (error as any)?.name === 'AbortError' || 
        (error as any)?.code === 'ETIMEDOUT' ||
        (error as any)?.code === 'ECONNRESET' ||
        (error as any)?.code === 'ENOTFOUND' ||
        (error as any)?.type === 'system';

      if (isRetryable && attempt <= maxRetries) {
        logger.warn(`[DOC_SCRAPER] Retry ${attempt}/${maxRetries} for ${url}: ${error}`);
        
        // Add exponential backoff delay
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return this.fetchWithTimeout(url, config, attempt + 1);
      }

      // Re-throw the original error after all retries are exhausted
      throw error;
    }
  }

  async scrapeDocumentation(config: ScrapingConfig): Promise<ScrapingResult> {
    const result: ScrapingResult = {
      chunks: [],
      errors: [],
      urls: [],
    };

    try {
      logger.info(`[DOC_SCRAPER] Starting scrape of ${config.url}`);

      await this.scrapeUrl(config, config.url, result, 0);

      logger.info(
        `[DOC_SCRAPER] Completed scrape: ${result.chunks.length} chunks from ${result.urls.length} URLs`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[DOC_SCRAPER] Scraping failed:", error);
      result.errors.push(`Failed to scrape ${config.url}: ${errorMessage}`);
    }

    return result;
  }

  async scrapeMultipleSources(
    configs: ScrapingConfig[]
  ): Promise<ScrapingResult> {
    const combinedResult: ScrapingResult = {
      chunks: [],
      errors: [],
      urls: [],
    };

    for (const config of configs) {
      try {
        const result = await this.scrapeDocumentation(config);
        combinedResult.chunks.push(...result.chunks);
        combinedResult.errors.push(...result.errors);
        combinedResult.urls.push(...result.urls);

        // Add delay between sources
        if (config.options.delay) {
          await this.delay(config.options.delay);
        }
      } catch (error) {
        combinedResult.errors.push(`Failed to scrape ${config.url}: ${error}`);
      }
    }

    return combinedResult;
  }

  private async scrapeUrl(
    config: ScrapingConfig,
    url: string,
    result: ScrapingResult,
    depth: number
  ): Promise<void> {
    if (this.visitedUrls.has(url)) {
      return;
    }

    if (depth > (config.options.maxDepth || 2)) {
      return;
    }

    this.visitedUrls.add(url);
    result.urls.push(url);

    try {
      logger.debug(`[DOC_SCRAPER] Fetching: ${url}`);

      const response = await this.fetchWithTimeout(url, config);
      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove excluded elements
      if (config.selectors.exclude) {
        config.selectors.exclude.forEach((selector) => {
          $(selector).remove();
        });
      }

      // Extract title
      const title = this.extractTitle($, config.selectors.title);

      // Extract main content with fallbacks
      let contentElement = config.selectors.content
        ? $(config.selectors.content).first()
        : null;

      // If primary selector fails, try fallbacks
      if (!contentElement || contentElement.length === 0) {
        const fallbackContentSelectors = [
          "main",
          "article",
          ".content",
          ".documentation",
          "#main-content",
          "#content",
          ".main-content",
          ".prose",
          ".markdown",
          ".md-content__inner",
          ".md-main__inner", 
          ".md-content",
          ".rst-content",
          ".flex.min-w-0.flex-1.flex-col",
          ".documentation-content",
          ".gitbook-content",
          ".page-content",
          ".docs-content",
          ".markdown-body",
          "[role='main']",
          ".tabbed-content",
          ".md-typeset",
          "div[class*='content']",
          "div[data-md-component='content']",
          ".document",
          ".body",
          "body",
        ];

        for (const fallbackSelector of fallbackContentSelectors) {
          contentElement = $(fallbackSelector).first();
          if (contentElement && contentElement.length > 0) {
            logger.debug(
              `[DOC_SCRAPER] Using fallback content selector: ${fallbackSelector}`
            );
            break;
          }
        }
      }

      if (!contentElement || contentElement.length === 0) {
        logger.warn(
          `[DOC_SCRAPER] No content found for any selector on ${url}`
        );
        return;
      }

      // Convert to markdown
      const markdown = this.turndownService.turndown(
        contentElement.html() || ""
      );

      // Split into chunks
      const chunks = this.chunkContent(markdown, {
        url,
        title,
        source: config.metadata.source,
        language: config.metadata.language,
        framework: config.metadata.framework,
        version: config.metadata.version,
      });

      result.chunks.push(...chunks);

      // Follow links if enabled
      if (
        config.options.followLinks &&
        depth < (config.options.maxDepth || 2)
      ) {
        const links = this.extractLinks($, url, config.selectors.navigation);

        for (const link of links.slice(0, 10)) {
          // Limit to 10 links per page
          await this.delay(config.options.delay || 1000);
          await this.scrapeUrl(config, link, result, depth + 1);
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`[DOC_SCRAPER] Failed to scrape ${url}:`, error);
      result.errors.push(`Failed to scrape ${url}: ${errorMessage}`);
    }
  }

  private extractTitle($: cheerio.CheerioAPI, titleSelector?: string): string {
    if (titleSelector) {
      const titleElement = $(titleSelector);
      if (titleElement.length > 0) {
        return titleElement.first().text().trim();
      }
    }

    // Fallback to common title selectors
    const titleSelectors = ["h1", "title", ".page-title", ".doc-title"];

    for (const selector of titleSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        return element.first().text().trim();
      }
    }

    return "Untitled";
  }

  private extractLinks(
    $: cheerio.CheerioAPI,
    baseUrl: string,
    navSelector?: string
  ): string[] {
    const links: string[] = [];
    const baseUrlObj = new URL(baseUrl);

    // Start with all links and filter by navigation area if specified
    let linkElements: any = $("a");

    // If navigation selector specified, try to limit to that area first
    if (navSelector) {
      const navLinks = $(navSelector).find("a");
      if (navLinks.length > 0) {
        linkElements = navLinks;
        logger.debug(
          `[DOC_SCRAPER] Using navigation selector "${navSelector}": found ${navLinks.length} links`
        );
      } else {
        logger.debug(
          `[DOC_SCRAPER] Navigation selector "${navSelector}" found no links, trying fallbacks`
        );
        // Try common navigation patterns
        const fallbackSelectors = [
          "nav a",
          ".sidebar a",
          ".toc a", 
          ".menu a",
          ".navigation a",
          ".docs-nav a",
          "[data-sidebar] a",
          ".toctree a",
          ".md-nav a",
          ".VPSidebar a",
          ".vp-sidebar a",
          ".rst-content .toctree-wrapper a",
          ".document-toc a",
          ".in-nav a",
          "#menu a",
          "#toc a",
          ".api-nav a",
          ".toctree-wrapper a",
          ".bd-sidebar a",
          ".pst-js-only a",
          ".text-sm a",
          // Enhanced selectors for modern documentation sites
          "aside a",
          ".md-nav__list a",
          ".md-nav__item a",
          ".md-tabs__link",
          ".md-sidebar a",
          ".gitbook-toc a",
          "[role='navigation'] a",
          "nav[aria-label] a",
          ".table-of-contents a",
          // Enhanced GitBook and Material for MkDocs selectors
          ".md-content a[href^='/']",
          ".md-typeset a[href^='/']",
          ".flex.min-w-0 a[href^='/']",
          ".gitbook-sidebar a",
          ".gitbook-navigation a",
          "[data-docs-nav] a",
          ".sidebar-nav a",
          ".docs-sidebar a",
          // Comprehensive content area link discovery
          "main a[href^='/']",
          "article a[href^='/']",
          ".content a[href^='/']",
          ".documentation-content a[href^='/']",
          ".prose a[href^='/']",
          ".markdown-body a[href^='/']",
          // Site-specific patterns (expanded)
          "a[href*='docs.unsloth']",
          "a[href*='docs.vllm']", 
          "a[href*='/en/latest/']",
          "a[href*='/get-started']",
          "a[href*='/basics']",
          "a[href*='/tutorials']",
          "a[href*='/examples']",
          "a[href*='/advanced']",
          "a[href*='/models']",
          "a[href*='/fine-tuning']",
          "a[href*='/serving']",
          "a[href*='/dev']",
          "a[href*='/quantization']",
          "a[href*='/performance']",
          "a[href*='/multi_gpu']",
          "a[href*='/distributed']",
          "a[href*='/usage']",
          "a[href*='/installation']",
          // Generic relative link discovery (more aggressive)
          "a[href^='./']",
          "a[href^='../']",
          "body a[href^='/']:not([href*='#']):not([href*='edit']):not([href*='raw']):not([href*='blame'])",
        ];

        for (const selector of fallbackSelectors) {
          const elements = $(selector);
          if (elements.length > 0) {
            linkElements = elements;
            logger.debug(
              `[DOC_SCRAPER] Found ${elements.length} links with fallback selector: ${selector}`
            );
            break;
          }
        }
      }
    }

    logger.debug(`[DOC_SCRAPER] Processing ${linkElements.length} total links`);

    linkElements.each((_: any, element: any) => {
      const href = $(element).attr("href");
      if (href) {
        try {
          const absoluteUrl = new URL(href, baseUrl);

          // Enhanced link filtering for modern documentation sites
          const isValidLink = (
            absoluteUrl.hostname === baseUrlObj.hostname &&
            href.length > 1 &&
            !href.includes("#") && // Skip anchor links
            !href.match(/\.(pdf|zip|tar\.gz|exe|dmg|jpg|jpeg|png|gif|svg|css|js)$/i) && // Skip binary and asset files
            // Allow some query params for modern docs (e.g., ?tab=install)
            (!href.includes("?") || href.match(/\?(tab|page|section|lang)=/)) &&
            // Skip certain patterns
            !href.match(/\/(edit|blame|history|raw|commit|compare)/) && // Skip GitHub edit links
            !href.match(/\/(login|signup|register|logout)/) && // Skip auth pages
            !href.includes("javascript:") &&
            !href.includes("mailto:") &&
            !href.includes("tel:") &&
            // Comprehensive documentation path matching
            (
              // Traditional doc paths
              href.includes("/docs") ||
              href.includes("/api") ||
              href.includes("/guide") ||
              href.includes("/reference") ||
              href.includes("/tutorial") ||
              href.includes("/getting") ||
              href.includes("/install") ||
              href.includes("/quick") ||
              href.match(/\/en\/(latest|stable)/) ||
              // Unsloth-specific paths (expanded)
              href.includes("/get-started") ||
              href.includes("/basics") ||
              href.includes("/tutorials") ||
              href.includes("/examples") ||
              href.includes("/advanced") ||
              href.includes("/models") ||
              href.includes("/fine-tuning") ||
              href.includes("/training") ||
              href.includes("/optimization") ||
              href.includes("/troubleshooting") ||
              href.includes("/configuration") ||
              href.includes("/setup") ||
              href.includes("/lora") ||
              href.includes("/qlora") ||
              href.includes("/inference") ||
              href.includes("/deployment") ||
              href.includes("/usage") ||
              href.includes("/how-to") ||
              href.includes("/cookbook") ||
              href.includes("/recipes") ||
              // vLLM-specific paths (expanded)
              href.includes("/serving") ||
              href.includes("/dev") ||
              href.includes("/models") ||
              href.includes("/quantization") ||
              href.includes("/performance") ||
              href.includes("/multi_gpu") ||
              href.includes("/distributed") ||
              href.includes("/automatic_prefix_caching") ||
              href.includes("/engine") ||
              href.includes("/offline_inference") ||
              href.includes("/openai_compatible_server") ||
              href.includes("/usage") ||
              href.includes("/benchmark") ||
              href.includes("/kernel") ||
              href.includes("/multimodal") ||
              href.includes("/speculative_decoding") ||
              href.includes("/lora") ||
              href.includes("/gptq") ||
              href.includes("/awq") ||
              href.includes("/fp8") ||
              href.includes("/kv_cache") ||
              // More generic paths for GitBook/Material sites
              href.startsWith("/") && !href.startsWith("//") ||
              // GitBook-style paths (alphanumeric with hyphens) - more permissive
              href.match(/^[a-z0-9-_]+$/i) ||
              href.match(/^[a-z0-9-_]+\/[a-z0-9-_]+/i) ||
              href.match(/^[a-z0-9-_]+\/[a-z0-9-_]+\/[a-z0-9-_]+/i) ||
              href.match(/^[a-z0-9-_]+\/[a-z0-9-_]+\/[a-z0-9-_]+\/[a-z0-9-_]+/i) ||
              // Material for MkDocs patterns
              href.includes(".html") ||
              href.endsWith(".md") ||
              // Accept any reasonable path that looks like documentation
              (href.includes("/") && href.match(/[a-z0-9-_]/i) && !href.includes("http") && href.length > 2 && !href.match(/^\/(js|css|images|assets|static)/))
            )
          );

          if (isValidLink) {
            links.push(absoluteUrl.toString());
          }
        } catch (error) {
          // Invalid URL, skip
        }
      }
    });

    const uniqueLinks = [...new Set(links)];
    logger.debug(
      `[DOC_SCRAPER] Found ${uniqueLinks.length} unique links to follow`
    );
    return uniqueLinks;
  }

  private extractLanguage(codeElement: HTMLElement): string {
    const classList = codeElement.className;

    // Common patterns for language detection
    const languagePatterns = [
      /language-(\w+)/,
      /lang-(\w+)/,
      /highlight-(\w+)/,
      /brush-(\w+)/,
    ];

    for (const pattern of languagePatterns) {
      const match = classList.match(pattern);
      if (match) {
        return match[1];
      }
    }

    // Check parent element
    if (codeElement.parentElement) {
      const parentClass = codeElement.parentElement.className;
      for (const pattern of languagePatterns) {
        const match = parentClass.match(pattern);
        if (match) {
          return match[1];
        }
      }
    }

    return "";
  }

  private chunkContent(
    content: string,
    metadata: {
      url: string;
      title: string;
      source: string;
      language?: string;
      framework?: string;
      version?: string;
    }
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const maxChunkSize = 1000; // Characters per chunk
    const overlap = 200; // Character overlap between chunks

    // Split content into sections based on headers
    const sections = content.split(/(?=^#{1,6}\s)/m);

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i].trim();
      if (section.length === 0) continue;

      // Extract section title
      const titleMatch = section.match(/^#{1,6}\s+(.+)$/m);
      const sectionTitle = titleMatch ? titleMatch[1] : metadata.title;

      // Split large sections into smaller chunks
      if (section.length <= maxChunkSize) {
        chunks.push(
          this.createChunk(section, metadata, sectionTitle, i, sections.length)
        );
      } else {
        const subChunks = this.splitIntoChunks(section, maxChunkSize, overlap);
        subChunks.forEach((chunk, subIndex) => {
          chunks.push(
            this.createChunk(
              chunk,
              metadata,
              `${sectionTitle} (part ${subIndex + 1})`,
              i * 100 + subIndex,
              sections.length * 100
            )
          );
        });
      }
    }

    return chunks;
  }

  private createChunk(
    content: string,
    metadata: {
      url: string;
      title: string;
      source: string;
      language?: string;
      framework?: string;
      version?: string;
    },
    section: string,
    chunkIndex: number,
    totalChunks: number
  ): DocumentChunk {
    // Create a safe ID by removing/replacing problematic characters
    const urlHash = this.createSafeId(metadata.url);
    const sourceHash = this.createSafeId(metadata.source);
    const id = `${sourceHash}_${urlHash}_${chunkIndex}`;

    return {
      id,
      content: content.trim(),
      metadata: {
        source: metadata.source,
        title: metadata.title,
        url: metadata.url,
        language: metadata.language,
        framework: metadata.framework,
        version: metadata.version,
        section,
        lastUpdated: new Date().toISOString(),
        chunkIndex,
        totalChunks,
      },
    };
  }

  private splitIntoChunks(
    text: string,
    maxSize: number,
    overlap: number
  ): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + maxSize;

      if (end >= text.length) {
        chunks.push(text.substring(start));
        break;
      }

      // Try to break at a sentence boundary
      const nextPeriod = text.indexOf(". ", end - 100);
      const nextNewline = text.indexOf("\n", end - 100);

      if (nextPeriod > end - 100 && nextPeriod < end + 100) {
        end = nextPeriod + 1;
      } else if (nextNewline > end - 100 && nextNewline < end + 100) {
        end = nextNewline;
      }

      chunks.push(text.substring(start, end));
      start = end - overlap;
    }

    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private createSafeId(input: string): string {
    // Create a safe ID by removing/replacing problematic characters and limiting length
    // This should match the VectorDatabase sanitizeId method
    let sanitized = input
      .replace(/[^\w\-_.]/g, "_") // Replace non-alphanumeric chars with underscore
      .replace(/_+/g, "_") // Replace multiple underscores with single
      .replace(/^_|_$/g, "") // Remove leading/trailing underscores
      .substring(0, 40); // Limit to 40 chars to leave room for chunk index

    // Ensure ID is not empty
    if (sanitized.length === 0) {
      sanitized = `doc_${Date.now()}`;
    }

    return sanitized;
  }

  // Predefined scraping configurations for common documentation sites
  static getCommonConfigs(): ScrapingConfig[] {
    return [
      {
        url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
        selectors: {
          content: ".main-page-content, article, .section-content, main",
          title: "h1, .titlebar-title, .page-title",
          navigation: ".sidebar, .document-toc, .in-nav",
          exclude: [
            ".sidebar",
            ".header",
            ".footer",
            ".breadcrumb",
            ".document-toc",
            ".page-footer",
            ".banner",
          ],
        },
        metadata: {
          source: "MDN",
          language: "javascript",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://nodejs.org/api/",
        selectors: {
          content: "#apicontent, main, article",
          title: "h1, .page-title",
          navigation: "#toc",
          exclude: ["#toc", ".mark", "nav", "footer"],
        },
        metadata: {
          source: "Node.js",
          language: "javascript",
          framework: "nodejs",
        },
        options: {
          followLinks: true,
          maxDepth: 2,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://react.dev/reference/react-dom",
        selectors: {
          content: "main, article, .content, [data-docs-content], .prose",
          title: "h1, .titlebar-title, .docs-title",
          navigation: "nav", // Simplified - fallback logic will handle the rest
          exclude: [
            "nav",
            "footer",
            ".sidebar",
            ".breadcrumb",
            ".page-footer",
            ".docs-nav",
            ".toc",
          ],
        },
        metadata: {
          source: "React",
          language: "javascript",
          framework: "react",
        },
        options: {
          followLinks: true,
          maxDepth: 5,
          delay: 1000,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://www.typescriptlang.org/docs/handbook/intro.html",
        selectors: {
          content: ".markdown, .whitespace-normal, main, article",
          title: "h1, .titlebar-title",
          navigation: "nav",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb", ".menu"],
        },
        metadata: {
          source: "TypeScript",
          language: "typescript",
          framework: "typescript",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 1200,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://code.visualstudio.com/api/references/vscode-api",
        selectors: {
          content: ".main-content, main, article",
          title: "h1, .page-title",
          navigation: "nav",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb"],
        },
        metadata: {
          source: "VS Code API",
          language: "typescript",
          framework: "vscode",
        },
        options: {
          followLinks: true,
          maxDepth: 2,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://docs.github.com/en/rest",
        selectors: {
          content: ".markdown-body, main, article",
          title: "h1, .page-title",
          navigation: "nav",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb"],
        },
        metadata: {
          source: "GitHub API",
          language: "api",
          framework: "github",
        },
        options: {
          followLinks: true,
          maxDepth: 2,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://docs.docker.com/engine/reference/commandline/",
        selectors: {
          content: ".content, main, article, .markdown-body",
          title: "h1, .page-title, .title",
          navigation: "nav",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb", ".toc"],
        },
        metadata: {
          source: "Docker",
          language: "docker",
          framework: "docker",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 1200,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://expressjs.com/en/4x/api.html",
        selectors: {
          content: "#page-doc, main, article, .content",
          title: "h1, .page-title",
          navigation: "#menu",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb", "#menu"],
        },
        metadata: {
          source: "Express.js",
          language: "javascript",
          framework: "express",
        },
        options: {
          followLinks: true,
          maxDepth: 3,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://docs.python.org/3/library/index.html",
        selectors: {
          content: ".body, main, article, .section",
          title: "h1, .page-title, .title",
          navigation: ".toctree-wrapper",
          exclude: [
            ".sidebar",
            ".toctree-wrapper",
            "nav",
            "footer",
            ".breadcrumb",
            ".headerlink",
          ],
        },
        metadata: {
          source: "Python",
          language: "python",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 1200,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://fastapi.tiangolo.com/",
        selectors: {
          content: ".md-content__inner, .content, main, article",
          title: "h1, .md-header__title, .page-title",
          navigation: ".md-nav__list",
          exclude: [
            ".md-nav",
            ".md-header",
            ".md-footer",
            "nav",
            "footer",
            ".breadcrumb",
          ],
        },
        metadata: {
          source: "FastAPI",
          language: "python",
          framework: "fastapi",
        },
        options: {
          followLinks: true,
          maxDepth: 5,
          delay: 1200,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://tailwindcss.com/docs/installation",
        selectors: {
          content: ".prose, main, article, .docs-content, .max-w-3xl",
          title: "h1, .page-title, .docs-title",
          navigation: ".docs-nav",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb", ".docs-nav"],
        },
        metadata: {
          source: "TailwindCSS",
          language: "css",
          framework: "tailwind",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 1000,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://vite.dev/guide/",
        selectors: {
          content: ".vp-doc, .VPContent, main, article, .content",
          title: "h1, .VPDocHero-title, .titlebar-title",
          navigation: ".VPSidebar .nav",
          exclude: [
            ".VPSidebar",
            ".VPNav",
            ".VPLocalNav",
            "nav",
            "footer",
            ".breadcrumb",
            ".banner",
          ],
        },
        metadata: {
          source: "Vite",
          language: "javascript",
          framework: "vite",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 1200,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://docs.pytorch.org/docs/stable/index.html",
        selectors: {
          content: ".rst-content, main, article, .body, .document",
          title: "h1, .page-title, .rst-content h1",
          navigation: ".toctree-wrapper",
          exclude: [
            ".toctree-wrapper",
            "nav",
            "footer",
            ".breadcrumb",
            ".headerlink",
            ".edit-on-github",
          ],
        },
        metadata: {
          source: "PyTorch",
          language: "python",
          framework: "pytorch",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://huggingface.co/docs/transformers/index",
        selectors: {
          content: ".prose, main, article, .docstring",
          title: "h1, .page-title",
          navigation: ".sidebar",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb"],
        },
        metadata: {
          source: "Transformers",
          language: "python",
          framework: "transformers",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://huggingface.co/docs/huggingface_hub/index",
        selectors: {
          content: ".prose, main, article, .docstring",
          title: "h1, .page-title",
          navigation: ".sidebar",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb"],
        },
        metadata: {
          source: "Hugging Face Hub",
          language: "python",
          framework: "huggingface",
        },
        options: {
          followLinks: true,
          maxDepth: 3,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://github.com/ollama/ollama/blob/main/docs/api.md",
        selectors: {
          content: ".markdown-body, main, article",
          title: "h1, .page-title",
          navigation: ".js-navigation-container",
          exclude: [".js-navigation-container", "nav", "footer", ".breadcrumb"],
        },
        metadata: {
          source: "Ollama",
          language: "api",
          framework: "ollama",
        },
        options: {
          followLinks: true,
          maxDepth: 2,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://huggingface.co/docs/peft/index",
        selectors: {
          content: ".prose, main, article, .docstring",
          title: "h1, .page-title",
          navigation: ".sidebar",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb"],
        },
        metadata: {
          source: "PEFT",
          language: "python",
          framework: "peft",
        },
        options: {
          followLinks: true,
          maxDepth: 3,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      // Note: LoRA and QLoRA are techniques/algorithms covered within PEFT documentation
      // They don't have separate documentation sites as they are implemented in PEFT
      {
        url: "https://huggingface.co/docs/accelerate/index",
        selectors: {
          content: ".prose, main, article, .docstring",
          title: "h1, .page-title",
          navigation: ".sidebar",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb"],
        },
        metadata: {
          source: "Accelerate",
          language: "python",
          framework: "accelerate",
        },
        options: {
          followLinks: true,
          maxDepth: 3,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://huggingface.co/docs/tokenizers/index",
        selectors: {
          content: ".prose, main, article, .docstring",
          title: "h1, .page-title",
          navigation: ".sidebar",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb"],
        },
        metadata: {
          source: "Tokenizers",
          language: "python",
          framework: "tokenizers",
        },
        options: {
          followLinks: true,
          maxDepth: 3,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://github.com/google/sentencepiece/blob/master/README.md",
        selectors: {
          content: ".markdown-body, main, article",
          title: "h1, .page-title",
          navigation: ".js-navigation-container",
          exclude: [".js-navigation-container", "nav", "footer", ".breadcrumb"],
        },
        metadata: {
          source: "SentencePiece",
          language: "python",
          framework: "sentencepiece",
        },
        options: {
          followLinks: true,
          maxDepth: 2,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://github.com/TimDettmers/bitsandbytes/blob/main/README.md",
        selectors: {
          content: ".markdown-body, main, article",
          title: "h1, .page-title",
          navigation: ".js-navigation-container",
          exclude: [".js-navigation-container", "nav", "footer", ".breadcrumb"],
        },
        metadata: {
          source: "BitsAndBytes",
          language: "python",
          framework: "bitsandbytes",
        },
        options: {
          followLinks: true,
          maxDepth: 2,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://python.langchain.com/docs/introduction/",
        selectors: {
          content: ".prose, main, article, .markdown",
          title: "h1, .page-title",
          navigation: ".sidebar",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb"],
        },
        metadata: {
          source: "LangChain",
          language: "python",
          framework: "langchain",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://python.langchain.com/api_reference/core/index.html",
        selectors: {
          content: ".prose, main, article, .markdown, .api-content",
          title: "h1, .page-title, .api-title",
          navigation: ".toctree, .sidebar, nav",
          exclude: [".sidebar", "nav", "footer", ".breadcrumb", ".toctree"],
        },
        metadata: {
          source: "LangChain Core",
          language: "python",
          framework: "langchain_core",
        },
        options: {
          followLinks: true,
          maxDepth: 3,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://python.langchain.com/api_reference/community/index.html",
        selectors: {
          content: "#main-content, .pst-js-only, main, article, .content",
          title: "h1, .page-title, .api-title",
          navigation: ".bd-sidebar, .toctree, nav",
          exclude: [
            ".bd-sidebar",
            "nav",
            "footer",
            ".breadcrumb",
            ".toctree",
            ".pst-js-only",
          ],
        },
        metadata: {
          source: "LangChain Community",
          language: "python",
          framework: "langchain_community",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 1500,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://docs.trychroma.com/docs/overview/introduction",
        selectors: {
          content:
            "article, main, .prose, .markdown-body, .content, [data-docs-content]",
          title: "h1, .page-title, .docs-title",
          navigation:
            "[data-docs-nav], .docs-nav, .sidebar-nav, nav[aria-label], .toc, .navigation-menu",
          exclude: [
            ".docs-nav",
            ".sidebar-nav",
            "nav",
            "footer",
            ".breadcrumb",
            ".header",
            ".page-footer",
            ".search-form",
            ".docs-header",
            ".edit-page",
            ".page-nav",
          ],
        },
        metadata: {
          source: "ChromaDB",
          language: "python",
          framework: "chromadb",
        },
        options: {
          followLinks: true,
          maxDepth: 6, // Increased to reach deeper nested pages
          delay: 1200, // Slightly faster but still respectful
        },
      },
      // Additional ChromaDB entry points to ensure comprehensive coverage
      {
        url: "https://docs.trychroma.com/docs/overview/getting-started",
        selectors: {
          content:
            "article, main, .prose, .markdown-body, .content, [data-docs-content]",
          title: "h1, .page-title, .docs-title",
          navigation:
            "[data-docs-nav], .docs-nav, .sidebar-nav, nav[aria-label], .toc, .navigation-menu",
          exclude: [
            ".docs-nav",
            ".sidebar-nav",
            "nav",
            "footer",
            ".breadcrumb",
            ".header",
            ".page-footer",
            ".search-form",
            ".docs-header",
            ".edit-page",
            ".page-nav",
          ],
        },
        metadata: {
          source: "ChromaDB",
          language: "python",
          framework: "chromadb",
        },
        options: {
          followLinks: true,
          maxDepth: 5,
          delay: 1200,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://docs.trychroma.com/docs/run-chroma",
        selectors: {
          content:
            "article, main, .prose, .markdown-body, .content, [data-docs-content]",
          title: "h1, .page-title, .docs-title",
          navigation:
            "[data-docs-nav], .docs-nav, .sidebar-nav, nav[aria-label], .toc, .navigation-menu",
          exclude: [
            ".docs-nav",
            ".sidebar-nav",
            "nav",
            "footer",
            ".breadcrumb",
            ".header",
            ".page-footer",
            ".search-form",
            ".docs-header",
            ".edit-page",
            ".page-nav",
          ],
        },
        metadata: {
          source: "ChromaDB",
          language: "python",
          framework: "chromadb",
        },
        options: {
          followLinks: true,
          maxDepth: 5,
          delay: 1200,
          timeout: 10000, // 10 seconds timeout
          retries: 2, // 2 retries for network issues
        },
      },
      {
        url: "https://docs.unsloth.ai/",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content, div[class*='content'], div[class*='page'], .page-content, .docs-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href^='/'], a[href*='docs.unsloth'], a[href*='get-started'], a[href*='basics'], a[href*='tutorials'], a[href*='examples'], a[href*='fine-tuning'], a[href*='advanced'], a[href*='models'], a[href*='installation']",
          exclude: [
            "footer",
            "header",
            ".footer",
            ".header",
            ".breadcrumb",
            ".pagination",
            ".edit-on-github",
            ".advertisement",
            ".sponsor",
            "script",
            "style",
            ".search-box",
            ".theme-switch",
          ],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 12,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.vllm.ai/en/latest/",
        selectors: {
          content: ".md-content__inner, .md-main__inner, .md-content, main, article, .rst-content, .content, [role='main'], .tabbed-content, .md-typeset, div[class*='content'], div[data-md-component='content'], .document, .body",
          title: "h1, .md-header__title, .page-title, .md-content__title, .rst-content h1",
          navigation: ".md-nav, .md-nav__list, .md-nav__item, .md-sidebar, .toctree-wrapper, nav, a[href*='/en/latest/'], a[href*='docs.vllm'], .md-tabs__link, a[href*='getting_started'], a[href*='models'], a[href*='serving'], a[href*='dev'], a[href*='quantization'], a[href*='performance'], a[href*='multi_gpu'], a[href*='distributed']",
          exclude: [
            ".md-header",
            ".md-footer",
            ".md-search",
            ".md-source",
            "footer",
            "header", 
            ".breadcrumb",
            ".edit-on-github",
            ".toc-toggle",
            ".headerlink",
            ".md-announce",
            "script",
            "style",
            ".md-dialog",
            ".md-nav__icon",
            ".md-clipboard",
            ".md-skip",
          ],
        },
        metadata: {
          source: "vLLM",
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 12,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      // Additional entry points for Unsloth to catch more sections
      {
        url: "https://docs.unsloth.ai/get-started",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content",
          title: "h1, .page-title, .doc-title",
          navigation: "aside, .sidebar, nav, a[href^='/']",
          exclude: ["footer", "header", ".footer", ".header", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python", 
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 5,
          delay: 2000,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.unsloth.ai/basics", 
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content",
          title: "h1, .page-title, .doc-title",
          navigation: "aside, .sidebar, nav, a[href^='/']",
          exclude: ["footer", "header", ".footer", ".header", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth", 
        },
        options: {
          followLinks: true,
          maxDepth: 5,
          delay: 2000,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      // Additional entry points for vLLM
      {
        url: "https://docs.vllm.ai/en/latest/getting_started/",
        selectors: {
          content: ".md-content__inner, .md-main__inner, .md-content, main, article",
          title: "h1, .md-header__title, .page-title",
          navigation: ".md-nav, .md-nav__list, nav, a[href*='/en/latest/']",
          exclude: [".md-header", ".md-footer", ".md-search", "script", "style"],
        },
        metadata: {
          source: "vLLM",
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 6,
          delay: 2000,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.vllm.ai/en/latest/models/",
        selectors: {
          content: ".md-content__inner, .md-main__inner, .md-content, main, article",
          title: "h1, .md-header__title, .page-title", 
          navigation: ".md-nav, .md-nav__list, nav, a[href*='/en/latest/']",
          exclude: [".md-header", ".md-footer", ".md-search", "script", "style"],
        },
        metadata: {
          source: "vLLM", 
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 6,
          delay: 2000,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      // Comprehensive vLLM documentation entry points
      {
        url: "https://docs.vllm.ai/en/latest/serving/",
        selectors: {
          content: ".md-content__inner, .md-main__inner, .md-content, main, article, .rst-content",
          title: "h1, .md-header__title, .page-title",
          navigation: ".md-nav, .md-nav__list, nav, a[href*='/en/latest/']",
          exclude: [".md-header", ".md-footer", ".md-search", "script", "style"],
        },
        metadata: {
          source: "vLLM",
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.vllm.ai/en/latest/dev/",
        selectors: {
          content: ".md-content__inner, .md-main__inner, .md-content, main, article, .rst-content",
          title: "h1, .md-header__title, .page-title",
          navigation: ".md-nav, .md-nav__list, nav, a[href*='/en/latest/']",
          exclude: [".md-header", ".md-footer", ".md-search", "script", "style"],
        },
        metadata: {
          source: "vLLM",
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.vllm.ai/en/latest/quantization/",
        selectors: {
          content: ".md-content__inner, .md-main__inner, .md-content, main, article, .rst-content",
          title: "h1, .md-header__title, .page-title",
          navigation: ".md-nav, .md-nav__list, nav, a[href*='/en/latest/']",
          exclude: [".md-header", ".md-footer", ".md-search", "script", "style"],
        },
        metadata: {
          source: "vLLM",
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 7,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.vllm.ai/en/latest/multi_gpu/",
        selectors: {
          content: ".md-content__inner, .md-main__inner, .md-content, main, article, .rst-content",
          title: "h1, .md-header__title, .page-title",
          navigation: ".md-nav, .md-nav__list, nav, a[href*='/en/latest/']",
          exclude: [".md-header", ".md-footer", ".md-search", "script", "style"],
        },
        metadata: {
          source: "vLLM",
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 6,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.vllm.ai/en/latest/performance_benchmark/",
        selectors: {
          content: ".md-content__inner, .md-main__inner, .md-content, main, article, .rst-content",
          title: "h1, .md-header__title, .page-title",
          navigation: ".md-nav, .md-nav__list, nav, a[href*='/en/latest/']",
          exclude: [".md-header", ".md-footer", ".md-search", "script", "style"],
        },
        metadata: {
          source: "vLLM",
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 5,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.vllm.ai/en/latest/automatic_prefix_caching/",
        selectors: {
          content: ".md-content__inner, .md-main__inner, .md-content, main, article, .rst-content",
          title: "h1, .md-header__title, .page-title",
          navigation: ".md-nav, .md-nav__list, nav, a[href*='/en/latest/']",
          exclude: [".md-header", ".md-footer", ".md-search", "script", "style"],
        },
        metadata: {
          source: "vLLM",
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.vllm.ai/en/latest/usage/",
        selectors: {
          content: ".md-content__inner, .md-main__inner, .md-content, main, article, .rst-content",
          title: "h1, .md-header__title, .page-title",
          navigation: ".md-nav, .md-nav__list, nav, a[href*='/en/latest/']",
          exclude: [".md-header", ".md-footer", ".md-search", "script", "style"],
        },
        metadata: {
          source: "vLLM",
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      // Comprehensive Unsloth documentation entry points
      {
        url: "https://docs.unsloth.ai/tutorials",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content",
          title: "h1, .page-title, .doc-title",
          navigation: "aside, .sidebar, nav, a[href^='/']",
          exclude: ["footer", "header", ".footer", ".header", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.unsloth.ai/examples",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content",
          title: "h1, .page-title, .doc-title",
          navigation: "aside, .sidebar, nav, a[href^='/']",
          exclude: ["footer", "header", ".footer", ".header", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.unsloth.ai/fine-tuning",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content",
          title: "h1, .page-title, .doc-title",
          navigation: "aside, .sidebar, nav, a[href^='/']",
          exclude: ["footer", "header", ".footer", ".header", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.unsloth.ai/advanced",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content",
          title: "h1, .page-title, .doc-title",
          navigation: "aside, .sidebar, nav, a[href^='/']",
          exclude: ["footer", "header", ".footer", ".header", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.unsloth.ai/models",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content",
          title: "h1, .page-title, .doc-title",
          navigation: "aside, .sidebar, nav, a[href^='/']",
          exclude: ["footer", "header", ".footer", ".header", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 7,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://docs.unsloth.ai/installation",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content",
          title: "h1, .page-title, .doc-title",
          navigation: "aside, .sidebar, nav, a[href^='/']",
          exclude: ["footer", "header", ".footer", ".header", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 6,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      // Additional GitHub-based documentation sources
      {
        url: "https://github.com/unslothsai/unsloth/tree/main/docs",
        selectors: {
          content: ".markdown-body, main, article, .Box-body",
          title: "h1, .page-title, .js-navigation-open",
          navigation: ".js-navigation-container, .Box-header",
          exclude: [".js-navigation-container", "nav", "footer", ".breadcrumb", ".BtnGroup"],
        },
        metadata: {
          source: "Unsloth GitHub",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 2000,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      {
        url: "https://github.com/vllm-project/vllm/tree/main/docs",
        selectors: {
          content: ".markdown-body, main, article, .Box-body",
          title: "h1, .page-title, .js-navigation-open",
          navigation: ".js-navigation-container, .Box-header",
          exclude: [".js-navigation-container", "nav", "footer", ".breadcrumb", ".BtnGroup"],
        },
        metadata: {
          source: "vLLM GitHub",
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 4,
          delay: 2000,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      // ReadTheDocs alternative entry points
      {
        url: "https://vllm.readthedocs.io/en/latest/",
        selectors: {
          content: ".rst-content .document, .section, main, article",
          title: "h1, .page-title, .rst-content h1",
          navigation: ".toctree-wrapper, nav, .wy-menu",
          exclude: [".toctree-wrapper", "nav", "footer", ".breadcrumb", ".headerlink"],
        },
        metadata: {
          source: "vLLM ReadTheDocs",
          language: "python",
          framework: "vllm",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1500,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000, // 15 seconds timeout
          retries: 3, // 3 retries for network issues
        },
      },
      // Comprehensive Unsloth specific URL configurations
      {
        url: "https://docs.unsloth.ai/get-started/beginner-start-here",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href^='/get-started'], a[href*='beginner'], a[href*='requirements'], a[href*='faq'], a[href*='fine-tuning']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style", ".search-box", ".theme-switch"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      {
        url: "https://docs.unsloth.ai/get-started/installing-+-updating",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='installing'], a[href*='updating'], a[href*='pip-install'], a[href*='conda'], a[href*='windows'], a[href*='colab']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      {
        url: "https://docs.unsloth.ai/get-started/fine-tuning-llms-guide",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='fine-tuning'], a[href*='what-model'], a[href*='lora'], a[href*='hyperparameters']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      {
        url: "https://docs.unsloth.ai/basics/reinforcement-learning-rl-guide",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='reinforcement'], a[href*='rl-guide'], a[href*='grpo'], a[href*='dpo'], a[href*='orpo'], a[href*='kto'], a[href*='training-ai']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      {
        url: "https://docs.unsloth.ai/basics/tutorials-how-to-fine-tune-and-run-llms",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='tutorials'], a[href*='gemma'], a[href*='magistral'], a[href*='devstral'], a[href*='llama'], a[href*='deepseek'], a[href*='qwq'], a[href*='phi'], a[href*='cogito']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      {
        url: "https://docs.unsloth.ai/basics/running-and-saving-models",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='running'], a[href*='saving'], a[href*='gguf'], a[href*='ollama'], a[href*='vllm'], a[href*='troubleshooting'], a[href*='inference']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 8,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      // Additional specific Unsloth URL configurations for comprehensive coverage
      {
        url: "https://docs.unsloth.ai/get-started/unsloth-notebooks",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='notebooks'], a[href*='colab'], a[href*='jupyter']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 6,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      {
        url: "https://docs.unsloth.ai/get-started/all-our-models",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='models'], a[href*='llama'], a[href*='gemma'], a[href*='qwen'], a[href*='phi']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 6,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      {
        url: "https://docs.unsloth.ai/basics/datasets-guide",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='datasets'], a[href*='data']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 6,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      {
        url: "https://docs.unsloth.ai/basics/chat-templates",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='chat'], a[href*='templates']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 6,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      {
        url: "https://docs.unsloth.ai/basics/vision-fine-tuning",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='vision'], a[href*='multimodal']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 6,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      {
        url: "https://docs.unsloth.ai/basics/troubleshooting-and-faqs",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='troubleshooting'], a[href*='faq'], a[href*='environment']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 6,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
      {
        url: "https://docs.unsloth.ai/basics/multi-gpu-training-with-unsloth",
        selectors: {
          content: ".flex.min-w-0.flex-1.flex-col, main, article, .prose, [role='main'], .documentation-content, .markdown-body, .gitbook-content",
          title: "h1, .page-title, .doc-title, .gitbook-page-title, .document-title",
          navigation: "aside, .sidebar, nav, .toc, .gitbook-toc, a[href*='multi-gpu'], a[href*='training'], a[href*='distributed']",
          exclude: ["footer", "header", ".footer", ".header", ".breadcrumb", ".pagination", ".edit-on-github", ".advertisement", "script", "style"],
        },
        metadata: {
          source: "Unsloth",
          language: "python",
          framework: "unsloth",
        },
        options: {
          followLinks: true,
          maxDepth: 6,
          delay: 1800,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          timeout: 15000,
          retries: 3,
        },
      },
    ];
  }
}
