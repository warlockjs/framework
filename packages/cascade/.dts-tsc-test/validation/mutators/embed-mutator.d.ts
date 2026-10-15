import type { Mutator } from "@warlock.js/seal";
import { ChildModel } from "../../model/model";
type DatabaseModelMutatorOptions = {
    model: ChildModel<any> | string;
};
export declare const databaseModelMutator: Mutator<DatabaseModelMutatorOptions>;
export declare const databaseModelsMutator: Mutator<DatabaseModelMutatorOptions>;
export {};
//# sourceMappingURL=embed-mutator.d.ts.map