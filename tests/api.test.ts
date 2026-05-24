import { describe, expect, test } from "vitest";
import { makeTestServer } from "./helpers/server";

describe("core API flow", () => {
  test("returns JSON not found for unknown authenticated API routes", async () => {
    const server = makeTestServer();
    const login = await server.request("/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secret" })
    });
    const cookie = login.headers.get("set-cookie") ?? "";

    const response = await server.request("/api/not-a-real-route", { headers: { cookie } });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ error: "Route not found" });
  });

  test("logs in, creates a deck and card, reviews the due card", async () => {
    const server = makeTestServer();
    const login = await server.request("/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secret" })
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    const csrfToken = (await login.json()).csrfToken;

    const deckResponse = await server.request("/api/decks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({ name: "Japanese", jlptLevel: "N4" })
    });
    expect(deckResponse.status).toBe(201);
    const deck = await deckResponse.json();

    const cardResponse = await server.request("/api/cards", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        deckId: deck.id,
        fields: {
          Expression: "確認",
          Reading: "かくにん",
          MeaningZh: "确认",
          MeaningEn: "confirmation",
          MeaningJa: "たしかめること",
          Example: "予約を確認します。",
          PitchAccent: "0"
        },
        tags: ["N4"]
      })
    });
    expect(cardResponse.status).toBe(201);

    const next = await server.request(`/api/review/next?deckId=${deck.id}`, {
      headers: { cookie }
    });
    expect(next.status).toBe(200);
    const due = await next.json();
    expect(due.card.fields.Expression).toBe("確認");
    expect(Object.keys(due.previews)).toEqual(["Again", "Hard", "Good", "Easy"]);
    expect(due.previews.Good.state).toBe("review");

    const answer = await server.request(`/api/review/${due.card.id}/answer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({ rating: "Good", elapsedMs: 2500 })
    });
    expect(answer.status).toBe(200);
    const reviewed = await answer.json();
    expect(reviewed.card.state).toBe("review");
    expect(reviewed.scheduler.state).toBe(due.previews.Good.state);
    expect(reviewed.scheduler.scheduledDays).toBe(due.previews.Good.scheduledDays);

    const exported = await server.request(`/api/decks/${deck.id}/export`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({ includeMedia: true, includeScheduling: false, legacySupport: true })
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/octet-stream");
    expect(exported.headers.get("content-disposition")).toContain(".apkg");

    const modernExport = await server.request(`/api/decks/${deck.id}/export`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({ includeMedia: true, includeScheduling: false, legacySupport: false })
    });
    expect(modernExport.status).toBe(200);
    expect(modernExport.headers.get("content-disposition")).toContain(".colpkg");
  });
});
