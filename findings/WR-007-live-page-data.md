# WR-007: live page data — push page-cache invalidation to open pages (recommended for 5.33)

Date: 2026-10-19 · Packages: @warlock.js/web, @warlock.js/core (socket connector) · From: Bureau

**Today:** `invalidatePageCache(tags)` is server-side only, and cross-process pub/sub is "out of scope for this release".
Bureau polls instead (staff activity every 3 s, room unread counts, the task board, Game rewards). Those polls raced
writers (an unread poll returned 503 during a write) and fought navigation (a Game reward refresh pulled the owner back
to the previous page after a click).

**Request:** when a server invalidates tags, connected clients learn about it over the existing socket.io connector,
and open pages whose loaders declared those tags re-run them (`loader.tags` / `usePageData({ live: true })`).
- Never refresh during a pending navigation.
- Pause while a form has unsent input.
- Fall back to a polling interval when no socket is available.

Bureau would delete its pollers.
