import type { Deck } from "./api";

export interface DeckTreeOption {
  id: string;
  deck: Deck;
  label: string;
  depth: number;
}

export function deckPathLabel(deck: Deck, decks: Deck[]) {
  return deckPath(deck, decks).map((item) => item.name).join(" / ");
}

export function deckTreeOptions(decks: Deck[]) {
  const byParent = new Map<string | null, Deck[]>();
  const byId = new Map(decks.map((deck) => [deck.id, deck]));
  for (const deck of decks) {
    const parentId = deck.parentId && byId.has(deck.parentId) ? deck.parentId : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(deck);
    byParent.set(parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort(compareDecks);
  }

  const options: DeckTreeOption[] = [];
  const visit = (deck: Deck, parents: Deck[]) => {
    const path = [...parents, deck];
    options.push({
      id: deck.id,
      deck,
      label: path.map((item) => item.name).join(" / "),
      depth: parents.length
    });
    for (const child of byParent.get(deck.id) ?? []) {
      visit(child, path);
    }
  };
  for (const root of byParent.get(null) ?? []) {
    visit(root, []);
  }
  return options;
}

export function reparentDeckOptions(decks: Deck[], deckId: string) {
  const excluded = descendantDeckIds(decks, deckId);
  excluded.add(deckId);
  return deckTreeOptions(decks).filter((option) => !excluded.has(option.id));
}

function deckPath(deck: Deck, decks: Deck[]) {
  const byId = new Map(decks.map((candidate) => [candidate.id, candidate]));
  const path: Deck[] = [];
  const seen = new Set<string>();
  let current: Deck | undefined = deck;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function descendantDeckIds(decks: Deck[], deckId: string) {
  const byParent = new Map<string, Deck[]>();
  for (const deck of decks) {
    if (!deck.parentId) continue;
    const children = byParent.get(deck.parentId) ?? [];
    children.push(deck);
    byParent.set(deck.parentId, children);
  }
  const descendants = new Set<string>();
  const visit = (parentId: string) => {
    for (const child of byParent.get(parentId) ?? []) {
      if (descendants.has(child.id)) continue;
      descendants.add(child.id);
      visit(child.id);
    }
  };
  visit(deckId);
  return descendants;
}

function compareDecks(a: Deck, b: Deck) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
}
