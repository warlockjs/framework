/**
 * The static facts of the `shop` fixture project, as a framework adapter
 * would report them, and a fake adapter that returns them.
 *
 * GENERATED together with the fixture's source files: when you change a file
 * under `shop/src`, `shop/mobile` or `shop/e2e`, change its facts here so they
 * agree (`tests/fixture.spec.ts` checks the line counts, headers and paths).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BookAdapter, BookFacts } from "../../src/contracts";

/** Absolute root of the fixture project. */
export const shopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "shop");

/** Everything the fake adapter reports. */
export const shopFacts: BookFacts = {
  files: [
    {
      file: "src/app/catalog/routes.ts",
      module: "src/app/catalog",
      type: "routes",
      lines: 7,
      about: "Registers the catalog's HTTP routes.",
      tags: {},
      exports: [],
      imports: [
        {
          specifier: "./controllers/new-arrivals.controller",
          file: "src/app/catalog/controllers/new-arrivals.controller.ts",
        },
        {
          specifier: "./controllers/products.controller",
          file: "src/app/catalog/controllers/products.controller.ts",
        },
        {
          specifier: "@warlock.js/core",
          file: null,
        },
      ],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/app/catalog/controllers/products.controller.ts",
      module: "src/app/catalog",
      type: "controller",
      lines: 9,
      about: "Answers the product list and product detail requests.",
      tags: {},
      exports: [
        {
          name: "ProductsController",
          about: "Lists products and shows one product.",
        },
      ],
      imports: [
        {
          specifier: "../repositories/products.repository",
          file: "src/app/catalog/repositories/products.repository.ts",
        },
        {
          specifier: "app/shared/utils/money",
          file: "src/app/shared/utils/money.ts",
          typeOnly: true,
        },
      ],
      importedBy: [
        "src/app/catalog/routes.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/catalog/controllers/new-arrivals.controller.ts",
      module: "src/app/catalog",
      type: "controller",
      lines: 8,
      about: "Answers the new arrivals request.",
      tags: {},
      exports: [
        {
          name: "NewArrivalsController",
          about: "Returns the new arrivals for the customer's country.",
        },
      ],
      imports: [
        {
          specifier: "../services/new-arrivals.service",
          file: "src/app/catalog/services/new-arrivals.service.ts",
        },
      ],
      importedBy: [
        "src/app/catalog/routes.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/catalog/services/new-arrivals.service.ts",
      module: "src/app/catalog",
      type: "service",
      lines: 10,
      about: "Lists the newest products sold in the customer's country.",
      tags: {},
      exports: [
        {
          name: "listNewArrivals",
          about: "Returns up to 20 products, newest first.",
        },
      ],
      imports: [
        {
          specifier: "../repositories/products.repository",
          file: "src/app/catalog/repositories/products.repository.ts",
        },
      ],
      importedBy: [
        "src/app/catalog/controllers/new-arrivals.controller.ts",
        "src/app/catalog/tests/new-arrivals.test.ts",
        "src/web/$sites/client/home.setup.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/catalog/repositories/products.repository.ts",
      module: "src/app/catalog",
      type: "repository",
      lines: 11,
      about: "Reads and updates products.",
      tags: {},
      exports: [
        {
          name: "productsRepository",
          about: "Finds products and lowers their stock.",
        },
      ],
      imports: [
        {
          specifier: "../models/product.model",
          file: "src/app/catalog/models/product.model.ts",
        },
        {
          specifier: "@warlock.js/cascade",
          file: null,
        },
      ],
      importedBy: [
        "src/app/catalog/controllers/products.controller.ts",
        "src/app/catalog/services/new-arrivals.service.ts",
        "src/app/orders/services/place-order.service.ts",
        "src/web/$sites/client/products/show.setup.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/catalog/models/product.model.ts",
      module: "src/app/catalog",
      type: "model",
      lines: 8,
      about: "A product customers can buy.",
      tags: {},
      exports: [
        {
          name: "Product",
          about: "A product with its price, stock and country.",
        },
      ],
      imports: [
        {
          specifier: "@warlock.js/cascade",
          file: null,
        },
      ],
      importedBy: [
        "src/app/catalog/repositories/products.repository.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/catalog/tests/new-arrivals.test.ts",
      module: "src/app/catalog",
      type: "spec",
      lines: 20,
      about: "Proves the new arrivals rules.",
      tags: {},
      exports: [],
      imports: [
        {
          specifier: "../services/new-arrivals.service",
          file: "src/app/catalog/services/new-arrivals.service.ts",
        },
        {
          specifier: "vitest",
          file: null,
        },
      ],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/app/orders/routes.ts",
      module: "src/app/orders",
      type: "routes",
      lines: 6,
      about: "Registers the orders' HTTP routes.",
      tags: {},
      exports: [],
      imports: [
        {
          specifier: "./controllers/place-order.controller",
          file: "src/app/orders/controllers/place-order.controller.ts",
        },
        {
          specifier: "@warlock.js/core",
          file: null,
        },
      ],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/app/orders/controllers/place-order.controller.ts",
      module: "src/app/orders",
      type: "controller",
      lines: 8,
      about: "Answers a customer's request to place an order.",
      tags: {},
      exports: [
        {
          name: "PlaceOrderController",
          about: "Places the order in the request body.",
        },
      ],
      imports: [
        {
          specifier: "../services/place-order.service",
          file: "src/app/orders/services/place-order.service.ts",
        },
      ],
      importedBy: [
        "src/app/orders/routes.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/orders/services/place-order.service.ts",
      module: "src/app/orders",
      type: "service",
      lines: 13,
      about: "Places an order and lowers the stock of its products.",
      tags: {},
      exports: [
        {
          name: "placeOrder",
          about: "Saves the order, lowers stock, then sends the confirmation.",
        },
      ],
      imports: [
        {
          specifier: "../events/order-placed.event",
          file: "src/app/orders/events/order-placed.event.ts",
        },
        {
          specifier: "../jobs/send-receipt.job",
          file: "src/app/orders/jobs/send-receipt.job.ts",
        },
        {
          specifier: "../mails/order-confirmation.mail",
          file: "src/app/orders/mails/order-confirmation.mail.ts",
        },
        {
          specifier: "app/catalog/repositories/products.repository",
          file: "src/app/catalog/repositories/products.repository.ts",
        },
      ],
      importedBy: [
        "src/app/orders/controllers/place-order.controller.ts",
        "src/app/orders/tests/place-order.test.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/orders/mails/order-confirmation.mail.ts",
      module: "src/app/orders",
      type: "mail",
      lines: 10,
      about: "Sends the order confirmation email.",
      tags: {},
      exports: [
        {
          name: "sendOrderConfirmation",
          about: "Emails the customer the order number and total.",
        },
      ],
      imports: [
        {
          specifier: "@warlock.js/core",
          file: null,
        },
      ],
      importedBy: [
        "src/app/orders/services/place-order.service.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/orders/jobs/send-receipt.job.ts",
      module: "src/app/orders",
      type: "job",
      lines: 10,
      about: "Sends the receipt after the payment settles.",
      tags: {},
      exports: [
        {
          name: "sendReceiptJob",
          about: "Retries three times, one minute apart.",
        },
      ],
      imports: [
        {
          specifier: "@warlock.js/queue",
          file: null,
        },
      ],
      importedBy: [
        "src/app/orders/services/place-order.service.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/orders/events/order-placed.event.ts",
      module: "src/app/orders",
      type: "event",
      lines: 6,
      about: "Announces that an order was placed.",
      tags: {},
      exports: [
        {
          name: "orderPlaced",
          about: "Emits order.placed with the order id.",
        },
      ],
      imports: [],
      importedBy: [
        "src/app/orders/services/place-order.service.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/orders/notifications/order-shipped.notification.ts",
      module: "src/app/orders",
      type: "source",
      lines: 10,
      about: "Tells the customer the order has shipped.",
      tags: {},
      exports: [
        {
          name: "orderShipped",
          about: "Pushes a notification with the tracking link.",
        },
      ],
      imports: [
        {
          specifier: "@warlock.js/notifications",
          file: null,
        },
      ],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/app/orders/tests/place-order.test.ts",
      module: "src/app/orders",
      type: "spec",
      lines: 20,
      about: "Proves the place-order rules.",
      tags: {},
      exports: [],
      imports: [
        {
          specifier: "../services/place-order.service",
          file: "src/app/orders/services/place-order.service.ts",
        },
        {
          specifier: "vitest",
          file: null,
        },
      ],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/app/auth/routes.ts",
      module: "src/app/auth",
      type: "routes",
      lines: 7,
      about: "Registers the sign-up and login routes.",
      tags: {},
      exports: [],
      imports: [
        {
          specifier: "./controllers/login.controller",
          file: "src/app/auth/controllers/login.controller.ts",
        },
        {
          specifier: "./controllers/register.controller",
          file: "src/app/auth/controllers/register.controller.ts",
        },
        {
          specifier: "@warlock.js/core",
          file: null,
        },
      ],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/app/auth/controllers/login.controller.ts",
      module: "src/app/auth",
      type: "controller",
      lines: 8,
      about: "Answers a login request.",
      tags: {},
      exports: [
        {
          name: "LoginController",
          about: "Opens a session for valid credentials.",
        },
      ],
      imports: [
        {
          specifier: "../services/login.service",
          file: "src/app/auth/services/login.service.ts",
        },
      ],
      importedBy: [
        "src/app/auth/routes.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/auth/controllers/register.controller.ts",
      module: "src/app/auth",
      type: "controller",
      lines: 8,
      about: "Answers a sign-up request.",
      tags: {},
      exports: [
        {
          name: "RegisterController",
          about: "Creates the account and sends the verification email.",
        },
      ],
      imports: [
        {
          specifier: "../services/register.service",
          file: "src/app/auth/services/register.service.ts",
        },
      ],
      importedBy: [
        "src/app/auth/routes.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/auth/services/login.service.ts",
      module: "src/app/auth",
      type: "service",
      lines: 6,
      about: "Checks a customer's email and password and opens a session.",
      tags: {},
      exports: [
        {
          name: "login",
          about: "Returns the session, or null for wrong credentials.",
        },
      ],
      imports: [],
      importedBy: [
        "src/app/auth/controllers/login.controller.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/auth/services/register.service.ts",
      module: "src/app/auth",
      type: "service",
      lines: 6,
      about: "Creates a customer account waiting for email verification.",
      tags: {},
      exports: [
        {
          name: "register",
          about: "Creates the account; it stays unverified until the email link is used.",
        },
      ],
      imports: [],
      importedBy: [
        "src/app/auth/controllers/register.controller.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/app/shared/jobs/delete-unverified.job.ts",
      module: "src/app/shared",
      type: "job",
      lines: 13,
      about: "Deletes accounts that were never verified, seven days after sign-up.",
      tags: {
        feature: [
          "auth",
        ],
      },
      exports: [
        {
          name: "deleteUnverifiedJob",
          about: "Runs daily.",
        },
      ],
      imports: [
        {
          specifier: "@warlock.js/queue",
          file: null,
        },
      ],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/app/shared/utils/money.ts",
      module: "src/app/shared",
      type: "util",
      lines: 6,
      about: "Formats prices in the customer's currency.",
      tags: {},
      exports: [
        {
          name: "formatMoney",
          about: "Returns the price with its currency sign, two decimals.",
        },
      ],
      imports: [],
      importedBy: [
        "src/app/catalog/controllers/products.controller.ts",
      ],
      mobileApp: null,
    },
    {
      file: "src/config/app.ts",
      module: "src/config",
      type: "config",
      lines: 5,
      about: "Names the app and its locales.",
      tags: {},
      exports: [
        {
          name: "default",
          about: null,
        },
      ],
      imports: [],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/web/$sites/client/root.tsx",
      module: "src/web",
      type: "root",
      lines: 5,
      about: "The client site's document shell.",
      tags: {},
      exports: [
        {
          name: "default",
          about: null,
        },
      ],
      imports: [],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/web/$sites/client/layout.tsx",
      module: "src/web",
      type: "layout",
      lines: 5,
      about: "The header, cart count and footer of every client page.",
      tags: {},
      exports: [
        {
          name: "default",
          about: null,
        },
      ],
      imports: [],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/web/$sites/client/home.page.tsx",
      module: "src/web",
      type: "page",
      lines: 11,
      about: "The home page with featured products and new arrivals.",
      tags: {},
      exports: [
        {
          name: "default",
          about: null,
        },
      ],
      imports: [
        {
          specifier: "./home.setup",
          file: "src/web/$sites/client/home.setup.ts",
        },
      ],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/web/$sites/client/home.setup.ts",
      module: "src/web",
      type: "setup",
      lines: 10,
      about: "Loads featured products and new arrivals for the home page.",
      tags: {},
      exports: [
        {
          name: "loader",
          about: "Returns featured products and up to 20 new arrivals.",
        },
      ],
      imports: [
        {
          specifier: "app/catalog/services/new-arrivals.service",
          file: "src/app/catalog/services/new-arrivals.service.ts",
        },
      ],
      importedBy: [
        "src/web/$sites/client/home.page.tsx",
      ],
      mobileApp: null,
    },
    {
      file: "src/web/$sites/client/products/show.page.tsx",
      module: "src/web",
      type: "page",
      lines: 9,
      about: "Shows one product with its price and stock.",
      tags: {},
      exports: [
        {
          name: "default",
          about: null,
        },
      ],
      imports: [
        {
          specifier: "./show.setup",
          file: "src/web/$sites/client/products/show.setup.ts",
        },
      ],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/web/$sites/client/products/show.setup.ts",
      module: "src/web",
      type: "setup",
      lines: 10,
      about: "Loads one product for its page.",
      tags: {},
      exports: [
        {
          name: "loader",
          about: "Returns the product, or a 404 when it does not exist.",
        },
      ],
      imports: [
        {
          specifier: "app/catalog/repositories/products.repository",
          file: "src/app/catalog/repositories/products.repository.ts",
        },
      ],
      importedBy: [
        "src/web/$sites/client/products/show.page.tsx",
      ],
      mobileApp: null,
    },
    {
      file: "src/web/$sites/admin/root.tsx",
      module: "src/web",
      type: "root",
      lines: 5,
      about: "The admin site's document shell.",
      tags: {},
      exports: [
        {
          name: "default",
          about: null,
        },
      ],
      imports: [],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/web/$sites/admin/layout.tsx",
      module: "src/web",
      type: "layout",
      lines: 5,
      about: "The staff menu around every admin page.",
      tags: {},
      exports: [
        {
          name: "default",
          about: null,
        },
      ],
      imports: [],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "src/web/$sites/admin/orders.page.tsx",
      module: "src/web",
      type: "page",
      lines: 5,
      about: "Lists recent orders for staff.",
      tags: {},
      exports: [
        {
          name: "default",
          about: null,
        },
      ],
      imports: [],
      importedBy: [],
      mobileApp: null,
    },
    {
      file: "mobile/app/_layout.tsx",
      module: "mobile/app",
      type: "component",
      lines: 5,
      about: "The tab bar of the mobile app.",
      tags: {},
      exports: [
        {
          name: "default",
          about: null,
        },
      ],
      imports: [],
      importedBy: [],
      mobileApp: "mobile",
    },
    {
      file: "mobile/app/index.tsx",
      module: "mobile/app",
      type: "component",
      lines: 5,
      about: "The home screen with new arrivals.",
      tags: {},
      exports: [
        {
          name: "default",
          about: null,
        },
      ],
      imports: [],
      importedBy: [],
      mobileApp: "mobile",
    },
    {
      file: "mobile/app/products/[id].tsx",
      module: "mobile/app",
      type: "component",
      lines: 5,
      about: "Shows one product with a save button.",
      tags: {},
      exports: [
        {
          name: "default",
          about: null,
        },
      ],
      imports: [],
      importedBy: [],
      mobileApp: "mobile",
    },
  ],
  routes: [
    {
      method: "GET",
      path: "/api/products",
      name: "catalog.products.index",
      sourceFile: "src/app/catalog/routes.ts",
      handler: "ProductsController.index",
      controller: "ProductsController",
      action: "index",
      handlerFile: "src/app/catalog/controllers/products.controller.ts",
      middleware: [],
      auth: {
        required: false,
        userTypes: [],
      },
      isPage: false,
      description: null,
    },
    {
      method: "GET",
      path: "/api/products/new-arrivals",
      name: "catalog.new-arrivals",
      sourceFile: "src/app/catalog/routes.ts",
      handler: "NewArrivalsController.index",
      controller: "NewArrivalsController",
      action: "index",
      handlerFile: "src/app/catalog/controllers/new-arrivals.controller.ts",
      middleware: [],
      auth: {
        required: false,
        userTypes: [],
      },
      isPage: false,
      description: null,
    },
    {
      method: "GET",
      path: "/api/products/:id",
      name: "catalog.products.show",
      sourceFile: "src/app/catalog/routes.ts",
      handler: "ProductsController.show",
      controller: "ProductsController",
      action: "show",
      handlerFile: "src/app/catalog/controllers/products.controller.ts",
      middleware: [],
      auth: {
        required: false,
        userTypes: [],
      },
      isPage: false,
      description: null,
    },
    {
      method: "POST",
      path: "/api/orders",
      name: "orders.place",
      sourceFile: "src/app/orders/routes.ts",
      handler: "PlaceOrderController.store",
      controller: "PlaceOrderController",
      action: "store",
      handlerFile: "src/app/orders/controllers/place-order.controller.ts",
      middleware: [
        "authMiddleware",
      ],
      auth: {
        required: true,
        userTypes: [
          "customer",
        ],
      },
      isPage: false,
      description: null,
    },
    {
      method: "POST",
      path: "/api/register",
      name: "auth.register",
      sourceFile: "src/app/auth/routes.ts",
      handler: "RegisterController.register",
      controller: "RegisterController",
      action: "register",
      handlerFile: "src/app/auth/controllers/register.controller.ts",
      middleware: [],
      auth: {
        required: false,
        userTypes: [],
      },
      isPage: false,
      description: null,
    },
    {
      method: "POST",
      path: "/api/login",
      name: "auth.login",
      sourceFile: "src/app/auth/routes.ts",
      handler: "LoginController.login",
      controller: "LoginController",
      action: "login",
      handlerFile: "src/app/auth/controllers/login.controller.ts",
      middleware: [],
      auth: {
        required: false,
        userTypes: [],
      },
      isPage: false,
      description: null,
    },
    {
      method: "GET",
      path: "/",
      name: "home",
      sourceFile: null,
      handler: "page",
      controller: null,
      action: null,
      handlerFile: "src/web/$sites/client/home.page.tsx",
      middleware: [],
      auth: {
        required: false,
        userTypes: [],
      },
      isPage: true,
      description: null,
    },
    {
      method: "GET",
      path: "/products/:id",
      name: "products.show",
      sourceFile: null,
      handler: "page",
      controller: null,
      action: null,
      handlerFile: "src/web/$sites/client/products/show.page.tsx",
      middleware: [],
      auth: {
        required: false,
        userTypes: [],
      },
      isPage: true,
      description: null,
    },
    {
      method: "GET",
      path: "/admin/orders",
      name: "orders",
      sourceFile: null,
      handler: "page",
      controller: null,
      action: null,
      handlerFile: "src/web/$sites/admin/orders.page.tsx",
      middleware: [],
      auth: {
        required: false,
        userTypes: [],
      },
      isPage: true,
      description: null,
    },
  ],
  sites: [
    {
      id: "client",
      root: "src/web/$sites/client",
      basePath: null,
    },
    {
      id: "admin",
      root: "src/web/$sites/admin",
      basePath: "/admin",
    },
  ],
  pages: [
    {
      site: "client",
      route: "/",
      name: "home",
      file: "src/web/$sites/client/home.page.tsx",
      setupFile: "src/web/$sites/client/home.setup.ts",
      layouts: [
        "src/web/$sites/client/layout.tsx",
      ],
      loaders: [
        "src/web/$sites/client/home.setup.ts",
      ],
      actions: [],
      requires: [],
      reachedFrom: [],
    },
    {
      site: "client",
      route: "/products/:id",
      name: "products.show",
      file: "src/web/$sites/client/products/show.page.tsx",
      setupFile: "src/web/$sites/client/products/show.setup.ts",
      layouts: [
        "src/web/$sites/client/layout.tsx",
      ],
      loaders: [
        "src/web/$sites/client/products/show.setup.ts",
      ],
      actions: [],
      requires: [],
      reachedFrom: [
        {
          type: "link",
          from: "src/web/$sites/client/home.page.tsx",
          line: 7,
        },
      ],
    },
    {
      site: "admin",
      route: "/admin/orders",
      name: "orders",
      file: "src/web/$sites/admin/orders.page.tsx",
      setupFile: null,
      layouts: [
        "src/web/$sites/admin/layout.tsx",
      ],
      loaders: [],
      actions: [],
      requires: [
        "user",
      ],
      reachedFrom: null,
    },
  ],
  mobile: [
    {
      id: "mobile",
      root: "mobile",
      routing: "files",
      routesDir: "mobile/app",
      screens: [
        {
          route: "/",
          file: "mobile/app/index.tsx",
          layouts: [
            "mobile/app/_layout.tsx",
          ],
        },
        {
          route: "/products/[id]",
          file: "mobile/app/products/[id].tsx",
          layouts: [
            "mobile/app/_layout.tsx",
          ],
        },
      ],
    },
  ],
  named: [
    {
      type: "mail",
      name: "order-confirmation",
      file: "src/app/orders/mails/order-confirmation.mail.ts",
    },
    {
      type: "job",
      name: "send-receipt",
      file: "src/app/orders/jobs/send-receipt.job.ts",
    },
    {
      type: "job",
      name: "delete-unverified",
      file: "src/app/shared/jobs/delete-unverified.job.ts",
    },
    {
      type: "event",
      name: "order.placed",
      file: "src/app/orders/events/order-placed.event.ts",
    },
    {
      type: "notification",
      name: "order-shipped",
      file: "src/app/orders/notifications/order-shipped.notification.ts",
    },
  ],
  tests: [
    "src/app/catalog/tests/new-arrivals.test.ts",
    "src/app/orders/tests/place-order.test.ts",
    "e2e/checkout.e2e.ts",
  ],
};

/** How often each adapter method was called. */
export type AdapterCalls = Record<
  "sourceRoots" | "files" | "routes" | "sites" | "pages" | "mobile" | "named" | "tests",
  number
>;

/**
 * A fake adapter over {@link shopFacts} (or `facts`). It never reads the
 * project; `calls` counts the calls so a spec can prove a no-change build
 * called nothing and a file-only question never called `routes`.
 */
export function createShopAdapter(facts: BookFacts = shopFacts): BookAdapter & { calls: AdapterCalls } {
  const calls: AdapterCalls = {
    sourceRoots: 0,
    files: 0,
    routes: 0,
    sites: 0,
    pages: 0,
    mobile: 0,
    named: 0,
    tests: 0,
  };
  const copy = <T>(value: T): T => structuredClone(value);

  return {
    name: "shop-fixture",
    version: "1.0.0",
    calls,
    async sourceRoots() {
      calls.sourceRoots++;
      return ["src", "mobile"];
    },
    async files() {
      calls.files++;
      return copy(facts.files);
    },
    async routes() {
      calls.routes++;
      return copy(facts.routes ?? []);
    },
    async sites() {
      calls.sites++;
      return copy(facts.sites);
    },
    async pages() {
      calls.pages++;
      return copy(facts.pages);
    },
    async mobile() {
      calls.mobile++;
      return copy(facts.mobile);
    },
    async named() {
      calls.named++;
      return copy(facts.named);
    },
    async tests() {
      calls.tests++;
      return copy(facts.tests);
    },
  };
}
