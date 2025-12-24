import { config } from "../config";
import type { StorageConfigurations } from "./types";

/**
 * Get storage configuration
 */
export function storageConfig(): StorageConfigurations;
export function storageConfig<T = any>(key: string): T;
export function storageConfig<T = any>(key: string, defaultValue: T): T;
export function storageConfig(key?: string, defaultValue?: any): any {
  if (!key) {
    return config.get("storage");
  }

  return config.get(`storage.${key}`, defaultValue);
}
