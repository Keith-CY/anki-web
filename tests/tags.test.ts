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

async function createTaggedCard(
  server: ReturnType<typeof makeTestServer>,
  auth: Awaited<ReturnType<typeof login>>,
  input: { deckId: string; expression: string; tags: string[]; fields?: Record<string, string> }
) {
  const response = await server.request("/api/cards", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({
      deckId: input.deckId,
      fields: { Expression: input.expression, Reading: "", MeaningZh: input.expression, ...(input.fields ?? {}) },
      tags: input.tags
    })
  });
  return (await response.json()).card;
}

describe("tag management", () => {
  test("summarizes deck tags and filters the card browser by tag", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Tagged", jlptLevel: "N4" });

    await createTaggedCard(server, auth, { deckId: deck.id, expression: "文法", tags: ["grammar", "N4"] });
    await createTaggedCard(server, auth, { deckId: deck.id, expression: "語彙", tags: ["vocabulary", "N4"] });
    await createTaggedCard(server, auth, { deckId: deck.id, expression: "発音", tags: ["pronunciation"] });

    const tagsResponse = await server.request(`/api/tags?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const tagsPayload = await tagsResponse.json();

    expect(tagsResponse.status).toBe(200);
    expect(tagsPayload.tags).toEqual([
      { name: "N4", count: 2 },
      { name: "grammar", count: 1 },
      { name: "pronunciation", count: 1 },
      { name: "vocabulary", count: 1 }
    ]);

    const cardsResponse = await server.request(`/api/cards?deckId=${deck.id}&tag=${encodeURIComponent("N4")}`, {
      headers: { cookie: auth.cookie }
    });
    const cardsPayload = await cardsResponse.json();

    expect(cardsResponse.status).toBe(200);
    expect(cardsPayload.cards).toHaveLength(2);
    expect(cardsPayload.cards.map((card: any) => card.fields.Expression).sort()).toEqual(["文法", "語彙"]);
  });

  test("searches the card browser across Japanese fields and tags", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Searchable", jlptLevel: "N4" });

    await createTaggedCard(server, auth, {
      deckId: deck.id,
      expression: "発音",
      tags: ["pronunciation"],
      fields: { Reading: "はつおん", MeaningEn: "pronunciation", Example: "発音を何度も練習しました。" }
    });
    await createTaggedCard(server, auth, {
      deckId: deck.id,
      expression: "文法",
      tags: ["grammar"],
      fields: { Reading: "ぶんぽう", MeaningZh: "语法", Example: "新しい文法を勉強しました。" }
    });
    await createTaggedCard(server, auth, {
      deckId: deck.id,
      expression: "語彙",
      tags: ["vocabulary"],
      fields: { Reading: "ごい", MeaningZh: "词汇", Example: "単語の意味を確認しました。" }
    });

    const byReading = await server.request(`/api/cards?deckId=${deck.id}&q=${encodeURIComponent("はつおん")}`, {
      headers: { cookie: auth.cookie }
    });
    expect((await byReading.json()).cards.map((card: any) => card.fields.Expression)).toEqual(["発音"]);

    const byMeaning = await server.request(`/api/cards?deckId=${deck.id}&q=${encodeURIComponent("语法")}`, {
      headers: { cookie: auth.cookie }
    });
    expect((await byMeaning.json()).cards.map((card: any) => card.fields.Expression)).toEqual(["文法"]);

    const byTagAndText = await server.request(
      `/api/cards?deckId=${deck.id}&tag=${encodeURIComponent("pronunciation")}&q=${encodeURIComponent("練習")}`,
      { headers: { cookie: auth.cookie } }
    );
    expect((await byTagAndText.json()).cards.map((card: any) => card.fields.Expression)).toEqual(["発音"]);
  });

  test("filters the card browser by scheduling state", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "State Filter", jlptLevel: "N4" });

    await createTaggedCard(server, auth, { deckId: deck.id, expression: "新規", tags: ["state"] });
    const reviewedCard = await createTaggedCard(server, auth, { deckId: deck.id, expression: "復習", tags: ["state"] });
    const suspendedCard = await createTaggedCard(server, auth, { deckId: deck.id, expression: "保留", tags: ["state"] });

    await server.request(`/api/review/${reviewedCard.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ rating: "Good", elapsedMs: 1000 })
    });
    await server.request(`/api/cards/${suspendedCard.id}/suspend`, {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken }
    });

    const reviewCards = await server.request(`/api/cards?deckId=${deck.id}&state=review`, { headers: { cookie: auth.cookie } });
    const suspendedCards = await server.request(`/api/cards?deckId=${deck.id}&state=suspended`, { headers: { cookie: auth.cookie } });
    const invalidState = await server.request(`/api/cards?deckId=${deck.id}&state=buried`, { headers: { cookie: auth.cookie } });

    expect(reviewCards.status).toBe(200);
    expect((await reviewCards.json()).cards.map((card: any) => card.fields.Expression)).toEqual(["復習"]);
    expect(suspendedCards.status).toBe(200);
    expect((await suspendedCards.json()).cards.map((card: any) => card.fields.Expression)).toEqual(["保留"]);
    expect(invalidState.status).toBe(400);
  });

  test("paginates large card browser result sets", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Large Imported Deck", jlptLevel: "N4" });

    for (let index = 0; index < 105; index += 1) {
      await createTaggedCard(server, auth, {
        deckId: deck.id,
        expression: `単語${String(index).padStart(3, "0")}`,
        tags: ["imported"]
      });
    }

    const page = await server.request(`/api/cards?deckId=${deck.id}&limit=20&offset=40`, {
      headers: { cookie: auth.cookie }
    });
    const payload = await page.json();

    expect(page.status).toBe(200);
    expect(payload.cards).toHaveLength(20);
    expect(payload.total).toBe(105);
    expect(payload.limit).toBe(20);
    expect(payload.offset).toBe(40);
    expect(payload.hasMore).toBe(true);
  });

  test("renames a tag within a selected deck without touching other decks", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const targetDeck = server.services.decks.createDeck({ name: "Target", jlptLevel: "N4" });
    const otherDeck = server.services.decks.createDeck({ name: "Other", jlptLevel: "N4" });

    await createTaggedCard(server, auth, { deckId: targetDeck.id, expression: "発音", tags: ["imported", "needs-review"] });
    await createTaggedCard(server, auth, { deckId: targetDeck.id, expression: "文法", tags: ["imported", "grammar"] });
    await createTaggedCard(server, auth, { deckId: otherDeck.id, expression: "語彙", tags: ["imported"] });

    const rename = await server.request(`/api/tags/${encodeURIComponent("imported")}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ name: "imported-japanese", deckId: targetDeck.id })
    });
    const renamePayload = await rename.json();

    expect(rename.status).toBe(200);
    expect(renamePayload).toMatchObject({ tag: { name: "imported-japanese", count: 2 }, updatedNotes: 2 });

    const targetTags = await server.request(`/api/tags?deckId=${targetDeck.id}`, { headers: { cookie: auth.cookie } });
    expect((await targetTags.json()).tags).toEqual([
      { name: "imported-japanese", count: 2 },
      { name: "grammar", count: 1 },
      { name: "needs-review", count: 1 }
    ]);

    const otherTags = await server.request(`/api/tags?deckId=${otherDeck.id}`, { headers: { cookie: auth.cookie } });
    expect((await otherTags.json()).tags).toEqual([{ name: "imported", count: 1 }]);
  });

  test("deletes a tag from cards while preserving remaining tags", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Cleanup", jlptLevel: "N4" });

    await createTaggedCard(server, auth, { deckId: deck.id, expression: "発音", tags: ["cleanup", "pronunciation"] });
    await createTaggedCard(server, auth, { deckId: deck.id, expression: "文法", tags: ["cleanup", "grammar"] });

    const deleted = await server.request(`/api/tags/${encodeURIComponent("cleanup")}?deckId=${encodeURIComponent(deck.id)}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken }
    });
    const deletePayload = await deleted.json();

    expect(deleted.status).toBe(200);
    expect(deletePayload).toMatchObject({ ok: true, removedTag: "cleanup", updatedNotes: 2 });

    const tagsResponse = await server.request(`/api/tags?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    expect((await tagsResponse.json()).tags).toEqual([
      { name: "grammar", count: 1 },
      { name: "pronunciation", count: 1 }
    ]);

    const cardsResponse = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const cards = (await cardsResponse.json()).cards;
    expect(cards.map((card: any) => card.tags).sort()).toEqual([["grammar"], ["pronunciation"]]);
  });

  test("bulk suspends and restores cards for a tag within a selected deck", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const targetDeck = server.services.decks.createDeck({ name: "Bulk Target", jlptLevel: "N4" });
    const otherDeck = server.services.decks.createDeck({ name: "Bulk Other", jlptLevel: "N4" });

    const reviewCard = await createTaggedCard(server, auth, { deckId: targetDeck.id, expression: "復習", tags: ["imported"] });
    const newCard = await createTaggedCard(server, auth, { deckId: targetDeck.id, expression: "新規", tags: ["imported"] });
    const otherCard = await createTaggedCard(server, auth, { deckId: otherDeck.id, expression: "別", tags: ["imported"] });
    server.services.db.prepare("UPDATE cards SET reps = 2 WHERE id = ?").run(reviewCard.id);

    const suspend = await server.request(`/api/tags/${encodeURIComponent("imported")}/bulk-state`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ action: "suspend", deckId: targetDeck.id })
    });

    expect(suspend.status).toBe(200);
    await expect(suspend.json()).resolves.toEqual({ ok: true, action: "suspend", updatedCards: 2 });
    const afterSuspend = server.services.db
      .prepare("SELECT id, state, queue FROM cards WHERE id IN (?, ?, ?) ORDER BY id")
      .all(reviewCard.id, newCard.id, otherCard.id) as Array<{ id: string; state: string; queue: string }>;
    expect(afterSuspend.filter((card) => card.id !== otherCard.id).map((card) => card.state)).toEqual(["suspended", "suspended"]);
    expect(afterSuspend.find((card) => card.id === otherCard.id)).toMatchObject({ state: "new", queue: "new" });

    const restore = await server.request(`/api/tags/${encodeURIComponent("imported")}/bulk-state`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ action: "unsuspend", deckId: targetDeck.id })
    });

    expect(restore.status).toBe(200);
    await expect(restore.json()).resolves.toEqual({ ok: true, action: "unsuspend", updatedCards: 2 });
    const restoredReview = server.services.db.prepare("SELECT state, queue FROM cards WHERE id = ?").get(reviewCard.id);
    const restoredNew = server.services.db.prepare("SELECT state, queue FROM cards WHERE id = ?").get(newCard.id);
    expect(restoredReview).toEqual({ state: "review", queue: "review" });
    expect(restoredNew).toEqual({ state: "new", queue: "new" });
  });
});
