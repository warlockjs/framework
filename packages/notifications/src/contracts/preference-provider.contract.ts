import type { ChannelName, Notifiable } from "../types";

/**
 * Pre-send gate consulted BEFORE each channel dispatch. Returns the subset of
 * `requested` channels this recipient accepts (mute lists, quiet hours,
 * per-type opt-ins, …).
 *
 * - Bypassed when `SendOptions.force === true`.
 * - Dropped channels fire a `skipped` event with reason `"preference"`.
 *
 * App-owned (passed to `setNotificationConfig({ preferences })`). The package
 * reserves the slot but ships no default implementation.
 */
export interface PreferenceProvider {
  resolveChannels(
    notifiable: Notifiable,
    type: string,
    requestedChannels: ChannelName[],
  ): Promise<ChannelName[]> | ChannelName[];
}
