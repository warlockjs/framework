//#region ../../@warlock.js/core/src/http/middleware/utils/cidr-match.d.ts
declare function ipMatches(ip: string, pattern: string): boolean;
/**
 * Returns true if `ip` matches any pattern in the list.
 *
 * @example
 * anyMatch("10.0.0.5", ["192.168.0.0/16", "10.0.0.0/8"]); // true
 */
declare function anyMatch(ip: string, patterns: string[]): boolean;
//#endregion
export { anyMatch, ipMatches };
//# sourceMappingURL=cidr-match.d.mts.map