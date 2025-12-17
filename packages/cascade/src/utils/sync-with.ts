import type { Model } from "./../model/model";

/**
 * Setup bidirectional sync between two models
 * When source model is updated, all target models with matching field are updated
 */
export function syncWith(
  sourceModel: typeof Model,
  targetModel: typeof Model,
  targetField: string,
  embedProperty = "embedData",
) {
  sourceModel.events().onUpdated(async model => {
    try {
      const targets = await targetModel.list({
        [targetField + ".id"]: model.id,
      });

      // Batch update for better performance
      await Promise.all(
        targets.map(item =>
          item.save({
            [targetField]: embedProperty ? model[embedProperty] : model,
          }),
        ),
      );
    } catch (error) {
      console.error(
        `Failed to sync ${sourceModel.name} -> ${targetModel.name}:`,
        error,
      );
      // Optionally: emit error event, log to monitoring service, etc.
    }
  });
}

/**
 * Helper to register multiple sync relationships at once
 */
export function registerSyncs(
  syncs: {
    source: typeof Model;
    target: typeof Model;
    targetField: string;
  }[],
) {
  syncs.forEach(({ source, target, targetField }) => {
    syncWith(source, target, targetField);
  });
}

/**
 * Sync multiple documents with a single model
 */
export function syncMany(
  sourceModel: typeof Model,
  targetModel: typeof Model,
  targetField: string,
) {
  sourceModel.events().onUpdated(async model => {
    const targets = await targetModel.list({
      [targetField + ".id"]: model.id,
    });

    await Promise.all(
      targets.map(item => item.reassociate(targetField, model).save()),
    );
  });
}

/**
 * Add a new value to the target field when the source model is created
 */
export function syncManyOnCreateFrom(
  sourceModel: typeof Model,
  targetModel: typeof Model,
  targetField: string,
) {
  sourceModel.events().onCreated(async model => {
    const targets = await targetModel.list({
      [targetField + ".id"]: model.id,
    });

    await Promise.all(
      targets.map(item => item.associate(targetField, model).save()),
    );
  });
}

/**
 * Unset the target field when the source model is deleted
 */
export function syncUnsetOnDelete(
  sourceModel: typeof Model,
  targetModel: typeof Model,
  targetField: string,
) {
  sourceModel.events().onDeleted(async model => {
    const targets = await targetModel.list({ [targetField + ".id"]: model.id });
    await Promise.all(targets.map(item => item.unset(targetField).save()));
  });
}
