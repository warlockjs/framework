/**
 * The Grimoire tab: a browser ES module that the devtools dashboard loads
 * (`panels/grimoire/view.js`) and that the static export inlines. It builds
 * the DOM with the context's `el()` and `svg()` helpers and sets every string
 * from the data as text, never as HTML. Hash links look like `#grimoire/flow/<feature>/<flow>`.
 *
 * Keep the last line as it is: the static export swaps it out to inline this file.
 */

/** The tabs: `[route, label]`. */
const TABS = [
  ["", "Overview"],
  ["features", "Features"],
  ["apps", "Apps"],
  ["tasks", "Tasks"],
  ["releases", "Releases"],
  ["check", "Check"],
  ["modules", "Modules"],
];

const SVG_WIDTH = 720;
const SVG_HEIGHT = 440;

/** How long a view may take before the skeleton is shown instead of waiting for it (ms). */
const SKELETON_AFTER = 150;

const BUILD_HINT = "Run warlock grimoire build, then reload.";

/** Decode one hash segment; a malformed escape stays as written. */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The value of a located field (`{ value, at }`), or the field itself. */
function plain(field) {
  return field !== null && typeof field === "object" && "value" in field ? field.value : field;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Which tab a hash route belongs to; `null` when it belongs to none. */
function tabOf(route) {
  const type = route.split("/")[0] ?? "";

  switch (type) {
    case "features":
    case "feature":
    case "flow":
      return "features";
    case "apps":
    case "page":
      return "apps";
    case "tasks":
    case "task":
      return "tasks";
    case "releases":
    case "release":
      return "releases";
    case "check":
      return "check";
    case "modules":
    case "file":
    case "route":
      return "modules";
    default:
      return "";
  }
}

/** The hash route (without `#grimoire/`) of a search hit or graph node id, or `null`. */
function targetOf(type, id) {
  const encode = encodeURIComponent;

  switch (type) {
    case "feature":
      return `feature/${encode(id)}`;
    case "flow": {
      const [feature, flow] = id.split("/");
      return `flow/${encode(feature ?? "")}/${encode(flow ?? "")}`;
    }
    case "page":
    case "screen": {
      const space = id.indexOf(" ");
      return space < 0 ? null : `page/${encode(id.slice(0, space))}/${encode(id.slice(space + 1))}`;
    }
    case "block": {
      const [app, page] = id.split("/");
      return `page/${encode(app ?? "")}/${encode(page ?? "")}`;
    }
    case "route": {
      const space = id.indexOf(" ");
      return space < 0
        ? null
        : `route/${encode(id.slice(0, space))}/${encode(id.slice(space + 1))}`;
    }
    case "file":
      return `file/${encode(id)}`;
    case "export":
      return `file/${encode(id.split("#")[0] ?? id)}`;
    case "task":
      return `task/${encode(id)}`;
    default:
      return null;
  }
}

/** The target of a graph node id (`file:src/a.ts`, `feature:auth`, …). */
function nodeTarget(id) {
  const colon = id.indexOf(":");
  const type = id.slice(0, colon);
  const rest = id.slice(colon + 1);

  if (type === "file" || type === "feature" || type === "flow") return targetOf(type, rest);
  // A layout has no view of its own: its blocks are listed on each page that uses it.
  if (type === "page") {
    const [app, page] = rest.split("/");
    return `page/${encodeURIComponent(app ?? "")}/${encodeURIComponent(page ?? "")}`;
  }
  if (type === "block") return targetOf("block", rest);
  return null;
}

/** Cut a long label from the front so the end of a path stays visible. */
function shorten(text, max = 26) {
  return text.length > max ? `…${text.slice(text.length - max + 1)}` : text;
}

const NODE_COLOURS = {
  center: "var(--brand)",
  feature: "var(--chart-2)",
  flow: "var(--chart-1)",
  app: "var(--chart-3)",
  block: "var(--chart-4)",
  layout: "var(--muted-foreground)",
  module: "var(--brand)",
  file: "var(--muted-foreground)",
};

// ── Building blocks ─────────────────────────────────────────────────────────

function link(ctx, text, target, attrs = {}) {
  return ctx.el("a", { href: ctx.href(target), text, ...attrs });
}

/** The tone (`good`, `info`, `warn`, `bad`, or none) a status word is shown in. */
function toneOf(status) {
  switch (status) {
    case "shipped":
    case "passing":
    case "pass":
    case "confirmed":
    case "done":
    case "fresh":
    case "cached":
      return "good";
    case "building":
    case "open":
      return "info";
    case "proposed":
    case "inferred":
    case "warning":
    case "waiting":
    case "stale":
    case "missing":
    case "untested":
      return "warn";
    case "failing":
    case "fail":
    case "error":
      return "bad";
    default:
      return "";
  }
}

function pill(ctx, text, tone = "") {
  return ctx.el("span", { class: tone ? `grimoire-pill is-${tone}` : "grimoire-pill", text });
}

function mono(ctx, text) {
  return ctx.el("span", { class: "grimoire-mono", text });
}

function muted(ctx, text) {
  return ctx.el("span", { class: "grimoire-muted", text });
}

function list(ctx, items) {
  return ctx.el(
    "ul",
    { class: "grimoire-list" },
    items.map((item) => ctx.el("li", {}, item)),
  );
}

/** A table that scrolls inside its card instead of widening the page. */
function table(ctx, headings, rows) {
  return ctx.el("div", { class: "grimoire-scroll" }, [
    ctx.el("table", { class: "grimoire-table" }, [
      ctx.el("thead", {}, [
        ctx.el(
          "tr",
          {},
          headings.map((heading) => ctx.el("th", { scope: "col", text: heading })),
        ),
      ]),
      ctx.el(
        "tbody",
        {},
        rows.map((row) =>
          ctx.el(
            "tr",
            {},
            row.map((cell) => ctx.el("td", {}, cell)),
          ),
        ),
      ),
    ]),
  ]);
}

/** A card with a heading. */
function section(ctx, title, children = []) {
  return ctx.el("section", { class: "grimoire-card" }, [
    ctx.el("h3", { text: title }),
    ...children,
  ]);
}

/** Label and value pairs. */
function facts(ctx, rows) {
  return ctx.el(
    "dl",
    { class: "grimoire-facts" },
    rows.flatMap(([label, value]) => [
      ctx.el("dt", { text: label }),
      ctx.el("dd", {}, value ?? muted(ctx, "none")),
    ]),
  );
}

/** A trail of links back up the hierarchy; the last crumb is the current view. */
function crumbs(ctx, trail) {
  return ctx.el("nav", { class: "grimoire-crumbs", "aria-label": "Breadcrumb" }, [
    ctx.el(
      "ol",
      {},
      trail.map(([label, target], index) =>
        ctx.el("li", {}, [
          index < trail.length - 1 && target !== undefined
            ? link(ctx, label, target)
            : ctx.el("span", { "aria-current": "page", text: label }),
        ]),
      ),
    ),
  ]);
}

/** The title block of a detail view. */
function heading(ctx, title, extras = []) {
  return ctx.el("header", { class: "grimoire-heading" }, [
    ctx.el("h2", { text: title }),
    extras.length ? ctx.el("div", { class: "grimoire-heading-meta" }, extras) : "",
  ]);
}

/** Items as compact chips; past `limit` the rest sits behind a "+N more" button. */
function chipList(ctx, items, make, limit = 8) {
  if (!items.length) return muted(ctx, "none");

  const nodes = items.map(make);
  const holder = ctx.el("div", { class: "grimoire-chips" });
  const more = ctx.el("button", { type: "button", class: "grimoire-more" });
  let open = false;

  const paint = () => {
    const visible = open ? nodes : nodes.slice(0, limit);

    more.textContent = open ? "Show fewer" : `+${nodes.length - limit} more`;
    more.setAttribute("aria-expanded", String(open));
    holder.replaceChildren(...visible, ...(nodes.length > limit ? [more] : []));
  };

  more.addEventListener("click", () => {
    open = !open;
    paint();
  });
  paint();
  return holder;
}

function fileLink(ctx, file) {
  return link(ctx, file, `file/${encodeURIComponent(file)}`, { class: "grimoire-chip" });
}

function fileChips(ctx, files, limit = 8) {
  return chipList(ctx, files, (file) => fileLink(ctx, file), limit);
}

/** `<feature>/<flow>` as a link. */
function flowLink(ctx, ref) {
  const target = targetOf("flow", ref);
  return target === null ? ref : link(ctx, ref, target);
}

function routeLink(ctx, method, path) {
  return link(
    ctx,
    `${method} ${path}`,
    `route/${encodeURIComponent(method)}/${encodeURIComponent(path)}`,
  );
}

/**
 * A filterable, sortable listing: a text box, status buttons with counts, an
 * optional sort menu and an "N of M" line. `render(shown)` returns the one
 * node that fills the body each time the filters change.
 */
function listing(ctx, options) {
  const { el } = ctx;
  const { items, noun, render } = options;
  const state = { text: "", status: "", sort: options.sorts?.[0]?.[0] ?? "" };
  const body = el("div", { class: "grimoire-listing-body" });
  const count = el("p", {
    class: "grimoire-listing-count",
    role: "status",
    "aria-live": "polite",
  });
  const buttons = [];
  const bar = el("div", { class: "grimoire-toolbar" });

  bar.append(
    el("input", {
      type: "search",
      class: "grimoire-filter-input",
      placeholder: `Filter ${noun}`,
      "aria-label": `Filter ${noun}`,
      oninput: (event) => {
        state.text = event.target.value;
        paint();
      },
    }),
  );

  if (options.statusOf) {
    const found = [...new Set(items.map(options.statusOf))];
    const order = options.statusOrder ?? [];
    const statuses = found.sort(
      (left, right) =>
        (order.indexOf(left) < 0 ? 99 : order.indexOf(left)) -
          (order.indexOf(right) < 0 ? 99 : order.indexOf(right)) || left.localeCompare(right),
    );

    if (statuses.length > 1) {
      const group = el("div", { class: "grimoire-filters", role: "group", "aria-label": "Status" });

      for (const status of ["", ...statuses]) {
        const total = status
          ? items.filter((item) => options.statusOf(item) === status).length
          : items.length;
        const button = el("button", {
          type: "button",
          class: "grimoire-filter",
          "aria-pressed": "false",
          text: `${status || "all"} ${total}`,
          onclick: () => {
            state.status = status;
            paint();
          },
        });

        buttons.push([button, status]);
        group.append(button);
      }

      bar.append(group);
    }
  }

  if (options.sorts && options.sorts.length > 1) {
    bar.append(
      el(
        "select",
        {
          class: "grimoire-sort",
          "aria-label": "Sort",
          onchange: (event) => {
            state.sort = event.target.value;
            paint();
          },
        },
        options.sorts.map(([key, label]) => el("option", { value: key, text: `Sort: ${label}` })),
      ),
    );
  }

  function paint() {
    const query = state.text.trim().toLowerCase();
    let shown = items.filter(
      (item) =>
        (!state.status || options.statusOf(item) === state.status) &&
        (!query || options.textOf(item).toLowerCase().includes(query)),
    );
    const sort = options.sorts?.find(([key]) => key === state.sort);

    if (sort) shown = [...shown].sort(sort[2]);

    for (const [button, status] of buttons) {
      button.setAttribute("aria-pressed", String(status === state.status));
    }

    count.textContent = `${shown.length} of ${items.length} ${noun}`;
    body.replaceChildren(
      shown.length
        ? render(shown, items)
        : ctx.empty(`No ${noun} match these filters. Clear the filter to see all ${items.length}.`),
    );
  }

  paint();
  return el("div", { class: "grimoire-listing" }, [bar, count, body]);
}

/** A list of findings: severity, code, message, what to do, and where. */
function findingList(ctx, findings) {
  return ctx.el(
    "ul",
    { class: "grimoire-findings" },
    findings.map((finding) => {
      const place = finding.at ? `${finding.at.file}:${finding.at.line}` : null;
      const file = finding.subject.file;

      return ctx.el("li", { class: "grimoire-finding" }, [
        ctx.el("div", { class: "grimoire-finding-head" }, [
          pill(ctx, finding.severity, toneOf(finding.severity)),
          finding.expected ? pill(ctx, "expected") : "",
          mono(ctx, finding.code),
        ]),
        ctx.el("p", { class: "grimoire-finding-message", text: finding.message }),
        finding.hint ? ctx.el("p", { class: "grimoire-muted", text: finding.hint }) : "",
        place || file
          ? ctx.el("div", { class: "grimoire-chips" }, [
              place ? mono(ctx, place) : "",
              file && file !== finding.at?.file ? fileLink(ctx, file) : "",
            ])
          : "",
      ]);
    }),
  );
}

function changesView(ctx, changes) {
  if (!changes.length) return ctx.empty("No changelog entries.");
  return list(
    ctx,
    changes.map((change) => [
      pill(ctx, change.word),
      ` ${plain(change.version)} `,
      change.flow ? [flowLink(ctx, `${change.feature}/${change.flow}`), " "] : "",
      change.text,
      change.release
        ? ` (release ${change.release}${change.date ? `, ${change.date}` : ""})`
        : " (not released)",
    ]),
  );
}

// ── Graphs ──────────────────────────────────────────────────────────────────

/** Plain SVG for a graph answer: the centre node in the middle, the others on one or two rings. */
function graphView(ctx, graph, title) {
  const { el, svg, empty, href } = ctx;
  const card = el("section", { class: "grimoire-card grimoire-graph" }, [
    el("h3", { text: title }),
  ]);

  if (!graph.nodes.length) {
    card.append(empty("Nothing to draw."));
    return card;
  }

  const centre = graph.nodes.find((node) => node.type === "center");
  const others = graph.nodes.filter((node) => node !== centre);
  const place = new Map();
  const middleX = SVG_WIDTH / 2;
  const middleY = SVG_HEIGHT / 2;

  if (centre) place.set(centre.id, [middleX, middleY]);

  const inner = centre ? Math.min(others.length, 18) : 0;
  const rings = centre ? [others.slice(0, inner), others.slice(inner)] : [others, []];
  rings.forEach((ring, index) => {
    const radiusX = centre ? (index === 0 ? 210 : 320) : 300;
    const radiusY = centre ? (index === 0 ? 150 : 195) : 185;
    ring.forEach((node, position) => {
      const angle =
        (position / Math.max(ring.length, 1)) * 2 * Math.PI - Math.PI / 2 + index * 0.15;
      place.set(node.id, [
        middleX + radiusX * Math.cos(angle),
        middleY + radiusY * Math.sin(angle),
      ]);
    });
  });

  const canvas = svg("svg", {
    viewBox: `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`,
    class: "grimoire-svg",
    role: "img",
    "aria-label": title,
  });

  for (const edge of graph.edges) {
    const from = place.get(edge.from);
    const to = place.get(edge.to);
    if (!from || !to) continue;
    canvas.append(
      svg("line", {
        x1: from[0].toFixed(1),
        y1: from[1].toFixed(1),
        x2: to[0].toFixed(1),
        y2: to[1].toFixed(1),
        stroke: "var(--input)",
        "stroke-width": edge.weight ? String(Math.min(1 + Math.log2(edge.weight), 5)) : "1.2",
      }),
    );
  }

  for (const node of graph.nodes) {
    const at = place.get(node.id);
    if (!at) continue;
    const target = nodeTarget(node.id);
    const circle = svg("circle", {
      cx: at[0].toFixed(1),
      cy: at[1].toFixed(1),
      r: node.type === "center" ? "9" : "6",
      fill: NODE_COLOURS[node.type] ?? "var(--muted-foreground)",
    });
    const label = svg("text", {
      x: at[0].toFixed(1),
      y: (at[1] + (node.type === "center" ? 24 : 18)).toFixed(1),
      "text-anchor": "middle",
      fill: "var(--foreground)",
      "font-size": "11",
      text: shorten(node.label),
    });
    const group = svg("g", {}, [svg("title", { text: node.label }), circle, label]);
    canvas.append(target === null ? group : svg("a", { href: href(target) }, [group]));
  }

  card.append(canvas);
  return card;
}

// ── Views ───────────────────────────────────────────────────────────────────

/** One overview card: a number, what it counts, and where it leads. */
function stat(ctx, { label, value, sub, target, tone = "" }) {
  return ctx.el(
    "a",
    { class: tone ? `grimoire-stat is-${tone}` : "grimoire-stat", href: ctx.href(target) },
    [
      ctx.el("span", { class: "grimoire-stat-label", text: label }),
      ctx.el("span", { class: "grimoire-stat-value", text: String(value) }),
      ctx.el("span", { class: "grimoire-stat-sub", text: sub }),
    ],
  );
}

const STATUS_ORDER = ["shipped", "building", "proposed", "retired"];

async function overviewView(ctx, summaryRequest) {
  const [data, check, releases] = await Promise.all([
    summaryRequest,
    ctx.api("check").catch(() => null),
    ctx.api("releases").catch(() => null),
  ]);
  const { el } = ctx;
  const features = data.features.features;
  const byStatus = new Map();

  for (const item of features) byStatus.set(item.status, (byStatus.get(item.status) ?? 0) + 1);

  const flows = features.reduce((total, item) => total + item.flows.length, 0);
  const statusLine = [...byStatus.entries()]
    .sort(([a], [b]) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b))
    .map(([status, total]) => `${total} ${status}`)
    .join(", ");
  const waiting = data.tasks.waiting.length;
  const open = data.tasks.open.length - waiting;
  const stale = data.routes === "stale" || data.routes === "missing";
  const out = el("div", { class: "grimoire-view" });

  out.append(
    el("div", { class: "grimoire-stats" }, [
      stat(ctx, {
        label: "Features",
        value: features.length,
        sub: features.length ? `${statusLine}; ${plural(flows, "flow")}` : "none written yet",
        target: "features",
      }),
      stat(ctx, {
        label: "Apps",
        value: data.apps ? data.apps.apps : "-",
        sub: data.apps
          ? `${plural(data.apps.pages, "page")}, ${plural(data.apps.screens, "screen")}`
          : "not counted",
        target: "apps",
      }),
      stat(ctx, {
        label: "Tasks",
        value: open,
        sub: `${open} open, ${waiting} waiting, ${data.tasks.done.length} done`,
        target: "tasks",
        tone: waiting ? "warn" : "",
      }),
      stat(ctx, {
        label: "Check errors",
        value: data.counts.errors,
        sub: `${plural(data.counts.errors, "error")}, ${plural(data.counts.warnings, "warning")}, ${data.counts.expected} expected`,
        target: "check",
        tone: data.counts.errors ? "bad" : data.counts.warnings ? "warn" : "good",
      }),
      stat(ctx, {
        label: "Book",
        value: data.book.files,
        sub: `files in ${plural(data.book.modules, "module")}`,
        target: "modules",
      }),
      stat(ctx, {
        label: "Route facts",
        value: data.routes,
        sub: stale ? "need a refresh" : "up to date",
        target: "check",
        tone: toneOf(data.routes),
      }),
    ]),
  );

  if (stale) {
    out.append(
      el("p", {
        class: "grimoire-note",
        text: "The route facts are old or missing. Run warlock grimoire build to refresh them.",
      }),
    );
  }

  if (!features.length) {
    out.append(
      ctx.empty(
        data.book.files
          ? `No features are written yet. The book lists ${data.book.files} files; search it above, or open the module graph. Ask your agent to write the features (skill use-the-grimoire).`
          : "The book is empty. Run warlock grimoire build.",
      ),
    );
  }

  const problems = (check?.findings ?? []).filter((finding) => !finding.expected).slice(0, 5);
  const recent = [...(releases?.releases ?? [])]
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 5);

  out.append(
    el("div", { class: "grimoire-split" }, [
      section(ctx, "Top problems", [
        check
          ? problems.length
            ? findingList(ctx, problems)
            : el("p", {}, [pill(ctx, "clean", "good"), " Nothing to fix."])
          : ctx.empty("The check report could not be loaded."),
        check ? el("p", {}, [link(ctx, "Open the check report", "check")]) : "",
      ]),
      section(ctx, "Recent releases", [
        recent.length
          ? list(
              ctx,
              recent.map((item) => [
                link(ctx, item.release, `release/${encodeURIComponent(item.release)}`),
                " ",
                muted(ctx, item.date),
              ]),
            )
          : ctx.empty(
              releases ? "No releases are written yet." : "The releases could not be loaded.",
            ),
        recent.length ? el("p", {}, [link(ctx, "All releases", "releases")]) : "",
      ]),
    ]),
  );

  if (features.length) {
    const latest = [...features]
      .sort((left, right) => right.updated.localeCompare(left.updated))
      .slice(0, 6);

    out.append(
      section(ctx, "Recently updated features", [
        list(
          ctx,
          latest.map((item) => [
            link(ctx, item.id, `feature/${encodeURIComponent(item.id)}`),
            " ",
            pill(ctx, item.status, toneOf(item.status)),
            " ",
            muted(ctx, `${item.title}, updated ${item.updated}`),
          ]),
        ),
        el("p", {}, [link(ctx, `All ${features.length} features`, "features")]),
      ]),
    );
  }

  return out;
}

const FEATURE_SORTS = [
  ["id", "name", (a, b) => a.id.localeCompare(b.id)],
  [
    "status",
    "status",
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.id.localeCompare(b.id),
  ],
  ["flows", "most flows", (a, b) => b.flows.length - a.flows.length || a.id.localeCompare(b.id)],
  [
    "updated",
    "recently updated",
    (a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id),
  ],
];

async function featuresView(ctx) {
  const data = await ctx.api("features");
  const { el } = ctx;
  const items = data.features;

  if (!items.length) {
    return ctx.empty(
      "No features are written yet. Ask your agent to write them (skill use-the-grimoire), then run warlock grimoire build.",
    );
  }

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, "Features"),
    listing(ctx, {
      items,
      noun: "features",
      placeholder: "Filter features",
      textOf: (item) =>
        [item.id, item.title, item.summary ?? "", ...item.flows.map((flow) => flow.id)].join(" "),
      statusOf: (item) => item.status,
      statusOrder: STATUS_ORDER,
      sorts: FEATURE_SORTS,
      render: (shown) =>
        el(
          "div",
          { class: "grimoire-feature-grid" },
          shown.map((item) => {
            const tone = toneOf(item.status);

            return el(
              "article",
              { class: tone ? `grimoire-feature is-${tone}` : "grimoire-feature" },
              [
                el("header", {}, [
                  el("h3", {}, [
                    link(ctx, item.title || item.id, `feature/${encodeURIComponent(item.id)}`),
                  ]),
                  pill(ctx, item.status, tone),
                ]),
                el("p", { class: "grimoire-feature-id" }, [
                  mono(ctx, item.id),
                  ` version ${item.version}, updated ${item.updated}`,
                ]),
                item.summary ? el("p", { class: "grimoire-clamp", text: item.summary }) : "",
                el("div", { class: "grimoire-feature-flows" }, [
                  muted(ctx, plural(item.flows.length, "flow")),
                  item.flows.length
                    ? chipList(
                        ctx,
                        item.flows,
                        (flow) =>
                          link(
                            ctx,
                            flow.id,
                            `flow/${encodeURIComponent(item.id)}/${encodeURIComponent(flow.id)}`,
                            { class: "grimoire-chip", title: flow.heading ?? flow.id },
                          ),
                        6,
                      )
                    : "",
                ]),
              ],
            );
          }),
        ),
    }),
  ]);
}

async function featureView(ctx, id) {
  const [data, graph] = await Promise.all([
    ctx.api(`features/${encodeURIComponent(id)}`),
    ctx.api(`graph/feature/${encodeURIComponent(id)}`).catch(() => null),
  ]);
  const { el } = ctx;
  const readme = data.readme;
  const status = plain(readme.status);
  const out = el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [["Features", "features"], [String(plain(readme.id))]]),
    heading(ctx, plain(readme.title), [
      mono(ctx, plain(readme.id)),
      pill(ctx, status, toneOf(status)),
      pill(ctx, `version ${plain(readme.version)}`),
      readme.origin ? pill(ctx, plain(readme.origin), toneOf(plain(readme.origin))) : "",
      muted(ctx, `updated ${plain(readme.updated)}`),
    ]),
  ]);

  if (readme.summary) out.append(el("p", { class: "grimoire-lede", text: readme.summary }));

  out.append(
    section(ctx, "Flows", [
      data.flows.length
        ? table(
            ctx,
            ["Flow", "Status", "Since", "Heading"],
            data.flows.map((flow) => [
              [
                link(
                  ctx,
                  flow.id,
                  `flow/${encodeURIComponent(plain(readme.id))}/${encodeURIComponent(flow.id)}`,
                ),
              ],
              [pill(ctx, flow.status, toneOf(flow.status))],
              [flow.since],
              [flow.heading ?? ""],
            ]),
          )
        : ctx.empty("This feature has no flows yet."),
    ]),
  );

  const map = data.bookmap;
  out.append(
    section(ctx, "Code", [
      facts(ctx, [
        ["Own files", String(map.own.length)],
        ["Borrowed", String(map.borrowed.length)],
        ["Routes", String(map.routes.length)],
        ["Not reached by a flow", String(map.unreached.length)],
      ]),
      el("h4", { text: "Routes" }),
      map.routes.length
        ? list(
            ctx,
            map.routes.map((item) => [
              routeLink(ctx, item.method, item.path),
              " in ",
              fileLink(ctx, item.file),
            ]),
          )
        : muted(ctx, "none"),
      el("h4", { text: "Pages and screens" }),
      Object.keys(map.pages).length
        ? list(
            ctx,
            Object.entries(map.pages).flatMap(([app, pages]) =>
              pages.map((item) => [
                link(
                  ctx,
                  `${app} ${item.route}`,
                  `page/${encodeURIComponent(app)}/${encodeURIComponent(item.route)}`,
                ),
              ]),
            ),
          )
        : muted(ctx, "none"),
      el("h4", { text: "Own files" }),
      fileChips(ctx, map.own, 12),
      el("h4", { text: "Files no flow reaches" }),
      fileChips(ctx, map.unreached, 12),
    ]),
  );

  if (data.tasks.length) {
    out.append(
      section(ctx, "Open tasks", [
        list(
          ctx,
          data.tasks.map((task) => [
            link(ctx, task.id, `task/${encodeURIComponent(task.id)}`),
            ` ${task.title} `,
            pill(ctx, task.status, toneOf(task.status)),
          ]),
        ),
      ]),
    );
  }

  out.append(section(ctx, "Recent changes", [changesView(ctx, data.changes)]));

  if (data.findings.length) out.append(section(ctx, "Findings", [findingList(ctx, data.findings)]));
  if (graph) out.append(graphView(ctx, graph, "The feature and its neighbours"));
  return out;
}

async function flowView(ctx, feature, flowId) {
  const data = await ctx.api(`flows/${encodeURIComponent(feature)}/${encodeURIComponent(flowId)}`);
  const { el } = ctx;
  const flow = data.flow;
  const map = data.bookmap;
  const status = plain(flow.status);
  const out = el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [
      ["Features", "features"],
      [feature, `feature/${encodeURIComponent(feature)}`],
      [`${plain(flow.heading) ?? plain(flow.id)}`],
    ]),
    heading(ctx, plain(flow.heading) ?? plain(flow.id), [
      mono(ctx, `${feature}/${flowId}`),
      pill(ctx, status, toneOf(status)),
      muted(ctx, `since ${plain(flow.since)}, for ${plain(flow.who)}`),
      link(ctx, `Back to ${feature}`, `feature/${encodeURIComponent(feature)}`),
    ]),
  ]);

  out.append(
    section(ctx, "Steps", [
      map.steps.length
        ? table(
            ctx,
            ["#", "Type", "Target", "Found", "Files"],
            map.steps.map((step) => [
              [String(step.index)],
              [step.type],
              [
                step.type === "route" && step.target.includes(" ")
                  ? routeLink(
                      ctx,
                      step.target.split(" ")[0],
                      step.target.slice(step.target.indexOf(" ") + 1),
                    )
                  : step.target,
              ],
              [
                step.found === null
                  ? ""
                  : pill(ctx, step.found ? "yes" : "no", step.found ? "good" : "bad"),
              ],
              [step.files.length ? fileChips(ctx, step.files, 6) : ""],
            ]),
          )
        : ctx.empty("This flow has no steps."),
    ]),
  );

  out.append(
    section(ctx, "Acceptance criteria", [
      map.criteria.length
        ? table(
            ctx,
            ["Id", "App", "Criterion", "Result", "Tests"],
            map.criteria.map((criterion) => [
              [mono(ctx, criterion.id)],
              [criterion.app ?? "all"],
              [criterion.text],
              [pill(ctx, criterion.status, toneOf(criterion.status))],
              [
                criterion.tests.length
                  ? list(
                      ctx,
                      criterion.tests.map((test) => [
                        fileLink(ctx, test.file),
                        `:${test.line} `,
                        test.name ?? "",
                        " ",
                        pill(
                          ctx,
                          test.stale ? `${test.result}, stale` : test.result,
                          test.stale ? "warn" : toneOf(test.result),
                        ),
                      ]),
                    )
                  : muted(ctx, "no test"),
              ],
            ]),
          )
        : ctx.empty("No criteria written."),
    ]),
  );

  out.append(
    section(ctx, "Shown by", [
      map.shownBy.length
        ? list(
            ctx,
            map.shownBy.map((shown) => [
              shown.type === "layout"
                ? `${shown.app} layout ${shown.id}`
                : link(
                    ctx,
                    `${shown.app} ${shown.type} ${shown.id}`,
                    `page/${encodeURIComponent(shown.app)}/${encodeURIComponent(shown.id)}`,
                  ),
              ` as block ${shown.block}`,
            ]),
          )
        : ctx.empty("No app page shows this flow."),
    ]),
  );

  if (flow.cases.length) {
    out.append(
      section(ctx, "Cases", [
        table(
          ctx,
          ["Question", "Answer"],
          flow.cases.map((item) => [
            [item.question],
            [item.doesNotApply ? `does not apply: ${item.answer}` : item.answer],
          ]),
        ),
      ]),
    );
  }

  if (flow.unknowns.length) {
    out.append(
      section(ctx, "Unknowns", [
        list(
          ctx,
          flow.unknowns.map((item) => [item.text]),
        ),
      ]),
    );
  }

  out.append(section(ctx, "History", [changesView(ctx, data.history)]));
  if (data.findings.length) out.append(section(ctx, "Findings", [findingList(ctx, data.findings)]));
  return out;
}

async function pageView(ctx, app, key) {
  const path = `${encodeURIComponent(app)}/pages/${encodeURIComponent(key)}`;
  const [data, graph] = await Promise.all([
    ctx.api(`apps/${path}`),
    ctx
      .api(`graph/page?app=${encodeURIComponent(app)}&page=${encodeURIComponent(key)}`)
      .catch(() => null),
  ]);
  const { el } = ctx;
  const page = data.page;
  const title = plain(page.heading) ?? page.id;
  const route = plain(page.route) ?? plain(page.screen) ?? page.id;
  const origin = page.origin ? plain(page.origin) : null;
  const out = el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [["Apps", "apps"], [app, "apps"], [title]]),
    heading(ctx, title, [
      pill(ctx, page.type === "screen" ? "screen" : "page"),
      mono(ctx, route),
      muted(ctx, app),
      origin ? pill(ctx, origin, toneOf(origin)) : "",
    ]),
  ]);

  if (page.purpose) out.append(el("p", { class: "grimoire-lede", text: page.purpose }));

  const rows = [
    ...(data.layout ? data.layout.blocks.map((row) => ({ row, from: "layout" })) : []),
    ...page.blocks.map((row) => ({ row, from: "page" })),
  ];
  out.append(
    section(ctx, "Blocks", [
      rows.length
        ? table(
            ctx,
            ["Block", "From", "Flow", "Who", "Changes with"],
            rows.map(({ row, from }) => [
              [row.block],
              [pill(ctx, from)],
              [row.flow ? flowLink(ctx, row.flow) : ""],
              [row.who.everyone ? "everyone" : row.who.conditions.join(", ")],
              [
                row.changesWith
                  .map((change) =>
                    change.condition ? `${change.condition}: ${change.text}` : change.text,
                  )
                  .join("; "),
              ],
            ]),
          )
        : ctx.empty("No blocks are written for this page."),
    ]),
  );

  if (page.blockFiles.length) {
    out.append(
      section(
        ctx,
        "Block details",
        page.blockFiles.map((block) =>
          el("div", {}, [
            el("h4", { text: block.id }),
            list(
              ctx,
              block.details.map((detail) => [`${detail.name}: ${detail.text}`]),
            ),
          ]),
        ),
      ),
    );
  }

  if (data.book) {
    out.append(
      section(ctx, "In the code", [
        facts(ctx, [
          ["File", fileLink(ctx, data.book.file)],
          ["Layouts", data.book.layouts?.length ? fileChips(ctx, data.book.layouts) : null],
          [
            "Requires",
            data.book.requires?.length
              ? chipList(ctx, data.book.requires, (item) => mono(ctx, item))
              : null,
          ],
        ]),
      ]),
    );
  }

  if (graph) out.append(graphView(ctx, graph, "The page and its blocks"));
  return out;
}

/** The group a page or screen is listed under: the first segment of its route, or the top level. */
function groupOf(row) {
  const segments = (row.route ?? row.id)
    .split("/")
    .filter((segment) => segment && !segment.startsWith(":") && !segment.startsWith("["));
  const first = segments[0]?.replace(/^\(.*\)$/, "") ?? "";

  return segments.length > 1 && first ? first : "";
}

function appIcon(ctx, type) {
  const { svg } = ctx;
  const common = {
    viewBox: "0 0 24 24",
    width: "22",
    height: "22",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: "grimoire-app-icon",
  };

  return type === "mobile"
    ? svg("svg", common, [
        svg("rect", { x: "7", y: "2.5", width: "10", height: "19", rx: "2.2" }),
        svg("path", { d: "M11 18.5h2" }),
      ])
    : svg("svg", common, [
        svg("rect", { x: "3", y: "4", width: "18", height: "12", rx: "2" }),
        svg("path", { d: "M9 20h6M12 16v4" }),
      ]);
}

async function appsView(ctx) {
  const data = await ctx.api("apps");
  const { el } = ctx;

  if (!data.apps.length)
    return ctx.empty(
      "No apps are written in grimoire/apps. Ask your agent to write them (skill use-the-grimoire).",
    );

  // Older answers list ids only.
  const rowsOf = (app) =>
    app.rows ?? [
      ...app.pages.map((id) => ({ id, type: "page" })),
      ...app.screens.map((id) => ({ id, type: "screen" })),
    ];
  const items = data.apps.flatMap((app) =>
    rowsOf(app).map((row) => ({
      route: null,
      heading: null,
      origin: null,
      layout: null,
      blocks: null,
      ...row,
      app: app.id,
    })),
  );

  const renderApp = (app, rows, filtered) => {
    const own = items.filter((row) => row.app === app.id);
    const confirmed = own.filter((row) => row.origin === "confirmed").length;
    const inferred = own.filter((row) => row.origin === "inferred").length;
    const groups = new Map();

    for (const row of rows) {
      const name = groupOf(row);

      groups.set(name, [...(groups.get(name) ?? []), row]);
    }

    return el("section", { class: "grimoire-card grimoire-app-card" }, [
      el("header", { class: "grimoire-app-head" }, [
        appIcon(ctx, app.type),
        el("h3", { text: app.id }),
        pill(ctx, app.type === "mobile" ? "mobile app" : "site"),
        mono(ctx, app.root),
      ]),
      el("p", { class: "grimoire-muted" }, [
        `${plural(app.pages.length, "page")}, ${plural(app.screens.length, "screen")}`,
        confirmed || inferred ? `; ${confirmed} confirmed, ${inferred} inferred` : "",
        filtered ? `; showing ${rows.length}` : "",
      ]),
      own.length
        ? [...groups.entries()]
            .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
            .map(([name, group]) =>
              el("div", { class: "grimoire-group" }, [
                el("h4", { text: `${name ? `/${name}` : "Top level"} (${group.length})` }),
                table(
                  ctx,
                  ["Page", "Route or screen", "Title", "Layout", "Blocks", "Status"],
                  [...group]
                    .sort((a, b) => (a.route ?? a.id).localeCompare(b.route ?? b.id))
                    .map((row) => [
                      [
                        link(
                          ctx,
                          row.id,
                          `page/${encodeURIComponent(app.id)}/${encodeURIComponent(row.id)}`,
                        ),
                        row.type === "screen" ? [" ", pill(ctx, "screen")] : "",
                      ],
                      [row.route ? mono(ctx, row.route) : ""],
                      [row.heading ?? ""],
                      [row.layout ?? ""],
                      [row.blocks === null ? "" : String(row.blocks)],
                      [
                        row.origin
                          ? pill(ctx, row.origin, toneOf(row.origin))
                          : muted(ctx, "unmarked"),
                      ],
                    ]),
                ),
              ]),
            )
        : ctx.empty("No pages written."),
    ]);
  };

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, "Apps"),
    items.length
      ? listing(ctx, {
          items,
          noun: "pages and screens",
          placeholder: "Filter pages and screens",
          textOf: (row) => [row.app, row.id, row.route ?? "", row.heading ?? ""].join(" "),
          statusOf: (row) => row.origin ?? "unmarked",
          statusOrder: ["confirmed", "inferred", "unmarked"],
          render: (shown, all) =>
            el(
              "div",
              { class: "grimoire-app-list" },
              data.apps
                .filter(
                  (app) => shown.length === all.length || shown.some((row) => row.app === app.id),
                )
                .map((app) =>
                  renderApp(
                    app,
                    shown.filter((row) => row.app === app.id),
                    shown.length !== all.length,
                  ),
                ),
            ),
        })
      : el(
          "div",
          { class: "grimoire-app-list" },
          data.apps.map((app) => renderApp(app, [], false)),
        ),
  ]);
}

/** One task's header facts. */
function taskCard(ctx, task) {
  return section(ctx, task.id, [
    facts(ctx, [
      ["Title", task.title],
      ["Type", task.type],
      ["Status", pill(ctx, task.status, toneOf(task.status))],
      [
        "Feature",
        task.feature
          ? link(ctx, task.feature, `feature/${encodeURIComponent(task.feature)}`)
          : null,
      ],
      ["Flow", task.feature && task.flow ? flowLink(ctx, `${task.feature}/${task.flow}`) : null],
      ["Apps", task.apps?.length ? task.apps.join(", ") : null],
      ["File", mono(ctx, task.file)],
      ["Decision needed", task.decisionNeeded ?? null],
      ["Shipped in", task.shipped ? `${task.shipped.feature} ${task.shipped.version}` : null],
    ]),
  ]);
}

async function tasksView(ctx, only) {
  const data = await ctx.api("tasks");
  const { el } = ctx;

  if (only) {
    const task = [...data.open, ...data.waiting, ...data.done].find((item) => item.id === only);

    return el("div", { class: "grimoire-view" }, [
      crumbs(ctx, [["Tasks", "tasks"], [only]]),
      task
        ? taskCard(ctx, task)
        : ctx.empty(`No task ${only}. Open the task list to see the ids that exist.`),
    ]);
  }

  // `waiting` is the part of `open` that waits for the owner: each task shows in one group only.
  const waiting = new Set(data.waiting.map((task) => task.id));
  const groups = [
    ["open", "Open", data.open.filter((task) => !waiting.has(task.id))],
    ["waiting", "Waiting for approval", data.waiting],
    ["done", "Done", data.done],
  ];
  const items = groups.flatMap(([group, , tasks]) => tasks.map((task) => ({ ...task, group })));

  if (!items.length) return ctx.empty("No tasks are written in grimoire/tasks.");

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, "Tasks"),
    listing(ctx, {
      items,
      noun: "tasks",
      textOf: (task) =>
        [task.id, task.title, task.type, task.feature ?? "", task.decisionNeeded ?? ""].join(" "),
      statusOf: (task) => task.group,
      statusOrder: ["open", "waiting", "done"],
      render: (shown) =>
        el(
          "div",
          { class: "grimoire-view-groups" },
          groups
            .map(([group, title]) => [title, shown.filter((task) => task.group === group), group])
            .filter(([, tasks]) => tasks.length)
            .map(([title, tasks, group]) =>
              section(ctx, `${title} (${tasks.length})`, [
                table(
                  ctx,
                  ["Task", "Title", "Type", "Status", "Feature", "Decision needed"],
                  tasks.map((task) => [
                    [link(ctx, task.id, `task/${encodeURIComponent(task.id)}`)],
                    [task.title],
                    [task.type],
                    [pill(ctx, task.status, toneOf(group))],
                    [
                      task.feature
                        ? link(ctx, task.feature, `feature/${encodeURIComponent(task.feature)}`)
                        : "",
                    ],
                    [task.decisionNeeded ?? ""],
                  ]),
                ),
              ]),
            ),
        ),
    }),
  ]);
}

async function releasesView(ctx) {
  const data = await ctx.api("releases");
  const { el } = ctx;

  if (!data.releases.length) return ctx.empty("No releases are written in grimoire/releases.");

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, "Releases"),
    listing(ctx, {
      items: data.releases,
      noun: "releases",
      textOf: (item) => `${item.release} ${item.date} ${item.file}`,
      sorts: [
        ["newest", "newest first", (a, b) => b.date.localeCompare(a.date)],
        ["oldest", "oldest first", (a, b) => a.date.localeCompare(b.date)],
      ],
      render: (shown) =>
        section(ctx, "Releases", [
          table(
            ctx,
            ["Release", "Date", "File"],
            shown.map((item) => [
              [link(ctx, item.release, `release/${encodeURIComponent(item.release)}`)],
              [item.date],
              [mono(ctx, item.file)],
            ]),
          ),
        ]),
    }),
  ]);
}

async function releaseView(ctx, id) {
  const data = await ctx.api(`releases/${encodeURIComponent(id)}`);
  const { el } = ctx;
  const entries = data.collected?.entries ?? [];
  const byFeature = new Map();

  for (const entry of entries)
    byFeature.set(entry.feature, [...(byFeature.get(entry.feature) ?? []), entry]);

  return el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [["Releases", "releases"], [`Release ${plain(data.release)}`]]),
    heading(ctx, `Release ${plain(data.release)}`, [muted(ctx, plain(data.date))]),
    data.brief ? el("p", { class: "grimoire-lede", text: data.brief }) : "",
    entries.length
      ? [...byFeature.entries()].map(([feature, items]) =>
          section(ctx, `${feature} (${items.length})`, [
            list(
              ctx,
              items.map((entry) => [
                `${entry.feature} ${entry.version}: ${entry.text ?? JSON.stringify(entry)}`,
              ]),
            ),
          ]),
        )
      : section(ctx, "Collected entries", [ctx.empty("Nothing is listed for this release.")]),
  ]);
}

async function checkView(ctx) {
  const report = await ctx.api("check");
  const { counts } = report;
  const { el } = ctx;
  const items = report.findings.map((finding) => ({
    finding,
    state: finding.expected ? "expected" : finding.severity,
  }));

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, report.ok ? "Check: no unexpected errors" : "Check: errors found", [
      pill(ctx, plural(counts.errors, "error"), counts.errors ? "bad" : "good"),
      pill(ctx, plural(counts.warnings, "warning"), counts.warnings ? "warn" : ""),
      pill(ctx, `${counts.expected} expected`),
      muted(ctx, `routes ${report.routes}`),
    ]),
    items.length
      ? listing(ctx, {
          items,
          noun: "findings",
          textOf: ({ finding }) =>
            [
              finding.code,
              finding.message,
              finding.at?.file ?? "",
              finding.subject.file ?? "",
              finding.subject.feature ?? "",
            ].join(" "),
          statusOf: (item) => item.state,
          statusOrder: ["error", "warning", "expected"],
          render: (shown) => {
            const fix = shown
              .filter((item) => item.state !== "expected")
              .map((item) => item.finding);
            const expected = shown
              .filter((item) => item.state === "expected")
              .map((item) => item.finding);

            return el("div", { class: "grimoire-view-groups" }, [
              fix.length ? section(ctx, `To fix (${fix.length})`, [findingList(ctx, fix)]) : "",
              expected.length
                ? section(ctx, `Expected: proposed work (${expected.length})`, [
                    el("p", {
                      class: "grimoire-muted",
                      text: "These concern features or flows that are still proposed, so the code does not exist yet. They never fail the check.",
                    }),
                    findingList(ctx, expected),
                  ])
                : "",
            ]);
          },
        })
      : ctx.empty("No findings."),
  ]);
}

async function fileView(ctx, path) {
  const [data, graph] = await Promise.all([
    ctx.api(`file?path=${encodeURIComponent(path)}`),
    ctx.api(`graph/file?path=${encodeURIComponent(path)}`).catch(() => null),
  ]);
  const { el } = ctx;
  const entry = data.entry;
  const out = el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [["Modules", "modules"], [entry.file]]),
    heading(ctx, entry.file, [
      pill(ctx, entry.type),
      mono(ctx, entry.module),
      muted(ctx, `${entry.lines} lines`),
    ]),
  ]);
  if (entry.about) out.append(el("p", { class: "grimoire-lede", text: entry.about }));

  out.append(
    section(ctx, "Who uses it", [
      facts(ctx, [
        [
          "Owned by",
          entry.feature
            ? link(ctx, entry.feature, `feature/${encodeURIComponent(entry.feature)}`)
            : null,
        ],
        ["Borrowed by", entry.borrowedBy.length ? entry.borrowedBy.join(", ") : null],
        [
          "Used by flows",
          entry.flows.length
            ? el(
                "span",
                {},
                entry.flows.flatMap((flow) => [flowLink(ctx, flow), " "]),
              )
            : null,
        ],
      ]),
    ]),
    section(ctx, "Exports", [
      entry.exports.length
        ? list(
            ctx,
            entry.exports.map((item) => [mono(ctx, item.name), item.about ? ` ${item.about}` : ""]),
          )
        : muted(ctx, "none"),
    ]),
    section(ctx, "Imports", [fileChips(ctx, entry.imports, 20)]),
    section(ctx, "Imported by", [fileChips(ctx, entry.importedBy, 20)]),
  );

  if (entry.routes.length) {
    out.append(
      section(ctx, "Routes", [
        list(
          ctx,
          entry.routes.map((item) => [routeLink(ctx, item.method, item.path), ` (${item.via})`]),
        ),
      ]),
    );
  }

  if (graph) out.append(graphView(ctx, graph, "The file and its neighbours"));
  return out;
}

async function routeView(ctx, method, path) {
  const data = await ctx.api(
    `route?method=${encodeURIComponent(method)}&path=${encodeURIComponent(path)}`,
  );
  const { el } = ctx;
  const found = data.route;
  const out = el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [["Modules", "modules"], [`${found.method} ${found.path}`]]),
    heading(ctx, `${found.method} ${found.path}`, [muted(ctx, found.description ?? found.handler)]),
  ]);
  if (found.handlerFile) out.append(el("p", {}, ["Handler: ", fileLink(ctx, found.handlerFile)]));
  out.append(
    section(ctx, "Files behind it", [fileChips(ctx, data.files, 20)]),
    section(ctx, "Flow steps", [
      data.steps.length
        ? list(
            ctx,
            data.steps.map((step) => [flowLink(ctx, step.flow), ` step ${step.index}`]),
          )
        : muted(ctx, "none"),
    ]),
  );
  return out;
}

async function modulesView(ctx) {
  const graph = await ctx.api("graph/modules");
  const { el } = ctx;
  const weight = new Map();

  for (const edge of graph.edges) {
    for (const end of [edge.from, edge.to])
      weight.set(end, (weight.get(end) ?? 0) + (edge.weight ?? 1));
  }

  const items = graph.nodes.map((node) => ({ label: node.label, links: weight.get(node.id) ?? 0 }));

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, "Module coupling"),
    el("p", {
      class: "grimoire-muted",
      text: "Lines are imports between modules; thicker means more imports. The most connected modules are drawn.",
    }),
    graphView(ctx, graph, "Modules"),
    items.length
      ? listing(ctx, {
          items,
          noun: "modules",
          textOf: (item) => item.label,
          sorts: [
            [
              "links",
              "most imports",
              (a, b) => b.links - a.links || a.label.localeCompare(b.label),
            ],
            ["name", "name", (a, b) => a.label.localeCompare(b.label)],
          ],
          render: (shown) =>
            section(ctx, "Modules", [
              table(
                ctx,
                ["Module", "Imports to and from"],
                shown.map((item) => [[mono(ctx, item.label)], [String(item.links)]]),
              ),
            ]),
        })
      : "",
  ]);
}

// ── Shell ───────────────────────────────────────────────────────────────────

/** Pick the view for the hash route. */
async function body(ctx, summaryRequest) {
  const parts = ctx.route ? ctx.route.split("/").map(decodeSegment) : [];
  const [type = "", first = "", second = ""] = parts;

  switch (type) {
    case "features":
      return featuresView(ctx);
    case "feature":
      return featureView(ctx, first);
    case "flow":
      return flowView(ctx, first, second);
    case "page":
      return pageView(ctx, first, parts.slice(2).join("/"));
    case "apps":
      return appsView(ctx);
    case "tasks":
      return tasksView(ctx, "");
    case "task":
      return tasksView(ctx, first);
    case "releases":
      return releasesView(ctx);
    case "release":
      return releaseView(ctx, first);
    case "check":
      return checkView(ctx);
    case "file":
      return fileView(ctx, first);
    case "route":
      return routeView(ctx, first, parts.slice(2).join("/"));
    case "modules":
      return modulesView(ctx);
    default:
      return overviewView(ctx, summaryRequest);
  }
}

/** What the view is about, for error messages, and the list to go back to. */
function describe(route) {
  const type = route.split("/")[0] ?? "";
  const map = {
    features: ["the features", null],
    feature: ["the feature", ["Features", "features"]],
    flow: ["the flow", ["Features", "features"]],
    apps: ["the apps", null],
    page: ["the page", ["Apps", "apps"]],
    tasks: ["the tasks", null],
    task: ["the task", ["Tasks", "tasks"]],
    releases: ["the releases", null],
    release: ["the release", ["Releases", "releases"]],
    check: ["the check report", null],
    modules: ["the module graph", null],
    file: ["the file", ["Modules", "modules"]],
    route: ["the route", ["Modules", "modules"]],
  };

  return map[type] ?? ["the overview", null];
}

/** The loading state: shown at once, so a large book never leaves a blank area. */
function skeleton(ctx) {
  const { el } = ctx;

  return el("div", { class: "grimoire-skeleton", role: "status" }, [
    el("p", { class: "grimoire-skeleton-title", text: "Opening the book…" }),
    el("p", {
      class: "grimoire-muted",
      text: "A large book can take a few seconds to open the first time.",
    }),
    el(
      "div",
      { class: "grimoire-skeleton-grid", "aria-hidden": "true" },
      [1, 2, 3, 4, 5, 6].map(() => el("div", { class: "grimoire-skeleton-block" })),
    ),
  ]);
}

/** A failed view: what failed, why, what to do, and a way to try again. */
function errorBox(ctx, route, error) {
  const { el } = ctx;
  const [what, back] = describe(route);
  const message = error && error.message ? error.message : String(error);
  const needsApp = message.includes("running app");

  return el("div", { class: "grimoire-error", role: "alert" }, [
    el("p", { class: "grimoire-error-title", text: `Could not load ${what}: ${message}` }),
    el("p", {
      class: "grimoire-muted",
      text: needsApp
        ? "Open the Grimoire tab in the devtools dashboard to see this answer."
        : back
          ? `It may have been renamed or removed. Go back to the list, or run warlock grimoire build and reload.`
          : BUILD_HINT,
    }),
    el("p", {}, [
      el("button", {
        type: "button",
        class: "grimoire-filter",
        text: "Try again",
        onclick: () => ctx.refresh(),
      }),
      back ? [" ", link(ctx, `Back to ${back[0]}`, back[1])] : "",
    ]),
  ]);
}

let shortcutHandler = null;

/** `/` focuses the search box from anywhere that is not a text field; the newest view owns the key. */
function bindShortcut(input) {
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
  if (shortcutHandler) document.removeEventListener("keydown", shortcutHandler);

  shortcutHandler = (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;

    const target = event.target;
    const tag = target && target.tagName;

    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      (target && target.isContentEditable)
    )
      return;
    if (!input.isConnected) return;

    event.preventDefault();
    input.focus();
  };
  document.addEventListener("keydown", shortcutHandler);
}

/** The header: the tabs and the one search box. Results appear under the box, grouped by type. */
function header(ctx, route, summaryRequest) {
  const { el } = ctx;
  const results = el("div", { class: "grimoire-results" });
  const active = tabOf(route);
  const badges = new Map();
  let token = 0;
  let timer = null;
  let rows = [];
  let current = -1;

  function highlight(index) {
    current = index;
    rows.forEach((row, position) => {
      row.node.setAttribute(
        "class",
        position === index ? "grimoire-hit is-active" : "grimoire-hit",
      );
      row.node.setAttribute("aria-selected", String(position === index));
    });
    if (rows[index]) {
      input.setAttribute("aria-activedescendant", `grimoire-hit-${index}`);
      rows[index].node.scrollIntoView?.({ block: "nearest" });
    }
  }

  function clear() {
    token += 1;
    rows = [];
    current = -1;
    results.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute?.("aria-activedescendant");
  }

  async function run(text) {
    const mine = ++token;
    rows = [];
    current = -1;
    results.replaceChildren();
    if (!text.trim()) {
      input.setAttribute("aria-expanded", "false");
      return;
    }
    input.setAttribute("aria-expanded", "true");
    try {
      const answer = await ctx.api(`search?q=${encodeURIComponent(text.trim())}&limit=15`);
      if (mine !== token) return;
      results.replaceChildren();
      if (!answer.hits.length) {
        results.append(
          ctx.empty(
            `Nothing matches "${text.trim()}". Try a shorter word, or a file or route name.`,
          ),
        );
        return;
      }

      const groups = new Map();

      for (const hit of answer.hits) groups.set(hit.type, [...(groups.get(hit.type) ?? []), hit]);

      for (const [type, hits] of groups) {
        const group = el(
          "div",
          { class: "grimoire-hit-group", role: "group", "aria-label": type },
          [
            el("p", {
              class: "grimoire-hit-title",
              "aria-hidden": "true",
              text: `${type} (${hits.length})`,
            }),
          ],
        );

        for (const hit of hits) {
          const target = targetOf(hit.type, hit.id);
          const inner = [
            pill(ctx, hit.type),
            mono(ctx, hit.id),
            hit.detail ? muted(ctx, hit.detail) : "",
          ];

          if (target === null) {
            group.append(el("div", { class: "grimoire-hit is-plain" }, inner));
            continue;
          }

          const node = el(
            "a",
            {
              href: ctx.href(target),
              class: "grimoire-hit",
              role: "option",
              id: `grimoire-hit-${rows.length}`,
              "aria-selected": "false",
            },
            inner,
          );

          rows.push({ node, target });
          group.append(node);
        }

        results.append(group);
      }
    } catch (error) {
      if (mine === token)
        results.append(
          el("p", {
            class: "grimoire-error-title",
            text: `Search failed: ${error.message}. Run warlock grimoire build, then search again.`,
          }),
        );
    }
  }

  const input = el("input", {
    type: "search",
    class: "grimoire-search",
    role: "combobox",
    placeholder: "Search flows, blocks, routes, files and tasks (press /)",
    "aria-label": "Search the Grimoire",
    "aria-autocomplete": "list",
    "aria-expanded": "false",
    autocomplete: "off",
    oninput: (event) => {
      const text = event.target.value;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => run(text), 150);
    },
    onkeydown: (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!rows.length) return;
        event.preventDefault?.();
        const step = event.key === "ArrowDown" ? 1 : -1;
        highlight((current + step + rows.length) % rows.length);
      } else if (event.key === "Enter") {
        const row = rows[current] ?? rows[0];
        if (!row) return;
        event.preventDefault?.();
        ctx.navigate(row.target);
      } else if (event.key === "Escape") {
        if (timer !== null) clearTimeout(timer);
        input.value = "";
        clear();
      }
    },
  });

  const nav = el(
    "nav",
    { class: "grimoire-tabs", "aria-label": "Grimoire" },
    TABS.map(([target, label]) => {
      const badge = el("span", { class: "grimoire-tab-count" });

      badges.set(target, badge);
      return el(
        "a",
        {
          href: ctx.href(target),
          class: target === active ? "grimoire-tab is-active" : "grimoire-tab",
          ...(target === active ? { "aria-current": "page" } : {}),
        },
        [label, " ", badge],
      );
    }),
  );

  bindShortcut(input);

  // The counts arrive with the summary; a view that does not need it still shows them.
  summaryRequest.then(
    (data) => {
      const set = (key, value) => {
        const badge = badges.get(key);
        if (badge && value !== undefined && value !== null) badge.textContent = String(value);
      };
      set("features", data.features?.features?.length);
      set("apps", data.apps?.apps);
      set("tasks", data.tasks ? data.tasks.open.length : undefined);
      set("releases", data.releases);
      set("check", data.counts ? data.counts.errors + data.counts.warnings : undefined);
    },
    () => undefined,
  );

  return {
    element: el("div", { class: "grimoire-header" }, [
      nav,
      el("div", { class: "grimoire-searchbox" }, [input, results]),
    ]),
    run,
    input,
  };
}

/** The context with `el()` flattening nested child lists and skipping empty ones. */
function withFlatChildren(context) {
  const flat = (children) =>
    Array.isArray(children)
      ? children
          .flat(Infinity)
          .filter((child) => child !== null && child !== undefined && child !== false)
      : children;
  return { ...context, el: (tag, attrs, children) => context.el(tag, attrs, flat(children)) };
}

async function renderGrimoire(context) {
  const ctx = withFlatChildren(context);
  const { root, el } = ctx;
  const route = ctx.route ?? "";

  if (typeof ctx.asset === "function")
    root.append(el("link", { rel: "stylesheet", href: ctx.asset("grimoire.css") }));

  // The tab counts and the overview share one summary request.
  const summaryRequest = Promise.resolve().then(() => ctx.api("summary"));

  summaryRequest.catch(() => undefined);

  const top = header(ctx, route, summaryRequest);
  const content = el("div", { class: "grimoire-body", "aria-busy": "true" });

  content.append(skeleton(ctx));
  root.append(el("div", { class: "grimoire-root" }, [top.element, content]));

  const loaded = (async () => {
    try {
      content.replaceChildren(await body(ctx, summaryRequest));
    } catch (error) {
      content.replaceChildren(errorBox(ctx, route, error));
    }
    content.setAttribute("aria-busy", "false");
  })();

  // A quick answer is shown filled in; a slow one hands back the skeleton at once and fills in later.
  await (typeof setTimeout === "function"
    ? Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, SKELETON_AFTER))])
    : loaded);
  return root;
}

export default renderGrimoire;
