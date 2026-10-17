# WR-051 — `FileLog`: configurable daily file names and built-in retention

- **Package:** `@warlock.js/logger` 5.30.0 (`FileLog`)
- **Classification:** feature request
- **Found:** 2026-10-17, while adding daily log files to a desktop/server app.

## Observed

- `chunk: "daily"` hard-codes the file name as `DD-MM-YYYY`. It is not configurable, doesn't sort by name, and
  `rotateFileName` is ignored for daily chunks.
- Size rotation writes `<fileName>-<rotateFileName>-<Date.now()>`, and the default `rotateFileName` is a getter.
- There is no retention, so apps write their own pruning (max age or max files).

## Request

- `fileName: (date) => string`, or a pattern such as `"bureau-{YYYY}-{MM}-{DD}"` for daily chunks, defaulting to a
  sortable ISO date.
- `retention: { maxFiles?, maxAgeDays? }`, pruned on boot and on rotation.

## App workaround

The app subclasses `FileLog`, overrides the `fileName` getter with `chunk: "single"`, and prunes `bureau-*.log` older
than 14 days at boot.
