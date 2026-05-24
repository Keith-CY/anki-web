import { describe, expect, test } from "vitest";
import { makeTestServer } from "./helpers/server";

async function login(server: ReturnType<typeof makeTestServer>) {
  const response = await server.request("/api/session/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "secret" })
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  const csrfToken = (await response.json()).csrfToken;
  return { cookie, csrfToken };
}

describe("daily management APIs", () => {
  test("creates child decks only under an existing parent deck", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);

    const parentResponse = await server.request("/api/decks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ name: "Japanese", jlptLevel: "N4" })
    });
    const parent = await parentResponse.json();

    const childResponse = await server.request("/api/decks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ name: "Vocabulary", jlptLevel: "N4", parentId: parent.id })
    });
    expect(childResponse.status).toBe(201);
    const child = await childResponse.json();
    expect(child.parentId).toBe(parent.id);

    const invalidChildResponse = await server.request("/api/decks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ name: "Orphan", jlptLevel: "N4", parentId: "deck_missing" })
    });
    expect(invalidChildResponse.status).toBe(404);
    await expect(invalidChildResponse.json()).resolves.toEqual({ error: "Parent deck not found" });
  });

  test("deleting a parent deck preserves child decks by promoting them to top level", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "Japanese", jlptLevel: "N4" });
    const childDeck = server.services.decks.createDeck({ name: "Vocabulary", parentId: parentDeck.id, jlptLevel: "N4" });

    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: childDeck.id,
        fields: { Expression: "発音", Reading: "はつおん", MeaningZh: "发音" },
        tags: ["vocabulary"]
      })
    });
    expect(cardResponse.status).toBe(201);

    const deleted = await server.request(`/api/decks/${parentDeck.id}`, {
      method: "DELETE",
      headers: { cookie, "x-csrf-token": csrfToken }
    });
    expect(deleted.status).toBe(200);

    const decks = await server.request("/api/decks", { headers: { cookie } });
    const payload = await decks.json();
    expect(payload.decks.find((deck: any) => deck.id === parentDeck.id)).toBeUndefined();
    expect(payload.decks.find((deck: any) => deck.id === childDeck.id)).toMatchObject({ parentId: null });

    const childCards = await server.request(`/api/cards?deckId=${childDeck.id}`, { headers: { cookie } });
    const childCardPayload = await childCards.json();
    expect(childCardPayload.cards).toHaveLength(1);
    expect(childCardPayload.cards[0].fields.Expression).toBe("発音");
  });

  test("reparents existing decks and rejects self or descendant parent cycles", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "Japanese", jlptLevel: "N4" });
    const vocabularyDeck = server.services.decks.createDeck({ name: "Vocabulary", jlptLevel: "N4" });
    const grammarDeck = server.services.decks.createDeck({ name: "Grammar", parentId: vocabularyDeck.id, jlptLevel: "N4" });

    const reparented = await server.request(`/api/decks/${vocabularyDeck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ parentId: parentDeck.id })
    });
    expect(reparented.status).toBe(200);
    await expect(reparented.json()).resolves.toMatchObject({ id: vocabularyDeck.id, parentId: parentDeck.id });

    const selfParent = await server.request(`/api/decks/${vocabularyDeck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ parentId: vocabularyDeck.id })
    });
    expect(selfParent.status).toBe(400);
    await expect(selfParent.json()).resolves.toEqual({ error: "Deck cannot be its own parent" });

    const cycle = await server.request(`/api/decks/${vocabularyDeck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ parentId: grammarDeck.id })
    });
    expect(cycle.status).toBe(400);
    await expect(cycle.json()).resolves.toEqual({ error: "Deck cannot be moved under one of its child decks" });

    const topLevel = await server.request(`/api/decks/${vocabularyDeck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ parentId: null })
    });
    expect(topLevel.status).toBe(200);
    await expect(topLevel.json()).resolves.toMatchObject({ id: vocabularyDeck.id, parentId: null });
  });

  test("updates deck metadata and edits then deletes a card", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);

    const deckResponse = await server.request("/api/decks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ name: "Starter", jlptLevel: "N5" })
    });
    const deck = await deckResponse.json();

    const renamedDeckResponse = await server.request(`/api/decks/${deck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ name: "日本語 Daily", jlptLevel: "N3", dailyNewLimit: 12, dailyReviewLimit: 80, fsrsRetention: 0.82 })
    });
    expect(renamedDeckResponse.status).toBe(200);
    const renamedDeck = await renamedDeckResponse.json();
    expect(renamedDeck.name).toBe("日本語 Daily");
    expect(renamedDeck.jlptLevel).toBe("N3");
    expect(renamedDeck.dailyNewLimit).toBe(12);
    expect(renamedDeck.fsrsRetention).toBe(0.82);

    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: { Expression: "古い", MeaningZh: "旧的" },
        tags: ["old"]
      })
    });
    const created = await cardResponse.json();

    const editResponse = await server.request(`/api/cards/${created.card.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        fields: { Expression: "新しい", Reading: "あたらしい", MeaningZh: "新的", PitchAccent: "4" },
        tags: ["N5", "edited"]
      })
    });
    expect(editResponse.status).toBe(200);
    const edited = await editResponse.json();
    expect(edited.card.fields.Expression).toBe("新しい");
    expect(edited.card.tags).toEqual(["N5", "edited"]);

    const deckDetail = await server.request(`/api/decks/${deck.id}`, { headers: { cookie } });
    expect(deckDetail.status).toBe(200);
    await expect(deckDetail.json()).resolves.toMatchObject({ id: deck.id, name: "日本語 Daily", jlptLevel: "N3" });

    const cardDetail = await server.request(`/api/cards/${created.card.id}`, { headers: { cookie } });
    expect(cardDetail.status).toBe(200);
    const cardDetailPayload = await cardDetail.json();
    expect(cardDetailPayload.card).toMatchObject({
      id: created.card.id,
      deckId: deck.id,
      fields: { Expression: "新しい", Reading: "あたらしい", MeaningZh: "新的" },
      tags: ["N5", "edited"]
    });

    const deleteResponse = await server.request(`/api/cards/${created.card.id}`, {
      method: "DELETE",
      headers: { cookie, "x-csrf-token": csrfToken }
    });
    expect(deleteResponse.status).toBe(200);

    const cardsResponse = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie } });
    const cards = await cardsResponse.json();
    expect(cards.cards).toHaveLength(0);
  });

  test("normalizes card tags on create and edit", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Tag Hygiene", jlptLevel: "N4" });

    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: { Expression: "発音", Reading: "はつおん", MeaningZh: "发音" },
        tags: ["  pronunciation  ", "", "N4", "JLPT N4", "pronunciation", "   "]
      })
    });

    expect(cardResponse.status).toBe(201);
    const created = await cardResponse.json();
    expect(created.card.tags).toEqual(["pronunciation", "N4", "JLPT_N4"]);

    const editResponse = await server.request(`/api/cards/${created.card.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        tags: [" grammar ", "N4 grammar", "grammar", ""]
      })
    });

    expect(editResponse.status).toBe(200);
    const edited = await editResponse.json();
    expect(edited.card.tags).toEqual(["grammar", "N4_grammar"]);

    const tagsResponse = await server.request(`/api/tags?deckId=${deck.id}`, { headers: { cookie } });
    const tagsPayload = await tagsResponse.json();
    expect(tagsPayload.tags.map((tag: any) => tag.name).sort()).toEqual(["N4_grammar", "grammar"]);
  });

  test("lists deck presets and applies one to a deck", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Preset Target", jlptLevel: "N4" });

    const presetsResponse = await server.request("/api/deck-presets", { headers: { cookie } });
    expect(presetsResponse.status).toBe(200);
    const presetsPayload = await presetsResponse.json();
    expect(presetsPayload.presets.map((preset: any) => preset.id)).toEqual([
      "preset_light",
      "preset_balanced",
      "preset_intensive"
    ]);

    const applyResponse = await server.request(`/api/decks/${deck.id}/apply-preset`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ presetId: "preset_intensive" })
    });

    expect(applyResponse.status).toBe(200);
    const applied = await applyResponse.json();
    expect(applied.preset).toMatchObject({
      id: "preset_intensive",
      dailyNewLimit: 40,
      dailyReviewLimit: 400,
      fsrsRetention: 0.92
    });
    expect(applied.deck).toMatchObject({
      id: deck.id,
      dailyNewLimit: 40,
      dailyReviewLimit: 400,
      fsrsRetention: 0.92
    });
  });

  test("moves a note and all sibling cards to another deck from card editing", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const sourceDeck = server.services.decks.createDeck({ name: "Source", jlptLevel: "N4" });
    const targetDeck = server.services.decks.createDeck({ name: "Target", jlptLevel: "N3" });
    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: sourceDeck.id,
        fields: {
          Expression: "移動",
          Reading: "いどう",
          MeaningZh: "移动"
        },
        tags: ["move"],
        createAllTemplates: true
      })
    });
    const created = await cardResponse.json();

    const moveResponse = await server.request(`/api/cards/${created.cards[0].id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: targetDeck.id,
        fields: { MeaningZh: "转移" },
        tags: ["moved"]
      })
    });

    expect(moveResponse.status).toBe(200);
    const moved = await moveResponse.json();
    expect(moved.card).toMatchObject({
      id: created.cards[0].id,
      noteId: created.noteId,
      deckId: targetDeck.id,
      tags: ["moved"]
    });
    expect(moved.card.fields.MeaningZh).toBe("转移");

    const sourceCards = await server.request(`/api/cards?deckId=${sourceDeck.id}`, { headers: { cookie } });
    const targetCards = await server.request(`/api/cards?deckId=${targetDeck.id}`, { headers: { cookie } });
    expect((await sourceCards.json()).cards).toHaveLength(0);
    expect((await targetCards.json()).cards.map((card: any) => card.deckId)).toEqual([
      targetDeck.id,
      targetDeck.id,
      targetDeck.id
    ]);
  });

  test("reads and updates a note with all sibling cards from the note endpoint", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const sourceDeck = server.services.decks.createDeck({ name: "Note Source", jlptLevel: "N4" });
    const targetDeck = server.services.decks.createDeck({ name: "Note Target", jlptLevel: "N3" });
    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: sourceDeck.id,
        fields: {
          Expression: "発音",
          Reading: "はつおん",
          MeaningZh: "发音"
        },
        tags: ["old-note"],
        createAllTemplates: true
      })
    });
    const created = await cardResponse.json();

    const detail = await server.request(`/api/notes/${created.noteId}`, { headers: { cookie } });
    expect(detail.status).toBe(200);
    const detailPayload = await detail.json();
    expect(detailPayload.note).toMatchObject({
      id: created.noteId,
      deckId: sourceDeck.id,
      fields: { Expression: "発音", Reading: "はつおん", MeaningZh: "发音" },
      tags: ["old-note"]
    });
    expect(detailPayload.note.cards).toHaveLength(created.cards.length);

    const update = await server.request(`/api/notes/${created.noteId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: targetDeck.id,
        fields: { MeaningZh: "发音；读音", PitchAccent: "0" },
        tags: ["N4", "pronunciation"]
      })
    });
    expect(update.status).toBe(200);
    const updated = await update.json();
    expect(updated.note).toMatchObject({
      id: created.noteId,
      deckId: targetDeck.id,
      fields: { Expression: "発音", Reading: "はつおん", MeaningZh: "发音；读音", PitchAccent: "0" },
      tags: ["N4", "pronunciation"]
    });
    expect(updated.note.cards).toHaveLength(created.cards.length);
    expect(updated.note.cards.every((card: any) => card.deckId === targetDeck.id)).toBe(true);

    const sourceCards = await server.request(`/api/cards?deckId=${sourceDeck.id}`, { headers: { cookie } });
    const targetCards = await server.request(`/api/cards?deckId=${targetDeck.id}`, { headers: { cookie } });
    expect((await sourceCards.json()).cards).toHaveLength(0);
    expect((await targetCards.json()).cards).toHaveLength(created.cards.length);
  });

  test("creates a note directly and returns generated cards", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Direct Notes", jlptLevel: "N4" });

    const response = await server.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: {
          Expression: "文法",
          Reading: "ぶんぽう",
          MeaningZh: "语法"
        },
        tags: ["grammar"],
        createAllTemplates: true
      })
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.note).toMatchObject({
      deckId: deck.id,
      fields: { Expression: "文法", Reading: "ぶんぽう", MeaningZh: "语法" },
      tags: ["grammar"]
    });
    expect(payload.note.cards).toHaveLength(3);

    const cards = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie } });
    expect((await cards.json()).cards).toHaveLength(3);
  });

  test("creates cards from a custom note type and all selected templates", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Custom Notes", jlptLevel: "mixed" });
    const css = ".card { color: rgb(20, 40, 60); } .reading { font-weight: 700; }";

    const noteTypeResponse = await server.request("/api/note-types", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        name: "Sentence Mining",
        css,
        fields: ["Sentence", "Reading", "Meaning"],
        templates: [
          {
            name: "Read",
            questionFormat: "<div>{{Sentence}}</div>",
            answerFormat: "{{FrontSide}}<hr>{{Reading}}<br>{{Meaning}}"
          },
          {
            name: "Recall",
            questionFormat: "<div>{{Meaning}}</div>",
            answerFormat: "{{FrontSide}}<hr>{{Sentence}}"
          }
        ]
      })
    });
    const noteType = (await noteTypeResponse.json()).noteType;

    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        noteTypeId: noteType.id,
        fields: {
          Sentence: "雨が降っています。",
          Reading: "あめがふっています。",
          Meaning: "It is raining."
        },
        tags: ["sentence-mining"],
        createAllTemplates: true
      })
    });

    expect(cardResponse.status).toBe(201);
    const created = await cardResponse.json();
    expect(created.cards).toHaveLength(2);
    expect(created.cards.map((card: any) => card.template.name)).toEqual(["Read", "Recall"]);
    expect(created.cards[0]).toMatchObject({
      deckId: deck.id,
      noteType: { id: noteType.id, name: "Sentence Mining", css },
      fieldNames: ["Sentence", "Reading", "Meaning"],
      fields: {
        Sentence: "雨が降っています。",
        Reading: "あめがふっています。",
        Meaning: "It is raining."
      },
      tags: ["sentence-mining"]
    });
    expect(created.cards[0].question).toContain("雨が降っています。");
    expect(created.cards[1].question).toContain("It is raining.");

    const cardDetail = await server.request(`/api/cards/${created.cards[0].id}`, { headers: { cookie } });
    expect((await cardDetail.json()).card.noteType.css).toBe(css);

    const cardList = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie } });
    const cardListPayload = await cardList.json();
    expect(cardListPayload.cards.map((card: any) => card.noteType.css)).toEqual([css, css]);

    const nextReview = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie } });
    expect((await nextReview.json()).card.noteType.css).toBe(css);

    const noteDetail = await server.request(`/api/notes/${created.noteId}`, { headers: { cookie } });
    const noteDetailPayload = await noteDetail.json();
    expect(noteDetailPayload.note.noteType.css).toBe(css);
    expect(noteDetailPayload.note.cards.map((card: any) => card.noteType.css)).toEqual([css, css]);

    const detail = await server.request(`/api/note-types/${noteType.id}`, { headers: { cookie } });
    expect(detail.status).toBe(200);
    const detailPayload = await detail.json();
    expect(detailPayload.noteType).toMatchObject({
      id: noteType.id,
      name: "Sentence Mining",
      fields: [{ name: "Sentence" }, { name: "Reading" }, { name: "Meaning" }],
      templates: [{ name: "Read" }, { name: "Recall" }]
    });
  });

  test("rejects manual card creation for an unknown note type", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Bad Note Type", jlptLevel: "mixed" });

    const response = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        noteTypeId: "note_type_missing",
        fields: { Front: "missing" },
        tags: []
      })
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Note type not found" });
  });

  test("deletes a whole note with sibling cards and review history", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Delete Note", jlptLevel: "N4" });
    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: {
          Expression: "削除",
          Reading: "さくじょ",
          MeaningZh: "删除"
        },
        tags: ["delete"],
        createAllTemplates: true
      })
    });
    const created = await cardResponse.json();
    for (const card of created.cards) {
      server.services.db
        .prepare(
          `INSERT INTO review_logs (
            id, card_id, rating, elapsed_ms, reviewed_at, previous_state, next_state,
            scheduled_days, stability, difficulty
          ) VALUES (?, ?, 'Good', 1000, ?, 'new', 'review', 1, 1, 1)`
        )
        .run(`review_${card.id}`, card.id, new Date().toISOString());
    }

    const deleted = await server.request(`/api/notes/${created.noteId}`, {
      method: "DELETE",
      headers: { cookie, "x-csrf-token": csrfToken }
    });

    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ ok: true, deletedCards: 3 });
    const noteCount = server.services.db.prepare("SELECT COUNT(*) AS count FROM notes WHERE id = ?").get(created.noteId) as { count: number };
    const cardCount = server.services.db.prepare("SELECT COUNT(*) AS count FROM cards WHERE note_id = ?").get(created.noteId) as { count: number };
    const reviewCount = server.services.db
      .prepare("SELECT COUNT(*) AS count FROM review_logs WHERE card_id IN (?, ?, ?)")
      .get(created.cards[0].id, created.cards[1].id, created.cards[2].id) as { count: number };
    expect(noteCount.count).toBe(0);
    expect(cardCount.count).toBe(0);
    expect(reviewCount.count).toBe(0);
  });

  test("suspends and restores a card from the review queue", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Suspend", jlptLevel: "N4" });
    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: { Expression: "保留", Reading: "ほりゅう", MeaningZh: "保留" },
        tags: ["manual"]
      })
    });
    const created = await cardResponse.json();

    const suspend = await server.request(`/api/cards/${created.card.id}/suspend`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: "{}"
    });
    expect(suspend.status).toBe(200);
    expect((await suspend.json()).card.state).toBe("suspended");

    const noNext = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie } });
    expect((await noNext.json()).card).toBeNull();

    const restore = await server.request(`/api/cards/${created.card.id}/unsuspend`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: "{}"
    });
    expect(restore.status).toBe(200);
    expect((await restore.json()).card.state).toBe("new");

    const next = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie } });
    const payload = await next.json();
    expect(payload.card.id).toBe(created.card.id);
  });

  test("resets a reviewed card back to new and clears its review history", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Reset Progress", jlptLevel: "N4" });
    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: { Expression: "復習", Reading: "ふくしゅう", MeaningZh: "复习" },
        tags: ["reset"]
      })
    });
    const created = await cardResponse.json();

    const reviewed = await server.request(`/api/review/${created.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1200 })
    });
    expect((await reviewed.json()).card.state).toBe("review");

    const reset = await server.request(`/api/cards/${created.card.id}/reset`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: "{}"
    });

    expect(reset.status).toBe(200);
    const payload = await reset.json();
    expect(payload.card).toMatchObject({
      id: created.card.id,
      state: "new",
      reps: 0,
      lapses: 0
    });
    const stored = server.services.db.prepare("SELECT state, queue, reps, lapses FROM cards WHERE id = ?").get(created.card.id) as any;
    expect(stored).toEqual({ state: "new", queue: "new", reps: 0, lapses: 0 });
    const reviewLogs = server.services.db.prepare("SELECT COUNT(*) AS count FROM review_logs WHERE card_id = ?").get(created.card.id) as { count: number };
    expect(reviewLogs.count).toBe(0);

    const next = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie } });
    expect((await next.json()).card.id).toBe(created.card.id);
  });

  test("creates all Japanese templates for pronunciation-focused manual cards", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Pronunciation", jlptLevel: "N4" });

    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: {
          Expression: "発音",
          Reading: "はつおん",
          PitchAccent: "0",
          MeaningZh: "发音",
          MeaningEn: "pronunciation",
          MeaningJa: "音を出すこと"
        },
        tags: ["manual", "pronunciation"],
        createAllTemplates: true
      })
    });

    expect(cardResponse.status).toBe(201);
    const created = await cardResponse.json();
    expect(created.cards).toHaveLength(3);

    const cardsResponse = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie } });
    const cards = await cardsResponse.json();
    expect(cards.cards).toHaveLength(3);
    expect(cards.cards.map((card: any) => card.question).join("\n")).toContain("はつおん");
  });

  test("creates grammar-focused manual cards with the Grammar template", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Manual Grammar", jlptLevel: "N4" });

    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: {
          Expression: "〜てもいい",
          MeaningZh: "可以……",
          MeaningEn: "may; is allowed to",
          Example: "ここで写真を撮ってもいいです。",
          ExplanationZh: "动词て形加もいい表示许可。",
          ExplanationEn: "Attach もいい to the te-form to ask or give permission.",
          ExplanationJa: "動詞のて形に「もいい」を付けて許可を表します。"
        },
        tags: ["manual", "grammar"],
        createAllTemplates: false,
        templateNames: ["Grammar"]
      })
    });

    expect(cardResponse.status).toBe(201);
    const created = await cardResponse.json();
    expect(created.cards).toHaveLength(1);
    expect(created.card.template.name).toBe("Grammar");
    expect(created.card.question).toContain("ここで写真を撮ってもいいです。");
    expect(created.card.answer).toContain("动词て形加もいい表示许可。");
    expect(created.card.answer).toContain("Attach もいい to the te-form");
    expect(created.card.answer).toContain("動詞のて形");
  });

  test("renders trilingual explanations on vocabulary recognition cards", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Manual Vocabulary Explanations", jlptLevel: "N4" });

    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: {
          Expression: "予約",
          Reading: "よやく",
          MeaningZh: "预约",
          MeaningEn: "reservation",
          MeaningJa: "前もって約束すること",
          Example: "ホテルを予約しました。",
          ExplanationZh: "旅行和餐厅场景常用。",
          ExplanationEn: "Common in travel and restaurant contexts.",
          ExplanationJa: "旅行やレストランの場面でよく使います。"
        },
        tags: ["manual", "vocabulary"]
      })
    });

    expect(cardResponse.status).toBe(201);
    const created = await cardResponse.json();
    expect(created.card.template.name).toBe("Recognize");
    expect(created.card.answer).toContain("旅行和餐厅场景常用。");
    expect(created.card.answer).toContain("Common in travel");
    expect(created.card.answer).toContain("旅行やレストラン");
  });

  test("lists note types with fields, templates, and usage counts", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Models", jlptLevel: "N4" });

    await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: { Expression: "発音", Reading: "はつおん", MeaningZh: "发音" },
        tags: ["pronunciation"],
        createAllTemplates: true
      })
    });

    const response = await server.request("/api/note-types", { headers: { cookie } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.noteTypes).toHaveLength(1);
    expect(payload.noteTypes[0]).toMatchObject({
      name: "Japanese Vocabulary Grammar Pronunciation",
      hasCss: true,
      noteCount: 1,
      cardCount: 3
    });
    expect(payload.noteTypes[0].fields.map((field: any) => field.name)).toEqual([
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
    ]);
    expect(payload.noteTypes[0].templates.map((template: any) => template.name)).toEqual(["Recognize", "Recall", "Pronunciation", "Grammar"]);
  });
});
