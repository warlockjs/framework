import { type ModelEventListener, type ModelEventName } from "../../events/model-events";
import type { Model } from "../model";
export declare function emitModelEvent<TContext = unknown>(model: Model, event: ModelEventName, context?: TContext): Promise<void>;
export declare function onModelEvent<TContext = unknown>(model: Model, event: ModelEventName, listener: ModelEventListener<any, TContext>): () => void;
export declare function onceModelEvent<TContext = unknown>(model: Model, event: ModelEventName, listener: ModelEventListener<any, TContext>): () => void;
export declare function offModelEvent<TContext = unknown>(model: Model, event: ModelEventName, listener: ModelEventListener<any, TContext>): void;
//# sourceMappingURL=instance-event-methods.d.ts.map