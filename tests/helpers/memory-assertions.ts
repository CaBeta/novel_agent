import { expect } from "vitest";
import type {
  ChapterMemoryUpdateResult,
  CharacterRelationMemory,
  ForeshadowingItem,
  ProjectMemoryData
} from "../../source/types/memory.js";
import type { FixtureChapter } from "./fixture-loader.js";

function asSet(values: string[]): Set<string> {
  return new Set(values.filter(Boolean));
}

function normalizeToken(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function sameRelationPair(
  relation: CharacterRelationMemory,
  expected: { from: string; to: string }
): boolean {
  const actual = [
    normalizeToken(relation.fromCharacterName),
    normalizeToken(relation.toCharacterName)
  ].sort();
  const target = [normalizeToken(expected.from), normalizeToken(expected.to)].sort();

  return actual[0] === target[0] && actual[1] === target[1];
}

function containsLooseToken(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizeToken(haystack);
  const normalizedNeedle = normalizeToken(needle);

  return (
    normalizedHaystack.includes(normalizedNeedle) ||
    normalizedNeedle.includes(normalizedHaystack)
  );
}

export function expectMentionedCharacters(
  result: ChapterMemoryUpdateResult,
  expectedNames: string[]
): void {
  const matchedNames = result.memory.characters
    .filter((character) => result.mentionedCharacterIds.includes(character.id))
    .map((character) => character.name);

  for (const name of expectedNames) {
    expect(matchedNames).toContain(name);
  }
}

export function expectTimelineParticipants(
  result: ChapterMemoryUpdateResult,
  expectedNames: string[]
): void {
  const participants = asSet(result.timelineEvent.participants);

  for (const name of expectedNames) {
    expect(participants.has(name)).toBe(true);
  }
}

export function expectMemoryContainsCharacters(
  memory: ProjectMemoryData,
  expectedNames: string[]
): void {
  const names = asSet(memory.characters.map((character) => character.name));

  for (const name of expectedNames) {
    expect(names.has(name)).toBe(true);
  }
}

export function expectTextContainsTokens(
  text: string,
  expectedTokens: string[]
): void {
  for (const token of expectedTokens) {
    expect(text).toContain(token);
  }
}

export function expectTextContainsAnyToken(
  text: string,
  expectedTokens: string[]
): void {
  expect(expectedTokens.some((token) => text.includes(token))).toBe(true);
}

export function expectRelationExists(
  relations: CharacterRelationMemory[],
  expectedRelations: NonNullable<FixtureChapter["expected"]["relations"]>,
  options: { strictType?: boolean } = {}
): void {
  for (const expectedRelation of expectedRelations) {
    const matched = relations.find((relation) => {
      if (!sameRelationPair(relation, expectedRelation)) {
        return false;
      }

      if (!options.strictType) {
        return true;
      }

      return relation.relationType === expectedRelation.type;
    });

    expect(matched).toBeDefined();
  }
}

export function expectWorldbookContains(
  memory: ProjectMemoryData,
  expectedTitles: string[],
  options: { match?: "all" | "any" } = {}
): void {
  const matches = expectedTitles.map((title) =>
    memory.worldbook.some(
      (entry) =>
        containsLooseToken(entry.title, title) ||
        containsLooseToken(entry.content, title)
    )
  );

  if ((options.match ?? "all") === "any") {
    expect(matches.some(Boolean)).toBe(true);
    return;
  }

  for (const matched of matches) {
    expect(matched).toBe(true);
  }
}

export function expectForeshadowingState(
  foreshadowing: ForeshadowingItem[],
  expected: NonNullable<FixtureChapter["expected"]["foreshadowing"]>,
  options: { match?: "all" | "any" } = {}
): void {
  const openMatches = (expected.open ?? []).map((clue) =>
    foreshadowing.some(
      (item) =>
        item.status === "open" &&
        (containsLooseToken(item.clue, clue) || containsLooseToken(item.notes, clue))
    )
  );

  const resolvedMatches = (expected.resolved ?? []).map((clue) =>
    foreshadowing.some(
      (item) =>
        item.status === "resolved" &&
        (containsLooseToken(item.clue, clue) || containsLooseToken(item.notes, clue))
    )
  );

  if ((options.match ?? "all") === "any") {
    const combined = openMatches.concat(resolvedMatches);
    if (combined.length > 0) {
      expect(combined.some(Boolean)).toBe(true);
    }
    return;
  }

  for (const matched of openMatches) {
    expect(matched).toBe(true);
  }

  for (const matched of resolvedMatches) {
    expect(matched).toBe(true);
  }
}
