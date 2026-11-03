import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { Agent, buildConnector, request } from "undici";
import ipaddr from "ipaddr.js";
import { webReadLimits as limits } from "../../shared/web-read.js";
import { checkAbort, WebReadError } from "./errors.js";

export function publicAddress(value: string): boolean {
  try {
    let address = ipaddr.parse(value);
    if (address.kind() === "ipv6" && (address as ipaddr.IPv6).isIPv4MappedAddress()) address = (address as ipaddr.IPv6).toIPv4Address();
    if (address.range() !== "unicast") return false;
    if (address.kind() === "ipv4" && address.match(ipaddr.parseCIDR("198.18.0.0/15"))) return false;
    // Fail closed for transition/local NAT64 and reserved IPv6 allocations, even
    // when an older ipaddr special-use table labels them unicast.
    if (address.kind() === "ipv6" && (!address.match(ipaddr.parseCIDR("2000::/3")) ||
      ["2001::/23", "2001:db8::/32", "2002::/16", "3ffe::/16", "3fff::/20"].some(cidr => address.match(ipaddr.parseCIDR(cidr))))) return false;
    return true;
  } catch { return false; }
}
export function publicUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new WebReadError("INVALID_URL", "Expected an absolute HTTP(S) URL."); }
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (value.length > limits.urlChars || /[\u0000-\u0020\u007f]/.test(value) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
      !host || !host.includes(".") && !isIP(host) || /(^|\.)(localhost|local|internal|home|lan|test|invalid)$/.test(host) || isIP(host) && !publicAddress(host))
    throw new WebReadError("URL_BLOCKED", "Only public HTTP(S) destinations on standard ports without embedded credentials are allowed.");
  url.hash = "";
  return url;
}
export interface ResolvedAddress { address: string; family: number }
export async function resolvePublic(host: string, signal: AbortSignal): Promise<ResolvedAddress[]> {
  checkAbort(signal);
  host = host.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!publicAddress(host)) throw new WebReadError("URL_BLOCKED", "The destination address is not public.");
    return [{ address: host, family: isIP(host) }];
  }
  const resolver = new Resolver({ timeout: 2000, tries: 2 });
  const abort = () => resolver.cancel();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const resolved = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
    checkAbort(signal);
    if (resolved.some(r => r.status === "rejected" && !["ENODATA", "ENOTFOUND"].includes(r.reason?.code)))
      throw new WebReadError("DNS_FAILED", "Could not safely resolve the destination.", true);
    const addresses = resolved.flatMap((r, i) => r.status === "fulfilled" ? r.value.map(address => ({ address, family: i ? 6 : 4 })) : []);
    if (!addresses.length) throw new WebReadError("DNS_FAILED", "The destination has no usable address.", true);
    if (addresses.some(a => !publicAddress(a.address))) throw new WebReadError("URL_BLOCKED", "The destination resolves to a non-public address.");
    return addresses;
  } finally { signal.removeEventListener("abort", abort); }
}
/** Keep URL Host/SNI semantics; the actual socket can use ONLY these validated addresses. */
export function pinnedAgent(addresses: ResolvedAddress[]) {
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new WebReadError("URL_BLOCKED", "Unsafe connection address.");
  return new Agent({ maxHeaderSize: 32_768, connect: buildConnector({ timeout: 10_000,
    lookup: (_host, options, callback) => {
      if (options.all) callback(null, addresses as import("node:dns").LookupAddress[]);
      else { const a = addresses.find(a => !options.family || a.family === options.family) ?? addresses[0]; callback(null, a.address, a.family); }
    },
  }) });
}
/** Intentional discard: handle the asynchronous abort error before destruction. */
function discardBody(body: Readable): void {
  body.once("error", () => {});
  body.destroy();
}
export interface Download { url: string; text: string; contentType: string }
export async function downloadPublic(value: string, signal: AbortSignal,
  transport: { resolve: typeof resolvePublic; agent: typeof pinnedAgent; request: typeof request } = { resolve: resolvePublic, agent: pinnedAgent, request }): Promise<Download> {
  let url = publicUrl(value);
  for (let hop = 0; hop <= limits.redirects; hop++) {
    checkAbort(signal);
    const agent = transport.agent(await transport.resolve(url.hostname, signal));
    try {
      const response = await transport.request(url, { dispatcher: agent, signal, method: "GET",
        headersTimeout: 10_000, bodyTimeout: 5000,
        headers: { "user-agent": "Axiom-WebRead/1.0", accept: "text/markdown, text/html;q=0.9, text/plain;q=0.8, application/json;q=0.5", "accept-encoding": "gzip, deflate, br" } });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        discardBody(response.body);
        if (typeof location !== "string" || hop === limits.redirects) throw new WebReadError("REDIRECT_LIMIT", "Invalid redirect or redirect limit reached.");
        url = publicUrl(new URL(location, url).href);
        continue;
      }
      if (response.statusCode !== 200) {
        discardBody(response.body);
        const code = response.statusCode === 401 ? "AUTH_REQUIRED" : response.statusCode === 403 ? "ACCESS_DENIED" : response.statusCode === 429 ? "RATE_LIMITED" : "HTTP_ERROR";
        throw new WebReadError(code, `HTTP ${response.statusCode}; no browser, account or alternate route was used.`, response.statusCode === 429 || response.statusCode >= 500);
      }
      const type = String(response.headers["content-type"] ?? "").toLowerCase();
      const mime = type.split(";", 1)[0].trim();
      if (!mime.startsWith("text/") && !["application/xhtml+xml", "application/json", "application/xml"].includes(mime)) {
        discardBody(response.body); throw new WebReadError("UNSUPPORTED_CONTENT", "Only HTML and text documents are supported; no attachments are downloaded.");
      }
      const encoding = String(response.headers["content-encoding"] ?? "identity").toLowerCase();
      const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : encoding === "identity" ? new Transform({ transform(chunk, _encoding, callback) { callback(null, chunk); } }) : undefined;
      if (!decoder) { discardBody(response.body); throw new WebReadError("UNSUPPORTED_ENCODING", "Unsupported content encoding."); }
      let wire = 0, decoded = 0;
      const chunks: Buffer[] = [];
      const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        wire += chunk.length;
        callback(wire > limits.wireBytes ? new WebReadError("BODY_LIMIT", "The download exceeds the byte limit.") : null, chunk);
      } });
      await pipeline(response.body, bounded, decoder, async (stream) => {
        for await (const chunk of stream) {
          checkAbort(signal);
          const bytes = Buffer.from(chunk);
          decoded += bytes.length;
          if (decoded > limits.decodedBytes) throw new WebReadError("BODY_LIMIT", "The decoded document exceeds the byte limit.");
          chunks.push(bytes);
        }
      }, { signal });
      checkAbort(signal);
      const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(type)?.[1] ?? "utf-8";
      let text: string;
      try { text = new TextDecoder(charset).decode(Buffer.concat(chunks)); }
      catch { throw new WebReadError("UNSUPPORTED_ENCODING", "Unsupported text character encoding."); }
      return { url: url.href, contentType: mime, text };
    } finally { await agent.destroy(); }
  }
  throw new WebReadError("REDIRECT_LIMIT", "Redirect limit reached.");
}
