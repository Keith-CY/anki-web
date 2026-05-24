import { describe, expect, test } from "vitest";
import { normalizeTagInput, tagDeleteMessage, tagRenameError, tagRenameMessage } from "../src/client/tagManagement";

describe("client tag management helpers", () => {
  test("normalizes tag names before rename requests", () => {
    expect(normalizeTagInput("  JLPT N4  ")).toBe("JLPT N4");
  });

  test("blocks empty and unchanged tag renames", () => {
    expect(tagRenameError("N4", " ")).toBe("Tag name is required");
    expect(tagRenameError("N4", " N4 ")).toBe("Tag name is unchanged");
    expect(tagRenameError("N4", "JLPT N4")).toBeNull();
  });

  test("builds concise tag action feedback", () => {
    expect(tagRenameMessage("JLPT N4", 3)).toBe("Renamed tag to JLPT N4 on 3 notes.");
    expect(tagDeleteMessage("cleanup", 1)).toBe("Removed cleanup from 1 note.");
  });
});
