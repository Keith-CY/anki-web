import { afterEach, describe, expect, test, vi } from "vitest";
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

describe("article URL generation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("inherits the target deck JLPT level when generating drafts from a public article URL", async () => {
    let promptInput: any = null;
    const fetchPublicUrl = vi.fn(async (url: string) => ({
      url,
      contentType: "text/html",
      buffer: Buffer.from(
        "<html><head><title>予約の会話</title></head><body><article>明日は友達とレストランへ行くので、電話で席を予約しました。名前と時間を確認して、発音も練習しました。店員さんとの会話では丁寧な表現を使い、あとで新しい単語と文法をノートにまとめました。</article></body></html>"
      )
    }));
    const server = makeTestServer({
      fetchPublicUrl,
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
              meanings: { zh: "预约", en: "reservation", ja: "前もって約束すること" },
              example: "席を予約しました。",
              exampleReading: "せきをよやくしました。",
              explanation: {
                zh: "N4 会话中常见的词。",
                en: "A common N4 conversation word.",
                ja: "N4の会話でよく使う語です。"
              },
              tags: ["article"]
            }
          ]
        };
      }
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "N4 Articles", jlptLevel: "N4" });

    const response = await server.request("/api/generation/from-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        url: "https://93.184.216.34/article.html",
        deckId: deck.id
      })
    });

    const body = await response.text();
    expect(response.status, body).toBe(201);
    expect(fetchPublicUrl).toHaveBeenCalledWith("https://93.184.216.34/article.html", {
      maxBytes: 2_000_000,
      contentTypes: ["text/html", "text/plain", "application/xhtml+xml"]
    });
    expect(promptInput).toMatchObject({ deckId: deck.id, jlptLevel: "N4", title: "予約の会話" });
    const payload = JSON.parse(body);
    expect(payload.drafts[0].fields.Expression).toBe("予約");
  });

  test("removes page navigation and footer noise before generating from an article URL", async () => {
    let promptInput: any = null;
    const fetchPublicUrl = vi.fn(async (url: string) => ({
      url,
      contentType: "text/html",
      buffer: Buffer.from(
        `<!doctype html>
        <html>
          <head><title>N3 文法メモ</title></head>
          <body>
            <header>ログイン 会員登録 検索</header>
            <nav>ホーム ニュース 広告リンク</nav>
            <section>
              <h1>〜ようにする</h1>
              <p>毎日日本語で日記を書くようにしています。復習の時は新しい語彙、文法、発音を確認します。</p>
              <p>授業の後で例文を声に出して読み、自然に使えるように練習します。</p>
            </section>
            <form>メール登録</form>
            <footer>会社情報 利用規約 お問い合わせ</footer>
          </body>
        </html>`
      )
    }));
    const server = makeTestServer({
      fetchPublicUrl,
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
              example: "毎日日本語で日記を書くようにしています。",
              exampleReading: "まいにちにほんごでにっきをかくようにしています。",
              explanation: {
                zh: "从文章正文生成。",
                en: "Generated from article body text.",
                ja: "記事本文から生成。"
              },
              tags: ["article"]
            }
          ]
        };
      }
    });
    const auth = await login(server);

    const response = await server.request("/api/generation/from-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ url: "https://93.184.216.34/n3-grammar.html", jlptLevel: "N3" })
    });

    expect(response.status, await response.clone().text()).toBe(201);
    expect(promptInput).toMatchObject({ title: "N3 文法メモ", jlptLevel: "N3" });
    expect(promptInput.text).toContain("毎日日本語で日記を書くようにしています");
    expect(promptInput.text).toContain("自然に使えるように練習します");
    expect(promptInput.text).not.toContain("ログイン");
    expect(promptInput.text).not.toContain("広告リンク");
    expect(promptInput.text).not.toContain("お問い合わせ");
    const source = server.services.db.prepare("SELECT content_text FROM sources").get() as any;
    expect(source.content_text).toBe(promptInput.text);
  });

  test("preserves ruby furigana as explicit readings when generating from an article URL", async () => {
    let promptInput: any = null;
    const fetchPublicUrl = vi.fn(async (url: string) => ({
      url,
      contentType: "text/html",
      buffer: Buffer.from(
        `<html>
          <head><title>発音メモ</title></head>
          <body>
            <article>
              <p><ruby>予約<rt>よやく</rt></ruby>を確認しました。</p>
              <p><ruby>発音<rt>はつおん</rt></ruby>を聞いて、アクセントも練習しました。</p>
              <p>授業では語彙、文法、例文を一緒に復習して、自然に話せるように声に出して読みました。</p>
            </article>
          </body>
        </html>`
      )
    }));
    const server = makeTestServer({
      fetchPublicUrl,
      generateDrafts: async (input) => {
        promptInput = input;
        return {
          drafts: [
            {
              kind: "pronunciation",
              expression: "発音",
              reading: "はつおん",
              pitchAccent: null,
              pitchAccentSource: "none",
              meanings: { zh: "发音", en: "pronunciation", ja: "音を出すこと" },
              example: "発音を聞きます。",
              exampleReading: "はつおんをききます。",
              explanation: {
                zh: "从带注音的文章生成。",
                en: "Generated from an article with furigana.",
                ja: "ふりがな付き記事から生成。"
              },
              tags: ["furigana"]
            }
          ]
        };
      }
    });
    const auth = await login(server);

    const response = await server.request("/api/generation/from-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ url: "https://93.184.216.34/furigana.html", jlptLevel: "N4" })
    });

    expect(response.status, await response.clone().text()).toBe(201);
    expect(promptInput.text).toContain("予約（よやく）を確認しました");
    expect(promptInput.text).toContain("発音（はつおん）を聞いて");
    expect(promptInput.text).not.toContain("予約よやく");
    const source = server.services.db.prepare("SELECT content_text FROM sources").get() as any;
    expect(source.content_text).toBe(promptInput.text);
  });

  test("reuses an existing article source when fetched article text is unchanged", async () => {
    const generatedExpressions = ["予約", "確認"];
    const fetchPublicUrl = vi.fn(async (url: string) => ({
      url,
      contentType: "text/html",
      buffer: Buffer.from(
        "<html><head><title>予約の会話</title></head><body><article>明日は友達とレストランへ行くので、電話で席を予約しました。名前と時間を確認して、発音も練習しました。店員さんとの会話では丁寧な表現を使い、あとで新しい単語と文法をノートにまとめました。</article></body></html>"
      )
    }));
    const server = makeTestServer({
      fetchPublicUrl,
      generateDrafts: async () => ({
        drafts: [
          {
            kind: "vocabulary",
            expression: generatedExpressions.shift() ?? "復習",
            reading: "よやく",
            pitchAccent: null,
            pitchAccentSource: "none",
            meanings: { zh: "学习", en: "study", ja: "勉強すること" },
            example: "席を予約しました。",
            exampleReading: "せきをよやくしました。",
            explanation: { zh: "重复文章生成。", en: "Generated from repeated article.", ja: "重複記事から生成。" },
            tags: ["dedupe-article"]
          }
        ]
      })
    });
    const auth = await login(server);
    const deck = server.services.decks.createDeck({ name: "Article Dedupe", jlptLevel: "N4" });
    const request = {
      url: "https://93.184.216.34/article.html",
      deckId: deck.id,
      jlptLevel: "N4"
    };

    const first = await server.request("/api/generation/from-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify(request)
    });
    const firstPayload = await first.json();
    const second = await server.request("/api/generation/from-url", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ ...request, url: "https://93.184.216.34/article?utm=repeat" })
    });

    expect(second.status, await second.clone().text()).toBe(201);
    const secondPayload = await second.json();
    expect(secondPayload.sourceId).toBe(firstPayload.sourceId);
    expect(secondPayload.importId).not.toBe(firstPayload.importId);
    expect(secondPayload.drafts[0].fields.Expression).toBe("確認");
    expect(secondPayload.drafts[0].fields.SourceUrl).toBe(firstPayload.drafts[0].fields.SourceUrl);
    expect(fetchPublicUrl).toHaveBeenCalledTimes(2);
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM sources WHERE type = 'article-url'").get()).toEqual({ count: 1 });
    const draftRows = server.services.db
      .prepare("SELECT front, status FROM generation_drafts WHERE source_id = ? ORDER BY created_at")
      .all(firstPayload.sourceId) as Array<{ front: string; status: string }>;
    expect(draftRows).toEqual([
      { front: "予約", status: "rejected" },
      { front: "確認", status: "draft" }
    ]);
  });
});
