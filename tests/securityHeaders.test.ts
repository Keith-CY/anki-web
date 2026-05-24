import { writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { makeTestServer } from "./helpers/server";

const expectedCsp =
  "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'";

describe("security response headers", () => {
  test("sets browser hardening headers on public health responses", async () => {
    const server = makeTestServer();
    const response = await server.request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(expectedCsp);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  });

  test("sets the same hardening headers on session login responses", async () => {
    const server = makeTestServer();
    const response = await server.request("/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secret" })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(expectedCsp);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  test("does not weaken media download headers while applying global hardening", async () => {
    const server = makeTestServer();
    const login = await server.request("/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secret" })
    });
    const cookie = login.headers.get("set-cookie") ?? "";
    const mediaPath = `${server.services.mediaDir}/accent.svg`;
    writeFileSync(mediaPath, Buffer.from("<svg></svg>"));
    server.services.db
      .prepare(
        `INSERT INTO media_assets (id, file_name, original_name, mime_type, path, checksum, source_id, created_at)
         VALUES ('media_svg_header', 'accent.svg', 'accent.svg', 'image/svg+xml', ?, 'svg-checksum', null, '2026-05-18T00:00:00.000Z')`
      )
      .run(mediaPath);

    const response = await server.request("/media/accent.svg", { headers: { cookie } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="accent.svg"');
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(expectedCsp);
  });
});
