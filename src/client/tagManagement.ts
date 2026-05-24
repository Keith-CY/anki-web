export function normalizeTagInput(value: string) {
  return value.trim();
}

export function tagRenameError(currentName: string, nextName: string) {
  const normalizedCurrent = normalizeTagInput(currentName);
  const normalizedNext = normalizeTagInput(nextName);
  if (!normalizedNext) return "Tag name is required";
  if (normalizedCurrent === normalizedNext) return "Tag name is unchanged";
  return null;
}

export function tagRenameMessage(name: string, updatedNotes: number) {
  return `Renamed tag to ${name} on ${updatedNotes} ${updatedNotes === 1 ? "note" : "notes"}.`;
}

export function tagDeleteMessage(name: string, updatedNotes: number) {
  return `Removed ${name} from ${updatedNotes} ${updatedNotes === 1 ? "note" : "notes"}.`;
}
