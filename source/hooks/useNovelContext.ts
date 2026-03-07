import { useCallback, useMemo } from "react";
import type { Character } from "../types/index.js";
import type { NovelProject, ProjectChapter } from "../types/project.js";
import { ContextManager } from "../services/context-manager.js";

export function useNovelContext() {
  const manager = useMemo(() => new ContextManager(), []);

  const hydrateProject = useCallback((
    project: Pick<NovelProject, "outline" | "characters" | "chapters">
  ) => manager.loadProject(project), [manager]);
  const setOutline = useCallback((outline: string) => manager.setOutline(outline), [
    manager
  ]);
  const addCharacter = useCallback(
    (character: Character) => manager.addCharacter(character),
    [manager]
  );
  const addChapter = useCallback(
    (chapter: ProjectChapter) => manager.addChapter(chapter),
    [manager]
  );
  const buildContext = useCallback(() => manager.buildContext(), [manager]);

  return { hydrateProject, setOutline, addCharacter, addChapter, buildContext };
}
