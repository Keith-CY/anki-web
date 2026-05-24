import { describe, expect, test } from "vitest";
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

async function createCard(server: ReturnType<typeof makeTestServer>, auth: Awaited<ReturnType<typeof login>>, deckId: string, expression: string) {
  const response = await server.request("/api/cards", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({
      deckId,
      fields: { Expression: expression, Reading: "", MeaningZh: expression },
      tags: ["limit"]
    })
  });
  return (await response.json()).card;
}

describe("daily review queue limits", () => {
  test("stops showing new cards after the deck daily new limit is reached", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "New limits", jlptLevel: "N4" });
    await server.request(`/api/decks/${deck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ dailyNewLimit: 1, dailyReviewLimit: 50 })
    });
    await createCard(server, auth, deck.id, "一枚目");
    await createCard(server, auth, deck.id, "二枚目");

    const first = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    expect(firstPayload.card.fields.Expression).toBe("一枚目");

    await server.request(`/api/review/${firstPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });

    const second = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const secondPayload = await second.json();
    expect(secondPayload.card).toBeNull();
  });

  test("stops showing due review cards after the deck daily review limit is reached", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Review limits", jlptLevel: "N3" });
    await server.request(`/api/decks/${deck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ dailyNewLimit: 50, dailyReviewLimit: 1 })
    });
    const first = await createCard(server, auth, deck.id, "復習一");
    const second = await createCard(server, auth, deck.id, "復習二");
    server.services.db
      .prepare("UPDATE cards SET state = 'review', queue = 'review', due_at = ?, scheduled_days = 1, reps = 1 WHERE id IN (?, ?)")
      .run("2026-05-17T00:00:00.000Z", first.id, second.id);

    const next = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const nextPayload = await next.json();
    expect(nextPayload.card.fields.Expression).toBe("復習一");

    await server.request(`/api/review/${nextPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });

    const blocked = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const blockedPayload = await blocked.json();
    expect(blockedPayload.card).toBeNull();
  });

  test("keeps due learning and relearning cards available even when daily limits are exhausted", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Learning bypass", jlptLevel: "N3" });
    await server.request(`/api/decks/${deck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ dailyNewLimit: 0, dailyReviewLimit: 0 })
    });
    const learning = await createCard(server, auth, deck.id, "学習中");
    const relearning = await createCard(server, auth, deck.id, "再学習中");
    const newCard = await createCard(server, auth, deck.id, "新規制限");
    const reviewCard = await createCard(server, auth, deck.id, "復習制限");
    server.services.db
      .prepare("UPDATE cards SET state = 'learning', queue = 'learning', due_at = ?, reps = 1 WHERE id = ?")
      .run("2026-05-17T00:00:00.000Z", learning.id);
    server.services.db
      .prepare("UPDATE cards SET state = 'relearning', queue = 'relearning', due_at = ?, reps = 3, lapses = 1 WHERE id = ?")
      .run("2026-05-17T00:01:00.000Z", relearning.id);
    server.services.db
      .prepare("UPDATE cards SET state = 'review', queue = 'review', due_at = ?, scheduled_days = 1, reps = 1 WHERE id = ?")
      .run("2026-05-17T00:02:00.000Z", reviewCard.id);

    const first = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    expect(firstPayload.card.fields.Expression).toBe("学習中");

    server.services.db
      .prepare("UPDATE cards SET buried_until = ?, updated_at = ? WHERE id = ?")
      .run("2999-01-01T00:00:00.000Z", "2026-05-17T00:00:00.000Z", learning.id);

    const second = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const secondPayload = await second.json();
    expect(secondPayload.card.fields.Expression).toBe("再学習中");

    expect(newCard.state).toBe("new");
  });

  test("continues past the first candidate window when daily-limited cards are blocking", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Candidate window", jlptLevel: "N3" });
    await server.request(`/api/decks/${deck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ dailyNewLimit: 0, dailyReviewLimit: 0 })
    });
    const blockedReviewIds = [];
    for (let index = 0; index < 55; index += 1) {
      const card = await createCard(server, auth, deck.id, `制限済み復習 ${index + 1}`);
      blockedReviewIds.push(card.id);
    }
    const learning = await createCard(server, auth, deck.id, "学習中候補");
    server.services.db
      .prepare(
        `UPDATE cards
         SET state = 'review', queue = 'review', due_at = ?, scheduled_days = 1, reps = 1
         WHERE id IN (${blockedReviewIds.map(() => "?").join(",")})`
      )
      .run("2026-05-17T00:00:00.000Z", ...blockedReviewIds);
    server.services.db
      .prepare("UPDATE cards SET state = 'learning', queue = 'learning', due_at = ?, reps = 1 WHERE id = ?")
      .run("2026-05-17T00:10:00.000Z", learning.id);

    const response = await server.request(`/api/review/next?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const payload = await response.json();

    expect(payload.card.fields.Expression).toBe("学習中候補");
  });

  test("applies intermediate parent deck daily limits when studying a grandparent deck", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const rootDeck = server.services.decks.createDeck({ name: "日本語", jlptLevel: "N4" });
    const vocabularyDeck = server.services.decks.createDeck({ name: "日本語::語彙", parentId: rootDeck.id, jlptLevel: "N4" });
    const n4Deck = server.services.decks.createDeck({ name: "日本語::語彙::N4", parentId: vocabularyDeck.id, jlptLevel: "N4" });
    await server.request(`/api/decks/${vocabularyDeck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ dailyNewLimit: 1, dailyReviewLimit: 200 })
    });
    await createCard(server, auth, n4Deck.id, "一枚目");
    await createCard(server, auth, n4Deck.id, "二枚目");

    const first = await server.request(`/api/review/next?deckId=${rootDeck.id}`, { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    expect(firstPayload.card.fields.Expression).toBe("一枚目");

    await server.request(`/api/review/${firstPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });

    const blocked = await server.request(`/api/review/next?deckId=${rootDeck.id}`, { headers: { cookie: auth.cookie } });
    const blockedPayload = await blocked.json();
    expect(blockedPayload.card).toBeNull();
  });

  test("applies parent deck daily limits when reviewing without selecting a deck", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "全体日本語", jlptLevel: "N4" });
    const childDeck = server.services.decks.createDeck({ name: "全体日本語::語彙", parentId: parentDeck.id, jlptLevel: "N4" });
    await server.request(`/api/decks/${parentDeck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ dailyNewLimit: 1, dailyReviewLimit: 200 })
    });
    await createCard(server, auth, childDeck.id, "一枚目");
    await createCard(server, auth, childDeck.id, "二枚目");

    const first = await server.request("/api/review/next", { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    expect(firstPayload.card.fields.Expression).toBe("一枚目");

    await server.request(`/api/review/${firstPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });

    const blocked = await server.request("/api/review/next", { headers: { cookie: auth.cookie } });
    const blockedPayload = await blocked.json();
    expect(blockedPayload.card).toBeNull();
  });

  test("applies ancestor deck daily limits when directly reviewing a child deck", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "子選択日本語", jlptLevel: "N4" });
    const childDeck = server.services.decks.createDeck({ name: "子選択日本語::語彙", parentId: parentDeck.id, jlptLevel: "N4" });
    await server.request(`/api/decks/${parentDeck.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ dailyNewLimit: 1, dailyReviewLimit: 200 })
    });
    await createCard(server, auth, childDeck.id, "一枚目");
    await createCard(server, auth, childDeck.id, "二枚目");

    const first = await server.request(`/api/review/next?deckId=${childDeck.id}`, { headers: { cookie: auth.cookie } });
    const firstPayload = await first.json();
    expect(firstPayload.card.fields.Expression).toBe("一枚目");

    await server.request(`/api/review/${firstPayload.card.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });

    const blocked = await server.request(`/api/review/next?deckId=${childDeck.id}`, { headers: { cookie: auth.cookie } });
    const blockedPayload = await blocked.json();
    expect(blockedPayload.card).toBeNull();
  });
});
