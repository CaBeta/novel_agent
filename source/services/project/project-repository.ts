import fs from "node:fs/promises";
import type {
  CreateProjectInput,
  NovelProject,
  NovelProjectMeta,
  ProjectPaths,
  ProjectState
} from "../../types/project.js";
import {
  resolveProjectPaths,
  resolveWorkspaceStatePath
} from "./project-paths.js";

const DEFAULT_PROJECT_STATE: ProjectState = {
  currentProjectSlug: null,
  lastOpenedAt: null
};

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function readJsonFile<T>(filepath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filepath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filepath: string, data: unknown): Promise<void> {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filepath, content, "utf-8");
}

function toProjectMeta(project: NovelProject): NovelProjectMeta {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    genre: project.genre,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    currentChapterIndex: project.currentChapterIndex
  };
}

export class ProjectRepository {
  constructor(private readonly rootDir: string) {}

  async ensureWorkspace(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async ensureProjectDirectories(slug: string): Promise<ProjectPaths> {
    const paths = resolveProjectPaths(this.rootDir, slug);

    await Promise.all([
      fs.mkdir(paths.projectDir, { recursive: true }),
      fs.mkdir(paths.chaptersDir, { recursive: true }),
      fs.mkdir(paths.outlinesDir, { recursive: true }),
      fs.mkdir(paths.memoryDir, { recursive: true }),
      fs.mkdir(paths.artifactsDir, { recursive: true }),
      fs.mkdir(paths.stateDir, { recursive: true })
    ]);

    return paths;
  }

  async listProjects(): Promise<NovelProjectMeta[]> {
    await this.ensureWorkspace();

    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    const projects: NovelProjectMeta[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const project = await this.readProject(entry.name).catch((error) => {
        if (
          error instanceof Error &&
          error.message.startsWith("项目不存在")
        ) {
          return null;
        }
        throw error;
      });

      if (project) {
        projects.push(toProjectMeta(project));
      }
    }

    return projects.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  async readProject(slug: string): Promise<NovelProject> {
    const paths = resolveProjectPaths(this.rootDir, slug);
    const project = await readJsonFile<NovelProject>(paths.projectFile);

    if (!project) {
      throw new Error(`项目不存在: ${slug}`);
    }

    return project;
  }

  async writeProject(project: NovelProject): Promise<void> {
    const paths = await this.ensureProjectDirectories(project.slug);
    await writeJsonFile(paths.projectFile, project);
  }

  async createProject(
    input: CreateProjectInput & { slug: string }
  ): Promise<NovelProject> {
    const paths = resolveProjectPaths(this.rootDir, input.slug);
    const existing = await readJsonFile<NovelProject>(paths.projectFile);

    if (existing) {
      throw new Error(`项目已存在: ${input.slug}`);
    }

    const now = new Date().toISOString();
    const project: NovelProject = {
      id: `${input.slug}-${Date.now()}`,
      slug: input.slug,
      title: input.title.trim(),
      genre: input.genre?.trim() ?? "",
      outline: input.outline?.trim() ?? "",
      characters: [],
      chapters: [],
      createdAt: now,
      updatedAt: now,
      currentChapterIndex: 0
    };

    await this.writeProject(project);
    return project;
  }

  async readState(): Promise<ProjectState> {
    await this.ensureWorkspace();

    const state = await readJsonFile<ProjectState>(
      resolveWorkspaceStatePath(this.rootDir)
    );

    return state ?? DEFAULT_PROJECT_STATE;
  }

  async writeState(state: ProjectState): Promise<void> {
    await this.ensureWorkspace();
    await writeJsonFile(resolveWorkspaceStatePath(this.rootDir), state);
  }
}
