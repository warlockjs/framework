import { BlockList, isIP } from "node:net";

/** Tests one client address against a compiled list of patterns. */
export type IpMatcher = (ip: string) => boolean;

/**
 * Add one pattern (exact IPv4/IPv6 address or CIDR block) to `list`.
 * Returns false when the pattern cannot be parsed.
 */
function addPattern(list: BlockList, raw: string): boolean {
  const pattern = raw.trim();
  const slash = pattern.indexOf("/");

  try {
    if (slash === -1) {
      const family = isIP(pattern);

      if (family === 0) return false;

      list.addAddress(pattern, family === 4 ? "ipv4" : "ipv6");

      return true;
    }

    const base = pattern.slice(0, slash);
    const bitsRaw = pattern.slice(slash + 1);
    const family = isIP(base);

    if (family === 0 || !/^\d{1,3}$/.test(bitsRaw)) return false;

    const bits = Number(bitsRaw);

    if (bits > (family === 4 ? 32 : 128)) return false;

    list.addSubnet(base, bits, family === 4 ? "ipv4" : "ipv6");

    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `rawIp` falls in `list`. IPv4-mapped IPv6 addresses
 * (`::ffff:10.0.0.1`) match IPv4 patterns, and IPv6 addresses compare by
 * value, so `2001:0db8::1` matches `2001:db8::1`.
 */
function listContains(list: BlockList, rawIp: string): boolean {
  if (typeof rawIp !== "string") return false;

  const ip = rawIp.trim();
  const family = isIP(ip);

  if (family === 0) return false;

  try {
    return list.check(ip, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

/**
 * Compile exact addresses and CIDR blocks (IPv4 and IPv6) into one matcher.
 * Throws for a pattern it cannot parse, naming `optionName`, so a typo in an
 * allow or deny list fails when the app boots instead of matching nothing.
 */
export function compileIpMatcher(patterns: readonly string[], optionName: string): IpMatcher {
  const list = new BlockList();

  for (const pattern of patterns) {
    if (typeof pattern !== "string" || !addPattern(list, pattern)) {
      throw new TypeError(
        `${optionName}: "${String(pattern)}" is not an IP address or CIDR block. ` +
          'Use an address such as "203.0.113.7" or "2001:db8::1", or a block such as "10.0.0.0/8" or "2001:db8::/32".',
      );
    }
  }

  return (ip) => listContains(list, ip);
}

const singlePatternCache = new Map<string, BlockList | null>();

/**
 * Lenient single-pattern match for the public `ipMatches()` helper: an
 * invalid pattern matches nothing. Parsed patterns are cached.
 */
export function matchesPattern(ip: string, pattern: string): boolean {
  let list = singlePatternCache.get(pattern);

  if (list === undefined) {
    const candidate = new BlockList();

    list = addPattern(candidate, pattern) ? candidate : null;

    if (singlePatternCache.size >= 1000) singlePatternCache.clear();

    singlePatternCache.set(pattern, list);
  }

  return list !== null && listContains(list, ip);
}
