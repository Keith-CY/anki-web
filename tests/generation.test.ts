import { describe, expect, test } from "vitest";
import { generatedDraftsSchema } from "../src/server/generation/schema";

describe("Japanese generation schema", () => {
  test("accepts trilingual vocabulary grammar and pronunciation drafts", () => {
    const parsed = generatedDraftsSchema.parse({
      drafts: [
        {
          kind: "vocabulary",
          expression: "確認",
          reading: "かくにん",
          pitchAccent: "0",
          pitchAccentSource: "ai",
          meanings: { zh: "确认", en: "confirmation", ja: "たしかめること" },
          example: "予約を確認します。",
          exampleReading: "よやくをかくにんします。",
          explanation: { zh: "常用于确认信息。", en: "Used to confirm information.", ja: "情報をたしかめる時に使う。" },
          tags: ["N4"]
        },
        {
          kind: "grammar",
          expression: "〜てしまう",
          reading: "てしまう",
          pitchAccent: null,
          pitchAccentSource: "none",
          meanings: { zh: "完成/遗憾", en: "completion/regret", ja: "完了や残念な気持ち" },
          example: "財布を忘れてしまいました。",
          exampleReading: "さいふをわすれてしまいました。",
          explanation: { zh: "表示做完或遗憾。", en: "Marks completion or regret.", ja: "完了や後悔を表す。" },
          tags: ["N4", "grammar"]
        }
      ]
    });

    expect(parsed.drafts).toHaveLength(2);
  });
});
