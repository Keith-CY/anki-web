import type Database from "better-sqlite3";

export function migrate(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      anki_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      parent_id TEXT,
      jlpt_level TEXT NOT NULL DEFAULT 'mixed',
      daily_new_limit INTEGER NOT NULL DEFAULT 20,
      daily_review_limit INTEGER NOT NULL DEFAULT 200,
      fsrs_retention REAL NOT NULL DEFAULT 0.9,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deck_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      daily_new_limit INTEGER NOT NULL,
      daily_review_limit INTEGER NOT NULL,
      fsrs_retention REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS note_types (
      id TEXT PRIMARY KEY,
      anki_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      css TEXT NOT NULL,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS note_fields (
      id TEXT PRIMARY KEY,
      note_type_id TEXT NOT NULL REFERENCES note_types(id) ON DELETE CASCADE,
      ord INTEGER NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(note_type_id, ord)
    );

    CREATE TABLE IF NOT EXISTS card_templates (
      id TEXT PRIMARY KEY,
      note_type_id TEXT NOT NULL REFERENCES note_types(id) ON DELETE CASCADE,
      ord INTEGER NOT NULL,
      name TEXT NOT NULL,
      question_format TEXT NOT NULL,
      answer_format TEXT NOT NULL,
      UNIQUE(note_type_id, ord)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      anki_guid TEXT NOT NULL UNIQUE,
      note_type_id TEXT NOT NULL REFERENCES note_types(id),
      deck_id TEXT NOT NULL REFERENCES decks(id),
      fields_json TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      source_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      anki_id INTEGER UNIQUE,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL REFERENCES decks(id),
      template_id TEXT NOT NULL REFERENCES card_templates(id),
      state TEXT NOT NULL,
      due_at TEXT NOT NULL,
      stability REAL NOT NULL DEFAULT 0,
      difficulty REAL NOT NULL DEFAULT 0,
      elapsed_days INTEGER NOT NULL DEFAULT 0,
      scheduled_days INTEGER NOT NULL DEFAULT 0,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      queue TEXT NOT NULL DEFAULT 'new',
      buried_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_logs (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      rating TEXT NOT NULL,
      elapsed_ms INTEGER NOT NULL,
      reviewed_at TEXT NOT NULL,
      previous_state TEXT NOT NULL,
      next_state TEXT NOT NULL,
      scheduled_days INTEGER NOT NULL,
      stability REAL NOT NULL,
      difficulty REAL NOT NULL,
      previous_snapshot_json TEXT NOT NULL DEFAULT '{}',
      next_snapshot_json TEXT NOT NULL DEFAULT '{}',
      buried_siblings_snapshot_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      path TEXT NOT NULL,
      checksum TEXT NOT NULL UNIQUE,
      source_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      include_scheduling INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      content_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_drafts (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      deck_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      pitch_accent_status TEXT NOT NULL,
      explanation_languages TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(deck_id, state, due_at);
    CREATE INDEX IF NOT EXISTS idx_cards_note ON cards(note_id);
    CREATE INDEX IF NOT EXISTS idx_notes_deck ON notes(deck_id);
    CREATE INDEX IF NOT EXISTS idx_drafts_status ON generation_drafts(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_imports_status ON imports(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, updated_at);

    INSERT OR IGNORE INTO deck_presets (
      id, name, description, daily_new_limit, daily_review_limit, fsrs_retention, created_at, updated_at
    ) VALUES
      ('preset_light', 'Light', 'Low daily load for busy days or new habits.', 10, 80, 0.88, datetime('now'), datetime('now')),
      ('preset_balanced', 'Balanced', 'Default daily pace for steady Japanese study.', 20, 200, 0.9, datetime('now'), datetime('now')),
      ('preset_intensive', 'Intensive', 'Higher daily limits and retention target for focused study blocks.', 40, 400, 0.92, datetime('now'), datetime('now'));
  `);
  const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
  if (!jobColumns.some((column) => column.name === "result_json")) {
    db.exec("ALTER TABLE jobs ADD COLUMN result_json TEXT");
  }
  const reviewLogColumns = db.prepare("PRAGMA table_info(review_logs)").all() as Array<{ name: string }>;
  if (!reviewLogColumns.some((column) => column.name === "previous_snapshot_json")) {
    db.exec("ALTER TABLE review_logs ADD COLUMN previous_snapshot_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (!reviewLogColumns.some((column) => column.name === "next_snapshot_json")) {
    db.exec("ALTER TABLE review_logs ADD COLUMN next_snapshot_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (!reviewLogColumns.some((column) => column.name === "buried_siblings_snapshot_json")) {
    db.exec("ALTER TABLE review_logs ADD COLUMN buried_siblings_snapshot_json TEXT NOT NULL DEFAULT '[]'");
  }
}
