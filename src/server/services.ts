import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { buildConfig } from "./config";
import { openDatabase } from "./db/client";
import type { AppServices, CreateConfigInput, DeckRecord, DeckService, JlptLevel, SessionRecord, SessionStore } from "./types";
import { id, nowIso, numericId } from "./utils/id";
import { ensureJapaneseNoteType } from "./cards/service";
import { sessionTtlMs } from "./auth";

export function createServices(input: CreateConfigInput = {}): AppServices {
  const config = buildConfig(input);
  mkdirSync(config.dataDir, { recursive: true });
  const mediaDir = join(config.dataDir, "media");
  const packageDir = join(config.dataDir, "packages");
  mkdirSync(mediaDir, { recursive: true });
  mkdirSync(packageDir, { recursive: true });

  const { db, orm } = openDatabase(config.databaseUrl);
  ensureJapaneseNoteType(db);

  return {
    config,
    db,
    orm,
    dataDir: config.dataDir,
    mediaDir,
    packageDir,
    sessions: createSessionStore(),
    decks: createDeckService(db),
    ttsSynthesize: input.ttsSynthesize ?? null,
    generateDrafts: input.generateDrafts ?? null,
    fetchPublicUrl: input.fetchPublicUrl ?? null
  };
}

function createSessionStore(): SessionStore {
  const sessions = new Map<string, SessionRecord>();
  return {
    create() {
      const record = {
        id: id("session"),
        csrfToken: id("csrf"),
        createdAt: new Date(),
        lastSeenAt: new Date()
      };
      sessions.set(record.id, record);
      return record;
    },
    get(sessionId) {
      if (!sessionId) return null;
      const record = sessions.get(sessionId);
      if (!record) return null;
      if (Date.now() - record.createdAt.getTime() > sessionTtlMs) {
        sessions.delete(sessionId);
        return null;
      }
      record.lastSeenAt = new Date();
      return record;
    },
    delete(sessionId) {
      if (sessionId) sessions.delete(sessionId);
    }
  };
}

function createDeckService(db: Database.Database): DeckService {
  return {
    createDeck(input) {
      const now = nowIso();
      const row: DeckRecord = {
        id: id("deck"),
        ankiId: numericId(),
        name: input.name.trim(),
        parentId: input.parentId ?? null,
        jlptLevel: normalizeJlpt(input.jlptLevel),
        dailyNewLimit: 20,
        dailyReviewLimit: 200,
        fsrsRetention: 0.9,
        createdAt: now,
        updatedAt: now
      };
      db.prepare(`
        INSERT INTO decks (
          id, anki_id, name, parent_id, jlpt_level, daily_new_limit, daily_review_limit,
          fsrs_retention, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id,
        row.ankiId,
        row.name,
        row.parentId,
        row.jlptLevel,
        row.dailyNewLimit,
        row.dailyReviewLimit,
        row.fsrsRetention,
        null,
        row.createdAt,
        row.updatedAt
      );
      return row;
    },
    listDecks() {
      return db
        .prepare("SELECT * FROM decks ORDER BY name COLLATE NOCASE")
        .all()
        .map(mapDeck);
    },
    getDeck(deckId) {
      const row = db.prepare("SELECT * FROM decks WHERE id = ?").get(deckId);
      return row ? mapDeck(row) : null;
    }
  };
}

export function mapDeck(row: any): DeckRecord {
  return {
    id: row.id,
    ankiId: row.anki_id,
    name: row.name,
    parentId: row.parent_id,
    jlptLevel: normalizeJlpt(row.jlpt_level),
    dailyNewLimit: row.daily_new_limit,
    dailyReviewLimit: row.daily_review_limit,
    fsrsRetention: row.fsrs_retention,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeJlpt(value: unknown): JlptLevel {
  if (value === "N5" || value === "N4" || value === "N3" || value === "N2" || value === "N1") return value;
  return "mixed";
}
