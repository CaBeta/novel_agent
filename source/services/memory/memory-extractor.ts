import { z } from "zod";
import { buildMemoryExtractionMessages } from "../../config/prompts.js";
import type { MemoryExtractionResult } from "../../types/memory.js";
import type { LLMProvider } from "../llm/index.js";

const RelationTypeSchema = z.enum([
  "allied",
  "hostile",
  "suspicious",
  "protective",
  "dependent",
  "neutral"
]);

const ExtractionSchema = z.object({
  characterUpdates: z
    .array(
      z.object({
        name: z.string().min(1),
        currentStatus: z.string().default(""),
        latestSummary: z.string().default(""),
        aliases: z.array(z.string()).default([])
      })
    )
    .default([]),
  relationUpdates: z
    .array(
      z.object({
        fromName: z.string().min(1),
        toName: z.string().min(1),
        relationType: RelationTypeSchema,
        currentStatus: z.string().default("")
      })
    )
    .default([]),
  worldbookEntries: z
    .array(
      z.object({
        title: z.string().min(1),
        content: z.string().default(""),
        tags: z.array(z.string()).default([])
      })
    )
    .default([]),
  timeline: z
    .object({
      summary: z.string().default(""),
      participants: z.array(z.string()).default([]),
      consequences: z.array(z.string()).default([]),
      keywords: z.array(z.string()).default([])
    })
    .optional(),
  foreshadowing: z
    .object({
      open: z
        .array(
          z.object({
            clue: z.string().min(1),
            notes: z.string().default(""),
            relatedCharacters: z.array(z.string()).default([])
          })
        )
        .default([]),
      resolve: z
        .array(
          z.object({
            clue: z.string().min(1),
            notes: z.string().default(""),
            relatedCharacters: z.array(z.string()).default([])
          })
        )
        .default([])
    })
    .default({ open: [], resolve: [] })
});

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

export class MemoryExtractor {
  constructor(private readonly llm: LLMProvider) {}

  async extract(input: {
    title: string;
    content: string;
    summary: string;
    candidateCharacters: string[];
    candidateRelations: Array<{ from: string; to: string; status: string }>;
    candidateWorldbook: string[];
    candidateForeshadowing: string[];
  }): Promise<MemoryExtractionResult | null> {
    try {
      const response = await this.llm.generateText(
        buildMemoryExtractionMessages(input)
      );
      if (!response.trim()) {
        return null;
      }

      const parsed = JSON.parse(stripCodeFence(response)) as unknown;
      const result = ExtractionSchema.parse(parsed);

      return {
        characterUpdates: result.characterUpdates,
        relationUpdates: result.relationUpdates,
        worldbookEntries: result.worldbookEntries,
        ...(result.timeline ? { timeline: result.timeline } : {}),
        foreshadowing: result.foreshadowing
      };
    } catch {
      return null;
    }
  }
}
