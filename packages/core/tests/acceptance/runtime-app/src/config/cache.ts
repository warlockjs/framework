import { FileCacheDriver, MemoryCacheDriver, type CacheConfigurations } from "@warlock.js/cache";
import { cachePath } from "@warlock.js/core";

// The file driver, so a request exercises the runtime's fs layer, not just memory.
const cacheConfigurations: CacheConfigurations = {
  default: "file",
  drivers: {
    file: FileCacheDriver,
    memory: MemoryCacheDriver,
  },
  options: {
    file: { directory: () => cachePath("runtime-acceptance") },
    memory: { ttl: 60 },
  },
};

export default cacheConfigurations;
