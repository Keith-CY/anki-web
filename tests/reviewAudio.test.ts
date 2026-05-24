import { describe, expect, test } from "vitest";
import { hasReviewAudio, reviewAudioButtonLabel, reviewAudioText } from "../src/client/reviewAudio";

const baseCard = {
  id: "card_1",
  noteId: "note_1",
  deckId: "deck_1",
  state: "new",
  dueAt: "2026-05-17T00:00:00.000Z",
  reps: 0,
  lapses: 0,
  noteType: { id: "note_type_1", name: "Japanese", css: "" },
  template: { id: "template_1", name: "Recognize", ord: 0 },
  fieldNames: [],
  fields: {},
  tags: [],
  question: "",
  answer: ""
};

describe("review audio helpers", () => {
  test("uses expression before reading as the Japanese TTS text", () => {
    expect(
      reviewAudioText({
        ...baseCard,
        fields: { Expression: "食べる", Reading: "たべる" }
      })
    ).toBe("食べる");
  });

  test("falls back to reading when expression is absent", () => {
    expect(
      reviewAudioText({
        ...baseCard,
        fields: { Expression: " ", Reading: "たべる" }
      })
    ).toBe("たべる");
  });

  test("falls back to imported card field order when Japanese fields are absent", () => {
    expect(
      reviewAudioText({
        ...baseCard,
        fieldNames: ["Front", "Back"],
        fields: { Front: "表", Back: "裏" }
      })
    ).toBe("表");
  });

  test("detects existing Anki sound markers and labels the action accordingly", () => {
    const cardWithAudio = {
      ...baseCard,
      fields: { Audio: "[sound:taberu.mp3]" }
    };

    expect(hasReviewAudio(cardWithAudio)).toBe(true);
    expect(reviewAudioButtonLabel(cardWithAudio)).toBe("Refresh audio");
    expect(reviewAudioButtonLabel(baseCard)).toBe("Generate audio");
  });
});
