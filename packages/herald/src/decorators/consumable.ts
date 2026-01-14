import { communicatorRegistry } from "../communicators";
import { type EventConsumerClass } from "../message-managers/types";

export type ConsumableOptions = {
  communicator?: string;
};

export const pendingSubscribers = new Set<{
  Consumer: EventConsumerClass;
  options?: ConsumableOptions;
}>();

/**
 * Register the consumer to the communicator
 */
export function Consumable(options?: ConsumableOptions) {
  return function (target: EventConsumerClass) {
    const communicatorDriver = options?.communicator;

    try {
      const currentCommunicator = communicatorRegistry.get(communicatorDriver);

      // if communicator is connected, subscribe the consumer
      if (currentCommunicator?.isConnected) {
        currentCommunicator.subscribe(target);
      } else {
        pendingSubscribers.add({ Consumer: target, options });
      }
    } catch {
      // mostly it will be an error that communicator is not registered yet
      // then add it to the pending subscribers
      pendingSubscribers.add({ Consumer: target, options });
    }
  };
}

// Register pending consumers on communicator's connection is done
communicatorRegistry.on("connected", (communicator) => {
  for (const { Consumer, options } of pendingSubscribers) {
    if (options?.communicator && communicator.name !== options.communicator) {
      continue;
    }

    communicator.subscribe(Consumer);
  }
});
