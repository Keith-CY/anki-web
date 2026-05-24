import type { Deck, Draft } from "./api";

export interface DraftInboxQueryInput {
  selectedStudyDeckId?: string;
  kind?: string;
  pitchAccentStatus?: string;
}

export interface DraftBulkApprovalInput {
  selectedStudyDeckId?: string;
  explicitTargetDeckId?: string;
}

export interface DraftApprovalResult {
  approved: number;
  cardsCreated: number;
  noteIds?: string[];
}

export function draftInboxQuery(input: DraftInboxQueryInput): { kind?: string; pitchAccentStatus?: string } {
  return {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.pitchAccentStatus ? { pitchAccentStatus: input.pitchAccentStatus } : {})
  };
}

export function draftBulkApprovalDeckId(input: DraftBulkApprovalInput) {
  return input.explicitTargetDeckId || undefined;
}

export function draftBulkTargetOptions(decks: Deck[]) {
  return [
    { id: "", label: "Keep each draft target" },
    ...decks.map((deck) => ({
      id: deck.id,
      label: `${deckDisplayName(deck)} · ${deck.jlptLevel}`
    }))
  ];
}

export function draftApprovalMessage(result: DraftApprovalResult) {
  return `Approved ${result.approved} drafts into ${result.cardsCreated} cards. Export generated packages from Learning sources.`;
}

export function draftDeckLabel(draft: Pick<Draft, "deckId">, deckNames: Map<string, string>) {
  return draft.deckId ? deckNames.get(draft.deckId) ?? "Unknown deck" : "Default deck";
}

function deckDisplayName(deck: Pick<Deck, "name">) {
  return deck.name.split("::").filter(Boolean).join(" / ");
}
