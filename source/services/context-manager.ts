import type { Character } from "../types/index.js";
import type { NovelProject, ProjectChapter } from "../types/project.js";

const MAX_CONTEXT_LENGTH = 3000;

export class ContextManager {
  private chapters: ProjectChapter[] = [];
  private characters: Character[] = [];
  private outline = "";

  loadProject(project: Pick<NovelProject, "outline" | "characters" | "chapters">): void {
    this.outline = project.outline;
    this.characters = [...project.characters];
    this.chapters = [...project.chapters];
  }

  setOutline(outline: string): void {
    this.outline = outline;
  }

  addCharacter(character: Character): void {
    this.characters.push(character);
  }

  addChapter(chapter: ProjectChapter): void {
    this.chapters.push(chapter);
  }

  buildContext(): string {
    const parts: string[] = [];

    if (this.outline) {
      parts.push(`【大纲】\n${this.outline}`);
    }

    if (this.characters.length > 0) {
      const characterDescriptions = this.characters
        .map((character) => `- ${character.name}: ${character.description}`)
        .join("\n");
      parts.push(`【主要角色】\n${characterDescriptions}`);
    }

    if (this.chapters.length > 0) {
      const recentSummaries = this.chapters
        .slice(-3)
        .map(
          (chapter) =>
            `第${chapter.index}章「${chapter.title}」: ${chapter.summary}`
        )
        .join("\n");
      parts.push(`【近期章节摘要】\n${recentSummaries}`);
    }

    const context = parts.join("\n\n");
    if (context.length > MAX_CONTEXT_LENGTH) {
      return context.slice(-MAX_CONTEXT_LENGTH);
    }
    return context;
  }
}
