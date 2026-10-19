# WR-012: browser end-to-end harness — warlock e2e (target 5.34)

Date: 2026-10-19 · Packages: @warlock.js/core (CLI), @warlock.js/web · From: Bureau

**Today:** `web` covers loader, action and render tests in Vitest. Bureau wrote more than 20 Chrome DevTools scripts
by hand, each with the same scaffolding:
- an owned production fixture in a disposable data root;
- fake engines on PATH;
- screenshots at 1280 and 390 px;
- viewport and overflow checks;
- zero-console-error and zero-HTTP-failure checks;
- cleanup that verifies the PID before stopping.

Workers repeatedly fixed the same harness bugs: click races, a phone page that silently grew to 448 px, and cleanup.

**Request:** `warlock e2e` with an owned app fixture, Chrome or Edge over CDP (no Playwright dependency), a stable
hit-tested click, viewport assertions, evidence JSON and screenshots, and PID-verified teardown.
