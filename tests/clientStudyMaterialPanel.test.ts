import { describe, expect, test } from "vitest";
import { acceptedStudyMaterialFileTypes, studyMaterialUploadLabel } from "../src/client/studyMaterialPanel";

describe("study material upload UI helpers", () => {
  test("advertises every supported text material format including DOCX and ZIP bundles", () => {
    expect(studyMaterialUploadLabel(0)).toBe("Upload .txt/.md/.html/.csv/.tsv/.srt/.vtt/.docx/.zip materials");
    expect(acceptedStudyMaterialFileTypes).toContain(".tsv");
    expect(acceptedStudyMaterialFileTypes).toContain("text/tab-separated-values");
    expect(acceptedStudyMaterialFileTypes).toContain(".srt");
    expect(acceptedStudyMaterialFileTypes).toContain("application/x-subrip");
    expect(acceptedStudyMaterialFileTypes).toContain(".vtt");
    expect(acceptedStudyMaterialFileTypes).toContain("text/vtt");
    expect(acceptedStudyMaterialFileTypes).toContain(".docx");
    expect(acceptedStudyMaterialFileTypes).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(acceptedStudyMaterialFileTypes).toContain(".zip");
    expect(acceptedStudyMaterialFileTypes).toContain("application/zip");
  });

  test("shows selected file count after the user chooses material files", () => {
    expect(studyMaterialUploadLabel(2)).toBe("2 material files selected");
  });
});
