/**
 * Tracked spec/test files the spec-coverage guard must not treat as orphans.
 */

/**
 * A scaffold template spec belongs to the app the scaffolder GENERATES, not to
 * the package that ships it. It is copied into a new project and runs there,
 * under that project's own vitest config.
 */
export function isScaffoldTemplateFile(relativePath) {
  return relativePath.split(/[\\/]/).includes("templates");
}

/**
 * A test file under `tests/fixtures/` belongs to a fixture app that a spec
 * spawns its own vitest against (for example `vitest-exit-app`). The package's
 * own vitest run must not pick it up, so it is not an orphan.
 */
export function isFixtureAppFile(relativePath) {
  const segments = relativePath.split(/[\\/]/);

  for (let index = 0; index < segments.length - 1; index++) {
    if (segments[index] === "tests" && segments[index + 1] === "fixtures") return true;
  }

  return false;
}

export function isExemptSpecFile(relativePath) {
  return isScaffoldTemplateFile(relativePath) || isFixtureAppFile(relativePath);
}
