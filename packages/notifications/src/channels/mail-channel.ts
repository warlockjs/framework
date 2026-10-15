/**
 * `mailChannel` — wraps `@warlock.js/core` `sendMail`.
 *
 * Route is `notifiable.email` by convention; override via `config.route`
 * when the column is named differently or computed.
 *
 * The renderer's payload is forwarded verbatim (`subject`, `html`, `text`,
 * `cc`). `from` is set once at channel-config time; per-send overrides go
 * through the payload itself (you can include `from` in `MailPayload` if
 * you extend the registry — but the convention is one channel = one
 * sender identity).
 *
 * @example
 *   // src/config/notifications.ts
 *   channels: {
 *     mail: mailChannel({ from: "no-reply@store.com" }),
 *   }
 *
 *   // anywhere
 *   await notify.mail(user, { subject: "Welcome", html: "<p>Hi!</p>" });
 */
import { sendMail } from "@warlock.js/core";
import type { Channel } from "../contracts";
import { defineChannel } from "../dispatch/define-channel";
import type { MailPayload, Notifiable } from "../types";

export type MailChannelConfig = {
  /** Default `from` address for every send through this channel. */
  from?: string;
  /** Route resolver. Defaults to `notifiable.get("email")`. */
  route?: (notifiable: Notifiable) => string;
};

export function mailChannel(config: MailChannelConfig = {}): Channel<MailPayload> {
  const resolveRoute = config.route ?? ((n) => n.get("email") as string);

  return defineChannel<MailPayload>({
    name: "mail",
    route: (notifiable) => resolveRoute(notifiable),
    async send({ payload, route }) {
      await sendMail({
        to: route as string,
        from: config.from,
        ...payload,
      });
    },
  });
}
