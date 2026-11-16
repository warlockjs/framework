import type { Plugin } from "vite";

const VITE_REFUSAL = /^Blocked request\. This host \((".*?")\) is not allowed\./;

/**
 * The text a refused host receives in a Warlock app. The bundler's own message
 * tells the reader to edit `server.allowedHosts` in a bundler config file,
 * which a Warlock app does not have; the setting here is `web.devAllowedHosts`.
 */
export function hostRefusalMessage(quotedHost: string): string {
  return (
    `Blocked request. This host (${quotedHost}) is not allowed.\n` +
    `To allow this host, add ${quotedHost} to \`web.devAllowedHosts\` in your web configuration ` +
    "(an entry starting with `.` also matches every subdomain), " +
    "or set `web.devAllowedHosts: true` to turn the host check off."
  );
}

type MiddlewareStack = { route: string; handle: unknown }[];

/**
 * Dev only. The bundler's host check runs before any plugin middleware and
 * answers with a message naming a setting a Warlock app does not have. This
 * puts a wrapper in front of that check and rewrites only that 403 body.
 */
export function hostRefusalPlugin(): Plugin {
  return {
    name: "warlock:host-refusal",
    configureServer(server) {
      const stack = (server.middlewares as unknown as { stack?: MiddlewareStack }).stack;

      const wrapper = (
        _request: unknown,
        response: {
          statusCode: number;
          end: (...args: unknown[]) => unknown;
        },
        next: () => void,
      ) => {
        const end = response.end.bind(response);

        response.end = (...args: unknown[]) => {
          const [body] = args;

          if (response.statusCode === 403 && typeof body === "string") {
            const match = VITE_REFUSAL.exec(body);

            if (match !== null) return end(hostRefusalMessage(match[1]!), ...args.slice(1));
          }

          return end(...args);
        };
        next();
      };

      // The host check is registered before `configureServer` runs, so only a
      // wrapper placed at the head of connect's stack sees its response. A
      // middleware stack without `stack` keeps the bundler's own text.
      if (stack === undefined) return;

      stack.unshift({ route: "", handle: wrapper });
    },
  };
}
