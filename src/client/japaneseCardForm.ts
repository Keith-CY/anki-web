export type ManualCardFocus = "vocabulary" | "grammar" | "pronunciation";

export interface ManualJapaneseCardInput {
  focus: ManualCardFocus;
  expression: string;
  reading: string;
  pitchAccent: string;
  meaningZh: string;
  meaningEn: string;
  meaningJa: string;
  example: string;
  explanationZh: string;
  explanationEn: string;
  explanationJa: string;
  audio?: string;
  tags: string;
}

export function buildManualJapaneseCardPayload(input: ManualJapaneseCardInput) {
  return {
    fields: {
      Expression: input.expression.trim(),
      Reading: input.reading.trim(),
      PitchAccent: input.pitchAccent.trim(),
      PitchAccentSource: "manual",
      MeaningZh: input.meaningZh.trim(),
      MeaningEn: input.meaningEn.trim(),
      MeaningJa: input.meaningJa.trim(),
      Example: input.example.trim(),
      ExampleReading: "",
      ExplanationZh: input.explanationZh.trim(),
      ExplanationEn: input.explanationEn.trim(),
      ExplanationJa: input.explanationJa.trim(),
      Audio: input.audio?.trim() ?? "",
      SourceUrl: ""
    },
    tags: normalizeManualTags(input.focus, input.tags),
    createAllTemplates: input.focus === "pronunciation",
    templateNames: input.focus === "grammar" ? ["Grammar"] : undefined
  };
}

function normalizeManualTags(focus: ManualCardFocus, tags: string) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of ["manual", focus, ...tags.split(",").map((value) => value.trim()).filter(Boolean)]) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}
