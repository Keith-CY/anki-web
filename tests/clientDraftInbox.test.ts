import { describe, expect, test } from "vitest";
import { draftApprovalMessage, draftBulkApprovalDeckId, draftBulkTargetOptions, draftInboxQuery } from "../src/client/draftInbox";
import type { Deck } from "../src/client/api";

const decks: Deck[] = [
  {
    id: "deck_parent",
    name: "Japanese",
    parentId: null,
    jlptLevel: "N4",
    dailyNewLimit: 20,
    dailyReviewLimit: 200,
    fsrsRetention: 0.9
  },
  {
    id: "deck_vocab",
    name: "Japanese::Vocabulary",
    parentId: "deck_parent",
    jlptLevel: "N4",
    dailyNewLimit: 20,
    dailyReviewLimit: 200,
    fsrsRetention: 0.9
  }
];

describe("draft inbox query model", () => {
  test("shows generated drafts from all decks instead of coupling review inbox to the selected study deck", () => {
    expect(
      draftInboxQuery({
        selectedStudyDeckId: "deck_review",
        kind: "",
        pitchAccentStatus: ""
      })
    ).toEqual({});
  });

  test("keeps draft-specific filters without adding an implicit deck filter", () => {
    expect(
      draftInboxQuery({
        selectedStudyDeckId: "deck_review",
        kind: "grammar",
        pitchAccentStatus: "review-required"
      })
    ).toEqual({ kind: "grammar", pitchAccentStatus: "review-required" });
  });

  test("does not bulk-approve drafts into the selected study deck unless the user explicitly chooses an override", () => {
    expect(draftBulkApprovalDeckId({ selectedStudyDeckId: "deck_review" })).toBeUndefined();
    expect(draftBulkApprovalDeckId({ selectedStudyDeckId: "deck_review", explicitTargetDeckId: "deck_target" })).toBe("deck_target");
  });

  test("offers a preserve-target option before explicit deck overrides", () => {
    expect(draftBulkTargetOptions(decks)).toEqual([
      { id: "", label: "Keep each draft target" },
      { id: "deck_parent", label: "Japanese · N4" },
      { id: "deck_vocab", label: "Japanese / Vocabulary · N4" }
    ]);
  });

  test("guides users to export approved generated cards as Anki packages", () => {
    expect(draftApprovalMessage({ approved: 3, cardsCreated: 5, noteIds: ["note_1", "note_2", "note_3"] })).toBe(
      "Approved 3 drafts into 5 cards. Export generated packages from Learning sources."
    );
  });
});
