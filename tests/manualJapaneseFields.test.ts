import { describe, expect, test } from "vitest";
import { buildManualJapaneseCardPayload } from "../src/client/japaneseCardForm";

describe("manual Japanese card form payload", () => {
  test("builds rich Japanese study fields and normalized tags", () => {
    const payload = buildManualJapaneseCardPayload({
      focus: "grammar",
      expression: "〜てもいい",
      reading: "てもいい",
      pitchAccent: "review",
      meaningZh: "可以...",
      meaningEn: "may; it is okay to",
      meaningJa: "許可を表す表現",
      example: "ここで写真を撮ってもいいです。",
      explanationZh: "表示许可或允许。",
      explanationEn: "Used to ask for or grant permission.",
      explanationJa: "許可を求めたり与えたりする時に使います。",
      audio: " [sound:manual-grammar.mp3] ",
      tags: " N4, grammar ,  文法 "
    });

    expect(payload.fields).toEqual({
      Expression: "〜てもいい",
      Reading: "てもいい",
      PitchAccent: "review",
      PitchAccentSource: "manual",
      MeaningZh: "可以...",
      MeaningEn: "may; it is okay to",
      MeaningJa: "許可を表す表現",
      Example: "ここで写真を撮ってもいいです。",
      ExampleReading: "",
      ExplanationZh: "表示许可或允许。",
      ExplanationEn: "Used to ask for or grant permission.",
      ExplanationJa: "許可を求めたり与えたりする時に使います。",
      Audio: "[sound:manual-grammar.mp3]",
      SourceUrl: ""
    });
    expect(payload.tags).toEqual(["manual", "grammar", "N4", "文法"]);
    expect(payload.createAllTemplates).toBe(false);
    expect(payload.templateNames).toEqual(["Grammar"]);
  });

  test("requests all Japanese templates for pronunciation-focused cards", () => {
    const payload = buildManualJapaneseCardPayload({
      focus: "pronunciation",
      expression: "発音",
      reading: "はつおん",
      pitchAccent: "0",
      meaningZh: "发音",
      meaningEn: "pronunciation",
      meaningJa: "音を出すこと",
      example: "発音を練習します。",
      explanationZh: "用于发音训练。",
      explanationEn: "Used for pronunciation practice.",
      explanationJa: "発音練習に使います。",
      audio: "",
      tags: "N4"
    });

    expect(payload.createAllTemplates).toBe(true);
    expect(payload.tags).toEqual(["manual", "pronunciation", "N4"]);
  });
});
