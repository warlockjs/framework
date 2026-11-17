import { BlockList, isIP } from "node:net";

/** The IPv4 ranges `"private"` stands for (private networks and link-local). */
const PRIVATE_V4: readonly (readonly [string, number])[] = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["169.254.0.0", 16],
];

/** The IPv6 ranges `"private"` stands for (unique local and link-local). */
const PRIVATE_V6: readonly (readonly [string, number])[] = [
  ["fc00::", 7],
  ["fe80::", 10],
];

const MAPPED_PREFIX = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * An address in its plain form: an IPv4-mapped IPv6 address (`::ffff:1.2.3.4`)
 * becomes `1.2.3.4`, a zone id (`fe80::1%eth0`) is dropped, and the letters of
 * an IPv6 address are lower case. Anything that is not an IP is returned
 * unchanged.
 */
export function normalizeIp(address: string): string {
  const value = address.trim();
  const zone = value.indexOf("%");
  const bare = zone === -1 ? value : value.slice(0, zone);
  const mapped = MAPPED_PREFIX.exec(bare);

  if (mapped?.[1] !== undefined && isIP(mapped[1]) === 4) return mapped[1];

  return isIP(bare) === 6 ? bare.toLowerCase() : bare;
}

/** Splits `a.b.c.d/24` into its address and prefix length, or `null` when it is not a CIDR. */
function parseCidr(entry: string): { address: string; prefix: number; family: 4 | 6 } | null {
  const slash = entry.indexOf("/");

  if (slash === -1) return null;

  const address = normalizeIp(entry.slice(0, slash));
  const text = entry.slice(slash + 1);
  const family = isIP(address);

  if (family === 0 || !/^\d{1,3}$/.test(text)) return null;

  const prefix = Number(text);

  if (family !== 4 && family !== 6) return null;

  return prefix <= (family === 4 ? 32 : 128) ? { address, prefix, family } : null;
}

/** Whether `entry` is an IP, a CIDR range, `"loopback"` or `"private"`. */
export function isValidNetworkEntry(entry: unknown): entry is string {
  if (typeof entry !== "string") return false;
  if (entry === "loopback" || entry === "private") return true;

  return isIP(normalizeIp(entry)) !== 0 || parseCidr(entry) !== null;
}

const compiled = new WeakMap<readonly string[], BlockList>();

function compile(entries: readonly string[]): BlockList {
  const cached = compiled.get(entries);

  if (cached) return cached;

  const list = new BlockList();

  for (const entry of entries) {
    if (entry === "loopback") {
      list.addSubnet("127.0.0.0", 8, "ipv4");
      list.addAddress("::1", "ipv6");
      continue;
    }

    if (entry === "private") {
      for (const [address, prefix] of PRIVATE_V4) list.addSubnet(address, prefix, "ipv4");
      for (const [address, prefix] of PRIVATE_V6) list.addSubnet(address, prefix, "ipv6");
      continue;
    }

    const cidr = parseCidr(entry);

    if (cidr) {
      list.addSubnet(cidr.address, cidr.prefix, cidr.family === 4 ? "ipv4" : "ipv6");
      continue;
    }

    const address = normalizeIp(entry);
    const family = isIP(address);

    if (family !== 0) list.addAddress(address, family === 4 ? "ipv4" : "ipv6");
  }

  compiled.set(entries, list);

  return list;
}

/**
 * Whether `address` matches an entry: an IP, a CIDR, `"loopback"` or
 * `"private"` (10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7, fe80::/10).
 * IPv4-mapped IPv6 addresses are unwrapped on both sides.
 */
export function ipMatches(address: string, entries: readonly string[]): boolean {
  if (entries.length === 0) return false;

  const ip = normalizeIp(address);
  const family = isIP(ip);

  if (family === 0) return false;

  return compile(entries).check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** The eight 16-bit groups of an IPv6 address, or `null` when it is not one. */
function ipv6Groups(address: string): number[] | null {
  if (isIP(address) !== 6) return null;

  // A trailing dotted IPv4 part (`::ffff:1.2.3.4`, `64:ff9b::1.2.3.4`) becomes two hex groups.
  const text = address.replace(
    /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
    (_, a, b, c, d) =>
      `${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`,
  );
  const parse = (part: string) =>
    part === "" ? [] : part.split(":").map((group) => parseInt(group, 16));
  const [head = "", rest] = text.split("::");
  const left = parse(head);
  const right = rest === undefined ? [] : parse(rest);
  const zeros = Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => 0);

  return [...left, ...zeros, ...right];
}

/**
 * The client an address counts as for the sign-in rate limits. An IPv4
 * address counts as itself (an IPv4-mapped IPv6 address as its IPv4 address),
 * an IPv6 address by its /64 network, because one host is usually given a
 * whole /64 and can change the rest at will. Anything else is returned as is.
 */
export function rateLimitClient(address: string): string {
  const ip = normalizeIp(address);
  const groups = ipv6Groups(ip);

  if (groups === null) return ip;

  // ::ffff:a.b.c.d written any other way (0:0:0:0:0:ffff:…, hex groups).
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;

    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }

  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}
