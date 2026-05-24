import { describe, expect, test } from "vitest";
import {
  buildJapaneseCardUpdatePayload,
  buildJapaneseDraftUpdatePayload,
  createJapaneseCardEditorState,
  japaneseCardEditorFields
} from "../src/client/japaneseCardEditor";

describe("Japanese card editor model", () => {
  test("covers the full Japanese study field set in a stable edit order", () => {
    expect(japaneseCardEditorFields.map((field) => field.key)).toEqual([
      "Expression",
      "Reading",
      "PitchAccent",
      "PitchAccentSource",
      "MeaningZh",
      "MeaningEn",
      "MeaningJa",
      "Example",
      "ExampleReading",
      "ExplanationZh",
      "ExplanationEn",
      "ExplanationJa",
      "Audio",
      "SourceUrl"
    ]);
  });

  test("builds a complete update payload without dropping pronunciation or provenance fields", () => {
    const state = createJapaneseCardEditorState(
      {
        Expression: " 食べる ",
        Reading: " たべる ",
        PitchAccent: " 2 ",
        PitchAccentSource: " manual ",
        MeaningZh: " 吃 ",
        MeaningEn: " to eat ",
        MeaningJa: " 食物を口に入れる ",
        Example: " パンを食べます。 ",
        ExampleReading: " パンをたべます。 ",
        ExplanationZh: " 他动词 ",
        ExplanationEn: " Ichidan verb ",
        ExplanationJa: " 一段動詞 ",
        Audio: " [sound:taberu.mp3] ",
        SourceUrl: " https://example.com/lesson "
      },
      ["vocabulary", "N5"]
    );
    state.tags = " vocabulary, N5, vocabulary ";

    expect(buildJapaneseCardUpdatePayload(state)).toEqual({
      fields: {
        Expression: "食べる",
        Reading: "たべる",
        PitchAccent: "2",
        PitchAccentSource: "manual",
        MeaningZh: "吃",
        MeaningEn: "to eat",
        MeaningJa: "食物を口に入れる",
        Example: "パンを食べます。",
        ExampleReading: "パンをたべます。",
        ExplanationZh: "他动词",
        ExplanationEn: "Ichidan verb",
        ExplanationJa: "一段動詞",
        Audio: "[sound:taberu.mp3]",
        SourceUrl: "https://example.com/lesson"
      },
      tags: ["vocabulary", "N5"]
    });
  });

  test("builds draft approval edits with kind, pitch status, and target deck", () => {
    const state = createJapaneseCardEditorState({ Expression: "文法", MeaningZh: "语法" }, ["grammar"]);

    expect(
      buildJapaneseDraftUpdatePayload({
        ...state,
        kind: "grammar",
        pitchAccentStatus: "confirmed",
        deckId: "deck_target"
      })
    ).toMatchObject({
      kind: "grammar",
      pitchAccentStatus: "confirmed",
      deckId: "deck_target",
      fields: {
        Expression: "文法",
        MeaningZh: "语法"
      },
      tags: ["grammar"]
    });
  });
});
