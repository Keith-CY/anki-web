import type Database from "better-sqlite3";
import type { CardRecord, JlptLevel } from "../types";
import { ankiGuid, id, nowIso, numericId, parseJson } from "../utils/id";
import { buildInitialSchedulingState } from "../review/scheduler";
import { renderCardTemplate } from "./rendering";

export const japaneseNoteTypeId = "note_type_japanese_learning";
export const japaneseNoteTypeAnkiId = 2026051701;

export const japaneseFields = [
  "Expression",
  "Reading",
  "PitchAccent",
  "PitchAccentSource",
  "MeaningZh",
  "MeaningEn",
  "MeaningJa",
  "Example",
  "ExampleReading",
  "ExplanationZh",
  "ExplanationEn",
  "ExplanationJa",
  "Audio",
  "SourceUrl"
];

const defaultJapaneseTemplateNames = ["Recognize", "Recall", "Pronunciation"];
const japaneseTemplates = [
  {
    name: "Recognize",
    qfmt: "<div class=\"jp\">{{Expression}}</div>{{#Audio}}<div>{{Audio}}</div>{{/Audio}}",
    afmt: "{{FrontSide}}<hr><div>{{Reading}} {{#PitchAccent}}<span class=\"muted\">[{{PitchAccent}}]</span>{{/PitchAccent}}</div><div>{{MeaningZh}} / {{MeaningEn}} / {{MeaningJa}}</div><p>{{Example}}</p><p class=\"muted\">{{ExplanationZh}}</p><p>{{ExplanationEn}}</p><p>{{ExplanationJa}}</p>"
  },
  {
    name: "Recall",
    qfmt: "<div>{{MeaningZh}}</div><div class=\"muted\">{{MeaningEn}}</div><p>{{ExampleReading}}</p>",
    afmt: "{{FrontSide}}<hr><div class=\"jp\">{{Expression}}</div><div>{{Reading}} {{PitchAccent}}</div><p>{{Example}}</p>"
  },
  {
    name: "Pronunciation",
    qfmt: "<div class=\"jp\">{{Expression}}</div><div>{{Reading}}</div>",
    afmt: "{{FrontSide}}<hr><div>Pitch: {{PitchAccent}}</div>{{#Audio}}<div>{{Audio}}</div>{{/Audio}}"
  },
  {
    name: "Grammar",
    qfmt: "<div class=\"jp\">{{Expression}}</div><p>{{Example}}</p><p class=\"muted\">{{MeaningZh}} / {{MeaningEn}}</p>",
    afmt: "{{FrontSide}}<hr><p>{{ExplanationZh}}</p><p>{{ExplanationEn}}</p><p>{{ExplanationJa}}</p><p class=\"muted\">{{ExampleReading}}</p>"
  }
];

export function ensureJapaneseNoteType(db: Database.Database) {
  const existing = db.prepare("SELECT id FROM note_types WHERE id = ?").get(japaneseNoteTypeId);
  if (existing) {
    ensureJapaneseNoteTypeDefinition(db);
    return;
  }

  const now = nowIso();
  db.prepare(`
    INSERT INTO note_types (id, anki_id, name, css, raw_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    japaneseNoteTypeId,
    japaneseNoteTypeAnkiId,
    "Japanese Vocabulary Grammar Pronunciation",
    ".card { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif; font-size: 20px; } .jp { font-size: 32px; } .muted { color: #667085; }",
    null,
    now,
    now
  );

  const insertField = db.prepare("INSERT INTO note_fields (id, note_type_id, ord, name) VALUES (?, ?, ?, ?)");
  japaneseFields.forEach((name, ord) => insertField.run(id("field"), japaneseNoteTypeId, ord, name));

  const insertTemplate = db.prepare(`
    INSERT INTO card_templates (id, note_type_id, ord, name, question_format, answer_format)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  japaneseTemplates.forEach((template, ord) => {
    insertTemplate.run(id("template"), japaneseNoteTypeId, ord, template.name, template.qfmt, template.afmt);
  });
}

function ensureJapaneseNoteTypeDefinition(db: Database.Database) {
  const existingFields = new Set(
    (db.prepare("SELECT name FROM note_fields WHERE note_type_id = ?").all(japaneseNoteTypeId) as Array<{ name: string }>).map(
      (field) => field.name
    )
  );
  const insertField = db.prepare("INSERT INTO note_fields (id, note_type_id, ord, name) VALUES (?, ?, ?, ?)");
  japaneseFields.forEach((name, ord) => {
    if (!existingFields.has(name)) insertField.run(id("field"), japaneseNoteTypeId, ord, name);
  });

  const existingTemplates = new Set(
    (db.prepare("SELECT name FROM card_templates WHERE note_type_id = ?").all(japaneseNoteTypeId) as Array<{ name: string }>).map(
      (template) => template.name
    )
  );
  const insertTemplate = db.prepare(`
    INSERT INTO card_templates (id, note_type_id, ord, name, question_format, answer_format)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  japaneseTemplates.forEach((template, ord) => {
    if (!existingTemplates.has(template.name)) insertTemplate.run(id("template"), japaneseNoteTypeId, ord, template.name, template.qfmt, template.afmt);
  });
}

export interface CreateJapaneseNoteInput {
  deckId: string;
  fields: Record<string, string | null | undefined>;
  tags?: string[];
  sourceId?: string | null;
  ankiGuidValue?: string | null;
  ankiCardIds?: Array<number | null>;
  createAllTemplates?: boolean;
  templateNames?: string[];
}

export interface CreateNoteForNoteTypeInput {
  deckId: string;
  noteTypeId: string;
  fields: Record<string, string | null | undefined>;
  tags?: string[];
  sourceId?: string | null;
  createAllTemplates?: boolean;
}

export function createJapaneseNote(db: Database.Database, input: CreateJapaneseNoteInput) {
  ensureJapaneseNoteType(db);
  const now = nowIso();
  const normalizedFields = normalizeJapaneseFields(input.fields);
  const noteId = id("note");
  db.prepare(`
    INSERT INTO notes (id, anki_guid, note_type_id, deck_id, fields_json, tags_json, source_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    noteId,
    input.ankiGuidValue ?? ankiGuid(),
    japaneseNoteTypeId,
    input.deckId,
    JSON.stringify(normalizedFields),
    JSON.stringify(normalizeTags(input.tags)),
    input.sourceId ?? null,
    now,
    now
  );

  const templates = db
    .prepare("SELECT id, name FROM card_templates WHERE note_type_id = ? ORDER BY ord")
    .all(japaneseNoteTypeId) as Array<{ id: string; name: string }>;
  const selectedTemplates = selectJapaneseTemplates(templates, input);
  const createdCards = selectedTemplates.map((template, index) =>
    insertCard(db, {
      noteId,
      deckId: input.deckId,
      templateId: template.id,
      ankiId: input.ankiCardIds?.[index] ?? null
    })
  );

  return { noteId, cards: createdCards, fields: normalizedFields };
}

function selectJapaneseTemplates(
  templates: Array<{ id: string; name: string }>,
  input: Pick<CreateJapaneseNoteInput, "createAllTemplates" | "templateNames">
) {
  if (input.templateNames?.length) {
    const selected = templates.filter((template) => input.templateNames?.includes(template.name));
    if (selected.length > 0) return selected;
  }
  if (input.createAllTemplates) return templates.filter((template) => defaultJapaneseTemplateNames.includes(template.name));
  return templates.slice(0, 1);
}

export function createNoteForNoteType(db: Database.Database, input: CreateNoteForNoteTypeInput) {
  const fieldRows = db
    .prepare("SELECT name FROM note_fields WHERE note_type_id = ? ORDER BY ord")
    .all(input.noteTypeId) as Array<{ name: string }>;
  if (fieldRows.length === 0) throw new Error("Note type not found");
  const templates = db
    .prepare("SELECT id FROM card_templates WHERE note_type_id = ? ORDER BY ord")
    .all(input.noteTypeId) as Array<{ id: string }>;
  if (templates.length === 0) throw new Error("Note type has no card templates");

  const now = nowIso();
  const normalizedFields = Object.fromEntries(fieldRows.map((field) => [field.name, input.fields[field.name] ?? ""])) as Record<
    string,
    string
  >;
  const noteId = id("note");
  db.prepare(`
    INSERT INTO notes (id, anki_guid, note_type_id, deck_id, fields_json, tags_json, source_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    noteId,
    ankiGuid(),
    input.noteTypeId,
    input.deckId,
    JSON.stringify(normalizedFields),
    JSON.stringify(normalizeTags(input.tags)),
    input.sourceId ?? null,
    now,
    now
  );

  const selectedTemplates = input.createAllTemplates ? templates : templates.slice(0, 1);
  const createdCards = selectedTemplates.map((template) =>
    insertCard(db, {
      noteId,
      deckId: input.deckId,
      templateId: template.id
    })
  );

  return { noteId, cards: createdCards, fields: normalizedFields };
}

export function insertCard(
  db: Database.Database,
  input: { noteId: string; deckId: string; templateId: string; ankiId?: number | null; dueAt?: Date; state?: CardRecord["state"] }
) {
  const now = nowIso();
  const initial = buildInitialSchedulingState(input.dueAt ?? new Date());
  const card: CardRecord = {
    id: id("card"),
    ankiId: input.ankiId ?? numericId(),
    noteId: input.noteId,
    deckId: input.deckId,
    templateId: input.templateId,
    state: input.state ?? initial.state,
    dueAt: initial.dueAt.toISOString(),
    stability: initial.stability,
    difficulty: initial.difficulty,
    elapsedDays: initial.elapsedDays,
    scheduledDays: initial.scheduledDays,
    reps: initial.reps,
    lapses: initial.lapses,
    queue: input.state ?? initial.state,
    buriedUntil: null,
    createdAt: now,
    updatedAt: now
  };

  db.prepare(`
    INSERT INTO cards (
      id, anki_id, note_id, deck_id, template_id, state, due_at, stability, difficulty,
      elapsed_days, scheduled_days, reps, lapses, queue, buried_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    card.id,
    card.ankiId,
    card.noteId,
    card.deckId,
    card.templateId,
    card.state,
    card.dueAt,
    card.stability,
    card.difficulty,
    card.elapsedDays,
    card.scheduledDays,
    card.reps,
    card.lapses,
    card.queue,
    card.buriedUntil,
    card.createdAt,
    card.updatedAt
  );

  return card;
}

export function normalizeJapaneseFields(fields: Record<string, string | null | undefined>) {
  return Object.fromEntries(japaneseFields.map((name) => [name, fields[name] ?? ""])) as Record<string, string>;
}

export function getCardForReview(db: Database.Database, deckId?: string | null) {
  const now = nowIso();
  const deckIds = deckScopeIds(db, deckId);
  const dailyLimitScope = dailyLimitScopeResolver(db, deckId);
  const candidateRows = deckIds
    ? db
        .prepare(
          `SELECT cards.*, notes.fields_json, notes.tags_json, notes.note_type_id AS note_type_id,
                  note_types.name AS note_type_name, note_types.css AS note_type_css,
                  (SELECT group_concat(name, char(31)) FROM note_fields WHERE note_fields.note_type_id = notes.note_type_id ORDER BY ord) AS field_names,
                  card_templates.name AS template_name, card_templates.question_format, card_templates.answer_format, card_templates.ord AS template_ord
           FROM cards
           JOIN notes ON notes.id = cards.note_id
           JOIN note_types ON note_types.id = notes.note_type_id
           JOIN card_templates ON card_templates.id = cards.template_id
           WHERE cards.deck_id IN (${placeholders(deckIds)})
             AND cards.state != 'suspended'
             AND cards.due_at <= ?
             AND (cards.buried_until IS NULL OR cards.buried_until <= ?)
           ORDER BY CASE WHEN cards.state = 'new' THEN 1 ELSE 0 END, cards.due_at ASC`
        )
        .all(...deckIds, now, now)
    : db
        .prepare(
          `SELECT cards.*, notes.fields_json, notes.tags_json, notes.note_type_id AS note_type_id,
                  note_types.name AS note_type_name, note_types.css AS note_type_css,
                  (SELECT group_concat(name, char(31)) FROM note_fields WHERE note_fields.note_type_id = notes.note_type_id ORDER BY ord) AS field_names,
                  card_templates.name AS template_name, card_templates.question_format, card_templates.answer_format, card_templates.ord AS template_ord
           FROM cards
           JOIN notes ON notes.id = cards.note_id
           JOIN note_types ON note_types.id = notes.note_type_id
           JOIN card_templates ON card_templates.id = cards.template_id
           WHERE cards.state != 'suspended'
             AND cards.due_at <= ?
             AND (cards.buried_until IS NULL OR cards.buried_until <= ?)
           ORDER BY CASE WHEN cards.state = 'new' THEN 1 ELSE 0 END, cards.due_at ASC`
        )
        .all(now, now);
  const row = candidateRows.find((candidate: any) =>
    dailyLimitScope(candidate.deck_id).every((limitDeckId) => isWithinDailyLimit(db, limitDeckId, candidate.state))
  );
  if (!row) return null;
  return cardDto(row);
}

export function burySiblingCards(db: Database.Database, reviewedCard: { id: string; note_id: string }, reviewedAt = new Date()) {
  const buriedUntil = nextLocalDayStart(reviewedAt).toISOString();
  db.prepare(
    `UPDATE cards
     SET buried_until = ?, updated_at = ?
     WHERE note_id = ?
       AND id != ?
       AND state != 'suspended'
       AND (buried_until IS NULL OR buried_until < ?)`
  ).run(buriedUntil, reviewedAt.toISOString(), reviewedCard.note_id, reviewedCard.id, buriedUntil);
  return buriedUntil;
}

export function getDeckDailyProgress(db: Database.Database, deckId: string, now = new Date()) {
  const deck = db.prepare("SELECT daily_new_limit, daily_review_limit FROM decks WHERE id = ?").get(deckId) as
    | { daily_new_limit: number; daily_review_limit: number }
    | undefined;
  if (!deck) return null;
  return {
    newLimit: deck.daily_new_limit,
    reviewLimit: deck.daily_review_limit,
    newDone: countReviewsByInitialState(db, deckId, "new", now),
    reviewDone: countReviewsByInitialState(db, deckId, "review", now)
  };
}

export function deckScopeIds(db: Database.Database, deckId?: string | null): string[] | null {
  if (!deckId) return null;
  const rows = db.prepare("SELECT id, parent_id FROM decks").all() as Array<{ id: string; parent_id: string | null }>;
  const childIdsByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const children = childIdsByParent.get(row.parent_id) ?? [];
    children.push(row.id);
    childIdsByParent.set(row.parent_id, children);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const pending = [deckId];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    ids.push(current);
    pending.push(...(childIdsByParent.get(current) ?? []));
  }
  return ids;
}

export function deckDailyLimitScopeIds(db: Database.Database, cardDeckId: string, selectedDeckId?: string | null) {
  const rows = db.prepare("SELECT id, parent_id FROM decks").all() as Array<{ id: string; parent_id: string | null }>;
  return deckDailyLimitScopeIdsFromRows(rows, cardDeckId, selectedDeckId);
}

function dailyLimitScopeResolver(db: Database.Database, selectedDeckId?: string | null) {
  const rows = db.prepare("SELECT id, parent_id FROM decks").all() as Array<{ id: string; parent_id: string | null }>;
  const cache = new Map<string, string[]>();
  return (cardDeckId: string) => {
    const key = `${cardDeckId}:${selectedDeckId ?? ""}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const scope = deckDailyLimitScopeIdsFromRows(rows, cardDeckId, selectedDeckId);
    cache.set(key, scope);
    return scope;
  };
}

function deckDailyLimitScopeIdsFromRows(
  rows: Array<{ id: string; parent_id: string | null }>,
  cardDeckId: string,
  selectedDeckId?: string | null
) {
  const parentById = new Map(rows.map((row) => [row.id, row.parent_id]));
  const scope: string[] = [];
  const seen = new Set<string>();
  let current: string | null | undefined = cardDeckId;
  while (current && !seen.has(current)) {
    seen.add(current);
    scope.push(current);
    current = parentById.get(current);
  }
  return scope;
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
  css?: string | null;
  fields: string[];
  templates: Array<{ name: string; questionFormat: string; answerFormat: string }>;
}

export interface CardListOptions {
  limit?: number | null;
  offset?: number | null;
  state?: string | null;
}

export function listCards(
  db: Database.Database,
  deckId?: string | null,
  tag?: string | null,
  search?: string | null,
  options: CardListOptions = {}
) {
  const rows = queryCardRows(db, deckId);
  const normalizedTag = tag?.trim();
  const normalizedSearch = normalizeSearch(search);
  const normalizedState = options.state?.trim();
  const filteredRows = rows.filter((row: any) => {
    const tags = parseJson<string[]>(row.tags_json, []);
    if (normalizedState && row.state !== normalizedState) return false;
    if (normalizedTag && !tags.includes(normalizedTag)) return false;
    if (normalizedSearch && !cardRowMatchesSearch(row, tags, normalizedSearch)) return false;
    return true;
  });
  const total = filteredRows.length;
  const limit = clampPageLimit(options.limit);
  const offset = clampPageOffset(options.offset);
  const pageRows = filteredRows.slice(offset, offset + limit);
  return {
    cards: pageRows.map(cardDto),
    total,
    limit,
    offset,
    hasMore: offset + limit < total
  };
}

export function listTags(db: Database.Database, deckId?: string | null): TagSummary[] {
  const counts = new Map<string, number>();
  for (const row of queryCardRows(db, deckId) as any[]) {
    const tags = new Set(parseJson<string[]>(row.tags_json, []).map((tag) => tag.trim()).filter(Boolean));
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function listNoteTypes(db: Database.Database): NoteTypeSummary[] {
  return noteTypeSummaries(db);
}

export function createNoteType(db: Database.Database, input: NoteTypeDefinitionInput) {
  const definition = normalizeNoteTypeDefinition(input);
  const now = nowIso();
  const noteTypeId = id("note_type");
  db.transaction(() => {
    db.prepare(`
      INSERT INTO note_types (id, anki_id, name, css, raw_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(noteTypeId, numericId(), definition.name, definition.css, null, now, now);
    replaceNoteTypeFieldsAndTemplates(db, noteTypeId, definition);
  })();
  return getNoteTypeSummary(db, noteTypeId)!;
}

export function updateNoteType(db: Database.Database, noteTypeId: string, input: Partial<NoteTypeDefinitionInput>) {
  const existing = getNoteTypeSummary(db, noteTypeId);
  if (!existing) throw new Error("Note type not found");
  const rewritesDefinition = input.fields !== undefined || input.templates !== undefined;
  if (rewritesDefinition && existing.noteCount > 0) {
    throw new Error("Cannot rewrite fields or templates for note types with existing notes");
  }
  const nextDefinition = normalizeNoteTypeDefinition({
    name: input.name ?? existing.name,
    css: input.css ?? existing.css,
    fields: input.fields ?? existing.fields.map((field) => field.name),
    templates:
      input.templates ??
      existing.templates.map((template) => ({
        name: template.name,
        questionFormat: template.questionFormat,
        answerFormat: template.answerFormat
      }))
  });
  db.transaction(() => {
    db.prepare("UPDATE note_types SET name = ?, css = ?, updated_at = ? WHERE id = ?").run(
      nextDefinition.name,
      nextDefinition.css,
      nowIso(),
      noteTypeId
    );
    if (rewritesDefinition) replaceNoteTypeFieldsAndTemplates(db, noteTypeId, nextDefinition);
  })();
  return getNoteTypeSummary(db, noteTypeId)!;
}

export function deleteNoteType(db: Database.Database, noteTypeId: string) {
  const existing = getNoteTypeSummary(db, noteTypeId);
  if (!existing) throw new Error("Note type not found");
  if (existing.builtIn) throw new Error("Built-in Japanese note type cannot be deleted");
  if (existing.noteCount > 0 || existing.cardCount > 0) {
    throw new Error("Cannot delete note type with existing notes or cards");
  }
  db.prepare("DELETE FROM note_types WHERE id = ?").run(noteTypeId);
}

export function getNoteTypeSummary(db: Database.Database, noteTypeId: string) {
  return noteTypeSummaries(db).find((noteType) => noteType.id === noteTypeId) ?? null;
}

function noteTypeSummaries(db: Database.Database): NoteTypeSummary[] {
  const fieldsByNoteType = new Map<string, NoteTypeSummary["fields"]>();
  const templatesByNoteType = new Map<string, NoteTypeSummary["templates"]>();
  const noteCounts = new Map<string, number>();
  const cardCounts = new Map<string, number>();

  const fieldRows = db.prepare("SELECT id, note_type_id, ord, name FROM note_fields ORDER BY note_type_id, ord").all() as Array<{
    id: string;
    note_type_id: string;
    ord: number;
    name: string;
  }>;
  for (const row of fieldRows) {
    const fields = fieldsByNoteType.get(row.note_type_id) ?? [];
    fields.push({ id: row.id, ord: row.ord, name: row.name });
    fieldsByNoteType.set(row.note_type_id, fields);
  }

  const templateRows = db
    .prepare("SELECT id, note_type_id, ord, name, question_format, answer_format FROM card_templates ORDER BY note_type_id, ord")
    .all() as Array<{
    id: string;
    note_type_id: string;
    ord: number;
    name: string;
    question_format: string;
    answer_format: string;
  }>;
  for (const row of templateRows) {
    const templates = templatesByNoteType.get(row.note_type_id) ?? [];
    templates.push({
      id: row.id,
      ord: row.ord,
      name: row.name,
      questionFormat: row.question_format,
      answerFormat: row.answer_format
    });
    templatesByNoteType.set(row.note_type_id, templates);
  }

  const noteCountRows = db.prepare("SELECT note_type_id, COUNT(*) AS count FROM notes GROUP BY note_type_id").all() as Array<{
    note_type_id: string;
    count: number;
  }>;
  for (const row of noteCountRows) noteCounts.set(row.note_type_id, row.count);

  const cardCountRows = db
    .prepare(
      `SELECT notes.note_type_id, COUNT(cards.id) AS count
       FROM notes
       JOIN cards ON cards.note_id = notes.id
       GROUP BY notes.note_type_id`
    )
    .all() as Array<{ note_type_id: string; count: number }>;
  for (const row of cardCountRows) cardCounts.set(row.note_type_id, row.count);

  const rows = db.prepare("SELECT * FROM note_types ORDER BY name COLLATE NOCASE").all() as any[];
  return rows.map((row) => ({
    id: row.id,
    ankiId: row.anki_id,
    name: row.name,
    css: row.css ?? "",
    builtIn: row.id === japaneseNoteTypeId,
    hasCss: Boolean(String(row.css ?? "").trim()),
    noteCount: noteCounts.get(row.id) ?? 0,
    cardCount: cardCounts.get(row.id) ?? 0,
    fields: fieldsByNoteType.get(row.id) ?? [],
    templates: templatesByNoteType.get(row.id) ?? []
  }));
}

function normalizeNoteTypeDefinition(input: NoteTypeDefinitionInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Note type name is required");
  const fields = uniqueNames(input.fields);
  if (fields.length === 0) throw new Error("At least one field is required");
  const templates = input.templates.map((template) => ({
    name: template.name.trim(),
    questionFormat: template.questionFormat,
    answerFormat: template.answerFormat
  }));
  if (templates.length === 0 || templates.some((template) => !template.name || !template.questionFormat || !template.answerFormat)) {
    throw new Error("At least one complete template is required");
  }
  return {
    name,
    css: input.css ?? "",
    fields,
    templates
  };
}

function replaceNoteTypeFieldsAndTemplates(db: Database.Database, noteTypeId: string, input: NoteTypeDefinitionInput) {
  db.prepare("DELETE FROM note_fields WHERE note_type_id = ?").run(noteTypeId);
  db.prepare("DELETE FROM card_templates WHERE note_type_id = ?").run(noteTypeId);

  const insertField = db.prepare("INSERT INTO note_fields (id, note_type_id, ord, name) VALUES (?, ?, ?, ?)");
  input.fields.forEach((name, ord) => insertField.run(id("field"), noteTypeId, ord, name));

  const insertTemplate = db.prepare(`
    INSERT INTO card_templates (id, note_type_id, ord, name, question_format, answer_format)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  input.templates.forEach((template, ord) =>
    insertTemplate.run(id("template"), noteTypeId, ord, template.name, template.questionFormat, template.answerFormat)
  );
}

function uniqueNames(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function renameTag(db: Database.Database, oldTag: string, newTag: string, deckId?: string | null) {
  const oldName = normalizeTagName(oldTag);
  const newName = normalizeTagName(newTag);
  if (!oldName) throw new Error("Tag name is required");
  if (!newName) throw new Error("New tag name is required");
  const updatedNotes = rewriteNoteTags(db, deckId, (tags) => {
    if (!tags.includes(oldName)) return tags;
    return uniqueTags(tags.map((tag) => (tag === oldName ? newName : tag)));
  });
  const summary = listTags(db, deckId).find((tag) => tag.name === newName);
  return { tag: summary ?? { name: newName, count: 0 }, updatedNotes };
}

export function deleteTag(db: Database.Database, tag: string, deckId?: string | null) {
  const tagName = normalizeTagName(tag);
  if (!tagName) throw new Error("Tag name is required");
  const updatedNotes = rewriteNoteTags(db, deckId, (tags) => tags.filter((candidate) => candidate !== tagName));
  return { removedTag: tagName, updatedNotes };
}

function queryCardRows(db: Database.Database, deckId?: string | null) {
  const deckIds = deckScopeIds(db, deckId);
  return deckIds
    ? db
        .prepare(
          `SELECT cards.*, notes.fields_json, notes.tags_json, notes.note_type_id AS note_type_id,
                  note_types.name AS note_type_name, note_types.css AS note_type_css,
                  (SELECT group_concat(name, char(31)) FROM note_fields WHERE note_fields.note_type_id = notes.note_type_id ORDER BY ord) AS field_names,
                  card_templates.name AS template_name, card_templates.question_format, card_templates.answer_format, card_templates.ord AS template_ord
           FROM cards
           JOIN notes ON notes.id = cards.note_id
           JOIN note_types ON note_types.id = notes.note_type_id
           JOIN card_templates ON card_templates.id = cards.template_id
           WHERE cards.deck_id IN (${placeholders(deckIds)})
           ORDER BY notes.updated_at DESC`
        )
        .all(...deckIds)
    : db
        .prepare(
          `SELECT cards.*, notes.fields_json, notes.tags_json, notes.note_type_id AS note_type_id,
                  note_types.name AS note_type_name, note_types.css AS note_type_css,
                  (SELECT group_concat(name, char(31)) FROM note_fields WHERE note_fields.note_type_id = notes.note_type_id ORDER BY ord) AS field_names,
                  card_templates.name AS template_name, card_templates.question_format, card_templates.answer_format, card_templates.ord AS template_ord
           FROM cards
           JOIN notes ON notes.id = cards.note_id
           JOIN note_types ON note_types.id = notes.note_type_id
           JOIN card_templates ON card_templates.id = cards.template_id
           ORDER BY notes.updated_at DESC`
        )
        .all();
}

function cardRowMatchesSearch(row: any, tags: string[], search: string) {
  const fields = parseJson<Record<string, string>>(row.fields_json, {});
  const haystack = [...Object.values(fields), ...tags].join("\n").toLocaleLowerCase();
  return haystack.includes(search);
}

function normalizeSearch(search?: string | null) {
  const normalized = search?.trim().toLocaleLowerCase();
  return normalized || "";
}

function rewriteNoteTags(db: Database.Database, deckId: string | null | undefined, rewrite: (tags: string[]) => string[]) {
  const deckIds = deckScopeIds(db, deckId);
  const rows = deckIds
    ? (db
        .prepare(`SELECT id, tags_json FROM notes WHERE deck_id IN (${placeholders(deckIds)})`)
        .all(...deckIds) as Array<{ id: string; tags_json: string }>)
    : (db.prepare("SELECT id, tags_json FROM notes").all() as Array<{ id: string; tags_json: string }>);
  const update = db.prepare("UPDATE notes SET tags_json = ?, updated_at = ? WHERE id = ?");
  const now = nowIso();
  let updated = 0;
  db.transaction(() => {
    for (const row of rows) {
      const existing = uniqueTags(parseJson<string[]>(row.tags_json, []).map(normalizeTagName).filter(Boolean));
      const next = uniqueTags(rewrite(existing).map(normalizeTagName).filter(Boolean));
      if (JSON.stringify(existing) === JSON.stringify(next)) continue;
      update.run(JSON.stringify(next), now, row.id);
      updated += 1;
    }
  })();
  return updated;
}

function normalizeTagName(tag: string) {
  return String(tag ?? "").trim().replace(/\s+/g, "_");
}

export function normalizeTags(tags?: string[] | null) {
  return uniqueTags((tags ?? []).map(normalizeTagName).filter(Boolean));
}

function uniqueTags(tags: string[]) {
  return Array.from(new Set(tags));
}

function clampPageLimit(limit?: number | null) {
  if (!Number.isFinite(limit ?? NaN)) return 50;
  return Math.max(1, Math.min(200, Math.floor(limit!)));
}

function clampPageOffset(offset?: number | null) {
  if (!Number.isFinite(offset ?? NaN)) return 0;
  return Math.max(0, Math.floor(offset!));
}

export function cardDto(row: any) {
  const fields = parseJson<Record<string, string>>(row.fields_json, {});
  const clozeOrdinal = Number.isFinite(row.template_ord) ? Number(row.template_ord) : null;
  const question = renderCardTemplate(row.question_format, fields, "", { clozeOrdinal, clozeMode: "question" });
  const answer = renderCardTemplate(row.answer_format, fields, question, { clozeOrdinal, clozeMode: "answer" });
  const fieldNames = String(row.field_names ?? "")
    .split("\x1f")
    .map((name) => name.trim())
    .filter(Boolean);
  return {
    id: row.id,
    noteId: row.note_id,
    deckId: row.deck_id,
    state: row.state,
    dueAt: row.due_at,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsed_days,
    scheduledDays: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    noteType: {
      id: row.note_type_id,
      name: row.note_type_name,
      css: row.note_type_css ?? ""
    },
    template: {
      id: row.template_id,
      name: row.template_name,
      ord: row.template_ord
    },
    fieldNames,
    fields,
    tags: normalizeTags(parseJson<string[]>(row.tags_json, [])),
    question,
    answer
  };
}

function isWithinDailyLimit(db: Database.Database, deckId: string, state: string) {
  const progress = getDeckDailyProgress(db, deckId);
  if (!progress) return true;
  if (state === "new") return progress.newDone < progress.newLimit;
  if (state === "review") return progress.reviewDone < progress.reviewLimit;
  return true;
}

function countReviewsByInitialState(db: Database.Database, deckId: string, state: "new" | "review", now: Date) {
  const deckIds = deckScopeIds(db, deckId) ?? [deckId];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM review_logs
       JOIN cards ON cards.id = review_logs.card_id
       WHERE cards.deck_id IN (${placeholders(deckIds)})
         AND review_logs.previous_state = ?
         AND review_logs.reviewed_at >= ?
         AND review_logs.reviewed_at < ?`
    )
    .get(...deckIds, state, start.toISOString(), end.toISOString()) as { count: number };
  return row.count;
}

function placeholders(values: string[]) {
  return values.map(() => "?").join(", ");
}

export function nextLocalDayStart(now: Date) {
  const next = new Date(now);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + 1);
  return next;
}

export function defaultDeck(db: Database.Database, jlptLevel: JlptLevel = "mixed") {
  const existing = db.prepare("SELECT id FROM decks ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  if (existing) return existing.id;
  const now = nowIso();
  const deckId = id("deck");
  db.prepare(`
    INSERT INTO decks (
      id, anki_id, name, parent_id, jlpt_level, daily_new_limit, daily_review_limit,
      fsrs_retention, raw_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(deckId, numericId(), "Japanese", null, jlptLevel, 20, 200, 0.9, null, now, now);
  return deckId;
}
