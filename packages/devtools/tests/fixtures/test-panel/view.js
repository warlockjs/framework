import { drawBars } from "./graph.js";

export default async function renderTestPanel({ api, el, root }) {
  const { results } = await api("search?q=a");
  root.append(el("h2", { text: "Test panel" }), drawBars(results));
}
