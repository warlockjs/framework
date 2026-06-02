import { Infer } from "@warlock.js/seal";
import { Model } from "@warlock.js/cascade";

//#region ../../@warlock.js/core/src/database/models/database-log/database-log.d.ts
declare const schema: any;
type LogSchema = Infer.Output<typeof schema>;
declare class DatabaseLogModel extends Model<LogSchema> {
  /**
   * Table name
   */
  static table: string;
  /**
   * {@inheritdoc}
   */
  static schema: any;
}
//#endregion
export { DatabaseLogModel };
//# sourceMappingURL=database-log.d.mts.map