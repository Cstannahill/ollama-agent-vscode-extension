import * as vscode from "vscode";

/**
 * Global provider for extension context access
 * Allows other components to access the extension context when needed
 */
class ExtensionContextProvider {
  private static instance: ExtensionContextProvider;
  private _context?: vscode.ExtensionContext;

  private constructor() {}

  static getInstance(): ExtensionContextProvider {
    if (!ExtensionContextProvider.instance) {
      ExtensionContextProvider.instance = new ExtensionContextProvider();
    }
    return ExtensionContextProvider.instance;
  }

  public setContext(context: vscode.ExtensionContext): void {
    this._context = context;
  }

  public getContext(): vscode.ExtensionContext | undefined {
    return this._context;
  }

  public getGlobalStoragePath(): string | undefined {
    return this._context?.globalStorageUri?.fsPath;
  }

  public getWorkspaceStoragePath(): string | undefined {
    return this._context?.storageUri?.fsPath;
  }
}

export const extensionContextProvider = ExtensionContextProvider.getInstance();
