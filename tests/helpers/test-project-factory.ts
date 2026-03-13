import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Character } from "../../source/types/index.js";
import type { NovelProject, ProjectPaths } from "../../source/types/project.js";
import { ProjectRepository } from "../../source/services/project/project-repository.js";
import { resolveProjectPaths } from "../../source/services/project/project-paths.js";
import type { FixtureChapter, FixtureProject } from "./fixture-loader.js";

function toProjectCharacters(characters: FixtureProject["characters"]): Character[] {
  return characters.map((character) => ({
    name: character.name,
    description: character.description,
    traits: character.traits
  }));
}

export async function createTestProject(
  fixtureProject: FixtureProject
): Promise<{
  cleanup: () => Promise<void>;
  project: NovelProject;
  projectPaths: ProjectPaths;
  rootDir: string;
}> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "novel-agent-tests-")
  );
  const repository = new ProjectRepository(rootDir);
  const slug = "test-novel";
  const baseProject = await repository.createProject({
    title: fixtureProject.title,
    slug,
    genre: fixtureProject.genre,
    outline: fixtureProject.outline
  });

  const project: NovelProject = {
    ...baseProject,
    characters: toProjectCharacters(fixtureProject.characters),
    chapters: []
  };

  await repository.writeProject(project);

  return {
    rootDir,
    project,
    projectPaths: resolveProjectPaths(rootDir, slug),
    cleanup: async () => {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  };
}

export function buildChapterRecord(
  chapter: FixtureChapter
): {
  chapterIndex: number;
  title: string;
  content: string;
  createdAt: string;
} {
  return {
    chapterIndex: chapter.index,
    title: chapter.title,
    content: chapter.originalText,
    createdAt: new Date(Date.UTC(2026, 0, chapter.index, 0, 0, 0)).toISOString()
  };
}
