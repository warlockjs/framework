# Generate Commands

Warlock.js provides a powerful scaffolding system through the `generate` command family (alias `g`). These commands help you quickly generate boilerplate code for various application components while maintaining consistency and following best practices.

## Overview

The generate command system (formerly `create`) scaffolds:

- **Modules** - Complete module structures with all necessary directories
- **Controllers** - Request handlers with optional validation
- **Services** - Business logic functions
- **Models** - Database models with migrations
- **Repositories** - Data access layer
- **Resources** - Response transformers
- **Validation** - Schema definitions with type inference

All generated code follows Warlock.js conventions and the new validation/requests folder structure.

## Quick Start

You can use `generate`, `create` (legacy), or the short alias `g`:

```bash
# Full command
warlock generate.module products

# Master command style
warlock generate module products
warlock g module products

# Alias (if configured in package.json)
npm run gen module products
```

---

## generate.module

Create a complete module structure with all necessary directories and files.

### Syntax

```bash
warlock generate.module <name> [options]
# OR
warlock g module <name> [options]
```

### Arguments

- `<name>` - Module name (kebab-case recommended)

### Options

- `--force, -f` - Overwrite existing module

### Example

```bash
warlock generate.module products
```

### Generated Structure

```
src/app/products/
├── main.ts                  # Module entry point (auto-imported)
├── routes.ts                # Route definitions (auto-imported)
├── controllers/             # Request handlers
├── services/                # Business logic
├── models/                  # Database models
├── repositories/            # Data access layer
├── validation/              # Validation schemas
├── requests/                # Request type definitions
├── resources/               # Response transformers
├── events/                  # Event handlers (auto-imported)
├── types/                   # TypeScript type definitions
└── utils/
    └── locales.ts          # Translations (auto-imported)
```

### Generated Files

#### `main.ts`

```typescript
import { onceConnected } from "@warlock.js/cascade";

// This function will be called once the app is connected to the database
onceConnected(async () => {
  // Module initialization code
  // Register event listeners
  // Setup module-specific configurations
});
```

#### `routes.ts`

```typescript
import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";

// Define your routes here
// Example:
// router.get("/products", listController);
```

#### `utils/locales.ts`

```typescript
import { groupedTranslations } from "@mongez/localization";

groupedTranslations("products", {
  // Add your translations here
});
```

### Next Steps

After creating a module:

1. Define routes in `routes.ts`
2. Create controllers using `generate.controller`
3. Create models using `generate.model`

---

## generate.controller

Create a controller with optional validation schema and request type.

### Syntax

```bash
warlock generate.controller <module>/<name> [options]
# OR
warlock g controller <module>/<name> [options]
```

### Arguments

- `<module>/<name>` - Module and controller name (e.g., `products/create-product`)

### Options

- `--with-validation, -v` - Generate validation schema and request type
- `--force, -f` - Overwrite existing files

### Examples

#### Basic Controller

```bash
warlock generate.controller products/list-products
```

**Generates:**

- `src/app/products/controllers/list-products.controller.ts`

**Output:**

```typescript
import type { RequestHandler, Response } from "@warlock.js/core";

export const listProductsController: RequestHandler = async (request, response: Response) => {
  // TODO: Implement controller logic
  return response.success({});
};
```

#### Controller with Validation

```bash
warlock generate.controller products/create-product --with-validation
```

**Generates:**

- `src/app/products/controllers/create-product.controller.ts`
- `src/app/products/validation/create-product.schema.ts`
- `src/app/products/requests/create-product.request.ts`

**Controller Output:**

```typescript
import type { RequestHandler, Response } from "@warlock.js/core";
import { type CreateProductRequest } from "../requests/create-product.request";
import { createProductSchema } from "../validation/create-product.schema";

export const createProductController: RequestHandler = async (
  request: CreateProductRequest,
  response: Response,
) => {
  // TODO: Implement controller logic
  return response.success({});
};

createProductController.validation = {
  schema: createProductSchema,
};
```

**Validation Schema Output:**

```typescript
import { v, type Infer } from "@warlock.js/core";

export const createProductSchema = v.object({
  // TODO: Define validation schema
});

export type CreateProductSchema = Infer<typeof createProductSchema>;
```

**Request Type Output:**

```typescript
import type { Request } from "@warlock.js/core";
import { type CreateProductSchema } from "../validation/create-product.schema";

export type CreateProductRequest = Request<CreateProductSchema>;
```

### Usage in Routes

```typescript
import { router } from "@warlock.js/core";
import { createProductController } from "./controllers/create-product.controller";

router.post("/products", createProductController);
```

---

## generate.service

Create a service function for business logic.

### Syntax

```bash
warlock generate.service <module>/<name> [options]
# OR
warlock g service <module>/<name> [options]
```

### Arguments

- `<module>/<name>` - Module and service name (e.g., `products/create-product`)

### Options

- `--force, -f` - Overwrite existing files

### Example

```bash
warlock generate.service products/create-product
```

**Generates:**

- `src/app/products/services/create-product.service.ts`

**Output:**

```typescript
export async function createProductService(data: any): Promise<any> {
  // TODO: Implement service logic
  throw new Error("createProductService not implemented");
}
```

### Usage in Controller

```typescript
import { createProductService } from "../services/create-product.service";

export const createProductController: RequestHandler = async (
  request: CreateProductRequest,
  response: Response,
) => {
  const product = await createProductService(request.validated());
  return response.success({ product });
};
```

---

## generate.model

Create a database model with migration and optional resource.

### Syntax

```bash
warlock generate.model <module>/<name> [options]
# OR
warlock g model <module>/<name> [options]
```

### Arguments

- `<module>/<name>` - Module and model name (e.g., `products/product`)

### Options

- `--with-resource, -rs` - Generate resource transformer
- `--table <name>` - Specify custom table name (default: pluralized snake_case)
- `--force, -f` - Overwrite existing files

### Examples

#### Basic Model

```bash
warlock generate.model products/product
```

**Generates:**

- `src/app/products/models/product/product.model.ts`
- `src/app/products/models/product/index.ts`
- `src/app/products/models/product/migrations/YYYY_MM_DD_HHmmss_product.migration.ts`

**Model Output:**

```typescript
import { Model } from "@warlock.js/core";
import type { StrictMode } from "@warlock.js/cascade";
import { v, type Infer } from "@warlock.js/core";

const productSchema = v.object({
  // TODO: Define model schema
  name: v.string().required(),
});

type ProductType = Infer<typeof productSchema>;

export class Product extends Model<ProductType> {
  public static table = "products";
  public static strictMode: StrictMode = "fail";

  public static schema = productSchema;

  public embed = ["id", "name"];
}
```

**Migration Output:**

```typescript
import { Migration } from "@warlock.js/cascade";

export class ProductMigration extends Migration {
  public async up() {
    await this.schema.create("products", (blueprint) => {
      blueprint.id();
      blueprint.string("name");
      // TODO: Define table columns
      blueprint.timestamps();
    });
  }

  public async down() {
    await this.schema.dropIfExists("products");
  }
}
```

#### Model with Resource

```bash
warlock generate.model products/product --with-resource
```

Additionally generates:

- `src/app/products/resources/product.resource.ts`

**Resource Output:**

```typescript
import { Resource } from "@warlock.js/core";

export class ProductResource extends Resource {
  public schema = {
    id: "int",
    name: "string",
    // TODO: Define resource schema
  };
}
```

The model will automatically reference the resource:

```typescript
export class Product extends Model<ProductType> {
  public static resource = ProductResource;
  // ...
}
```

#### Custom Table Name

```bash
warlock generate.model products/product --table products_catalog
```

### Next Steps

After creating a model:

1. Update the model schema in `product.model.ts`
2. Update the migration in `migrations/YYYY_MM_DD_HHmmss_product.migration.ts`
3. Run migration: `warlock migrate`

---

## generate.repository

Create a repository for data access layer.

### Syntax

```bash
warlock generate.repository <module>/<name> [options]
# OR
warlock g repository <module>/<name> [options]
```

### Arguments

- `<module>/<name>` - Module and repository name (e.g., `products/product`)

### Options

- `--force, -f` - Overwrite existing files

### Example

```bash
warlock generate.repository products/product
```

**Generates:**

- `src/app/products/repositories/product.repository.ts`

**Output:**

```typescript
import type { FilterByOptions, RepositoryOptions } from "@warlock.js/core";
import { RepositoryManager } from "@warlock.js/core";
import { Product } from "../models/product";

export class ProductRepository extends RepositoryManager<Product> {
  public source = Product;

  protected defaultOptions: RepositoryOptions = this.withDefaultOptions({});

  protected filterBy: FilterByOptions = this.withDefaultFilters({
    name: "like",
  });
}

export const productRepository = new ProductRepository();
```

### Usage in Service

```typescript
import { productRepository } from "../repositories/product.repository";

export async function createProductService(data: any) {
  return await productRepository.create(data);
}
```

---

## generate.resource

Create a resource transformer for API responses.

### Syntax

```bash
warlock generate.resource <module>/<name> [options]
# OR
warlock g resource <module>/<name> [options]
```

### Arguments

- `<module>/<name>` - Module and resource name (e.g., `products/product`)

### Options

- `--force, -f` - Overwrite existing files

### Example

```bash
warlock generate.resource products/product
```

**Generates:**

- `src/app/products/resources/product.resource.ts`

**Output:**

```typescript
import { Resource } from "@warlock.js/core";

export class ProductResource extends Resource {
  public schema = {
    id: "int",
    name: "string",
    // TODO: Define resource schema
  };
}
```

### Usage in Model

```typescript
import { ProductResource } from "../../resources/product.resource";

export class Product extends Model<ProductType> {
  public static resource = ProductResource;
  // ...
}
```

---

## generate.validation

Create a validation schema with optional request type.

### Syntax

```bash
warlock generate.validation <module>/<name> [options]
# OR
warlock g validation <module>/<name> [options]
```

### Arguments

- `<module>/<name>` - Module and validation name (e.g., `products/create-product`)

### Options

- `--with-request, -r` - Generate request type
- `--force, -f` - Overwrite existing files

### Examples

#### Basic Validation

```bash
warlock generate.validation products/update-product
```

**Generates:**

- `src/app/products/validation/update-product.schema.ts`

**Output:**

```typescript
import { v, type Infer } from "@warlock.js/core";

export const updateProductSchema = v.object({
  // TODO: Define validation schema
});

export type UpdateProductSchema = Infer<typeof updateProductSchema>;
```

#### Validation with Request Type

```bash
warlock generate.validation products/update-product --with-request
```

Additionally generates:

- `src/app/products/requests/update-product.request.ts`

**Request Type Output:**

```typescript
import type { Request } from "@warlock.js/core";
import { type UpdateProductSchema } from "../validation/update-product.schema";

export type UpdateProductRequest = Request<UpdateProductSchema>;
```

---

## Name Transformations

All generate commands automatically handle name transformations:

| Input            | PascalCase      | camelCase       | kebab-case       | snake_case       |
| ---------------- | --------------- | --------------- | ---------------- | ---------------- |
| `create-product` | `CreateProduct` | `createProduct` | `create-product` | `create_product` |
| `CreateProduct`  | `CreateProduct` | `createProduct` | `create-product` | `create_product` |
| `create_product` | `CreateProduct` | `createProduct` | `create-product` | `create_product` |

These transformations are applied automatically in generated code:

- **Class names**: PascalCase (`CreateProduct`, `ProductRepository`)
- **Function names**: camelCase (`createProductService`, `createProductController`)
- **File names**: kebab-case (`create-product.controller.ts`, `create-product.schema.ts`)
- **Table names**: snake_case (`products`, `product_categories`)

---

## Common Workflows

### Creating a Complete CRUD Module

```bash
# 1. Create module
warlock g module products

# 2. Create model with resource
warlock g model products/product --with-resource

# 3. Create repository
warlock g repository products/product

# 4. Create controllers
warlock g controller products/create-product --with-validation
warlock g controller products/update-product --with-validation
warlock g controller products/list-products
warlock g controller products/get-product

# 5. Create services
warlock g service products/create-product
warlock g service products/update-product
warlock g service products/list-products
warlock g service products/get-product
```

### Creating a Simple Feature

```bash
# 1. Create controller with validation
warlock g controller users/change-password --with-validation

# 2. Create service
warlock g service users/change-password
```

### Adding Validation to Existing Controller

```bash
# Create validation and request type separately
warlock g validation users/update-profile --with-request
```

---

## Best Practices

### 1. Module Organization

- Create one module per major feature (e.g., `products`, `orders`, `users`)
- Use sub-modules sparingly; prefer flat structure within a module
- Keep related functionality together

### 2. Naming Conventions

- **Modules**: Plural, kebab-case (`products`, `user-settings`)
- **Models**: Singular, PascalCase (`Product`, `UserSetting`)
- **Controllers**: Action-based, kebab-case (`create-product`, `list-products`)
- **Services**: Match controller names (`create-product.service.ts`)

### 3. Validation Strategy

- Always use `--with-validation` for controllers that accept input
- Keep validation schemas in the `validation/` folder
- Export both schema and inferred type
- Use `--with-request` to generate typed request objects

### 4. Repository Pattern

- Create repositories for all models
- Define filter options in the repository
- Use repositories in services, not directly in controllers

### 5. Resource Transformers

- Use `--with-resource` when creating models
- Define resource schema to control API response shape
- Keep sensitive data out of resources (e.g., passwords, tokens)

---

## Error Handling

### Module Does Not Exist

```bash
$ warlock g controller products/create-product
Error: Module "products" does not exist
Run: warlock g module products
```

**Solution**: Create the module first using `generate.module` (or `g module`)

### File Already Exists

```bash
$ warlock g controller products/create-product
Error: Controller "create-product.controller.ts" already exists
Use --force to overwrite
```

**Solution**: Use `--force` flag to overwrite, or choose a different name

---

## Alias Configuration

If you want to use `gen` or other shortcuts via `npm run`, add this to your `package.json` scripts:

```json
{
  "scripts": {
    "gen": "npx warlock generate",
    "g": "npx warlock generate"
  }
}
```

Then you can run:

```bash
npm run gen module products
npm run g controller users/login
```
