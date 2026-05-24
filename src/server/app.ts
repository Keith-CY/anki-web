import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import * as cheerio from "cheerio";
import JSZip from "jszip";
import type { Element } from "domhandler";
import type { AppServices, ReviewRating } from "./types";
import {
  attachSessionCookie,
  checkLoginRateLimit,
  clearSessionCookie,
  readSession,
  requireAuth,
  requireCsrf,
  resetLoginRateLimit,
  verifyPassword
} from "./auth";
import { AnkiPackageWorker } from "./anki/worker";
import {
  burySiblingCards,
  cardDto,
  createJapaneseNote,
  createNoteForNoteType,
  createNoteType,
  deckDailyLimitScopeIds,
  deckScopeIds,
  deleteNoteType,
  deleteTag,
  getCardForReview,
  getDeckDailyProgress,
  getNoteTypeSummary,
  listCards,
  listNoteTypes,
  listTags,
  nextLocalDayStart,
  normalizeTags,
  renameTag,
  updateNoteType
} from "./cards/service";
import { fetchPublicUrl } from "./imports/fetch";
import { completeJob, createJob, failJob, getJob, listJobs } from "./jobs/service";
import { preserveRubyReadings } from "./htmlText";
import { applyReviewAnswer, buildInitialSchedulingState, previewReviewAnswers, type SchedulingState } from "./review/scheduler";
import { checksum, id, nowIso, parseJson, safeFileName } from "./utils/id";
import {
  approveDraft,
  approveDrafts,
  generateCardAudio,
  generateDraftAudio,
  generateDraftAudios,
  generateDraftsFromArticleUrl,
  generateDraftsFromTextMaterial,
  GenerationInputError,
  generationPreview,
  getDraft,
  ImportJobFailure,
  listDrafts,
  regenerateDraftsFromSource,
  rejectDraft,
  rejectDrafts,
  updateDraft
} from "./generation/service";

const loginSchema = z.object({ password: z.string().min(1) });
const createDeckSchema = z.object({
  name: z.string().min(1),
  jlptLevel: z.enum(["N5", "N4", "N3", "N2", "N1", "mixed"]).optional(),
  parentId: z.string().nullable().optional()
});
const updateDeckSchema = z.object({
  name: z.string().min(1).optional(),
  jlptLevel: z.enum(["N5", "N4", "N3", "N2", "N1", "mixed"]).optional(),
  parentId: z.string().nullable().optional(),
  dailyNewLimit: z.number().int().min(0).max(999).optional(),
  dailyReviewLimit: z.number().int().min(0).max(9999).optional(),
  fsrsRetention: z.number().min(0.7).max(0.99).optional()
});
const applyDeckPresetSchema = z.object({
  presetId: z.string().min(1)
});
const createCardSchema = z.object({
  deckId: z.string().min(1),
  noteTypeId: z.string().min(1).optional(),
  fields: z.record(z.string(), z.string().nullable().optional()),
  tags: z.array(z.string()).optional(),
  createAllTemplates: z.boolean().default(false),
  templateNames: z.array(z.string().trim().min(1).max(120)).max(20).optional()
});
const updateCardSchema = z.object({
  fields: z.record(z.string(), z.string().nullable().optional()).optional(),
  tags: z.array(z.string()).optional(),
  deckId: z.string().min(1).optional()
});
const cardListQuerySchema = z.object({
  state: z.enum(["new", "learning", "review", "relearning", "suspended"]).optional()
});
const updateNoteSchema = updateCardSchema;
const renameTagSchema = z.object({
  name: z.string().trim().min(1).max(120),
  deckId: z.string().min(1).nullable().optional()
});
const bulkTagStateSchema = z.object({
  action: z.enum(["suspend", "unsuspend"]),
  deckId: z.string().min(1).nullable().optional()
});
const noteTypeTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  questionFormat: z.string().min(1).max(100_000),
  answerFormat: z.string().min(1).max(100_000)
});
const createNoteTypeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  css: z.string().max(100_000).optional().default(""),
  fields: z.array(z.string().trim().min(1).max(120)).min(1).max(80),
  templates: z.array(noteTypeTemplateSchema).min(1).max(50)
});
const updateNoteTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    css: z.string().max(100_000).optional(),
    fields: z.array(z.string().trim().min(1).max(120)).min(1).max(80).optional(),
    templates: z.array(noteTypeTemplateSchema).min(1).max(50).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one note type field is required");
const answerSchema = z.object({
  rating: z.enum(["Again", "Hard", "Good", "Easy"]),
  elapsedMs: z.number().int().min(0).max(600_000).default(0)
});
const urlImportSchema = z.object({
  url: z.string().url(),
  includeScheduling: z.boolean().default(false)
});
const ankiPackageContentTypes = [
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.anki",
  "application/vnd.anki.package",
  "application/x-anki",
  "application/apkg",
  "application/x-apkg",
  "application/colpkg",
  "application/x-colpkg",
  "binary/octet-stream"
];
const fileImportSchema = z.object({
  includeScheduling: z.boolean().default(false)
});
const articleImportSchema = z.object({
  url: z.string().url(),
  deckId: z.string().nullable().optional(),
  jlptLevel: z.enum(["N5", "N4", "N3", "N2", "N1", "mixed"]).nullable().optional()
});
const sourceRegenerationSchema = z.object({
  deckId: z.string().nullable().optional(),
  jlptLevel: z.enum(["N5", "N4", "N3", "N2", "N1", "mixed"]).nullable().optional()
});
const textMaterialImportSchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(20).max(200_000),
  deckId: z.string().nullable().optional(),
  jlptLevel: z.enum(["N5", "N4", "N3", "N2", "N1", "mixed"]).nullable().optional()
});
const updateDraftSchema = z.object({
  kind: z.enum(["vocabulary", "grammar", "pronunciation"]).optional(),
  fields: z.record(z.string(), z.string().nullable().optional()).optional(),
  tags: z.array(z.string()).optional(),
  pitchAccentStatus: z.enum(["confirmed", "review-required"]).optional(),
  deckId: z.string().nullable().optional()
});
const draftListQuerySchema = z.object({
  status: z.enum(["draft", "approved", "rejected"]).default("draft"),
  deckId: z.string().min(1).optional(),
  kind: z.enum(["vocabulary", "grammar", "pronunciation"]).optional(),
  pitchAccentStatus: z.enum(["confirmed", "review-required"]).optional()
});
const bulkDraftApprovalSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  deckId: z.string().min(1).nullable().optional()
});
const bulkDraftRejectSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200)
});
const bulkDraftAudioSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200)
});
const audioGenerationSchema = z.object({
  text: z.string().min(1).optional()
});
const packageExportSchema = z.object({
  includeMedia: z.boolean().default(true),
  includeScheduling: z.boolean().default(false),
  legacySupport: z.boolean().default(true)
});
const settingsPreferencesSchema = z.object({
  defaultJlptLevel: z.enum(["N5", "N4", "N3", "N2", "N1", "mixed"]).default("mixed"),
  packageImport: z
    .object({
      includeScheduling: z.boolean().default(false)
    })
    .default({ includeScheduling: false }),
  packageExport: packageExportSchema.default({ includeMedia: true, includeScheduling: false, legacySupport: true })
});
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'"
].join("; ");

export function createServerApp(services: AppServices) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    applySecurityHeaders(c, services.config.nodeEnv);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/media/:fileName", async (c) => {
    const session = await readSession(c, services);
    if (!session) return c.json({ error: "Authentication required" }, 401);
    const fileName = basename(decodePathParam(c.req.param("fileName")));
    const asset = services.db
      .prepare("SELECT * FROM media_assets WHERE file_name = ? OR original_name = ? ORDER BY created_at DESC LIMIT 1")
      .get(fileName, fileName) as any;
    if (!asset || !existsSync(asset.path)) return c.json({ error: "Media not found" }, 404);
    return new Response(new Uint8Array(readFileSync(asset.path)), {
      headers: mediaResponseHeaders(asset.mime_type, fileName)
    });
  });

  app.get("/api/session", async (c) => {
    const session = await readSession(c, services);
    return c.json({ authenticated: Boolean(session), csrfToken: session?.csrfToken ?? null });
  });

  app.post("/api/session/login", async (c) => {
    if (!(await checkLoginRateLimit(c))) {
      return c.json({ error: "Too many login attempts" }, 429);
    }
    const body = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Password is required" }, 400);
    if (!(await verifyPassword(services, body.data.password))) {
      return c.json({ error: "Invalid password" }, 401);
    }
    resetLoginRateLimit(c);
    const session = services.sessions.create();
    await attachSessionCookie(c, services, session);
    return c.json({ authenticated: true, csrfToken: session.csrfToken });
  });

  app.delete("/api/session", async (c) => {
    const session = await readSession(c, services);
    if (session && c.req.header("x-csrf-token") !== session.csrfToken) {
      return c.json({ error: "Invalid CSRF token" }, 403);
    }
    services.sessions.delete(session?.id);
    clearSessionCookie(c);
    return c.json({ authenticated: false });
  });

  app.use("/api/*", requireAuth(services));
  app.use("/api/*", requireCsrf());

  app.get("/api/settings", (c) => c.json({ settings: settingsDto(services) }));

  app.patch("/api/settings/preferences", async (c) => {
    const body = settingsPreferencesSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid settings preferences payload", issues: body.error.issues }, 400);
    const preferences = saveSettingsPreferences(services, body.data);
    return c.json({ preferences });
  });

  app.get("/api/jobs", (c) => c.json({ jobs: listJobs(services.db) }));

  app.get("/api/jobs/:id", (c) => {
    const job = getJob(services.db, c.req.param("id"));
    if (!job) return c.json({ error: "Job not found" }, 404);
    return c.json(job);
  });

  app.get("/api/decks", (c) => c.json({ decks: services.decks.listDecks() }));

  app.get("/api/decks/:id", (c) => {
    const deck = services.decks.getDeck(c.req.param("id"));
    if (!deck) return c.json({ error: "Deck not found" }, 404);
    return c.json(deck);
  });

  app.get("/api/deck-presets", (c) => {
    const rows = services.db.prepare("SELECT * FROM deck_presets ORDER BY daily_new_limit ASC, name COLLATE NOCASE").all() as any[];
    return c.json({ presets: rows.map(deckPresetDto) });
  });

  app.post("/api/decks", async (c) => {
    const body = createDeckSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid deck payload", issues: body.error.issues }, 400);
    if (body.data.parentId && !services.decks.getDeck(body.data.parentId)) {
      return c.json({ error: "Parent deck not found" }, 404);
    }
    const deck = services.decks.createDeck(body.data);
    return c.json(deck, 201);
  });

  app.patch("/api/decks/:id", async (c) => {
    const body = updateDeckSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid deck payload", issues: body.error.issues }, 400);
    const existing = services.decks.getDeck(c.req.param("id"));
    if (!existing) return c.json({ error: "Deck not found" }, 404);
    const parentValidation = validateDeckParentUpdate(services, existing.id, body.data.parentId);
    if (!parentValidation.ok) return c.json({ error: parentValidation.error }, parentValidation.status);
    const next = {
      name: body.data.name ?? existing.name,
      jlptLevel: body.data.jlptLevel ?? existing.jlptLevel,
      parentId: body.data.parentId === undefined ? existing.parentId : body.data.parentId,
      dailyNewLimit: body.data.dailyNewLimit ?? existing.dailyNewLimit,
      dailyReviewLimit: body.data.dailyReviewLimit ?? existing.dailyReviewLimit,
      fsrsRetention: body.data.fsrsRetention ?? existing.fsrsRetention
    };
    services.db
      .prepare(
        `UPDATE decks
         SET name = ?, parent_id = ?, jlpt_level = ?, daily_new_limit = ?, daily_review_limit = ?, fsrs_retention = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(next.name, next.parentId, next.jlptLevel, next.dailyNewLimit, next.dailyReviewLimit, next.fsrsRetention, nowIso(), existing.id);
    return c.json(services.decks.getDeck(existing.id));
  });

  app.post("/api/decks/:id/apply-preset", async (c) => {
    const body = applyDeckPresetSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid deck preset payload", issues: body.error.issues }, 400);
    const existing = services.decks.getDeck(c.req.param("id"));
    if (!existing) return c.json({ error: "Deck not found" }, 404);
    const preset = services.db.prepare("SELECT * FROM deck_presets WHERE id = ?").get(body.data.presetId) as any;
    if (!preset) return c.json({ error: "Deck preset not found" }, 404);
    services.db
      .prepare(
        `UPDATE decks
         SET daily_new_limit = ?, daily_review_limit = ?, fsrs_retention = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(preset.daily_new_limit, preset.daily_review_limit, preset.fsrs_retention, nowIso(), existing.id);
    return c.json({ deck: services.decks.getDeck(existing.id), preset: deckPresetDto(preset) });
  });

  app.delete("/api/decks/:id", (c) => {
    const existing = services.decks.getDeck(c.req.param("id"));
    if (!existing) return c.json({ error: "Deck not found" }, 404);
    services.db.transaction(() => {
      services.db.prepare("UPDATE decks SET parent_id = NULL, updated_at = ? WHERE parent_id = ?").run(nowIso(), existing.id);
      services.db.prepare("DELETE FROM review_logs WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?)").run(existing.id);
      services.db.prepare("DELETE FROM cards WHERE deck_id = ?").run(existing.id);
      services.db.prepare("DELETE FROM notes WHERE deck_id = ?").run(existing.id);
      services.db.prepare("DELETE FROM generation_drafts WHERE deck_id = ?").run(existing.id);
      services.db.prepare("DELETE FROM decks WHERE id = ?").run(existing.id);
    })();
    return c.json({ ok: true });
  });

  app.post("/api/decks/:id/unbury", (c) => {
    const existing = services.decks.getDeck(c.req.param("id"));
    if (!existing) return c.json({ error: "Deck not found" }, 404);
    const deckIds = deckScopeIds(services.db, existing.id) ?? [existing.id];
    const result = services.db
      .prepare(
        `UPDATE cards
         SET buried_until = NULL, updated_at = ?
         WHERE deck_id IN (${sqlPlaceholders(deckIds)})
           AND buried_until IS NOT NULL
           AND state != 'suspended'`
      )
      .run(nowIso(), ...deckIds);
    return c.json({ ok: true, restoredCards: result.changes });
  });

  app.get("/api/cards", (c) => {
    const query = cardListQuerySchema.safeParse({ state: c.req.query("state") || undefined });
    if (!query.success) return c.json({ error: "Invalid card query", issues: query.error.issues }, 400);
    return c.json(
      listCards(services.db, c.req.query("deckId"), c.req.query("tag"), c.req.query("q"), {
        limit: parseOptionalInteger(c.req.query("limit")),
        offset: parseOptionalInteger(c.req.query("offset")),
        state: query.data.state
      })
    );
  });

  app.get("/api/cards/:id", (c) => {
    const card = services.db.prepare("SELECT id FROM cards WHERE id = ?").get(c.req.param("id"));
    if (!card) return c.json({ error: "Card not found" }, 404);
    return c.json({ card: loadCardDto(services, c.req.param("id")) });
  });

  app.get("/api/tags", (c) => c.json({ tags: listTags(services.db, c.req.query("deckId")) }));

  app.get("/api/note-types", (c) => c.json({ noteTypes: listNoteTypes(services.db) }));

  app.get("/api/note-types/:id", (c) => {
    const noteType = getNoteTypeSummary(services.db, c.req.param("id"));
    if (!noteType) return c.json({ error: "Note type not found" }, 404);
    return c.json({ noteType });
  });

  app.post("/api/note-types", async (c) => {
    const body = createNoteTypeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid note type payload", issues: body.error.issues }, 400);
    try {
      return c.json({ noteType: createNoteType(services.db, body.data) }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.patch("/api/note-types/:id", async (c) => {
    const body = updateNoteTypeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid note type payload", issues: body.error.issues }, 400);
    try {
      return c.json({ noteType: updateNoteType(services.db, c.req.param("id"), body.data) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, message === "Note type not found" ? 404 : 400);
    }
  });

  app.delete("/api/note-types/:id", (c) => {
    try {
      deleteNoteType(services.db, c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, message === "Note type not found" ? 404 : 400);
    }
  });

  app.patch("/api/tags/:name", async (c) => {
    const body = renameTagSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid tag payload", issues: body.error.issues }, 400);
    try {
      return c.json(renameTag(services.db, decodePathParam(c.req.param("name")), body.data.name, body.data.deckId));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/tags/:name/bulk-state", async (c) => {
    const body = bulkTagStateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid tag bulk-state payload", issues: body.error.issues }, 400);
    try {
      const result = setTagCardState(services, decodePathParam(c.req.param("name")), body.data.action, body.data.deckId);
      return c.json({ ok: true, action: body.data.action, ...result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete("/api/tags/:name", (c) => {
    try {
      const result = deleteTag(services.db, decodePathParam(c.req.param("name")), c.req.query("deckId"));
      return c.json({ ok: true, ...result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/media", (c) => {
    const rows = services.db.prepare("SELECT * FROM media_assets ORDER BY created_at DESC LIMIT 200").all() as any[];
    return c.json({ assets: rows.map(mediaAssetDto) });
  });

  app.get("/api/media/:id", (c) => {
    const asset = services.db.prepare("SELECT * FROM media_assets WHERE id = ?").get(c.req.param("id")) as any;
    if (!asset) return c.json({ error: "Media not found" }, 404);
    return c.json({ asset: mediaAssetDto(asset) });
  });

  app.post("/api/media", async (c) => {
    const body = await c.req.parseBody().catch(() => null);
    const file = uploadFileFromBody(body?.file);
    if (!file) return c.json({ error: "Media file is required" }, 400);
    try {
      const uploaded = await storeUploadedMedia(services, file);
      return c.json(uploaded, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete("/api/media/:id", (c) => {
    const asset = services.db.prepare("SELECT * FROM media_assets WHERE id = ?").get(c.req.param("id")) as any;
    if (!asset) return c.json({ error: "Media not found" }, 404);
    services.db.transaction(() => {
      clearMediaReferences(services, asset);
      services.db.prepare("DELETE FROM media_assets WHERE id = ?").run(asset.id);
    })();
    if (asset.path && existsSync(asset.path)) {
      rmSync(asset.path, { force: true });
    }
    return c.json({ ok: true });
  });

  app.post("/api/cards", async (c) => {
    const body = createCardSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid card payload", issues: body.error.issues }, 400);
    if (!services.decks.getDeck(body.data.deckId)) return c.json({ error: "Deck not found" }, 404);
    const noteTypeId = body.data.noteTypeId;
    if (noteTypeId && !services.db.prepare("SELECT id FROM note_types WHERE id = ?").get(noteTypeId)) {
      return c.json({ error: "Note type not found" }, 404);
    }
    const created = createManagedNote(services, body.data);
    return c.json({ noteId: created.note.id, card: created.note.cards[0], cards: created.note.cards }, 201);
  });

  app.post("/api/notes", async (c) => {
    const body = createCardSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid note payload", issues: body.error.issues }, 400);
    if (!services.decks.getDeck(body.data.deckId)) return c.json({ error: "Deck not found" }, 404);
    const noteTypeId = body.data.noteTypeId;
    if (noteTypeId && !services.db.prepare("SELECT id FROM note_types WHERE id = ?").get(noteTypeId)) {
      return c.json({ error: "Note type not found" }, 404);
    }
    return c.json(createManagedNote(services, body.data), 201);
  });

  app.patch("/api/cards/:id", async (c) => {
    const body = updateCardSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid card payload", issues: body.error.issues }, 400);
    const card = services.db.prepare("SELECT * FROM cards WHERE id = ?").get(c.req.param("id")) as any;
    if (!card) return c.json({ error: "Card not found" }, 404);
    const note = services.db.prepare("SELECT * FROM notes WHERE id = ?").get(card.note_id) as any;
    if (!note) return c.json({ error: "Note not found" }, 404);
    const targetDeckId = body.data.deckId ?? note.deck_id;
    if (body.data.deckId && !services.decks.getDeck(body.data.deckId)) {
      return c.json({ error: "Target deck not found" }, 404);
    }
    const existingFields = JSON.parse(note.fields_json) as Record<string, string>;
    const updatedFields = { ...existingFields, ...(body.data.fields ?? {}) };
    services.db.transaction(() => {
      const updatedAt = nowIso();
      services.db
        .prepare("UPDATE notes SET deck_id = ?, fields_json = ?, tags_json = ?, updated_at = ? WHERE id = ?")
        .run(
          targetDeckId,
          JSON.stringify(updatedFields),
          JSON.stringify(body.data.tags === undefined ? normalizeTags(JSON.parse(note.tags_json)) : normalizeTags(body.data.tags)),
          updatedAt,
          note.id
        );
      if (targetDeckId !== note.deck_id) {
        services.db.prepare("UPDATE cards SET deck_id = ?, updated_at = ? WHERE note_id = ?").run(targetDeckId, updatedAt, note.id);
      }
    })();
    const updated = services.db
      .prepare(
        `SELECT cards.*, notes.fields_json, notes.tags_json, notes.note_type_id AS note_type_id,
                note_types.name AS note_type_name, note_types.css AS note_type_css,
                (SELECT group_concat(name, char(31)) FROM note_fields WHERE note_fields.note_type_id = notes.note_type_id ORDER BY ord) AS field_names,
                card_templates.name AS template_name, card_templates.question_format, card_templates.answer_format, card_templates.ord AS template_ord
         FROM cards
         JOIN notes ON notes.id = cards.note_id
         JOIN note_types ON note_types.id = notes.note_type_id
         JOIN card_templates ON card_templates.id = cards.template_id
         WHERE cards.id = ?`
      )
      .get(card.id);
    return c.json({ card: cardDto(updated) });
  });

  app.delete("/api/cards/:id", (c) => {
    const card = services.db.prepare("SELECT * FROM cards WHERE id = ?").get(c.req.param("id")) as any;
    if (!card) return c.json({ error: "Card not found" }, 404);
    services.db.transaction(() => {
      services.db.prepare("DELETE FROM review_logs WHERE card_id = ?").run(card.id);
      services.db.prepare("DELETE FROM cards WHERE id = ?").run(card.id);
      const remaining = services.db.prepare("SELECT COUNT(*) AS count FROM cards WHERE note_id = ?").get(card.note_id) as { count: number };
      if (remaining.count === 0) {
        services.db.prepare("DELETE FROM notes WHERE id = ?").run(card.note_id);
      }
    })();
    return c.json({ ok: true });
  });

  app.get("/api/notes/:id", (c) => {
    const note = loadNoteDto(services, c.req.param("id"));
    if (!note) return c.json({ error: "Note not found" }, 404);
    return c.json({ note });
  });

  app.patch("/api/notes/:id", async (c) => {
    const body = updateNoteSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid note payload", issues: body.error.issues }, 400);
    const note = services.db.prepare("SELECT * FROM notes WHERE id = ?").get(c.req.param("id")) as any;
    if (!note) return c.json({ error: "Note not found" }, 404);
    const targetDeckId = body.data.deckId ?? note.deck_id;
    if (body.data.deckId && !services.decks.getDeck(body.data.deckId)) {
      return c.json({ error: "Target deck not found" }, 404);
    }
    const existingFields = JSON.parse(note.fields_json) as Record<string, string>;
    const updatedFields = { ...existingFields, ...(body.data.fields ?? {}) };
    const updatedTags = body.data.tags === undefined ? normalizeTags(JSON.parse(note.tags_json)) : normalizeTags(body.data.tags);
    const updatedAt = nowIso();
    services.db.transaction(() => {
      services.db
        .prepare("UPDATE notes SET deck_id = ?, fields_json = ?, tags_json = ?, updated_at = ? WHERE id = ?")
        .run(targetDeckId, JSON.stringify(updatedFields), JSON.stringify(updatedTags), updatedAt, note.id);
      if (targetDeckId !== note.deck_id) {
        services.db.prepare("UPDATE cards SET deck_id = ?, updated_at = ? WHERE note_id = ?").run(targetDeckId, updatedAt, note.id);
      }
    })();
    return c.json({ note: loadNoteDto(services, note.id) });
  });

  app.delete("/api/notes/:id", (c) => {
    const note = services.db.prepare("SELECT * FROM notes WHERE id = ?").get(c.req.param("id")) as any;
    if (!note) return c.json({ error: "Note not found" }, 404);
    const cards = services.db.prepare("SELECT id FROM cards WHERE note_id = ?").all(note.id) as Array<{ id: string }>;
    services.db.transaction(() => {
      services.db.prepare("DELETE FROM review_logs WHERE card_id IN (SELECT id FROM cards WHERE note_id = ?)").run(note.id);
      services.db.prepare("DELETE FROM cards WHERE note_id = ?").run(note.id);
      services.db.prepare("DELETE FROM notes WHERE id = ?").run(note.id);
    })();
    return c.json({ ok: true, deletedCards: cards.length });
  });

  app.post("/api/cards/:id/suspend", (c) => {
    const card = services.db.prepare("SELECT * FROM cards WHERE id = ?").get(c.req.param("id")) as any;
    if (!card) return c.json({ error: "Card not found" }, 404);
    services.db
      .prepare("UPDATE cards SET state = 'suspended', queue = 'suspended', buried_until = NULL, updated_at = ? WHERE id = ?")
      .run(nowIso(), card.id);
    return c.json({ card: loadCardDto(services, card.id) });
  });

  app.post("/api/cards/:id/unsuspend", (c) => {
    const card = services.db.prepare("SELECT * FROM cards WHERE id = ?").get(c.req.param("id")) as any;
    if (!card) return c.json({ error: "Card not found" }, 404);
    const restoredState = card.reps > 0 ? "review" : "new";
    services.db
      .prepare("UPDATE cards SET state = ?, queue = ?, buried_until = NULL, updated_at = ? WHERE id = ?")
      .run(restoredState, restoredState, nowIso(), card.id);
    return c.json({ card: loadCardDto(services, card.id) });
  });

  app.post("/api/cards/:id/reset", (c) => {
    const card = services.db.prepare("SELECT * FROM cards WHERE id = ?").get(c.req.param("id")) as any;
    if (!card) return c.json({ error: "Card not found" }, 404);
    const resetAt = new Date();
    const initial = buildInitialSchedulingState(resetAt);
    services.db.transaction(() => {
      services.db.prepare("DELETE FROM review_logs WHERE card_id = ?").run(card.id);
      services.db
        .prepare(
          `UPDATE cards
           SET state = 'new', queue = 'new', due_at = ?, stability = ?, difficulty = ?,
               elapsed_days = 0, scheduled_days = 0, reps = 0, lapses = 0,
               buried_until = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(initial.dueAt.toISOString(), initial.stability, initial.difficulty, nowIso(resetAt), card.id);
    })();
    return c.json({ card: loadCardDto(services, card.id) });
  });

  app.post("/api/cards/:id/audio", async (c) => {
    const body = audioGenerationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid audio payload", issues: body.error.issues }, 400);
    try {
      const result = await generateCardAudio(services, c.req.param("id"), body.data.text);
      const updated = services.db
        .prepare(
          `SELECT cards.*, notes.fields_json, notes.tags_json, notes.note_type_id AS note_type_id,
                  note_types.name AS note_type_name, note_types.css AS note_type_css,
                  (SELECT group_concat(name, char(31)) FROM note_fields WHERE note_fields.note_type_id = notes.note_type_id ORDER BY ord) AS field_names,
                  card_templates.name AS template_name, card_templates.question_format, card_templates.answer_format, card_templates.ord AS template_ord
           FROM cards
           JOIN notes ON notes.id = cards.note_id
           JOIN note_types ON note_types.id = notes.note_type_id
           JOIN card_templates ON card_templates.id = cards.template_id
           WHERE cards.id = ?`
        )
        .get(c.req.param("id"));
      return c.json({ audio: result.audio, card: cardDto(updated) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/review/next", (c) => {
    const card = getCardForReview(services.db, c.req.query("deckId"));
    if (!card) return c.json({ card: null, previews: null });
    const row = services.db.prepare("SELECT * FROM cards WHERE id = ?").get(card.id) as any;
    return c.json({ card, previews: previewReviewAnswers(schedulingStateFromCardRow(row), new Date(), schedulingOptionsForCardRow(services, row)) });
  });

  app.post("/api/review/:cardId/bury", (c) => {
    const card = services.db.prepare("SELECT * FROM cards WHERE id = ?").get(c.req.param("cardId")) as any;
    if (!card) return c.json({ error: "Card not found" }, 404);
    if (card.state === "suspended") return c.json({ error: "Suspended cards cannot be buried from review" }, 400);
    const buriedAt = new Date();
    const buriedUntil = nextLocalDayStart(buriedAt).toISOString();
    services.db
      .prepare("UPDATE cards SET buried_until = ?, updated_at = ? WHERE id = ?")
      .run(buriedUntil, buriedAt.toISOString(), card.id);
    return c.json({ card: loadCardDto(services, card.id), buriedUntil });
  });

  app.post("/api/review/:cardId/answer", async (c) => {
    const body = answerSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid review answer", issues: body.error.issues }, 400);
    const card = services.db.prepare("SELECT * FROM cards WHERE id = ?").get(c.req.param("cardId")) as any;
    if (!card) return c.json({ error: "Card not found" }, 404);
    const reviewedAt = new Date();
    if (!canAnswerReviewCard(card, reviewedAt)) {
      return c.json({ error: "Card is not currently due for review" }, 409);
    }
    const previousSnapshot = reviewSnapshotFromCardRow(card);
    const next = applyReviewAnswer(
      schedulingStateFromCardRow(card),
      body.data.rating as ReviewRating,
      reviewedAt,
      schedulingOptionsForCardRow(services, card)
    );
    const nextSnapshot = reviewSnapshotFromSchedulingState(next, card, reviewedAt);
    const buriedSiblingSnapshots = siblingSnapshotsForAutoBury(services, card, reviewedAt);
    services.db
      .prepare(
        `UPDATE cards
         SET state = ?, due_at = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
             reps = ?, lapses = ?, queue = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.state,
        next.dueAt.toISOString(),
        next.stability,
        next.difficulty,
        next.elapsedDays,
        next.scheduledDays,
        next.reps,
        next.lapses,
        next.state,
        reviewedAt.toISOString(),
        card.id
      );
    services.db
      .prepare(
        `INSERT INTO review_logs (
          id, card_id, rating, elapsed_ms, reviewed_at, previous_state, next_state,
          scheduled_days, stability, difficulty, previous_snapshot_json, next_snapshot_json, buried_siblings_snapshot_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id("review"),
        card.id,
        body.data.rating,
        body.data.elapsedMs,
        reviewedAt.toISOString(),
        card.state,
        next.state,
        next.scheduledDays,
        next.stability,
        next.difficulty,
        JSON.stringify(previousSnapshot),
        JSON.stringify(nextSnapshot),
        JSON.stringify(buriedSiblingSnapshots)
      );
    burySiblingCards(services.db, card, reviewedAt);
    const updated = services.db
      .prepare(
        `SELECT cards.*, notes.fields_json, notes.tags_json, notes.note_type_id AS note_type_id,
                note_types.name AS note_type_name, note_types.css AS note_type_css,
                (SELECT group_concat(name, char(31)) FROM note_fields WHERE note_fields.note_type_id = notes.note_type_id ORDER BY ord) AS field_names,
                card_templates.name AS template_name, card_templates.question_format, card_templates.answer_format, card_templates.ord AS template_ord
         FROM cards
         JOIN notes ON notes.id = cards.note_id
         JOIN note_types ON note_types.id = notes.note_type_id
         JOIN card_templates ON card_templates.id = cards.template_id
         WHERE cards.id = ?`
      )
      .get(card.id);
    return c.json({ card: cardDto(updated), rating: body.data.rating, scheduler: next });
  });

  app.post("/api/review/:cardId/undo", (c) => {
    const review = services.db
      .prepare("SELECT * FROM review_logs WHERE card_id = ? ORDER BY reviewed_at DESC, id DESC LIMIT 1")
      .get(c.req.param("cardId")) as any;
    if (!review) return c.json({ error: "Review answer not found" }, 404);
    const card = services.db.prepare("SELECT * FROM cards WHERE id = ?").get(review.card_id) as any;
    if (!card) return c.json({ error: "Card not found" }, 404);
    try {
      const restoredSiblingCards = services.db.transaction(() => {
        restoreCardFromReviewSnapshot(services, review.card_id, parseJson(review.previous_snapshot_json, null));
        const restored = restoreBuriedSiblingsFromReviewLog(services, review);
        services.db.prepare("DELETE FROM review_logs WHERE id = ?").run(review.id);
        return restored;
      })();
      return c.json({
        card: loadCardDto(services, review.card_id),
        undoneReview: {
          id: review.id,
          rating: review.rating,
          reviewedAt: review.reviewed_at
        },
        restoredSiblingCards
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/imports/apkg-url", async (c) => {
    const body = urlImportSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid import payload", issues: body.error.issues }, 400);
    const result = await runApkgUrlImport(services, body.data);
    if (!result.ok) return c.json({ id: result.importId, status: "failed", error: result.error }, 400);
    return c.json(result.import);
  });

  app.post("/api/imports/apkg-file", async (c) => {
    const body = await c.req.parseBody().catch(() => null);
    const file = uploadFileFromBody(body?.file);
    if (!file) return c.json({ error: "Anki package file is required" }, 400);
    const parsed = fileImportSchema.safeParse({ includeScheduling: parseFormBoolean(body?.includeScheduling) });
    if (!parsed.success) return c.json({ error: "Invalid import payload", issues: parsed.error.issues }, 400);
    const validationError = uploadedPackageValidationError(file);
    if (validationError) return c.json({ error: validationError }, 400);
    const importId = id("import");
    const packageName = safeUploadedPackageName(file.name || "anki-package.apkg");
    const sourceUrl = `upload:///${encodeURIComponent(packageName)}`;
    const now = nowIso();
    const jobId = createJob(services, {
      type: "apkg-import",
      payload: { importId, url: sourceUrl, includeScheduling: parsed.data.includeScheduling }
    });
    services.db
      .prepare(
        `INSERT INTO imports (id, type, url, status, include_scheduling, error, result_json, created_at, updated_at)
         VALUES (?, 'apkg-file', ?, 'running', ?, NULL, NULL, ?, ?)`
      )
      .run(importId, sourceUrl, parsed.data.includeScheduling ? 1 : 0, now, now);

    try {
      const buffer = await uploadedPackageBuffer(file, packageName);
      const result = await new AnkiPackageWorker(services).importPackage(buffer, {
        sourceUrl,
        includeScheduling: parsed.data.includeScheduling
      });
      const packageFileName = archiveImportedPackage(services, importId, sourceUrl, buffer);
      const resultWithArchive = packageImportResultWithStudyMaterialRecommendations(services, { ...result, packageFileName });
      services.db
        .prepare("UPDATE imports SET status = 'completed', result_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(resultWithArchive), nowIso(), importId);
      completeJob(services, jobId, { importId, ...resultWithArchive });
      return c.json({ id: importId, status: "completed", result: resultWithArchive });
    } catch (error) {
      services.db
        .prepare("UPDATE imports SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
        .run(error instanceof Error ? error.message : String(error), nowIso(), importId);
      failJob(services, jobId, error);
      return c.json({ id: importId, status: "failed", error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/imports/article-url", async (c) => {
    const body = articleImportSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid article import payload", issues: body.error.issues }, 400);
    try {
      const result = await generateDraftsFromArticleUrl(services, body.data);
      return c.json(result, 201);
    } catch (error) {
      return importJobFailureResponse(c, error);
    }
  });

  app.get("/api/generation/preview", (c) => c.json({ preview: generationPreview(services, c.req.query("deckId")) }));

  app.post("/api/generation/from-url", async (c) => {
    const body = articleImportSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid generation payload", issues: body.error.issues }, 400);
    try {
      const result = await generateDraftsFromArticleUrl(services, body.data);
      return c.json(result, 201);
    } catch (error) {
      return importJobFailureResponse(c, error);
    }
  });

  app.post("/api/generation/from-text", async (c) => {
    const body = textMaterialImportSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid text material payload", issues: body.error.issues }, 400);
    try {
      const result = await generateDraftsFromTextMaterial(services, body.data);
      return c.json(result);
    } catch (error) {
      return importJobFailureResponse(c, error);
    }
  });

  app.post("/api/generation/from-file", async (c) => {
    const body = await c.req.parseBody().catch(() => null);
    const file = uploadFileFromBody(body?.file);
    if (!file) return c.json({ error: "Study material file is required" }, 400);
    try {
      const material = await textMaterialFromUploadedFile(file, body);
      const parsed = textMaterialImportSchema.safeParse(material);
      if (!parsed.success) return c.json({ error: "Invalid text material file", issues: parsed.error.issues }, 400);
      const result = await generateDraftsFromTextMaterial(services, parsed.data);
      return c.json(result, 201);
    } catch (error) {
      return importJobFailureResponse(c, error);
    }
  });

  app.post("/api/generation/from-files", async (c) => {
    const body = (await c.req.parseBody({ all: true }).catch(() => null)) as Record<string, unknown> | null;
    const files = uploadFilesFromBody(body?.files ?? body?.["files[]"] ?? body?.file);
    if (files.length === 0) return c.json({ error: "At least one study material file is required" }, 400);
    try {
      const material = await textMaterialFromUploadedFiles(files, body);
      const parsed = textMaterialImportSchema.safeParse(material);
      if (!parsed.success) return c.json({ error: "Invalid text material files", issues: parsed.error.issues }, 400);
      const result = await generateDraftsFromTextMaterial(services, parsed.data);
      return c.json(result, 201);
    } catch (error) {
      return importJobFailureResponse(c, error);
    }
  });

  app.get("/api/imports", (c) => {
    const rows = services.db.prepare("SELECT * FROM imports ORDER BY updated_at DESC LIMIT 25").all() as any[];
    return c.json({ imports: rows.map((row) => importDto(services, row)) });
  });

  app.get("/api/imports/:id", (c) => {
    const row = services.db.prepare("SELECT * FROM imports WHERE id = ?").get(c.req.param("id")) as any;
    if (!row) return c.json({ error: "Import not found" }, 404);
    return c.json(importDto(services, row));
  });

  app.get("/api/imports/:id/package", (c) => {
    const row = services.db.prepare("SELECT * FROM imports WHERE id = ?").get(c.req.param("id")) as any;
    if (!row) return c.json({ error: "Import not found" }, 404);
    const result = parseJson<Record<string, unknown>>(row.result_json, {});
    const packageFileName = typeof result.packageFileName === "string" ? basename(result.packageFileName) : null;
    if (!packageFileName) return c.json({ error: "This import has no archived package" }, 400);
    const packagePath = join(services.packageDir, packageFileName);
    if (!existsSync(packagePath)) return c.json({ error: "Archived package not found" }, 404);
    return new Response(new Uint8Array(readFileSync(packagePath)), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": attachmentDisposition(packageFileName)
      }
    });
  });

  app.post("/api/imports/:id/retry", async (c) => {
    const row = services.db.prepare("SELECT * FROM imports WHERE id = ?").get(c.req.param("id")) as any;
    if (!row) return c.json({ error: "Import not found" }, 404);
    if (row.type !== "apkg-url") return c.json({ error: "Only URL package imports can be retried" }, 400);
    if (row.status !== "failed") return c.json({ error: "Only failed imports can be retried" }, 400);
    const result = await runApkgUrlImport(services, {
      url: row.url,
      includeScheduling: Boolean(row.include_scheduling),
      retryOfImportId: row.id
    });
    if (!result.ok) {
      return c.json({ id: result.importId, status: "failed", error: result.error, retryOfImportId: row.id }, 400);
    }
    return c.json({ ...result.import, retryOfImportId: row.id }, 201);
  });

  app.get("/api/sources", (c) => {
    const rows = services.db.prepare("SELECT * FROM sources ORDER BY created_at DESC LIMIT 100").all() as any[];
    return c.json({ sources: rows.map((row) => sourceDto(services, row)) });
  });

  app.get("/api/sources/:id", (c) => {
    const row = services.db.prepare("SELECT * FROM sources WHERE id = ?").get(c.req.param("id")) as any;
    if (!row) return c.json({ error: "Source not found" }, 404);
    return c.json({ source: sourceDto(services, row) });
  });

  app.post("/api/sources/:id/regenerate", async (c) => {
    const body = sourceRegenerationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid source regeneration payload", issues: body.error.issues }, 400);
    try {
      const result = await regenerateDraftsFromSource(services, c.req.param("id"), body.data);
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof GenerationInputError) {
        return c.json({ error: error.message }, error.message === "Source not found" ? 404 : 400);
      }
      return importJobFailureResponse(c, error);
    }
  });

  app.post("/api/sources/:id/export", async (c) => {
    const body = packageExportSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid export payload", issues: body.error.issues }, 400);
    try {
      const exported = await new AnkiPackageWorker(services).exportSource(c.req.param("id"), body.data);
      return new Response(new Uint8Array(exported.buffer), {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": attachmentDisposition(exported.fileName)
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, message === "Source not found" ? 404 : 400);
    }
  });

  app.post("/api/imports/:id/export", async (c) => {
    const body = packageExportSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid export payload", issues: body.error.issues }, 400);
    const row = services.db.prepare("SELECT * FROM imports WHERE id = ?").get(c.req.param("id")) as any;
    if (!row) return c.json({ error: "Import not found" }, 404);
    const result = row.result_json ? JSON.parse(row.result_json) : null;
    const sourceId = typeof result?.sourceId === "string" ? result.sourceId : null;
    if (!sourceId) return c.json({ error: "This import has no generated card source to export" }, 400);
    try {
      const exported = await new AnkiPackageWorker(services).exportSource(sourceId, body.data);
      return new Response(new Uint8Array(exported.buffer), {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": attachmentDisposition(exported.fileName)
        }
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/drafts", (c) => {
    const query = draftListQuerySchema.safeParse({
      status: c.req.query("status") ?? undefined,
      deckId: c.req.query("deckId") || undefined,
      kind: c.req.query("kind") || undefined,
      pitchAccentStatus: c.req.query("pitchAccentStatus") || undefined
    });
    if (!query.success) return c.json({ error: "Invalid draft query", issues: query.error.issues }, 400);
    return c.json({ drafts: listDrafts(services.db, query.data) });
  });

  app.get("/api/drafts/:id", (c) => {
    const draft = getDraft(services.db, c.req.param("id"));
    if (!draft) return c.json({ error: "Draft not found" }, 404);
    return c.json({ draft });
  });

  app.post("/api/drafts/approve-bulk", async (c) => {
    const body = bulkDraftApprovalSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid bulk approval payload", issues: body.error.issues }, 400);
    try {
      return c.json(await approveDrafts(services, body.data.ids, body.data.deckId));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/drafts/reject-bulk", async (c) => {
    const body = bulkDraftRejectSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid bulk rejection payload", issues: body.error.issues }, 400);
    try {
      return c.json(await rejectDrafts(services, body.data.ids));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/drafts/audio-bulk", async (c) => {
    const body = bulkDraftAudioSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid bulk audio payload", issues: body.error.issues }, 400);
    try {
      return c.json(await generateDraftAudios(services, body.data.ids));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.patch("/api/drafts/:id", async (c) => {
    const body = updateDraftSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid draft payload", issues: body.error.issues }, 400);
    try {
      const draft = updateDraft(services, c.req.param("id"), body.data);
      return c.json({ draft });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/drafts/:id/audio", async (c) => {
    const body = audioGenerationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid audio payload", issues: body.error.issues }, 400);
    try {
      return c.json(await generateDraftAudio(services, c.req.param("id"), body.data.text));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/drafts/:id/approve", async (c) => {
    try {
      return c.json(await approveDraft(services, c.req.param("id")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/drafts/:id/reject", async (c) => {
    try {
      await rejectDraft(services, c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/decks/:id/export", async (c) => {
    const body = packageExportSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid export payload", issues: body.error.issues }, 400);
    try {
      const exported = await new AnkiPackageWorker(services).exportDeck(c.req.param("id"), body.data);
      return new Response(new Uint8Array(exported.buffer), {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": attachmentDisposition(exported.fileName)
        }
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/stats", (c) => {
    const deckId = c.req.query("deckId");
    const daily = deckId ? getDeckDailyProgress(services.db, deckId) : null;
    return c.json({
      due: countDueCards(services, deckId),
      cards: countCards(services, deckId),
      reviews: countReviews(services, deckId),
      drafts: countDrafts(services, deckId),
      daily,
      cardStates: cardStateStats(services, deckId),
      ratings: ratingStats(services, deckId),
      activity: reviewActivityStats(services, deckId),
      calendar: reviewCalendarStats(services, deckId)
    });
  });

  app.all("/api/*", (c) => c.json({ error: "Route not found" }, 404));

  const clientDir = join(process.cwd(), "dist/client");
  if (existsSync(clientDir)) {
    app.use("/assets/*", serveStatic({ root: clientDir }));
    app.get("*", serveStatic({ path: join(clientDir, "index.html") }));
  }

  return app;
}

function applySecurityHeaders(c: Context, nodeEnv: AppServices["config"]["nodeEnv"]) {
  c.header("content-security-policy", contentSecurityPolicy);
  c.header("x-content-type-options", "nosniff");
  c.header("x-frame-options", "DENY");
  c.header("referrer-policy", "no-referrer");
  c.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  c.header("cross-origin-opener-policy", "same-origin");
  c.header("cross-origin-resource-policy", "same-origin");
  if (nodeEnv === "production") {
    c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
}

function loadCardDto(services: AppServices, cardId: string) {
  const row = services.db
    .prepare(
      `SELECT cards.*, notes.fields_json, notes.tags_json, notes.note_type_id AS note_type_id,
              note_types.name AS note_type_name, note_types.css AS note_type_css,
              (SELECT group_concat(name, char(31)) FROM note_fields WHERE note_fields.note_type_id = notes.note_type_id ORDER BY ord) AS field_names,
              card_templates.name AS template_name, card_templates.question_format, card_templates.answer_format, card_templates.ord AS template_ord
       FROM cards
       JOIN notes ON notes.id = cards.note_id
       JOIN note_types ON note_types.id = notes.note_type_id
       JOIN card_templates ON card_templates.id = cards.template_id
       WHERE cards.id = ?`
    )
    .get(cardId);
  return cardDto(row);
}

function validateDeckParentUpdate(
  services: AppServices,
  deckId: string,
  parentId: string | null | undefined
): { ok: true } | { ok: false; status: 400 | 404; error: string } {
  if (parentId === undefined || parentId === null) return { ok: true };
  if (parentId === deckId) return { ok: false, status: 400, error: "Deck cannot be its own parent" };
  if (!services.decks.getDeck(parentId)) return { ok: false, status: 404, error: "Parent deck not found" };
  const descendantIds = deckScopeIds(services.db, deckId) ?? [deckId];
  if (descendantIds.includes(parentId)) {
    return { ok: false, status: 400, error: "Deck cannot be moved under one of its child decks" };
  }
  return { ok: true };
}

function createManagedNote(services: AppServices, input: z.infer<typeof createCardSchema>) {
  const noteTypeId = input.noteTypeId;
  const created = noteTypeId
    ? createNoteForNoteType(services.db, {
        deckId: input.deckId,
        noteTypeId,
        fields: input.fields,
        tags: input.tags ?? [],
        createAllTemplates: input.createAllTemplates
      })
    : createJapaneseNote(services.db, {
        deckId: input.deckId,
        fields: input.fields,
        tags: input.tags ?? [],
        createAllTemplates: input.createAllTemplates,
        templateNames: input.templateNames
      });
  return { note: loadNoteDto(services, created.noteId)! };
}

function loadNoteDto(services: AppServices, noteId: string) {
  const note = services.db
    .prepare(
      `SELECT notes.*, note_types.name AS note_type_name,
              note_types.css AS note_type_css,
              (SELECT group_concat(name, char(31)) FROM note_fields WHERE note_fields.note_type_id = notes.note_type_id ORDER BY ord) AS field_names
       FROM notes
       JOIN note_types ON note_types.id = notes.note_type_id
       WHERE notes.id = ?`
    )
    .get(noteId) as any;
  if (!note) return null;
  const cards = services.db
    .prepare(
      `SELECT cards.*, notes.fields_json, notes.tags_json, notes.note_type_id AS note_type_id,
              note_types.name AS note_type_name, note_types.css AS note_type_css,
              (SELECT group_concat(name, char(31)) FROM note_fields WHERE note_fields.note_type_id = notes.note_type_id ORDER BY ord) AS field_names,
              card_templates.name AS template_name, card_templates.question_format, card_templates.answer_format, card_templates.ord AS template_ord
       FROM cards
       JOIN notes ON notes.id = cards.note_id
       JOIN note_types ON note_types.id = notes.note_type_id
       JOIN card_templates ON card_templates.id = cards.template_id
       WHERE cards.note_id = ?
       ORDER BY card_templates.ord`
    )
    .all(note.id)
    .map(cardDto);
  const fieldNames = String(note.field_names ?? "")
    .split("\x1f")
    .map((name) => name.trim())
    .filter(Boolean);
  return {
    id: note.id,
    deckId: note.deck_id,
    sourceId: note.source_id,
    noteType: {
      id: note.note_type_id,
      name: note.note_type_name,
      css: note.note_type_css ?? ""
    },
    fieldNames,
    fields: parseJson<Record<string, string>>(note.fields_json, {}),
    tags: parseJson<string[]>(note.tags_json, []),
    cards,
    createdAt: note.created_at,
    updatedAt: note.updated_at
  };
}

function schedulingStateFromCardRow(card: any) {
  return {
    state: card.state,
    dueAt: new Date(card.due_at),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.updated_at ? new Date(card.updated_at) : null
  };
}

function schedulingOptionsForCardRow(services: AppServices, card: any) {
  const deck = services.db.prepare("SELECT fsrs_retention FROM decks WHERE id = ?").get(card.deck_id) as
    | { fsrs_retention: number }
    | undefined;
  return { requestRetention: deck?.fsrs_retention ?? 0.9 };
}

function reviewSnapshotFromCardRow(card: any) {
  return {
    state: card.state,
    dueAt: card.due_at,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    queue: card.queue,
    buriedUntil: card.buried_until ?? null,
    updatedAt: card.updated_at
  };
}

function reviewSnapshotFromSchedulingState(state: SchedulingState, card: any, reviewedAt: Date) {
  return {
    state: state.state,
    dueAt: state.dueAt.toISOString(),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsedDays: state.elapsedDays,
    scheduledDays: state.scheduledDays,
    reps: state.reps,
    lapses: state.lapses,
    queue: state.state,
    buriedUntil: card.buried_until ?? null,
    updatedAt: reviewedAt.toISOString()
  };
}

function siblingSnapshotsForAutoBury(services: AppServices, reviewedCard: any, reviewedAt: Date) {
  const buriedUntil = nextLocalDayStart(reviewedAt).toISOString();
  const rows = services.db
    .prepare(
      `SELECT id, buried_until, updated_at
       FROM cards
       WHERE note_id = ?
         AND id != ?
         AND state != 'suspended'
         AND (buried_until IS NULL OR buried_until < ?)`
    )
    .all(reviewedCard.note_id, reviewedCard.id, buriedUntil) as Array<{
    id: string;
    buried_until: string | null;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    buriedUntil: row.buried_until ?? null,
    updatedAt: row.updated_at
  }));
}

function restoreCardFromReviewSnapshot(services: AppServices, cardId: string, snapshot: any) {
  if (!snapshot || typeof snapshot !== "object") throw new Error("Review snapshot is unavailable");
  services.db
    .prepare(
      `UPDATE cards
       SET state = ?, due_at = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
           reps = ?, lapses = ?, queue = ?, buried_until = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      snapshot.state,
      snapshot.dueAt,
      Number(snapshot.stability) || 0,
      Number(snapshot.difficulty) || 0,
      Number(snapshot.elapsedDays) || 0,
      Number(snapshot.scheduledDays) || 0,
      Number(snapshot.reps) || 0,
      Number(snapshot.lapses) || 0,
      snapshot.queue,
      snapshot.buriedUntil ?? null,
      snapshot.updatedAt ?? nowIso(),
      cardId
    );
}

function restoreBuriedSiblingsFromReviewLog(services: AppServices, review: any) {
  const snapshots = parseJson<Array<{ id: string; buriedUntil: string | null; updatedAt: string }>>(review.buried_siblings_snapshot_json, []);
  const update = services.db.prepare("UPDATE cards SET buried_until = ?, updated_at = ? WHERE id = ?");
  let restored = 0;
  for (const snapshot of snapshots) {
    if (!snapshot.id) continue;
    const result = update.run(snapshot.buriedUntil ?? null, snapshot.updatedAt ?? nowIso(), snapshot.id);
    restored += result.changes;
  }
  return restored;
}

function parseOptionalInteger(value: string | undefined) {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodePathParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function attachmentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "deck.apkg";
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function runApkgUrlImport(
  services: AppServices,
  input: { url: string; includeScheduling: boolean; retryOfImportId?: string | null }
) {
  const importId = id("import");
  const now = nowIso();
  const jobId = createJob(services, {
    type: "apkg-import",
    payload: {
      importId,
      url: input.url,
      includeScheduling: input.includeScheduling,
      ...(input.retryOfImportId ? { retryOfImportId: input.retryOfImportId } : {})
    }
  });
  services.db
    .prepare(
      `INSERT INTO imports (id, type, url, status, include_scheduling, error, result_json, created_at, updated_at)
       VALUES (?, 'apkg-url', ?, 'running', ?, NULL, NULL, ?, ?)`
    )
    .run(importId, input.url, input.includeScheduling ? 1 : 0, now, now);

  try {
    const fetched = await publicUrlFetcher(services)(input.url, {
      maxBytes: 200_000_000,
      contentTypes: ankiPackageContentTypes
    });
    const result = await new AnkiPackageWorker(services).importPackage(fetched.buffer, {
      sourceUrl: fetched.url,
      includeScheduling: input.includeScheduling
    });
    const packageFileName = archiveImportedPackage(services, importId, fetched.url, fetched.buffer, fetched.contentType, fetched.fileName);
    const resultWithArchive = packageImportResultWithStudyMaterialRecommendations(services, { ...result, packageFileName });
    services.db
      .prepare("UPDATE imports SET status = 'completed', result_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(resultWithArchive), nowIso(), importId);
    completeJob(services, jobId, { importId, ...resultWithArchive });
    const row = services.db.prepare("SELECT * FROM imports WHERE id = ?").get(importId) as any;
    return { ok: true as const, import: importDto(services, row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    services.db.prepare("UPDATE imports SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(message, nowIso(), importId);
    failJob(services, jobId, error);
    return { ok: false as const, importId, error: message };
  }
}

function publicUrlFetcher(services: AppServices) {
  return services.fetchPublicUrl ?? fetchPublicUrl;
}

function archiveImportedPackage(
  services: AppServices,
  importId: string,
  sourceUrl: string,
  buffer: Buffer,
  contentType?: string | null,
  preferredName?: string | null
) {
  const originalName = archivedPackageName(sourceUrl, contentType, preferredName);
  const fileName = `${importId}-${originalName}`;
  writeFileSync(join(services.packageDir, fileName), buffer);
  return fileName;
}

function archivedPackageName(sourceUrl: string, contentType?: string | null, preferredName?: string | null) {
  const candidate = preferredName?.trim() ? preferredName : new URL(sourceUrl).pathname;
  const baseName = safeFileName(basename(candidate.replace(/[/\\]+/g, "/")) || "anki-package");
  const extension = extname(baseName).toLowerCase();
  if (extension === ".apkg" || extension === ".colpkg") return baseName;
  return `${baseName}.${archivedPackageExtension(contentType)}`;
}

function archivedPackageExtension(contentType?: string | null) {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();
  if (normalized === "application/colpkg" || normalized === "application/x-colpkg") return "colpkg";
  return "apkg";
}

function packageImportResultWithStudyMaterialRecommendations(services: AppServices, result: Record<string, unknown>) {
  const sourceId = typeof result.sourceId === "string" ? result.sourceId : null;
  const studyMaterialRecommendations = sourceId ? packageStudyMaterialRecommendations(services, sourceId) : [];
  return {
    ...result,
    needsStudyMaterial: studyMaterialRecommendations.some((recommendation) => recommendation.deckCoverage.needsMaterial),
    studyMaterialRecommendations
  };
}

function packageStudyMaterialRecommendations(services: AppServices, sourceId: string) {
  const decksWithNotes = services.db
    .prepare(
      `SELECT DISTINCT decks.id, decks.name, decks.parent_id AS parentId
       FROM notes
       JOIN decks ON decks.id = notes.deck_id
       WHERE notes.source_id = ?
       ORDER BY decks.name COLLATE NOCASE`
    )
    .all(sourceId) as Array<{ id: string; name: string; parentId: string | null }>;
  const decks = packageRecommendationDecks(services, decksWithNotes);
  return decks.map((deck) => ({
    deckId: deck.id,
    deckName: deck.name,
    deckCoverage: generationPreview(services, deck.id).deckCoverage
  }));
}

function packageRecommendationDecks(
  services: AppServices,
  decksWithNotes: Array<{ id: string; name: string; parentId: string | null }>
) {
  if (decksWithNotes.length === 0) return [];
  const noteDeckIds = new Set(decksWithNotes.map((deck) => deck.id));
  const deckById = new Map(services.decks.listDecks().map((deck) => [deck.id, deck]));
  const recommendationById = new Map<string, { id: string; name: string }>();
  for (const deck of decksWithNotes) {
    const root = importedRecommendationRoot(deck, deckById, noteDeckIds);
    recommendationById.set(root.id, { id: root.id, name: root.name });
  }
  return [...recommendationById.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function importedRecommendationRoot(
  deck: { id: string; name: string; parentId: string | null },
  deckById: Map<string, { id: string; name: string; parentId: string | null }>,
  noteDeckIds: Set<string>
) {
  let root = deck;
  let current: typeof deck | undefined = deck;
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = deckById.get(current.parentId);
    if (!parent) break;
    root = parent;
    if (noteDeckIds.has(parent.id)) break;
    current = parent;
  }
  return root;
}

function importJobFailureResponse(c: any, error: unknown) {
  if (error instanceof ImportJobFailure) {
    return c.json({ importId: error.importId, status: "failed", error: error.message }, 400);
  }
  if (error instanceof GenerationInputError) {
    return c.json({ error: error.message }, 400);
  }
  return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
}

function importDto(services: AppServices, row: any) {
  const result = row.result_json ? JSON.parse(row.result_json) : null;
  const sourceId = typeof result?.sourceId === "string" ? result.sourceId : null;
  return {
    id: row.id,
    type: row.type,
    url: row.url,
    status: row.status,
    includeScheduling: Boolean(row.include_scheduling),
    error: row.error ?? null,
    result,
    generatedSource: sourceId ? generatedSourceSummary(services, sourceId) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function generatedSourceSummary(services: AppServices, sourceId: string) {
  const draftCounts = services.db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM generation_drafts
       WHERE source_id = ?`
    )
    .get(sourceId) as { draft: number | null; approved: number | null; rejected: number | null };
  const approvedNotes = services.db.prepare("SELECT COUNT(*) AS count FROM notes WHERE source_id = ?").get(sourceId) as { count: number };
  return {
    id: sourceId,
    draftCards: draftCounts.draft ?? 0,
    approvedDrafts: draftCounts.approved ?? 0,
    rejectedDrafts: draftCounts.rejected ?? 0,
    approvedCards: approvedNotes.count
  };
}

function deckPresetDto(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    dailyNewLimit: row.daily_new_limit,
    dailyReviewLimit: row.daily_review_limit,
    fsrsRetention: row.fsrs_retention,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mediaAssetDto(row: any) {
  return {
    id: row.id,
    fileName: row.file_name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sourceId: row.source_id ?? null,
    createdAt: row.created_at,
    available: Boolean(row.path && existsSync(row.path))
  };
}

async function storeUploadedMedia(services: AppServices, file: File) {
  const originalName = basename(file.name || "media");
  const mimeType = uploadedMediaMimeType(file, originalName);
  if (!isAllowedUploadedMediaType(mimeType)) {
    throw new Error("Only audio and raster image media can be uploaded");
  }
  if (!uploadedMediaExtensionMatchesMimeType(originalName, mimeType)) {
    throw new Error("Media file extension does not match an allowed media type");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error("Media file is empty");
  if (buffer.byteLength > 50_000_000) throw new Error("Media file is larger than 50000000 bytes");

  const digest = checksum(buffer);
  const existing = services.db
    .prepare("SELECT * FROM media_assets WHERE checksum = ? ORDER BY created_at DESC LIMIT 1")
    .get(digest) as any;
  if (existing) {
    if (!existsSync(existing.path)) {
      mkdirSync(dirname(existing.path), { recursive: true });
      writeFileSync(existing.path, buffer);
    }
    return { asset: mediaAssetDto(existing), reference: mediaReference(existing.file_name, existing.mime_type) };
  }

  const fileName = uploadedMediaFileName(originalName, mimeType, digest);
  const mediaPath = join(services.mediaDir, fileName);
  mkdirSync(services.mediaDir, { recursive: true });
  writeFileSync(mediaPath, buffer);
  const now = nowIso();
  const assetId = id("media");
  services.db
    .prepare(
      `INSERT INTO media_assets (id, file_name, original_name, mime_type, path, checksum, source_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(assetId, fileName, originalName, mimeType, mediaPath, digest, now);
  const asset = services.db.prepare("SELECT * FROM media_assets WHERE id = ?").get(assetId);
  return { asset: mediaAssetDto(asset), reference: mediaReference(fileName, mimeType) };
}

function uploadFileFromBody(value: unknown): File | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") return null;
  const file = candidate as Partial<File>;
  if (typeof file.name !== "string" || typeof file.arrayBuffer !== "function") return null;
  return file as File;
}

function uploadFilesFromBody(value: unknown): File[] {
  const candidates = Array.isArray(value) ? value : value ? [value] : [];
  return candidates.flatMap((candidate) => {
    const file = uploadFileFromBody(candidate);
    return file ? [file] : [];
  });
}

async function textMaterialFromUploadedFile(file: File, body: Record<string, unknown> | null) {
  const material = await textMaterialFilePart(file);
  const explicitTitle = formTextValue(body?.title)?.trim();
  return {
    title: explicitTitle || textMaterialTitleFromFileName(material.originalName),
    text: material.text,
    deckId: formTextValue(body?.deckId) || undefined,
    jlptLevel: formTextValue(body?.jlptLevel) || undefined
  };
}

async function textMaterialFromUploadedFiles(files: File[], body: Record<string, unknown> | null) {
  if (files.length > 20) throw new Error("At most 20 study material files can be uploaded at once");
  const parts = await Promise.all(files.map((file) => textMaterialFilePart(file)));
  const readableText = parts.map((part) => part.text).join("\n").trim();
  const text = parts.map((part) => `## ${part.originalName}\n${part.text}`).join("\n\n---\n\n").trim();
  if (text.length > 200_000) throw new Error("Combined study material is larger than 200000 characters");
  const explicitTitle = formTextValue(body?.title)?.trim();
  return {
    title: explicitTitle || textMaterialBatchTitle(parts.map((part) => part.originalName)),
    text: readableText.length >= 20 ? text : readableText,
    deckId: formTextValue(body?.deckId) || undefined,
    jlptLevel: formTextValue(body?.jlptLevel) || undefined
  };
}

async function textMaterialFilePart(file: File) {
  const originalName = basename(file.name || "study-material.txt");
  const mimeType = uploadedTextMaterialMimeType(file, originalName);
  if (!isAllowedTextMaterialFile(originalName, mimeType)) {
    throw new Error(
      "Only .txt, .md, .markdown, .html, .htm, .csv, .tsv, .srt, .vtt, .docx, and .zip study material files can be uploaded"
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error("Study material file is empty");
  if (buffer.byteLength > 200_000) throw new Error("Study material file is larger than 200000 bytes");
  if (isZipStudyMaterialFile(originalName, mimeType)) {
    return extractStudyTextFromZip(originalName, buffer);
  }
  return {
    originalName,
    text: await normalizeUploadedStudyBuffer(originalName, mimeType, buffer)
  };
}

async function normalizeUploadedStudyBuffer(originalName: string, mimeType: string, buffer: Buffer) {
  if (isDocxStudyMaterialFile(originalName, mimeType)) {
    return extractStudyTextFromDocx(buffer);
  }
  const rawText = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  return normalizeUploadedStudyText(originalName, mimeType, rawText);
}

function uploadedTextMaterialMimeType(file: File, originalName: string) {
  const provided = file.type?.split(";")[0]?.trim().toLowerCase();
  return provided || mediaMimeTypeFromName(originalName) || "application/octet-stream";
}

function isAllowedTextMaterialFile(originalName: string, mimeType: string) {
  const extension = extname(originalName).toLowerCase();
  if ([".txt", ".md", ".markdown"].includes(extension)) {
    return ["text/plain", "text/markdown", "text/x-markdown", "application/octet-stream"].includes(mimeType);
  }
  if ([".html", ".htm"].includes(extension)) {
    return ["text/html", "application/xhtml+xml", "application/octet-stream"].includes(mimeType);
  }
  if (extension === ".csv") {
    return ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"].includes(mimeType);
  }
  if (extension === ".tsv") {
    return ["text/tab-separated-values", "text/plain", "application/octet-stream"].includes(mimeType);
  }
  if (extension === ".srt") {
    return ["application/x-subrip", "text/plain", "application/octet-stream"].includes(mimeType);
  }
  if (extension === ".vtt") {
    return ["text/vtt", "text/plain", "application/octet-stream"].includes(mimeType);
  }
  if (extension === ".docx") {
    return ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"].includes(mimeType);
  }
  if (extension === ".zip") {
    return ["application/zip", "application/x-zip-compressed", "application/octet-stream"].includes(mimeType);
  }
  return false;
}

function normalizeUploadedStudyText(originalName: string, mimeType: string, rawText: string) {
  if (isHtmlTextMaterialFile(originalName, mimeType)) return extractStudyTextFromHtml(rawText);
  if (isSubtitleStudyMaterialFile(originalName, mimeType)) return extractStudyTextFromSubtitle(rawText);
  const delimiter = delimitedStudyTextSeparator(originalName, mimeType);
  return delimiter ? normalizeDelimitedStudyText(rawText, delimiter) : rawText;
}

function isHtmlTextMaterialFile(originalName: string, mimeType: string) {
  const extension = extname(originalName).toLowerCase();
  return [".html", ".htm"].includes(extension) || mimeType === "text/html" || mimeType === "application/xhtml+xml";
}

function delimitedStudyTextSeparator(originalName: string, mimeType: string) {
  const extension = extname(originalName).toLowerCase();
  if (extension === ".csv" || mimeType === "text/csv" || mimeType === "application/csv") return ",";
  if (extension === ".tsv" || mimeType === "text/tab-separated-values") return "\t";
  return null;
}

function isSubtitleStudyMaterialFile(originalName: string, mimeType: string) {
  const extension = extname(originalName).toLowerCase();
  return extension === ".srt" || extension === ".vtt" || mimeType === "application/x-subrip" || mimeType === "text/vtt";
}

function isDocxStudyMaterialFile(originalName: string, mimeType: string) {
  return extname(originalName).toLowerCase() === ".docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isZipStudyMaterialFile(originalName: string, mimeType: string) {
  return extname(originalName).toLowerCase() === ".zip" || mimeType === "application/x-zip-compressed";
}

async function extractStudyTextFromZip(originalName: string, buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => ({ entry, name: readableZipStudyEntryName(entry.name) }))
    .filter((entry): entry is { entry: JSZip.JSZipObject; name: string } => Boolean(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > 100) throw new Error("ZIP study material bundle contains more than 100 files");

  const parts = [];
  for (const { entry, name } of entries) {
    const mimeType = "application/octet-stream";
    if (!isAllowedTextMaterialFile(name, mimeType) || isZipStudyMaterialFile(name, mimeType)) continue;
    const entryBuffer = Buffer.from(await entry.async("uint8array"));
    if (entryBuffer.byteLength === 0) continue;
    if (entryBuffer.byteLength > 200_000) throw new Error(`Study material file ${name} is larger than 200000 bytes`);
    const text = (await normalizeUploadedStudyBuffer(name, mimeType, entryBuffer)).trim();
    if (text) parts.push({ originalName: name, text });
  }

  if (parts.length === 0) {
    throw new Error("ZIP study material bundle contains no readable .txt, .md, .html, .csv, .tsv, .srt, .vtt, or .docx files");
  }
  const text = parts.map((part) => `## ${part.originalName}\n${part.text}`).join("\n\n---\n\n").trim();
  if (text.length > 200_000) throw new Error("ZIP study material bundle is larger than 200000 characters");
  return { originalName, text };
}

function readableZipStudyEntryName(name: string) {
  const normalized = name.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("__MACOSX/")) return "";
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return "";
  if ((segments.at(-1) ?? "").startsWith(".")) return "";
  return normalized;
}

async function extractStudyTextFromDocx(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = zip.file("word/document.xml");
  if (!documentXml) throw new Error("DOCX file does not contain word/document.xml");
  const xml = await documentXml.async("string");
  const text = extractWordprocessingText(xml);
  if (!text) throw new Error("DOCX study material has no readable text");
  return text;
}

function extractWordprocessingText(xml: string) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const paragraphs = $("w\\:p, p")
    .toArray()
    .map((paragraph) => wordParagraphText($, paragraph))
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return paragraphs.join("\n").trim();
}

function wordParagraphText($: cheerio.CheerioAPI, paragraph: Element) {
  let text = "";
  $(paragraph)
    .find("w\\:t, t, w\\:tab, tab, w\\:br, br")
    .each((_, element) => {
      if (element.tagName === "w:t" || element.tagName === "t") text += $(element).text();
      if (element.tagName === "w:tab" || element.tagName === "tab") text += " ";
      if (element.tagName === "w:br" || element.tagName === "br") text += "\n";
    });
  return text;
}

function normalizeDelimitedStudyText(text: string, delimiter: "," | "\t") {
  const rows = parseDelimitedStudyRows(text, delimiter).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length === 0) return "";
  if (rows.length === 1) return rows[0].map((cell, index) => `Column ${index + 1}: ${cell}`).join("\n");
  const headers = rows[0].map((cell, index) => cell.trim() || `Column ${index + 1}`);
  return rows
    .slice(1)
    .map((row, rowIndex) => {
      const fields = row
        .map((cell, index) => {
          const value = cell.trim();
          return value ? `${headers[index] ?? `Column ${index + 1}`}: ${value}` : "";
        })
        .filter(Boolean);
      return [`Row ${rowIndex + 1}`, ...fields].join("\n");
    })
    .join("\n\n")
    .trim();
}

function parseDelimitedStudyRows(text: string, delimiter: "," | "\t") {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      continue;
    }
    cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function extractStudyTextFromSubtitle(text: string) {
  const subtitleLines: string[] = [];
  let skippingMetadataBlock = false;
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      skippingMetadataBlock = false;
      continue;
    }
    if (skippingMetadataBlock) continue;
    if (/^WEBVTT\b/i.test(line)) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(line)) {
      skippingMetadataBlock = true;
      continue;
    }
    if (/^\d+$/.test(line)) continue;
    if (line.includes("-->")) continue;
    subtitleLines.push(line.replace(/<[^>]+>/g, ""));
  }
  return normalizeExtractedStudyText(subtitleLines.join("\n"));
}

function extractStudyTextFromHtml(html: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg, canvas, iframe, nav, header, footer, form").remove();
  preserveRubyReadings($);
  const root = $("main, article").first();
  const text = (root.length ? root : $("body")).text();
  return normalizeExtractedStudyText(text);
}

function normalizeExtractedStudyText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function textMaterialTitleFromFileName(fileName: string) {
  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  return stem.trim() || "Study material";
}

function textMaterialBatchTitle(fileNames: string[]) {
  const stems = fileNames.map(textMaterialTitleFromFileName).filter(Boolean);
  if (stems.length === 0) return "Study materials";
  if (stems.length === 1) return stems[0];
  const prefix = stems.slice(0, 2).join(" + ");
  return stems.length === 2 ? prefix : `${prefix} + ${stems.length - 2} more`;
}

function formTextValue(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" ? candidate : "";
}

function parseFormBoolean(value: unknown) {
  const normalized = formTextValue(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
}

async function uploadedPackageBuffer(file: File, originalName: string) {
  if (!isAllowedUploadedPackage(originalName, uploadedPackageMimeType(file))) {
    throw new Error("Only .apkg and .colpkg package files can be uploaded");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error("Anki package file is empty");
  if (buffer.byteLength > 200_000_000) throw new Error("Anki package file is larger than 200000000 bytes");
  return buffer;
}

function safeUploadedPackageName(fileName: string) {
  const clean = safeFileName(basename(fileName || "anki-package.apkg"));
  const extension = extname(clean).toLowerCase();
  if (extension === ".apkg" || extension === ".colpkg") return clean;
  return `${clean || "anki-package"}.apkg`;
}

function uploadedPackageMimeType(file: File) {
  return file.type?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

function uploadedPackageValidationError(file: File) {
  if (!isAllowedUploadedPackage(file.name || "anki-package.apkg", uploadedPackageMimeType(file))) {
    return "Only .apkg and .colpkg package files can be uploaded";
  }
  return null;
}

function isAllowedUploadedPackage(originalName: string, mimeType: string) {
  const extension = extname(originalName).toLowerCase();
  return (
    [".apkg", ".colpkg"].includes(extension) &&
    [
      "application/octet-stream",
      "application/zip",
      "application/x-zip-compressed",
      "application/vnd.anki",
      "application/vnd.anki.package",
      "application/x-anki",
      "application/apkg",
      "application/x-apkg",
      "application/colpkg",
      "application/x-colpkg"
    ].includes(mimeType)
  );
}

function uploadedMediaMimeType(file: File, originalName: string) {
  const provided = file.type?.split(";")[0]?.trim().toLowerCase();
  return provided || mediaMimeTypeFromName(originalName) || "application/octet-stream";
}

function mediaResponseHeaders(mimeType: string | null | undefined, fileName: string) {
  const safeInlineType = safeInlineMediaType(mimeType);
  const headers: Record<string, string> = {
    "content-type": safeInlineType ?? "application/octet-stream",
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff"
  };
  if (!safeInlineType) {
    headers["content-disposition"] = `attachment; filename="${attachmentFileName(fileName)}"`;
  }
  return headers;
}

function safeInlineMediaType(mimeType: string | null | undefined) {
  const normalized = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  return isAllowedUploadedMediaType(normalized) ? normalized : null;
}

function isAllowedUploadedMediaType(mimeType: string) {
  return (
    ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/aac", "audio/flac"].includes(
      mimeType
    ) ||
    ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(mimeType)
  );
}

function attachmentFileName(fileName: string) {
  return safeFileName(basename(fileName)).replace(/["\\\r\n]/g, "_") || "media.bin";
}

function uploadedMediaExtensionMatchesMimeType(originalName: string, mimeType: string) {
  const extension = extname(originalName).toLowerCase();
  if (!extension) return true;
  return allowedUploadedMediaExtensions(mimeType).includes(extension);
}

function allowedUploadedMediaExtensions(mimeType: string) {
  switch (mimeType) {
    case "audio/mpeg":
    case "audio/mp3":
      return [".mp3", ".mpeg"];
    case "audio/wav":
    case "audio/x-wav":
      return [".wav"];
    case "audio/ogg":
      return [".ogg", ".oga"];
    case "audio/webm":
      return [".webm"];
    case "audio/mp4":
      return [".m4a", ".mp4"];
    case "audio/aac":
      return [".aac"];
    case "audio/flac":
      return [".flac"];
    case "image/png":
      return [".png"];
    case "image/jpeg":
      return [".jpg", ".jpeg"];
    case "image/gif":
      return [".gif"];
    case "image/webp":
      return [".webp"];
    case "image/avif":
      return [".avif"];
    default:
      return [];
  }
}

function uploadedMediaFileName(originalName: string, mimeType: string, digest: string) {
  const cleanName = safeFileName(originalName);
  const rawExtension = normalizedUploadedExtension(extname(cleanName));
  const extension = rawExtension || uploadedExtensionForMimeType(mimeType) || ".bin";
  const stem = uploadFileStem(rawExtension ? cleanName.slice(0, -rawExtension.length) : cleanName);
  return `${stem}-${digest.slice(0, 10)}${extension}`;
}

function normalizedUploadedExtension(extension: string) {
  const clean = extension.toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!clean || clean === ".") return "";
  if (clean === ".jpeg") return ".jpg";
  if (clean === ".mpeg") return ".mp3";
  return clean;
}

function uploadFileStem(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "media"
  );
}

function mediaMimeTypeFromName(name: string) {
  switch (extname(name).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".webm":
      return "audio/webm";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    default:
      return null;
  }
}

function uploadedExtensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "audio/mpeg":
    case "audio/mp3":
      return ".mp3";
    case "audio/wav":
    case "audio/x-wav":
      return ".wav";
    case "audio/ogg":
      return ".ogg";
    case "audio/webm":
      return ".webm";
    case "audio/mp4":
      return ".m4a";
    case "audio/aac":
      return ".aac";
    case "audio/flac":
      return ".flac";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/avif":
      return ".avif";
    default:
      return null;
  }
}

function mediaReference(fileName: string, mimeType: string) {
  if (mimeType.startsWith("audio/")) return `[sound:${fileName}]`;
  return `<img src="${fileName}">`;
}

function sourceDto(services: AppServices, row: any) {
  const draftCounts = services.db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM generation_drafts
       WHERE source_id = ?`
    )
    .get(row.id) as { total: number; draft: number | null; approved: number | null; rejected: number | null };
  const approvedNotes = services.db.prepare("SELECT COUNT(*) AS count FROM notes WHERE source_id = ?").get(row.id) as { count: number };
  return {
    id: row.id,
    type: row.type,
    url: row.url,
    title: row.title,
    contentPreview: sourcePreview(row.content_text),
    contentHash: row.content_hash,
    drafts: {
      total: draftCounts.total,
      draft: draftCounts.draft ?? 0,
      approved: draftCounts.approved ?? 0,
      rejected: draftCounts.rejected ?? 0
    },
    approvedNotes: approvedNotes.count,
    createdAt: row.created_at
  };
}

function sourcePreview(text: string) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function settingsDto(services: AppServices) {
  return {
    nodeEnv: services.config.nodeEnv,
    storage: {
      dataDir: services.dataDir,
      databaseConfigured: Boolean(services.config.databaseUrl),
      mediaDir: services.mediaDir,
      packageDir: services.packageDir
    },
    openai: {
      configured: Boolean(services.config.openaiApiKey),
      baseUrlConfigured: Boolean(services.config.openaiBaseUrl),
      textModel: services.config.openaiTextModel,
      ttsModel: services.config.openaiTtsModel,
      ttsVoice: services.config.openaiTtsVoice
    },
    providers: {
      structuredGeneration: services.generateDrafts ? "custom" : services.config.openaiApiKey ? "openai" : "local-fallback",
      tts: services.ttsSynthesize ? "custom" : services.config.openaiApiKey ? "openai" : "not-configured"
    },
    japanese: {
      pitchAccentLexiconConfigured: Boolean(services.config.pitchAccentLexiconSource),
      pitchAccentLexiconSource: services.config.pitchAccentLexiconSource
    },
    preferences: readSettingsPreferences(services)
  };
}

function readSettingsPreferences(services: AppServices) {
  const row = services.db.prepare("SELECT value FROM settings WHERE key = 'preferences'").get() as { value: string } | undefined;
  return normalizeSettingsPreferences(parseJson(row?.value, {}));
}

function saveSettingsPreferences(services: AppServices, preferences: z.infer<typeof settingsPreferencesSchema>) {
  const normalized = normalizeSettingsPreferences(preferences);
  services.db
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('preferences', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(JSON.stringify(normalized), nowIso());
  return normalized;
}

function normalizeSettingsPreferences(input: unknown) {
  return settingsPreferencesSchema.parse(input ?? {});
}

function clearMediaReferences(services: AppServices, asset: any) {
  const candidates = [asset.file_name, asset.original_name].filter(Boolean);
  const now = nowIso();
  clearMediaReferencesFromTable(services, "notes", candidates, now);
  clearMediaReferencesFromTable(services, "generation_drafts", candidates, now);
}

function clearMediaReferencesFromTable(services: AppServices, tableName: "notes" | "generation_drafts", fileNames: string[], updatedAt: string) {
  const rows = services.db.prepare(`SELECT id, fields_json FROM ${tableName}`).all() as Array<{ id: string; fields_json: string }>;
  const update = services.db.prepare(`UPDATE ${tableName} SET fields_json = ?, updated_at = ? WHERE id = ?`);
  for (const row of rows) {
    const fields = parseJson<Record<string, string>>(row.fields_json, {});
    let changed = false;
    const next = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => {
        if (typeof value !== "string") return [key, value];
        const cleaned = removeMediaReference(value, fileNames);
        if (cleaned !== value) changed = true;
        return [key, cleaned];
      })
    );
    if (changed) update.run(JSON.stringify(next), updatedAt, row.id);
  }
}

function removeMediaReference(value: string, fileNames: string[]) {
  let next = value;
  for (const fileName of fileNames) {
    next = next.replaceAll(`[sound:${fileName}]`, "");
  }
  next = next.replace(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi, (match, doubleQuoted, singleQuoted, unquoted) => {
    const src = String(doubleQuoted ?? singleQuoted ?? unquoted ?? "");
    return isDeletedLocalImageReference(src, fileNames) ? "" : match;
  });
  return next.trim();
}

function isDeletedLocalImageReference(src: string, fileNames: string[]) {
  const normalized = normalizeImageReference(src);
  return fileNames.some((fileName) => normalized === fileName || normalized === `/media/${fileName}`);
}

function normalizeImageReference(src: string) {
  const trimmed = src.trim();
  try {
    const mediaPrefix = "/media/";
    if (trimmed.startsWith(mediaPrefix)) {
      return `${mediaPrefix}${decodeURIComponent(trimmed.slice(mediaPrefix.length))}`;
    }
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function setTagCardState(services: AppServices, tag: string, action: "suspend" | "unsuspend", deckId?: string | null) {
  const tagName = tag.trim();
  if (!tagName) throw new Error("Tag name is required");
  if (deckId && !services.decks.getDeck(deckId)) throw new Error("Deck not found");
  const deckIds = scopedDeckIds(services, deckId);
  const noteRows = deckIds
    ? (services.db
        .prepare(`SELECT id, tags_json FROM notes WHERE deck_id IN (${sqlPlaceholders(deckIds)})`)
        .all(...deckIds) as Array<{ id: string; tags_json: string }>)
    : (services.db.prepare("SELECT id, tags_json FROM notes").all() as Array<{ id: string; tags_json: string }>);
  const noteIds = noteRows
    .filter((row) => parseJson<string[]>(row.tags_json, []).map((candidate) => candidate.trim()).includes(tagName))
    .map((row) => row.id);
  if (noteIds.length === 0) return { updatedCards: 0 };

  const cards = services.db
    .prepare(`SELECT id, reps, state FROM cards WHERE note_id IN (${noteIds.map(() => "?").join(",")})`)
    .all(...noteIds) as Array<{ id: string; reps: number; state: string }>;
  const updatedAt = nowIso();
  const suspend = services.db.prepare("UPDATE cards SET state = 'suspended', queue = 'suspended', buried_until = NULL, updated_at = ? WHERE id = ?");
  const restore = services.db.prepare("UPDATE cards SET state = ?, queue = ?, buried_until = NULL, updated_at = ? WHERE id = ?");
  let updatedCards = 0;
  services.db.transaction(() => {
    for (const card of cards) {
      if (action === "suspend") {
        if (card.state === "suspended") continue;
        suspend.run(updatedAt, card.id);
      } else {
        if (card.state !== "suspended") continue;
        const restoredState = card.reps > 0 ? "review" : "new";
        restore.run(restoredState, restoredState, updatedAt, card.id);
      }
      updatedCards += 1;
    }
  })();
  return { updatedCards };
}

function cardStateStats(services: AppServices, deckId?: string) {
  const stats: Record<string, number> = { new: 0, learning: 0, review: 0, relearning: 0, suspended: 0 };
  const deckIds = scopedDeckIds(services, deckId);
  const rows = deckIds
    ? (services.db
        .prepare(`SELECT state, COUNT(*) AS count FROM cards WHERE deck_id IN (${sqlPlaceholders(deckIds)}) GROUP BY state`)
        .all(...deckIds) as Array<{
        state: string;
        count: number;
      }>)
    : (services.db.prepare("SELECT state, COUNT(*) AS count FROM cards GROUP BY state").all() as Array<{
    state: string;
    count: number;
      }>);
  for (const row of rows) stats[row.state] = row.count;
  return stats;
}

function countDueCards(services: AppServices, deckId?: string) {
  const now = nowIso();
  const where = `state != 'suspended' AND due_at <= ? AND (buried_until IS NULL OR buried_until <= ?)`;
  const deckIds = scopedDeckIds(services, deckId);
  const rows = deckIds
    ? (services.db
        .prepare(
          `SELECT deck_id, state
           FROM cards
           WHERE deck_id IN (${sqlPlaceholders(deckIds)}) AND ${where}
           ORDER BY CASE WHEN state = 'new' THEN 1 ELSE 0 END, due_at ASC`
        )
        .all(...deckIds, now, now) as Array<DueCardLimitRow>)
    : (services.db
        .prepare(
          `SELECT deck_id, state
           FROM cards
           WHERE ${where}
           ORDER BY CASE WHEN state = 'new' THEN 1 ELSE 0 END, due_at ASC`
        )
        .all(now, now) as Array<DueCardLimitRow>);
  return countDailyLimitAvailableDueCards(services, rows, deckId);
}

type DueCardLimitRow = { deck_id: string; state: string };
type DailyLimitedCardState = "new" | "review";

function countDailyLimitAvailableDueCards(services: AppServices, rows: DueCardLimitRow[], selectedDeckId?: string) {
  const remainingSlots = new Map<string, number>();
  const scopeCache = new Map<string, string[]>();
  let available = 0;
  for (const row of rows) {
    const limitedState = dailyLimitedCardState(row.state);
    if (!limitedState) {
      available += 1;
      continue;
    }
    const limitDeckIds = deckDailyLimitScopeForRow(services, row.deck_id, selectedDeckId, scopeCache);
    if (!limitDeckIds.every((limitDeckId) => dailyLimitRemaining(services, remainingSlots, limitDeckId, limitedState) > 0)) {
      continue;
    }
    for (const limitDeckId of limitDeckIds) {
      consumeDailyLimitSlot(services, remainingSlots, limitDeckId, limitedState);
    }
    available += 1;
  }
  return available;
}

function dailyLimitedCardState(state: string): DailyLimitedCardState | null {
  if (state === "new" || state === "review") return state;
  return null;
}

function deckDailyLimitScopeForRow(
  services: AppServices,
  cardDeckId: string,
  selectedDeckId: string | undefined,
  cache: Map<string, string[]>
) {
  const key = `${cardDeckId}:${selectedDeckId ?? ""}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const scope = deckDailyLimitScopeIds(services.db, cardDeckId, selectedDeckId);
  cache.set(key, scope);
  return scope;
}

function dailyLimitRemaining(
  services: AppServices,
  cache: Map<string, number>,
  deckId: string,
  state: DailyLimitedCardState
) {
  const key = dailyLimitKey(deckId, state);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const progress = getDeckDailyProgress(services.db, deckId);
  const remaining = progress
    ? state === "new"
      ? Math.max(0, progress.newLimit - progress.newDone)
      : Math.max(0, progress.reviewLimit - progress.reviewDone)
    : Number.POSITIVE_INFINITY;
  cache.set(key, remaining);
  return remaining;
}

function consumeDailyLimitSlot(
  services: AppServices,
  cache: Map<string, number>,
  deckId: string,
  state: DailyLimitedCardState
) {
  const remaining = dailyLimitRemaining(services, cache, deckId, state);
  if (Number.isFinite(remaining)) cache.set(dailyLimitKey(deckId, state), Math.max(0, remaining - 1));
}

function dailyLimitKey(deckId: string, state: DailyLimitedCardState) {
  return `${deckId}:${state}`;
}

function countCards(services: AppServices, deckId?: string) {
  const deckIds = scopedDeckIds(services, deckId);
  const row = deckIds
    ? (services.db
        .prepare(`SELECT COUNT(*) AS count FROM cards WHERE deck_id IN (${sqlPlaceholders(deckIds)})`)
        .get(...deckIds) as { count: number })
    : (services.db.prepare("SELECT COUNT(*) AS count FROM cards").get() as { count: number });
  return row.count;
}

function canAnswerReviewCard(card: any, reviewedAt: Date) {
  if (card.state === "suspended") return false;
  const now = reviewedAt.toISOString();
  if (String(card.due_at ?? "") > now) return false;
  return !card.buried_until || String(card.buried_until) <= now;
}

function countReviews(services: AppServices, deckId?: string) {
  const deckIds = scopedDeckIds(services, deckId);
  const row = deckIds
    ? (services.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM review_logs
           JOIN cards ON cards.id = review_logs.card_id
           WHERE cards.deck_id IN (${sqlPlaceholders(deckIds)})`
        )
        .get(...deckIds) as { count: number })
    : (services.db.prepare("SELECT COUNT(*) AS count FROM review_logs").get() as { count: number });
  return row.count;
}

function countDrafts(services: AppServices, deckId?: string) {
  const deckIds = scopedDeckIds(services, deckId);
  const row = deckIds
    ? (services.db
        .prepare(`SELECT COUNT(*) AS count FROM generation_drafts WHERE status = 'draft' AND deck_id IN (${sqlPlaceholders(deckIds)})`)
        .get(...deckIds) as { count: number })
    : (services.db.prepare("SELECT COUNT(*) AS count FROM generation_drafts WHERE status = 'draft'").get() as { count: number });
  return row.count;
}

function ratingStats(services: AppServices, deckId?: string) {
  const stats: Record<ReviewRating, number> = { Again: 0, Hard: 0, Good: 0, Easy: 0 };
  const deckIds = scopedDeckIds(services, deckId);
  const rows = deckIds
    ? (services.db
        .prepare(
          `SELECT rating, COUNT(*) AS count
           FROM review_logs
           JOIN cards ON cards.id = review_logs.card_id
           WHERE cards.deck_id IN (${sqlPlaceholders(deckIds)})
           GROUP BY rating`
        )
        .all(...deckIds) as Array<{
        rating: ReviewRating;
        count: number;
      }>)
    : (services.db.prepare("SELECT rating, COUNT(*) AS count FROM review_logs GROUP BY rating").all() as Array<{
        rating: ReviewRating;
        count: number;
      }>);
  for (const row of rows) {
    if (row.rating in stats) stats[row.rating] = row.count;
  }
  return stats;
}

function reviewActivityStats(services: AppServices, deckId?: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows: Array<{ date: string; reviews: number }> = [];
  const deckIds = scopedDeckIds(services, deckId);
  const countReviews = deckIds
    ? services.db.prepare(
        `SELECT COUNT(*) AS count
         FROM review_logs
         JOIN cards ON cards.id = review_logs.card_id
         WHERE cards.deck_id IN (${sqlPlaceholders(deckIds)}) AND reviewed_at >= ? AND reviewed_at < ?`
      )
    : services.db.prepare("SELECT COUNT(*) AS count FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ?");
  for (let index = 6; index >= 0; index -= 1) {
    const start = new Date(today);
    start.setDate(start.getDate() - index);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const count = (deckIds
      ? countReviews.get(...deckIds, start.toISOString(), end.toISOString())
      : countReviews.get(start.toISOString(), end.toISOString())) as { count: number };
    rows.push({ date: localDateKey(start), reviews: count.count });
  }
  return rows;
}

function reviewCalendarStats(services: AppServices, deckId?: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today);
  monthStart.setDate(1);
  const rows: Array<{
    date: string;
    reviews: number;
    elapsedMs: number;
    ratings: Record<ReviewRating, number>;
  }> = [];
  const deckIds = scopedDeckIds(services, deckId);
  const query = deckIds
    ? services.db.prepare(
        `SELECT rating, COUNT(*) AS reviews, COALESCE(SUM(elapsed_ms), 0) AS elapsed_ms
         FROM review_logs
         JOIN cards ON cards.id = review_logs.card_id
         WHERE cards.deck_id IN (${sqlPlaceholders(deckIds)}) AND reviewed_at >= ? AND reviewed_at < ?
         GROUP BY rating`
      )
    : services.db.prepare(
        `SELECT rating, COUNT(*) AS reviews, COALESCE(SUM(elapsed_ms), 0) AS elapsed_ms
         FROM review_logs
         WHERE reviewed_at >= ? AND reviewed_at < ?
         GROUP BY rating`
      );
  for (const start = new Date(monthStart); start <= today; start.setDate(start.getDate() + 1)) {
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const ratingRows = (deckIds
      ? query.all(...deckIds, start.toISOString(), end.toISOString())
      : query.all(start.toISOString(), end.toISOString())) as Array<{ rating: ReviewRating; reviews: number; elapsed_ms: number }>;
    const ratings: Record<ReviewRating, number> = { Again: 0, Hard: 0, Good: 0, Easy: 0 };
    let reviews = 0;
    let elapsedMs = 0;
    for (const row of ratingRows) {
      if (row.rating in ratings) ratings[row.rating] = row.reviews;
      reviews += row.reviews;
      elapsedMs += row.elapsed_ms;
    }
    rows.push({ date: localDateKey(start), reviews, elapsedMs, ratings });
  }
  return rows;
}

function scopedDeckIds(services: AppServices, deckId?: string | null) {
  return deckId ? deckScopeIds(services.db, deckId) : null;
}

function sqlPlaceholders(values: string[]) {
  return values.map(() => "?").join(", ");
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
