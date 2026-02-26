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
