import { describe, expect, test } from "vitest";
import { deckPresetSummary, matchingDeckPresetId } from "../src/client/deckPresets";

const presets = [
  {
    id: "preset_light",
    name: "Light",
    description: "",
    dailyNewLimit: 10,
    dailyReviewLimit: 80,
    fsrsRetention: 0.88
  },
  {
    id: "preset_balanced",
    name: "Balanced",
    description: "",
    dailyNewLimit: 20,
    dailyReviewLimit: 200,
    fsrsRetention: 0.9
  }
];

describe("deck preset view helpers", () => {
  test("selects the preset matching the current deck scheduling settings", () => {
    expect(
      matchingDeckPresetId(
        {
          dailyNewLimit: 20,
          dailyReviewLimit: 200,
          fsrsRetention: 0.9
        },
        presets
      )
    ).toBe("preset_balanced");
  });

  test("falls back to the first preset when deck settings are custom", () => {
    expect(
      matchingDeckPresetId(
        {
          dailyNewLimit: 15,
          dailyReviewLimit: 120,
          fsrsRetention: 0.91
        },
        presets
      )
    ).toBe("preset_light");
  });

  test("summarizes preset daily limits and retention", () => {
    expect(deckPresetSummary(presets[0])).toBe("10 new/day · 80 reviews/day · 88% retention");
  });
});
