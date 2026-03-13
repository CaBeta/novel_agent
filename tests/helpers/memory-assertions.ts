import { expect } from "vitest";
import type {
  ChapterMemoryUpdateResult,
  ProjectMemoryData
} from "../../source/types/memory.js";

function asSet(values: string[]): Set<string> {
  return new Set(values.filter(Boolean));
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
