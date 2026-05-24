import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { makeTestServer } from "./helpers/server";
import { AnkiPackageWorker } from "../src/server/anki/worker";
import { createJapaneseNote, createNoteForNoteType, createNoteType } from "../src/server/cards/service";

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

describe("text learning material generation", () => {
  test("previews generation constraints for the selected Japanese deck", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Preview", jlptLevel: "N3" });

    const response = await server.request(`/api/generation/preview?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preview).toMatchObject({
      targetDeck: { id: deck.id, name: "Preview", jlptLevel: "N3" },
      jlptLevel: "N3",
      outputNoteType: "Japanese Vocabulary Grammar Pronunciation",
      maxDrafts: 40,
      provider: "local-fallback",
      pitchAccentPolicy: {
        lexiconSourceConfirms: false,
        aiSourceRequiresReview: true,
        field: "PitchAccentSource"
      }
    });
    expect(payload.preview.cardKinds).toEqual([
      { kind: "vocabulary", label: "Vocabulary", approvalCreatesAllTemplates: false },
      { kind: "grammar", label: "Grammar", approvalCreatesAllTemplates: false },
      { kind: "pronunciation", label: "Pronunciation", approvalCreatesAllTemplates: true }
    ]);
    expect(payload.preview.explanationLanguages.map((language: any) => language.code)).toEqual(["zh", "en", "ja"]);
    expect(JSON.stringify(payload)).not.toContain("test-session-secret");
  });

  test("previews selected deck coverage gaps before importing more study material", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "Imported Japanese", jlptLevel: "N4" });
    const childDeck = server.services.decks.createDeck({ name: "Imported Japanese::Grammar", parentId: parentDeck.id, jlptLevel: "N4" });
    const otherDeck = server.services.decks.createDeck({ name: "Other Japanese", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: parentDeck.id,
      templateNames: ["Recognize"],
      fields: {
        Expression: "予約",
        Reading: "よやく",
        MeaningZh: "预约",
        MeaningEn: "reservation",
        MeaningJa: "前もって約束すること"
      }
    });
    createJapaneseNote(server.services.db, {
      deckId: childDeck.id,
      templateNames: ["Grammar"],
      fields: {
        Expression: "〜ておく",
        MeaningZh: "预先做",
        MeaningEn: "do in advance",
        MeaningJa: "前もってする"
      }
    });
    createJapaneseNote(server.services.db, {
      deckId: otherDeck.id,
      templateNames: ["Pronunciation"],
      fields: {
        Expression: "橋",
        Reading: "はし",
        PitchAccent: "2",
        MeaningZh: "桥",
        MeaningEn: "bridge",
        MeaningJa: "川などにかけるもの"
      }
    });

    const response = await server.request(`/api/generation/preview?deckId=${parentDeck.id}`, { headers: { cookie: auth.cookie } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preview.deckCoverage).toMatchObject({
      scope: "deck",
      targetDeckId: parentDeck.id,
      totalJapaneseNotes: 2,
      needsMaterial: true,
      insufficientKinds: ["vocabulary", "grammar", "pronunciation"]
    });
    expect(payload.preview.deckCoverage.kinds).toEqual([
      { kind: "vocabulary", label: "Vocabulary", current: 1, recommendedMinimum: 20, missing: 19, insufficient: true },
      { kind: "grammar", label: "Grammar", current: 1, recommendedMinimum: 10, missing: 9, insufficient: true },
      { kind: "pronunciation", label: "Pronunciation", current: 0, recommendedMinimum: 10, missing: 10, insufficient: true }
    ]);
  });

  test("classifies pronunciation coverage without inflating vocabulary counts", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Pronunciation Coverage", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      createAllTemplates: true,
      fields: {
        Expression: "橋",
        Reading: "はし",
        PitchAccent: "2",
        MeaningZh: "桥",
        MeaningEn: "bridge",
        MeaningJa: "川などにかけるもの"
      }
    });

    const response = await server.request(`/api/generation/preview?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preview.deckCoverage.kinds).toEqual([
      { kind: "vocabulary", label: "Vocabulary", current: 0, recommendedMinimum: 20, missing: 20, insufficient: true },
      { kind: "grammar", label: "Grammar", current: 0, recommendedMinimum: 10, missing: 10, insufficient: true },
      { kind: "pronunciation", label: "Pronunciation", current: 1, recommendedMinimum: 10, missing: 9, insufficient: true }
    ]);
  });

  test("classifies manually tagged Japanese grammar cards even with generic templates", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Manual Grammar Coverage", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      templateNames: ["Recognize"],
      fields: {
        Expression: "〜ておく",
        Reading: "ておく",
        MeaningZh: "预先做",
        MeaningEn: "do in advance",
        MeaningJa: "前もってする"
      },
      tags: ["grammar"]
    });

    const response = await server.request(`/api/generation/preview?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preview.deckCoverage.kinds).toEqual([
      { kind: "vocabulary", label: "Vocabulary", current: 0, recommendedMinimum: 20, missing: 20, insufficient: true },
      { kind: "grammar", label: "Grammar", current: 1, recommendedMinimum: 10, missing: 9, insufficient: true },
      { kind: "pronunciation", label: "Pronunciation", current: 0, recommendedMinimum: 10, missing: 10, insufficient: true }
    ]);
  });

  test("keeps explicitly tagged Japanese vocabulary cards from inflating pronunciation coverage", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Vocabulary Coverage", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      templateNames: ["Recognize"],
      fields: {
        Expression: "発音",
        Reading: "はつおん",
        MeaningZh: "发音",
        MeaningEn: "pronunciation",
        MeaningJa: "音を出すこと"
      },
      tags: ["vocabulary"]
    });

    const response = await server.request(`/api/generation/preview?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preview.deckCoverage.kinds).toEqual([
      { kind: "vocabulary", label: "Vocabulary", current: 1, recommendedMinimum: 20, missing: 19, insufficient: true },
      { kind: "grammar", label: "Grammar", current: 0, recommendedMinimum: 10, missing: 10, insufficient: true },
      { kind: "pronunciation", label: "Pronunciation", current: 0, recommendedMinimum: 10, missing: 10, insufficient: true }
    ]);
  });

  test("counts external Anki note types when previewing imported deck coverage", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "External Japanese Deck", jlptLevel: "N4" });
    const noteType = createNoteType(server.services.db, {
      name: "Imported Basic",
      css: "",
      fields: ["Front", "Back"],
      templates: [{ name: "Card 1", questionFormat: "{{Front}}", answerFormat: "{{FrontSide}}<hr>{{Back}}" }]
    });
    createNoteForNoteType(server.services.db, {
      deckId: deck.id,
      noteTypeId: noteType.id,
      fields: { Front: "予約", Back: "よやく / reservation" },
      tags: ["vocabulary"]
    });
    createNoteForNoteType(server.services.db, {
      deckId: deck.id,
      noteTypeId: noteType.id,
      fields: { Front: "〜ておく", Back: "do in advance / 旅行の前に予約しておきます" },
      tags: []
    });
    createNoteForNoteType(server.services.db, {
      deckId: deck.id,
      noteTypeId: noteType.id,
      fields: { Front: "橋（はし）", Back: "pitch accent [2] / bridge" },
      tags: ["pronunciation"]
    });

    const response = await server.request(`/api/generation/preview?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preview.deckCoverage).toMatchObject({
      totalJapaneseNotes: 3,
      insufficientKinds: ["vocabulary", "grammar", "pronunciation"]
    });
    expect(payload.preview.deckCoverage.kinds).toEqual([
      { kind: "vocabulary", label: "Vocabulary", current: 1, recommendedMinimum: 20, missing: 19, insufficient: true },
      { kind: "grammar", label: "Grammar", current: 1, recommendedMinimum: 10, missing: 9, insufficient: true },
      { kind: "pronunciation", label: "Pronunciation", current: 1, recommendedMinimum: 10, missing: 9, insufficient: true }
    ]);
  });

  test("focuses local fallback drafts on selected deck coverage gaps", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Covered Vocabulary", jlptLevel: "N4" });
    for (let index = 0; index < 20; index += 1) {
      createJapaneseNote(server.services.db, {
        deckId: deck.id,
        templateNames: ["Recognize"],
        fields: {
          Expression: `語彙${index}`,
          Reading: `ごい${index}`,
          MeaningZh: "词汇",
          MeaningEn: "vocabulary",
          MeaningJa: "語彙"
        }
      });
    }

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "文法と発音の復習",
        text: "授業では文法を確認して、例文を声に出して発音練習しました。旅行の前に予約しておきます。"
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts.map((draft: any) => draft.kind)).toEqual(["grammar", "pronunciation"]);
    expect(payload.drafts.every((draft: any) => draft.fields.SourceUrl === `text-material://${payload.importId}`)).toBe(true);
  });

  test("previews the saved default JLPT level when no target deck is selected", async () => {
    const server = makeTestServer();
    const auth = await login(server);

    await server.request("/api/settings/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        defaultJlptLevel: "N2",
        packageImport: { includeScheduling: false },
        packageExport: { includeMedia: true, includeScheduling: false, legacySupport: true }
      })
    });

    const response = await server.request("/api/generation/preview", { headers: { cookie: auth.cookie } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preview).toMatchObject({
      targetDeck: null,
      jlptLevel: "N2"
    });
  });

  test("keeps generated lexicon pitch accent under review until a lexicon source is configured", async () => {
    const server = makeTestServer({
      generateDrafts: async () => ({
        drafts: [
          {
            kind: "vocabulary",
            expression: "橋",
            reading: "はし",
            pitchAccent: "2",
            pitchAccentSource: "lexicon",
            meanings: { zh: "桥", en: "bridge", ja: "川などにかけるもの" },
            example: "橋を渡ります。",
            exampleReading: "はしをわたります。",
            explanation: { zh: "词典候选仍需确认来源。", en: "Lexicon candidate still needs source verification.", ja: "辞書候補も出典確認が必要です。" },
            tags: ["pitch"]
          }
        ]
      })
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Pitch Review", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "音調",
        text: "橋とはしのアクセントを比べました。発音を確認して、例文を何度も読みました。"
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts[0].fields.PitchAccentSource).toBe("lexicon");
    expect(payload.drafts[0].pitchAccentStatus).toBe("review-required");
  });

  test("confirms generated lexicon pitch accent when a lexicon source is configured", async () => {
    const server = makeTestServer({
      pitchAccentLexiconSource: "nhk-accent",
      generateDrafts: async () => ({
        drafts: [
          {
            kind: "vocabulary",
            expression: "雨",
            reading: "あめ",
            pitchAccent: "1",
            pitchAccentSource: "lexicon",
            meanings: { zh: "雨", en: "rain", ja: "空から降る水" },
            example: "雨が降っています。",
            exampleReading: "あめがふっています。",
            explanation: { zh: "词典来源已配置。", en: "Lexicon source is configured.", ja: "辞書出典が設定されています。" },
            tags: ["pitch"]
          }
        ]
      })
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Pitch Confirmed", jlptLevel: "N5" });

    const preview = await server.request(`/api/generation/preview?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    await expect(preview.json()).resolves.toMatchObject({
      preview: {
        pitchAccentPolicy: {
          lexiconSourceConfirms: true
        }
      }
    });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N5",
        title: "雨の音",
        text: "雨の音を聞いて、発音とアクセントを練習しました。"
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts[0].fields.PitchAccentSource).toBe("lexicon");
    expect(payload.drafts[0].pitchAccentStatus).toBe("confirmed");
  });

  test("reuses an existing learning source when the same normalized text material is imported again", async () => {
    const generatedExpressions = ["予約", "確認"];
    const server = makeTestServer({
      generateDrafts: async () => ({
        drafts: [
          {
            kind: "vocabulary",
            expression: generatedExpressions.shift() ?? "復習",
            reading: "よやく",
            pitchAccent: null,
            pitchAccentSource: "none",
            meanings: { zh: "学习", en: "study", ja: "勉強すること" },
            example: "毎日語彙を復習します。",
            exampleReading: "まいにちごいをふくしゅうします。",
            explanation: { zh: "重复资料生成。", en: "Generated from repeated material.", ja: "重複資料から生成。" },
            tags: ["dedupe"]
          }
        ]
      })
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Duplicate Source", jlptLevel: "N4" });
    const body = {
      deckId: deck.id,
      jlptLevel: "N4",
      title: "重複ノート",
      text: "今日は学校で新しい文法を勉強しました。先生は例文を読んで、発音を何度も練習しました。"
    };

    const first = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify(body)
    });
    const firstPayload = await first.json();
    const second = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ ...body, text: `\n${body.text}\n` })
    });

    expect(second.status).toBe(200);
    const secondPayload = await second.json();
    expect(secondPayload.sourceId).toBe(firstPayload.sourceId);
    expect(secondPayload.importId).not.toBe(firstPayload.importId);
    expect(secondPayload.drafts[0].fields.Expression).toBe("確認");
    expect(secondPayload.drafts[0].fields.SourceUrl).toBe(firstPayload.drafts[0].fields.SourceUrl);
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM sources WHERE type = 'text-material'").get()).toEqual({ count: 1 });
    const draftRows = server.services.db
      .prepare("SELECT front, status FROM generation_drafts WHERE source_id = ? ORDER BY created_at")
      .all(firstPayload.sourceId) as Array<{ front: string; status: string }>;
    expect(draftRows).toEqual([
      { front: "予約", status: "rejected" },
      { front: "確認", status: "draft" }
    ]);
  });

  test("generates drafts from an uploaded text study material file", async () => {
    const seenInputs: Array<{ title: string; text: string; jlptLevel: string }> = [];
    const server = makeTestServer({
      generateDrafts: async (input) => {
        seenInputs.push(input);
        return {
          drafts: [
            {
              kind: "grammar",
              expression: "〜ておく",
              reading: "",
              pitchAccent: null,
              pitchAccentSource: "none",
              meanings: { zh: "事先做", en: "do in advance", ja: "前もってする" },
              example: "旅行の前に予約しておきます。",
              exampleReading: "りょこうのまえによやくしておきます。",
              explanation: {
                zh: "从上传的课堂笔记生成。",
                en: "Generated from uploaded class notes.",
                ja: "アップロードした授業ノートから生成。"
              },
              tags: ["uploaded"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Uploaded Notes", jlptLevel: "N3" });
    const form = new FormData();
    form.set("deckId", deck.id);
    form.set("jlptLevel", "N3");
    form.set(
      "file",
      new File(
        [
          "# 授業ノート\n旅行の前にホテルを予約しておきます。授業では文法、語彙、発音を確認して、例文を何度も読みました。"
        ],
        "lesson-notes.md",
        { type: "text/markdown" }
      )
    );

    const response = await server.request("/api/generation/from-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    const payload = await response.json();
    expect(payload.drafts).toHaveLength(1);
    expect(payload.drafts[0]).toMatchObject({
      kind: "grammar",
      deckId: deck.id,
      fields: {
        Expression: "〜ておく"
      }
    });
    expect(payload.drafts[0].fields.SourceUrl).toBe(`text-material://${payload.importId}`);
    const source = server.services.db.prepare("SELECT title FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.title).toBe("lesson-notes");
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0]).toMatchObject({
      title: "lesson-notes",
      jlptLevel: "N3"
    });
    expect(seenInputs[0].text).toContain("ホテルを予約しておきます");
  });

  test("extracts readable Japanese text from an uploaded HTML study material file", async () => {
    const seenInputs: Array<{ title: string; text: string; jlptLevel: string }> = [];
    const server = makeTestServer({
      generateDrafts: async (input) => {
        seenInputs.push(input);
        return {
          drafts: [
            {
              kind: "grammar",
              expression: "〜ておく",
              reading: "",
              pitchAccent: null,
              pitchAccentSource: "none",
              meanings: { zh: "事先做", en: "do in advance", ja: "前もってする" },
              example: "旅行の前に予約しておきます。",
              exampleReading: "りょこうのまえによやくしておきます。",
              explanation: {
                zh: "从 HTML 学习资料生成。",
                en: "Generated from HTML study material.",
                ja: "HTML教材から生成。"
              },
              tags: ["html"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "HTML Notes", jlptLevel: "N4" });
    const form = new FormData();
    form.set("deckId", deck.id);
    form.set(
      "file",
      new File(
        [
          `<!doctype html>
          <html>
            <head><title>ignored title</title><style>.ad { display: none; }</style><script>removeMe()</script></head>
            <body>
              <nav>サイトメニュー</nav>
              <main>
                <h1>第3課 文法</h1>
                <iframe>外部広告の埋め込みテキスト</iframe>
                <canvas>グラフのフォールバックテキスト</canvas>
                <p>旅行の前にホテルを予約しておきます。文法、語彙、発音を一緒に確認します。</p>
                <ul><li>例文を声に出して練習します。</li></ul>
              </main>
            </body>
          </html>`
        ],
        "grammar-lesson.html",
        { type: "text/html" }
      )
    );

    const response = await server.request("/api/generation/from-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    const payload = await response.json();
    expect(payload.drafts[0].fields.SourceUrl).toBe(`text-material://${payload.importId}`);
    const source = server.services.db.prepare("SELECT title, content_text FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.title).toBe("grammar-lesson");
    expect(source.content_text).toContain("第3課 文法");
    expect(source.content_text).toContain("ホテルを予約しておきます");
    expect(source.content_text).toContain("例文を声に出して練習します");
    expect(source.content_text).not.toContain("removeMe");
    expect(source.content_text).not.toContain("サイトメニュー");
    expect(source.content_text).not.toContain("外部広告");
    expect(source.content_text).not.toContain("フォールバック");
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0]).toMatchObject({ title: "grammar-lesson", jlptLevel: "N4" });
    expect(seenInputs[0].text).toContain("文法、語彙、発音");
    expect(seenInputs[0].text).not.toContain("<main>");
  });

  test("extracts readable Japanese text from an uploaded subtitle study material file", async () => {
    const seenInputs: Array<{ title: string; text: string }> = [];
    const server = makeTestServer({
      generateDrafts: async (input) => {
        seenInputs.push(input);
        return {
          drafts: [
            {
              kind: "pronunciation",
              expression: "発音",
              reading: "はつおん",
              pitchAccent: null,
              pitchAccentSource: "none",
              meanings: { zh: "发音", en: "pronunciation", ja: "音の出し方" },
              example: "発音を確認します。",
              exampleReading: "はつおんをかくにんします。",
              explanation: {
                zh: "从字幕听力材料生成。",
                en: "Generated from subtitle listening material.",
                ja: "字幕教材から生成。"
              },
              tags: ["subtitle"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Subtitle Listening", jlptLevel: "N4" });
    const form = new FormData();
    form.set("deckId", deck.id);
    form.set(
      "file",
      new File(
        [
          `1
00:00:01,000 --> 00:00:03,000
旅行の前にホテルを予約します。

2
00:00:03,500 --> 00:00:06,000
発音を聞いて、声に出して練習します。`
        ],
        "listening-practice.srt",
        { type: "application/x-subrip" }
      )
    );

    const response = await server.request("/api/generation/from-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    const payload = await response.json();
    expect(payload.drafts[0].fields.SourceUrl).toBe(`text-material://${payload.importId}`);
    const source = server.services.db.prepare("SELECT title, content_text FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.title).toBe("listening-practice");
    expect(source.content_text).toContain("ホテルを予約します");
    expect(source.content_text).toContain("声に出して練習します");
    expect(source.content_text).not.toContain("-->");
    expect(source.content_text).not.toContain("00:00");
    expect(seenInputs[0].text).not.toContain("-->");
  });

  test("drops WebVTT note blocks from uploaded subtitle study material", async () => {
    const seenInputs: Array<{ title: string; text: string }> = [];
    const server = makeTestServer({
      generateDrafts: async (input) => {
        seenInputs.push(input);
        return {
          drafts: [
            {
              kind: "vocabulary",
              expression: "予約",
              reading: "よやく",
              pitchAccent: null,
              pitchAccentSource: "none",
              meanings: { zh: "预约", en: "reservation", ja: "前もって約束すること" },
              example: "ホテルを予約します。",
              exampleReading: "ホテルをよやくします。",
              explanation: {
                zh: "从字幕正文生成。",
                en: "Generated from subtitle cue text.",
                ja: "字幕本文から生成。"
              },
              tags: ["subtitle"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "VTT Listening", jlptLevel: "N4" });
    const form = new FormData();
    form.set("deckId", deck.id);
    form.set(
      "file",
      new File(
        [
          `WEBVTT

NOTE
Internal editor note: do not generate cards from this line.
注釈用メモは教材ではありません。

00:00:01.000 --> 00:00:03.000
<v 先生>ホテルを予約します。</v>

00:00:03.500 --> 00:00:06.000
旅行の前に確認します。`
        ],
        "lesson-notes.vtt",
        { type: "text/vtt" }
      )
    );

    const response = await server.request("/api/generation/from-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    const payload = await response.json();
    const source = server.services.db.prepare("SELECT title, content_text FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.title).toBe("lesson-notes");
    expect(source.content_text).toContain("ホテルを予約します");
    expect(source.content_text).toContain("旅行の前に確認します");
    expect(source.content_text).not.toContain("Internal editor note");
    expect(source.content_text).not.toContain("注釈用メモ");
    expect(seenInputs[0].text).not.toContain("Internal editor note");
    expect(seenInputs[0].text).not.toContain("注釈用メモ");
  });

  test("extracts readable Japanese text from an uploaded DOCX study material file", async () => {
    const seenInputs: Array<{ title: string; text: string; jlptLevel: string }> = [];
    const server = makeTestServer({
      generateDrafts: async (input) => {
        seenInputs.push(input);
        return {
          drafts: [
            {
              kind: "grammar",
              expression: "〜ことができる",
              reading: "",
              pitchAccent: null,
              pitchAccentSource: "none",
              meanings: { zh: "能够", en: "can do", ja: "可能を表す" },
              example: "日本語で予約することができます。",
              exampleReading: "にほんごでよやくすることができます。",
              explanation: {
                zh: "从 Word 学习资料生成。",
                en: "Generated from Word study material.",
                ja: "Word教材から生成。"
              },
              tags: ["docx"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "DOCX Notes", jlptLevel: "N4" });
    const docx = new JSZip();
    docx.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      </Types>`
    );
    docx.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`
    );
    docx.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>第4課 Word ノート</w:t></w:r></w:p>
          <w:p><w:r><w:t>日本語で予約することができます。</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>語彙、文法、発音を確認します。</w:t></w:r></w:p>
        </w:body>
      </w:document>`
    );
    const form = new FormData();
    form.set("deckId", deck.id);
    form.set(
      "file",
      new File([Buffer.from(await docx.generateAsync({ type: "uint8array" }))], "word-lesson.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
    );

    const response = await server.request("/api/generation/from-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    const payload = await response.json();
    expect(payload.drafts[0].fields.SourceUrl).toBe(`text-material://${payload.importId}`);
    const source = server.services.db.prepare("SELECT title, content_text FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.title).toBe("word-lesson");
    expect(source.content_text).toContain("第4課 Word ノート");
    expect(source.content_text).toContain("日本語で予約することができます。 語彙、文法、発音を確認します。");
    expect(source.content_text).not.toContain("<w:t>");
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0]).toMatchObject({ title: "word-lesson", jlptLevel: "N4" });
    expect(seenInputs[0].text).toContain("予約することができます");
  });

  test("extracts multiple readable study material files from an uploaded ZIP bundle", async () => {
    const seenInputs: Array<{ title: string; text: string; jlptLevel: string }> = [];
    const server = makeTestServer({
      generateDrafts: async (input) => {
        seenInputs.push(input);
        return {
          drafts: [
            {
              kind: "vocabulary",
              expression: "予約",
              reading: "よやく",
              pitchAccent: null,
              pitchAccentSource: "none",
              meanings: { zh: "预约", en: "reservation", ja: "前もって約束すること" },
              example: "ホテルを予約します。",
              exampleReading: "ホテルをよやくします。",
              explanation: {
                zh: "从 ZIP 学习资料包生成。",
                en: "Generated from a ZIP study material bundle.",
                ja: "ZIP教材パックから生成。"
              },
              tags: ["zip"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "ZIP Notes", jlptLevel: "N4" });
    const bundle = new JSZip();
    bundle.file("week-01.md", "# 第1週\nホテルを予約します。語彙、文法、発音を確認します。");
    bundle.file(
      "grammar/lesson.html",
      `<html><body><nav>メニュー</nav><main><p>旅行の前に予約しておきます。</p><script>ignored()</script></main></body></html>`
    );
    bundle.file("tables/vocab.csv", "Expression,Reading,MeaningEn,Example\n確認,かくにん,confirmation,予約を確認します。");
    bundle.file("images/ignored.png", Buffer.from([0, 1, 2, 3]));
    const form = new FormData();
    form.set("deckId", deck.id);
    form.set("file", new File([Buffer.from(await bundle.generateAsync({ type: "uint8array" }))], "lesson-pack.zip", { type: "application/zip" }));

    const response = await server.request("/api/generation/from-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    const payload = await response.json();
    expect(payload.drafts[0].fields.SourceUrl).toBe(`text-material://${payload.importId}`);
    const source = server.services.db.prepare("SELECT title, content_text FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.title).toBe("lesson-pack");
    expect(source.content_text).toContain("## week-01.md");
    expect(source.content_text).toContain("ホテルを予約します");
    expect(source.content_text).toContain("## grammar/lesson.html");
    expect(source.content_text).toContain("旅行の前に予約しておきます");
    expect(source.content_text).toContain("## tables/vocab.csv");
    expect(source.content_text).toContain("Expression: 確認");
    expect(source.content_text).not.toContain("ignored.png");
    expect(source.content_text).not.toContain("メニュー");
    expect(source.content_text).not.toContain("ignored()");
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0]).toMatchObject({ title: "lesson-pack", jlptLevel: "N4" });
    expect(seenInputs[0].text).toContain("confirmation");
  });

  test("preserves ruby furigana from uploaded HTML study material", async () => {
    const seenInputs: Array<{ title: string; text: string; jlptLevel: string }> = [];
    const server = makeTestServer({
      generateDrafts: async (input) => {
        seenInputs.push(input);
        return {
          drafts: [
            {
              kind: "pronunciation",
              expression: "発音",
              reading: "はつおん",
              pitchAccent: null,
              pitchAccentSource: "none",
              meanings: { zh: "发音", en: "pronunciation", ja: "音を出すこと" },
              example: "発音を確認します。",
              exampleReading: "はつおんをかくにんします。",
              explanation: {
                zh: "从带注音的 HTML 资料生成。",
                en: "Generated from HTML study material with furigana.",
                ja: "ふりがな付きHTML教材から生成。"
              },
              tags: ["furigana"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Ruby HTML", jlptLevel: "N4" });
    const form = new FormData();
    form.set("deckId", deck.id);
    form.set(
      "file",
      new File(
        [
          `<html>
            <head><title>ignored</title></head>
            <body>
              <main>
                <p><ruby>予約<rt>よやく</rt></ruby>を確認しました。</p>
                <p><ruby>発音<rt>はつおん</rt></ruby>を練習します。</p>
              </main>
            </body>
          </html>`
        ],
        "ruby-lesson.html",
        { type: "text/html" }
      )
    );

    const response = await server.request("/api/generation/from-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0].text).toContain("予約（よやく）を確認しました");
    expect(seenInputs[0].text).toContain("発音（はつおん）を練習します");
    expect(seenInputs[0].text).not.toContain("予約よやく");
    const payload = await response.json();
    const source = server.services.db.prepare("SELECT content_text FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.content_text).toBe(seenInputs[0].text);
  });

  test("normalizes uploaded CSV and TSV vocabulary tables into readable study material", async () => {
    const seenInputs: Array<{ title: string; text: string; jlptLevel: string }> = [];
    const server = makeTestServer({
      generateDrafts: async (input) => {
        seenInputs.push(input);
        return {
          drafts: [
            {
              kind: "vocabulary",
              expression: "予約",
              reading: "よやく",
              pitchAccent: "0",
              pitchAccentSource: "ai",
              meanings: { zh: "预约", en: "reservation", ja: "前もって約束すること" },
              example: "レストランを予約しました。",
              exampleReading: "れすとらんをよやくしました。",
              explanation: {
                zh: "从词汇表生成。",
                en: "Generated from a vocabulary table.",
                ja: "語彙表から生成。"
              },
              tags: ["table"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Vocabulary Tables", jlptLevel: "N4" });
    const form = new FormData();
    form.set("title", "N4 語彙表");
    form.set("deckId", deck.id);
    form.append(
      "files",
      new File(
        [
          'Expression,Reading,MeaningZh,MeaningEn,Example\n予約,よやく,预约,reservation,レストランを予約しました。\n"復習,確認",ふくしゅう,复习,review,"語彙,文法を復習します。"'
        ],
        "vocabulary.csv",
        { type: "text/csv" }
      )
    );
    form.append(
      "files",
      new File(["Expression\tReading\tMeaningEn\tExample\n発音\tはつおん\tpronunciation\t発音を確認します。"], "pronunciation.tsv", {
        type: "text/tab-separated-values"
      })
    );

    const response = await server.request("/api/generation/from-files", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    const payload = await response.json();
    expect(payload.drafts[0].fields.SourceUrl).toBe(`text-material://${payload.importId}`);
    const source = server.services.db.prepare("SELECT title, content_text FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.title).toBe("N4 語彙表");
    expect(source.content_text).toContain("## vocabulary.csv");
    expect(source.content_text).toContain("Row 1");
    expect(source.content_text).toContain("Expression: 予約");
    expect(source.content_text).toContain("Example: レストランを予約しました。");
    expect(source.content_text).toContain("Expression: 復習,確認");
    expect(source.content_text).toContain("Example: 語彙,文法を復習します。");
    expect(source.content_text).toContain("## pronunciation.tsv");
    expect(source.content_text).toContain("Expression: 発音");
    expect(source.content_text).toContain("MeaningEn: pronunciation");
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0].text).toContain("Reading: よやく");
    expect(seenInputs[0].text).toContain("Reading: はつおん");
  });

  test("creates vocabulary drafts directly from structured CSV tables without an AI provider", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Offline Vocabulary Table", jlptLevel: "N4" });
    const form = new FormData();
    form.set("title", "N4 CSV");
    form.set("deckId", deck.id);
    form.set(
      "file",
      new File(
        [
          [
            "Expression,Reading,MeaningZh,MeaningEn,MeaningJa,Example,ExampleReading,PitchAccent,PitchAccentSource,Tags",
            "予約,よやく,预约,reservation,前もって約束すること,レストランを予約しました。,れすとらんをよやくしました,0,ai,N4 vocabulary",
            "発音,はつおん,发音,pronunciation,音を出すこと,発音を確認します。,はつおんをかくにんします,0,none,N4 pronunciation"
          ].join("\n")
        ],
        "n4-vocabulary.csv",
        { type: "text/csv" }
      )
    );

    const response = await server.request("/api/generation/from-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    const payload = await response.json();
    expect(payload.drafts).toHaveLength(2);
    expect(payload.drafts[0]).toMatchObject({
      kind: "vocabulary",
      deckId: deck.id,
      pitchAccentStatus: "review-required",
      fields: {
        Expression: "予約",
        Reading: "よやく",
        MeaningZh: "预约",
        MeaningEn: "reservation",
        MeaningJa: "前もって約束すること",
        Example: "レストランを予約しました。",
        ExampleReading: "れすとらんをよやくしました",
        PitchAccent: "0",
        PitchAccentSource: "ai"
      }
    });
    expect(payload.drafts[0].fields.ExplanationZh).toContain("N4 CSV");
    expect(payload.drafts[0].raw.tags).toEqual(["N4", "vocabulary"]);
    expect(payload.drafts[1]).toMatchObject({
      kind: "vocabulary",
      fields: {
        Expression: "発音",
        Reading: "はつおん",
        MeaningEn: "pronunciation",
        PitchAccentSource: "none"
      }
    });
    const source = server.services.db.prepare("SELECT content_text FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.content_text).toContain("Row 1\nExpression: 予約");
    expect(source.content_text).toContain("Row 2\nExpression: 発音");
  });

  test("creates drafts directly from Japanese-labeled CSV tables without an AI provider", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "日本語ラベル表", jlptLevel: "N4" });
    const form = new FormData();
    form.set("title", "日本語 CSV");
    form.set("deckId", deck.id);
    form.set(
      "file",
      new File(
        [
          [
            "種類,表現,読み,意味中文,意味英語,意味日本語,例文,例文読み,アクセント,アクセントソース,タグ",
            "語彙,予約,よやく,预约,reservation,前もって約束すること,ホテルを予約しておきます。,ほてるをよやくしておきます,0,AI,N4 語彙",
            "文法,〜ておく,ておく,预先做,do in advance,前もってする,ホテルを予約しておきます。,ほてるをよやくしておきます,,なし,N4 文法"
          ].join("\n")
        ],
        "nihongo-labels.csv",
        { type: "text/csv" }
      )
    );

    const response = await server.request("/api/generation/from-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    const payload = await response.json();
    expect(payload.drafts).toHaveLength(2);
    expect(payload.drafts[0]).toMatchObject({
      kind: "vocabulary",
      deckId: deck.id,
      pitchAccentStatus: "review-required",
      fields: {
        Expression: "予約",
        Reading: "よやく",
        MeaningZh: "预约",
        MeaningEn: "reservation",
        MeaningJa: "前もって約束すること",
        Example: "ホテルを予約しておきます。",
        ExampleReading: "ほてるをよやくしておきます",
        PitchAccent: "0",
        PitchAccentSource: "ai"
      }
    });
    expect(payload.drafts[1]).toMatchObject({
      kind: "grammar",
      fields: {
        Expression: "〜ておく",
        Reading: "ておく",
        MeaningZh: "预先做",
        MeaningEn: "do in advance",
        MeaningJa: "前もってする",
        PitchAccentSource: "none"
      }
    });
    const source = server.services.db.prepare("SELECT content_text FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.content_text).toContain("Row 1\n種類: 語彙");
    expect(source.content_text).toContain("表現: 予約");
  });

  test("creates drafts directly from Chinese-labeled Japanese study tables without an AI provider", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "中文日语资料", jlptLevel: "N3" });
    const form = new FormData();
    form.set("title", "中文列名 CSV");
    form.set("deckId", deck.id);
    form.set(
      "file",
      new File(
        [
          [
            "类型,表达,读音,中文释义,英文释义,日文释义,例句,例句读音,声调,声调来源,标签",
            "词汇,確認,かくにん,确认,confirmation,確かめること,予約を確認しました。,よやくをかくにんしました,0,AI,N3 词汇",
            "语法,〜ようにする,ようにする,尽量做,make an effort to,努力して行う,毎日復習するようにします。,まいにちふくしゅうするようにします,,无,N3 语法"
          ].join("\n")
        ],
        "chinese-labels.csv",
        { type: "text/csv" }
      )
    );

    const response = await server.request("/api/generation/from-file", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    const payload = await response.json();
    expect(payload.drafts).toHaveLength(2);
    expect(payload.drafts[0]).toMatchObject({
      kind: "vocabulary",
      deckId: deck.id,
      pitchAccentStatus: "review-required",
      fields: {
        Expression: "確認",
        Reading: "かくにん",
        MeaningZh: "确认",
        MeaningEn: "confirmation",
        MeaningJa: "確かめること",
        Example: "予約を確認しました。",
        ExampleReading: "よやくをかくにんしました",
        PitchAccent: "0",
        PitchAccentSource: "ai"
      }
    });
    expect(payload.drafts[1]).toMatchObject({
      kind: "grammar",
      fields: {
        Expression: "〜ようにする",
        Reading: "ようにする",
        MeaningZh: "尽量做",
        MeaningEn: "make an effort to",
        MeaningJa: "努力して行う",
        PitchAccentSource: "none"
      }
    });
    expect(payload.drafts[0].raw.tags).toEqual(["N3", "词汇", "vocabulary"]);
    const source = server.services.db.prepare("SELECT content_text FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.content_text).toContain("Row 1\n类型: 词汇");
    expect(source.content_text).toContain("表达: 確認");
  });

  test("generates one draft batch from multiple uploaded text study material files", async () => {
    const seenInputs: Array<{ title: string; text: string; jlptLevel: string }> = [];
    const server = makeTestServer({
      generateDrafts: async (input) => {
        seenInputs.push(input);
        return {
          drafts: [
            {
              kind: "vocabulary",
              expression: "復習",
              reading: "ふくしゅう",
              pitchAccent: "0",
              pitchAccentSource: "ai",
              meanings: { zh: "复习", en: "review", ja: "学んだことをもう一度確認すること" },
              example: "週末に語彙と文法を復習します。",
              exampleReading: "しゅうまつにごいとぶんぽうをふくしゅうします。",
              explanation: {
                zh: "从多份学习资料合并生成。",
                en: "Generated from multiple uploaded study materials.",
                ja: "複数の学習資料から生成。"
              },
              tags: ["batch"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Batch Notes", jlptLevel: "N4" });
    const form = new FormData();
    form.set("title", "春学期ノート");
    form.set("deckId", deck.id);
    form.append(
      "files",
      new File(["# 語彙\n週末に語彙を復習します。発音も確認します。"], "week-01.md", { type: "text/markdown" })
    );
    form.append(
      "files",
      new File(["# 文法\n文法の例文を作って、声に出して練習します。"], "week-02.txt", { type: "text/plain" })
    );

    const response = await server.request("/api/generation/from-files", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status, await response.clone().text()).toBe(201);
    const payload = await response.json();
    expect(payload.drafts).toHaveLength(1);
    expect(payload.drafts[0]).toMatchObject({
      kind: "vocabulary",
      deckId: deck.id,
      fields: {
        Expression: "復習",
        PitchAccentSource: "ai"
      },
      pitchAccentStatus: "review-required"
    });
    expect(payload.drafts[0].fields.SourceUrl).toBe(`text-material://${payload.importId}`);
    const source = server.services.db.prepare("SELECT title, content_text FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.title).toBe("春学期ノート");
    expect(source.content_text).toContain("week-01.md");
    expect(source.content_text).toContain("週末に語彙を復習します");
    expect(source.content_text).toContain("week-02.txt");
    expect(source.content_text).toContain("文法の例文を作って");
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0]).toMatchObject({
      title: "春学期ノート",
      jlptLevel: "N4"
    });
    expect(seenInputs[0].text).toContain("week-01.md");
    expect(seenInputs[0].text).toContain("week-02.txt");
  });

  test("rejects batch study material uploads that contain no readable text", async () => {
    let generationCalls = 0;
    const server = makeTestServer({
      generateDrafts: async () => {
        generationCalls += 1;
        return {
          drafts: [
            {
              kind: "vocabulary",
              expression: "復習",
              reading: "ふくしゅう",
              pitchAccent: "0",
              pitchAccentSource: "ai",
              meanings: { zh: "复习", en: "review", ja: "学んだことを確認すること" },
              example: "復習します。",
              exampleReading: "ふくしゅうします。",
              explanation: {
                zh: "不应为不可读资料生成。",
                en: "Should not generate from unreadable material.",
                ja: "読めない資料から生成しません。"
              },
              tags: ["batch"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const form = new FormData();
    form.set("title", "Empty web captures");
    form.append("files", new File(["<html><body><nav>Menu</nav><script>ignored()</script></body></html>"], "nav-only.html", { type: "text/html" }));
    form.append("files", new File(["<html><body><header>Header</header><footer>Footer</footer></body></html>"], "chrome-only.html", { type: "text/html" }));

    const response = await server.request("/api/generation/from-files", {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe("Invalid text material files");
    expect(generationCalls).toBe(0);
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM imports").get()).toEqual({ count: 0 });
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM sources").get()).toEqual({ count: 0 });
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM generation_drafts").get()).toEqual({ count: 0 });
  });

  test("uses configured structured AI generation before local fallback", async () => {
    let promptInput: any = null;
    const server = makeTestServer({
      generateDrafts: async (input) => {
        promptInput = input;
        return {
          drafts: [
            {
              kind: "vocabulary",
              expression: "予約",
              reading: "よやく",
              pitchAccent: "0",
              pitchAccentSource: "ai",
              meanings: {
                zh: "预约",
                en: "reservation",
                ja: "前もって約束すること"
              },
              example: "レストランを予約しました。",
              exampleReading: "れすとらんをよやくしました。",
              explanation: {
                zh: "AI 生成的词汇卡，音调需要人工确认。",
                en: "AI-generated vocabulary card; pitch accent needs review.",
                ja: "AI生成の語彙カードです。アクセントは確認が必要です。"
              },
              tags: ["N4", "ai"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "AI Material", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "予約の会話",
        text: "明日は友達とレストランへ行くので、電話で席を予約しました。名前と時間を確認して、発音も練習しました。"
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(promptInput).toMatchObject({
      title: "予約の会話",
      jlptLevel: "N4",
      requestedKinds: ["vocabulary", "grammar", "pronunciation"],
      deckCoverage: {
        insufficientKinds: ["vocabulary", "grammar", "pronunciation"]
      }
    });
    expect(promptInput.text).toContain("席を予約しました");
    expect(payload.drafts).toHaveLength(1);
    expect(payload.drafts[0].fields.Expression).toBe("予約");
    expect(payload.drafts[0].fields.PitchAccentSource).toBe("ai");
    expect(payload.drafts[0].pitchAccentStatus).toBe("review-required");
    expect(payload.drafts[0].raw.tags).toEqual(["N4", "ai"]);
  });

  test("normalizes generated draft tags before approving and exporting a package", async () => {
    const server = makeTestServer({
      generateDrafts: async () => ({
        drafts: [
          {
            kind: "vocabulary",
            expression: "予約",
            reading: "よやく",
            pitchAccent: "0",
            pitchAccentSource: "ai",
            meanings: { zh: "预约", en: "reservation", ja: "前もって約束すること" },
            example: "レストランを予約しました。",
            exampleReading: "れすとらんをよやくしました。",
            explanation: {
              zh: "预约的用法。",
              en: "How to use reservation.",
              ja: "予約の使い方です。"
            },
            tags: ["JLPT N4", "review queue", "N4"]
          }
        ]
      })
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Generated Tag Hygiene", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "タグ教材",
        text: "旅行の準備でレストランを予約しました。電話で時間を確認し、友達に場所を説明しました。予約という語彙を例文で復習します。"
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts[0].raw.tags).toEqual(["JLPT_N4", "review_queue", "N4"]);

    const approval = await server.request(`/api/drafts/${payload.drafts[0].id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });
    expect(approval.status).toBe(200);

    const cardsResponse = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie: auth.cookie } });
    const cardsPayload = await cardsResponse.json();
    expect(cardsPayload.cards[0].tags).toEqual(["JLPT_N4", "review_queue", "N4"]);

    const exportResponse = await server.request(`/api/imports/${payload.importId}/export`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ includeMedia: true, includeScheduling: false, legacySupport: true })
    });
    expect(exportResponse.status).toBe(200);

    const tempDir = mkdtempSync(join(tmpdir(), "anki-tag-export-"));
    try {
      const zip = await JSZip.loadAsync(Buffer.from(await exportResponse.arrayBuffer()));
      const collectionPath = join(tempDir, "collection.anki2");
      writeFileSync(collectionPath, await zip.file("collection.anki2")!.async("nodebuffer"));
      const exportedDb = new Database(collectionPath, { readonly: true });
      const note = exportedDb.prepare("SELECT tags FROM notes").get() as any;
      expect(note.tags).toBe(" JLPT_N4 review_queue N4 ");
      exportedDb.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("inherits the target deck JLPT level when study material does not specify one", async () => {
    let promptInput: any = null;
    const server = makeTestServer({
      generateDrafts: async (input) => {
        promptInput = input;
        return {
          drafts: [
            {
              kind: "grammar",
              expression: "〜ようにする",
              reading: "ようにする",
              pitchAccent: null,
              pitchAccentSource: "none",
              meanings: { zh: "尽量做", en: "make an effort to", ja: "努力して行う" },
              example: "毎日復習するようにします。",
              exampleReading: "まいにちふくしゅうするようにします。",
              explanation: {
                zh: "N3 常见表达，用来表示努力形成习惯。",
                en: "A common N3 pattern for making an effort or habit.",
                ja: "努力や習慣化を表します。"
              },
              tags: ["grammar"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "N3 Grammar", jlptLevel: "N3" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        title: "文法ノート",
        text: "最近は日本語で日記を書くようにしています。毎日少しずつ復習して、新しい文法も例文で確認しています。"
      })
    });

    expect(response.status).toBe(200);
    expect(promptInput).toMatchObject({ deckId: deck.id, jlptLevel: "N3" });
    const payload = await response.json();
    expect(payload.drafts[0].fields.Expression).toBe("〜ようにする");
  });

  test("uses the saved default JLPT level when study material has no deck or level", async () => {
    let promptInput: any = null;
    const server = makeTestServer({
      generateDrafts: async (input) => {
        promptInput = input;
        return {
          drafts: [
            {
              kind: "vocabulary",
              expression: "抽象的",
              reading: "ちゅうしょうてき",
              pitchAccent: null,
              pitchAccentSource: "none",
              meanings: { zh: "抽象的", en: "abstract", ja: "具体的でないさま" },
              example: "抽象的な説明を具体例で確認しました。",
              exampleReading: "ちゅうしょうてきなせつめいをぐたいれいでかくにんしました。",
              explanation: {
                zh: "N2 程度的词汇候选。",
                en: "A vocabulary candidate around N2.",
                ja: "N2程度の語彙候補です。"
              },
              tags: ["default-level"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    await server.request("/api/settings/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        defaultJlptLevel: "N2",
        packageImport: { includeScheduling: false },
        packageExport: { includeMedia: true, includeScheduling: false, legacySupport: true }
      })
    });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        title: "読解ノート",
        text: "読解の授業で抽象的な説明を読み、具体例を使って意味を確認しました。語彙、文法、発音も復習しました。"
      })
    });

    expect(response.status).toBe(200);
    expect(promptInput).toMatchObject({ jlptLevel: "N2" });
    const payload = await response.json();
    expect(payload.drafts[0].fields.Expression).toBe("抽象的");
    const defaultDeck = server.services.db.prepare("SELECT id, name, jlpt_level FROM decks WHERE id = ?").get(payload.drafts[0].deckId) as any;
    expect(defaultDeck).toMatchObject({ name: "Japanese", jlpt_level: "N2" });
  });

  test("generates cached TTS audio for study material drafts when a TTS provider is configured", async () => {
    const spoken: string[] = [];
    const server = makeTestServer({
      ttsSynthesize: async ({ text }) => {
        spoken.push(text);
        return Buffer.from(`audio:${text}`);
      },
      generateDrafts: async () => ({
        drafts: [
          {
            kind: "vocabulary",
            expression: "予約",
            reading: "よやく",
            pitchAccent: "0",
            pitchAccentSource: "ai",
            meanings: { zh: "预约", en: "reservation", ja: "前もって約束すること" },
            example: "レストランを予約しました。",
            exampleReading: "れすとらんをよやくしました。",
            explanation: {
              zh: "预约的用法。",
              en: "How to use reservation.",
              ja: "予約の使い方です。"
            },
            tags: ["N4", "audio"]
          },
          {
            kind: "pronunciation",
            expression: "発音",
            reading: "はつおん",
            pitchAccent: null,
            pitchAccentSource: "none",
            meanings: { zh: "发音", en: "pronunciation", ja: "音を出すこと" },
            example: "発音を練習します。",
            exampleReading: "はつおんをれんしゅうします。",
            explanation: {
              zh: "发音练习。",
              en: "Pronunciation practice.",
              ja: "発音の練習です。"
            },
            tags: ["N4", "audio"]
          }
        ]
      })
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Auto Audio", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "音声つき教材",
        text: "明日は友達とレストランへ行くので、電話で席を予約しました。発音も何度も練習しました。"
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(spoken).toEqual(["予約", "発音"]);
    expect(payload.drafts.map((draft: any) => draft.fields.Audio)).toEqual([
      expect.stringMatching(/^\[sound:.+\.mp3\]$/),
      expect.stringMatching(/^\[sound:.+\.mp3\]$/)
    ]);
    const assets = server.services.db.prepare("SELECT original_name, mime_type, source_id FROM media_assets ORDER BY original_name").all() as any[];
    expect(assets).toEqual([
      { original_name: "tts:test-tts:alloy:予約", mime_type: "audio/mpeg", source_id: payload.sourceId },
      { original_name: "tts:test-tts:alloy:発音", mime_type: "audio/mpeg", source_id: payload.sourceId }
    ]);
  });

  test("keeps generated study material drafts when automatic TTS audio fails", async () => {
    const server = makeTestServer({
      ttsSynthesize: async () => {
        throw new Error("tts unavailable");
      },
      generateDrafts: async () => ({
        drafts: [
          {
            kind: "vocabulary",
            expression: "確認",
            reading: "かくにん",
            pitchAccent: "0",
            pitchAccentSource: "ai",
            meanings: { zh: "确认", en: "confirmation", ja: "確かめること" },
            example: "予約を確認しました。",
            exampleReading: "よやくをかくにんしました。",
            explanation: {
              zh: "确认的用法。",
              en: "How to use confirmation.",
              ja: "確認の使い方です。"
            },
            tags: ["N4", "audio"]
          }
        ]
      })
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "TTS Optional", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "音声失敗教材",
        text: "予約を確認しました。音声生成に失敗しても、学習カードの草稿は残します。"
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts).toHaveLength(1);
    expect(payload.drafts[0].fields.Expression).toBe("確認");
    expect(payload.drafts[0].fields.Audio).toBe("");
    const jobs = server.services.db.prepare("SELECT type, status, error FROM jobs ORDER BY created_at").all() as any[];
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "draft-tts", status: "failed", error: "tts unavailable" })
      ])
    );
  });

  test("returns a structured failed import when draft generation fails", async () => {
    const server = makeTestServer({
      generateDrafts: async () => {
        throw new Error("provider unavailable");
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Failed Material", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "失敗ノート",
        text: "今日は学校で新しい文法を勉強しました。先生は例文を読んで、発音を何度も練習しました。"
      })
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "failed",
      error: "provider unavailable"
    });
    expect(payload.importId).toMatch(/^import_/);

    const failedImport = await server.request(`/api/imports/${payload.importId}`, { headers: { cookie: auth.cookie } });
    await expect(failedImport.json()).resolves.toMatchObject({
      id: payload.importId,
      type: "text-material",
      status: "failed",
      error: "provider unavailable"
    });
  });

  test("rejects study material generation for an unknown target deck", async () => {
    const server = makeTestServer();
    const auth = await login(server);

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: "deck_missing",
        jlptLevel: "N4",
        title: "不存在的牌组",
        text: "今日は学校で新しい文法を勉強しました。先生は例文を読んで、発音を何度も練習しました。"
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Target deck not found" });
    const imports = server.services.db.prepare("SELECT COUNT(*) AS count FROM imports").get() as { count: number };
    const sources = server.services.db.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number };
    const drafts = server.services.db.prepare("SELECT COUNT(*) AS count FROM generation_drafts").get() as { count: number };
    expect(imports.count).toBe(0);
    expect(sources.count).toBe(0);
    expect(drafts.count).toBe(0);
  });

  test("keeps specific Japanese grammar patterns in local fallback drafts", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Fallback Grammar", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "進行形ノート",
        text: "今、雨が降っている。友だちは図書館で本を読んでいる。動作が続いていることを表す文法です。"
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    const grammar = payload.drafts.find((draft: any) => draft.kind === "grammar");
    expect(grammar.fields.Expression).toBe("〜ている");
    expect(grammar.fields.Example).toContain("降っている");
    expect(grammar.raw.tags).toEqual(expect.arrayContaining(["N4", "grammar", "needs-review"]));
  });

  test("creates grammar drafts from pasted Japanese grammar lists without an AI provider", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Pasted Grammar", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "文法リスト",
        text: [
          "今週の授業で扱う文法です。",
          "- 〜ておく: 预先做 / do in advance / 前もってする / 旅行の前にホテルを予約しておきます。",
          "- 〜ようにする: 尽量做 / make an effort to / 努力して行う / 毎日復習するようにします。"
        ].join("\n")
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts).toHaveLength(2);
    expect(payload.drafts[0]).toMatchObject({
      kind: "grammar",
      fields: {
        Expression: "〜ておく",
        Reading: "ておく",
        MeaningZh: "预先做",
        MeaningEn: "do in advance",
        MeaningJa: "前もってする",
        Example: "旅行の前にホテルを予約しておきます。",
        SourceUrl: `text-material://${payload.importId}`
      }
    });
    expect(payload.drafts[1].fields.Expression).toBe("〜ようにする");
    expect(payload.drafts[1].fields.Reading).toBe("ようにする");
    expect(payload.drafts[0].raw.tags).toEqual(expect.arrayContaining(["N4", "grammar"]));
  });

  test("creates vocabulary drafts from pasted Japanese vocabulary lists without an AI provider", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Pasted Vocabulary", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "旅行語彙リスト",
        text: [
          "旅行の前に覚える語彙です。",
          "- 予約（よやく）: 预约 / reservation / 前もって約束すること",
          "- 確認（かくにん）: 确认 / confirmation / 確かめること"
        ].join("\n")
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts).toHaveLength(2);
    expect(payload.drafts[0]).toMatchObject({
      kind: "vocabulary",
      fields: {
        Expression: "予約",
        Reading: "よやく",
        MeaningZh: "预约",
        MeaningEn: "reservation",
        MeaningJa: "前もって約束すること",
        SourceUrl: `text-material://${payload.importId}`
      }
    });
    expect(payload.drafts[1].fields.Expression).toBe("確認");
    expect(payload.drafts[1].fields.Reading).toBe("かくにん");
    expect(payload.drafts[0].raw.tags).toEqual(expect.arrayContaining(["N4", "vocabulary"]));
  });

  test("preserves pitch accent markers from pasted Japanese vocabulary lists", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Pitch Vocabulary", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "アクセント語彙",
        text: [
          "発音練習用の語彙です。",
          "- 橋（はし）[2]: 桥 / bridge / 川などにかけるもの",
          "- 雨（あめ）[1]: 雨 / rain / 空から降る水"
        ].join("\n")
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts).toHaveLength(2);
    expect(payload.drafts[0]).toMatchObject({
      kind: "vocabulary",
      pitchAccentStatus: "review-required",
      fields: {
        Expression: "橋",
        Reading: "はし",
        PitchAccent: "2",
        PitchAccentSource: "none"
      }
    });
    expect(payload.drafts[1].fields.Expression).toBe("雨");
    expect(payload.drafts[1].fields.PitchAccent).toBe("1");
  });

  test("creates pronunciation drafts from pasted Japanese pronunciation drills without an AI provider", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Pronunciation Drills", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "発音ドリル",
        text: [
          "授業で練習する発音リストです。",
          "- 発音: 橋（はし）[2]: 桥 / bridge / 川などにかけるもの / 橋とはしを言い分けます。",
          "- 発音: 雨（あめ）[1]: 雨 / rain / 空から降る水 / 雨と飴を聞き分けます。"
        ].join("\n")
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts).toHaveLength(2);
    expect(payload.drafts[0]).toMatchObject({
      kind: "pronunciation",
      pitchAccentStatus: "review-required",
      fields: {
        Expression: "橋",
        Reading: "はし",
        PitchAccent: "2",
        PitchAccentSource: "none",
        MeaningZh: "桥",
        MeaningEn: "bridge",
        MeaningJa: "川などにかけるもの",
        Example: "橋とはしを言い分けます。",
        SourceUrl: `text-material://${payload.importId}`
      }
    });
    expect(payload.drafts[1].fields.Expression).toBe("雨");
    expect(payload.drafts[1].fields.PitchAccent).toBe("1");
    expect(payload.drafts[0].raw.tags).toEqual(expect.arrayContaining(["N4", "pronunciation"]));
  });

  test("combines pasted vocabulary grammar and pronunciation lists in one local fallback batch", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Mixed Lesson Notes", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "混合授業ノート",
        text: [
          "授業で不足していた語彙、文法、発音をまとめます。",
          "- 予約（よやく）: 预约 / reservation / 前もって約束すること",
          "- 〜ておく: 预先做 / do in advance / 前もってする / 旅行の前にホテルを予約しておきます。",
          "- 発音: 橋（はし）[2]: 桥 / bridge / 川などにかけるもの / 橋とはしを言い分けます。"
        ].join("\n")
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts.map((draft: any) => draft.kind)).toEqual(["vocabulary", "grammar", "pronunciation"]);
    expect(payload.drafts.map((draft: any) => draft.fields.Expression)).toEqual(["予約", "〜ておく", "橋"]);
    expect(payload.drafts[2].fields.PitchAccent).toBe("2");
    for (const draft of payload.drafts) {
      expect(draft.fields.SourceUrl).toBe(`text-material://${payload.importId}`);
    }
  });

  test("parses numbered mixed Japanese study lists in one local fallback batch", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Numbered Mixed Notes", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "番号付き授業ノート",
        text: [
          "番号付きで貼り付けた復習リストです。",
          "1. 予約（よやく）: 预约 / reservation / 前もって約束すること",
          "2. 〜ておく: 预先做 / do in advance / 前もってする / 旅行の前にホテルを予約しておきます。",
          "3. 発音: 橋（はし）[2]: 桥 / bridge / 川などにかけるもの / 橋とはしを言い分けます。"
        ].join("\n")
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts.map((draft: any) => draft.kind)).toEqual(["vocabulary", "grammar", "pronunciation"]);
    expect(payload.drafts.map((draft: any) => draft.fields.Expression)).toEqual(["予約", "〜ておく", "橋"]);
    expect(payload.drafts[2].fields.PitchAccent).toBe("2");
  });

  test("generates approved cards from pasted study material that remain exportable", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Text Material", jlptLevel: "N4" });
    createJapaneseNote(server.services.db, {
      deckId: deck.id,
      fields: {
        Expression: "既存",
        Reading: "きそん",
        MeaningZh: "既有",
        MeaningEn: "existing",
        MeaningJa: "すでにあること",
        Example: "既存のカードです。"
      },
      tags: ["manual"]
    });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "授業ノート",
        text: "今日は学校で新しい文法を勉強しました。先生は例文を読んで、発音を何度も練習しました。あとで単語の意味も確認しました。"
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts).toHaveLength(3);
    expect(payload.drafts.map((draft: any) => draft.kind)).toEqual(["vocabulary", "grammar", "pronunciation"]);
    for (const draft of payload.drafts) {
      expect(draft.deckId).toBe(deck.id);
      expect(draft.pitchAccentStatus).toBe("review-required");
      expect(draft.fields.ExplanationZh).toContain("授業ノート");
      expect(draft.fields.SourceUrl).toBe(`text-material://${payload.importId}`);
    }

    const source = server.services.db.prepare("SELECT * FROM sources WHERE id = ?").get(payload.sourceId) as any;
    expect(source.type).toBe("text-material");
    expect(source.title).toBe("授業ノート");
    expect(source.content_text).toContain("新しい文法");

    const approval = await server.request(`/api/drafts/${payload.drafts[0].id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });
    expect(approval.status).toBe(200);
    const approved = await approval.json();
    expect(approved.fields.SourceUrl).toBe(`text-material://${payload.importId}`);

    const exportResponse = await server.request(`/api/decks/${deck.id}/export`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ includeMedia: true, includeScheduling: false, legacySupport: true })
    });
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-disposition")).toContain(".apkg");

    const generatedPackage = await server.request(`/api/imports/${payload.importId}/export`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ includeMedia: true, includeScheduling: false, legacySupport: true })
    });
    const generatedPackageError = generatedPackage.status === 200 ? "" : await generatedPackage.text();
    expect(generatedPackage.status, generatedPackageError).toBe(200);
    expect(generatedPackage.headers.get("content-disposition")).toContain(
      `filename*=UTF-8''${encodeURIComponent("授業ノート.apkg")}`
    );

    const tempDir = mkdtempSync(join(tmpdir(), "anki-generated-export-"));
    try {
      const zip = await JSZip.loadAsync(Buffer.from(await generatedPackage.arrayBuffer()));
      const collectionPath = join(tempDir, "collection.anki2");
      writeFileSync(collectionPath, await zip.file("collection.anki2")!.async("nodebuffer"));
      const exportedDb = new Database(collectionPath, { readonly: true });
      const notes = exportedDb.prepare("SELECT * FROM notes").all() as any[];
      expect(notes).toHaveLength(1);
      expect(notes[0].flds).toContain(`text-material://${payload.importId}`);
      expect(notes[0].flds).not.toContain("既存");
      exportedDb.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("exports approved study-material cards as a package that imports into a fresh review workspace", async () => {
    const server = makeTestServer();
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Round Trip Source", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-text", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        deckId: deck.id,
        jlptLevel: "N4",
        title: "復習資料",
        text: "今日は学校で新しい文法を勉強しました。先生は例文を読んで、発音を何度も練習しました。"
      })
    });
    const payload = await response.json();
    await server.request(`/api/drafts/${payload.drafts[0].id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: "{}"
    });

    const exported = await server.request(`/api/sources/${payload.sourceId}/export`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ includeMedia: true, includeScheduling: false, legacySupport: true })
    });
    expect(exported.status).toBe(200);

    const freshServer = makeTestServer();
    const freshAuth = await login(freshServer);
    const imported = await new AnkiPackageWorker(freshServer.services).importPackage(Buffer.from(await exported.arrayBuffer()), {
      sourceUrl: "https://example.com/generated-study-material.apkg",
      includeScheduling: false
    });

    expect(imported.notesImported).toBe(1);
    expect(imported.cardsImported).toBeGreaterThanOrEqual(1);
    const importedDeck = freshServer.services.decks.listDecks().find((candidate) => candidate.name === "Round Trip Source");
    expect(importedDeck).toBeDefined();
    const next = await freshServer.request(`/api/review/next?deckId=${importedDeck!.id}`, { headers: { cookie: freshAuth.cookie } });
    const reviewPayload = await next.json();
    expect(reviewPayload.card.fields.SourceUrl).toBe(`text-material://${payload.importId}`);
    expect(reviewPayload.card.fields.ExplanationZh).toContain("復習資料");
    expect(Object.keys(reviewPayload.previews)).toEqual(["Again", "Hard", "Good", "Easy"]);
  });
});
