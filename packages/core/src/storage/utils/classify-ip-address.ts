import { isIP } from "node:net";

/**
 * Dependency-free IP classifier for SSRF guards. Imports node built-ins only
 * so other packages (e.g. `@warlock.js/ai`) can reuse it verbatim.
 */

type Ipv4Octets = [number, number, number, number];

/** Parse a dotted-quad into four octets, or `null` if malformed. */
function parseIpv4(ip: string): Ipv4Octets | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }

  return octets as Ipv4Octets;
}

function isPrivateIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) {
    return true; // unparseable → refuse, fail closed
  }

  const [a, b] = octets;

  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local + metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 192 && b === 0) || // 192.0.0.0/24 + 192.0.2.0/24 (IETF/test)
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    (a === 198 && b === 51) || // 198.51.100.0/24 test-net-2
    (a === 203 && b === 0) || // 203.0.113.0/24 test-net-3
    a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  );
}

/**
 * Expand an IPv6 literal into its eight 16-bit groups (`::` expanded, a
 * trailing dotted-quad folded into two groups, zone id dropped). Returns
 * `null` when it cannot be parsed.
 */
function expandIpv6(ip: string): number[] | null {
  let text = (ip.toLowerCase().split("%")[0] ?? "").trim();
  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1);
  }

  const dotted = text.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const octets = parseIpv4(dotted[2] as string);
    if (!octets) {
      return null;
    }
    const [a, b, c, d] = octets;
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) {
    return null;
  }

  const toGroups = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const head = toGroups(halves[0] as string);
  const tail = halves.length === 2 ? toGroups(halves[1] as string) : [];

  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) {
      return null;
    }
    groups = [...head, ...new Array<string>(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }

  if (groups.length !== 8) {
    return null;
  }

  const values = groups.map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
  );

  return values.some((n) => Number.isNaN(n)) ? null : values;
}

/** Build a dotted-quad from two 16-bit groups. */
function toIpv4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * Extract the IPv4 address embedded in an IPv6 one — IPv4-mapped
 * (`::ffff:a.b.c.d` / `::ffff:XXXX:XXXX`), IPv4-translated (`::ffff:0:a.b.c.d`),
 * IPv4-compatible (`::a.b.c.d`), NAT64 (`64:ff9b::/96`) and 6to4
 * (`2002::/16`) — or `null` when there is none.
 */
function extractEmbeddedIpv4(g: number[]): string | null {
  const zero = (from: number, to: number) => g.slice(from, to).every((n) => n === 0);

  if (zero(0, 5) && g[5] === 0xffff) {
    return toIpv4(g[6] as number, g[7] as number); // ::ffff:0:0/96
  }
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) {
    return toIpv4(g[6] as number, g[7] as number); // ::ffff:0:0:0/96 (SIIT)
  }
  if (zero(0, 6)) {
    return toIpv4(g[6] as number, g[7] as number); // ::/96 (compatible)
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) {
    return toIpv4(g[6] as number, g[7] as number); // 64:ff9b::/96 NAT64
  }
  if (g[0] === 0x2002) {
    return toIpv4(g[1] as number, g[2] as number); // 2002::/16 6to4
  }

  return null;
}

// Every fallback returns `true` ("private — refuse"): this is an SSRF guard,
// so an address we cannot classify must be refused, never let through.
function isPrivateIpv6(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (!groups) {
    return true;
  }

  const embedded = extractEmbeddedIpv4(groups);
  if (embedded !== null) {
    return isPrivateIpv4(embedded); // also covers :: (0.0.0.0) and ::1 (0.0.0.1)
  }

  const head = groups[0] as number;

  // fc00::/7 unique-local
  if ((head & 0xfe00) === 0xfc00) {
    return true;
  }
  // fe80::/10 link-local
  if ((head & 0xffc0) === 0xfe80) {
    return true;
  }

  return false;
}

/**
 * True when `ip` is a private, loopback, link-local, unique-local,
 * carrier-grade-NAT, unspecified, or otherwise non-public address — the set
 * an SSRF guard must refuse. IPv6 is normalised first, so every spelling of
 * an embedded IPv4 (mapped, hex-mapped, compatible, NAT64, 6to4) is judged
 * by the IPv4 it carries. A non-IP string returns `false` (the caller
 * resolves hostnames via DNS first).
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return isPrivateIpv4(ip);
  }
  if (family === 6) {
    return isPrivateIpv6(ip);
  }
  return false;
}
