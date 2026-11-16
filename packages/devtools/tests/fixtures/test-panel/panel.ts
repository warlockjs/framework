import type { DevtoolsPanelExport } from "../../../src/types";

/** A module listed in the `panels` option: its default export is a panel factory. */
const devtoolsPanel: DevtoolsPanelExport = ({ root }) => ({
  id: "fixture",
  title: "Fixture",
  view: new URL("./view.js", import.meta.url),
  assets: { "graph.js": new URL("./graph.js", import.meta.url) },
  routes: [{ path: "", handler: () => ({ root }) }],
});

export default devtoolsPanel;
