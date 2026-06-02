import { ModelEvents, type ModelEventListener, type ModelEventName } from "../../events/model-events";
import type { ChildModel, Model } from "../model";
export declare function getModelEvents<TModel extends Model>(ModelClass: any): ModelEvents<TModel>;
export declare function cleanupModelEvents(ModelClass: any): void;
export declare function onStaticEvent<TModel extends Model = Model, TContext = unknown>(ModelClass: ChildModel<TModel>, event: ModelEventName, listener: ModelEventListener<TModel, TContext>): () => void;
export declare function onceStaticEvent<TModel extends Model = Model, TContext = unknown>(ModelClass: ChildModel<TModel>, event: ModelEventName, listener: ModelEventListener<TModel, TContext>): () => void;
export declare function offStaticEvent<TModel extends Model = Model, TContext = unknown>(ModelClass: ChildModel<TModel>, event: ModelEventName, listener: ModelEventListener<TModel, TContext>): void;
export declare function getGlobalEvents(): ModelEvents<Model>;
//# sourceMappingURL=static-event-methods.d.ts.map