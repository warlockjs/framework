import { describe, expect, it } from "vitest";
import type { GuardrailDetectorContext } from "../contracts";
import { pii } from "./pii";

/**
 * The PII detector ignores its context argument (it inspects only `text`),
 * so a minimal stub satisfies the `check(text, ctx)` signature in tests.
 */
const ctx = { phase: "output" } as unknown as GuardrailDetectorContext;

describe("pii detector", () => {
  describe("category matching", () => {
    it("matches an SSN", () => {
      const verdict = pii({ onMatch: "flag" }).check("My SSN is 123-45-6789.", ctx);

      expect(verdict.type).toBe("flag");

      if (verdict.type === "flag") {
        expect(verdict.matches.map((match) => match.rule)).toContain("pii.ssn");
      }
    });

    it("matches an email address", () => {
      const verdict = pii({ onMatch: "flag" }).check(
        "Contact me at jane.doe@example.com today.",
        ctx,
      );

      expect(verdict.type).toBe("flag");

      if (verdict.type === "flag") {
        expect(verdict.matches.map((match) => match.label)).toContain("email");
      }
    });

    it("matches a phone number", () => {
      const verdict = pii({ detect: ["phone"], onMatch: "flag" }).check(
        "Call +1 (415) 555-0132 for support.",
        ctx,
      );

      expect(verdict.type).toBe("flag");

      if (verdict.type === "flag") {
        expect(verdict.matches.map((match) => match.rule)).toContain("pii.phone");
      }
    });

    it("matches a credit-card number", () => {
      const verdict = pii({ detect: ["credit-card"], onMatch: "flag" }).check(
        "Card: 4111 1111 1111 1111.",
        ctx,
      );

      expect(verdict.type).toBe("flag");

      if (verdict.type === "flag") {
        expect(verdict.matches.map((match) => match.label)).toContain("credit-card");
      }
    });

    it("matches an IPv4 address", () => {
      const verdict = pii({ detect: ["ipv4"], onMatch: "flag" }).check(
        "Server at 192.168.1.42 is down.",
        ctx,
      );

      expect(verdict.type).toBe("flag");

      if (verdict.type === "flag") {
        expect(verdict.matches.map((match) => match.rule)).toContain("pii.ipv4");
      }
    });

    it("honours the detect allow-list (a category not requested does not match)", () => {
      const verdict = pii({ detect: ["ssn"], onMatch: "flag" }).check("Email me at a@b.com.", ctx);

      expect(verdict.type).toBe("allow");
    });

    it("reports a [start, end] span for each match", () => {
      const text = "ssn 123-45-6789";
      const verdict = pii({ detect: ["ssn"], onMatch: "flag" }).check(text, ctx);

      expect(verdict.type).toBe("flag");

      if (verdict.type === "flag") {
        const [span] = verdict.matches;
        expect(span.span).toBeDefined();
        const [start, end] = span.span ?? [0, 0];
        expect(text.slice(start, end + 1)).toBe("123-45-6789");
      }
    });
  });

  describe("redact masking", () => {
    it("replaces the matched span with the default placeholder", () => {
      const verdict = pii({ detect: ["ssn"] }).check("ssn 123-45-6789 end", ctx);

      expect(verdict.type).toBe("redact");

      if (verdict.type === "redact") {
        expect(verdict.text).toBe("ssn [REDACTED] end");
        expect(verdict.text).not.toContain("123-45-6789");
      }
    });

    it("substitutes {label} in the mask template with the matched category", () => {
      const verdict = pii({ detect: ["email"], mask: "[PII:{label}]" }).check(
        "ping a@b.com now",
        ctx,
      );

      expect(verdict.type).toBe("redact");

      if (verdict.type === "redact") {
        expect(verdict.text).toBe("ping [PII:email] now");
      }
    });

    it("redacts multiple matches across categories in one pass", () => {
      const verdict = pii({ mask: "[{label}]" }).check("a@b.com and 192.168.0.1 both leak", ctx);

      expect(verdict.type).toBe("redact");

      if (verdict.type === "redact") {
        expect(verdict.text).toContain("[email]");
        expect(verdict.text).toContain("[ipv4]");
        expect(verdict.text).not.toContain("a@b.com");
        expect(verdict.text).not.toContain("192.168.0.1");
      }
    });

    it("uses a template without the {label} token verbatim", () => {
      const verdict = pii({ detect: ["ssn"], mask: "***" }).check("id 123-45-6789", ctx);

      expect(verdict.type).toBe("redact");

      if (verdict.type === "redact") {
        expect(verdict.text).toBe("id ***");
      }
    });
  });

  describe("no false positives on clean text", () => {
    it("allows ordinary prose", () => {
      const verdict = pii().check("The quarterly report is due next Tuesday afternoon.", ctx);

      expect(verdict.type).toBe("allow");
    });

    it("does not flag a plain number that is not PII-shaped", () => {
      const verdict = pii().check("We shipped 42 units in 2026.", ctx);

      expect(verdict.type).toBe("allow");
    });
  });

  describe("onMatch action", () => {
    it("blocks when onMatch is block", () => {
      const verdict = pii({ detect: ["email"], onMatch: "block" }).check("reach a@b.com", ctx);

      expect(verdict.type).toBe("block");

      if (verdict.type === "block") {
        expect(verdict.reason).toContain("email");
        expect(verdict.matches?.length).toBe(1);
      }
    });
  });

  describe("dictionary terms", () => {
    it("matches an extra exact-string term case-insensitively", () => {
      const verdict = pii({
        detect: [],
        dictionary: ["Project Aurora"],
        onMatch: "flag",
      }).check("Internal note about project aurora launch.", ctx);

      expect(verdict.type).toBe("flag");

      if (verdict.type === "flag") {
        expect(verdict.matches[0].rule).toBe("pii.dictionary");
      }
    });

    it("treats dictionary metacharacters literally", () => {
      const verdict = pii({
        detect: [],
        dictionary: ["a.b"],
        onMatch: "flag",
      }).check("axb is not it, but a.b is", ctx);

      expect(verdict.type).toBe("flag");

      if (verdict.type === "flag") {
        // Only the literal "a.b" matches — "axb" must not.
        expect(verdict.matches.length).toBe(1);
      }
    });

    it("redacts a dictionary term with the {label} template", () => {
      const verdict = pii({
        detect: [],
        dictionary: ["secret-token"],
        mask: "[{label}]",
      }).check("the secret-token leaked", ctx);

      expect(verdict.type).toBe("redact");

      if (verdict.type === "redact") {
        expect(verdict.text).toBe("the [dictionary] leaked");
      }
    });
  });

  describe("linear-time scanning", () => {
    /** The address pattern the detector used before its one-pass scanner. */
    const referenceEmail = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

    function referenceSpans(text: string): Array<[number, number]> {
      return [...text.matchAll(referenceEmail)].map(
        (match) => [match.index, match.index + match[0].length - 1] as [number, number],
      );
    }

    it("finds exactly the address spans of the reference pattern", () => {
      const samples = [
        "mail a@b.com and c.d+e@f-g.co.uk now",
        "..foo@bar.com",
        "a@b.com.x@y.io",
        "x@y.z1 q@w.er",
        "_x@y.zz",
        "%a@b.cd @ e@f@g.hi",
        "joe@example.c0m and joe@example.com.",
        "a@b.c",
      ];

      for (const sample of samples) {
        const verdict = pii({ detect: ["email"], onMatch: "flag" }).check(sample, ctx);
        const spans = verdict.type === "flag" ? verdict.matches.map((match) => match.span) : [];

        expect(spans, sample).toEqual(referenceSpans(sample));
      }
    });

    it("returns on a long run of address-like characters with no address", () => {
      // Quadratic under a backtracking address regex (minutes of blocked event loop).
      const verdict = pii().check("a.".repeat(200_000), ctx);

      expect(verdict.type).toBe("allow");
    });

    it("dedupes and redacts many hits in one pass", () => {
      const text = "1.1.1.1 ".repeat(50_000);
      const verdict = pii({ detect: ["ipv4"], mask: "[{label}]" }).check(text, ctx);

      expect(verdict.type).toBe("redact");

      if (verdict.type === "redact") {
        expect(verdict.matches.length).toBe(50_000);
        expect(verdict.text).toBe("[ipv4] ".repeat(50_000));
      }
    });

    it("redacts a very large number of addresses instead of failing open", () => {
      // 200,000 hits: spreading them into one `push` call overflowed the stack,
      // and a throwing detector lets the text through.
      const text = "a@b.co ".repeat(200_000);
      const verdict = pii({ detect: ["email"], mask: "[{label}]" }).check(text, ctx);

      expect(verdict.type).toBe("redact");

      if (verdict.type === "redact") {
        expect(verdict.matches.length).toBe(200_000);
        expect(verdict.text).toBe("[email] ".repeat(200_000));
      }
    });

    it("keeps the earliest, widest span when hits overlap", () => {
      const verdict = pii({
        detect: [],
        dictionary: ["alpha beta", "beta", "alpha", "beta gamma"],
        mask: "<{label}>",
      }).check("alpha beta gamma", ctx);

      expect(verdict.type).toBe("redact");

      if (verdict.type === "redact") {
        expect(verdict.matches.map((match) => match.span)).toEqual([[0, 9]]);
        expect(verdict.text).toBe("<dictionary> gamma");
      }
    });
  });
});
