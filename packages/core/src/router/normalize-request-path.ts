/**
 * Canonicalize an incoming request pathname before either router matches it.
 *
 * This is deliberately narrower than `normalizeRoutePath`, which joins route
 * declarations and also resolves doubled slashes plus `.` / `..` segments.
 * A request must keep those bytes unchanged; v5.2 only makes one terminal
 * slash optional. The root path is already canonical and must never become an
 * empty string.
 */
export function normalizeRequestPath(pathname: string): string {
  if (pathname === "" || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
