export type DestructiveActionKind = "deck" | "card" | "note" | "media" | "noteType" | "tag";

export function destructiveActionMessage(kind: DestructiveActionKind, label: string) {
  const quoted = `"${label || "selected item"}"`;
  if (kind === "deck") return `Delete deck ${quoted} and its cards, drafts, and review history?`;
  if (kind === "note") return `Delete note ${quoted} and all sibling cards?`;
  if (kind === "media") return `Delete media ${quoted} and remove its references from cards and drafts?`;
  if (kind === "noteType") return `Delete note type ${quoted}?`;
  if (kind === "tag") return `Remove tag ${quoted} from matching cards?`;
  return `Delete card ${quoted}?`;
}

export function confirmDestructiveAction(
  kind: DestructiveActionKind,
  label: string,
  confirmAction: (message: string) => boolean = defaultConfirmAction
) {
  return confirmAction(destructiveActionMessage(kind, label));
}

function defaultConfirmAction(message: string) {
  if (typeof globalThis.confirm !== "function") return false;
  return globalThis.confirm(message);
}
