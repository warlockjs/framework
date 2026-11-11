import {
  loginThrottleMiddleware,
  tokenConsumeThrottleMiddleware,
  tokenIssueThrottleMiddleware,
} from "@warlock.js/auth";
import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";
import { forgotPasswordController } from "./controllers/forgot-password.controller";
import { loginController } from "./controllers/login.controller";
import { logoutAllController } from "./controllers/logout-all.controller";
import { logoutController } from "./controllers/logout.controller";
import { meController } from "./controllers/me.controller";
import { refreshTokenController } from "./controllers/refresh-token.controller";
import { resetPasswordController } from "./controllers/reset-password.controller";

// Auth routes. Sign-in and password recovery are open by design (`public: true`)
// and throttled; the rest need a signed-in user.
router.prefix("/auth", () => {
  // Failed sign-ins lock the account and the IP after 5 tries in 15 minutes.
  router.post("/login", loginController, {
    public: true,
    middleware: [loginThrottleMiddleware()],
  });
  router.post("/refresh-token", refreshTokenController, {
    public: true,
    rateLimit: { max: 30, timeWindow: 60_000 },
  });
  // Reset codes: 3 per hour per email and per IP. Reset attempts: 10 failures per
  // 15 minutes per email and per IP, so spreading guesses over many addresses
  // does not help; each code also stops working after 5 wrong tries.
  router.post("/forgot-password", forgotPasswordController, {
    public: true,
    middleware: [tokenIssueThrottleMiddleware()],
  });
  router.post("/reset-password", resetPasswordController, {
    public: true,
    middleware: [tokenConsumeThrottleMiddleware({ by: ["email", "ip"] })],
  });
  guarded(() => {
    router.post("/logout", logoutController);
    router.post("/logout-all", logoutAllController);
    router.get("/me", meController);
  });
});
