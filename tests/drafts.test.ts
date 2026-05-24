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

describe("draft review workflow", () => {
  test("edits a generated draft before approving it into a deck", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Generated", jlptLevel: "N3" });
    const targetDeck = server.services.decks.createDeck({ name: "Approved Target", jlptLevel: "N4" });
    server.services.db
      .prepare(
        `INSERT INTO generation_drafts (
          id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
          explanation_languages, raw_json, created_at, updated_at
        ) VALUES (
          'draft_test', NULL, ?, 'vocabulary', 'draft', '古い', 'old', ?, 'review-required',
          'zh,en,ja', ?, '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z'
        )`
      )
      .run(
        deck.id,
        JSON.stringify({
          Expression: "古い",
          Reading: "ふるい",
          PitchAccent: "",
          MeaningZh: "旧的",
          MeaningEn: "old",
          MeaningJa: "昔の",
          Audio: ""
        }),
        JSON.stringify({ tags: ["needs-review"] })
      );

    const edit = await server.request("/api/drafts/draft_test", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        kind: "vocabulary",
        fields: {
          Expression: "新しい",
          Reading: "あたらしい",
          PitchAccent: "4",
          PitchAccentSource: "manual",
          MeaningZh: "新的",
          MeaningEn: "new",
          MeaningJa: "新たな",
          Example: "新しい本を買いました。",
          ExampleReading: "あたらしいほんをかいました。",
          ExplanationZh: "用于形容新近出现的事物。",
          ExplanationEn: "Common i-adjective.",
          ExplanationJa: "い形容詞。",
          Audio: "[sound:atarashii.mp3]",
          SourceUrl: "https://example.com/lesson"
        },
        tags: ["N5", "edited"],
        pitchAccentStatus: "confirmed",
        deckId: targetDeck.id
      })
    });
    expect(edit.status).toBe(200);
    const edited = await edit.json();
    expect(edited.draft.front).toBe("新しい");
    expect(edited.draft.pitchAccentStatus).toBe("confirmed");
    expect(edited.draft.deckId).toBe(targetDeck.id);

    const detail = await server.request("/api/drafts/draft_test", { headers: { cookie } });
    expect(detail.status).toBe(200);
    const detailPayload = await detail.json();
    expect(detailPayload.draft).toMatchObject({
      id: "draft_test",
      deckId: targetDeck.id,
      kind: "vocabulary",
      fields: { Expression: "新しい", Reading: "あたらしい" },
      pitchAccentStatus: "confirmed"
    });

    const approval = await server.request("/api/drafts/draft_test/approve", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: "{}"
    });
    expect(approval.status).toBe(200);

    const sourceCards = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie } });
    expect((await sourceCards.json()).cards).toHaveLength(0);

    const cards = await server.request(`/api/cards?deckId=${targetDeck.id}`, { headers: { cookie } });
    const payload = await cards.json();
    expect(payload.cards[0].fields.Expression).toBe("新しい");
    expect(payload.cards[0].fields.ExampleReading).toBe("あたらしいほんをかいました。");
    expect(payload.cards[0].fields.SourceUrl).toBe("https://example.com/lesson");
    expect(payload.cards[0].tags).toEqual(["N5", "edited"]);
  });

  test("bulk approves generated drafts into cards for export", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Bulk Approved", jlptLevel: "N4" });
    const now = "2026-05-17T00:00:00.000Z";
    const insertDraft = server.services.db.prepare(
      `INSERT INTO generation_drafts (
        id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
        explanation_languages, raw_json, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, 'draft', ?, ?, ?, 'review-required', 'zh,en,ja', ?, ?, ?)`
    );
    insertDraft.run(
      "draft_bulk_vocab",
      deck.id,
      "vocabulary",
      "予約",
      "reservation",
      JSON.stringify({ Expression: "予約", Reading: "よやく", MeaningZh: "预约", MeaningEn: "reservation", MeaningJa: "前もって約束すること" }),
      JSON.stringify({ tags: ["N4", "bulk"] }),
      now,
      now
    );
    insertDraft.run(
      "draft_bulk_pronunciation",
      deck.id,
      "pronunciation",
      "発音",
      "pronunciation",
      JSON.stringify({ Expression: "発音", Reading: "はつおん", PitchAccent: "0", MeaningZh: "发音", MeaningEn: "pronunciation" }),
      JSON.stringify({ tags: ["N4", "pronunciation"] }),
      now,
      now
    );

    const approval = await server.request("/api/drafts/approve-bulk", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ ids: ["draft_bulk_vocab", "draft_bulk_pronunciation"] })
    });

    expect(approval.status).toBe(200);
    const payload = await approval.json();
    expect(payload).toMatchObject({ approved: 2, cardsCreated: 4 });
    expect(payload.noteIds).toHaveLength(2);

    const drafts = await server.request("/api/drafts", { headers: { cookie } });
    expect((await drafts.json()).drafts).toHaveLength(0);

    const cards = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie } });
    const cardPayload = await cards.json();
    expect(cardPayload.cards).toHaveLength(4);
    expect(cardPayload.cards.map((card: any) => card.fields.Expression).sort()).toEqual(["予約", "発音", "発音", "発音"]);
  });

  test("bulk approves generated drafts into a requested target deck", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const sourceDeck = server.services.decks.createDeck({ name: "Generated Source", jlptLevel: "N4" });
    const targetDeck = server.services.decks.createDeck({ name: "Approved Target", jlptLevel: "N3" });
    const insertDraft = server.services.db.prepare(
      `INSERT INTO generation_drafts (
        id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
        explanation_languages, raw_json, created_at, updated_at
      ) VALUES (?, NULL, ?, 'vocabulary', 'draft', ?, ?, ?, 'review-required', 'zh,en,ja', ?,
        '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z')`
    );
    insertDraft.run(
      "draft_target_one",
      sourceDeck.id,
      "予約",
      "reservation",
      JSON.stringify({ Expression: "予約", Reading: "よやく", MeaningZh: "预约", MeaningEn: "reservation" }),
      JSON.stringify({ tags: ["target"] })
    );
    insertDraft.run(
      "draft_target_two",
      sourceDeck.id,
      "確認",
      "confirmation",
      JSON.stringify({ Expression: "確認", Reading: "かくにん", MeaningZh: "确认", MeaningEn: "confirmation" }),
      JSON.stringify({ tags: ["target"] })
    );

    const approval = await server.request("/api/drafts/approve-bulk", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ ids: ["draft_target_one", "draft_target_two"], deckId: targetDeck.id })
    });

    expect(approval.status, await approval.clone().text()).toBe(200);
    await expect(approval.json()).resolves.toMatchObject({ approved: 2, cardsCreated: 2 });
    const sourceCards = await server.request(`/api/cards?deckId=${sourceDeck.id}`, { headers: { cookie } });
    expect((await sourceCards.json()).cards).toHaveLength(0);
    const targetCards = await server.request(`/api/cards?deckId=${targetDeck.id}`, { headers: { cookie } });
    const targetPayload = await targetCards.json();
    expect(targetPayload.cards.map((card: any) => card.fields.Expression).sort()).toEqual(["予約", "確認"]);
  });

  test("does not partially approve a bulk request when the target deck is invalid", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Invalid Bulk Target", jlptLevel: "N4" });
    server.services.db
      .prepare(
        `INSERT INTO generation_drafts (
          id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
          explanation_languages, raw_json, created_at, updated_at
        ) VALUES ('draft_target_invalid', NULL, ?, 'vocabulary', 'draft', '予約', 'reservation', ?, 'review-required',
          'zh,en,ja', ?, '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z')`
      )
      .run(
        deck.id,
        JSON.stringify({ Expression: "予約", Reading: "よやく", MeaningZh: "预约", MeaningEn: "reservation" }),
        JSON.stringify({ tags: ["target"] })
      );

    const approval = await server.request("/api/drafts/approve-bulk", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ ids: ["draft_target_invalid"], deckId: "deck_missing" })
    });

    expect(approval.status).toBe(400);
    await expect(approval.json()).resolves.toEqual({ error: "Target deck not found" });
    const draft = server.services.db.prepare("SELECT status FROM generation_drafts WHERE id = 'draft_target_invalid'").get() as { status: string };
    const cards = server.services.db.prepare("SELECT COUNT(*) AS count FROM cards WHERE deck_id = ?").get(deck.id) as { count: number };
    expect(draft.status).toBe("draft");
    expect(cards.count).toBe(0);
  });

  test("bulk rejects generated drafts without creating cards", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Bulk Rejected", jlptLevel: "N4" });
    const insertDraft = server.services.db.prepare(
      `INSERT INTO generation_drafts (
        id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
        explanation_languages, raw_json, created_at, updated_at
      ) VALUES (?, NULL, ?, 'vocabulary', 'draft', ?, ?, ?, 'review-required', 'zh,en,ja', '{}',
        '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z')`
    );
    insertDraft.run("draft_reject_one", deck.id, "予約", "reservation", JSON.stringify({ Expression: "予約", MeaningZh: "预约" }));
    insertDraft.run("draft_reject_two", deck.id, "確認", "confirmation", JSON.stringify({ Expression: "確認", MeaningZh: "确认" }));

    const rejection = await server.request("/api/drafts/reject-bulk", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ ids: ["draft_reject_one", "draft_reject_two"] })
    });

    expect(rejection.status).toBe(200);
    await expect(rejection.json()).resolves.toEqual({ rejected: 2 });
    const drafts = await server.request("/api/drafts", { headers: { cookie } });
    expect((await drafts.json()).drafts).toHaveLength(0);
    const rejected = await server.request("/api/drafts?status=rejected", { headers: { cookie } });
    expect((await rejected.json()).drafts.map((draft: any) => draft.id).sort()).toEqual(["draft_reject_one", "draft_reject_two"]);
    const cards = server.services.db.prepare("SELECT COUNT(*) AS count FROM cards WHERE deck_id = ?").get(deck.id) as { count: number };
    expect(cards.count).toBe(0);
  });

  test("filters draft review inbox by deck, card kind, and pitch accent status", async () => {
    const server = makeTestServer();
    const { cookie } = await login(server);
    const grammarDeck = server.services.decks.createDeck({ name: "Grammar Review", jlptLevel: "N4" });
    const vocabDeck = server.services.decks.createDeck({ name: "Vocabulary Review", jlptLevel: "N5" });
    const insertDraft = server.services.db.prepare(
      `INSERT INTO generation_drafts (
        id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
        explanation_languages, raw_json, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, 'draft', ?, ?, ?, ?, 'zh,en,ja', '{}',
        '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z')`
    );
    insertDraft.run(
      "draft_filter_grammar",
      grammarDeck.id,
      "grammar",
      "〜てもいい",
      "permission",
      JSON.stringify({ Expression: "〜てもいい", MeaningZh: "可以……" }),
      "review-required"
    );
    insertDraft.run(
      "draft_filter_vocab",
      vocabDeck.id,
      "vocabulary",
      "予約",
      "reservation",
      JSON.stringify({ Expression: "予約", MeaningZh: "预约" }),
      "review-required"
    );
    insertDraft.run(
      "draft_filter_confirmed",
      grammarDeck.id,
      "grammar",
      "〜なければならない",
      "must",
      JSON.stringify({ Expression: "〜なければならない", MeaningZh: "必须……" }),
      "confirmed"
    );

    const response = await server.request(
      `/api/drafts?deckId=${encodeURIComponent(grammarDeck.id)}&kind=grammar&pitchAccentStatus=review-required`,
      { headers: { cookie } }
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts.map((draft: any) => draft.id)).toEqual(["draft_filter_grammar"]);
  });

  test("includes child deck drafts when filtering the review inbox by parent deck", async () => {
    const server = makeTestServer();
    const { cookie } = await login(server);
    const parentDeck = server.services.decks.createDeck({ name: "Japanese Drafts", jlptLevel: "N4" });
    const childDeck = server.services.decks.createDeck({ name: "Japanese Drafts::Vocabulary", parentId: parentDeck.id, jlptLevel: "N4" });
    const otherDeck = server.services.decks.createDeck({ name: "Other Drafts", jlptLevel: "N4" });
    const insertDraft = server.services.db.prepare(
      `INSERT INTO generation_drafts (
        id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
        explanation_languages, raw_json, created_at, updated_at
      ) VALUES (?, NULL, ?, 'vocabulary', 'draft', ?, ?, ?, 'review-required', 'zh,en,ja', '{}',
        '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z')`
    );
    insertDraft.run(
      "draft_child_vocab",
      childDeck.id,
      "発音",
      "pronunciation",
      JSON.stringify({ Expression: "発音", MeaningZh: "发音" })
    );
    insertDraft.run(
      "draft_other_vocab",
      otherDeck.id,
      "予約",
      "reservation",
      JSON.stringify({ Expression: "予約", MeaningZh: "预约" })
    );

    const response = await server.request(`/api/drafts?deckId=${encodeURIComponent(parentDeck.id)}`, { headers: { cookie } });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.drafts.map((draft: any) => draft.id)).toEqual(["draft_child_vocab"]);
  });

  test("does not partially reject a bulk request when one draft is invalid", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Atomic Reject", jlptLevel: "N4" });
    server.services.db
      .prepare(
        `INSERT INTO generation_drafts (
          id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
          explanation_languages, raw_json, created_at, updated_at
        ) VALUES ('draft_reject_valid', NULL, ?, 'vocabulary', 'draft', '確認', 'confirmation', ?, 'review-required',
          'zh,en,ja', '{}', '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z')`
      )
      .run(deck.id, JSON.stringify({ Expression: "確認", MeaningZh: "确认" }));

    const rejection = await server.request("/api/drafts/reject-bulk", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ ids: ["draft_reject_valid", "draft_missing"] })
    });

    expect(rejection.status).toBe(400);
    await expect(rejection.json()).resolves.toEqual({ error: "Draft not found" });
    const draft = server.services.db.prepare("SELECT status FROM generation_drafts WHERE id = 'draft_reject_valid'").get() as {
      status: string;
    };
    expect(draft.status).toBe("draft");
  });

  test("approves grammar drafts into grammar-focused review cards", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Grammar Drafts", jlptLevel: "N4" });
    server.services.db
      .prepare(
        `INSERT INTO generation_drafts (
          id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
          explanation_languages, raw_json, created_at, updated_at
        ) VALUES (
          'draft_grammar_focus', NULL, ?, 'grammar', 'draft', '〜てもいい', 'permission', ?, 'review-required',
          'zh,en,ja', ?, '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z'
        )`
      )
      .run(
        deck.id,
        JSON.stringify({
          Expression: "〜てもいい",
          Reading: "てもいい",
          MeaningZh: "可以……",
          MeaningEn: "may; is allowed to",
          MeaningJa: "許可を表す文型",
          Example: "ここで写真を撮ってもいいです。",
          ExampleReading: "ここでしゃしんをとってもいいです。",
          ExplanationZh: "动词て形加もいい表示许可。",
          ExplanationEn: "Attach もいい to the te-form to ask or give permission.",
          ExplanationJa: "動詞のて形に「もいい」を付けて許可を表します。"
        }),
        JSON.stringify({ tags: ["N4", "grammar"] })
      );

    const approval = await server.request("/api/drafts/draft_grammar_focus/approve", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: "{}"
    });

    expect(approval.status).toBe(200);
    const cards = await server.request(`/api/cards?deckId=${deck.id}`, { headers: { cookie } });
    const payload = await cards.json();
    expect(payload.cards).toHaveLength(1);
    expect(payload.cards[0].template.name).toBe("Grammar");
    expect(payload.cards[0].question).toContain("ここで写真を撮ってもいいです。");
    expect(payload.cards[0].answer).toContain("动词て形加もいい表示许可。");
  });

  test("does not partially approve a bulk request when one draft is invalid", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);
    const deck = server.services.decks.createDeck({ name: "Atomic Bulk", jlptLevel: "N4" });
    server.services.db
      .prepare(
        `INSERT INTO generation_drafts (
          id, source_id, deck_id, kind, status, front, back, fields_json, pitch_accent_status,
          explanation_languages, raw_json, created_at, updated_at
        ) VALUES ('draft_atomic_valid', NULL, ?, 'vocabulary', 'draft', '確認', 'confirmation', ?, 'review-required',
          'zh,en,ja', ?, '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z')`
      )
      .run(
        deck.id,
        JSON.stringify({ Expression: "確認", Reading: "かくにん", MeaningZh: "确认", MeaningEn: "confirmation" }),
        JSON.stringify({ tags: ["bulk"] })
      );

    const approval = await server.request("/api/drafts/approve-bulk", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ ids: ["draft_atomic_valid", "draft_missing"] })
    });

    expect(approval.status).toBe(400);
    await expect(approval.json()).resolves.toEqual({ error: "Draft not found" });
    const draft = server.services.db.prepare("SELECT status FROM generation_drafts WHERE id = 'draft_atomic_valid'").get() as {
      status: string;
    };
    const notes = server.services.db.prepare("SELECT COUNT(*) AS count FROM notes WHERE deck_id = ?").get(deck.id) as { count: number };
    const cards = server.services.db.prepare("SELECT COUNT(*) AS count FROM cards WHERE deck_id = ?").get(deck.id) as { count: number };
    expect(draft.status).toBe("draft");
    expect(notes.count).toBe(0);
    expect(cards.count).toBe(0);
  });
});
