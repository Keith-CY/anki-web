export const japaneseCardEditorFields = [
  { key: "Expression", label: "Expression", multiline: false },
  { key: "Reading", label: "Reading", multiline: false },
  { key: "PitchAccent", label: "Pitch accent", multiline: false },
  { key: "PitchAccentSource", label: "Pitch source", multiline: false },
  { key: "MeaningZh", label: "中文释义", multiline: false },
  { key: "MeaningEn", label: "English meaning", multiline: false },
  { key: "MeaningJa", label: "日本語説明", multiline: false },
  { key: "Example", label: "Example sentence", multiline: true },
  { key: "ExampleReading", label: "Example reading", multiline: true },
  { key: "ExplanationZh", label: "中文补充说明", multiline: true },
  { key: "ExplanationEn", label: "English explanation", multiline: true },
  { key: "ExplanationJa", label: "日本語補足", multiline: true },
  { key: "Audio", label: "Audio", multiline: false },
  { key: "SourceUrl", label: "Source URL", multiline: false }
] as const;

export type JapaneseCardEditorFieldKey = (typeof japaneseCardEditorFields)[number]["key"];

export interface JapaneseCardEditorState {
  fields: Record<JapaneseCardEditorFieldKey, string>;
  tags: string;
}

export interface JapaneseDraftEditorState extends JapaneseCardEditorState {
  kind: "vocabulary" | "grammar" | "pronunciation";
  pitchAccentStatus: "confirmed" | "review-required";
  deckId: string;
}

export function createJapaneseCardEditorState(fields: Record<string, string>, tags: string[]): JapaneseCardEditorState {
  const editorFields = Object.fromEntries(
    japaneseCardEditorFields.map((field) => [field.key, fields[field.key] ?? ""])
  ) as Record<JapaneseCardEditorFieldKey, string>;
  return {
    fields: editorFields,
    tags: tags.join(", ")
  };
}

export function buildJapaneseCardUpdatePayload(state: JapaneseCardEditorState) {
  const fields = Object.fromEntries(
    japaneseCardEditorFields.map((field) => [field.key, state.fields[field.key].trim()])
  ) as Record<JapaneseCardEditorFieldKey, string>;
  return {
    fields,
    tags: normalizeTags(state.tags)
  };
}

export function buildJapaneseDraftUpdatePayload(state: JapaneseDraftEditorState) {
  return {
    ...buildJapaneseCardUpdatePayload(state),
    kind: state.kind,
    pitchAccentStatus: state.pitchAccentStatus,
    deckId: state.deckId || null
  };
}

function normalizeTags(tags: string) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags.split(",").map((value) => value.trim()).filter(Boolean)) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}
