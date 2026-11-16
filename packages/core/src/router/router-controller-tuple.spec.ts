/**
 * A route registered as a `[controller, "action"]` tuple keeps the controller
 * class name and the action name on the route record.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { router } from "./router";

class PostsController {
  public list() {
    return undefined;
  }
}

class StaticController {
  public static show() {
    return undefined;
  }
}

describe("router controller tuple", () => {
  beforeEach(() => {
    (router as any).routes = [];
  });

  afterEach(() => {
    (router as any).routes = [];
  });

  it("records the class name and the action", () => {
    router.get("/tuple-class", [new PostsController(), "list"]);

    expect(router.list().find((route) => route.path === "/tuple-class")).toMatchObject({
      $controller: "PostsController",
      $action: "list",
    });
  });

  it("records the name of a controller class with static actions", () => {
    router.get("/tuple-static", [StaticController, "show"]);

    expect(router.list().find((route) => route.path === "/tuple-static")).toMatchObject({
      $controller: "StaticController",
      $action: "show",
    });
  });

  it("records a null class for a plain object and leaves function handlers without the fields", () => {
    router.get("/tuple-object", [{ index: () => undefined }, "index"]);
    router.get("/tuple-plain", (() => undefined) as any);

    const routes = router.list();

    expect(routes.find((route) => route.path === "/tuple-object")).toMatchObject({
      $controller: null,
      $action: "index",
    });
    expect(routes.find((route) => route.path === "/tuple-plain")).not.toHaveProperty("$controller");
  });
});
