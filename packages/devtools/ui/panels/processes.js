/**
 * The built-in Processes panel: the app's supervised processes from
 * `GET <path>/api/processes`, one card each. It styles itself with the
 * dashboard's panel classes (`card`, `muted`, `empty`) and defines no colours.
 */
export default async function renderProcesses({ api, el, empty, refresh }) {
  const rows = await api();
  const section = el("section", { class: "card detail" }, [
    el("h2", { text: "Processes" }),
    el("p", {
      class: "muted",
      text: rows.length
        ? `${rows.length} supervised ${rows.length === 1 ? "process" : "processes"}`
        : "",
    }),
    el("div", {}, [el("button", { text: "Refresh", onclick: () => refresh() })]),
  ]);
  if (!rows.length)
    section.append(empty("No supervised processes. Configure with warlock add process."));
  for (const row of rows) {
    section.append(el("pre", { text: JSON.stringify(row, null, 2) }));
  }
  return section;
}
