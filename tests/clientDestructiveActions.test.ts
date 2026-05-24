import { describe, expect, test, vi } from "vitest";
import { confirmDestructiveAction, destructiveActionMessage } from "../src/client/destructiveActions";

describe("destructive action confirmations", () => {
  test("describes the real data that will be removed", () => {
    expect(destructiveActionMessage("deck", "N4 Grammar")).toBe(
      'Delete deck "N4 Grammar" and its cards, drafts, and review history?'
    );
    expect(destructiveActionMessage("note", "予約")).toBe('Delete note "予約" and all sibling cards?');
    expect(destructiveActionMessage("media", "hatsuon.mp3")).toBe(
      'Delete media "hatsuon.mp3" and remove its references from cards and drafts?'
    );
  });

  test("only allows the action when the user confirms it", () => {
    const confirm = vi.fn(() => false);
    expect(confirmDestructiveAction("card", "確認", confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith('Delete card "確認"?');

    confirm.mockReturnValue(true);
    expect(confirmDestructiveAction("tag", "needs-review", confirm)).toBe(true);
  });
});
