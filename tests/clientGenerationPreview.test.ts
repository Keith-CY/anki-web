import { describe, expect, test } from "vitest";
import {
  previewCoverageSummary,
  previewKindSummary,
  previewLanguageSummary,
  previewProviderLabel,
  previewTargetDeckLabel
} from "../src/client/generationPreviewViewModel";
import type { GenerationPreview } from "../src/client/api";

const preview: GenerationPreview = {
  targetDeck: { id: "deck_1", name: "N4", jlptLevel: "N4" },
  jlptLevel: "N4",
  outputNoteType: "Japanese Vocabulary Grammar Pronunciation",
  maxDrafts: 40,
  provider: "local-fallback",
  cardKinds: [
    { kind: "vocabulary", label: "Vocabulary", approvalCreatesAllTemplates: false },
    { kind: "grammar", label: "Grammar", approvalCreatesAllTemplates: false },
    { kind: "pronunciation", label: "Pronunciation", approvalCreatesAllTemplates: true }
  ],
  explanationLanguages: [
    { code: "zh", label: "Chinese" },
    { code: "en", label: "English" },
    { code: "ja", label: "Japanese" }
  ],
  pitchAccentPolicy: {
    lexiconSourceConfirms: true,
    aiSourceRequiresReview: true,
    field: "PitchAccentSource"
  },
  deckCoverage: {
    scope: "deck",
    targetDeckId: "deck_1",
    totalJapaneseNotes: 7,
    needsMaterial: true,
    insufficientKinds: ["grammar", "pronunciation"],
    kinds: [
      { kind: "vocabulary", label: "Vocabulary", current: 24, recommendedMinimum: 20, missing: 0, insufficient: false },
      { kind: "grammar", label: "Grammar", current: 4, recommendedMinimum: 10, missing: 6, insufficient: true },
      { kind: "pronunciation", label: "Pronunciation", current: 1, recommendedMinimum: 10, missing: 9, insufficient: true }
    ]
  }
};

describe("generation preview view model", () => {
  test("summarizes expected card kinds and languages", () => {
    expect(previewKindSummary(preview)).toBe("Vocabulary, Grammar, Pronunciation");
    expect(previewLanguageSummary(preview)).toBe("Chinese / English / Japanese");
  });

  test("labels local fallback provider plainly", () => {
    expect(previewProviderLabel(preview)).toBe("Local fallback");
  });

  test("uses the current generation target deck label over a stale preview target", () => {
    expect(previewTargetDeckLabel(preview, "N3 Grammar")).toBe("N3 Grammar");
    expect(previewTargetDeckLabel(preview, null)).toBe("Generated default deck");
  });

  test("summarizes deck coverage gaps for study material import", () => {
    expect(previewCoverageSummary(preview)).toBe("Needs material: Grammar +6, Pronunciation +9");
    expect(
      previewCoverageSummary({
        ...preview,
        deckCoverage: {
          ...preview.deckCoverage,
          needsMaterial: false,
          insufficientKinds: [],
          kinds: preview.deckCoverage.kinds.map((kind) => ({ ...kind, current: kind.recommendedMinimum, missing: 0, insufficient: false }))
        }
      })
    ).toBe("Coverage looks ready for daily review");
  });
});
