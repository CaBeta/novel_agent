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
