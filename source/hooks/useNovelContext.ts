import { useMemo } from "react";
import type { Chapter, Character } from "../types/index.js";
import { ContextManager } from "../services/context-manager.js";

export function useNovelContext() {
  const manager = useMemo(() => new ContextManager(), []);

  const setOutline = (outline: string) => manager.setOutline(outline);
  const addCharacter = (character: Character) => manager.addCharacter(character);
  const addChapter = (chapter: Chapter) => manager.addChapter(chapter);
  const buildContext = () => manager.buildContext();

  return { setOutline, addCharacter, addChapter, buildContext };
}
