import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import Database from "better-sqlite3";
import JSZip from "jszip";
import type { AppServices, DeckRecord, ExportOptions, ImportOptions, ImportResult, JlptLevel } from "../types";
import { ankiChecksum, ankiGuid, checksum, id, nowIso, numericId, parseJson, safeFileName } from "../utils/id";
import {
  createJapaneseNote,
  deckScopeIds,
  defaultDeck,
  ensureJapaneseNoteType,
  japaneseFields,
  japaneseNoteTypeAnkiId,
  japaneseNoteTypeId
} from "../cards/service";

export class AnkiPackageWorker {
  constructor(private readonly services: AppServices) {}

  async importPackage(buffer: Buffer, options: ImportOptions): Promise<ImportResult> {
    const zip = await JSZip.loadAsync(buffer);
    const packageFormat = await readPackageFormat(zip);
    const tempDir = mkdtempSync(join(tmpdir(), "anki-import-"));
    const collectionPath = await this.writeCollectionDatabase(zip, tempDir);
    const sourceId = id("source");

    try {
      const packageDb = new Database(collectionPath, { readonly: true });
      try {
        const col = packageDb.prepare("SELECT decks, models FROM col LIMIT 1").get() as any;
        const decks = parseJson<Record<string, any>>(col?.decks, {});
        const models = parseJson<Record<string, any>>(col?.models, {});
        const mediaImport = await this.importMedia(zip, sourceId, packageFormat);
        try {
          return this.services.db.transaction(() => {
            this.recordPackageSource(sourceId, options.sourceUrl, buffer);
            const deckMap = this.importDecks(decks);
            const noteTypeMap = this.importModels(models);
            const noteImport = this.importNotes(packageDb, noteTypeMap, deckMap, sourceId, mediaImport.references);
            const cardImport = this.importCards(packageDb, deckMap, options.includeScheduling, noteImport.noteIdByPackageId);
            this.importReviewLogs(packageDb, options.includeScheduling, cardImport.cardIdByPackageId);
            return {
              sourceId,
              decksImported: Object.keys(deckMap).length,
              noteTypesImported: Object.keys(noteTypeMap).length,
              notesImported: noteImport.imported,
              cardsImported: cardImport.imported,
              mediaImported: mediaImport.imported
            };
          })();
        } catch (error) {
          this.removeMediaForSource(sourceId);
          throw error;
        }
      } finally {
        packageDb.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private async writeCollectionDatabase(zip: JSZip, tempDir: string) {
    const compressedCollection = zip.file("collection.anki21b");
    if (compressedCollection) {
      const collectionPath = join(tempDir, "collection.anki21");
      try {
        writeFileSync(collectionPath, zstdDecompressSync(await compressedCollection.async("nodebuffer")));
      } catch (error) {
        throw new Error(`Unable to decompress collection.anki21b: ${error instanceof Error ? error.message : String(error)}`);
      }
      return collectionPath;
    }

    const collectionName = ["collection.anki21", "collection.anki2"].find((name) => zip.file(name));
    if (!collectionName) {
      throw new Error("Package does not contain collection.anki21b, collection.anki21, or collection.anki2");
    }
    const collectionPath = join(tempDir, collectionName);
    writeFileSync(collectionPath, await zip.file(collectionName)!.async("nodebuffer"));
    return collectionPath;
  }

  async exportDeck(deckId: string, options: ExportOptions) {
    const deck = this.services.decks.getDeck(deckId);
    if (!deck) throw new Error("Deck not found");
    const deckIds = deckScopeIds(this.services.db, deckId) ?? [deckId];

    return await this.exportSelectedNotes(
      {
        where: `notes.deck_id IN (${sqlPlaceholders(deckIds)})`,
        params: deckIds,
        deckIds,
        emptyMessage: "Deck has no cards to export",
        fileName: exportPackageFileName(deck.name, options)
      },
      options
    );
  }

  async exportSource(sourceId: string, options: ExportOptions) {
    const source = this.services.db.prepare("SELECT * FROM sources WHERE id = ?").get(sourceId) as any;
    if (!source) throw new Error("Source not found");

    return await this.exportSelectedNotes(
      {
        where: "notes.source_id = ?",
        params: [sourceId],
        emptyMessage: "No approved cards found for this import",
        fileName: exportPackageFileName(source.title || "Generated Cards", options)
      },
      options
    );
  }

  private async exportSelectedNotes(
    selection: { where: string; params: unknown[]; deckIds?: string[]; emptyMessage: string; fileName: string },
    options: ExportOptions
  ) {
    const tempDir = mkdtempSync(join(tmpdir(), "anki-export-"));
    const collectionPath = join(tempDir, options.legacySupport ? "collection.anki2" : "collection.anki21");
    const exportDb = new Database(collectionPath);
    try {
      createExportSchema(exportDb);
      const exportedAt = Math.floor(Date.now() / 1000);
      const notes = this.services.db
        .prepare(
          `SELECT notes.*, note_types.anki_id AS note_type_anki_id
           FROM notes
           JOIN note_types ON note_types.id = notes.note_type_id
           WHERE ${selection.where}
           ORDER BY notes.created_at`
        )
        .all(...selection.params) as any[];
      if (notes.length === 0) throw new Error(selection.emptyMessage);

      const decks = this.decksForExport(selection.deckIds ?? [...new Set(notes.map((note) => note.deck_id))]);
      if (decks.length === 0) throw new Error("No decks found for export");
      const deckById = new Map(decks.map((deck) => [deck.id, deck]));
      const modelJson = buildExportModelJson(
        this.services.db,
        [...new Set(notes.map((note) => note.note_type_id))],
        exportedAt
      );
      const deckJson = Object.fromEntries(
        decks.map((deck) => [
          deck.ankiId,
          {
          id: deck.ankiId,
          name: exportDeckName(deck, deckById),
          mod: exportedAt,
          usn: -1,
          desc: "",
          dyn: 0,
          collapsed: false,
          extendNew: 0,
          extendRev: 0,
          conf: 1
          }
        ])
      );
      exportDb
        .prepare(
          `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
           VALUES (1, ?, ?, ?, 11, 0, -1, 0, '{}', ?, ?, '{}', '{}')`
        )
        .run(exportedAt, exportedAt, exportedAt * 1000, JSON.stringify(modelJson), JSON.stringify(deckJson));

      const cardRows = this.services.db.prepare(`
        SELECT cards.*, card_templates.ord AS template_ord
        FROM cards
        JOIN card_templates ON card_templates.id = cards.template_id
        WHERE cards.note_id = ?
        ORDER BY card_templates.ord, cards.created_at
      `);
      const modelFields = this.readImportedModelFields();
      const insertNote = exportDb.prepare(`
        INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
        VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')
      `);
      const insertCard = exportDb.prepare(`
        INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
        VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, 0, ?, ?, 0, 0, 0, 0, '')
      `);
      const insertRevlog = exportDb.prepare(`
        INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
        VALUES (?, ?, -1, ?, ?, ?, 0, ?, 1)
      `);
      const reviewLogRows = this.services.db.prepare("SELECT * FROM review_logs WHERE card_id = ? ORDER BY reviewed_at, id");
      let reviewLogIndex = 0;

      for (const note of notes) {
        const fields = parseJson<Record<string, string>>(note.fields_json, {});
        const fieldNames = modelFields[note.note_type_id] ?? japaneseFields;
        const fieldValues = fieldNames.map((field) => fields[field] ?? "");
        const noteAnkiId = numericId();
        const sfld = fieldValues[0] ?? "";
        insertNote.run(
          noteAnkiId,
          note.anki_guid || ankiGuid(),
          note.note_type_anki_id,
          exportedAt,
          ` ${parseJson<string[]>(note.tags_json, []).join(" ")} `,
          fieldValues.join("\x1f"),
          sfld,
          ankiChecksum(sfld)
        );

        const cards = cardRows.all(note.id) as any[];
        for (const card of cards) {
          const cardDeck = deckById.get(card.deck_id) ?? deckById.get(note.deck_id);
          if (!cardDeck) continue;
          const cardAnkiId = this.stableCardAnkiId(card);
          const ord = Math.max(0, card.template_ord ?? cards.indexOf(card));
          const scheduling = exportCardScheduling(card, options.includeScheduling);
          insertCard.run(
            cardAnkiId,
            noteAnkiId,
            cardDeck.ankiId,
            ord,
            exportedAt,
            scheduling.type,
            scheduling.queue,
            scheduling.due,
            scheduling.ivl,
            options.includeScheduling ? card.reps : 0,
            options.includeScheduling ? card.lapses : 0
          );
          if (options.includeScheduling) {
            const logs = reviewLogRows.all(card.id) as any[];
            logs.forEach((log) => {
              insertRevlog.run(
                reviewLogAnkiId(log.reviewed_at, reviewLogIndex),
                cardAnkiId,
                ratingToAnkiEase(log.rating),
                Math.max(0, Number(log.scheduled_days) || 0),
                Math.max(0, Number(card.scheduled_days) || 0),
                Math.max(0, Number(log.elapsed_ms) || 0)
              );
              reviewLogIndex += 1;
            });
          }
        }
      }

      exportDb.close();
      const zip = new JSZip();
      if (options.legacySupport) {
        zip.file("collection.anki2", readFileSync(collectionPath));
        const mediaMap = options.includeMedia ? this.addReferencedMedia(zip, notes, { compressed: false }) : {};
        zip.file("media", JSON.stringify(mediaMap));
      } else {
        zip.file("meta", encodePackageMetadata(3));
        zip.file("collection.anki21b", zstdCompressSync(readFileSync(collectionPath)));
        zip.file("collection.anki2", createCompatibilityCollection());
        const mediaEntries = options.includeMedia ? this.addReferencedMedia(zip, notes, { compressed: true }) : [];
        zip.file("media", zstdCompressSync(encodeMediaEntries(mediaEntries)));
      }
      const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      return {
        fileName: selection.fileName,
        buffer: output
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private stableCardAnkiId(card: any) {
    if (Number.isFinite(card.anki_id)) return Number(card.anki_id);
    let candidate = numericId();
    while (this.services.db.prepare("SELECT id FROM cards WHERE anki_id = ?").get(candidate)) {
      candidate = numericId();
    }
    this.services.db.prepare("UPDATE cards SET anki_id = ?, updated_at = ? WHERE id = ?").run(candidate, nowIso(), card.id);
    card.anki_id = candidate;
    return candidate;
  }

  private recordPackageSource(sourceId: string, sourceUrl: string, buffer: Buffer) {
    this.services.db
      .prepare(
        `INSERT INTO sources (id, type, url, title, content_text, content_hash, created_at)
         VALUES (?, 'apkg-url', ?, ?, '', ?, ?)`
      )
      .run(sourceId, sourceUrl, basename(new URL(sourceUrl).pathname) || "Anki package", checksum(buffer), nowIso());
    return sourceId;
  }

  private removeMediaForSource(sourceId: string) {
    const rows = this.services.db.prepare("SELECT path FROM media_assets WHERE source_id = ?").all(sourceId) as Array<{ path: string }>;
    this.services.db.prepare("DELETE FROM media_assets WHERE source_id = ?").run(sourceId);
    for (const row of rows) {
      if (row.path && existsSync(row.path)) rmSync(row.path, { force: true });
    }
  }

  private importDecks(decks: Record<string, any>) {
    const map: Record<string, string> = {};
    const importedDecks: Array<{ id: string; name: string }> = [];
    const insert = this.services.db.prepare(`
      INSERT INTO decks (
        id, anki_id, name, parent_id, jlpt_level, daily_new_limit, daily_review_limit,
        fsrs_retention, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, 20, 200, 0.9, ?, ?, ?)
    `);
    for (const [ankiId, deck] of Object.entries(decks)) {
      if (deck?.dyn) continue;
      const existing = this.services.db.prepare("SELECT id, name FROM decks WHERE anki_id = ?").get(Number(ankiId)) as
        | { id: string; name: string }
        | undefined;
      const deckName = deck?.name ?? `Deck ${ankiId}`;
      if (existing && existing.name === deckName) {
        map[ankiId] = existing.id;
        importedDecks.push({ id: existing.id, name: deckName });
        continue;
      }
      const deckId = id("deck");
      const localAnkiId = existing ? availableDeckAnkiId(this.services.db) : Number(ankiId);
      insert.run(deckId, localAnkiId, deckName, inferJlptLevel(deckName), JSON.stringify(deck), nowIso(), nowIso());
      map[ankiId] = deckId;
      importedDecks.push({ id: deckId, name: deckName });
    }
    this.restoreImportedDeckHierarchy(importedDecks);
    if (Object.keys(map).length === 0) {
      const localDeck = defaultDeck(this.services.db);
      map.default = localDeck;
    }
    return map;
  }

  private restoreImportedDeckHierarchy(importedDecks: Array<{ id: string; name: string }>) {
    if (importedDecks.length === 0) return;
    this.ensureMissingParentDecks(importedDecks.map((deck) => deck.name));
    const allDecks = this.services.decks.listDecks();
    const deckIdByName = new Map(allDecks.map((deck) => [deck.name, deck.id]));
    const updateParent = this.services.db.prepare("UPDATE decks SET parent_id = ?, updated_at = ? WHERE id = ?");
    const updatedAt = nowIso();
    for (const deck of importedDecks) {
      const parentName = parentDeckName(deck.name);
      if (!parentName) continue;
      const parentId = deckIdByName.get(parentName);
      if (!parentId || parentId === deck.id) continue;
      updateParent.run(parentId, updatedAt, deck.id);
    }
  }

  private ensureMissingParentDecks(deckNames: string[]) {
    const deckIdByName = new Map(this.services.decks.listDecks().map((deck) => [deck.name, deck.id]));
    const insert = this.services.db.prepare(`
      INSERT INTO decks (
        id, anki_id, name, parent_id, jlpt_level, daily_new_limit, daily_review_limit,
        fsrs_retention, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 20, 200, 0.9, NULL, ?, ?)
    `);
    const updateParent = this.services.db.prepare("UPDATE decks SET parent_id = ?, updated_at = ? WHERE id = ?");
    for (const deckName of deckNames) {
      const ancestors = ancestorDeckNames(deckName);
      for (const ancestorName of ancestors) {
        if (!deckIdByName.has(ancestorName)) {
          const deckId = id("deck");
          const createdAt = nowIso();
          insert.run(deckId, numericId(), ancestorName, null, inferJlptLevel(ancestorName), createdAt, createdAt);
          deckIdByName.set(ancestorName, deckId);
        }
        const parentName = parentDeckName(ancestorName);
        if (!parentName) continue;
        const parentId = deckIdByName.get(parentName);
        const ancestorId = deckIdByName.get(ancestorName);
        if (parentId && ancestorId && parentId !== ancestorId) updateParent.run(parentId, nowIso(), ancestorId);
      }
    }
  }

  private decksForExport(deckIds: string[]) {
    const decks = new Map<string, DeckRecord>();
    const pending = [...deckIds];
    while (pending.length > 0) {
      const deckId = pending.shift()!;
      if (decks.has(deckId)) continue;
      const deck = this.services.decks.getDeck(deckId);
      if (!deck) continue;
      decks.set(deck.id, deck);
      if (deck.parentId) pending.push(deck.parentId);
    }
    return Array.from(decks.values());
  }

  private importModels(models: Record<string, any>) {
    const map: Record<string, string> = {};
    for (const [ankiId, model] of Object.entries(models)) {
      const existing = this.services.db.prepare("SELECT id FROM note_types WHERE anki_id = ?").get(Number(ankiId)) as
        | { id: string }
        | undefined;
      if (existing && importedModelMatchesNoteType(this.services.db, existing.id, model)) {
        this.mergeImportedModel(existing.id, model);
        map[ankiId] = existing.id;
        continue;
      }
      const noteTypeId = id("note_type");
      const localAnkiId = existing ? availableNoteTypeAnkiId(this.services.db) : Number(ankiId);
      this.services.db
        .prepare("INSERT INTO note_types (id, anki_id, name, css, raw_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(noteTypeId, localAnkiId, model?.name ?? `Model ${ankiId}`, model?.css ?? "", JSON.stringify(model), nowIso(), nowIso());
      const insertField = this.services.db.prepare("INSERT INTO note_fields (id, note_type_id, ord, name) VALUES (?, ?, ?, ?)");
      for (const field of model?.flds ?? []) {
        insertField.run(id("field"), noteTypeId, field.ord ?? 0, field.name ?? `Field ${field.ord ?? 0}`);
      }
      const insertTemplate = this.services.db.prepare(
        "INSERT INTO card_templates (id, note_type_id, ord, name, question_format, answer_format) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const templates = model?.tmpls?.length
        ? model.tmpls
        : [
            {
              name: "Card 1",
              ord: 0,
              qfmt: `{{${model?.flds?.[0]?.name ?? "Front"}}}`,
              afmt: `{{FrontSide}}<hr>{{${model?.flds?.[1]?.name ?? model?.flds?.[0]?.name ?? "Back"}}}`
            }
          ];
      for (const template of templates) {
        insertTemplate.run(
          id("template"),
          noteTypeId,
          template.ord ?? 0,
          template.name ?? `Card ${template.ord ?? 0}`,
          template.qfmt ?? "{{Front}}",
          template.afmt ?? "{{FrontSide}}<hr>{{Back}}"
        );
      }
      map[ankiId] = noteTypeId;
    }
    ensureJapaneseNoteType(this.services.db);
    map[String(japaneseNoteTypeAnkiId)] = japaneseNoteTypeId;
    return map;
  }

  private mergeImportedModel(noteTypeId: string, model: any) {
    const now = nowIso();
    const fields = Array.isArray(model?.flds) ? model.flds : [];
    const templates = Array.isArray(model?.tmpls) ? model.tmpls : [];
    this.services.db.transaction(() => {
      this.services.db.prepare("UPDATE note_types SET raw_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(model), now, noteTypeId);

      const existingFieldOrds = new Set(
        (this.services.db.prepare("SELECT ord FROM note_fields WHERE note_type_id = ?").all(noteTypeId) as Array<{ ord: number }>).map(
          (row) => row.ord
        )
      );
      const insertField = this.services.db.prepare("INSERT INTO note_fields (id, note_type_id, ord, name) VALUES (?, ?, ?, ?)");
      for (const field of fields) {
        const ord = Number(field?.ord) || 0;
        if (existingFieldOrds.has(ord)) continue;
        insertField.run(id("field"), noteTypeId, ord, field?.name ?? `Field ${ord}`);
        existingFieldOrds.add(ord);
      }

      const existingTemplateOrds = new Set(
        (this.services.db.prepare("SELECT ord FROM card_templates WHERE note_type_id = ?").all(noteTypeId) as Array<{ ord: number }>).map(
          (row) => row.ord
        )
      );
      const insertTemplate = this.services.db.prepare(
        "INSERT INTO card_templates (id, note_type_id, ord, name, question_format, answer_format) VALUES (?, ?, ?, ?, ?, ?)"
      );
      for (const template of templates) {
        const ord = Number(template?.ord) || 0;
        if (existingTemplateOrds.has(ord)) continue;
        insertTemplate.run(
          id("template"),
          noteTypeId,
          ord,
          template?.name ?? `Card ${ord}`,
          template?.qfmt ?? "{{Front}}",
          template?.afmt ?? "{{FrontSide}}<hr>{{Back}}"
        );
        existingTemplateOrds.add(ord);
      }
    })();
  }

  private async importMedia(zip: JSZip, sourceId: string, packageFormat: PackageFormat) {
    const mediaFile = zip.file("media");
    if (!mediaFile) return { imported: 0, references: new Map<string, string>() };
    let imported = 0;
    const references = new Map<string, string>();
    const mediaMap = await readMediaMap(mediaFile, packageFormat);
    const insert = this.services.db.prepare(`
      INSERT OR IGNORE INTO media_assets (id, file_name, original_name, mime_type, path, checksum, source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entry of mediaMap) {
      const file = zip.file(entry.zipName);
      if (!file) continue;
      const rawBuffer = await file.async("nodebuffer");
      const buffer = packageFormat.zstdMedia ? zstdDecompressSync(rawBuffer) : rawBuffer;
      validateImportedMedia(entry, buffer);
      const digest = checksum(buffer);
      const existing = this.services.db
        .prepare("SELECT file_name, path FROM media_assets WHERE checksum = ?")
        .get(digest) as { file_name: string; path: string } | undefined;
      if (existing) {
        if (!existsSync(existing.path)) writeFileSync(existing.path, buffer);
        references.set(entry.originalName, existing.file_name);
        continue;
      }
      const fileName = this.availableMediaFileName(safeFileName(entry.originalName), digest);
      const path = join(this.services.mediaDir, fileName);
      writeFileSync(path, buffer);
      const result = insert.run(id("media"), fileName, entry.originalName, mimeFromName(entry.originalName), path, digest, sourceId, nowIso());
      if (result.changes > 0) {
        imported += 1;
        references.set(entry.originalName, fileName);
      } else {
        rmSync(path, { force: true });
      }
    }
    return { imported, references };
  }

  private addReferencedMedia(zip: JSZip, notes: any[], options: { compressed: false }): Record<string, string>;
  private addReferencedMedia(zip: JSZip, notes: any[], options: { compressed: true }): MediaEntryForExport[];
  private addReferencedMedia(zip: JSZip, notes: any[], options: { compressed: boolean }) {
    const refs = new Set<string>();
    for (const note of notes) {
      const fields = parseJson<Record<string, string>>(note.fields_json, {});
      for (const value of Object.values(fields)) {
        for (const match of value.matchAll(/\[sound:([^\]]+)\]/g)) {
          refs.add(match[1]);
        }
        for (const match of value.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
          refs.add(match[1]);
        }
      }
    }

    const mediaMap: Record<string, string> = {};
    const mediaEntries: MediaEntryForExport[] = [];
    let index = 0;
    for (const ref of refs) {
      const asset = this.services.db
        .prepare("SELECT * FROM media_assets WHERE original_name = ? OR file_name = ? ORDER BY created_at DESC LIMIT 1")
        .get(ref, ref) as any;
      if (!asset || !existsSync(asset.path)) continue;
      const zipName = String(index);
      const buffer = readFileSync(asset.path);
      if (options.compressed) {
        zip.file(zipName, zstdCompressSync(buffer));
        mediaEntries.push({ name: ref, size: buffer.byteLength, sha1: createHash("sha1").update(buffer).digest() });
      } else {
        zip.file(zipName, buffer);
        mediaMap[zipName] = ref;
      }
      index += 1;
    }
    return options.compressed ? mediaEntries : mediaMap;
  }

  private availableMediaFileName(originalName: string, digest: string) {
    const existing = this.services.db.prepare("SELECT checksum FROM media_assets WHERE file_name = ?").get(originalName) as
      | { checksum: string }
      | undefined;
    if (!existing || existing.checksum === digest) return originalName;
    return `${digest.slice(0, 10)}-${originalName}`;
  }

  private importNotes(
    packageDb: Database.Database,
    noteTypeMap: Record<string, string>,
    deckMap: Record<string, string>,
    sourceId: string,
    mediaReferences: Map<string, string>
  ) {
    const notes = packageDb.prepare("SELECT * FROM notes").all() as any[];
    const cardLookup = packageDb.prepare("SELECT did FROM cards WHERE nid = ? ORDER BY ord LIMIT 1");
    const modelFields = this.readImportedModelFields();
    const noteIdByPackageId = new Map<number, string>();
    let imported = 0;
    for (const note of notes) {
      const noteTypeId = noteTypeMap[String(note.mid)] ?? japaneseNoteTypeId;
      const firstCard = cardLookup.get(note.id) as { did: number } | undefined;
      const deckId = deckMap[String(firstCard?.did)] ?? deckMap.default ?? Object.values(deckMap)[0] ?? defaultDeck(this.services.db);
      const fieldNames = modelFields[noteTypeId] ?? japaneseFields;
      const values = String(note.flds ?? "").split("\x1f");
      const fields = Object.fromEntries(fieldNames.map((name, index) => [name, rewriteMediaReferences(values[index] ?? "", mediaReferences)]));
      const fieldsJson = JSON.stringify(fields);
      const tags = normalizeAnkiTags(note.tags);
      const tagsJson = JSON.stringify(tags);
      const existing = this.services.db
        .prepare("SELECT id, note_type_id, deck_id, fields_json, tags_json FROM notes WHERE anki_guid = ?")
        .get(note.guid) as
        | { id: string; note_type_id: string; deck_id: string; fields_json: string; tags_json: string }
        | undefined;
      if (
        existing &&
        existing.note_type_id === noteTypeId &&
        existing.deck_id === deckId &&
        existing.fields_json === fieldsJson &&
        storedTagsMatch(existing.tags_json, tags)
      ) {
        noteIdByPackageId.set(Number(note.id), existing.id);
        continue;
      }
      const structuralExisting = existing
        ? (
            this.services.db
              .prepare("SELECT id, tags_json FROM notes WHERE note_type_id = ? AND deck_id = ? AND fields_json = ? ORDER BY created_at")
              .all(noteTypeId, deckId, fieldsJson) as Array<{ id: string; tags_json: string }>
          ).find((candidate) => storedTagsMatch(candidate.tags_json, tags))
        : undefined;
      if (structuralExisting) {
        noteIdByPackageId.set(Number(note.id), structuralExisting.id);
        continue;
      }
      const noteId = id("note");
      const localGuid = existing || !note.guid ? availableNoteGuid(this.services.db) : note.guid;
      this.services.db
        .prepare(
          `INSERT INTO notes (id, anki_guid, note_type_id, deck_id, fields_json, tags_json, source_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          noteId,
          localGuid,
          noteTypeId,
          deckId,
          fieldsJson,
          tagsJson,
          sourceId,
          nowIso(),
          nowIso()
        );
      noteIdByPackageId.set(Number(note.id), noteId);
      imported += 1;
    }
    return { imported, noteIdByPackageId };
  }

  private importCards(
    packageDb: Database.Database,
    deckMap: Record<string, string>,
    includeScheduling: boolean,
    noteIdByPackageId: Map<number, string>
  ) {
    const rows = packageDb.prepare("SELECT * FROM cards ORDER BY id").all() as any[];
    const cardIdByPackageId = new Map<number, string>();
    let imported = 0;
    for (const row of rows) {
      const packageNote = packageDb.prepare("SELECT guid, mid FROM notes WHERE id = ?").get(row.nid) as any;
      if (!packageNote) continue;
      const localNoteId = noteIdByPackageId.get(Number(row.nid));
      const localNote = (
        localNoteId
          ? this.services.db.prepare("SELECT id, note_type_id, deck_id FROM notes WHERE id = ?").get(localNoteId)
          : this.services.db.prepare("SELECT id, note_type_id, deck_id FROM notes WHERE anki_guid = ?").get(packageNote.guid)
      ) as any;
      if (!localNote) continue;
      const packageCardId = Number(row.id);
      const existing = this.services.db.prepare("SELECT id, note_id FROM cards WHERE anki_id = ?").get(packageCardId) as
        | { id: string; note_id: string }
        | undefined;
      if (existing && existing.note_id === localNote.id) {
        cardIdByPackageId.set(packageCardId, existing.id);
        continue;
      }
      const template = this.templateForImportedCard(localNote.note_type_id, Number(row.ord) || 0);
      if (!template) continue;
      const deckId = deckMap[String(row.did)] ?? localNote.deck_id;
      const now = new Date();
      const scheduling = importedCardScheduling(row, includeScheduling, now);
      const cardId = id("card");
      const localAnkiId = existing ? availableCardAnkiId(this.services.db) : packageCardId;
      this.services.db
        .prepare(
          `INSERT INTO cards (
            id, anki_id, note_id, deck_id, template_id, state, due_at, stability, difficulty,
            elapsed_days, scheduled_days, reps, lapses, queue, buried_until, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
        )
        .run(
          cardId,
          localAnkiId,
          localNote.id,
          deckId,
          template.id,
          scheduling.state,
          scheduling.dueAt,
          scheduling.stability,
          0,
          0,
          scheduling.scheduledDays,
          scheduling.reps,
          scheduling.lapses,
          scheduling.state,
          nowIso(),
          nowIso()
        );
      cardIdByPackageId.set(packageCardId, cardId);
      imported += 1;
    }
    return { imported, cardIdByPackageId };
  }

  private importReviewLogs(packageDb: Database.Database, includeScheduling: boolean, cardIdByPackageId: Map<number, string>) {
    if (!includeScheduling || !hasTable(packageDb, "revlog")) return 0;
    const rows = packageDb.prepare("SELECT * FROM revlog ORDER BY id").all() as any[];
    const insert = this.services.db.prepare(`
      INSERT OR IGNORE INTO review_logs (
        id, card_id, rating, elapsed_ms, reviewed_at, previous_state, next_state,
        scheduled_days, stability, difficulty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let imported = 0;
    for (const row of rows) {
      const mappedCardId = cardIdByPackageId.get(Number(row.cid));
      const card = (
        mappedCardId
          ? this.services.db.prepare("SELECT id, state, scheduled_days, stability, difficulty FROM cards WHERE id = ?").get(mappedCardId)
          : this.services.db.prepare("SELECT id, state, scheduled_days, stability, difficulty FROM cards WHERE anki_id = ?").get(row.cid)
      ) as { id: string; state: string; scheduled_days: number; stability: number; difficulty: number } | undefined;
      if (!card) continue;
      const scheduledDays = Math.max(0, Number(row.ivl) || card.scheduled_days || 0);
      const result = insert.run(
        `review_${card.id}_${row.id}`,
        card.id,
        ankiEaseToRating(row.ease),
        Math.max(0, Number(row.time) || 0),
        new Date(Number(row.id) || Date.now()).toISOString(),
        "review",
        card.state,
        scheduledDays,
        scheduledDays || card.stability || 0,
        card.difficulty || 0
      );
      if (result.changes > 0) imported += 1;
    }
    return imported;
  }

  private templateForImportedCard(noteTypeId: string, ord: number) {
    const existing = this.services.db
      .prepare("SELECT id FROM card_templates WHERE note_type_id = ? AND ord = ?")
      .get(noteTypeId, ord) as { id: string } | undefined;
    if (existing) return existing;

    const base = this.services.db
      .prepare(
        `SELECT name, question_format, answer_format
         FROM card_templates
         WHERE note_type_id = ? AND ord = 0`
      )
      .get(noteTypeId) as
      | {
          name: string;
          question_format: string;
          answer_format: string;
        }
      | undefined;
    if (!base || !isClozeTemplate(base.question_format, base.answer_format)) return null;

    const templateId = id("template");
    this.services.db
      .prepare("INSERT INTO card_templates (id, note_type_id, ord, name, question_format, answer_format) VALUES (?, ?, ?, ?, ?, ?)")
      .run(templateId, noteTypeId, ord, `Cloze ${ord + 1}`, base.question_format, base.answer_format);
    return { id: templateId };
  }

  private readImportedModelFields() {
    const rows = this.services.db
      .prepare(
        `SELECT note_fields.note_type_id, note_fields.name
         FROM note_fields
         ORDER BY note_fields.note_type_id, note_fields.ord`
      )
      .all() as Array<{ note_type_id: string; name: string }>;
    const fields: Record<string, string[]> = {};
    for (const row of rows) {
      fields[row.note_type_id] ??= [];
      fields[row.note_type_id].push(row.name);
    }
    return fields;
  }
}

interface PackageFormat {
  version: number;
  zstdMedia: boolean;
}

interface ImportedMediaEntry {
  zipName: string;
  originalName: string;
  size: number | null;
  sha1: Buffer | null;
}

interface ParsedMediaEntry {
  name: string;
  legacyZipFilename: number | null;
  size: number | null;
  sha1: Buffer | null;
}

interface MediaEntryForExport {
  name: string;
  size: number;
  sha1: Buffer;
}

async function readPackageFormat(zip: JSZip): Promise<PackageFormat> {
  const metaFile = zip.file("meta");
  const version = metaFile ? parsePackageMetadata(await metaFile.async("nodebuffer")) : 0;
  return {
    version,
    zstdMedia: version >= 2 || Boolean(zip.file("collection.anki21b"))
  };
}

async function readMediaMap(mediaFile: JSZip.JSZipObject, packageFormat: PackageFormat): Promise<ImportedMediaEntry[]> {
  const buffer = await mediaFile.async("nodebuffer");
  if (packageFormat.zstdMedia) {
    try {
      const entries = parseMediaEntries(zstdDecompressSync(buffer));
      return entries.map((entry, index) => ({
        zipName: String(entry.legacyZipFilename ?? index),
        originalName: entry.name,
        size: entry.size,
        sha1: entry.sha1
      }));
    } catch (error) {
      throw new Error(`Unable to read compressed media map: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const mediaMap = parseJson<Record<string, string>>(buffer.toString("utf8"), {});
  return Object.entries(mediaMap).map(([zipName, originalName]) => ({ zipName, originalName, size: null, sha1: null }));
}

function parsePackageMetadata(buffer: Buffer) {
  let offset = 0;
  let version = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 7;
    if (fieldNumber === 1 && wireType === 0) {
      const parsed = readVarint(buffer, offset);
      version = parsed.value;
      offset = parsed.offset;
    } else {
      offset = skipProtobufField(buffer, offset, wireType);
    }
  }
  return version;
}

function parseMediaEntries(buffer: Buffer) {
  const entries: ParsedMediaEntry[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 7;
    if (fieldNumber === 1 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + length.value;
      entries.push(parseMediaEntry(buffer.subarray(offset, end)));
      offset = end;
    } else {
      offset = skipProtobufField(buffer, offset, wireType);
    }
  }
  return entries;
}

function parseMediaEntry(buffer: Buffer): ParsedMediaEntry {
  let offset = 0;
  let name = "";
  let legacyZipFilename: number | null = null;
  let size: number | null = null;
  let sha1: Buffer | null = null;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 7;
    if (fieldNumber === 1 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      name = buffer.subarray(offset, offset + length.value).toString("utf8");
      offset += length.value;
    } else if (fieldNumber === 255 && wireType === 0) {
      const parsed = readVarint(buffer, offset);
      legacyZipFilename = parsed.value;
      offset = parsed.offset;
    } else if (fieldNumber === 2 && wireType === 0) {
      const parsed = readVarint(buffer, offset);
      size = parsed.value;
      offset = parsed.offset;
    } else if (fieldNumber === 3 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      sha1 = Buffer.from(buffer.subarray(offset, offset + length.value));
      offset += length.value;
    } else {
      offset = skipProtobufField(buffer, offset, wireType);
    }
  }
  return { name, legacyZipFilename, size, sha1 };
}

function validateImportedMedia(entry: ImportedMediaEntry, buffer: Buffer) {
  if (entry.size !== null && buffer.byteLength !== entry.size) {
    throw new Error(`Imported media ${entry.originalName} size mismatch`);
  }
  if (entry.sha1?.length) {
    const digest = createHash("sha1").update(buffer).digest();
    if (!digest.equals(entry.sha1)) {
      throw new Error(`Imported media ${entry.originalName} checksum mismatch`);
    }
  }
}

function normalizeAnkiTags(tags: string | string[]) {
  const values = Array.isArray(tags) ? tags : String(tags ?? "").trim().split(/\s+/);
  return [...new Set(values.map((tag) => tag.trim()).filter(Boolean))].sort();
}

function storedTagsMatch(tagsJson: string, tags: string[]) {
  return JSON.stringify(normalizeAnkiTags(parseJson<string[]>(tagsJson, []))) === JSON.stringify(tags);
}

function readVarint(buffer: Buffer, offset: number) {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    value += (byte & 0x7f) * 2 ** shift;
    cursor += 1;
    if ((byte & 0x80) === 0) return { value, offset: cursor };
    shift += 7;
    if (shift > 35) throw new Error("Varint is too large");
  }
  throw new Error("Unexpected end of protobuf varint");
}

function skipProtobufField(buffer: Buffer, offset: number, wireType: number) {
  if (wireType === 0) return readVarint(buffer, offset).offset;
  if (wireType === 1) return offset + 8;
  if (wireType === 2) {
    const length = readVarint(buffer, offset);
    return length.offset + length.value;
  }
  if (wireType === 5) return offset + 4;
  throw new Error(`Unsupported protobuf wire type: ${wireType}`);
}

function encodePackageMetadata(version: number) {
  return Buffer.concat([encodeVarint((1 << 3) | 0), encodeVarint(version)]);
}

function encodeMediaEntries(entries: MediaEntryForExport[]) {
  return Buffer.concat(entries.map((entry) => encodeLengthDelimitedField(1, encodeMediaEntry(entry))));
}

function encodeMediaEntry(entry: MediaEntryForExport) {
  return Buffer.concat([
    encodeLengthDelimitedField(1, Buffer.from(entry.name, "utf8")),
    encodeVarintField(2, entry.size),
    encodeLengthDelimitedField(3, entry.sha1)
  ]);
}

function encodeLengthDelimitedField(fieldNumber: number, value: Buffer) {
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 2), encodeVarint(value.byteLength), value]);
}

function encodeVarintField(fieldNumber: number, value: number) {
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 0), encodeVarint(value)]);
}

function encodeVarint(value: number) {
  const bytes = [];
  let remaining = value >>> 0;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

function createCompatibilityCollection() {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-compat-"));
  const collectionPath = join(tempDir, "collection.anki2");
  const db = new Database(collectionPath);
  try {
    createExportSchema(db);
    const exportedAt = Math.floor(Date.now() / 1000);
    const deckId = 1;
    const modelId = 1;
    const noteId = numericId();
    const cardId = numericId();
    const message = "Please update to the latest Anki version, then import the .colpkg/.apkg file again.";
    const model = {
      [modelId]: {
        id: modelId,
        name: "Basic",
        type: 0,
        mod: exportedAt,
        usn: -1,
        sortf: 0,
        did: null,
        css: ".card { font-family: sans-serif; font-size: 20px; }",
        flds: [
          { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20 },
          { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 }
        ],
        tmpls: [
          {
            name: "Card 1",
            ord: 0,
            qfmt: "{{Front}}",
            afmt: "{{FrontSide}}<hr>{{Back}}",
            did: null,
            bqfmt: "",
            bafmt: ""
          }
        ],
        latexPre: "",
        latexPost: "",
        req: [[0, "any", [0]]]
      }
    };
    const decks = {
      [deckId]: {
        id: deckId,
        name: "Default",
        mod: exportedAt,
        usn: -1,
        desc: "",
        dyn: 0,
        collapsed: false,
        extendNew: 0,
        extendRev: 0,
        conf: 1
      }
    };
    db.prepare(
      `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
       VALUES (1, ?, ?, ?, 11, 0, -1, 0, '{}', ?, ?, '{}', '{}')`
    ).run(exportedAt, exportedAt, exportedAt * 1000, JSON.stringify(model), JSON.stringify(decks));
    db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (?, ?, ?, ?, -1, '', ?, ?, ?, 0, '')`
    ).run(noteId, ankiGuid(), modelId, exportedAt, `${message}\x1f`, message, ankiChecksum(message));
    db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (?, ?, ?, 0, ?, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`
    ).run(cardId, noteId, deckId, exportedAt);
    db.close();
    return readFileSync(collectionPath);
  } finally {
    if (db.open) db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function hasTable(db: Database.Database, tableName: string) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function exportPackageFileName(name: string, options: ExportOptions) {
  return `${safeFileName(name)}.${options.legacySupport ? "apkg" : "colpkg"}`;
}

function exportDeckName(deck: DeckRecord, deckById: Map<string, DeckRecord>, seen = new Set<string>()): string {
  if (deck.name.includes("::")) return deck.name;
  if (!deck.parentId || seen.has(deck.id)) return deck.name;
  const parent = deckById.get(deck.parentId);
  if (!parent) return deck.name;
  const nextSeen = new Set(seen);
  nextSeen.add(deck.id);
  return `${exportDeckName(parent, deckById, nextSeen)}::${deck.name}`;
}

function parentDeckName(name: string) {
  const parts = name
    .split("::")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(0, -1).join("::");
}

function ancestorDeckNames(name: string) {
  const parts = name
    .split("::")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("::"));
}

function inferJlptLevel(name: string): JlptLevel {
  const match = name.toUpperCase().match(/(?:^|[^A-Z0-9])N([1-5])(?:[^A-Z0-9]|$)/);
  if (!match) return "mixed";
  return `N${match[1]}` as JlptLevel;
}

function availableDeckAnkiId(db: Database.Database) {
  let candidate = numericId();
  while (db.prepare("SELECT id FROM decks WHERE anki_id = ?").get(candidate)) {
    candidate = numericId();
  }
  return candidate;
}

function availableNoteTypeAnkiId(db: Database.Database) {
  let candidate = numericId();
  while (db.prepare("SELECT id FROM note_types WHERE anki_id = ?").get(candidate)) {
    candidate = numericId();
  }
  return candidate;
}

function availableCardAnkiId(db: Database.Database) {
  let candidate = numericId();
  while (db.prepare("SELECT id FROM cards WHERE anki_id = ?").get(candidate)) {
    candidate = numericId();
  }
  return candidate;
}

function availableNoteGuid(db: Database.Database) {
  let candidate = ankiGuid();
  while (db.prepare("SELECT id FROM notes WHERE anki_guid = ?").get(candidate)) {
    candidate = ankiGuid();
  }
  return candidate;
}

function importedModelMatchesNoteType(db: Database.Database, noteTypeId: string, model: any) {
  const existing = db.prepare("SELECT name FROM note_types WHERE id = ?").get(noteTypeId) as { name: string } | undefined;
  const modelName = String(model?.name ?? "");
  if (existing && modelName && existing.name !== modelName) return false;
  const importedFields = Array.isArray(model?.flds) ? model.flds : [];
  const importedFieldNameByOrd = new Map<number, string>();
  for (const field of importedFields) {
    const ord = Number(field?.ord) || 0;
    importedFieldNameByOrd.set(ord, field?.name ?? `Field ${ord}`);
  }
  const existingFields = db.prepare("SELECT ord, name FROM note_fields WHERE note_type_id = ? ORDER BY ord").all(noteTypeId) as Array<{
    ord: number;
    name: string;
  }>;
  for (const field of existingFields) {
    const importedName = importedFieldNameByOrd.get(field.ord);
    if (importedName !== undefined && importedName !== field.name) return false;
  }
  return true;
}

function sqlPlaceholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

function ankiEaseToRating(ease: unknown) {
  switch (Number(ease)) {
    case 1:
      return "Again";
    case 2:
      return "Hard";
    case 4:
      return "Easy";
    default:
      return "Good";
  }
}

function ratingToAnkiEase(rating: unknown) {
  switch (rating) {
    case "Again":
      return 1;
    case "Hard":
      return 2;
    case "Easy":
      return 4;
    default:
      return 3;
  }
}

function reviewLogAnkiId(reviewedAt: string, offset: number) {
  const time = new Date(reviewedAt).getTime();
  return (Number.isFinite(time) ? time : Date.now()) + offset;
}

function exportCardScheduling(card: any, includeScheduling: boolean) {
  if (!includeScheduling) {
    return { type: 0, queue: 0, due: 0, ivl: 0 };
  }
  if (card.state === "suspended") {
    const scheduledDays = Math.max(0, Number(card.scheduled_days) || 0);
    const type = scheduledDays > 0 || Number(card.reps) > 0 ? 2 : 0;
    return { type, queue: -1, due: scheduledDays, ivl: scheduledDays };
  }
  if (card.state === "review") {
    const scheduledDays = Math.max(1, Number(card.scheduled_days) || 1);
    return { type: 2, queue: 2, due: scheduledDays, ivl: scheduledDays };
  }
  if (card.state === "learning") {
    return { type: 1, queue: 1, due: exportLearningDue(card), ivl: 0 };
  }
  if (card.state === "relearning") {
    return { type: 3, queue: 1, due: exportLearningDue(card), ivl: Math.max(0, Number(card.scheduled_days) || 0) };
  }
  return { type: 0, queue: 0, due: 0, ivl: 0 };
}

function exportLearningDue(card: any) {
  const due = new Date(card.due_at).getTime();
  return Math.max(0, Math.floor((Number.isFinite(due) ? due : Date.now()) / 1000));
}

function createExportSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE col (
      id integer primary key, crt integer not null, mod integer not null, scm integer not null,
      ver integer not null, dty integer not null, usn integer not null, ls integer not null,
      conf text not null, models text not null, decks text not null, dconf text not null, tags text not null
    );
    CREATE TABLE notes (
      id integer primary key, guid text not null, mid integer not null, mod integer not null,
      usn integer not null, tags text not null, flds text not null, sfld integer not null,
      csum integer not null, flags integer not null, data text not null
    );
    CREATE TABLE cards (
      id integer primary key, nid integer not null, did integer not null, ord integer not null,
      mod integer not null, usn integer not null, type integer not null, queue integer not null,
      due integer not null, ivl integer not null, factor integer not null, reps integer not null,
      lapses integer not null, left integer not null, odue integer not null, odid integer not null,
      flags integer not null, data text not null
    );
    CREATE TABLE revlog (
      id integer primary key, cid integer not null, usn integer not null, ease integer not null,
      ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null,
      type integer not null
    );
    CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
  `);
}

function buildExportModelJson(db: Database.Database, noteTypeIds: string[], exportedAt: number) {
  const models: Record<string, any> = {};
  const selectFields = db.prepare("SELECT ord, name FROM note_fields WHERE note_type_id = ? ORDER BY ord");
  const selectTemplates = db.prepare(
    "SELECT ord, name, question_format, answer_format FROM card_templates WHERE note_type_id = ? ORDER BY ord"
  );
  for (const noteTypeId of noteTypeIds) {
    const row = db.prepare("SELECT * FROM note_types WHERE id = ?").get(noteTypeId) as any;
    if (!row) continue;
    const raw = parseJson<Record<string, any> | null>(row.raw_json, null);
    const fields = selectFields.all(noteTypeId) as Array<{ ord: number; name: string }>;
    const templates = selectTemplates.all(noteTypeId) as Array<{
      ord: number;
      name: string;
      question_format: string;
      answer_format: string;
    }>;
    const rawFields = Array.isArray(raw?.flds) ? raw.flds : [];
    const rawTemplates = Array.isArray(raw?.tmpls) ? raw.tmpls : [];
    const model = {
      ...(raw ?? {}),
      id: row.anki_id,
      name: row.name,
      type: raw?.type ?? 0,
      mod: exportedAt,
      usn: -1,
      sortf: raw?.sortf ?? 0,
      did: raw?.did ?? null,
      css: row.css || raw?.css || ".card { font-family: sans-serif; font-size: 20px; }",
      flds: fields.map((field) => {
        const rawField = rawFields.find((candidate: any) => candidate?.ord === field.ord);
        return {
          ...(rawField ?? {}),
          name: field.name,
          ord: field.ord,
          sticky: rawField?.sticky ?? false,
          rtl: rawField?.rtl ?? false,
          font: rawField?.font ?? "Arial",
          size: rawField?.size ?? 20
        };
      }),
      tmpls: templates.map((template) => {
        const rawTemplate = rawTemplates.find((candidate: any) => candidate?.ord === template.ord);
        return {
          ...(rawTemplate ?? {}),
          name: template.name,
          ord: template.ord,
          qfmt: template.question_format,
          afmt: template.answer_format,
          did: rawTemplate?.did ?? null,
          bqfmt: rawTemplate?.bqfmt ?? "",
          bafmt: rawTemplate?.bafmt ?? ""
        };
      }),
      latexPre: raw?.latexPre ?? "",
      latexPost: raw?.latexPost ?? "",
      req: raw?.req ?? templates.map((template) => [template.ord, "any", [0]])
    };
    models[String(row.anki_id)] = model;
  }
  return models;
}

function isClozeTemplate(questionFormat: string, answerFormat: string) {
  return `${questionFormat}\n${answerFormat}`.includes("{{cloze:");
}

function rewriteMediaReferences(value: string, mediaReferences: Map<string, string>) {
  if (mediaReferences.size === 0) return value;
  return value
    .replace(/\[sound:([^\]]+)\]/g, (match, name) => `[sound:${mediaReferences.get(name) ?? name}]`)
    .replace(/(<img[^>]+src=["'])([^"']+)(["'])/gi, (match, prefix, name, suffix) => `${prefix}${mediaReferences.get(name) ?? name}${suffix}`);
}

function importedCardScheduling(row: any, includeScheduling: boolean, importedAt: Date) {
  if (!includeScheduling) {
    return {
      state: "new",
      dueAt: importedAt.toISOString(),
      stability: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0
    };
  }
  if (Number(row.queue) === -1) {
    return {
      state: "suspended",
      dueAt: importedAt.toISOString(),
      stability: Math.max(0, Number(row.ivl) || 0),
      scheduledDays: Math.max(0, Number(row.ivl) || 0),
      reps: Math.max(0, Number(row.reps) || 0),
      lapses: Math.max(0, Number(row.lapses) || 0)
    };
  }
  if (row.type === 3) {
    const scheduledDays = Math.max(0, Number(row.ivl) || 0);
    return {
      state: "relearning",
      dueAt: importedLearningDueAt(row, importedAt),
      stability: scheduledDays,
      scheduledDays,
      reps: Math.max(0, Number(row.reps) || 0),
      lapses: Math.max(0, Number(row.lapses) || 0)
    };
  }
  if (row.type === 1 || row.queue === 1 || row.queue === 3) {
    return {
      state: "learning",
      dueAt: importedLearningDueAt(row, importedAt),
      stability: 0,
      scheduledDays: 0,
      reps: Math.max(0, Number(row.reps) || 0),
      lapses: Math.max(0, Number(row.lapses) || 0)
    };
  }
  if (row.type !== 2) {
    return {
      state: "new",
      dueAt: importedAt.toISOString(),
      stability: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0
    };
  }
  const scheduledDays = Math.max(1, Number(row.ivl) || 1);
  const dueAt = new Date(importedAt);
  dueAt.setDate(dueAt.getDate() + scheduledDays);
  return {
    state: "review",
    dueAt: dueAt.toISOString(),
    stability: scheduledDays,
    scheduledDays,
    reps: Math.max(0, Number(row.reps) || 0),
    lapses: Math.max(0, Number(row.lapses) || 0)
  };
}

function importedLearningDueAt(row: any, importedAt: Date) {
  const due = Number(row.due);
  if (!Number.isFinite(due) || due <= 0) return importedAt.toISOString();
  if (Number(row.queue) === 3) {
    const dueAt = new Date(importedAt);
    dueAt.setDate(dueAt.getDate() + Math.max(0, due));
    return dueAt.toISOString();
  }
  return new Date(due * 1000).toISOString();
}

function mimeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".avif")) return "image/avif";
  return "application/octet-stream";
}
