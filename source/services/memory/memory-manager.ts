import fs from "node:fs/promises";
import path from "node:path";
import type { Character } from "../../types/index.js";
import type {
  ChapterSummaryMemory,
  CharacterMemory,
  ProjectMemoryData,
  TimelineEvent
} from "../../types/memory.js";
import type { NovelProject, ProjectChapter, ProjectPaths } from "../../types/project.js";

const MEMORY_FILES = {
  characters: "characters.json",
  worldbook: "worldbook.json",
  timeline: "timeline.json",
  foreshadowing: "foreshadowing.json",
  summaries: "summaries.json"
} as const;

function buildMemoryFilepaths(memoryDir: string) {
  return {
    characters: path.join(memoryDir, MEMORY_FILES.characters),
    worldbook: path.join(memoryDir, MEMORY_FILES.worldbook),
    timeline: path.join(memoryDir, MEMORY_FILES.timeline),
    foreshadowing: path.join(memoryDir, MEMORY_FILES.foreshadowing),
    summaries: path.join(memoryDir, MEMORY_FILES.summaries)
  };
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function buildId(prefix: string, raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${prefix}-${normalized || "item"}`;
}

function createEmptyMemory(): ProjectMemoryData {
  return {
    characters: [],
    worldbook: [],
    timeline: [],
    foreshadowing: [],
    summaries: []
  };
}

function toCharacterMemory(character: Character): CharacterMemory {
  return {
    id: buildId("character", character.name),
    name: character.name,
    description: character.description,
    traits: [...character.traits],
    goals: [],
    secrets: [],
    currentStatus: character.description,
    aliases: [],
    latestSummary: "",
    lastSeenChapter: null,
    recentEvents: [],
    sourceChapterIndices: []
  };
}

function toSummaryMemory(chapter: ProjectChapter): ChapterSummaryMemory {
  return {
    chapterIndex: chapter.index,
    title: chapter.title,
    summary: chapter.summary,
    keywords: [chapter.title].filter(Boolean),
    createdAt: chapter.createdAt
  };
}

function toTimelineEvent(chapter: ProjectChapter): TimelineEvent {
  return {
    id: `timeline-chapter-${chapter.index}`,
    chapterIndex: chapter.index,
    title: chapter.title,
    summary: chapter.summary,
    participants: [],
    consequences: [chapter.summary],
    keywords: [chapter.title].filter(Boolean),
    occurredAt: chapter.createdAt
  };
}

async function readJsonFile<T>(filepath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filepath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filepath: string, data: unknown): Promise<void> {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filepath, content, "utf-8");
}

export class MemoryManager {
  private readonly files;

  constructor(private readonly projectPaths: ProjectPaths) {
    this.files = buildMemoryFilepaths(projectPaths.memoryDir);
  }

  async ensureMemoryDir(): Promise<void> {
    await fs.mkdir(this.projectPaths.memoryDir, { recursive: true });
  }

  async initialize(
    project: Pick<NovelProject, "characters" | "chapters">
  ): Promise<ProjectMemoryData> {
    await this.ensureMemoryDir();

    const existing = await this.load();
    const nextMemory: ProjectMemoryData = {
      characters:
        existing.characters.length > 0
          ? existing.characters
          : project.characters.map(toCharacterMemory),
      worldbook: existing.worldbook,
      timeline:
        existing.timeline.length > 0
          ? existing.timeline
          : project.chapters.map(toTimelineEvent),
      foreshadowing: existing.foreshadowing,
      summaries:
        existing.summaries.length > 0
          ? existing.summaries
          : project.chapters.map(toSummaryMemory)
    };

    await this.writeAll(nextMemory);
    return nextMemory;
  }

  async load(): Promise<ProjectMemoryData> {
    await this.ensureMemoryDir();

    const [characters, worldbook, timeline, foreshadowing, summaries] =
      await Promise.all([
        readJsonFile<CharacterMemory[]>(this.files.characters),
        readJsonFile<ProjectMemoryData["worldbook"]>(this.files.worldbook),
        readJsonFile<TimelineEvent[]>(this.files.timeline),
        readJsonFile<ProjectMemoryData["foreshadowing"]>(this.files.foreshadowing),
        readJsonFile<ChapterSummaryMemory[]>(this.files.summaries)
      ]);

    return {
      ...createEmptyMemory(),
      ...(characters ? { characters } : {}),
      ...(worldbook ? { worldbook } : {}),
      ...(timeline ? { timeline } : {}),
      ...(foreshadowing ? { foreshadowing } : {}),
      ...(summaries ? { summaries } : {})
    };
  }

  async writeAll(memory: ProjectMemoryData): Promise<void> {
    await this.ensureMemoryDir();

    await Promise.all([
      writeJsonFile(this.files.characters, memory.characters),
      writeJsonFile(this.files.worldbook, memory.worldbook),
      writeJsonFile(this.files.timeline, memory.timeline),
      writeJsonFile(this.files.foreshadowing, memory.foreshadowing),
      writeJsonFile(this.files.summaries, memory.summaries)
    ]);
  }
}
