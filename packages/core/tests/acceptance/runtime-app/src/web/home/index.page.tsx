import type { PageProps } from "@warlock.js/web";
import { useState } from "react";
import type { loader } from "./index.setup";

export default function HomePage({ data }: PageProps<typeof loader>) {
  const [count, setCount] = useState(0);

  return (
    <main>
      <h1 id="runtime-marker">RUNTIME_PAGE_OK</h1>
      <p id="runtime-name">{data.runtime}</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Clicked {count}
      </button>
    </main>
  );
}
