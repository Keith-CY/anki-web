import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { AnkiPackageWorker } from "../src/server/anki/worker";
import { makeTestServer } from "./helpers/server";

describe("Docker smoke fixture", () => {
  test("generates an importable Japanese apkg fixture", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "anki-smoke-fixture-test-"));
    try {
      const fixturePath = join(tempDir, "japanese-smoke.apkg");
      execFileSync("node", ["scripts/create-smoke-apkg.mjs", fixturePath], { cwd: process.cwd(), stdio: "pipe" });

      const server = makeTestServer();
      const result = await new AnkiPackageWorker(server.services).importPackage(readFileSync(fixturePath), {
        sourceUrl: "fixture://japanese-smoke.apkg",
        includeScheduling: false
      });

      expect(result).toMatchObject({
        decksImported: 1,
        notesImported: 1,
        cardsImported: 1
      });
      const card = server.services.db.prepare("SELECT fields_json, tags_json FROM notes LIMIT 1").get() as {
        fields_json: string;
        tags_json: string;
      };
      expect(JSON.parse(card.fields_json)).toMatchObject({
        Front: "復習",
        Back: expect.stringContaining("review")
      });
      expect(JSON.parse(card.tags_json)).toEqual(["smoke"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
