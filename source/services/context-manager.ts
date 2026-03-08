import type { ProjectMemoryData } from "../types/memory.js";
import { MemoryRetriever } from "./memory/memory-retriever.js";

const MAX_CONTEXT_LENGTH = 3600;

export class ContextManager {
  private memory: ProjectMemoryData = {
    characters: [],
    relations: [],
    worldbook: [],
    timeline: [],
    foreshadowing: [],
    summaries: []
  };
  private outline = "";
  private readonly retriever = new MemoryRetriever();

  loadProject(project: { outline: string; memory: ProjectMemoryData }): void {
    this.outline = project.outline;
    this.memory = {
      characters: [...project.memory.characters],
      relations: [...project.memory.relations],
      worldbook: [...project.memory.worldbook],
      timeline: [...project.memory.timeline],
      foreshadowing: [...project.memory.foreshadowing],
      summaries: [...project.memory.summaries]
    };
  }

  buildContext(topic: string): string {
    const retrieval = this.retriever.retrieveForTopic(this.memory, topic);
    const parts: string[] = [];

    if (this.outline) {
      parts.push(`【大纲】\n${this.outline}`);
    }

    if (retrieval.characters.length > 0) {
      const characterDescriptions = retrieval.characters
        .map(
          (character) =>
            `- ${character.name}: ${character.description}；当前状态：${character.currentStatus}`
        )
        .join("\n");
      parts.push(`【相关角色】\n${characterDescriptions}`);
    }

    if (retrieval.relations.length > 0) {
      const relationshipDescriptions = retrieval.relations
        .map(
          (relation) =>
            `- ${relation.fromCharacterName} / ${relation.toCharacterName}: ${relation.currentStatus}`
        )
        .join("\n");
      parts.push(`【角色关系】\n${relationshipDescriptions}`);
    }

    if (retrieval.worldbook.length > 0) {
      const worldbookEntries = retrieval.worldbook
        .map((entry) => `- ${entry.title}: ${entry.content}`)
        .join("\n");
      parts.push(`【相关设定】\n${worldbookEntries}`);
    }

    if (retrieval.summaries.length > 0) {
      const recentSummaries = retrieval.summaries
        .map(
          (summary) =>
            `第${summary.chapterIndex}章「${summary.title}」: ${summary.summary}`
        )
        .join("\n");
      parts.push(`【相关章节摘要】\n${recentSummaries}`);
    }

    if (retrieval.timeline.length > 0) {
      const timelineEntries = retrieval.timeline
        .map(
          (event) =>
            `第${event.chapterIndex}章: ${event.summary}${
              event.participants.length > 0
                ? `（涉及：${event.participants.join("、")}）`
                : ""
            }`
        )
        .join("\n");
      parts.push(`【关键时间线】\n${timelineEntries}`);
    }

    if (retrieval.foreshadowing.length > 0) {
      const foreshadowingEntries = retrieval.foreshadowing
        .map((item) => `- 第${item.introducedInChapter}章埋下：${item.clue}`)
        .join("\n");
      parts.push(`【未回收伏笔】\n${foreshadowingEntries}`);
    }

    const context = parts.join("\n\n");
    if (context.length > MAX_CONTEXT_LENGTH) {
      return context.slice(-MAX_CONTEXT_LENGTH);
    }
    return context;
  }
}
