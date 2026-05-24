import type { Deck } from "./api";

export type GenerationJlptSelection = "auto" | "N5" | "N4" | "N3" | "N2" | "N1" | "mixed";

export function generationTargetFor(
  decks: Deck[],
  deckId: string,
  selectedJlptLevel: GenerationJlptSelection,
  defaultJlptLevel: string
) {
  const targetDeck = deckId ? decks.find((deck) => deck.id === deckId) : null;
  return {
    deckId: targetDeck?.id,
    jlptLevel: selectedJlptLevel === "auto" ? targetDeck?.jlptLevel ?? defaultJlptLevel : selectedJlptLevel
  };
}

export function nextGenerationDeckSelection(currentDeckId: string | null, decks: Deck[]) {
  if (currentDeckId === "") return "";
  if (currentDeckId && decks.some((deck) => deck.id === currentDeckId)) return currentDeckId;
  return decks[0]?.id ?? "";
}
