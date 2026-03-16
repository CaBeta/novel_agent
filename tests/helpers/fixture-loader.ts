import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export interface FixtureCharacter {
  id: string;
  name: string;
  description: string;
  traits: string[];
  goals: string[];
  secrets: string[];
  currentStatus: string;
  aliases: string[];
  latestSummary: string;
  lastSeenChapter: number | null;
  recentEvents: string[];
  sourceChapterIndices: number[];
}

export interface FixtureProject {
  title: string;
  genre: string;
  outline: string;
  characters: FixtureCharacter[];
}

export interface FixtureChapter {
  index: number;
  title: string;
  plotSummary: string;
  originalText: string;
  expected: {
    mentionedCharacters?: string[];
    relations?: Array<{
      from: string;
      to: string;
      type: string;
      hint?: string;
    }>;
    worldbookEntries?: string[];
    foreshadowing?: {
      open?: string[];
      resolved?: string[];
    };
    timeline?: {
      participantsMustInclude?: string[];
      summaryMustContain?: string[];
    };
    summary?: {
      mustContainKeywords?: string[];
      maxLength?: number;
    };
  };
}

export interface RetrievalCase {
  afterChapter: number;
  topic: string;
  expectedCharacters?: string[];
  expectedWorldbook?: string[];
  mustRetrieveForeshadowing?: boolean;
  mustMatchKeywords?: string[];
  description: string;
}

export interface LoadedFixtureData {
  fixtureDir: string;
  project: FixtureProject;
  chapters: FixtureChapter[];
  retrievalCases: RetrievalCase[];
}

const ExpectedRelationSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
  hint: z.string().min(1).optional()
});

const ExpectedSchema = z.object({
  mentionedCharacters: z.array(z.string().min(1)).optional(),
  relations: z.array(ExpectedRelationSchema).optional(),
  worldbookEntries: z.array(z.string().min(1)).optional(),
  foreshadowing: z
    .object({
      open: z.array(z.string().min(1)).optional(),
      resolved: z.array(z.string().min(1)).optional()
    })
    .optional(),
  timeline: z
    .object({
      participantsMustInclude: z.array(z.string().min(1)).optional(),
      summaryMustContain: z.array(z.string().min(1)).optional()
    })
    .optional(),
  summary: z
    .object({
      mustContainKeywords: z.array(z.string().min(1)).optional(),
      maxLength: z.number().positive().optional()
    })
    .optional()
});

const FixtureCharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  traits: z.array(z.string()),
  goals: z.array(z.string()),
  secrets: z.array(z.string()),
  currentStatus: z.string(),
  aliases: z.array(z.string()),
  latestSummary: z.string(),
  lastSeenChapter: z.number().int().nullable(),
  recentEvents: z.array(z.string()),
  sourceChapterIndices: z.array(z.number().int())
});

const FixtureProjectSchema = z.object({
  title: z.string().min(1),
  genre: z.string(),
  outline: z.string(),
  characters: z.array(FixtureCharacterSchema)
});

const FixtureChapterSchema = z.object({
  index: z.number().int().positive(),
  title: z.string().min(1),
  plotSummary: z.string().min(1),
  originalText: z.string().min(1),
  expected: ExpectedSchema
});

const RetrievalCaseSchema = z.object({
  afterChapter: z.number().int().positive(),
  topic: z.string().min(1),
  expectedCharacters: z.array(z.string().min(1)).optional(),
  expectedWorldbook: z.array(z.string().min(1)).optional(),
  mustRetrieveForeshadowing: z.boolean().optional(),
  mustMatchKeywords: z.array(z.string().min(1)).optional(),
  description: z.string().min(1)
});

export function resolveFixtureDir(): string {
  const configured = process.env["NOVEL_TEST_FIXTURES_DIR"]?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.resolve(process.cwd(), "tests/fixtures/test-novel");
}

export function hasLocalFixtureData(): boolean {
  const fixtureDir = resolveFixtureDir();
  const projectPath = path.join(fixtureDir, "project.json");
  const chaptersDir = path.join(fixtureDir, "chapters");

  return fs.existsSync(projectPath) && fs.existsSync(chaptersDir);
}

export async function loadFixtureData(): Promise<LoadedFixtureData> {
  const fixtureDir = resolveFixtureDir();
  const projectPath = path.join(fixtureDir, "project.json");
  const retrievalCasesPath = path.join(fixtureDir, "retrieval-cases.json");
  const chaptersDir = path.join(fixtureDir, "chapters");

  const chapterFiles = fs
    .readdirSync(chaptersDir)
    .filter((entry) => /^chapter_\d+\.json$/.test(entry))
    .sort();

  const project = FixtureProjectSchema.parse(
    JSON.parse(await fs.promises.readFile(projectPath, "utf8"))
  ) as FixtureProject;
  const retrievalCases = z
    .array(RetrievalCaseSchema)
    .parse(JSON.parse(await fs.promises.readFile(retrievalCasesPath, "utf8"))) as RetrievalCase[];
  const chapters = await Promise.all(
    chapterFiles.map(async (filename) => {
      const filepath = path.join(chaptersDir, filename);
      return FixtureChapterSchema.parse(
        JSON.parse(await fs.promises.readFile(filepath, "utf8"))
      ) as FixtureChapter;
    })
  );

  return {
    fixtureDir,
    project,
    chapters: chapters.sort((left, right) => left.index - right.index),
    retrievalCases: retrievalCases.sort(
      (left, right) => left.afterChapter - right.afterChapter
    )
  };
}
