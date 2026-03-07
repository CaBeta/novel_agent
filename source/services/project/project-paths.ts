import path from "node:path";
import type { ProjectPaths } from "../../types/project.js";

const PROJECT_FILE = "project.json";
const WORKSPACE_STATE_FILE = ".workspace.json";

export function resolveWorkspaceStatePath(rootDir: string): string {
  return path.join(rootDir, WORKSPACE_STATE_FILE);
}

export function resolveProjectPaths(
  rootDir: string,
  slug: string
): ProjectPaths {
  const projectDir = path.join(rootDir, slug);

  return {
    rootDir,
    projectDir,
    projectFile: path.join(projectDir, PROJECT_FILE),
    chaptersDir: path.join(projectDir, "chapters"),
    outlinesDir: path.join(projectDir, "outlines"),
    memoryDir: path.join(projectDir, "memory"),
    artifactsDir: path.join(projectDir, "artifacts"),
    stateDir: path.join(projectDir, "state")
  };
}
