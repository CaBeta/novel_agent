# ReAct Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将小说创作系统从线性状态机重构为完全自主的 ReAct Agent 模式

**Architecture:** 4 个核心工具 (bash, generate_content, dispatch_agent, ask_user) + SubAgent 系统用于并行任务,混合上下文策略 (正文共享, SubAgent 独立),状态持久化支持断点恢复

**Tech Stack:** TypeScript, OpenAI SDK, Ink (React TUI), Zod

---

## Task 1: Agent Types 定义

**Files:**
- Create: `source/agent/types.ts`

**Step 1: 定义 Agent 核心类型**

```typescript
// source/agent/types.ts
import type { Message } from "../types/index.js";

export interface Tool {
  name: string;
  description: string;
  parameters: z.infer<typeof z.ZodTypeAny>;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
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
  pendingToolCalls?: PendingToolCall[];
}

export interface PendingToolCall {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
}

export interface ConversationMessage extends Message {
  toolCalls?: PendingToolCall[];
  toolCallId?: string;
}

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
```

**Step 2: Commit**

```bash
git add source/agent/types.ts
git commit -m "feat(agent): add Agent core type definitions"
```

---

## Task 2: Agent Runtime 核心实现

**Files:**
- Create: `source/agent/runtime.ts`
- Create: `source/agent/index.ts`

**Step 1: 创建 Runtime 类 - 消息管理**

```typescript
// source/agent/runtime.ts
import type { ConversationMessage } from "./types.js";

export class ConversationManager {
  private messages: ConversationMessage[] = [];

  addSystemPrompt(content: string): void {
    this.messages.push({ role: "system", content });
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addAssistantMessage(content: string, toolCalls?: PendingToolCall[]): void {
    this.messages.push({ role: "assistant", content, toolCalls });
  }

  addToolResult(toolCallId: string, output: string): void {
    this.messages.push({
      role: "tool",
      content: output,
      toolCallId
    });
  }

  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  getLastMessage(): ConversationMessage | undefined {
    return this.messages[this.messages.length - 1];
  }
}
```

**Step 2: 创建 Runtime 类 - 执行引擎**

```typescript
// source/agent/runtime.ts (续)
import { z } from "zod";
import type { Tool, ToolResult, AgentState, PendingToolCall } from "./types.js";
import { ConversationManager } from "./runtime.js";

interface RuntimeConfig {
  systemPrompt: string;
  tools: Tool[];
  llmProvider: LLMProvider;
}

export class AgentRuntime {
  private conversation: ConversationManager;
  private state: AgentState;
  private tools: Map<string, Tool>;
  private llmProvider: LLMProvider;

  constructor(config: RuntimeConfig) {
    this.conversation = new ConversationManager();
    this.conversation.addSystemPrompt(config.systemPrompt);
    this.tools = new Map(config.tools.map(t => [t.name, t]));
    this.llmProvider = config.llmProvider;
    this.state = { status: "idle" };
  }

  async run(userInput: string): Promise<string> {
    this.conversation.addUserMessage(userInput);
    this.state = { status: "thinking" };

    while (this.state.status !== "completed" && this.state.status !== "error") {
      if (this.state.status === "waiting_for_user") {
        // 等待用户输入
        break;
      }

      // 获取 LLM 响应
      const response = await this.getLLMResponse();

      // 解析响应中的工具调用
      const toolCalls = this.parseToolCalls(response);

      if (toolCalls.length === 0) {
        // 没有工具调用,任务完成
        this.state = { status: "completed" };
        return response;
      }

      // 执行工具调用
      for (const toolCall of toolCalls) {
        const result = await this.executeTool(toolCall);
        this.conversation.addToolResult(toolCall.id, result.output);
      }
    }

    return this.conversation.getLastMessage()?.content ?? "";
  }

  private async getLLMResponse(): Promise<string> {
    // 调用 LLM 获取响应
    // TODO: 实现
    return "";
  }

  private parseToolCalls(response: string): PendingToolCall[] {
    // 解析响应中的工具调用
    // TODO: 实现
    return [];
  }

  private async executeTool(toolCall: PendingToolCall): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.toolName);
    if (!tool) {
      return { output: "", error: `Unknown tool: ${toolCall.toolName}` };
    }
    return tool.execute(toolCall.parameters);
  }
}
```

**Step 3: Commit**

```bash
git add source/agent/runtime.ts
git commit -m "feat(agent): add Agent Runtime core implementation"
```

---

## Task 3: bash 工具实现

**Files:**
- Create: `source/agent/tools/bash.ts`
- Modify: `source/agent/tools/index.ts`

**Step 1: 实现 bash 工具**

```typescript
// source/agent/tools/bash.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";

const execAsync = promisify(exec);

export const BashToolSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  timeout: z.number().optional().default(30000).describe("Timeout in milliseconds")
});

export const bashTool: Tool = {
  name: "bash",
  description: "Execute a bash command. Use this for file operations, project management, and any shell commands.",
  parameters: BashToolSchema,
  execute: async (params: z.infer<typeof BashToolSchema>): Promise<ToolResult> => {
    try {
      const { stdout, stderr } = await execAsync(params.command, {
        timeout: params.timeout,
        maxBuffer: 1024 * 1024 // 1MB
      });

      const output = stderr ? `${stdout}\n${stderr}` : stdout;
      return { output: output.trim() };
    } catch (error) {
      if (error instanceof Error) {
        return { output: "", error: error.message };
      }
      return { output: "", error: "Unknown error executing bash command" };
    }
  }
};
```

**Step 2: 创建工具注册中心**

```typescript
// source/agent/tools/index.ts
import type { Tool } from "../types.js";
import { bashTool } from "./bash.js";

export const coreTools: Tool[] = [
  bashTool,
];

export function getToolByName(name: string): Tool | undefined {
  return coreTools.find(t => t.name === name);
}
```

**Step 3: Commit**

```bash
git add source/agent/tools/bash.ts source/agent/tools/index.ts
git commit -m "feat(agent): add bash tool implementation"
```

---

## Task 4: generate_content 工具实现

**Files:**
- Create: `source/agent/tools/generate-content.ts`
- Modify: `source/agent/tools/index.ts`

**Step 1: 实现 generate_content 工具**

```typescript
// source/agent/tools/generate-content.ts
import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";
import type { LLMProvider } from "../../services/llm/index.js";

export const GenerateContentSchema = z.object({
  task: z.enum(["chapter", "outline", "summary", "memory_extract"]),
  topic: z.string().describe("The topic or direction for content generation"),
  context: z.string().optional().describe("Additional context information"),
  style: z.string().optional().describe("Writing style requirements"),
  length: z.number().optional().describe("Target length in characters")
});

interface GenerateContentToolParams {
  llmProvider: LLMProvider;
}

export function createGenerateContentTool(params: GenerateContentToolParams): Tool {
  return {
    name: "generate_content",
    description: "Generate novel content using LLM. Use for writing chapters, outlines, summaries, or extracting memory.",
    parameters: GenerateContentSchema,
    execute: async (p: z.infer<typeof GenerateContentSchema>): Promise<ToolResult> => {
      try {
        const systemPrompts: Record<string, string> = {
          chapter: "你是一个专业的小说家。请根据给定的大纲和上下文,创作精彩的章节正文。",
          outline: "你是一个小说大纲专家。请根据给定的主题,创作详细的章节大纲。",
          summary: "你是一个文本摘要专家。请将给定的内容压缩为简洁的摘要,保留关键情节。",
          memory_extract: "你是记忆提取专家。请从给定的章节内容中提取角色、事件、设定等记忆信息。"
        };

        const messages = [
          { role: "system", content: systemPrompts[p.task] },
          { role: "user", content: buildUserPrompt(p) }
        ];

        let fullContent = "";
        for await (const chunk of params.llmProvider.streamGenerate(messages)) {
          fullContent += chunk;
        }

        return { output: fullContent };
      } catch (error) {
        return { output: "", error: error instanceof Error ? error.message : "Unknown error" };
      }
  };
}

function buildUserPrompt(p: z.infer<typeof GenerateContentSchema>): string {
  const parts: string[] = [];

  if (p.context) {
    parts.push(`上下文信息:\n${p.context}`);
  }

  parts.push(`任务: ${p.topic}`);

  if (p.style) {
    parts.push(`风格要求: ${p.style}`);
  }

  if (p.length) {
    parts.push(`目标字数: ${p.length}`);
  }

  return parts.join("\n\n");
}
```

**Step 2: 更新工具注册中心**

```typescript
// source/agent/tools/index.ts (修改)
import type { Tool } from "../types.js";
import type { LLMProvider } from "../../services/llm/index.js";
import { bashTool } from "./bash.js";
import { createGenerateContentTool } from "./generate-content.js";

export function createCoreTools(llmProvider: LLMProvider): Tool[] {
  return [
    bashTool,
    createGenerateContentTool({ llmProvider }),
  ];
}

export function getToolByName(tools: Tool[], name: string): Tool | undefined {
  return tools.find(t => t.name === name);
}
```

**Step 3: Commit**

```bash
git add source/agent/tools/generate-content.ts source/agent/tools/index.ts
git commit -m "feat(agent): add generate_content tool implementation"
```

---

## Task 5: ask_user 工具实现

**Files:**
- Create: `source/agent/tools/ask-user.ts`
- Modify: `source/agent/tools/index.ts`

**Step 1: 实现 ask_user 工具**

```typescript
// source/agent/tools/ask-user.ts
import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";

export const AskUserSchema = z.object({
  question: z.string().describe("The question to ask the user"),
  options: z.array(z.string()).optional().describe("Optional predefined options for the user to choose from")
});

interface AskUserToolParams {
  askCallback: (question: string, options?: string[]) => Promise<string>;
}

export function createAskUserTool(params: AskUserToolParams): Tool {
  return {
    name: "ask_user",
    description: "Ask the user a question when you need their input or decision.",
    parameters: AskUserSchema,
    execute: async (p: z.infer<typeof AskUserSchema>): Promise<ToolResult> => {
      try {
        const answer = await params.askCallback(p.question, p.options);
        return { output: answer };
      } catch (error) {
        return { output: "", error: error instanceof Error ? error.message : "Unknown error" };
      }
    }
  };
}
```

**Step 2: 更新工具注册中心**

```typescript
// source/agent/tools/index.ts (修改)
import type { Tool } from "../types.js";
import type { LLMProvider } from "../../services/llm/index.js";
import { bashTool } from "./bash.js";
import { createGenerateContentTool } from "./generate-content.js";
import { createAskUserTool } from "./ask-user.js";

interface CreateToolsParams {
  llmProvider: LLMProvider;
  askCallback: (question: string, options?: string[]) => Promise<string>;
}

export function createCoreTools(params: CreateToolsParams): Tool[] {
  return [
    bashTool,
    createGenerateContentTool({ llmProvider: params.llmProvider }),
    createAskUserTool({ askCallback: params.askCallback }),
  ];
}

export function getToolByName(tools: Tool[], name: string): Tool | undefined {
  return tools.find(t => t.name === name);
}
```

**Step 3: Commit**

```bash
git add source/agent/tools/ask-user.ts source/agent/tools/index.ts
git commit -m "feat(agent): add ask_user tool implementation"
```

---

## Task 6: dispatch_agent 工具实现 (SubAgent 派发)

**Files:**
- Create: `source/agent/tools/dispatch-agent.ts`
- Modify: `source/agent/tools/index.ts`

**Step 1: 实现 dispatch_agent 工具**

```typescript
// source/agent/tools/dispatch-agent.ts
import { z } from "zod";
import type { Tool, ToolResult, SubAgentConfig, SubAgentResult } from "../types.js";

export const DispatchAgentSchema = z.object({
  type: z.enum(["quality_check", "memory_update", "outline_gen"]),
  task: z.string().describe("The specific task for the subagent"),
  context: z.string().optional().describe("Additional context for the subagent"),
  parallel: z.boolean().optional().default(false).describe("Whether to run in parallel with other subagents")
});

interface DispatchAgentToolParams {
  subAgentRunner: (config: SubAgentConfig) => Promise<SubAgentResult>;
}

export function createDispatchAgentTool(params: DispatchAgentToolParams): Tool {
  return {
    name: "dispatch_agent",
    description: "Dispatch a subagent to handle a specific task independently. Use for quality checks, memory updates, and outline generation.",
    parameters: DispatchAgentSchema,
    execute: async (p: z.infer<typeof DispatchAgentSchema>): Promise<ToolResult> => {
      try {
        const config: SubAgentConfig = {
          type: p.type,
          task: p.task,
          context: p.context
        };

        const result = await params.subAgentRunner(config);

        if (result.success) {
          return { output: result.output };
        } else {
          return { output: "", error: result.error ?? "SubAgent failed" };
        }
      } catch (error) {
        return { output: "", error: error instanceof Error ? error.message : "Unknown error" };
      }
    }
  };
}
```

**Step 2: 更新工具注册中心**

```typescript
// source/agent/tools/index.ts (修改)
import type { Tool, SubAgentConfig, SubAgentResult } from "../types.js";
import type { LLMProvider } from "../../services/llm/index.js";
import { bashTool } from "./bash.js";
import { createGenerateContentTool } from "./generate-content.js";
import { createAskUserTool } from "./ask-user.js";
import { createDispatchAgentTool } from "./dispatch-agent.js";

interface CreateToolsParams {
  llmProvider: LLMProvider;
  askCallback: (question: string, options?: string[]) => Promise<string>;
  subAgentRunner: (config: SubAgentConfig) => Promise<SubAgentResult>;
}

export function createCoreTools(params: CreateToolsParams): Tool[] {
  return [
    bashTool,
    createGenerateContentTool({ llmProvider: params.llmProvider }),
    createAskUserTool({ askCallback: params.askCallback }),
    createDispatchAgentTool({ subAgentRunner: params.subAgentRunner }),
  ];
}

export function getToolByName(tools: Tool[], name: string): Tool | undefined {
  return tools.find(t => t.name === name);
}
```

**Step 3: Commit**

```bash
git add source/agent/tools/dispatch-agent.ts source/agent/tools/index.ts
git commit -m "feat(agent): add dispatch_agent tool for SubAgent dispatching"
```

---

## Task 7: SubAgent 系统实现

**Files:**
- Create: `source/agent/subagents/index.ts`
- Create: `source/agent/subagents/quality-check.ts`
- Create: `source/agent/subagents/memory-update.ts`
- Create: `source/agent/subagents/outline-gen.ts`

**Step 1: 创建 SubAgent 基础接口**

```typescript
// source/agent/subagents/index.ts
import type { LLMProvider } from "../../services/llm/index.js";
import type { SubAgentConfig, SubAgentResult } from "../types.js";

export interface SubAgent {
  type: string;
  execute(config: SubAgentConfig): Promise<SubAgentResult>;
}

export interface SubAgentContext {
  llmProvider: LLMProvider;
  projectPath: string;
}

export function createSubAgentRunner(context: SubAgentContext) {
  return async (config: SubAgentConfig): Promise<SubAgentResult> => {
    const subagent = createSubAgent(config.type, context);
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

function createSubAgent(type: string, context: SubAgentContext): SubAgent | null {
  switch (type) {
    // 将在后续步骤中实现
    default:
      return null;
  }
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

请以JSON格式返回检查结果:
{
  "passed": true/false,
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"]
}`;

export function createQualityCheckSubAgent(context: SubAgentContext): SubAgent {
  return {
    type: "quality_check",
    execute: async (config: SubAgentConfig): Promise<SubAgentResult> => {
      try {
        const messages = [
          { role: "system", content: QUALITY_CHECK_PROMPT },
          { role: "user", content: `请检查以下章节:\n\n${config.task}` }
        ];

        let response = "";
        for await (const chunk of context.llmProvider.streamGenerate(messages)) {
          response += chunk;
        }

        // 解析 JSON 响应
        const result = JSON.parse(response);

        return {
          type: "quality_check",
          success: result.passed,
          output: response,
          error: result.passed ? undefined : result.issues.join("; ")
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

请以JSON格式返回:
{
  "characters": [...],
  "events": [...],
  "settings": [...],
  "relationships": [...]
}`;

export function createMemoryUpdateSubAgent(context: SubAgentContext): SubAgent {
  return {
    type: "memory_update",
    execute: async (config: SubAgentConfig): Promise<SubAgentResult> => {
      try {
        const messages = [
          { role: "system", content: MEMORY_UPDATE_PROMPT },
          { role: "user", content: `请从以下内容中提取记忆:\n\n${config.task}` }
        ];

        let response = "";
        for await (const chunk of context.llmProvider.streamGenerate(messages)) {
          response += chunk;
        }

        // TODO: 将提取的记忆写入文件
        // 这里需要调用 MemoryManager

        return {
          type: "memory_update",
          success: true,
          output: response
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
2. 主要情节
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
          { role: "system", content: OUTLINE_GEN_PROMPT },
          { role: "user", content: `主题: ${config.task}${contextInfo}` }
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

**Step 5: 更新 SubAgent 注册中心**

```typescript
// source/agent/subagents/index.ts (修改)
import type { LLMProvider } from "../../services/llm/index.js";
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
  return async (config: SubAgentConfig): Promise<SubAgentResult> => {
    const subagent = createSubAgent(config.type, context);
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

function createSubAgent(type: string, context: SubAgentContext): SubAgent | null {
  switch (type) {
    case "quality_check":
      return createQualityCheckSubAgent(context);
    case "memory_update":
      return createMemoryUpdateSubAgent(context);
    case "outline_gen":
      return createOutlineGenSubAgent(context);
    default:
      return null;
  }
}
```

**Step 6: Commit**

```bash
git add source/agent/subagents/
git commit -m "feat(agent): add SubAgent system with quality_check, memory_update, and outline_gen"
```

---

## Task 8: Agent Prompt 设计

**Files:**
- Create: `source/agent/prompt.ts`

**Step 1: 创建 Agent System Prompt**

```typescript
// source/agent/prompt.ts
export const AGENT_SYSTEM_PROMPT = `你是一个专业的小说创作 Agent。你能够自主规划、执行和监控整个小说创作流程。

## 你的能力

你可以使用以下工具:

### 1. bash
执行任意 bash 命令。用于文件操作、项目管理等。
示例: \`cat project.json\`, \`ls chapters/\`, \`mkdir -p output\`

### 2. generate_content
使用 LLM 生成小说内容。用于写章节、大纲、摘要等。
参数:
- task: "chapter" | "outline" | "summary" | "memory_extract"
- topic: 主题或方向
- context: 额外上下文 (可选)
- style: 风格要求 (可选)
- length: 目标字数 (可选)

### 3. dispatch_agent
派发子 Agent 执行独立任务。用于质检、记忆更新等可并行的任务。
参数:
- type: "quality_check" | "memory_update" | "outline_gen"
- task: 具体任务描述
- context: 额外上下文 (可选)

### 4. ask_user
向用户提问。当你需要用户决策时使用。
参数:
- question: 问题内容
- options: 预设选项 (可选)

## 工作方式

你使用 ReAct 模式工作:
1. **Thought**: 思考当前情况,规划下一步
2. **Action**: 调用工具执行操作
3. **Observation**: 观察工具返回结果
4. 循环直到任务完成

## 示例

用户: "写第10章,主角决战反派"

Thought: 用户想写第10章。我需要先检查项目状态,看看前面的章节和当前大纲。
Action: bash: "cat project.json"
Observation: 项目有9章,大纲指向第10章是决战场景...

Thought: 需要获取更多上下文。我应该并行执行记忆更新和读取第9章。
Action: dispatch_agent(type="memory_update", task="更新记忆")
Action: bash: "cat chapters/chapter_009.md"
Observation: 记忆已更新,第9章内容已读取...

Thought: 现在可以生成第10章了。
Action: generate_content(task="chapter", topic="第10章: 主角决战反派", context="...")
Observation: 章节生成完成,3000字...

Thought: 应该检查质量。
Action: dispatch_agent(type="quality_check", task="检查第10章")
Observation: 质检通过...

Thought: 保存章节。
Action: bash: "echo '...' > chapters/chapter_010.md"
Observation: 章节已保存

Thought: 任务完成!
Response: 第10章已完成并保存,字数3000,无质量问题。

## 注意事项

1. 始终保持思考过程透明
2. 遇到问题时主动调整策略
3. 合理使用并行执行提高效率
4. 需要用户决策时及时提问
5. 确保每次操作都有明确目的
`;
```

**Step 2: Commit**

```bash
git add source/agent/prompt.ts
git commit -m "feat(agent): add Agent system prompt with tool descriptions"
```

---

## Task 9: 状态持久化实现

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
    this.conversationDir = config.conversationDir ?? path.join(process.env.HOME ?? "", ".novel-agent", "conversations");
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
      const statePath = this.getStatePath();
      await fs.unlink(statePath);
    } catch {
      // ignore
    }
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

## Task 10: UI 集成 - AgentView 组件

**Files:**
- Create: `source/components/AgentView.tsx`
- Modify: `source/app.tsx`

**Step 1: 创建 AgentView 组件**

```typescript
// source/components/AgentView.tsx
import React, { useState, useEffect } from "react";
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
}

export function AgentView({
  projectTitle,
  agentOutput,
  currentThought,
  currentAction,
  isThinking,
  onSubmit,
  onAbort
}: AgentViewProps) {
  const [input, setInput] = useState("");

  useInput((_input, key) => {
    if (key.escape && isThinking) {
      onAbort();
    }
  });

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
          placeholder="输入指令... (Esc 中断)"
          onSubmit={(value) => {
            if (value.trim()) {
              onSubmit(value.trim());
              setInput("");
            }
          }}
        />
      </Box>
    </Layout>
  );
}
```

**Step 2: Commit**

```bash
git add source/components/AgentView.tsx
git commit -m "feat(ui): add AgentView component for Agent interaction"
```

---

## Task 11: 重构 app.tsx 使用 Agent Runtime

**Files:**
- Modify: `source/app.tsx`

**Step 1: 重构 app.tsx**

```typescript
// source/app.tsx (重构)
import React, { useCallback, useEffect, useState } from "react";
import { AgentView } from "./components/AgentView.js";
import { LoadingView } from "./components/LoadingView.js";
import { ErrorView } from "./components/ErrorView.js";
import { ProjectSetupView } from "./components/ProjectSetupView.js";
import { AgentRuntime } from "./agent/runtime.js";
import { createCoreTools } from "./agent/tools/index.js";
import { createSubAgentRunner } from "./agent/subagents/index.js";
import { StateStore } from "./agent/state-store.js";
import { AGENT_SYSTEM_PROMPT } from "./agent/prompt.js";
import { createLLMProvider } from "./services/llm/index.js";
import { createProjectManager } from "./services/project/project-manager.js";
import { loadNovelConfig } from "./config/schema.js";
import type { AppStep } from "./types/index.js";
import type { NovelProject, NovelProjectMeta, ProjectPaths } from "./types/project.js";

// ... 保留现有的初始化逻辑 ...

export default function App() {
  const [step, setStep] = useState<AppStep>("loading");
  const [currentProject, setCurrentProject] = useState<NovelProject | null>(null);
  const [agentOutput, setAgentOutput] = useState("");
  const [currentThought, setCurrentThought] = useState<string>();
  const [currentAction, setCurrentAction] = useState<string>();
  const [isThinking, setIsThinking] = useState(false);
  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);

  // ... 保留现有的项目加载逻辑 ...

  const initializeAgent = useCallback((project: NovelProject, paths: ProjectPaths) => {
    const llmProvider = createLLMProvider(/* config */);
    const subAgentRunner = createSubAgentRunner({
      llmProvider,
      projectPath: paths.rootDir
    });

    const tools = createCoreTools({
      llmProvider,
      askCallback: async (question, options) => {
        // TODO: 实现用户提问 UI
        return "";
      },
      subAgentRunner
    });

    const agentRuntime = new AgentRuntime({
      systemPrompt: AGENT_SYSTEM_PROMPT,
      tools,
      llmProvider
    });

    setRuntime(agentRuntime);
  }, []);

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

  const handleAbort = useCallback(() => {
    // TODO: 实现 Agent 中断
    setIsThinking(false);
  }, []);

  // 渲染逻辑
  switch (step) {
    case "loading":
      return <LoadingView message="正在初始化..." />;
    case "project":
      return <ProjectSetupView /* ... */ />;
    case "input":
    case "writing":
      return currentProject ? (
        <AgentView
          projectTitle={currentProject.title}
          agentOutput={agentOutput}
          currentThought={currentThought}
          currentAction={currentAction}
          isThinking={isThinking}
          onSubmit={handleAgentSubmit}
          onAbort={handleAbort}
        />
      ) : (
        <ErrorView message="项目未加载" onRetry={() => setStep("project")} />
      );
    case "error":
      return <ErrorView message="发生错误" onRetry={() => setStep("project")} />;
    default:
      return <ErrorView message="未知状态" onRetry={() => setStep("project")} />;
  }
}
```

**Step 2: Commit**

```bash
git add source/app.tsx
git commit -m "refactor: integrate Agent Runtime into main app"
```

---

## Task 12: 集成测试

**Files:**
- Create: `tests/agent/runtime.test.ts`
- Create: `tests/agent/tools.test.ts`

**Step 1: 创建 Runtime 测试**

```typescript
// tests/agent/runtime.test.ts
import { describe, it, expect } from "vitest";
import { AgentRuntime } from "../../source/agent/runtime.js";
import { createCoreTools } from "../../source/agent/tools/index.js";

describe("AgentRuntime", () => {
  it("should initialize with system prompt", () => {
    const runtime = new AgentRuntime({
      systemPrompt: "Test prompt",
      tools: [],
      llmProvider: mockLLMProvider
    });

    expect(runtime).toBeDefined();
  });

  // TODO: 添加更多测试
});
```

**Step 2: 创建工具测试**

```typescript
// tests/agent/tools.test.ts
import { describe, it, expect } from "vitest";
import { bashTool } from "../../source/agent/tools/bash.js";

describe("BashTool", () => {
  it("should execute echo command", async () => {
    const result = await bashTool.execute({ command: "echo hello" });
    expect(result.output).toBe("hello");
  });

  it("should handle errors", async () => {
    const result = await bashTool.execute({ command: "nonexistent_command_xyz" });
    expect(result.error).toBeDefined();
  });
});
```

**Step 3: Commit**

```bash
git add tests/agent/
git commit -m "test(agent): add integration tests for Agent Runtime and tools"
```

---

## Task 13: 文档更新

**Files:**
- Modify: `architecture.md`
- Modify: `docs/plans/2026-03-21-agent-redesign-design.md`

**Step 1: 更新架构文档**

在 `architecture.md` 中添加 Agent 模式的说明。

**Step 2: Commit**

```bash
git add architecture.md docs/plans/
git commit -m "docs: update architecture documentation for Agent mode"
```

---

## 任务依赖关系

```
Task 1 (Types) ─┐
                 ├──> Task 3 (bash tool)
                 │
                 ├──> Task 4 (generate_content)
                 │
                 ├──> Task 5 (ask_user)
                 │
                 └──> Task 6 (dispatch_agent) ──> Task 7 (SubAgents)
                                              │
Task 2 (Runtime) ────────────────────────────┤
                                              │
Task 8 (Prompt) ─────────────────────────────┤
                                              │
Task 9 (StateStore) ─────────────────────────┤
                                              │
Task 10 (AgentView) ─────────────────────────┤
                                              │
Task 11 (App.tsx) ───────────────────────────┤
                                              │
Task 12 (Tests) ─────────────────────────────┘
Task 13 (Docs)
```

---

## 验收标准

1. Agent 能够接收用户指令并自主规划执行
2. 4 个核心工具都能正常工作
3. SubAgent 系统能够并行执行任务
4. 状态能够持久化并支持断点恢复
5. UI 能够展示 Agent 的思考过程
6. 所有测试通过
