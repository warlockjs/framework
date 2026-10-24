import { router } from "@warlock.js/core";

router.get("/app-ping", ({ response }) => response.success({ ok: true }));
