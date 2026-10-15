import { Model } from "@warlock.js/cascade";
import AuditEntryResource from "../resources/audit-entry.resource";

export type AuditEntryData = {
  id: number;
  action: string;
  ip: string;
};

export default class AuditEntry extends Model<AuditEntryData> {
  public static resource = AuditEntryResource;
}
