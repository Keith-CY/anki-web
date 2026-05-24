import { describe, expect, test } from "vitest";
import {
  newNoteTypeEditorState,
  normalizeFieldLines,
  noteTypeDeleteDisabledReason,
  noteTypeEditorState,
  noteTypePayloadFromEditor
} from "../src/client/noteTypeEditor";
import type { NoteTypeSummary } from "../src/client/api";

const noteType: NoteTypeSummary = {
  id: "note_type_custom",
  ankiId: 123,
  name: "Sentence Mining",
  css: ".card {}",
  builtIn: false,
  hasCss: true,
  noteCount: 0,
  cardCount: 0,
  fields: [
    { id: "field_1", ord: 0, name: "Sentence" },
    { id: "field_2", ord: 1, name: "Meaning" }
  ],
  templates: [
    {
      id: "template_1",
      ord: 0,
      name: "Read",
      questionFormat: "{{Sentence}}",
      answerFormat: "{{FrontSide}}<hr>{{Meaning}}"
    }
  ]
};

describe("note type editor helpers", () => {
  test("builds a starter custom note type definition", () => {
    const state = newNoteTypeEditorState();

    expect(state.fieldsText).toContain("Expression");
    expect(state.templates[0].questionFormat).toContain("{{Expression}}");
  });

  test("round-trips note type summaries into editable payloads", () => {
    const state = noteTypeEditorState(noteType);

    expect(state).toMatchObject({
      name: "Sentence Mining",
      fieldsText: "Sentence\nMeaning"
    });
    expect(noteTypePayloadFromEditor({ ...state, fieldsText: " Sentence \nMeaning\nSentence\n" })).toEqual({
      name: "Sentence Mining",
      css: ".card {}",
      fields: ["Sentence", "Meaning"],
      templates: [
        {
          name: "Read",
          questionFormat: "{{Sentence}}",
          answerFormat: "{{FrontSide}}<hr>{{Meaning}}"
        }
      ]
    });
  });

  test("explains when deleting a note type is unsafe", () => {
    expect(normalizeFieldLines("A\n\n B \nA")).toEqual(["A", "B"]);
    expect(noteTypeDeleteDisabledReason({ ...noteType, builtIn: true })).toBe("Built-in Japanese note type");
    expect(noteTypeDeleteDisabledReason({ ...noteType, noteCount: 1 })).toBe("In use by existing notes");
    expect(noteTypeDeleteDisabledReason(noteType)).toBe("");
  });
});
