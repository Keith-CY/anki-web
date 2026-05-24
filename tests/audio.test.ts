import { describe, expect, test } from "vitest";
import { existsSync, rmSync, writeFileSync } from "node:fs";
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

describe("pronunciation audio generation", () => {
  test("uploads local audio media and uses it in a manual Japanese card", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Manual Media", jlptLevel: "N4" });
    const form = new FormData();
    form.set("file", new File([Buffer.from("manual audio bytes")], "manual audio.mp3", { type: "audio/mpeg" }));

    const upload = await server.request("/api/media", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
      body: form
    });

    expect(upload.status, await upload.clone().text()).toBe(201);
    const uploaded = await upload.json();
    expect(uploaded.asset).toMatchObject({
      originalName: "manual audio.mp3",
      mimeType: "audio/mpeg",
      available: true
    });
    expect(uploaded.asset.fileName).toMatch(/^manual-audio-[a-f0-9]{10}\.mp3$/);
    expect(uploaded.reference).toBe(`[sound:${uploaded.asset.fileName}]`);
    expect("path" in uploaded.asset).toBe(false);

    const detail = await server.request(`/api/media/${uploaded.asset.id}`, { headers: { cookie } });
    expect(detail.status).toBe(200);
    const detailPayload = await detail.json();
    expect(detailPayload.asset).toMatchObject({
      id: uploaded.asset.id,
      fileName: uploaded.asset.fileName,
      originalName: "manual audio.mp3",
      mimeType: "audio/mpeg",
      available: true
    });
    expect("path" in detailPayload.asset).toBe(false);

    const stored = server.services.db.prepare("SELECT * FROM media_assets WHERE id = ?").get(uploaded.asset.id) as any;
    expect(existsSync(stored.path)).toBe(true);
    const media = await server.request(`/media/${encodeURIComponent(uploaded.asset.fileName)}`, { headers: { cookie } });
    expect(media.status).toBe(200);
    expect(Buffer.from(await media.arrayBuffer())).toEqual(Buffer.from("manual audio bytes"));

    const created = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: {
          Expression: "音声",
          Reading: "おんせい",
          MeaningZh: "音频",
          Audio: uploaded.reference
        },
        tags: ["manual-audio"]
      })
    });
    expect(created.status).toBe(201);

    const cards = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie } });
    const payload = await cards.json();
    expect(payload.cards[0].fields.Audio).toBe(uploaded.reference);
    expect(payload.cards[0].answer).toContain("<audio controls");
  });

  test("treats malformed protected media paths as not found", async () => {
    const server = makeTestServer();
    const { cookie } = await login(server);

    const response = await server.request("/media/%E0%A4%A", { headers: { cookie } });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Media not found" });
  });

  test("rejects uploaded media when the file extension does not match an allowed audio or raster image type", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const form = new FormData();
    form.set("file", new File([Buffer.from("<svg><script>alert(1)</script></svg>")], "accent.svg", { type: "image/png" }));

    const response = await server.request("/api/media", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
      body: form
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Media file extension does not match an allowed media type" });
  });

  test("deduplicates repeated media uploads by checksum even when file names differ", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const firstForm = new FormData();
    firstForm.set("file", new File([Buffer.from("same pronunciation audio")], "hatsuon.mp3", { type: "audio/mpeg" }));
    const secondForm = new FormData();
    secondForm.set("file", new File([Buffer.from("same pronunciation audio")], "renamed-hatsuon.mp3", { type: "audio/mpeg" }));

    const first = await server.request("/api/media", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
      body: firstForm
    });
    expect(first.status, await first.clone().text()).toBe(201);
    const firstPayload = await first.json();

    const second = await server.request("/api/media", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
      body: secondForm
    });

    expect(second.status, await second.clone().text()).toBe(201);
    const secondPayload = await second.json();
    expect(secondPayload.asset).toMatchObject({
      id: firstPayload.asset.id,
      fileName: firstPayload.asset.fileName,
      originalName: "hatsuon.mp3",
      available: true
    });
    expect(secondPayload.reference).toBe(firstPayload.reference);
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM media_assets").get()).toEqual({ count: 1 });
  });

  test("restores a missing stored media file when the same content is uploaded again", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const firstForm = new FormData();
    firstForm.set("file", new File([Buffer.from("recoverable pronunciation audio")], "recover.mp3", { type: "audio/mpeg" }));

    const first = await server.request("/api/media", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
      body: firstForm
    });
    expect(first.status, await first.clone().text()).toBe(201);
    const firstPayload = await first.json();
    const stored = server.services.db.prepare("SELECT * FROM media_assets WHERE id = ?").get(firstPayload.asset.id) as any;
    rmSync(stored.path, { force: true });
    expect(existsSync(stored.path)).toBe(false);

    const secondForm = new FormData();
    secondForm.set("file", new File([Buffer.from("recoverable pronunciation audio")], "recover-copy.mp3", { type: "audio/mpeg" }));
    const second = await server.request("/api/media", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
      body: secondForm
    });

    expect(second.status, await second.clone().text()).toBe(201);
    const secondPayload = await second.json();
    expect(secondPayload.asset).toMatchObject({
      id: firstPayload.asset.id,
      fileName: firstPayload.asset.fileName,
      available: true
    });
    expect(secondPayload.reference).toBe(firstPayload.reference);
    expect(existsSync(stored.path)).toBe(true);
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM media_assets").get()).toEqual({ count: 1 });
  });

  test("serves unsafe media records as opaque attachments with nosniff", async () => {
    const server = makeTestServer();
    const { cookie } = await login(server);
    const mediaPath = `${server.services.mediaDir}/accent.svg`;
    writeFileSync(mediaPath, Buffer.from('<svg><script>alert("xss")</script></svg>'));
    server.services.db
      .prepare(
        `INSERT INTO media_assets (id, file_name, original_name, mime_type, path, checksum, source_id, created_at)
         VALUES ('media_svg_1', 'accent.svg', 'accent.svg', 'image/svg+xml', ?, 'svg-checksum', 'source_import_1', '2026-05-17T00:00:00.000Z')`
      )
      .run(mediaPath);

    const response = await server.request("/media/accent.svg", { headers: { cookie } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="accent.svg"');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('<svg><script>alert("xss")</script></svg>'));
  });

  test("bulk generates missing TTS audio for selected drafts", async () => {
    const spoken: string[] = [];
    const server = makeTestServer({
      ttsSynthesize: async ({ text }: { text: string }) => {
        spoken.push(text);
        return Buffer.from(`audio:${text}`);
      }
    });
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Bulk Draft Audio", jlptLevel: "N4" });
    const insertDraft = server.services.db.prepare(
      `INSERT INTO generation_drafts (
        id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
        explanation_languages, raw_json, created_at, updated_at
      ) VALUES (?, NULL, ?, 'pronunciation', 'draft', ?, 'pronunciation', ?, 'confirmed',
        'zh,en,ja', '{}', '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z')`
    );
    insertDraft.run(
      "draft_bulk_audio_1",
      deck.id,
      "発音",
      JSON.stringify({ Expression: "発音", Reading: "はつおん", Audio: "" })
    );
    insertDraft.run(
      "draft_bulk_audio_2",
      deck.id,
      "確認",
      JSON.stringify({ Expression: "確認", Reading: "かくにん", Audio: "[sound:existing.mp3]" })
    );
    insertDraft.run(
      "draft_bulk_audio_3",
      deck.id,
      "練習",
      JSON.stringify({ Expression: "", Reading: "れんしゅう", Audio: "" })
    );

    const response = await server.request("/api/drafts/audio-bulk", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ ids: ["draft_bulk_audio_1", "draft_bulk_audio_2", "draft_bulk_audio_3"] })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.generated).toBe(2);
    expect(payload.skipped).toBe(1);
    expect(spoken).toEqual(["発音", "れんしゅう"]);
    expect(payload.drafts).toHaveLength(3);
    expect(payload.drafts.find((draft: any) => draft.id === "draft_bulk_audio_1").fields.Audio).toMatch(/^\[sound:.+\.mp3\]$/);
    expect(payload.drafts.find((draft: any) => draft.id === "draft_bulk_audio_2").fields.Audio).toBe("[sound:existing.mp3]");
    expect(payload.drafts.find((draft: any) => draft.id === "draft_bulk_audio_3").fields.Audio).toMatch(/^\[sound:.+\.mp3\]$/);
  });

  test("generates cached TTS audio for a draft and preserves it when approved", async () => {
    const server = makeTestServer({
      ttsSynthesize: async ({ text }: { text: string }) => Buffer.from(`audio:${text}`)
    });
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Audio", jlptLevel: "N4" });
    server.services.db
      .prepare(
        `INSERT INTO generation_drafts (
          id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
          explanation_languages, raw_json, created_at, updated_at
        ) VALUES (
          'draft_audio', NULL, ?, 'pronunciation', 'draft', '発音', 'pronunciation', ?, 'confirmed',
          'zh,en,ja', ?, '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z'
        )`
      )
      .run(
        deck.id,
        JSON.stringify({
          Expression: "発音",
          Reading: "はつおん",
          PitchAccent: "0",
          MeaningZh: "发音",
          MeaningEn: "pronunciation",
          MeaningJa: "音を出すこと",
          Audio: ""
        }),
        JSON.stringify({ tags: ["pronunciation"] })
      );

    const audio = await server.request("/api/drafts/draft_audio/audio", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ text: "発音" })
    });
    expect(audio.status).toBe(200);
    const audioPayload = await audio.json();
    expect(audioPayload.audio).toMatch(/^\[sound:.+\.mp3\]$/);

    await server.request("/api/drafts/draft_audio/approve", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: "{}"
    });
    const cards = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie } });
    const payload = await cards.json();
    expect(payload.cards[0].fields.Audio).toBe(audioPayload.audio);
    expect(payload.cards[0].answer).toContain("<audio controls");
  });

  test("generates cached TTS audio for an existing card", async () => {
    const server = makeTestServer({
      ttsSynthesize: async ({ text }: { text: string }) => Buffer.from(`audio:${text}`)
    });
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Cards", jlptLevel: "N4" });
    const created = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: { Expression: "確認", Reading: "かくにん", MeaningZh: "确认" },
        tags: ["audio"]
      })
    });
    const card = (await created.json()).card;

    const audio = await server.request(`/api/cards/${card.id}/audio`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ text: "確認" })
    });
    expect(audio.status).toBe(200);
    const payload = await audio.json();
    expect(payload.card.fields.Audio).toMatch(/^\[sound:.+\.mp3\]$/);
    const assets = server.services.db.prepare("SELECT * FROM media_assets").all();
    expect(assets).toHaveLength(1);
  });

  test("keeps TTS media linked to the source when refreshing audio for an approved generated card", async () => {
    const server = makeTestServer({
      ttsSynthesize: async ({ text }: { text: string }) => Buffer.from(`audio:${text}`)
    });
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Generated Source Audio", jlptLevel: "N4" });
    const sourceId = "source_audio_refresh";
    const now = new Date().toISOString();
    server.services.db
      .prepare(
        `INSERT INTO sources (id, type, url, title, content_text, content_hash, created_at)
         VALUES (?, 'text-material', 'text-material://source_audio_refresh', '音声教材', '発音を練習します。', 'hash-audio-refresh', ?)`
      )
      .run(sourceId, now);
    const note = createJapaneseNote(server.services.db, {
      deckId: deck.id,
      sourceId,
      fields: {
        Expression: "発音",
        Reading: "はつおん",
        MeaningZh: "发音",
        MeaningEn: "pronunciation",
        MeaningJa: "音を出すこと",
        SourceUrl: "text-material://source_audio_refresh"
      },
      tags: ["generated"]
    });

    const audio = await server.request(`/api/cards/${note.cards[0].id}/audio`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ text: "発音" })
    });

    expect(audio.status).toBe(200);
    const asset = server.services.db.prepare("SELECT original_name, source_id FROM media_assets").get() as any;
    expect(asset).toEqual({ original_name: "tts:test-tts:alloy:発音", source_id: sourceId });
  });

  test("keeps TTS cache entries separate for different configured voices", async () => {
    const spoken: Array<{ text: string; voice: string }> = [];
    const server = makeTestServer({
      ttsSynthesize: async ({ text, voice }: { text: string; voice: string }) => {
        spoken.push({ text, voice });
        return Buffer.from(`audio:${voice}:${text}`);
      }
    });
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Voice Cache", jlptLevel: "N4" });
    const created = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: { Expression: "発音", Reading: "はつおん", MeaningZh: "发音" },
        tags: ["audio"]
      })
    });
    const card = (await created.json()).card;

    const firstAudio = await server.request(`/api/cards/${card.id}/audio`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ text: "発音" })
    });
    const firstPayload = await firstAudio.json();

    server.services.config.openaiTtsVoice = "verse";
    const secondAudio = await server.request(`/api/cards/${card.id}/audio`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ text: "発音" })
    });
    const secondPayload = await secondAudio.json();

    expect(spoken).toEqual([
      { text: "発音", voice: "alloy" },
      { text: "発音", voice: "verse" }
    ]);
    expect(firstPayload.audio).not.toBe(secondPayload.audio);
    const assets = server.services.db.prepare("SELECT * FROM media_assets ORDER BY created_at").all();
    expect(assets).toHaveLength(2);
  });

  test("lists and deletes generated media assets", async () => {
    const server = makeTestServer({
      ttsSynthesize: async ({ text }: { text: string }) => Buffer.from(`audio:${text}`)
    });
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Media Library", jlptLevel: "N4" });
    const created = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: { Expression: "音声", Reading: "おんせい", MeaningZh: "音频" },
        tags: ["audio"]
      })
    });
    const card = (await created.json()).card;
    await server.request(`/api/cards/${card.id}/audio`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ text: "音声" })
    });

    const list = await server.request("/api/media", { headers: { cookie } });
    expect(list.status).toBe(200);
    const payload = await list.json();
    expect(payload.assets).toHaveLength(1);
    expect(payload.assets[0]).toMatchObject({
      originalName: "tts:test-tts:alloy:音声",
      mimeType: "audio/mpeg"
    });
    expect("path" in payload.assets[0]).toBe(false);

    const stored = server.services.db.prepare("SELECT * FROM media_assets WHERE id = ?").get(payload.assets[0].id) as any;
    expect(existsSync(stored.path)).toBe(true);

    const deletion = await server.request(`/api/media/${payload.assets[0].id}`, {
      method: "DELETE",
      headers: { cookie, "x-csrf-token": csrfToken }
    });
    expect(deletion.status).toBe(200);
    expect(existsSync(stored.path)).toBe(false);
    const remaining = server.services.db.prepare("SELECT * FROM media_assets").all();
    expect(remaining).toHaveLength(0);

    const cards = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie } });
    const cardPayload = await cards.json();
    expect(cardPayload.cards[0].fields.Audio).toBe("");
    expect(cardPayload.cards[0].answer).not.toContain("<audio controls");
  });

  test("removes deleted local image references from cards and drafts", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Media Images", jlptLevel: "N4" });
    const mediaPath = `${server.services.mediaDir}/pitch.png`;
    writeFileSync(mediaPath, Buffer.from("png"));
    server.services.db
      .prepare(
        `INSERT INTO media_assets (id, file_name, original_name, mime_type, path, checksum, source_id, created_at)
         VALUES ('media_image_1', 'pitch.png', 'pitch.png', 'image/png', ?, 'pitch-image-checksum', NULL, '2026-05-17T00:00:00.000Z')`
      )
      .run(mediaPath);

    const created = await server.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        fields: {
          Expression: "発音",
          Reading: "はつおん",
          MeaningZh: "发音",
          Example: '<img alt="pitch" src="pitch.png">発音を練習します。'
        },
        tags: ["image"]
      })
    });
    expect(created.status).toBe(201);

    server.services.db
      .prepare(
        `INSERT INTO generation_drafts (
          id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
          explanation_languages, raw_json, created_at, updated_at
        ) VALUES ('draft_image_1', NULL, ?, 'pronunciation', 'draft', '発音', 'pronunciation', ?, 'review-required',
          'zh,en,ja', '{}', '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z')`
      )
      .run(deck.id, JSON.stringify({ Expression: "発音", ExplanationZh: '<img src="pitch.png">説明' }));

    const deletion = await server.request("/api/media/media_image_1", {
      method: "DELETE",
      headers: { cookie, "x-csrf-token": csrfToken }
    });
    expect(deletion.status).toBe(200);

    const cards = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie } });
    const cardPayload = await cards.json();
    expect(cardPayload.cards[0].fields.Example).toBe("発音を練習します。");
    expect(cardPayload.cards[0].answer).not.toContain("pitch.png");

    const drafts = await server.request("/api/drafts", { headers: { cookie } });
    const draftPayload = await drafts.json();
    expect(draftPayload.drafts[0].fields.ExplanationZh).toBe("説明");
  });
});
