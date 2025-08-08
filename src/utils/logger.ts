import * as vscode from "vscode";
import { getConfig } from "../config";
import chalk from "chalk";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel = LogLevel.INFO;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Ollama Agent");
    this.updateLogLevel();
  }

  public updateLogLevel() {
    const config = getConfig();
    switch (config.logLevel) {
      case "debug":
        this.logLevel = LogLevel.DEBUG;
        break;
      case "info":
        this.logLevel = LogLevel.INFO;
        break;
      case "warn":
        this.logLevel = LogLevel.WARN;
        break;
      case "error":
        this.logLevel = LogLevel.ERROR;
        break;
      default:
        this.logLevel = LogLevel.INFO;
    }
  }

  private log(level: LogLevel, message: string, ...args: any[]) {
    if (level < this.logLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelStr = LogLevel[level];
    let coloredMessage = message;
    switch (level) {
      case LogLevel.DEBUG:
        coloredMessage = chalk.blue(`OAVSCE - DEBUG: ${message}`);
        break;
      case LogLevel.INFO:
        coloredMessage = chalk.green(`OAVSCE - INFO: ${message}`);
        break;
      case LogLevel.WARN:
        coloredMessage = chalk.yellow(`OAVSCE - WARN: ${message}`);
        break;
      case LogLevel.ERROR:
        coloredMessage = chalk.red(`OAVSCE - ERROR: ${message}`);
        break;
      default:
        coloredMessage = message;
    }
    const formattedMessage = `[${timestamp}] [${levelStr}] ${coloredMessage}`;

    if (args.length > 0) {
      this.outputChannel.appendLine(
        `${formattedMessage} ${JSON.stringify(args)}`
      );
    } else {
      this.outputChannel.appendLine(formattedMessage);
    }

    // Also log to console for debugging
    if (level >= LogLevel.WARN || level === LogLevel.DEBUG) {
      console.log(formattedMessage, ...args);
    }
  }

  debug(message: string, ...args: any[]) {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: any[]) {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: any[]) {
    this.log(LogLevel.ERROR, message, ...args);
  }

  show() {
    this.outputChannel.show();
  }

  dispose() {
    this.outputChannel.dispose();
  }
}

export const logger = new Logger();
