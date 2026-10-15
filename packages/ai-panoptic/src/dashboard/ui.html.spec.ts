import { describe, expect, it } from "vitest";
import { dashboardHtml } from "./ui.html";

/**
 * The dashboard page is one self-contained HTML string with vanilla JS
 * inlined inside a TS template literal. These tests guard the two things
 * that silently break that string: an unbalanced template (a stray
 * literal backtick prematurely closing it) and a regression that drops a
 * feature's wiring marker. They do NOT exercise the client JS — that's
 * what `trace-filter.spec.ts` covers via the mirrored pure helpers.
 */
describe("dashboardHtml", () => {
  const html = dashboardHtml("/", "Panoptic");

  it("renders the page title and stays a single HTML document", () => {
    expect(html).toContain("Panoptic");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("inlines NO literal backtick in the client JS — it builds one via fromCharCode", () => {
    // The only backticks allowed are the TS template-literal delimiters
    // and the `${basePath}api` interpolation in the TS layer. Inside the
    // <script> body there must be zero, or the outer template breaks. We
    // assert the client builds its backtick through String.fromCharCode.
    const scriptStart = html.lastIndexOf("<script>");
    const scriptBody = html.slice(scriptStart);

    expect(scriptBody).toContain("String.fromCharCode(96)");
    expect(scriptBody.includes("`")).toBe(false);
  });

  it("keeps the existing drawer + theme features", () => {
    expect(html).toContain('id="drawer"');
    expect(html).toContain('id="theme"');
    expect(html).toContain('data-theme-set="system"');
    expect(html).toContain("renderTree");
    expect(html).toContain("renderDetail");
  });

  it("keeps the bearer token out of the outer script scope (not a page-global)", () => {
    // `TOKEN` must live inside its own nested IIFE — not a bare top-level
    // `var` in the ~1000-line closure the rest of the client script
    // shares — so it isn't reachable from unrelated code in that scope.
    // Only the `fetchAuthed` function the inner IIFE returns is shared.
    expect(html).toContain(
      'var fetchAuthed = (function () {\n    var TOKEN = new URLSearchParams(window.location.search).get("token");',
    );
    // The token variable itself is referenced only inside that inner
    // closure (its declaration + the two reads used to attach it to a
    // request), never again by the rest of the ~1000-line outer script.
    const tokenMatches = html.match(/\bTOKEN\b/g) ?? [];
    expect(tokenMatches.length).toBe(3);
  });

  it("wires the search box + filter chips", () => {
    expect(html).toContain('id="search"');
    expect(html).toContain('id="status-chips"');
    expect(html).toContain('id="type-chips"');
    expect(html).toContain('id="session-chips"');
    expect(html).toContain("renderChips");
    expect(html).toContain("matchesFilter");
  });

  it("wires the grouping dropdown (session / prompt / type dimensions)", () => {
    // The three mutually-exclusive group-by dimensions live in one <select>.
    expect(html).toContain('id="group-by"');
    expect(html).toContain('value="session"');
    expect(html).toContain('value="type"');
    expect(html).toContain("groupBySession");
    expect(html).toContain("sgroup-head");
  });

  it("wires the prompt-version filter + group-by dimension", () => {
    // Filter chip row, the prompt group-by option, and the inlined helpers
    // that mirror trace-filter.ts (tracePromptKey / groupByPrompt).
    expect(html).toContain('id="prompt-chips"');
    expect(html).toContain('value="prompt"');
    expect(html).toContain("tracePromptKey");
    expect(html).toContain("groupByPrompt");
    expect(html).toContain("data-prompt=");
    // The node-detail metadata panel surfaces the prompt name@version.
    expect(html).toContain("spanPromptKey");
    expect(html).toContain("agent.promptName");
  });

  it("wires the cost heatmap with a legend", () => {
    expect(html).toContain("heatIntensity");
    expect(html).toContain("maxNodeCost");
    expect(html).toContain('class="heat"');
    expect(html).toContain('class="grad"');
  });

  it("wires the tree / timeline view toggle and a Gantt", () => {
    expect(html).toContain('data-view="tree"');
    expect(html).toContain('data-view="timeline"');
    expect(html).toContain("renderGantt");
    expect(html).toContain("criticalPath");
    expect(html).toContain("flattenSpans");
  });

  it("wires the errors-only status chip", () => {
    expect(html).toContain("data-errors=");
    expect(html).toContain("errorsOnly");
  });

  it("wires URL-hash deep-links for trace + span", () => {
    expect(html).toContain("writeHash");
    expect(html).toContain("readHash");
    expect(html).toContain("applyHash");
    expect(html).toContain("#trace=");
    expect(html).toContain("hashchange");
  });

  it("keeps the 2s poll and notes the live-tail follow-up", () => {
    expect(html).toContain("setInterval(poll, 2000)");
    expect(html).toContain("FOLLOW-UP");
  });

  it("honors a non-root base path in the API base", () => {
    const scoped = dashboardHtml("/panoptic/", "Panoptic");

    expect(scoped).toContain('"/panoptic/api"');
  });

  it("bakes EVALUATE_ENABLED false and wires nothing extra by default", () => {
    expect(html).toContain("EVALUATE_ENABLED = false");
    expect(html).toContain("data-evaluate-toggle");
    expect(html).toContain("data-evaluate-run");
  });

  it("bakes EVALUATE_ENABLED true and the configured default instructions when evaluate is enabled", () => {
    const enabled = dashboardHtml("/", "Panoptic", true, "Must stay under 200 words.");

    expect(enabled).toContain("EVALUATE_ENABLED = true");
    expect(enabled).toContain("Must stay under 200 words.");
  });

  it("NEVER inlines a literal backtick even when the configured instructions contain one", () => {
    // The exact hazard encodeForInlineScript exists for: an operator's
    // instructions containing backtick-quoted code (e.g. "grade `foo()`
    // calls") must not leak a raw backtick into the outer template.
    const withBacktick = dashboardHtml("/", "Panoptic", true, "Grade `foo()` calls strictly.");
    const scriptStart = withBacktick.lastIndexOf("<script>");
    const scriptBody = withBacktick.slice(scriptStart);

    expect(scriptBody.includes("`")).toBe(false);
    // Still reconstructs the original text at runtime via BT concatenation.
    expect(scriptBody).toContain('"Grade "');
    expect(scriptBody).toContain('"foo()"');
    expect(scriptBody).toContain("+ BT +");
  });
});
