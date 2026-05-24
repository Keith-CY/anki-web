import { verify } from "@node-rs/argon2";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { argonVerifyOptions } from "./config";
import type { AppServices, SessionRecord } from "./types";

export const sessionCookieName = "anki_session";
export const sessionCookieMaxAgeSeconds = 60 * 60 * 24 * 30;
export const sessionTtlMs = sessionCookieMaxAgeSeconds * 1000;

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function verifyPassword(services: AppServices, password: string) {
  return verify(services.config.appPasswordHash, password, argonVerifyOptions());
}

export async function checkLoginRateLimit(c: Context) {
  const key = loginRateLimitKey(c);
  const now = Date.now();
  const current = attempts.get(key);
  if (current && current.resetAt > now && current.count >= 8) {
    return false;
  }
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return true;
}

export function resetLoginRateLimit(c: Context) {
  attempts.delete(loginRateLimitKey(c));
}

function loginRateLimitKey(c: Context) {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function attachSessionCookie(c: Context, services: AppServices, session: SessionRecord) {
  await setSignedCookie(c, sessionCookieName, session.id, services.config.sessionSecret, {
    httpOnly: true,
    sameSite: "Lax",
    secure: services.config.nodeEnv === "production",
    path: "/",
    maxAge: sessionCookieMaxAgeSeconds
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, sessionCookieName, { path: "/" });
}

export async function readSession(c: Context, services: AppServices) {
  const sessionId = await getSignedCookie(c, services.config.sessionSecret, sessionCookieName);
  return typeof sessionId === "string" ? services.sessions.get(sessionId) : null;
}

export function requireAuth(services: AppServices): MiddlewareHandler {
  return async (c, next) => {
    const session = await readSession(c, services);
    if (!session) {
      return c.json({ error: "Authentication required" }, 401);
    }
    c.set("session", session);
    await next();
  };
}

export function requireCsrf(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
      await next();
      return;
    }
    const session = c.get("session") as SessionRecord | undefined;
    const token = c.req.header("x-csrf-token");
    if (!session || token !== session.csrfToken) {
      return c.json({ error: "Invalid CSRF token" }, 403);
    }
    await next();
  };
}
