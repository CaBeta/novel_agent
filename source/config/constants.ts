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
