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

export interface CharacterRelationMemory {
  id: string;
  fromCharacterId: string;
  toCharacterId: string;
  fromCharacterName: string;
  toCharacterName: string;
  relationType:
    | "allied"
    | "hostile"
    | "suspicious"
    | "protective"
    | "dependent"
    | "neutral";
  currentStatus: string;
  latestSummary: string;
  lastUpdatedChapter: number;
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
  relations: CharacterRelationMemory[];
  worldbook: WorldbookEntry[];
  timeline: TimelineEvent[];
  foreshadowing: ForeshadowingItem[];
  summaries: ChapterSummaryMemory[];
}

export interface MemoryRetrievalResult {
  characters: CharacterMemory[];
  relations: CharacterRelationMemory[];
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

export interface MemoryExtractionResult {
  characterUpdates: Array<{
    name: string;
    currentStatus: string;
    latestSummary: string;
    aliases: string[];
  }>;
  relationUpdates: Array<{
    fromName: string;
    toName: string;
    relationType:
      | "allied"
      | "hostile"
      | "suspicious"
      | "protective"
      | "dependent"
      | "neutral";
    currentStatus: string;
  }>;
  worldbookEntries: Array<{
    title: string;
    content: string;
    tags: string[];
  }>;
  timeline?: {
    summary: string;
    participants: string[];
    consequences: string[];
    keywords: string[];
  };
  foreshadowing: {
    open: Array<{
      clue: string;
      notes: string;
      relatedCharacters: string[];
    }>;
    resolve: Array<{
      clue: string;
      notes: string;
      relatedCharacters: string[];
    }>;
  };
}

export interface MemoryUpdateReport {
  chapterIndex: number;
  title: string;
  createdAt: string;
  summary: ChapterSummaryMemory;
  timelineEvent: TimelineEvent;
  matchedCharacterIds: string[];
  extractionMode: "rules" | "rules+llm";
  characterChanges: {
    updatedIds: string[];
  };
  relationChanges: {
    addedIds: string[];
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
