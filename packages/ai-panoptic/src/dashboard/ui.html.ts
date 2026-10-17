import { WARLOCK_LOGO_DATA_URI } from "./warlock-logo";

/**
 * Build the single self-contained dashboard HTML page. No external
 * assets, no bundler, no framework — one inlined string that polls the
 * read-only JSON API (`{basePath}api/aggregate`, `{basePath}api/traces`,
 * `{basePath}api/traces/:id`) and renders:
 *
 * - the {@link TraceAggregate} headline counts (traces / completed /
 *   failed / cancelled / tokens in·out·total / cost);
 * - a newest-first trace list as clickable master rows, each led by a
 *   colour-coded, title-cased type label (Supervisor / Agent / Tool / …);
 * - a two-pane drawer: a collapsible call tree on the left (the nested
 *   span hierarchy) and the selected node's detail on the right — rich
 *   input/output, token breakdown, and a metadata panel (session id,
 *   ids, version, attributes).
 *
 * Span input/output is rendered structurally (chat bubbles / key-value /
 * Markdown), durations in seconds, tokens as ↓input · ↑output · total.
 * Theme is light / dark / system (persisted to localStorage). All UI
 * state — selected trace, selected span, collapsed nodes — lives in JS,
 * NOT the DOM, so the 2s poll never disturbs an open drawer.
 *
 * The list is filterable entirely client-side over the polled traces: a
 * free-text search (name + session), status / type / session filter
 * chips, an "errors only" header toggle, and an optional group-by-session
 * view with collapsible headers. Each tree node and trace row carries a
 * cost heatmap accent scaled to the trace's most expensive node, with a
 * small legend. The drawer's left pane toggles between the nested call
 * TREE and a Gantt TIMELINE (span offset from root start + duration,
 * critical path highlighted). The selected trace and span are reflected
 * in the URL hash (`#trace=&span=`) and re-opened from it on load — so a
 * drawer view is shareable/bookmarkable. A live socket tail is a noted
 * follow-up; this pass stays on the 2s poll.
 *
 * `basePath` and `title` are baked in at serve time. The page is
 * intentionally dependency-free vanilla JS so it works offline.
 *
 * @param basePath Normalized mount path ending in `/` (e.g. `"/"`).
 * @param title Header title shown in the page.
 */
export function dashboardHtml(
  basePath: string,
  title: string,
  evaluateEnabled: boolean = false,
  evaluateDefaultInstructions: string = "",
): string {
  const apiBase = `${basePath}api`;
  const safeTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<script>
(function () {
  try {
    var m = localStorage.getItem("panoptic-theme") || "system";
    var light = m === "light" || (m === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
  } catch (e) {}
})();
</script>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0d10; --surface: #101317; --surface2: #14171c; --panel: #0d1014;
    --border: #23272e; --border2: #2d333b;
    --text: #e6e8eb; --text2: #adbac7; --dim: #8b949e;
    --sel-bg: #0f1722; --sel-border: #316dca;
    --ty-agent: #539bf5; --ty-tool: #c297ff; --ty-model: #4cc2b0; --ty-prim: #e3b341; --ty-other: #adbac7;
    --tok-in: #58a6ff; --tok-out: #3fb950; --tok-total: #b899ff; --cost: #e3b341;
    --ok: #56d364; --ok-bg: #0f2e1d; --fail: #f85149; --fail-bg: #3a1416; --cancel: #d29922; --cancel-bg: #332701; --other: #8b949e; --other-bg: #1c2128;
    --code-bg: #0b0d10; --inline-bg: #1c2128; --link: #539bf5;
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --bg: #ffffff; --surface: #f6f8fa; --surface2: #eef1f4; --panel: #ffffff;
    --border: #d0d7de; --border2: #afb8c1;
    --text: #1f2328; --text2: #3b4350; --dim: #636c76;
    --sel-bg: #ddf4ff; --sel-border: #0969da;
    --ty-agent: #0969da; --ty-tool: #8250df; --ty-model: #0f7d6b; --ty-prim: #9a6700; --ty-other: #57606a;
    --tok-in: #0969da; --tok-out: #1a7f37; --tok-total: #8250df; --cost: #9a6700;
    --ok: #1a7f37; --ok-bg: #dafbe1; --fail: #cf222e; --fail-bg: #ffebe9; --cancel: #9a6700; --cancel-bg: #fff8c5; --other: #57606a; --other-bg: #eaeef2;
    --code-bg: #f6f8fa; --inline-bg: #eaeef2; --link: #0969da;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--text); }
  header { padding: 14px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; }
  header img.logo { height: 26px; width: 26px; display: block; flex: none; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .meta { color: var(--dim); font-size: 12px; }
  .theme { margin-left: auto; display: flex; gap: 2px; border: 1px solid var(--border); border-radius: 8px; padding: 2px; }
  .theme button { background: transparent; border: none; color: var(--dim); cursor: pointer; font-size: 14px; line-height: 1; padding: 4px 8px; border-radius: 6px; }
  .theme button:hover { color: var(--text); }
  .theme button.active { background: var(--surface2); color: var(--text); }
  .stats { display: flex; flex-wrap: wrap; gap: 10px; padding: 14px 20px; border-bottom: 1px solid var(--border); }
  .stat { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; min-width: 84px; }
  .stat .label { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .stat .value { font-size: 18px; font-weight: 600; }
  main { padding: 12px 20px 40px; }

  .trace-row { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; background: var(--surface); padding: 9px 12px; display: flex; align-items: center; gap: 9px; cursor: pointer; transition: background .12s ease, border-color .12s ease; }
  .trace-row:hover { background: var(--surface2); border-color: var(--border2); }
  .trace-row.selected { border-color: var(--sel-border); background: var(--sel-bg); }
  .rname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rprompt { font-size: 11px; color: var(--ty-agent); border: 1px solid var(--border2); border-radius: 6px; padding: 1px 6px; white-space: nowrap; }
  .rright { margin-left: auto; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .chev { color: var(--dim); font-size: 16px; font-style: normal; }

  .tylabel { font-weight: 600; flex: none; }
  .ty-agent { color: var(--ty-agent); } .ty-tool { color: var(--ty-tool); } .ty-model { color: var(--ty-model); } .ty-prim { color: var(--ty-prim); } .ty-other { color: var(--ty-other); }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600; flex: none; }
  .badge.completed { background: var(--ok-bg); color: var(--ok); }
  .badge.failed { background: var(--fail-bg); color: var(--fail); }
  .badge.cancelled { background: var(--cancel-bg); color: var(--cancel); }
  .badge.other { background: var(--other-bg); color: var(--other); }
  .sdot { width: 7px; height: 7px; border-radius: 999px; display: inline-block; flex: none; }
  .sdot-completed { background: var(--ok); } .sdot-failed { background: var(--fail); } .sdot-cancelled { background: var(--cancel); } .sdot-other { background: var(--other); }
  .dim { color: var(--dim); font-size: 12px; }
  .tok { white-space: nowrap; font-size: 12px; }
  .tok-in { color: var(--tok-in); } .tok-out { color: var(--tok-out); } .tok-total { color: var(--tok-total); }
  .cost { color: var(--cost); font-weight: 600; font-size: 12px; white-space: nowrap; }

  .io-body { margin-bottom: 6px; }
  .piol { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin: 11px 0 3px; }
  .messages { display: flex; flex-direction: column; gap: 8px; }
  .msg-collapse { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
  .msg-collapse > summary { cursor: pointer; padding: 7px 10px; list-style: none; font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .msg-collapse > summary::-webkit-details-marker { display: none; }
  .msg-collapse > summary::before { content: "\\25B8"; color: var(--dim); }
  .msg-collapse[open] > summary::before { content: "\\25BE"; }
  .msg-collapse[open] > summary { border-bottom: 1px solid var(--border); }
  .msg-collapse .messages { padding: 8px; }
  .msg-collapse .msg-count { font-weight: 600; color: var(--text2); }
  .msg { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface); }
  .msg-role { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; padding: 4px 10px; color: var(--text2); background: var(--surface2); border-bottom: 1px solid var(--border); }
  .msg-role.role-system { color: var(--cancel); } .msg-role.role-user { color: var(--ty-agent); } .msg-role.role-assistant { color: var(--ok); } .msg-role.role-tool { color: var(--ty-tool); }
  .msg-content { padding: 8px 10px; }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; align-items: start; }
  .kv-row { display: contents; }
  .kv-k { color: var(--dim); font-family: ui-monospace, monospace; font-size: 12px; padding: 2px 0; white-space: nowrap; }
  .kv-v { font-size: 13px; min-width: 0; overflow: auto; padding: 1px 0; word-break: break-word; }
  .part { border-left: 2px solid var(--border2); padding-left: 8px; margin: 4px 0; }
  .part-label { font-size: 11px; text-transform: uppercase; color: var(--dim); margin-bottom: 2px; }
  .md-h { font-weight: 700; margin: 8px 0 4px; }
  .md-h1 { font-size: 16px; } .md-h2 { font-size: 14px; } .md-h3 { font-size: 13px; color: var(--text2); } .md-h4 { font-size: 12px; color: var(--dim); }
  .md-p { margin: 4px 0; white-space: pre-wrap; word-break: break-word; }
  .io-body ul, .msg-content ul { margin: 4px 0; padding-left: 18px; }
  pre.code { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px; overflow: auto; max-height: 320px; font-size: 12px; white-space: pre; margin: 6px 0; }
  pre.mini { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; overflow: auto; max-height: 200px; font-size: 12px; margin: 0; }
  code { background: var(--inline-bg); border-radius: 4px; padding: 1px 4px; font-family: ui-monospace, monospace; font-size: 12px; }
  a { color: var(--link); }
  .empty { color: var(--dim); padding: 30px; text-align: center; }

  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); opacity: 0; pointer-events: none; transition: opacity .18s ease; z-index: 40; }
  .backdrop.open { opacity: 1; pointer-events: auto; }
  .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(760px, 96vw); background: var(--panel); border-left: 1px solid var(--border); transform: translateX(100%); transition: transform .18s ease; z-index: 50; display: flex; flex-direction: column; box-shadow: -16px 0 40px rgba(0,0,0,.4); }
  .drawer.open { transform: translateX(0); }
  .drawer-head { padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .drawer-close { margin-left: auto; background: transparent; border: 1px solid var(--border); color: var(--dim); border-radius: 6px; cursor: pointer; font-size: 13px; line-height: 1; padding: 5px 9px; }
  .drawer-close:hover { color: var(--text); border-color: var(--border2); }
  .drawer-body { flex: 1; overflow: hidden; }
  .dsplit { display: flex; height: 100%; }
  .dtree { flex: 0 0 44%; overflow: auto; padding: 8px 6px; border-right: 1px solid var(--border); }
  .ddetail { flex: 1; overflow: auto; padding: 10px 14px; min-width: 0; }
  .tnode { display: flex; align-items: center; gap: 7px; padding: 5px 7px; border-radius: 6px; cursor: pointer; font-size: 13px; border: 1px solid transparent; }
  .tnode:hover { background: var(--surface); }
  .tnode.selected { background: var(--sel-bg); border-color: var(--sel-border); }
  .tname { color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tmeta { margin-left: auto; color: var(--dim); font-size: 12px; white-space: nowrap; }
  .twisty { color: var(--dim); font-size: 11px; width: 12px; text-align: center; flex: none; }
  .tkids { margin-left: 10px; padding-left: 9px; border-left: 1px solid var(--border); }
  .crumb { font-size: 12px; color: var(--dim); margin-bottom: 6px; word-break: break-all; }
  .crumb .sep { color: var(--border2); }
  .dhead-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
  .meta-sec { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 8px; }
  .meta-title { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); margin-bottom: 6px; }

  /* Toolbar: search box + filter chips over the trace list. */
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 20px; border-bottom: 1px solid var(--border); }
  .search { flex: 1 1 220px; min-width: 160px; background: var(--surface2); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 7px 10px; font: inherit; }
  .search:focus { outline: none; border-color: var(--sel-border); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip { background: var(--surface2); border: 1px solid var(--border); color: var(--text2); border-radius: 999px; padding: 4px 11px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background .12s ease, border-color .12s ease, color .12s ease; }
  .chip:hover { color: var(--text); border-color: var(--border2); }
  .chip.active { background: var(--sel-bg); border-color: var(--sel-border); color: var(--text); }
  .chip-clear { color: var(--dim); border-style: dashed; }
  .chip-group { display: inline-flex; gap: 6px; align-items: center; }
  .chip-group .gl { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); }
  .toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: var(--text2); user-select: none; }
  .toggle input { accent-color: var(--sel-border); }
  .toggle select { background: var(--surface2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px; font-size: 12px; cursor: pointer; }
  .toggle select:hover { border-color: var(--border2); }

  /* Session grouping headers. */
  .sgroup { margin-bottom: 10px; }
  .sgroup-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; background: var(--surface2); border: 1px solid var(--border); cursor: pointer; margin-bottom: 6px; }
  .sgroup-head:hover { border-color: var(--border2); }
  .sgroup-tw { color: var(--dim); font-size: 11px; width: 12px; text-align: center; flex: none; }
  .sgroup-id { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sgroup-count { margin-left: auto; color: var(--dim); font-size: 12px; }
  .sgroup-body { padding-left: 6px; }

  /* Per-type aggregate stats panel (a CSS-grid table above the trace list). */
  .stats-table { margin: 0 0 14px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; font-size: 12px; }
  .strow { display: grid; grid-template-columns: 1.5fr 0.7fr 1fr 0.8fr 0.8fr 1fr 1fr; gap: 10px; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--border); }
  .strow:last-child { border-bottom: none; }
  .strow.sthead { background: var(--surface2); color: var(--dim); font-weight: 600; }
  .strow > span { text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .strow > .stc-type { text-align: left; }
  .stc-fail.fail { color: var(--fail); }

  /* Cost heatmap: a left accent bar tinted by relative rollup cost. */
  .trace-row { position: relative; }
  .tnode { position: relative; }
  .heat { position: absolute; left: 0; top: 3px; bottom: 3px; width: 3px; border-radius: 2px; background: var(--cost); }

  /* Timeline / waterfall view in the drawer. */
  .dview { display: flex; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .dview button { background: transparent; border: 1px solid var(--border); color: var(--dim); cursor: pointer; font-size: 12px; padding: 4px 10px; border-radius: 6px; }
  .dview button:hover { color: var(--text); }
  .dview button.active { background: var(--surface2); color: var(--text); border-color: var(--border2); }
  .legend { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dim); }
  .legend .grad { width: 64px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, var(--surface2), var(--cost)); border: 1px solid var(--border); }
  .gantt { padding: 8px 10px; }

  /* Evaluate — the drawer's one write action (config-gated). */
  .eval-btn { background: transparent; border: 1px solid var(--border); color: var(--text2); cursor: pointer; font-size: 12px; padding: 4px 10px; border-radius: 6px; margin: 10px 0 0; }
  .eval-btn:hover:not(:disabled) { color: var(--text); border-color: var(--border2); }
  .eval-btn:disabled { opacity: .6; cursor: default; }
  .eval-panel { margin-top: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface2); }
  .eval-panel textarea { width: 100%; min-height: 64px; background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 8px; font: 12px/1.5 ui-sans-serif, system-ui, sans-serif; resize: vertical; }
  .eval-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .eval-error { color: var(--fail); font-size: 12px; }
  .eval-result { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 12px; }
  .eval-score { font-weight: 600; }
  .eval-issues { margin: 6px 0 0; padding-left: 18px; }
  .grow { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: 12px; cursor: pointer; border-radius: 4px; }
  .grow:hover { background: var(--surface); }
  .grow.selected { background: var(--sel-bg); }
  .glabel { flex: 0 0 38%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text2); }
  .gtrack { position: relative; flex: 1; height: 14px; background: var(--surface2); border-radius: 4px; overflow: hidden; }
  .gbar { position: absolute; top: 2px; bottom: 2px; border-radius: 3px; background: var(--ty-agent); min-width: 2px; }
  .gbar.crit { background: var(--fail); }
  .gbar.bar-completed { background: var(--ty-agent); } .gbar.bar-failed { background: var(--fail); } .gbar.bar-cancelled { background: var(--cancel); } .gbar.bar-other { background: var(--other); }
  .gdur { flex: 0 0 auto; color: var(--dim); white-space: nowrap; min-width: 44px; text-align: right; }
  .gantt-legend { display: flex; gap: 14px; margin-top: 8px; font-size: 11px; color: var(--dim); }
  .gantt-legend .ck { display: inline-flex; align-items: center; gap: 5px; }
  .gantt-legend .sw { width: 12px; height: 8px; border-radius: 2px; display: inline-block; }

  @media (max-width: 560px) {
    .dsplit { flex-direction: column; }
    .dtree { flex: none; max-height: 42vh; border-right: none; border-bottom: 1px solid var(--border); }
    .glabel { flex-basis: 30%; }
  }
</style>
</head>
<body>
<header>
  <img class="logo" src="${WARLOCK_LOGO_DATA_URI}" alt="Warlock" />
  <h1>${safeTitle}</h1>
  <span class="meta" id="meta">connecting…</span>
  <div class="theme" id="theme" role="group" aria-label="Theme" style="margin-left:auto">
    <button type="button" data-theme-set="light" title="Light" aria-label="Light theme">☀</button>
    <button type="button" data-theme-set="dark" title="Dark" aria-label="Dark theme">☾</button>
    <button type="button" data-theme-set="system" title="System" aria-label="System theme">◐</button>
  </div>
</header>
<div class="stats" id="stats"></div>
<div class="toolbar" id="toolbar">
  <input class="search" id="search" type="search" placeholder="Search name or session…" aria-label="Search traces" autocomplete="off" />
  <div class="chips" id="status-chips" role="group" aria-label="Filter by status"></div>
  <div class="chips" id="type-chips" role="group" aria-label="Filter by type"></div>
  <div class="chips" id="session-chips" role="group" aria-label="Filter by session"></div>
  <div class="chips" id="prompt-chips" role="group" aria-label="Filter by prompt version"></div>
  <label class="toggle" id="group-wrap" title="Group the trace list (mutually exclusive)">
    Group
    <select id="group-by" aria-label="Group the trace list">
      <option value="">None</option>
      <option value="session">Session</option>
      <option value="prompt">Prompt</option>
      <option value="type">Type</option>
    </select>
  </label>
  <label class="toggle" id="stats-wrap" title="Show a per-type aggregate stats panel (count, failure rate, p50/p95 latency, tokens, cost)">
    <input type="checkbox" id="show-stats" /> Stats
  </label>
  <button class="chip chip-clear" id="clear-filters" type="button" title="Clear all filters">Clear</button>
</div>
<div id="stats-panel"></div>
<main id="traces"><div class="empty">Loading…</div></main>

<div class="backdrop" id="backdrop"></div>
<aside class="drawer" id="drawer" aria-hidden="true" aria-label="Trace detail">
  <div class="drawer-head" id="drawer-head"></div>
  <div class="drawer-body" id="drawer-body"></div>
</aside>

<script>
(function () {
  var API = ${JSON.stringify(apiBase)};
  var EVALUATE_ENABLED = ${JSON.stringify(evaluateEnabled)};
  var BT = String.fromCharCode(96);
  var EVALUATE_DEFAULT_INSTRUCTIONS = ${encodeForInlineScript(evaluateDefaultInstructions)};

  // Carry the ?token= the page itself was loaded with onto every
  // subsequent poll as an Authorization header — otherwise the API calls
  // below inherit no auth and 401 forever once authToken is configured
  // (the initial page load is the only request the URL's query string
  // naturally reaches; the server only honors ?token= on that one route,
  // see serve.ts). The token itself is kept in its own nested closure,
  // not a plain var sitting alongside the rest of this file's top-level
  // state, so it isn't trivially reachable from other code sharing this
  // script's outer scope; only the fetchAuthed function it returns is.
  var fetchAuthed = (function () {
    var TOKEN = new URLSearchParams(window.location.search).get("token");
    return function fetchAuthed(url, options) {
      var opts = options || {};
      var headers = opts.headers || {};
      if (TOKEN) headers = Object.assign({}, headers, { Authorization: "Bearer " + TOKEN });
      return fetch(url, Object.assign({}, opts, { headers: headers }));
    };
  })();

  var state = {
    traces: [], selectedId: null, selectedSpanId: null, collapsed: {}, sig: null,
    // Client-side filter state (search box + chips + errors-only header toggle).
    filter: { text: "", statuses: {}, types: {}, sessionId: null, promptKey: null, errorsOnly: false },
    groupBySession: false,        // session-grouping list toggle
    groupByPrompt: false,         // prompt-version-grouping list toggle
    groupByType: false,           // root-type-grouping list toggle
    showStats: false,             // per-type aggregate-stats panel toggle (independent of grouping)
    collapsedGroups: {},          // collapsed group headers (session, prompt, or type)
    view: "tree",                 // drawer left pane: "tree" | "timeline"
    hashApplied: false,           // guards one-time deep-link open on load
    evaluate: {}                  // per-span evaluate UI state, keyed by spanId
  };

  var STATUS_FILTERS = ["completed", "failed", "cancelled"];
  var TYPE_FILTERS = ["agent", "tool", "model", "supervisor", "team", "workflow", "orchestrator", "planner", "batch", "callback"];
  var ERROR_STATUSES = { failed: 1, cancelled: 1, incomplete: 1 };
  var NO_SESSION_KEY = "(no session)";
  var NO_PROMPT_KEY = "(no prompt)";
  var NO_TYPE_KEY = "(no type)";

  var statusClass = function (s) {
    if (s === "completed" || s === "failed" || s === "cancelled") return s;
    if (s === "incomplete") return "failed";
    return "other";
  };
  var esc = function (v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var num = function (n) { return (n == null ? 0 : n).toLocaleString(); };
  var fmt = function (v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
  };

  function dur(ms) {
    if (ms == null) return "—";
    if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
    if (ms >= 1) return Math.round(ms) + "ms";
    return ms.toFixed(1) + "ms";
  }

  function tokens(u) {
    if (!u) return "";
    var i = u.input || 0, o = u.output || 0, t = (u.total != null) ? u.total : (i + o);
    if (i === 0 && o === 0 && t === 0) return ""; // nothing to show — hide the row
    return '<span class="tok">'
      + '<span class="tok-in" title="input tokens">&#8595; ' + num(i) + "</span> "
      + '<span class="tok-out" title="output tokens">&#8593; ' + num(o) + "</span> "
      + '<span class="tok-total" title="total tokens">' + num(t) + " total</span></span>";
  }

  var TYPE_LABELS = {
    agent: "Agent", tool: "Tool", model: "Model", supervisor: "Supervisor",
    workflow: "Workflow", orchestrator: "Orchestrator", team: "Team",
    planner: "Planner", prompt: "Prompt", guardrail: "Guardrail"
  };
  var PRIMITIVES = { supervisor: 1, workflow: 1, orchestrator: 1, team: 1, planner: 1 };
  function typeClass(type) {
    if (PRIMITIVES[type]) return "ty-prim";
    if (type === "agent") return "ty-agent";
    if (type === "tool") return "ty-tool";
    if (type === "model") return "ty-model";
    return "ty-other";
  }
  function typeLabel(type) {
    var t = type || "node";
    var label = TYPE_LABELS[t] || (t.charAt(0).toUpperCase() + t.slice(1));
    return '<span class="tylabel ' + typeClass(t) + '">' + esc(label) + "</span>";
  }
  // Plain-text (no span wrapper) capitalized labels for bare-text sites —
  // group headers, filter-chip labels — where the colored typeLabel span is
  // not wanted. Underlying keys/classes/filter values stay raw lowercase.
  function typeText(type) {
    var t = type || "node";
    return TYPE_LABELS[t] || (t.charAt(0).toUpperCase() + t.slice(1));
  }
  function statusText(s) {
    return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s;
  }
  function statusDot(s) { return '<span class="sdot sdot-' + statusClass(s) + '" title="' + esc(s) + '"></span>'; }

  function findTrace(id) {
    for (var i = 0; i < state.traces.length; i++) if (state.traces[i].traceId === id) return state.traces[i];
    return null;
  }
  function findSpan(span, id) {
    if (span.spanId === id) return span;
    var k = span.children || [];
    for (var i = 0; i < k.length; i++) { var r = findSpan(k[i], id); if (r) return r; }
    return null;
  }
  function findPath(span, id, acc) {
    var p = (acc || []).concat([span]);
    if (span.spanId === id) return p;
    var k = span.children || [];
    for (var i = 0; i < k.length; i++) { var r = findPath(k[i], id, p); if (r) return r; }
    return null;
  }
  function countSpans(span) {
    var n = 1, k = span.children || [];
    for (var i = 0; i < k.length; i++) n += countSpans(k[i]);
    return n;
  }
  function traceSig(t) { return t.root.status + "|" + countSpans(t.root) + "|" + t.duration + "|" + (t.usage && t.usage.total); }
  // Sum every priced lane of a cost object into one USD number.
  function costSumObj(c) {
    if (!c) return 0;
    return (c.input || 0) + (c.output || 0) + (c.cachedInput || 0) + (c.cacheWrite || 0) + (c.cachedOutput || 0) + (c.reasoning || 0);
  }
  // The cost a single span directly carries (on its rolled-up usage).
  function usageCost(usage) { return usage ? costSumObj(usage.cost) : 0; }
  // Rollup-aware subtree cost: take a node's own cost when it has one
  // (it already rolls up its trips); otherwise sum the children. This
  // avoids double-counting on wrapper nodes (workflow/supervisor roots
  // carry tokens but no cost, so we descend to the priced agent/model).
  function rollupCost(span) {
    var own = usageCost(span.usage);
    if (own > 0) return own;
    var sum = 0;
    (span.children || []).forEach(function (c) { sum += rollupCost(c); });
    return sum;
  }
  function traceCost(t) {
    var explicit = costSumObj(t.cost);
    return explicit > 0 ? explicit : rollupCost(t.root);
  }
  // Format a USD amount; tiny per-node costs need more decimals to read.
  function money(n) {
    if (!n) return "$0";
    return "$" + (n < 0.01 ? n.toFixed(6) : n.toFixed(4));
  }

  // --- Client-side filtering / grouping / heatmap ----------------------
  // These mirror the pure, unit-tested helpers in trace-filter.ts. Keep
  // the two in sync: trace-filter.ts is the spec, this is its inlined twin.
  function anySelected(map) {
    for (var k in map) { if (map[k]) return true; }
    return false;
  }
  function matchesFilter(t) {
    var f = state.filter, root = t.root;
    if (f.errorsOnly && !ERROR_STATUSES[root.status]) return false;
    if (anySelected(f.statuses) && !f.statuses[root.status]) return false;
    if (anySelected(f.types) && !f.types[root.type]) return false;
    if (f.sessionId && t.sessionId !== f.sessionId) return false;
    if (f.promptKey && tracePromptKey(t) !== f.promptKey) return false;
    var text = (f.text || "").trim().toLowerCase();
    if (text) {
      var hay = (String(root.name) + " " + (t.sessionId || "")).toLowerCase();
      if (hay.indexOf(text) === -1) return false;
    }
    return true;
  }
  function filteredTraces() {
    var out = [];
    for (var i = 0; i < state.traces.length; i++) if (matchesFilter(state.traces[i])) out.push(state.traces[i]);
    return out;
  }
  function groupBySession(list) {
    var order = [], byKey = {};
    for (var i = 0; i < list.length; i++) {
      var key = list[i].sessionId || NO_SESSION_KEY;
      if (!byKey[key]) { byKey[key] = []; order.push(key); }
      byKey[key].push(list[i]);
    }
    return order.map(function (k) { return { sessionId: k, traces: byKey[k] }; });
  }
  // Group by prompt version (name@version) — the second group-by dimension
  // beside session. Mirrors groupByPrompt in trace-filter.ts. Unlinked runs
  // bucket under NO_PROMPT_KEY so they stay visible.
  function groupByPrompt(list) {
    var order = [], byKey = {};
    for (var i = 0; i < list.length; i++) {
      var key = tracePromptKey(list[i]) || NO_PROMPT_KEY;
      if (!byKey[key]) { byKey[key] = []; order.push(key); }
      byKey[key].push(list[i]);
    }
    return order.map(function (k) { return { groupKey: k, traces: byKey[k] }; });
  }
  // Group by root type (agent/workflow/supervisor/planner/…) — the coarsest
  // group-by dimension. Mirrors groupByType in trace-filter.ts. root.type is
  // always present, so the NO_TYPE_KEY bucket is only a defensive fallback.
  function typeGroups(list) {
    var order = [], byKey = {};
    for (var i = 0; i < list.length; i++) {
      var key = (list[i].root && list[i].root.type) || NO_TYPE_KEY;
      if (!byKey[key]) { byKey[key] = []; order.push(key); }
      byKey[key].push(list[i]);
    }
    return order.map(function (k) { return { groupKey: k, traces: byKey[k] }; });
  }
  // Inlined twins of percentile + aggregateByType in trace-filter.ts (the
  // spec). Power the per-type stats panel from the same filtered list the
  // trace view renders, so the panel honors active filters with no API call.
  function percentile(values, p) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var rank = Math.ceil((p / 100) * sorted.length) - 1;
    var index = Math.min(Math.max(rank, 0), sorted.length - 1);
    return sorted[index];
  }
  function aggregateByType(list) {
    var order = [], byKey = {};
    for (var i = 0; i < list.length; i++) {
      var key = (list[i].root && list[i].root.type) || NO_TYPE_KEY;
      if (!byKey[key]) { byKey[key] = []; order.push(key); }
      byKey[key].push(list[i]);
    }
    return order.map(function (k) {
      var bucket = byKey[k];
      var durations = [], failed = 0, tokens = 0, cost = 0;
      for (var j = 0; j < bucket.length; j++) {
        var t = bucket[j];
        durations.push(t.duration);
        if (ERROR_STATUSES[t.root.status]) failed += 1;
        tokens += (t.usage && t.usage.total) || 0;
        cost += traceCost(t);
      }
      return {
        type: k, count: bucket.length, failed: failed,
        failRate: bucket.length ? failed / bucket.length : 0,
        p50: percentile(durations, 50), p95: percentile(durations, 95),
        tokens: tokens, cost: cost
      };
    });
  }
  // Per-type aggregate panel above the trace list. Honors the active filters
  // (computed over filteredTraces) and re-renders on every poll/filter tick.
  function renderStatsPanel() {
    var host = document.getElementById("stats-panel");
    if (!host) return;
    var stats = state.showStats ? aggregateByType(filteredTraces()) : [];
    if (!stats.length) { host.innerHTML = ""; return; }
    var head = '<div class="strow sthead">'
      + '<span class="stc-type">Type</span><span>Count</span><span>Failed</span>'
      + '<span>p50</span><span>p95</span><span>Tokens</span><span>Cost</span></div>';
    var rows = stats.map(function (s) {
      var failTxt = s.failed
        ? s.failed + " (" + Math.round(s.failRate * 100) + "%)"
        : "0";
      return '<div class="strow">'
        + '<span class="stc-type">' + typeLabel(s.type) + "</span>"
        + '<span>' + num(s.count) + "</span>"
        + '<span class="stc-fail' + (s.failed ? " fail" : "") + '">' + failTxt + "</span>"
        + '<span class="dim">' + dur(s.p50) + "</span>"
        + '<span class="dim">' + dur(s.p95) + "</span>"
        + '<span>' + num(s.tokens) + "</span>"
        + '<span class="cost">' + money(s.cost) + "</span>"
        + "</div>";
    }).join("");
    host.innerHTML = '<div class="stats-table">' + head + rows + "</div>";
  }
  // Largest single-node rollup cost in a subtree — heatmap denominator.
  function maxNodeCost(span) {
    var max = rollupCost(span);
    (span.children || []).forEach(function (c) { var m = maxNodeCost(c); if (m > max) max = m; });
    return max;
  }
  // Intensity in [0,1] of a node's cost vs the trace max. Free trace → 0.
  function heatIntensity(nodeCost, maxCost) {
    if (maxCost <= 0 || nodeCost <= 0) return 0;
    var r = nodeCost / maxCost;
    return r > 1 ? 1 : r;
  }
  // The distinct sessionIds present across the polled traces, first-seen
  // order, capped so the chip row never overflows the toolbar.
  function presentSessions() {
    var seen = {}, out = [];
    for (var i = 0; i < state.traces.length && out.length < 12; i++) {
      var s = state.traces[i].sessionId;
      if (s && !seen[s]) { seen[s] = 1; out.push(s); }
    }
    return out;
  }
  // The root types actually present in the polled traces — so the type filter
  // chips show only what exists (no dead "Tool"/"Model"/"Batch"/… chips), in
  // canonical TYPE_FILTERS order. An active-but-aged-out selection stays so
  // the filter is never stranded with no chip to clear it.
  function presentTypes() {
    var seen = {};
    for (var i = 0; i < state.traces.length; i++) {
      var t = state.traces[i].root && state.traces[i].root.type;
      if (t) seen[t] = 1;
    }
    for (var k in state.filter.types) { if (state.filter.types[k]) seen[k] = 1; }
    var out = [];
    for (var j = 0; j < TYPE_FILTERS.length; j++) {
      if (seen[TYPE_FILTERS[j]]) { out.push(TYPE_FILTERS[j]); delete seen[TYPE_FILTERS[j]]; }
    }
    for (var x in seen) { out.push(x); }
    return out;
  }
  // The distinct prompt name@version keys present across the polled traces,
  // first-seen order, capped so the chip row never overflows the toolbar.
  function presentPrompts() {
    var seen = {}, out = [];
    for (var i = 0; i < state.traces.length && out.length < 12; i++) {
      var p = tracePromptKey(state.traces[i]);
      if (p && !seen[p]) { seen[p] = 1; out.push(p); }
    }
    return out;
  }

  // (S5) Markdown link URLs come from captured prompt/tool text — attacker-
  // influenced content — so only http:, https:, mailto: and relative/anchor
  // URLs may become an href; javascript:, data:, vbscript:, etc. must not.
  // The check runs on the URL as the browser will act on it: undo the
  // entities esc() introduced (the HTML parser decodes them exactly once in
  // the attribute), strip the control chars / whitespace browsers ignore
  // when parsing a scheme (java\\tscript:), and lowercase. Returns the
  // original (still-escaped) URL when safe, or null to drop the link.
  function sanitizeHref(url) {
    var probe = url.replace(/&(amp|lt|gt|quot|#39);/g, function (m, name) {
      return { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[name];
    });
    probe = probe.replace(/[\\u0000-\\u0020\\u007f]+/g, "").toLowerCase();
    if (/^[a-z][a-z0-9+.-]*:/.test(probe)) {
      return /^(https?|mailto):/.test(probe) ? url : null;
    }
    if (/^[\\/\\\\]{2}/.test(probe)) return null; // scheme-relative smuggles a foreign host
    return url;
  }
  function mdInline(s) {
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
    var codeRe = new RegExp(BT + "([^" + BT + "]+)" + BT, "g");
    s = s.replace(codeRe, "<code>$1</code>");
    s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function (m, label, url) {
      var href = sanitizeHref(url);
      if (href === null) return label; // unsafe scheme: label as plain text, no <a>
      return '<a href="' + href + '" target="_blank" rel="noopener">' + label + "</a>";
    });
    return s;
  }
  function mdToHtml(raw) {
    var src = esc(String(raw));
    var fence = BT + BT + BT;
    var html = "", idx = 0;
    while (true) {
      var start = src.indexOf(fence, idx);
      if (start === -1) { html += mdBlocks(src.slice(idx)); break; }
      html += mdBlocks(src.slice(idx, start));
      var nl = src.indexOf("\\n", start + 3);
      var bodyStart = (nl === -1) ? start + 3 : nl + 1;
      var end = src.indexOf(fence, bodyStart);
      if (end === -1) { html += mdBlocks(src.slice(start)); break; }
      html += '<pre class="code">' + src.slice(bodyStart, end).replace(/\\n$/, "") + "</pre>";
      idx = end + 3;
    }
    return html;
  }
  function mdBlocks(src) {
    var lines = src.split("\\n"), html = "", inList = false;
    function closeList() { if (inList) { html += "</ul>"; inList = false; } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var h = ln.match(/^(#{1,4})\\s+(.*)$/);
      if (h) { closeList(); html += '<div class="md-h md-h' + h[1].length + '">' + mdInline(h[2]) + "</div>"; continue; }
      var li = ln.match(/^\\s*[-*]\\s+(.*)$/);
      if (li) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + mdInline(li[1]) + "</li>"; continue; }
      if (ln.trim() === "") { closeList(); continue; }
      closeList();
      html += '<div class="md-p">' + mdInline(ln) + "</div>";
    }
    closeList();
    return html;
  }
  function renderKv(obj) {
    var keys = Object.keys(obj);
    if (!keys.length) return '<span class="dim">{}</span>';
    return '<div class="kv">' + keys.map(function (k) {
      var v = obj[k], vs;
      if (v === null || v === undefined) vs = '<span class="dim">null</span>';
      else if (typeof v === "object") vs = '<pre class="mini">' + esc(fmt(v)) + "</pre>";
      else vs = esc(String(v));
      return '<div class="kv-row"><span class="kv-k">' + esc(k) + '</span><span class="kv-v">' + vs + "</span></div>";
    }).join("") + "</div>";
  }
  function isMessageArray(v) {
    return Array.isArray(v) && v.length > 0 && v.every(function (m) { return m && typeof m === "object" && typeof m.role === "string"; });
  }
  function renderContent(c) {
    if (c == null) return '<span class="dim">—</span>';
    if (typeof c === "string") return mdToHtml(c);
    if (Array.isArray(c)) return c.map(renderPart).join("");
    if (typeof c === "object") return renderKv(c);
    return esc(String(c));
  }
  function renderPart(p) {
    if (p == null) return "";
    if (typeof p === "string") return mdToHtml(p);
    if (p.type === "text" && typeof p.text === "string") return mdToHtml(p.text);
    return '<div class="part"><div class="part-label">' + esc(p.type || "part") + "</div>" + renderKv(p) + "</div>";
  }
  function previewText(c) {
    if (c == null) return "";
    if (typeof c === "string") return c.replace(/\\s+/g, " ").slice(0, 70);
    if (Array.isArray(c)) {
      for (var i = 0; i < c.length; i++) {
        var p = c[i];
        if (typeof p === "string") return p.slice(0, 70);
        if (p && p.type === "text" && p.text) return String(p.text).slice(0, 70);
      }
      return "";
    }
    try { return JSON.stringify(c).slice(0, 70); } catch (e) { return ""; }
  }
  function renderMsg(m) {
    var role = m.role || "msg";
    var body = (m.content !== undefined) ? renderContent(m.content) : renderKv(m);
    return '<div class="msg"><div class="msg-role role-' + esc(role) + '">' + esc(role) + '</div><div class="msg-content">' + body + "</div></div>";
  }
  function renderMessages(arr) {
    var inner = '<div class="messages">' + arr.map(renderMsg).join("") + "</div>";
    // Short threads render inline; a long history (10-15+ messages) collapses
    // behind a <details> so it doesn't blow up the detail pane — the summary
    // shows the count + a preview of the latest message; click to expand.
    if (arr.length <= 6) return inner;
    var last = arr[arr.length - 1] || {};
    var preview = (last.role ? last.role + ": " : "") + previewText(last.content);
    return '<details class="msg-collapse"><summary><span class="msg-count">' + arr.length
      + ' messages</span> <span class="dim">' + esc(preview) + "</span></summary>" + inner + "</details>";
  }
  function smartValue(v) {
    if (v === null || v === undefined) return '<span class="dim">—</span>';
    if (typeof v === "string") {
      var t = v.trim();
      if (t.charAt(0) === "{" || t.charAt(0) === "[") { try { return smartValue(JSON.parse(t)); } catch (e) {} }
      return mdToHtml(v);
    }
    if (isMessageArray(v)) return renderMessages(v);
    if (Array.isArray(v)) {
      return '<div class="kv">' + v.map(function (item, i) {
        var vs = (item && typeof item === "object") ? renderKv(item) : esc(String(item));
        return '<div class="kv-row"><span class="kv-k">' + i + '</span><span class="kv-v">' + vs + "</span></div>";
      }).join("") + "</div>";
    }
    if (typeof v === "object") return renderKv(v);
    return esc(String(v));
  }

  function renderStats(a) {
    var cost = a.cost ? (((a.cost.input || 0) + (a.cost.output || 0) + (a.cost.cachedInput || 0) + (a.cost.cacheWrite || 0) + (a.cost.cachedOutput || 0) + (a.cost.reasoning || 0)).toFixed(4)) : "—";
    var u = a.usage || {};
    var cells = [
      ["traces", num(a.traces), null],
      ["completed", num(a.completed), null],
      ["failed", num(a.failed), null],
      ["cancelled", num(a.cancelled), null],
      ["&#8595; tokens in", num(u.input), "var(--tok-in)"],
      ["&#8593; tokens out", num(u.output), "var(--tok-out)"],
      ["tokens total", num(u.total), "var(--tok-total)"],
      ["cost (usd)", cost, null]
    ];
    document.getElementById("stats").innerHTML = cells.map(function (c) {
      var st = c[2] ? ' style="color:' + c[2] + '"' : "";
      return '<div class="stat"><div class="label"' + st + ">" + c[0] + '</div><div class="value"' + st + ">" + esc(c[1]) + "</div></div>";
    }).join("");
  }

  // Per-row heat accent: tint the left edge by the trace's own cost
  // relative to the most expensive trace currently in the (filtered) list.
  function heatStyle(intensity) {
    if (intensity <= 0) return "";
    var op = (0.12 + intensity * 0.88).toFixed(3);
    return ' style="--heat-op:' + op + '"';
  }
  function heatBar(intensity) {
    if (intensity <= 0) return "";
    var op = (0.12 + intensity * 0.88).toFixed(3);
    return '<span class="heat" style="opacity:' + op + '" title="relative cost"></span>';
  }
  function renderRow(t, maxTraceCost) {
    var sel = t.traceId === state.selectedId ? " selected" : "";
    var intensity = heatIntensity(traceCost(t), maxTraceCost);
    var pk = tracePromptKey(t);
    return '<div class="trace-row' + sel + '" data-id="' + esc(t.traceId) + '">'
      + heatBar(intensity)
      + typeLabel(t.root.type)
      + '<span class="badge ' + statusClass(t.root.status) + '">' + esc(statusText(t.root.status)) + "</span>"
      + '<span class="rname">' + esc(t.root.name) + "</span>"
      + (pk ? '<span class="rprompt" title="prompt version">' + esc(pk) + "</span>" : "")
      + (t.sessionId ? '<span class="dim">' + esc(t.sessionId) + "</span>" : "")
      + '<span class="rright">' + tokens(t.usage) + '<span class="dim">· ' + dur(t.duration) + "</span></span>"
      + '<i class="chev">›</i>'
      + "</div>";
  }
  function maxTraceCostOf(list) {
    var max = 0;
    for (var i = 0; i < list.length; i++) { var c = traceCost(list[i]); if (c > max) max = c; }
    return max;
  }
  // Render grouped buckets. "groups" is the normalized list each group-by
  // dimension produces — a groupKey + its traces. Shared by session, prompt,
  // and type. Optional "labelFn" maps the raw groupKey to a display label and
  // switches the header to the compact "Label (N)" form (used by type, whose
  // keys are friendly enums); session/prompt omit it and keep their raw id
  // plus the right-aligned "N trace(s)" count. data-group stays the RAW key
  // so collapse state keys consistently regardless of the display label.
  function renderGroups(groups, maxTraceCost, labelFn) {
    return groups.map(function (g) {
      var collapsed = !!state.collapsedGroups[g.groupKey];
      var idAndCount = labelFn
        ? '<span class="sgroup-id">' + esc(labelFn(g.groupKey)) + " (" + g.traces.length + ")</span>"
        : '<span class="sgroup-id">' + esc(g.groupKey) + "</span>"
          + '<span class="sgroup-count">' + g.traces.length + " trace(s)</span>";
      var head = '<div class="sgroup-head" data-group="' + esc(g.groupKey) + '">'
        + '<span class="sgroup-tw">' + (collapsed ? "▸" : "▾") + "</span>"
        + idAndCount + "</div>";
      var body = collapsed ? "" : '<div class="sgroup-body">'
        + g.traces.map(function (t) { return renderRow(t, maxTraceCost); }).join("") + "</div>";
      return '<div class="sgroup">' + head + body + "</div>";
    }).join("");
  }
  // Normalize a session group ({sessionId,…}) to the shared {groupKey,…} shape.
  function sessionGroups(list) {
    return groupBySession(list).map(function (g) { return { groupKey: g.sessionId, traces: g.traces }; });
  }
  function renderList() {
    var list = filteredTraces();
    // Keep the per-type stats panel in sync — runs on every poll + filter
    // change, before the empty-state early return below.
    renderStatsPanel();
    var host = document.getElementById("traces");
    if (!list.length) {
      host.innerHTML = state.traces.length
        ? '<div class="empty">No traces match the current filters.</div>'
        : '<div class="empty">No traces yet. Run an observed flow and they will appear here.</div>';
      return;
    }
    var maxTraceCost = maxTraceCostOf(list);
    // One grouping dimension renders at a time. The toggles are kept mutually
    // exclusive in their change handlers, so this precedence chain (most
    // specific → coarsest: prompt → session → type) only ever matches one.
    var html;
    if (state.groupByPrompt) html = renderGroups(groupByPrompt(list), maxTraceCost);
    else if (state.groupBySession) html = renderGroups(sessionGroups(list), maxTraceCost);
    else if (state.groupByType) html = renderGroups(typeGroups(list), maxTraceCost, typeText);
    else html = list.map(function (t) { return renderRow(t, maxTraceCost); }).join("");
    host.innerHTML = html;
    document.getElementById("meta").textContent = list.length + " of " + state.traces.length + " trace(s) · live";
  }

  // --- Filter UI rendering ---------------------------------------------
  function renderChips() {
    var f = state.filter;
    document.getElementById("status-chips").innerHTML =
      '<span class="chip-group"><span class="gl">status</span>'
      + STATUS_FILTERS.map(function (s) {
        return '<button type="button" class="chip' + (f.statuses[s] ? " active" : "") + '" data-status="' + esc(s) + '">' + esc(statusText(s)) + "</button>";
      }).join("")
      + '<button type="button" class="chip' + (f.errorsOnly ? " active" : "") + '" data-errors="1" title="Show only failed / cancelled traces">Errors only</button>'
      + "</span>";
    var types = presentTypes();
    document.getElementById("type-chips").innerHTML = types.length
      ? '<span class="chip-group"><span class="gl">type</span>'
        + types.map(function (ty) {
          return '<button type="button" class="chip' + (f.types[ty] ? " active" : "") + '" data-type="' + esc(ty) + '">' + esc(typeText(ty)) + "</button>";
        }).join("") + "</span>"
      : "";
    var sessions = presentSessions();
    document.getElementById("session-chips").innerHTML = sessions.length
      ? '<span class="chip-group"><span class="gl">session</span>'
        + sessions.map(function (s) {
          return '<button type="button" class="chip' + (f.sessionId === s ? " active" : "") + '" data-session="' + esc(s) + '">' + esc(s) + "</button>";
        }).join("") + "</span>"
      : "";
    // Prompt-version filter chips — one per distinct name@version seen.
    // Hidden entirely until a named-prompt run shows up, so the toolbar stays
    // clean for projects that don't use the ai.prompts registry.
    var prompts = presentPrompts();
    document.getElementById("prompt-chips").innerHTML = prompts.length
      ? '<span class="chip-group"><span class="gl">prompt</span>'
        + prompts.map(function (p) {
          return '<button type="button" class="chip' + (f.promptKey === p ? " active" : "") + '" data-prompt="' + esc(p) + '">' + esc(p) + "</button>";
        }).join("") + "</span>"
      : "";
  }

  // Heatmap denominator for the currently rendered trace tree. Set by
  // renderDrawer before each renderTree pass so node accents are scaled
  // against the most expensive node in this trace.
  var currentTreeMax = 0;
  function renderTree(span) {
    var hasKids = span.children && span.children.length;
    var collapsed = !!state.collapsed[span.spanId];
    var sel = span.spanId === state.selectedSpanId ? " selected" : "";
    var tw = hasKids ? (collapsed ? "▸" : "▾") : "·";
    var node = '<div class="tnode' + sel + '" data-span="' + esc(span.spanId) + '">'
      + heatBar(heatIntensity(rollupCost(span), currentTreeMax))
      + '<span class="twisty"' + (hasKids ? ' data-toggle="' + esc(span.spanId) + '"' : "") + ">" + tw + "</span>"
      + typeLabel(span.type)
      + '<span class="tname">' + esc(span.name) + "</span>"
      + statusDot(span.status)
      + '<span class="tmeta">' + dur(span.duration) + "</span>"
      + "</div>";
    var kids = (hasKids && !collapsed) ? '<div class="tkids">' + span.children.map(renderTree).join("") + "</div>" : "";
    return node + kids;
  }

  // --- Timeline / waterfall (Gantt) ------------------------------------
  // Flatten the span tree to a depth-first ordered list, each entry
  // carrying its offset (ms from root start) + duration, so we can lay
  // out concurrency without re-walking. parseTs tolerates a missing/bad
  // startedAt by falling back to 0 so a bad clock never NaNs the bars.
  function parseTs(s) { var n = Date.parse(s); return isNaN(n) ? 0 : n; }
  // Render an ISO timestamp for the detail drawer as a readable, locale-
  // unambiguous local time — "28 Jun 2026 03:16 PM" (named month so there is
  // no M/D vs D/M confusion; minute precision). Falls back to the raw string
  // on a bad clock.
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtTs(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var h = d.getHours();
    var ampm = h >= 12 ? "PM" : "AM";
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear()
      + " " + pad2(h12) + ":" + pad2(d.getMinutes()) + " " + ampm;
  }
  function flattenSpans(root) {
    var base = parseTs(root.startedAt);
    var rows = [];
    (function walk(span, depth) {
      var start = parseTs(span.startedAt) - base;
      if (start < 0) start = 0;
      var d = (span.duration != null) ? span.duration : 0;
      rows.push({ span: span, depth: depth, offset: start, duration: d, end: start + d });
      (span.children || []).forEach(function (c) { walk(c, depth + 1); });
    })(root, 0);
    return rows;
  }
  // Critical path: from the root, repeatedly step into the child whose
  // end time is latest (the one that pushed the parent's finish). Marks
  // the spans that determine total wall-clock time.
  function criticalPath(root) {
    var crit = {};
    (function walk(span) {
      crit[span.spanId] = 1;
      var kids = span.children || [];
      if (!kids.length) return;
      var pick = null, pe = -1;
      for (var i = 0; i < kids.length; i++) {
        var e = parseTs(kids[i].startedAt) + ((kids[i].duration != null) ? kids[i].duration : 0);
        if (e > pe) { pe = e; pick = kids[i]; }
      }
      if (pick) walk(pick);
    })(root);
    return crit;
  }
  function renderGantt(root) {
    var rows = flattenSpans(root);
    var span0 = rows.length ? rows[0] : null;
    var total = 0;
    rows.forEach(function (r) { if (r.end > total) total = r.end; });
    if (total <= 0) total = (span0 && span0.duration) || 1;
    var crit = criticalPath(root);
    var body = rows.map(function (r) {
      var leftPct = (r.offset / total) * 100;
      var widthPct = Math.max((r.duration / total) * 100, 0.6);
      var sel = r.span.spanId === state.selectedSpanId ? " selected" : "";
      var isCrit = crit[r.span.spanId] ? " crit" : "";
      var barClass = "gbar bar-" + statusClass(r.span.status) + (isCrit ? " crit" : "");
      var pad = "padding-left:" + (r.depth * 10) + "px";
      return '<div class="grow' + sel + '" data-span="' + esc(r.span.spanId) + '">'
        + '<span class="glabel" style="' + pad + '" title="' + esc(r.span.name) + '">' + esc(r.span.name) + "</span>"
        + '<span class="gtrack"><span class="' + barClass + '" style="left:' + leftPct.toFixed(2) + "%;width:" + widthPct.toFixed(2) + '%"></span></span>'
        + '<span class="gdur">' + dur(r.duration) + "</span>"
        + "</div>";
    }).join("");
    var legend = '<div class="gantt-legend">'
      + '<span class="ck"><span class="sw" style="background:var(--fail)"></span> critical path</span>'
      + '<span class="ck"><span class="sw" style="background:var(--ty-agent)"></span> span (offset + duration)</span>'
      + "</div>";
    return '<div class="gantt">' + (body || '<div class="dim">No spans.</div>') + legend + "</div>";
  }

  // The name@version of the named prompt this span's run resolved, read
  // from the collector's prompt-version-linkage attributes. Returns null when
  // the run carried no named prompt. Mirrors tracePromptKey in trace-filter.ts.
  function spanPromptKey(span) {
    var a = span && span.attributes;
    if (!a || typeof a !== "object") return null;
    var name = a["agent.promptName"];
    if (typeof name !== "string" || !name.length) return null;
    var ver = a["agent.promptVersion"];
    var vl = (typeof ver === "string" && ver.length) ? ver : "1";
    return name + "@" + vl;
  }
  function tracePromptKey(t) { return spanPromptKey(t.root); }

  // Humanize a metadata key for display: split dot.notation + camelCase,
  // Title-case each word, upcase "id". e.g. "supervisor.terminatedBy" →
  // "Supervisor Terminated By", "span id" → "Span ID", "agent.trips" →
  // "Agent Trips". Underlying attribute keys are untouched.
  // NB: this whole script is a template literal — regex backslash classes
  // MUST be double-escaped (\\s) so the rendered script retains its backslash.
  function humanizeKey(key) {
    return String(key).split(/[.\\s]+/).map(function (seg) {
      return seg.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\\s+/).map(function (w) {
        if (!w) return w;
        if (w.toLowerCase() === "id") return "ID";
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(" ");
    }).join(" ");
  }

  function renderMeta(span, trace) {
    var rows = [];
    // Absolute wall-clock span — the head shows only the elapsed duration, so
    // surface when this node actually started/ended for log correlation.
    rows.push(["started", fmtTs(span.startedAt)]);
    rows.push(["ended", fmtTs(span.endedAt)]);
    var sid = span.sessionId || trace.sessionId;
    if (sid) rows.push(["session", sid]);
    // Prompt-version linkage: surface the resolved named prompt as one clean
    // name@version row right under session, so the panel reads it as a
    // first-class dimension rather than two raw attribute keys.
    var pk = spanPromptKey(span);
    if (pk) rows.push(["prompt", pk]);
    if (span.version) rows.push(["version", span.version]);
    rows.push(["span id", span.spanId]);
    if (span.parentSpanId) rows.push(["parent", span.parentSpanId]);
    rows.push(["trace id", span.traceId || trace.traceId]);
    var attrs = span.attributes;
    // Skip the two raw prompt keys — already shown as the clean prompt row.
    if (attrs && typeof attrs === "object") Object.keys(attrs).forEach(function (k) {
      if (k === "agent.promptName" || k === "agent.promptVersion") return;
      rows.push([k, attrs[k]]);
    });
    var kv = rows.map(function (r) {
      var v = r[1];
      var vs = (v && typeof v === "object") ? '<pre class="mini">' + esc(fmt(v)) + "</pre>" : esc(String(v));
      return '<div class="kv-row"><span class="kv-k">' + esc(humanizeKey(r[0])) + '</span><span class="kv-v">' + vs + "</span></div>";
    }).join("");
    return '<div class="meta-sec"><div class="meta-title">metadata</div><div class="kv">' + kv + "</div></div>";
  }

  // --- Evaluate: grade a span's last captured system prompt -------------
  // Config-gated (EVALUATE_ENABLED) — the drawer's only write action, POSTing
  // to a route that itself only exists when the server was configured with
  // evaluate. UI state lives in state.evaluate, keyed by spanId, so it
  // survives a re-render (e.g. switching to a sibling span and back).
  function extractLastSystemPrompt(span) {
    if (!Array.isArray(span.input)) return null;
    for (var i = span.input.length - 1; i >= 0; i--) {
      var m = span.input[i];
      if (m && typeof m === "object" && m.role === "system" && typeof m.content === "string") return m.content;
    }
    return null;
  }
  function evalState(spanId) {
    return state.evaluate[spanId] || (state.evaluate[spanId] = {
      open: false, instructions: EVALUATE_DEFAULT_INSTRUCTIONS, status: "idle", result: null, error: null
    });
  }
  function evalResultHtml(result) {
    var score = typeof result.score === "number" ? Math.round(result.score * 100) + "%" : "n/a";
    var issues = (result.issues || []).map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("");
    return '<div class="eval-result"><span class="eval-score">Score: ' + score + "</span>"
      + (issues ? '<ul class="eval-issues">' + issues + "</ul>" : "") + "</div>";
  }
  function evalSectionHtml(span) {
    if (!EVALUATE_ENABLED) return "";
    var sysPrompt = extractLastSystemPrompt(span);
    if (!sysPrompt) return "";
    var st = evalState(span.spanId);
    var btn = '<button type="button" class="eval-btn" data-evaluate-toggle="' + esc(span.spanId) + '">'
      + (st.open ? "Hide evaluate" : "Evaluate system prompt") + "</button>";
    if (!st.open) return btn;
    var running = st.status === "running";
    return btn + '<div class="eval-panel">'
      + '<textarea id="eval-instructions" placeholder="Grading instructions (optional — falls back to the configured default)"' + (running ? " disabled" : "") + ">" + esc(st.instructions || "") + "</textarea>"
      + '<div class="eval-actions">'
      + '<button type="button" class="eval-btn" data-evaluate-run="' + esc(span.spanId) + '"' + (running ? " disabled" : "") + ">" + (running ? "Evaluating…" : "Run") + "</button>"
      + (st.error ? '<span class="eval-error">' + esc(st.error) + "</span>" : "")
      + "</div>"
      + (st.result ? evalResultHtml(st.result) : "")
      + "</div>";
  }
  function rerenderDetail() {
    var t = findTrace(state.selectedId);
    if (!t) return;
    var sel = findSpan(t.root, state.selectedSpanId) || t.root;
    document.getElementById("drawer-detail").innerHTML = renderDetail(sel, t);
  }
  function toggleEvalPanel(spanId) {
    evalState(spanId).open = !evalState(spanId).open;
    rerenderDetail();
  }
  function runEvaluate(traceId, spanId) {
    var st = evalState(spanId);
    var textarea = document.getElementById("eval-instructions");
    if (textarea) st.instructions = textarea.value;
    st.status = "running"; st.error = null;
    rerenderDetail();
    fetchAuthed(API + "/traces/" + encodeURIComponent(traceId) + "/spans/" + encodeURIComponent(spanId) + "/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instructions: st.instructions })
    }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, data: data }; });
    }).then(function (res) {
      if (res.ok) { st.status = "done"; st.result = res.data; st.error = null; }
      else { st.status = "error"; st.error = (res.data && (res.data.message || res.data.error)) || "evaluate failed"; st.result = null; }
      rerenderDetail();
    }).catch(function () {
      st.status = "error"; st.error = "network error"; st.result = null;
      rerenderDetail();
    });
  }

  function renderDetail(span, trace) {
    var path = findPath(trace.root, span.spanId) || [span];
    var crumb = path.map(function (p, i) { return (i ? '<span class="sep"> › </span>' : "") + "<span>" + esc(p.name) + "</span>"; }).join("");
    var io = "";
    if (span.input !== undefined) io += '<div class="piol" style="color:var(--tok-in)">input</div><div class="io-body">' + smartValue(span.input) + "</div>";
    if (span.output !== undefined) io += '<div class="piol" style="color:var(--tok-out)">output</div><div class="io-body">' + smartValue(span.output) + "</div>";
    if (span.error) io += '<div class="piol" style="color:var(--fail)">error</div><div class="io-body">' + smartValue(span.error) + "</div>";

    // Tokens + cost line — omitted entirely when the node has neither
    // (e.g. a free tool with zero usage), so the panel stays uncluttered.
    var tk = tokens(span.usage);
    var c = rollupCost(span);
    var metaLine = (tk || c > 0)
      ? '<div style="margin-bottom:4px">' + tk + (c > 0 ? '<span class="cost">' + (tk ? " · " : "") + money(c) + "</span>" : "") + "</div>"
      : "";

    return '<div class="crumb">' + crumb + "</div>"
      + '<div class="dhead-row">' + typeLabel(span.type) + '<span style="font-weight:600">' + esc(span.name) + "</span>"
      + '<span class="badge ' + statusClass(span.status) + '">' + esc(statusText(span.status)) + "</span>"
      + '<span class="dim">· ' + dur(span.duration) + "</span></div>"
      + metaLine
      + io
      + evalSectionHtml(span, trace)
      + renderMeta(span, trace);
  }

  function headHtml(t) {
    var cost = traceCost(t);
    return typeLabel(t.root.type)
      + '<span class="badge ' + statusClass(t.root.status) + '">' + esc(statusText(t.root.status)) + "</span>"
      + '<span style="font-weight:600">' + esc(t.root.name) + "</span>"
      + '<span class="dim">· ' + dur(t.duration) + "</span>"
      + tokens(t.usage)
      + (cost > 0 ? '<span class="cost">· ' + money(cost) + "</span>" : "")
      + '<button class="drawer-close" type="button" title="Close (Esc)">✕ Close</button>';
  }

  function viewSwitcher() {
    var tree = state.view === "tree" ? " active" : "";
    var tl = state.view === "timeline" ? " active" : "";
    return '<div class="dview" id="drawer-view">'
      + '<button type="button" class="' + tree.trim() + '" data-view="tree">Tree</button>'
      + '<button type="button" class="' + tl.trim() + '" data-view="timeline">Timeline</button>'
      + '<span class="legend" title="Node colour = relative cost"><span>cost</span><span class="grad"></span></span>'
      + "</div>";
  }
  function leftPaneHtml(t) {
    if (state.view === "timeline") return renderGantt(t.root);
    currentTreeMax = maxNodeCost(t.root);
    return renderTree(t.root);
  }
  function renderDrawer(t) {
    document.getElementById("drawer-head").innerHTML = headHtml(t);
    var sel = findSpan(t.root, state.selectedSpanId) || t.root;
    document.getElementById("drawer-body").innerHTML =
      '<div class="dsplit"><div class="dtree" id="drawer-tree">' + viewSwitcher() + leftPaneHtml(t) + "</div>"
      + '<div class="ddetail" id="drawer-detail">' + renderDetail(sel, t) + "</div></div>";
  }
  // Re-render only the left pane (after a view switch) without disturbing
  // the detail panel or scroll position of the detail side.
  function renderLeftPane() {
    var t = findTrace(state.selectedId);
    if (!t) return;
    document.getElementById("drawer-tree").innerHTML = viewSwitcher() + leftPaneHtml(t);
  }

  function selectSpan(id) {
    state.selectedSpanId = id;
    var t = findTrace(state.selectedId);
    if (!t) return;
    document.getElementById("drawer-detail").innerHTML = renderDetail(findSpan(t.root, id) || t.root, t);
    // Highlight in whichever left pane is active (tree nodes or Gantt rows).
    var nodes = document.querySelectorAll(".tnode[data-span], .grow[data-span]");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute("data-span") === id) nodes[i].classList.add("selected");
      else nodes[i].classList.remove("selected");
    }
    writeHash();
  }
  function toggleSpan(id) {
    state.collapsed[id] = !state.collapsed[id];
    var t = findTrace(state.selectedId);
    if (t) renderLeftPane();
  }
  function setView(v) {
    if (state.view === v) return;
    state.view = v;
    renderLeftPane();
  }

  function openTrace(id, spanId) {
    state.selectedId = id;
    var t = findTrace(id);
    if (t) {
      state.selectedSpanId = (spanId && findSpan(t.root, spanId)) ? spanId : t.root.spanId;
      state.collapsed = {};
      renderDrawer(t);
      state.sig = traceSig(t);
    }
    document.getElementById("drawer").classList.add("open");
    document.getElementById("drawer").setAttribute("aria-hidden", "false");
    document.getElementById("backdrop").classList.add("open");
    markSelectedRow();
    writeHash();
  }
  function closeDrawer() {
    state.selectedId = null; state.selectedSpanId = null; state.sig = null;
    document.getElementById("drawer").classList.remove("open");
    document.getElementById("drawer").setAttribute("aria-hidden", "true");
    document.getElementById("backdrop").classList.remove("open");
    markSelectedRow();
    writeHash();
  }

  // --- Deep-links: reflect the open trace + span in the URL hash -------
  // #trace=<id>&span=<id>. Written on open/close/select; read on load and
  // on manual hash edits (back/forward). A guard flag stops writeHash from
  // re-triggering our own hashchange handler in a loop.
  var suppressHash = false;
  function writeHash() {
    var h = "";
    if (state.selectedId) {
      h = "#trace=" + encodeURIComponent(state.selectedId);
      if (state.selectedSpanId && state.selectedSpanId !== state.selectedId) {
        h += "&span=" + encodeURIComponent(state.selectedSpanId);
      }
    }
    suppressHash = true;
    try {
      if (history && history.replaceState) history.replaceState(null, "", h || (location.pathname + location.search));
      else location.hash = h;
    } catch (e) { location.hash = h; }
    suppressHash = false;
  }
  function readHash() {
    var raw = (location.hash || "").replace(/^#/, "");
    var out = { trace: null, span: null };
    raw.split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i === -1) return;
      var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
      if (k === "trace") out.trace = v;
      else if (k === "span") out.span = v;
    });
    return out;
  }
  // Open whatever the hash points at, if that trace is loaded. Returns
  // true when it acted so the caller can mark the one-time load as done.
  function applyHash() {
    var h = readHash();
    if (!h.trace) {
      if (state.selectedId) closeDrawer();
      return true;
    }
    if (!findTrace(h.trace)) return false; // not polled yet — retry next poll
    openTrace(h.trace, h.span || undefined);
    return true;
  }
  function markSelectedRow() {
    var rows = document.querySelectorAll(".trace-row");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-id") === state.selectedId) rows[i].classList.add("selected");
      else rows[i].classList.remove("selected");
    }
  }

  document.getElementById("traces").addEventListener("click", function (e) {
    var head = e.target.closest ? e.target.closest(".sgroup-head") : null;
    if (head) {
      var g = head.getAttribute("data-group");
      state.collapsedGroups[g] = !state.collapsedGroups[g];
      renderList();
      return;
    }
    var row = e.target.closest ? e.target.closest(".trace-row") : null;
    if (row) openTrace(row.getAttribute("data-id"));
  });
  document.getElementById("drawer-head").addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".drawer-close")) closeDrawer();
  });
  document.getElementById("drawer-body").addEventListener("click", function (e) {
    var vb = e.target.closest ? e.target.closest("[data-view]") : null;
    if (vb) { setView(vb.getAttribute("data-view")); return; }
    var tog = e.target.closest ? e.target.closest("[data-toggle]") : null;
    if (tog) { toggleSpan(tog.getAttribute("data-toggle")); return; }
    var evalToggle = e.target.closest ? e.target.closest("[data-evaluate-toggle]") : null;
    if (evalToggle) { toggleEvalPanel(evalToggle.getAttribute("data-evaluate-toggle")); return; }
    var evalRun = e.target.closest ? e.target.closest("[data-evaluate-run]") : null;
    if (evalRun && state.selectedId) { runEvaluate(state.selectedId, evalRun.getAttribute("data-evaluate-run")); return; }
    var node = e.target.closest ? e.target.closest(".tnode[data-span], .grow[data-span]") : null;
    if (node) selectSpan(node.getAttribute("data-span"));
  });
  // Track the instructions textarea live (no re-render on keystroke, so
  // typing never loses focus/cursor position).
  document.getElementById("drawer-body").addEventListener("input", function (e) {
    if (e.target && e.target.id === "eval-instructions" && state.selectedSpanId) {
      evalState(state.selectedSpanId).instructions = e.target.value;
    }
  });
  document.getElementById("backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" || e.keyCode === 27) closeDrawer(); });

  // --- Filter / toolbar wiring -----------------------------------------
  function toggleMapKey(map, key) { if (map[key]) delete map[key]; else map[key] = 1; }
  document.getElementById("status-chips").addEventListener("click", function (e) {
    if (!e.target.closest) return;
    // The "Errors only" shortcut chip lives in the status group now.
    if (e.target.closest("[data-errors]")) {
      state.filter.errorsOnly = !state.filter.errorsOnly;
      renderChips(); renderList();
      return;
    }
    var b = e.target.closest("[data-status]");
    if (!b) return;
    toggleMapKey(state.filter.statuses, b.getAttribute("data-status"));
    renderChips(); renderList();
  });
  document.getElementById("type-chips").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-type]") : null;
    if (!b) return;
    toggleMapKey(state.filter.types, b.getAttribute("data-type"));
    renderChips(); renderList();
  });
  document.getElementById("session-chips").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-session]") : null;
    if (!b) return;
    var s = b.getAttribute("data-session");
    state.filter.sessionId = (state.filter.sessionId === s) ? null : s;
    renderChips(); renderList();
  });
  document.getElementById("prompt-chips").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-prompt]") : null;
    if (!b) return;
    var p = b.getAttribute("data-prompt");
    state.filter.promptKey = (state.filter.promptKey === p) ? null : p;
    renderChips(); renderList();
  });
  document.getElementById("search").addEventListener("input", function (e) {
    state.filter.text = e.target.value || "";
    renderList();
  });
  // One mutually-exclusive grouping dimension, chosen from the Group dropdown.
  // "" = no grouping; renderList's precedence chain only ever matches one.
  // Switching dimensions drops stale collapsed-header keys.
  function setGrouping(dim) {
    state.groupBySession = dim === "session";
    state.groupByPrompt = dim === "prompt";
    state.groupByType = dim === "type";
    state.collapsedGroups = {};
    renderList();
  }
  document.getElementById("group-by").addEventListener("change", function (e) {
    setGrouping(e.target.value);
  });
  document.getElementById("show-stats").addEventListener("change", function (e) {
    state.showStats = !!e.target.checked;
    renderStatsPanel();
  });
  document.getElementById("clear-filters").addEventListener("click", function () {
    state.filter = { text: "", statuses: {}, types: {}, sessionId: null, promptKey: null, errorsOnly: false };
    document.getElementById("search").value = "";
    renderChips(); renderList();
  });

  // Back/forward or a manual hash edit re-syncs the open trace/span.
  window.addEventListener("hashchange", function () {
    if (suppressHash) return;
    applyHash();
  });

  var THEME_KEY = "panoptic-theme";
  var mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  function applyTheme(mode) {
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    var light = mode === "light" || (mode === "system" && mql && mql.matches);
    document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
    var btns = document.querySelectorAll("[data-theme-set]");
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("active", btns[i].getAttribute("data-theme-set") === mode);
  }
  document.getElementById("theme").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-theme-set]") : null;
    if (b) applyTheme(b.getAttribute("data-theme-set"));
  });
  if (mql && mql.addEventListener) mql.addEventListener("change", function () {
    var cur = "system";
    try { cur = localStorage.getItem(THEME_KEY) || "system"; } catch (e) {}
    if (cur === "system") applyTheme("system");
  });
  var savedTheme = "system";
  try { savedTheme = localStorage.getItem(THEME_KEY) || "system"; } catch (e) {}
  applyTheme(savedTheme);

  function poll() {
    Promise.all([
      fetchAuthed(API + "/aggregate").then(function (r) { return r.json(); }),
      fetchAuthed(API + "/traces").then(function (r) { return r.json(); })
    ]).then(function (res) {
      renderStats(res[0]);
      state.traces = res[1] || [];
      document.getElementById("meta").textContent = state.traces.length + " trace(s) · live";
      renderChips();
      renderList();
      // Open whatever the URL hash deep-links to, once the target trace
      // has actually arrived in a poll (it may not be in the first batch).
      if (!state.hashApplied) {
        if (applyHash()) state.hashApplied = true;
      } else if (state.selectedId) {
        var t = findTrace(state.selectedId);
        if (t) { var sig = traceSig(t); if (sig !== state.sig) { renderDrawer(t); state.sig = sig; } }
      }
    }).catch(function (e) {
      document.getElementById("meta").textContent = "disconnected";
    });
  }

  // FOLLOW-UP: a live socket tail (SSE / WebSocket push) is out of scope
  // for this pass; the dashboard stays on the 2s JSON poll below. When
  // added, it should reuse renderList/renderDrawer and keep the poll as a
  // reconnect fallback.
  poll();
  setInterval(poll, 2000);
})();
</script>
</body>
</html>`;
}

/** Escape a string for safe interpolation into static HTML text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Encode free-form text (e.g. `evaluate.instructions`, which an operator
 * could type anything into) as a JS EXPRESSION that reconstructs it at
 * runtime, WITHOUT ever emitting a literal backtick into the served page —
 * the client script is itself built from a TS template literal, so a raw
 * backtick in the output would be a real syntax hazard (see the `BT =
 * String.fromCharCode(96)` construction already in the client script for
 * the same reason). `JSON.stringify` alone doesn't escape backticks (they
 * aren't JSON-significant), so a value containing one is split around it
 * and rejoined with the client's own `BT` constant. No backticks in the
 * input ⇒ a single plain `JSON.stringify(value)` — no unnecessary
 * concatenation in the common case.
 */
function encodeForInlineScript(value: string): string {
  return value
    .split("`")
    .map((part) => JSON.stringify(part))
    .join(" + BT + ");
}
