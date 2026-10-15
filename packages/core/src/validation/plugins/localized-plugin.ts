/**
 * Localized Validator Plugin
 *
 * Adds localized() method to Seal v factory
 */

import type { BaseValidator, SealPlugin } from "@warlock.js/seal";
import { v } from "@warlock.js/seal";

/**
 * Localized validation plugin for Seal
 */
export const localizedPlugin: SealPlugin = {
  name: "localized",
  version: "1.0.0",
  description: "Adds localized validation (v.localized())",
  install() {
    v.localized = ((valueValidator?: BaseValidator, errorMessage?: string) =>
      v.array(
        v.object({
          localeCode: v.string().required(),
          value: valueValidator || v.scalar(),
        }),
        errorMessage,
      )) as unknown as typeof v.localized;
  },
};
