import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiPanel, DOCS_VIEWER_KEY } from "@/panels/api";
import { renderPanel } from "./helpers";

beforeEach(() => localStorage.clear());

describe("API panel", () => {
  it("shows Scalar by default and offers the downloads", () => {
    renderPanel(ApiPanel);

    expect(screen.getByTitle("API reference")).toHaveAttribute("src", "docs");
    expect(screen.getByRole("link", { name: "OpenAPI JSON" })).toHaveAttribute("href", "api/openapi.json");
    expect(screen.getByRole("link", { name: "Postman collection" })).toHaveAttribute("href", "api/postman.json");
  });

  it("switches to Swagger UI and remembers the choice", async () => {
    const user = userEvent.setup();

    renderPanel(ApiPanel);
    await user.click(screen.getByRole("button", { name: "Swagger UI" }));

    expect(screen.getByTitle("API reference")).toHaveAttribute("src", "docs/swagger");
    expect(localStorage.getItem(DOCS_VIEWER_KEY)).toBe("swagger");
  });

  it("starts from the saved viewer", () => {
    localStorage.setItem(DOCS_VIEWER_KEY, "swagger");
    renderPanel(ApiPanel);

    expect(screen.getByTitle("API reference")).toHaveAttribute("src", "docs/swagger");
  });
});
