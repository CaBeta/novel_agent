export type AppStep =
  | "loading"
  | "project"
  | "input"
  | "writing"
  | "done"
  | "error";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Character {
  name: string;
  description: string;
  traits: string[];
}

export interface GenerateOptions {
  topic: string;
  context: string;
  signal?: AbortSignal;
}
