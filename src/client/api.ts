import { exportPackageFileName, type ExportPackageOptions } from "./packageOptions";

export interface ApiSession {
  authenticated: boolean;
  csrfToken: string | null;
}

export interface Deck {
  id: string;
  name: string;
  parentId: string | null;
  jlptLevel: string;
  dailyNewLimit: number;
  dailyReviewLimit: number;
  fsrsRetention: number;
}

export interface DeckPreset {
  id: string;
  name: string;
  description: string;
  dailyNewLimit: number;
  dailyReviewLimit: number;
  fsrsRetention: number;
}

export interface ReviewCard {
  id: string;
  noteId: string;
  deckId: string;
  state: string;
  dueAt: string;
  reps: number;
  lapses: number;
  noteType: { id: string; name: string; css: string };
  template: { id: string; name: string; ord: number };
  fieldNames: string[];
  fields: Record<string, string>;
  tags: string[];
  question: string;
  answer: string;
}

export interface NoteDetail {
  id: string;
  deckId: string;
  sourceId: string | null;
  noteType: { id: string; name: string; css: string };
  fieldNames: string[];
  fields: Record<string, string>;
  tags: string[];
  cards: ReviewCard[];
  createdAt: string;
  updatedAt: string;
}

export interface CardListPayload {
  cards: ReviewCard[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export type CardBrowserState = "new" | "learning" | "review" | "relearning" | "suspended";

export type ReviewRating = "Again" | "Hard" | "Good" | "Easy";

export interface ReviewSchedulerOutput {
  state: string;
  dueAt: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  lastReview: string | null;
}

export interface ReviewAnswerPayload {
  card: ReviewCard;
  rating: ReviewRating;
  scheduler: ReviewSchedulerOutput;
}

export interface ReviewNextPayload {
  card: ReviewCard | null;
  previews: Record<ReviewRating, ReviewSchedulerOutput> | null;
}

export interface Draft {
  id: string;
  deckId: string | null;
  kind: string;
  front: string;
  back: string;
  pitchAccentStatus: string;
  fields: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface ImportJob {
  id: string;
  type: string;
  url: string;
  status: string;
  includeScheduling: boolean;
  error: string | null;
  result: Record<string, unknown> | null;
  generatedSource: {
    id: string;
    draftCards: number;
    approvedDrafts: number;
    rejectedDrafts: number;
    approvedCards: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaAsset {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  sourceId: string | null;
  createdAt: string;
  available: boolean;
}

export interface MediaUploadPayload {
  asset: MediaAsset;
  reference: string;
}

export interface SourceRecord {
  id: string;
  type: string;
  url: string;
  title: string;
  contentPreview: string;
  contentHash: string;
  drafts: { total: number; draft: number; approved: number; rejected: number };
  approvedNotes: number;
  createdAt: string;
}

export interface TagSummary {
  name: string;
  count: number;
}

export interface NoteTypeSummary {
  id: string;
  ankiId: number;
  name: string;
  css: string;
  builtIn: boolean;
  hasCss: boolean;
  noteCount: number;
  cardCount: number;
  fields: Array<{ id: string; ord: number; name: string }>;
  templates: Array<{ id: string; ord: number; name: string; questionFormat: string; answerFormat: string }>;
}

export interface NoteTypeDefinitionInput {
  name: string;
  css: string;
  fields: string[];
  templates: Array<{ name: string; questionFormat: string; answerFormat: string }>;
}

export interface StatsPayload {
  due: number;
  cards: number;
  reviews: number;
  drafts: number;
  daily: { newDone: number; newLimit: number; reviewDone: number; reviewLimit: number } | null;
  cardStates: Record<string, number>;
  ratings: Record<"Again" | "Hard" | "Good" | "Easy", number>;
  activity: Array<{ date: string; reviews: number }>;
  calendar: Array<{
    date: string;
    reviews: number;
    elapsedMs: number;
    ratings: Record<"Again" | "Hard" | "Good" | "Easy", number>;
  }>;
}

export interface RuntimeSettings {
  nodeEnv: string;
  storage: {
    dataDir: string;
    databaseConfigured: boolean;
    mediaDir: string;
    packageDir: string;
  };
  openai: {
    configured: boolean;
    baseUrlConfigured: boolean;
    textModel: string;
    ttsModel: string;
    ttsVoice: string;
  };
  providers: {
    structuredGeneration: "custom" | "openai" | "local-fallback";
    tts: "custom" | "openai" | "not-configured";
  };
  japanese: {
    pitchAccentLexiconConfigured: boolean;
    pitchAccentLexiconSource: string | null;
  };
  preferences: SettingsPreferences;
}

export interface SettingsPreferences {
  defaultJlptLevel: string;
  packageImport: {
    includeScheduling: boolean;
  };
  packageExport: {
    includeMedia: boolean;
    includeScheduling: boolean;
    legacySupport: boolean;
  };
}

export interface GenerationPreview {
  targetDeck: { id: string; name: string; jlptLevel: string } | null;
  jlptLevel: string;
  outputNoteType: string;
  maxDrafts: number;
  provider: "custom" | "openai" | "local-fallback";
  cardKinds: Array<{ kind: "vocabulary" | "grammar" | "pronunciation"; label: string; approvalCreatesAllTemplates: boolean }>;
  deckCoverage: {
    scope: "deck" | "all-decks";
    targetDeckId: string | null;
    totalJapaneseNotes: number;
    needsMaterial: boolean;
    insufficientKinds: Array<"vocabulary" | "grammar" | "pronunciation">;
    kinds: Array<{
      kind: "vocabulary" | "grammar" | "pronunciation";
      label: string;
      current: number;
      recommendedMinimum: number;
      missing: number;
      insufficient: boolean;
    }>;
  };
  explanationLanguages: Array<{ code: string; label: string }>;
  pitchAccentPolicy: {
    lexiconSourceConfirms: boolean;
    aiSourceRequiresReview: boolean;
    field: string;
  };
}

export class ApiClient {
  csrfToken: string | null = null;

  async session() {
    const session = await this.get<ApiSession>("/api/session");
    this.csrfToken = session.csrfToken;
    return session;
  }

  async login(password: string) {
    const session = await this.post<ApiSession>("/api/session/login", { password }, false);
    this.csrfToken = session.csrfToken;
    return session;
  }

  async logout() {
    return this.delete("/api/session");
  }

  async decks() {
    return this.get<{ decks: Deck[] }>("/api/decks");
  }

  async deck(id: string) {
    return this.get<Deck>(`/api/decks/${id}`);
  }

  async deckPresets() {
    return this.get<{ presets: DeckPreset[] }>("/api/deck-presets");
  }

  async createDeck(input: { name: string; jlptLevel: string; parentId?: string | null }) {
    return this.post<Deck>("/api/decks", input);
  }

  async updateDeck(
    id: string,
    input: Partial<Pick<Deck, "name" | "parentId" | "jlptLevel" | "dailyNewLimit" | "dailyReviewLimit" | "fsrsRetention">>
  ) {
    return this.patch<Deck>(`/api/decks/${id}`, input);
  }

  async unburyDeck(id: string) {
    return this.post<{ ok: true; restoredCards: number }>(`/api/decks/${id}/unbury`, {});
  }

  async applyDeckPreset(id: string, presetId: string) {
    return this.post<{ deck: Deck; preset: DeckPreset }>(`/api/decks/${id}/apply-preset`, { presetId });
  }

  async deleteDeck(id: string) {
    return this.delete<{ ok: true }>(`/api/decks/${id}`);
  }

  async cards(deckId?: string, tag?: string, search?: string, page?: { limit?: number; offset?: number; state?: CardBrowserState }) {
    const params = new URLSearchParams();
    if (deckId) params.set("deckId", deckId);
    if (tag) params.set("tag", tag);
    if (search?.trim()) params.set("q", search.trim());
    if (page?.limit !== undefined) params.set("limit", String(page.limit));
    if (page?.offset !== undefined) params.set("offset", String(page.offset));
    if (page?.state) params.set("state", page.state);
    const query = params.toString();
    return this.get<CardListPayload>(`/api/cards${query ? `?${query}` : ""}`);
  }

  async tags(deckId?: string) {
    return this.get<{ tags: TagSummary[] }>(`/api/tags${deckId ? `?deckId=${encodeURIComponent(deckId)}` : ""}`);
  }

  async noteTypes() {
    return this.get<{ noteTypes: NoteTypeSummary[] }>("/api/note-types");
  }

  async noteType(id: string) {
    return this.get<{ noteType: NoteTypeSummary }>(`/api/note-types/${encodeURIComponent(id)}`);
  }

  async createNoteType(input: NoteTypeDefinitionInput) {
    return this.post<{ noteType: NoteTypeSummary }>("/api/note-types", input);
  }

  async updateNoteType(id: string, input: Partial<NoteTypeDefinitionInput>) {
    return this.patch<{ noteType: NoteTypeSummary }>(`/api/note-types/${encodeURIComponent(id)}`, input);
  }

  async deleteNoteType(id: string) {
    return this.delete<{ ok: true }>(`/api/note-types/${encodeURIComponent(id)}`);
  }

  async renameTag(name: string, nextName: string, deckId?: string) {
    return this.patch<{ tag: TagSummary; updatedNotes: number }>(`/api/tags/${encodeURIComponent(name)}`, { name: nextName, deckId });
  }

  async deleteTag(name: string, deckId?: string) {
    return this.delete<{ ok: true; removedTag: string; updatedNotes: number }>(
      `/api/tags/${encodeURIComponent(name)}${deckId ? `?deckId=${encodeURIComponent(deckId)}` : ""}`
    );
  }

  async bulkTagState(name: string, action: "suspend" | "unsuspend", deckId?: string) {
    return this.post<{ ok: true; action: "suspend" | "unsuspend"; updatedCards: number }>(
      `/api/tags/${encodeURIComponent(name)}/bulk-state`,
      { action, deckId }
    );
  }

  async createCard(input: {
    deckId: string;
    noteTypeId?: string;
    fields: Record<string, string>;
    tags: string[];
    createAllTemplates?: boolean;
    templateNames?: string[];
  }) {
    return this.post<{ card: ReviewCard; cards: ReviewCard[] }>("/api/cards", input);
  }

  async createNote(input: {
    deckId: string;
    noteTypeId?: string;
    fields: Record<string, string>;
    tags: string[];
    createAllTemplates?: boolean;
    templateNames?: string[];
  }) {
    return this.post<{ note: NoteDetail }>("/api/notes", input);
  }

  async updateCard(id: string, input: { fields?: Record<string, string>; tags?: string[]; deckId?: string }) {
    return this.patch<{ card: ReviewCard }>(`/api/cards/${id}`, input);
  }

  async card(id: string) {
    return this.get<{ card: ReviewCard }>(`/api/cards/${id}`);
  }

  async note(id: string) {
    return this.get<{ note: NoteDetail }>(`/api/notes/${id}`);
  }

  async updateNote(id: string, input: { fields?: Record<string, string>; tags?: string[]; deckId?: string }) {
    return this.patch<{ note: NoteDetail }>(`/api/notes/${id}`, input);
  }

  async generateCardAudio(id: string, text?: string) {
    return this.post<{ audio: string; card: ReviewCard }>(`/api/cards/${id}/audio`, { text });
  }

  async suspendCard(id: string) {
    return this.post<{ card: ReviewCard }>(`/api/cards/${id}/suspend`, {});
  }

  async unsuspendCard(id: string) {
    return this.post<{ card: ReviewCard }>(`/api/cards/${id}/unsuspend`, {});
  }

  async resetCard(id: string) {
    return this.post<{ card: ReviewCard }>(`/api/cards/${id}/reset`, {});
  }

  async deleteCard(id: string) {
    return this.delete<{ ok: true }>(`/api/cards/${id}`);
  }

  async deleteNote(id: string) {
    return this.delete<{ ok: true; deletedCards: number }>(`/api/notes/${id}`);
  }

  async next(deckId?: string) {
    return this.get<ReviewNextPayload>(`/api/review/next${deckId ? `?deckId=${encodeURIComponent(deckId)}` : ""}`);
  }

  async answer(cardId: string, rating: ReviewRating, elapsedMs: number) {
    return this.post<ReviewAnswerPayload>(`/api/review/${cardId}/answer`, { rating, elapsedMs });
  }

  async buryReviewCard(cardId: string) {
    return this.post<{ card: ReviewCard; buriedUntil: string }>(`/api/review/${cardId}/bury`, {});
  }

  async undoReviewAnswer(cardId: string) {
    return this.post<{ card: ReviewCard; undoneReview: { id: string; rating: ReviewRating; reviewedAt: string }; restoredSiblingCards: number }>(
      `/api/review/${cardId}/undo`,
      {}
    );
  }

  async importApkg(url: string, includeScheduling = false) {
    return this.post<ImportJob>("/api/imports/apkg-url", { url, includeScheduling });
  }

  async retryImport(id: string) {
    return this.post<ImportJob & { retryOfImportId: string }>(`/api/imports/${id}/retry`, {});
  }

  async importApkgFile(file: File, includeScheduling = false) {
    const form = new FormData();
    form.set("file", file);
    form.set("includeScheduling", String(includeScheduling));
    const response = await fetch("/api/imports/apkg-file", {
      method: "POST",
      credentials: "include",
      headers: this.csrfToken ? { "x-csrf-token": this.csrfToken } : {},
      body: form
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error ?? "Import failed");
    }
    return payload;
  }

  async imports() {
    return this.get<{ imports: ImportJob[] }>("/api/imports");
  }

  async importJob(id: string) {
    return this.get<ImportJob>(`/api/imports/${id}`);
  }

  async jobs() {
    return this.get<{ jobs: JobRecord[] }>("/api/jobs");
  }

  async job(id: string) {
    return this.get<JobRecord>(`/api/jobs/${id}`);
  }

  async media() {
    return this.get<{ assets: MediaAsset[] }>("/api/media");
  }

  async mediaAsset(id: string) {
    return this.get<{ asset: MediaAsset }>(`/api/media/${id}`);
  }

  async uploadMedia(file: File) {
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/media", {
      method: "POST",
      credentials: "include",
      headers: this.csrfToken ? { "x-csrf-token": this.csrfToken } : {},
      body: form
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error ?? "Media upload failed");
    }
    return payload as MediaUploadPayload;
  }

  async sources() {
    return this.get<{ sources: SourceRecord[] }>("/api/sources");
  }

  async source(id: string) {
    return this.get<{ source: SourceRecord }>(`/api/sources/${id}`);
  }

  async regenerateSource(id: string, input: { deckId?: string; jlptLevel?: string } = {}) {
    return this.post<{ importId: string; sourceId: string; drafts: Draft[] }>(`/api/sources/${id}/regenerate`, input);
  }

  async settings() {
    return this.get<{ settings: RuntimeSettings }>("/api/settings");
  }

  async updateSettingsPreferences(input: SettingsPreferences) {
    return this.patch<{ preferences: SettingsPreferences }>("/api/settings/preferences", input);
  }

  async deleteMedia(id: string) {
    return this.delete<{ ok: true }>(`/api/media/${id}`);
  }

  async generateFromUrl(url: string, deckId?: string, jlptLevel?: string) {
    return this.post("/api/generation/from-url", { url, deckId, jlptLevel });
  }

  async generationPreview(deckId?: string) {
    return this.get<{ preview: GenerationPreview }>(`/api/generation/preview${deckId ? `?deckId=${encodeURIComponent(deckId)}` : ""}`);
  }

  async generateFromText(input: { title: string; text: string; deckId?: string; jlptLevel?: string }) {
    return this.post("/api/generation/from-text", input);
  }

  async generateFromFile(file: File, input: { title?: string; deckId?: string; jlptLevel?: string } = {}) {
    const form = new FormData();
    form.set("file", file);
    if (input.title?.trim()) form.set("title", input.title.trim());
    if (input.deckId) form.set("deckId", input.deckId);
    if (input.jlptLevel) form.set("jlptLevel", input.jlptLevel);
    const response = await fetch("/api/generation/from-file", {
      method: "POST",
      credentials: "include",
      headers: {
        ...(this.csrfToken ? { "x-csrf-token": this.csrfToken } : {})
      },
      body: form
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error ?? "Generation failed");
    }
    return payload;
  }

  async generateFromFiles(files: File[], input: { title?: string; deckId?: string; jlptLevel?: string } = {}) {
    const form = new FormData();
    for (const file of files) {
      form.append("files", file);
    }
    if (input.title?.trim()) form.set("title", input.title.trim());
    if (input.deckId) form.set("deckId", input.deckId);
    if (input.jlptLevel) form.set("jlptLevel", input.jlptLevel);
    const response = await fetch("/api/generation/from-files", {
      method: "POST",
      credentials: "include",
      headers: {
        ...(this.csrfToken ? { "x-csrf-token": this.csrfToken } : {})
      },
      body: form
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error ?? "Generation failed");
    }
    return payload;
  }

  async drafts(filters: { status?: string; deckId?: string; kind?: string; pitchAccentStatus?: string } = {}) {
    const params = new URLSearchParams();
    params.set("status", filters.status ?? "draft");
    if (filters.deckId) params.set("deckId", filters.deckId);
    if (filters.kind) params.set("kind", filters.kind);
    if (filters.pitchAccentStatus) params.set("pitchAccentStatus", filters.pitchAccentStatus);
    return this.get<{ drafts: Draft[] }>(`/api/drafts?${params.toString()}`);
  }

  async draft(id: string) {
    return this.get<{ draft: Draft }>(`/api/drafts/${id}`);
  }

  async approveDraft(id: string) {
    return this.post<{ noteId: string; cards: Array<{ id: string }> }>(`/api/drafts/${id}/approve`, {});
  }

  async approveDrafts(ids: string[], deckId?: string) {
    return this.post<{ approved: number; cardsCreated: number; noteIds: string[] }>("/api/drafts/approve-bulk", { ids, deckId });
  }

  async rejectDraft(id: string) {
    return this.post(`/api/drafts/${id}/reject`, {});
  }

  async rejectDrafts(ids: string[]) {
    return this.post<{ rejected: number }>("/api/drafts/reject-bulk", { ids });
  }

  async updateDraft(
    id: string,
    input: { fields?: Record<string, string>; tags?: string[]; pitchAccentStatus?: string; kind?: string; deckId?: string | null }
  ) {
    return this.patch<{ draft: Draft }>(`/api/drafts/${id}`, input);
  }

  async generateDraftAudio(id: string, text?: string) {
    return this.post<{ audio: string; draft: Draft }>(`/api/drafts/${id}/audio`, { text });
  }

  async generateDraftAudios(ids: string[]) {
    return this.post<{ generated: number; skipped: number; drafts: Draft[] }>("/api/drafts/audio-bulk", { ids });
  }

  async exportDeck(id: string, options: ExportPackageOptions = { includeMedia: true, includeScheduling: false, legacySupport: true }) {
    return this.downloadPackage(`/api/decks/${id}/export`, options, exportPackageFileName("deck", options));
  }

  async exportImport(id: string, options: ExportPackageOptions = { includeMedia: true, includeScheduling: false, legacySupport: true }) {
    return this.downloadPackage(`/api/imports/${id}/export`, options, exportPackageFileName("generated", options));
  }

  async exportSource(id: string, options: ExportPackageOptions = { includeMedia: true, includeScheduling: false, legacySupport: true }) {
    return this.downloadPackage(`/api/sources/${encodeURIComponent(id)}/export`, options, exportPackageFileName("source", options));
  }

  async downloadImportedPackage(id: string) {
    return this.downloadFile(`/api/imports/${encodeURIComponent(id)}/package`, "import.apkg");
  }

  private async downloadPackage(
    path: string,
    options: { includeMedia: boolean; includeScheduling: boolean; legacySupport: boolean },
    fallbackFileName: string
  ) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(this.csrfToken ? { "x-csrf-token": this.csrfToken } : {})
      },
      body: JSON.stringify(options)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? "Export failed");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const fileName = downloadFileName(disposition, fallbackFileName);
    return { blob, fileName };
  }

  private async downloadFile(path: string, fallbackFileName: string) {
    const response = await fetch(path, { credentials: "include" });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? "Download failed");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const fileName = downloadFileName(disposition, fallbackFileName);
    return { blob, fileName };
  }

  async stats() {
    return this.get<StatsPayload>("/api/stats");
  }

  async deckStats(deckId?: string) {
    return this.get<StatsPayload>(`/api/stats${deckId ? `?deckId=${encodeURIComponent(deckId)}` : ""}`);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  private async post<T>(path: string, body: unknown, includeCsrf = true): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(includeCsrf && this.csrfToken ? { "x-csrf-token": this.csrfToken } : {})
      },
      body: JSON.stringify(body)
    });
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(this.csrfToken ? { "x-csrf-token": this.csrfToken } : {})
      },
      body: JSON.stringify(body)
    });
  }

  private async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, {
      method: "DELETE",
      headers: this.csrfToken ? { "x-csrf-token": this.csrfToken } : {}
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, { credentials: "include", ...init });
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      throw new Error(typeof payload === "string" ? payload : payload.error ?? "Request failed");
    }
    return payload as T;
  }
}

function downloadFileName(disposition: string, fallback: string) {
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }
  return disposition.match(/filename="([^"]+)"/)?.[1] ?? fallback;
}
