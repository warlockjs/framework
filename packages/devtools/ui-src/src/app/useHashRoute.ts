import { useEffect, useState } from "react";
import { parseHash, type HashRoute } from "@/lib/route";

/** The current location hash as a route; updates on `hashchange`. */
export function useHashRoute(): HashRoute {
  const [hash, setHash] = useState(() => location.hash);

  useEffect(() => {
    const onChange = () => setHash(location.hash);

    window.addEventListener("hashchange", onChange);
    onChange();

    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return parseHash(hash);
}
