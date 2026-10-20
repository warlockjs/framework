import { changeLocaleCode, useLocale, useTextDirection, useTrans } from "@warlock.js/web";
import { useState } from "react";

/** Own the contact section's locale switch and recoverable error state. */
export function useContactLocale() {
  const locale = useLocale();
  const direction = useTextDirection();
  const translate = useTrans();
  const [isSwitchingLocale, setIsSwitchingLocale] = useState(false);
  const [localeError, setLocaleError] = useState("");

  /**
   * Switch locale via the framework's `changeLocaleCode` — no reload, no
   * manual cookie write. The control is disabled while the request is in
   * flight, and a rejection leaves the current locale in place while
   * surfacing an error instead of throwing.
   */
  async function toggleLocale() {
    const nextLocale = locale === "en" ? "ar" : "en";

    setIsSwitchingLocale(true);
    setLocaleError("");

    try {
      await changeLocaleCode(nextLocale);
    } catch (error) {
      setLocaleError(error instanceof Error ? error.message : "Could not update the locale.");
    } finally {
      setIsSwitchingLocale(false);
    }
  }

  return { direction, translate, isSwitchingLocale, localeError, toggleLocale };
}
