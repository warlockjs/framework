import { Model } from "@warlock.js/cascade";
import { type Infer, v } from "@warlock.js/seal";

const schema = v.object({
  module: v.string(),
  action: v.string(),
  content: v.any(),
  stack: v.string().optional(),
  level: v.string(),
  date: v.string(),
});

type LogSchema = Infer.Output<typeof schema>;

export class DatabaseLogModel extends Model<LogSchema> {
  /**
   * Table name
   */
  public static table = "logs";

  /**
   * {@inheritdoc}
   */
  public static schema = schema;

  /**
   * Legacy rows stored `message`/`trace`; map them to `content`/`stack`
   * when the new fields are absent.
   */
  private static readonly legacyFields: Record<string, string> = {
    content: "message",
    stack: "trace",
  };

  /**
   * Log content, falling back to the legacy `message` field
   */
  public get content(): unknown {
    return this.get("content");
  }

  /**
   * Error stack, falling back to the legacy `trace` field
   */
  public get stack(): string | undefined {
    return this.get("stack");
  }

  /**
   * {@inheritdoc}
   */
  public get(field: string, defaultValue?: any): any {
    const value = super.get(field, undefined as any);

    if (value !== undefined && value !== null) return value;

    const legacy = DatabaseLogModel.legacyFields[field];

    if (legacy) {
      const legacyValue = super.get(legacy, undefined as any);

      if (legacyValue !== undefined && legacyValue !== null) return legacyValue;
    }

    return value ?? defaultValue;
  }
}
