import type { Message } from "../../types/index.js";

export interface LLMProvider {
  generateText(messages: Message[], signal?: AbortSignal): Promise<string>;

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
