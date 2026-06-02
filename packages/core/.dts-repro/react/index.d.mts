import { ComponentType, ReactElement, ReactNode } from "react";

//#region ../../@warlock.js/core/src/react/index.d.ts
/**
 * Render a React element/component to HTML string
 *
 * **Important:** This function requires React packages to be installed.
 * Install them with: `warlock add react` or `yarn add react react-dom`
 *
 * @example
 * ```typescript
 * const html = renderReact(<WelcomeEmail name="John" />);
 * ```
 */
declare function renderReact(reactElement: ReactElement | ComponentType | ReactNode): string;
//#endregion
export { renderReact };
//# sourceMappingURL=index.d.mts.map