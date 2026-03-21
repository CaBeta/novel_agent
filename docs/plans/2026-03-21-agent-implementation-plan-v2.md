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

// OpenAI tools 参数格式 (统一定义在 types/index.ts)
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}
```

**Step 2: 定义 Agent 核心类型**

```typescript
// source/agent/types.ts
import { z, type ZodTypeAny } from "zod";
import type { Message, ToolCall, FunctionDefinition } from "../types/index.js";

// 修复: parameters 是 ZodSchema 本身,不是 infer 后的类型
export interface Tool<TSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  parameters: TSchema; // Zod Schema 对象
  execute: (params: z.infer<TSchema>) => Promise<ToolResult>;
}

export type ToolResult =
  | {
      kind: "completed";
      output: string;
      error?: string;
    }
  | {
      kind: "await_user";
      stateUpdate: Pick<AgentState, "status" | "pendingQuestion">;
    };

export interface AgentState {
  status: "idle" | "thinking" | "acting" | "waiting_for_user" | "completed" | "error";
  currentTask?: string;
  lastThought?: string;
  lastAction?: string;
  lastObservation?: string;
  pendingToolCalls?: ToolCall[];
  // 修复 P2: 持久化用户提问状态
  pendingQuestion?: {
    question: string;
    options?: string[];
  };
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

  // 修复 P9: 完整转换消息,包括 assistant 的 tool_calls
  private convertMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map(msg => {
      // tool 角色消息
      if (msg.role === "tool") {
        return {
          role: "tool",
          content: msg.content,
          tool_call_id: msg.toolCallId
        } as OpenAI.ChatCompletionToolMessageParam;
      }

      // assistant 消息,可能包含 tool_calls
      if (msg.role === "assistant") {
        const assistantMsg = msg as Message & { toolCalls?: ToolCall[] };
        if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
          return {
            role: "assistant",
            content: msg.content,
            tool_calls: assistantMsg.toolCalls.map(tc => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments
              }
            }))
          } as OpenAI.ChatCompletionAssistantMessageParam;
        }
        return {
          role: "assistant",
          content: msg.content
        } as OpenAI.ChatCompletionAssistantMessageParam;
      }

      // 其他角色 (system, user)
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
  AgentState,
  FunctionDefinition
} from "./types.js";
import type { Message, ToolCall } from "../types/index.js";
import type { LLMProvider } from "../services/llm/types.js";
import { StateStore } from "./state-store.js";

interface RuntimeConfig {
  systemPrompt: string;
  tools: Tool[];
  llmProvider: LLMProvider;
  stateStore: StateStore;
  onStateChange?: (state: AgentState) => void;
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
  private onStateChange?: (state: AgentState) => void;
  private systemPrompt: string;
  private abortController: AbortController | null = null;

  constructor(config: RuntimeConfig) {
    this.systemPrompt = config.systemPrompt;
    this.tools = new Map(config.tools.map(t => [t.name, t]));
    this.llmProvider = config.llmProvider;
    this.stateStore = config.stateStore;
    this.onStateChange = config.onStateChange;
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

    // 调用内部循环方法
    return this.runLoop(combinedSignal);
  }

  // 修复 P1: 抽取主循环为独立方法,支持 continueWithAnswer 复用
  private async runLoop(signal: AbortSignal): Promise<string> {
    while (this.state.status !== "completed" && this.state.status !== "error") {
      if (signal.aborted) {
        this.state = { status: "error", currentTask: "用户中断" };
        await this.stateStore.saveState(this.state);
        break;
      }

      // 如果在等待用户,保存状态并退出循环
      if (this.state.status === "waiting_for_user") {
        await this.stateStore.saveState(this.state);
        await this.stateStore.saveConversation(this.messages);
        break;
      }

      try {
        // 使用 OpenAI Function Calling (修复 P1)
        const response = await this.llmProvider.generateWithTools(
          this.messages,
          this.getToolDefinitions(),
          signal
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

        // 修复 P2: 保存完整的 assistant 消息,包含 toolCalls
        const assistantMsg: Message = {
          role: "assistant",
          content: response.content ?? "",
          toolCalls: response.toolCalls  // 关键: 必须保存 toolCalls
        } as Message;
        this.messages.push(assistantMsg);

        // 并行执行所有工具调用 (修复 P1 并行问题)
        // 修复 P1: 保存 pendingToolCalls 以便断点恢复时能接回正确的工具调用
        this.state = {
          status: "acting",
          pendingToolCalls: response.toolCalls
        };
        await this.stateStore.saveState(this.state);
        await this.stateStore.saveConversation(this.messages);

        // 修复 P1: 并行执行工具,每个完成后立即保存结果 (支持 ask_user 中断恢复)
        // ask_user 不再阻塞等待用户回答,而是返回 await_user 结果给 Runtime
        const askUserCall = response.toolCalls.find(tc => tc.function.name === "ask_user");
        const pendingResults: Map<string, {
          toolCallId: string;
        } & (
          | { kind: "completed"; output: string; error?: string }
          | { kind: "await_user"; stateUpdate: Pick<AgentState, "status" | "pendingQuestion"> }
        )> = new Map();

        // 创建所有工具执行的 Promise,每个完成后立即保存结果
        const toolPromises = response.toolCalls.map(async (toolCall) => {
          const result = await this.executeToolCall(toolCall);
          pendingResults.set(toolCall.id, result);

          // 非等待型工具完成后立即保存结果到消息历史
          // 这样即使随后进入 waiting_for_user,已完成的工具结果也不会丢失
          if (result.kind === "completed") {
            this.messages.push({
              role: "tool",
              content: result.error ? `Error: ${result.error}` : result.output,
              toolCallId: result.toolCallId
            });
            // 立即持久化,确保断点恢复时其他工具结果不丢失
            await this.stateStore.saveConversation(this.messages);
          }

          return result;
        });

        await Promise.all(toolPromises);

        // ask_user 会返回 waiting 信号,Runtime 在这里停止主循环并等待 continueWithAnswer 接回
        const askUserResult = askUserCall
          ? pendingResults.get(askUserCall.id)
          : undefined;
        if (askUserCall && askUserResult?.kind === "await_user") {
          this.state = {
            ...this.state,
            ...askUserResult.stateUpdate,
            pendingToolCalls: [askUserCall]
          };
          await this.stateStore.saveState(this.state);
          await this.stateStore.saveConversation(this.messages);
          this.onStateChange?.(this.state);
          break;
        }

        // 添加 ask_user 的普通结果 (其他工具结果已在执行时添加)
        if (askUserCall && askUserResult?.kind === "completed") {
            this.messages.push({
              role: "tool",
              content: askUserResult.error ? `Error: ${askUserResult.error}` : askUserResult.output,
              toolCallId: askUserResult.toolCallId
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

  // 执行单个工具调用 (抽取为独立方法)
  private async executeToolCall(toolCall: ToolCall): Promise<{
    toolCallId: string;
  } & (
    | { kind: "completed"; output: string; error?: string }
    | { kind: "await_user"; stateUpdate: Pick<AgentState, "status" | "pendingQuestion"> }
  )> {
    const toolName = toolCall.function.name;
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        toolCallId: toolCall.id,
        kind: "completed",
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
        ...result
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        kind: "completed",
        output: "",
        error: error instanceof Error ? error.message : "Tool execution failed"
      };
    }
  }

  // 并行执行工具 (保留用于其他场景)
  private async executeToolsInParallel(toolCalls: ToolCall[]): Promise<Array<{
    toolCallId: string;
  } & (
    | { kind: "completed"; output: string; error?: string }
    | { kind: "await_user"; stateUpdate: Pick<AgentState, "status" | "pendingQuestion"> }
  )>> {
    // 创建所有工具执行的 Promise
    const promises = toolCalls.map(async (toolCall) => {
      const toolName = toolCall.function.name;
      const tool = this.tools.get(toolName);

      if (!tool) {
        return {
          toolCallId: toolCall.id,
          kind: "completed",
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
          ...result
        };
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          kind: "completed",
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
  async resume(): Promise<AgentState | null> {
    const savedState = await this.stateStore.loadState();
    const savedMessages = await this.stateStore.loadConversation();

    if (!savedState || !savedMessages) {
      return null;
    }

    this.state = savedState;
    this.messages = savedMessages;

    // 返回完整状态,支持 UI 恢复 pendingQuestion
    return savedState;
  }

  // 修复 P1: 继续等待中的问答,接回原工具调用
  async continueWithAnswer(userAnswer: string, signal?: AbortSignal): Promise<string> {
    // 验证当前状态
    if (this.state.status !== "waiting_for_user") {
      throw new Error("Cannot continue: not waiting for user input");
    }

    // 获取待恢复的 ask_user 工具调用
    const pendingCall = this.state.pendingToolCalls?.find(
      tc => tc.function.name === "ask_user"
    );
    if (!pendingCall) {
      throw new Error("Cannot continue: no pending ask_user tool call found");
    }

    // 创建 abort controller (如果不存在)
    if (!this.abortController) {
      this.abortController = new AbortController();
    }
    const combinedSignal = signal
      ? AbortSignal.any([signal, this.abortController.signal])
      : this.abortController.signal;

    // 创建工具结果消息,接回原工具调用
    this.messages.push({
      role: "tool",
      content: userAnswer,
      toolCallId: pendingCall.id
    } as Message);

    // 恢复运行状态
    this.state = { status: "thinking", pendingQuestion: undefined, pendingToolCalls: undefined };
    await this.stateStore.saveState(this.state);
    await this.stateStore.saveConversation(this.messages);

    // 继续主循环
    return this.runLoop(combinedSignal);
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

// 允许的命令白名单 (修复 P4 - 移除高风险命令)
const ALLOWED_COMMANDS = [
  // 文件读取 (只读)
  "cat", "head", "tail", "less", "more",
  // 文件列表 (只读)
  "ls", "find", "tree",
  // 目录操作 (安全)
  "pwd",
  // 文件搜索 (只读)
  "grep", "rg", "ag", "ack",
  // 文本处理 (只读)
  "wc", "sort", "uniq", "cut",
  // 其他安全命令
  "echo", "date", "which"
];

// 扩展白名单 (需要显式启用,默认禁用)
const EXTENDED_COMMANDS = {
  // 写入操作 - 需要显式启用
  mkdir: "mkdir",
  sed: "sed",
  awk: "awk",
  // 项目工具 - 可能有危险操作,需要额外检查
  git: "git",
  npm: "npm",
  pnpm: "pnpm"
};

// 危险命令模式 (修复 P4 - 扩展危险模式)
const DANGEROUS_PATTERNS = [
  // 文件删除
  /\brm\s+/,
  /\brmdir\b/,
  // 权限修改
  /\bsudo\b/,
  /\bchmod\b/,
  /\bchown\b/,
  // 设备操作
  /\b>\s*\/dev\//,
  /\bmkfs\b/,
  /\bdd\b/,
  /\bformat\b/,
  // 网络操作
  /\bcurl\b.*\|\s*(ba)?sh\b/,
  /\bwget\b.*\|\s*(ba)?sh\b/,
  // Fork bomb
  /\b:\(\)\{\s*:\|:\s*&\s*\};\s*:/,
  // Git 危险操作
  /\bgit\s+(push\s+)?--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[fd]/,
  /\bgit\s+checkout\s+--\s*\./,
  // NPM 危险操作
  /\bnpm\s+run\s+\w+/,
  /\bpnpm\s+run\s+\w+/,
  // 环境变量泄露
  /\benv\b/,
  /\bprintenv\b/,
  /\bexport\b.*\b(PATH|HOME|USER|PASSWORD|KEY|SECRET|TOKEN)\b/i,
  // 脚本执行
  /\beval\b/,
  /\bexec\b/,
  /\bsource\b.*\.\//,
];

const BashToolSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  timeout: z.number().optional().default(30000).describe("Timeout in milliseconds")
});

interface BashToolConfig {
  workingDirectory: string;
  allowedCommands?: string[];
  // 修复 P4: 显式启用扩展命令
  enableExtendedCommands?: {
    mkdir?: boolean;
    sed?: boolean;
    awk?: boolean;
    git?: boolean;    // 仍会进行危险操作检查
    npm?: boolean;    // 仍会进行危险操作检查
    pnpm?: boolean;   // 仍会进行危险操作检查
  };
}

export function createBashTool(config: BashToolConfig): Tool {
  // 基础白名单
  let allowedCommands = [...ALLOWED_COMMANDS];

  // 添加启用的扩展命令
  if (config.enableExtendedCommands) {
    const { enableExtendedCommands: ext } = config;
    if (ext.mkdir) allowedCommands.push("mkdir");
    if (ext.sed) allowedCommands.push("sed");
    if (ext.awk) allowedCommands.push("awk");
    if (ext.git) allowedCommands.push("git");
    if (ext.npm) allowedCommands.push("npm");
    if (ext.pnpm) allowedCommands.push("pnpm");
  }

  // 允许用户自定义覆盖
  if (config.allowedCommands) {
    allowedCommands = config.allowedCommands;
  }

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
            kind: "completed",
            output: "",
            error: `Command blocked: contains dangerous pattern`
          };
        }
      }

      // 安全检查 2: 提取命令名并检查白名单
      const commandName = command.trim().split(/\s+/)[0];
      if (!allowedCommands.includes(commandName)) {
        return {
          kind: "completed",
          output: "",
          error: `Command not allowed: ${commandName}. Allowed commands: ${allowedCommands.join(", ")}`
        };
      }

      // 安全检查 3: 防止路径穿越
      if (command.includes("..") || command.includes("~")) {
        return {
          kind: "completed",
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
        return { kind: "completed", output: output.trim() };
      } catch (error) {
        if (error instanceof Error) {
          // 超时错误
          if (error.message.includes("ETIMEDOUT")) {
            return { kind: "completed", output: "", error: `Command timed out after ${timeout}ms` };
          }
          return { kind: "completed", output: "", error: error.message };
        }
        return { kind: "completed", output: "", error: "Unknown error executing bash command" };
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

        return { kind: "completed", output: fullContent };
      } catch (error) {
        return {
          kind: "completed",
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
import type { Tool, ToolResult, AgentState } from "../types.js";
import type { StateStore } from "../state-store.js";

const AskUserSchema = z.object({
  question: z.string().describe("The question to ask the user"),
  options: z.array(z.string()).optional().describe("Optional predefined options")
});

// 修复 P5: ask_user 改为返回 waiting 信号,由 Runtime 统一暂停主循环
interface AskUserToolConfig {
  stateStore: StateStore;
  getState: () => AgentState;
}

export function createAskUserTool(config: AskUserToolConfig): Tool {
  return {
    name: "ask_user",
    description: "Ask the user a question when you need their input or decision. Use this when you encounter ambiguous situations or need clarification.",
    parameters: AskUserSchema,
    execute: async (params: z.infer<typeof AskUserSchema>): Promise<ToolResult> => {
      try {
        // 保留 Runtime 先前写入的 pendingToolCalls,避免恢复时丢失 ask_user 原始调用
        const waitingState: AgentState = {
          ...config.getState(),
          status: "waiting_for_user",
          pendingQuestion: {
            question: params.question,
            options: params.options
          }
        };

        // 持久化等待状态 (支持断点恢复)
        await config.stateStore.saveState(waitingState);

        // 立即返回 waiting 信号,由 Runtime 停止主循环并等待 continueWithAnswer 接回
        return {
          kind: "await_user",
          stateUpdate: {
            status: "waiting_for_user",
            pendingQuestion: waitingState.pendingQuestion
          }
        };
      } catch (error) {
        return {
          kind: "completed",
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
          return { kind: "completed", output: result.output };
        } else {
          return { kind: "completed", output: "", error: result.error ?? "SubAgent failed" };
        }
      } catch (error) {
        return {
          kind: "completed",
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
import type { Tool, SubAgentConfig, SubAgentResult, AgentState } from "../types.js";
import type { LLMProvider } from "../../services/llm/types.js";
import type { StateStore } from "../state-store.js";
import { createBashTool } from "./bash.js";
import { createGenerateContentTool } from "./generate-content.js";
import { createAskUserTool } from "./ask-user.js";
import { createDispatchAgentTool } from "./dispatch-agent.js";

export interface CreateToolsConfig {
  llmProvider: LLMProvider;
  subAgentRunner: (config: SubAgentConfig) => Promise<SubAgentResult>;
  workingDirectory: string;
  // 修复 P7: ask_user 需要的额外参数
  stateStore: StateStore;
  getState: () => AgentState;
}

export function createCoreTools(config: CreateToolsConfig): Tool[] {
  return [
    createBashTool({ workingDirectory: config.workingDirectory }),
    createGenerateContentTool({ llmProvider: config.llmProvider }),
    // 修复 P7: 传入完整参数
    createAskUserTool({
      stateStore: config.stateStore,
      getState: config.getState
    }),
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
import type { ProjectPaths } from "../../types/project.js";
import { resolveProjectPaths } from "../../services/project/project-paths.js";
import { createQualityCheckSubAgent } from "./quality-check.js";
import { createMemoryUpdateSubAgent } from "./memory-update.js";
import { createOutlineGenSubAgent } from "./outline-gen.js";

export interface SubAgent {
  type: string;
  execute(config: SubAgentConfig): Promise<SubAgentResult>;
}

// 修复 P8: 明确区分工作区根目录和项目路径
export interface SubAgentContext {
  llmProvider: LLMProvider;
  // 工作区根目录 (包含多个项目的目录)
  workspaceRoot: string;
  // 当前项目 slug
  projectSlug: string;
}

// 工具函数: 从 SubAgentContext 获取 ProjectPaths
export function getProjectPaths(context: SubAgentContext): ProjectPaths {
  return resolveProjectPaths(context.workspaceRoot, context.projectSlug);
}

// 修复 P1: 添加 createSubAgentRunner 函数声明
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

**Step 3: 实现 memory_update SubAgent (修复 P3 - 真正接入 MemoryManager)**

```typescript
// source/agent/subagents/memory-update.ts
import type { SubAgent, SubAgentContext, SubAgentConfig, SubAgentResult } from "./index.js";
import { getProjectPaths } from "./index.js";
import { MemoryManager } from "../../services/memory/memory-manager.js";
import type { CharacterMemory, TimelineEvent } from "../../types/memory.js";

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
        // 1. 使用 LLM 提取记忆
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

        // 修复 P3: 真正接入 MemoryManager
        const extractedData = JSON.parse(jsonMatch[0]);

        // 修复 P8: 使用正确的路径获取方式
        const projectPaths = getProjectPaths(context);
        const memoryManager = new MemoryManager(projectPaths);

        // 加载现有记忆
        const existingMemory = await memoryManager.load();

        // 合并新角色
        if (extractedData.characters?.length > 0) {
          const newCharacters: CharacterMemory[] = extractedData.characters.map((c: any) => ({
            id: `character-${c.name.toLowerCase().replace(/\s+/g, "-")}`,
            name: c.name,
            description: c.description ?? "",
            traits: c.traits ?? [],
            goals: [],
            secrets: [],
            currentStatus: c.description ?? "",
            aliases: [],
            latestSummary: "",
            lastSeenChapter: null,
            recentEvents: [],
            sourceChapterIndices: []
          }));

          // 去重合并
          for (const newChar of newCharacters) {
            const existingIndex = existingMemory.characters.findIndex(
              c => c.name.toLowerCase() === newChar.name.toLowerCase()
            );
            if (existingIndex >= 0) {
              // 更新现有角色
              existingMemory.characters[existingIndex] = {
                ...existingMemory.characters[existingIndex],
                ...newChar,
                traits: [...new Set([...existingMemory.characters[existingIndex].traits, ...newChar.traits])]
              };
            } else {
              existingMemory.characters.push(newChar);
            }
          }
        }

        // 合并新事件到时间线
        if (extractedData.events?.length > 0) {
          const newEvents: TimelineEvent[] = extractedData.events.map((e: any, i: number) => ({
            id: `event-${Date.now()}-${i}`,
            chapterIndex: e.chapter ?? 0,
            title: e.name,
            summary: e.description,
            participants: [],
            consequences: [],
            keywords: [e.name],
            occurredAt: new Date().toISOString()
          }));
          existingMemory.timeline.push(...newEvents);
        }

        // 写入更新后的记忆
        await memoryManager.writeAll(existingMemory);

        return {
          type: "memory_update",
          success: true,
          output: JSON.stringify({
            charactersAdded: extractedData.characters?.length ?? 0,
            eventsAdded: extractedData.events?.length ?? 0,
            totalCharacters: existingMemory.characters.length,
            totalEvents: existingMemory.timeline.length
          })
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
        // 修复 P2: 使用 Layout 支持的颜色 (blue/yellow/green/red/gray)
        <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow" bold>Agent 提问:</Text>
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
import React, { useCallback, useEffect, useState } from "react";
import { AgentView } from "./components/AgentView.js";
import { AgentRuntime } from "./agent/runtime.js";
import { createCoreTools } from "./agent/tools/index.js";
import { createSubAgentRunner } from "./agent/subagents/index.js";
import { StateStore } from "./agent/state-store.js";
import { AGENT_SYSTEM_PROMPT } from "./agent/prompt.js";

// ... 其他导入 ...

export default function App() {
  // ... 现有状态 ...

  // 修复 P2: 用户提问状态
  const [pendingQuestion, setPendingQuestion] = useState<{
    question: string;
    options?: string[];
  } | null>(null);

  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);

  // 初始化 Agent (修复 P6: 对齐真实 API)
  const initializeAgent = useCallback((project: NovelProject, paths: ProjectPaths) => {
    // 从配置加载 LLM 设置
    const config = loadNovelConfig();
    const apiKey = resolveApiKey(config.llm.provider);
    const llmConfig = {
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
      ...(config.llm.baseURL ? { baseURL: config.llm.baseURL } : {})
    };
    const llmProvider = createLLMProvider(config.llm.provider, apiKey, llmConfig);
    // 修复 P1: 使用项目目录而非工作区根目录,避免多项目状态串线
    const stateStore = new StateStore({ projectPath: paths.projectDir });

    // 修复 P8: 传入正确的路径参数
    // 修复 P1: 使用 project.slug 而非 currentProject.slug
    const subAgentRunner = createSubAgentRunner({
      llmProvider,
      workspaceRoot: paths.rootDir,      // 工作区根目录
      projectSlug: project.slug          // 项目 slug (使用参数,非 state)
    });

    let agentRuntime!: AgentRuntime;

    // 修复 P2: 传入完整参数
    const tools = createCoreTools({
      llmProvider,
      subAgentRunner,
      workingDirectory: paths.rootDir,
      stateStore,
      getState: () => agentRuntime.getState()
    });

    agentRuntime = new AgentRuntime({
      systemPrompt: AGENT_SYSTEM_PROMPT,
      tools,
      llmProvider,
      stateStore,
      onStateChange: (state) => {
        if (state.status === "waiting_for_user" && state.pendingQuestion) {
          setPendingQuestion({
            question: state.pendingQuestion.question,
            options: state.pendingQuestion.options
          });
          setAgentOutput(`等待您的回答: ${state.pendingQuestion.question}`);
        }
      }
    });

    setRuntime(agentRuntime);
  }, []);

  // 修复 P10: 初始化时检查恢复
  useEffect(() => {
    if (!runtime) return;

    const checkResume = async () => {
      const resumedState = await runtime.resume();
      if (resumedState) {
        // 修复 P1: 如果有待恢复的问题,恢复问答 UI 并使用 continueWithAnswer 接回原工具调用
        if (resumedState.status === "waiting_for_user" && resumedState.pendingQuestion) {
          setPendingQuestion({
            question: resumedState.pendingQuestion.question,
            options: resumedState.pendingQuestion.options
          });

          setAgentOutput(`等待您的回答: ${resumedState.pendingQuestion.question}`);
        } else if (resumedState.currentTask) {
          // 有待恢复的任务,显示恢复提示
          setAgentOutput(`检测到未完成的任务: ${resumedState.currentTask}\n请重新输入指令继续,或输入新的指令。`);
        }
      }
    };

    void checkResume();
  }, [runtime]);

  // 处理用户回答 (修复 P2)
  const handleAnswerQuestion = useCallback(async (answer: string) => {
    if (!runtime) return;

    setPendingQuestion(null);
    setIsThinking(true);

    try {
      const result = await runtime.continueWithAnswer(answer);
      setAgentOutput(result);
    } catch (error) {
      setAgentOutput(error instanceof Error ? error.message : "继续执行失败");
    } finally {
      setIsThinking(false);
    }
  }, [runtime]);

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

## Task 12: 测试任务 (修复 P11)

**Files:**
- Create: `tests/agent/runtime.test.ts`
- Create: `tests/agent/tools/bash.test.ts`
- Create: `tests/agent/tools/ask-user.test.ts`
- Create: `tests/agent/tools/dispatch-agent.test.ts`

**Step 1: Runtime 测试**

```typescript
// tests/agent/runtime.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { AgentRuntime } from "../../source/agent/runtime.js";
import { StateStore } from "../../source/agent/state-store.js";
import type { LLMProvider } from "../../source/services/llm/types.js";
import type { Tool } from "../../source/agent/types.js";

// Mock LLM Provider
const mockLLMProvider: LLMProvider = {
  generateText: vi.fn(),
  streamGenerate: vi.fn(),
  generateWithTools: vi.fn()
};

const mockStateStore = {
  saveState: vi.fn(),
  loadState: vi.fn(),
  saveConversation: vi.fn(),
  loadConversation: vi.fn()
};

describe("AgentRuntime", () => {
  let runtime: AgentRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new AgentRuntime({
      systemPrompt: "Test prompt",
      tools: [],
      llmProvider: mockLLMProvider,
      stateStore: mockStateStore as any
    });
  });

  it("should initialize with idle status", () => {
    expect(runtime.getState().status).toBe("idle");
  });

  it("should complete without tool calls", async () => {
    vi.mocked(mockLLMProvider.generateWithTools).mockResolvedValue({
      content: "Task completed",
      toolCalls: undefined
    });

    const result = await runtime.run("test input");
    expect(result).toBe("Task completed");
    expect(runtime.getState().status).toBe("completed");
  });

  it("should execute tools in parallel", async () => {
    const toolResults = new Map<string, string>();

    const mockTool1: Tool = {
      name: "tool1",
      description: "Test tool 1",
      parameters: z.object({ input: z.string() }),
      execute: async (params) => {
        await new Promise(r => setTimeout(r, 100));
        toolResults.set("tool1", params.input);
        return { kind: "completed", output: "tool1 result" };
      }
    };

    const mockTool2: Tool = {
      name: "tool2",
      description: "Test tool 2",
      parameters: z.object({ input: z.string() }),
      execute: async (params) => {
        await new Promise(r => setTimeout(r, 100));
        toolResults.set("tool2", params.input);
        return { kind: "completed", output: "tool2 result" };
      }
    };

    runtime = new AgentRuntime({
      systemPrompt: "Test",
      tools: [mockTool1, mockTool2],
      llmProvider: mockLLMProvider,
      stateStore: mockStateStore as any
    });

    vi.mocked(mockLLMProvider.generateWithTools)
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          { id: "1", type: "function", function: { name: "tool1", arguments: '{"input":"a"}' } },
          { id: "2", type: "function", function: { name: "tool2", arguments: '{"input":"b"}' } }
        ]
      })
      .mockResolvedValueOnce({ content: "Done", toolCalls: undefined });

    const start = Date.now();
    await runtime.run("test");
    const duration = Date.now() - start;

    // 并行执行应该 < 250ms (两个 100ms 并行)
    expect(duration).toBeLessThan(250);
    expect(toolResults.size).toBe(2);
  });

  it("should resume from saved state", async () => {
    vi.mocked(mockStateStore.loadState).mockResolvedValue({
      status: "thinking",
      currentTask: "Pending task"
    });
    vi.mocked(mockStateStore.loadConversation).mockResolvedValue([
      { role: "user", content: "Previous input" }
    ]);

    const resumed = await runtime.resume();
    // resume() 返回 AgentState | null
    expect(resumed).not.toBeNull();
    expect(resumed?.status).toBe("thinking");
    expect(resumed?.currentTask).toBe("Pending task");
  });

  it("should resume pending question state", async () => {
    vi.mocked(mockStateStore.loadState).mockResolvedValue({
      status: "waiting_for_user",
      pendingToolCalls: [
        { id: "1", type: "function", function: { name: "ask_user", arguments: '{"question":"Which character?"}' } }
      ],
      pendingQuestion: {
        question: "Which character should be the focus?",
        options: ["Alice", "Bob"]
      }
    });
    vi.mocked(mockStateStore.loadConversation).mockResolvedValue([
      { role: "user", content: "Write chapter 1" },
      { role: "assistant", content: "", toolCalls: [{ id: "1", type: "function", function: { name: "ask_user", arguments: '{"question":"Which character?"}' } }] }
    ]);

    const resumed = await runtime.resume();
    expect(resumed?.status).toBe("waiting_for_user");
    expect(resumed?.pendingToolCalls?.[0]?.function.name).toBe("ask_user");
    expect(resumed?.pendingQuestion?.question).toBe("Which character should be the focus?");
    expect(resumed?.pendingQuestion?.options).toEqual(["Alice", "Bob"]);
  });
});
```

**Step 2: bash 工具测试**

```typescript
// tests/agent/tools/bash.test.ts
import { describe, it, expect } from "vitest";
import { createBashTool } from "../../../source/agent/tools/bash.js";

describe("BashTool", () => {
  const tool = createBashTool({ workingDirectory: process.cwd() });

  it("should execute safe commands", async () => {
    const result = await tool.execute({ command: "echo hello" });
    expect(result.output).toBe("hello");
    expect(result.error).toBeUndefined();
  });

  it("should block dangerous commands", async () => {
    const result = await tool.execute({ command: "rm -rf /" });
    expect(result.error).toContain("blocked");
  });

  it("should block git force push", async () => {
    const result = await tool.execute({ command: "git push --force" });
    expect(result.error).toContain("blocked");
  });

  it("should block npm run", async () => {
    const result = await tool.execute({ command: "npm run build" });
    expect(result.error).toContain("blocked");
  });

  it("should restrict to working directory", async () => {
    const restrictedTool = createBashTool({
      workingDirectory: "/tmp/test"
    });
    // 尝试路径穿越
    const result = await restrictedTool.execute({ command: "cat ../../../etc/passwd" });
    expect(result.error).toBeDefined();
  });
});
```

**Step 3: ask_user 工具测试**

```typescript
// tests/agent/tools/ask-user.test.ts
import { describe, it, expect, vi } from "vitest";
import { createAskUserTool } from "../../../source/agent/tools/ask-user.js";

describe("AskUserTool", () => {
  it("should save pending question with pendingToolCalls intact", async () => {
    const savedState: any[] = [];
    const mockStateStore = {
      saveState: vi.fn(async (state: any) => {
        savedState.push(state);
      })
    };

    const tool = createAskUserTool({
      stateStore: mockStateStore as any,
      getState: () => ({
        status: "acting",
        pendingToolCalls: [
          { id: "1", type: "function", function: { name: "ask_user", arguments: "{\"question\":\"Test question?\"}" } }
        ]
      })
    });

    const result = await tool.execute({ question: "Test question?" });

    expect(result.kind).toBe("await_user");
    expect(mockStateStore.saveState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "waiting_for_user",
        pendingQuestion: { question: "Test question?" },
        pendingToolCalls: [
          { id: "1", type: "function", function: { name: "ask_user", arguments: "{\"question\":\"Test question?\"}" } }
        ]
      })
    );
  });
});
```

**Step 4: dispatch_agent 工具测试**

```typescript
// tests/agent/tools/dispatch-agent.test.ts
import { describe, it, expect, vi } from "vitest";
import { createDispatchAgentTool } from "../../../source/agent/tools/dispatch-agent.js";

describe("DispatchAgentTool", () => {
  it("should call subAgentRunner with correct config", async () => {
    const mockSubAgentRunner = vi.fn().mockResolvedValue({
      type: "memory_update",
      success: true,
      output: "Memory updated successfully"
    });

    const tool = createDispatchAgentTool({
      subAgentRunner: mockSubAgentRunner
    });

    const result = await tool.execute({
      type: "memory_update",
      task: "Extract memory from chapter 1",
      context: "Chapter 1: The protagonist meets a mysterious stranger"
    });

    expect(mockSubAgentRunner).toHaveBeenCalledWith({
      type: "memory_update",
      task: "Extract memory from chapter 1",
      context: "Chapter 1: The protagonist meets a mysterious stranger"
    });
    expect(result.output).toBe("Memory updated successfully");
    expect(result.error).toBeUndefined();
  });

  it("should handle sub-agent errors gracefully", async () => {
    const mockSubAgentRunner = vi.fn().mockResolvedValue({
      type: "memory_update",
      success: false,
      error: "Failed to parse memory data"
    });

    const tool = createDispatchAgentTool({
      subAgentRunner: mockSubAgentRunner
    });

    const result = await tool.execute({
      type: "memory_update",
      task: "Extract memory from chapter 1"
    });

    expect(result.error).toBe("Failed to parse memory data");
    expect(result.output).toBe("");
  });

  it("should validate type parameter against enum", async () => {
    const tool = createDispatchAgentTool({
      subAgentRunner: vi.fn()
    });

    // 测试无效的 type (Zod 会拒绝)
    const result = await tool.execute({
      // @ts-expect-error 测试无效的 type 值
      type: "invalid_type",
      task: "Test task"
    });

    // Zod 验证失败会返回 error
    expect(result.error).toBeDefined();
  });

  it("should work without optional context", async () => {
    const mockSubAgentRunner = vi.fn().mockResolvedValue({
      type: "quality_check",
      success: true,
      output: "Quality check passed"
    });

    const tool = createDispatchAgentTool({
      subAgentRunner: mockSubAgentRunner
    });

    const result = await tool.execute({
      type: "quality_check",
      task: "Check chapter 1 for consistency"
    });

    expect(mockSubAgentRunner).toHaveBeenCalledWith({
      type: "quality_check",
      task: "Check chapter 1 for consistency",
      context: undefined
    });
    expect(result.output).toBe("Quality check passed");
  });
});
```

**Step 5: Commit**

```bash
git add tests/agent/
git commit -m "test(agent): add comprehensive tests for Runtime and tools"
```

---

## 验收标准

1. **类型正确**: Message 支持 tool role, Tool.parameters 是 ZodSchema
2. **协议完整**: 使用 OpenAI Function Calling, assistant 消息保存 toolCalls
3. **真正并行**: 多个工具调用使用 Promise.all 并行执行
4. **沙箱安全**: bash 工具有白名单 (默认禁用 git/npm) 和工作目录限制
5. **用户交互**: ask_user 持久化等待状态, UI 支持问答和断点恢复
6. **断点恢复**: StateStore 在 Runtime 生命周期中被调用, resume() 可恢复
7. **记忆闭环**: memory_update 真正接入 MemoryManager, 无 TODO
8. **App 集成**: createLLMProvider 使用真实签名 (provider, apiKey, config)
9. **测试通过**: 所有新增代码有对应测试
