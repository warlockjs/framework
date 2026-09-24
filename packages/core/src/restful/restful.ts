import type { GenericObject } from "@mongez/reinforcements";
import type { Model } from "@warlock.js/cascade";
import { log } from "@warlock.js/logger";
import type { Request, Response } from "../http";
import type { QueryBuilderContract, RepositoryManager } from "../repositories";
import type { HttpContext, RestfulMiddleware, RouteResource } from "../router";

const warnedUnvalidated = new WeakSet<object>();

export abstract class Restful<T extends Model> implements RouteResource {
  /**
   * Middleware for each method
   */
  protected middleware: RestfulMiddleware = {};

  /**
   * Record name
   */
  protected recordName = "record";

  /**
   * Records list name
   */
  protected recordsListName = "records";

  /**
   * Repository
   */
  protected abstract repository: RepositoryManager<T>;

  /**
   * Define what to be returned when a record is created|updated|deleted|patched
   */
  protected returnOn: Record<string, "record" | "records"> = {
    create: "record",
    update: "record",
    delete: "record",
    patch: "record",
  };

  /**
   * Enable fetching cache
   *
   * @default true
   */
  public cache = true;

  /**
   * Find record instance by id
   */
  public async find(id: number) {
    const findMethod = this.cache ? "getCached" : "find";
    return this.repository[findMethod](id);
  }

  /**
   * List records
   */
  public async list({ request, response }: HttpContext) {
    try {
      const middlewareOutput = await this.callMiddleware("list", request, response);

      if (middlewareOutput) return middlewareOutput;

      const responseDocument: GenericObject = {};

      const data = request.heavy();

      if (data.paginate === "false") {
        data.paginate = false;
      }

      const listMethod = this.cache ? "listCached" : "list";

      const { data: documents, pagination } = await this.repository[listMethod](data);

      responseDocument[this.recordsListName] = documents;

      if (pagination) {
        responseDocument.pagination = pagination;
      }

      return response.success(responseDocument);
    } catch (error: any) {
      log.error("restful", "list", error);
      return response.serverError(error);
    }
  }

  /**
   * Get single record
   */
  public async get({ request, response }: HttpContext) {
    try {
      const middlewareOutput = await this.callMiddleware("get", request, response);

      if (middlewareOutput) return middlewareOutput;

      const record = await this.find(request.input("id"));

      if (!record) {
        return response.notFound();
      }

      return response.success({
        [this.recordName]: record,
      });
    } catch (error) {
      log.error("restful", "get", error);

      throw error;
    }
  }

  /**
   * Create a new record
   */
  public async create({ request, response }: HttpContext) {
    try {
      const middlewareOutput = await this.callMiddleware("create", request, response);

      if (middlewareOutput) return middlewareOutput;

      const model = this.repository.newModel();
      const beforeCreate = await this.beforeCreate(request, response, model);

      if (beforeCreate) {
        return beforeCreate;
      }

      const beforeSave = await this.beforeSave(request, response, model);

      if (beforeSave) {
        return beforeSave;
      }

      const record = await this.repository.create(this.payload("create", request));

      const createOutput = await this.onCreate(request, response, record);

      if (createOutput) {
        return createOutput;
      }

      const saveOutput = await this.onSave(request, response, record);

      if (saveOutput) {
        return saveOutput;
      }

      if (this.returnOn.create === "records") {
        return this.list({ request, response });
      }

      return response.successCreate({
        [this.recordName]: record,
      });
    } catch (error: Error | any) {
      log.error("restful", "create", error);

      return response.badRequest({
        error: error.message,
      });
    }
  }

  /**
   * Update record
   */
  public async update({ request, response }: HttpContext) {
    try {
      const middlewareOutput = await this.callMiddleware("update", request, response);

      if (middlewareOutput) return middlewareOutput;

      // Find record
      const record = await this.find(request.input("id"));

      if (!record) {
        return response.notFound({
          error: "Record not found",
        });
      }

      const beforeOutput = await this.beforeUpdate(request, response, record);
      if (beforeOutput) {
        return beforeOutput;
      }

      const beforeSafe = await this.beforeSave(request, response, record);

      if (beforeSafe) {
        return beforeSafe;
      }

      const oldRecord = record.clone();

      await record.save(this.payload("update", request));

      await this.onUpdate(request, response, record, oldRecord);
      await this.onSave(request, response, record, oldRecord);

      if (this.returnOn.update === "records") {
        return this.list({ request, response });
      }

      return response.success({
        [this.recordName]: record,
      });
    } catch (error) {
      log.error("restful", "update", error);

      throw error;
    }
  }

  /**
   * Patch record
   */
  public async patch({ request, response }: HttpContext) {
    try {
      const middlewareOutput = await this.callMiddleware("patch", request, response);

      if (middlewareOutput) return middlewareOutput;

      const record = await this.find(request.input("id"));

      if (!record) {
        return response.notFound({
          error: "Record not found",
        });
      }

      const oldRecord = record.clone();

      const beforePatch = await this.beforePatch(request, response, record, oldRecord);

      if (beforePatch) {
        return beforePatch;
      }

      const beforeSave = await this.beforeSave(request, response, record, oldRecord);

      if (beforeSave) {
        return beforeSave;
      }

      await record.save(this.payload("patch", request));

      await this.onPatch(request, response, record, oldRecord);
      await this.onSave(request, response, record, oldRecord);

      if (this.returnOn.patch === "records") {
        return this.list({ request, response });
      }

      return response.success({
        [this.recordName]: record,
      });
    } catch (error) {
      log.error("restful", "patch", error);

      throw error;
    }
  }

  /**
   * Delete record
   */
  public async delete({ request, response }: HttpContext) {
    try {
      const record = await this.find(request.input("id"));

      if (!record) {
        return response.notFound();
      }

      const middlewareOutput = await this.callMiddleware("delete", request, response, record);

      if (middlewareOutput) return middlewareOutput;

      await this.beforeDelete(request, response, record);

      await record.destroy();

      this.onDelete(request, response, record);

      if (this.returnOn.delete === "records") {
        return this.list({ request, response });
      }

      return response.success();
    } catch (error: Error | any) {
      log.error("restful", "delete", error);

      return response.badRequest({
        error: error.message,
      });
    }
  }

  /**
   * Bulk delete records
   */
  public async bulkDelete({ request, response }: HttpContext) {
    try {
      const ids = request.input("id");

      if (!Array.isArray(ids)) {
        return response.badRequest({
          error: "id must be an array",
        });
      }

      const records = await this.repository.all({
        perform: (query: QueryBuilderContract<T>) =>
          query.whereIn(
            "id",
            ids.map((id) => parseInt(id)),
          ),
      });

      await Promise.all(
        records.map(async (record) => {
          if (await this.callMiddleware("delete", request, response, record)) {
            return;
          }

          await this.beforeDelete(request, response, record);
          await record.destroy();
          this.onDelete(request, response, record);
        }),
      );

      if (this.returnOn.delete === "records") {
        return this.list({ request, response });
      }

      return response.success({
        deleted: records.length,
      });
    } catch (error: Error | any) {
      log.error("restful", "bulkDelete", error);
      return response.badRequest({
        error: error.message,
      });
    }
  }

  /**
   * Before create
   */
  protected async beforeCreate(_request: Request, _response: Response, _record: T): Promise<any> {
    //
  }

  /**
   * On create
   */
  protected async onCreate(_request: Request, _response: Response, _record: T): Promise<any> {
    //
  }

  /**
   * Before update
   */
  protected async beforeUpdate(
    _request: Request,
    _response: Response,
    _record: T,
    _oldRecord?: T,
  ): Promise<any> {
    //
  }

  /**
   * On update
   */
  protected async onUpdate(
    _request: Request,
    _response: Response,
    _record: T,
    _oldRecord: T,
  ): Promise<any> {
    //
  }

  /**
   * Before delete
   */
  protected async beforeDelete(_request: Request, _response: Response, _record: T): Promise<any> {
    //
  }

  /**
   * On delete
   */
  protected async onDelete(_request: Request, _response: Response, _record: T): Promise<any> {
    //
  }

  /**
   * Before patch
   */
  protected async beforePatch(
    _request: Request,
    _response: Response,
    _record: T,
    _oldRecord?: T,
  ): Promise<any> {
    //
  }

  /**
   * On patch
   */
  protected async onPatch(
    _request: Request,
    _response: Response,
    _record: T,
    _oldRecord: T,
  ): Promise<any> {
    //
  }

  /**
   * Before save
   */
  protected async beforeSave(
    _request: Request,
    _response: Response,
    _record?: T,
    _oldRecord?: T,
  ): Promise<any> {
    //
  }

  /**
   * On save
   */
  protected async onSave(
    _request: Request,
    _response: Response,
    _record: T,
    _oldRecord?: T,
  ): Promise<any> {
    //
  }

  /**
   * Data to persist: only the validated input.
   * Without a validation schema the raw input is kept (legacy behaviour)
   * and a one-time warning names the resource.
   */
  protected payload(action: "create" | "update" | "patch", request: Request): GenericObject {
    const validation = (this as any).validation;

    if (validation?.all || validation?.[action]) {
      return request.validated();
    }

    if (!warnedUnvalidated.has(this.constructor)) {
      warnedUnvalidated.add(this.constructor);

      log.warn(
        "restful",
        "validation",
        this.constructor.name + " has no validation schema: " + action + " persists unvalidated request input. Define a validation schema to persist only validated fields.",
      );
    }

    if (action === "create") return request.all();

    return action === "update" ? request.allExceptParams() : request.heavyExceptParams();
  }

  /**
   * Call middleware for the given method
   *
   */
  protected async callMiddleware(
    method: string,
    request: Request,
    response: Response,
    _record?: any,
  ) {
    if (!this.middleware[method]) return;

    for (const middleware of this.middleware[method]) {
      const output = await middleware({ request, response });

      if (output) {
        return output;
      }
    }

    return;
  }
}
