import type { NoteTypeSummary } from "./api";

export function noteTypeUsageText(noteType: NoteTypeSummary) {
  return `${noteType.noteCount} ${noteType.noteCount === 1 ? "note" : "notes"} · ${noteType.cardCount} ${
    noteType.cardCount === 1 ? "card" : "cards"
  }`;
}

export function noteTypeTemplateNames(noteType: NoteTypeSummary) {
  return [...noteType.templates]
    .sort((left, right) => left.ord - right.ord)
    .map((template) => template.name)
    .join(", ");
}
