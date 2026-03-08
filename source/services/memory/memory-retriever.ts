import type {
  ChapterSummaryMemory,
  CharacterRelationMemory,
  ForeshadowingItem,
  MemoryRetrievalResult,
  ProjectMemoryData,
  TimelineEvent,
  WorldbookEntry,
  CharacterMemory
} from "../../types/memory.js";

interface RetrievalOptions {
  maxCharacters?: number;
  maxWorldbook?: number;
  maxTimeline?: number;
  maxSummaries?: number;
  maxForeshadowing?: number;
}

function tokenizeTopic(topic: string): string[] {
  const normalized = topic.trim();
  if (!normalized) {
    return [];
  }

  const parts = normalized
    .split(/[\s,，。；;、/|]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);

  return Array.from(new Set([normalized, ...parts]));
}

function scoreTexts(tokens: string[], texts: Array<string | string[]>): number {
  if (tokens.length === 0) {
    return 0;
  }

  const haystack = texts
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .join(" ")
    .toLowerCase();

  return tokens.reduce((score, token) => {
    const lowerToken = token.toLowerCase();
    if (haystack.includes(lowerToken)) {
      return score + Math.max(2, lowerToken.length);
    }
    return score;
  }, 0);
}

function sortByScore<T>(
  items: T[],
  scorer: (item: T) => number,
  tieBreaker?: (item: T) => number
): Array<{ item: T; score: number }> {
  return items
    .map((item) => ({ item, score: scorer(item) }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return (tieBreaker?.(right.item) ?? 0) - (tieBreaker?.(left.item) ?? 0);
    });
}

function takeMatchedOrFallback<T>(
  scored: Array<{ item: T; score: number }>,
  limit: number
): T[] {
  const matched = scored.filter((entry) => entry.score > 0).slice(0, limit);
  if (matched.length > 0) {
    return matched.map((entry) => entry.item);
  }
  return scored.slice(0, limit).map((entry) => entry.item);
}

export class MemoryRetriever {
  retrieveForTopic(
    memory: ProjectMemoryData,
    topic: string,
    options: RetrievalOptions = {}
  ): MemoryRetrievalResult {
    const tokens = tokenizeTopic(topic);
    const maxCharacters = options.maxCharacters ?? 5;
    const maxWorldbook = options.maxWorldbook ?? 3;
    const maxTimeline = options.maxTimeline ?? 3;
    const maxSummaries = options.maxSummaries ?? 3;
    const maxForeshadowing = options.maxForeshadowing ?? 3;

    const characters = takeMatchedOrFallback(
      sortByScore<CharacterMemory>(
        memory.characters,
        (character) =>
          scoreTexts(tokens, [
            character.name,
            character.aliases,
            character.description,
            character.traits,
            character.currentStatus
          ]),
        () => 0
      ),
      maxCharacters
    );

    const characterIds = new Set(characters.map((item) => item.id));
    const relations = takeMatchedOrFallback(
      sortByScore<CharacterRelationMemory>(
        memory.relations.filter(
          (relation) =>
            characterIds.has(relation.fromCharacterId) ||
            characterIds.has(relation.toCharacterId)
        ),
        (relation) =>
          scoreTexts(tokens, [
            relation.fromCharacterName,
            relation.toCharacterName,
            relation.currentStatus,
            relation.latestSummary
          ]),
        (relation) => relation.lastUpdatedChapter
      ),
      4
    ).sort((left, right) => left.lastUpdatedChapter - right.lastUpdatedChapter);

    const worldbook = takeMatchedOrFallback(
      sortByScore<WorldbookEntry>(
        memory.worldbook,
        (entry) => scoreTexts(tokens, [entry.title, entry.content, entry.tags]),
        () => 0
      ),
      maxWorldbook
    );

    const summaries = takeMatchedOrFallback(
      sortByScore<ChapterSummaryMemory>(
        [...memory.summaries].sort((left, right) => right.chapterIndex - left.chapterIndex),
        (summary) => scoreTexts(tokens, [summary.title, summary.summary, summary.keywords]),
        (summary) => summary.chapterIndex
      ),
      maxSummaries
    ).sort((left, right) => left.chapterIndex - right.chapterIndex);

    const timeline = takeMatchedOrFallback(
      sortByScore<TimelineEvent>(
        [...memory.timeline].sort((left, right) => right.chapterIndex - left.chapterIndex),
        (event) =>
          scoreTexts(tokens, [
            event.title,
            event.summary,
            event.participants,
            event.consequences
          ]),
        (event) => event.chapterIndex
      ),
      maxTimeline
    ).sort((left, right) => left.chapterIndex - right.chapterIndex);

    const foreshadowing = takeMatchedOrFallback(
      sortByScore<ForeshadowingItem>(
        memory.foreshadowing.filter((item) => item.status === "open"),
        (item) => scoreTexts(tokens, [item.clue, item.notes]),
        (item) => item.introducedInChapter
      ),
      maxForeshadowing
    ).sort((left, right) => left.introducedInChapter - right.introducedInChapter);

    return {
      characters,
      relations,
      worldbook,
      timeline,
      foreshadowing,
      summaries,
      matchedKeywords: tokens
    };
  }
}
