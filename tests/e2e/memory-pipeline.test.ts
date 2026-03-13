import { describe, expect, it } from "vitest";
import { MemoryManager } from "../../source/services/memory/memory-manager.js";
import { MemoryWriter } from "../../source/services/memory/memory-writer.js";
import {
  hasLocalFixtureData,
  loadFixtureData
} from "../helpers/fixture-loader.js";
import {
  expectMentionedCharacters,
  expectTimelineParticipants
} from "../helpers/memory-assertions.js";
import {
  buildChapterRecord,
  createTestProject
} from "../helpers/test-project-factory.js";

const describeLocal = hasLocalFixtureData() ? describe : describe.skip;

describeLocal("memory pipeline", () => {
  it("records local fixture chapters into project memory", async () => {
    const fixture = await loadFixtureData();
    const workspace = await createTestProject(fixture.project);
    const knownCharacterNames = new Set(
      fixture.project.characters.map((character) => character.name)
    );

    try {
      const memoryManager = new MemoryManager(workspace.projectPaths);
      await memoryManager.initialize(workspace.project);
      const writer = new MemoryWriter(memoryManager);

      for (const chapter of fixture.chapters) {
        const result = await writer.recordChapter(buildChapterRecord(chapter));

        expect(result.report.extractionMode).toBe("rules");
        expect(result.summary.summary.length).toBeGreaterThan(0);
        expect(result.summary.summary.length).toBeLessThanOrEqual(
          chapter.expected.summary?.maxLength ?? 200
        );

        if ((chapter.expected.mentionedCharacters?.length ?? 0) > 0) {
          const stableExpectedCharacters = (
            chapter.expected.mentionedCharacters ?? []
          ).filter((name) => knownCharacterNames.has(name));

          expectMentionedCharacters(
            result,
            stableExpectedCharacters
          );
        }

        if (
          (chapter.expected.timeline?.participantsMustInclude?.length ?? 0) > 0
        ) {
          expectTimelineParticipants(
            result,
            chapter.expected.timeline?.participantsMustInclude ?? []
          );
        }
      }

      const finalMemory = await memoryManager.load();
      expect(finalMemory.summaries).toHaveLength(fixture.chapters.length);
      expect(finalMemory.timeline).toHaveLength(fixture.chapters.length);
    } finally {
      await workspace.cleanup();
    }
  });
});
