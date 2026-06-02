import { merge } from "@mongez/reinforcements";
//#region ../../@warlock.js/core/src/router/route-builder.ts
var RouteBuilder = class RouteBuilder {
	constructor(router, path, moreOptions = {}) {
		this.router = router;
		this.path = path;
		this.moreOptions = moreOptions;
		this.addedRoutes = {
			get: false,
			post: false,
			put: false,
			delete: false,
			patch: false,
			options: false,
			head: false
		};
	}
	/**
	* Add a get method to the route
	*/
	get(handler, options = {}) {
		if (this.addedRoutes.get) throw new Error(`Route ${this.path} already has a GET method`);
		this.addedRoutes.get = true;
		this.router.get(this.path, handler, this.withOptions(options));
		return this;
	}
	/**
	* Get one resource, appends /:id to the path
	* For example: /posts/:id
	*/
	getOne(handler, options = {}) {
		this.router.get(`${this.path}/:id`, handler, this.withOptions(options));
		return this;
	}
	/**
	* Add a post method to the route
	*/
	post(handler, options = {}) {
		if (this.addedRoutes.post) throw new Error(`Route ${this.path} already has a POST method`);
		this.addedRoutes.post = true;
		this.router.post(this.path, handler, this.withOptions(options));
		return this;
	}
	/**
	* Post one resource, appends /:id to the path
	* For example: /posts/:id
	*/
	postOne(handler, options = {}) {
		this.router.post(`${this.path}/:id`, handler, this.withOptions(options));
		return this;
	}
	/**
	* Add a PUT request handler for current path
	*/
	put(handler, options = {}) {
		if (this.addedRoutes.put) throw new Error(`Route ${this.path} already has a PUT method`);
		this.addedRoutes.put = true;
		this.router.put(this.path, handler, this.withOptions(options));
		return this;
	}
	/**
	* Update one resource, appends /:id to the path
	*/
	updateOne(handler, options = {}) {
		this.router.put(`${this.path}/:id`, handler, this.withOptions(options));
		return this;
	}
	/**
	* Add a PATCH request handler for current path
	*/
	patch(handler, options = {}) {
		if (this.addedRoutes.patch) throw new Error(`Route ${this.path} already has a PATCH method`);
		this.addedRoutes.patch = true;
		this.router.patch(this.path, handler, this.withOptions(options));
		return this;
	}
	/**
	* Patch one resource, appends /:id to the path
	*/
	patchOne(handler, options = {}) {
		this.router.patch(`${this.path}/:id`, handler, this.withOptions(options));
		return this;
	}
	/**
	* Add a DELETE request handler for current path
	*/
	delete(handler, options = {}) {
		if (this.addedRoutes.delete) throw new Error(`Route ${this.path} already has a DELETE method`);
		this.addedRoutes.delete = true;
		this.router.delete(this.path, handler, this.withOptions(options));
		return this;
	}
	/**
	* Delete one resource, appends /:id to the path
	*/
	deleteOne(handler, options = {}) {
		this.router.delete(`${this.path}/:id`, handler, this.withOptions(options));
		return this;
	}
	/**
	* List all resources (RESTful alias for GET collection)
	* @example router.route("/posts").list(listPosts)
	*/
	list(handler, options = {}) {
		return this.get(handler, options);
	}
	/**
	* Create a new resource (RESTful alias for POST)
	* @example router.route("/posts").create(createPost)
	*/
	create(handler, options = {}) {
		return this.post(handler, options);
	}
	/**
	* Show a single resource (RESTful alias for GET one)
	* @example router.route("/posts").show(showPost) // GET /posts/:id
	*/
	show(handler, options = {}) {
		return this.getOne(handler, options);
	}
	/**
	* Update a resource (RESTful alias for PUT one)
	* @example router.route("/posts").update(updatePost) // PUT /posts/:id
	*/
	update(handler, options = {}) {
		return this.updateOne(handler, options);
	}
	/**
	* Destroy a resource (RESTful alias for DELETE one)
	* @example router.route("/posts").destroy(deletePost) // DELETE /posts/:id
	*/
	destroy(handler, options = {}) {
		return this.deleteOne(handler, options);
	}
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
	nest(path, options = {}) {
		const nestedPath = `${this.path}${path}`;
		const mergedOptions = this.withOptions(options);
		return new RouteBuilder(this.router, nestedPath, mergedOptions);
	}
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
	crud(handlers, options = {}) {
		if (handlers.list) this.get(handlers.list, options);
		if (handlers.create) this.post(handlers.create, options);
		if (handlers.show) this.getOne(handlers.show, options);
		if (handlers.update) this.updateOne(handlers.update, options);
		if (handlers.destroy) this.deleteOne(handlers.destroy, options);
		if (handlers.patch) this.patchOne(handlers.patch, options);
		return this;
	}
	/**
	* Merge options with moreOptions
	*/
	withOptions(options = {}) {
		return merge(this.moreOptions, options);
	}
};
//#endregion
export { RouteBuilder };

//# sourceMappingURL=route-builder.mjs.map