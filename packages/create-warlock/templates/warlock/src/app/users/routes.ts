import { router } from "@warlock.js/core";
import { adminMiddleware } from "app/auth/middleware/admin.middleware";
import { guarded } from "app/shared/utils/router";
import { createNewUserController } from "./controllers/create-new-user.controller";
import { listUsersController } from "./controllers/list-users.controller";

// Listing every account (with emails) and creating accounts are admin actions:
// a signed-in user without `role: "admin"` gets 403.
guarded(() => {
  router.group({ middleware: [adminMiddleware] }, () => {
    router.route("/users").list(listUsersController).post(createNewUserController);
  });
});
