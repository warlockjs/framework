import { Request } from "../http/request.mjs";
import { Response } from "../http/response.mjs";
import { RestfulMiddleware, RouteResource } from "../router/types.mjs";
import { RepositoryManager } from "../repositories/repository.manager.mjs";
import { Model } from "@warlock.js/cascade";

//#region ../../@warlock.js/core/src/restful/restful.d.ts
declare abstract class Restful<T extends Model> implements RouteResource {
  /**
   * Middleware for each method
   */
  protected middleware: RestfulMiddleware;
  /**
   * Record name
   */
  protected recordName: string;
  /**
   * Records list name
   */
  protected recordsListName: string;
  /**
   * Repository
   */
  protected abstract repository: RepositoryManager<T>;
  /**
   * Define what to be returned when a record is created|updated|deleted|patched
   */
  protected returnOn: Record<string, "record" | "records">;
  /**
   * Enable fetching cache
   *
   * @default true
   */
  cache: boolean;
  /**
   * Find record instance by id
   */
  find(id: number): Promise<T | null>;
  /**
   * List records
   */
  list(request: Request, response: Response): Promise<Response | undefined>;
  /**
   * Get single record
   */
  get(request: Request, response: Response): Promise<Response | undefined>;
  /**
   * Create a new record
   */
  create(request: Request, response: Response): Promise<any>;
  /**
   * Update record
   */
  update(request: Request, response: Response): Promise<any>;
  /**
   * Patch record
   */
  patch(request: Request, response: Response): Promise<Response | undefined>;
  /**
   * Delete record
   */
  delete(request: Request, response: Response): Promise<Response | undefined>;
  /**
   * Bulk delete records
   */
  bulkDelete(request: Request, response: Response): Promise<Response | undefined>;
  /**
   * Before create
   */
  protected beforeCreate(_request: Request, _response: Response, _record: T): Promise<any>;
  /**
   * On create
   */
  protected onCreate(_request: Request, _response: Response, _record: T): Promise<any>;
  /**
   * Before update
   */
  protected beforeUpdate(_request: Request, _response: Response, _record: T, _oldRecord?: T): Promise<any>;
  /**
   * On update
   */
  protected onUpdate(_request: Request, _response: Response, _record: T, _oldRecord: T): Promise<any>;
  /**
   * Before delete
   */
  protected beforeDelete(_request: Request, _response: Response, _record: T): Promise<any>;
  /**
   * On delete
   */
  protected onDelete(_request: Request, _response: Response, _record: T): Promise<any>;
  /**
   * Before patch
   */
  protected beforePatch(_request: Request, _response: Response, _record: T, _oldRecord?: T): Promise<any>;
  /**
   * On patch
   */
  protected onPatch(_request: Request, _response: Response, _record: T, _oldRecord: T): Promise<any>;
  /**
   * Before save
   */
  protected beforeSave(_request: Request, _response: Response, _record?: T, _oldRecord?: T): Promise<any>;
  /**
   * On save
   */
  protected onSave(_request: Request, _response: Response, _record: T, _oldRecord?: T): Promise<any>;
  /**
   * Call middleware for the given method
   *
   */
  protected callMiddleware(method: string, request: Request, response: Response, _record?: any): Promise<any[] | Record<string, any> | Response | undefined>;
}
//#endregion
export { Restful };
//# sourceMappingURL=restful.d.mts.map