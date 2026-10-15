import type { Channel } from "../contracts";

/**
 * Identity helper that narrows the channel type to its payload. Use it when
 * you want TypeScript to enforce the `send` payload shape against the
 * payload type you declared.
 *
 * Built-in channels (`mail`, `database`) ship as factories; custom channels
 * are usually defined with this helper.
 *
 * @example
 *   import { defineChannel } from "@warlock.js/notifications";
 *
 *   type DiscordPayload = { content: string };
 *
 *   export const discordChannel = () =>
 *     defineChannel<DiscordPayload>({
 *       name: "discord",
 *       route: (n) => n.get("discord_webhook"),
 *       async send({ payload, route }) {
 *         await fetch(route as string, {
 *           method: "POST",
 *           headers: { "content-type": "application/json" },
 *           body: JSON.stringify(payload),
 *         });
 *       },
 *     });
 *
 *   // Then teach the registry:
 *   declare module "@warlock.js/notifications" {
 *     interface NotificationChannels { discord: DiscordPayload }
 *   }
 */
export function defineChannel<P>(channel: Channel<P>): Channel<P> {
  return channel;
}
