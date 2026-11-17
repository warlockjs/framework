/**
 * Hash routes of the dashboard.
 *
 *  - `#<tab>[/<route>]`: a tab and its own sub-route
 *  - `#/setup/<token>`, `#/invite/<token>`: sign-in links (the token is read once, then removed from the address)
 *  - `#/account`, `#/admin/users`, `#/admin/audit`, `#/admin/settings`: shell pages
 */
export type AdminPage = "users" | "audit" | "settings";

export type HashRoute =
  | { type: "setup"; token: string }
  | { type: "invite"; token: string }
  | { type: "account" }
  | { type: "admin"; page: AdminPage }
  | { type: "tab"; id: string; route: string };

/** Parses a location hash (with or without the leading `#`). */
export function parseHash(hash: string): HashRoute {
  const value = hash.replace(/^#/, "");

  if (value.startsWith("/")) {
    const [, first = "", second = ""] = value.split("/");

    if (first === "setup" && second) return { type: "setup", token: decodeURIComponent(second) };
    if (first === "invite" && second) return { type: "invite", token: decodeURIComponent(second) };
    if (first === "account") return { type: "account" };
    if (first === "admin") {
      return { type: "admin", page: second === "audit" || second === "settings" ? second : "users" };
    }

    return { type: "tab", id: "", route: "" };
  }

  const slash = value.indexOf("/");

  return slash === -1
    ? { type: "tab", id: value, route: "" }
    : { type: "tab", id: value.slice(0, slash), route: value.slice(slash + 1) };
}

/** The hash of a tab view. */
export function tabHash(id: string, route = ""): string {
  return `#${id}${route ? `/${route}` : ""}`;
}

/** Removes the hash (a sign-in token) from the address bar and the history entry. */
export function clearHash(): void {
  history.replaceState(null, "", location.pathname + location.search);
}
