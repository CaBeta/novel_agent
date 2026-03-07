import type { Character } from "./index.js";

export interface ProjectChapter {
  index: number;
  title: string;
  summary: string;
  filepath: string;
  charCount: number;
  createdAt: string;
}

export interface NovelProjectMeta {
  id: string;
  slug: string;
  title: string;
  genre: string;
  createdAt: string;
  updatedAt: string;
  currentChapterIndex: number;
}

export interface NovelProject extends NovelProjectMeta {
  outline: string;
  characters: Character[];
  chapters: ProjectChapter[];
}

export interface ProjectState {
  currentProjectSlug: string | null;
  lastOpenedAt: string | null;
}

export interface ProjectPaths {
  rootDir: string;
  projectDir: string;
  projectFile: string;
  chaptersDir: string;
  outlinesDir: string;
  memoryDir: string;
  artifactsDir: string;
  stateDir: string;
}

export interface CreateProjectInput {
  title: string;
  slug?: string;
  genre?: string;
  outline?: string;
}
