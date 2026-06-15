# @warlock.js/notifications — skills

All cross-references use the form `@warlock.js/notifications/<skill>/SKILL.md`.

Skills are added as the package's public surface lands. Phase 0 (core dispatch) ships:

- (incoming) `notifications-basics/` — what the package is, when to reach for it, the mental model.
- (incoming) `define-notification/` — reusable multi-channel definitions; `via`, renderers, `(data, to, ctx)`.
- (incoming) `send-ad-hoc/` — `notify.<channel>` proxy + `notify.channel(name)` runtime form.
- (incoming) `configure-notifications/` — `config/notifications.ts`, `NotificationConfig`, `SendOptions`.
- (incoming) `define-channel/` — custom channels via `defineChannel` + `declare module`.
- (incoming) `use-in-app/` — `inApp.configure({model})`, `listUnread` / `markAsRead` / `markAsUnread`.
- (incoming) `write-notification-migration/` — `notificationColumns(Notification)`, named from the model's `columnMap`.
- (incoming) `observe-notifications/` — `notifications.on("sending" | "sent" | "failed" | "skipped", …)`.
- `queue-notifications/` — async `.queue()` via the herald-backed dispatcher + worker.
- (deferred — Phase 2, bridges) `gate-with-preferences/` — already covered in `configure-notifications`; promote if it grows.
- (deferred — Phase 2, bridges) `send-via-whatsapp/`, `send-via-telegram/`, `send-via-push/`, `send-via-slack/`.

Regenerate the LLM index after any change:

```bash
node scripts/generate-llms.mjs
```
