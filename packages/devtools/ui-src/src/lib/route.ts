/**
 * Hash routes of the dashboard.
 *
 *  - `#<tab>[/<route>]`: a tab and its own sub-route
 *  - `#/setup/<token>`, `#/invite/<token>`: sign-in links (the token is read once, then removed from the address)
 *  - `#/account`, `#/admin/users`, `#/admin/audit`, `#/admin/settings`, `#/admin/shares[?panel=<id>]`: shell pages
 *  - `#/share/<token>` opens a read-only share link (the token is read once, then removed); `#/share` and `#share/<route>` are the open link
 */
export type AdminPage = "users" | "audit" | "settings" | "shares";

export type HashRoute =
  | { type: "setup"; token: string }
  | { type: "invite"; token: string }
  | { type: "share"; token: string | null }
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
    if (first === "share") return { type: "share", token: second ? decodeURIComponent(second) : null };
    if (first === "account") return { type: "account" };
    if (first === "admin") {
      const page = second.split("?")[0];

      return {
        type: "admin",
        page: page === "audit" || page === "settings" || page === "shares" ? page : "users",
      };
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

/** Whether a hash belongs to a read-only share link (`#/share…` or `#share/…`), which needs no sign-in. */
export function isShareHash(hash: string): boolean {
  return /^#?(\/share(\/|$)|share(\/|$))/.test(hash);
}

/** The panel route a share page shows for a hash: `#share/product/x` and `#product/x` give the route, `#/share…` gives `""`. */
export function shareRouteOf(hash: string): string {
  const value = hash.replace(/^#/, "");

  if (value === "" || value.startsWith("/")) return "";

  return value === "share" ? "" : value.replace(/^share\//, "");
}

/** The `panel` of an `#/admin/shares?panel=<id>` hash, or `null`. */
export function sharePanelOf(hash: string): string | null {
  const query = hash.split("?")[1];

  return query ? new URLSearchParams(query).get("panel") : null;
}
