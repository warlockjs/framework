/**
 * The dashboard shell: reads `api/auth/session`, shows the sign-in steps
 * (production) or the tabs from `api/panels`, and renders the open tab
 * (`panels/registry.ts` for built-in tabs, `panel-host/` for package panels).
 *
 * Owner: WP-6 (this is the scaffold's placeholder).
 */
export function App() {
  return (
    <main className="p-6">
      <h1 className="text-lg font-semibold">Warlock Devtools</h1>
    </main>
  );
}
