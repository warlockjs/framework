import { FileCacheDriver, MemoryCacheDriver } from "@warlock.js/cache";

export default {
  default: "file",
  silenceSingleServerWarning: true,
  drivers: { file: FileCacheDriver, memory: MemoryCacheDriver },
  options: {
    file: { directory: () => "storage/cache" },
    memory: { ttl: 60 },
  },
};
