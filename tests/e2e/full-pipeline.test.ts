import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasLocalFixtureData,
  loadFixtureData
} from "../helpers/fixture-loader.js";
import { buildWriterMessages } from "../../source/config/prompts.js";
import { ContextManager } from "../../source/services/context-manager.js";
import { MemoryExtractor } from "../../source/services/memory/memory-extractor.js";
import { MemoryManager } from "../../source/services/memory/memory-manager.js";
import { MemoryWriter } from "../../source/services/memory/memory-writer.js";
import type { MemoryUpdateReport } from "../../source/types/memory.js";
import { canRunRecordedLLM, createRecordingLLM } from "../helpers/llm-recorder.js";
import {
  buildChapterRecord,
  createTestProject
} from "../helpers/test-project-factory.js";

const fixtureDir = process.env["NOVEL_TEST_FIXTURES_DIR"]?.trim()
  ? process.env["NOVEL_TEST_FIXTURES_DIR"]!.trim()
  : path.resolve(process.cwd(), "tests/fixtures/test-novel");
const describeLocal =
  hasLocalFixtureData() && canRunRecordedLLM(fixtureDir) ? describe : describe.skip;

function calculateKeywordCoverage(text: string, keywords: string[]): {
  matched: string[];
  missing: string[];
  ratio: number;
} {
  const matched = keywords.filter((keyword) => text.includes(keyword));
  const missing = keywords.filter((keyword) => !text.includes(keyword));

  return {
    matched,
    missing,
    ratio: keywords.length === 0 ? 1 : matched.length / keywords.length
  };
}

describeLocal("full pipeline", () => {
  it("generates chapter content with a recorded or replayed LLM", async () => {
    const fixture = await loadFixtureData();
    const workspace = await createTestProject(fixture.project);
    const recordingLLM = await createRecordingLLM(fixture.fixtureDir);

    try {
      const memoryManager = new MemoryManager(workspace.projectPaths);
      await memoryManager.initialize(workspace.project);
      const memoryWriter = new MemoryWriter(
        memoryManager,
        new MemoryExtractor(recordingLLM.llm)
      );
      const contextManager = new ContextManager();
      const artifactsDir = path.join(workspace.projectPaths.artifactsDir, "e2e");

      await fs.mkdir(artifactsDir, { recursive: true });

      for (const chapter of fixture.chapters) {
        const currentMemory = await memoryManager.load();
        contextManager.loadProject({
          outline: fixture.project.outline,
          memory: currentMemory
        });

        const context = contextManager.buildContext(chapter.plotSummary);
        const messages = buildWriterMessages(chapter.plotSummary, context);
        const generatedText = await recordingLLM.llm.generateText(messages);
        const summaryKeywords = chapter.expected.summary?.mustContainKeywords ?? [];
        const keywordCoverage = calculateKeywordCoverage(
          generatedText,
          summaryKeywords
        );

        expect(generatedText.trim().length).toBeGreaterThan(100);
        expect(generatedText).toContain("陈远");
        if (summaryKeywords.length > 0) {
          expect(keywordCoverage.matched.length).toBeGreaterThan(0);
          expect(keywordCoverage.ratio).toBeGreaterThanOrEqual(0.5);
        }

        if (chapter.index > 1) {
          expect(context).toContain("【相关章节摘要】");
        }

        const result = await memoryWriter.recordChapter({
          ...buildChapterRecord(chapter),
          content: generatedText,
          artifactsDir
        });

        expect(result.summary.summary.length).toBeGreaterThan(0);
        expect(result.timelineEvent.title).toBe(chapter.title);

        const artifactPath = path.join(
          artifactsDir,
          `chapter-${String(chapter.index).padStart(3, "0")}`,
          "memory-update.json"
        );
        const artifact = JSON.parse(
          await fs.readFile(artifactPath, "utf8")
        ) as MemoryUpdateReport;

        expect(artifact.chapterIndex).toBe(chapter.index);
        expect(artifact.title).toBe(chapter.title);
        expect(artifact.createdAt).toBe(buildChapterRecord(chapter).createdAt);
        expect(artifact.extractionMode).toBe(result.report.extractionMode);
        expect(artifact.summary.chapterIndex).toBe(chapter.index);
        expect(artifact.summary.title).toBe(chapter.title);
        expect(artifact.timelineEvent.chapterIndex).toBe(chapter.index);
        expect(artifact.timelineEvent.title).toBe(chapter.title);
        expect(Array.isArray(artifact.matchedCharacterIds)).toBe(true);
        expect(Array.isArray(artifact.characterChanges.updatedIds)).toBe(true);
        expect(Array.isArray(artifact.relationChanges.addedIds)).toBe(true);
        expect(Array.isArray(artifact.relationChanges.updatedIds)).toBe(true);
        expect(Array.isArray(artifact.worldbookChanges.addedIds)).toBe(true);
        expect(Array.isArray(artifact.worldbookChanges.updatedIds)).toBe(true);
        expect(Array.isArray(artifact.foreshadowingChanges.addedIds)).toBe(true);
        expect(Array.isArray(artifact.foreshadowingChanges.resolvedIds)).toBe(
          true
        );
        expect(artifact).toEqual(result.report);
      }

      const finalMemory = await memoryManager.load();
      expect(finalMemory.summaries).toHaveLength(fixture.chapters.length);
      expect(finalMemory.timeline).toHaveLength(fixture.chapters.length);
      expect(finalMemory.characters.length).toBeGreaterThan(0);
      expect(recordingLLM.mode === "record" || recordingLLM.mode === "replay").toBe(
        true
      );
    } finally {
      await workspace.cleanup();
    }
  });
});
