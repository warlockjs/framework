/**
 * Embed Validator Plugin
 *
 * Adds embed validation to Seal v factory
 */
import type { SealPlugin } from "@warlock.js/seal";
import type { ChildModel } from "../../model/model";
import { EmbedModelValidator } from "../validators/embed-validator";
type EmbedOptions = {
    errorMessage?: string;
    embed?: string | string[];
};
declare module "@warlock.js/seal" {
    interface ValidatorV {
        embed(model: ChildModel<any> | string, options?: EmbedOptions): EmbedModelValidator;
        embedMany(model: ChildModel<any> | string, options?: EmbedOptions): EmbedModelValidator;
    }
}
/**
 * File validation plugin for Seal
 */
export declare const embedValidator: SealPlugin;
export {};
//# sourceMappingURL=embed-validator-plugin.d.ts.map