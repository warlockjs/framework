import { Infer } from "@warlock.js/seal";
import { Model } from "@warlock.js/cascade";

//#region ../../@warlock.js/core/src/http/database/RequestLog.d.ts
declare const schema: any;
type RequestLogSchema = Infer.Output<typeof schema>;
declare class RequestLog extends Model<RequestLogSchema> {
  /**
   * {@inheritdoc}
   */
  static table: string;
  /**
   * {@inheritdoc}
   */
  static schema: any;
}
//#endregion
export { RequestLog };
//# sourceMappingURL=RequestLog.d.mts.map