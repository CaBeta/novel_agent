import type { Message } from "../../types/index.js";

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
