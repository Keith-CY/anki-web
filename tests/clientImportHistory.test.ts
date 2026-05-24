import { describe, expect, test } from "vitest";
import {
  canDownloadArchivedPackage,
  canExportGeneratedImport,
  canRetryImport,
  formatImportResult,
  formatImportUrl,
  studyMaterialTargetForImport
} from "../src/client/importHistory";
import type { ImportJob } from "../src/client/api";

function importJob(overrides: Partial<ImportJob>): ImportJob {
  return {
    id: "import_1",
    type: "text-material",
    url: "text-material://import_1",
    status: "completed",
    includeScheduling: false,
    error: null,
    result: { sourceId: "source_1", draftsCreated: 3 },
    generatedSource: {
      id: "source_1",
      draftCards: 3,
      approvedDrafts: 0,
      rejectedDrafts: 0,
      approvedCards: 0
    },
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:01.000Z",
    ...overrides
  };
}

describe("import history view model", () => {
  test("only enables generated package export after cards are approved", () => {
    expect(canExportGeneratedImport(importJob({ generatedSource: { ...importJob({}).generatedSource!, approvedCards: 0 } }))).toBe(false);
    expect(canExportGeneratedImport(importJob({ generatedSource: { ...importJob({}).generatedSource!, approvedCards: 1 } }))).toBe(true);
    expect(
      canExportGeneratedImport(
        importJob({
          type: "source-regeneration",
          generatedSource: { ...importJob({}).generatedSource!, approvedCards: 1 }
        })
      )
    ).toBe(true);
    expect(canExportGeneratedImport(importJob({ type: "apkg-url", generatedSource: null, result: { notesImported: 1 } }))).toBe(false);
  });

  test("summarizes generated imports with draft and approved counts", () => {
    expect(formatImportUrl(importJob({}))).toBe("pasted study notes");
    expect(formatImportUrl(importJob({ type: "source-regeneration", url: "text-material://import_1" }))).toBe("regenerated study source");
    expect(formatImportResult(importJob({}))).toBe("3 drafts · 0 approved");
    expect(formatImportResult(importJob({ generatedSource: { ...importJob({}).generatedSource!, approvedCards: 2 } }))).toBe(
      "3 drafts · 2 approved"
    );
  });

  test("surfaces package coverage gaps as study material recommendations", () => {
    const job = importJob({
      type: "apkg-url",
      generatedSource: null,
      result: {
        notesImported: 1,
        cardsImported: 1,
        needsStudyMaterial: true,
        studyMaterialRecommendations: [
          {
            deckId: "deck_url_package",
            deckName: "URL Package",
            deckCoverage: {
              needsMaterial: true,
              insufficientKinds: ["vocabulary", "grammar", "pronunciation"],
              kinds: [
                { kind: "vocabulary", label: "Vocabulary", current: 1, recommendedMinimum: 20, missing: 19, insufficient: true },
                { kind: "grammar", label: "Grammar", current: 0, recommendedMinimum: 10, missing: 10, insufficient: true },
                { kind: "pronunciation", label: "Pronunciation", current: 0, recommendedMinimum: 10, missing: 10, insufficient: true }
              ]
            }
          }
        ]
      }
    });

    expect(formatImportResult(job)).toBe("1 notes · 1 cards · needs material: Vocabulary 19, Grammar 10, Pronunciation 10");
    expect(studyMaterialTargetForImport(job)).toEqual({
      deckId: "deck_url_package",
      deckName: "URL Package",
      summary: "Vocabulary 19, Grammar 10, Pronunciation 10"
    });
    expect(studyMaterialTargetForImport(importJob({ type: "apkg-url", generatedSource: null, result: { notesImported: 1, cardsImported: 1 } }))).toBeNull();
  });

  test("enables archived package download only for completed package imports with a stored file", () => {
    expect(
      canDownloadArchivedPackage(
        importJob({
          type: "apkg-url",
          status: "completed",
          generatedSource: null,
          result: { packageFileName: "import_1-japanese.apkg", cardsImported: 1 }
        })
      )
    ).toBe(true);
    expect(
      canDownloadArchivedPackage(
        importJob({
          type: "apkg-file",
          status: "completed",
          generatedSource: null,
          result: { packageFileName: "local-japanese.apkg", cardsImported: 1 }
        })
      )
    ).toBe(true);
    expect(canDownloadArchivedPackage(importJob({ type: "apkg-url", result: { cardsImported: 1 }, generatedSource: null }))).toBe(false);
    expect(canDownloadArchivedPackage(importJob({ status: "failed", result: { packageFileName: "broken.apkg" } }))).toBe(false);
  });

  test("enables retry only for failed URL package imports", () => {
    expect(canRetryImport(importJob({ type: "apkg-url", status: "failed", url: "https://example.com/broken.apkg" }))).toBe(true);
    expect(canRetryImport(importJob({ type: "apkg-file", status: "failed", url: "upload:///broken.apkg" }))).toBe(false);
    expect(canRetryImport(importJob({ type: "apkg-url", status: "completed" }))).toBe(false);
    expect(canRetryImport(importJob({ type: "text-material", status: "failed" }))).toBe(false);
  });
});
