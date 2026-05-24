import { describe, expect, test } from "vitest";
import { makeTestServer } from "./helpers/server";
import { createJapaneseNote } from "../src/server/cards/service";

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

async function createCard(server: ReturnType<typeof makeTestServer>, auth: Awaited<ReturnType<typeof login>>, deckId: string, expression: string) {
  const response = await server.request("/api/cards", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({
      deckId,
      fields: { Expression: expression, Reading: "", MeaningZh: expression },
      tags: ["stats"]
    })
  });
  return (await response.json()).card;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("stats API", () => {
  test("returns card state, answer rating, and seven day review activity breakdowns", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Stats", jlptLevel: "N4" });
    const newCard = await createCard(server, auth, deck.id, "新規");
    const reviewCard = await createCard(server, auth, deck.id, "復習");
    const suspendedCard = await createCard(server, auth, deck.id, "停止");
    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    server.services.db.prepare("UPDATE cards SET state = 'review', queue = 'review', reps = 1 WHERE id = ?").run(reviewCard.id);
    server.services.db.prepare("UPDATE cards SET state = 'suspended', queue = 'suspended' WHERE id = ?").run(suspendedCard.id);
    server.services.db
      .prepare(
        `INSERT INTO review_logs (
          id, card_id, rating, elapsed_ms, reviewed_at, previous_state, next_state,
          scheduled_days, stability, difficulty
        ) VALUES (?, ?, ?, 1000, ?, 'new', 'review', 1, 1, 1)`
      )
      .run("review_good", newCard.id, "Good", now.toISOString());
    server.services.db
      .prepare(
        `INSERT INTO review_logs (
          id, card_id, rating, elapsed_ms, reviewed_at, previous_state, next_state,
          scheduled_days, stability, difficulty
        ) VALUES (?, ?, ?, 1000, ?, 'review', 'relearning', 0, 1, 1)`
      )
      .run("review_again", reviewCard.id, "Again", twoDaysAgo.toISOString());

    const response = await server.request("/api/stats", { headers: { cookie: auth.cookie } });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.cardStates).toMatchObject({ new: 1, review: 1, suspended: 1 });
    expect(payload.ratings).toMatchObject({ Again: 1, Hard: 0, Good: 1, Easy: 0 });
    expect(payload.activity).toHaveLength(7);
    expect(payload.activity.at(-1)).toMatchObject({ date: localDateKey(now), reviews: 1 });
    expect(payload.activity.find((day: any) => day.date === localDateKey(twoDaysAgo))).toMatchObject({ reviews: 1 });
  });

  test("scopes selected deck stats and excludes buried cards from due counts", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Scoped Stats", jlptLevel: "N4" });
    const otherDeck = server.services.decks.createDeck({ name: "Other Stats", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      createAllTemplates: true,
      fields: {
        Expression: "発音",
        Reading: "はつおん",
        MeaningZh: "发音",
        MeaningEn: "pronunciation",
        MeaningJa: "音を出すこと",
        Example: "発音を練習します。"
      }
    });
    await createCard(server, auth, deck.id, "文法");
    const otherCard = await createCard(server, auth, otherDeck.id, "別デッキ");

    const first = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    await server.request(`/api/review/${firstPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });
    server.services.db
      .prepare(
        `INSERT INTO review_logs (
          id, card_id, rating, elapsed_ms, reviewed_at, previous_state, next_state,
          scheduled_days, stability, difficulty
        ) VALUES (?, ?, 'Again', 1500, ?, 'new', 'relearning', 0, 1, 1)`
      )
      .run("other_deck_again", otherCard.id, new Date().toISOString());

    const scoped = await server.request(`/api/stats?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const scopedPayload = await scoped.json();
    const global = await server.request("/api/stats", { headers: { cookie: auth.cookie } });
    const globalPayload = await global.json();

    expect(scopedPayload.due).toBe(1);
    expect(scopedPayload.cards).toBe(4);
    expect(scopedPayload.reviews).toBe(1);
    expect(scopedPayload.cardStates).toMatchObject({ new: 3, review: 1, suspended: 0 });
    expect(scopedPayload.ratings).toMatchObject({ Again: 0, Hard: 0, Good: 1, Easy: 0 });
    expect(globalPayload.due).toBe(2);
    expect(globalPayload.cardStates).toMatchObject({ new: 4, review: 1, suspended: 0 });
    expect(globalPayload.ratings).toMatchObject({ Again: 1, Hard: 0, Good: 1, Easy: 0 });
  });

  test("rolls child deck cards and reviews into parent deck stats", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "Japanese", jlptLevel: "N4" });
    const childDeck = server.services.decks.createDeck({ name: "Japanese::Vocabulary", parentId: parentDeck.id, jlptLevel: "N4" });
    const otherDeck = server.services.decks.createDeck({ name: "Other", jlptLevel: "N4" });
    const childCard = await createCard(server, auth, childDeck.id, "発音");
    const otherCard = await createCard(server, auth, otherDeck.id, "別");
    server.services.db
      .prepare(
        `INSERT INTO review_logs (
          id, card_id, rating, elapsed_ms, reviewed_at, previous_state, next_state,
          scheduled_days, stability, difficulty
        ) VALUES (?, ?, 'Good', 1000, ?, 'new', 'review', 1, 1, 1)`
      )
      .run("parent_child_review", childCard.id, new Date().toISOString());
    server.services.db
      .prepare(
        `INSERT INTO review_logs (
          id, card_id, rating, elapsed_ms, reviewed_at, previous_state, next_state,
          scheduled_days, stability, difficulty
        ) VALUES (?, ?, 'Again', 1000, ?, 'new', 'relearning', 0, 1, 1)`
      )
      .run("other_review", otherCard.id, new Date().toISOString());

    const scoped = await server.request(`/api/stats?deckId=${parentDeck.id}`, { headers: { cookie: auth.cookie } });
    const payload = await scoped.json();

    expect(payload.cards).toBe(1);
    expect(payload.due).toBe(1);
    expect(payload.reviews).toBe(1);
    expect(payload.daily).toMatchObject({ newDone: 1, reviewDone: 0 });
    expect(payload.cardStates).toMatchObject({ new: 1, review: 0, suspended: 0 });
    expect(payload.ratings).toMatchObject({ Again: 0, Hard: 0, Good: 1, Easy: 0 });
    expect(payload.activity.at(-1).reviews).toBe(1);
    expect(payload.calendar.at(-1).ratings).toMatchObject({ Again: 0, Hard: 0, Good: 1, Easy: 0 });
  });

  test("reports due cards that are still available under daily deck limits", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "Limited Parent", jlptLevel: "N4" });
    const childDeck = server.services.decks.createDeck({ name: "Limited Parent::Child", parentId: parentDeck.id, jlptLevel: "N4" });
    server.services.db.prepare("UPDATE decks SET daily_new_limit = 1 WHERE id = ?").run(parentDeck.id);
    await createCard(server, auth, childDeck.id, "一枚目");
    await createCard(server, auth, childDeck.id, "二枚目");

    const before = await server.request(`/api/stats?deckId=${parentDeck.id}`, { headers: { cookie: auth.cookie } });
    const beforePayload = await before.json();
    expect(beforePayload.due).toBe(1);

    const first = await server.request(`/api/review/next?deckId=${parentDeck.id}`, { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    await server.request(`/api/review/${firstPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });

    const after = await server.request(`/api/stats?deckId=${parentDeck.id}`, { headers: { cookie: auth.cookie } });
    const afterPayload = await after.json();
    expect(afterPayload.due).toBe(0);
    expect(afterPayload.daily).toMatchObject({ newLimit: 1, newDone: 1 });
  });

  test("counts due cards through intermediate parent deck daily limits", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const rootDeck = server.services.decks.createDeck({ name: "Japanese Root", jlptLevel: "N4" });
    const vocabularyDeck = server.services.decks.createDeck({ name: "Japanese Root::Vocabulary", parentId: rootDeck.id, jlptLevel: "N4" });
    const n4Deck = server.services.decks.createDeck({ name: "Japanese Root::Vocabulary::N4", parentId: vocabularyDeck.id, jlptLevel: "N4" });
    server.services.db.prepare("UPDATE decks SET daily_new_limit = 1 WHERE id = ?").run(vocabularyDeck.id);
    await createCard(server, auth, n4Deck.id, "一枚目");
    await createCard(server, auth, n4Deck.id, "二枚目");

    const before = await server.request(`/api/stats?deckId=${rootDeck.id}`, { headers: { cookie: auth.cookie } });
    const beforePayload = await before.json();
    expect(beforePayload.due).toBe(1);

    const first = await server.request(`/api/review/next?deckId=${rootDeck.id}`, { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    await server.request(`/api/review/${firstPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });

    const after = await server.request(`/api/stats?deckId=${rootDeck.id}`, { headers: { cookie: auth.cookie } });
    const afterPayload = await after.json();
    expect(afterPayload.due).toBe(0);
  });

  test("counts global due cards through parent deck daily limits", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "Global Japanese", jlptLevel: "N4" });
    const childDeck = server.services.decks.createDeck({ name: "Global Japanese::Vocabulary", parentId: parentDeck.id, jlptLevel: "N4" });
    server.services.db.prepare("UPDATE decks SET daily_new_limit = 1 WHERE id = ?").run(parentDeck.id);
    await createCard(server, auth, childDeck.id, "一枚目");
    await createCard(server, auth, childDeck.id, "二枚目");

    const before = await server.request("/api/stats", { headers: { cookie: auth.cookie } });
    const beforePayload = await before.json();
    expect(beforePayload.due).toBe(1);

    const first = await server.request("/api/review/next", { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    await server.request(`/api/review/${firstPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });

    const after = await server.request("/api/stats", { headers: { cookie: auth.cookie } });
    const afterPayload = await after.json();
    expect(afterPayload.due).toBe(0);
  });

  test("counts selected child deck due cards through ancestor daily limits", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "Selected Child Parent", jlptLevel: "N4" });
    const childDeck = server.services.decks.createDeck({ name: "Selected Child Parent::Vocabulary", parentId: parentDeck.id, jlptLevel: "N4" });
    server.services.db.prepare("UPDATE decks SET daily_new_limit = 1 WHERE id = ?").run(parentDeck.id);
    await createCard(server, auth, childDeck.id, "一枚目");
    await createCard(server, auth, childDeck.id, "二枚目");

    const before = await server.request(`/api/stats?deckId=${childDeck.id}`, { headers: { cookie: auth.cookie } });
    const beforePayload = await before.json();
    expect(beforePayload.due).toBe(1);

    const first = await server.request(`/api/review/next?deckId=${childDeck.id}`, { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    await server.request(`/api/review/${firstPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });

    const after = await server.request(`/api/stats?deckId=${childDeck.id}`, { headers: { cookie: auth.cookie } });
    const afterPayload = await after.json();
    expect(afterPayload.due).toBe(0);
  });

  test("returns current-month review calendar scoped to the selected deck", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Calendar", jlptLevel: "N4" });
    const otherDeck = server.services.decks.createDeck({ name: "Other Calendar", jlptLevel: "N4" });
    const targetCard = await createCard(server, auth, deck.id, "今日");
    const otherCard = await createCard(server, auth, otherDeck.id, "別");
    const today = new Date();
    const todayKey = localDateKey(today);

    server.services.db
      .prepare(
        `INSERT INTO review_logs (
          id, card_id, rating, elapsed_ms, reviewed_at, previous_state, next_state,
          scheduled_days, stability, difficulty
        ) VALUES (?, ?, ?, ?, ?, 'new', 'review', 1, 1, 1)`
      )
      .run("calendar_good", targetCard.id, "Good", 1500, today.toISOString());
    server.services.db
      .prepare(
        `INSERT INTO review_logs (
          id, card_id, rating, elapsed_ms, reviewed_at, previous_state, next_state,
          scheduled_days, stability, difficulty
        ) VALUES (?, ?, ?, ?, ?, 'new', 'relearning', 0, 1, 1)`
      )
      .run("calendar_other_again", otherCard.id, "Again", 2000, today.toISOString());

    const scoped = await server.request(`/api/stats?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const scopedPayload = await scoped.json();
    const global = await server.request("/api/stats", { headers: { cookie: auth.cookie } });
    const globalPayload = await global.json();

    expect(scopedPayload.calendar[0].date.endsWith("-01")).toBe(true);
    expect(scopedPayload.calendar.at(-1).date).toBe(todayKey);
    expect(scopedPayload.calendar.at(-1)).toMatchObject({
      reviews: 1,
      elapsedMs: 1500,
      ratings: { Again: 0, Hard: 0, Good: 1, Easy: 0 }
    });
    expect(globalPayload.calendar.at(-1)).toMatchObject({
      reviews: 2,
      elapsedMs: 3500,
      ratings: { Again: 1, Hard: 0, Good: 1, Easy: 0 }
    });
  });
});
