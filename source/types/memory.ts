export interface CharacterMemory {
  id: string;
  name: string;
  description: string;
  traits: string[];
  goals: string[];
  secrets: string[];
  currentStatus: string;
  aliases: string[];
}

export interface WorldbookEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
}

export interface TimelineEvent {
  id: string;
  chapterIndex: number;
  title: string;
  summary: string;
  participants: string[];
  consequences: string[];
  occurredAt: string;
}

export interface ForeshadowingItem {
  id: string;
  clue: string;
  status: "open" | "resolved";
  introducedInChapter: number;
  payoffChapter: number | null;
  notes: string;
}

export interface ChapterSummaryMemory {
  chapterIndex: number;
  title: string;
  summary: string;
  keywords: string[];
  createdAt: string;
}

export interface ProjectMemoryData {
  characters: CharacterMemory[];
  worldbook: WorldbookEntry[];
  timeline: TimelineEvent[];
  foreshadowing: ForeshadowingItem[];
  summaries: ChapterSummaryMemory[];
}

export interface MemoryRetrievalResult {
  characters: CharacterMemory[];
  worldbook: WorldbookEntry[];
  timeline: TimelineEvent[];
  foreshadowing: ForeshadowingItem[];
  summaries: ChapterSummaryMemory[];
  matchedKeywords: string[];
}

export interface ChapterMemoryUpdateResult {
  memory: ProjectMemoryData;
  summary: ChapterSummaryMemory;
  timelineEvent: TimelineEvent;
  mentionedCharacterIds: string[];
}
