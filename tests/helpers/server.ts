import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerApp } from "../../src/server/app";
import { createServices } from "../../src/server/services";
import type { FetchPublicUrl, GenerateDrafts, TtsSynthesize } from "../../src/server/types";

export function makeTestServer(
  options: {
    ttsSynthesize?: TtsSynthesize | null;
    generateDrafts?: GenerateDrafts | null;
    fetchPublicUrl?: FetchPublicUrl | null;
    pitchAccentLexiconSource?: string | null;
  } = {}
) {
  const root = mkdtempSync(join(tmpdir(), "anki-web-test-"));
  const services = createServices({
    dataDir: root,
    databaseUrl: join(root, "test.db"),
    appPassword: "secret",
    nodeEnv: "test",
    sessionSecret: "test-session-secret",
    openaiApiKey: null,
    openaiBaseUrl: null,
    openaiTextModel: "test-model",
    openaiTtsModel: "test-tts",
    openaiTtsVoice: "alloy",
    pitchAccentLexiconSource: options.pitchAccentLexiconSource ?? null,
    ttsSynthesize: options.ttsSynthesize,
    generateDrafts: options.generateDrafts,
    fetchPublicUrl: options.fetchPublicUrl
  });

  return Object.assign(createServerApp(services), { services });
}
