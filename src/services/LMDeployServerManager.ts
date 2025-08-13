/**
 * LMDeploy Server Manager
 * Handles automatic startup, shutdown, and lifecycle management of the LMDeploy Python server
 */

import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import { logger } from '../utils/logger';
import { getConfig } from '../config';

export interface LMDeployServerStatus {
  isRunning: boolean;
  pid?: number;
  port?: number;
  startTime?: Date;
  lastHealthCheck?: Date;
  error?: string;
}

export class LMDeployServerManager {
  private static instance: LMDeployServerManager;
  private serverProcess: ChildProcess | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private status: LMDeployServerStatus = { isRunning: false };
  private readonly extensionPath: string;
  private readonly serverPath: string;
  private statusBarItem: vscode.StatusBarItem;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
    this.serverPath = path.join(extensionPath, 'src', 'lmdeploy-server');
    
    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 
      100
    );
    this.statusBarItem.text = "$(loading~spin) LMDeploy";
    this.statusBarItem.tooltip = "LMDeploy Server Status";
    this.statusBarItem.command = 'ollamaAgent.lmdeployStatus';
    this.updateStatusBar();
  }

  public static getInstance(extensionPath?: string): LMDeployServerManager {
    if (!LMDeployServerManager.instance) {
      if (!extensionPath) {
        throw new Error('Extension path required for first initialization');
      }
      LMDeployServerManager.instance = new LMDeployServerManager(extensionPath);
    }
    return LMDeployServerManager.instance;
  }

  /**
   * Start the LMDeploy server if enabled and not already running
   */
  public async startServer(): Promise<boolean> {
    const config = getConfig();
    
    if (!config.lmdeploy.enabled) {
      logger.info('[LMDeploy] Server startup skipped - LMDeploy disabled in settings');
      return false;
    }

    if (this.status.isRunning) {
      logger.info('[LMDeploy] Server already running');
      return true;
    }

    try {
      logger.info('[LMDeploy] Starting server...');
      
      // Check if server directory exists
      if (!fs.existsSync(this.serverPath)) {
        throw new Error(`LMDeploy server directory not found: ${this.serverPath}`);
      }

      // Check if server.py exists
      const serverScript = path.join(this.serverPath, 'app', 'server.py');
      if (!fs.existsSync(serverScript)) {
        throw new Error(`LMDeploy server script not found: ${serverScript}`);
      }

      // Extract port from serverUrl
      const port = this.extractPortFromUrl(config.lmdeploy.serverUrl);
      
      // Use Python from virtual environment
      const venvPythonPath = path.join(this.serverPath, '.venv', 'bin', 'python');
      
      // Check if venv Python exists
      if (!fs.existsSync(venvPythonPath)) {
        throw new Error(`Virtual environment Python not found: ${venvPythonPath}. Please ensure the virtual environment is set up correctly.`);
      }
      
      // Spawn uvicorn server process using venv Python (uvicorn is in the venv)
      const uvicornPath = path.join(this.serverPath, '.venv', 'bin', 'uvicorn');
      
      // Check if uvicorn exists in venv
      if (!fs.existsSync(uvicornPath)) {
        // Fallback to using python -m uvicorn
        this.serverProcess = spawn(venvPythonPath, ['-m', 'uvicorn', 'app.server:app', '--port', port.toString(), '--host', '0.0.0.0'], {
          cwd: this.serverPath,
          env: {
            ...process.env,
            LMDEPLOY_PORT: port.toString(),
            LMDEPLOY_HOST: '0.0.0.0',
            LMDEPLOY_MODEL: config.lmdeploy.model,
            LMDEPLOY_SESSION_LEN: config.lmdeploy.sessionLen?.toString() || '2048',
            LMDEPLOY_MAX_BATCH_SIZE: config.lmdeploy.maxBatchSize?.toString() || '8',
            LMDEPLOY_TENSOR_PARALLEL_SIZE: config.lmdeploy.tensorParallelSize?.toString() || '1',
            LMDEPLOY_CACHE_MAX_ENTRY_COUNT: config.lmdeploy.cacheMaxEntryCount?.toString() || '0.8',
            LMDEPLOY_ENGINE_TYPE: config.lmdeploy.engineType || 'turbomind'
          },
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } else {
        // Use uvicorn directly from venv
        this.serverProcess = spawn(uvicornPath, ['app.server:app', '--port', port.toString(), '--host', '0.0.0.0'], {
          cwd: this.serverPath,
          env: {
            ...process.env,
            LMDEPLOY_PORT: port.toString(),
            LMDEPLOY_HOST: '0.0.0.0',
            LMDEPLOY_MODEL: config.lmdeploy.model,
            LMDEPLOY_SESSION_LEN: config.lmdeploy.sessionLen?.toString() || '2048',
            LMDEPLOY_MAX_BATCH_SIZE: config.lmdeploy.maxBatchSize?.toString() || '8',
            LMDEPLOY_TENSOR_PARALLEL_SIZE: config.lmdeploy.tensorParallelSize?.toString() || '1',
            LMDEPLOY_CACHE_MAX_ENTRY_COUNT: config.lmdeploy.cacheMaxEntryCount?.toString() || '0.8',
            LMDEPLOY_ENGINE_TYPE: config.lmdeploy.engineType || 'turbomind'
          },
          stdio: ['pipe', 'pipe', 'pipe']
        });
      }

      // Handle server output
      this.serverProcess.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          logger.debug(`[LMDeploy Server] ${output}`);
        }
      });

      this.serverProcess.stderr?.on('data', (data) => {
        const error = data.toString().trim();
        if (error) {
          logger.warn(`[LMDeploy Server Error] ${error}`);
        }
      });

      // Handle server exit
      this.serverProcess.on('exit', (code, signal) => {
        logger.info(`[LMDeploy] Server exited with code ${code}, signal ${signal}`);
        this.status.isRunning = false;
        this.status.pid = undefined;
        this.updateStatusBar();
        
        // Restart if unexpected exit
        if (code !== 0 && config.lmdeploy.enabled) {
          logger.warn('[LMDeploy] Server crashed, attempting restart in 5 seconds...');
          setTimeout(() => {
            this.startServer();
          }, 5000);
        }
      });

      // Handle server error
      this.serverProcess.on('error', (error) => {
        logger.error(`[LMDeploy] Server startup error: ${error.message}`);
        this.status.isRunning = false;
        this.status.error = error.message;
        this.updateStatusBar();
      });

      // Update status
      this.status = {
        isRunning: true,
        pid: this.serverProcess.pid,
        port: port,
        startTime: new Date(),
        lastHealthCheck: new Date()
      };

      // Wait for server to be ready
      const isReady = await this.waitForServerReady(config.lmdeploy.serverUrl, 30000);
      
      if (isReady) {
        logger.info(`[LMDeploy] Server started successfully on port ${port}`);
        this.startHealthCheck();
        this.updateStatusBar();
        
        // Show notification
        vscode.window.showInformationMessage(
          `LMDeploy server started on port ${port}`,
          'View Status'
        ).then((selection) => {
          if (selection === 'View Status') {
            this.showServerStatus();
          }
        });
        
        return true;
      } else {
        throw new Error('Server failed to become ready within timeout');
      }

    } catch (error) {
      logger.error(`[LMDeploy] Failed to start server: ${error}`);
      this.status.error = error instanceof Error ? error.message : String(error);
      this.updateStatusBar();
      
      vscode.window.showErrorMessage(
        `Failed to start LMDeploy server: ${this.status.error}`,
        'View Logs'
      ).then((selection) => {
        if (selection === 'View Logs') {
          logger.show();
        }
      });
      
      return false;
    }
  }

  /**
   * Stop the LMDeploy server
   */
  public async stopServer(): Promise<void> {
    if (!this.serverProcess || !this.status.isRunning) {
      logger.info('[LMDeploy] No server to stop');
      return;
    }

    try {
      logger.info('[LMDeploy] Stopping server...');
      
      // Stop health check
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // Graceful shutdown
      this.serverProcess.kill('SIGTERM');
      
      // Force kill after 5 seconds if not stopped
      setTimeout(() => {
        if (this.serverProcess && this.status.isRunning) {
          logger.warn('[LMDeploy] Force killing server process');
          this.serverProcess.kill('SIGKILL');
        }
      }, 5000);

      this.status.isRunning = false;
      this.status.pid = undefined;
      this.updateStatusBar();
      
      logger.info('[LMDeploy] Server stopped');

    } catch (error) {
      logger.error(`[LMDeploy] Error stopping server: ${error}`);
    }
  }

  /**
   * Restart the server
   */
  public async restartServer(): Promise<boolean> {
    await this.stopServer();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    return await this.startServer();
  }

  /**
   * Get current server status
   */
  public getStatus(): LMDeployServerStatus {
    return { ...this.status };
  }

  /**
   * Wait for server to be ready
   */
  private async waitForServerReady(serverUrl: string, timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 1000; // Check every second

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await axios.get(`${serverUrl}/`, { timeout: 5000 });
        if (response.status === 200 && response.data?.lmdeploy_available) {
          return true;
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }
      
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    return false;
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      const config = getConfig();
      if (!config.lmdeploy.enabled || !this.status.isRunning) {
        return;
      }

      try {
        const response = await axios.get(`${config.lmdeploy.serverUrl}/api/status`, { 
          timeout: 5000 
        });
        
        if (response.status === 200) {
          this.status.lastHealthCheck = new Date();
          this.status.error = undefined;
        } else {
          throw new Error(`Health check failed with status ${response.status}`);
        }
      } catch (error) {
        logger.warn(`[LMDeploy] Health check failed: ${error}`);
        this.status.error = error instanceof Error ? error.message : String(error);
        
        // If health check fails multiple times, restart server
        const timeSinceLastCheck = Date.now() - (this.status.lastHealthCheck?.getTime() || 0);
        if (timeSinceLastCheck > 60000) { // 1 minute
          logger.warn('[LMDeploy] Server unhealthy, attempting restart...');
          this.restartServer();
        }
      }
      
      this.updateStatusBar();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Update status bar item
   */
  private updateStatusBar(): void {
    if (this.status.isRunning) {
      if (this.status.error) {
        this.statusBarItem.text = "$(warning) LMDeploy";
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.tooltip = `LMDeploy Server (Warning): ${this.status.error}`;
      } else {
        this.statusBarItem.text = "$(check) LMDeploy";
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = `LMDeploy Server Running (PID: ${this.status.pid}, Port: ${this.status.port})`;
      }
    } else {
      this.statusBarItem.text = "$(circle-slash) LMDeploy";
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      this.statusBarItem.tooltip = this.status.error ? 
        `LMDeploy Server Error: ${this.status.error}` : 
        'LMDeploy Server Stopped';
    }

    const config = getConfig();
    if (config.lmdeploy.enabled) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  /**
   * Show server status in a webview or info message
   */
  public showServerStatus(): void {
    const status = this.getStatus();
    const config = getConfig();
    
    const statusMessage = `
LMDeploy Server Status:
• Running: ${status.isRunning ? 'Yes' : 'No'}
• PID: ${status.pid || 'N/A'}
• Port: ${status.port || 'N/A'}
• Started: ${status.startTime?.toLocaleString() || 'N/A'}
• Last Health Check: ${status.lastHealthCheck?.toLocaleString() || 'N/A'}
• Error: ${status.error || 'None'}
• Configuration: ${config.lmdeploy.enabled ? 'Enabled' : 'Disabled'}
• Model: ${config.lmdeploy.model}
• Engine: ${config.lmdeploy.engineType}
    `.trim();

    vscode.window.showInformationMessage(
      statusMessage,
      { modal: true },
      'Restart Server',
      'Stop Server',
      'View Logs'
    ).then((selection) => {
      switch (selection) {
        case 'Restart Server':
          this.restartServer();
          break;
        case 'Stop Server':
          this.stopServer();
          break;
        case 'View Logs':
          logger.show();
          break;
      }
    });
  }

  /**
   * Extract port number from URL
   */
  private extractPortFromUrl(url: string): number {
    try {
      const urlObj = new URL(url);
      return parseInt(urlObj.port) || 11435;
    } catch {
      return 11435; // Default port
    }
  }

  /**
   * Cleanup on extension deactivation
   */
  public dispose(): void {
    this.stopServer();
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.statusBarItem.dispose();
  }
}