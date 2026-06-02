import type { QueryBuilderContract } from "../../contracts";
import type { GlobalScopeOptions, LocalScopeCallback, ChildModel } from "../model";
export declare function addGlobalModelScope(ModelClass: ChildModel<any>, name: string, callback: (query: QueryBuilderContract) => void, options?: GlobalScopeOptions): void;
export declare function removeGlobalModelScope(ModelClass: ChildModel<any>, name: string): void;
export declare function addLocalModelScope(ModelClass: ChildModel<any>, name: string, callback: LocalScopeCallback): void;
export declare function removeLocalModelScope(ModelClass: ChildModel<any>, name: string): void;
//# sourceMappingURL=scope-methods.d.ts.map