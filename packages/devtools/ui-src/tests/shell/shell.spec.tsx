import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "@/app/App";
import { NOT_FOUND_EVENT } from "@/api/client";
import { developmentSession, instanceInfo, mockApi, sessionView, signedOut } from "../helpers/api";

vi.mock("@/panels/registry", async () => (await import("../helpers/fake-panels")).fakeRegistry());

const panels = [
  { id: "requests", title: "Requests", type: "built-in", shareable: false },
  { id: "queries", title: "Queries", type: "built-in", shareable: false },
];

describe("shell", () => {
  it("skips sign-in in development and shows the tabs", async () => {
    mockApi({
      "api/auth/session": { body: developmentSession },
      "api/panels": { body: panels },
    });
    render(<App />);

    expect(await screen.findByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(screen.getByText("Development")).toBeInTheDocument();
    expect(screen.queryByLabelText("Instance")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
    expect(await screen.findByText("tab:requests route: instance:all")).toBeInTheDocument();
  });

  it("keeps the header and the other tabs when one tab fails to draw", async () => {
    window.location.hash = "#broken";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockApi({
      "api/auth/session": { body: sessionView() },
      "api/panels": { body: [...panels, { id: "broken", title: "Broken", type: "built-in", shareable: false }] },
    });
    render(<App />);

    expect(await screen.findByText("The Broken view could not be shown")).toBeInTheDocument();
    expect(screen.getByText(/Objects are not valid as a React child/)).toBeInTheDocument();

    await act(async () => {
      window.location.hash = "#queries";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(await screen.findByText("tab:queries route: instance:all")).toBeInTheDocument();
    expect(screen.queryByText("The Broken view could not be shown")).not.toBeInTheDocument();
  });

  it("builds the tabs from api/panels and passes the tab's route", async () => {
    window.location.hash = "#queries/abc/def";
    mockApi({
      "api/auth/session": { body: sessionView() },
      "api/panels": { body: panels },
    });
    render(<App />);

    expect(await screen.findByText("tab:queries route:abc/def instance:all")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Queries" })).toHaveAttribute("aria-current", "page");
  });

  it("renders package panels in the panel host", async () => {
    window.location.hash = "#book";
    mockApi({
      "api/auth/session": { body: sessionView() },
      "api/panels": { body: [...panels, { id: "book", title: "Book", type: "package", shareable: false }] },
    });
    render(<App />);

    expect(await screen.findByRole("link", { name: "Book" })).toBeInTheDocument();
    // No view module can be imported in a spec, so the host reports it instead of failing silently.
    expect(await screen.findByText(/Book panel's view module did not load/)).toBeInTheDocument();
  });

  it("shows the production badge and the instance picker, and passes the choice to the tab", async () => {
    mockApi({
      "api/auth/session": { body: sessionView() },
      "api/panels": { body: panels },
      "api/instances": {
        body: {
          current: instanceInfo.id,
          instances: [instanceInfo, { ...instanceInfo, id: "host:2:xyz", label: "host #2" }],
        },
      },
    });
    render(<App />);

    expect(await screen.findByText("Production — host #1")).toBeInTheDocument();

    const picker = await screen.findByLabelText("Instance");

    await waitFor(() => expect(within(picker).getAllByRole("option")).toHaveLength(3));
    await userEvent.selectOptions(picker, "host:2:xyz");

    expect(await screen.findByText("tab:requests route: instance:host:2:xyz")).toBeInTheDocument();
  });

  it("shows the admin menu to admins only", async () => {
    mockApi({
      "api/auth/session": { body: sessionView() },
      "api/panels": { body: panels },
      "api/instances": { body: { current: instanceInfo.id, instances: [instanceInfo] } },
    });
    const { unmount } = render(<App />);

    expect(await screen.findByRole("button", { name: /Admin/ })).toBeInTheDocument();
    unmount();

    mockApi({
      "api/auth/session": { body: sessionView({ role: "viewer" }) },
      "api/panels": { body: panels },
      "api/instances": { body: { current: instanceInfo.id, instances: [instanceInfo] } },
    });
    render(<App />);

    expect(await screen.findByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Admin/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /admin@example.com/ })).toBeInTheDocument();
  });

  it("sets the CSRF token from the session for later writes", async () => {
    const api = mockApi({
      "api/auth/session": { body: sessionView({ csrf: "token-from-session" }) },
      "api/panels": { body: panels },
      "api/instances": { body: { current: instanceInfo.id, instances: [instanceInfo] } },
      "POST api/auth/logout": { status: 204 },
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /admin@example.com/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() =>
      expect(api.calls.some((call) => call.path === "api/auth/logout")).toBe(true),
    );
    expect(
      api.calls.find((call) => call.path === "api/auth/logout")?.headers.get("X-Devtools-Csrf"),
    ).toBe("token-from-session");
  });

  it("returns to sign-in with a note when an API call answers a bare 404", async () => {
    let signedIn = true;

    mockApi({
      "api/auth/session": () => ({ body: signedIn ? sessionView() : signedOut }),
      "api/panels": { body: panels },
      "api/instances": { body: { current: instanceInfo.id, instances: [instanceInfo] } },
    });
    render(<App />);
    await screen.findByRole("link", { name: "Requests" });

    signedIn = false;
    act(() => {
      window.dispatchEvent(new CustomEvent(NOT_FOUND_EVENT, { detail: { path: "api/requests" } }));
    });

    expect(await screen.findByText("Your session ended. Sign in again.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("says what to do when the session cannot be read", async () => {
    mockApi({
      "api/auth/session": {
        status: 500,
        body: {
          error: "The monitor database is down. Check the server log.",
          code: "server.error",
          ref: "R1",
        },
      },
    });
    render(<App />);

    expect(await screen.findByText(/monitor database is down/)).toBeInTheDocument();
    expect(screen.getByText("Reference: R1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("shell chrome", () => {
  const setup = () =>
    mockApi({
      "api/auth/session": { body: developmentSession },
      "api/panels": {
        body: [...panels, { id: "grimoire", title: "Grimoire", type: "package", shareable: false }],
      },
    });

  it("groups the tabs in sections and puts package panels under Packages", async () => {
    setup();
    render(<App />);

    await screen.findByRole("link", { name: "Requests" });

    const nav = screen.getByRole("navigation", { name: "Dashboard tabs" });

    expect(within(nav).getByText("Monitor")).toBeInTheDocument();
    expect(within(nav).getByText("Packages")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Grimoire" })).toBeInTheDocument();
  });

  it("cycles the theme, saves it and sets the dark class", async () => {
    localStorage.removeItem("warlock-devtools-theme");
    setup();
    render(<App />);

    const toggle = await screen.findByRole("button", { name: /^Theme: system/ });

    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: /^Theme: light/ })).toBeInTheDocument();
    expect(localStorage.getItem("warlock-devtools-theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");

    await userEvent.click(screen.getByRole("button", { name: /^Theme: light/ }));
    expect(localStorage.getItem("warlock-devtools-theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");

    await userEvent.click(screen.getByRole("button", { name: /^Theme: dark/ }));
    expect(localStorage.getItem("warlock-devtools-theme")).toBeNull();

    document.documentElement.classList.remove("dark");
  });

  it("opens the navigation drawer with the menu button and closes it with Escape", async () => {
    setup();
    render(<App />);

    const open = await screen.findByRole("button", { name: "Open navigation" });
    const sidebar = document.getElementById("dashboard-sidebar") as HTMLElement;

    expect(sidebar).toHaveAttribute("data-open", "false");
    await userEvent.click(open);
    expect(sidebar).toHaveAttribute("data-open", "true");
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Close navigation backdrop" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(sidebar).toHaveAttribute("data-open", "false");
    expect(
      screen.queryByRole("button", { name: "Close navigation backdrop" }),
    ).not.toBeInTheDocument();
  });

  it("closes the drawer when a tab is chosen", async () => {
    setup();
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("link", { name: "Queries" }));

    expect(document.getElementById("dashboard-sidebar")).toHaveAttribute("data-open", "false");
  });

  it("opens the command palette with Ctrl+K and jumps to a tab with the keyboard", async () => {
    setup();
    render(<App />);
    await screen.findByRole("link", { name: "Requests" });

    await userEvent.keyboard("{Control>}k{/Control}");

    const input = await screen.findByRole("combobox", { name: "Search tabs and pages" });

    expect(input).toHaveFocus();
    await userEvent.type(input, "quer");

    const options = screen.getAllByRole("option");

    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Queries");

    await userEvent.keyboard("{Enter}");
    expect(window.location.hash).toBe("#queries");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("moves with the arrow keys, says when nothing matches and closes with Escape", async () => {
    setup();
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Search tabs and pages" }));

    const input = await screen.findByRole("combobox");

    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1]?.id);

    await userEvent.type(input, "zzzz");
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
