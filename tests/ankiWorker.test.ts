import { describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { makeTestServer } from "./helpers/server";
import { AnkiPackageWorker } from "../src/server/anki/worker";
import { createJapaneseNote } from "../src/server/cards/service";

describe("Anki package worker", () => {
  test("exports a deck to apkg and imports it back without scheduling by default", async () => {
    const server = makeTestServer();
    const deck = server.services.decks.createDeck({ name: "Exported Japanese", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "発音",
        Reading: "はつおん",
        MeaningZh: "发音",
        MeaningEn: "pronunciation",
        MeaningJa: "音を出すこと",
        Example: "発音を練習します。",
        PitchAccent: "0"
      },
      tags: ["pronunciation"]
    });

    const worker = new AnkiPackageWorker(server.services);
    const exported = await worker.exportDeck(deck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });

    const targetServer = makeTestServer();
    const imported = await new AnkiPackageWorker(targetServer.services).importPackage(exported.buffer, {
      sourceUrl: "https://example.com/export.apkg",
      includeScheduling: false
    });

    expect(imported.notesImported).toBeGreaterThanOrEqual(1);
    expect(imported.cardsImported).toBeGreaterThanOrEqual(1);
  });

  test("exports a parent deck with child deck cards and hierarchy", async () => {
    const server = makeTestServer();
    const parentDeck = server.services.decks.createDeck({ name: "Japanese", jlptLevel: "N4" });
    const vocabularyDeck = server.services.decks.createDeck({ name: "Vocabulary", parentId: parentDeck.id, jlptLevel: "N4" });
    const grammarDeck = server.services.decks.createDeck({ name: "Grammar", parentId: parentDeck.id, jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: vocabularyDeck.id,
      fields: {
        Expression: "発音",
        Reading: "はつおん",
        MeaningZh: "发音"
      },
      tags: ["vocabulary"]
    });
    createJapaneseNote(server.services.db, {
      deckId: grammarDeck.id,
      fields: {
        Expression: "なら",
        Reading: "なら",
        MeaningZh: "如果"
      },
      tags: ["grammar"]
    });

    const exported = await new AnkiPackageWorker(server.services).exportDeck(parentDeck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });
    const targetServer = makeTestServer();
    const imported = await new AnkiPackageWorker(targetServer.services).importPackage(exported.buffer, {
      sourceUrl: "https://example.com/parent-tree.apkg",
      includeScheduling: false
    });
    const importedDecks = targetServer.services.decks.listDecks();
    const importedParent = importedDecks.find((deck) => deck.name === "Japanese");
    const importedVocabulary = importedDecks.find((deck) => deck.name === "Japanese::Vocabulary");
    const importedGrammar = importedDecks.find((deck) => deck.name === "Japanese::Grammar");

    expect(imported.notesImported).toBe(2);
    expect(imported.cardsImported).toBe(2);
    expect(importedParent).toBeDefined();
    expect(importedVocabulary?.parentId).toBe(importedParent!.id);
    expect(importedGrammar?.parentId).toBe(importedParent!.id);
  });

  test("does not duplicate local cards when an exported deck is imported back into the same collection", async () => {
    const server = makeTestServer();
    const deck = server.services.decks.createDeck({ name: "Round Trip Local", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "語彙",
        Reading: "ごい",
        MeaningZh: "词汇",
        MeaningEn: "vocabulary",
        MeaningJa: "言葉の集まり",
        Example: "語彙を増やします。"
      },
      tags: ["vocabulary"]
    });

    const worker = new AnkiPackageWorker(server.services);
    const exported = await worker.exportDeck(deck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });
    const imported = await worker.importPackage(exported.buffer, {
      sourceUrl: "https://example.com/round-trip-local.apkg",
      includeScheduling: false
    });
    const cards = server.services.db.prepare("SELECT * FROM cards WHERE deck_id = ?").all(deck.id);

    expect(imported.notesImported).toBe(0);
    expect(imported.cardsImported).toBe(0);
    expect(cards).toHaveLength(1);
  });

  test("keeps different package decks separate when their Anki deck ids collide", async () => {
    const server = makeTestServer();
    const worker = new AnkiPackageWorker(server.services);

    await worker.importPackage(
      await buildDeckIdCollisionApkg({
        deckName: "Collision Vocabulary",
        guid: "collision-vocabulary-guid",
        noteId: 111111111,
        cardId: 222222222,
        fields: "語彙\x1fvocabulary"
      }),
      {
        sourceUrl: "https://example.com/collision-vocabulary.apkg",
        includeScheduling: false
      }
    );
    const secondImport = await worker.importPackage(
      await buildDeckIdCollisionApkg({
        deckName: "Collision Grammar",
        guid: "collision-grammar-guid",
        noteId: 333333333,
        cardId: 444444444,
        fields: "文法\x1fgrammar"
      }),
      {
        sourceUrl: "https://example.com/collision-grammar.apkg",
        includeScheduling: false
      }
    );

    const decks = server.services.decks.listDecks();
    const vocabularyDeck = decks.find((deck) => deck.name === "Collision Vocabulary");
    const grammarDeck = decks.find((deck) => deck.name === "Collision Grammar");
    const grammarCards = grammarDeck
      ? (server.services.db
          .prepare(
            `SELECT notes.fields_json
             FROM cards
             JOIN notes ON notes.id = cards.note_id
             WHERE cards.deck_id = ?`
          )
          .all(grammarDeck.id) as Array<{ fields_json: string }>)
      : [];

    expect(secondImport.notesImported).toBe(1);
    expect(secondImport.cardsImported).toBe(1);
    expect(vocabularyDeck).toBeDefined();
    expect(grammarDeck).toBeDefined();
    expect(grammarDeck?.id).not.toBe(vocabularyDeck?.id);
    expect(grammarCards.map((card) => JSON.parse(card.fields_json).Front)).toEqual(["文法"]);
  });

  test("keeps different package note types separate when their Anki model ids collide", async () => {
    const server = makeTestServer();
    const worker = new AnkiPackageWorker(server.services);

    await worker.importPackage(
      await buildNoteTypeIdCollisionApkg({
        modelName: "Collision Basic",
        deckId: 52525252,
        deckName: "Collision Basic Deck",
        guid: "collision-basic-guid",
        noteId: 121212121,
        cardId: 232323232,
        fields: "語彙\x1fvocabulary"
      }),
      {
        sourceUrl: "https://example.com/collision-basic.apkg",
        includeScheduling: false
      }
    );
    const secondImport = await worker.importPackage(
      await buildNoteTypeIdCollisionApkg({
        modelName: "Collision Rich",
        deckId: 62626262,
        deckName: "Collision Rich Deck",
        guid: "collision-rich-guid",
        noteId: 343434343,
        cardId: 454545454,
        fields: "文法\x1fgrammar\x1fcontrastive",
        fieldNames: ["Term", "Definition", "Hint"]
      }),
      {
        sourceUrl: "https://example.com/collision-rich.apkg",
        includeScheduling: false
      }
    );

    const noteTypes = server.services.db.prepare("SELECT id, name FROM note_types ORDER BY name").all() as Array<{ id: string; name: string }>;
    const basicType = noteTypes.find((noteType) => noteType.name === "Collision Basic");
    const richType = noteTypes.find((noteType) => noteType.name === "Collision Rich");
    const richNote = server.services.db.prepare("SELECT note_type_id, fields_json FROM notes WHERE anki_guid = ?").get("collision-rich-guid") as
      | { note_type_id: string; fields_json: string }
      | undefined;

    expect(secondImport.notesImported).toBe(1);
    expect(secondImport.cardsImported).toBe(1);
    expect(basicType).toBeDefined();
    expect(richType).toBeDefined();
    expect(richType?.id).not.toBe(basicType?.id);
    expect(richNote?.note_type_id).toBe(richType?.id);
    expect(JSON.parse(richNote?.fields_json ?? "{}")).toEqual({
      Term: "文法",
      Definition: "grammar",
      Hint: "contrastive"
    });
  });

  test("keeps different package cards when their Anki card ids collide", async () => {
    const server = makeTestServer();
    const worker = new AnkiPackageWorker(server.services);

    await worker.importPackage(
      await buildCardIdCollisionApkg({
        modelId: 818181811,
        deckId: 818181812,
        deckName: "Card Collision Vocabulary",
        guid: "card-collision-vocabulary-guid",
        noteId: 818181813,
        fields: "語彙\x1fvocabulary"
      }),
      {
        sourceUrl: "https://example.com/card-collision-vocabulary.apkg",
        includeScheduling: false
      }
    );
    const secondImport = await worker.importPackage(
      await buildCardIdCollisionApkg({
        modelId: 828282821,
        deckId: 828282822,
        deckName: "Card Collision Grammar",
        guid: "card-collision-grammar-guid",
        noteId: 828282823,
        fields: "文法\x1fgrammar"
      }),
      {
        sourceUrl: "https://example.com/card-collision-grammar.apkg",
        includeScheduling: false
      }
    );

    const grammarDeck = server.services.decks.listDecks().find((deck) => deck.name === "Card Collision Grammar");
    const grammarCards = grammarDeck
      ? (server.services.db
          .prepare(
            `SELECT cards.anki_id, notes.fields_json
             FROM cards
             JOIN notes ON notes.id = cards.note_id
             WHERE cards.deck_id = ?`
          )
          .all(grammarDeck.id) as Array<{ anki_id: number; fields_json: string }>)
      : [];

    expect(secondImport.notesImported).toBe(1);
    expect(secondImport.cardsImported).toBe(1);
    expect(grammarCards.map((card) => JSON.parse(card.fields_json).Front)).toEqual(["文法"]);
    expect(grammarCards[0]?.anki_id).not.toBe(929292929);
  });

  test("keeps different package notes when their Anki GUIDs collide", async () => {
    const server = makeTestServer();
    const worker = new AnkiPackageWorker(server.services);

    await worker.importPackage(
      await buildNoteGuidCollisionApkg({
        modelId: 939393931,
        deckId: 939393932,
        deckName: "GUID Collision Vocabulary",
        noteId: 939393933,
        cardId: 939393934,
        fields: "語彙\x1fvocabulary"
      }),
      {
        sourceUrl: "https://example.com/guid-collision-vocabulary.apkg",
        includeScheduling: false
      }
    );
    const secondImport = await worker.importPackage(
      await buildNoteGuidCollisionApkg({
        modelId: 949494941,
        deckId: 949494942,
        deckName: "GUID Collision Grammar",
        noteId: 949494943,
        cardId: 949494944,
        fields: "文法\x1fgrammar"
      }),
      {
        sourceUrl: "https://example.com/guid-collision-grammar.apkg",
        includeScheduling: false
      }
    );

    const grammarDeck = server.services.decks.listDecks().find((deck) => deck.name === "GUID Collision Grammar");
    const grammarCards = grammarDeck
      ? (server.services.db
          .prepare(
            `SELECT notes.anki_guid, notes.fields_json
             FROM cards
             JOIN notes ON notes.id = cards.note_id
             WHERE cards.deck_id = ?`
          )
          .all(grammarDeck.id) as Array<{ anki_guid: string; fields_json: string }>)
      : [];

    expect(secondImport.notesImported).toBe(1);
    expect(secondImport.cardsImported).toBe(1);
    expect(grammarCards.map((card) => JSON.parse(card.fields_json).Front)).toEqual(["文法"]);
    expect(grammarCards[0]?.anki_guid).not.toBe("shared-note-guid");
  });

  test("does not duplicate a GUID-collided package when it is imported again", async () => {
    const server = makeTestServer();
    const worker = new AnkiPackageWorker(server.services);
    const vocabularyPackage = await buildNoteGuidCollisionApkg({
      modelId: 959595951,
      deckId: 959595952,
      deckName: "Repeated GUID Vocabulary",
      noteId: 959595953,
      cardId: 959595954,
      fields: "語彙\x1fvocabulary"
    });
    const grammarPackage = await buildNoteGuidCollisionApkg({
      modelId: 969696961,
      deckId: 969696962,
      deckName: "Repeated GUID Grammar",
      noteId: 969696963,
      cardId: 969696964,
      fields: "文法\x1fgrammar"
    });

    await worker.importPackage(vocabularyPackage, {
      sourceUrl: "https://example.com/repeated-guid-vocabulary.apkg",
      includeScheduling: false
    });
    await worker.importPackage(grammarPackage, {
      sourceUrl: "https://example.com/repeated-guid-grammar.apkg",
      includeScheduling: false
    });
    const repeatedImport = await worker.importPackage(grammarPackage, {
      sourceUrl: "https://example.com/repeated-guid-grammar.apkg",
      includeScheduling: false
    });

    const grammarDeck = server.services.decks.listDecks().find((deck) => deck.name === "Repeated GUID Grammar");
    const grammarCards = grammarDeck
      ? (server.services.db
          .prepare(
            `SELECT notes.fields_json
             FROM cards
             JOIN notes ON notes.id = cards.note_id
             WHERE cards.deck_id = ?`
          )
          .all(grammarDeck.id) as Array<{ fields_json: string }>)
      : [];

    expect(repeatedImport.notesImported).toBe(0);
    expect(repeatedImport.cardsImported).toBe(0);
    expect(grammarCards.map((card) => JSON.parse(card.fields_json).Front)).toEqual(["文法"]);
  });

  test("keeps same-GUID package notes separate when they belong to different decks", async () => {
    const server = makeTestServer();
    const worker = new AnkiPackageWorker(server.services);
    const sharedFields = "共有\x1fshared";

    await worker.importPackage(
      await buildNoteGuidCollisionApkg({
        modelId: 979797971,
        modelName: "Shared GUID Basic",
        deckId: 979797972,
        deckName: "Shared GUID Vocabulary",
        noteId: 979797973,
        cardId: 979797974,
        fields: sharedFields
      }),
      {
        sourceUrl: "https://example.com/shared-guid-vocabulary.apkg",
        includeScheduling: false
      }
    );
    const secondImport = await worker.importPackage(
      await buildNoteGuidCollisionApkg({
        modelId: 979797971,
        modelName: "Shared GUID Basic",
        deckId: 989898982,
        deckName: "Shared GUID Grammar",
        noteId: 989898983,
        cardId: 989898984,
        fields: sharedFields
      }),
      {
        sourceUrl: "https://example.com/shared-guid-grammar.apkg",
        includeScheduling: false
      }
    );

    const grammarDeck = server.services.decks.listDecks().find((deck) => deck.name === "Shared GUID Grammar");
    const grammarNotes = grammarDeck
      ? (server.services.db
          .prepare(
            `SELECT notes.anki_guid, notes.source_id, notes.fields_json
             FROM notes
             WHERE notes.deck_id = ?`
          )
          .all(grammarDeck.id) as Array<{ anki_guid: string; source_id: string; fields_json: string }>)
      : [];

    expect(secondImport.notesImported).toBe(1);
    expect(secondImport.cardsImported).toBe(1);
    expect(grammarNotes.map((note) => JSON.parse(note.fields_json).Front)).toEqual(["共有"]);
    expect(grammarNotes[0]?.anki_guid).not.toBe("shared-note-guid");
    expect(grammarNotes[0]?.source_id).toBe(secondImport.sourceId);
  });

  test("does not duplicate imported notes when Anki tags are reordered", async () => {
    const server = makeTestServer();
    const worker = new AnkiPackageWorker(server.services);
    const sharedFields = "語順\x1ftag order";

    await worker.importPackage(
      await buildNoteGuidCollisionApkg({
        modelId: 999191911,
        modelName: "Tag Order Basic",
        deckId: 999191912,
        deckName: "Tag Order",
        noteId: 999191913,
        cardId: 999191914,
        fields: sharedFields,
        tags: ["jlpt-n4", "grammar"]
      }),
      {
        sourceUrl: "https://example.com/tag-order-a.apkg",
        includeScheduling: false
      }
    );
    const secondImport = await worker.importPackage(
      await buildNoteGuidCollisionApkg({
        modelId: 999191911,
        modelName: "Tag Order Basic",
        deckId: 999191912,
        deckName: "Tag Order",
        noteId: 999191913,
        cardId: 999191914,
        fields: sharedFields,
        tags: ["grammar", "jlpt-n4"]
      }),
      {
        sourceUrl: "https://example.com/tag-order-b.apkg",
        includeScheduling: false
      }
    );

    const importedDeck = server.services.decks.listDecks().find((deck) => deck.name === "Tag Order");
    const notes = importedDeck
      ? (server.services.db.prepare("SELECT fields_json, tags_json FROM notes WHERE deck_id = ?").all(importedDeck.id) as Array<{
          fields_json: string;
          tags_json: string;
        }>)
      : [];
    const cards = importedDeck ? server.services.db.prepare("SELECT id FROM cards WHERE deck_id = ?").all(importedDeck.id) : [];

    expect(secondImport.notesImported).toBe(0);
    expect(secondImport.cardsImported).toBe(0);
    expect(notes.map((note) => JSON.parse(note.fields_json).Front)).toEqual(["語順"]);
    expect(cards).toHaveLength(1);
  });

  test("exports referenced audio media and imports it into the media library", async () => {
    const server = makeTestServer();
    const deck = server.services.decks.createDeck({ name: "Media Japanese", jlptLevel: "N4" });
    const mediaPath = join(server.services.mediaDir, "hatsuon.mp3");
    writeFileSync(mediaPath, Buffer.from("fake mp3 bytes"));
    server.services.db
      .prepare(
        `INSERT INTO media_assets (id, file_name, original_name, mime_type, path, checksum, source_id, created_at)
         VALUES ('media_test_audio', 'hatsuon.mp3', 'hatsuon.mp3', 'audio/mpeg', ?, 'media-test-checksum', NULL, '2026-05-17T00:00:00.000Z')`
      )
      .run(mediaPath);

    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "発音",
        Reading: "はつおん",
        MeaningZh: "发音",
        MeaningEn: "pronunciation",
        MeaningJa: "音を出すこと",
        Example: "発音を練習します。",
        PitchAccent: "0",
        Audio: "[sound:hatsuon.mp3]"
      },
      tags: ["pronunciation"]
    });

    const exported = await new AnkiPackageWorker(server.services).exportDeck(deck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });
    const zip = await JSZip.loadAsync(exported.buffer);
    const mediaMap = JSON.parse(await zip.file("media")!.async("text"));
    expect(Object.values(mediaMap)).toContain("hatsuon.mp3");

    const targetServer = makeTestServer();
    const imported = await new AnkiPackageWorker(targetServer.services).importPackage(exported.buffer, {
      sourceUrl: "https://example.com/media.apkg",
      includeScheduling: false
    });
    const assets = targetServer.services.db.prepare("SELECT * FROM media_assets WHERE original_name = 'hatsuon.mp3'").all();

    expect(imported.mediaImported).toBe(1);
    expect(assets).toHaveLength(1);
  });

  test("does not count duplicate media when the same package is imported again", async () => {
    const sourceServer = makeTestServer();
    const deck = sourceServer.services.decks.createDeck({ name: "Duplicate Media Japanese", jlptLevel: "N4" });
    const mediaPath = join(sourceServer.services.mediaDir, "duplicate-hatsuon.mp3");
    writeFileSync(mediaPath, Buffer.from("fake duplicate mp3 bytes"));
    sourceServer.services.db
      .prepare(
        `INSERT INTO media_assets (id, file_name, original_name, mime_type, path, checksum, source_id, created_at)
         VALUES ('media_duplicate_audio', 'duplicate-hatsuon.mp3', 'duplicate-hatsuon.mp3', 'audio/mpeg', ?, 'media-duplicate-checksum', NULL, '2026-05-17T00:00:00.000Z')`
      )
      .run(mediaPath);
    createJapaneseNote(sourceServer.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "発音",
        Reading: "はつおん",
        MeaningZh: "发音",
        MeaningEn: "pronunciation",
        MeaningJa: "音を出すこと",
        Example: "発音を練習します。",
        PitchAccent: "0",
        Audio: "[sound:duplicate-hatsuon.mp3]"
      },
      tags: ["pronunciation"]
    });

    const exported = await new AnkiPackageWorker(sourceServer.services).exportDeck(deck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });

    const targetServer = makeTestServer();
    const worker = new AnkiPackageWorker(targetServer.services);
    const firstImport = await worker.importPackage(exported.buffer, {
      sourceUrl: "https://example.com/duplicate-media.apkg",
      includeScheduling: false
    });
    const secondImport = await worker.importPackage(exported.buffer, {
      sourceUrl: "https://example.com/duplicate-media.apkg",
      includeScheduling: false
    });
    const assets = targetServer.services.db
      .prepare("SELECT * FROM media_assets WHERE original_name = 'duplicate-hatsuon.mp3'")
      .all();

    expect(firstImport.mediaImported).toBe(1);
    expect(secondImport.mediaImported).toBe(0);
    expect(assets).toHaveLength(1);
  });

  test("rewrites duplicate media references to the existing local file name", async () => {
    const server = makeTestServer();
    const existingPath = join(server.services.mediaDir, "existing-audio.mp3");
    const mediaBytes = Buffer.from("same audio bytes");
    writeFileSync(existingPath, mediaBytes);
    server.services.db
      .prepare(
        `INSERT INTO media_assets (id, file_name, original_name, mime_type, path, checksum, source_id, created_at)
         VALUES ('media_existing_alias_source', 'existing-audio.mp3', 'existing-audio.mp3', 'audio/mpeg', ?, ?, NULL, '2026-05-17T00:00:00.000Z')`
      )
      .run(existingPath, createHash("sha1").update(mediaBytes).digest("hex"));
    const sourcePackage = await buildMediaAliasApkg("alias-audio.mp3", mediaBytes);

    const imported = await new AnkiPackageWorker(server.services).importPackage(sourcePackage, {
      sourceUrl: "https://example.com/media-alias.apkg",
      includeScheduling: false
    });
    const note = server.services.db.prepare("SELECT fields_json FROM notes WHERE anki_guid = 'media-alias-guid'").get() as any;
    const aliasAsset = server.services.db
      .prepare("SELECT * FROM media_assets WHERE original_name = 'alias-audio.mp3'")
      .get();

    expect(imported.mediaImported).toBe(0);
    expect(JSON.parse(note.fields_json).Back).toBe("[sound:existing-audio.mp3]");
    expect(aliasAsset).toBeUndefined();
  });

  test("exports a modern compressed package when legacy support is disabled", async () => {
    const server = makeTestServer();
    const deck = server.services.decks.createDeck({ name: "Modern Export", jlptLevel: "N3" });
    const mediaPath = join(server.services.mediaDir, "modern-export.mp3");
    writeFileSync(mediaPath, Buffer.from("modern export media bytes"));
    server.services.db
      .prepare(
        `INSERT INTO media_assets (id, file_name, original_name, mime_type, path, checksum, source_id, created_at)
         VALUES ('media_modern_export', 'modern-export.mp3', 'modern-export.mp3', 'audio/mpeg', ?, 'modern-export-checksum', NULL, '2026-05-17T00:00:00.000Z')`
      )
      .run(mediaPath);
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "文法",
        Reading: "ぶんぽう",
        MeaningZh: "语法",
        MeaningEn: "grammar",
        MeaningJa: "文のルール",
        Example: "文法を勉強します。",
        Audio: "[sound:modern-export.mp3]"
      }
    });

    const exported = await new AnkiPackageWorker(server.services).exportDeck(deck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: false
    });
    const zip = await JSZip.loadAsync(exported.buffer);

    expect(exported.fileName).toBe("Modern Export.colpkg");
    expect(zip.file("meta")).toBeTruthy();
    expect(zip.file("collection.anki21b")).toBeTruthy();
    expect(zip.file("collection.anki21")).toBeNull();
    expect(zip.file("collection.anki2")).toBeTruthy();
    const collection = zstdDecompressSync(await zip.file("collection.anki21b")!.async("nodebuffer"));
    expect(collection.byteLength).toBeGreaterThan(0);
    const mediaMap = zstdDecompressSync(await zip.file("media")!.async("nodebuffer"));
    expect(mediaMap.toString("utf8")).toContain("modern-export.mp3");
    const mediaBytes = zstdDecompressSync(await zip.file("0")!.async("nodebuffer"));
    expect(mediaBytes).toEqual(Buffer.from("modern export media bytes"));
  });

  test("imports compressed collection.anki21b before an older compatibility placeholder", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const sourcePackage = await buildCompressedModernApkgWithPlaceholder();

    const imported = await new AnkiPackageWorker(server.services).importPackage(sourcePackage, {
      sourceUrl: "https://example.com/modern.apkg",
      includeScheduling: false
    });

    expect(imported.notesImported).toBe(1);
    expect(imported.cardsImported).toBe(1);
    const importedDeck = server.services.decks.listDecks().find((deck) => deck.name === "Compressed Modern");
    expect(importedDeck).toBeDefined();
    const cards = await server.request(`/api/cards?deckId=${importedDeck!.id}`, { headers: { cookie: auth.cookie } });
    const payload = await cards.json();
    expect(payload.cards).toHaveLength(1);
    expect(payload.cards[0].fields.Front).toBe("圧縮");
    expect(payload.cards[0].fields.Back).toBe("compressed");
    expect(server.services.decks.listDecks().some((deck) => deck.name === "Compatibility Placeholder")).toBe(false);
  });

  test("creates missing parent decks from imported Anki hierarchical deck names", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const sourcePackage = await buildChildOnlyDeckApkg();

    const imported = await new AnkiPackageWorker(server.services).importPackage(sourcePackage, {
      sourceUrl: "https://example.com/child-only.apkg",
      includeScheduling: false
    });
    const decks = server.services.decks.listDecks();
    const parentDeck = decks.find((deck) => deck.name === "Japanese");
    const childDeck = decks.find((deck) => deck.name === "Japanese::Vocabulary");

    expect(imported.notesImported).toBe(1);
    expect(imported.cardsImported).toBe(1);
    expect(parentDeck).toBeDefined();
    expect(childDeck?.parentId).toBe(parentDeck!.id);

    const cards = await server.request(`/api/cards?deckId=${parentDeck!.id}`, { headers: { cookie: auth.cookie } });
    const payload = await cards.json();
    expect(payload.cards).toHaveLength(1);
    expect(payload.cards[0].fields.Front).toBe("語彙");
  });

  test("infers JLPT level from imported Anki deck names", async () => {
    const server = makeTestServer();
    const sourcePackage = await buildNamedDeckApkg("JLPT N4::Vocabulary");

    const imported = await new AnkiPackageWorker(server.services).importPackage(sourcePackage, {
      sourceUrl: "https://example.com/jlpt-n4-vocabulary.apkg",
      includeScheduling: false
    });
    const decks = server.services.decks.listDecks();
    const parentDeck = decks.find((deck) => deck.name === "JLPT N4");
    const childDeck = decks.find((deck) => deck.name === "JLPT N4::Vocabulary");

    expect(imported.notesImported).toBe(1);
    expect(imported.cardsImported).toBe(1);
    expect(parentDeck?.jlptLevel).toBe("N4");
    expect(childDeck?.jlptLevel).toBe("N4");
  });

  test("rolls back database rows when package import fails after notes are staged", async () => {
    const server = makeTestServer();
    const sourcePackage = await buildMalformedRevlogApkg();

    await expect(
      new AnkiPackageWorker(server.services).importPackage(sourcePackage, {
        sourceUrl: "https://example.com/malformed-revlog.apkg",
        includeScheduling: true
      })
    ).rejects.toThrow(/revlog|id/i);

    expect(server.services.db.prepare("SELECT id FROM sources WHERE url = 'https://example.com/malformed-revlog.apkg'").get()).toBeUndefined();
    expect(server.services.decks.listDecks().some((deck) => deck.name === "Malformed Revlog")).toBe(false);
    expect(server.services.db.prepare("SELECT id FROM note_types WHERE name = 'Malformed Revlog Model'").get()).toBeUndefined();
    expect(server.services.db.prepare("SELECT id FROM notes WHERE anki_guid = 'malformed-revlog-guid'").get()).toBeUndefined();
    expect(server.services.db.prepare("SELECT id FROM cards WHERE anki_id = 9701").get()).toBeUndefined();
  });

  test("imports zstd-compressed media from modern packages", async () => {
    const server = makeTestServer();
    const sourcePackage = await buildCompressedModernApkgWithPlaceholder([
      { name: "modern-audio.mp3", data: Buffer.from("modern compressed media bytes") }
    ]);

    const imported = await new AnkiPackageWorker(server.services).importPackage(sourcePackage, {
      sourceUrl: "https://example.com/modern-media.apkg",
      includeScheduling: false
    });
    const assets = server.services.db.prepare("SELECT * FROM media_assets WHERE original_name = 'modern-audio.mp3'").all() as any[];

    expect(imported.mediaImported).toBe(1);
    expect(assets).toHaveLength(1);
    expect(readFileSync(assets[0].path)).toEqual(Buffer.from("modern compressed media bytes"));
  });

  test("rejects tampered zstd-compressed media from modern packages", async () => {
    const server = makeTestServer();
    const sourcePackage = await buildCompressedModernApkgWithPlaceholder([
      { name: "modern-audio.mp3", data: Buffer.from("declared modern media bytes") }
    ]);
    const zip = await JSZip.loadAsync(sourcePackage);
    zip.file("0", zstdCompressSync(Buffer.from("tampered media bytes")));
    const tamperedPackage = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    await expect(
      new AnkiPackageWorker(server.services).importPackage(tamperedPackage, {
        sourceUrl: "https://example.com/tampered-modern-media.apkg",
        includeScheduling: false
      })
    ).rejects.toThrow(/media .*mismatch/i);
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM media_assets").get()).toEqual({ count: 0 });
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM sources").get()).toEqual({ count: 0 });
  });

  test("preserves safe raster media MIME types from imported packages", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const sourcePackage = await buildMediaAliasApkg("pitch.webp", Buffer.from("webp bytes"));

    const imported = await new AnkiPackageWorker(server.services).importPackage(sourcePackage, {
      sourceUrl: "https://example.com/webp-media.apkg",
      includeScheduling: false
    });
    const asset = server.services.db.prepare("SELECT * FROM media_assets WHERE original_name = 'pitch.webp'").get() as any;
    const media = await server.request("/media/pitch.webp", { headers: { cookie: auth.cookie } });

    expect(imported.mediaImported).toBe(1);
    expect(asset.mime_type).toBe("image/webp");
    expect(media.headers.get("content-type")).toBe("image/webp");
    expect(media.headers.get("x-content-type-options")).toBe("nosniff");
    expect(media.headers.get("content-disposition")).toBeNull();
    expect(Buffer.from(await media.arrayBuffer())).toEqual(Buffer.from("webp bytes"));
  });

  test("re-exports imported custom note type fields and templates", async () => {
    const server = makeTestServer();
    const sourcePackage = await buildCustomApkg();
    await new AnkiPackageWorker(server.services).importPackage(sourcePackage, {
      sourceUrl: "https://example.com/custom.apkg",
      includeScheduling: false
    });

    const importedDeck = server.services.decks.listDecks().find((deck) => deck.name === "Imported Custom");
    expect(importedDeck).toBeDefined();
    const auth = await login(server);
    const importedCardsResponse = await server.request(`/api/cards?deckId=${importedDeck!.id}`, { headers: { cookie: auth.cookie } });
    const importedCards = await importedCardsResponse.json();
    expect(importedCards.cards[0]).toMatchObject({
      noteType: { name: "Custom Japanese" },
      template: { name: "Card 1", ord: 0 },
      fieldNames: ["Front", "Back"]
    });

    const exported = await new AnkiPackageWorker(server.services).exportDeck(importedDeck!.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });

    const tempDir = mkdtempSync(join(tmpdir(), "anki-reexport-test-"));
    try {
      const zip = await JSZip.loadAsync(exported.buffer);
      const collectionPath = join(tempDir, "collection.anki2");
      writeFileSync(collectionPath, await zip.file("collection.anki2")!.async("nodebuffer"));
      const exportedDb = new Database(collectionPath, { readonly: true });
      const col = exportedDb.prepare("SELECT models FROM col LIMIT 1").get() as any;
      const models = JSON.parse(col.models);
      const note = exportedDb.prepare("SELECT * FROM notes LIMIT 1").get() as any;
      const model = models[String(note.mid)];

      expect(model.name).toBe("Custom Japanese");
      expect(model.flds.map((field: any) => field.name)).toEqual(["Front", "Back"]);
      expect(model.tmpls[0].qfmt).toBe("<div>{{Front}}</div>");
      expect(model.tmpls[0].afmt).toBe("{{FrontSide}}<hr>{{Back}}");
      expect(note.flds).toBe("表\x1f裏");
      exportedDb.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("imports Anki cloze cards and renders each cloze ordinal", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const sourcePackage = await buildClozeApkg();
    const imported = await new AnkiPackageWorker(server.services).importPackage(sourcePackage, {
      sourceUrl: "https://example.com/cloze.apkg",
      includeScheduling: false
    });

    expect(imported.notesImported).toBe(1);
    expect(imported.cardsImported).toBe(2);

    const importedDeck = server.services.decks.listDecks().find((deck) => deck.name === "Imported Cloze");
    expect(importedDeck).toBeDefined();
    const cards = (await server.request(`/api/cards?deckId=${importedDeck!.id}`, { headers: { cookie: auth.cookie } })).json();
    const payload = await cards;

    expect(payload.cards).toHaveLength(2);
    const questions = payload.cards.map((card: any) => card.question).join("\n---\n");
    expect(questions).toContain("[...]で勉強します");
    expect(questions).toContain("学校で[...]します");
  });

  test("adds missing templates when an existing imported note type evolves", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const firstPackage = await buildEvolvingTemplateApkg({
      guid: "evolving-template-guid-1",
      noteId: 9101,
      cardBaseId: 9201,
      includeRecallTemplate: false
    });
    const secondPackage = await buildEvolvingTemplateApkg({
      guid: "evolving-template-guid-2",
      noteId: 9102,
      cardBaseId: 9301,
      includeRecallTemplate: true
    });

    await new AnkiPackageWorker(server.services).importPackage(firstPackage, {
      sourceUrl: "https://example.com/evolving-v1.apkg",
      includeScheduling: false
    });
    const imported = await new AnkiPackageWorker(server.services).importPackage(secondPackage, {
      sourceUrl: "https://example.com/evolving-v2.apkg",
      includeScheduling: false
    });

    expect(imported.notesImported).toBe(1);
    expect(imported.cardsImported).toBe(2);

    const importedDeck = server.services.decks.listDecks().find((deck) => deck.name === "Evolving Templates");
    expect(importedDeck).toBeDefined();
    const cards = await server.request(`/api/cards?deckId=${importedDeck!.id}`, { headers: { cookie: auth.cookie } });
    const payload = await cards.json();
    const secondNoteCards = payload.cards.filter((card: any) => card.fields.Front === "二枚目");
    expect(secondNoteCards.map((card: any) => card.template.name).sort()).toEqual(["Card 1", "Recall"]);
    expect(secondNoteCards.find((card: any) => card.template.name === "Recall").question).toContain("second");
  });

  test("creates a safe default template when an imported model has no templates", async () => {
    const sourcePackage = await buildNoTemplateApkg();
    const server = makeTestServer();
    const auth = await login(server);

    const imported = await new AnkiPackageWorker(server.services).importPackage(sourcePackage, {
      sourceUrl: "https://example.com/no-template.apkg",
      includeScheduling: false
    });

    expect(imported.notesImported).toBe(1);
    expect(imported.cardsImported).toBe(1);
    const importedDeck = server.services.decks.listDecks().find((deck) => deck.name === "No Template Import");
    expect(importedDeck).toBeDefined();
    const cards = await server.request(`/api/cards?deckId=${importedDeck!.id}`, { headers: { cookie: auth.cookie } });
    const payload = await cards.json();
    expect(payload.cards).toHaveLength(1);
    expect(payload.cards[0].question).toContain("表");
    expect(payload.cards[0].answer).toContain("裏");
    expect(payload.cards[0].template.name).toBe("Card 1");
  });

  test("strips scheduling by default and preserves it when explicitly imported", async () => {
    const sourcePackage = await buildScheduledApkg();
    const strippedServer = makeTestServer();
    await new AnkiPackageWorker(strippedServer.services).importPackage(sourcePackage, {
      sourceUrl: "https://example.com/scheduled.apkg",
      includeScheduling: false
    });
    const stripped = strippedServer.services.db.prepare("SELECT * FROM cards WHERE anki_id = 422").get() as any;
    expect(stripped.state).toBe("new");
    expect(stripped.scheduled_days).toBe(0);
    expect(stripped.reps).toBe(0);
    expect(stripped.lapses).toBe(0);
    const strippedLogs = strippedServer.services.db.prepare("SELECT COUNT(*) AS count FROM review_logs").get() as { count: number };
    expect(strippedLogs.count).toBe(0);

    const preservedServer = makeTestServer();
    const beforeImport = Date.now();
    await new AnkiPackageWorker(preservedServer.services).importPackage(sourcePackage, {
      sourceUrl: "https://example.com/scheduled.apkg",
      includeScheduling: true
    });
    const preserved = preservedServer.services.db.prepare("SELECT * FROM cards WHERE anki_id = 422").get() as any;
    const preservedSuspended = preservedServer.services.db.prepare("SELECT * FROM cards WHERE anki_id = 424").get() as any;
    const preservedSuspendedNew = preservedServer.services.db.prepare("SELECT * FROM cards WHERE anki_id = 426").get() as any;
    const preservedLearning = preservedServer.services.db.prepare("SELECT * FROM cards WHERE anki_id = 428").get() as any;
    const preservedRelearning = preservedServer.services.db.prepare("SELECT * FROM cards WHERE anki_id = 430").get() as any;
    const dueAt = new Date(preserved.due_at).getTime();

    expect(preserved.state).toBe("review");
    expect(preserved.queue).toBe("review");
    expect(preserved.scheduled_days).toBe(17);
    expect(preserved.reps).toBe(9);
    expect(preserved.lapses).toBe(2);
    expect(dueAt).toBeGreaterThanOrEqual(beforeImport + 16 * 24 * 60 * 60 * 1000);
    const preservedLog = preservedServer.services.db.prepare("SELECT * FROM review_logs WHERE card_id = ?").get(preserved.id) as any;
    expect(preservedLog).toMatchObject({
      rating: "Good",
      elapsed_ms: 4200,
      previous_state: "review",
      next_state: "review",
      scheduled_days: 17
    });
    expect(preservedSuspended).toMatchObject({
      state: "suspended",
      queue: "suspended",
      reps: 4,
      lapses: 1
    });
    expect(preservedSuspendedNew).toMatchObject({
      state: "suspended",
      queue: "suspended",
      reps: 0,
      lapses: 0
    });
    expect(preservedLearning).toMatchObject({
      state: "learning",
      queue: "learning",
      reps: 2,
      lapses: 0
    });
    expect(preservedRelearning).toMatchObject({
      state: "relearning",
      queue: "relearning",
      reps: 7,
      lapses: 2
    });

    const importedDeck = preservedServer.services.decks.listDecks().find((deck) => deck.name === "Scheduled Import");
    const exported = await new AnkiPackageWorker(preservedServer.services).exportDeck(importedDeck!.id, {
      includeMedia: true,
      includeScheduling: true,
      legacySupport: true
    });
    const tempDir = mkdtempSync(join(tmpdir(), "anki-scheduled-reexport-"));
    try {
      const zip = await JSZip.loadAsync(exported.buffer);
      const collectionPath = join(tempDir, "collection.anki2");
      writeFileSync(collectionPath, await zip.file("collection.anki2")!.async("nodebuffer"));
      const exportedDb = new Database(collectionPath, { readonly: true });
      const revlogs = exportedDb.prepare("SELECT * FROM revlog").all() as any[];
      expect(revlogs).toHaveLength(1);
      expect(revlogs[0]).toMatchObject({ ease: 3, ivl: 17, time: 4200 });
      const exportedSuspended = exportedDb
        .prepare(
          `SELECT cards.*
           FROM cards
           JOIN notes ON notes.id = cards.nid
           WHERE notes.flds LIKE '停止%'`
        )
        .get() as any;
      expect(exportedSuspended).toMatchObject({ type: 2, queue: -1, reps: 4, lapses: 1 });
      const exportedLearning = exportedDb
        .prepare(
          `SELECT cards.*
           FROM cards
           JOIN notes ON notes.id = cards.nid
           WHERE notes.flds LIKE '学習%'`
        )
        .get() as any;
      const exportedRelearning = exportedDb
        .prepare(
          `SELECT cards.*
           FROM cards
           JOIN notes ON notes.id = cards.nid
           WHERE notes.flds LIKE '再学習%'`
        )
        .get() as any;
      expect(exportedLearning).toMatchObject({ type: 1, queue: 1, reps: 2, lapses: 0 });
      expect(exportedRelearning).toMatchObject({ type: 3, queue: 1, reps: 7, lapses: 2 });
      exportedDb.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("exports same-timestamp review logs for different cards with unique Anki ids", async () => {
    const server = makeTestServer();
    const deck = server.services.decks.createDeck({ name: "Same Timestamp Reviews", jlptLevel: "N4" });
    const firstNote = createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "語彙",
        Reading: "ごい",
        MeaningZh: "词汇"
      },
      tags: ["review"]
    });
    const secondNote = createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "文法",
        Reading: "ぶんぽう",
        MeaningZh: "语法"
      },
      tags: ["review"]
    });
    const reviewedAt = "2026-05-20T02:00:00.000Z";

    for (const card of [firstNote.cards[0], secondNote.cards[0]]) {
      server.services.db
        .prepare("UPDATE cards SET state = 'review', queue = 'review', scheduled_days = 5, reps = 1, updated_at = ? WHERE id = ?")
        .run(reviewedAt, card.id);
      server.services.db
        .prepare(
          `INSERT INTO review_logs (
            id, card_id, rating, elapsed_ms, reviewed_at, previous_state, next_state,
            scheduled_days, stability, difficulty
          ) VALUES (?, ?, 'Good', 2500, ?, 'new', 'review', 5, 1, 1)`
        )
        .run(`review_${card.id}`, card.id, reviewedAt);
    }

    const exported = await new AnkiPackageWorker(server.services).exportDeck(deck.id, {
      includeMedia: true,
      includeScheduling: true,
      legacySupport: true
    });
    const tempDir = mkdtempSync(join(tmpdir(), "anki-same-timestamp-revlog-export-"));
    try {
      const zip = await JSZip.loadAsync(exported.buffer);
      const collectionPath = join(tempDir, "collection.anki2");
      writeFileSync(collectionPath, await zip.file("collection.anki2")!.async("nodebuffer"));
      const exportedDb = new Database(collectionPath, { readonly: true });
      const revlogs = exportedDb.prepare("SELECT id, cid FROM revlog ORDER BY cid").all() as Array<{ id: number; cid: number }>;
      exportedDb.close();

      expect(revlogs).toHaveLength(2);
      expect(new Set(revlogs.map((log) => log.id)).size).toBe(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

async function login(server: ReturnType<typeof makeTestServer>) {
  const response = await server.request("/api/session/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "secret" })
  });
  return { cookie: response.headers.get("set-cookie") ?? "" };
}

async function buildCompressedModernApkgWithPlaceholder(mediaEntries: Array<{ name: string; data: Buffer }> = []) {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-modern-compressed-source-"));
  try {
    const realCollectionPath = join(tempDir, "collection.anki21");
    const placeholderCollectionPath = join(tempDir, "collection.anki2");
    createSimpleAnkiCollection(realCollectionPath, {
      modelId: 1357913579,
      deckId: 246802468,
      deckName: "Compressed Modern",
      modelName: "Modern Japanese",
      noteId: 1357,
      cardId: 2468,
      guid: "compressed-guid",
      fields: "圧縮\x1fcompressed"
    });
    createSimpleAnkiCollection(placeholderCollectionPath, {
      modelId: 975319753,
      deckId: 864208642,
      deckName: "Compatibility Placeholder",
      modelName: "Placeholder",
      noteId: 9753,
      cardId: 8642,
      guid: "placeholder-guid",
      fields: "Please update Anki\x1fThis placeholder should not be imported"
    });

    const zip = new JSZip();
    zip.file("meta", encodePackageMetadata(3));
    zip.file("collection.anki21b", zstdCompressSync(readFileSync(realCollectionPath)));
    zip.file("collection.anki2", readFileSync(placeholderCollectionPath));
    zip.file(
      "media",
      zstdCompressSync(
        encodeMediaEntries(
          mediaEntries.map((entry) => ({
            name: entry.name,
            size: entry.data.byteLength,
            sha1: createHash("sha1").update(entry.data).digest()
          }))
        )
      )
    );
    mediaEntries.forEach((entry, index) => {
      zip.file(String(index), zstdCompressSync(entry.data));
    });
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildMediaAliasApkg(mediaName: string, data: Buffer) {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-media-alias-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    createSimpleAnkiCollection(collectionPath, {
      modelId: 1010101010,
      deckId: 202020202,
      deckName: "Media Alias Import",
      modelName: "Media Alias",
      noteId: 303030303,
      cardId: 404040404,
      guid: "media-alias-guid",
      fields: `音声\x1f[sound:${mediaName}]`
    });

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", JSON.stringify({ "0": mediaName }));
    zip.file("0", data);
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildChildOnlyDeckApkg() {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-child-only-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    createSimpleAnkiCollection(collectionPath, {
      modelId: 505050505,
      deckId: 606060606,
      deckName: "Japanese::Vocabulary",
      modelName: "Child Only Japanese",
      noteId: 707070707,
      cardId: 808080808,
      guid: "child-only-guid",
      fields: "語彙\x1fvocabulary"
    });

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildNamedDeckApkg(deckName: string) {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-named-deck-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    createSimpleAnkiCollection(collectionPath, {
      modelId: 515151515,
      deckId: 616161616,
      deckName,
      modelName: "Named Deck Japanese",
      noteId: 717171717,
      cardId: 818181818,
      guid: "named-deck-guid",
      fields: "文法\x1fgrammar"
    });

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildDeckIdCollisionApkg(input: { deckName: string; guid: string; noteId: number; cardId: number; fields: string }) {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-deck-id-collision-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    createSimpleAnkiCollection(collectionPath, {
      modelId: 919191919,
      deckId: 42424242,
      deckName: input.deckName,
      modelName: "Deck Id Collision Japanese",
      noteId: input.noteId,
      cardId: input.cardId,
      guid: input.guid,
      fields: input.fields
    });

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildNoteTypeIdCollisionApkg(input: {
  modelName: string;
  deckId: number;
  deckName: string;
  guid: string;
  noteId: number;
  cardId: number;
  fields: string;
  fieldNames?: string[];
}) {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-note-type-id-collision-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    createSimpleAnkiCollection(collectionPath, {
      modelId: 737373737,
      deckId: input.deckId,
      deckName: input.deckName,
      modelName: input.modelName,
      noteId: input.noteId,
      cardId: input.cardId,
      guid: input.guid,
      fields: input.fields,
      fieldNames: input.fieldNames
    });

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildCardIdCollisionApkg(input: {
  modelId: number;
  deckId: number;
  deckName: string;
  guid: string;
  noteId: number;
  fields: string;
}) {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-card-id-collision-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    createSimpleAnkiCollection(collectionPath, {
      modelId: input.modelId,
      deckId: input.deckId,
      deckName: input.deckName,
      modelName: input.deckName,
      noteId: input.noteId,
      cardId: 929292929,
      guid: input.guid,
      fields: input.fields
    });

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildNoteGuidCollisionApkg(input: {
  modelId: number;
  modelName?: string;
  deckId: number;
  deckName: string;
  noteId: number;
  cardId: number;
  fields: string;
  tags?: string[];
}) {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-note-guid-collision-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    createSimpleAnkiCollection(collectionPath, {
      modelId: input.modelId,
      deckId: input.deckId,
      deckName: input.deckName,
      modelName: input.modelName ?? input.deckName,
      noteId: input.noteId,
      cardId: input.cardId,
      guid: "shared-note-guid",
      fields: input.fields,
      tags: input.tags
    });

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildEvolvingTemplateApkg(input: { guid: string; noteId: number; cardBaseId: number; includeRecallTemplate: boolean }) {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-evolving-template-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    const templates = [
      { name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr>{{Back}}" },
      ...(input.includeRecallTemplate ? [{ name: "Recall", ord: 1, qfmt: "{{Back}}", afmt: "{{FrontSide}}<hr>{{Front}}" }] : [])
    ];
    createSimpleAnkiCollection(collectionPath, {
      modelId: 3141592653,
      deckId: 271828182,
      deckName: "Evolving Templates",
      modelName: "Evolving Japanese",
      noteId: input.noteId,
      cardId: input.cardBaseId,
      guid: input.guid,
      fields: input.includeRecallTemplate ? "二枚目\x1fsecond" : "一枚目\x1ffirst",
      templates,
      cardOrdinals: input.includeRecallTemplate ? [0, 1] : [0]
    });

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildMalformedRevlogApkg() {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-malformed-revlog-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    createSimpleAnkiCollection(collectionPath, {
      modelId: 1010101999,
      deckId: 202020299,
      deckName: "Malformed Revlog",
      modelName: "Malformed Revlog Model",
      noteId: 9601,
      cardId: 9701,
      guid: "malformed-revlog-guid",
      fields: "壊れた\x1fbroken"
    });
    const db = new Database(collectionPath);
    db.exec("DROP TABLE revlog; CREATE TABLE revlog (cid integer not null); INSERT INTO revlog (cid) VALUES (9701);");
    db.close();

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function encodePackageMetadata(version: number) {
  return Buffer.concat([encodeVarint((1 << 3) | 0), encodeVarint(version)]);
}

function encodeMediaEntries(entries: Array<{ name: string; size: number; sha1: Buffer }>) {
  return Buffer.concat(entries.map((entry) => encodeLengthDelimitedField(1, encodeMediaEntry(entry))));
}

function encodeMediaEntry(entry: { name: string; size: number; sha1: Buffer }) {
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

function createSimpleAnkiCollection(
  collectionPath: string,
  input: {
    modelId: number;
    deckId: number;
    deckName: string;
    modelName: string;
    noteId: number;
    cardId: number;
    guid: string;
    fields: string;
    fieldNames?: string[];
    templates?: Array<{ name: string; ord: number; qfmt: string; afmt: string }>;
    cardOrdinals?: number[];
    tags?: string[];
  }
) {
  const db = new Database(collectionPath);
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
  const fieldNames = input.fieldNames ?? ["Front", "Back"];
  const model = {
    [input.modelId]: {
      id: input.modelId,
      name: input.modelName,
      type: 0,
      mod: 1779000000,
      usn: -1,
      sortf: 0,
      did: null,
      css: ".card { font-family: sans-serif; }",
      flds: fieldNames.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20 })),
      tmpls: (
        input.templates ?? [
          {
            name: "Card 1",
            ord: 0,
            qfmt: `{{${fieldNames[0] ?? "Front"}}}`,
            afmt: `{{FrontSide}}<hr>{{${fieldNames[1] ?? fieldNames[0] ?? "Back"}}}`
          }
        ]
      ).map(
        (template) => ({
          name: template.name,
          ord: template.ord,
          qfmt: template.qfmt,
          afmt: template.afmt,
          did: null,
          bqfmt: "",
          bafmt: ""
        })
      ),
      latexPre: "",
      latexPost: "",
      req: [[0, "any", [0]]]
    }
  };
  const decks = {
    [input.deckId]: {
      id: input.deckId,
      name: input.deckName,
      mod: 1779000000,
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
     VALUES (1, 1779000000, 1779000000, 1779000000000, 11, 0, -1, 0, '{}', ?, ?, '{}', '{}')`
  ).run(JSON.stringify(model), JSON.stringify(decks));
  db.prepare(
    `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
     VALUES (?, ?, ?, 1779000000, -1, ?, ?, '', 0, 0, '')`
  ).run(input.noteId, input.guid, input.modelId, ` ${(input.tags ?? ["modern"]).join(" ")} `, input.fields);
  const insertCard = db.prepare(
    `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
     VALUES (?, ?, ?, ?, 1779000000, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`
  );
  (input.cardOrdinals ?? [0]).forEach((ord, index) => {
    insertCard.run(input.cardId + index, input.noteId, input.deckId, ord);
  });
  db.close();
}

async function buildCustomApkg() {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-custom-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    const db = new Database(collectionPath);
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
    const modelId = 1234567890;
    const deckId = 987654321;
    const model = {
      [modelId]: {
        id: modelId,
        name: "Custom Japanese",
        type: 0,
        mod: 1779000000,
        usn: -1,
        sortf: 0,
        did: null,
        css: ".card { font-family: sans-serif; }",
        flds: [
          { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20 },
          { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 }
        ],
        tmpls: [
          {
            name: "Card 1",
            ord: 0,
            qfmt: "<div>{{Front}}</div>",
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
        name: "Imported Custom",
        mod: 1779000000,
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
       VALUES (1, 1779000000, 1779000000, 1779000000000, 11, 0, -1, 0, '{}', ?, ?, '{}', '{}')`
    ).run(JSON.stringify(model), JSON.stringify(decks));
    db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (111, 'custom-guid', ?, 1779000000, -1, ' custom ', ?, '表', 0, 0, '')`
    ).run(modelId, "表\x1f裏");
    db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (222, 111, ?, 0, 1779000000, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`
    ).run(deckId);
    db.close();

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildClozeApkg() {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-cloze-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    const db = new Database(collectionPath);
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
    const modelId = 2222222222;
    const deckId = 333333333;
    const model = {
      [modelId]: {
        id: modelId,
        name: "Cloze Japanese",
        type: 1,
        mod: 1779000000,
        usn: -1,
        sortf: 0,
        did: null,
        css: ".card { font-family: sans-serif; }",
        flds: [
          { name: "Text", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20 },
          { name: "Back Extra", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 }
        ],
        tmpls: [
          {
            name: "Cloze",
            ord: 0,
            qfmt: "{{cloze:Text}}",
            afmt: "{{cloze:Text}}<hr>{{Back Extra}}",
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
        name: "Imported Cloze",
        mod: 1779000000,
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
       VALUES (1, 1779000000, 1779000000, 1779000000000, 11, 0, -1, 0, '{}', ?, ?, '{}', '{}')`
    ).run(JSON.stringify(model), JSON.stringify(decks));
    db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (211, 'cloze-guid', ?, 1779000000, -1, ' grammar ', ?, '今日は学校で勉強します。', 0, 0, '')`
    ).run(modelId, "今日は{{c1::学校}}で{{c2::勉強}}します。\x1f場所と動作");
    db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (?, 211, ?, ?, 1779000000, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`
    ).run(311, deckId, 0);
    db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (?, 211, ?, ?, 1779000000, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`
    ).run(312, deckId, 1);
    db.close();

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildScheduledApkg() {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-scheduled-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    const db = new Database(collectionPath);
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
    const modelId = 4444444444;
    const deckId = 555555555;
    const model = {
      [modelId]: {
        id: modelId,
        name: "Scheduled Japanese",
        type: 0,
        mod: 1779000000,
        usn: -1,
        sortf: 0,
        did: null,
        css: ".card { font-family: sans-serif; }",
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
        name: "Scheduled Import",
        mod: 1779000000,
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
       VALUES (1, 1779000000, 1779000000, 1779000000000, 11, 0, -1, 0, '{}', ?, ?, '{}', '{}')`
    ).run(JSON.stringify(model), JSON.stringify(decks));
    db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (421, 'scheduled-guid', ?, 1779000000, -1, ' review ', ?, '復習', 0, 0, '')`
    ).run(modelId, "復習\x1freview");
    db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (423, 'suspended-guid', ?, 1779000000, -1, ' suspended ', ?, '停止', 0, 0, '')`
    ).run(modelId, "停止\x1fsuspended");
    db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (425, 'suspended-new-guid', ?, 1779000000, -1, ' suspended ', ?, '新停止', 0, 0, '')`
    ).run(modelId, "新停止\x1fsuspended new");
    db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (427, 'learning-guid', ?, 1779000000, -1, ' learning ', ?, '学習', 0, 0, '')`
    ).run(modelId, "学習\x1flearning");
    db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (429, 'relearning-guid', ?, 1779000000, -1, ' relearning ', ?, '再学習', 0, 0, '')`
    ).run(modelId, "再学習\x1frelearning");
    db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (422, 421, ?, 0, 1779000000, -1, 2, 2, 19000, 17, 2500, 9, 2, 0, 0, 0, 0, '')`
    ).run(deckId);
    db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (424, 423, ?, 0, 1779000000, -1, 2, -1, 19000, 21, 2500, 4, 1, 0, 0, 0, 0, '')`
    ).run(deckId);
    db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (426, 425, ?, 0, 1779000000, -1, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`
    ).run(deckId);
    db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (428, 427, ?, 0, 1779000000, -1, 1, 1, 1779000600, 0, 0, 2, 0, 0, 0, 0, 0, '')`
    ).run(deckId);
    db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (430, 429, ?, 0, 1779000000, -1, 3, 1, 1779000600, 2, 2500, 7, 2, 0, 0, 0, 0, '')`
    ).run(deckId);
    db.prepare(
      `INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
       VALUES (1779000000123, 422, -1, 3, 17, 7, 2500, 4200, 1)`
    ).run();
    db.close();

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildNoTemplateApkg() {
  const tempDir = mkdtempSync(join(tmpdir(), "anki-no-template-source-"));
  try {
    const collectionPath = join(tempDir, "collection.anki2");
    const db = new Database(collectionPath);
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
    const modelId = 6666666666;
    const deckId = 777777777;
    const model = {
      [modelId]: {
        id: modelId,
        name: "No Template Japanese",
        type: 0,
        mod: 1779000000,
        usn: -1,
        sortf: 0,
        did: null,
        css: ".card { font-family: sans-serif; }",
        flds: [
          { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20 },
          { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 }
        ],
        tmpls: [],
        latexPre: "",
        latexPost: "",
        req: []
      }
    };
    const decks = {
      [deckId]: {
        id: deckId,
        name: "No Template Import",
        mod: 1779000000,
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
       VALUES (1, 1779000000, 1779000000, 1779000000000, 11, 0, -1, 0, '{}', ?, ?, '{}', '{}')`
    ).run(JSON.stringify(model), JSON.stringify(decks));
    db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (611, 'no-template-guid', ?, 1779000000, -1, ' fallback ', ?, '表', 0, 0, '')`
    ).run(modelId, "表\x1f裏");
    db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (622, 611, ?, 0, 1779000000, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`
    ).run(deckId);
    db.close();

    const zip = new JSZip();
    zip.file("collection.anki2", readFileSync(collectionPath));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
