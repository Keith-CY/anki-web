import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import type Database from "better-sqlite3";
import type { AppServices, DraftKind, GenerateDraftsInput, GenerationDeckCoverage, JlptLevel } from "../types";
import { checksum, id, nowIso, parseJson, safeFileName } from "../utils/id";
import { fetchPublicUrl } from "../imports/fetch";
import { completeJob, createJob, failJob } from "../jobs/service";
import { createJapaneseNote, deckScopeIds, defaultDeck, japaneseNoteTypeId, normalizeTags } from "../cards/service";
import { preserveRubyReadings } from "../htmlText";
import { generatedDraftsSchema, jsonSchemaForGeneratedDrafts, type GeneratedDraft } from "./schema";

export interface ArticleGenerationResult {
  importId: string;
  sourceId: string;
  drafts: Array<Record<string, unknown>>;
}

export class ImportJobFailure extends Error {
  constructor(
    readonly importId: string,
    message: string
  ) {
    super(message);
    this.name = "ImportJobFailure";
  }
}

export class GenerationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationInputError";
  }
}

const generationCardKinds = [
  { kind: "vocabulary" as const, label: "Vocabulary", approvalCreatesAllTemplates: false },
  { kind: "grammar" as const, label: "Grammar", approvalCreatesAllTemplates: false },
  { kind: "pronunciation" as const, label: "Pronunciation", approvalCreatesAllTemplates: true }
];

export function generationPreview(services: AppServices, deckId?: string | null) {
  const deck = deckId ? services.decks.getDeck(deckId) : null;
  const defaultLevel = defaultJlptLevel(services);
  return {
    targetDeck: deck ? { id: deck.id, name: deck.name, jlptLevel: deck.jlptLevel } : null,
    jlptLevel: deck?.jlptLevel ?? defaultLevel,
    outputNoteType: "Japanese Vocabulary Grammar Pronunciation",
    maxDrafts: 40,
    provider: services.generateDrafts ? "custom" : services.config.openaiApiKey ? "openai" : "local-fallback",
    cardKinds: generationCardKinds,
    deckCoverage: generationDeckCoverage(services.db, deck?.id ?? null, generationCardKinds),
    explanationLanguages: [
      { code: "zh", label: "Chinese" },
      { code: "en", label: "English" },
      { code: "ja", label: "Japanese" }
    ],
    pitchAccentPolicy: {
      lexiconSourceConfirms: Boolean(services.config.pitchAccentLexiconSource),
      aiSourceRequiresReview: true,
      field: "PitchAccentSource"
    }
  };
}

const generationCoverageMinimums = {
  vocabulary: 20,
  grammar: 10,
  pronunciation: 10
};

const generationCoverageTemplates = {
  vocabulary: ["Recognize", "Recall"],
  grammar: ["Grammar"],
  pronunciation: ["Pronunciation"]
};

function generationDeckCoverage(
  db: Database.Database,
  deckId: string | null,
  cardKinds: Array<{ kind: "vocabulary" | "grammar" | "pronunciation"; label: string }>
): GenerationDeckCoverage {
  const deckIds = deckId ? (deckScopeIds(db, deckId) ?? [deckId]) : null;
  const deckClause = deckIds?.length ? ` AND notes.deck_id IN (${placeholders(deckIds)})` : "";
  const deckParams = deckIds ?? [];
  const rows = db
    .prepare(`
      SELECT
        notes.id AS note_id,
        notes.note_type_id,
        notes.fields_json,
        notes.tags_json,
        note_types.name AS note_type_name,
        card_templates.name AS template_name
      FROM notes
      JOIN note_types ON note_types.id = notes.note_type_id
      LEFT JOIN cards ON cards.note_id = notes.id
      LEFT JOIN card_templates ON card_templates.id = cards.template_id
      WHERE 1 = 1${deckClause}
    `)
    .all(...deckParams) as Array<{
    note_id: string;
    note_type_id: string;
    note_type_name: string;
    fields_json: string;
    tags_json: string;
    template_name: string | null;
  }>;
  const notes = new Map<
    string,
    {
      noteTypeId: string;
      noteTypeName: string;
      fields: Record<string, string>;
      tags: string[];
      templates: Set<string>;
    }
  >();
  for (const row of rows) {
    const note =
      notes.get(row.note_id) ??
      {
        noteTypeId: row.note_type_id,
        noteTypeName: row.note_type_name,
        fields: parseJson<Record<string, string>>(row.fields_json, {}),
        tags: parseJson<string[]>(row.tags_json, []),
        templates: new Set<string>()
      };
    if (row.template_name) note.templates.add(row.template_name);
    notes.set(row.note_id, note);
  }
  const counts = { vocabulary: 0, grammar: 0, pronunciation: 0 };
  let totalJapaneseNotes = 0;
  for (const note of notes.values()) {
    const kind = coverageKindForNote(note);
    if (kind) counts[kind] += 1;
    if (kind) totalJapaneseNotes += 1;
  }
  const kinds = cardKinds.map((kind) => {
    const recommendedMinimum = generationCoverageMinimums[kind.kind];
    const current = counts[kind.kind];
    const missing = Math.max(0, recommendedMinimum - current);
    return {
      kind: kind.kind,
      label: kind.label,
      current,
      recommendedMinimum,
      missing,
      insufficient: missing > 0
    };
  });
  const insufficientKinds = kinds.filter((kind) => kind.insufficient).map((kind) => kind.kind);
  return {
    scope: deckId ? "deck" : "all-decks",
    targetDeckId: deckId,
    totalJapaneseNotes,
    needsMaterial: insufficientKinds.length > 0,
    insufficientKinds,
    kinds
  };
}

function coverageKindForTemplates(templates: Set<string>) {
  if (generationCoverageTemplates.pronunciation.some((template) => templates.has(template))) return "pronunciation";
  if (generationCoverageTemplates.grammar.some((template) => templates.has(template))) return "grammar";
  if (generationCoverageTemplates.vocabulary.some((template) => templates.has(template))) return "vocabulary";
  return null;
}

function explicitCoverageKind(text: string) {
  if (/\bpronunciation\b|\bpronunciation-drill\b|発音|はつおん|音調|声調/.test(text)) return "pronunciation";
  if (/\bgrammar\b|文法|ぶんぽう|语法|語法/.test(text)) return "grammar";
  if (/\bvocab(?:ulary)?\b|\bword(?:s)?\b|語彙|単語|词汇|单词/.test(text)) return "vocabulary";
  return null;
}

function coverageKindForNote(note: {
  noteTypeId: string;
  noteTypeName: string;
  fields: Record<string, string>;
  tags: string[];
  templates: Set<string>;
}) {
  const tagKind = explicitCoverageKind(note.tags.join(" ").toLowerCase());
  if (tagKind) return tagKind;
  const templateKind = coverageKindForTemplates(note.templates);
  const fieldValues = Object.values(note.fields).join("\n");
  const metadata =
    note.noteTypeId === japaneseNoteTypeId ? "" : [note.noteTypeName, ...note.templates].join(" ").toLowerCase();
  const text = `${metadata}\n${fieldValues}`.toLowerCase();
  if (/\bpronunciation\b|\bpitch\b|\baccent\b|発音|はつおん|ピッチ|アクセント|音調|声調/.test(text)) return "pronunciation";
  if (/\bgrammar\b|文法|ぶんぽう|语法|語法/.test(text) || /[〜~][ぁ-ゖァ-ヺー一-龯a-zA-Z]/u.test(fieldValues)) return "grammar";
  if (note.noteTypeId === japaneseNoteTypeId) return templateKind;
  if (/\bvocab(?:ulary)?\b|\bword(?:s)?\b|語彙|単語|词汇|单词/.test(text) || hasJapaneseStudyText(fieldValues)) return "vocabulary";
  return null;
}

function hasJapaneseStudyText(text: string) {
  return /[ぁ-ゖァ-ヺー一-龯]/u.test(text);
}

function generationRequestContext(services: AppServices, deckId: string): Pick<GenerateDraftsInput, "requestedKinds" | "deckCoverage"> {
  const deckCoverage = generationDeckCoverage(services.db, deckId, generationCardKinds);
  const requestedKinds = deckCoverage.insufficientKinds.length > 0 ? deckCoverage.insufficientKinds : generationCardKinds.map((kind) => kind.kind);
  return { requestedKinds, deckCoverage };
}

export async function generateDraftsFromArticleUrl(
  services: AppServices,
  input: { url: string; deckId?: string | null; jlptLevel?: JlptLevel | null }
): Promise<ArticleGenerationResult> {
  const target = resolveGenerationTarget(services, input.deckId, input.jlptLevel);
  const now = nowIso();
  const importId = id("import");
  const jobId = createJob(services, {
    type: "article-generation",
    payload: {
      importId,
      url: input.url,
      deckId: input.deckId ?? null,
      jlptLevel: target.jlptLevel
    }
  });
  services.db.prepare(`
    INSERT INTO imports (id, type, url, status, include_scheduling, error, result_json, created_at, updated_at)
    VALUES (?, 'article-url', ?, 'running', 0, NULL, NULL, ?, ?)
  `).run(importId, input.url, now, now);

  try {
    const fetched = await publicUrlFetcher(services)(input.url, {
      maxBytes: 2_000_000,
      contentTypes: ["text/html", "text/plain", "application/xhtml+xml"]
    });
    const article = extractArticle(fetched.buffer.toString("utf8"), fetched.url);
    const contentHash = checksum(article.text);
    const existingSource = services.db
      .prepare("SELECT id, url, title FROM sources WHERE type = 'article-url' AND content_hash = ? ORDER BY created_at LIMIT 1")
      .get(contentHash) as { id: string; url: string; title: string } | undefined;
    const sourceId = existingSource?.id ?? id("source");
    if (!existingSource) {
      services.db.prepare(`
        INSERT INTO sources (id, type, url, title, content_text, content_hash, created_at)
        VALUES (?, 'article-url', ?, ?, ?, ?, ?)
      `).run(sourceId, fetched.url, article.title, article.text, contentHash, nowIso());
    }

    const drafts = await createDrafts(services, {
      sourceId,
      deckId: target.deckId,
      title: existingSource?.title ?? article.title,
      text: article.text,
      jlptLevel: target.jlptLevel,
      ...generationRequestContext(services, target.deckId)
    });
    if (existingSource) archivePreviousSourceDrafts(services.db, sourceId, drafts.map((draft) => draft.id));

    services.db
      .prepare("UPDATE imports SET status = 'completed', result_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify({ sourceId, draftsCreated: drafts.length }), nowIso(), importId);
    completeJob(services, jobId, { importId, sourceId, draftsCreated: drafts.length });
    return { importId, sourceId, drafts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    services.db
      .prepare("UPDATE imports SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .run(message, nowIso(), importId);
    failJob(services, jobId, error);
    throw new ImportJobFailure(importId, message);
  }
}

function publicUrlFetcher(services: AppServices) {
  return services.fetchPublicUrl ?? fetchPublicUrl;
}

export async function generateDraftsFromTextMaterial(
  services: AppServices,
  input: { title: string; text: string; deckId?: string | null; jlptLevel?: JlptLevel | null }
): Promise<ArticleGenerationResult> {
  const target = resolveGenerationTarget(services, input.deckId, input.jlptLevel);
  const now = nowIso();
  const importId = id("import");
  const title = input.title.trim();
  const text = normalizeStudyMaterialText(input.text).slice(0, 20_000);
  const provenanceUrl = `text-material://${importId}`;
  const jobId = createJob(services, {
    type: "text-generation",
    payload: {
      importId,
      title,
      deckId: input.deckId ?? null,
      jlptLevel: target.jlptLevel
    }
  });
  services.db.prepare(`
    INSERT INTO imports (id, type, url, status, include_scheduling, error, result_json, created_at, updated_at)
    VALUES (?, 'text-material', ?, 'running', 0, NULL, NULL, ?, ?)
  `).run(importId, provenanceUrl, now, now);

  try {
    const contentHash = checksum(text);
    const existingSource = services.db
      .prepare("SELECT id, url, title FROM sources WHERE type = 'text-material' AND content_hash = ? ORDER BY created_at LIMIT 1")
      .get(contentHash) as { id: string; url: string; title: string } | undefined;
    const sourceId = existingSource?.id ?? id("source");
    if (!existingSource) {
      services.db.prepare(`
        INSERT INTO sources (id, type, url, title, content_text, content_hash, created_at)
        VALUES (?, 'text-material', ?, ?, ?, ?, ?)
      `).run(sourceId, provenanceUrl, title, text, contentHash, nowIso());
    }

    const drafts = await createDrafts(services, {
      sourceId,
      deckId: target.deckId,
      title: existingSource?.title ?? title,
      text,
      jlptLevel: target.jlptLevel,
      ...generationRequestContext(services, target.deckId)
    });
    if (existingSource) archivePreviousSourceDrafts(services.db, sourceId, drafts.map((draft) => draft.id));

    services.db
      .prepare("UPDATE imports SET status = 'completed', result_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify({ sourceId, draftsCreated: drafts.length }), nowIso(), importId);
    completeJob(services, jobId, { importId, sourceId, draftsCreated: drafts.length });
    return { importId, sourceId, drafts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    services.db
      .prepare("UPDATE imports SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .run(message, nowIso(), importId);
    failJob(services, jobId, error);
    throw new ImportJobFailure(importId, message);
  }
}

export async function regenerateDraftsFromSource(
  services: AppServices,
  sourceId: string,
  input: { deckId?: string | null; jlptLevel?: JlptLevel | null } = {}
): Promise<ArticleGenerationResult> {
  const source = services.db.prepare("SELECT * FROM sources WHERE id = ?").get(sourceId) as
    | { id: string; url: string; title: string; content_text: string }
    | undefined;
  if (!source) throw new GenerationInputError("Source not found");
  const target = resolveGenerationTarget(services, input.deckId ?? deckIdForSource(services.db, sourceId), input.jlptLevel);
  const now = nowIso();
  const importId = id("import");
  const jobId = createJob(services, {
    type: "source-regeneration",
    payload: {
      importId,
      sourceId,
      deckId: target.deckId,
      jlptLevel: target.jlptLevel
    }
  });
  services.db.prepare(`
    INSERT INTO imports (id, type, url, status, include_scheduling, error, result_json, created_at, updated_at)
    VALUES (?, 'source-regeneration', ?, 'running', 0, NULL, NULL, ?, ?)
  `).run(importId, source.url, now, now);

  try {
    const drafts = await createDrafts(services, {
      sourceId,
      deckId: target.deckId,
      title: source.title,
      text: source.content_text,
      jlptLevel: target.jlptLevel,
      ...generationRequestContext(services, target.deckId)
    });
    archivePreviousSourceDrafts(services.db, sourceId, drafts.map((draft) => draft.id));

    services.db
      .prepare("UPDATE imports SET status = 'completed', result_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify({ sourceId, draftsCreated: drafts.length }), nowIso(), importId);
    completeJob(services, jobId, { importId, sourceId, draftsCreated: drafts.length });
    return { importId, sourceId, drafts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    services.db
      .prepare("UPDATE imports SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .run(message, nowIso(), importId);
    failJob(services, jobId, error);
    throw new ImportJobFailure(importId, message);
  }
}

function archivePreviousSourceDrafts(db: Database.Database, sourceId: string, activeDraftIds: string[]) {
  const params: unknown[] = [nowIso(), sourceId];
  let activeClause = "";
  if (activeDraftIds.length > 0) {
    activeClause = ` AND id NOT IN (${placeholders(activeDraftIds)})`;
    params.push(...activeDraftIds);
  }
  db.prepare(`UPDATE generation_drafts SET status = 'rejected', updated_at = ? WHERE source_id = ? AND status = 'draft'${activeClause}`).run(
    ...params
  );
}

function deckIdForSource(db: Database.Database, sourceId: string) {
  const draft = db.prepare("SELECT deck_id FROM generation_drafts WHERE source_id = ? AND deck_id IS NOT NULL ORDER BY created_at LIMIT 1").get(sourceId) as
    | { deck_id: string }
    | undefined;
  if (draft?.deck_id) return draft.deck_id;
  const note = db.prepare("SELECT deck_id FROM notes WHERE source_id = ? ORDER BY created_at LIMIT 1").get(sourceId) as { deck_id: string } | undefined;
  return note?.deck_id ?? null;
}

function resolveGenerationTarget(services: AppServices, deckId?: string | null, jlptLevel?: JlptLevel | null) {
  const targetJlptLevel = jlptLevel ?? defaultJlptLevel(services);
  if (!deckId) return { deckId: defaultDeck(services.db, targetJlptLevel), jlptLevel: targetJlptLevel };
  const deck = services.decks.getDeck(deckId);
  if (!deck) throw new GenerationInputError("Target deck not found");
  return { deckId: deck.id, jlptLevel: jlptLevel ?? (deck.jlptLevel as JlptLevel) };
}

function defaultJlptLevel(services: AppServices): JlptLevel {
  const row = services.db.prepare("SELECT value FROM settings WHERE key = 'preferences'").get() as { value: string } | undefined;
  const preferences = parseJson<Record<string, unknown>>(row?.value, {});
  const configured = preferences.defaultJlptLevel;
  return isJlptLevel(configured) ? configured : "mixed";
}

function isJlptLevel(value: unknown): value is JlptLevel {
  return value === "N5" || value === "N4" || value === "N3" || value === "N2" || value === "N1" || value === "mixed";
}

export async function approveDraft(services: AppServices, draftId: string) {
  const draft = services.db.prepare("SELECT * FROM generation_drafts WHERE id = ?").get(draftId) as any;
  if (!draft) throw new Error("Draft not found");
  if (draft.status !== "draft") throw new Error("Only draft cards can be approved");
  return approveDraftRow(services, draft);
}

function approveDraftRow(services: AppServices, draft: any, targetDeckId?: string | null) {
  const fields = parseJson<Record<string, string>>(draft.fields_json, {});
  const raw = parseJson<Record<string, unknown>>(draft.raw_json, {});
  const deckId = targetDeckId ?? draft.deck_id ?? defaultDeck(services.db, defaultJlptLevel(services));
  const created = createJapaneseNote(services.db, {
    deckId,
    fields,
    tags: rawDraftTags(raw),
    sourceId: draft.source_id,
    templateNames: draftTemplateNames(draft.kind)
  });

  services.db
    .prepare("UPDATE generation_drafts SET status = 'approved', updated_at = ? WHERE id = ?")
    .run(nowIso(), draft.id);

  return created;
}

function draftTemplateNames(kind: string) {
  if (kind === "grammar") return ["Grammar"];
  if (kind === "pronunciation") return ["Recognize", "Recall", "Pronunciation"];
  return ["Recognize"];
}

export async function approveDrafts(services: AppServices, draftIds: string[], targetDeckId?: string | null) {
  const ids = Array.from(new Set(draftIds.map((draftId) => draftId.trim()).filter(Boolean)));
  if (ids.length === 0) throw new Error("Draft ids are required");
  if (targetDeckId && !services.decks.getDeck(targetDeckId)) throw new Error("Target deck not found");
  const placeholders = ids.map(() => "?").join(",");
  const drafts = services.db.prepare(`SELECT * FROM generation_drafts WHERE id IN (${placeholders})`).all(...ids) as any[];
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  for (const draftId of ids) {
    const draft = draftById.get(draftId);
    if (!draft) throw new Error("Draft not found");
    if (draft.status !== "draft") throw new Error("Only draft cards can be approved");
  }
  const created = services.db.transaction(() => ids.map((draftId) => approveDraftRow(services, draftById.get(draftId), targetDeckId)))();
  return {
    approved: created.length,
    cardsCreated: created.reduce((total, note) => total + note.cards.length, 0),
    noteIds: created.map((note) => note.noteId)
  };
}

export async function rejectDraft(services: AppServices, draftId: string) {
  const result = services.db
    .prepare("UPDATE generation_drafts SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'draft'")
    .run(nowIso(), draftId);
  if (result.changes === 0) throw new Error("Draft not found");
}

export async function rejectDrafts(services: AppServices, draftIds: string[]) {
  const ids = Array.from(new Set(draftIds.map((draftId) => draftId.trim()).filter(Boolean)));
  if (ids.length === 0) throw new Error("Draft ids are required");
  const placeholders = ids.map(() => "?").join(",");
  const drafts = services.db.prepare(`SELECT id, status FROM generation_drafts WHERE id IN (${placeholders})`).all(...ids) as Array<{
    id: string;
    status: string;
  }>;
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  for (const draftId of ids) {
    const draft = draftById.get(draftId);
    if (!draft) throw new Error("Draft not found");
    if (draft.status !== "draft") throw new Error("Only draft cards can be rejected");
  }
  services.db
    .transaction(() => {
      const update = services.db.prepare("UPDATE generation_drafts SET status = 'rejected', updated_at = ? WHERE id = ?");
      const rejectedAt = nowIso();
      ids.forEach((draftId) => update.run(rejectedAt, draftId));
    })();
  return { rejected: ids.length };
}

export interface UpdateDraftInput {
  kind?: "vocabulary" | "grammar" | "pronunciation";
  fields?: Record<string, string | null | undefined>;
  tags?: string[];
  pitchAccentStatus?: "confirmed" | "review-required";
  deckId?: string | null;
}

export function updateDraft(services: AppServices, draftId: string, input: UpdateDraftInput) {
  const draft = services.db.prepare("SELECT * FROM generation_drafts WHERE id = ?").get(draftId) as any;
  if (!draft) throw new Error("Draft not found");
  if (draft.status !== "draft") throw new Error("Only draft cards can be edited");

  const fields = {
    ...parseJson<Record<string, string>>(draft.fields_json, {}),
    ...Object.fromEntries(Object.entries(input.fields ?? {}).map(([key, value]) => [key, value ?? ""]))
  };
  const existingRaw = parseJson<Record<string, unknown>>(draft.raw_json, {});
  const raw = {
    ...existingRaw,
    tags: input.tags === undefined ? rawDraftTags(existingRaw) : normalizeTags(input.tags)
  };
  const deckId = resolveDraftDeckId(services.db, draft.deck_id, input.deckId);
  const front = fields.Expression || draft.front;
  const back = [fields.MeaningZh, fields.MeaningEn, fields.MeaningJa].filter(Boolean).join(" / ") || draft.back;

  services.db
    .prepare(
      `UPDATE generation_drafts
       SET deck_id = ?, kind = ?, front = ?, back = ?, fields_json = ?, pitch_accent_status = ?,
           raw_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      deckId,
      input.kind ?? draft.kind,
      front,
      back,
      JSON.stringify(fields),
      input.pitchAccentStatus ?? draft.pitch_accent_status,
      JSON.stringify(raw),
      nowIso(),
      draftId
    );

  return listDrafts(services.db).find((row) => row.id === draftId) ?? null;
}

function resolveDraftDeckId(db: Database.Database, currentDeckId: string | null, inputDeckId: string | null | undefined) {
  if (inputDeckId === undefined) return currentDeckId;
  if (inputDeckId === null || inputDeckId === "") return null;
  const deck = db.prepare("SELECT id FROM decks WHERE id = ?").get(inputDeckId) as { id: string } | undefined;
  if (!deck) throw new Error("Target deck not found");
  return deck.id;
}

export interface DraftListFilters {
  status?: string;
  deckId?: string | null;
  kind?: "vocabulary" | "grammar" | "pronunciation";
  pitchAccentStatus?: "confirmed" | "review-required";
}

export function listDrafts(db: Database.Database, filters: DraftListFilters | string = "draft") {
  const options: DraftListFilters = typeof filters === "string" ? { status: filters } : filters;
  const where = ["status = ?"];
  const params: unknown[] = [options.status ?? "draft"];
  if (options.deckId) {
    const deckIds = deckScopeIds(db, options.deckId) ?? [options.deckId];
    where.push(`deck_id IN (${placeholders(deckIds)})`);
    params.push(...deckIds);
  }
  if (options.kind) {
    where.push("kind = ?");
    params.push(options.kind);
  }
  if (options.pitchAccentStatus) {
    where.push("pitch_accent_status = ?");
    params.push(options.pitchAccentStatus);
  }
  return db
    .prepare(`SELECT * FROM generation_drafts WHERE ${where.join(" AND ")} ORDER BY created_at DESC`)
    .all(...params)
    .map(draftDto);
}

export function getDraft(db: Database.Database, draftId: string) {
  const row = db.prepare("SELECT * FROM generation_drafts WHERE id = ?").get(draftId) as any;
  return row ? draftDto(row) : null;
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(",");
}

function draftDto(row: any) {
  return {
    id: row.id,
    sourceId: row.source_id,
    deckId: row.deck_id,
    kind: row.kind,
    status: row.status,
    front: row.front,
    back: row.back,
    fields: parseJson(row.fields_json, {}),
    pitchAccentStatus: row.pitch_accent_status,
    explanationLanguages: row.explanation_languages,
    raw: parseJson(row.raw_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function generateTtsAudio(services: AppServices, text: string, options: { sourceId?: string | null } = {}) {
  const normalized = text.trim();
  if (!normalized) throw new Error("TTS text is required");
  const cacheKey = ttsCacheKey(services, normalized);
  const sourceId = options.sourceId ?? null;
  const existing = sourceId
    ? (services.db
        .prepare("SELECT file_name FROM media_assets WHERE source_id = ? AND original_name = ? ORDER BY created_at DESC LIMIT 1")
        .get(sourceId, cacheKey) as { file_name: string } | undefined)
    : (services.db
        .prepare("SELECT file_name FROM media_assets WHERE source_id IS NULL AND original_name = ? ORDER BY created_at DESC LIMIT 1")
        .get(cacheKey) as { file_name: string } | undefined);
  if (existing) return `[sound:${existing.file_name}]`;

  const buffer = await synthesizeAudio(services, normalized);
  const fileName = `${safeFileName(text).slice(0, 40)}-${checksum(buffer).slice(0, 10)}.mp3`;
  const mediaPath = join(services.mediaDir, fileName);
  mkdirSync(services.mediaDir, { recursive: true });
  writeFileSync(mediaPath, buffer);
  const now = nowIso();
  services.db
    .prepare(
      `INSERT OR IGNORE INTO media_assets (id, file_name, original_name, mime_type, path, checksum, source_id, created_at)
       VALUES (?, ?, ?, 'audio/mpeg', ?, ?, ?, ?)`
    )
    .run(id("media"), fileName, cacheKey, mediaPath, checksum(buffer), sourceId, now);
  return `[sound:${fileName}]`;
}

function ttsCacheKey(services: AppServices, text: string) {
  return `tts:${services.config.openaiTtsModel}:${services.config.openaiTtsVoice}:${text}`;
}

export async function generateDraftAudio(
  services: AppServices,
  draftId: string,
  text?: string | null,
  options: { recordJob?: boolean } = {}
) {
  const draft = services.db.prepare("SELECT * FROM generation_drafts WHERE id = ?").get(draftId) as any;
  if (!draft) throw new Error("Draft not found");
  if (draft.status !== "draft") throw new Error("Only draft cards can be edited");
  const fields = parseJson<Record<string, string>>(draft.fields_json, {});
  const sourceText = text || fields.Expression || fields.Reading || draft.front;
  const jobId =
    options.recordJob === false
      ? null
      : createJob(services, {
          type: "draft-tts",
          payload: { draftId, text: sourceText.slice(0, 120) }
        });
  try {
    const audio = await generateTtsAudio(services, sourceText, { sourceId: draft.source_id });
    fields.Audio = audio;
    services.db
      .prepare("UPDATE generation_drafts SET fields_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(fields), nowIso(), draftId);
    const result = { audio, draft: listDrafts(services.db).find((row) => row.id === draftId) ?? null };
    if (jobId) completeJob(services, jobId, { draftId, audio });
    return result;
  } catch (error) {
    if (jobId) failJob(services, jobId, error);
    throw error;
  }
}

export async function generateDraftAudios(services: AppServices, draftIds: string[]) {
  const ids = Array.from(new Set(draftIds.map((draftId) => draftId.trim()).filter(Boolean)));
  if (ids.length === 0) throw new Error("Draft ids are required");
  const jobId = createJob(services, {
    type: "draft-tts-bulk",
    payload: { draftIds: ids, count: ids.length }
  });
  try {
    let generated = 0;
    let skipped = 0;
    const drafts = [];
    for (const draftId of ids) {
      const draft = services.db.prepare("SELECT * FROM generation_drafts WHERE id = ?").get(draftId) as any;
      if (!draft) throw new Error("Draft not found");
      if (draft.status !== "draft") throw new Error("Only draft cards can be edited");
      const fields = parseJson<Record<string, string>>(draft.fields_json, {});
      if (/\[sound:[^\]]+\]/.test(fields.Audio ?? "")) {
        skipped += 1;
        drafts.push(listDrafts(services.db).find((row) => row.id === draftId));
        continue;
      }
      const result = await generateDraftAudio(services, draftId, fields.Expression || fields.Reading || draft.front, { recordJob: false });
      generated += 1;
      drafts.push(result.draft);
    }
    const result = { generated, skipped, drafts: drafts.filter(Boolean) };
    completeJob(services, jobId, { generated, skipped });
    return result;
  } catch (error) {
    failJob(services, jobId, error);
    throw error;
  }
}

export async function generateCardAudio(services: AppServices, cardId: string, text?: string | null) {
  const card = services.db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as any;
  if (!card) throw new Error("Card not found");
  const note = services.db.prepare("SELECT * FROM notes WHERE id = ?").get(card.note_id) as any;
  if (!note) throw new Error("Note not found");
  const fields = parseJson<Record<string, string>>(note.fields_json, {});
  const sourceText = text || fields.Expression || fields.Reading || "";
  const jobId = createJob(services, {
    type: "card-tts",
    payload: { cardId, noteId: note.id, text: String(sourceText ?? "").slice(0, 120) }
  });
  try {
    const audio = await generateTtsAudio(services, sourceText, { sourceId: note.source_id });
    fields.Audio = audio;
    services.db.prepare("UPDATE notes SET fields_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(fields), nowIso(), note.id);
    completeJob(services, jobId, { cardId, audio });
    return { audio };
  } catch (error) {
    failJob(services, jobId, error);
    throw error;
  }
}

async function synthesizeAudio(services: AppServices, text: string) {
  if (services.ttsSynthesize) {
    return services.ttsSynthesize({
      text,
      model: services.config.openaiTtsModel,
      voice: services.config.openaiTtsVoice
    });
  }
  if (!services.config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required to generate TTS audio");
  }
  const client = createOpenAiClient(services);
  const response = await client.audio.speech.create({
    model: services.config.openaiTtsModel,
    voice: services.config.openaiTtsVoice as any,
    input: text,
    response_format: "mp3"
  });
  return Buffer.from(await response.arrayBuffer());
}

function extractArticle(html: string, url: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg, canvas, iframe, nav, header, footer, form").remove();
  preserveRubyReadings($);
  const title = ($("title").first().text() || new URL(url).hostname).trim();
  const text = normalizeExtractedArticleText($("article").text() || $("main").text() || $("body").text()).slice(0, 20_000);
  if (text.length < 80) {
    throw new Error("Article text is too short to generate cards");
  }
  return { title, text };
}

function normalizeExtractedArticleText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function createDrafts(
  services: AppServices,
  input: GenerateDraftsInput
) {
  const generated = services.generateDrafts
    ? generatedDraftsSchema.parse(await services.generateDrafts(input))
    : services.config.openaiApiKey
      ? await generateWithOpenAi(services, input)
      : fallbackDrafts(input.title, input.text, input.jlptLevel, input.requestedKinds);

  const rows = generated.drafts.map((draft) =>
    insertDraft(services.db, input.sourceId, input.deckId, draft, Boolean(services.config.pitchAccentLexiconSource))
  );
  if (!canGenerateDraftTts(services)) return rows;
  const rowsWithAudio = [];
  for (const row of rows) {
    try {
      const result = await generateDraftAudio(services, row.id, draftAudioText(row));
      rowsWithAudio.push(result.draft ?? row);
    } catch {
      rowsWithAudio.push(row);
    }
  }
  return rowsWithAudio;
}

function canGenerateDraftTts(services: AppServices) {
  return Boolean(services.ttsSynthesize || services.config.openaiApiKey);
}

function draftAudioText(row: { fields: Record<string, string>; front: string }) {
  return row.fields.Expression || row.fields.Reading || row.front;
}

async function generateWithOpenAi(
  services: AppServices,
  input: GenerateDraftsInput
) {
  const client = createOpenAiClient(services);
  const coverageSummary = input.deckCoverage.kinds
    .map((kind) => `${kind.label}: ${kind.current}/${kind.recommendedMinimum}, missing ${kind.missing}`)
    .join("; ");
  const response = await client.responses.create({
    model: services.config.openaiTextModel,
    input: [
      {
        role: "system",
        content:
          "You create high-quality Japanese Anki cards. Return only schema-valid JSON. Include Chinese, English, and Japanese explanations. Mark AI-only pitch accent as pitchAccentSource=ai."
      },
      {
        role: "user",
        content: `Target JLPT: ${input.jlptLevel}. Article title: ${input.title}
Requested card kinds based on selected deck coverage: ${input.requestedKinds.join(", ")}.
Current coverage: ${coverageSummary}.

Extract Japanese study cards from this article. Prioritize the requested card kinds before adding already-covered kinds:
${input.text}`
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "japanese_anki_drafts",
        strict: true,
        schema: jsonSchemaForGeneratedDrafts()
      }
    }
  } as any);
  return generatedDraftsSchema.parse(JSON.parse((response as any).output_text));
}

function fallbackDrafts(title: string, text: string, jlptLevel: JlptLevel, requestedKinds: DraftKind[]) {
  const tableDrafts = structuredTableDrafts(title, text, jlptLevel);
  if (tableDrafts.length > 0) {
    return generatedDraftsSchema.parse({ drafts: tableDrafts.slice(0, 40) });
  }
  const listDrafts = [
    ...vocabularyListDrafts(title, text, jlptLevel),
    ...grammarListDrafts(title, text, jlptLevel),
    ...pronunciationListDrafts(title, text, jlptLevel)
  ];
  if (listDrafts.length > 0) {
    return generatedDraftsSchema.parse({ drafts: listDrafts.slice(0, 40) });
  }
  const sentences = text
    .split(/[。！？!?]\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const vocabulary = pickVocabularyExpression(text, title);
  const grammar = pickGrammarExpression(text);
  const pronunciation = pickPronunciationExpression(text, vocabulary);
  const tags = (kind: string) => [jlptLevel, kind, "needs-review"].filter((tag) => tag !== "mixed");
  const example = (needle: string) => sentences.find((sentence) => sentence.includes(needle.replace(/[〜~]/g, ""))) ?? sentences[0] ?? text.slice(0, 80);
  const genericDrafts: GeneratedDraft[] = [
    {
      kind: "vocabulary",
      expression: vocabulary,
      reading: "",
      pitchAccent: null,
      pitchAccentSource: "none",
      meanings: {
        zh: "请审核后补充中文释义",
        en: "Review and add an English meaning",
        ja: "確認して意味を追加してください"
      },
      example: example(vocabulary),
      exampleReading: "",
      explanation: {
        zh: `从《${title}》自动抽取的词汇候选，请审核释义、读音和例句。`,
        en: `Vocabulary candidate extracted from "${title}". Review meaning, reading, and example.`,
        ja: `「${title}」から抽出された語彙候補です。意味、読み、例文を確認してください。`
      },
      tags: tags("vocabulary")
    },
    {
      kind: "grammar",
      expression: grammar,
      reading: "",
      pitchAccent: null,
      pitchAccentSource: "none",
      meanings: {
        zh: "请审核后补充语法说明",
        en: "Review and add a grammar explanation",
        ja: "確認して文法説明を追加してください"
      },
      example: example(grammar),
      exampleReading: "",
      explanation: {
        zh: `从《${title}》自动抽取的语法候选，请确认接续、含义和例句。`,
        en: `Grammar candidate extracted from "${title}". Review form, meaning, and example.`,
        ja: `「${title}」から抽出された文法候補です。接続、意味、例文を確認してください。`
      },
      tags: tags("grammar")
    },
    {
      kind: "pronunciation",
      expression: pronunciation,
      reading: "",
      pitchAccent: null,
      pitchAccentSource: "none",
      meanings: {
        zh: "请审核后补充发音和音调",
        en: "Review and add pronunciation and pitch accent",
        ja: "確認して発音とアクセントを追加してください"
      },
      example: example(pronunciation),
      exampleReading: "",
      explanation: {
        zh: `从《${title}》自动抽取的发音练习候选，AI/本地规则未确认音调。`,
        en: `Pronunciation candidate extracted from "${title}". Pitch accent is not confirmed.`,
        ja: `「${title}」から抽出された発音練習候補です。アクセントは未確認です。`
      },
      tags: tags("pronunciation")
    }
  ];
  const requested = new Set(requestedKinds);
  const focusedDrafts = genericDrafts.filter((draft) => requested.has(draft.kind));
  return generatedDraftsSchema.parse({ drafts: focusedDrafts.length > 0 ? focusedDrafts : genericDrafts });
}

function normalizeStudyMaterialText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function structuredTableDrafts(title: string, text: string, jlptLevel: JlptLevel): GeneratedDraft[] {
  return structuredRows(text)
    .map((row) => draftFromStructuredRow(title, row, jlptLevel))
    .filter((draft): draft is GeneratedDraft => Boolean(draft));
}

function structuredRows(text: string) {
  const rows: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;
  for (const line of text.split("\n")) {
    if (/^Row\s+\d+\b/i.test(line)) {
      if (current && Object.keys(current).length > 0) rows.push(current);
      current = {};
      continue;
    }
    const match = line.match(/^([^:]{1,80}):\s*(.*)$/);
    if (!match || !current) continue;
    current[normalizeStructuredFieldName(match[1])] = match[2].trim();
  }
  if (current && Object.keys(current).length > 0) rows.push(current);
  return rows;
}

function draftFromStructuredRow(title: string, row: Record<string, string>, jlptLevel: JlptLevel): GeneratedDraft | null {
  const expression = structuredField(row, [
    "expression",
    "front",
    "term",
    "word",
    "vocabulary",
    "japanese",
    "表現",
    "語彙",
    "単語",
    "日本語",
    "表达",
    "表达式",
    "词条",
    "词汇",
    "单词",
    "日语",
    "日文"
  ]);
  if (!expression) return null;
  const kind = structuredKind(structuredField(row, ["kind", "type", "種類", "種別", "カード種類", "类型", "种类", "卡片类型"]));
  const reading = structuredField(row, ["reading", "kana", "furigana", "読み", "よみ", "読み方", "读音", "读法", "假名", "振假名"]) ?? "";
  const meaningZh =
    structuredField(row, [
      "meaningzh",
      "zh",
      "chinese",
      "meaningchinese",
      "中文",
      "意味中文",
      "中国語",
      "中国語訳",
      "中国語意味",
      "中文释义",
      "中文意思",
      "中文解释",
      "中文翻译",
      "汉语释义"
    ]) ??
    "请审核后补充中文释义";
  const meaningEn =
    structuredField(row, [
      "meaningen",
      "en",
      "english",
      "meaningenglish",
      "英語",
      "意味英語",
      "英語訳",
      "英語意味",
      "英文释义",
      "英文意思",
      "英文解释",
      "英文翻译",
      "英语释义"
    ]) ??
    "Review and add an English meaning";
  const meaningJa =
    structuredField(row, [
      "meaningja",
      "ja",
      "meaningjapanese",
      "japanesemeaning",
      "意味日本語",
      "日本語説明",
      "日本語訳",
      "日文释义",
      "日文意思",
      "日文解释",
      "日语释义",
      "日语解释"
    ]) ??
    "確認して意味を追加してください";
  const pitchAccent = structuredField(row, ["pitchaccent", "accent", "アクセント", "ピッチアクセント", "音調", "声调", "音调", "重音"]) ?? null;
  const pitchAccentSource = structuredPitchAccentSource(
    structuredField(row, ["pitchaccentsource", "accentsource", "source", "アクセントソース", "音調ソース", "出典", "声调来源", "音调来源", "来源"])
  );
  const tags = structuredTags(structuredField(row, ["tags", "tag", "タグ", "标签", "标记"]), jlptLevel, kind);
  return {
    kind,
    expression,
    reading,
    pitchAccent,
    pitchAccentSource,
    meanings: {
      zh: meaningZh,
      en: meaningEn,
      ja: meaningJa
    },
    example: structuredField(row, ["example", "sentence", "例文", "文", "例句", "句子"]) ?? "",
    exampleReading: structuredField(row, ["examplereading", "examplekana", "例文読み", "例文よみ", "例文かな", "例句读音", "例句读法"]) ?? "",
    explanation: {
      zh: `从《${title}》的结构化词表导入，请审核释义、读音和例句。`,
      en: `Imported from the structured table "${title}". Review meaning, reading, and example.`,
      ja: `「${title}」の構造化された表から取り込んだ候補です。意味、読み、例文を確認してください。`
    },
    tags
  };
}

function structuredField(row: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = row[normalizeStructuredFieldName(name)];
    if (value) return value;
  }
  return null;
}

function normalizeStructuredFieldName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, "");
}

function structuredKind(value: string | null): GeneratedDraft["kind"] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "grammar" || normalized === "文法" || normalized === "ぶんぽう" || normalized === "语法") return "grammar";
  if (normalized === "pronunciation" || normalized === "発音" || normalized === "はつおん" || normalized === "发音") return "pronunciation";
  return "vocabulary";
}

function structuredPitchAccentSource(value: string | null): GeneratedDraft["pitchAccentSource"] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "lexicon" || normalized === "辞書" || normalized === "じしょ" || normalized === "词典" || normalized === "字典") return "lexicon";
  if (normalized === "ai") return "ai";
  return "none";
}

function structuredTags(value: string | null, jlptLevel: JlptLevel, kind: GeneratedDraft["kind"]) {
  const parsed = (value ?? "")
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const defaults = [jlptLevel, kind].filter((tag) => tag !== "mixed");
  return Array.from(new Set([...parsed, ...defaults]));
}

function vocabularyListDrafts(title: string, text: string, jlptLevel: JlptLevel): GeneratedDraft[] {
  return text
    .split("\n")
    .map((line) => line.match(/^\s*(?:(?:[-*・]|\d+[.)]|[０-９]+[．）])\s*)?([^\s（(：:]{1,40})\s*[（(]([ぁ-ゖァ-ヺー・\s]+)[）)]\s*(?:[［\[]([0-9?？\-]+)[］\]])?\s*[：:]\s*(.+)$/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const meanings = parseVocabularyListMeanings(match[4]);
      return {
        kind: "vocabulary" as const,
        expression: match[1].trim(),
        reading: match[2].replace(/\s+/g, "").trim(),
        pitchAccent: normalizeVocabularyListPitchAccent(match[3]),
        pitchAccentSource: "none" as const,
        meanings,
        example: "",
        exampleReading: "",
        explanation: {
          zh: `从《${title}》的词汇列表导入，请审核读音、释义和例句。`,
          en: `Imported from the vocabulary list "${title}". Review reading, meaning, and example.`,
          ja: `「${title}」の語彙リストから取り込んだ候補です。読み、意味、例文を確認してください。`
        },
        tags: [jlptLevel, "vocabulary", "needs-review"].filter((tag) => tag !== "mixed")
      };
    });
}

function normalizeVocabularyListPitchAccent(value: string | undefined) {
  const normalized = value?.replace(/[？]/g, "?").trim();
  return normalized && normalized !== "?" ? normalized : null;
}

function parseVocabularyListMeanings(raw: string) {
  const parts = raw
    .split(/\s*[／/]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    zh: parts[0] ?? "请审核后补充中文释义",
    en: parts[1] ?? "Review and add an English meaning",
    ja: parts[2] ?? "確認して意味を追加してください"
  };
}

function pronunciationListDrafts(title: string, text: string, jlptLevel: JlptLevel): GeneratedDraft[] {
  return text
    .split("\n")
    .map((line) =>
      line.match(
        /^\s*(?:(?:[-*・]|\d+[.)]|[０-９]+[．）])\s*)?(?:発音|pronunciation)\s*[：:]\s*([^\s（(：:]{1,40})\s*[（(]([ぁ-ゖァ-ヺー・\s]+)[）)]\s*(?:[［\[]([0-9?？\-]+)[］\]])?\s*[：:]\s*(.+)$/iu
      )
    )
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const details = parsePronunciationListDetails(match[4]);
      return {
        kind: "pronunciation" as const,
        expression: match[1].trim(),
        reading: match[2].replace(/\s+/g, "").trim(),
        pitchAccent: normalizeVocabularyListPitchAccent(match[3]),
        pitchAccentSource: "none" as const,
        meanings: {
          zh: details.meaningZh,
          en: details.meaningEn,
          ja: details.meaningJa
        },
        example: details.example,
        exampleReading: "",
        explanation: {
          zh: `从《${title}》的发音练习列表导入，请审核读音、音调和例句。`,
          en: `Imported from the pronunciation drill list "${title}". Review reading, pitch accent, and example.`,
          ja: `「${title}」の発音練習リストから取り込んだ候補です。読み、アクセント、例文を確認してください。`
        },
        tags: [jlptLevel, "pronunciation", "needs-review"].filter((tag) => tag !== "mixed")
      };
    });
}

function parsePronunciationListDetails(raw: string) {
  const parts = raw
    .split(/\s*[／/]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    meaningZh: parts[0] ?? "请审核后补充发音和音调",
    meaningEn: parts[1] ?? "Review and add pronunciation and pitch accent",
    meaningJa: parts[2] ?? "確認して発音とアクセントを追加してください",
    example: parts[3] ?? ""
  };
}

function grammarListDrafts(title: string, text: string, jlptLevel: JlptLevel): GeneratedDraft[] {
  return text
    .split("\n")
    .map((line) => line.match(/^\s*(?:(?:[-*・]|\d+[.)]|[０-９]+[．）])\s*)?([〜~][^：:]{1,60})\s*[：:]\s*(.+)$/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const details = parseGrammarListDetails(match[2]);
      const expression = normalizeGrammarListExpression(match[1]);
      return {
        kind: "grammar" as const,
        expression,
        reading: expression.replace(/^〜/, ""),
        pitchAccent: null,
        pitchAccentSource: "none" as const,
        meanings: {
          zh: details.meaningZh,
          en: details.meaningEn,
          ja: details.meaningJa
        },
        example: details.example,
        exampleReading: "",
        explanation: {
          zh: `从《${title}》的文法列表导入，请审核接续、含义和例句。`,
          en: `Imported from the grammar list "${title}". Review form, meaning, and example.`,
          ja: `「${title}」の文法リストから取り込んだ候補です。接続、意味、例文を確認してください。`
        },
        tags: [jlptLevel, "grammar", "needs-review"].filter((tag) => tag !== "mixed")
      };
    });
}

function normalizeGrammarListExpression(value: string) {
  return value.trim().replace(/^~/, "〜");
}

function parseGrammarListDetails(raw: string) {
  const parts = raw
    .split(/\s*[／/]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    meaningZh: parts[0] ?? "请审核后补充语法说明",
    meaningEn: parts[1] ?? "Review and add a grammar explanation",
    meaningJa: parts[2] ?? "確認して文法説明を追加してください",
    example: parts[3] ?? ""
  };
}

function pickVocabularyExpression(text: string, title: string) {
  const preferred = ["新しい文法", "単語", "意味", "例文", "学校", "先生", "勉強", "確認"].find((term) => text.includes(term));
  if (preferred) return preferred;
  return text.match(/[\u3400-\u9fff][\u3040-\u30ff\u3400-\u9fff]{1,10}/)?.[0] ?? title;
}

function pickGrammarExpression(text: string) {
  const patterns: Array<[RegExp, string]> = [
    [/(?:て|で)いる/, "〜ている"],
    [/(?:て|で)ください/, "〜てください"],
    [/(?:て|で)もいい/, "〜てもいい"],
    [/なければならない/, "〜なければならない"],
    [/ことができる/, "〜ことができる"],
    [/ようにする/, "〜ようにする"],
    [/たことがある/, "〜たことがある"],
    [/たばかり/, "〜たばかり"]
  ];
  const matched = patterns.find(([pattern]) => pattern.test(text));
  if (matched) return matched[1];
  if (text.includes("ました")) return "〜ました";
  if (text.includes("です")) return "〜です";
  if (text.includes("ます")) return "〜ます";
  if (text.includes("て")) return "〜て";
  return "文法";
}

function pickPronunciationExpression(text: string, fallback: string) {
  const preferred = ["発音", "読む", "読んで", "練習", "音"].find((term) => text.includes(term));
  if (preferred) return preferred;
  return text.match(/[\u3040-\u30ff]{2,}/)?.[0] ?? fallback;
}

function insertDraft(
  db: Database.Database,
  sourceId: string,
  deckId: string,
  draft: GeneratedDraft,
  lexiconPitchAccentConfirmed: boolean
) {
  const now = nowIso();
  const source = db.prepare("SELECT url FROM sources WHERE id = ?").get(sourceId) as { url: string } | undefined;
  const fields = {
    Expression: draft.expression,
    Reading: draft.reading,
    PitchAccent: draft.pitchAccent ?? "",
    PitchAccentSource: draft.pitchAccentSource,
    MeaningZh: draft.meanings.zh,
    MeaningEn: draft.meanings.en,
    MeaningJa: draft.meanings.ja,
    Example: draft.example,
    ExampleReading: draft.exampleReading,
    ExplanationZh: draft.explanation.zh,
    ExplanationEn: draft.explanation.en,
    ExplanationJa: draft.explanation.ja,
    Audio: "",
    SourceUrl: source?.url ?? ""
  };
  const row = {
    id: id("draft"),
    sourceId,
    deckId,
    kind: draft.kind,
    status: "draft",
    front: draft.expression,
    back: `${draft.meanings.zh} / ${draft.meanings.en} / ${draft.meanings.ja}`,
    fields,
    pitchAccentStatus: draft.pitchAccentSource === "lexicon" && lexiconPitchAccentConfirmed ? "confirmed" : "review-required",
    explanationLanguages: "zh,en,ja",
    raw: generatedDraftRaw(draft),
    createdAt: now,
    updatedAt: now
  };
  db.prepare(`
    INSERT INTO generation_drafts (
      id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
      explanation_languages, raw_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.sourceId,
    row.deckId,
    row.kind,
    row.status,
    row.front,
    row.back,
    JSON.stringify(row.fields),
    row.pitchAccentStatus,
    row.explanationLanguages,
    JSON.stringify(row.raw),
    row.createdAt,
    row.updatedAt
  );
  return row;
}

function generatedDraftRaw(draft: GeneratedDraft) {
  return {
    ...draft,
    tags: normalizeTags(draft.tags)
  };
}

function rawDraftTags(raw: Record<string, unknown>) {
  if (!Array.isArray(raw.tags)) return [];
  return normalizeTags(raw.tags.filter((tag): tag is string => typeof tag === "string"));
}

function createOpenAiClient(services: AppServices) {
  return new OpenAI({
    apiKey: services.config.openaiApiKey ?? undefined,
    baseURL: services.config.openaiBaseUrl ?? undefined
  });
}
