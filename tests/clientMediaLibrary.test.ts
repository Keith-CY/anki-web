import { describe, expect, test } from "vitest";
import { mediaActionErrorMessage, mediaDeletedMessage, mediaUploadedMessage, mediaAssetReference } from "../src/client/mediaLibrary";

describe("media library view model", () => {
  test("builds insertable Anki field references for uploaded media", () => {
    expect(mediaAssetReference({ fileName: "hatsuon.mp3", mimeType: "audio/mpeg" })).toBe("[sound:hatsuon.mp3]");
    expect(mediaAssetReference({ fileName: "pitch.png", mimeType: "image/png" })).toBe('<img src="pitch.png">');
  });

  test("confirms upload and delete actions with useful media context", () => {
    const asset = { originalName: "hatsuon.mp3", fileName: "hatsuon-abc.mp3", mimeType: "audio/mpeg" };

    expect(mediaUploadedMessage(asset)).toBe("Uploaded hatsuon.mp3: [sound:hatsuon-abc.mp3]");
    expect(mediaDeletedMessage(asset)).toBe("Deleted media hatsuon.mp3 and removed its card references.");
  });

  test("reports media action failures with operation-specific context", () => {
    expect(mediaActionErrorMessage("upload", new Error("Media file is empty"))).toBe("Media upload failed: Media file is empty");
    expect(mediaActionErrorMessage("delete", "missing asset")).toBe("Media delete failed: missing asset");
    expect(mediaActionErrorMessage("delete", null)).toBe("Media delete failed");
  });
});
