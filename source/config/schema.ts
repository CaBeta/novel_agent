import fs from "node:fs";
import { z } from "zod";
import {
  CONFIG_FILE,
  DEFAULT_LLM_CONFIG,
  DEFAULT_OUTPUT_CONFIG,
  DEFAULT_PROJECT_CONFIG
} from "./constants.js";

export const NovelConfigSchema = z.object({
  llm: z
    .object({
      provider: z
        .enum(["openai", "deepseek"])
        .default(DEFAULT_LLM_CONFIG.provider),
      model: z.string().default(DEFAULT_LLM_CONFIG.model),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .default(DEFAULT_LLM_CONFIG.temperature),
      maxTokens: z.number().positive().default(DEFAULT_LLM_CONFIG.maxTokens),
      baseURL: z.string().url().optional()
    })
    .default({}),
  output: z
    .object({
      dir: z.string().default(DEFAULT_OUTPUT_CONFIG.dir),
      filenamePattern: z.string().default(DEFAULT_OUTPUT_CONFIG.filenamePattern)
    })
    .default({}),
  project: z
    .object({
      rootDir: z.string().default(DEFAULT_PROJECT_CONFIG.rootDir),
      autoLoadLastProject: z
        .boolean()
        .default(DEFAULT_PROJECT_CONFIG.autoLoadLastProject)
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
