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

describe("import history API", () => {
  test("lists recent package and material import jobs with parsed result payloads", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Import History", jlptLevel: "N4" });

    await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "履歴ノート",
        text: "今日は学校で新しい文法を勉強しました。先生は例文を読んで、発音を何度も練習しました。"
      })
    });
    server.services.db
      .prepare(
        `INSERT INTO imports (id, type, url, status, include_scheduling, error, result_json, created_at, updated_at)
         VALUES ('import_failed', 'apkg-url', 'https://example.com/broken.apkg', 'failed', 0, 'Download failed', NULL,
                 '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z')`
      )
      .run();

    const response = await server.request("/api/imports", { headers: { cookie: auth.cookie } });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.imports).toHaveLength(2);
    expect(payload.imports[0]).toMatchObject({
      type: "text-material",
      status: "completed",
      includeScheduling: false,
      error: null,
      generatedSource: {
        id: expect.any(String),
        draftCards: 3,
        approvedCards: 0
      }
    });
    expect(payload.imports[0].result).toMatchObject({ draftsCreated: 3 });
    expect(payload.imports[1]).toMatchObject({
      id: "import_failed",
      type: "apkg-url",
      status: "failed",
      error: "Download failed"
    });
  });

  test("lists stored source provenance with draft and approved card counts", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Source History", jlptLevel: "N4" });

    const generation = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "会話メモ",
        text: "今日は先生と学校で会話しました。新しい文法を確認して、発音を何度も練習しました。"
      })
    });
    const generated = await generation.json();
    await server.request(`/api/drafts/${generated.drafts[0].id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });

    const response = await server.request("/api/sources", { headers: { cookie: auth.cookie } });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.sources).toHaveLength(1);
    expect(payload.sources[0]).toMatchObject({
      id: generated.sourceId,
      type: "text-material",
      url: generated.drafts[0].fields.SourceUrl,
      title: "会話メモ",
      drafts: { total: 3, draft: 2, approved: 1, rejected: 0 },
      approvedNotes: 1
    });
    expect(payload.sources[0].contentPreview).toContain("新しい文法");
    expect(payload.sources[0].contentPreview.length).toBeLessThanOrEqual(160);

    const detail = await server.request(`/api/sources/${generated.sourceId}`, { headers: { cookie: auth.cookie } });
    expect(detail.status).toBe(200);
    const detailPayload = await detail.json();
    expect(detailPayload.source).toMatchObject({
      id: generated.sourceId,
      title: "会話メモ",
      drafts: { total: 3, draft: 2, approved: 1, rejected: 0 },
      approvedNotes: 1
    });
  });

  test("regenerates draft cards from a stored learning source without re-uploading material", async () => {
    const seenInputs: Array<Record<string, any>> = [];
    const server = makeTestServer({
      generateDrafts: async (input) => {
        seenInputs.push(input);
        return {
          drafts: [
            {
              kind: "grammar",
              expression: seenInputs.length === 1 ? "〜ながら" : "〜たばかり",
              reading: "",
              pitchAccent: null,
              pitchAccentSource: "none",
              meanings: { zh: "语法", en: "grammar", ja: "文法" },
              example: "音楽を聞きながら勉強します。",
              exampleReading: "おんがくをききながらべんきょうします。",
              explanation: { zh: "来源资料生成。", en: "Generated from source.", ja: "資料から生成。" },
              tags: ["regenerate"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Regenerate Source", jlptLevel: "N3" });

    const generation = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        title: "再生成メモ",
        text: "授業で新しい文法を確認しました。例文と発音を何度も練習しました。"
      })
    });
    const generated = await generation.json();

    const regenerated = await server.request(`/api/sources/${generated.sourceId}/regenerate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });

    expect(regenerated.status, await regenerated.clone().text()).toBe(201);
    const payload = await regenerated.json();
    expect(payload.sourceId).toBe(generated.sourceId);
    expect(payload.drafts).toHaveLength(1);
    expect(payload.drafts[0]).toMatchObject({
      deckId: deck.id,
      fields: {
        Expression: "〜たばかり",
        SourceUrl: generated.drafts[0].fields.SourceUrl
      }
    });
    expect(seenInputs).toHaveLength(2);
    expect(seenInputs[1]).toMatchObject({
      sourceId: generated.sourceId,
      deckId: deck.id,
      title: "再生成メモ",
      jlptLevel: "N3"
    });
    expect(seenInputs[1].text).toContain("新しい文法を確認しました");

    const importRow = server.services.db.prepare("SELECT type, status, result_json FROM imports WHERE id = ?").get(payload.importId) as any;
    expect(importRow).toMatchObject({ type: "source-regeneration", status: "completed" });
    expect(JSON.parse(importRow.result_json)).toMatchObject({ sourceId: generated.sourceId, draftsCreated: 1 });

    const source = await server.request("/api/sources", { headers: { cookie: auth.cookie } });
    const sourcePayload = await source.json();
    expect(sourcePayload.sources[0]).toMatchObject({
      id: generated.sourceId,
      drafts: { total: 2, draft: 1, approved: 0, rejected: 1 }
    });
    const drafts = await server.request("/api/drafts", { headers: { cookie: auth.cookie } });
    expect((await drafts.json()).drafts.map((draft: any) => draft.fields.Expression)).toEqual(["〜たばかり"]);
  });

  test("exports approved cards from a learning source as an apkg", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Source Export", jlptLevel: "N4" });

    const generation = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "資料カード",
        text: "今日は学校で新しい文法を勉強しました。先生は例文を読んで、発音を何度も練習しました。"
      })
    });
    const generated = await generation.json();

    await server.request(`/api/drafts/${generated.drafts[0].id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });

    const exported = await server.request(`/api/sources/${generated.sourceId}/export`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ includeMedia: true, includeScheduling: false, legacySupport: true })
    });

    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/octet-stream");
    expect(exported.headers.get("content-disposition")).toContain(".apkg");
    expect((await exported.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
