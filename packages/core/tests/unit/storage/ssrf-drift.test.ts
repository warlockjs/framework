import { describe, expect, it } from "vitest";
import { isPrivateOrReservedIp as coreIsPrivateOrReservedIp } from "../../../src/storage/utils/safe-fetch";
// Relative import into @warlock.js/ai — core cannot depend on ai as a
// package, but this test file is allowed to reach across the workspace to
// diff the two SSRF classifiers directly. `ai/src/security/private-ip.ts`
// has no imports beyond `node:net`, so this resolves without needing a
// vitest alias (see core/vitest.config.ts's `workspaceSource` helper,
// which exists for packages whose entry pulls in further unresolved
// workspace deps — not needed here).
import { isPrivateOrReservedIp as aiIsPrivateOrReservedIp } from "../../../../ai/src/security/private-ip";

/**
 * DRIFT GUARD — canon b880975c.
 *
 * `@warlock.js/core`'s `isPrivateOrReservedIp` (core/src/storage/utils/safe-fetch.ts)
 * and `@warlock.js/ai`'s `isPrivateOrReservedIp` (ai/src/security/private-ip.ts)
 * are two independent, intentionally-duplicated copies of the same SSRF
 * address classifier (core cannot depend on ai). Per
 * implementation/2026-08-20-G-ssrf-consolidation.md they are byte-identical
 * today. This suite is a stopgap ruled by Suki (canon b880975c): it fails
 * loudly the instant the two diverge, and it exists only until
 * `@warlock.js/warden` ships and BOTH packages consume it — at which point
 * this file should be deleted rather than "fixed".
 */

type Verdict = { address: string; label: string; core: boolean; ai: boolean };

/**
 * Canonical corpus. Every range either module's source comments name is
 * represented here — this is what makes the test a genuine drift guard
 * rather than a happy-path smoke test. Verified against both files on
 * 2026-08-20:
 *   - core/src/storage/utils/safe-fetch.ts:100-152 (isPrivateIpv4/isPrivateIpv6)
 *   - ai/src/security/private-ip.ts:29-73 (isPrivateIpv4/isPrivateIpv6)
 * Both name the identical set of ranges — no expected-divergence entries
 * were needed.
 */
const CORPUS: Array<{ label: string; address: string; expected: boolean }> = [
  // --- IPv4 "this network" ---
  { label: "0.0.0.0/8 this-network", address: "0.0.0.0", expected: true },
  { label: "0.0.0.0/8 this-network (high)", address: "0.255.255.255", expected: true },

  // --- IPv4 private ranges ---
  { label: "10.0.0.0/8 private (low)", address: "10.0.0.0", expected: true },
  { label: "10.0.0.0/8 private", address: "10.1.2.3", expected: true },
  { label: "10.0.0.0/8 private (high)", address: "10.255.255.255", expected: true },
  { label: "9.255.255.255 public boundary below 10/8", address: "9.255.255.255", expected: false },
  { label: "11.0.0.0 public boundary above 10/8", address: "11.0.0.0", expected: false },

  { label: "172.16.0.0/12 private (low)", address: "172.16.0.0", expected: true },
  { label: "172.16.0.0/12 private", address: "172.20.1.1", expected: true },
  { label: "172.16.0.0/12 private (high)", address: "172.31.255.255", expected: true },
  { label: "172.15.255.255 public boundary below 172.16/12", address: "172.15.255.255", expected: false },
  { label: "172.32.0.0 public boundary above 172.16/12", address: "172.32.0.0", expected: false },

  { label: "192.168.0.0/16 private (low)", address: "192.168.0.0", expected: true },
  { label: "192.168.0.0/16 private", address: "192.168.1.1", expected: true },
  { label: "192.168.0.0/16 private (high)", address: "192.168.255.255", expected: true },
  { label: "192.167.255.255 public boundary below 192.168/16", address: "192.167.255.255", expected: false },
  { label: "192.169.0.0 public boundary above 192.168/16", address: "192.169.0.0", expected: false },

  // --- IPv4 loopback ---
  { label: "127.0.0.0/8 loopback (low)", address: "127.0.0.1", expected: true },
  { label: "127.0.0.0/8 loopback (high)", address: "127.255.255.255", expected: true },

  // --- IPv4 CGNAT ---
  { label: "100.64.0.0/10 CGNAT (low)", address: "100.64.0.0", expected: true },
  { label: "100.64.0.0/10 CGNAT", address: "100.100.0.1", expected: true },
  { label: "100.64.0.0/10 CGNAT (high)", address: "100.127.255.255", expected: true },
  { label: "100.63.255.255 public boundary below CGNAT", address: "100.63.255.255", expected: false },
  { label: "100.128.0.0 public boundary above CGNAT", address: "100.128.0.0", expected: false },

  // --- IPv4 link-local / metadata ---
  { label: "169.254.0.0/16 link-local (low)", address: "169.254.0.0", expected: true },
  { label: "169.254.169.254 cloud metadata endpoint", address: "169.254.169.254", expected: true },
  { label: "169.254.0.0/16 link-local (high)", address: "169.254.255.255", expected: true },

  // --- IPv4 IETF/test ranges ---
  { label: "192.0.0.0/24 IETF protocol assignments", address: "192.0.0.1", expected: true },
  { label: "192.0.2.0/24 test-net-1 (falls in 192.0.0.0/24 check)", address: "192.0.2.1", expected: true },
  { label: "198.18.0.0/15 benchmarking (low)", address: "198.18.0.1", expected: true },
  { label: "198.18.0.0/15 benchmarking (high)", address: "198.19.255.255", expected: true },
  { label: "198.51.100.0/24 test-net-2", address: "198.51.100.1", expected: true },
  { label: "203.0.113.0/24 test-net-3", address: "203.0.113.1", expected: true },

  // --- IPv4 multicast / reserved / broadcast ---
  { label: "224.0.0.0/4 multicast (low)", address: "224.0.0.0", expected: true },
  { label: "240.0.0.0/4 reserved", address: "240.0.0.1", expected: true },
  { label: "255.255.255.255 broadcast", address: "255.255.255.255", expected: true },

  // --- IPv4 public addresses (well-known) ---
  { label: "8.8.8.8 public DNS", address: "8.8.8.8", expected: false },
  { label: "1.1.1.1 public DNS", address: "1.1.1.1", expected: false },
  { label: "223.255.255.255 public boundary below multicast", address: "223.255.255.255", expected: false },

  // --- non-IP string: node's `isIP` returns family 0, so both classifiers
  // return `false` without reaching the internal (unreachable in practice)
  // "unparseable → fail closed" branch, which only guards a parse failure
  // AFTER `isIP` has already confirmed family 4 ---
  { label: "malformed octet overflow (not a valid IP per node:net isIP)", address: "999.999.999.999", expected: false },

  // --- IPv6 loopback / unspecified ---
  { label: "::1 loopback", address: "::1", expected: true },
  { label: ":: unspecified", address: "::", expected: true },

  // --- IPv6 link-local ---
  { label: "fe80:: link-local", address: "fe80::1", expected: true },
  { label: "fe80::/10 link-local boundary", address: "febf::1", expected: true },

  // --- IPv6 unique-local ---
  { label: "fc00::/7 unique-local (fc..)", address: "fc00::1", expected: true },
  { label: "fc00::/7 unique-local (fd..)", address: "fd00::1", expected: true },

  // --- IPv6 v4-mapped ---
  { label: "::ffff:10.0.0.1 v4-mapped private", address: "::ffff:10.0.0.1", expected: true },
  { label: "::ffff:169.254.169.254 v4-mapped metadata", address: "::ffff:169.254.169.254", expected: true },
  { label: "::ffff:8.8.8.8 v4-mapped public", address: "::ffff:8.8.8.8", expected: false },

  // --- IPv6 public ---
  { label: "2001:4860:4860::8888 public (Google DNS)", address: "2001:4860:4860::8888", expected: false },
  { label: "2606:4700:4700::1111 public (Cloudflare DNS)", address: "2606:4700:4700::1111", expected: false },
];

describe("SSRF classifier drift guard (canon b880975c)", () => {
  it("core and ai agree on every corpus entry", () => {
    const drift: Verdict[] = [];

    for (const { label, address } of CORPUS) {
      const core = coreIsPrivateOrReservedIp(address);
      const ai = aiIsPrivateOrReservedIp(address);
      if (core !== ai) {
        drift.push({ address, label, core, ai });
      }
    }

    if (drift.length > 0) {
      const details = drift
        .map(
          (d) =>
            `  "${d.address}" (${d.label}): core=${d.core} vs ai=${d.ai}`,
        )
        .join("\n");
      throw new Error(
        `SSRF classifier drift detected between core and ai (canon b880975c) — ` +
          `these two copies of isPrivateOrReservedIp are supposed to be byte-identical ` +
          `until @warlock.js/warden exists. Diverging addresses:\n${details}`,
      );
    }

    expect(drift).toEqual([]);
  });

  it("matches the corpus's own expected verdicts (sanity check on the corpus itself)", () => {
    for (const { label, address, expected } of CORPUS) {
      expect(coreIsPrivateOrReservedIp(address), `core: ${label} (${address})`).toBe(expected);
      expect(aiIsPrivateOrReservedIp(address), `ai: ${label} (${address})`).toBe(expected);
    }
  });
});
