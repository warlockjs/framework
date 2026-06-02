//#region ../../@warlock.js/core/src/cli/commands/generate/templates/stubs.ts
/**
* Controller template stub
*
* Controllers default to the guarded handler type since application
* routes run behind `guarded()`. When `withValidation` is set, the
* schema's exported type + value are imported directly from the
* `schema/` folder and bound to the handler — no `requests/` alias.
*/
function controllerStub(name, options = {}) {
	const { withValidation } = options;
	if (!withValidation) return `import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";

export const ${name.camel}Controller: GuardedRequestHandler = async (request, response) => {
  // TODO: Implement controller logic
  return response.success({});
};
`;
	return `import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { type ${name.pascal}Schema, ${name.camel}Schema } from "../schema/${name.kebab}.schema";

export const ${name.camel}Controller: GuardedRequestHandler<${name.pascal}Schema> = async (
  request,
  response,
) => {
  // TODO: Implement controller logic
  return response.success({});
};

${name.camel}Controller.validation = {
  schema: ${name.camel}Schema,
};
`;
}
/**
* CRUD Create Controller template
* Note: moduleName is the module (plural), we need singular entity name
*/
function crudCreateControllerStub(moduleName) {
	return `import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { type Create${moduleName.pascal}Schema, create${moduleName.pascal}Schema } from "../schema/create-${moduleName.kebab}.schema";
import { create${moduleName.pascal}Service } from "../services/create-${moduleName.kebab}.service";

export const create${moduleName.pascal}Controller: GuardedRequestHandler<Create${moduleName.pascal}Schema> = async (
  request,
  response,
) => {
  const ${moduleName.camel} = await create${moduleName.pascal}Service(request.validated());

  return response.successCreate({
    ${moduleName.camel},
  });
};

create${moduleName.pascal}Controller.validation = {
  schema: create${moduleName.pascal}Schema,
};
`;
}
/**
* CRUD Update Controller template
*/
function crudUpdateControllerStub(moduleName) {
	return `import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { type Update${moduleName.pascal}Schema, update${moduleName.pascal}Schema } from "../schema/update-${moduleName.kebab}.schema";
import { update${moduleName.pascal}Service } from "../services/update-${moduleName.kebab}.service";

export const update${moduleName.pascal}Controller: GuardedRequestHandler<Update${moduleName.pascal}Schema> = async (
  request,
  response,
) => {
  const ${moduleName.camel} = await update${moduleName.pascal}Service(request.input("id"), request.validated());

  return response.success({
    ${moduleName.camel},
  });
};

update${moduleName.pascal}Controller.validation = {
  schema: update${moduleName.pascal}Schema,
};
`;
}
/**
* CRUD List Controller template
*/
function crudListControllerStub(moduleName) {
	const plural = moduleName.plural;
	return `import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { list${plural.pascal}Service } from "../services/list-${plural.kebab}.service";

export const list${plural.pascal}Controller: GuardedRequestHandler = async (
  request,
  response,
) => {
  const { data, pagination } = await list${plural.pascal}Service(request.all());

  return response.success({
    data,
    pagination,
  });
};
`;
}
/**
* CRUD Show/Get Controller template
*/
function crudShowControllerStub(moduleName) {
	return `import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { get${moduleName.pascal}Service } from "../services/get-${moduleName.kebab}.service";

export const get${moduleName.pascal}Controller: GuardedRequestHandler = async (
  request,
  response,
) => {
  const ${moduleName.camel} = await get${moduleName.pascal}Service(request.input("id"));

  if (!${moduleName.camel}) {
    return response.notFound();
  }

  return response.success({
    ${moduleName.camel},
  });
};
`;
}
/**
* CRUD Delete Controller template
*/
function crudDeleteControllerStub(moduleName) {
	return `import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { delete${moduleName.pascal}Service } from "../services/delete-${moduleName.kebab}.service";

export const delete${moduleName.pascal}Controller: GuardedRequestHandler = async (
  request,
  response,
) => {
  await delete${moduleName.pascal}Service(request.input("id"));

  return response.noContent();
};
`;
}
/**
* CRUD Routes template
*/
function crudRoutesStub(moduleName) {
	const singular = moduleName.singular;
	const plural = moduleName.plural;
	return `import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";
import { create${singular.pascal}Controller } from "./controllers/create-${singular.kebab}.controller";
import { delete${singular.pascal}Controller } from "./controllers/delete-${singular.kebab}.controller";
import { get${singular.pascal}Controller } from "./controllers/get-${singular.kebab}.controller";
import { list${plural.pascal}Controller } from "./controllers/list-${plural.kebab}.controller";
import { update${singular.pascal}Controller } from "./controllers/update-${singular.kebab}.controller";

guarded(() => {
  router
    .route("/${plural.kebab}")
    .list(list${plural.pascal}Controller)
    .show(get${singular.pascal}Controller)
    .create(create${singular.pascal}Controller)
    .update(update${singular.pascal}Controller)
    .destroy(delete${singular.pascal}Controller);
});
`;
}
/**
* CRUD Model template
*/
function crudModelStub(moduleName) {
	const singular = moduleName.singular;
	const plural = moduleName.plural;
	return `import { Model, RegisterModel } from "@warlock.js/cascade";
import { type Infer, v } from "@warlock.js/core";
import { ${singular.pascal}Resource } from "app/${plural.kebab}/resources/${singular.kebab}.resource";

export const ${singular.camel}Schema = v.object({
  // TODO: Add more fields
});

export type ${singular.pascal}Schema = Infer.Output<typeof ${singular.camel}Schema>;

@RegisterModel()
export class ${singular.pascal} extends Model<${singular.pascal}Schema> {
  public static table = "${plural.snake}";

  public static schema = ${singular.camel}Schema;

  public static relations = {};

  public static resource = ${singular.pascal}Resource;
}
`;
}
/**
* CRUD Resource template
*/
function crudResourceStub(moduleName) {
	return `import { defineResource } from "@warlock.js/core";

export const ${moduleName.singular.pascal}Resource = defineResource({
  schema: {
    id: "number",
    // TODO: Add more resource fields
  },
});
`;
}
/**
* CRUD Repository template
*/
function crudRepositoryStub(entity) {
	const moduleSingularName = entity.singular;
	const modulePluralName = entity.plural;
	return `import type { FilterRules, TypedRepositoryOptions } from "@warlock.js/core";
import { RepositoryManager } from "@warlock.js/core";
import { ${moduleSingularName.pascal} } from "../models/${moduleSingularName.kebab}";

type ${moduleSingularName.pascal}ListFilter = {
  // Repository list filters
};

export type ${moduleSingularName.pascal}ListOptions = TypedRepositoryOptions<${moduleSingularName.pascal}ListFilter>;

class ${modulePluralName.pascal}Repository extends RepositoryManager<${moduleSingularName.pascal}, ${moduleSingularName.pascal}ListOptions> {
  public source = ${moduleSingularName.pascal};

  public simpleSelectColumns: string[] = ["id"];

  public filterBy: FilterRules = {
    id: "=",
  };

  public defaultOptions: RepositoryOptions = {
    orderBy: {
      id: "desc",
    },
  };
}

export const ${modulePluralName.camel}Repository = new ${modulePluralName.pascal}Repository();
`;
}
/**
* CRUD Create Service template
*/
function crudCreateServiceStub(entity) {
	const moduleSingularName = entity.singular;
	return `import { ${moduleSingularName.pascal} } from "../models/${moduleSingularName.kebab}";
import type { Create${moduleSingularName.pascal}Schema } from "../schema/create-${moduleSingularName.kebab}.schema";

export async function create${moduleSingularName.pascal}Service(data: Create${moduleSingularName.pascal}Schema) {
  const ${moduleSingularName.camel} = await ${moduleSingularName.pascal}.create(data);
  return ${moduleSingularName.camel};
}
`;
}
/**
* CRUD Update Service template
*/
function crudUpdateServiceStub(entity) {
	const moduleSingularName = entity.singular;
	return `import { ResourceNotFoundError } from "@warlock.js/core";
import { get${moduleSingularName.pascal}Service } from "./get-${moduleSingularName.kebab}.service";
import type { Update${moduleSingularName.pascal}Schema } from "../schema/update-${moduleSingularName.kebab}.schema";

export async function update${moduleSingularName.pascal}Service(id: number | string, data: Update${moduleSingularName.pascal}Schema) {
  const ${moduleSingularName.camel} = await get${moduleSingularName.pascal}Service(id);

  await ${moduleSingularName.camel}.save({ merge: data });
  return ${moduleSingularName.camel};
}
`;
}
/**
* CRUD List Service template
*/
function crudListServiceStub(entity) {
	const modulePluralName = entity.plural;
	return `import { ${modulePluralName.camel}Repository } from "../repositories/${modulePluralName.kebab}.repository";

export async function list${modulePluralName.pascal}Service(filters: any) {
  return ${modulePluralName.camel}Repository.listCached(filters);
}
`;
}
/**
* CRUD Get Service template
*/
function crudGetServiceStub(entity) {
	return `import { ${entity.plural.camel}Repository } from "../repositories/${entity.plural.kebab}.repository";
import { ResourceNotFoundError } from "@warlock.js/core";

export async function get${entity.singular.pascal}Service(id: number | string) {
  const ${entity.singular.camel} = await ${entity.plural.camel}Repository.getCached(id);

  if (!${entity.singular.camel}) {
    throw new ResourceNotFoundError("${entity.singular.pascal} resource not found!");
  }

  return ${entity.singular.camel};
}
`;
}
/**
* CRUD Delete Service template
*/
function crudDeleteServiceStub(entity) {
	const singular = entity.singular;
	return `import { ResourceNotFoundError } from "@warlock.js/core";
import { get${singular.pascal}Service } from "./get-${singular.kebab}.service";

export async function delete${singular.pascal}Service(id: number | string) {
  const ${singular.camel} = await get${singular.pascal}Service(id);
  if (!${singular.camel}) {
    throw new ResourceNotFoundError("${singular.pascal} not found");
  }
  await ${singular.camel}.destroy();
}
`;
}
/**
* CRUD Seed template
*/
function crudSeedStub(entity) {
	return `import { seeder } from "@warlock.js/core";
import { ${entity.singular.pascal} } from "../models/${entity.singular.kebab}";

export default seeder({
  name: "Seed ${entity.plural.pascal}",
  once: true,
  enabled: true,
  run: async () => {
    const total = 10;
    for (let i = 0; i < total; i++) {
      await ${entity.singular.pascal}.create({
        // TODO: Add more fields
      });
    }

    return {
      recordsCreated: total,
    };
  },
});
`;
}
/**
* Migration template
*/
/**
* Migration Create template
*/
function migrationStub(entityName, options = {}) {
	const { columns = "", imports = [], timestamps = true } = options;
	const allImports = ["Migration", ...imports].join(", ");
	let optionsString = "";
	if (timestamps === false) optionsString = `, { timestamps: false }`;
	return `import { ${allImports} } from "@warlock.js/cascade";
import { ${entityName.pascal} } from "../${entityName.kebab}.model";

export default Migration.create(${entityName.pascal}, {
${columns ? columns : "  // add your columns here, id is auto added to the list"}
}${optionsString});
`;
}
/**
* Migration Alter template
*/
function migrationAlterStub(entityName, options = {}) {
	const { add = "", drop, rename, imports = [] } = options;
	const allImports = ["Migration", ...imports].join(", ");
	const schemaParts = [];
	if (add) schemaParts.push(`  add: {\n${add}\n  },`);
	if (drop) schemaParts.push(`  drop: ${drop},`);
	if (rename) schemaParts.push(`  rename: ${rename},`);
	return `import { ${allImports} } from "@warlock.js/cascade";
import { ${entityName.pascal} } from "../${entityName.kebab}.model";

export default Migration.alter(${entityName.pascal}, {
${schemaParts.join("\n")}
});
`;
}
/**
* CRUD Create Schema template
* Outputs to: schema/create-{entity}.schema.ts
*/
function crudCreateSchemaStub(moduleName) {
	return `import { type Infer, v } from "@warlock.js/seal";

export const create${moduleName.pascal}Schema = v.object({
  // TODO: Add validation rules
});

export type Create${moduleName.pascal}Schema = Infer<typeof create${moduleName.pascal}Schema>;
`;
}
/**
* CRUD Update Schema template
* Outputs to: schema/update-{entity}.schema.ts
*/
function crudUpdateSchemaStub(moduleName) {
	return `import { type Infer, v } from "@warlock.js/seal";

export const update${moduleName.pascal}Schema = v.object({
  // TODO: Add validation rules
});

export type Update${moduleName.pascal}Schema = Infer<typeof update${moduleName.pascal}Schema>;
`;
}
/**
* Service template stub
*/
function serviceStub(name) {
	return `export async function ${name.camel}Service(data: any): Promise<any> {
  // TODO: Implement service logic
  throw new Error("${name.camel}Service not implemented");
}
`;
}
/**
* Schema template stub
* Outputs to: schema/{name}.schema.ts
*/
function schemaStub(name) {
	return `import { type Infer, v } from "@warlock.js/seal";

export const ${name.camel}Schema = v.object({
  // TODO: Define validation schema
});

export type ${name.pascal}Schema = Infer<typeof ${name.camel}Schema>;
`;
}
/**
* Model template stub
*/
function modelStub(name, options = {}) {
	const { tableName = `${name.plural.snake}`, withResource } = options;
	return `import { Model } from "@warlock.js/core";
import type { StrictMode } from "@warlock.js/cascade";
import { v, type Infer } from "@warlock.js/core";
${withResource ? `import { ${name.singular.pascal}Resource } from "../../resources/${name.singular.kebab}.resource";` : ""}

const ${name.singular.camel}Schema = v.object({
  // TODO: Define model schema
});

export type ${name.singular.pascal}Type = Infer.Output<typeof ${name.singular.camel}Schema>;

export class ${name.singular.pascal} extends Model<${name.singular.pascal}Type> {
  public static table = "${tableName}";
  public static strictMode: StrictMode = "fail";
${withResource ? `  public static resource = ${name.singular.pascal}Resource;` : ""}

  public static schema = ${name.singular.camel}Schema;

  public static relations = {
    // TODO: Define relations
  };
}
`;
}
/**
* Repository template stub
*/
function repositoryStub(name) {
	return `import type { FilterByOptions, RepositoryOptions } from "@warlock.js/core";
import { RepositoryManager } from "@warlock.js/core";
import { ${name.singular.pascal} } from "../models/${name.singular.kebab}";

type ${name.singular.pascal}ListFilter = {
  // Repository list filters
};

export type ${name.singular.pascal}ListOptions = RepositoryOptions & ${name.singular.pascal}ListFilter;

export class ${name.plural.pascal}Repository extends RepositoryManager<${name.singular.pascal}, ${name.singular.pascal}ListFilter> {
  public source = ${name.singular.pascal};

  protected defaultOptions: RepositoryOptions = this.withDefaultOptions({});

  protected filterBy: FilterByOptions = this.withDefaultFilters({
    name: "like",
  });
}

export const ${name.plural.camel}Repository = new ${name.plural.pascal}Repository();
`;
}
/**
* Resource template stub
*/
function resourceStub(name) {
	return `import { Resource } from "@warlock.js/core";

export class ${name.singular.pascal}Resource extends Resource {
  public schema = {
    id: "int",
    name: "string",
    // TODO: Define resource schema
  };
}
`;
}
//#endregion
export { controllerStub, crudCreateControllerStub, crudCreateSchemaStub, crudCreateServiceStub, crudDeleteControllerStub, crudDeleteServiceStub, crudGetServiceStub, crudListControllerStub, crudListServiceStub, crudModelStub, crudRepositoryStub, crudResourceStub, crudRoutesStub, crudSeedStub, crudShowControllerStub, crudUpdateControllerStub, crudUpdateSchemaStub, crudUpdateServiceStub, migrationAlterStub, migrationStub, modelStub, repositoryStub, resourceStub, schemaStub, serviceStub };

//# sourceMappingURL=stubs.mjs.map