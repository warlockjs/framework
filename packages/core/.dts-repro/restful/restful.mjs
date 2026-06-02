import { log } from "@warlock.js/logger";
//#region ../../@warlock.js/core/src/restful/restful.ts
var Restful = class {
	constructor() {
		this.middleware = {};
		this.recordName = "record";
		this.recordsListName = "records";
		this.returnOn = {
			create: "record",
			update: "record",
			delete: "record",
			patch: "record"
		};
		this.cache = true;
	}
	/**
	* Find record instance by id
	*/
	async find(id) {
		const findMethod = this.cache ? "getCached" : "find";
		return this.repository[findMethod](id);
	}
	/**
	* List records
	*/
	async list(request, response) {
		try {
			if (await this.callMiddleware("list", request, response)) return;
			const responseDocument = {};
			const data = request.heavy();
			if (data.paginate === "false") data.paginate = false;
			const listMethod = this.cache ? "listCached" : "list";
			const { data: documents, pagination } = await this.repository[listMethod](data);
			responseDocument[this.recordsListName] = documents;
			if (pagination) responseDocument.pagination = pagination;
			return response.success(responseDocument);
		} catch (error) {
			log.error("restful", "list", error);
			return response.serverError(error);
		}
	}
	/**
	* Get single record
	*/
	async get(request, response) {
		try {
			if (await this.callMiddleware("get", request, response)) return;
			const record = await this.find(request.input("id"));
			if (!record) return response.notFound();
			return response.success({ [this.recordName]: record });
		} catch (error) {
			log.error("restful", "get", error);
		}
	}
	/**
	* Create a new record
	*/
	async create(request, response) {
		try {
			const model = this.repository.newModel();
			const beforeCreate = await this.beforeCreate(request, response, model);
			if (beforeCreate) return beforeCreate;
			const beforeSave = await this.beforeSave(request, response, model);
			if (beforeSave) return beforeSave;
			const record = await this.repository.create(request.all());
			const createOutput = await this.onCreate(request, response, record);
			if (createOutput) return createOutput;
			const saveOutput = await this.onSave(request, response, record);
			if (saveOutput) return saveOutput;
			if (this.returnOn.create === "records") return this.list(request, response);
			return response.successCreate({ [this.recordName]: record });
		} catch (error) {
			log.error("restful", "create", error);
			return response.badRequest({ error: error.message });
		}
	}
	/**
	* Update record
	*/
	async update(request, response) {
		try {
			const record = await this.find(request.input("id"));
			if (!record) return response.notFound({ error: "Record not found" });
			const beforeOutput = await this.beforeUpdate(request, response, record);
			if (beforeOutput) return beforeOutput;
			const beforeSafe = await this.beforeSave(request, response, record);
			if (beforeSafe) return beforeSafe;
			const oldRecord = record.clone();
			await record.save(request.allExceptParams());
			this.onUpdate(request, response, record, oldRecord);
			this.onSave(request, response, record, oldRecord);
			if (this.returnOn.update === "records") return this.list(request, response);
			return response.success({ [this.recordName]: record });
		} catch (error) {
			log.error("restful", "update", error);
		}
	}
	/**
	* Patch record
	*/
	async patch(request, response) {
		try {
			const record = await this.find(request.input("id"));
			if (!record) return response.notFound({ error: "Record not found" });
			const oldRecord = record.clone();
			await this.beforePatch(request, response, record, oldRecord);
			await this.beforeSave(request, response, record, oldRecord);
			await record.save(request.heavyExceptParams());
			this.onPatch(request, response, record, oldRecord);
			this.onSave(request, response, record, oldRecord);
			if (this.returnOn.patch === "records") return this.list(request, response);
			return response.success({ [this.recordName]: record });
		} catch (error) {
			log.error("restful", "patch", error);
		}
	}
	/**
	* Delete record
	*/
	async delete(request, response) {
		try {
			const record = await this.find(request.input("id"));
			if (!record) return response.notFound();
			if (await this.callMiddleware("delete", request, response, record)) return;
			await this.beforeDelete(request, response, record);
			await record.destroy();
			this.onDelete(request, response, record);
			if (this.returnOn.delete === "records") return this.list(request, response);
			return response.success();
		} catch (error) {
			log.error("restful", "delete", error);
			return response.badRequest({ error: error.message });
		}
	}
	/**
	* Bulk delete records
	*/
	async bulkDelete(request, response) {
		try {
			const ids = request.input("id");
			if (!Array.isArray(ids)) return response.badRequest({ error: "id must be an array" });
			const records = await this.repository.all({ perform: (query) => query.whereIn("id", ids.map((id) => parseInt(id))) });
			await Promise.all(records.map(async (record) => {
				if (await this.callMiddleware("delete", request, response, record)) return;
				await this.beforeDelete(request, response, record);
				await record.destroy();
				this.onDelete(request, response, record);
			}));
			if (this.returnOn.delete === "records") return this.list(request, response);
			return response.success({ deleted: records.length });
		} catch (error) {
			log.error("restful", "bulkDelete", error);
			return response.badRequest({ error: error.message });
		}
	}
	/**
	* Before create
	*/
	async beforeCreate(_request, _response, _record) {}
	/**
	* On create
	*/
	async onCreate(_request, _response, _record) {}
	/**
	* Before update
	*/
	async beforeUpdate(_request, _response, _record, _oldRecord) {}
	/**
	* On update
	*/
	async onUpdate(_request, _response, _record, _oldRecord) {}
	/**
	* Before delete
	*/
	async beforeDelete(_request, _response, _record) {}
	/**
	* On delete
	*/
	async onDelete(_request, _response, _record) {}
	/**
	* Before patch
	*/
	async beforePatch(_request, _response, _record, _oldRecord) {}
	/**
	* On patch
	*/
	async onPatch(_request, _response, _record, _oldRecord) {}
	/**
	* Before save
	*/
	async beforeSave(_request, _response, _record, _oldRecord) {}
	/**
	* On save
	*/
	async onSave(_request, _response, _record, _oldRecord) {}
	/**
	* Call middleware for the given method
	*
	*/
	async callMiddleware(method, request, response, _record) {
		if (!this.middleware[method]) return;
		for (const middleware of this.middleware[method]) {
			const output = await middleware(request, response);
			if (output) return output;
		}
	}
};
//#endregion
export { Restful };

//# sourceMappingURL=restful.mjs.map