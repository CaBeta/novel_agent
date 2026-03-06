# Novel Agent 架构设计文档

> 基于 **TypeScript + Ink** 的终端小说写作 Agent

---

## 一、产品定位

**长篇网文创作操作系统** — 不是"一键写完整本小说"，而是一个可持续维护长篇项目的 CLI 创作系统。

架构分为两层：

- **内核层**：规划、记忆、生成、修订、审核、调度
- **交互层**：CLI/TUI 作者工作台

当前处于**可运行的最小原型**阶段，能完成单章流式生成与连续多章写作。后续将沿 [路线图](./docs/roadmap.md) 逐步补齐长篇核心能力。

---

## 二、技术选型

| 技术 | 用途 | 选择理由 |
|------|------|----------|
| TypeScript | 开发语言 | 类型安全，IDE 支持好 |
| Ink (React) | 终端 UI 框架 | 组件化、Flexbox 布局、流式渲染 |
| OpenAI SDK | LLM 交互 | 原生流式支持，TypeScript 类型完备；兼容 DeepSeek 等 OpenAI 协议供应商 |
| Zod | 运行时校验 | 配置文件 & LLM 输出结构校验 |
| ink-text-input | 用户输入 | Ink 生态标准组件 |
| ink-spinner | 加载动画 | Ink 生态标准组件 |
| ink-select-input | 选项选择 | 剧情分支交互（已安装，待启用） |
| tsx | 开发运行时 | 开发阶段直接运行 TypeScript |
| pnpm | 包管理 | 快速、节省磁盘空间 |
| dotenv | 环境变量 | 使用 `import 'dotenv/config'` 方式加载 |

---

## 三、项目结构

```text
novel-cli/
├── source/
│   ├── cli.tsx                  # 入口：环境初始化 + 渲染
│   ├── app.tsx                  # 根组件：配置加载、路由 & 全局状态
│   │
│   ├── components/              # UI 组件层
│   │   ├── Layout.tsx           # 通用布局（边框、标题栏、APP_NAME）
│   │   ├── InputView.tsx        # 输入阶段界面
│   │   ├── WritingView.tsx      # 流式写作界面（Esc 取消）
│   │   ├── DoneView.tsx         # 完成界面（回车继续）
│   │   └── ErrorView.tsx        # 错误提示界面（回车重试）
│   │
│   ├── hooks/                   # 自定义 Hooks
│   │   ├── useStreamWriter.ts   # 封装流式写作逻辑 + AbortController
│   │   └── useNovelContext.ts   # 小说上下文管理（封装 ContextManager）
│   │
│   ├── services/                # 业务逻辑层
│   │   ├── llm/
│   │   │   ├── types.ts         # LLM 接口定义
│   │   │   ├── openai.ts        # OpenAI 实现（兼容 DeepSeek）
│   │   │   └── index.ts         # Provider 工厂（openai / deepseek）
│   │   ├── context-manager.ts   # 上下文压缩 & 管理
│   │   └── file-manager.ts      # 文件输出管理（支持自定义命名模式）
│   │
│   ├── config/                  # 配置层
│   │   ├── constants.ts         # 应用常量（含默认 LLM 和输出配置）
│   │   ├── prompts.ts           # 提示词模板
│   │   └── schema.ts            # 配置文件 Zod Schema + loadNovelConfig()
│   │
│   └── types/                   # 全局类型
│       └── index.ts
│
├── dist/                        # 编译输出目录
├── output/                      # 生成内容输出目录（gitignore）
├── docs/                        # 项目文档（gitignore）
│   ├── prepare.md               # 竞品调研与技术路线分析
│   ├── roadmap.md               # 分阶段路线图
│   └── implementation-plan.md   # 实施计划与模块拆分
├── novel.config.json            # 项目级配置（模型、参数、输出）
├── .env                         # 环境变量（API Key）
├── .env.example                 # 环境变量模板
├── .gitignore
├── tsconfig.json
├── pnpm-lock.yaml
└── package.json
```

---

## 四、核心模块设计

### 4.1 类型定义 (`source/types/index.ts`)

```typescript
export type AppStep = "input" | "writing" | "done" | "error";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Chapter {
  index: number;
  title: string;
  content: string;
  summary: string;
  createdAt: string;
}

export interface Character {
  name: string;
  description: string;
  traits: string[];
}

export interface NovelProject {
  title: string;
  genre: string;
  outline: string;
  characters: Character[];
  chapters: Chapter[];
}

export interface GenerateOptions {
  topic: string;
  context: string;
  signal?: AbortSignal;
}
```

### 4.2 LLM 抽象层 (`source/services/llm/`)

将 LLM 交互抽象为接口，解耦具体实现。通过 OpenAI SDK 的 `baseURL` 机制兼容多个供应商。

**接口定义** (`types.ts`)：

```typescript
export interface LLMProvider {
  streamGenerate(
    messages: Message[],
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown>;
}

export interface LLMConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  baseURL?: string;
}
```

**OpenAI 实现** (`openai.ts`)：

```typescript
import OpenAI from "openai";
import type { Message } from "../../types/index.js";
import type { LLMConfig, LLMProvider } from "./types.js";

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI;
  private readonly config: LLMConfig;

  constructor(apiKey: string, config: LLMConfig) {
    this.client = new OpenAI({ apiKey, baseURL: config.baseURL });
    this.config = config;
  }

  async *streamGenerate(
    messages: Message[],
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        messages,
        stream: true
      },
      { signal }
    );

    for await (const chunk of stream) {
      if (signal?.aborted) return;
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}
```

**工厂函数** (`index.ts`)：

支持 `openai` 和 `deepseek` 两种 provider。DeepSeek 通过 OpenAI SDK 的兼容协议接入，自动注入 `baseURL`。

```typescript
import { OpenAIProvider } from "./openai.js";
import type { LLMConfig, LLMProvider } from "./types.js";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export function createLLMProvider(
  provider: string,
  apiKey: string,
  config: LLMConfig
): LLMProvider {
  switch (provider) {
    case "openai":
      return new OpenAIProvider(apiKey, config);
    case "deepseek":
      return new OpenAIProvider(apiKey, {
        ...config,
        baseURL: config.baseURL ?? DEEPSEEK_BASE_URL
      });
    default:
      throw new Error(`不支持的 LLM 供应商: ${provider}`);
  }
}

export type { LLMConfig, LLMProvider };
```

### 4.3 配置管理 (`source/config/`)

**常量** (`constants.ts`)：

```typescript
export const APP_NAME = "Novel Agent";
export const OUTPUT_DIR = "./output";
export const CONFIG_FILE = "novel.config.json";

export const DEFAULT_LLM_CONFIG = {
  provider: "openai",
  model: "gpt-4o-mini",
  temperature: 0.8,
  maxTokens: 4096
} as const;

export const DEFAULT_OUTPUT_CONFIG = {
  dir: OUTPUT_DIR,
  filenamePattern: "chapter_{index}"
} as const;
```

**提示词模板** (`prompts.ts`)：

```typescript
import type { Message } from "../types/index.js";

export const SYSTEM_PROMPT_WRITER = `你是一个专业的小说家。
要求：
- 文笔流畅，描写生动
- 保持与前文风格一致
- 注意人物性格的连贯性`;

export const SYSTEM_PROMPT_SUMMARY = `你是一个文本摘要专家。
请将给定的章节内容压缩为 200 字以内的摘要，保留关键情节和人物关系。`;

export function buildWriterMessages(topic: string, context: string): Message[] {
  return [
    { role: "system", content: SYSTEM_PROMPT_WRITER },
    {
      role: "user",
      content: context
        ? `已有背景：\n${context}\n\n请续写关于「${topic}」的情节。`
        : `请写一段关于「${topic}」的情节。`
    }
  ];
}
```

**配置 Schema** (`schema.ts`)：

通过 `loadNovelConfig()` 从 `novel.config.json` 读取并校验，文件不存在时回退到默认值。

```typescript
import fs from "node:fs";
import { z } from "zod";
import { CONFIG_FILE } from "./constants.js";

export const NovelConfigSchema = z.object({
  llm: z
    .object({
      provider: z.enum(["openai", "deepseek"]).default("openai"),
      model: z.string().default("gpt-4o-mini"),
      temperature: z.number().min(0).max(2).default(0.8),
      maxTokens: z.number().positive().default(4096),
      baseURL: z.string().url().optional()
    })
    .default({}),
  output: z
    .object({
      dir: z.string().default("./output"),
      filenamePattern: z.string().default("chapter_{index}")
    })
    .default({})
});

export type NovelConfig = z.infer<typeof NovelConfigSchema>;

export function loadNovelConfig(configPath: string = CONFIG_FILE): NovelConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return NovelConfigSchema.parse(parsed);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return NovelConfigSchema.parse({});
    }
    throw error;
  }
}
```

### 4.4 文件管理 (`source/services/file-manager.ts`)

支持自定义输出目录和文件名模式（通过 `{index}` 占位符）。

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { OUTPUT_DIR } from "../config/constants.js";

const DEFAULT_FILENAME_PATTERN = "chapter_{index}";

export class FileManager {
  private readonly outputDir: string;
  private readonly filenamePattern: string;

  constructor(
    outputDir: string = OUTPUT_DIR,
    filenamePattern: string = DEFAULT_FILENAME_PATTERN
  ) {
    this.outputDir = outputDir;
    this.filenamePattern = filenamePattern;
  }

  async ensureOutputDir(): Promise<void> {
    await fs.mkdir(this.outputDir, { recursive: true });
  }

  async saveChapter(index: number, content: string): Promise<string> {
    await this.ensureOutputDir();
    const filename = this.formatFilename(index);
    const filepath = path.join(this.outputDir, filename);
    await fs.writeFile(filepath, content, "utf-8");
    return filepath;
  }

  async getNextChapterIndex(): Promise<number> {
    await this.ensureOutputDir();
    const files = await fs.readdir(this.outputDir);
    const chapterFiles = files.filter((file) => file.endsWith(".md"));
    if (chapterFiles.length === 0) return 1;

    const indices = chapterFiles
      .map((file) => {
        const match = file.match(/(\d+)\.md$/);
        const rawIndex = match?.[1];
        if (!rawIndex) return 0;
        const parsed = Number.parseInt(rawIndex, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
      })
      .filter((num) => Number.isFinite(num));

    if (indices.length === 0) return 1;
    return Math.max(...indices) + 1;
  }

  private formatFilename(index: number): string {
    const safeIndex = String(index).padStart(3, "0");
    const name = this.filenamePattern.replace("{index}", safeIndex);
    return `${name}.md`;
  }
}
```

### 4.5 上下文管理 (`source/services/context-manager.ts`)

当前为内存模式，维护大纲、角色和最近章节摘要。后续将改造为从持久化记忆文件中检索。

```typescript
import type { Chapter, Character } from "../types/index.js";

const MAX_CONTEXT_LENGTH = 3000;

export class ContextManager {
  private chapters: Chapter[] = [];
  private characters: Character[] = [];
  private outline = "";

  setOutline(outline: string): void {
    this.outline = outline;
  }

  addCharacter(character: Character): void {
    this.characters.push(character);
  }

  addChapter(chapter: Chapter): void {
    this.chapters.push(chapter);
  }

  buildContext(): string {
    const parts: string[] = [];

    if (this.outline) {
      parts.push(`【大纲】\n${this.outline}`);
    }

    if (this.characters.length > 0) {
      const characterDescriptions = this.characters
        .map((character) => `- ${character.name}: ${character.description}`)
        .join("\n");
      parts.push(`【主要角色】\n${characterDescriptions}`);
    }

    if (this.chapters.length > 0) {
      const recentSummaries = this.chapters
        .slice(-3)
        .map(
          (chapter) =>
            `第${chapter.index}章「${chapter.title}」: ${chapter.summary}`
        )
        .join("\n");
      parts.push(`【近期章节摘要】\n${recentSummaries}`);
    }

    const context = parts.join("\n\n");
    if (context.length > MAX_CONTEXT_LENGTH) {
      return context.slice(-MAX_CONTEXT_LENGTH);
    }
    return context;
  }
}
```

### 4.6 核心 Hooks

**`useStreamWriter`** — 将流式写作逻辑从组件中抽离，内置 `AbortController` 管理生命周期：

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import type { LLMProvider } from "../services/llm/index.js";
import type { Message } from "../types/index.js";

interface StreamWriterState {
  content: string;
  isWriting: boolean;
  error: string | null;
  charCount: number;
}

export function useStreamWriter(llm: LLMProvider) {
  const [state, setState] = useState<StreamWriterState>({
    content: "",
    isWriting: false,
    error: null,
    charCount: 0
  });
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (messages: Message[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ content: "", isWriting: true, error: null, charCount: 0 });

      try {
        let fullText = "";
        for await (const chunk of llm.streamGenerate(messages, controller.signal)) {
          if (controller.signal.aborted) break;
          fullText += chunk;
          setState((prev) => {
            const nextContent = prev.content + chunk;
            return {
              ...prev,
              content: nextContent,
              charCount: Array.from(nextContent).length
            };
          });
        }

        if (!controller.signal.aborted) {
          setState((prev) => ({ ...prev, isWriting: false }));
        }
        return fullText;
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "未知错误";
          setState((prev) => ({
            ...prev,
            isWriting: false,
            error: message
          }));
        }
        return null;
      }
    },
    [llm]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isWriting: false }));
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return { ...state, start, abort };
}
```

**`useNovelContext`** — 封装 `ContextManager`，提供上下文操作方法：

```typescript
import { useMemo } from "react";
import type { Chapter, Character } from "../types/index.js";
import { ContextManager } from "../services/context-manager.js";

export function useNovelContext() {
  const manager = useMemo(() => new ContextManager(), []);

  const setOutline = (outline: string) => manager.setOutline(outline);
  const addCharacter = (character: Character) => manager.addCharacter(character);
  const addChapter = (chapter: Chapter) => manager.addChapter(chapter);
  const buildContext = () => manager.buildContext();

  return { setOutline, addCharacter, addChapter, buildContext };
}
```

---

## 五、UI 组件设计

### 5.1 状态流转

```text
[input] ──提交──> [writing] ──完成──> [done]
   ^                  │                  │
   │                  ├──失败──> [error]  │
   │                  │            │      │
   │                  └── Esc ─────┘      │
   └──────── 继续写作 ──────────────────────┘
```

四种状态：`input` → `writing` → `done` / `error`。`done` 和 `error` 均可回到 `input` 继续下一章。写作过程中按 Esc 可中断并返回输入界面。

### 5.2 通用布局组件

所有视图共享 `Layout` 组件，统一边框样式和标题格式：

```tsx
import React, { type PropsWithChildren } from "react";
import { Box, Text } from "ink";
import { APP_NAME } from "../config/constants.js";

interface LayoutProps extends PropsWithChildren {
  title: string;
  borderColor: "blue" | "yellow" | "green" | "red" | "gray";
}

export function Layout({ title, borderColor, children }: LayoutProps) {
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor={borderColor}>
      <Text bold>{`${APP_NAME} · ${title}`}</Text>
      <Box marginTop={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
```

### 5.3 视图组件

**InputView** — 接受用户输入，校验非空，使用 `Layout` 包裹：

```tsx
import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { Layout } from "./Layout.js";

interface InputViewProps {
  chapterIndex: number;
  onSubmit: (value: string) => void;
}

export function InputView({ chapterIndex, onSubmit }: InputViewProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <Layout title={`第 ${chapterIndex} 章`} borderColor="blue">
      <Text>请输入本章剧情方向：</Text>
      <Box marginTop={1}>
        <Text color="green">{"> "}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          placeholder="描述这一章的情节方向..."
          onSubmit={handleSubmit}
        />
      </Box>
    </Layout>
  );
}
```

**WritingView** — 流式展示 + Esc 取消：

```tsx
import React from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { Layout } from "./Layout.js";

interface WritingViewProps {
  content: string;
  charCount: number;
  onAbort: () => void;
}

export function WritingView({ content, charCount, onAbort }: WritingViewProps) {
  useInput((_input, key) => {
    if (key.escape) onAbort();
  });

  return (
    <Layout title="正在写作" borderColor="yellow">
      <Box marginBottom={1} justifyContent="space-between">
        <Text color="yellow">
          <Spinner type="dots" /> 正在生成...
        </Text>
        <Text color="gray">{charCount} 字</Text>
      </Box>
      <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={0}>
        <Text wrap="wrap">{content || "..."}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="cyan">按 Esc 取消，回到输入界面</Text>
      </Box>
    </Layout>
  );
}
```

**DoneView** — 完成信息展示，回车继续：

```tsx
import React from "react";
import { Box, Text, useInput } from "ink";
import { Layout } from "./Layout.js";

interface DoneViewProps {
  filepath: string;
  charCount: number;
  onContinue: () => void;
}

export function DoneView({ filepath, charCount, onContinue }: DoneViewProps) {
  useInput((_input, key) => {
    if (key.return) onContinue();
  });

  return (
    <Layout title="写作完成" borderColor="green">
      <Text color="green" bold>
        本章已生成
      </Text>
      <Text>{`文件已保存: ${filepath}`}</Text>
      <Text color="gray">{`字数: ${charCount}`}</Text>
      <Box marginTop={1}>
        <Text color="cyan">按回车继续下一章，Ctrl+C 退出</Text>
      </Box>
    </Layout>
  );
}
```

**ErrorView** — 错误信息 + 回车重试：

```tsx
import React from "react";
import { Box, Text, useInput } from "ink";
import { Layout } from "./Layout.js";

interface ErrorViewProps {
  message: string;
  onRetry: () => void;
}

export function ErrorView({ message, onRetry }: ErrorViewProps) {
  useInput((_input, key) => {
    if (key.return) onRetry();
  });

  return (
    <Layout title="生成失败" borderColor="red">
      <Text color="red" bold>
        生成失败
      </Text>
      <Text color="red">{message}</Text>
      <Box marginTop={1}>
        <Text color="cyan">按回车返回输入界面重试</Text>
      </Box>
    </Layout>
  );
}
```

### 5.4 根组件 (`source/app.tsx`)

根组件负责加载配置、初始化 LLM 和 FileManager、管理步骤状态。启动时自动检测已有章节编号。

```tsx
import React, { useCallback, useEffect, useState } from "react";
import { InputView } from "./components/InputView.js";
import { WritingView } from "./components/WritingView.js";
import { DoneView } from "./components/DoneView.js";
import { ErrorView } from "./components/ErrorView.js";
import { useNovelContext } from "./hooks/useNovelContext.js";
import { useStreamWriter } from "./hooks/useStreamWriter.js";
import { createLLMProvider } from "./services/llm/index.js";
import { FileManager } from "./services/file-manager.js";
import { buildWriterMessages } from "./config/prompts.js";
import { loadNovelConfig } from "./config/schema.js";
import type { AppStep } from "./types/index.js";

const config = loadNovelConfig();

function resolveApiKey(provider: string): string {
  if (provider === "deepseek") {
    const deepseekKey = process.env["DEEPSEEK_API_KEY"];
    if (!deepseekKey) {
      throw new Error("请在 .env 中设置 DEEPSEEK_API_KEY");
    }
    return deepseekKey;
  }

  const openaiKey = process.env["OPENAI_API_KEY"];
  if (!openaiKey) {
    throw new Error("请在 .env 中设置 OPENAI_API_KEY");
  }
  return openaiKey;
}

const apiKey = resolveApiKey(config.llm.provider);
const llmConfig = {
  model: config.llm.model,
  temperature: config.llm.temperature,
  maxTokens: config.llm.maxTokens,
  ...(config.llm.baseURL ? { baseURL: config.llm.baseURL } : {})
};
const llm = createLLMProvider(config.llm.provider, apiKey, llmConfig);
const fileManager = new FileManager(
  config.output.dir,
  config.output.filenamePattern
);

export default function App() {
  const [step, setStep] = useState<AppStep>("input");
  const [chapterIndex, setChapterIndex] = useState(1);
  const [savedPath, setSavedPath] = useState("");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const { addChapter, buildContext } = useNovelContext();
  const writer = useStreamWriter(llm);

  useEffect(() => {
    let active = true;
    void fileManager
      .getNextChapterIndex()
      .then((nextIndex) => {
        if (active) setChapterIndex(nextIndex);
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "初始化失败";
        setRuntimeError(message);
        setStep("error");
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = useCallback(
    async (topic: string) => {
      setRuntimeError(null);
      setStep("writing");

      const context = buildContext();
      const messages = buildWriterMessages(topic, context);
      const result = await writer.start(messages);

      if (!result || !result.trim()) {
        setStep("error");
        setRuntimeError(writer.error ?? "模型未返回有效内容");
        return;
      }

      try {
        const filepath = await fileManager.saveChapter(chapterIndex, result);
        setSavedPath(filepath);
        addChapter({
          index: chapterIndex,
          title: topic,
          content: result,
          summary: result.slice(0, 200),
          createdAt: new Date().toISOString()
        });
        setStep("done");
      } catch (error) {
        const message = error instanceof Error ? error.message : "保存章节失败";
        setRuntimeError(message);
        setStep("error");
      }
    },
    [addChapter, buildContext, chapterIndex, writer]
  );

  const handleAbort = useCallback(() => {
    writer.abort();
    setStep("input");
  }, [writer]);

  const handleContinue = useCallback(() => {
    setRuntimeError(null);
    setChapterIndex((index) => index + 1);
    setStep("input");
  }, []);

  const handleRetry = useCallback(() => {
    setRuntimeError(null);
    setStep("input");
  }, []);

  switch (step) {
    case "input":
      return <InputView chapterIndex={chapterIndex} onSubmit={handleSubmit} />;
    case "writing":
      return (
        <WritingView
          content={writer.content}
          charCount={writer.charCount}
          onAbort={handleAbort}
        />
      );
    case "done":
      return (
        <DoneView
          filepath={savedPath}
          charCount={writer.charCount}
          onContinue={handleContinue}
        />
      );
    case "error":
      return (
        <ErrorView
          message={runtimeError ?? writer.error ?? "未知错误"}
          onRetry={handleRetry}
        />
      );
    default:
      return <ErrorView message="未知状态" onRetry={handleRetry} />;
  }
}
```

### 5.5 入口文件 (`source/cli.tsx`)

```tsx
#!/usr/bin/env node
import "dotenv/config";
import React from "react";
import { render } from "ink";
import App from "./app.js";

render(<App />);
```

`dotenv/config` 在入口最早加载，确保所有模块都能读到环境变量。

---

## 六、配置文件示例

### `novel.config.json`

```json
{
  "llm": {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "temperature": 0.8,
    "maxTokens": 4096
  },
  "output": {
    "dir": "./output",
    "filenamePattern": "chapter_{index}"
  }
}
```

支持的 provider：

| provider | 对应 API Key 环境变量 | 默认 baseURL |
|----------|----------------------|-------------|
| `openai` | `OPENAI_API_KEY` | OpenAI 官方 |
| `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com` |

### `.env.example`

```text
OPENAI_API_KEY=sk-proj-xxxxxxxxx
DEEPSEEK_API_KEY=sk-xxxxxxxxx
```

### `.gitignore`

```text
node_modules/
dist/
output/
.env
*.log

.DS_Store

docs
```

---

## 七、依赖清单

```json
{
  "dependencies": {
    "dotenv": "^16.4.7",
    "ink": "^5.2.1",
    "ink-select-input": "^6.0.0",
    "ink-spinner": "^5.0.0",
    "ink-text-input": "^6.0.0",
    "openai": "^4.80.1",
    "react": "^18.3.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^18.3.13",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

---

## 八、开发与运行

```bash
# 开发模式（直接运行 TypeScript）
pnpm dev

# 开发模式（监听变更，排除 output 和 dist）
pnpm dev:watch

# 编译
pnpm build

# 运行编译产物
pnpm start

# 类型检查
pnpm typecheck
```

---

## 九、当前实现边界

当前项目是一个**可运行的最小原型**，已具备的能力：

- CLI 入口与多状态界面切换
- OpenAI / DeepSeek 兼容接口调用与流式输出
- 通过配置文件切换模型供应商和参数
- 章节保存与自增编号
- 最近章节摘要的简单上下文拼接
- 写作中断（Esc）与错误重试

当前尚未实现的能力：

- **项目持久化**：没有"项目"这一持久化对象，仅有本次运行的内存状态
- **长篇数据结构**：没有卷纲、章纲、场景、伏笔、时间线等结构
- **长期记忆**：上下文只在内存中维护，重启后丢失
- **章节门禁**：没有质量检查、一致性校验和自动修订
- **修改传播**：无法安全处理中途改设定
- **进度追踪**：没有成本统计、失败恢复和断点续写

---

## 十、目标架构

根据 [实施计划](./docs/implementation-plan.md)，系统将逐步收敛到以下代码结构：

```text
source/
  app.tsx
  cli.tsx
  commands/
    new-project.ts               # 创建新项目
    write-chapter.ts             # 写作章节
    resume-workflow.ts           # 恢复工作流
    edit-project.ts              # 编辑项目设定
  components/
  config/
  hooks/
  services/
    llm/
    project/
      project-manager.ts         # 项目生命周期管理
      project-repository.ts      # 项目数据读写
      project-paths.ts           # 项目路径解析
    memory/
      memory-manager.ts          # 记忆管理
      memory-retriever.ts        # 按主题检索相关记忆
      memory-writer.ts           # 记忆回写
    outline/
      outline-manager.ts         # 大纲管理
    workflow/
      chapter-workflow.ts        # 章节工作流定义
      workflow-runner.ts         # 工作流执行器
      workflow-state.ts          # 工作流状态持久化
    gate/
      chapter-gate.ts            # 门禁执行
      gate-rules.ts              # 规则型检查
      gate-report.ts             # 门禁报告
    edit/
      impact-analyzer.ts         # 修改影响分析
      chapter-rewriter.ts        # 章节局部重写
  types/
    index.ts
    project.ts                   # 项目领域类型
    memory.ts                    # 记忆领域类型
    workflow.ts                  # 工作流领域类型
    gate.ts                      # 门禁领域类型
```

目标项目数据结构：

```text
projects/
  <project-slug>/
    project.json                 # 项目元数据
    outlines/
      book.json                  # 全书大纲
      arcs.json                  # 卷纲
      chapters.json              # 章纲
    memory/
      characters.json            # 角色记忆
      worldbook.json             # 世界观设定
      timeline.json              # 时间线
      foreshadowing.json         # 伏笔追踪
      summaries.json             # 章节摘要
    chapters/
      chapter_001.md             # 最终章节正文
    artifacts/
      chapter-001/
        prompt.json              # 写作提示词
        draft.md                 # 初稿
        summary.json             # 章节摘要
        memory-update.json       # 记忆更新
        gate-report.json         # 门禁报告
        revision.md              # 修订稿
    state/
      workflow.json              # 工作流状态
      session.json               # 会话状态
```

---

## 十一、分阶段路线图

详见 [路线图](./docs/roadmap.md) 和 [实施计划](./docs/implementation-plan.md)。

### Phase 0：夯实当前原型 → v0.2

- 引入 `NovelProject` 持久化目录结构
- 把运行时状态落盘，重启后可恢复
- 补基础测试和错误恢复机制

### Phase 1：长篇对象模型与记忆层 → v0.3

- 定义角色、设定、时间线、伏笔、摘要等结构
- 替换内存上下文为文件级长期记忆
- 每章完成后自动回写摘要和记忆

### Phase 2：规划链路 → v0.4

- 增加开书流程（题材、卖点、世界观、角色卡、卷纲、章纲）
- 章节生成消费 `ChapterOutline` 而非裸 `topic`

### Phase 3：章节工作流 → v0.4

- 拆分单次生成为状态化工作流：准备上下文 → 生成正文 → 章节总结 → 更新记忆
- 支持中断恢复和失败重试
- 每章留下完整产物目录

### Phase 4：门禁与修订闭环 → v0.5

- 规则型检查：标题缺失、摘要缺失、长度异常、重复短语、章纲偏离
- LLM 检查：角色行为合理性、设定一致性、节奏、钩子、AI 味
- 门禁失败后进入修订流程

### Phase 5：编辑回路与修改传播 → v0.6

- 修改意图 → 受影响对象分析 → 局部改写 → 回写记忆和大纲
- 从"生成器"升级为"可维护的长篇系统"

### Phase 6：产品化增强 → v1.0

- 成本统计与预算控制
- 项目面板与进度视图
- 风格库、提示词库、题材模板
- 批量写作和自动调度

---

## 十二、设计原则

### UI 不保存业务真相

`app.tsx` 和各个 View 只处理交互和状态展示。项目数据、章节数据、门禁结果、工作流状态都落到服务层。

### 生成过程必须可重放

每章产物（提示词、初稿、摘要、记忆更新、门禁报告、修订稿）都保留在 `artifacts/` 目录，便于追溯。

### 每一步都要有中间对象

大纲、记忆、提示词、门禁、修订不混在一个大函数里。每步有明确输入和输出对象，便于替换模型或加检查项。

---

## 十三、参考项目

| 项目 | 借鉴方向 |
|------|----------|
| [xindoo/ai-novel-lab](https://github.com/xindoo/ai-novel-lab) | 大纲驱动、工程化文档、修订闭环 |
| [MaoXiaoYuZ/Long-Novel-GPT](https://github.com/MaoXiaoYuZ/Long-Novel-GPT) | 大纲→正文主链路、RAG 编辑回路 |
| [leenbj/novel-creator-skill](https://github.com/leenbj/novel-creator-skill) | 长期记忆、门禁质检、断点续写、自动调度 |
| [ponysb/91Writing](https://github.com/ponysb/91Writing) | 产品化壳层、多模型配置、成本统计 |
| [hestudy/snowflake-fiction](https://github.com/hestudy/snowflake-fiction) | 雪花写作法、网文节奏工具链、质量检查 |
