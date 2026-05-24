import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { basename } from "node:path";
import { Readable } from "node:stream";
import type { LookupFunction } from "node:net";
import type { LookupAddress, LookupOptions } from "node:dns";
import { resolveSafePublicUrl, type LookupHost, type SafeUrlAddress } from "../security/urlSafety";

export interface FetchPublicUrlOptions {
  maxBytes: number;
  contentTypes?: string[];
  timeoutMs?: number;
  lookupHost?: LookupHost;
  transport?: FetchTransport;
}

export interface FetchedPublicUrl {
  url: string;
  contentType: string;
  buffer: Buffer;
  fileName?: string;
}

export interface FetchTransportContext {
  addresses: SafeUrlAddress[];
  signal: AbortSignal;
  timeoutMs: number;
}

export type FetchTransport = (url: URL, context: FetchTransportContext) => Promise<Response>;

export async function fetchPublicUrl(input: string, options: FetchPublicUrlOptions): Promise<FetchedPublicUrl> {
  let safeUrl = await resolveSafePublicUrl(input, { lookupHost: options.lookupHost });
  let url = safeUrl.url;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const transport = options.transport ?? fetchWithPinnedAddresses;

  for (let redirect = 0; redirect < 5; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await transport(url, {
        addresses: safeUrl.addresses,
        signal: controller.signal,
        timeoutMs
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        safeUrl = await resolveSafePublicUrl(new URL(response.headers.get("location")!, url).toString(), {
          lookupHost: options.lookupHost
        });
        url = safeUrl.url;
        continue;
      }
      if (!response.ok) {
        throw new Error(`Download failed with HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";
      if (options.contentTypes?.length && !isAllowedContentType(contentType, options.contentTypes)) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > options.maxBytes) {
        throw new Error(`Response is larger than ${options.maxBytes} bytes`);
      }
      const buffer = await readResponseBody(response, options.maxBytes);
      const fileName = contentDispositionFileName(response.headers.get("content-disposition"));
      return { url: url.toString(), contentType, buffer, ...(fileName ? { fileName } : {}) };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Too many redirects");
}

function contentDispositionFileName(value: string | null) {
  if (!value) return null;
  const extended = value.match(/(?:^|;)\s*filename\*\s*=\s*(?:UTF-8''|)([^;]+)/i)?.[1];
  const fallback = value.match(/(?:^|;)\s*filename\s*=\s*("([^"]*)"|[^;]+)/i)?.[2] ?? value.match(/(?:^|;)\s*filename\s*=\s*([^;]+)/i)?.[1];
  const raw = extended ? decodeHeaderValue(extended) : fallback ? stripHeaderQuotes(fallback) : null;
  if (!raw) return null;
  const name = basename(raw.replace(/[/\\]+/g, "/")).trim();
  return name || null;
}

function decodeHeaderValue(value: string) {
  try {
    return decodeURIComponent(stripHeaderQuotes(value));
  } catch {
    return stripHeaderQuotes(value);
  }
}

function stripHeaderQuotes(value: string) {
  return value.trim().replace(/^"|"$/g, "");
}

function fetchWithPinnedAddresses(url: URL, context: FetchTransportContext): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        lookup: pinnedLookup(context.addresses),
        signal: context.signal,
        timeout: context.timeoutMs
      },
      (incoming) => {
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
            status: incoming.statusCode ?? 0,
            headers: responseHeaders(incoming.headers)
          })
        );
      }
    );
    request.on("timeout", () => request.destroy(new Error("Request timed out")));
    request.on("error", reject);
    request.end();
  });
}

function pinnedLookup(addresses: SafeUrlAddress[]): LookupFunction {
  return (
    _hostname: string,
    options: LookupOptions,
    callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
  ) => {
    const family = numericLookupFamily(options.family);
    const candidates = family ? addresses.filter((address) => address.family === family) : addresses;
    const selected = candidates[0] ?? addresses[0];
    if (!selected) {
      callback(Object.assign(new Error("URL host did not resolve to any addresses"), { code: "ENOTFOUND" }), "", 0);
      return;
    }
    if (options.all) {
      callback(null, candidates.length > 0 ? candidates : addresses);
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

function numericLookupFamily(family: LookupOptions["family"]) {
  if (family === "IPv4") return 4;
  if (family === "IPv6") return 6;
  return family === 4 || family === 6 ? family : 0;
}

function responseHeaders(headers: Record<string, number | string | string[] | undefined>) {
  const output = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => output.append(name, item));
    } else {
      output.set(name, String(value));
    }
  }
  return output;
}

function isAllowedContentType(contentType: string, allowedContentTypes: string[]) {
  const normalized = contentType.trim().toLowerCase();
  return allowedContentTypes.some((allowed) => normalized === allowed.trim().toLowerCase());
}

async function readResponseBody(response: Response, maxBytes: number) {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(`Response is larger than ${maxBytes} bytes`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Response is larger than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
    total
  );
}
