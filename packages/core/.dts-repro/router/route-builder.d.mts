import { RequestHandlerType, RouteOptions } from "./types.mjs";
import { Router } from "./router.mjs";

//#region ../../@warlock.js/core/src/router/route-builder.d.ts
declare class RouteBuilder {
  private readonly router;
  private readonly path;
  private readonly moreOptions;
  protected addedRoutes: {
    get: boolean;
    post: boolean;
    put: boolean;
    delete: boolean;
    patch: boolean;
    options: boolean;
    head: boolean;
  };
  constructor(router: Router, path: string, moreOptions?: RouteOptions);
  /**
   * Add a get method to the route
   */
  get(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Get one resource, appends /:id to the path
   * For example: /posts/:id
   */
  getOne(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add a post method to the route
   */
  post(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Post one resource, appends /:id to the path
   * For example: /posts/:id
   */
  postOne(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add a PUT request handler for current path
   */
  put(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Update one resource, appends /:id to the path
   */
  updateOne(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add a PATCH request handler for current path
   */
  patch(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Patch one resource, appends /:id to the path
   */
  patchOne(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add a DELETE request handler for current path
   */
  delete(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Delete one resource, appends /:id to the path
   */
  deleteOne(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * List all resources (RESTful alias for GET collection)
   * @example router.route("/posts").list(listPosts)
   */
  list(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Create a new resource (RESTful alias for POST)
   * @example router.route("/posts").create(createPost)
   */
  create(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Show a single resource (RESTful alias for GET one)
   * @example router.route("/posts").show(showPost) // GET /posts/:id
   */
  show(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Update a resource (RESTful alias for PUT one)
   * @example router.route("/posts").update(updatePost) // PUT /posts/:id
   */
  update(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Destroy a resource (RESTful alias for DELETE one)
   * @example router.route("/posts").destroy(deletePost) // DELETE /posts/:id
   */
  destroy(handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Create a nested route builder
   * Useful for building nested resources like /posts/:id/comments
   * @example
   * router.route("/posts/:id")
   *   .getOne(showPost)
   *   .nest("/comments")
   *     .list(listComments)      // GET /posts/:id/comments
   *     .create(createComment);  // POST /posts/:id/comments
   */
  nest(path: string, options?: RouteOptions): RouteBuilder;
  /**
   * Set up common RESTful CRUD routes in one call
   * @example
   * router.route("/posts").crud({
   *   list: listPosts,        // GET /posts
   *   create: createPost,     // POST /posts
   *   show: showPost,         // GET /posts/:id
   *   update: updatePost,     // PUT /posts/:id
   *   destroy: deletePost,    // DELETE /posts/:id
   *   patch: patchPost,       // PATCH /posts/:id
   * });
   */
  crud(handlers: {
    list?: RequestHandlerType;
    create?: RequestHandlerType;
    show?: RequestHandlerType;
    update?: RequestHandlerType;
    destroy?: RequestHandlerType;
    patch?: RequestHandlerType;
  }, options?: RouteOptions): this;
  /**
   * Merge options with moreOptions
   */
  protected withOptions(options?: RouteOptions): RouteOptions;
}
//#endregion
export { RouteBuilder };
//# sourceMappingURL=route-builder.d.mts.map