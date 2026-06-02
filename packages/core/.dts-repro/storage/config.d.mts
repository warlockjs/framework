import { CloudStorageDriverOptions, LocalStorageDriverOptions, R2StorageDriverOptions, StorageConfigurations, StorageDriverConfig } from "./types.mjs";
import { S3ClientConfig } from "@aws-sdk/client-s3";

//#region ../../@warlock.js/core/src/storage/config.d.ts
/**
 * Get storage configuration
 */
declare function storageConfig(): StorageConfigurations;
declare function storageConfig<T = any>(key: string): T;
declare function storageConfig<T = any>(key: string, defaultValue: T): T;
declare const storageConfigurations: {
  local: (options: LocalStorageDriverOptions) => StorageDriverConfig;
  aws: (options: CloudStorageDriverOptions & S3ClientConfig) => StorageDriverConfig;
  r2: (options: R2StorageDriverOptions & S3ClientConfig) => StorageDriverConfig;
  spaces: (options: CloudStorageDriverOptions & S3ClientConfig) => StorageDriverConfig;
};
//#endregion
export { storageConfig, storageConfigurations };
//# sourceMappingURL=config.d.mts.map