import type { ErrorPageProps } from "@warlock.js/web";

export default function ForbiddenPage({ status }: ErrorPageProps) {
  return (
    <main className="forbidden">
      <div className="forbidden__content">
        <h1>{status}</h1>
        <p className="forbidden__title">You do not have access to this page.</p>
        <p className="forbidden__description">
          Sign in with an account that has access, or head back to the home page.
        </p>
        <a className="forbidden__action" href="/">
          Return home
        </a>
      </div>
    </main>
  );
}
