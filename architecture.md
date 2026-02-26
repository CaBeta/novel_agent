# Novel Agent 架构设计文档

> 基于 **TypeScript + Ink** 的终端小说写作 Agent

---

## 一、技术选型

| 技术 | 用途 | 选择理由 |
|------|------|----------|
| TypeScript | 开发语言 | 类型安全，IDE 支持好 |
| Ink (React) | 终端 UI 框架 | 组件化、Flexbox 布局、流式渲染 |
| OpenAI SDK | LLM 交互 | 原生流式支持，TypeScript 类型完备 |
| Zod | 运行时校验 | 配置文件 & LLM 输出结构校验 |
| ink-text-input | 用户输入 | Ink 生态标准组件 |
| ink-spinner | 加载动画 | Ink 生态标准组件 |
| ink-select-input | 选项选择 | 剧情分支交互 |

---

## 二、项目结构

```text
novel-cli/
├── source/
│   ├── cli.tsx                  # 入口：环境初始化 + 渲染
│   ├── app.tsx                  # 根组件：路由 & 全局状态
│   │
│   ├── components/              # UI 组件层
│   │   ├── InputView.tsx        # 输入阶段界面
│   │   ├── WritingView.tsx      # 流式写作界面
│   │   ├── DoneView.tsx         # 完成界面
│   │   ├── ErrorView.tsx        # 错误提示界面
│   │   └── Layout.tsx           # 通用布局（边框、标题栏）
│   │
│   ├── hooks/                   # 自定义 Hooks
│   │   ├── useStreamWriter.ts   # 封装流式写作逻辑 + AbortController
│   │   └── useNovelContext.ts   # 小说上下文管理
│   │
│   ├── services/                # 业务逻辑层
│   │   ├── llm/
│   │   │   ├── types.ts         # LLM 接口定义
│   │   │   ├── openai.ts        # OpenAI 实现
│   │   │   └── index.ts         # Provider 工厂
│   │   ├── context-manager.ts   # 上下文压缩 & 管理
│   │   └── file-manager.ts      # 文件输出管理
│   │
│   ├── config/                  # 配置层
│   │   ├── constants.ts         # 应用常量
│   │   ├── prompts.ts           # 提示词模板
│   │   └── schema.ts            # 配置文件 Zod Schema
│   │
│   └── types/                   # 全局类型
│       └── index.ts
│
├── output/                      # 生成内容输出目录（gitignore）
├── novel.config.json            # 项目级配置（模型、参数、提示词覆盖）
├── .env                         # 环境变量（API Key）
├── .gitignore
├── tsconfig.json
└── package.json
```

---

## 三、核心模块设计

### 3.1 类型定义 (`source/types/index.ts`)

```typescript
export type AppStep = 'input' | 'writing' | 'done' | 'error';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Chapter {
  index: number;
  title: string;
  content: string;
  summary: string;
  createdAt: string;
}

export interface NovelProject {
  title: string;
  genre: string;
  outline: string;
  characters: Character[];
  chapters: Chapter[];
}

export interface Character {
  name: string;
  description: string;
  traits: string[];
}

export interface GenerateOptions {
  topic: string;
  context: string;
  signal?: AbortSignal;
}
```

### 3.2 LLM 抽象层 (`source/services/llm/`)

将 LLM 交互抽象为接口，解耦具体实现，便于切换模型供应商。

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
import OpenAI from 'openai';
import type { LLMProvider, LLMConfig } from './types.js';
import type { Message } from '../../types/index.js';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private config: LLMConfig;

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
        stream: true,
      },
      { signal }
    );

    for await (const chunk of stream) {
      if (signal?.aborted) return;
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }
}
```

**工厂函数** (`index.ts`)：

```typescript
import { OpenAIProvider } from './openai.js';
import type { LLMProvider, LLMConfig } from './types.js';

export function createLLMProvider(
  provider: string,
  apiKey: string,
  config: LLMConfig
): LLMProvider {
  switch (provider) {
    case 'openai':
      return new OpenAIProvider(apiKey, config);
    default:
      throw new Error(`不支持的 LLM 供应商: ${provider}`);
  }
}

export type { LLMProvider, LLMConfig };
```

### 3.3 配置管理 (`source/config/`)

**常量** (`constants.ts`)：

```typescript
export const APP_NAME = 'Novel Agent';
export const OUTPUT_DIR = './output';
export const CONFIG_FILE = 'novel.config.json';

export const DEFAULT_LLM_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  temperature: 0.8,
  maxTokens: 4096,
} as const;
```

**提示词模板** (`prompts.ts`)：

```typescript
export const SYSTEM_PROMPT_WRITER = `你是一个专业的小说家。
要求：
- 文笔流畅，描写生动
- 保持与前文风格一致
- 注意人物性格的连贯性`;

export const SYSTEM_PROMPT_SUMMARY = `你是一个文本摘要专家。
请将给定的章节内容压缩为 200 字以内的摘要，保留关键情节和人物关系。`;

export function buildWriterMessages(
  topic: string,
  context: string
) {
  return [
    { role: 'system' as const, content: SYSTEM_PROMPT_WRITER },
    {
      role: 'user' as const,
      content: context
        ? `已有背景：\n${context}\n\n请续写关于「${topic}」的情节。`
        : `请写一段关于「${topic}」的情节。`,
    },
  ];
}
```

**配置 Schema** (`schema.ts`)：

```typescript
import { z } from 'zod';

export const NovelConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(['openai']).default('openai'),
    model: z.string().default('gpt-4o-mini'),
    temperature: z.number().min(0).max(2).default(0.8),
    maxTokens: z.number().positive().default(4096),
    baseURL: z.string().url().optional(),
  }).default({}),
  output: z.object({
    dir: z.string().default('./output'),
    filenamePattern: z.string().default('chapter_{index}'),
  }).default({}),
});

export type NovelConfig = z.infer<typeof NovelConfigSchema>;
```

### 3.4 文件管理 (`source/services/file-manager.ts`)

```typescript
import fs from 'fs/promises';
import path from 'path';
import { OUTPUT_DIR } from '../config/constants.js';

export class FileManager {
  private outputDir: string;

  constructor(outputDir: string = OUTPUT_DIR) {
    this.outputDir = outputDir;
  }

  async ensureOutputDir(): Promise<void> {
    await fs.mkdir(this.outputDir, { recursive: true });
  }

  async saveChapter(index: number, content: string): Promise<string> {
    await this.ensureOutputDir();
    const filename = `chapter_${String(index).padStart(3, '0')}.md`;
    const filepath = path.join(this.outputDir, filename);
    await fs.writeFile(filepath, content, 'utf-8');
    return filepath;
  }

  async getNextChapterIndex(): Promise<number> {
    await this.ensureOutputDir();
    const files = await fs.readdir(this.outputDir);
    const chapterFiles = files.filter((f) => /^chapter_\d+\.md$/.test(f));
    if (chapterFiles.length === 0) return 1;
    const indices = chapterFiles.map((f) => {
      const match = f.match(/chapter_(\d+)\.md/);
      return match ? parseInt(match[1], 10) : 0;
    });
    return Math.max(...indices) + 1;
  }
}
```

### 3.5 上下文管理 (`source/services/context-manager.ts`)

```typescript
import type { Chapter, Character, Message } from '../types/index.js';

const MAX_CONTEXT_LENGTH = 3000;

export class ContextManager {
  private chapters: Chapter[] = [];
  private characters: Character[] = [];
  private outline: string = '';

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
      const charDesc = this.characters
        .map((c) => `- ${c.name}: ${c.description}`)
        .join('\n');
      parts.push(`【主要角色】\n${charDesc}`);
    }

    if (this.chapters.length > 0) {
      const recentSummaries = this.chapters
        .slice(-3)
        .map((ch) => `第${ch.index}章「${ch.title}」: ${ch.summary}`)
        .join('\n');
      parts.push(`【近期章节摘要】\n${recentSummaries}`);
    }

    const context = parts.join('\n\n');
    if (context.length > MAX_CONTEXT_LENGTH) {
      return context.slice(-MAX_CONTEXT_LENGTH);
    }
    return context;
  }
}
```

### 3.6 核心 Hook (`source/hooks/useStreamWriter.ts`)

将流式写作逻辑从组件中抽离，封装为可复用的 Hook，内置 `AbortController` 管理生命周期。

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import type { LLMProvider } from '../services/llm/index.js';
import type { Message } from '../types/index.js';

interface StreamWriterState {
  content: string;
  isWriting: boolean;
  error: string | null;
  charCount: number;
}

export function useStreamWriter(llm: LLMProvider) {
  const [state, setState] = useState<StreamWriterState>({
    content: '',
    isWriting: false,
    error: null,
    charCount: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (messages: Message[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ content: '', isWriting: true, error: null, charCount: 0 });

    try {
      let fullText = '';
      for await (const chunk of llm.streamGenerate(messages, controller.signal)) {
        if (controller.signal.aborted) break;
        fullText += chunk;
        setState((prev) => ({
          ...prev,
          content: prev.content + chunk,
          charCount: [...(prev.content + chunk)].length,
        }));
      }

      if (!controller.signal.aborted) {
        setState((prev) => ({ ...prev, isWriting: false }));
      }
      return fullText;
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : '未知错误';
        setState((prev) => ({
          ...prev,
          isWriting: false,
          error: message,
        }));
      }
      return null;
    }
  }, [llm]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return { ...state, start, abort };
}
```

---

## 四、UI 组件设计

### 4.1 状态流转

```text
[input] ──提交──> [writing] ──完成──> [done]
   ^                  │                  │
   │                  ├──失败──> [error]  │
   │                  │            │      │
   │                  └──取消──────┘      │
   └──────── 继续写作 ──────────────────────┘
```

五种状态：`input` → `writing` → `done` / `error`，`done` 和 `error` 均可回到 `input` 继续下一章。

### 4.2 组件拆分

**InputView** — 接受用户输入，校验非空：

```tsx
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { APP_NAME } from '../config/constants.js';

interface Props {
  chapterIndex: number;
  onSubmit: (value: string) => void;
}

export function InputView({ chapterIndex, onSubmit }: Props) {
  const [value, setValue] = useState('');

  const handleSubmit = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="blue">
      <Text bold>{APP_NAME} - 第 {chapterIndex} 章</Text>
      <Box marginTop={1}>
        <Text color="green">{'> '}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          placeholder="描述这一章的情节方向..."
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
}
```

**WritingView** — 流式展示 + Ctrl+C 中断提示：

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface Props {
  content: string;
  charCount: number;
}

export function WritingView({ content, charCount }: Props) {
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="yellow">
      <Box marginBottom={1} justifyContent="space-between">
        <Text color="yellow">
          <Spinner type="dots" /> 正在生成...
        </Text>
        <Text color="gray">{charCount} 字</Text>
      </Box>
      <Box borderStyle="single" borderColor="gray" padding={1}>
        <Text wrap="wrap">{content || '...'}</Text>
      </Box>
    </Box>
  );
}
```

**DoneView** — 完成信息展示：

```tsx
import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  filepath: string;
  charCount: number;
  onContinue: () => void;
}

export function DoneView({ filepath, charCount, onContinue }: Props) {
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="green">
      <Text color="green" bold>写作完成</Text>
      <Text>文件已保存: {filepath}</Text>
      <Text color="gray">字数: {charCount}</Text>
      <Box marginTop={1}>
        <Text color="cyan">按回车继续下一章，Ctrl+C 退出</Text>
      </Box>
    </Box>
  );
}
```

**ErrorView** — 错误信息 + 重试引导：

```tsx
import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  message: string;
  onRetry: () => void;
}

export function ErrorView({ message, onRetry }: Props) {
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="red">
      <Text color="red" bold>生成失败</Text>
      <Text color="red">{message}</Text>
      <Box marginTop={1}>
        <Text color="cyan">按回车重试</Text>
      </Box>
    </Box>
  );
}
```

### 4.3 根组件 (`source/app.tsx`)

```tsx
import React, { useState, useCallback } from 'react';
import { useApp } from 'ink';
import { InputView } from './components/InputView.js';
import { WritingView } from './components/WritingView.js';
import { DoneView } from './components/DoneView.js';
import { ErrorView } from './components/ErrorView.js';
import { useStreamWriter } from './hooks/useStreamWriter.js';
import { createLLMProvider } from './services/llm/index.js';
import { FileManager } from './services/file-manager.js';
import { ContextManager } from './services/context-manager.js';
import { buildWriterMessages } from './config/prompts.js';
import { DEFAULT_LLM_CONFIG } from './config/constants.js';
import type { AppStep } from './types/index.js';

const apiKey = process.env['OPENAI_API_KEY'];
if (!apiKey) {
  console.error('请在 .env 中设置 OPENAI_API_KEY');
  process.exit(1);
}

const llm = createLLMProvider(
  DEFAULT_LLM_CONFIG.provider,
  apiKey,
  DEFAULT_LLM_CONFIG
);
const fileManager = new FileManager();
const contextManager = new ContextManager();

export default function App() {
  const { exit } = useApp();
  const [step, setStep] = useState<AppStep>('input');
  const [chapterIndex, setChapterIndex] = useState(1);
  const [savedPath, setSavedPath] = useState('');
  const writer = useStreamWriter(llm);

  const handleSubmit = useCallback(async (topic: string) => {
    setStep('writing');
    const context = contextManager.buildContext();
    const messages = buildWriterMessages(topic, context);
    const result = await writer.start(messages);

    if (result) {
      const filepath = await fileManager.saveChapter(chapterIndex, result);
      setSavedPath(filepath);
      contextManager.addChapter({
        index: chapterIndex,
        title: topic,
        content: result,
        summary: result.slice(0, 200),
        createdAt: new Date().toISOString(),
      });
      setStep('done');
    } else {
      setStep('error');
    }
  }, [chapterIndex, writer]);

  const handleContinue = useCallback(() => {
    setChapterIndex((i) => i + 1);
    setStep('input');
  }, []);

  const handleRetry = useCallback(() => {
    setStep('input');
  }, []);

  switch (step) {
    case 'input':
      return <InputView chapterIndex={chapterIndex} onSubmit={handleSubmit} />;
    case 'writing':
      return <WritingView content={writer.content} charCount={writer.charCount} />;
    case 'done':
      return (
        <DoneView
          filepath={savedPath}
          charCount={writer.charCount}
          onContinue={handleContinue}
        />
      );
    case 'error':
      return (
        <ErrorView
          message={writer.error ?? '未知错误'}
          onRetry={handleRetry}
        />
      );
  }
}
```

### 4.4 入口文件 (`source/cli.tsx`)

```tsx
#!/usr/bin/env node
import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import App from './app.js';

render(<App />);
```

`dotenv/config` 在入口最早加载，确保所有模块都能读到环境变量。

---

## 五、配置文件示例

### `novel.config.json`

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "temperature": 0.8,
    "maxTokens": 4096
  },
  "output": {
    "dir": "./output",
    "filenamePattern": "chapter_{index}"
  }
}
```

### `.env`

```text
OPENAI_API_KEY=sk-proj-xxxxxxxxx
```

### `.gitignore`

```text
node_modules/
dist/
output/
.env
*.log
```

---

## 六、依赖清单

```bash
# 项目初始化
npx create-ink-app --typescript novel-cli
cd novel-cli

# 核心依赖
npm install openai zod ink-text-input ink-spinner ink-select-input

# dotenv 使用 import 'dotenv/config' 方式，无需额外配置
npm install dotenv
```

---

## 七、开发与运行

```bash
# 开发模式（监听变更）
npm run dev

# 编译
npm run build

# 运行
npm start

# 类型检查
npx tsc --noEmit
```

---

## 八、后续迭代方向

### P1 - 近期

- **剧情分支选择**：写作完成后，用 `ink-select-input` 提供 2-3 个后续发展方向供选择
- **大纲管理命令**：支持 `novel-cli outline` 子命令，设置/查看全书大纲
- **角色库管理**：支持 `novel-cli character add` 添加角色，自动注入上下文

### P2 - 中期

- **多 Provider 支持**：实现 Claude、Gemini、本地模型的 `LLMProvider`
- **章节摘要自动生成**：写完一章后自动调用 LLM 生成摘要，存入上下文
- **多面板 Dashboard**：左栏大纲/角色，右栏正文，底部状态栏

### P3 - 远期

- **项目持久化**：将 `NovelProject` 序列化为 JSON，支持跨会话续写
- **版本管理**：每次生成保留历史版本，支持 diff 和回滚
- **导出功能**：支持导出为 EPUB / PDF
