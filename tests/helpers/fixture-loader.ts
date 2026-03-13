import fs from "node:fs";
import path from "node:path";

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

  const project = JSON.parse(
    await fs.promises.readFile(projectPath, "utf8")
  ) as FixtureProject;
  const retrievalCases = JSON.parse(
    await fs.promises.readFile(retrievalCasesPath, "utf8")
  ) as RetrievalCase[];
  const chapters = await Promise.all(
    chapterFiles.map(async (filename) => {
      const filepath = path.join(chaptersDir, filename);
      return JSON.parse(
        await fs.promises.readFile(filepath, "utf8")
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
