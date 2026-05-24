import { describe, expect, test } from "vitest";
import { assertSafePublicUrl } from "../src/server/security/urlSafety";

describe("safe public URL validation", () => {
  test("allows normal public HTTPS URLs", async () => {
    await expect(assertSafePublicUrl("https://93.184.216.34/deck.apkg")).resolves.toEqual(
      new URL("https://93.184.216.34/deck.apkg")
    );
  });

  test("rejects private and local network targets", async () => {
    await expect(assertSafePublicUrl("http://127.0.0.1:8080/deck.apkg")).rejects.toThrow(/private/i);
    await expect(assertSafePublicUrl("http://10.0.0.7/deck.apkg")).rejects.toThrow(/private/i);
    await expect(assertSafePublicUrl("http://localhost/deck.apkg")).rejects.toThrow(/private/i);
  });

  test("rejects local hostnames with absolute DNS trailing dots before DNS lookup", async () => {
    await expect(assertSafePublicUrl("http://printer.local./deck.apkg")).rejects.toThrow(/private/i);
    await expect(assertSafePublicUrl("http://localhost./deck.apkg")).rejects.toThrow(/private/i);
  });

  test("rejects reserved non-public network targets", async () => {
    await expect(assertSafePublicUrl("http://100.64.0.1/deck.apkg")).rejects.toThrow(/private/i);
    await expect(assertSafePublicUrl("http://198.18.0.1/deck.apkg")).rejects.toThrow(/private/i);
    await expect(assertSafePublicUrl("http://192.0.2.1/deck.apkg")).rejects.toThrow(/private/i);
    await expect(assertSafePublicUrl("http://[2001:db8::1]/deck.apkg")).rejects.toThrow(/private/i);
  });

  test("rejects private IPv6 literal forms", async () => {
    await expect(assertSafePublicUrl("http://[::1]:8080/deck.apkg")).rejects.toThrow(/private/i);
    await expect(assertSafePublicUrl("http://[::ffff:127.0.0.1]/deck.apkg")).rejects.toThrow(/private/i);
    await expect(assertSafePublicUrl("http://[fc00::1]/deck.apkg")).rejects.toThrow(/private/i);
    await expect(assertSafePublicUrl("http://[fe80::1]/deck.apkg")).rejects.toThrow(/private/i);
    await expect(assertSafePublicUrl("http://[ff02::1]/deck.apkg")).rejects.toThrow(/private/i);
  });

  test("rejects non HTTP protocols", async () => {
    await expect(assertSafePublicUrl("file:///tmp/deck.apkg")).rejects.toThrow(/http/i);
  });

  test("rejects credentialed URLs instead of silently stripping credentials", async () => {
    await expect(assertSafePublicUrl("https://user:secret@93.184.216.34/deck.apkg")).rejects.toThrow(/credentials/i);
  });

  test("rejects non-standard HTTP and HTTPS ports", async () => {
    await expect(assertSafePublicUrl("http://93.184.216.34:22/deck.apkg")).rejects.toThrow(/port/i);
    await expect(assertSafePublicUrl("https://93.184.216.34:8443/deck.apkg")).rejects.toThrow(/port/i);
  });
});
