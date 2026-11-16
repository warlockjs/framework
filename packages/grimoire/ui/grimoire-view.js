/**
 * The Grimoire tab: a browser ES module that the devtools dashboard loads
 * (`panels/grimoire/view.js`) and that the static export inlines. It builds
 * the DOM with the context's `el()` and `svg()` helpers and sets every string
 * from the data as text, never as HTML. Hash links look like `#grimoire/flow/<feature>/<flow>`.
 *
 * Keep the last line as it is: the static export swaps it out to inline this file.
 */

const NAV = [
  ["", "Home"],
  ["apps", "Apps"],
  ["tasks", "Tasks"],
  ["releases", "Releases"],
  ["check", "Check"],
  ["modules", "Modules"],
];

const SVG_WIDTH = 720;
const SVG_HEIGHT = 440;

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
  center: "var(--accent)",
  feature: "var(--good)",
  flow: "var(--bar)",
  app: "var(--warn)",
  block: "var(--bar)",
  layout: "var(--muted)",
  module: "var(--accent)",
  file: "var(--muted)",
};

/** Plain SVG for a graph answer: the centre node in the middle, the others on one or two rings. */
function graphView(ctx, graph, title) {
  const { el, svg, empty, href } = ctx;
  const card = el("section", { class: "card grimoire-graph" }, [el("h3", { text: title })]);

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
        stroke: "var(--line)",
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
      fill: NODE_COLOURS[node.type] ?? "var(--muted)",
    });
    const label = svg("text", {
      x: at[0].toFixed(1),
      y: (at[1] + (node.type === "center" ? 24 : 18)).toFixed(1),
      "text-anchor": "middle",
      fill: "var(--text)",
      "font-size": "11",
      text: shorten(node.label),
    });
    const group = svg("g", {}, [svg("title", { text: node.label }), circle, label]);
    canvas.append(target === null ? group : svg("a", { href: href(target) }, [group]));
  }

  card.append(canvas);
  return card;
}

/** One section card with a heading. */
function section(ctx, title, children = []) {
  return ctx.el("section", { class: "card detail" }, [ctx.el("h3", { text: title }), ...children]);
}

function link(ctx, text, target, attrs = {}) {
  return ctx.el("a", { href: ctx.href(target), text, ...attrs });
}

function badge(ctx, text, tone = "") {
  return ctx.el("span", { class: tone ? `badge ${tone}` : "badge", text });
}

function list(ctx, items) {
  return ctx.el(
    "ul",
    { class: "grimoire-list" },
    items.map((item) => ctx.el("li", {}, item)),
  );
}

function table(ctx, headings, rows) {
  return ctx.el("table", { class: "grimoire-table" }, [
    ctx.el("thead", {}, [
      ctx.el(
        "tr",
        {},
        headings.map((heading) => ctx.el("th", { text: heading })),
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
  ]);
}

function statusTone(status) {
  if (status === "shipped" || status === "passing" || status === "pass") return "good";
  if (status === "retired" || status === "failing" || status === "fail" || status === "error")
    return "bad";
  return "";
}

/** `<feature>/<flow>` as a link. */
function flowLink(ctx, ref) {
  const target = targetOf("flow", ref);
  return target === null ? ref : link(ctx, ref, target);
}

function fileLink(ctx, file) {
  return link(ctx, file, `file/${encodeURIComponent(file)}`);
}

function fileList(ctx, files, limit = 12) {
  if (!files.length) return ctx.el("span", { class: "muted", text: "none" });
  const shown = files.slice(0, limit);
  const items = shown.map((file) => [fileLink(ctx, file)]);
  if (files.length > limit)
    items.push([ctx.el("span", { class: "muted", text: `+${files.length - limit} more` })]);
  return list(ctx, items);
}

// ── Views ───────────────────────────────────────────────────────────────────

async function homeView(ctx) {
  const data = await ctx.api("summary");
  const { el } = ctx;
  const out = el("div", { class: "grimoire-view" });
  const cards = el("div", { class: "grimoire-cards" }, [
    el("div", { class: "card" }, [
      el("h3", { text: "Check" }),
      link(ctx, `${data.counts.errors} errors, ${data.counts.warnings} warnings`, "check"),
      el("p", { class: "muted", text: `${data.counts.expected} expected (proposed work)` }),
    ]),
    el("div", { class: "card" }, [
      el("h3", { text: "Tasks" }),
      link(
        ctx,
        `${data.tasks.open.length - data.tasks.waiting.length} open, ${data.tasks.waiting.length} waiting`,
        "tasks",
      ),
      el("p", { class: "muted", text: `${data.tasks.done.length} done` }),
    ]),
    el("div", { class: "card" }, [
      el("h3", { text: "Book" }),
      link(ctx, `${data.book.files} files in ${data.book.modules} modules`, "modules"),
      el("p", { class: "muted", text: `routes: ${data.routes}` }),
    ]),
  ]);
  out.append(cards);

  if (data.routes === "stale" || data.routes === "missing") {
    out.append(
      el("p", {
        class: "muted",
        text: "The route facts are old or missing. Run warlock grimoire build to refresh them.",
      }),
    );
  }

  const features = data.features.features;

  if (!features.length) {
    out.append(
      ctx.empty(
        data.book.files
          ? `No features are written yet. The book below lists ${data.book.files} files; search it above, or open the module graph. Ask your agent to write the features (skill use-the-grimoire).`
          : "The book is empty. Run warlock grimoire build.",
      ),
    );
    return out;
  }

  out.append(
    section(ctx, "Features", [
      table(
        ctx,
        ["Feature", "Title", "Status", "Version", "Flows"],
        features.map((item) => [
          [link(ctx, item.id, `feature/${encodeURIComponent(item.id)}`)],
          [item.title],
          [badge(ctx, item.status, statusTone(item.status))],
          [item.version],
          [item.flows.map((flow) => flow.id).join(", ")],
        ]),
      ),
    ]),
  );
  return out;
}

async function featureView(ctx, id) {
  const [data, graph] = await Promise.all([
    ctx.api(`features/${encodeURIComponent(id)}`),
    ctx.api(`graph/feature/${encodeURIComponent(id)}`).catch(() => null),
  ]);
  const { el } = ctx;
  const readme = data.readme;
  const out = el("div", { class: "grimoire-view" }, [
    el("h2", { text: `${plain(readme.title)} (${plain(readme.id)})` }),
    el("p", {}, [
      badge(ctx, plain(readme.status), statusTone(plain(readme.status))),
      ` version ${plain(readme.version)}, updated ${plain(readme.updated)}`,
    ]),
  ]);

  if (readme.summary) out.append(el("p", { text: readme.summary }));

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
              [badge(ctx, flow.status, statusTone(flow.status))],
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
      el("p", {
        text: `${map.own.length} own files, ${map.borrowed.length} borrowed, ${map.routes.length} routes, ${map.unreached.length} not reached by any flow.`,
      }),
      el("h4", { text: "Routes" }),
      map.routes.length
        ? list(
            ctx,
            map.routes.map((item) => [
              link(
                ctx,
                `${item.method} ${item.path}`,
                `route/${encodeURIComponent(item.method)}/${encodeURIComponent(item.path)}`,
              ),
              " in ",
              fileLink(ctx, item.file),
            ]),
          )
        : el("p", { class: "muted", text: "none" }),
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
        : el("p", { class: "muted", text: "none" }),
      el("h4", { text: "Files no flow reaches" }),
      fileList(ctx, map.unreached),
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
            badge(ctx, task.status),
          ]),
        ),
      ]),
    );
  }

  out.append(section(ctx, "Recent changes", [changesView(ctx, data.changes)]));

  if (data.findings.length)
    out.append(section(ctx, "Findings", [findingsView(ctx, data.findings)]));
  if (graph) out.append(graphView(ctx, graph, "The feature and its neighbours"));
  return out;
}

function changesView(ctx, changes) {
  if (!changes.length) return ctx.empty("No changelog entries.");
  return list(
    ctx,
    changes.map((change) => [
      badge(ctx, change.word),
      ` ${plain(change.version)} `,
      change.flow ? [flowLink(ctx, `${change.feature}/${change.flow}`), " "] : "",
      change.text,
      change.release
        ? ` (release ${change.release}${change.date ? `, ${change.date}` : ""})`
        : " (not released)",
    ]),
  );
}

function findingsView(ctx, findings) {
  return table(
    ctx,
    ["Code", "Severity", "Message", "Where"],
    findings.map((finding) => [
      [finding.code],
      [
        badge(
          ctx,
          finding.expected ? `${finding.severity} (expected)` : finding.severity,
          finding.severity === "error" && !finding.expected ? "bad" : "",
        ),
      ],
      [finding.message],
      [finding.at ? `${finding.at.file}:${finding.at.line}` : (finding.subject.file ?? "")],
    ]),
  );
}

async function flowView(ctx, feature, flowId) {
  const data = await ctx.api(`flows/${encodeURIComponent(feature)}/${encodeURIComponent(flowId)}`);
  const { el } = ctx;
  const flow = data.flow;
  const map = data.bookmap;
  const out = el("div", { class: "grimoire-view" }, [
    el("h2", { text: `${plain(flow.heading) ?? plain(flow.id)} (${feature}/${flowId})` }),
    el("p", {}, [
      badge(ctx, plain(flow.status), statusTone(plain(flow.status))),
      ` since ${plain(flow.since)}, for ${plain(flow.who)}. `,
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
                  ? link(
                      ctx,
                      step.target,
                      `route/${encodeURIComponent(step.target.split(" ")[0])}/${encodeURIComponent(step.target.slice(step.target.indexOf(" ") + 1))}`,
                    )
                  : step.target,
              ],
              [step.found === null ? "" : step.found ? "yes" : "no"],
              [step.files.length ? fileList(ctx, step.files, 6) : ""],
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
              [criterion.id],
              [criterion.app ?? "all"],
              [criterion.text],
              [badge(ctx, criterion.status, statusTone(criterion.status))],
              [
                criterion.tests.length
                  ? list(
                      ctx,
                      criterion.tests.map((test) => [
                        fileLink(ctx, test.file),
                        `:${test.line} `,
                        test.name ?? "",
                        " ",
                        badge(
                          ctx,
                          test.stale ? `${test.result}, stale` : test.result,
                          statusTone(test.result),
                        ),
                      ]),
                    )
                  : el("span", { class: "muted", text: "no test" }),
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
  if (data.findings.length)
    out.append(section(ctx, "Findings", [findingsView(ctx, data.findings)]));
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
  const out = el("div", { class: "grimoire-view" }, [
    el("h2", {
      text: `${plain(page.heading) ?? page.id} (${app} ${plain(page.route) ?? plain(page.screen) ?? page.id})`,
    }),
  ]);

  if (page.purpose) out.append(el("p", { text: page.purpose }));

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
              [from],
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
        el("p", {}, [fileLink(ctx, data.book.file)]),
        data.book.layouts?.length
          ? el("p", {}, ["Layouts: ", fileList(ctx, data.book.layouts)])
          : "",
        data.book.requires?.length
          ? el("p", { text: `Requires: ${data.book.requires.join(", ")}` })
          : "",
      ]),
    );
  }

  if (graph) out.append(graphView(ctx, graph, "The page and its blocks"));
  return out;
}

async function appsView(ctx) {
  const data = await ctx.api("apps");
  if (!data.apps.length) return ctx.empty("No apps are written in grimoire/apps.");
  return ctx.el(
    "div",
    { class: "grimoire-view" },
    data.apps.map((app) =>
      section(ctx, `${app.id} (${app.type})`, [
        ctx.el("p", { class: "muted", text: app.root }),
        app.pages.length || app.screens.length
          ? list(
              ctx,
              [...app.pages, ...app.screens].map((id) => [
                link(ctx, id, `page/${encodeURIComponent(app.id)}/${encodeURIComponent(id)}`),
              ]),
            )
          : ctx.empty("No pages written."),
      ]),
    ),
  );
}

async function tasksView(ctx, only) {
  const data = await ctx.api("tasks");
  // `waiting` is the part of `open` that waits for the owner: each task shows in one group only.
  const waiting = new Set(data.waiting.map((task) => task.id));
  const groups = [
    ["Open", data.open.filter((task) => !waiting.has(task.id))],
    ["Waiting for approval", data.waiting],
    ["Done", data.done],
  ]
    .map(([title, items]) => [title, only ? items.filter((task) => task.id === only) : items])
    .filter(([, items]) => items.length);

  if (!groups.length) {
    return ctx.empty(only ? `No task ${only}.` : "No tasks are written in grimoire/tasks.");
  }

  return ctx.el(
    "div",
    { class: "grimoire-view" },
    groups.map(([title, items]) =>
      section(ctx, `${title} (${items.length})`, [
        table(
          ctx,
          ["Task", "Type", "Status", "Feature", "Title", "Decision needed"],
          items.map((task) => [
            [link(ctx, task.id, `task/${encodeURIComponent(task.id)}`)],
            [task.type],
            [badge(ctx, task.status)],
            [
              task.feature
                ? link(ctx, task.feature, `feature/${encodeURIComponent(task.feature)}`)
                : "",
            ],
            [task.title],
            [task.decisionNeeded ?? ""],
          ]),
        ),
      ]),
    ),
  );
}

async function releasesView(ctx) {
  const data = await ctx.api("releases");
  if (!data.releases.length) return ctx.empty("No releases are written in grimoire/releases.");
  return section(ctx, "Releases", [
    table(
      ctx,
      ["Release", "Date", "File"],
      data.releases.map((item) => [
        [link(ctx, item.release, `release/${encodeURIComponent(item.release)}`)],
        [item.date],
        [item.file],
      ]),
    ),
  ]);
}

async function releaseView(ctx, id) {
  const data = await ctx.api(`releases/${encodeURIComponent(id)}`);
  const entries = data.collected?.entries ?? [];
  return ctx.el("div", { class: "grimoire-view" }, [
    ctx.el("h2", { text: `Release ${plain(data.release)} (${plain(data.date)})` }),
    data.brief ? ctx.el("p", { text: data.brief }) : "",
    section(ctx, "Collected entries", [
      entries.length
        ? list(
            ctx,
            entries.map((entry) => [
              `${entry.feature} ${entry.version}: ${entry.text ?? JSON.stringify(entry)}`,
            ]),
          )
        : ctx.empty("Nothing is listed for this release."),
    ]),
  ]);
}

async function checkView(ctx) {
  const report = await ctx.api("check");
  const { counts } = report;
  return ctx.el("div", { class: "grimoire-view" }, [
    ctx.el("h2", { text: report.ok ? "Check: no unexpected errors" : "Check: errors found" }),
    ctx.el("p", {
      class: "muted",
      text: `${counts.errors} errors, ${counts.warnings} warnings, ${counts.expected} expected; routes ${report.routes}`,
    }),
    report.findings.length ? findingsView(ctx, report.findings) : ctx.empty("No findings."),
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
    el("h2", { text: entry.file }),
    el("p", { class: "muted", text: `${entry.type} in ${entry.module}, ${entry.lines} lines` }),
  ]);
  if (entry.about) out.append(el("p", { text: entry.about }));

  const owner = [];
  if (entry.feature)
    owner.push(
      "Owned by ",
      link(ctx, entry.feature, `feature/${encodeURIComponent(entry.feature)}`),
      ". ",
    );
  if (entry.borrowedBy.length) owner.push("Borrowed by ", entry.borrowedBy.join(", "), ". ");
  if (entry.flows.length)
    owner.push("Used by flows: ", ...entry.flows.flatMap((flow) => [flowLink(ctx, flow), " "]));
  if (owner.length) out.append(el("p", {}, owner));

  out.append(
    section(ctx, "Exports", [
      entry.exports.length
        ? list(
            ctx,
            entry.exports.map((item) => [`${item.name}${item.about ? `: ${item.about}` : ""}`]),
          )
        : el("span", { class: "muted", text: "none" }),
    ]),
    section(ctx, "Imports", [fileList(ctx, entry.imports, 20)]),
    section(ctx, "Imported by", [fileList(ctx, entry.importedBy, 20)]),
  );

  if (entry.routes.length) {
    out.append(
      section(ctx, "Routes", [
        list(
          ctx,
          entry.routes.map((item) => [
            link(
              ctx,
              `${item.method} ${item.path}`,
              `route/${encodeURIComponent(item.method)}/${encodeURIComponent(item.path)}`,
            ),
            ` (${item.via})`,
          ]),
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
    el("h2", { text: `${found.method} ${found.path}` }),
    el("p", { class: "muted", text: found.description ?? found.handler }),
  ]);
  if (found.handlerFile) out.append(el("p", {}, ["Handler: ", fileLink(ctx, found.handlerFile)]));
  out.append(
    section(ctx, "Files behind it", [fileList(ctx, data.files, 20)]),
    section(ctx, "Flow steps", [
      data.steps.length
        ? list(
            ctx,
            data.steps.map((step) => [flowLink(ctx, step.flow), ` step ${step.index}`]),
          )
        : el("span", { class: "muted", text: "none" }),
    ]),
  );
  return out;
}

async function modulesView(ctx) {
  const graph = await ctx.api("graph/modules");
  return ctx.el("div", { class: "grimoire-view" }, [
    ctx.el("h2", { text: "Module coupling" }),
    ctx.el("p", {
      class: "muted",
      text: "Lines are imports between modules; thicker means more imports. The most connected modules are drawn.",
    }),
    graphView(ctx, graph, "Modules"),
  ]);
}

/** Pick the view for the hash route. */
async function body(ctx) {
  const parts = ctx.route ? ctx.route.split("/").map(decodeSegment) : [];
  const [type = "", first = "", second = ""] = parts;

  switch (type) {
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
      return homeView(ctx);
  }
}

/** The header: navigation and the one search box. Results appear under the box. */
function header(ctx) {
  const { el } = ctx;
  const results = el("div", { class: "grimoire-results" });
  let token = 0;
  let timer = null;

  async function run(text) {
    const mine = ++token;
    results.replaceChildren?.();
    if (!text.trim()) return;
    try {
      const answer = await ctx.api(`search?q=${encodeURIComponent(text.trim())}&limit=15`);
      if (mine !== token) return;
      results.replaceChildren?.();
      if (!answer.hits.length) {
        results.append(ctx.empty(`Nothing matches "${text.trim()}".`));
        return;
      }
      results.append(
        list(
          ctx,
          answer.hits.map((hit) => {
            const target = targetOf(hit.type, hit.id);
            return [
              badge(ctx, hit.type),
              " ",
              target === null ? hit.id : link(ctx, hit.id, target),
              hit.detail ? el("span", { class: "muted", text: ` ${hit.detail}` }) : "",
            ];
          }),
        ),
      );
    } catch (error) {
      if (mine === token)
        results.append(el("p", { class: "error", text: `Search failed: ${error.message}` }));
    }
  }

  const input = el("input", {
    type: "search",
    class: "grimoire-search",
    placeholder: "Search flows, blocks, routes, files and tasks",
    "aria-label": "Search the Grimoire",
    oninput: (event) => {
      const text = event.target.value;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => run(text), 150);
    },
  });
  const nav = el(
    "nav",
    { class: "grimoire-nav" },
    NAV.map(([target, label]) => link(ctx, label, target)),
  );

  return { element: el("div", { class: "grimoire-header" }, [nav, input, results]), run, input };
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
  if (typeof ctx.asset === "function")
    root.append(el("link", { rel: "stylesheet", href: ctx.asset("grimoire.css") }));
  const top = header(ctx);
  const content = el("div", { class: "grimoire-body" });
  root.append(top.element, content);

  try {
    content.append(await body(ctx));
  } catch (error) {
    content.append(el("p", { class: "error", text: `Could not load this view: ${error.message}` }));
  }
  return root;
}

export default renderGrimoire;
