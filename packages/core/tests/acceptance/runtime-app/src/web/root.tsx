import type { AppProps } from "@warlock.js/web";
import { Head, Scripts } from "@warlock.js/web";

export default function App({ children }: AppProps) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <Head />
      </head>
      <body>
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
