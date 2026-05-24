import { afterEach, describe, expect, test, vi } from "vitest";
import { sessionCookieName } from "../src/server/auth";
import { makeTestServer } from "./helpers/server";

describe("single-password auth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("rejects bad passwords and protects private APIs", async () => {
    const server = makeTestServer();

    const protectedResponse = await server.request("/api/decks");
    expect(protectedResponse.status).toBe(401);

    const bad = await server.request("/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong" })
    });
    expect(bad.status).toBe(401);
  });

  test("successful login clears failed login rate-limit count for that source", async () => {
    const server = makeTestServer();
    const headers = { "content-type": "application/json", "x-forwarded-for": "203.0.113.24" };
    for (let index = 0; index < 7; index += 1) {
      const bad = await server.request("/api/session/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: "wrong" })
      });
      expect(bad.status).toBe(401);
    }

    const good = await server.request("/api/session/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "secret" })
    });
    expect(good.status).toBe(200);

    const nextGood = await server.request("/api/session/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "secret" })
    });
    expect(nextGood.status).toBe(200);
  });

  test("expires sessions server-side after the cookie lifetime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T00:00:00.000Z"));
    const server = makeTestServer();

    const login = await server.request("/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secret" })
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";

    const active = await server.request("/api/session", { headers: { cookie } });
    expect(await active.json()).toMatchObject({ authenticated: true });

    vi.setSystemTime(new Date("2026-06-16T00:00:00.001Z"));

    const expired = await server.request("/api/session", { headers: { cookie } });
    expect(await expired.json()).toEqual({ authenticated: false, csrfToken: null });

    const protectedResponse = await server.request("/api/decks", { headers: { cookie } });
    expect(protectedResponse.status).toBe(401);
  });

  test("rejects unsigned raw session ids as cookies", async () => {
    const server = makeTestServer();
    const session = server.services.sessions.create();
    const cookie = `${sessionCookieName}=${session.id}`;

    const sessionResponse = await server.request("/api/session", { headers: { cookie } });
    expect(await sessionResponse.json()).toEqual({ authenticated: false, csrfToken: null });

    const protectedResponse = await server.request("/api/decks", { headers: { cookie } });
    expect(protectedResponse.status).toBe(401);
  });

  test("requires CSRF token when logging out an authenticated session", async () => {
    const server = makeTestServer();
    const login = await server.request("/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secret" })
    });
    const cookie = login.headers.get("set-cookie") ?? "";
    const csrfToken = (await login.json()).csrfToken as string;

    const missingToken = await server.request("/api/session", {
      method: "DELETE",
      headers: { cookie }
    });
    expect(missingToken.status).toBe(403);
    await expect(missingToken.json()).resolves.toEqual({ error: "Invalid CSRF token" });

    const stillActive = await server.request("/api/session", { headers: { cookie } });
    await expect(stillActive.json()).resolves.toMatchObject({ authenticated: true });

    const logout = await server.request("/api/session", {
      method: "DELETE",
      headers: { cookie, "x-csrf-token": csrfToken }
    });
    expect(logout.status).toBe(200);
    await expect(logout.json()).resolves.toEqual({ authenticated: false });
  });

  test("clears stale logout requests even when no valid session exists", async () => {
    const server = makeTestServer();

    const logout = await server.request("/api/session", {
      method: "DELETE",
      headers: { cookie: `${sessionCookieName}=stale-or-invalid` }
    });

    expect(logout.status).toBe(200);
    await expect(logout.json()).resolves.toEqual({ authenticated: false });
    expect(logout.headers.get("set-cookie")).toContain(`${sessionCookieName}=`);
  });
});
