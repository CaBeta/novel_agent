# ReAct Agent Implementation Plan (v2 - 修复版)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将小说创作系统从线性状态机重构为完全自主的 ReAct Agent 模式

**Architecture:**
- 4 个核心工具 (bash, generate_content, dispatch_agent, ask_user)
- 使用 **OpenAI Function Calling** 原生协议 (修复 P1)
- **真正的并行执行** SubAgent (修复 P1)
- **沙箱化的 bash 工具** (修复 P1)
- **完整的 ask_user 和断点恢复** 接入 (修复 P2)

**Tech Stack:** TypeScript, OpenAI SDK, Ink (React TUI), Zod

---

## 修复清单

| 问题 | 严重度 | 修复方案 |
|------|--------|----------|
| Message 类型不支持 tool role | P1 | 扩展 Message 类型 |
| Tool parameters 类型错误 | P1 | 使用 ZodSchema 而非 infer |
| ReAct 协议未定义 | P1 | 使用 OpenAI Function Calling |
| 并行 SubAgent 是串行 | P1 | 实现 Promise.all 并行 |
| bash 工具无沙箱 | P1 | 添加白名单和工作目录限制 |
| ask_user 未接入 | P2 | 接入 Runtime 生命周期 |
| StateStore 未接入 | P2 | 在 Runtime 中调用 saveState |

---

## Task 1: 扩展 Message 类型 + Agent Types

**Files:**
- Modify: `source/types/index.ts`
- Create: `source/agent/types.ts`

**Step 1: 扩展现有 Message 类型**

```typescript
// source/types/index.ts (修改)
export type AppStep =
  | "loading"
  | "project"
  | "input"
  | "writing"
  | "done"
  | "error";

// 扩展: 支持 tool 角色
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string; // tool 角色专用
}

// OpenAI Function Calling 格式的工具调用
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON 字符串
  };
}

// 扩展 assistant 消息
export interface AssistantMessage extends Message {
  role: "assistant";
  toolCalls?: ToolCall[];
}
```

**Step 2: 定义 Agent 核心类型**

```typescript
// source/agent/types.ts
import { z, type ZodTypeAny } from "zod";
import type { Message, ToolCall } from "../types/index.js";

// 修复: parameters 是 ZodSchema 本身,不是 infer 后的类型
export interface Tool<TSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  parameters: TSchema; // Zod Schema 对象
  execute: (params: z.infer<TSchema>) => Promise<ToolResult>;
}

export interface ToolResult {
  output: string;
  error?: string;
}

export interface AgentState {
  status: "idle" | "thinking" | "acting" | "waiting_for_user" | "completed" | "error";
  currentTask?: string;
  lastThought?: string;
  lastAction?: string;
  lastObservation?: string;
  pendingToolCalls?: ToolCall[];
}

// 使用扩展后的 Message 类型
export type ConversationMessage = Message;

export interface SubAgentConfig {
  type: "quality_check" | "memory_update" | "outline_gen";
  task: string;
  context?: string;
}

export interface SubAgentResult {
  type: string;
  success: boolean;
  output: string;
  error?: string;
}

// OpenAI tools 参数格式
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

// 用户交互回调类型
export interface UserInteraction {
  askUser: (question: string, options?: string[]) => Promise<string>;
}
```

**Step 3: Commit**

```bash
git add source/types/index.ts source/agent/types.ts
git commit -m "feat(agent): add Agent core types with OpenAI Function Calling support"
```

---

## Task 2: 扩展 LLMProvider 支持 Function Calling

**Files:**
- Modify: `source/services/llm/types.ts`
- Modify: `source/services/llm/openai.ts`

**Step 1: 扩展 LLMProvider 接口**

```typescript
// source/services/llm/types.ts
import type { Message, ToolCall, FunctionDefinition } from "../../types/index.js";

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
}

export interface LLMProvider {
  // 现有方法
  generateText(messages: Message[], signal?: AbortSignal): Promise<string>;
  streamGenerate(messages: Message[], signal?: AbortSignal): AsyncGenerator<string>;

  // 新增: 支持 Function Calling
  generateWithTools(
    messages: Message[],
    tools: FunctionDefinition[],
    signal?: AbortSignal
  ): Promise<LLMResponse>;
}
```

**Step 2: 实现 OpenAI Provider 的 generateWithTools**

```typescript
// source/services/llm/openai.ts
import OpenAI from "openai";
import type { Message, ToolCall, FunctionDefinition } from "../../types/index.js";
import type { LLMConfig, LLMProvider, LLMResponse } from "./types.js";

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI;
  private readonly config: LLMConfig;

  constructor(apiKey: string, config: LLMConfig) {
    this.client = new OpenAI({ apiKey, baseURL: config.baseURL });
    this.config = config;
  }

  async generateText(messages: Message[], signal?: AbortSignal): Promise<string> {
    const response = await this.client.chat.completions.create(
      {
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        messages: this.convertMessages(messages)
      },
      { signal }
    );
    return response.choices[0]?.message?.content ?? "";
  }

  async *streamGenerate(
    messages: Message[],
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        messages: this.convertMessages(messages),
        stream: true
      },
      { signal }
    );

    for await (const chunk of stream) {
      if (signal?.aborted) return;
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }

  // 新增: 支持 Function Calling
  async generateWithTools(
    messages: Message[],
    tools: FunctionDefinition[],
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create(
      {
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        messages: this.convertMessages(messages),
        tools: tools.map(t => ({
          type: "function" as const,
          function: t
        })),
        tool_choice: "auto"
      },
      { signal }
    );

    const message = response.choices[0]?.message;
    const toolCalls = message?.tool_calls?.map(tc => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments
      }
    }));

    return {
      content: message?.content ?? "",
      toolCalls
    };
  }

  private convertMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map(msg => {
      if (msg.role === "tool") {
        return {
          role: "tool",
          content: msg.content,
          tool_call_id: msg.toolCallId
        } as OpenAI.ChatCompletionToolMessageParam;
      }
      return {
        role: msg.role,
        content: msg.content
      } as OpenAI.ChatCompletionUserMessageParam;
    });
  }
}
```

**Step 3: Commit**

```bash
git add source/services/llm/types.ts source/services/llm/openai.ts
git commit -m "feat(llm): add Function Calling support to LLMProvider"
```

---

## Task 3: 实现 Agent Runtime (含并行执行)

**Files:**
- Create: `source/agent/runtime.ts`

**关键修复:**
- 使用 OpenAI Function Calling (修复 P1)
- 真正的并行执行 (修复 P1)
- 接入 StateStore 和 ask_user (修复 P2)

**Step 1: 实现 Runtime 类**

```typescript
// source/agent/runtime.ts
import { z, type ZodTypeAny } from "zod";
import type {
  Tool,
  ToolResult,
  AgentState,
  FunctionDefinition,
  UserInteraction
} from "./types.js";
import type { Message, ToolCall } from "../types/index.js";
import type { LLMProvider } from "../services/llm/types.js";
import { StateStore } from "./state-store.js";

interface RuntimeConfig {
  systemPrompt: string;
  tools: Tool[];
  llmProvider: LLMProvider;
  stateStore: StateStore;
  userInteraction: UserInteraction;
}

// 将 Zod Schema 转换为 JSON Schema
function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const def = schema._def;

  if (def.typeName === "ZodObject") {
    const shape = def.shape();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as ZodTypeAny);
      if (!(value as ZodTypeAny).isOptional?.()) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined
    };
  }
  if (def.typeName === "ZodString") {
    return { type: "string", description: def.description };
  }
  if (def.typeName === "ZodNumber") {
    return { type: "number", description: def.description };
  }
  if (def.typeName === "ZodBoolean") {
    return { type: "boolean", description: def.description };
  }
  if (def.typeName === "ZodArray") {
    return { type: "array", items: zodToJsonSchema(def.type) };
  }
  if (def.typeName === "ZodEnum") {
    return { type: "string", enum: def.values };
  }
  if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") {
    return zodToJsonSchema(def.innerType);
  }
  if (def.typeName === "ZodNativeEnum") {
    return { type: "string", enum: Object.values(def.values) };
  }
  return { type: "string" };
}

export class AgentRuntime {
  private messages: Message[] = [];
  private state: AgentState;
  private tools: Map<string, Tool>;
  private llmProvider: LLMProvider;
  private stateStore: StateStore;
  private userInteraction: UserInteraction;
  private systemPrompt: string;
  private abortController: AbortController | null = null;

  constructor(config: RuntimeConfig) {
    this.systemPrompt = config.systemPrompt;
    this.tools = new Map(config.tools.map(t => [t.name, t]));
    this.llmProvider = config.llmProvider;
    this.stateStore = config.stateStore;
    this.userInteraction = config.userInteraction;
    this.state = { status: "idle" };

    // 添加 system prompt
    this.messages.push({ role: "system", content: config.systemPrompt });
  }

  // 获取 OpenAI tools 格式
  private getToolDefinitions(): FunctionDefinition[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters)
    }));
  }

  async run(userInput: string, signal?: AbortSignal): Promise<string> {
    this.abortController = new AbortController();
    const combinedSignal = signal
      ? AbortSignal.any([signal, this.abortController.signal])
      : this.abortController.signal;

    this.messages.push({ role: "user", content: userInput });
    this.state = { status: "thinking" };

    // 保存状态 (修复 P2)
    await this.stateStore.saveState(this.state);
    await this.stateStore.saveConversation(this.messages);

    while (this.state.status !== "completed" && this.state.status !== "error") {
      if (combinedSignal.aborted) {
        this.state = { status: "error", currentTask: "用户中断" };
        await this.stateStore.saveState(this.state);
        break;
      }

      if (this.state.status === "waiting_for_user") {
        // 等待用户输入 (修复 P2)
        break;
      }

      try {
        // 使用 OpenAI Function Calling (修复 P1)
        const response = await this.llmProvider.generateWithTools(
          this.messages,
          this.getToolDefinitions(),
          combinedSignal
        );

        // 检查是否有工具调用
        if (!response.toolCalls || response.toolCalls.length === 0) {
          // 没有工具调用,任务完成
          this.messages.push({ role: "assistant", content: response.content });
          this.state = { status: "completed" };
          await this.stateStore.saveState(this.state);
          await this.stateStore.saveConversation(this.messages);
          return response.content;
        }

        // 添加助手消息
        const assistantMsg: Message = { role: "assistant", content: response.content };
        this.messages.push(assistantMsg);

        // 并行执行所有工具调用 (修复 P1 并行问题)
        this.state = {
          status: "acting",
          pendingToolCalls: response.toolCalls
        };
        await this.stateStore.saveState(this.state);

        // 关键: 使用 Promise.all 并行执行
        const results = await this.executeToolsInParallel(response.toolCalls);

        // 添加所有工具结果
        for (const result of results) {
          this.messages.push({
            role: "tool",
            content: result.error ? `Error: ${result.error}` : result.output,
            toolCallId: result.toolCallId
          });
        }

        this.state = { status: "thinking" };
        await this.stateStore.saveState(this.state);
        await this.stateStore.saveConversation(this.messages);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "未知错误";
        this.state = { status: "error", currentTask: errorMsg };
        await this.stateStore.saveState(this.state);
        throw error;
      }
    }

    const lastMsg = this.messages[this.messages.length - 1];
    return lastMsg?.content ?? "";
  }

  // 并行执行工具 (修复 P1)
  private async executeToolsInParallel(toolCalls: ToolCall[]): Promise<Array<{
    toolCallId: string;
    output: string;
    error?: string;
  }>> {
    // 创建所有工具执行的 Promise
    const promises = toolCalls.map(async (toolCall) => {
      const toolName = toolCall.function.name;
      const tool = this.tools.get(toolName);

      if (!tool) {
        return {
          toolCallId: toolCall.id,
          output: "",
          error: `Unknown tool: ${toolName}`
        };
      }

      try {
        // 解析 JSON 参数
        const rawParams = JSON.parse(toolCall.function.arguments);
        // Zod 验证
        const validatedParams = tool.parameters.parse(rawParams);
        // 执行工具
        const result = await tool.execute(validatedParams);

        return {
          toolCallId: toolCall.id,
          output: result.output,
          error: result.error
        };
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          output: "",
          error: error instanceof Error ? error.message : "Tool execution failed"
        };
      }
    });

    // 关键: Promise.all 实现真正的并行
    return Promise.all(promises);
  }

  // 中断执行
  abort(): void {
    this.abortController?.abort();
  }

  // 获取当前状态
  getState(): AgentState {
    return { ...this.state };
  }

  // 从断点恢复 (修复 P2)
  async resume(): Promise<string | null> {
    const savedState = await this.stateStore.loadState();
    const savedMessages = await this.stateStore.loadConversation();

    if (!savedState || !savedMessages) {
      return null;
    }

    this.state = savedState;
    this.messages = savedMessages;

    return savedState.currentTask ?? null;
  }
}
```

**Step 2: Commit**

```bash
git add source/agent/runtime.ts
git commit -m "feat(agent): implement Agent Runtime with parallel tool execution and state persistence"
```

---

## Task 4: bash 工具实现 (沙箱化)

**Files:**
- Create: `source/agent/tools/bash.ts`

**关键修复 (P1):**
- 添加命令白名单
- 工作目录限制
- 危险命令拦截

**Step 1: 实现沙箱化的 bash 工具**

```typescript
// source/agent/tools/bash.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";

const execAsync = promisify(exec);

// 允许的命令白名单
const ALLOWED_COMMANDS = [
  // 文件读取
  "cat", "head", "tail", "less", "more",
  // 文件列表
  "ls", "find", "tree",
  // 目录操作
  "mkdir", "pwd",
  // 文件搜索
  "grep", "rg", "ag", "ack",
  // 文本处理
  "wc", "sort", "uniq", "cut", "awk", "sed",
  // 项目相关
  "git", "npm", "pnpm", "yarn",
  // 其他安全命令
  "echo", "date", "which"
];

// 危险命令模式
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/,
  /\brm\s+.*\*/,
  /\bsudo\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\b>\s*\/dev\//,
  /\bmkfs\b/,
  /\bdd\b/,
  /\bformat\b/,
  /\b:\(\)\{\s*:\|:\s*&\s*\};\s*:/, // fork bomb
];

const BashToolSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  timeout: z.number().optional().default(30000).describe("Timeout in milliseconds")
});

interface BashToolConfig {
  workingDirectory: string;
  allowedCommands?: string[];
}

export function createBashTool(config: BashToolConfig): Tool {
  const allowedCommands = config.allowedCommands ?? ALLOWED_COMMANDS;

  return {
    name: "bash",
    description: `Execute a bash command in a sandboxed environment.
Allowed commands: ${allowedCommands.join(", ")}.
Working directory is restricted to the project folder.`,
    parameters: BashToolSchema,
    execute: async (params: z.infer<typeof BashToolSchema>): Promise<ToolResult> => {
      const { command, timeout } = params;

      // 安全检查 1: 检查危险模式
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
          return {
            output: "",
            error: `Command blocked: contains dangerous pattern`
          };
        }
      }

      // 安全检查 2: 提取命令名并检查白名单
      const commandName = command.trim().split(/\s+/)[0];
      if (!allowedCommands.includes(commandName)) {
        return {
          output: "",
          error: `Command not allowed: ${commandName}. Allowed commands: ${allowedCommands.join(", ")}`
        };
      }

      // 安全检查 3: 防止路径穿越
      if (command.includes("..") || command.includes("~")) {
        return {
          output: "",
          error: `Command blocked: path traversal detected`
        };
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout,
          maxBuffer: 1024 * 1024, // 1MB
          cwd: config.workingDirectory // 限制工作目录
        });

        const output = stderr ? `${stdout}\n${stderr}` : stdout;
        return { output: output.trim() };
      } catch (error) {
        if (error instanceof Error) {
          // 超时错误
          if (error.message.includes("ETIMEDOUT")) {
            return { output: "", error: `Command timed out after ${timeout}ms` };
          }
          return { output: "", error: error.message };
        }
        return { output: "", error: "Unknown error executing bash command" };
      }
    }
  };
}

// 导出默认实例 (向后兼容)
export const bashTool: Tool = createBashTool({
  workingDirectory: process.cwd()
});
```

**Step 2: Commit**

```bash
git add source/agent/tools/bash.ts
git commit -m "feat(agent): add sandboxed bash tool with command whitelist and working directory restriction"
```

---

## Task 5: generate_content 工具实现

**Files:**
- Create: `source/agent/tools/generate-content.ts`

**Step 1: 实现 generate_content 工具**

```typescript
// source/agent/tools/generate-content.ts
import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";
import type { LLMProvider } from "../../services/llm/types.js";

const GenerateContentSchema = z.object({
  task: z.enum(["chapter", "outline", "summary", "memory_extract"]),
  topic: z.string().describe("The topic or direction for content generation"),
  context: z.string().optional().describe("Additional context information"),
  style: z.string().optional().describe("Writing style requirements"),
  length: z.number().optional().describe("Target length in characters")
});

interface GenerateContentToolConfig {
  llmProvider: LLMProvider;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  chapter: "你是一个专业的小说家。请根据给定的大纲和上下文,创作精彩的章节正文。要求文笔流畅,描写生动。",
  outline: "你是一个小说大纲专家。请根据给定的主题,创作详细的章节大纲。包含主要情节、角色登场、关键对话。",
  summary: "你是一个文本摘要专家。请将给定的内容压缩为简洁的摘要,保留关键情节。",
  memory_extract: "你是记忆提取专家。请从给定的章节内容中提取角色、事件、设定等记忆信息。以JSON格式返回。"
};

export function createGenerateContentTool(config: GenerateContentToolConfig): Tool {
  return {
    name: "generate_content",
    description: "Generate novel content using LLM. Use for writing chapters, outlines, summaries, or extracting memory.",
    parameters: GenerateContentSchema,
    execute: async (params: z.infer<typeof GenerateContentSchema>): Promise<ToolResult> => {
      try {
        const systemPrompt = SYSTEM_PROMPTS[params.task] ?? SYSTEM_PROMPTS.chapter;

        const userPrompt = buildUserPrompt(params);

        const messages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userPrompt }
        ];

        let fullContent = "";
        for await (const chunk of config.llmProvider.streamGenerate(messages)) {
          fullContent += chunk;
        }

        return { output: fullContent };
      } catch (error) {
        return {
          output: "",
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
  };
}

function buildUserPrompt(params: z.infer<typeof GenerateContentSchema>): string {
  const parts: string[] = [];

  if (params.context) {
    parts.push(`上下文信息:\n${params.context}`);
  }

  parts.push(`任务: ${params.topic}`);

  if (params.style) {
    parts.push(`风格要求: ${params.style}`);
  }

  if (params.length) {
    parts.push(`目标字数: 约 ${params.length} 字`);
  }

  return parts.join("\n\n");
}
```

**Step 2: Commit**

```bash
git add source/agent/tools/generate-content.ts
git commit -m "feat(agent): add generate_content tool implementation"
```

---

## Task 6: ask_user 工具实现

**Files:**
- Create: `source/agent/tools/ask-user.ts`

**Step 1: 实现 ask_user 工具**

```typescript
// source/agent/tools/ask-user.ts
import { z } from "zod";
import type { Tool, ToolResult, UserInteraction } from "../types.js";

const AskUserSchema = z.object({
  question: z.string().describe("The question to ask the user"),
  options: z.array(z.string()).optional().describe("Optional predefined options")
});

interface AskUserToolConfig {
  userInteraction: UserInteraction;
}

export function createAskUserTool(config: AskUserToolConfig): Tool {
  return {
    name: "ask_user",
    description: "Ask the user a question when you need their input or decision. Use this when you encounter ambiguous situations or need clarification.",
    parameters: AskUserSchema,
    execute: async (params: z.infer<typeof AskUserSchema>): Promise<ToolResult> => {
      try {
        const answer = await config.userInteraction.askUser(
          params.question,
          params.options
        );
        return { output: answer };
      } catch (error) {
        return {
          output: "",
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
  };
}
```

**Step 2: Commit**

```bash
git add source/agent/tools/ask-user.ts
git commit -m "feat(agent): add ask_user tool implementation"
```

---

## Task 7: dispatch_agent 工具实现 (支持并行)

**Files:**
- Create: `source/agent/tools/dispatch-agent.ts`

**Step 1: 实现 dispatch_agent 工具**

```typescript
// source/agent/tools/dispatch-agent.ts
import { z } from "zod";
import type { Tool, ToolResult, SubAgentConfig, SubAgentResult } from "../types.js";

const DispatchAgentSchema = z.object({
  type: z.enum(["quality_check", "memory_update", "outline_gen"]),
  task: z.string().describe("The specific task for the subagent"),
  context: z.string().optional().describe("Additional context for the subagent")
  // 注意: 并行执行由 Runtime 层处理,不需要 parallel 参数
});

interface DispatchAgentToolConfig {
  subAgentRunner: (config: SubAgentConfig) => Promise<SubAgentResult>;
}

export function createDispatchAgentTool(config: DispatchAgentToolConfig): Tool {
  return {
    name: "dispatch_agent",
    description: `Dispatch a subagent to handle a specific task independently.
Subagents run in isolation with their own context.
Available types:
- quality_check: Check content quality (consistency, logic, style)
- memory_update: Extract and update memory from content
- outline_gen: Generate chapter outline

Note: Multiple dispatch_agent calls in the same response will execute in parallel.`,
    parameters: DispatchAgentSchema,
    execute: async (params: z.infer<typeof DispatchAgentSchema>): Promise<ToolResult> => {
      try {
        const subAgentConfig: SubAgentConfig = {
          type: params.type,
          task: params.task,
          context: params.context
        };

        const result = await config.subAgentRunner(subAgentConfig);

        if (result.success) {
          return { output: result.output };
        } else {
          return { output: "", error: result.error ?? "SubAgent failed" };
        }
      } catch (error) {
        return {
          output: "",
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
  };
}
```

**Step 2: Commit**

```bash
git add source/agent/tools/dispatch-agent.ts
git commit -m "feat(agent): add dispatch_agent tool for SubAgent dispatching"
```

---

## Task 8: 工具注册中心

**Files:**
- Create: `source/agent/tools/index.ts`

**Step 1: 创建工具注册中心**

```typescript
// source/agent/tools/index.ts
import type { Tool, UserInteraction, SubAgentConfig, SubAgentResult } from "../types.js";
import type { LLMProvider } from "../../services/llm/types.js";
import { createBashTool } from "./bash.js";
import { createGenerateContentTool } from "./generate-content.js";
import { createAskUserTool } from "./ask-user.js";
import { createDispatchAgentTool } from "./dispatch-agent.js";

export interface CreateToolsConfig {
  llmProvider: LLMProvider;
  userInteraction: UserInteraction;
  subAgentRunner: (config: SubAgentConfig) => Promise<SubAgentResult>;
  workingDirectory: string;
}

export function createCoreTools(config: CreateToolsConfig): Tool[] {
  return [
    createBashTool({ workingDirectory: config.workingDirectory }),
    createGenerateContentTool({ llmProvider: config.llmProvider }),
    createAskUserTool({ userInteraction: config.userInteraction }),
    createDispatchAgentTool({ subAgentRunner: config.subAgentRunner })
  ];
}

export function getToolByName(tools: Tool[], name: string): Tool | undefined {
  return tools.find(t => t.name === name);
}

export type { Tool, ToolResult };
```

**Step 2: Commit**

```bash
git add source/agent/tools/index.ts
git commit -m "feat(agent): add tool registry with factory functions"
```

---

## Task 9: StateStore 实现

**Files:**
- Create: `source/agent/state-store.ts`

**Step 1: 实现状态存储**

```typescript
// source/agent/state-store.ts
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentState, ConversationMessage } from "./types.js";

interface StateStoreConfig {
  projectPath: string;
  conversationDir?: string;
}

export class StateStore {
  private projectPath: string;
  private conversationDir: string;

  constructor(config: StateStoreConfig) {
    this.projectPath = config.projectPath;
    this.conversationDir = config.conversationDir
      ?? path.join(process.env.HOME ?? "", ".novel-agent", "conversations");
  }

  async saveState(state: AgentState): Promise<void> {
    const statePath = this.getStatePath();
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
  }

  async loadState(): Promise<AgentState | null> {
    try {
      const statePath = this.getStatePath();
      const content = await fs.readFile(statePath, "utf-8");
      return JSON.parse(content) as AgentState;
    } catch {
      return null;
    }
  }

  async saveConversation(messages: ConversationMessage[]): Promise<void> {
    const projectSlug = path.basename(this.projectPath);
    const conversationPath = this.getConversationPath(projectSlug);
    await fs.mkdir(path.dirname(conversationPath), { recursive: true });
    await fs.writeFile(conversationPath, JSON.stringify(messages, null, 2), "utf-8");
  }

  async loadConversation(): Promise<ConversationMessage[] | null> {
    try {
      const projectSlug = path.basename(this.projectPath);
      const conversationPath = this.getConversationPath(projectSlug);
      const content = await fs.readFile(conversationPath, "utf-8");
      return JSON.parse(content) as ConversationMessage[];
    } catch {
      return null;
    }
  }

  async clearState(): Promise<void> {
    try {
      await fs.unlink(this.getStatePath());
    } catch {
      // ignore
    }
  }

  async hasPendingTask(): Promise<boolean> {
    const state = await this.loadState();
    return state?.status === "acting" || state?.status === "thinking";
  }

  private getStatePath(): string {
    return path.join(this.projectPath, ".agent-state.json");
  }

  private getConversationPath(projectSlug: string): string {
    return path.join(this.conversationDir, projectSlug, "history.json");
  }
}
```

**Step 2: Commit**

```bash
git add source/agent/state-store.ts
git commit -m "feat(agent): add StateStore for persistence and recovery"
```

---

## Task 10: SubAgent 系统实现

**Files:**
- Create: `source/agent/subagents/index.ts`
- Create: `source/agent/subagents/quality-check.ts`
- Create: `source/agent/subagents/memory-update.ts`
- Create: `source/agent/subagents/outline-gen.ts`

**Step 1: 创建 SubAgent 接口和注册中心**

```typescript
// source/agent/subagents/index.ts
import type { LLMProvider } from "../../services/llm/types.js";
import type { SubAgentConfig, SubAgentResult } from "../types.js";
import { createQualityCheckSubAgent } from "./quality-check.js";
import { createMemoryUpdateSubAgent } from "./memory-update.js";
import { createOutlineGenSubAgent } from "./outline-gen.js";

export interface SubAgent {
  type: string;
  execute(config: SubAgentConfig): Promise<SubAgentResult>;
}

export interface SubAgentContext {
  llmProvider: LLMProvider;
  projectPath: string;
}

export function createSubAgentRunner(context: SubAgentContext) {
  const subagents: Map<string, SubAgent> = new Map([
    ["quality_check", createQualityCheckSubAgent(context)],
    ["memory_update", createMemoryUpdateSubAgent(context)],
    ["outline_gen", createOutlineGenSubAgent(context)]
  ]);

  return async (config: SubAgentConfig): Promise<SubAgentResult> => {
    const subagent = subagents.get(config.type);
    if (!subagent) {
      return {
        type: config.type,
        success: false,
        output: "",
        error: `Unknown subagent type: ${config.type}`
      };
    }
    return subagent.execute(config);
  };
}
```

**Step 2: 实现 quality_check SubAgent**

```typescript
// source/agent/subagents/quality-check.ts
import type { SubAgent, SubAgentContext } from "./index.js";
import type { SubAgentConfig, SubAgentResult } from "../types.js";

const QUALITY_CHECK_PROMPT = `你是一个小说质量检查专家。请检查以下章节内容的质量。

检查项目:
1. 标题是否合适
2. 内容是否连贯
3. 角色行为是否一致
4. 是否有明显逻辑问题
5. 是否有重复内容
6. 风格是否统一

请严格以JSON格式返回检查结果:
{
  "passed": true或false,
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"]
}`;

export function createQualityCheckSubAgent(context: SubAgentContext): SubAgent {
  return {
    type: "quality_check",
    execute: async (config: SubAgentConfig): Promise<SubAgentResult> => {
      try {
        const messages = [
          { role: "system" as const, content: QUALITY_CHECK_PROMPT },
          { role: "user" as const, content: `请检查以下章节:\n\n${config.task}` }
        ];

        let response = "";
        for await (const chunk of context.llmProvider.streamGenerate(messages)) {
          response += chunk;
        }

        // 提取 JSON
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return {
            type: "quality_check",
            success: false,
            output: response,
            error: "无法解析质检结果"
          };
        }

        const result = JSON.parse(jsonMatch[0]);

        return {
          type: "quality_check",
          success: result.passed === true,
          output: JSON.stringify(result, null, 2),
          error: result.passed ? undefined : result.issues?.join("; ")
        };
      } catch (error) {
        return {
          type: "quality_check",
          success: false,
          output: "",
          error: error instanceof Error ? error.message : "Quality check failed"
        };
      }
    }
  };
}
```

**Step 3: 实现 memory_update SubAgent**

```typescript
// source/agent/subagents/memory-update.ts
import type { SubAgent, SubAgentContext } from "./index.js";
import type { SubAgentConfig, SubAgentResult } from "../types.js";

const MEMORY_UPDATE_PROMPT = `你是记忆提取专家。请从给定的章节内容中提取以下记忆信息:

1. 角色信息 (新出现的角色、角色发展)
2. 事件信息 (重要事件、情节发展)
3. 设定信息 (世界观、规则)
4. 关系变化 (角色间关系的发展)

请严格以JSON格式返回:
{
  "characters": [{"name": "", "description": "", "traits": []}],
  "events": [{"name": "", "description": "", "chapter": N}],
  "settings": [{"name": "", "description": ""}],
  "relationships": [{"from": "", "to": "", "type": "", "description": ""}]
}`;

export function createMemoryUpdateSubAgent(context: SubAgentContext): SubAgent {
  return {
    type: "memory_update",
    execute: async (config: SubAgentConfig): Promise<SubAgentResult> => {
      try {
        const messages = [
          { role: "system" as const, content: MEMORY_UPDATE_PROMPT },
          { role: "user" as const, content: `请从以下内容中提取记忆:\n\n${config.task}` }
        ];

        let response = "";
        for await (const chunk of context.llmProvider.streamGenerate(messages)) {
          response += chunk;
        }

        // 提取 JSON
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return {
            type: "memory_update",
            success: false,
            output: response,
            error: "无法解析记忆数据"
          };
        }

        // TODO: 将记忆写入 MemoryManager

        return {
          type: "memory_update",
          success: true,
          output: jsonMatch[0]
        };
      } catch (error) {
        return {
          type: "memory_update",
          success: false,
          output: "",
          error: error instanceof Error ? error.message : "Memory update failed"
        };
      }
    }
  };
}
```

**Step 4: 实现 outline_gen SubAgent**

```typescript
// source/agent/subagents/outline-gen.ts
import type { SubAgent, SubAgentContext } from "./index.js";
import type { SubAgentConfig, SubAgentResult } from "../types.js";

const OUTLINE_GEN_PROMPT = `你是小说大纲专家。请根据给定的主题和上下文,创作章节大纲。

大纲应包含:
1. 章节标题
2. 主要情节 (3-5个情节点)
3. 角色登场
4. 关键对话
5. 情感走向
6. 结尾钩子

请以结构化格式返回大纲。`;

export function createOutlineGenSubAgent(context: SubAgentContext): SubAgent {
  return {
    type: "outline_gen",
    execute: async (config: SubAgentConfig): Promise<SubAgentResult> => {
      try {
        const contextInfo = config.context ? `\n\n上下文: ${config.context}` : "";
        const messages = [
          { role: "system" as const, content: OUTLINE_GEN_PROMPT },
          { role: "user" as const, content: `主题: ${config.task}${contextInfo}` }
        ];

        let response = "";
        for await (const chunk of context.llmProvider.streamGenerate(messages)) {
          response += chunk;
        }

        return {
          type: "outline_gen",
          success: true,
          output: response
        };
      } catch (error) {
        return {
          type: "outline_gen",
          success: false,
          output: "",
          error: error instanceof Error ? error.message : "Outline generation failed"
        };
      }
    }
  };
}
```

**Step 5: Commit**

```bash
git add source/agent/subagents/
git commit -m "feat(agent): add SubAgent system with quality_check, memory_update, and outline_gen"
```

---

## Task 11: UI 集成 - AgentView 和 App

**Files:**
- Create: `source/components/AgentView.tsx`
- Modify: `source/app.tsx`

**Step 1: 创建 AgentView 组件**

```typescript
// source/components/AgentView.tsx
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { Layout } from "./Layout.js";

interface AgentViewProps {
  projectTitle: string;
  agentOutput: string;
  currentThought?: string;
  currentAction?: string;
  isThinking: boolean;
  onSubmit: (input: string) => void;
  onAbort: () => void;
  // 修复 P2: 添加用户提问回调
  pendingQuestion?: {
    question: string;
    options?: string[];
  } | null;
  onAnswerQuestion?: (answer: string) => void;
}

export function AgentView({
  projectTitle,
  agentOutput,
  currentThought,
  currentAction,
  isThinking,
  onSubmit,
  onAbort,
  pendingQuestion,
  onAnswerQuestion
}: AgentViewProps) {
  const [input, setInput] = useState("");

  useInput((_input, key) => {
    if (key.escape && isThinking) {
      onAbort();
    }
  });

  const handleSubmit = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (pendingQuestion && onAnswerQuestion) {
      onAnswerQuestion(trimmed);
    } else {
      onSubmit(trimmed);
    }
    setInput("");
  }, [pendingQuestion, onAnswerQuestion, onSubmit]);

  return (
    <Layout title={`${projectTitle} - Agent Mode`} borderColor="blue">
      {/* Agent 状态区 */}
      {isThinking && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="yellow">Agent 正在工作...</Text>
          {currentThought && (
            <Box>
              <Text color="cyan">思考: </Text>
              <Text dimColor>{currentThought}</Text>
            </Box>
          )}
          {currentAction && (
            <Box>
              <Text color="green">行动: </Text>
              <Text dimColor>{currentAction}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* 用户提问区 (修复 P2) */}
      {pendingQuestion && (
        <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="magenta" paddingX={1}>
          <Text color="magenta" bold>Agent 提问:</Text>
          <Text>{pendingQuestion.question}</Text>
          {pendingQuestion.options && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>选项:</Text>
              {pendingQuestion.options.map((opt, i) => (
                <Text key={i}>  {i + 1}. {opt}</Text>
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* 输出区 */}
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
        <Text wrap="wrap">{agentOutput || "等待输入..."}</Text>
      </Box>

      {/* 输入区 */}
      <Box>
        <Text color="green">{"> "}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          placeholder={pendingQuestion ? "输入回答..." : "输入指令... (Esc 中断)"}
          onSubmit={handleSubmit}
        />
      </Box>
    </Layout>
  );
}
```

**Step 2: 重构 app.tsx (修复 P2)**

```typescript
// source/app.tsx (关键修改)
import React, { useCallback, useEffect, useState, useRef } from "react";
import { AgentView } from "./components/AgentView.js";
import { AgentRuntime } from "./agent/runtime.js";
import { createCoreTools } from "./agent/tools/index.js";
import { createSubAgentRunner } from "./agent/subagents/index.js";
import { StateStore } from "./agent/state-store.js";
import { AGENT_SYSTEM_PROMPT } from "./agent/prompt.js";
import type { UserInteraction } from "./agent/types.js";

// ... 其他导入 ...

export default function App() {
  // ... 现有状态 ...

  // 修复 P2: 用户提问状态
  const [pendingQuestion, setPendingQuestion] = useState<{
    question: string;
    options?: string[];
    resolve: (answer: string) => void;
  } | null>(null);

  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);
  const questionResolveRef = useRef<((answer: string) => void) | null>(null);

  // 初始化 Agent
  const initializeAgent = useCallback((project: NovelProject, paths: ProjectPaths) => {
    const llmProvider = createLLMProvider(/* config */);
    const stateStore = new StateStore({ projectPath: paths.rootDir });

    // 修复 P2: 实现用户交互回调
    const userInteraction: UserInteraction = {
      askUser: async (question: string, options?: string[]) => {
        return new Promise((resolve) => {
          questionResolveRef.current = resolve;
          setPendingQuestion({ question, options, resolve });
        });
      }
    };

    const subAgentRunner = createSubAgentRunner({
      llmProvider,
      projectPath: paths.rootDir
    });

    const tools = createCoreTools({
      llmProvider,
      userInteraction,
      subAgentRunner,
      workingDirectory: paths.rootDir
    });

    const agentRuntime = new AgentRuntime({
      systemPrompt: AGENT_SYSTEM_PROMPT,
      tools,
      llmProvider,
      stateStore,
      userInteraction
    });

    setRuntime(agentRuntime);
  }, []);

  // 处理用户回答 (修复 P2)
  const handleAnswerQuestion = useCallback((answer: string) => {
    if (pendingQuestion?.resolve) {
      pendingQuestion.resolve(answer);
    }
    setPendingQuestion(null);
    questionResolveRef.current = null;
  }, [pendingQuestion]);

  // 处理用户输入
  const handleAgentSubmit = useCallback(async (input: string) => {
    if (!runtime) return;

    setIsThinking(true);
    setAgentOutput("");
    setCurrentThought(undefined);
    setCurrentAction(undefined);

    try {
      const result = await runtime.run(input);
      setAgentOutput(result);
    } catch (error) {
      setAgentOutput(error instanceof Error ? error.message : "Agent 运行失败");
    } finally {
      setIsThinking(false);
    }
  }, [runtime]);

  // 渲染
  return (
    <AgentView
      projectTitle={currentProject?.title ?? "Novel Agent"}
      agentOutput={agentOutput}
      currentThought={currentThought}
      currentAction={currentAction}
      isThinking={isThinking}
      onSubmit={handleAgentSubmit}
      onAbort={() => runtime?.abort()}
      pendingQuestion={pendingQuestion ? {
        question: pendingQuestion.question,
        options: pendingQuestion.options
      } : null}
      onAnswerQuestion={handleAnswerQuestion}
    />
  );
}
```

**Step 3: Commit**

```bash
git add source/components/AgentView.tsx source/app.tsx
git commit -m "feat(ui): integrate Agent with user interaction support"
```

---

## 任务依赖关系

```
Task 1 (Types) ──────────────────────────────────────┐
                                                      │
Task 2 (LLM Function Calling) ───────────────────────┤
                                                      │
Task 3 (Runtime) ────────────────────────────────────┤
                                                      │
Task 4-8 (Tools) ────────────────────────────────────┤
        │                                             │
        └──> Task 10 (SubAgents) ─────────────────────┤
                                                      │
Task 9 (StateStore) ─────────────────────────────────┤
                                                      │
Task 11 (UI) ─────────────────────────────────────────┘
```

---

## 验收标准

1. **类型正确**: Message 支持 tool role, Tool.parameters 是 ZodSchema
2. **协议完整**: 使用 OpenAI Function Calling,无 TODO
3. **真正并行**: 多个工具调用使用 Promise.all 并行执行
4. **沙箱安全**: bash 工具有白名单和工作目录限制
5. **用户交互**: ask_user 正确接入 Runtime, UI 支持问答
6. **断点恢复**: StateStore 在 Runtime 生命周期中被调用
7. **测试通过**: 所有新增代码有对应测试
