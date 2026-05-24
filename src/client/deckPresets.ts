import type { Deck, DeckPreset } from "./api";

export function matchingDeckPresetId(deck: Pick<Deck, "dailyNewLimit" | "dailyReviewLimit" | "fsrsRetention"> | null, presets: DeckPreset[]) {
  if (!presets.length) return "";
  if (!deck) return presets[0].id;
  return (
    presets.find(
      (preset) =>
        preset.dailyNewLimit === deck.dailyNewLimit &&
        preset.dailyReviewLimit === deck.dailyReviewLimit &&
        Math.abs(preset.fsrsRetention - deck.fsrsRetention) < 0.0001
    )?.id ?? presets[0].id
  );
}

export function deckPresetSummary(preset: DeckPreset) {
  return `${preset.dailyNewLimit} new/day · ${preset.dailyReviewLimit} reviews/day · ${Math.round(preset.fsrsRetention * 100)}% retention`;
}
