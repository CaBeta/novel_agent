import { useCallback, useMemo } from "react";
import type { ProjectMemoryData } from "../types/memory.js";
import { ContextManager } from "../services/context-manager.js";

export function useNovelContext() {
  const manager = useMemo(() => new ContextManager(), []);

  const hydrateProject = useCallback(
    (project: { outline: string; memory: ProjectMemoryData }) =>
      manager.loadProject(project),
    [manager]
  );
  const buildContext = useCallback(
    (topic: string) => manager.buildContext(topic),
    [manager]
  );

  return { hydrateProject, buildContext };
}
