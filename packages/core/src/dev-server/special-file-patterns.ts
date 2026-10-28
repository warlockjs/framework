import { isTestFile } from "../utils/is-test-file";

const normalize = (path: string) => path.replace(/\\/g, "/");

/** `src/config/**` — any depth, the config key is the raw path */
export const isConfigFile = (path: string) => {
  const normalized = normalize(path);
  return (
    /^src\/config\/.*\.(ts|tsx)$/.test(normalized) &&
    !isTestFile(normalized) &&
    !/\/(?:__tests__|__mocks__|__fixtures__|tests?|fixtures)\//.test(normalized)
  );
};

/** `src/app/main.ts` or `src/app/<module>/main.ts` */
export const isMainFile = (path: string) =>
  !isTestFile(path) && /^src\/app\/([^/]+\/)?main\.(ts|tsx)$/.test(normalize(path));

/** `src/app/<module>/routes.ts` — one level deep */
export const isRouteFile = (path: string) =>
  !isTestFile(path) && /^src\/app\/[^/]+\/routes\.(ts|tsx)$/.test(normalize(path));

/** `src/app/worker.ts` or `src/app/<module>/worker.ts` — mirrors `isMainFile`'s optional module dir */
export const isWorkerFile = (path: string) =>
  !isTestFile(path) && /^src\/app\/([^/]+\/)?worker\.(ts|tsx)$/.test(normalize(path));

/** `src/app/<module>/events/<file>.ts` */
export const isEventFile = (path: string) =>
  !isTestFile(path) && /^src\/app\/[^/]+\/events\/[^/]+\.(ts|tsx)$/.test(normalize(path));

/** `src/app/<module>/utils/locales.ts`, `locales.json` or `locales/<feature>.json` */
export const isLocaleFile = (path: string) =>
  !isTestFile(path) &&
  (/^src\/app\/[^/]+\/utils\/locales\.(ts|tsx|json)$/.test(normalize(path)) ||
    /^src\/app\/[^/]+\/utils\/locales\/[^/]+\.json$/.test(normalize(path)));

/** Source files the dev server can hot-reload; anything else is data (`.sql`, `.json`, …) */
export const isCodeFile = (path: string) =>
  /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(normalize(path));
