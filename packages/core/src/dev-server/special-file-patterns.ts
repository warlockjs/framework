const normalize = (path: string) => path.replace(/\\/g, "/");

/** `src/config/**` — any depth, the config key is the raw path */
export const isConfigFile = (path: string) => /^src\/config\/.*\.(ts|tsx)$/.test(normalize(path));

/** `src/app/main.ts` or `src/app/<module>/main.ts` */
export const isMainFile = (path: string) =>
  /^src\/app\/([^/]+\/)?main\.(ts|tsx)$/.test(normalize(path));

/** `src/app/<module>/routes.ts` — one level deep */
export const isRouteFile = (path: string) =>
  /^src\/app\/[^/]+\/routes\.(ts|tsx)$/.test(normalize(path));

/** `src/app/<module>/events/<file>.ts` */
export const isEventFile = (path: string) =>
  /^src\/app\/[^/]+\/events\/[^/]+\.(ts|tsx)$/.test(normalize(path));

/** `src/app/<module>/utils/locales.ts` */
export const isLocaleFile = (path: string) =>
  /^src\/app\/[^/]+\/utils\/locales\.(ts|tsx)$/.test(normalize(path));

/** Source files the dev server can hot-reload; anything else is data (`.sql`, `.json`, …) */
export const isCodeFile = (path: string) =>
  /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(normalize(path));
