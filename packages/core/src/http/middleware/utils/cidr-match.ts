import { matchesPattern } from "./ip-matcher";

/**
 * Match an IP address against an exact address or a CIDR block, IPv4 or
 * IPv6. IPv4-mapped IPv6 addresses (`::ffff:1.2.3.4`) match IPv4 patterns,
 * and IPv6 addresses compare by value (`2001:0db8::1` equals `2001:db8::1`).
 * An invalid address or pattern matches nothing.
 *
 * @example
 * ipMatches("10.0.0.5", "10.0.0.0/8");          // true
 * ipMatches("10.0.0.5", "10.0.0.5");            // true
 * ipMatches("2001:db8::5", "2001:db8::/32");    // true
 * ipMatches("192.168.1.1", "10.0.0.0/8");       // false
 */
export function ipMatches(rawIp: string, rawPattern: string): boolean {
  if (!rawIp || !rawPattern) {
    return false;
  }

  return matchesPattern(rawIp, rawPattern);
}

/**
 * Returns true if `ip` matches any pattern in the list.
 *
 * @example
 * anyMatch("10.0.0.5", ["192.168.0.0/16", "10.0.0.0/8"]); // true
 */
export function anyMatch(ip: string, patterns: string[]): boolean {
  return patterns.some((pattern) => ipMatches(ip, pattern));
}
