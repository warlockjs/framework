/** Declares the endpoint that switches the visitor's language. */
import { router } from "@warlock.js/core";
import { localeController } from "./controllers/locale.controller";

router.post("/api/locale", localeController, { public: true });
