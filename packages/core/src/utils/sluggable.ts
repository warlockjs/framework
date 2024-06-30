import slug from "@mongez/slug";
import type { Model } from "@warlock.js/cascade";

/**
 * Used for model castings
 */
export function sluggable(generateFrom: string, slugLocaleCode = "en") {
  return (model: Model) => {
    let value = model.get(generateFrom);

    if (!value) return "";

    if (Array.isArray(value)) {
      value = (value as any[]).find(
        value => value.localeCode === slugLocaleCode,
      )?.value;
    }

    return slug(String(value));
  };
}
