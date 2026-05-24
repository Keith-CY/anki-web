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

describe("job status API", () => {
  test("records failed package imports as queryable jobs", async () => {
    const server = makeTestServer();
    const auth = await login(server);

    const failedImport = await server.request("/api/imports/apkg-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ url: "http://127.0.0.1:9876/deck.apkg", includeScheduling: false })
    });
    const failedPayload = await failedImport.json();

    const response = await server.request("/api/jobs", { headers: { cookie: auth.cookie } });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.jobs).toHaveLength(1);
    expect(payload.jobs[0]).toMatchObject({
      type: "apkg-import",
      status: "failed",
      error: expect.stringContaining("Private network")
    });
    expect(payload.jobs[0].payload).toMatchObject({
      importId: failedPayload.id,
      includeScheduling: false
    });

    const detail = await server.request(`/api/jobs/${payload.jobs[0].id}`, { headers: { cookie: auth.cookie } });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: payload.jobs[0].id, status: "failed" });
  });

  test("records text generation and bulk TTS results", async () => {
    const server = makeTestServer({
      ttsSynthesize: async () => Buffer.from("fake-mp3")
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Job Deck", jlptLevel: "N4" });

    const generation = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "仕事ノート",
        text: "今日は学校で新しい文法を勉強しました。先生は例文を読んで、発音を何度も練習しました。"
      })
    });
    const generated = await generation.json();

    await server.request("/api/drafts/audio-bulk", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ ids: generated.drafts.map((draft: any) => draft.id) })
    });

    const response = await server.request("/api/jobs", { headers: { cookie: auth.cookie } });

    expect(response.status).toBe(200);
    const payload = await response.json();
    const jobsByType = payload.jobs.reduce((counts: Record<string, number>, job: any) => {
      counts[job.type] = (counts[job.type] ?? 0) + 1;
      return counts;
    }, {});
    expect(jobsByType).toMatchObject({
      "draft-tts-bulk": 1,
      "draft-tts": 3,
      "text-generation": 1
    });
    expect(payload.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "draft-tts", status: "completed" }),
        expect.objectContaining({
          type: "text-generation",
          status: "completed",
          payload: expect.objectContaining({ importId: generated.importId, title: "仕事ノート", deckId: deck.id, jlptLevel: "N4" }),
          result: expect.objectContaining({ sourceId: generated.sourceId, draftsCreated: 3 })
        })
      ])
    );
    const bulkJob = payload.jobs.find((job: any) => job.type === "draft-tts-bulk");
    expect(bulkJob).toMatchObject({
      status: "completed",
      result: { generated: 0, skipped: 3 }
    });
  });
});
