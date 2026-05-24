import { describe, expect, test } from "vitest";
import { createJapaneseNote } from "../src/server/cards/service";
import { makeTestServer } from "./helpers/server";

async function login(server: ReturnType<typeof makeTestServer>) {
  const response = await server.request("/api/session/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "secret" })
  });
  return {
    cookie: response.headers.get("set-cookie") ?? "",
    csrfToken: (await response.json()).csrfToken as string
  };
}

describe("review queue", () => {
  test("studies due cards from child decks when the selected deck is a parent deck", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "日本語", jlptLevel: "N4" });
    const vocabularyDeck = server.services.decks.createDeck({ name: "日本語::語彙", parentId: parentDeck.id, jlptLevel: "N4" });
    const grammarDeck = server.services.decks.createDeck({ name: "日本語::文法", parentId: parentDeck.id, jlptLevel: "N4" });
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

    const next = await server.request(`/api/review/next?deckId=${parentDeck.id}`, { headers: { cookie: auth.cookie } });
    const payload = await next.json();

    expect(payload.card).toBeTruthy();
    expect([vocabularyDeck.id, grammarDeck.id]).toContain(payload.card.deckId);
    expect(["発音", "なら"]).toContain(payload.card.fields.Expression);
  });

  test("applies a parent deck daily new-card limit across child decks", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "Parent daily limit", jlptLevel: "N4" });
    const childDeck = server.services.decks.createDeck({ name: "Parent daily limit::Child", parentId: parentDeck.id, jlptLevel: "N4" });
    server.services.db.prepare("UPDATE decks SET daily_new_limit = 1 WHERE id = ?").run(parentDeck.id);
    createJapaneseNote(server.services.db, {
      deckId: childDeck.id,
      fields: {
        Expression: "一枚目",
        Reading: "いちまいめ",
        MeaningZh: "第一张"
      }
    });
    createJapaneseNote(server.services.db, {
      deckId: childDeck.id,
      fields: {
        Expression: "二枚目",
        Reading: "にまいめ",
        MeaningZh: "第二张"
      }
    });

    const first = await server.request(`/api/review/next?deckId=${parentDeck.id}`, { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    expect(firstPayload.card.fields.Expression).toBe("一枚目");

    await server.request(`/api/review/${firstPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1200 })
    });

    const blocked = await server.request(`/api/review/next?deckId=${parentDeck.id}`, { headers: { cookie: auth.cookie } });
    await expect(blocked.json()).resolves.toMatchObject({ card: null });
  });

  test("unburies child deck cards when a parent deck is selected", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "Parent unbury", jlptLevel: "N4" });
    const childDeck = server.services.decks.createDeck({ name: "Parent unbury::Child", parentId: parentDeck.id, jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: childDeck.id,
      fields: {
        Expression: "発音",
        Reading: "はつおん",
        MeaningZh: "发音"
      }
    });
    const card = server.services.db.prepare("SELECT id FROM cards WHERE deck_id = ?").get(childDeck.id) as { id: string };
    server.services.db
      .prepare("UPDATE cards SET buried_until = ?, updated_at = ? WHERE id = ?")
      .run("2999-01-01T00:00:00.000Z", "2026-05-18T00:00:00.000Z", card.id);

    const before = await server.request(`/api/review/next?deckId=${parentDeck.id}`, { headers: { cookie: auth.cookie } });
    await expect(before.json()).resolves.toMatchObject({ card: null });

    const unburied = await server.request(`/api/decks/${parentDeck.id}/unbury`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });
    expect(unburied.status).toBe(200);
    await expect(unburied.json()).resolves.toMatchObject({ restoredCards: 1 });

    const after = await server.request(`/api/review/next?deckId=${parentDeck.id}`, { headers: { cookie: auth.cookie } });
    const payload = await after.json();
    expect(payload.card.fields.Expression).toBe("発音");
  });

  test("buries sibling cards from the same note until the next day after a review", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Sibling burying", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      createAllTemplates: true,
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
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "文法",
        Reading: "ぶんぽう",
        MeaningZh: "语法",
        MeaningEn: "grammar",
        MeaningJa: "文の決まり",
        Example: "文法を勉強します。",
        PitchAccent: "0"
      },
      tags: ["grammar"]
    });

    const first = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    expect(firstPayload.card.fields.Expression).toBe("発音");

    await server.request(`/api/review/${firstPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1200 })
    });

    const buriedSiblings = server.services.db
      .prepare("SELECT * FROM cards WHERE note_id = ? AND id != ? AND buried_until IS NOT NULL")
      .all(firstPayload.card.noteId, firstPayload.card.id);
    expect(buriedSiblings).toHaveLength(2);

    const second = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const secondPayload = await second.json();
    expect(secondPayload.card.fields.Expression).toBe("文法");
  });

  test("manually buries the current review card without recording an answer", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Manual bury", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "一枚目",
        Reading: "いちまいめ",
        MeaningZh: "第一张"
      },
      tags: ["manual"]
    });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "二枚目",
        Reading: "にまいめ",
        MeaningZh: "第二张"
      },
      tags: ["manual"]
    });

    const first = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    expect(firstPayload.card.fields.Expression).toBe("一枚目");

    const buried = await server.request(`/api/review/${firstPayload.card.id}/bury`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });
    expect(buried.status).toBe(200);
    const buriedPayload = await buried.json();
    expect(buriedPayload.card.id).toBe(firstPayload.card.id);
    expect(buriedPayload.card.state).toBe("new");
    expect(buriedPayload.buriedUntil).toBeTruthy();

    const reviewCount = server.services.db.prepare("SELECT COUNT(*) AS count FROM review_logs").get() as { count: number };
    expect(reviewCount.count).toBe(0);

    const next = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const nextPayload = await next.json();
    expect(nextPayload.card.fields.Expression).toBe("二枚目");
  });

  test("rejects stale review answers after a card has already been scheduled", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Stale answer guard", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "重複",
        Reading: "ちょうふく",
        MeaningZh: "重复"
      },
      tags: ["guard"]
    });

    const next = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const nextPayload = await next.json();

    const firstAnswer = await server.request(`/api/review/${nextPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });
    expect(firstAnswer.status).toBe(200);

    const staleAnswer = await server.request(`/api/review/${nextPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });
    expect(staleAnswer.status).toBe(409);
    await expect(staleAnswer.json()).resolves.toEqual({ error: "Card is not currently due for review" });

    const reviewCount = server.services.db.prepare("SELECT COUNT(*) AS count FROM review_logs").get() as { count: number };
    expect(reviewCount.count).toBe(1);
  });

  test("records full scheduling snapshots for review audit and undo support", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Review snapshots", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "復習",
        Reading: "ふくしゅう",
        MeaningZh: "复习"
      },
      tags: ["audit"]
    });

    const next = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const nextPayload = await next.json();
    const answer = await server.request(`/api/review/${nextPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1400 })
    });
    expect(answer.status).toBe(200);
    const answerPayload = await answer.json();

    const log = server.services.db.prepare("SELECT previous_snapshot_json, next_snapshot_json FROM review_logs").get() as {
      previous_snapshot_json: string;
      next_snapshot_json: string;
    };
    const previous = JSON.parse(log.previous_snapshot_json);
    const after = JSON.parse(log.next_snapshot_json);

    expect(previous).toMatchObject({
      state: "new",
      reps: 0,
      lapses: 0,
      queue: "new",
      buriedUntil: null
    });
    expect(previous.dueAt).toBe(nextPayload.card.dueAt);
    expect(after).toMatchObject({
      state: answerPayload.scheduler.state,
      dueAt: answerPayload.scheduler.dueAt,
      reps: answerPayload.scheduler.reps,
      lapses: answerPayload.scheduler.lapses,
      queue: answerPayload.scheduler.state,
      buriedUntil: null
    });
  });

  test("undoes the latest review answer and restores automatically buried siblings", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Undo review", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      createAllTemplates: true,
      fields: {
        Expression: "発音",
        Reading: "はつおん",
        MeaningZh: "发音",
        MeaningEn: "pronunciation",
        MeaningJa: "音を出すこと",
        Example: "発音を練習します。",
        PitchAccent: "0"
      },
      tags: ["undo"]
    });

    const next = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const nextPayload = await next.json();
    const answer = await server.request(`/api/review/${nextPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 900 })
    });
    expect(answer.status).toBe(200);
    expect(
      server.services.db
        .prepare("SELECT COUNT(*) AS count FROM cards WHERE note_id = ? AND id != ? AND buried_until IS NOT NULL")
        .get(nextPayload.card.noteId, nextPayload.card.id)
    ).toEqual({ count: 2 });

    const undo = await server.request(`/api/review/${nextPayload.card.id}/undo`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });

    expect(undo.status).toBe(200);
    const payload = await undo.json();
    expect(payload.card).toMatchObject({
      id: nextPayload.card.id,
      state: "new",
      reps: 0,
      lapses: 0,
      dueAt: nextPayload.card.dueAt
    });
    expect(payload.undoneReview.rating).toBe("Good");
    expect(payload.restoredSiblingCards).toBe(2);
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM review_logs").get()).toEqual({ count: 0 });
    expect(
      server.services.db
        .prepare("SELECT COUNT(*) AS count FROM cards WHERE note_id = ? AND id != ? AND buried_until IS NOT NULL")
        .get(nextPayload.card.noteId, nextPayload.card.id)
    ).toEqual({ count: 0 });
  });

  test("rejects answers for a manually buried card", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Buried answer guard", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "後で",
        Reading: "あとで",
        MeaningZh: "稍后"
      },
      tags: ["guard"]
    });

    const next = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const nextPayload = await next.json();

    await server.request(`/api/review/${nextPayload.card.id}/bury`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });

    const answer = await server.request(`/api/review/${nextPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });

    expect(answer.status).toBe(409);
    const reviewCount = server.services.db.prepare("SELECT COUNT(*) AS count FROM review_logs").get() as { count: number };
    expect(reviewCount.count).toBe(0);
  });

  test("restores buried cards for a deck without unsuspending cards", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Unbury", jlptLevel: "N4" });
    const firstNote = createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "戻す",
        Reading: "もどす",
        MeaningZh: "恢复"
      },
      tags: ["manual"]
    });
    const secondNote = createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "停止",
        Reading: "ていし",
        MeaningZh: "暂停"
      },
      tags: ["manual"]
    });
    const buriedUntil = new Date(Date.now() + 86_400_000).toISOString();
    const suspendedCardId = secondNote.cards[0].id;
    server.services.db
      .prepare("UPDATE cards SET buried_until = ?, updated_at = ? WHERE id = ?")
      .run(buriedUntil, buriedUntil, firstNote.cards[0].id);
    server.services.db
      .prepare("UPDATE cards SET state = 'suspended', queue = 'suspended', buried_until = ?, updated_at = ? WHERE id = ?")
      .run(buriedUntil, buriedUntil, suspendedCardId);

    const response = await server.request(`/api/decks/${deck.id}/unbury`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, restoredCards: 1 });
    const activeCard = server.services.db.prepare("SELECT buried_until FROM cards WHERE id = ?").get(firstNote.cards[0].id) as {
      buried_until: string | null;
    };
    const suspendedCard = server.services.db.prepare("SELECT state, buried_until FROM cards WHERE id = ?").get(suspendedCardId) as {
      state: string;
      buried_until: string | null;
    };
    expect(activeCard.buried_until).toBeNull();
    expect(suspendedCard).toEqual({ state: "suspended", buried_until: buriedUntil });
  });
});
