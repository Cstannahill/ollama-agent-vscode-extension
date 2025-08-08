# Ollama Agent VS Code Extension Architecture

## 🧩 **Core Languages & Environment**

### ✅ **TypeScript**

- VS Code extensions are typically written in **TypeScript** (preferred) or JavaScript.
- Type safety is very helpful when dealing with dynamic LLM behavior.

### ✅ **Node.js**

- Underlying runtime for the extension. You’ll use Node APIs for filesystem access, running subprocesses, HTTP requests, etc.

---

## 📦 **VS Code Extension SDK**

### ✅ `vscode` npm package

- The official VS Code API surface. You'll use it to:

  - Register commands
  - Read/write files in the workspace
  - Access open editors and terminals
  - Create UI (e.g., webviews, output panels, inline chat, etc.)

---

## 🔌 **Communication with Ollama**

### ✅ Ollama HTTP API (local inference)

- Ollama exposes a local REST API (usually `http://localhost:11434`) with endpoints like:

  - `POST /api/generate`
  - `POST /api/chat`
  - `POST /api/embeddings`

- Use `fetch` or `axios` to interface with it from your extension.

---

## 🧠 **Agent Framework (optional but powerful)**

To chain tasks, you’ll want some kind of **agentic loop** or planning system.
Here are some frameworks/libraries that help:

### 🟡 **LangChain.js**

- Abstracts prompt templates, memory, chaining, tool calling, etc.
- Can act as a lightweight agent system inside your extension.
- You can register tools like “read file,” “write file,” “run command.”

### 🟡 **AutoGen (coming to JS soon) / CrewAI**

- Not ready in TS yet, but conceptually similar: multi-agent systems that can assign and complete goals using tool APIs.

You could also build your own minimal planner / reflection loop if you want to stay lightweight.

---

## 🧰 **Tooling Layer (functions the model can call)**

You need to expose tools for the model to invoke in a structured way.

### ✅ **Function Calling Spec**

Define tools in JSON schema-like fashion:

```ts
{
  name: "readFile",
  description: "Read the contents of a file in the workspace",
  parameters: {
    type: "object",
    properties: {
      filePath: { type: "string" }
    },
    required: ["filePath"]
  }
}
```

Use this to:

- Send tools as part of prompt or function call metadata
- Parse model output to invoke appropriate tool
- Reflect on result, possibly reprompt or continue chain

---

## 📄 **File System Access**

- Use `vscode.workspace.fs` or Node `fs.promises` APIs
- For agentic systems, maintain a **virtual scratchpad / state log** (JSON or markdown) to reflect ongoing actions

---

## 🧪 **Testing / Local Development Tools**

- `yo code` generator for scaffolding extensions
- `vsce` to package your extension
- Use `ts-node` and a `launch.json` setup for debugging your extension with breakpoints

---

## 🧠 Prompt Engineering / Multi-Step Planning

- Prompt templates to handle:

  - Tool selection
  - Observations + reflections
  - "Thought, Action, Observation, Reflection" loops (ReAct pattern)

- Chain-of-thought prompting or even embedding previous file context in messages

---

## 🖼️ Optional UI Enhancements

- **Webviews**: Custom panels for output, logs, chat, etc.
- **Inline Chat**: Chat in the editor like Copilot Chat or Continue.dev
- **Tree View**: Visualize task chains, memory, file modifications

---

## 🔐 Security & Safeguards

- Never allow raw shell command execution without confirmation.
- File write actions should be scoped to workspace or opt-in.
- Log all agent actions and provide an undo system or action preview.

---

## 🔍 Example Libraries / Tools

| Tool          | Purpose                                  |
| ------------- | ---------------------------------------- |
| `vscode`      | Core extension API                       |
| `axios`       | HTTP client for Ollama                   |
| `langchain`   | Tool abstraction + agent behavior        |
| `fs-extra`    | FS with more ergonomic API               |
| `zod` / `ajv` | Tool parameter schema validation         |
| `yaml`        | If using config or memory logs in YAML   |
| `marked`      | Markdown rendering for chat or tool logs |

---

## 🚀 Forward-Thinking Suggestions

- Use Ollama’s `system` and `template` options to fine-tune behavior.
- Allow users to plug in their own tools easily (custom tool registry).
- Add fine-grained controls for which folders/files the model can access.
- Keep logs of each action and tool call in a readable format.

---
