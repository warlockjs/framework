# src/app/catalog

Feature: catalog. 7 files, 73 lines.

## Files
- controllers/new-arrivals.controller.ts  controller  Answers the new arrivals request.
- controllers/products.controller.ts  controller  Answers the product list and product detail requests.
- models/product.model.ts  model  A product customers can buy.
- repositories/products.repository.ts  repository  Reads and updates products.
- routes.ts  routes  Registers the catalog's HTTP routes.
- services/new-arrivals.service.ts  service  Lists the newest products sold in the customer's country.
- tests/new-arrivals.test.ts  spec  Proves the new arrivals rules.

## Routes
- GET /api/products
- GET /api/products/new-arrivals
- GET /api/products/:id

## Used by
- src/web (2 files)
- src/app/orders (1 file)
