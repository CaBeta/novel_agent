import type {
  ChapterMemoryUpdateResult,
  ChapterSummaryMemory,
  CharacterMemory,
  ForeshadowingItem,
  MemoryUpdateReport,
  ProjectMemoryData,
  TimelineEvent,
  WorldbookEntry
} from "../../types/memory.js";
import { MemoryManager } from "./memory-manager.js";
import fs from "node:fs/promises";
import path from "node:path";

interface RecordChapterMemoryInput {
  chapterIndex: number;
  title: string;
  content: string;
  createdAt: string;
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function splitKeywords(raw: string): string[] {
  return raw
    .split(/[\s,，。；;、/|：:\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function normalizeToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildId(prefix: string, raw: string): string {
  return `${prefix}-${normalizeToken(raw) || "item"}`;
}

function buildKeywordList(
  title: string,
  summary: string,
  mentionedCharacters: CharacterMemory[]
): string[] {
  return dedupe(
    [title, ...splitKeywords(title), ...mentionedCharacters.map((item) => item.name)]
      .concat(splitKeywords(summary).slice(0, 5))
      .filter(Boolean)
  ).slice(0, 8);
}

function detectMentionedCharacters(
  characters: CharacterMemory[],
  text: string
): CharacterMemory[] {
  const haystack = text.trim();
  if (!haystack) {
    return [];
  }

  return characters.filter((character) =>
    [character.name, ...character.aliases].some(
      (name) => name.trim().length > 0 && haystack.includes(name)
    )
  );
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractCharacterEvent(
  character: CharacterMemory,
  title: string,
  content: string,
  fallback: string
): string {
  const names = [character.name, ...character.aliases].filter(Boolean);
  const sentences = splitSentences(`${title}。${content}`);
  const matched = sentences.filter((sentence) =>
    names.some((name) => sentence.includes(name))
  );

  if (matched.length === 0) {
    return fallback;
  }

  return matched.slice(0, 2).join("；").slice(0, 120);
}

function mergeRecentEvents(events: string[], nextEvent: string): string[] {
  return dedupe([...events, nextEvent].filter(Boolean)).slice(-5);
}

function extractWorldbookCandidates(
  title: string,
  summary: string,
  content: string,
  excludedNames: string[]
): string[] {
  const suffixPattern =
    /([\u4e00-\u9fff]{2,12}(?:城|宫|山|门|宗|阁|司|府|国|洲|镇|村|寨|江|河|湖|海|谷|院|殿|帮|会|盟|派|寺|塔|衙|局))/g;
  const source = `${title} ${summary} ${content.slice(0, 300)}`;
  const found = Array.from(source.matchAll(suffixPattern), (match) => match[1] ?? "")
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !excludedNames.includes(item));

  return dedupe(found).slice(0, 5);
}

function updateWorldbookEntries(
  worldbook: WorldbookEntry[],
  chapterIndex: number,
  createdAt: string,
  summary: string,
  candidates: string[]
): { entries: WorldbookEntry[]; addedIds: string[]; updatedIds: string[] } {
  const nextEntries = [...worldbook];
  const addedIds: string[] = [];
  const updatedIds: string[] = [];

  for (const candidate of candidates) {
    const existingIndex = nextEntries.findIndex(
      (entry) => normalizeToken(entry.title) === normalizeToken(candidate)
    );

    if (existingIndex === -1) {
      const entry: WorldbookEntry = {
        id: buildId("worldbook", candidate),
        title: candidate,
        content: `第${chapterIndex}章提及：${summary}`,
        tags: ["auto"],
        sourceChapterIndices: [chapterIndex],
        lastUpdatedAt: createdAt
      };
      nextEntries.push(entry);
      addedIds.push(entry.id);
      continue;
    }

    const existing = nextEntries[existingIndex];
    if (!existing) {
      continue;
    }
    const hasCurrentChapter = existing.sourceChapterIndices.includes(chapterIndex);
    const nextContent = existing.content.includes(summary)
      ? existing.content
      : `${existing.content}\n最近提及：${summary}`.slice(0, 300);

    nextEntries[existingIndex] = {
      ...existing,
      content: nextContent,
      sourceChapterIndices: hasCurrentChapter
        ? existing.sourceChapterIndices
        : existing.sourceChapterIndices.concat(chapterIndex),
      lastUpdatedAt: createdAt
    };
    updatedIds.push(existing.id);
  }

  return { entries: nextEntries, addedIds, updatedIds };
}

function resolveForeshadowingItems(
  foreshadowing: ForeshadowingItem[],
  title: string,
  summary: string,
  chapterIndex: number,
  relatedCharacters: string[]
): { entries: ForeshadowingItem[]; addedIds: string[]; resolvedIds: string[] } {
  const revealTokens = ["揭开", "真相", "原来", "兑现", "回收", "答案"];
  const hintTokens = ["伏笔", "线索", "秘密", "预兆", "密信", "玉佩", "遗诏"];
  const chapterKeywords = splitKeywords(`${title} ${summary}`);
  const resolvedIds: string[] = [];

  const nextEntries = foreshadowing.map((item) => {
    if (item.status === "resolved") {
      return item;
    }

    const overlap = chapterKeywords.some(
      (keyword) =>
        item.clue.includes(keyword) || item.notes.includes(keyword)
    );
    const shouldResolve =
      overlap && revealTokens.some((token) => `${title} ${summary}`.includes(token));

    if (!shouldResolve) {
      return item;
    }

    resolvedIds.push(item.id);
    return {
      ...item,
      status: "resolved" as const,
      payoffChapter: chapterIndex,
      notes: `${item.notes}；第${chapterIndex}章出现回收信号`,
      relatedCharacters: dedupe([...item.relatedCharacters, ...relatedCharacters])
    };
  });

  if (!hintTokens.some((token) => `${title} ${summary}`.includes(token))) {
    return { entries: nextEntries, addedIds: [], resolvedIds };
  }

  const addedItem: ForeshadowingItem = {
    id: `foreshadowing-${chapterIndex}`,
    clue: title,
    status: "open",
    introducedInChapter: chapterIndex,
    payoffChapter: null,
    notes: summary,
    relatedCharacters
  };

  return {
    entries: nextEntries
      .filter((item) => item.id !== addedItem.id)
      .concat(addedItem)
      .sort((left, right) => left.introducedInChapter - right.introducedInChapter),
    addedIds: [addedItem.id],
    resolvedIds
  };
}

export function summarizeChapterContent(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 200);
}

export class MemoryWriter {
  constructor(private readonly manager: MemoryManager) {}

  private async writeUpdateArtifact(
    artifactsDir: string,
    chapterIndex: number,
    report: MemoryUpdateReport
  ): Promise<string> {
    const chapterArtifactDir = path.join(
      artifactsDir,
      `chapter-${String(chapterIndex).padStart(3, "0")}`
    );
    await fs.mkdir(chapterArtifactDir, { recursive: true });
    const filepath = path.join(chapterArtifactDir, "memory-update.json");
    await fs.writeFile(filepath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    return filepath;
  }

  async recordChapter(
    input: RecordChapterMemoryInput & { artifactsDir?: string }
  ): Promise<ChapterMemoryUpdateResult> {
    const currentMemory = await this.manager.load();
    const summaryText = summarizeChapterContent(input.content);
    const mentionedCharacters = detectMentionedCharacters(
      currentMemory.characters,
      `${input.title}\n${input.content}`
    );
    const summary: ChapterSummaryMemory = {
      chapterIndex: input.chapterIndex,
      title: input.title,
      summary: summaryText,
      keywords: buildKeywordList(input.title, summaryText, mentionedCharacters),
      createdAt: input.createdAt
    };
    const updatedCharacters = currentMemory.characters.map((character) => {
      const matched = mentionedCharacters.some((item) => item.id === character.id);
      if (!matched) {
        return character;
      }

      const event = extractCharacterEvent(
        character,
        input.title,
        input.content,
        summaryText
      );

      return {
        ...character,
        currentStatus: event,
        latestSummary: event,
        lastSeenChapter: input.chapterIndex,
        recentEvents: mergeRecentEvents(character.recentEvents, event),
        sourceChapterIndices: dedupe(
          character.sourceChapterIndices.concat(input.chapterIndex)
        )
      };
    });
    const timelineEvent: TimelineEvent = {
      id: `timeline-chapter-${input.chapterIndex}`,
      chapterIndex: input.chapterIndex,
      title: input.title,
      summary: summaryText,
      participants: mentionedCharacters.map((character) => character.name),
      consequences: [summaryText],
      keywords: buildKeywordList(input.title, summaryText, mentionedCharacters),
      occurredAt: input.createdAt
    };
    const worldbookChanges = updateWorldbookEntries(
      currentMemory.worldbook,
      input.chapterIndex,
      input.createdAt,
      summaryText,
      extractWorldbookCandidates(
        input.title,
        summaryText,
        input.content,
        currentMemory.characters.map((character) => character.name)
      )
    );
    const foreshadowingChanges = resolveForeshadowingItems(
      currentMemory.foreshadowing,
      input.title,
      summaryText,
      input.chapterIndex,
      mentionedCharacters.map((character) => character.name)
    );

    const nextMemory: ProjectMemoryData = {
      ...currentMemory,
      characters: updatedCharacters,
      worldbook: worldbookChanges.entries,
      summaries: currentMemory.summaries
        .filter((item) => item.chapterIndex !== input.chapterIndex)
        .concat(summary)
        .sort((left, right) => left.chapterIndex - right.chapterIndex),
      timeline: currentMemory.timeline
        .filter((item) => item.chapterIndex !== input.chapterIndex)
        .concat(timelineEvent)
        .sort((left, right) => left.chapterIndex - right.chapterIndex),
      foreshadowing: foreshadowingChanges.entries
    };

    await this.manager.writeAll(nextMemory);

    const report: MemoryUpdateReport = {
      chapterIndex: input.chapterIndex,
      title: input.title,
      createdAt: input.createdAt,
      summary,
      timelineEvent,
      matchedCharacterIds: mentionedCharacters.map((character) => character.id),
      characterChanges: {
        updatedIds: mentionedCharacters.map((character) => character.id)
      },
      worldbookChanges: {
        addedIds: worldbookChanges.addedIds,
        updatedIds: worldbookChanges.updatedIds
      },
      foreshadowingChanges: {
        addedIds: foreshadowingChanges.addedIds,
        resolvedIds: foreshadowingChanges.resolvedIds
      }
    };

    if (input.artifactsDir) {
      await this.writeUpdateArtifact(
        input.artifactsDir,
        input.chapterIndex,
        report
      );
    }

    return {
      memory: nextMemory,
      summary,
      timelineEvent,
      mentionedCharacterIds: mentionedCharacters.map((character) => character.id),
      report
    };
  }
}
