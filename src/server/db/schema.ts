import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const decks = sqliteTable("decks", {
  id: text("id").primaryKey(),
  ankiId: integer("anki_id").notNull(),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  jlptLevel: text("jlpt_level").notNull(),
  dailyNewLimit: integer("daily_new_limit").notNull(),
  dailyReviewLimit: integer("daily_review_limit").notNull(),
  fsrsRetention: real("fsrs_retention").notNull(),
  rawJson: text("raw_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const deckPresets = sqliteTable("deck_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  dailyNewLimit: integer("daily_new_limit").notNull(),
  dailyReviewLimit: integer("daily_review_limit").notNull(),
  fsrsRetention: real("fsrs_retention").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const noteTypes = sqliteTable("note_types", {
  id: text("id").primaryKey(),
  ankiId: integer("anki_id").notNull(),
  name: text("name").notNull(),
  css: text("css").notNull(),
  rawJson: text("raw_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const noteFields = sqliteTable("note_fields", {
  id: text("id").primaryKey(),
  noteTypeId: text("note_type_id").notNull(),
  ord: integer("ord").notNull(),
  name: text("name").notNull()
});

export const cardTemplates = sqliteTable("card_templates", {
  id: text("id").primaryKey(),
  noteTypeId: text("note_type_id").notNull(),
  ord: integer("ord").notNull(),
  name: text("name").notNull(),
  questionFormat: text("question_format").notNull(),
  answerFormat: text("answer_format").notNull()
});

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  ankiGuid: text("anki_guid").notNull(),
  noteTypeId: text("note_type_id").notNull(),
  deckId: text("deck_id").notNull(),
  fieldsJson: text("fields_json").notNull(),
  tagsJson: text("tags_json").notNull(),
  sourceId: text("source_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  ankiId: integer("anki_id"),
  noteId: text("note_id").notNull(),
  deckId: text("deck_id").notNull(),
  templateId: text("template_id").notNull(),
  state: text("state").notNull(),
  dueAt: text("due_at").notNull(),
  stability: real("stability").notNull(),
  difficulty: real("difficulty").notNull(),
  elapsedDays: integer("elapsed_days").notNull(),
  scheduledDays: integer("scheduled_days").notNull(),
  reps: integer("reps").notNull(),
  lapses: integer("lapses").notNull(),
  queue: text("queue").notNull(),
  buriedUntil: text("buried_until"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const reviewLogs = sqliteTable("review_logs", {
  id: text("id").primaryKey(),
  cardId: text("card_id").notNull(),
  rating: text("rating").notNull(),
  elapsedMs: integer("elapsed_ms").notNull(),
  reviewedAt: text("reviewed_at").notNull(),
  previousState: text("previous_state").notNull(),
  nextState: text("next_state").notNull(),
  scheduledDays: integer("scheduled_days").notNull(),
  stability: real("stability").notNull(),
  difficulty: real("difficulty").notNull(),
  previousSnapshotJson: text("previous_snapshot_json").notNull(),
  nextSnapshotJson: text("next_snapshot_json").notNull(),
  buriedSiblingsSnapshotJson: text("buried_siblings_snapshot_json").notNull()
});

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  path: text("path").notNull(),
  checksum: text("checksum").notNull(),
  sourceId: text("source_id"),
  createdAt: text("created_at").notNull()
});

export const imports = sqliteTable("imports", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  url: text("url").notNull(),
  status: text("status").notNull(),
  includeScheduling: integer("include_scheduling").notNull(),
  error: text("error"),
  resultJson: text("result_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  contentText: text("content_text").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: text("created_at").notNull()
});

export const generationDrafts = sqliteTable("generation_drafts", {
  id: text("id").primaryKey(),
  sourceId: text("source_id"),
  deckId: text("deck_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  front: text("front").notNull(),
  back: text("back").notNull(),
  fieldsJson: text("fields_json").notNull(),
  pitchAccentStatus: text("pitch_accent_status").notNull(),
  explanationLanguages: text("explanation_languages").notNull(),
  rawJson: text("raw_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  payloadJson: text("payload_json").notNull(),
  resultJson: text("result_json"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});
