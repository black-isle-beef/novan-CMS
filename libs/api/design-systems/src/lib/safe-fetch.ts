// safe-fetch.ts — fetches a stylesheet from an address a developer typed (a CDN's copy of Bootstrap, say) without
// letting that address reach the API's own network: https only, public addresses only (checked when the connection
// is made, so DNS cannot change the answer afterwards), redirects followed by hand and checked again, and a size cap.
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch } from 'undici';

/** Something about the address or what it sent; the message is for the developer who typed it. */
export class FetchProblem extends Error {}

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/** An address on the public internet: not private, loopback, link-local, reserved or multicast. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is checked as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]);
    return !blocked.check(address, 'ipv6');
  }
  return !blocked.check(address, 'ipv4');
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup for the agent's connections that only ever answers with public addresses. */
function publicLookup(hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback): void {
  dnsLookup(hostname, { family: options.family ?? 0, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const allowed = addresses.filter((entry) => isPublicAddress(entry.address));
    if (!allowed.length) {
      const refused: NodeJS.ErrnoException = new FetchProblem(`${hostname} is not a public address.`);
      refused.code = 'ENOTFOUND';
      return callback(refused, []);
    }
    if (options.all) callback(null, allowed);
    else callback(null, allowed[0].address, allowed[0].family);
  });
}

const agent = new Agent({ connect: { lookup: publicLookup as never }, connectTimeout: 10_000 });

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

/** The body of a public https address, after at most a few redirects, refusing anything bigger than `maxBytes`. */
export async function safeFetch(address: string, options: SafeFetchOptions): Promise<{ bytes: Buffer; url: string; contentType: string }> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  let url = checkAddress(address);
  for (let redirects = 0; ; redirects++) {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(url, { dispatcher: agent, redirect: 'manual', signal, headers: { accept: 'text/css,*/*;q=0.1' } });
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      if (cause instanceof FetchProblem) throw cause;
      if (signal.aborted) throw new FetchProblem(`${url.host} took too long to answer.`);
      throw new FetchProblem(`${url.host} could not be reached.`);
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel();
      if (redirects >= (options.maxRedirects ?? 3)) throw new FetchProblem('The address redirects too many times.');
      url = checkAddress(new URL(response.headers.get('location') as string, url).href);
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new FetchProblem(`${url.host} answered ${response.status}.`);
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > options.maxBytes) {
      await response.body?.cancel();
      throw new FetchProblem(`The file is bigger than ${Math.round(options.maxBytes / 1024 / 1024)} MB.`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > options.maxBytes) {
        throw new FetchProblem(`The file is bigger than ${Math.round(options.maxBytes / 1024 / 1024)} MB.`);
      }
      chunks.push(Buffer.from(chunk));
    }
    return { bytes: Buffer.concat(chunks), url: url.href, contentType: response.headers.get('content-type') ?? '' };
  }
}

/** An https address without credentials whose host, when it is an IP address, is a public one. */
function checkAddress(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new FetchProblem('That is not an address.');
  }
  if (url.protocol !== 'https:') throw new FetchProblem('Use an https address.');
  if (url.username || url.password) throw new FetchProblem('Use an address without a user name or password.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) throw new FetchProblem(`${host} is not a public address.`);
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new FetchProblem(`${host} is not a public address.`);
  return url;
}
