import { afterEach, describe, expect, test, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestServer } from "./helpers/server";
import { AnkiPackageWorker } from "../src/server/anki/worker";
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

describe("Anki package URL import API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("imports an apkg URL served with an Anki-specific content type", async () => {
    const sourceServer = makeTestServer();
    const sourceDeck = sourceServer.services.decks.createDeck({ name: "URL Package", jlptLevel: "N4" });
    createJapaneseNote(sourceServer.services.db, {
      deckId: sourceDeck.id,
      fields: {
        Expression: "予約",
        Reading: "よやく",
        MeaningZh: "预约",
        MeaningEn: "reservation",
        MeaningJa: "前もって約束すること",
        Example: "席を予約しました。"
      },
      tags: ["url-import"]
    });
    const exported = await new AnkiPackageWorker(sourceServer.services).exportDeck(sourceDeck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });

    const fetchPublicUrl = fetchPublicUrlFromResponses([
      new Response(new Uint8Array(exported.buffer), {
        status: 200,
        headers: { "content-type": "application/vnd.anki.package" }
      })
    ]);

    const targetServer = makeTestServer({ fetchPublicUrl });
    const auth = await login(targetServer);
    const response = await targetServer.request("/api/imports/apkg-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        url: "https://93.184.216.34/japanese.apkg",
        includeScheduling: false
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "completed",
      result: {
        sourceId: expect.stringMatching(/^source_/),
        decksImported: 1,
        notesImported: 1,
        cardsImported: 1,
        needsStudyMaterial: true,
        studyMaterialRecommendations: [
          {
            deckName: "URL Package",
            deckCoverage: {
              needsMaterial: true,
              insufficientKinds: ["vocabulary", "grammar", "pronunciation"],
              kinds: [
                { kind: "vocabulary", current: 1, recommendedMinimum: 20, missing: 19, insufficient: true },
                { kind: "grammar", current: 0, recommendedMinimum: 10, missing: 10, insufficient: true },
                { kind: "pronunciation", current: 0, recommendedMinimum: 10, missing: 10, insufficient: true }
              ]
            }
          }
        ]
      }
    });
    const importHistory = await targetServer.request("/api/imports", { headers: { cookie: auth.cookie } });
    const historyPayload = await importHistory.json();
    expect(historyPayload.imports[0].result.sourceId).toBeTruthy();
    const jobs = await targetServer.request("/api/jobs", { headers: { cookie: auth.cookie } });
    const jobsPayload = await jobs.json();
    expect(jobsPayload.jobs[0]).toMatchObject({
      type: "apkg-import",
      status: "completed",
      result: {
        sourceId: historyPayload.imports[0].result.sourceId,
        packageFileName: historyPayload.imports[0].result.packageFileName,
        cardsImported: 1
      }
    });
    expect(historyPayload.imports[0].result.packageFileName).toMatch(/japanese.*\.apkg$/);
    expect(readdirSync(targetServer.services.packageDir)).toEqual([historyPayload.imports[0].result.packageFileName]);
    expect(readFileSync(join(targetServer.services.packageDir, historyPayload.imports[0].result.packageFileName))).toEqual(exported.buffer);
    const archivedPackage = await targetServer.request(`/api/imports/${historyPayload.imports[0].id}/package`, {
      headers: { cookie: auth.cookie }
    });
    expect(archivedPackage.status).toBe(200);
    expect(archivedPackage.headers.get("content-type")).toBe("application/octet-stream");
    expect(archivedPackage.headers.get("content-disposition")).toContain("japanese.apkg");
    expect(Buffer.from(await archivedPackage.arrayBuffer())).toEqual(exported.buffer);
    const importedCards = await targetServer.request("/api/cards", { headers: { cookie: auth.cookie } });
    const payload = await importedCards.json();
    expect(payload.cards[0].fields.Expression).toBe("予約");
    expect(payload.cards[0].tags).toEqual(["url-import"]);
  });

  test("targets the imported parent deck for multi-deck package study material recommendations", async () => {
    const sourceServer = makeTestServer();
    const parentDeck = sourceServer.services.decks.createDeck({ name: "Imported Japanese N4", jlptLevel: "N4" });
    const vocabularyDeck = sourceServer.services.decks.createDeck({ name: "Vocabulary", parentId: parentDeck.id, jlptLevel: "N4" });
    const grammarDeck = sourceServer.services.decks.createDeck({ name: "Grammar", parentId: parentDeck.id, jlptLevel: "N4" });
    createJapaneseNote(sourceServer.services.db, {
      deckId: vocabularyDeck.id,
      fields: {
        Expression: "予約",
        Reading: "よやく",
        MeaningZh: "预约",
        MeaningEn: "reservation",
        MeaningJa: "前もって約束すること",
        Example: "席を予約しました。"
      },
      templateNames: ["Recognize"],
      tags: ["package-vocabulary"]
    });
    createJapaneseNote(sourceServer.services.db, {
      deckId: grammarDeck.id,
      fields: {
        Expression: "〜ている",
        Reading: "ている",
        MeaningZh: "正在",
        MeaningEn: "be doing",
        MeaningJa: "動作の継続を表す",
        Example: "日本語を勉強しています。"
      },
      templateNames: ["Grammar"],
      tags: ["package-grammar"]
    });
    const exported = await new AnkiPackageWorker(sourceServer.services).exportDeck(parentDeck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });
    const fetchPublicUrl = fetchPublicUrlFromResponses([
      new Response(new Uint8Array(exported.buffer), {
        status: 200,
        headers: { "content-type": "application/vnd.anki.package" }
      })
    ]);

    const targetServer = makeTestServer({ fetchPublicUrl });
    const auth = await login(targetServer);
    const response = await targetServer.request("/api/imports/apkg-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        url: "https://93.184.216.34/imported-japanese-n4.apkg",
        includeScheduling: false
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result.studyMaterialRecommendations[0]).toMatchObject({
      deckName: "Imported Japanese N4",
      deckCoverage: {
        insufficientKinds: ["vocabulary", "grammar", "pronunciation"],
        kinds: [
          { kind: "vocabulary", current: 1, missing: 19, insufficient: true },
          { kind: "grammar", current: 1, missing: 9, insufficient: true },
          { kind: "pronunciation", current: 0, missing: 10, insufficient: true }
        ]
      }
    });
  });

  test("adds an Anki package extension when archiving a URL download without one", async () => {
    const sourceServer = makeTestServer();
    const sourceDeck = sourceServer.services.decks.createDeck({ name: "Extensionless Download", jlptLevel: "N4" });
    createJapaneseNote(sourceServer.services.db, {
      deckId: sourceDeck.id,
      fields: {
        Expression: "予約",
        Reading: "よやく",
        MeaningZh: "预约",
        MeaningEn: "reservation",
        MeaningJa: "前もって約束すること",
        Example: "席を予約しました。"
      },
      tags: ["url-download"]
    });
    const exported = await new AnkiPackageWorker(sourceServer.services).exportDeck(sourceDeck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });

    const fetchPublicUrl = fetchPublicUrlFromResponses([
      new Response(new Uint8Array(exported.buffer), {
        status: 200,
        headers: { "content-type": "application/vnd.anki.package" }
      })
    ]);

    const targetServer = makeTestServer({ fetchPublicUrl });
    const auth = await login(targetServer);
    const response = await targetServer.request("/api/imports/apkg-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        url: "https://93.184.216.34/download?id=japanese",
        includeScheduling: false
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.packageFileName).toMatch(/download.*\.apkg$/);

    const archivedPackage = await targetServer.request(`/api/imports/${payload.id}/package`, {
      headers: { cookie: auth.cookie }
    });
    expect(archivedPackage.headers.get("content-disposition")).toContain("download.apkg");
    expect(Buffer.from(await archivedPackage.arrayBuffer())).toEqual(exported.buffer);
  });

  test("uses the response filename when archiving a package URL download", async () => {
    const sourceServer = makeTestServer();
    const sourceDeck = sourceServer.services.decks.createDeck({ name: "Named Download", jlptLevel: "N4" });
    createJapaneseNote(sourceServer.services.db, {
      deckId: sourceDeck.id,
      fields: {
        Expression: "確認",
        Reading: "かくにん",
        MeaningZh: "确认",
        MeaningEn: "confirmation",
        MeaningJa: "たしかめること",
        Example: "予約を確認しました。"
      },
      tags: ["named-download"]
    });
    const exported = await new AnkiPackageWorker(sourceServer.services).exportDeck(sourceDeck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });

    const fetchPublicUrl = fetchPublicUrlFromResponses([
      new Response(new Uint8Array(exported.buffer), {
        status: 200,
        headers: {
          "content-type": "application/vnd.anki.package",
          "content-disposition": "attachment; filename*=UTF-8''Japanese%20N4.apkg"
        }
      })
    ]);

    const targetServer = makeTestServer({ fetchPublicUrl });
    const auth = await login(targetServer);
    const response = await targetServer.request("/api/imports/apkg-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        url: "https://93.184.216.34/download?id=named",
        includeScheduling: false
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.packageFileName).toMatch(/Japanese N4\.apkg$/);

    const archivedPackage = await targetServer.request(`/api/imports/${payload.id}/package`, {
      headers: { cookie: auth.cookie }
    });
    expect(archivedPackage.headers.get("content-disposition")).toContain("Japanese%20N4.apkg");
    expect(Buffer.from(await archivedPackage.arrayBuffer())).toEqual(exported.buffer);
  });

  test("imports a compressed collection package URL served as x-colpkg", async () => {
    const sourceServer = makeTestServer();
    const sourceDeck = sourceServer.services.decks.createDeck({ name: "Collection Package", jlptLevel: "N3" });
    createJapaneseNote(sourceServer.services.db, {
      deckId: sourceDeck.id,
      fields: {
        Expression: "文法",
        Reading: "ぶんぽう",
        MeaningZh: "语法",
        MeaningEn: "grammar",
        MeaningJa: "文の規則",
        Example: "新しい文法を確認しました。"
      },
      tags: ["colpkg-url"]
    });
    const exported = await new AnkiPackageWorker(sourceServer.services).exportDeck(sourceDeck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: false
    });

    const fetchPublicUrl = fetchPublicUrlFromResponses([
      new Response(new Uint8Array(exported.buffer), {
        status: 200,
        headers: { "content-type": "application/x-colpkg" }
      })
    ]);

    const targetServer = makeTestServer({ fetchPublicUrl });
    const auth = await login(targetServer);
    const response = await targetServer.request("/api/imports/apkg-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        url: "https://93.184.216.34/collection.colpkg",
        includeScheduling: false
      })
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      status: "completed",
      result: {
        notesImported: 1,
        cardsImported: 1,
        packageFileName: expect.stringMatching(/collection.*\.colpkg$/)
      }
    });
    const importedCards = await targetServer.request("/api/cards", { headers: { cookie: auth.cookie } });
    const payload = await importedCards.json();
    expect(payload.cards[0].fields.Expression).toBe("文法");
    expect(payload.cards[0].tags).toEqual(["colpkg-url"]);
  });

  test("retries a failed package URL import as a new import job", async () => {
    const sourceServer = makeTestServer();
    const sourceDeck = sourceServer.services.decks.createDeck({ name: "Retry Package", jlptLevel: "N4" });
    createJapaneseNote(sourceServer.services.db, {
      deckId: sourceDeck.id,
      fields: {
        Expression: "復習",
        Reading: "ふくしゅう",
        MeaningZh: "复习",
        MeaningEn: "review",
        MeaningJa: "前に学んだことをもう一度勉強すること",
        Example: "毎日語彙を復習します。"
      },
      tags: ["retry-import"]
    });
    const exported = await new AnkiPackageWorker(sourceServer.services).exportDeck(sourceDeck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });

    const fetchPublicUrl = fetchPublicUrlFromResponses([
      new Response("temporary outage", { status: 503, headers: { "content-type": "text/plain" } }),
      new Response(new Uint8Array(exported.buffer), {
        status: 200,
        headers: { "content-type": "application/vnd.anki.package" }
      })
    ]);

    const targetServer = makeTestServer({ fetchPublicUrl });
    const auth = await login(targetServer);
    const failedResponse = await targetServer.request("/api/imports/apkg-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        url: "https://93.184.216.34/retry.apkg",
        includeScheduling: false
      })
    });
    expect(failedResponse.status).toBe(400);
    const failedPayload = await failedResponse.json();

    const retryResponse = await targetServer.request(`/api/imports/${failedPayload.id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });

    expect(retryResponse.status).toBe(201);
    const retryPayload = await retryResponse.json();
    expect(retryPayload).toMatchObject({
      type: "apkg-url",
      status: "completed",
      retryOfImportId: failedPayload.id,
      result: {
        notesImported: 1,
        cardsImported: 1,
        packageFileName: expect.stringMatching(/retry.*\.apkg$/)
      }
    });
    expect(retryPayload.id).not.toBe(failedPayload.id);

    const importHistory = await targetServer.request("/api/imports", { headers: { cookie: auth.cookie } });
    const historyPayload = await importHistory.json();
    expect(historyPayload.imports.map((entry: any) => entry.status)).toEqual(["completed", "failed"]);

    const jobs = await targetServer.request("/api/jobs", { headers: { cookie: auth.cookie } });
    const jobsPayload = await jobs.json();
    expect(jobsPayload.jobs[0]).toMatchObject({
      type: "apkg-import",
      status: "completed",
      payload: {
        importId: retryPayload.id,
        retryOfImportId: failedPayload.id,
        url: "https://93.184.216.34/retry.apkg"
      }
    });

    const importedCards = await targetServer.request("/api/cards", { headers: { cookie: auth.cookie } });
    const payload = await importedCards.json();
    expect(payload.cards[0].fields.Expression).toBe("復習");
    expect(payload.cards[0].tags).toEqual(["retry-import"]);
  });

  test("rejects retry for non-failed or non-URL imports", async () => {
    const targetServer = makeTestServer();
    const auth = await login(targetServer);
    const now = new Date().toISOString();
    targetServer.services.db
      .prepare(
        `INSERT INTO imports (id, type, url, status, include_scheduling, error, result_json, created_at, updated_at)
         VALUES
           ('import_completed', 'apkg-url', 'https://example.com/done.apkg', 'completed', 0, NULL, '{}', ?, ?),
           ('import_file_failed', 'apkg-file', 'upload:///local.apkg', 'failed', 0, 'Import failed', NULL, ?, ?)`
      )
      .run(now, now, now, now);

    const completedRetry = await targetServer.request("/api/imports/import_completed/retry", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });
    expect(completedRetry.status).toBe(400);
    await expect(completedRetry.json()).resolves.toMatchObject({ error: "Only failed imports can be retried" });

    const fileRetry = await targetServer.request("/api/imports/import_file_failed/retry", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });
    expect(fileRetry.status).toBe(400);
    await expect(fileRetry.json()).resolves.toMatchObject({ error: "Only URL package imports can be retried" });
  });

  test("imports an uploaded apkg file and archives the original package", async () => {
    const sourceServer = makeTestServer();
    const sourceDeck = sourceServer.services.decks.createDeck({ name: "Uploaded Package", jlptLevel: "N4" });
    createJapaneseNote(sourceServer.services.db, {
      deckId: sourceDeck.id,
      fields: {
        Expression: "確認",
        Reading: "かくにん",
        MeaningZh: "确认",
        MeaningEn: "confirmation",
        MeaningJa: "たしかめること",
        Example: "発音を確認しました。"
      },
      tags: ["file-import"]
    });
    const exported = await new AnkiPackageWorker(sourceServer.services).exportDeck(sourceDeck.id, {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });

    const targetServer = makeTestServer();
    const auth = await login(targetServer);
    const form = new FormData();
    form.set("includeScheduling", "false");
    form.set("file", new File([new Uint8Array(exported.buffer)], "local-japanese.apkg", { type: "application/vnd.anki.package" }));

    const response = await targetServer.request("/api/imports/apkg-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "completed",
      result: {
        decksImported: 1,
        notesImported: 1,
        cardsImported: 1,
        packageFileName: expect.stringMatching(/local-japanese.*\.apkg$/)
      }
    });

    const importHistory = await targetServer.request("/api/imports", { headers: { cookie: auth.cookie } });
    const historyPayload = await importHistory.json();
    expect(historyPayload.imports[0]).toMatchObject({
      type: "apkg-file",
      status: "completed",
      includeScheduling: false
    });
    expect(readFileSync(join(targetServer.services.packageDir, historyPayload.imports[0].result.packageFileName))).toEqual(exported.buffer);

    const archivedPackage = await targetServer.request(`/api/imports/${historyPayload.imports[0].id}/package`, {
      headers: { cookie: auth.cookie }
    });
    expect(archivedPackage.headers.get("content-disposition")).toContain("local-japanese.apkg");
    expect(Buffer.from(await archivedPackage.arrayBuffer())).toEqual(exported.buffer);

    const importedCards = await targetServer.request("/api/cards", { headers: { cookie: auth.cookie } });
    const payload = await importedCards.json();
    expect(payload.cards[0].fields.Expression).toBe("確認");
    expect(payload.cards[0].tags).toEqual(["file-import"]);
  });

  test("rejects uploaded non-package files before creating an import job", async () => {
    const targetServer = makeTestServer();
    const auth = await login(targetServer);
    const form = new FormData();
    form.set("file", new File([Buffer.from("plain notes")], "lesson-notes.txt", { type: "application/octet-stream" }));

    const response = await targetServer.request("/api/imports/apkg-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Only .apkg and .colpkg package files can be uploaded" });
    expect(targetServer.services.db.prepare("SELECT COUNT(*) AS count FROM imports").get()).toEqual({ count: 0 });
    expect(targetServer.services.db.prepare("SELECT COUNT(*) AS count FROM jobs").get()).toEqual({ count: 0 });
  });
});

function fetchPublicUrlFromResponses(responses: Response[]) {
  return vi.fn(async (url: string, options: { maxBytes: number; contentTypes?: string[] }) => {
    const response = responses.shift();
    if (!response) throw new Error("No mocked response remaining");
    if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";
    if (options.contentTypes?.length && !options.contentTypes.includes(contentType)) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > options.maxBytes) throw new Error(`Response is larger than ${options.maxBytes} bytes`);
    const fileName = responseFileName(response.headers.get("content-disposition"));
    return { url, contentType, buffer, ...(fileName ? { fileName } : {}) };
  });
}

function responseFileName(value: string | null) {
  const encoded = value?.match(/(?:^|;)\s*filename\*\s*=\s*(?:UTF-8''|)([^;]+)/i)?.[1];
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded.trim().replace(/^"|"$/g, ""));
  } catch {
    return encoded.trim().replace(/^"|"$/g, "");
  }
}
