import type {
  ChapterMemoryUpdateResult,
  ChapterSummaryMemory,
  CharacterMemory,
  ForeshadowingItem,
  ProjectMemoryData,
  TimelineEvent
} from "../../types/memory.js";
import { MemoryManager } from "./memory-manager.js";

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

function buildForeshadowingUpdates(
  chapterIndex: number,
  title: string,
  summary: string
): ForeshadowingItem[] {
  const combined = `${title} ${summary}`;
  const hintTokens = ["伏笔", "线索", "秘密", "预兆"];

  if (!hintTokens.some((token) => combined.includes(token))) {
    return [];
  }

  return [
    {
      id: `foreshadowing-${chapterIndex}`,
      clue: title,
      status: "open",
      introducedInChapter: chapterIndex,
      payoffChapter: null,
      notes: summary
    }
  ];
}

export function summarizeChapterContent(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 200);
}

export class MemoryWriter {
  constructor(private readonly manager: MemoryManager) {}

  async recordChapter(
    input: RecordChapterMemoryInput
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
    const timelineEvent: TimelineEvent = {
      id: `timeline-chapter-${input.chapterIndex}`,
      chapterIndex: input.chapterIndex,
      title: input.title,
      summary: summaryText,
      participants: mentionedCharacters.map((character) => character.name),
      consequences: [summaryText],
      occurredAt: input.createdAt
    };
    const foreshadowingUpdates = buildForeshadowingUpdates(
      input.chapterIndex,
      input.title,
      summaryText
    );

    const nextMemory: ProjectMemoryData = {
      ...currentMemory,
      summaries: currentMemory.summaries
        .filter((item) => item.chapterIndex !== input.chapterIndex)
        .concat(summary)
        .sort((left, right) => left.chapterIndex - right.chapterIndex),
      timeline: currentMemory.timeline
        .filter((item) => item.chapterIndex !== input.chapterIndex)
        .concat(timelineEvent)
        .sort((left, right) => left.chapterIndex - right.chapterIndex),
      foreshadowing: currentMemory.foreshadowing
        .filter((item) => item.id !== `foreshadowing-${input.chapterIndex}`)
        .concat(foreshadowingUpdates)
        .sort(
          (left, right) => left.introducedInChapter - right.introducedInChapter
        )
    };

    await this.manager.writeAll(nextMemory);

    return {
      memory: nextMemory,
      summary,
      timelineEvent,
      mentionedCharacterIds: mentionedCharacters.map((character) => character.id)
    };
  }
}
