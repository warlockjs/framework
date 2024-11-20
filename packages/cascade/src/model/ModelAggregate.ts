import { colors } from "@mongez/copper";
import type { GenericObject } from "@mongez/reinforcements";
import { toStudlyCase } from "@mongez/reinforcements";
import type { Pipeline } from "../aggregate";
import { $agg, Aggregate, selectPipeline } from "../aggregate";
import type { Model } from "../model/model";
import { joinableProxy } from "../utils/joinable-proxy";
import type { Joinable, JoinableProxy } from "./joinable";
import type {
  ChunkCallback,
  Document,
  Filter,
  PaginationListing,
} from "./types";

export class ModelAggregate<T extends Model> extends Aggregate {
  /**
   * Joining list
   * Each key will have the model as a value reference to it
   */
  protected joiningList: GenericObject = {};

  /**
   * Constructor
   */
  public constructor(protected readonly model: typeof Model) {
    super(model.collection);
    this.query = model.query;
  }

  /**
   * {@inheritDoc}
   */
  public async get<Output = T>(
    mapData?: (record: any) => any,
  ): Promise<Output[]> {
    if (!mapData) {
      mapData = (record: any) => {
        const model = new this.model(record);

        for (const relation in this.joiningList) {
          const data = model.get(relation);

          if (!data) continue;

          model.set(relation, this.joiningList[relation](data));
        }

        return model;
      };
    }
    return (await super.get(mapData)) as Output[];
  }

  /**
   * Find or create
   */
  public async findOrCreate<Data extends Document = Document>(
    data: Data,
  ): Promise<T> {
    return (await this.first()) || ((await this.model.create(data)) as T);
  }

  /**
   * Find and update the given data
   * Please note that the filter should be done via where() methods
   * This method returns the updated records
   * If you need just to update the records directly in the database, then use `update` method directly.
   */
  public async findAndUpdate<Data extends Document = Document>(
    data: Data,
  ): Promise<T[]> {
    const records = await this.get();

    await Promise.all(records.map(async model => await model.save(data)));

    return records;
  }

  /**
   * {@inheritdoc}
   */
  public async chunk<Output = T>(
    limit: number,
    callback: ChunkCallback<Output>,
    mapData?: (data: any) => any,
  ) {
    return super.chunk(limit, callback, mapData);
  }

  /**
   * {@inheritDoc}
   */
  public async first(mapData?: (data: any) => any) {
    return (await super.first(mapData)) as T | undefined;
  }

  /**
   * {@inheritDoc}
   */
  public async last(filters?: Filter) {
    return (await super.last(filters)) as T | undefined;
  }

  /**
   * {@inheritDoc}
   */
  public async paginate<G = T>(
    page = 1,
    limit = this.model.perPage,
  ): Promise<PaginationListing<G>> {
    return await super.paginate<G>(page, limit);
  }

  /**
   * Delete records
   */
  public async delete() {
    const records = await this.get();

    records.forEach(async (model: any) => {
      await model.destroy();
    });

    return records.length;
  }

  /**
   * Perform a join
   */
  public joining(
    joining: string | JoinableProxy,
    options?:
      | {
          where?: GenericObject;
          select?: string[];
          pipeline: (GenericObject | Pipeline)[];
          as?: string;
        }
      | ((query: JoinableProxy) => any),
  ) {
    joining = this.getJoinable(joining);

    if (typeof options === "function") {
      options(joining);
    } else {
      if (options?.where) {
        joining.where(options.where);
      }

      if (options?.select) {
        joining.select(...options.select);
      }

      if (options?.as) {
        joining.as(options.as);
      }

      if (options?.pipeline) {
        joining.addPipelines(options.pipeline);
      }
    }

    const data = joining.parse();

    this.joiningList[data.as] = joining.getReturnAs();

    return this.lookup(data);
  }

  /**
   * Get joinable instance for current model
   */
  protected getJoinable(joinable: string | Joinable) {
    let joinableObject: Joinable;
    if (typeof joinable === "string") {
      joinableObject = this.model.relations[joinable] as Joinable;
      if (!joinableObject) {
        throw new Error(
          `Call to undefined joinable ${colors.redBright(joinable)} in ${this.model.name} model relations`,
        );
      }
    } else {
      joinableObject = joinable;
    }

    return joinableProxy(joinableObject.clone());
  }

  /**
   * Perform a join and count the records of the joined collection
   */
  public countJoining(
    joining: string | JoinableProxy,
    options?: {
      where?: GenericObject;
      select?: string[];
      pipeline: (GenericObject | Pipeline)[];
      as?: string;
    },
  ) {
    const joiningObject = this.getJoinable(joining);

    const as = joiningObject.get("as");

    const returnAs = options?.as || (as || "document") + "Count";

    return this.joining(joiningObject, options)
      .addField(returnAs, {
        $size: $agg.columnName(as),
      })
      .deselect([as]);
  }

  /**
   * Join the given alias
   */
  public with(alias: string, ...moreParams: any[]) {
    const method = `with${toStudlyCase(alias)}`;

    const relation = (this.model as any)[method];

    if (!relation) {
      throw new Error(`Relation ${alias} not found`);
    }

    const {
      model,
      localField,
      as,
      foreignField,
      single = false,
      select: selectColumns,
      pipeline = [],
    } = relation.call(this.model, ...moreParams);

    if (selectColumns) {
      pipeline.push(selectPipeline(selectColumns));
    }

    this.lookup({
      as,
      single,
      from: model.collection,
      // related to from field
      foreignField: foreignField || `${as}.id`,
      // related to current model
      localField: localField || "id",
      pipeline,
    });

    return this;
  }

  /**
   * Clone the aggregate model class
   */
  public clone() {
    const aggregate = new ModelAggregate(this.model);

    aggregate.pipelines = this.pipelines.slice();

    return aggregate as this;
  }
}
