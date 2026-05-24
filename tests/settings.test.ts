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

describe("runtime settings API", () => {
  test("returns safe runtime configuration without secrets", async () => {
    const server = makeTestServer();
    server.services.config.openaiApiKey = "sk-test-secret";
    server.services.config.openaiBaseUrl = "https://api.example.com/v1";
    server.services.config.openaiTextModel = "japanese-card-model";
    server.services.config.openaiTtsModel = "tts-model";
    server.services.config.openaiTtsVoice = "voice-test";
    const auth = await login(server);

    const response = await server.request("/api/settings", { headers: { cookie: auth.cookie } });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.settings).toMatchObject({
      nodeEnv: "test",
      storage: {
        dataDir: server.services.dataDir,
        databaseConfigured: true,
        mediaDir: server.services.mediaDir,
        packageDir: server.services.packageDir
      },
      openai: {
        configured: true,
        baseUrlConfigured: true,
        textModel: "japanese-card-model",
        ttsModel: "tts-model",
        ttsVoice: "voice-test"
      },
      providers: {
        structuredGeneration: "openai",
        tts: "openai"
      },
      japanese: {
        pitchAccentLexiconConfigured: false,
        pitchAccentLexiconSource: null
      },
      preferences: {
        defaultJlptLevel: "mixed",
        packageImport: { includeScheduling: false },
        packageExport: { includeMedia: true, includeScheduling: false, legacySupport: true }
      }
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("sk-test-secret");
    expect(serialized).not.toContain("test-session-secret");
    expect(serialized).not.toContain("appPasswordHash");
    expect(serialized).not.toContain("sessionSecret");
    expect(serialized).not.toContain("openaiApiKey");
    expect(serialized).not.toContain(server.services.config.databaseUrl);
  });

  test("persists editable learning and package preferences", async () => {
    const server = makeTestServer();
    const auth = await login(server);

    const update = await server.request("/api/settings/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({
        defaultJlptLevel: "N3",
        packageImport: { includeScheduling: true },
        packageExport: { includeMedia: false, includeScheduling: true, legacySupport: false }
      })
    });

    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      preferences: {
        defaultJlptLevel: "N3",
        packageImport: { includeScheduling: true },
        packageExport: { includeMedia: false, includeScheduling: true, legacySupport: false }
      }
    });

    const response = await server.request("/api/settings", { headers: { cookie: auth.cookie } });
    const payload = await response.json();
    expect(payload.settings.preferences).toMatchObject({
      defaultJlptLevel: "N3",
      packageImport: { includeScheduling: true },
      packageExport: { includeMedia: false, includeScheduling: true, legacySupport: false }
    });

    const row = server.services.db.prepare("SELECT value FROM settings WHERE key = 'preferences'").get() as { value: string };
    expect(JSON.parse(row.value)).toMatchObject({ defaultJlptLevel: "N3" });
  });
});
