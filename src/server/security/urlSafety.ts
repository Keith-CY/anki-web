import { lookup } from "node:dns/promises";
import net from "node:net";

export interface SafeUrlAddress {
  address: string;
  family: number;
}

export type LookupHost = (hostname: string) => Promise<SafeUrlAddress[]>;

export interface SafePublicUrl {
  url: URL;
  addresses: SafeUrlAddress[];
}

export async function assertSafePublicUrl(input: string, options: { lookupHost?: LookupHost } = {}): Promise<URL> {
  return (await resolveSafePublicUrl(input, options)).url;
}

export async function resolveSafePublicUrl(input: string, options: { lookupHost?: LookupHost } = {}): Promise<SafePublicUrl> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  if (!url.hostname) {
    throw new Error("URL host is required");
  }

  const hostname = normalizeUrlHostname(url.hostname);

  if (isPrivateHostname(hostname)) {
    throw new Error("Private or local hosts are not allowed");
  }

  const literal = net.isIP(hostname);
  if (literal && isPrivateIp(hostname)) {
    throw new Error("Private network URLs are not allowed");
  }

  let addresses: SafeUrlAddress[] = [];
  if (literal) {
    addresses = [{ address: hostname, family: literal }];
  }
  if (!literal) {
    addresses = await (options.lookupHost ?? defaultLookupHost)(hostname);
    if (addresses.length === 0) {
      throw new Error("URL host did not resolve to any addresses");
    }
    if (addresses.some((address) => isPrivateIp(address.address))) {
      throw new Error("Private network URLs are not allowed");
    }
  }
  if (!isAllowedWebPort(url)) {
    throw new Error("Only standard HTTP and HTTPS ports are supported");
  }

  return { url, addresses };
}

async function defaultLookupHost(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

function isAllowedWebPort(url: URL) {
  if (!url.port) return true;
  return (url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443");
}

function normalizeUrlHostname(hostname: string) {
  const unbracketed = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return unbracketed.replace(/\.+$/, "");
}

function isPrivateHostname(hostname: string) {
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local");
}

function isPrivateIp(address: string) {
  const version = net.isIP(address);
  if (version === 4) {
    return isPrivateIpv4(address);
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = mappedIpv4Address(lower);
    if (mapped) return isPrivateIpv4(mapped);
    if (lower === "::" || lower === "::1") return true;
    const [firstPart, secondPart] = lower.split(":");
    const first = Number.parseInt(firstPart || "0", 16);
    const second = Number.parseInt(secondPart || "0", 16);
    if (!Number.isFinite(first)) return false;
    return (
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xffc0) === 0xfec0 ||
      (first & 0xff00) === 0xff00 ||
      (first === 0x2001 && second === 0x0db8)
    );
  }
  return false;
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
  return (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255) ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    (a === 169 && b === 254) ||
    a === 0 ||
    a >= 224
  );
}

function mappedIpv4Address(address: string) {
  if (!address.startsWith("::ffff:")) return null;
  const tail = address.slice("::ffff:".length);
  if (net.isIP(tail) === 4) return tail;
  const parts = tail.split(":").map((part) => Number.parseInt(part, 16));
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 0xffff)) return null;
  return `${parts[0] >> 8}.${parts[0] & 0xff}.${parts[1] >> 8}.${parts[1] & 0xff}`;
}
