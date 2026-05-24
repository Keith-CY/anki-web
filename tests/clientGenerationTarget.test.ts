import { describe, expect, test } from "vitest";
import { generationTargetFor, nextGenerationDeckSelection } from "../src/client/generationTarget";
import type { Deck } from "../src/client/api";

const decks: Deck[] = [
  {
    id: "deck_1",
    name: "Grammar",
    parentId: null,
    jlptLevel: "N4",
    dailyNewLimit: 10,
    dailyReviewLimit: 100,
    fsrsRetention: 0.9
  },
  {
    id: "deck_2",
    name: "Pitch Accent",
    parentId: "deck_1",
    jlptLevel: "N3",
    dailyNewLimit: 10,
    dailyReviewLimit: 100,
    fsrsRetention: 0.9
  }
];

describe("generation target selection", () => {
  test("uses the explicit JLPT level selected on the generation screen", () => {
    expect(generationTargetFor(decks, "deck_1", "N2", "mixed")).toEqual({
      deckId: "deck_1",
      jlptLevel: "N2"
    });
  });

  test("falls back to the selected deck JLPT level when the generation level is automatic", () => {
    expect(generationTargetFor(decks, "deck_2", "auto", "mixed")).toEqual({
      deckId: "deck_2",
      jlptLevel: "N3"
    });
  });

  test("uses the default JLPT level when no deck is selected", () => {
    expect(generationTargetFor(decks, "", "auto", "N5")).toEqual({
      deckId: undefined,
      jlptLevel: "N5"
    });
  });

  test("initializes the generation deck once without coupling it to later workspace deck changes", () => {
    expect(nextGenerationDeckSelection(null, decks)).toBe("deck_1");
    expect(nextGenerationDeckSelection("deck_2", decks)).toBe("deck_2");
    expect(nextGenerationDeckSelection("", decks)).toBe("");
  });

  test("repairs a stale generation deck after that deck is deleted", () => {
    expect(nextGenerationDeckSelection("deck_missing", decks)).toBe("deck_1");
  });
});
