//#region ../../@warlock.js/core/src/http/middleware/utils/cidr-match.ts
/**
* Match an IPv4 address against an exact IP or a CIDR block.
*
* IPv6 patterns are matched as exact-string only — full IPv6 CIDR support is
* out of scope; ACLs in production almost always use IPv4 ranges. Add IPv6 CIDR
* later if a real use-case appears.
*
* @example
* ipMatches("10.0.0.5", "10.0.0.0/8");      // true
* ipMatches("10.0.0.5", "10.0.0.5");        // true
* ipMatches("192.168.1.1", "10.0.0.0/8");   // false
*/
function ipv4ToInt(ip) {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;
	let result = 0;
	for (const part of parts) {
		const num = Number(part);
		if (!Number.isInteger(num) || num < 0 || num > 255) return null;
		result = (result << 8) + num;
	}
	return result >>> 0;
}
function ipMatches(ip, pattern) {
	if (!ip || !pattern) return false;
	if (pattern === ip) return true;
	if (!pattern.includes("/")) return false;
	const [base, bitsRaw] = pattern.split("/");
	const bits = Number(bitsRaw);
	if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
	const ipInt = ipv4ToInt(ip);
	const baseInt = ipv4ToInt(base);
	if (ipInt === null || baseInt === null) return false;
	if (bits === 0) return true;
	const mask = -1 << 32 - bits >>> 0;
	return (ipInt & mask) === (baseInt & mask);
}
/**
* Returns true if `ip` matches any pattern in the list.
*
* @example
* anyMatch("10.0.0.5", ["192.168.0.0/16", "10.0.0.0/8"]); // true
*/
function anyMatch(ip, patterns) {
	return patterns.some((pattern) => ipMatches(ip, pattern));
}
//#endregion
export { anyMatch, ipMatches };

//# sourceMappingURL=cidr-match.mjs.map