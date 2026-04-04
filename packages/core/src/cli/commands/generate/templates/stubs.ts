import type { ParsedName } from "../types";
import { parseName } from "../utils/name-parser";

/**
 * Controller template stub
 */
export function controllerStub(
  name: ParsedName,
  options: { withValidation?: boolean } = {},
): string {
  const { withValidation } = options;

  return `import type { RequestHandler, Response } from "@warlock.js/core";
${
  withValidation
    ? `import { type ${name.pascal}Request } from "../requests/${name.kebab}.request";
import { ${name.camel}Schema } from "../schema/${name.kebab}.schema";`
    : ""
}

export const ${name.camel}Controller: RequestHandler = async (
  request${withValidation ? `: ${name.pascal}Request` : ""},
  response: Response,
) => {
  // TODO: Implement controller logic
  return response.success({});
};
${
  withValidation
    ? `
${name.camel}Controller.validation = {
  schema: ${name.camel}Schema,
};`
    : ""
}
`;
}

/**
 * CRUD Create Controller template
 * Note: moduleName is the module (plural), we need singular entity name
 */
export function crudCreateControllerStub(moduleName: ParsedName): string {
  // Get singular entity name (e.g., "products" -> "product")
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);

  return `import { type RequestHandler } from "@warlock.js/core";
import { type Create${entity.pascal}Request } from "../requests/create-${entity.kebab}.request";
import { create${entity.pascal}Schema } from "../schema/create-${entity.kebab}.schema";
import { create${entity.pascal}Service } from "../services/create-${entity.kebab}.service";

export const create${entity.pascal}Controller: RequestHandler = async (
  request: Create${entity.pascal}Request,
  response,
) => {
  const ${entity.camel} = await create${entity.pascal}Service(request.validated());

  return response.success({
    ${entity.camel},
  });
};

create${entity.pascal}Controller.validation = {
  schema: create${entity.pascal}Schema,
};
`;
}

/**
 * CRUD Update Controller template
 */
export function crudUpdateControllerStub(moduleName: ParsedName): string {
  // Get singular entity name
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);

  return `import { type RequestHandler } from "@warlock.js/core";
import { type Update${entity.pascal}Request } from "../requests/update-${entity.kebab}.request";
import { update${entity.pascal}Schema } from "../schema/update-${entity.kebab}.schema";
import { update${entity.pascal}Service } from "../services/update-${entity.kebab}.service";

export const update${entity.pascal}Controller: RequestHandler = async (
  request: Update${entity.pascal}Request,
  response,
) => {
  const ${entity.camel} = await update${entity.pascal}Service(request.int("id"), request.validated());

  if (!${entity.camel}) {
    return response.notFound();
  }

  return response.success({
    ${entity.camel},
  });
};

update${entity.pascal}Controller.validation = {
  schema: update${entity.pascal}Schema,
};
`;
}

/**
 * CRUD List Controller template
 */
export function crudListControllerStub(moduleName: ParsedName): string {
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);

  return `import { type RequestHandler } from "@warlock.js/core";
import { list${entity.pascal}sService } from "../services/list-${moduleName.kebab}.service";

export const list${entity.pascal}sController: RequestHandler = async (
  request,
  response,
) => {
  const { data, pagination } = await list${entity.pascal}sService(request.all());

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
export function crudShowControllerStub(moduleName: ParsedName): string {
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);

  return `import { type RequestHandler } from "@warlock.js/core";
import { get${entity.pascal}Service } from "../services/get-${entity.kebab}.service";

export const get${entity.pascal}Controller: RequestHandler = async (
  request,
  response,
) => {
  const ${entity.camel} = await get${entity.pascal}Service(request.int("id"));

  if (!${entity.camel}) {
    return response.notFound();
  }

  return response.success({
    ${entity.camel},
  });
};
`;
}

/**
 * CRUD Delete Controller template
 */
export function crudDeleteControllerStub(moduleName: ParsedName): string {
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);

  return `import { type RequestHandler } from "@warlock.js/core";
import { delete${entity.pascal}Service } from "../services/delete-${entity.kebab}.service";

export const delete${entity.pascal}Controller: RequestHandler = async (
  request,
  response,
) => {
  await delete${entity.pascal}Service(request.int("id"));

  return response.success({
    message: "${entity.pascal} deleted successfully",
  });
};
`;
}

/**
 * CRUD Routes template
 */
export function crudRoutesStub(moduleName: ParsedName): string {
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);

  return `import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";
import { create${entity.pascal}Controller } from "./controllers/create-${entity.kebab}.controller";
import { delete${entity.pascal}Controller } from "./controllers/delete-${entity.kebab}.controller";
import { get${entity.pascal}Controller } from "./controllers/get-${entity.kebab}.controller";
import { list${entity.pascal}sController } from "./controllers/list-${moduleName.kebab}.controller";
import { update${entity.pascal}Controller } from "./controllers/update-${entity.kebab}.controller";

guarded(() => {
  router
    .route("/${moduleName.kebab}")
    .list(list${entity.pascal}sController)
    .show(get${entity.pascal}Controller)
    .create(create${entity.pascal}Controller)
    .update(update${entity.pascal}Controller)
    .destroy(delete${entity.pascal}Controller);
});
`;
}

/**
 * CRUD Model template
 */
export function crudModelStub(moduleName: ParsedName): string {
  // Get singular entity name
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);

  return `import { Model, RegisterModel } from "@warlock.js/cascade";
import { type Infer, v } from "@warlock.js/core";
import { ${entity.pascal}Resource } from "app/${moduleName.kebab}/resources/${entity.kebab}.resource";

export const ${entity.camel}Schema = v.object({
  name: v.string().required(),
  // TODO: Add more fields
});

type ${entity.pascal}Schema = Infer<typeof ${entity.camel}Schema>;

@RegisterModel()
export class ${entity.pascal} extends Model<${entity.pascal}Schema> {
  public static table = "${moduleName.snake}";

  public static schema = ${entity.camel}Schema;

  public static relations = {};

  public static resource = ${entity.pascal}Resource;
}
`;
}

/**
 * CRUD Resource template
 */
export function crudResourceStub(moduleName: ParsedName): string {
  // Get singular entity name
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);

  return `import { defineResource } from "@warlock.js/core";

export const ${entity.pascal}Resource = defineResource({
  schema: {
    id: "number",
    name: "string",
    // TODO: Add more fields
    createdBy: "object",
    updatedBy: "object",
    isActive: "boolean",
  },
});
`;
}

/**
 * CRUD Repository template
 */
export function crudRepositoryStub(moduleName: ParsedName): string {
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);
  return `import type { FilterRules, RepositoryOptions } from "@warlock.js/core";
import { RepositoryManager } from "@warlock.js/core";
import { ${entity.pascal} } from "../models/${entity.kebab}";

class ${entity.pascal}Repository extends RepositoryManager<${entity.pascal}> {
  public source = ${entity.pascal};

  public simpleSelectColumns: string[] = ["id"];

  public filterBy: FilterRules = {
    id: "int",
  };

  public defaultOptions: RepositoryOptions = {
    orderBy: {
      id: "desc",
    },
  };
}

export const ${moduleName.camel}Repository = new ${entity.pascal}Repository();
`;
}

/**
 * CRUD Create Service template
 */
export function crudCreateServiceStub(moduleName: ParsedName): string {
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);
  return `import { ${entity.pascal} } from "../models/${entity.kebab}";
import type { Create${entity.pascal}Schema } from "../schema/create-${entity.kebab}.schema";

export async function create${entity.pascal}Service(data: Create${entity.pascal}Schema) {
  const ${entity.camel} = await ${entity.pascal}.create(data);
  return ${entity.camel};
}
`;
}

/**
 * CRUD Update Service template
 */
export function crudUpdateServiceStub(moduleName: ParsedName): string {
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);
  return `import { ResourceNotFoundError } from "@warlock.js/core";
import { ${entity.pascal} } from "../models/${entity.kebab}";
import type { Update${entity.pascal}Schema } from "../schema/update-${entity.kebab}.schema";

export async function update${entity.pascal}Service(id: number, data: Update${entity.pascal}Schema) {
  const ${entity.camel} = await ${entity.pascal}.find(id);
  if (!${entity.camel}) {
    throw new ResourceNotFoundError("${entity.pascal} not found");
  }
  await ${entity.camel}.save({ merge: data });
  return ${entity.camel};
}
`;
}

/**
 * CRUD List Service template
 */
export function crudListServiceStub(moduleName: ParsedName): string {
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);
  return `import { ${moduleName.camel}Repository } from "../repositories/${moduleName.kebab}.repository";

export async function list${entity.pascal}sService(filters: any) {
  return ${moduleName.camel}Repository.listCached(filters);
}
`;
}

/**
 * CRUD Get Service template
 */
export function crudGetServiceStub(moduleName: ParsedName): string {
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);
  return `import { ${moduleName.camel}Repository } from "../repositories/${moduleName.kebab}.repository";

export async function get${entity.pascal}Service(id: number) {
  return ${moduleName.camel}Repository.getCached(id);
}
`;
}

/**
 * CRUD Delete Service template
 */
export function crudDeleteServiceStub(moduleName: ParsedName): string {
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);
  return `import { ResourceNotFoundError } from "@warlock.js/core";
import { ${entity.pascal} } from "../models/${entity.kebab}";

export async function delete${entity.pascal}Service(id: number) {
  const ${entity.camel} = await ${entity.pascal}.find(id);
  if (!${entity.camel}) {
    throw new ResourceNotFoundError("${entity.pascal} not found");
  }
  await ${entity.camel}.destroy();
}
`;
}

/**
 * CRUD Seed template
 */
export function crudSeedStub(moduleName: ParsedName): string {
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);
  return `import { Random } from "@mongez/reinforcements";
import { seeder } from "@warlock.js/core";
import { ${entity.pascal} } from "../models/${entity.kebab}";

export default seeder({
  name: "Seed ${entity.pascal}s",
  once: true,
  enabled: true,
  run: async () => {
    const total = 10;
    for (let i = 0; i < total; i++) {
      // await ${entity.pascal}.create({
      //   name: \`${entity.pascal} \${Random.int()}\`,
      //   // TODO: Add more fields
      // });
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
export function migrationStub(entityName: ParsedName): string {
  return `import { Migration } from "@warlock.js/cascade";
import { ${entityName.pascal} } from "../${entityName.kebab}.model";

export default class ${entityName.pascal}Migration extends Migration.for(${entityName.pascal}) {
  /**
    * Migration metadata
  */
  public static createdAt = "${new Date().toISOString()}";

  /**
   * Set migration execution order (If it holds other migrations references)
   */
  public static order = 0;

  public up() {
    // Create table
    this.createTableIfNotExists();

    // Primary key
    this.id();

    // Add your schema fields here
    this.text("name").notNullable();

    // Status
    this.boolean("isActive").default(true);

    // Timestamps
    this.timestamps();
  }

  public down() {
    this.dropTableIfExists();
  }
}
`;
}

/**
 * CRUD Create Schema template
 * Outputs to: schema/create-{entity}.schema.ts
 */
export function crudCreateValidationStub(moduleName: ParsedName): string {
  // Get singular entity name
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);

  return `import { v, type Infer } from "@warlock.js/core";

export const create${entity.pascal}Schema = v.object({
  name: v.string().required(),
  // TODO: Add validation rules
});

export type Create${entity.pascal}Schema = Infer<typeof create${entity.pascal}Schema>;
`;
}

/**
 * CRUD Update Schema template
 * Outputs to: schema/update-{entity}.schema.ts
 */
export function crudUpdateValidationStub(moduleName: ParsedName): string {
  // Get singular entity name
  const entityKebab = moduleName.kebab.endsWith("s")
    ? moduleName.kebab.slice(0, -1)
    : moduleName.kebab;
  const entity = parseName(entityKebab);

  return `import { v, type Infer } from "@warlock.js/core";

export const update${entity.pascal}Schema = v.object({
  name: v.string(),
  // TODO: Add validation rules
});

export type Update${entity.pascal}Schema = Infer<typeof update${entity.pascal}Schema>;
`;
}

/**
 * Service template stub
 */
export function serviceStub(name: ParsedName): string {
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
export function validationStub(name: ParsedName): string {
  return `import { v, type Infer } from "@warlock.js/core";

export const ${name.camel}Schema = v.object({
  // TODO: Define validation schema
});

export type ${name.pascal}Schema = Infer<typeof ${name.camel}Schema>;
`;
}

/**
 * Request type template stub
 */
export function requestStub(name: ParsedName): string {
  return `import type { Request } from "@warlock.js/core";
import { type ${name.pascal}Schema } from "../schema/${name.kebab}.schema";

export type ${name.pascal}Request = Request<${name.pascal}Schema>;
`;
}

/**
 * Model template stub
 */
export function modelStub(
  name: ParsedName,
  options: { tableName?: string; withResource?: boolean } = {},
): string {
  const { tableName = `${name.snake}s`, withResource } = options;

  return `import { Model } from "@warlock.js/core";
import type { StrictMode } from "@warlock.js/cascade";
import { v, type Infer } from "@warlock.js/core";
${withResource ? `import { ${name.pascal}Resource } from "../../resources/${name.kebab}.resource";` : ""}

const ${name.camel}Schema = v.object({
  // TODO: Define model schema
  name: v.string().required(),
});

type ${name.pascal}Type = Infer<typeof ${name.camel}Schema>;

export class ${name.pascal} extends Model<${name.pascal}Type> {
  public static table = "${tableName}";
  public static strictMode: StrictMode = "fail";
${withResource ? `  public static resource = ${name.pascal}Resource;` : ""}

  public static schema = ${name.camel}Schema;

  public embed = ["id", "name"];
}
`;
}

/**
 * Repository template stub
 */
export function repositoryStub(name: ParsedName): string {
  return `import type { FilterByOptions, RepositoryOptions } from "@warlock.js/core";
import { RepositoryManager } from "@warlock.js/core";
import { ${name.pascal} } from "../models/${name.kebab}";

export class ${name.pascal}Repository extends RepositoryManager<${name.pascal}> {
  public source = ${name.pascal};

  protected defaultOptions: RepositoryOptions = this.withDefaultOptions({});

  protected filterBy: FilterByOptions = this.withDefaultFilters({
    name: "like",
  });
}

export const ${name.camel}Repository = new ${name.pascal}Repository();
`;
}

/**
 * Resource template stub
 */
export function resourceStub(name: ParsedName): string {
  return `import { Resource } from "@warlock.js/core";

export class ${name.pascal}Resource extends Resource {
  public schema = {
    id: "int",
    name: "string",
    // TODO: Define resource schema
  };
}
`;
}

/**
 * Migration template stub
 */
