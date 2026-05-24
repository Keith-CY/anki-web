import { describe, expect, test } from "vitest";
import { noteTypeTemplateNames, noteTypeUsageText } from "../src/client/noteTypesViewModel";
import type { NoteTypeSummary } from "../src/client/api";

const noteType: NoteTypeSummary = {
  id: "note_type_1",
  ankiId: 123,
  name: "Japanese",
  css: ".card {}",
  builtIn: true,
  hasCss: true,
  noteCount: 2,
  cardCount: 5,
  fields: [],
  templates: [
    { id: "template_1", ord: 0, name: "Recognize", questionFormat: "", answerFormat: "" },
    { id: "template_2", ord: 1, name: "Recall", questionFormat: "", answerFormat: "" }
  ]
};

describe("note type view model", () => {
  test("summarizes note and card usage", () => {
    expect(noteTypeUsageText(noteType)).toBe("2 notes · 5 cards");
  });

  test("formats template names in ordinal order", () => {
    expect(noteTypeTemplateNames(noteType)).toBe("Recognize, Recall");
  });
});
