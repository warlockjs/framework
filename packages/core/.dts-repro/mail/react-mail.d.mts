import React from "react";

//#region ../../@warlock.js/core/src/mail/react-mail.d.ts
/**
 * Render a React element to HTML for email
 *
 * - Uses @react-email/render when installed (full react-email pipeline)
 * - Falls back to react-dom/server renderToStaticMarkup otherwise
 *
 * **Note:** This function requires React packages to be installed.
 * Install them with: `warlock add react` or `npm install react react-dom`
 */
declare function renderReactMail(element: React.ReactElement | React.ComponentType): Promise<string>;
//#endregion
export { renderReactMail };
//# sourceMappingURL=react-mail.d.mts.map