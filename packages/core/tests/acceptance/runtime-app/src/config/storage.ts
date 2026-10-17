import { storageConfigurations, uploadsPath, type StorageConfigurations } from "@warlock.js/core";

// Local disk only: the acceptance run needs no network and no credentials.
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
