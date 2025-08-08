import { BaseTool } from "../core/BaseTool";
import { z } from "zod";
import { logger } from "../utils/logger";
import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// HTTP Request Tool
export class HttpRequestTool extends BaseTool {
  name = "http_request";
  description = "Make HTTP requests to APIs and web services";
  
  schema = z.object({
    url: z.string().describe("The URL to make the request to"),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]).optional().describe("HTTP method (default: GET)"),
    headers: z.record(z.string(), z.string()).optional().describe("HTTP headers as key-value pairs"),
    body: z.string().optional().describe("Request body (for POST, PUT, PATCH)"),
    timeout: z.number().optional().describe("Request timeout in milliseconds (default: 30000)"),
    followRedirects: z.boolean().optional().describe("Follow HTTP redirects (default: true)"),
    validateCerts: z.boolean().optional().describe("Validate SSL certificates (default: true)"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const {
        url,
        method = "GET",
        headers = {},
        body,
        timeout = 30000,
        followRedirects = true,
        validateCerts = true
      } = params;

      logger.info(`[HTTP_REQUEST] Making ${method} request to: ${url}`);

      // Use curl for HTTP requests (available on most systems)
      const curlCommand = this.buildCurlCommand({
        url,
        method,
        headers,
        body,
        timeout,
        followRedirects,
        validateCerts
      });

      const { stdout, stderr } = await execAsync(curlCommand, {
        timeout: timeout + 5000, // Add buffer to curl timeout
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      if (stderr && !stderr.includes("% Total")) {
        logger.warn(`[HTTP_REQUEST] curl stderr: ${stderr}`);
      }

      logger.info(`[HTTP_REQUEST] Request completed successfully`);
      return `HTTP ${method} ${url}\n\nResponse:\n${stdout}`;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[HTTP_REQUEST] Failed:", error);
      
      if (error && typeof error === 'object' && 'stdout' in error) {
        const execError = error as any;
        return `HTTP request failed: ${errorMessage}\n\nResponse:\n${execError.stdout}\n\nError details:\n${execError.stderr}`;
      }
      
      throw new Error(`HTTP request failed: ${errorMessage}`);
    }
  }

  private buildCurlCommand(params: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeout: number;
    followRedirects: boolean;
    validateCerts: boolean;
  }): string {
    const { url, method, headers, body, timeout, followRedirects, validateCerts } = params;
    
    let cmd = ["curl"];
    
    // Basic options
    cmd.push("-i"); // Include headers in output
    cmd.push("-s"); // Silent mode
    cmd.push("--show-error"); // Show errors
    cmd.push(`--max-time ${Math.floor(timeout / 1000)}`); // Timeout in seconds
    
    // Method
    if (method !== "GET") {
      cmd.push(`-X ${method}`);
    }
    
    // Headers
    Object.entries(headers).forEach(([key, value]) => {
      cmd.push(`-H "${key}: ${value}"`);
    });
    
    // Body
    if (body && ["POST", "PUT", "PATCH"].includes(method)) {
      cmd.push(`-d '${body.replace(/'/g, "\\'")}'`);
      // Add content-type if not specified
      if (!Object.keys(headers).some(k => k.toLowerCase() === "content-type")) {
        cmd.push(`-H "Content-Type: application/json"`);
      }
    }
    
    // Redirects
    if (followRedirects) {
      cmd.push("-L");
    }
    
    // SSL validation
    if (!validateCerts) {
      cmd.push("-k");
    }
    
    // URL (last)
    cmd.push(`"${url}"`);
    
    return cmd.join(" ");
  }
}

// API Testing Tool
export class ApiTestTool extends BaseTool {
  name = "api_test";
  description = "Test API endpoints with assertions and validation";
  
  schema = z.object({
    url: z.string().describe("API endpoint URL"),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional().describe("HTTP method"),
    headers: z.record(z.string(), z.string()).optional().describe("Request headers"),
    body: z.string().optional().describe("Request body"),
    expectedStatus: z.number().optional().describe("Expected HTTP status code"),
    expectedHeaders: z.record(z.string(), z.string()).optional().describe("Expected response headers"),
    expectedBody: z.string().optional().describe("Expected response body content"),
    timeout: z.number().optional().describe("Request timeout in milliseconds"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const {
        url,
        method = "GET",
        headers = {},
        body,
        expectedStatus,
        expectedHeaders,
        expectedBody,
        timeout = 30000
      } = params;

      logger.info(`[API_TEST] Testing ${method} ${url}`);

      // Make the HTTP request
      const httpTool = new HttpRequestTool();
      const response = await httpTool.execute({
        url,
        method,
        headers,
        body,
        timeout
      });

      // Parse the response
      const { statusCode, responseHeaders, responseBody } = this.parseHttpResponse(response);
      
      // Run assertions
      const results = this.runAssertions({
        statusCode,
        responseHeaders,
        responseBody,
        expectedStatus,
        expectedHeaders,
        expectedBody
      });

      const testResult = {
        url,
        method,
        status: statusCode,
        passed: results.every(r => r.passed),
        assertions: results,
        response: {
          headers: responseHeaders,
          body: responseBody.substring(0, 1000) + (responseBody.length > 1000 ? "..." : "")
        }
      };

      logger.info(`[API_TEST] Test completed - ${testResult.passed ? "PASSED" : "FAILED"}`);
      
      return `API Test Results for ${method} ${url}:
Status: ${testResult.passed ? "✅ PASSED" : "❌ FAILED"}

Assertions:
${results.map(r => `${r.passed ? "✅" : "❌"} ${r.description}: ${r.message}`).join("\n")}

Response Status: ${statusCode}
Response Preview: ${responseBody.substring(0, 500)}${responseBody.length > 500 ? "..." : ""}`;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[API_TEST] Failed:", error);
      throw new Error(`API test failed: ${errorMessage}`);
    }
  }

  private parseHttpResponse(response: string): {
    statusCode: number;
    responseHeaders: Record<string, string>;
    responseBody: string;
  } {
    const lines = response.split('\n');
    const headerEndIndex = lines.findIndex(line => line.trim() === '');
    
    // Extract status code
    const statusLine = lines.find(line => line.startsWith('HTTP/'));
    const statusCode = statusLine ? parseInt(statusLine.split(' ')[1]) : 0;
    
    // Extract headers
    const responseHeaders: Record<string, string> = {};
    for (let i = 0; i < headerEndIndex; i++) {
      const line = lines[i];
      if (line.includes(':') && !line.startsWith('HTTP/')) {
        const [key, ...valueParts] = line.split(':');
        responseHeaders[key.trim().toLowerCase()] = valueParts.join(':').trim();
      }
    }
    
    // Extract body
    const responseBody = lines.slice(headerEndIndex + 1).join('\n').trim();
    
    return { statusCode, responseHeaders, responseBody };
  }

  private runAssertions(params: {
    statusCode: number;
    responseHeaders: Record<string, string>;
    responseBody: string;
    expectedStatus?: number;
    expectedHeaders?: Record<string, string>;
    expectedBody?: string;
  }): Array<{passed: boolean; description: string; message: string}> {
    const results = [];
    
    // Status code assertion
    if (params.expectedStatus !== undefined) {
      const passed = params.statusCode === params.expectedStatus;
      results.push({
        passed,
        description: "Status Code",
        message: passed 
          ? `Expected ${params.expectedStatus}, got ${params.statusCode}` 
          : `Expected ${params.expectedStatus}, got ${params.statusCode}`
      });
    }
    
    // Header assertions
    if (params.expectedHeaders) {
      Object.entries(params.expectedHeaders).forEach(([key, expectedValue]) => {
        const actualValue = params.responseHeaders[key.toLowerCase()];
        const passed = actualValue === expectedValue;
        results.push({
          passed,
          description: `Header ${key}`,
          message: passed 
            ? `Expected "${expectedValue}", got "${actualValue}"` 
            : `Expected "${expectedValue}", got "${actualValue}"`
        });
      });
    }
    
    // Body content assertion
    if (params.expectedBody) {
      const passed = params.responseBody.includes(params.expectedBody);
      results.push({
        passed,
        description: "Body Content",
        message: passed 
          ? `Body contains expected content` 
          : `Body does not contain expected content: "${params.expectedBody}"`
      });
    }
    
    return results;
  }
}

// Health Check Tool
export class HealthCheckTool extends BaseTool {
  name = "health_check";
  description = "Check the health status of services and endpoints";
  
  schema = z.object({
    urls: z.union([z.string(), z.array(z.string())]).describe("URL(s) to check"),
    timeout: z.number().optional().describe("Timeout per request in milliseconds"),
    retries: z.number().optional().describe("Number of retry attempts"),
    interval: z.number().optional().describe("Interval between retries in milliseconds"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const {
        urls,
        timeout = 10000,
        retries = 2,
        interval = 1000
      } = params;

      const urlList = Array.isArray(urls) ? urls : [urls];
      logger.info(`[HEALTH_CHECK] Checking health of ${urlList.length} endpoint(s)`);

      const results = await Promise.all(
        urlList.map(url => this.checkEndpoint(url, timeout, retries, interval))
      );

      const summary = {
        total: results.length,
        healthy: results.filter(r => r.healthy).length,
        unhealthy: results.filter(r => !r.healthy).length,
        results
      };

      logger.info(`[HEALTH_CHECK] Completed - ${summary.healthy}/${summary.total} healthy`);

      return `Health Check Results:
Overall Status: ${summary.healthy === summary.total ? "✅ ALL HEALTHY" : "⚠️  ISSUES DETECTED"}
Healthy: ${summary.healthy}/${summary.total}

Details:
${results.map(r => 
  `${r.healthy ? "✅" : "❌"} ${r.url} - ${r.status} (${r.responseTime}ms)${r.error ? ` - ${r.error}` : ""}`
).join("\n")}`;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[HEALTH_CHECK] Failed:", error);
      throw new Error(`Health check failed: ${errorMessage}`);
    }
  }

  private async checkEndpoint(
    url: string, 
    timeout: number, 
    retries: number, 
    interval: number
  ): Promise<{url: string; healthy: boolean; status: string; responseTime: number; error?: string}> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const startTime = Date.now();
      
      try {
        const curlCommand = `curl -s -o /dev/null -w "%{http_code}" --max-time ${Math.floor(timeout / 1000)} "${url}"`;
        const { stdout } = await execAsync(curlCommand);
        const responseTime = Date.now() - startTime;
        const statusCode = parseInt(stdout.trim());
        
        if (statusCode >= 200 && statusCode < 400) {
          return {
            url,
            healthy: true,
            status: `HTTP ${statusCode}`,
            responseTime
          };
        } else {
          if (attempt === retries) {
            return {
              url,
              healthy: false,
              status: `HTTP ${statusCode}`,
              responseTime,
              error: `Unhealthy status code: ${statusCode}`
            };
          }
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        if (attempt === retries) {
          return {
            url,
            healthy: false,
            status: "ERROR",
            responseTime,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
      
      // Wait before retry
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
    
    // Fallback (should not reach here)
    return {
      url,
      healthy: false,
      status: "UNKNOWN",
      responseTime: 0,
      error: "Maximum retries exceeded"
    };
  }
}

// Port Scanner Tool
export class PortScanTool extends BaseTool {
  name = "port_scan";
  description = "Scan network ports to check service availability";
  
  schema = z.object({
    host: z.string().describe("Target hostname or IP address"),
    ports: z.union([z.number(), z.array(z.number()), z.string()]).describe("Port(s) to scan (single port, array, or range like '80-443')"),
    timeout: z.number().optional().describe("Timeout per port in milliseconds"),
  });

  async execute(params: z.infer<typeof this.schema>): Promise<string> {
    try {
      const { host, ports, timeout = 5000 } = params;
      
      const portList = this.parsePortsInput(ports);
      logger.info(`[PORT_SCAN] Scanning ${portList.length} ports on ${host}`);

      const results = await Promise.all(
        portList.map(port => this.scanPort(host, port, timeout))
      );

      const openPorts = results.filter(r => r.open);
      const closedPorts = results.filter(r => !r.open);

      return `Port Scan Results for ${host}:
Open Ports: ${openPorts.length}
Closed Ports: ${closedPorts.length}

Open Ports:
${openPorts.map(r => `✅ ${r.port} - ${r.service || "Unknown service"} (${r.responseTime}ms)`).join("\n") || "None"}

Closed Ports:
${closedPorts.slice(0, 10).map(r => `❌ ${r.port} (${r.responseTime}ms)`).join("\n")}${closedPorts.length > 10 ? `\n... and ${closedPorts.length - 10} more` : ""}`;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[PORT_SCAN] Failed:", error);
      throw new Error(`Port scan failed: ${errorMessage}`);
    }
  }

  private parsePortsInput(ports: number | number[] | string): number[] {
    if (typeof ports === "number") {
      return [ports];
    } else if (Array.isArray(ports)) {
      return ports;
    } else if (typeof ports === "string") {
      // Handle range like "80-443"
      if (ports.includes("-")) {
        const [start, end] = ports.split("-").map(p => parseInt(p.trim()));
        const portList = [];
        for (let i = start; i <= end; i++) {
          portList.push(i);
        }
        return portList;
      } else {
        // Handle comma-separated like "80,443,8080"
        return ports.split(",").map(p => parseInt(p.trim()));
      }
    }
    return [];
  }

  private async scanPort(host: string, port: number, timeout: number): Promise<{
    port: number;
    open: boolean;
    responseTime: number;
    service?: string;
  }> {
    const startTime = Date.now();
    
    try {
      // Use netcat for port scanning
      const command = `nc -z -w${Math.floor(timeout / 1000)} ${host} ${port}`;
      await execAsync(command);
      
      const responseTime = Date.now() - startTime;
      const service = this.getServiceName(port);
      
      return {
        port,
        open: true,
        responseTime,
        service
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        port,
        open: false,
        responseTime
      };
    }
  }

  private getServiceName(port: number): string | undefined {
    const commonPorts: Record<number, string> = {
      21: "FTP",
      22: "SSH",
      23: "Telnet",
      25: "SMTP",
      53: "DNS",
      80: "HTTP",
      110: "POP3",
      143: "IMAP",
      443: "HTTPS",
      993: "IMAPS",
      995: "POP3S",
      3000: "Node.js dev server",
      3306: "MySQL",
      5432: "PostgreSQL",
      6379: "Redis",
      8080: "HTTP Alt",
      8443: "HTTPS Alt",
      9200: "Elasticsearch"
    };
    
    return commonPorts[port];
  }
}