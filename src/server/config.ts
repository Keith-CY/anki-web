import { hashSync } from "@node-rs/argon2";
import { join } from "node:path";
import type { AppConfig, CreateConfigInput } from "./types";

const argonOptions = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
};

export function buildConfig(input: CreateConfigInput = {}): AppConfig {
  const nodeEnv = normalizeNodeEnv(input.nodeEnv ?? process.env.NODE_ENV);
  const dataDir = input.dataDir ?? process.env.DATA_DIR ?? (nodeEnv === "production" ? "/data" : join(process.cwd(), "data"));
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL ?? `${dataDir}/anki-web.db`;
  const configuredPasswordHash = nonBlankSetting(input.appPasswordHash ?? process.env.APP_PASSWORD_HASH);
  const configuredPassword = nonBlankSetting(input.appPassword ?? process.env.APP_PASSWORD);
  const appPasswordHash = configuredPasswordHash ?? hashAppPassword(configuredPassword ?? developmentPassword(nodeEnv));
  const sessionSecret = productionSessionSecret(
    nonBlankSetting(input.sessionSecret ?? process.env.SESSION_SECRET) ?? developmentSecret(nodeEnv),
    nodeEnv
  );

  return {
    dataDir,
    databaseUrl,
    appPasswordHash,
    nodeEnv,
    sessionSecret,
    openaiApiKey: optionalSetting(input.openaiApiKey ?? process.env.OPENAI_API_KEY),
    openaiBaseUrl: optionalSetting(input.openaiBaseUrl ?? process.env.OPENAI_BASE_URL),
    openaiTextModel: optionalSetting(input.openaiTextModel ?? process.env.OPENAI_TEXT_MODEL) ?? "gpt-5-mini",
    openaiTtsModel: optionalSetting(input.openaiTtsModel ?? process.env.OPENAI_TTS_MODEL) ?? "gpt-4o-mini-tts",
    openaiTtsVoice: optionalSetting(input.openaiTtsVoice ?? process.env.OPENAI_TTS_VOICE) ?? "alloy",
    pitchAccentLexiconSource: optionalSetting(input.pitchAccentLexiconSource ?? process.env.PITCH_ACCENT_LEXICON_SOURCE)
  };
}

export function argonVerifyOptions() {
  return argonOptions;
}

export function hashAppPassword(password: string) {
  if (!password.trim()) throw new Error("Password must not be blank");
  return hashSync(password, argonOptions);
}

function normalizeNodeEnv(value: string | null | undefined): AppConfig["nodeEnv"] {
  if (value === "production" || value === "test") return value;
  return "development";
}

function developmentPassword(nodeEnv: AppConfig["nodeEnv"]) {
  if (nodeEnv === "production") {
    throw new Error("APP_PASSWORD or APP_PASSWORD_HASH must be set in production.");
  }
  return "anki";
}

function developmentSecret(nodeEnv: AppConfig["nodeEnv"]) {
  if (nodeEnv === "production") {
    throw new Error("SESSION_SECRET must be set in production.");
  }
  return "dev-session-secret-change-me";
}

function productionSessionSecret(secret: string, nodeEnv: AppConfig["nodeEnv"]) {
  if (nodeEnv === "production" && secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production.");
  }
  return secret;
}

function optionalSetting(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function nonBlankSetting(value: string | null | undefined) {
  return value?.trim() ? value : null;
}
