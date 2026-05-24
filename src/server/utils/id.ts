import { createHash, randomBytes, randomUUID } from "node:crypto";

export function id(prefix?: string) {
  const value = randomUUID();
  return prefix ? `${prefix}_${value}` : value;
}

let lastNumericId = 0;

export function numericId() {
  const candidate = Math.floor(Date.now() * 1000 + Math.random() * 1000);
  lastNumericId = Math.max(candidate, lastNumericId + 1);
  return lastNumericId;
}

export function ankiGuid() {
  return randomBytes(8).toString("base64url").slice(0, 10);
}

export function checksum(input: string | Buffer) {
  return createHash("sha1").update(input).digest("hex");
}

export function ankiChecksum(input: string) {
  const digest = checksum(input);
  return Number.parseInt(digest.slice(0, 8), 16);
}

export function nowIso(date = new Date()) {
  return date.toISOString();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function safeFileName(name: string) {
  return name.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim() || "media";
}
