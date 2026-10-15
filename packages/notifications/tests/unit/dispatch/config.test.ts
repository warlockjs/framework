import { afterEach, describe, expect, it } from "vitest";
import {
  getNotificationConfig,
  NotificationsNotConfiguredError,
  resetNotificationConfig,
  setNotificationConfig,
} from "../../../src";

describe("notification config", () => {
  afterEach(() => {
    resetNotificationConfig();
  });

  it("`getNotificationConfig` throws when unset", () => {
    expect(() => getNotificationConfig()).toThrow(NotificationsNotConfiguredError);
  });

  it("`setNotificationConfig` makes the config readable", () => {
    setNotificationConfig({ channels: {} });
    expect(getNotificationConfig()).toEqual({ channels: {} });
  });

  it("`setNotificationConfig` REPLACES rather than merges", () => {
    setNotificationConfig({
      channels: {},
      preferences: { resolveChannels: () => [] },
    });

    setNotificationConfig({ channels: {} });

    expect(getNotificationConfig().preferences).toBeUndefined();
  });

  it("`resetNotificationConfig` returns to the unconfigured state", () => {
    setNotificationConfig({ channels: {} });
    resetNotificationConfig();
    expect(() => getNotificationConfig()).toThrow(NotificationsNotConfiguredError);
  });
});
