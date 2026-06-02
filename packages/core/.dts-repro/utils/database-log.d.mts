import { DatabaseLogModel } from "../database/models/database-log/database-log.mjs";
import { ChildModel, Model } from "@warlock.js/cascade";
import { BasicLogConfigurations, LogChannel, LogContract, LoggingData } from "@warlock.js/logger";

//#region ../../@warlock.js/core/src/utils/database-log.d.ts
type DatabaseLogOptions = BasicLogConfigurations & {
  /**
   * Model to use for logging
   */
  model?: typeof DatabaseLogModel;
};
declare class DatabaseLog extends LogChannel<DatabaseLogOptions> implements LogContract {
  /**
   * {@inheritdoc}
   */
  name: string;
  /**
   * Database model
   */
  get model(): ChildModel<Model>;
  /**
   * {@inheritdoc}
   */
  log(log: LoggingData): Promise<void>;
}
//#endregion
export { DatabaseLog, DatabaseLogOptions };
//# sourceMappingURL=database-log.d.mts.map