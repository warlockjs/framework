// Dispatch surface — public exports for the package barrel.
//
// Internal helpers (`dispatcher.ts`'s `dispatchChannel`, the `emit` function)
// are deliberately NOT re-exported — channels + tests can import them from
// the relative paths if needed, but they're not package API.

export * from "./define-channel";
export * from "./define-notification";
export * from "./notify";
export { notifications } from "./notifications-event-bus";
