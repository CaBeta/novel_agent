import { describe, expect, it } from "vitest";
import { ContextManager } from "../../source/services/context-manager.js";
import { MemoryManager } from "../../source/services/memory/memory-manager.js";
import { MemoryWriter } from "../../source/services/memory/memory-writer.js";
import {
  hasLocalFixtureData,
  loadFixtureData
} from "../helpers/fixture-loader.js";
import {
  expectTextContainsAnyToken,
  expectMemoryContainsCharacters,
  expectTextContainsTokens
} from "../helpers/memory-assertions.js";
import {
  buildChapterRecord,
  createTestProject
} from "../helpers/test-project-factory.js";

const describeLocal = hasLocalFixtureData() ? describe : describe.skip;

describeLocal("context retrieval", () => {
  it("builds context from accumulated local fixture memory", async () => {
    const fixture = await loadFixtureData();
    const workspace = await createTestProject(fixture.project);

    try {
      const memoryManager = new MemoryManager(workspace.projectPaths);
      await memoryManager.initialize(workspace.project);
      const writer = new MemoryWriter(memoryManager);

      for (const retrievalCase of fixture.retrievalCases) {
        const chapters = fixture.chapters.filter(
          (chapter) => chapter.index <= retrievalCase.afterChapter
        );

        for (const chapter of chapters) {
          await writer.recordChapter(buildChapterRecord(chapter));
        }

        const memory = await memoryManager.load();
        const contextManager = new ContextManager();
        contextManager.loadProject({
          outline: fixture.project.outline,
          memory
        });

        const context = contextManager.buildContext(retrievalCase.topic);
        expect(context).toContain("【大纲】");

        if ((retrievalCase.expectedCharacters?.length ?? 0) > 0) {
          expectMemoryContainsCharacters(
            memory,
            retrievalCase.expectedCharacters ?? []
          );
          expectTextContainsTokens(context, retrievalCase.expectedCharacters ?? []);
        }

        if ((retrievalCase.mustMatchKeywords?.length ?? 0) > 0) {
          expectTextContainsAnyToken(
            context,
            retrievalCase.mustMatchKeywords ?? []
          );
        }

        if (retrievalCase.mustRetrieveForeshadowing) {
          const hasOpenForeshadowing = memory.foreshadowing.some(
            (item) => item.status === "open"
          );
          if (hasOpenForeshadowing) {
            expect(context).toContain("【未回收伏笔】");
          }
        }
      }
    } finally {
      await workspace.cleanup();
    }
  });
});
