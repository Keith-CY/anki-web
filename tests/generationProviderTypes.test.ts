import { describe, expect, test } from "vitest";
import type { GenerateDrafts } from "../src/server/types";

describe("custom generation provider types", () => {
  test("exposes source and deck context to provider implementations", () => {
    const provider: GenerateDrafts = async (input) => {
      const sourceId: string = input.sourceId;
      const deckId: string = input.deckId;
      const jlptLevel = input.jlptLevel;
      return { drafts: [], sourceId, deckId, jlptLevel };
    };

    expect(typeof provider).toBe("function");
  });
});
