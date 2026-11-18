/**
 * The product map: the Grimoire for readers who do not read code. A browser
 * ES module with two entry points:
 *
 * - `productMapView(ctx, parts)`: the "Product map" section inside the Grimoire
 *   tab. `parts` are the hash route segments after `product` (`[]`,
 *   `["feature", id]`, `["flow", feature, flow]`). Returns an element.
 * - the default export `renderProductMap(context)`: the page a read-only
 *   share link opens (`context.shared === true`), with the same context
 *   helpers as a panel view.
 *
 * It builds the DOM with the context's `el()` helper and sets every string
 * from the data as text, never as HTML. Every top-level name starts with
 * `product` or `PRODUCT` because the static export inlines this file next to
 * the Grimoire view.
 *
 * Keep the last line as it is: the static export swaps it out to inline this file.
 */

const PRODUCT_STATUS = {
  proposed: "Planned",
  building: "Being built",
  shipped: "Live",
  retired: "Retired",
};

const PRODUCT_LIGHT = {
  good: { label: "Working well", glyph: "✓" },
  attention: { label: "Needs attention", glyph: "!" },
  problem: { label: "Has problems", glyph: "✕" },
  unknown: { label: "Not checked yet", glyph: "?" },
};

const PRODUCT_PROOF = {
  pass: { level: "good", label: "Passing" },
  fail: { level: "problem", label: "Failing" },
  stale: { level: "attention", label: "Needs a new check (the tests changed)" },
  "not-run": { level: "attention", label: "Not checked yet" },
  "no-test": { level: "attention", label: "No test yet" },
};

const PRODUCT_CHANGE = { added: "Added", changed: "Changed", fixed: "Fixed", removed: "Removed" };

const PRODUCT_DEVELOPER_KEY = "grimoire-product-developer";

/** The helpers of one render: the context's `el()` made tolerant of nested and empty children. */
function productKit(ctx) {
  const flat = (children) =>
    Array.isArray(children)
      ? children
          .flat(Infinity)
          .filter((child) => child !== null && child !== undefined && child !== false)
      : children;
  const el = (tag, attrs = {}, children = []) => ctx.el(tag, attrs, flat(children));
  const shared = ctx.shared === true;
  const link = (to, text, attrs = {}) =>
    el("a", {
      ...attrs,
      // The host's href keeps a link inside its page (`#share/<route>` behind a share link), so it survives a reload or a new tab.
      href: typeof ctx.href === "function" ? ctx.href(to) : `#${to}`,
      text,
      onclick: (event) => {
        if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.button > 0)) return;
        event?.preventDefault?.();
        ctx.navigate(to);
      },
    });

  return { el, shared, link };
}

function productPlural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function productDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function productEncode(text) {
  return encodeURIComponent(text);
}

function productDate(value) {
  if (!value) return null;
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return String(value);

  try {
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return String(value);
  }
}

function productStatusChip(kit, status) {
  return kit.el("span", { class: `pm-chip pm-status pm-status--${status}`, text: PRODUCT_STATUS[status] ?? status });
}

/** A traffic light: a shape and words as well as a colour. */
function productLight(kit, level, label) {
  const light = PRODUCT_LIGHT[level] ?? PRODUCT_LIGHT.unknown;

  return kit.el("span", { class: `pm-light pm-light--${PRODUCT_LIGHT[level] ? level : "unknown"}` }, [
    kit.el("span", { class: "pm-light-glyph", "aria-hidden": "true", text: light.glyph }),
    kit.el("span", { text: label ?? light.label }),
  ]);
}

function productHealth(kit, health) {
  return kit.el("div", { class: "pm-health" }, [
    productLight(kit, health.level),
    kit.el("span", { class: "pm-health-reason", text: health.reason }),
  ]);
}

function productChips(kit, items, kind) {
  if (!items || items.length === 0) return null;

  return kit.el(
    "ul",
    { class: `pm-chips pm-chips--${kind}`, "aria-label": kind === "audience" ? "Who it is for" : "Where it lives" },
    items.map((item) => kit.el("li", { class: `pm-chip pm-chip--${kind}`, text: item })),
  );
}

function productSection(kit, title, body, attrs = {}) {
  return kit.el("section", { class: "pm-section", ...attrs }, [
    kit.el("h3", { class: "pm-section-title", text: title }),
    body,
  ]);
}

function productBreadcrumb(kit, trail) {
  return kit.el("nav", { class: "pm-crumbs", "aria-label": "Breadcrumb" }, [
    kit.el(
      "ol",
      {},
      trail.map((item, index) =>
        kit.el("li", {}, [
          item.to !== undefined && index < trail.length - 1
            ? kit.link(item.to, item.text)
            : kit.el("span", { "aria-current": "page", text: item.text }),
        ]),
      ),
    ),
  ]);
}

// ── Screenshots ───────────────────────────────────────────────────────────

/** One shared dialog per view; a screenshot button fills it and opens it. */
function productLightbox(ctx, kit) {
  const image = kit.el("img", { class: "pm-lightbox-image", alt: "" });
  const caption = kit.el("p", { class: "pm-lightbox-caption" });
  const dialog = kit.el(
    "dialog",
    {
      class: "pm-lightbox",
      "aria-label": "Screenshot",
      onclick: (event) => {
        if (event && event.target === dialog) dialog.close?.();
      },
    },
    [
      kit.el("div", { class: "pm-lightbox-body" }, [
        image,
        caption,
        kit.el("button", {
          type: "button",
          class: "pm-button",
          text: "Close",
          onclick: () => (typeof dialog.close === "function" ? dialog.close() : undefined),
        }),
      ]),
    ],
  );

  return {
    dialog,
    open(shot) {
      image.setAttribute("src", ctx.file(shot.src));
      image.setAttribute("alt", shot.alt);
      caption.textContent = shot.alt;

      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    },
  };
}

const PRODUCT_SHOT_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;

/**
 * Whether a screenshot path is a plain path inside the screenshots folder: no
 * scheme, no absolute path, no backslash and no empty, `.` or `..` segment, so
 * `ctx.file()` can never point an image outside the folder.
 */
function productShotPath(src) {
  if (typeof src !== "string" || src === "" || src.startsWith("/") || /[\\:\0?#]/.test(src)) return false;

  const segments = src.split("/");

  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..") && PRODUCT_SHOT_EXTENSION.test(src);
}

function productShots(ctx, kit, list, lightbox) {
  const shots = (list ?? []).filter((shot) => productShotPath(shot?.src));

  if (shots.length === 0 || typeof ctx.file !== "function") return null;

  return kit.el(
    "ul",
    { class: "pm-shots" },
    shots.map((shot) =>
      kit.el("li", {}, [
        kit.el(
          "button",
          {
            type: "button",
            class: "pm-shot",
            "aria-label": `Enlarge screenshot${shot.alt ? `: ${shot.alt}` : ""}`,
            onclick: () => lightbox.open(shot),
          },
          [kit.el("img", { src: ctx.file(shot.src), alt: shot.alt, loading: "lazy" })],
        ),
      ]),
    ),
  );
}

function productAppearances(ctx, kit, appearances, lightbox, withFlowLinks) {
  if (!appearances || appearances.length === 0) return null;

  const byApp = new Map();

  for (const item of appearances) {
    if (!byApp.has(item.app)) byApp.set(item.app, []);
    byApp.get(item.app).push(item);
  }

  return productSection(
    kit,
    "Where you see it",
    kit.el(
      "div",
      { class: "pm-apps" },
      [...byApp.entries()].map(([app, items]) =>
        kit.el("div", { class: "pm-app" }, [
          kit.el("h4", { text: app }),
          kit.el(
            "ul",
            { class: "pm-places" },
            items.map((item) =>
              kit.el("li", { class: "pm-place" }, [
                kit.el("div", { class: "pm-place-head" }, [
                  kit.el("strong", { text: item.title ?? item.id }),
                  item.route ? kit.el("span", { class: "pm-place-route", text: item.route }) : null,
                  withFlowLinks && item.flow
                    ? kit.link(`product/flow/${item.flow.split("/").map(productEncode).join("/")}`, "See the story", { class: "pm-place-flow" })
                    : null,
                ]),
                productShots(ctx, kit, item.screenshots, lightbox),
              ]),
            ),
          ),
        ]),
      ),
    ),
  );
}

// ── Developer toggle ──────────────────────────────────────────────────────

function productDeveloperToggle(kit, body) {
  let on = false;

  try {
    on = globalThis.localStorage?.getItem(PRODUCT_DEVELOPER_KEY) === "1";
  } catch {
    on = false;
  }

  const button = kit.el("button", {
    type: "button",
    class: "pm-button pm-developer-toggle",
    "aria-pressed": String(on),
    text: "For developers",
  });
  const panel = kit.el("section", { class: "pm-developer", "aria-label": "For developers" }, on ? body() : []);

  if (!on) panel.setAttribute("hidden", "");

  let built = on;

  button.addEventListener("click", () => {
    on = !on;

    try {
      globalThis.localStorage?.setItem(PRODUCT_DEVELOPER_KEY, on ? "1" : "0");
    } catch {
      // The choice is only a convenience.
    }

    button.setAttribute("aria-pressed", String(on));

    if (on && !built) {
      panel.replaceChildren(...[body()].flat());
      built = true;
    }

    if (on) panel.removeAttribute?.("hidden");
    else panel.setAttribute("hidden", "");
  });

  return { button, panel };
}

// ── Pages ─────────────────────────────────────────────────────────────────

function productLoadError(ctx, kit, what, error) {
  return kit.el("div", { class: "pm-error", role: "alert" }, [
    kit.el("h3", { text: `Could not load ${what}` }),
    kit.el("p", { text: error?.message ?? String(error) }),
    kit.el("p", {
      class: "pm-muted",
      text: kit.shared
        ? "Reload the page. If it still fails, the link may have expired or been revoked: ask the person who shared it for a new one."
        : "Check that the app is running, then try again.",
    }),
    kit.el("button", {
      type: "button",
      class: "pm-button",
      text: "Try again",
      onclick: () => ctx.refresh?.(),
    }),
  ]);
}

function productMapPage(ctx, kit, answer) {
  const features = answer.features ?? [];
  const live = features.filter((feature) => feature.status === "shipped").length;
  const attention = features.filter(
    (feature) => feature.health.level === "attention" || feature.health.level === "problem",
  ).length;
  const share = ctx.share?.enabled ? ctx.share : null;

  const header = kit.el("header", { class: "pm-hero" }, [
    kit.el("div", {}, [
      kit.el("h2", { text: "Product map" }),
      kit.el("p", {
        class: "pm-lead",
        text: "What the product does, who it is for and how healthy each part is, in plain words.",
      }),
    ]),
    share
      ? kit.el("a", { class: "pm-button pm-button--primary", href: share.manageHref, text: "Share this map" })
      : null,
  ]);

  if (features.length === 0) {
    return kit.el("div", { class: "pm-page" }, [
      header,
      kit.el("div", { class: "pm-empty" }, [
        kit.el("h3", { text: "No features are written yet" }),
        kit.el("p", {
          text: "Ask your agent to describe the product in grimoire/features. Each feature you describe becomes a card here.",
        }),
      ]),
    ]);
  }

  const apps = [...new Set(features.flatMap((feature) => feature.apps))].sort();
  const audiences = [...new Set(features.flatMap((feature) => feature.audience))].sort();
  const state = { text: "", app: "", audience: "" };
  const grid = kit.el("ul", { class: "pm-grid" });
  const count = kit.el("p", { class: "pm-count", role: "status", "aria-live": "polite" });
  const none = kit.el("p", { class: "pm-empty pm-empty--inline", text: "No feature matches. Clear the search or a filter." });

  const card = (feature) =>
    kit.el("li", { class: "pm-card" }, [
      kit.el("div", { class: "pm-card-top" }, [
        productStatusChip(kit, feature.status),
        kit.el("span", { class: "pm-muted", text: productPlural(feature.flows, "flow") }),
      ]),
      kit.el("h3", { class: "pm-card-title" }, [
        kit.link(`product/feature/${productEncode(feature.id)}`, feature.title, { class: "pm-card-link" }),
      ]),
      kit.el("p", {
        class: "pm-card-summary",
        text: feature.summary ?? "No summary yet.",
      }),
      productChips(kit, feature.audience, "audience"),
      productChips(kit, feature.apps, "app"),
      productHealth(kit, feature.health),
    ]);

  const show = () => {
    const needle = state.text.trim().toLowerCase();
    const matches = features.filter(
      (feature) =>
        (state.app === "" || feature.apps.includes(state.app)) &&
        (state.audience === "" || feature.audience.includes(state.audience)) &&
        (needle === "" ||
          feature.title.toLowerCase().includes(needle) ||
          (feature.summary ?? "").toLowerCase().includes(needle)),
    );

    grid.replaceChildren(...matches.map(card));
    count.textContent = `Showing ${matches.length} of ${features.length} features`;
    if (matches.length === 0) grid.append(none);
  };

  const select = (label, options, key) =>
    kit.el("label", { class: "pm-field" }, [
      kit.el("span", { text: label }),
      kit.el(
        "select",
        {
          onchange: (event) => {
            state[key] = event?.target?.value ?? "";
            show();
          },
        },
        [
          kit.el("option", { value: "", text: `All ${label.toLowerCase()}s` }),
          ...options.map((option) => kit.el("option", { value: option, text: option })),
        ],
      ),
    ]);

  const filters = kit.el("div", { class: "pm-filters", role: "search" }, [
    kit.el("label", { class: "pm-field pm-field--grow" }, [
      kit.el("span", { text: "Search" }),
      kit.el("input", {
        type: "search",
        placeholder: "Search by name or summary",
        oninput: (event) => {
          state.text = event?.target?.value ?? "";
          show();
        },
      }),
    ]),
    apps.length > 1 ? select("App", apps, "app") : null,
    audiences.length > 0 ? select("Audience", audiences, "audience") : null,
  ]);

  show();

  return kit.el("div", { class: "pm-page" }, [
    header,
    kit.el("ul", { class: "pm-stats", "aria-label": "At a glance" }, [
      kit.el("li", {}, [kit.el("strong", { text: String(features.length) }), kit.el("span", { text: "features" })]),
      kit.el("li", {}, [kit.el("strong", { text: String(live) }), kit.el("span", { text: "live" })]),
      kit.el("li", {}, [
        kit.el("strong", { text: String(attention) }),
        kit.el("span", { text: attention === 1 ? "needs attention" : "need attention" }),
      ]),
    ]),
    filters,
    count,
    grid,
  ]);
}

function productFlowCard(kit, flow) {
  return kit.el("li", { class: "pm-card pm-card--flow" }, [
    kit.el("div", { class: "pm-card-top" }, [
      productStatusChip(kit, flow.status),
      kit.el("span", { class: "pm-muted", text: flow.who }),
    ]),
    kit.el("h4", { class: "pm-card-title" }, [
      kit.link(`product/flow/${flow.ref.split("/").map(productEncode).join("/")}`, flow.title, { class: "pm-card-link" }),
    ]),
    kit.el("p", { class: "pm-card-summary", text: flow.summary ?? "No summary yet." }),
    productHealth(kit, flow.health),
  ]);
}

function productTimeline(kit, releases) {
  const ordered = [...releases].sort(
    (left, right) => Number(right.release === null) - Number(left.release === null),
  );

  return kit.el(
    "ol",
    { class: "pm-timeline" },
    ordered.map((item) => {
      const when = [
        item.release === null ? "Not released yet" : `Release ${item.release}`,
        productDate(item.date),
      ].filter(Boolean);

      return kit.el("li", { class: "pm-release" }, [
        kit.el("div", { class: "pm-release-head" }, [
          kit.el("strong", { text: `Version ${item.version}` }),
          kit.el("span", { class: "pm-muted", text: when.join(" · ") }),
        ]),
        kit.el(
          "ul",
          { class: "pm-changes" },
          item.changes.map((change) =>
            kit.el("li", {}, [
              kit.el("span", { class: `pm-chip pm-change pm-change--${change.word}`, text: PRODUCT_CHANGE[change.word] ?? change.word }),
              kit.el("span", { text: change.text }),
            ]),
          ),
        ),
      ]);
    }),
  );
}

function productPlanned(kit, planned) {
  return kit.el(
    "ul",
    { class: "pm-list" },
    planned.map((item) =>
      kit.el("li", {}, [
        kit.el("span", { class: "pm-chip", text: item.type === "bug" ? "Fix" : item.type === "feature" ? "New" : item.type === "decision" ? "Decision" : "Upkeep" }),
        kit.el("span", { text: item.title }),
        kit.el("span", { class: "pm-muted", text: item.status }),
      ]),
    ),
  );
}

function productFeaturePage(ctx, kit, answer, lightbox) {
  const feature = answer.feature;
  const health = answer.health;
  const sections = [];

  sections.push(
    kit.el("header", { class: "pm-title" }, [
      kit.el("div", { class: "pm-title-row" }, [
        kit.el("h2", { text: feature.title }),
        productStatusChip(kit, feature.status),
      ]),
      kit.el("p", { class: "pm-lead", text: feature.summary ?? "No summary yet." }),
      productChips(kit, feature.audience, "audience"),
      productChips(kit, feature.apps, "app"),
      kit.el("p", { class: "pm-muted", text: `Version ${feature.version}` }),
    ]),
  );

  sections.push(
    kit.el("section", { class: "pm-section pm-callout", "aria-label": "Health" }, [
      productHealth(kit, health),
      health.errors && health.errors.count > 0
        ? kit.el("p", {
            class: "pm-muted",
            text: `${productPlural(health.errors.count, "error")} in the last hour on the pages and routes this feature uses.`,
          })
        : null,
    ]),
  );

  if (feature.why) sections.push(productSection(kit, "Why it exists", kit.el("p", { class: "pm-prose", text: feature.why })));

  if (answer.flows.length > 0)
    sections.push(
      productSection(
        kit,
        "What people can do",
        kit.el("ul", { class: "pm-grid pm-grid--flows" }, answer.flows.map((flow) => productFlowCard(kit, flow))),
      ),
    );

  sections.push(productAppearances(ctx, kit, answer.appearances, lightbox, true));

  sections.push(
    productSection(
      kit,
      "What changed",
      answer.releases.length > 0
        ? productTimeline(kit, answer.releases)
        : kit.el("p", { class: "pm-muted", text: "No changes are recorded yet." }),
    ),
  );

  if (answer.planned.length > 0)
    sections.push(productSection(kit, "Coming next", productPlanned(kit, answer.planned)));

  return sections;
}

function productFeatureDeveloper(kit, developer) {
  return () => [
    kit.el("h3", { class: "pm-section-title", text: "For developers" }),
    kit.el("dl", { class: "pm-facts" }, [
      kit.el("dt", { text: "Folders" }),
      kit.el("dd", { class: "pm-mono", text: developer.folders.join(", ") || "none" }),
      kit.el("dt", { text: "Files it owns" }),
      kit.el("dd", { text: String(developer.files) }),
      kit.el("dt", { text: "Check findings" }),
      kit.el("dd", {
        text: `${productPlural(developer.findings.errors, "error")}, ${productPlural(developer.findings.warnings, "warning")}`,
      }),
      kit.el("dt", { text: "Routes" }),
      kit.el(
        "dd",
        {},
        developer.routes.length === 0
          ? "none"
          : kit.el(
              "ul",
              { class: "pm-mono pm-plain-list" },
              developer.routes.map((route) => kit.el("li", { text: `${route.method} ${route.path}` })),
            ),
      ),
    ]),
  ];
}

function productStory(ctx, kit, story, lightbox) {
  if (story.length === 0)
    return kit.el("p", { class: "pm-muted", text: "No steps are written for this flow yet." });

  return kit.el(
    "ol",
    { class: "pm-story" },
    story.map((step) =>
      kit.el("li", { class: "pm-step" }, [
        kit.el("p", { text: step.text }),
        step.derived ? kit.el("span", { class: "pm-chip pm-chip--soft", text: "from the technical steps" }) : null,
        productShots(ctx, kit, step.screenshots, lightbox),
      ]),
    ),
  );
}

function productCases(kit, cases) {
  const handled = cases.filter((item) => item.handled);
  const skipped = cases.filter((item) => !item.handled);
  const item = (entry) =>
    kit.el("li", {}, [
      kit.el("strong", { text: entry.question }),
      kit.el("p", { text: entry.handled ? entry.answer : entry.answer.replace(/^does not apply\b[:\s—-]*/i, "") }),
      entry.criteria.length > 0
        ? kit.el("span", { class: "pm-chip pm-chip--soft", text: `Checked by ${entry.criteria.join(", ")}` })
        : null,
    ]);

  return [
    handled.length > 0
      ? kit.el("ul", { class: "pm-cases" }, handled.map(item))
      : kit.el("p", { class: "pm-muted", text: "No edge cases are written yet." }),
    skipped.length > 0
      ? kit.el("details", { class: "pm-details" }, [
          kit.el("summary", { text: `Does not apply (${skipped.length})` }),
          kit.el("ul", { class: "pm-cases" }, skipped.map(item)),
        ])
      : null,
  ];
}

function productProof(kit, proof) {
  return kit.el(
    "ul",
    { class: "pm-proof" },
    proof.map((item) => {
      const status = PRODUCT_PROOF[item.status] ?? PRODUCT_PROOF["not-run"];

      return kit.el("li", {}, [
        productLight(kit, status.level, status.label),
        kit.el("span", { text: item.text }),
      ]);
    }),
  );
}

function productFlowPage(ctx, kit, answer, lightbox) {
  const flow = answer.flow;
  const neighbour = (item, label) =>
    item === null
      ? null
      : kit.link(`product/flow/${productEncode(flow.feature)}/${productEncode(item.id)}`, `${label}: ${item.heading ?? item.id}`, {
          class: "pm-button",
        });
  const sections = [
    productBreadcrumb(kit, [
      { text: "Product map", to: "product" },
      { text: flow.featureTitle, to: `product/feature/${productEncode(flow.feature)}` },
      { text: flow.title },
    ]),
    kit.el("header", { class: "pm-title" }, [
      kit.el("div", { class: "pm-title-row" }, [kit.el("h2", { text: flow.title }), productStatusChip(kit, flow.status)]),
      kit.el("p", { class: "pm-lead", text: flow.summary ?? "No summary yet." }),
      kit.el("p", { class: "pm-muted", text: `For ${flow.who} · since version ${flow.since}` }),
    ]),
    kit.el("section", { class: "pm-section pm-callout", "aria-label": "Health" }, [productHealth(kit, answer.health)]),
    productSection(kit, "How it goes", productStory(ctx, kit, answer.story, lightbox)),
    productSection(
      kit,
      "What proves it",
      answer.proof.length > 0
        ? productProof(kit, answer.proof)
        : kit.el("p", { class: "pm-muted", text: "No checks are written for this flow yet." }),
    ),
    productSection(kit, "What if…", kit.el("div", {}, productCases(kit, answer.cases))),
    productAppearances(ctx, kit, answer.appearances, lightbox, false),
    kit.el("nav", { class: "pm-neighbours", "aria-label": "Other flows of this feature" }, [
      neighbour(answer.previous, "Previous"),
      neighbour(answer.next, "Next"),
    ]),
  ];

  return sections;
}

/** A step's file counts, like the technical flow page: the type-only count only when there is one. */
function productStepCounts(counts) {
  const parts = [`${counts.direct} direct`, `${counts.feature} in this feature`, `${counts.reachable} reachable`];

  if (counts.typeOnly > 0) parts.push(`${counts.typeOnly} type-only`);

  return parts.join(" · ");
}

function productFlowDeveloper(ctx, kit, answer) {
  return () => [
    kit.el("h3", { class: "pm-section-title", text: "For developers" }),
    kit.link(`flows/${answer.flow.ref}`, "Open the technical flow page"),
    kit.el(
      "ol",
      { class: "pm-tech-steps" },
      answer.developer.steps.map((step) =>
        kit.el("li", {}, [
          kit.el("strong", { text: `${step.type} ` }),
          kit.el("span", { class: "pm-mono", text: step.target }),
          step.entry ? kit.el("div", { class: "pm-mono pm-muted", text: step.entry }) : null,
          kit.el("div", {
            class: "pm-muted",
            text: productStepCounts(step.counts),
          }),
        ]),
      ),
    ),
  ];
}

// ── Entry points ──────────────────────────────────────────────────────────

/** The product map section for the hash route segments after `product`. */
export async function productMapView(ctx, parts = []) {
  const kit = productKit(ctx);
  const { el } = kit;
  const root = el("div", { class: `pm-root${kit.shared ? " pm-shared" : ""}` });
  const lightbox = productLightbox(ctx, kit);

  if (typeof ctx.asset === "function")
    root.append(el("link", { rel: "stylesheet", href: ctx.asset("product-map.css") }));

  const main = el("main", { class: "pm-main", "aria-busy": "true" });
  const [kind, first, second] = parts.map(productDecode);

  root.append(main);

  try {
    if (kind === "feature" && first) {
      const answer = await ctx.api(`product/features/${productEncode(first)}`);
      const body = [
        productBreadcrumb(kit, [{ text: "Product map", to: "product" }, { text: answer.feature.title }]),
        ...productFeaturePage(ctx, kit, answer, lightbox),
      ];

      if (!kit.shared && answer.developer) {
        const toggle = productDeveloperToggle(kit, productFeatureDeveloper(kit, answer.developer));

        body.splice(1, 0, el("div", { class: "pm-toolbar" }, [toggle.button]));
        body.push(toggle.panel);
      }

      main.append(el("div", { class: "pm-page" }, body));
    } else if (kind === "flow" && first && second) {
      const answer = await ctx.api(`product/flows/${productEncode(first)}/${productEncode(second)}`);
      const body = productFlowPage(ctx, kit, answer, lightbox);

      if (!kit.shared && answer.developer) {
        const toggle = productDeveloperToggle(kit, productFlowDeveloper(ctx, kit, answer));

        body.splice(2, 0, el("div", { class: "pm-toolbar" }, [toggle.button]));
        body.push(toggle.panel);
      }

      main.append(el("div", { class: "pm-page" }, body));
    } else {
      main.append(productMapPage(ctx, kit, await ctx.api("product")));
    }
  } catch (error) {
    main.append(productLoadError(ctx, kit, kind === "feature" ? "this feature" : kind === "flow" ? "this flow" : "the product map", error));
  }

  main.setAttribute("aria-busy", "false");
  root.append(lightbox.dialog);

  if (kit.shared) root.append(el("footer", { class: "pm-footer", text: "Read-only view" }));

  return root;
}

/** The shared page: the map with no developer detail and no links into the rest of the tab. */
async function renderProductMap(context) {
  const parts = (context.route ?? "").split("/").filter(Boolean);

  if (parts[0] === "share" && (parts.length === 1 || parts[1] === "feature" || parts[1] === "flow")) parts.shift();
  if (parts[0] === "product") parts.shift();

  return productMapView({ ...context, shared: true }, parts);
}

export default renderProductMap;
