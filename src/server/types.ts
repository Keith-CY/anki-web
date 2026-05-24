import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "./db/schema";

export type ReviewRating = "Again" | "Hard" | "Good" | "Easy";
export type CardState = "new" | "learning" | "review" | "relearning" | "suspended";
export type DraftKind = "vocabulary" | "grammar" | "pronunciation";
export type DraftStatus = "draft" | "approved" | "rejected";
export type ImportStatus = "queued" | "running" | "completed" | "failed";
export type JlptLevel = "N5" | "N4" | "N3" | "N2" | "N1" | "mixed";

export interface AppConfig {
  dataDir: string;
  databaseUrl: string;
  appPasswordHash: string;
  nodeEnv: "development" | "test" | "production";
  sessionSecret: string;
  openaiApiKey: string | null;
  openaiBaseUrl: string | null;
  openaiTextModel: string;
  openaiTtsModel: string;
  openaiTtsVoice: string;
  pitchAccentLexiconSource: string | null;
}

export interface CreateConfigInput {
  dataDir?: string;
  databaseUrl?: string;
  appPassword?: string | null;
  appPasswordHash?: string | null;
  nodeEnv?: string | null;
  sessionSecret?: string | null;
  openaiApiKey?: string | null;
  openaiBaseUrl?: string | null;
  openaiTextModel?: string | null;
  openaiTtsModel?: string | null;
  openaiTtsVoice?: string | null;
  pitchAccentLexiconSource?: string | null;
  ttsSynthesize?: TtsSynthesize | null;
  generateDrafts?: GenerateDrafts | null;
  fetchPublicUrl?: FetchPublicUrl | null;
}

export interface AppServices {
  config: AppConfig;
  db: Database.Database;
  orm: BetterSQLite3Database<typeof schema>;
  dataDir: string;
  mediaDir: string;
  packageDir: string;
  sessions: SessionStore;
  decks: DeckService;
  ttsSynthesize?: TtsSynthesize | null;
  generateDrafts?: GenerateDrafts | null;
  fetchPublicUrl?: FetchPublicUrl | null;
}

export type TtsSynthesize = (input: { text: string; voice: string; model: string }) => Promise<Buffer>;
export interface GenerateDraftsInput {
  sourceId: string;
  deckId: string;
  title: string;
  text: string;
  jlptLevel: JlptLevel;
  requestedKinds: DraftKind[];
  deckCoverage: GenerationDeckCoverage;
}

export interface GenerationDeckCoverageKind {
  kind: DraftKind;
  label: string;
  current: number;
  recommendedMinimum: number;
  missing: number;
  insufficient: boolean;
}

export interface GenerationDeckCoverage {
  scope: "deck" | "all-decks";
  targetDeckId: string | null;
  totalJapaneseNotes: number;
  needsMaterial: boolean;
  insufficientKinds: DraftKind[];
  kinds: GenerationDeckCoverageKind[];
}

export type GenerateDrafts = (input: GenerateDraftsInput) => Promise<unknown>;
export type FetchPublicUrl = (
  input: string,
  options: { maxBytes: number; contentTypes?: string[]; timeoutMs?: number }
) => Promise<{ url: string; contentType: string; buffer: Buffer; fileName?: string }>;

export interface SessionRecord {
  id: string;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface SessionStore {
  create(): SessionRecord;
  get(id: string | undefined): SessionRecord | null;
  delete(id: string | undefined): void;
}

export interface DeckService {
  createDeck(input: { name: string; jlptLevel?: JlptLevel | null; parentId?: string | null }): DeckRecord;
  listDecks(): DeckRecord[];
  getDeck(id: string): DeckRecord | null;
}

export interface DeckRecord {
  id: string;
  ankiId: number;
  name: string;
  parentId: string | null;
  jlptLevel: JlptLevel;
  dailyNewLimit: number;
  dailyReviewLimit: number;
  fsrsRetention: number;
  createdAt: string;
  updatedAt: string;
}

export interface CardRecord {
  id: string;
  ankiId: number | null;
  noteId: string;
  deckId: string;
  templateId: string;
  state: CardState;
  dueAt: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  queue: string;
  buriedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportOptions {
  includeMedia: boolean;
  includeScheduling: boolean;
  legacySupport: boolean;
}

export interface ImportOptions {
  sourceUrl: string;
  includeScheduling: boolean;
}

export interface ImportResult {
  sourceId: string;
  packageFileName?: string;
  decksImported: number;
  noteTypesImported: number;
  notesImported: number;
  cardsImported: number;
  mediaImported: number;
}
