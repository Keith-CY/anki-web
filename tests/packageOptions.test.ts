import { describe, expect, test } from "vitest";
import {
  defaultExportPackageOptions,
  defaultImportPackageOptions,
  exportPackageExtension,
  exportPackageTitle,
  exportPackagePayload,
  importPackagePayload
} from "../src/client/packageOptions";

describe("package option payloads", () => {
  test("keeps scheduling stripped by default for package imports", () => {
    expect(importPackagePayload("https://example.com/japanese.apkg", defaultImportPackageOptions)).toEqual({
      url: "https://example.com/japanese.apkg",
      includeScheduling: false
    });
  });

  test("exports media by default while leaving scheduling opt-in", () => {
    expect(exportPackagePayload(defaultExportPackageOptions)).toEqual({
      includeMedia: true,
      includeScheduling: false,
      legacySupport: true
    });
  });

  test("preserves explicit scheduling choices for round-trip package exchange", () => {
    expect(importPackagePayload("https://example.com/progress.apkg", { includeScheduling: true })).toEqual({
      url: "https://example.com/progress.apkg",
      includeScheduling: true
    });
    expect(
      exportPackagePayload({
        includeMedia: false,
        includeScheduling: true,
        legacySupport: false
      })
    ).toEqual({
      includeMedia: false,
      includeScheduling: true,
      legacySupport: false
    });
  });

  test("describes the selected export package format", () => {
    expect(exportPackageExtension({ ...defaultExportPackageOptions, legacySupport: true })).toBe("apkg");
    expect(exportPackageExtension({ ...defaultExportPackageOptions, legacySupport: false })).toBe("colpkg");
    expect(exportPackageTitle("Export deck", { ...defaultExportPackageOptions, legacySupport: true })).toBe("Export deck as .apkg");
    expect(exportPackageTitle("Export deck", { ...defaultExportPackageOptions, legacySupport: false })).toBe("Export deck as .colpkg");
  });
});
