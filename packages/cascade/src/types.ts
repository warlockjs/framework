import type { MongoClientOptions } from "mongodb";

export type DatabaseConfigurations = {
  /**
   * Database host
   */
  host?: string;
  /**
   * Database port
   */
  port?: number;
  /**
   * Database username
   */
  username?: string;
  /**
   * Database password
   */
  password?: string;
  /**
   * Database name
   */
  database?: string;
  /**
   * Database authentication
   */
  dbAuth?: string;
  /**
   * Database URL string
   */
  url?: string;
  /**
   * Model configurations
   */
  model?: {
    /**
     * Randomly increment the id
     * If initial id is defined, this option will be ignored
     *
     * @default false
     */
    randomIncrement?: boolean;
    /**
     * Randomly generate first id
     * if initial id is defined, this option will be ignored
     * @default false
     */
    randomInitialId?: boolean;
    /**
     * Define the initial value of the id
     *
     * @default 1
     */
    initialId?: number;
    /**
     * Define the amount to be incremented by for the next generated id
     *
     * @default 1
     */
    autoIncrementBy?: number;
  };
} & Partial<MongoClientOptions>;
