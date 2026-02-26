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
