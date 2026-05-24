import { describe, expect, test } from "vitest";
import { deckPathLabel, deckTreeOptions, reparentDeckOptions } from "../src/client/deckHierarchy";
import type { Deck } from "../src/client/api";

const baseDeck = {
  ankiId: 1,
  jlptLevel: "mixed",
  dailyNewLimit: 20,
  dailyReviewLimit: 200,
  fsrsRetention: 0.9
};

function deck(input: Pick<Deck, "id" | "name" | "parentId">): Deck {
  return { ...baseDeck, ...input };
}

describe("deck hierarchy view helpers", () => {
  const decks = [
    deck({ id: "deck_vocab", name: "Vocabulary", parentId: "deck_n4" }),
    deck({ id: "deck_japanese", name: "Japanese", parentId: null }),
    deck({ id: "deck_n4", name: "N4", parentId: "deck_japanese" }),
    deck({ id: "deck_grammar", name: "Grammar", parentId: "deck_n4" }),
    deck({ id: "deck_archive", name: "Archive", parentId: null })
  ];

  test("formats nested deck paths to disambiguate duplicate or short deck names", () => {
    expect(deckPathLabel(decks[0], decks)).toBe("Japanese / N4 / Vocabulary");
    expect(deckPathLabel(decks[4], decks)).toBe("Archive");
  });

  test("orders deck options as an alphabetized tree with depths", () => {
    expect(deckTreeOptions(decks).map((option) => `${option.depth}:${option.label}`)).toEqual([
      "0:Archive",
      "0:Japanese",
      "1:Japanese / N4",
      "2:Japanese / N4 / Grammar",
      "2:Japanese / N4 / Vocabulary"
    ]);
  });

  test("excludes the selected deck and descendants from reparent candidates", () => {
    expect(reparentDeckOptions(decks, "deck_n4").map((option) => option.id)).toEqual(["deck_archive", "deck_japanese"]);
  });
});
