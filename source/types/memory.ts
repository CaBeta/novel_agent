export interface CharacterMemory {
  id: string;
  name: string;
  description: string;
  traits: string[];
  goals: string[];
  secrets: string[];
  currentStatus: string;
  aliases: string[];
  latestSummary: string;
  lastSeenChapter: number | null;
  recentEvents: string[];
  sourceChapterIndices: number[];
}

export interface WorldbookEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  sourceChapterIndices: number[];
  lastUpdatedAt: string;
}

export interface TimelineEvent {
  id: string;
  chapterIndex: number;
  title: string;
  summary: string;
  participants: string[];
  consequences: string[];
  keywords: string[];
  occurredAt: string;
}

export interface ForeshadowingItem {
  id: string;
  clue: string;
  status: "open" | "resolved";
  introducedInChapter: number;
  payoffChapter: number | null;
  notes: string;
  relatedCharacters: string[];
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
  report: MemoryUpdateReport;
}

export interface MemoryUpdateReport {
  chapterIndex: number;
  title: string;
  createdAt: string;
  summary: ChapterSummaryMemory;
  timelineEvent: TimelineEvent;
  matchedCharacterIds: string[];
  characterChanges: {
    updatedIds: string[];
  };
  worldbookChanges: {
    addedIds: string[];
    updatedIds: string[];
  };
  foreshadowingChanges: {
    addedIds: string[];
    resolvedIds: string[];
  };
}
