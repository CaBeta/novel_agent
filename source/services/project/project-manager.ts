import { ProjectRepository } from "./project-repository.js";
import type {
  CreateProjectInput,
  NovelProject,
  NovelProjectMeta,
  ProjectChapter
} from "../../types/project.js";

function slugifyProjectTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  const slug = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "project";
}

function ensureUniqueSlug(baseSlug: string, existingSlugs: Set<string>): string {
  if (!existingSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let counter = 2;
  let candidate = `${baseSlug}-${counter}`;

  while (existingSlugs.has(candidate)) {
    counter += 1;
    candidate = `${baseSlug}-${counter}`;
  }

  return candidate;
}

export class ProjectManager {
  constructor(private readonly repository: ProjectRepository) {}

  async listProjects(): Promise<NovelProjectMeta[]> {
    return this.repository.listProjects();
  }

  async getCurrentProject(): Promise<NovelProject | null> {
    const state = await this.repository.readState();

    if (!state.currentProjectSlug) {
      return null;
    }

    try {
      return await this.repository.readProject(state.currentProjectSlug);
    } catch {
      await this.repository.writeState({
        currentProjectSlug: null,
        lastOpenedAt: state.lastOpenedAt
      });
      return null;
    }
  }

  async resolveInitialProject(autoLoadLastProject: boolean): Promise<NovelProject | null> {
    if (autoLoadLastProject) {
      const currentProject = await this.getCurrentProject();
      if (currentProject) {
        return currentProject;
      }
    }

    const projects = await this.listProjects();
    const [singleProject] = projects;
    if (projects.length === 1 && singleProject) {
      return this.openProject(singleProject.slug);
    }

    return null;
  }

  async openProject(slug: string): Promise<NovelProject> {
    const project = await this.repository.readProject(slug);
    await this.repository.writeState({
      currentProjectSlug: project.slug,
      lastOpenedAt: new Date().toISOString()
    });
    return project;
  }

  async createProject(input: CreateProjectInput): Promise<NovelProject> {
    const title = input.title.trim();
    if (!title) {
      throw new Error("项目标题不能为空");
    }

    const existing = await this.listProjects();
    const existingSlugs = new Set(existing.map((project) => project.slug));
    const baseSlug = input.slug?.trim() || slugifyProjectTitle(title);
    const slug = ensureUniqueSlug(baseSlug, existingSlugs);
    const project = await this.repository.createProject({
      ...input,
      title,
      slug
    });

    await this.repository.writeState({
      currentProjectSlug: project.slug,
      lastOpenedAt: new Date().toISOString()
    });

    return project;
  }

  async saveChapter(
    project: NovelProject,
    chapter: ProjectChapter
  ): Promise<NovelProject> {
    const nextChapters = project.chapters
      .filter((item) => item.index !== chapter.index)
      .concat(chapter)
      .sort((left, right) => left.index - right.index);

    const now = new Date().toISOString();
    const updatedProject: NovelProject = {
      ...project,
      chapters: nextChapters,
      currentChapterIndex: Math.max(project.currentChapterIndex, chapter.index),
      updatedAt: now
    };

    await this.repository.writeProject(updatedProject);
    await this.repository.writeState({
      currentProjectSlug: updatedProject.slug,
      lastOpenedAt: now
    });

    return updatedProject;
  }
}

export function createProjectManager(rootDir: string): ProjectManager {
  return new ProjectManager(new ProjectRepository(rootDir));
}
