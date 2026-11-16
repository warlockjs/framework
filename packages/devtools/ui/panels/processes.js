/**
 * The built-in Processes panel: the app's supervised processes from
 * `GET <path>/api/processes`, one JSON block each.
 */
export default async function renderProcesses({ api, el, empty, refresh }) {
  const rows = await api();
  const section = el("section", { class: "card detail" }, [el("h2", { text: "Processes" })]);
  section.append(el("button", { text: "Refresh", onclick: () => refresh() }));
  if (!rows.length)
    section.append(empty("No supervised processes. Configure with warlock add process."));
  for (const row of rows) {
    section.append(el("pre", { text: JSON.stringify(row, null, 2) }));
  }
  return section;
}
