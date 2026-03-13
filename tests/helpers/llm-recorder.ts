import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createLLMProvider,
  type LLMProvider
} from "../../source/services/llm/index.js";
import type { Message } from "../../source/types/index.js";

interface RecordedResponse {
  key: string;
  provider: string;
  model: string;
  messages: Message[];
  response: string;
  recordedAt: string;
}

export interface RecordingLLMContext {
  llm: LLMProvider;
  mode: "record" | "replay";
  recordingsDir: string;
}

function hashMessages(messages: Message[]): string {
  return createHash("sha1")
    .update(JSON.stringify(messages))
    .digest("hex");
}

function resolveProviderName(): "openai" | "deepseek" {
  const configured = process.env["NOVEL_TEST_LLM_PROVIDER"]?.trim();
  if (configured === "deepseek") {
    return "deepseek";
  }
  if (configured === "openai") {
    return "openai";
  }
  if (process.env["DEEPSEEK_API_KEY"]) {
    return "deepseek";
  }
  return "openai";
}

function resolveApiKey(provider: "openai" | "deepseek"): string | null {
  if (provider === "deepseek") {
    return process.env["DEEPSEEK_API_KEY"]?.trim() || null;
  }

  return process.env["OPENAI_API_KEY"]?.trim() || null;
}

function resolveModel(provider: "openai" | "deepseek"): string {
  const configured = process.env["NOVEL_TEST_LLM_MODEL"]?.trim();
  if (configured) {
    return configured;
  }

  return provider === "deepseek" ? "deepseek-chat" : "gpt-4o-mini";
}

function resolveBaseURL(): string | undefined {
  const configured = process.env["NOVEL_TEST_LLM_BASE_URL"]?.trim();
  return configured || undefined;
}

function shouldRecord(): boolean {
  return process.env["LLM_RECORD"] === "true";
}

export function resolveRecordingsDir(fixtureDir: string): string {
  const configured = process.env["NOVEL_TEST_RECORDINGS_DIR"]?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.join(fixtureDir, "recordings");
}

export function hasRecordings(fixtureDir: string): boolean {
  const recordingsDir = resolveRecordingsDir(fixtureDir);
  if (!fs.existsSync(recordingsDir)) {
    return false;
  }

  return fs
    .readdirSync(recordingsDir)
    .some((entry) => entry.endsWith(".json"));
}

export function canRunRecordedLLM(fixtureDir: string): boolean {
  if (hasRecordings(fixtureDir)) {
    return true;
  }

  if (!shouldRecord()) {
    return false;
  }

  const provider = resolveProviderName();
  return resolveApiKey(provider) !== null;
}

export async function createRecordingLLM(
  fixtureDir: string
): Promise<RecordingLLMContext> {
  const mode = shouldRecord() ? "record" : "replay";
  const provider = resolveProviderName();
  const model = resolveModel(provider);
  const recordingsDir = resolveRecordingsDir(fixtureDir);

  await fs.promises.mkdir(recordingsDir, { recursive: true });

  const delegate =
    mode === "record"
      ? createLLMProvider(provider, resolveApiKey(provider) ?? "", {
          model,
          temperature: 0.7,
          maxTokens: 4096,
          ...(resolveBaseURL() ? { baseURL: resolveBaseURL() } : {})
        })
      : null;

  const llm: LLMProvider = {
    async generateText(messages, signal) {
      const key = hashMessages(messages);
      const filepath = path.join(recordingsDir, `${key}.json`);

      if (mode === "replay") {
        if (!fs.existsSync(filepath)) {
          throw new Error(
            `缺少录制文件: ${filepath}。请先使用 LLM_RECORD=true 运行 test:record。`
          );
        }

        const recorded = JSON.parse(
          await fs.promises.readFile(filepath, "utf8")
        ) as RecordedResponse;
        return recorded.response;
      }

      if (!delegate) {
        throw new Error("录制模式未能初始化 LLM Provider");
      }

      const response = await delegate.generateText(messages, signal);
      const recorded: RecordedResponse = {
        key,
        provider,
        model,
        messages,
        response,
        recordedAt: new Date().toISOString()
      };

      await fs.promises.writeFile(
        filepath,
        `${JSON.stringify(recorded, null, 2)}\n`,
        "utf8"
      );

      return response;
    },

    async *streamGenerate(messages, signal) {
      const text = await this.generateText(messages, signal);
      if (text) {
        yield text;
      }
    }
  };

  return { llm, mode, recordingsDir };
}
