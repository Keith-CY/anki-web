import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiClient } from "../src/client/api";

describe("ApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("posts pasted learning material to the text generation endpoint", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ importId: "import_1", sourceId: "source_1", drafts: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.generateFromText({
      title: "授業ノート",
      text: "今日は学校で新しい文法を勉強しました。",
      deckId: "deck_1",
      jlptLevel: "N4"
    });

    expect(requests[0].path).toBe("/api/generation/from-text");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      title: "授業ノート",
      text: "今日は学校で新しい文法を勉強しました。",
      deckId: "deck_1",
      jlptLevel: "N4"
    });
  });

  test("uploads text learning material files with multipart form data", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ importId: "import_1", sourceId: "source_1", drafts: [] }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.generateFromFile(new File([Buffer.from("旅行の前に予約しておきます。")], "lesson.md", { type: "text/markdown" }), {
      deckId: "deck_1",
      jlptLevel: "N3"
    });

    expect(requests[0].path).toBe("/api/generation/from-file");
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.body).toBeInstanceOf(FormData);
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect((requests[0].init?.headers as Record<string, string>)["content-type"]).toBeUndefined();
    const form = requests[0].init?.body as FormData;
    expect(form.get("deckId")).toBe("deck_1");
    expect(form.get("jlptLevel")).toBe("N3");
    expect(form.get("file")).toBeInstanceOf(File);
  });

  test("uploads multiple text learning material files with multipart form data", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ importId: "import_1", sourceId: "source_1", drafts: [] }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.generateFromFiles(
      [
        new File([Buffer.from("語彙を復習します。")], "week-01.md", { type: "text/markdown" }),
        new File([Buffer.from("文法を練習します。")], "week-02.txt", { type: "text/plain" })
      ],
      {
        title: "春学期ノート",
        deckId: "deck_1",
        jlptLevel: "N4"
      }
    );

    expect(requests[0].path).toBe("/api/generation/from-files");
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.body).toBeInstanceOf(FormData);
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect((requests[0].init?.headers as Record<string, string>)["content-type"]).toBeUndefined();
    const form = requests[0].init?.body as FormData;
    expect(form.get("title")).toBe("春学期ノート");
    expect(form.get("deckId")).toBe("deck_1");
    expect(form.get("jlptLevel")).toBe("N4");
    expect(form.getAll("files")).toHaveLength(2);
    expect(form.getAll("files")[0]).toBeInstanceOf(File);
    expect(form.getAll("files")[1]).toBeInstanceOf(File);
  });

  test("fetches generation preview for the selected deck", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ preview: { jlptLevel: "N4", cardKinds: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    const payload = await api.generationPreview("deck_1");

    expect(requests[0].path).toBe("/api/generation/preview?deckId=deck_1");
    expect(requests[0].init).toEqual({ credentials: "include" });
    expect(payload.preview.jlptLevel).toBe("N4");
  });

  test("fetches import history", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(
          JSON.stringify({
            imports: [
              {
                id: "import_1",
                type: "text-material",
                url: "text-material://import_1",
                status: "completed",
                includeScheduling: false,
                error: null,
                result: { draftsCreated: 1 },
                generatedSource: {
                  id: "source_1",
                  draftCards: 1,
                  approvedDrafts: 0,
                  rejectedDrafts: 0,
                  approvedCards: 0
                },
                createdAt: "2026-05-17T00:00:00.000Z",
                updatedAt: "2026-05-17T00:00:01.000Z"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const api = new ApiClient();
    const payload = await api.imports();

    expect(requests[0].path).toBe("/api/imports");
    expect(requests[0].init).toEqual({ credentials: "include" });
    expect(payload.imports[0].status).toBe("completed");
    expect(payload.imports[0].result).toEqual({ draftsCreated: 1 });
    expect(payload.imports[0].generatedSource?.approvedCards).toBe(0);
  });

  test("fetches a single import job", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ id: "import_1", status: "completed", result: { draftsCreated: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    const payload = await api.importJob("import_1");

    expect(requests[0].path).toBe("/api/imports/import_1");
    expect(payload.id).toBe("import_1");
  });

  test("fetches job history", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: "job_1",
                type: "text-generation",
                status: "completed",
                payload: { importId: "import_1" },
                result: { draftsCreated: 3 },
                error: null,
                createdAt: "2026-05-17T00:00:00.000Z",
                updatedAt: "2026-05-17T00:00:01.000Z"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const api = new ApiClient();
    const payload = await api.jobs();

    expect(requests[0].path).toBe("/api/jobs");
    expect(requests[0].init).toEqual({ credentials: "include" });
    expect(payload.jobs[0].result).toEqual({ draftsCreated: 3 });
  });

  test("fetches a single job detail", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ id: "job_1", status: "completed", result: { draftsCreated: 3 } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    const payload = await api.job("job_1");

    expect(requests[0].path).toBe("/api/jobs/job_1");
    expect(payload.id).toBe("job_1");
  });

  test("lists, reads, and deletes media assets", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        const payload =
          path === "/api/media"
            ? { assets: [] }
            : path === "/api/media/media_1" && init?.method !== "DELETE"
              ? { asset: { id: "media_1", fileName: "manual.mp3", available: true } }
              : { ok: true };
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.media();
    const detail = await api.mediaAsset("media_1");
    await api.deleteMedia("media_1");

    expect(requests.map((request) => request.path)).toEqual(["/api/media", "/api/media/media_1", "/api/media/media_1"]);
    expect(requests[2].init?.method).toBe("DELETE");
    expect((requests[2].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(detail.asset.id).toBe("media_1");
  });

  test("uploads media with multipart form data and csrf protection", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ asset: { id: "media_1" }, reference: "[sound:manual.mp3]" }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.uploadMedia(new File([Buffer.from("audio")], "manual.mp3", { type: "audio/mpeg" }));

    expect(result.reference).toBe("[sound:manual.mp3]");
    expect(requests[0].path).toBe("/api/media");
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.body).toBeInstanceOf(FormData);
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect((requests[0].init?.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });

  test("downloads generated packages from learning sources", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(new Blob(["apkg"]), {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": "attachment; filename=\"source.apkg\""
          }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const exported = await api.exportSource("source_1", { includeMedia: true, includeScheduling: false, legacySupport: true });

    expect(requests[0].path).toBe("/api/sources/source_1/export");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });
    expect(exported.fileName).toBe("source.apkg");
  });

  test("downloads archived packages from package import history", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(new Blob(["apkg"]), {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": "attachment; filename=\"japanese.apkg\""
          }
        });
      })
    );

    const api = new ApiClient();
    const archived = await api.downloadImportedPackage("import_1");

    expect(requests[0].path).toBe("/api/imports/import_1/package");
    expect(requests[0].init).toEqual({ credentials: "include" });
    expect(archived.fileName).toBe("japanese.apkg");
  });

  test("fetches source provenance records", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ sources: [{ id: "source_1", title: "授業ノート" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    const payload = await api.sources();

    expect(requests[0].path).toBe("/api/sources");
    expect(requests[0].init).toEqual({ credentials: "include" });
    expect(payload.sources[0].title).toBe("授業ノート");
  });

  test("fetches a source provenance detail", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ source: { id: "source_1", title: "授業ノート" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    const payload = await api.source("source_1");

    expect(requests[0].path).toBe("/api/sources/source_1");
    expect(payload.source.title).toBe("授業ノート");
  });

  test("posts source regeneration requests with csrf protection", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ importId: "import_1", sourceId: "source_1", drafts: [] }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.regenerateSource("source_1", { deckId: "deck_1", jlptLevel: "N3" });

    expect(requests[0].path).toBe("/api/sources/source_1/regenerate");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ deckId: "deck_1", jlptLevel: "N3" });
  });

  test("fetches safe runtime settings", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ settings: { openai: { configured: false } } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    const payload = await api.settings();

    expect(requests[0].path).toBe("/api/settings");
    expect(requests[0].init).toEqual({ credentials: "include" });
    expect(payload.settings.openai.configured).toBe(false);
  });

  test("updates persisted settings preferences with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(
          JSON.stringify({
            preferences: {
              defaultJlptLevel: "N3",
              packageImport: { includeScheduling: true },
              packageExport: { includeMedia: false, includeScheduling: true, legacySupport: false }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const payload = await api.updateSettingsPreferences({
      defaultJlptLevel: "N3",
      packageImport: { includeScheduling: true },
      packageExport: { includeMedia: false, includeScheduling: true, legacySupport: false }
    });

    expect(requests[0].path).toBe("/api/settings/preferences");
    expect(requests[0].init?.method).toBe("PATCH");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      defaultJlptLevel: "N3",
      packageImport: { includeScheduling: true },
      packageExport: { includeMedia: false, includeScheduling: true, legacySupport: false }
    });
    expect(payload.preferences.packageExport.legacySupport).toBe(false);
  });

  test("fetches note type summaries", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ noteTypes: [{ id: "note_type_1", fields: [], templates: [] }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    const payload = await api.noteTypes();

    expect(requests[0].path).toBe("/api/note-types");
    expect(requests[0].init).toEqual({ credentials: "include" });
    expect(payload.noteTypes[0].id).toBe("note_type_1");
  });

  test("fetches a note type detail", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ noteType: { id: "note_type_1", fields: [], templates: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    const payload = await api.noteType("note_type_1");

    expect(requests[0].path).toBe("/api/note-types/note_type_1");
    expect(payload.noteType.id).toBe("note_type_1");
  });

  test("posts note type create update and delete requests with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ noteType: { id: "note_type_custom" }, ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.createNoteType({
      name: "Sentence Mining",
      css: ".card {}",
      fields: ["Sentence", "Meaning"],
      templates: [{ name: "Read", questionFormat: "{{Sentence}}", answerFormat: "{{Meaning}}" }]
    });
    await api.updateNoteType("note_type_custom", {
      name: "Sentence Mining Plus",
      css: "",
      fields: ["Sentence", "Meaning", "Source"],
      templates: [{ name: "Read", questionFormat: "{{Sentence}}", answerFormat: "{{Meaning}}" }]
    });
    await api.deleteNoteType("note_type_custom");

    expect(requests.map((request) => request.path)).toEqual([
      "/api/note-types",
      "/api/note-types/note_type_custom",
      "/api/note-types/note_type_custom"
    ]);
    expect(requests.map((request) => request.init?.method)).toEqual(["POST", "PATCH", "DELETE"]);
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect((requests[1].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect((requests[2].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
  });

  test("posts card suspend and unsuspend actions", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ card: { id: "card_1", state: "suspended" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.suspendCard("card_1");
    await api.unsuspendCard("card_1");

    expect(requests.map((request) => request.path)).toEqual(["/api/cards/card_1/suspend", "/api/cards/card_1/unsuspend"]);
    expect(requests.map((request) => request.init?.method)).toEqual(["POST", "POST"]);
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
  });

  test("posts card progress reset actions with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ card: { id: "card_1", state: "new", reps: 0 } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.resetCard("card_1");

    expect(result.card.state).toBe("new");
    expect(requests[0].path).toBe("/api/cards/card_1/reset");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
  });

  test("posts review bury actions with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ card: { id: "card_1" }, buriedUntil: "2026-05-19T00:00:00.000Z" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.buryReviewCard("card_1");

    expect(requests[0].path).toBe("/api/review/card_1/bury");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(result.buriedUntil).toBe("2026-05-19T00:00:00.000Z");
  });

  test("posts review undo actions with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ card: { id: "card_1", state: "new" }, restoredSiblingCards: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.undoReviewAnswer("card_1");

    expect(requests[0].path).toBe("/api/review/card_1/undo");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(result.restoredSiblingCards).toBe(2);
  });

  test("forwards deck FSRS retention updates", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ id: "deck_1", fsrsRetention: 0.82 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.updateDeck("deck_1", { fsrsRetention: 0.82 });

    expect(requests[0].path).toBe("/api/decks/deck_1");
    expect(requests[0].init?.method).toBe("PATCH");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ fsrsRetention: 0.82 });
  });

  test("forwards parent deck updates when moving an existing deck", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ id: "deck_child", parentId: "deck_parent" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const deck = await api.updateDeck("deck_child", { parentId: "deck_parent" });

    expect(deck.parentId).toBe("deck_parent");
    expect(requests[0].path).toBe("/api/decks/deck_child");
    expect(requests[0].init?.method).toBe("PATCH");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ parentId: "deck_parent" });
  });

  test("forwards parent deck id when creating a child deck", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ id: "deck_child", name: "Vocabulary", parentId: "deck_parent" }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const deck = await api.createDeck({ name: "Vocabulary", jlptLevel: "N4", parentId: "deck_parent" });

    expect(deck.parentId).toBe("deck_parent");
    expect(requests[0].path).toBe("/api/decks");
    expect(requests[0].init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ name: "Vocabulary", jlptLevel: "N4", parentId: "deck_parent" });
  });

  test("fetches deck and card details", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(
          JSON.stringify(path === "/api/decks/deck_1" ? { id: "deck_1", name: "日本語" } : { card: { id: "card_1", deckId: "deck_1" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const api = new ApiClient();
    const deck = await api.deck("deck_1");
    const card = await api.card("card_1");

    expect(requests.map((request) => request.path)).toEqual(["/api/decks/deck_1", "/api/cards/card_1"]);
    expect(deck.id).toBe("deck_1");
    expect(card.card.id).toBe("card_1");
  });

  test("fetches and applies deck presets", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(
          JSON.stringify(
            path === "/api/deck-presets"
              ? { presets: [{ id: "preset_light", name: "Light" }] }
              : { deck: { id: "deck_1", dailyNewLimit: 10 }, preset: { id: "preset_light" } }
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const presets = await api.deckPresets();
    const applied = await api.applyDeckPreset("deck_1", "preset_light");

    expect(requests.map((request) => request.path)).toEqual(["/api/deck-presets", "/api/decks/deck_1/apply-preset"]);
    expect(requests[0].init).toEqual({ credentials: "include" });
    expect(requests[1].init?.method).toBe("POST");
    expect((requests[1].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({ presetId: "preset_light" });
    expect(presets.presets[0].id).toBe("preset_light");
    expect(applied.preset.id).toBe("preset_light");
  });

  test("posts deck unbury actions with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ ok: true, restoredCards: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.unburyDeck("deck_1");

    expect(requests[0].path).toBe("/api/decks/deck_1/unbury");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(result.restoredCards).toBe(2);
  });

  test("forwards card edits with a target deck", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ card: { id: "card_1", deckId: "deck_target" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.updateCard("card_1", {
      deckId: "deck_target",
      fields: { Expression: "移動" },
      tags: ["moved"]
    });

    expect(requests[0].path).toBe("/api/cards/card_1");
    expect(requests[0].init?.method).toBe("PATCH");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      deckId: "deck_target",
      fields: { Expression: "移動" },
      tags: ["moved"]
    });
    expect(result.card.deckId).toBe("deck_target");
  });

  test("gets and updates notes with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        const body =
          init?.method === "PATCH"
            ? { note: { id: "note_1", deckId: "deck_target", fields: { MeaningZh: "发音" }, tags: ["N4"], cards: [] } }
            : { note: { id: "note_1", deckId: "deck_source", fields: { Expression: "発音" }, tags: ["old"], cards: [] } };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const detail = await api.note("note_1");
    const updated = await api.updateNote("note_1", {
      deckId: "deck_target",
      fields: { MeaningZh: "发音" },
      tags: ["N4"]
    });

    expect(requests[0].path).toBe("/api/notes/note_1");
    expect(requests[0].init?.method).toBeUndefined();
    expect(requests[1].path).toBe("/api/notes/note_1");
    expect(requests[1].init?.method).toBe("PATCH");
    expect((requests[1].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({
      deckId: "deck_target",
      fields: { MeaningZh: "发音" },
      tags: ["N4"]
    });
    expect(detail.note.deckId).toBe("deck_source");
    expect(updated.note.deckId).toBe("deck_target");
  });

  test("creates notes with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ note: { id: "note_1", deckId: "deck_1", fields: {}, tags: [], cards: [] } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.createNote({
      deckId: "deck_1",
      fields: { Expression: "文法" },
      tags: ["grammar"],
      createAllTemplates: true
    });

    expect(requests[0].path).toBe("/api/notes");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      deckId: "deck_1",
      fields: { Expression: "文法" },
      tags: ["grammar"],
      createAllTemplates: true
    });
    expect(result.note.id).toBe("note_1");
  });

  test("deletes notes with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ ok: true, deletedCards: 3 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.deleteNote("note_1");

    expect(requests[0].path).toBe("/api/notes/note_1");
    expect(requests[0].init?.method).toBe("DELETE");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(result.deletedCards).toBe(3);
  });

  test("posts bulk tag state changes with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ ok: true, action: "suspend", updatedCards: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.bulkTagState("needs review", "suspend", "deck_1");

    expect(requests[0].path).toBe("/api/tags/needs%20review/bulk-state");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ action: "suspend", deckId: "deck_1" });
    expect(result.updatedCards).toBe(2);
  });

  test("posts bulk draft audio generation with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ generated: 2, skipped: 1, drafts: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.generateDraftAudios(["draft_1", "draft_2"]);

    expect(requests[0].path).toBe("/api/drafts/audio-bulk");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ ids: ["draft_1", "draft_2"] });
    expect(result.generated).toBe(2);
  });

  test("fetches tag summaries and card lists with selected tag, search, pagination, and state filters", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify(path === "/api/tags?deckId=deck_1" ? { tags: [] } : { cards: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    await api.tags("deck_1");
    await api.cards("deck_1", "N4", "発音", { limit: 50, offset: 100, state: "suspended" });

    expect(requests.map((request) => request.path)).toEqual([
      "/api/tags?deckId=deck_1",
      "/api/cards?deckId=deck_1&tag=N4&q=%E7%99%BA%E9%9F%B3&limit=50&offset=100&state=suspended"
    ]);
  });

  test("forwards tag rename and delete requests with CSRF", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.renameTag("N4", "JLPT N4", "deck_1");
    await api.deleteTag("needs review", "deck_1");

    expect(requests.map((request) => request.path)).toEqual([
      "/api/tags/N4",
      "/api/tags/needs%20review?deckId=deck_1"
    ]);
    expect(requests[0].init?.method).toBe("PATCH");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ name: "JLPT N4", deckId: "deck_1" });
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(requests[1].init?.method).toBe("DELETE");
    expect((requests[1].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
  });

  test("forwards package import and export option payloads", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === "/api/decks/deck_1/export") {
          return new Response(new Blob(["apkg"]), {
            status: 200,
            headers: { "content-disposition": 'attachment; filename="deck.apkg"' }
          });
        }
        if (path === "/api/imports/import_1/export") {
          return new Response(new Blob(["apkg"]), {
            status: 200,
            headers: { "content-disposition": `attachment; filename="_____.apkg"; filename*=UTF-8''${encodeURIComponent("授業ノート.apkg")}` }
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.importApkg("https://example.com/deck.apkg", true);
    await api.retryImport("import_failed");
    const deckExport = await api.exportDeck("deck_1", { includeMedia: false, includeScheduling: true, legacySupport: false });
    const generatedExport = await api.exportImport("import_1", {
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });

    expect(requests[0].path).toBe("/api/imports/apkg-url");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      url: "https://example.com/deck.apkg",
      includeScheduling: true
    });
    expect(requests[1].path).toBe("/api/imports/import_failed/retry");
    expect(requests[1].init?.method).toBe("POST");
    expect((requests[1].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({});
    expect(requests[2].path).toBe("/api/decks/deck_1/export");
    expect(JSON.parse(String(requests[2].init?.body))).toEqual({
      includeMedia: false,
      includeScheduling: true,
      legacySupport: false
    });
    expect(deckExport.fileName).toBe("deck.apkg");
    expect(requests[3].path).toBe("/api/imports/import_1/export");
    expect(JSON.parse(String(requests[3].init?.body))).toEqual({
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });
    expect(generatedExport.fileName).toBe("授業ノート.apkg");
  });

  test("uploads package files with multipart form data", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ id: "import_1", status: "completed", result: { cardsImported: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.importApkgFile(new File([Buffer.from("apkg")], "local.apkg", { type: "application/vnd.anki.package" }), true);

    expect(requests[0].path).toBe("/api/imports/apkg-file");
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.body).toBeInstanceOf(FormData);
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect((requests[0].init?.headers as Record<string, string>)["content-type"]).toBeUndefined();
    const form = requests[0].init?.body as FormData;
    expect(form.get("includeScheduling")).toBe("true");
    expect(form.get("file")).toBeInstanceOf(File);
  });

  test("uses the selected package format for export fallback filenames", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(new Blob(["package"]), { status: 200 });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";

    const modernDeck = await api.exportDeck("deck_1", { includeMedia: true, includeScheduling: false, legacySupport: false });
    const modernImport = await api.exportImport("import_1", { includeMedia: true, includeScheduling: false, legacySupport: false });
    const legacySource = await api.exportSource("source_1", { includeMedia: true, includeScheduling: false, legacySupport: true });

    expect(modernDeck.fileName).toBe("deck.colpkg");
    expect(modernImport.fileName).toBe("generated.colpkg");
    expect(legacySource.fileName).toBe("source.apkg");
  });

  test("forwards draft target deck updates", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ draft: { id: "draft_1", deckId: "deck_target" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    await api.updateDraft("draft_1", {
      deckId: "deck_target",
      kind: "grammar",
      fields: { Expression: "文法" },
      tags: ["grammar"],
      pitchAccentStatus: "confirmed"
    });

    expect(requests[0].path).toBe("/api/drafts/draft_1");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      deckId: "deck_target",
      kind: "grammar",
      fields: { Expression: "文法" },
      tags: ["grammar"],
      pitchAccentStatus: "confirmed"
    });
  });

  test("fetches a draft detail", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ draft: { id: "draft_1", kind: "grammar" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    const payload = await api.draft("draft_1");

    expect(requests[0].path).toBe("/api/drafts/draft_1");
    expect(payload.draft.id).toBe("draft_1");
  });

  test("forwards bulk draft approval requests", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ approved: 2, cardsCreated: 4, noteIds: ["note_1", "note_2"] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.approveDrafts(["draft_1", "draft_2"], "deck_target");

    expect(requests[0].path).toBe("/api/drafts/approve-bulk");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ ids: ["draft_1", "draft_2"], deckId: "deck_target" });
    expect(result.cardsCreated).toBe(4);
  });

  test("fetches draft review inbox with deck, kind, and pitch filters", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ drafts: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    await api.drafts({ deckId: "deck 1", kind: "grammar", pitchAccentStatus: "review-required" });

    expect(requests[0].path).toBe("/api/drafts?status=draft&deckId=deck+1&kind=grammar&pitchAccentStatus=review-required");
    expect(requests[0].init).toEqual({ credentials: "include" });
  });

  test("forwards bulk draft rejection requests", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({ rejected: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const api = new ApiClient();
    api.csrfToken = "csrf-token";
    const result = await api.rejectDrafts(["draft_1", "draft_2"]);

    expect(requests[0].path).toBe("/api/drafts/reject-bulk");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ ids: ["draft_1", "draft_2"] });
    expect(result.rejected).toBe(2);
  });
});
