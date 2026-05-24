import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { sourceLibraryRows } from "../src/client/sourceLibrary";
import type { SourceRecord } from "../src/client/api";

function source(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    id: "source_1",
    type: "text-material",
    url: "text-material://source_1",
    title: "Japanese notes",
    contentPreview: "N4 grammar notes",
    contentHash: "hash_1",
    drafts: { total: 3, draft: 0, approved: 3, rejected: 0 },
    approvedNotes: 3,
    createdAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

describe("source library view model", () => {
  test("shows only export-ready learning sources in the draft review package panel", () => {
    expect(
      sourceLibraryRows(
        [
          source({ id: "approved", title: "Approved grammar", approvedNotes: 2 }),
          source({ id: "drafts_only", title: "Unapproved vocabulary", approvedNotes: 0 })
        ],
        { exportReadyOnly: true }
      ).map((row) => row.source.id)
    ).toEqual(["approved"]);
  });

  test("uses human source labels for generated package provenance", () => {
    expect(sourceLibraryRows([source({ type: "text-material", url: "text-material://source_1" })])[0].originLabel).toBe(
      "pasted study notes"
    );
    expect(sourceLibraryRows([source({ type: "article-url", url: "https://example.com/jp" })])[0].originLabel).toBe(
      "https://example.com/jp"
    );
  });

  test("marks export availability from approved notes", () => {
    expect(sourceLibraryRows([source({ approvedNotes: 1 })])[0].canExport).toBe(true);
    expect(sourceLibraryRows([source({ approvedNotes: 0 })])[0].canExport).toBe(false);
  });

  test("regenerates stored sources with the selected generation deck and JLPT target", () => {
    const appSource = readFileSync(new URL("../src/client/App.tsx", import.meta.url), "utf8");

    expect(appSource.includes("api.regenerateSource(source.id, generationTarget)")).toBe(true);
  });
});
