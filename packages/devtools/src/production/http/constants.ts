/** The header the dashboard sends the CSRF token in. */
export const DEVTOOLS_CSRF_HEADER = "x-devtools-csrf";

/** The session cookie name over HTTPS (`__Secure-` makes browsers refuse it over plain HTTP). */
export const DEVTOOLS_SESSION_COOKIE = "__Secure-warlock-devtools";

/** The session cookie name when `requireHttps` is off (local trials only). */
export const DEVTOOLS_SESSION_COOKIE_INSECURE = "warlock-devtools";

/** The share cookie name over HTTPS. */
export const DEVTOOLS_SHARE_COOKIE = "__Secure-warlock-devtools-share";

/** The share cookie name when `requireHttps` is off (local trials only). */
export const DEVTOOLS_SHARE_COOKIE_INSECURE = "warlock-devtools-share";

/** The longest a share cookie lives, whatever the link's expiry: 12 hours. */
export const DEVTOOLS_SHARE_COOKIE_MAX_SECONDS = 12 * 3600;
