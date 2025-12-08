import type { Model } from "@warlock.js/cascade";
import type { RepositoryManager } from "./repository-manager";

export class RepositoryFiller {
  /**
   * Constructor
   */
  public constructor(protected repository: RepositoryManager<any, any>) {
    //
  }

  /**
   * Create new record
   */
  public async create(
    data: any,
    model: Model = this.repository.newModel(),
  ): Promise<Model> {
    await this.repository.setData(model, data, "create");

    this.repository.onSaving(model, data);
    this.repository.onCreating(model, data);

    this.repository.trigger("creating", model, data);
    this.repository.trigger("saving", model, data);

    await model.save(data);

    this.repository.onCreate(model, data);
    this.repository.onSave(model, data);

    this.repository.trigger("create", model);
    this.repository.trigger("save", model);

    return model;
  }

  /**
   * Update record
   */
  public async update(model: Model, data: any) {
    const currentModel = this.repository.newModel(model.data);

    this.repository.onUpdating(model, data);
    this.repository.onSaving(model, data);

    await this.repository.setData(model, data, "update");

    this.repository.trigger("updating", model, data);
    this.repository.trigger("saving", model, data);

    await model.save(data);

    this.repository.onUpdate(model, data, currentModel);
    this.repository.onSave(model, data, currentModel);

    this.repository.trigger("update", model, currentModel);
    this.repository.trigger("save", model, currentModel);

    return model;
  }

  /**
   * Increment a column value
   */
  public async increment(model: Model | number, column: string, value = 1) {
    if (typeof model === "number") {
      model = (await this.repository.find(model)) as Model;
    }

    await model.increment(column, value);

    return model;
  }

  /**
   * Decrement a column value
   */
  public async decrement(model: Model | number, column: string, value = 1) {
    if (typeof model === "number") {
      model = (await this.repository.find(model)) as Model;
    }

    await model.decrement(column, value);

    return model;
  }
}
