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
  requestFilter: { q: "", status: "", method: "" },
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
        request.persisted
          ? el("span", { class: "badge", text: "saved" })
          : document.createTextNode(""),
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

function requestTools(request) {
  const status = el("span", { class: "meta" });
  const button = el("button", {
    type: "button",
    text: "Copy as curl",
    onclick: async () => {
      try {
        const { curl } = await api(`api/requests/${encodeURIComponent(request.id)}/curl`);
        await navigator.clipboard.writeText(curl);
        status.textContent = "Copied. Redacted values stay redacted.";
      } catch (error) {
        status.textContent = `Could not copy: ${error.message}`;
      }
    },
  });
  return el("div", { class: "toolbar" }, [button, status]);
}

/** The parts only the persisted request log keeps: the error, the redacted input and the response. */
function recordSections(record) {
  const sections = [];
  if (record.error) {
    const where = [record.error.phase, record.error.file, record.error.site]
      .filter(Boolean)
      .join(" · ");
    sections.push(
      el("h3", { text: "Error" }),
      el("div", { class: "warning" }, [
        el("span", { text: `${record.error.name}: ${record.error.message}` }),
        where ? el("div", { class: "meta", text: where }) : document.createTextNode(""),
      ]),
    );
    if (record.error.stack) sections.push(el("pre", { text: record.error.stack }));
  }
  const input = {
    headers: record.headers,
    params: record.params,
    query: record.query,
    body: record.body,
    session: record.session,
    ip: record.ip,
  };
  sections.push(
    el("h3", { text: "Request (redacted)" }),
    el("pre", { text: JSON.stringify(input, null, 2) }),
    el("h3", { text: "Response" }),
    el("pre", { text: JSON.stringify({ status: record.status, ...record.response }, null, 2) }),
  );
  if (record.queries?.nPlusOne?.length)
    sections.push(
      el("h3", { text: `Queries (${record.queries.count})` }),
      el("pre", { text: JSON.stringify(record.queries, null, 2) }),
    );
  return sections;
}

function requestFilterQuery() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.requestFilter))
    if (value.trim()) params.set(key, value.trim());
  const text = params.toString();
  return text ? `?${text}` : "";
}

function requestFilterBar() {
  const field = (key, placeholder) =>
    el("input", {
      type: "search",
      placeholder,
      value: state.requestFilter[key],
      onchange: (event) => {
        state.requestFilter[key] = event.target.value;
        render();
      },
    });
  return el("div", { class: "toolbar" }, [
    field("q", "Search url or id"),
    field("status", "Status: 404 or 5xx"),
    field("method", "Method"),
  ]);
}

async function requestDetail(request) {
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
  section.append(requestTools(request));
  if (request.record) section.append(...recordSections(request.record));
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
  section.append(el("h3", { text: "AI runs" }), await requestAiView(request.id));
  return section;
}

async function requestsView() {
  const list = el("div", { class: "panel list" });
  try {
    state.requests = await api(`api/requests${requestFilterQuery()}`);
  } catch (error) {
    return errorView(error);
  }
  list.append(requestFilterBar());
  if (!state.requests.length) list.append(empty("No requests yet — make a request to your app"));
  else
    state.requests.forEach((item) =>
      list.append(requestRow(item, item.id === state.selectedRequest)),
    );
  const detail =
    state.selectedRequest && state.details.get(state.selectedRequest)
      ? await requestDetail(state.details.get(state.selectedRequest))
      : el("div", { class: "panel" }, empty("Select a request to inspect it."));
  return el("div", { class: "layout" }, [list, detail]);
}

function aiUsage(usage, cost) {
  const cacheSemantics =
    usage.inputIncludesCache === false
      ? "input excludes cache tokens"
      : "input includes cache tokens";
  return `${value(usage.input)} input · ${value(usage.output)} output · ${value(usage.cachedTokens)} cache read · ${value(usage.cacheWriteTokens)} cache write · ${cost == null ? "unpriced" : `$${cost.toFixed(6)} USD`} (${cacheSemantics})`;
}

function aiRunSummary(run) {
  return el("div", {}, [
    el("div", {
      class: "row-top",
      text: `${run.name} · ${run.status}${run.incomplete ? " · Incomplete / truncated" : ""} · ${run.duration} ms`,
    }),
    el("div", { class: "meta", text: run.models.join(", ") || "Model unreported" }),
    el("p", { text: aiUsage(run.usage, run.cost) }),
    el("div", {
      class: "meta",
      text: `${run.toolCalls} tool calls · ${run.retries} retries · ${value(run.cacheHits)} provider cache-hit trips · ${run.truncatedTrips} truncated trips · ${run.compactions} applied / ${run.skippedCompactions} skipped compactions · ${run.providerCompactions} provider compactions`,
    }),
    el("div", {
      class: "meta",
      text: `${run.traceId} · ${run.requestId ? `Request ${run.requestId}` : "Background / no request id"}`,
    }),
  ]);
}

function aiGuidance(data) {
  return empty(
    data.message ||
      "Install @warlock.js/ai and @warlock.js/ai-panoptic, restart warlock dev, and enable Panoptic observation.",
  );
}

async function requestAiView(requestId) {
  try {
    const data = await api(`api/ai?requestId=${encodeURIComponent(requestId)}`);
    if (!data.available) return aiGuidance(data);
    const section = el("div");
    if (!data.runs.length) section.append(empty("No AI runs collected for this request yet."));
    for (const run of data.runs) {
      section.append(
        el(
          "button",
          {
            class: "row",
            type: "button",
            onclick: () => {
              state.selectedAiRun = run.traceId;
              state.aiRequestId = requestId;
              setTab("ai");
            },
          },
          aiRunSummary(run),
        ),
      );
    }
    return section;
  } catch (error) {
    return errorView(error);
  }
}

function aiSpan(span, rootStartedAt) {
  const incomplete =
    span.status === "incomplete" ||
    span.error?.type === "AgentIncompleteError" ||
    span.error?.type === "AGENT_INCOMPLETE";
  const start = Date.parse(span.startedAt) - Date.parse(rootStartedAt);
  const section = el("details", { class: "ai-span", open: "" }, [
    el("summary", {
      text: `${span.type} ${span.name} · ${span.status}${incomplete ? " · Incomplete / truncated" : ""} · +${start} ms · ${span.duration} ms`,
    }),
    el("p", { class: "meta", text: `${span.startedAt} → ${span.endedAt}` }),
    el("pre", {
      text: JSON.stringify(
        { usage: span.usage, attributes: span.attributes, error: span.error },
        null,
        2,
      ),
    }),
  ]);
  span.children.forEach((child) => section.append(aiSpan(child, rootStartedAt)));
  return section;
}

async function aiView() {
  const section = el("section", { class: "detail" }, el("h2", { text: "AI runs" }));
  const input = el("input", {
    type: "text",
    placeholder: "HTTP request id (empty for all runs)",
    "aria-label": "Filter AI runs by HTTP request id",
    value: state.aiRequestId || "",
  });
  section.append(
    el(
      "form",
      {
        class: "toolbar",
        onsubmit: (event) => {
          event.preventDefault();
          state.aiRequestId = input.value;
          state.selectedAiRun = undefined;
          render();
        },
      },
      [input, el("button", { type: "submit", text: "Filter / refresh" })],
    ),
  );
  const data = await api(
    `api/ai${state.aiRequestId ? `?requestId=${encodeURIComponent(state.aiRequestId)}` : ""}`,
  );
  if (!data.available) {
    section.append(aiGuidance(data));
    return section;
  }
  if (!data.runs.length) {
    section.append(
      empty(
        "No AI runs yet. Enable Panoptic observation and execute a flow; runs appear when collection completes.",
      ),
    );
    return section;
  }
  const costs = data.runs.filter((run) => run.cost != null);
  section.append(
    el("p", {
      text: `${data.aggregate.traces} runs · ${data.aggregate.usage.input} input tokens · ${data.aggregate.usage.output} output tokens · ${costs.length ? `$${costs.reduce((sum, run) => sum + run.cost, 0).toFixed(6)} USD (reported cost)` : "unpriced"}`,
    }),
  );
  const list = el("div", { class: "panel list" });
  for (const run of data.runs)
    list.append(
      el(
        "button",
        {
          class: `row${run.traceId === state.selectedAiRun ? " is-selected" : ""}`,
          type: "button",
          onclick: () => {
            state.selectedAiRun = run.traceId;
            render();
          },
        },
        aiRunSummary(run),
      ),
    );
  const detail = el("div", { class: "panel detail" });
  const selected = data.runs.find((run) => run.traceId === state.selectedAiRun);
  if (selected) {
    detail.append(aiRunSummary(selected));
    if (selected.requestId)
      detail.append(
        el("button", {
          type: "button",
          text: "Open HTTP request",
          onclick: async () => {
            state.tab = "requests";
            tabs.forEach((button) =>
              button.classList.toggle("is-active", button.dataset.tab === "requests"),
            );
            await showRequest(selected.requestId);
          },
        }),
      );
    try {
      const trace = await api(`api/ai/runs/${encodeURIComponent(selected.traceId)}`);
      detail.append(aiSpan(trace.root, trace.startedAt));
    } catch (error) {
      detail.append(errorView(error));
    }
  } else detail.append(empty("Select a run to inspect tools, retries and compaction metadata."));
  section.append(el("div", { class: "layout" }, [list, detail]));
  return section;
}

function agentRunSummary(run) {
  const cost = run.cost == null ? "unpriced" : `$${run.cost.toFixed(6)} USD`;
  return el("div", {}, [
    el("div", {
      class: "row-top",
      text: `${run.agent} · ${run.status} · ${value(run.durationMs)} ms`,
    }),
    el("div", { class: "meta", text: run.model }),
    el("p", {
      text: `${run.turns} turns · ${run.toolCalls} tool calls · ${run.refusals} refused · ${run.usage.input} input · ${run.usage.output} output · ${cost}`,
    }),
    el("div", {
      class: "meta",
      text: `${run.runId}${run.requestId ? ` · Request ${run.requestId}` : ""}`,
    }),
  ]);
}

function agentToolCall(call) {
  const lines = [
    `${call.name} · ${call.status} · ${call.durationMs} ms`,
    ...(call.refusal ? [`refused: ${call.refusal}`] : []),
    ...(call.error ? [`error: ${call.error.message}`] : []),
  ];
  return el("details", { class: "ai-span", open: call.refusal || call.error ? "" : null }, [
    el("summary", { text: lines.join(" · ") }),
    el("pre", {
      text: JSON.stringify({ input: call.input, output: call.output }, null, 2),
    }),
  ]);
}

function agentTurn(turn, trace) {
  const tokens = turn.toolsOffered.reduce((sum, tool) => sum + tool.tokens, 0);
  const cost = turn.cost == null ? "" : ` · $${turn.cost.toFixed(6)} USD`;
  const section = el("details", { class: "ai-span", open: "" }, [
    el("summary", {
      text: `turn ${turn.index} · ${value(turn.finishReason)} · ${Math.round(turn.durationMs)} ms · ${turn.usage.input} input · ${turn.usage.output} output${cost}`,
    }),
    el("p", {
      class: "meta",
      text: `starts from ${turn.input} · system prompt ${value(turn.systemPromptHash)} · tools ${turn.toolsHash}`,
    }),
    el("p", {
      class: "meta",
      text: `Tools offered (~${tokens} tokens): ${turn.toolsOffered.map((tool) => `${tool.name}@${tool.schemaHash.slice(0, 8)}`).join(", ") || "none"}`,
    }),
  ]);
  if (turn.text) section.append(el("pre", { text: turn.text }));
  turn.toolCalls.forEach((call) => section.append(agentToolCall(call)));
  turn.contract.forEach((event) =>
    section.append(
      el("p", {
        class: "meta",
        text: `contract: ${event.type}${event.tool ? ` ${event.tool}` : ""}${event.name ? ` ${event.name}` : ""}${event.reason ? ` (${event.reason})` : ""}`,
      }),
    ),
  );
  if (turn.error) section.append(el("p", { class: "error", text: turn.error.message }));
  return section;
}

function agentRequestDiff(trace, previous) {
  if (!previous) return empty("No earlier run of this agent to compare with.");
  const tools = (item) =>
    new Map(item.turns.flatMap((turn) => turn.toolsOffered).map((tool) => [tool.name, tool.schemaHash]));
  const now = tools(trace);
  const before = tools(previous);
  const changed = [...now].filter(([name, hash]) => before.has(name) && before.get(name) !== hash);
  const added = [...now.keys()].filter((name) => !before.has(name));
  const removed = [...before.keys()].filter((name) => !now.has(name));
  const prompt =
    trace.systemPrompt?.hash === previous.systemPrompt?.hash ? "same" : "changed";
  const identical =
    prompt === "same" && !changed.length && !added.length && !removed.length;
  return el("p", {
    class: "meta",
    text: identical
      ? `Same system prompt and tool definitions as ${previous.runId}.`
      : `Against ${previous.runId}: system prompt ${prompt}; tools changed: ${changed.map(([name]) => name).join(", ") || "none"}; added: ${added.join(", ") || "none"}; removed: ${removed.join(", ") || "none"}.`,
  });
}

async function agentsView() {
  const section = el("section", { class: "detail" }, el("h2", { text: "Agent runs" }));
  const input = el("input", {
    type: "text",
    placeholder: "HTTP request id (empty for all runs)",
    "aria-label": "Filter agent runs by HTTP request id",
    value: state.agentRequestId || "",
  });
  section.append(
    el(
      "form",
      {
        class: "toolbar",
        onsubmit: (event) => {
          event.preventDefault();
          state.agentRequestId = input.value;
          state.selectedAgentRun = undefined;
          render();
        },
      },
      [input, el("button", { type: "submit", text: "Filter / refresh" })],
    ),
  );
  const data = await api(
    `api/ai/agent-runs${state.agentRequestId ? `?requestId=${encodeURIComponent(state.agentRequestId)}` : ""}`,
  );
  if (!data.available) {
    section.append(empty(data.message || "No agent traces yet."));
    return section;
  }
  if (!data.runs.length) {
    section.append(empty("No agent runs yet. Execute an agent in development; runs appear as turns finish."));
    return section;
  }
  const list = el("div", { class: "panel list" });
  for (const run of data.runs)
    list.append(
      el(
        "button",
        {
          class: `row${run.runId === state.selectedAgentRun ? " is-selected" : ""}`,
          type: "button",
          onclick: () => {
            state.selectedAgentRun = run.runId;
            render();
          },
        },
        agentRunSummary(run),
      ),
    );
  const detail = el("div", { class: "panel detail" });
  const selected = data.runs.find((run) => run.runId === state.selectedAgentRun);
  if (selected) {
    detail.append(agentRunSummary(selected));
    try {
      const trace = await api(`api/ai/agent-runs/${encodeURIComponent(selected.runId)}`);
      const index = data.runs.indexOf(selected);
      const earlier = data.runs.slice(index + 1).find((run) => run.agent === selected.agent);
      const previous = earlier
        ? await api(`api/ai/agent-runs/${encodeURIComponent(earlier.runId)}`).catch(() => undefined)
        : undefined;
      detail.append(el("p", { class: "meta", text: `Input: ${trace.input}` }));
      if (trace.systemPrompt) {
        detail.append(
          el("details", { class: "ai-span" }, [
            el("summary", { text: `System prompt ${trace.systemPrompt.hash}` }),
            el("pre", { text: trace.systemPrompt.text ?? "Text not kept (only the hash is recorded)." }),
          ]),
        );
      }
      detail.append(agentRequestDiff(trace, previous));
      for (const [hash, schema] of Object.entries(trace.toolSchemas))
        detail.append(
          el("details", { class: "ai-span" }, [
            el("summary", { text: `Tool ${schema.name}@${hash.slice(0, 8)}` }),
            el("pre", { text: `${schema.description}\n\n${schema.schema ?? "Schema not kept."}` }),
          ]),
        );
      trace.turns.forEach((turn) => detail.append(agentTurn(turn, trace)));
      if (trace.error) detail.append(el("p", { class: "error", text: trace.error.message }));
    } catch (error) {
      detail.append(errorView(error));
    }
  } else detail.append(empty("Select a run to inspect its prompt, tools, calls and refusals."));
  section.append(el("div", { class: "layout" }, [list, detail]));
  return section;
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

const DOCS_VIEWERS = [
  { id: "scalar", label: "Scalar", src: "docs" },
  { id: "swagger", label: "Swagger UI", src: "docs/swagger" },
];
const DOCS_VIEWER_KEY = "warlock-devtools-docs-viewer";

function savedDocsViewer() {
  try {
    const id = localStorage.getItem(DOCS_VIEWER_KEY);
    return DOCS_VIEWERS.find((viewer) => viewer.id === id) || DOCS_VIEWERS[0];
  } catch {
    return DOCS_VIEWERS[0];
  }
}

function saveDocsViewer(viewer) {
  try {
    localStorage.setItem(DOCS_VIEWER_KEY, viewer.id);
  } catch {
    // Storage can be blocked; the choice then lasts until the tab changes.
  }
}

function apiView() {
  const section = el("section");
  const frame = el("iframe", { class: "docs-frame", title: "API reference" });
  const buttons = DOCS_VIEWERS.map((viewer) =>
    el("button", {
      class: "toggle",
      type: "button",
      text: viewer.label,
    }),
  );
  const show = (viewer) => {
    frame.src = viewer.src;
    buttons.forEach((button, index) =>
      button.classList.toggle("is-active", DOCS_VIEWERS[index] === viewer),
    );
  };
  const pick = (viewer) => {
    saveDocsViewer(viewer);
    show(viewer);
  };
  buttons.forEach((button, index) =>
    button.addEventListener("click", () => pick(DOCS_VIEWERS[index])),
  );
  section.append(
    el("div", { class: "toolbar" }, [
      ...buttons,
      el("a", {
        class: "toolbar-link",
        href: "api/openapi.json",
        download: "openapi.json",
        text: "OpenAPI JSON",
      }),
      el("a", {
        class: "toolbar-link",
        href: "api/postman.json",
        download: "postman.json",
        text: "Postman collection",
      }),
    ]),
    frame,
  );
  show(savedDocsViewer());
  return section;
}

let renderVersion = 0;

async function processesView() {
  const rows = await api("api/processes");
  const section = el("section", { class: "card detail" }, [el("h2", { text: "Processes" })]);
  section.append(el("button", { text: "Refresh", onclick: () => render() }));
  if (!rows.length)
    section.append(empty("No supervised processes. Configure with warlock add process."));
  for (const row of rows) {
    section.append(el("pre", { text: JSON.stringify(row, null, 2) }));
  }
  return section;
}

async function render() {
  const version = ++renderVersion;
  try {
    const view =
      state.tab === "ai"
        ? await aiView()
        : state.tab === "agents"
          ? await agentsView()
          : state.tab === "requests"
          ? await requestsView()
          : state.tab === "queries"
            ? queriesView()
            : state.tab === "mail"
              ? await mailView()
              : state.tab === "logs"
                ? await logsView()
                : state.tab === "routes"
                  ? await routesView()
                  : state.tab === "processes"
                    ? await processesView()
                    : apiView();
    if (version === renderVersion) app.replaceChildren(view);
  } catch (error) {
    if (version === renderVersion) app.replaceChildren(errorView(error));
  }
}

tabs.forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
document.querySelector("#clear").addEventListener("click", async () => {
  try {
    await api("api/requests", { method: "DELETE" });
    state.requests = [];
    state.details.clear();
    state.selectedRequest = undefined;
    state.selectedAiRun = undefined;
    render();
  } catch (error) {
    app.prepend(errorView(error));
  }
});
const events = new EventSource("api/stream");
for (const type of ["request", "mail", "log", "ai", "agent-trace"])
  events.addEventListener(type, (event) => {
    try {
      const data = JSON.parse(event.data);
      if (type === "ai" && (state.tab === "ai" || state.tab === "requests")) render();
      if (type === "agent-trace" && state.tab === "agents") render();
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
