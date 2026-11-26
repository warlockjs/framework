/** Declares the home page's data endpoint. */
import { router } from "@warlock.js/core";
import { homePageController } from "./controllers/home-page.controller";

router.get("/", homePageController);
