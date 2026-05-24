import { describe, expect, test } from "vitest";
import { draftAudioSource, draftAudioTitle } from "../src/client/draftAudio";

describe("draft audio helpers", () => {
  test("builds authenticated media URLs from Anki sound markers", () => {
    expect(draftAudioSource({ Audio: "[sound:発音 sample.mp3]" })).toBe("/media/%E7%99%BA%E9%9F%B3%20sample.mp3");
  });

  test("ignores drafts without generated audio", () => {
    expect(draftAudioSource({ Audio: "" })).toBeNull();
    expect(draftAudioSource({ Audio: "no marker" })).toBeNull();
  });

  test("labels generation as refresh when audio already exists", () => {
    expect(draftAudioTitle({ Audio: "[sound:hatsuon.mp3]" })).toBe("Refresh audio");
    expect(draftAudioTitle({ Audio: "" })).toBe("Generate audio");
  });
});
