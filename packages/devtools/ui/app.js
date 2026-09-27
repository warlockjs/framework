if (!location.pathname.endsWith("/"))
  location.replace(location.pathname + "/" + location.search + location.hash);

const app = document.querySelector("#app");
const tabs = document.querySelectorAll(".tab");
const state = {
  tab: "requests",
  requests: [],
  details: new Map(),
  mails: [],
  logs: [],
  routes: [],
};

async function api(path, init) {
  const response = await fetch(path, init);
  if (!response.ok && response.status !== 204) {
    let message = response.statusText || `Request failed (${response.status})`;
    try {
      message = (await response.json()).error || message;
    } catch {
      /* response has no JSON error */
    }
    throw new Error(message);
  }
  return response.status === 204 ? undefined : response.json();
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) node.append(child);
  return node;
}

function errorView(error) {
  return el("p", { class: "error", text: `Could not load this view: ${error.message}` });
}
function empty(message) {
  return el("p", { class: "empty", text: message });
}
function time(value) {
  return value ? new Date(value).toLocaleTimeString() : "—";
}
function value(value) {
  return value == null ? "—" : String(value);
}
function sql(query) {
  return (
    query.sql ||
    `${query.collection || "collection"}.${query.command || "command"}\n${JSON.stringify(query.pipeline ?? {}, null, 2)}`
  );
}
function canExplain(query) {
  return query.driver === "postgres" && /^(select|with)\b/i.test((query.sql || "").trim());
}
function setTab(tab) {
  state.tab = tab;
  tabs.forEach((button) => button.classList.toggle("is-active", button.dataset.tab === tab));
  render();
}

function requestRow(request, selected) {
  const status = request.status == null ? "—" : String(request.status);
  return el(
    "button",
    {
      class: `row${selected ? " is-selected" : ""}`,
      type: "button",
      onclick: () => showRequest(request.id),
    },
    [
      el("div", { class: "row-top" }, [
        el("span", { class: "method", text: request.method }),
        el("span", { class: `status-${status[0]}`, text: status }),
      ]),
      el("div", { class: "path", text: request.path }),
      el("div", { class: "meta" }, [
        el("span", { text: `${value(request.durationMs)} ms` }),
        el("span", { text: `${request.queryCount} queries` }),
        request.warningCount
          ? el("span", { class: "badge", text: `⚠ ${request.warningCount}` })
          : document.createTextNode(""),
      ]),
    ],
  );
}

async function showRequest(id) {
  try {
    state.details.set(id, await api(`api/requests/${encodeURIComponent(id)}`));
    state.selectedRequest = id;
    render();
  } catch (error) {
    app.replaceChildren(errorView(error));
  }
}

function waterfall(request) {
  const entries = [
    ...request.phases.map((item) => ({
      label: item.name,
      at: item.startedAt,
      duration: item.durationMs,
    })),
    ...request.queries.map((item) => ({
      label: sql(item).replace(/\s+/g, " ").slice(0, 90),
      at: item.startedAt,
      duration: item.durationMs,
    })),
    ...request.cache.map((item) => ({
      label: `${item.type} ${item.key || item.keys?.join(", ") || ""}`.trim(),
      at: item.at,
      duration: item.durationMs || 0,
    })),
  ];
  if (!entries.length) return empty("No timed work recorded for this request.");
  const duration = Math.max(request.durationMs || 0, 1);
  const box = el("div", { class: "waterfall" });
  entries.forEach((entry) => {
    const start = Math.max(0, Math.min(100, ((entry.at - request.startedAt) / duration) * 100));
    const width = Math.max(0, Math.min(100 - start, (entry.duration / duration) * 100));
    const bar = el("span", { class: "bar" });
    bar.style.setProperty("--start", `${start}%`);
    bar.style.setProperty("--width", `${width}%`);
    box.append(
      el("div", { class: "waterfall-row" }, [
        el("div", { class: "waterfall-label", text: entry.label }),
        el("div", { class: "track" }, bar),
      ]),
    );
  });
  return box;
}

function queryRow(query, requestId) {
  const details = el("div", { class: "query" });
  const head = el("div", { class: "query-head" }, [
    el("span", {
      text: `${query.driver} · ${query.durationMs} ms · ${value(query.rowCount)} rows${query.error ? ` · ${query.error}` : ""}`,
    }),
  ]);
  if (canExplain(query) && requestId) {
    const button = el("button", {
      class: "explain",
      type: "button",
      text: "Explain",
      onclick: async () => {
        button.disabled = true;
        try {
          const result = await api(
            `api/requests/${encodeURIComponent(requestId)}/queries/${encodeURIComponent(query.id)}/explain`,
            { method: "POST" },
          );
          details.append(el("pre", { text: JSON.stringify(result.plan, null, 2) }));
        } catch (error) {
          details.append(el("p", { class: "error", text: error.message }));
        } finally {
          button.disabled = false;
        }
      },
    });
    head.append(button);
  }
  details.append(head, el("pre", { text: sql(query) }));
  if (query.bindings)
    details.append(el("pre", { text: `bindings: ${JSON.stringify(query.bindings, null, 2)}` }));
  return details;
}

function requestDetail(request) {
  const section = el("section", { class: "detail" }, [
    el("h2", {
      text: `${request.method} ${request.path} · ${value(request.status)} · ${value(request.durationMs)} ms`,
    }),
  ]);
  if (request.warnings.length) {
    section.append(el("h3", { text: "Warnings" }));
    request.warnings.forEach((warning) => {
      const children = [el("span", { text: warning.message })];
      if (warning.caller)
        children.push(
          document.createTextNode(" "),
          el("a", {
            href: `vscode://file/${warning.caller.file}:${warning.caller.line}:${warning.caller.column}`,
            text: `${warning.caller.file}:${warning.caller.line}`,
          }),
        );
      section.append(el("div", { class: "warning" }, children));
    });
  }
  section.append(
    el("h3", { text: "Waterfall" }),
    waterfall(request),
    el("h3", { text: "Queries" }),
  );
  section.append(
    request.queries.length
      ? request.queries.map((query) => queryRow(query, request.id))
      : empty("No queries recorded."),
  );
  section.append(
    el("h3", { text: "Request logs" }),
    request.logs.length ? logsList(request.logs) : empty("No logs recorded."),
  );
  section.append(el("h3", { text: "Request mail" }));
  if (request.mails.length)
    request.mails.forEach((id) =>
      section.append(
        el("button", {
          class: "row",
          type: "button",
          text: `Mail ${id}`,
          onclick: () => {
            setTab("mail");
            showMail(id);
          },
        }),
      ),
    );
  else section.append(empty("No mail captured."));
  return section;
}

async function requestsView() {
  const list = el("div", { class: "panel list" });
  try {
    state.requests = await api("api/requests");
  } catch (error) {
    return errorView(error);
  }
  if (!state.requests.length) list.append(empty("No requests yet — make a request to your app"));
  else
    state.requests.forEach((item) =>
      list.append(requestRow(item, item.id === state.selectedRequest)),
    );
  const detail =
    state.selectedRequest && state.details.get(state.selectedRequest)
      ? requestDetail(state.details.get(state.selectedRequest))
      : el("div", { class: "panel" }, empty("Select a request to inspect it."));
  return el("div", { class: "layout" }, [list, detail]);
}

function queriesView() {
  const requests = [...state.details.values()].sort((a, b) => b.startedAt - a.startedAt);
  // This session-only tab intentionally lists queries from request details fetched so far.
  const items = requests
    .flatMap((request) => request.queries.map((query) => ({ query, request })))
    .sort((a, b) => b.query.startedAt - a.query.startedAt);
  return el("section", { class: "card detail" }, [
    el("h2", { text: "Queries from inspected requests" }),
    items.length
      ? items.map(({ query, request }) => queryRow(query, request.id))
      : empty("Select requests to collect their queries in this session."),
  ]);
}

function mailDetail(mail) {
  const section = el("section", { class: "detail" }, [
    el("h2", { text: mail.subject || "(No subject)" }),
  ]);
  const table = el("table");
  const body = el("tbody");
  [
    ["From", mail.from],
    ["To", mail.to?.join(", ")],
    ["Cc", mail.cc?.join(", ")],
    ["Bcc", mail.bcc?.join(", ")],
  ].forEach(([name, item]) =>
    body.append(el("tr", {}, [el("th", { text: name }), el("td", { text: item || "—" })])),
  );
  Object.entries(mail.headers || {}).forEach(([name, item]) =>
    body.append(el("tr", {}, [el("th", { text: name }), el("td", { text: item })])),
  );
  table.append(body);
  section.append(table);
  const content = el("div");
  const htmlButton = el("button", { class: "toggle is-active", type: "button", text: "HTML" });
  const textButton = el("button", { class: "toggle", type: "button", text: "Text" });
  const show = (html) => {
    htmlButton.classList.toggle("is-active", html);
    textButton.classList.toggle("is-active", !html);
    content.replaceChildren(
      html
        ? el("iframe", {
            class: "mail-frame",
            sandbox: "",
            src: `api/mails/${encodeURIComponent(mail.id)}/html`,
            title: "HTML email body",
          })
        : el("pre", { text: mail.text || "No plain-text body." }),
    );
  };
  htmlButton.addEventListener("click", () => show(true));
  textButton.addEventListener("click", () => show(false));
  section.append(
    el("h3", { text: "Body" }),
    el("div", { class: "toolbar" }, [htmlButton, textButton]),
    content,
  );
  show(true);
  section.append(el("h3", { text: "Attachments" }));
  section.append(
    mail.attachments?.length
      ? el(
          "ul",
          { class: "attachments" },
          mail.attachments.map((file) =>
            el("li", {
              text: `${file.filename} · ${file.contentType || "unknown type"} · ${value(file.size)} bytes`,
            }),
          ),
        )
      : empty("No attachments."),
  );
  return section;
}

async function showMail(id) {
  try {
    state.selectedMail = await api(`api/mails/${encodeURIComponent(id)}`);
    render();
  } catch (error) {
    app.replaceChildren(errorView(error));
  }
}
async function mailView() {
  try {
    state.mails = await api("api/mails");
  } catch (error) {
    return errorView(error);
  }
  const list = el("div", { class: "panel list" });
  list.append(
    state.mails.length
      ? state.mails.map((mail) =>
          el(
            "button",
            {
              class: `row${state.selectedMail?.id === mail.id ? " is-selected" : ""}`,
              type: "button",
              onclick: () => showMail(mail.id),
            },
            [
              el("div", { class: "path", text: mail.subject || "(No subject)" }),
              el("div", {
                class: "meta",
                text: `${mail.to.join(", ")} · ${time(mail.capturedAt)}`,
              }),
            ],
          ),
        )
      : empty("No mail captured."),
  );
  return el("div", { class: "layout" }, [
    list,
    state.selectedMail
      ? mailDetail(state.selectedMail)
      : el("div", { class: "panel" }, empty("Select a message to inspect it.")),
  ]);
}

function logsList(logs) {
  const box = el("div");
  logs.forEach((log) => {
    const row = el("div", { class: "query" }, [
      el("div", { class: "query-head" }, [
        el("span", { class: `log-level log-${log.level}`, text: log.level }),
        el("span", { text: `${log.module} · ${log.action} · ${time(log.at)}` }),
      ]),
      el("div", { text: log.message }),
    ]);
    if (log.context !== undefined)
      row.append(
        el("details", {}, [
          el("summary", { text: "Context" }),
          el("pre", { text: JSON.stringify(log.context, null, 2) }),
        ]),
      );
    box.append(row);
  });
  return box;
}
async function logsView() {
  const section = el("section", { class: "card detail" }, [el("h2", { text: "Logs" })]);
  const level = el("select");
  ["", "debug", "info", "warn", "error", "success"].forEach((name) =>
    level.append(el("option", { value: name, text: name || "All levels" })),
  );
  const module = el("input", { placeholder: "Filter module" });
  const output = el("div");
  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (level.value) params.set("level", level.value);
      if (module.value) params.set("module", module.value);
      state.logs = await api(`api/logs?${params}`);
      output.replaceChildren(state.logs.length ? logsList(state.logs) : empty("No logs found."));
    } catch (error) {
      output.replaceChildren(errorView(error));
    }
  };
  level.addEventListener("change", load);
  module.addEventListener("input", load);
  section.append(el("div", { class: "toolbar" }, [level, module]), output);
  await load();
  return section;
}

async function routesView() {
  try {
    state.routes = await api("api/routes");
  } catch (error) {
    return errorView(error);
  }
  const section = el("section", { class: "card detail" }, [el("h2", { text: "Routes" })]);
  const filter = el("input", { placeholder: "Filter routes" });
  const output = el("div");
  const draw = () => {
    const needle = filter.value.toLowerCase();
    const routes = state.routes.filter((route) =>
      `${route.method} ${route.path} ${route.name || ""} ${(route.middleware || []).join(" ")}`
        .toLowerCase()
        .includes(needle),
    );
    if (!routes.length) {
      output.replaceChildren(empty("No routes found."));
      return;
    }
    const table = el("table");
    table.append(
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          ["Method", "Path", "Name", "Middleware"].map((name) => el("th", { text: name })),
        ),
      ),
    );
    table.append(
      el(
        "tbody",
        {},
        routes.map((route) =>
          el("tr", {}, [
            el("td", { text: route.method }),
            el("td", { text: route.path }),
            el("td", { text: route.name || "—" }),
            el("td", { text: (route.middleware || []).join(", ") || "—" }),
          ]),
        ),
      ),
    );
    output.replaceChildren(table);
  };
  filter.addEventListener("input", draw);
  section.append(el("div", { class: "toolbar" }, filter), output);
  draw();
  return section;
}

async function render() {
  try {
    const view =
      state.tab === "requests"
        ? await requestsView()
        : state.tab === "queries"
          ? queriesView()
          : state.tab === "mail"
            ? await mailView()
            : state.tab === "logs"
              ? await logsView()
              : await routesView();
    app.replaceChildren(view);
  } catch (error) {
    app.replaceChildren(errorView(error));
  }
}

tabs.forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
document.querySelector("#clear").addEventListener("click", async () => {
  try {
    await api("api/requests", { method: "DELETE" });
    state.requests = [];
    state.details.clear();
    state.selectedRequest = undefined;
    render();
  } catch (error) {
    app.prepend(errorView(error));
  }
});
const events = new EventSource("api/stream");
for (const type of ["request", "mail", "log"])
  events.addEventListener(type, (event) => {
    try {
      const data = JSON.parse(event.data);
      if (type === "request") {
        state.requests = [data, ...state.requests.filter((item) => item.id !== data.id)].slice(
          0,
          200,
        );
        if (state.tab === "requests") render();
      }
      if (type === "mail") {
        state.mails = [data, ...state.mails.filter((item) => item.id !== data.id)].slice(0, 200);
      }
      if (type === "log") state.logs = [data, ...state.logs].slice(0, 200);
    } catch {
      /* malformed stream data is ignored */
    }
  });
render();
