import { describe, expect, test } from "vitest";
import { verify } from "@node-rs/argon2";
import { buildConfig, argonVerifyOptions, hashAppPassword } from "../src/server/config";

describe("server configuration", () => {
  test("rejects blank production passwords instead of hashing an empty instance password", () => {
    expect(() => buildConfig({ nodeEnv: "production", appPassword: "", sessionSecret: "long-production-secret" })).toThrow(
      /APP_PASSWORD or APP_PASSWORD_HASH/i
    );
    expect(() => buildConfig({ nodeEnv: "production", appPassword: "   ", sessionSecret: "long-production-secret" })).toThrow(
      /APP_PASSWORD or APP_PASSWORD_HASH/i
    );
  });

  test("rejects blank production session secrets", () => {
    expect(() => buildConfig({ nodeEnv: "production", appPassword: "secret", sessionSecret: "" })).toThrow(/SESSION_SECRET/i);
    expect(() => buildConfig({ nodeEnv: "production", appPassword: "secret", sessionSecret: "   " })).toThrow(/SESSION_SECRET/i);
  });

  test("rejects short production session secrets", () => {
    expect(() => buildConfig({ nodeEnv: "production", appPassword: "secret", sessionSecret: "short-secret" })).toThrow(
      /SESSION_SECRET must be at least 32 characters/i
    );
  });

  test("treats blank optional OpenAI settings as absent and preserves safe defaults", () => {
    const config = buildConfig({
      nodeEnv: "test",
      appPassword: "secret",
      sessionSecret: "test-session-secret",
      openaiApiKey: " ",
      openaiBaseUrl: "",
      openaiTextModel: " ",
      openaiTtsModel: "",
      openaiTtsVoice: " "
    });

    expect(config.openaiApiKey).toBeNull();
    expect(config.openaiBaseUrl).toBeNull();
    expect(config.openaiTextModel).toBe("gpt-5-mini");
    expect(config.openaiTtsModel).toBe("gpt-4o-mini-tts");
    expect(config.openaiTtsVoice).toBe("alloy");
  });

  test("generates Argon2id app password hashes for production secret setup", async () => {
    const hash = hashAppPassword("correct horse battery staple");

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verify(hash, "correct horse battery staple", argonVerifyOptions())).resolves.toBe(true);
    await expect(verify(hash, "wrong password", argonVerifyOptions())).resolves.toBe(false);
  });
});
