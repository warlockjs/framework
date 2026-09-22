import { type DataSource } from "@warlock.js/cascade";
import { type FastifyInstance } from "fastify";
import { type Server } from "socket.io";
import { ContainerKeyMissingError } from "../errors/container-key-missing-error";
import { type Router } from "../router";
import {
  getRegisteredContainerInstances,
  registerContainerInstance,
} from "./container-instance-registry";
import type { DevelopmentModelModules } from "./development-model-modules";

export type {
  DevelopmentModelModuleEntry,
  DevelopmentModelModules,
  DevelopmentModelModuleState,
} from "./development-model-modules";

const containerMap: Map<string, any> = new Map();

registerContainerInstance();

/**
 * Known container types for better IDE support
 */
export type ContainerTypes = {
  router: Router;
  "http.server": FastifyInstance;
  "http.baseUrl": string;
  socket: Server;
  "database.source": DataSource;
  "development.modelModules": DevelopmentModelModules;
};

type ContainerKeys = keyof ContainerTypes | (string & {});

class Container {
  /**
   * Set a value in the container
   */
  public set<K extends keyof ContainerTypes>(key: K, value: ContainerTypes[K]): void;
  public set<T = any>(key: string, value: T): void;
  public set(key: any, value: any) {
    containerMap.set(key, value);
  }

  /**
   * Get a value from the container, or throw if `key` is not registered.
   *
   * Behaves exactly like an ordinary "not registered" error when only one
   * copy of this module is loaded. When {@link getRegisteredContainerInstances}
   * shows more than one, the thrown error additionally names that count, so
   * a duplicate-instance dev-path miss is never indistinguishable from a
   * genuine missing registration.
   *
   * Use {@link tryGet} instead when the value is genuinely optional.
   */
  public get<K extends keyof ContainerTypes>(key: K): ContainerTypes[K];
  public get<T = any>(key: string): T;
  public get(key: any): any {
    if (!containerMap.has(key)) {
      const instanceCount = getRegisteredContainerInstances().length;
      throw new ContainerKeyMissingError(key, instanceCount, [...containerMap.keys()]);
    }

    return containerMap.get(key);
  }

  /**
   * Check if a key exists in the container
   */
  public has(key: ContainerKeys) {
    return containerMap.has(key);
  }

  /**
   * Get a value from the container, or `undefined` if `key` is not
   * registered.
   *
   * Use this only for genuinely optional dependencies — where the caller
   * has its own fallback for an absent value. For every other read, prefer
   * {@link get}: a hole in the container should fail loudly, not hand back
   * `undefined` typed as the real value.
   */
  public tryGet<K extends keyof ContainerTypes>(key: K): ContainerTypes[K] | undefined;
  public tryGet<T = any>(key: string): T | undefined;
  public tryGet(key: any): any {
    return containerMap.get(key);
  }

  /**
   * @deprecated `get` now throws for a missing key; use {@link get}.
   */
  public getOrFail<K extends keyof ContainerTypes>(key: K): ContainerTypes[K];
  public getOrFail<T = any>(key: string): T;
  public getOrFail(key: any): any {
    return this.get(key);
  }

  /**
   * Delete a key from the container
   */
  public delete(key: string) {
    containerMap.delete(key);
  }
}

export const container = new Container();
