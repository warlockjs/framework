// Context
export * from "./context/database-data-source-context";
export * from "./context/database-transaction-context";

// Contracts
export * from "./contracts/database-driver.contract";
export * from "./contracts/database-id-generator.contract";
export * from "./contracts/database-remover.contract";
export * from "./contracts/database-restorer.contract";
export * from "./contracts/database-writer.contract";
export * from "./contracts/migration-driver.contract";
export * from "./contracts/query-builder.contract";
export * from "./contracts/sync-adapter.contract";

// Data Source
export * from "./data-source/data-source";
export * from "./data-source/data-source-registry";

// Errors
export * from "./errors/missing-data-source.error";

// Core Services
export * from "./database-dirty-tracker";
export * from "./events/model-events";
export * from "./model/model";
export * from "./model/register-model";
export * from "./remover/database-remover";
export * from "./restorer/database-restorer";
export * from "./types";
export * from "./validation";
export * from "./writer/database-writer";

// Expressions
export * from "./expressions";

// MongoDB Driver
export * from "./drivers/mongo/mongo-id-generator";
export * from "./drivers/mongo/mongo-query-builder";
export * from "./drivers/mongo/mongo-sync-adapter";
export * from "./drivers/mongo/mongodb-driver";
export * from "./drivers/mongo/types";

// Re-export MongoDB client types for convenience
export type { MongoClientOptions, TransactionOptions } from "mongodb";

// Sync system
export { modelSync } from "./sync/model-sync";
export { ModelSyncOperation } from "./sync/model-sync-operation";
export { DEFAULT_MAX_SYNC_DEPTH, SyncContextManager } from "./sync/sync-context";
export { SyncManager } from "./sync/sync-manager";
export type {
  EmbedKey,
  ModelSyncConfig,
  ModelSyncContract,
  ModelSyncOperationContract,
  SyncConfig,
  SyncContext,
  SyncEventPayload,
  SyncInstruction,
  SyncInstructionOptions,
  SyncResult,
} from "./sync/types";

// Utilities
export * from "./utils/connect-to-database";
export * from "./utils/database-writer.utils";
export * from "./utils/define-model";
export * from "./utils/once-connected";

// Migration System
export * from "./migration";

// MongoDB Migration Driver
export { MongoMigrationDriver } from "./drivers/mongo/mongo-migration-driver";
