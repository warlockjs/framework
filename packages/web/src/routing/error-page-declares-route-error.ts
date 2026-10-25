/** Raised when an error boundary (or the forbidden page) attempts to become a browsable route. */
export class ErrorPageDeclaresRouteError extends Error {
  public constructor(pageFile: string, special: "error" | "forbidden" = "error") {
    super(
      `The ${special} page "${pageFile}" declares \`config.route\`. ${special}.page.tsx is a ${
        special === "error" ? "error boundary" : "special page"
      }, not a browsable page; remove config.route.`,
    );
    this.name = "ErrorPageDeclaresRouteError";
  }
}
