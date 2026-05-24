import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchPublicUrl } from "../src/server/imports/fetch";

describe("public URL fetch safeguards", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("stops reading a response body as soon as the byte limit is exceeded", async () => {
    const chunks = [Buffer.alloc(6, "a"), Buffer.alloc(6, "b"), Buffer.alloc(6, "c")];
    let reads = 0;
    let cancelled = false;

    const transport = vi.fn(async () => {
      const body = {
        getReader() {
          return {
            async read() {
              const chunk = chunks[reads];
              reads += 1;
              return chunk ? { done: false, value: chunk } : { done: true, value: undefined };
            },
            async cancel() {
              cancelled = true;
            },
            releaseLock() {}
          };
        }
      };

      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/octet-stream" }),
        body,
        arrayBuffer: async () => {
          reads = chunks.length;
          return Buffer.concat(chunks);
        }
      } as unknown as Response;
    });

    await expect(
      fetchPublicUrl("https://93.184.216.34/deck.apkg", {
        maxBytes: 10,
        contentTypes: ["application/octet-stream"],
        transport
      })
    ).rejects.toThrow(/larger than 10 bytes/);

    expect(reads).toBeLessThan(chunks.length);
    expect(cancelled).toBe(true);
  });

  test("passes the validated public DNS addresses into the outgoing fetch transport", async () => {
    const seen: Array<{ url: string; addresses: Array<{ address: string; family: number }> }> = [];
    const transport = vi.fn(async (url: URL, context: { addresses: Array<{ address: string; family: number }> }) => {
      seen.push({ url: url.toString(), addresses: context.addresses });
      return new Response(Buffer.from("package bytes"), {
        status: 200,
        headers: new Headers({ "content-type": "application/octet-stream" })
      });
    });
    const lookupHost = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

    const result = await fetchPublicUrl("https://example.invalid/deck.apkg", {
      maxBytes: 100,
      contentTypes: ["application/octet-stream"],
      lookupHost,
      transport
    });

    expect(result.buffer).toEqual(Buffer.from("package bytes"));
    expect(lookupHost).toHaveBeenCalledWith("example.invalid");
    expect(seen).toEqual([
      {
        url: "https://example.invalid/deck.apkg",
        addresses: [{ address: "93.184.216.34", family: 4 }]
      }
    ]);
  });

  test("returns a safe filename from response content disposition", async () => {
    const transport = vi.fn(async () => {
      return new Response(Buffer.from("package bytes"), {
        status: 200,
        headers: new Headers({
          "content-type": "application/vnd.anki.package",
          "content-disposition": "attachment; filename*=UTF-8''Japanese%20N4.apkg"
        })
      });
    });

    const result = await fetchPublicUrl("https://93.184.216.34/download?id=japanese", {
      maxBytes: 100,
      contentTypes: ["application/vnd.anki.package"],
      transport
    });

    expect(result.fileName).toBe("Japanese N4.apkg");
  });

  test("rejects redirects to credentialed or non-standard-port URLs", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({ location: "https://user:secret@93.184.216.34/deck.apkg" }),
        body: null
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({ location: "https://93.184.216.34:8443/deck.apkg" }),
        body: null
      } as unknown as Response);

    await expect(
      fetchPublicUrl("https://93.184.216.34/start", {
        maxBytes: 10,
        contentTypes: ["application/octet-stream"],
        transport
      })
    ).rejects.toThrow(/credentials/i);

    await expect(
      fetchPublicUrl("https://93.184.216.34/start", {
        maxBytes: 10,
        contentTypes: ["application/octet-stream"],
        transport
      })
    ).rejects.toThrow(/port/i);
  });

  test("requires exact content type matches instead of substring matches", async () => {
    const transport = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/octet-streamish" }),
        body: null,
        arrayBuffer: async () => Buffer.from("not really an apkg")
      } as unknown as Response;
    });

    await expect(
      fetchPublicUrl("https://93.184.216.34/deck.apkg", {
        maxBytes: 100,
        contentTypes: ["application/octet-stream"],
        transport
      })
    ).rejects.toThrow(/unsupported content type/i);
  });
});
