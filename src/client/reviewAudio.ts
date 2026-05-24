import type { ReviewCard } from "./api";

export function reviewAudioText(card: ReviewCard) {
  const fieldNames = card.fieldNames ?? Object.keys(card.fields);
  const fallbackField = fieldNames.map((name) => card.fields[name]?.trim()).find(Boolean) ?? "";
  return (card.fields.Expression?.trim() || card.fields.Reading?.trim() || fallbackField).trim();
}

export function hasReviewAudio(card: ReviewCard) {
  return /\[sound:[^\]]+\]/.test(card.fields.Audio ?? "");
}

export function reviewAudioButtonLabel(card: ReviewCard) {
  return hasReviewAudio(card) ? "Refresh audio" : "Generate audio";
}
