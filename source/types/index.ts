export type AppStep = "input" | "writing" | "done" | "error";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Chapter {
  index: number;
  title: string;
  content: string;
  summary: string;
  createdAt: string;
}

export interface Character {
  name: string;
  description: string;
  traits: string[];
}

export interface NovelProject {
  title: string;
  genre: string;
  outline: string;
  characters: Character[];
  chapters: Chapter[];
}

export interface GenerateOptions {
  topic: string;
  context: string;
  signal?: AbortSignal;
}
