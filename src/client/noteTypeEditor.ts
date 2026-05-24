import type { NoteTypeSummary } from "./api";

export interface NoteTypeTemplateInput {
  name: string;
  questionFormat: string;
  answerFormat: string;
}

export interface NoteTypeEditorState {
  name: string;
  css: string;
  fieldsText: string;
  templates: NoteTypeTemplateInput[];
}

export function newNoteTypeEditorState(): NoteTypeEditorState {
  return {
    name: "",
    css: ".card { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 20px; }",
    fieldsText: "Expression\nReading\nMeaning",
    templates: [
      {
        name: "Card 1",
        questionFormat: "{{Expression}}",
        answerFormat: "{{FrontSide}}<hr>{{Reading}}<br>{{Meaning}}"
      }
    ]
  };
}

export function noteTypeEditorState(noteType: NoteTypeSummary): NoteTypeEditorState {
  return {
    name: noteType.name,
    css: noteType.css ?? "",
    fieldsText: noteType.fields.map((field) => field.name).join("\n"),
    templates: noteType.templates.map((template) => ({
      name: template.name,
      questionFormat: template.questionFormat,
      answerFormat: template.answerFormat
    }))
  };
}

export function noteTypePayloadFromEditor(state: NoteTypeEditorState) {
  return {
    name: state.name.trim(),
    css: state.css,
    fields: normalizeFieldLines(state.fieldsText),
    templates: state.templates.map((template) => ({
      name: template.name.trim(),
      questionFormat: template.questionFormat,
      answerFormat: template.answerFormat
    }))
  };
}

export function normalizeFieldLines(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((field) => field.trim())
        .filter(Boolean)
    )
  );
}

export function noteTypeDeleteDisabledReason(noteType: NoteTypeSummary) {
  if (noteType.builtIn) return "Built-in Japanese note type";
  if (noteType.noteCount > 0 || noteType.cardCount > 0) return "In use by existing notes";
  return "";
}
