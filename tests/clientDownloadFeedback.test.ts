import { describe, expect, test } from "vitest";
import { downloadFeedbackMessage, packageActionErrorMessage } from "../src/client/downloadFeedback";

describe("download feedback messages", () => {
  test("confirms deck package exports with the downloaded file name", () => {
    expect(downloadFeedbackMessage("deck-export", "Japanese.apkg")).toBe("Exported deck package: Japanese.apkg.");
  });

  test("confirms archived original package downloads with provenance language", () => {
    expect(downloadFeedbackMessage("archived-import", "original-japanese.apkg")).toBe("Downloaded original imported package: original-japanese.apkg.");
  });

  test("confirms generated import package exports with the downloaded file name", () => {
    expect(downloadFeedbackMessage("generated-import-export", "generated-cards.colpkg")).toBe(
      "Exported generated package: generated-cards.colpkg."
    );
  });

  test("reports package action failures with operation-specific context", () => {
    expect(packageActionErrorMessage("deck-export", new Error("Deck has no cards to export"))).toBe(
      "Deck export failed: Deck has no cards to export"
    );
    expect(packageActionErrorMessage("archived-import", "network lost")).toBe("Original package download failed: network lost");
    expect(packageActionErrorMessage("generated-import-export", null)).toBe("Generated package export failed");
    expect(packageActionErrorMessage("source-export", new Error("No approved cards found"))).toBe(
      "Generated source package export failed: No approved cards found"
    );
  });
});
