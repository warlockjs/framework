import { herald } from "./utils/connect-to-broker";

/**
 * Minimal mirror of `@warlock.js/core`'s `UseCaseBroadcastEvent`.
 *
 * Kept local on purpose: this adapter is **structurally typed** so `@warlock.js/herald`
 * takes no dependency on `@warlock.js/core`. The shape only needs the fields the
 * adapter reads (`event` for the channel, `payload` for the body).
 */
export type UseCaseBroadcastEvent = {
  useCase: string;
  event: string;
  id: string;
  at: Date;
  payload: unknown;
};

/**
 * Channel adapter that publishes use-case broadcast events onto a herald broker.
 *
 * Register it in the use-cases config so successful use cases fan out to the bus:
 *
 * @example
 * // src/config/use-cases.ts
 * import { heraldBroadcast } from "@warlock.js/herald";
 *
 * export default {
 *   broadcast: {
 *     enabled: true,
 *     channels: [heraldBroadcast({ broker: "default" })],
 *   },
 * } satisfies UseCaseConfigurations;
 *
 * @param options - Optional broker name (defaults to the default broker)
 */
export function heraldBroadcast(options?: { broker?: string }) {
  return {
    async broadcast(event: UseCaseBroadcastEvent): Promise<void> {
      await herald(options?.broker).channel(event.event).publish(event.payload);
    },
  };
}
