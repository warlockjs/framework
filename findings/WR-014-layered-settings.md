# WR-014: layered settings with read-time defaults (later)

Date: 2026-10-19 · Package: @warlock.js/core (or a small new package) · From: Bureau B15

**Request:** settings scopes (for example global, then workspace, then member) resolved at read time from typed
defaults.
- Only the owner's overrides are stored.
- Settings added in later releases default on.
- Per-key reset to default.
- Each value reports its source (default / global / workspace) for the UI.
- Revisioned compare-and-swap writes.

Bureau B15 built exactly this by hand.
