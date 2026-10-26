import { type LookupAddress } from 'node:dns';
/**
 * Address classification for fetching a URL the CLI did not choose itself
 * (A2A inbound attachment download). "Private"
 * here means anything a request must not be steered to: loopback, private and
 * shared ranges, link-local (including cloud metadata 169.254.169.254),
 * unspecified, multicast and reserved space.
 */
export declare function stripIpBrackets(hostname: string): string;
/**
 * hostname 归一化：小写 + 去掉 DNS 末尾点。
 *
 * `new URL('https://evil.com./x').hostname` 是 `'evil.com.'`，`evil.com%2e` 也解析成同一个串。
 * 末尾点是 DNS 里合法的绝对写法、解析到同一台主机，但不归一化会同时穿三层：
 * `matchNetworkDomain` 是逐字比较，黑名单落空；`isPrivateHost` 的 `localhost` 判定落空；
 * 威胁库拿到多一个点的串去算哈希，必然不命中。
 *
 * IPv6 字面量带方括号、不含末尾点，这里原样小写返回。
 */
export declare function normalizeHostname(hostname: string): string;
/** IP literals are classified; otherwise only the `localhost` aliases are known without DNS. */
export declare function isPrivateHost(hostname: string): boolean;
export declare function isPrivateIP(ip: string): boolean;
/** A URL whose resolved address is private; the request is never sent. */
export declare class PrivateAddressError extends Error {
    readonly hostname: string;
    readonly address: string;
    constructor(hostname: string, address: string);
}
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
/** Signature of `dns.lookup`, as `net.connect` / undici `connect.lookup` call it. */
export type LookupFunction = (hostname: string, options: {
    all?: boolean;
    family?: number | string;
} & Record<string, unknown>, callback: LookupCallback) => void;
/**
 * A `lookup` that resolves every address of the host and fails with
 * {@link PrivateAddressError} if any of them is private. Handed to the
 * connection itself (undici `Agent` `connect.lookup`), the socket connects to
 * the address validated here, so a second resolution cannot swap in a private
 * one (DNS rebinding).
 */
export declare function createPublicAddressLookup(resolve?: LookupFunction, 
/** Hosts whose private addresses are expected (e.g. a cloud object store's VPC endpoint). */
isTrustedHost?: (hostname: string) => boolean): LookupFunction;
/** Resolves and validates a host once; for transports that cannot take a pinned lookup. */
export declare function assertPublicHost(hostname: string, resolve?: LookupFunction): Promise<void>;
export {};
