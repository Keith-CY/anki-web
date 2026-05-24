import type { GenerationPreview } from "./api";

export function previewKindSummary(preview: GenerationPreview) {
  return preview.cardKinds.map((kind) => kind.label).join(", ");
}

export function previewLanguageSummary(preview: GenerationPreview) {
  return preview.explanationLanguages.map((language) => language.label).join(" / ");
}

export function previewProviderLabel(preview: GenerationPreview) {
  if (preview.provider === "openai") return "OpenAI-compatible";
  if (preview.provider === "custom") return "Custom provider";
  return "Local fallback";
}

export function previewTargetDeckLabel(preview: GenerationPreview | null, currentTargetDeckName: string | null | undefined) {
  if (currentTargetDeckName !== undefined) {
    return currentTargetDeckName ?? "Generated default deck";
  }
  return preview?.targetDeck?.name ?? "Generated default deck";
}

export function previewCoverageSummary(preview: GenerationPreview) {
  if (!preview.deckCoverage.needsMaterial) return "Coverage looks ready for daily review";
  const gaps = preview.deckCoverage.kinds
    .filter((kind) => kind.insufficient)
    .map((kind) => `${kind.label} +${kind.missing}`)
    .join(", ");
  return gaps ? `Needs material: ${gaps}` : "Needs more study material";
}
