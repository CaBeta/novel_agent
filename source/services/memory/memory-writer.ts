import type {
  ChapterMemoryUpdateResult,
  ChapterSummaryMemory,
  CharacterMemory,
  CharacterRelationMemory,
  ForeshadowingItem,
  MemoryExtractionResult,
  MemoryUpdateReport,
  ProjectMemoryData,
  TimelineEvent,
  WorldbookEntry
} from "../../types/memory.js";
import { MemoryManager } from "./memory-manager.js";
import { MemoryExtractor } from "./memory-extractor.js";
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

function determineRelationType(summary: string): CharacterRelationMemory["relationType"] {
  if (/(联手|合作|结盟|并肩|帮助)/.test(summary)) {
    return "allied";
  }
  if (/(敌对|追杀|冲突|交锋|对峙)/.test(summary)) {
    return "hostile";
  }
  if (/(怀疑|提防|试探|警惕)/.test(summary)) {
    return "suspicious";
  }
  if (/(保护|庇护|救下|守住)/.test(summary)) {
    return "protective";
  }
  if (/(依赖|仰仗|听命|倚靠)/.test(summary)) {
    return "dependent";
  }
  return "neutral";
}

function relationTypeFromText(
  value: string | undefined,
  fallback: CharacterRelationMemory["relationType"]
): CharacterRelationMemory["relationType"] {
  if (
    value === "allied" ||
    value === "hostile" ||
    value === "suspicious" ||
    value === "protective" ||
    value === "dependent" ||
    value === "neutral"
  ) {
    return value;
  }
  return fallback;
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

function buildRelationId(leftId: string, rightId: string): string {
  return [leftId, rightId].sort().join("__");
}

function buildRelationStatus(
  left: CharacterMemory,
  right: CharacterMemory,
  content: string,
  fallback: string
): string {
  const sentences = splitSentences(content);
  const matched = sentences.filter(
    (sentence) =>
      sentence.includes(left.name) && sentence.includes(right.name)
  );

  if (matched.length === 0) {
    return fallback;
  }

  return matched.slice(0, 2).join("；").slice(0, 120);
}

function updateCharacterRelations(
  relations: CharacterRelationMemory[],
  mentionedCharacters: CharacterMemory[],
  chapterIndex: number,
  content: string,
  summary: string
): { entries: CharacterRelationMemory[]; addedIds: string[]; updatedIds: string[] } {
  if (mentionedCharacters.length < 2) {
    return { entries: relations, addedIds: [], updatedIds: [] };
  }

  const nextEntries = [...relations];
  const addedIds: string[] = [];
  const updatedIds: string[] = [];

  for (let index = 0; index < mentionedCharacters.length; index += 1) {
    const left = mentionedCharacters[index];
    if (!left) {
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < mentionedCharacters.length; nextIndex += 1) {
      const right = mentionedCharacters[nextIndex];
      if (!right) {
        continue;
      }

      const relationId = buildRelationId(left.id, right.id);
      const status = buildRelationStatus(left, right, content, summary);
      const relationType = determineRelationType(status);
      const existingIndex = nextEntries.findIndex((item) => item.id === relationId);

      if (existingIndex === -1) {
        nextEntries.push({
          id: relationId,
          fromCharacterId: left.id,
          toCharacterId: right.id,
          fromCharacterName: left.name,
          toCharacterName: right.name,
          relationType,
          currentStatus: status,
          latestSummary: status,
          lastUpdatedChapter: chapterIndex,
          sourceChapterIndices: [chapterIndex]
        });
        addedIds.push(relationId);
        continue;
      }

      const existing = nextEntries[existingIndex];
      if (!existing) {
        continue;
      }

      nextEntries[existingIndex] = {
        ...existing,
        relationType,
        currentStatus: status,
        latestSummary: status,
        lastUpdatedChapter: chapterIndex,
        sourceChapterIndices: dedupe(
          existing.sourceChapterIndices.concat(chapterIndex)
        )
      };
      updatedIds.push(relationId);
    }
  }

  return {
    entries: nextEntries.sort(
      (left, right) => left.lastUpdatedChapter - right.lastUpdatedChapter
    ),
    addedIds,
    updatedIds
  };
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
    .filter(
      (item) =>
        item.length >= 2 &&
        !excludedNames.includes(item) &&
        !/[与和及并]/.test(item)
    );

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
  constructor(
    private readonly manager: MemoryManager,
    private readonly extractor?: MemoryExtractor
  ) {}

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
    const initialRelationChanges = updateCharacterRelations(
      currentMemory.relations,
      mentionedCharacters,
      input.chapterIndex,
      input.content,
      summaryText
    );
    const initialWorldbookCandidates = extractWorldbookCandidates(
      input.title,
      summaryText,
      input.content,
      currentMemory.characters.map((character) => character.name)
    );
    const initialForeshadowing = resolveForeshadowingItems(
      currentMemory.foreshadowing,
      input.title,
      summaryText,
      input.chapterIndex,
      mentionedCharacters.map((character) => character.name)
    );
    const extraction = await this.extractor?.extract({
      title: input.title,
      content: input.content,
      summary: summaryText,
      candidateCharacters: mentionedCharacters.map((character) => character.name),
      candidateRelations: initialRelationChanges.entries
        .filter((item) => item.lastUpdatedChapter === input.chapterIndex)
        .map((item) => ({
          from: item.fromCharacterName,
          to: item.toCharacterName,
          status: item.currentStatus
        })),
      candidateWorldbook: initialWorldbookCandidates,
      candidateForeshadowing: initialForeshadowing.addedIds
    });
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
      const llmCharacter = extraction?.characterUpdates.find(
        (item) => item.name === character.name
      );
      const mergedAliases = dedupe(
        character.aliases.concat(llmCharacter?.aliases ?? [])
      );
      const nextStatus =
        llmCharacter?.currentStatus.trim() || event;
      const nextLatestSummary =
        llmCharacter?.latestSummary.trim() || nextStatus;

      return {
        ...character,
        currentStatus: nextStatus,
        latestSummary: nextLatestSummary,
        lastSeenChapter: input.chapterIndex,
        aliases: mergedAliases,
        recentEvents: mergeRecentEvents(character.recentEvents, nextLatestSummary),
        sourceChapterIndices: dedupe(
          character.sourceChapterIndices.concat(input.chapterIndex)
        )
      };
    });
    const llmTimeline = extraction?.timeline;
    const timelineEvent: TimelineEvent = {
      id: `timeline-chapter-${input.chapterIndex}`,
      chapterIndex: input.chapterIndex,
      title: input.title,
      summary: llmTimeline?.summary.trim() || summaryText,
      participants:
        llmTimeline?.participants.filter(Boolean) ??
        mentionedCharacters.map((character) => character.name),
      consequences:
        llmTimeline?.consequences.filter(Boolean).slice(0, 4) ?? [summaryText],
      keywords:
        llmTimeline?.keywords.filter(Boolean).slice(0, 8) ??
        buildKeywordList(input.title, summaryText, mentionedCharacters),
      occurredAt: input.createdAt
    };
    const relationChanges = extraction
      ? mergeLLMRelations(
          currentMemory.relations,
          initialRelationChanges,
          extraction,
          currentMemory.characters,
          input.chapterIndex
        )
      : initialRelationChanges;
    const worldbookChanges = updateWorldbookEntries(
      currentMemory.worldbook,
      input.chapterIndex,
      input.createdAt,
      summaryText,
      dedupe(
        initialWorldbookCandidates.concat(
          extraction?.worldbookEntries.map((entry) => entry.title) ?? []
        )
      )
    );
    const llmWorldbookChanges = mergeLLMWorldbookEntries(
      worldbookChanges.entries,
      extraction,
      input.chapterIndex,
      input.createdAt
    );
    const foreshadowingChanges = mergeLLMForeshadowing(
      extraction,
      initialForeshadowing,
      currentMemory.foreshadowing,
      input.chapterIndex
    );

    const nextMemory: ProjectMemoryData = {
      ...currentMemory,
      characters: updatedCharacters,
      relations: relationChanges.entries,
      worldbook: llmWorldbookChanges.entries,
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
      extractionMode: extraction ? "rules+llm" : "rules",
      characterChanges: {
        updatedIds: mentionedCharacters.map((character) => character.id)
      },
      relationChanges: {
        addedIds: relationChanges.addedIds,
        updatedIds: relationChanges.updatedIds
      },
      worldbookChanges: {
        addedIds: llmWorldbookChanges.addedIds,
        updatedIds: llmWorldbookChanges.updatedIds
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

function mergeLLMRelations(
  currentRelations: CharacterRelationMemory[],
  ruleResult: {
    entries: CharacterRelationMemory[];
    addedIds: string[];
    updatedIds: string[];
  },
  extraction: MemoryExtractionResult,
  currentCharacters: CharacterMemory[],
  chapterIndex: number
): {
  entries: CharacterRelationMemory[];
  addedIds: string[];
  updatedIds: string[];
} {
  const nextEntries = [...ruleResult.entries];
  const addedIds = [...ruleResult.addedIds];
  const updatedIds = [...ruleResult.updatedIds];

  for (const relation of extraction.relationUpdates) {
    const fromCharacter = currentCharacters.find(
      (item) => item.name === relation.fromName
    );
    const toCharacter = currentCharacters.find(
      (item) => item.name === relation.toName
    );
    if (!fromCharacter || !toCharacter) {
      continue;
    }

    const relationId = buildRelationId(fromCharacter.id, toCharacter.id);
    const existingIndex = nextEntries.findIndex((item) => item.id === relationId);
    const relationType = relationTypeFromText(
      relation.relationType,
      determineRelationType(relation.currentStatus)
    );
    const currentStatus = relation.currentStatus.trim();

    if (existingIndex === -1) {
      nextEntries.push({
        id: relationId,
        fromCharacterId: fromCharacter.id,
        toCharacterId: toCharacter.id,
        fromCharacterName: fromCharacter.name,
        toCharacterName: toCharacter.name,
        relationType,
        currentStatus,
        latestSummary: currentStatus,
        lastUpdatedChapter: chapterIndex,
        sourceChapterIndices: [chapterIndex]
      });
      if (!addedIds.includes(relationId)) {
        addedIds.push(relationId);
      }
      continue;
    }

    const existing = nextEntries[existingIndex];
    if (!existing) {
      continue;
    }

    nextEntries[existingIndex] = {
      ...existing,
      relationType,
      currentStatus: currentStatus || existing.currentStatus,
      latestSummary: currentStatus || existing.latestSummary,
      lastUpdatedChapter: chapterIndex,
      sourceChapterIndices: dedupe(
        existing.sourceChapterIndices.concat(chapterIndex)
      )
    };
    if (!updatedIds.includes(relationId)) {
      updatedIds.push(relationId);
    }
  }

  return {
    entries: nextEntries.sort(
      (left, right) => left.lastUpdatedChapter - right.lastUpdatedChapter
    ),
    addedIds,
    updatedIds
  };
}

function mergeLLMWorldbookEntries(
  currentEntries: WorldbookEntry[],
  extraction: MemoryExtractionResult | null | undefined,
  chapterIndex: number,
  createdAt: string
): { entries: WorldbookEntry[]; addedIds: string[]; updatedIds: string[] } {
  if (!extraction || extraction.worldbookEntries.length === 0) {
    return { entries: currentEntries, addedIds: [], updatedIds: [] };
  }

  const nextEntries = [...currentEntries];
  const addedIds: string[] = [];
  const updatedIds: string[] = [];

  for (const item of extraction.worldbookEntries) {
    const title = item.title.trim();
    if (!title) {
      continue;
    }

    const entryId = buildId("worldbook", title);
    const existingIndex = nextEntries.findIndex((entry) => entry.id === entryId);
    const content = item.content.trim();
    const tags = dedupe(item.tags.filter(Boolean).concat("auto"));

    if (existingIndex === -1) {
      nextEntries.push({
        id: entryId,
        title,
        content,
        tags,
        sourceChapterIndices: [chapterIndex],
        lastUpdatedAt: createdAt
      });
      addedIds.push(entryId);
      continue;
    }

    const existing = nextEntries[existingIndex];
    if (!existing) {
      continue;
    }

    nextEntries[existingIndex] = {
      ...existing,
      content: content || existing.content,
      tags: dedupe(existing.tags.concat(tags)),
      sourceChapterIndices: dedupe(
        existing.sourceChapterIndices.concat(chapterIndex)
      ),
      lastUpdatedAt: createdAt
    };
    updatedIds.push(entryId);
  }

  return { entries: nextEntries, addedIds, updatedIds };
}

function mergeLLMForeshadowing(
  extraction: MemoryExtractionResult | null | undefined,
  ruleResult: {
    entries: ForeshadowingItem[];
    addedIds: string[];
    resolvedIds: string[];
  },
  currentForeshadowing: ForeshadowingItem[],
  chapterIndex: number
): { entries: ForeshadowingItem[]; addedIds: string[]; resolvedIds: string[] } {
  if (!extraction) {
    return ruleResult;
  }

  let nextEntries = [...ruleResult.entries];
  const addedIds = [...ruleResult.addedIds];
  const resolvedIds = [...ruleResult.resolvedIds];

  for (const item of extraction.foreshadowing.resolve) {
    const existingIndex = nextEntries.findIndex(
      (entry) =>
        entry.status === "open" &&
        (entry.clue.includes(item.clue) || item.clue.includes(entry.clue))
    );
    if (existingIndex === -1) {
      continue;
    }

    const existing = nextEntries[existingIndex];
    if (!existing) {
      continue;
    }

    nextEntries[existingIndex] = {
      ...existing,
      status: "resolved",
      payoffChapter: chapterIndex,
      notes: item.notes.trim() || existing.notes,
      relatedCharacters: dedupe(
        existing.relatedCharacters.concat(item.relatedCharacters)
      )
    };
    if (!resolvedIds.includes(existing.id)) {
      resolvedIds.push(existing.id);
    }
  }

  for (const item of extraction.foreshadowing.open) {
    const clue = item.clue.trim();
    if (!clue) {
      continue;
    }

    const entryId = buildId("foreshadowing", clue);
    const existingIndex = nextEntries.findIndex((entry) => entry.id === entryId);

    if (existingIndex === -1) {
      nextEntries.push({
        id: entryId,
        clue,
        status: "open",
        introducedInChapter: chapterIndex,
        payoffChapter: null,
        notes: item.notes.trim(),
        relatedCharacters: dedupe(item.relatedCharacters)
      });
      if (!addedIds.includes(entryId)) {
        addedIds.push(entryId);
      }
      continue;
    }

    const existing = nextEntries[existingIndex];
    if (!existing || existing.status === "resolved") {
      continue;
    }

    nextEntries[existingIndex] = {
      ...existing,
      notes: item.notes.trim() || existing.notes,
      relatedCharacters: dedupe(
        existing.relatedCharacters.concat(item.relatedCharacters)
      )
    };
  }

  return {
    entries: nextEntries.sort(
      (left, right) => left.introducedInChapter - right.introducedInChapter
    ),
    addedIds,
    resolvedIds
  };
}
