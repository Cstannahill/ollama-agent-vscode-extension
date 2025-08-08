# 📂 VS Code Extension Structure for Ollama Agent

## 🧱 Suggested Project Structure

```
ollama-agent-vscode-extension/
├── .vscode/
│   └── launch.json              # Debug configs
├── media/                       # Static assets (icons, UI, CSS for webviews)
├── src/
│   ├── agents/
│   │   └── BasicAgent.ts        # Agent loop logic (ReAct, Planner-Executor, etc.)
│   ├── api/
│   │   └── ollama.ts            # Ollama REST API interface
│   ├── commands/
│   │   └── registerCommands.ts  # Register user commands (e.g. "Agent: Fix File")
│   ├── tools/
│   │   ├── FileReadTool.ts      # Tools agent can call
│   │   ├── FileWriteTool.ts
│   │   └── RunShellTool.ts
│   ├── core/
│   │   ├── ToolManager.ts       # Registry & invoker for all tools
│   │   ├── PromptBuilder.ts     # Prompt construction templates
│   │   └── ChatSession.ts       # Message history, function calls, state
│   ├── views/
│   │   ├── ChatPanel.ts         # Webview or inline chat UI (optional)
│   │   └── SidebarProvider.ts   # For sidebar tree views
│   ├── utils/
│   │   └── logger.ts            # Logging and diagnostics
│   ├── extension.ts             # Entry point
│   └── config.ts                # Global constants, settings
├── test/
│   └── ...                      # Unit and integration tests
├── package.json                 # VS Code extension manifest + dependencies
├── tsconfig.json
└── README.md
```

---

## 📂 Folder Breakdown

### `agents/`

- One or more "brains" or "controllers" for chaining tool calls and planning.
- Future: support multiple agent strategies (ReAct, Reflexion, Planner/Executor).

### `api/`

- Responsible for calling Ollama’s HTTP endpoints (chat, generate, embeddings).
- Abstracted here so you can swap in remote models (OpenAI, Claude, etc.) later.

### `commands/`

- All VS Code `registerCommand` calls live here.
- Keeps the entry `extension.ts` clean and declarative.

### `tools/`

- All capabilities the agent can call (file read/write, terminal, etc.).
- Each tool defines:

  - `name`
  - `description`
  - `parameters` (Zod or JSON schema)
  - `run(args): Promise<T>`

### `core/`

- Core functionality:

  - `ToolManager`: keeps a registry of tools, resolves & invokes them.
  - `PromptBuilder`: central place to assemble prompts / system instructions.
  - `ChatSession`: manages messages, memory, turn history.

### `views/`

- Webviews, tree views, panels, etc. Use sparingly unless going UI-heavy.

### `utils/`

- Generic helpers (logging, path resolution, token counting, etc.)

---

## 🔧 Future-Ready Ideas

Here’s where modularity pays off:

| Feature                 | How to Add                                                            |
| ----------------------- | --------------------------------------------------------------------- |
| ✅ New Tool             | Drop a new `.ts` file in `tools/`, register it in `ToolManager`       |
| ✅ Swap model           | Create another `api/` module, change which API is used                |
| ✅ Multiple agents      | `agents/PlanningAgent.ts`, `agents/ReActAgent.ts` — plug into command |
| ✅ Configurable prompts | Move system prompts to `config/` or user settings                     |
| ✅ Add chat UI          | Build `ChatPanel.ts` in `views/` and register webview provider        |

---

## 🧪 Development Tip

Create a `dev/` playground script to test your agent logic _outside_ VS Code, using local mock data, before binding to UI/editor. It speeds up development tremendously.

---

## 🚀 Starter Command Registration (inside `commands/registerCommands.ts`)

```ts
import * as vscode from "vscode";
import { runAgentOnCurrentFile } from "./runAgent";

export function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("ollamaAgent.run", runAgentOnCurrentFile)
  );
}
```

Then in `extension.ts`:

```ts
import { registerCommands } from "./commands/registerCommands";

export function activate(context: vscode.ExtensionContext) {
  registerCommands(context);
}
```

---

## ✅ Recap: Benefits of This Structure

- **Easy to add tools/agents**
- **Isolated responsibilities (API, core, tools, UI, commands)**
- **Clean separation for long-term maintainability**
- **Testable agent logic outside of VS Code**

---
