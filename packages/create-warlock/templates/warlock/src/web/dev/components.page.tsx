import { useTextDirection, useTrans } from "@warlock.js/web";

/**
 * Every control the app uses, in one place, so the design system's
 * `design-system/components` criteria can be looked at in each language.
 * Development only (the loader answers "not found" in production).
 */
export default function ComponentsPage() {
  const translate = useTrans();
  const direction = useTextDirection();

  return (
    <main className="warlock-home" dir={direction} data-components>
      <h1>{translate("components.title")}</h1>
      <h2>{translate("components.headings")}</h2>
      <h3>{translate("components.controls")}</h3>
      {/* A display of the controls: nothing here is sent, so the button is a plain button. */}
      <form className="warlock-contact-form">
        <label htmlFor="components-name">
          <span>{translate("components.name")}</span>
          <input id="components-name" name="name" type="text" />
        </label>
        <label htmlFor="components-email">
          <span>{translate("components.email")}</span>
          <input
            id="components-email"
            name="email"
            type="text"
            inputMode="email"
            autoComplete="email"
            aria-invalid="true"
          />
          <small className="warlock-field-error">{translate("components.error")}</small>
        </label>
        <label htmlFor="components-message">
          <span>{translate("components.message")}</span>
          <textarea id="components-message" name="message" rows={4} />
        </label>
        <button className="warlock-contact-submit" type="button">
          {translate("components.send")}
        </button>
      </form>
    </main>
  );
}
