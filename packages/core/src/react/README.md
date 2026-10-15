# React

React server-side rendering support. Provides `renderReact()` which converts React components/elements to HTML strings. Resolves `react` and `react-dom/server` lazily and **synchronously** on the first call that needs them, so importing the package never loads React into apps that do not render, and `renderReact()` either has both modules or throws. Missing packages throw a clear error with install instructions; a package that is present but fails to load surfaces its own error instead, naming the specifier that actually failed.

## Key Files

| File       | Purpose                                                           |
| ---------- | ----------------------------------------------------------------- |
| `index.ts` | `renderReact()` function — renders React elements to HTML strings |

## Key Exports

- `renderReact(element)` — renders a `ReactElement`, `ComponentType`, or `ReactNode` to an HTML string

## Dependencies

### Internal (within `core/src`)

- None

### External

- `node:module` — `createRequire`, for synchronous resolution from an ESM module
- `react` — optional peer dependency, resolved on first render
- `react-dom/server` — optional peer dependency (`renderToString`), resolved on first render as a separate specifier so its failures are reported as its own

## Used By

- `mail/react-mail.ts` — renders React-based email templates to HTML
- Application-level SSR use cases
