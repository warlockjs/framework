import { storageConfigurations, uploadsPath, type StorageConfigurations } from "@warlock.js/core";

// The storage connector starts in the early phase and fails the boot outright
// when its default driver has no configuration, so even an app that stores
// nothing needs this. Local only — the acceptance run must not depend on a
// network or on credentials.
const storageOptions: StorageConfigurations = {
  default: "local",
  drivers: {
    local: storageConfigurations.local({
      root: uploadsPath(),
      urlPrefix: "/uploads",
    }),
  },
};

export default storageOptions;
