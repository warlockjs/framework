// Channel factories shipped in Phase 1.
//
// Bridges-backed channels (whatsapp, telegram, push, slack) ship in Phase 2
// as additional factories that extend the `NotificationChannels` registry
// via `declare module`.

export * from "./database-channel";
export * from "./mail-channel";
