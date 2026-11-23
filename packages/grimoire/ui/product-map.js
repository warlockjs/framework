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
  return kit.el("span", {
    class: `pm-chip pm-status pm-status--${status}`,
    text: PRODUCT_STATUS[status] ?? status,
  });
}

/** A traffic light: a shape and words as well as a colour. */
function productLight(kit, level, label) {
  const light = PRODUCT_LIGHT[level] ?? PRODUCT_LIGHT.unknown;

  return kit.el(
    "span",
    { class: `pm-light pm-light--${PRODUCT_LIGHT[level] ? level : "unknown"}` },
    [
      kit.el("span", { class: "pm-light-glyph", "aria-hidden": "true", text: light.glyph }),
      kit.el("span", { text: label ?? light.label }),
    ],
  );
}

function productHealth(kit, health) {
  return kit.el("div", { class: "pm-health" }, [
    productLight(kit, health.level),
    kit.el("span", { class: "pm-health-reason", text: health.reason }),
  ]);
}

/**
 * The health strip of a feature card: four thin segments (flows written,
 * criteria proven by tests, screenshots present, open findings) and a legend
 * that says each number in words. Criteria with no recorded results are grey and
 * read "not measured": that is a missing measurement, not a problem.
 */
function productStrip(kit, strip) {
  if (!strip) return null;

  const share = (part, whole) =>
    whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0;
  const findings = strip.findings.errors + strip.findings.warnings;
  const criteria = strip.criteria;
  const parts = [
    {
      key: "flows",
      fill: share(strip.flows.shipped, strip.flows.total),
      tone: strip.flows.total ? "info" : "none",
      text: `${productPlural(strip.flows.total, "flow")} written, ${strip.flows.shipped} shipped`,
    },
    {
      key: "proof",
      fill: criteria.measured ? share(criteria.proven, criteria.total) : 0,
      tone:
        !criteria.total || !criteria.measured
          ? "none"
          : criteria.failing
            ? "bad"
            : criteria.proven === criteria.total
              ? "good"
              : "warn",
      text: !criteria.total
        ? "No criteria written"
        : criteria.measured
          ? `${criteria.proven} of ${criteria.total} criteria proven by tests`
          : `${criteria.total} criteria, test results not measured`,
    },
    {
      key: "shots",
      fill: share(strip.screenshots.present, strip.screenshots.places),
      tone: !strip.screenshots.places
        ? "none"
        : strip.screenshots.present === strip.screenshots.places
          ? "good"
          : "warn",
      text: strip.screenshots.places
        ? `${strip.screenshots.present} of ${productPlural(strip.screenshots.places, "place")} with a screenshot`
        : "No pages show it yet",
    },
    {
      key: "findings",
      fill: 100,
      tone: strip.findings.errors ? "bad" : findings ? "warn" : "good",
      text: findings ? `${productPlural(findings, "open finding")}` : "No open findings",
    },
  ];
  const summary = parts.map((part) => part.text).join("; ");

  return kit.el(
    "div",
    { class: "pm-strip", role: "group", "aria-label": "Health", title: summary },
    [
      kit.el(
        "div",
        { class: "pm-strip-bar", "aria-hidden": "true" },
        parts.map((part) =>
          kit.el("span", { class: `pm-strip-seg is-${part.tone}` }, [
            kit.el("span", { class: "pm-strip-fill", style: `width: ${part.fill}%` }),
          ]),
        ),
      ),
      kit.el(
        "ul",
        { class: "pm-strip-legend" },
        parts.map((part) =>
          kit.el("li", { class: `pm-strip-item is-${part.tone}` }, [
            kit.el("span", { class: "pm-strip-dot", "aria-hidden": "true" }),
            part.text,
          ]),
        ),
      ),
    ],
  );
}

function productChips(kit, items, kind) {
  if (!items || items.length === 0) return null;

  return kit.el(
    "ul",
    {
      class: `pm-chips pm-chips--${kind}`,
      "aria-label": kind === "audience" ? "Who it is for" : "Where it lives",
    },
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
  if (typeof src !== "string" || src === "" || src.startsWith("/") || /[\\:\0?#]/.test(src))
    return false;

  const segments = src.split("/");

  return (
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    PRODUCT_SHOT_EXTENSION.test(src)
  );
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

/**
 * One row per page or screen, not per block: the blocks that show the flow are
 * listed under the page, and a screenshot the blocks share is shown once.
 */
function productPlaces(items) {
  const places = new Map();

  for (const item of items) {
    const key = `${item.type}|${item.id}`;
    let place = places.get(key);

    if (!place) {
      place = { ...item, blocks: [], flows: [], screenshots: [] };
      places.set(key, place);
    }

    if (item.block && !place.blocks.includes(item.block)) place.blocks.push(item.block);
    if (item.flow && !place.flows.includes(item.flow)) place.flows.push(item.flow);

    for (const shot of item.screenshots ?? []) {
      if (!place.screenshots.some((known) => known.src === shot.src)) place.screenshots.push(shot);
    }
  }

  return [...places.values()];
}

function productAppearances(ctx, kit, appearances, lightbox, withFlowLinks) {
  if (!appearances || appearances.length === 0) return null;

  const byApp = new Map();

  for (const item of appearances) {
    if (!byApp.has(item.app)) byApp.set(item.app, { title: item.appTitle ?? null, items: [] });
    byApp.get(item.app).items.push(item);
  }

  return productSection(
    kit,
    "Where you see it",
    kit.el(
      "div",
      { class: "pm-apps" },
      [...byApp.entries()].map(([app, group]) =>
        kit.el("div", { class: "pm-app" }, [
          kit.el("h4", { text: group.title ?? app }),
          kit.el(
            "ul",
            { class: "pm-places" },
            productPlaces(group.items).map((item) =>
              kit.el("li", { class: "pm-place" }, [
                kit.el("div", { class: "pm-place-head" }, [
                  kit.el("strong", { text: item.title ?? item.id }),
                  item.route ? kit.el("span", { class: "pm-place-route", text: item.route }) : null,
                  ...(withFlowLinks
                    ? item.flows.map((flow) =>
                        kit.link(
                          `product/flow/${flow.split("/").map(productEncode).join("/")}`,
                          item.flows.length > 1
                            ? `See the story of ${flow.split("/").pop()}`
                            : "See the story",
                          { class: "pm-place-flow" },
                        ),
                      )
                    : []),
                ]),
                item.blocks.length > 0
                  ? kit.el(
                      "ul",
                      { class: "pm-place-blocks", "aria-label": "Blocks that show it" },
                      item.blocks.map((block) => kit.el("li", { text: block })),
                    )
                  : null,
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
  const panel = kit.el(
    "section",
    { class: "pm-developer", "aria-label": "For developers" },
    on ? body() : [],
  );

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

/** The sorts of the feature cards. `id` is the written order and the default. */
const PRODUCT_SORTS = [
  { value: "id", label: "Feature id" },
  { value: "name", label: "Name" },
  { value: "changed", label: "Recently changed" },
  { value: "health", label: "Health (worst first)" },
];

const PRODUCT_HEALTH_ORDER = { problem: 0, attention: 1, unknown: 2, good: 3 };

const productCompareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/** The cards in the order `sort` names; the sort is stable, so equal cards keep their written order. */
export function productSortFeatures(features, sort) {
  const list = features.map((feature, index) => ({ feature, index }));
  const by = {
    id: (a, b) => productCompareText(a.feature.id, b.feature.id),
    name: (a, b) => a.feature.title.localeCompare(b.feature.title),
    changed: (a, b) => productCompareText(b.feature.changedAt ?? "", a.feature.changedAt ?? ""),
    health: (a, b) =>
      (PRODUCT_HEALTH_ORDER[a.feature.health.level] ?? 2) -
      (PRODUCT_HEALTH_ORDER[b.feature.health.level] ?? 2),
  }[sort];

  if (!by) return features;

  return list.sort((a, b) => by(a, b) || a.index - b.index).map((item) => item.feature);
}

/** The flow cards in the order `sort` names (`written`, `name`, `health`); the sort is stable. */
export function productSortFlows(flows, sort) {
  const list = flows.map((flow, index) => ({ flow, index }));
  const by = {
    name: (a, b) => (a.flow.title ?? "").localeCompare(b.flow.title ?? ""),
    health: (a, b) =>
      (PRODUCT_HEALTH_ORDER[a.flow.health?.level] ?? 2) -
      (PRODUCT_HEALTH_ORDER[b.flow.health?.level] ?? 2),
  }[sort];

  if (!by) return flows;

  return list.sort((a, b) => by(a, b) || a.index - b.index).map((item) => item.flow);
}

/**
 * The features that changed since a day (`yyyy-mm-dd`) or since a release (the release's own
 * changes included, and anything not yet released). An empty `since` keeps every feature.
 */
export function productChangedSince(features, since, releases = []) {
  if (!since) return features;

  if (since.startsWith("release:")) {
    const name = since.slice("release:".length);
    const position = releases.findIndex((item) => item.release === name);

    if (position < 0) return features;

    const later = new Set(releases.slice(position).map((item) => item.release));

    return features.filter(
      (feature) =>
        feature.unreleased === true ||
        (feature.changedIn ?? []).some((release) => later.has(release)),
    );
  }

  return features.filter((feature) => (feature.changedAt ?? "") >= since);
}

/** The "changed since" choices: the last week and month before the newest change, and each written release. */
function productSinceChoices(features, releases) {
  const validDay = (value) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
  const newest = features.reduce(
    (max, feature) =>
      validDay(feature.changedAt) && feature.changedAt > max ? feature.changedAt : max,
    "",
  );
  const choices = [];

  if (newest !== "") {
    for (const [days, label] of [
      [7, "Last 7 days"],
      [30, "Last 30 days"],
    ]) {
      const day = new Date(`${newest}T00:00:00Z`);

      day.setUTCDate(day.getUTCDate() - days);
      choices.push({ value: day.toISOString().slice(0, 10), label: `${label} of activity` });
    }
  }

  for (const item of [...releases].reverse())
    choices.push({ value: `release:${item.release}`, label: `Release ${item.release} and later` });

  return choices;
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
    kit.el("div", { class: "pm-hero-actions" }, [
      kit.link("product/whats-new", "What's new", { class: "pm-button" }),
      share
        ? kit.el("a", {
            class: "pm-button pm-button--primary",
            href: share.manageHref,
            text: "Share this map",
          })
        : null,
    ]),
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
  const releases = answer.releases ?? [];
  const state = { text: "", app: "", audience: "", sort: "id", since: "" };
  const grid = kit.el("ul", { class: "pm-grid" });
  const count = kit.el("p", { class: "pm-count", role: "status", "aria-live": "polite" });
  const none = kit.el("p", {
    class: "pm-empty pm-empty--inline",
    text: "No feature matches. Clear the search or a filter.",
  });

  const card = (feature) =>
    kit.el("li", { class: "pm-card" }, [
      kit.el("div", { class: "pm-card-top" }, [
        productStatusChip(kit, feature.status),
        kit.el("span", { class: "pm-muted", text: productPlural(feature.flows, "flow") }),
      ]),
      kit.el("h3", { class: "pm-card-title" }, [
        kit.link(`product/feature/${productEncode(feature.id)}`, feature.title, {
          class: "pm-card-link",
        }),
      ]),
      kit.el("p", {
        class: "pm-card-summary",
        text: feature.summary ?? "No summary yet.",
      }),
      productChips(kit, feature.audience, "audience"),
      productChips(kit, feature.apps, "app"),
      productStrip(kit, feature.strip),
      productHealth(kit, feature.health),
    ]);

  const show = () => {
    const needle = state.text.trim().toLowerCase();
    const matches = productSortFeatures(
      productChangedSince(features, state.since, releases),
      state.sort,
    ).filter(
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
    kit.el("label", { class: "pm-field" }, [
      kit.el("span", { text: "Sort by" }),
      kit.el(
        "select",
        {
          "data-pm": "sort",
          onchange: (event) => {
            state.sort = event?.target?.value ?? "id";
            show();
          },
        },
        PRODUCT_SORTS.map((item) => kit.el("option", { value: item.value, text: item.label })),
      ),
    ]),
    kit.el("label", { class: "pm-field" }, [
      kit.el("span", { text: "Changed since" }),
      kit.el(
        "select",
        {
          "data-pm": "since",
          onchange: (event) => {
            state.since = event?.target?.value ?? "";
            show();
          },
        },
        [
          kit.el("option", { value: "", text: "Any time" }),
          ...productSinceChoices(features, releases).map((item) =>
            kit.el("option", { value: item.value, text: item.label }),
          ),
        ],
      ),
    ]),
  ]);

  show();

  return kit.el("div", { class: "pm-page" }, [
    header,
    kit.el("ul", { class: "pm-stats", "aria-label": "At a glance" }, [
      kit.el("li", {}, [
        kit.el("strong", { text: String(features.length) }),
        kit.el("span", { text: "features" }),
      ]),
      kit.el("li", {}, [
        kit.el("strong", { text: String(live) }),
        kit.el("span", { text: "live" }),
      ]),
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
      kit.link(`product/flow/${flow.ref.split("/").map(productEncode).join("/")}`, flow.title, {
        class: "pm-card-link",
      }),
    ]),
    kit.el("p", { class: "pm-card-summary", text: flow.summary ?? "No summary yet." }),
    productHealth(kit, flow.health),
  ]);
}

/** A reference id: `AC-6`, `T-089`, `QA 1.5.6`. */
const PRODUCT_REF = /^(?:[A-Z]{1,5}-\d+|QA\s+\d[\w.-]*)$/;
/** A trailing parenthesised group (optionally followed by one end mark) at the end of a sentence. */
const PRODUCT_TRAILING_GROUP = /\s*\(([^()]*)\)\s*([.!?]?)\s*$/;

/**
 * Split the reference ids off the end of a change sentence: `"Fixed the total (AC-6, T-089)."` gives
 * `{ text: "Fixed the total.", refs: ["AC-6", "T-089"] }`. Only a trailing parenthesised group whose items are
 * all reference ids is taken, so ordinary parentheses in the text stay.
 */
export function productSplitRefs(sentence) {
  let text = String(sentence ?? "");
  const refs = [];

  for (;;) {
    const match = PRODUCT_TRAILING_GROUP.exec(text);

    if (!match) break;

    const parts = match[1]
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length === 0 || !parts.every((part) => PRODUCT_REF.test(part))) break;

    refs.unshift(...parts);
    text = `${text.slice(0, match.index)}${match[2]}`;
  }

  return { text: text.trim(), refs };
}

const PRODUCT_CHANGE_ORDER = ["added", "changed", "fixed", "removed"];

function productTimeline(kit, releases) {
  const ordered = [...releases].sort(
    (left, right) => Number(right.release === null) - Number(left.release === null),
  );

  return kit.el(
    "ol",
    { class: "pm-timeline" },
    ordered.map((item) => {
      const groups = new Map();

      for (const change of item.changes)
        groups.set(change.word, [...(groups.get(change.word) ?? []), change]);

      const words = [
        ...PRODUCT_CHANGE_ORDER.filter((word) => groups.has(word)),
        ...[...groups.keys()].filter((word) => !PRODUCT_CHANGE_ORDER.includes(word)),
      ];
      const date = productDate(item.date);

      return kit.el("li", { class: `pm-release${item.release === null ? " is-unreleased" : ""}` }, [
        kit.el("div", { class: "pm-release-head" }, [
          kit.el("strong", { class: "pm-release-version", text: `Version ${item.version}` }),
          item.release === null
            ? kit.el("span", {
                class: "pm-chip pm-chip--soft pm-release-state",
                text: "Unreleased",
              })
            : kit.el("span", {
                class: "pm-muted pm-release-state",
                text: [`Release ${item.release}`, date].filter(Boolean).join(" · "),
              }),
        ]),
        words.length === 0
          ? kit.el("p", { class: "pm-muted", text: "No changes are listed for this version." })
          : kit.el(
              "div",
              { class: "pm-change-groups" },
              words.map((word) =>
                kit.el("section", { class: "pm-change-group" }, [
                  kit.el("h4", {
                    class: `pm-change-type pm-change--${word}`,
                    text: PRODUCT_CHANGE[word] ?? word,
                  }),
                  kit.el(
                    "ul",
                    { class: "pm-changes" },
                    // Criterion and task ids are for developers: this list is for people who read the product, not the code.
                    groups.get(word).map((change) =>
                      kit.el("li", {}, [
                        kit.el("span", {
                          class: "pm-change-text",
                          text: productSplitRefs(change.text).text,
                        }),
                      ]),
                    ),
                  ),
                ]),
              ),
            ),
      ]);
    }),
  );
}

/** One release of the What's new view: its date, the brief, then the changes per feature in plain words. */
function productWhatsNewRelease(kit, release, alone) {
  const date = productDate(release.date);
  const name = release.release === null ? "Not released yet" : `Version ${release.release}`;

  return kit.el("li", { class: `pm-release${release.release === null ? " is-unreleased" : ""}` }, [
    kit.el("div", { class: "pm-release-head" }, [
      release.release === null || alone
        ? kit.el("h3", { class: "pm-release-version", text: name })
        : kit.el("h3", { class: "pm-release-version" }, [
            kit.link(`product/whats-new/${productEncode(release.release)}`, name),
          ]),
      date ? kit.el("span", { class: "pm-muted pm-release-state", text: date }) : null,
      release.release === null
        ? kit.el("span", { class: "pm-chip pm-chip--soft pm-release-state", text: "Unreleased" })
        : null,
    ]),
    release.brief ? kit.el("p", { class: "pm-prose", text: release.brief }) : null,
    release.features.length === 0
      ? kit.el("p", { class: "pm-muted", text: "No changes are listed for this version." })
      : kit.el(
          "div",
          { class: "pm-whatsnew-features" },
          release.features.map((feature) => {
            const groups = new Map();

            for (const change of feature.changes)
              groups.set(change.word, [...(groups.get(change.word) ?? []), change]);

            const words = [
              ...PRODUCT_CHANGE_ORDER.filter((word) => groups.has(word)),
              ...[...groups.keys()].filter((word) => !PRODUCT_CHANGE_ORDER.includes(word)),
            ];

            return kit.el("div", { class: "pm-whatsnew-feature" }, [
              kit.el("h4", {}, [
                kit.link(`product/feature/${productEncode(feature.id)}`, feature.title),
              ]),
              kit.el(
                "ul",
                { class: "pm-changes" },
                words.flatMap((word) =>
                  groups.get(word).map((change) =>
                    kit.el("li", {}, [
                      kit.el("span", {
                        class: `pm-change-type pm-change--${word}`,
                        text: PRODUCT_CHANGE[word] ?? word,
                      }),
                      kit.el("span", {
                        class: "pm-change-text",
                        text: `${change.flow ? `${change.flow}: ` : ""}${productSplitRefs(change.text).text}`,
                      }),
                    ]),
                  ),
                ),
              ),
            ]);
          }),
        ),
  ]);
}

/** `#grimoire/product/whats-new[/<release>]`: the releases newest first, or one release. */
function productWhatsNewPage(kit, answer, only) {
  const releases = only
    ? answer.releases.filter((release) => release.release === only)
    : answer.releases;
  const trail = [{ text: "Product map", to: "product" }];

  if (only)
    trail.push({ text: "What's new", to: "product/whats-new" }, { text: `Version ${only}` });
  else trail.push({ text: "What's new" });

  return kit.el("div", { class: "pm-page" }, [
    productBreadcrumb(kit, trail),
    kit.el("header", { class: "pm-title" }, [
      kit.el("h2", { text: "What's new" }),
      kit.el("p", {
        class: "pm-lead",
        text: "What changed in each release, in plain words, newest first.",
      }),
    ]),
    releases.length === 0
      ? kit.el("div", { class: "pm-empty" }, [
          kit.el("h3", { text: only ? `No release "${only}" is written` : "No releases yet" }),
          kit.el("p", {
            text: only
              ? "Open What's new for the list of releases."
              : "When a release is stamped (warlock grimoire release --stamp), its changes are listed here.",
          }),
        ])
      : kit.el(
          "ol",
          { class: "pm-timeline pm-whatsnew" },
          releases.map((release) => productWhatsNewRelease(kit, release, Boolean(only))),
        ),
  ]);
}

/** The host the adapter reported, or `null` when there is none. */
function productHost(host) {
  return host && typeof host === "object" ? host : null;
}

/** "Warlock.js v5.58.0" with the logo, for the footer of the shared page. */
function productBrandLine(kit, host) {
  return kit.el("span", { class: "pm-brand" }, [
    host.logo
      ? kit.el("img", {
          class: "pm-brand-logo",
          src: host.logo,
          alt: "",
          width: "16",
          height: "16",
        })
      : null,
    kit.el("span", { text: host.version ? `${host.name} v${host.version}` : host.name }),
  ]);
}

function productPlanned(kit, planned) {
  return kit.el(
    "ul",
    { class: "pm-list" },
    planned.map((item) =>
      kit.el("li", {}, [
        kit.el("span", {
          class: "pm-chip",
          text:
            item.type === "bug"
              ? "Fix"
              : item.type === "feature"
                ? "New"
                : item.type === "decision"
                  ? "Decision"
                  : "Upkeep",
        }),
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

  if (feature.why)
    sections.push(
      productSection(kit, "Why it exists", kit.el("p", { class: "pm-prose", text: feature.why })),
    );

  if (answer.flows.length > 0) {
    const list = kit.el("ul", { class: "pm-grid pm-grid--flows" });
    const showFlows = (sort) =>
      list.replaceChildren(
        ...productSortFlows(answer.flows, sort).map((flow) => productFlowCard(kit, flow)),
      );

    showFlows("written");
    sections.push(
      productSection(kit, "What people can do", [
        answer.flows.length > 1
          ? kit.el("label", { class: "pm-field" }, [
              kit.el("span", { text: "Sort by" }),
              kit.el(
                "select",
                {
                  "data-pm": "flow-sort",
                  onchange: (event) => showFlows(event?.target?.value ?? "written"),
                },
                [
                  kit.el("option", { value: "written", text: "As written" }),
                  kit.el("option", { value: "name", text: "Name" }),
                  kit.el("option", { value: "health", text: "Health (worst first)" }),
                ],
              ),
            ])
          : null,
        list,
      ]),
    );
  }

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
              developer.routes.map((route) =>
                kit.el("li", { text: `${route.method} ${route.path}` }),
              ),
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
        step.derived
          ? kit.el("span", { class: "pm-chip pm-chip--soft", text: "from the technical steps" })
          : null,
        productShots(ctx, kit, step.screenshots, lightbox),
      ]),
    ),
  );
}

/** The fixed case questions as the plain question a reader asks. A flow's own label is shown as written. */
const PRODUCT_CASE_SENTENCES = {
  "invalid input": "What if the input is not valid?",
  "not allowed": "What if the person is not allowed to do this?",
  "not found": "What if it cannot be found?",
  duplicate: "What if it already exists?",
  limits: "What if a limit is reached?",
  expiry: "What if it has expired?",
  "double submit": "What if it is sent twice?",
  "outside service down": "What if an outside service is down?",
  "server unreachable": "What if the server cannot be reached?",
  "server error": "What if the server fails?",
};

function productCaseSentence(question) {
  const text = String(question ?? "").trim();
  const known = PRODUCT_CASE_SENTENCES[text.toLowerCase()];

  if (known) return known;

  return text === "" ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function productCases(kit, cases) {
  const handled = cases.filter((item) => item.handled);
  const skipped = cases.filter((item) => !item.handled);
  const item = (entry) =>
    kit.el("li", {}, [
      kit.el("strong", { text: productCaseSentence(entry.question) }),
      kit.el("p", {
        text: entry.handled ? entry.answer : entry.answer.replace(/^does not apply\b[:\s—-]*/i, ""),
      }),
      entry.criteria.length > 0
        ? kit.el("span", {
            class: "pm-chip pm-chip--soft",
            text: `Checked by ${productPlural(entry.criteria.length, "check")}`,
          })
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
      : kit.link(
          `product/flow/${productEncode(flow.feature)}/${productEncode(item.id)}`,
          `${label}: ${item.heading ?? item.id}`,
          {
            class: "pm-button",
          },
        );
  const sections = [
    productBreadcrumb(kit, [
      { text: "Product map", to: "product" },
      { text: flow.featureTitle, to: `product/feature/${productEncode(flow.feature)}` },
      { text: flow.title },
    ]),
    kit.el("header", { class: "pm-title" }, [
      kit.el("div", { class: "pm-title-row" }, [
        kit.el("h2", { text: flow.title }),
        productStatusChip(kit, flow.status),
      ]),
      kit.el("p", { class: "pm-lead", text: flow.summary ?? "No summary yet." }),
      kit.el("p", { class: "pm-muted", text: `${flow.who} · since version ${flow.since}` }),
    ]),
    kit.el("section", { class: "pm-section pm-callout", "aria-label": "Health" }, [
      productHealth(kit, answer.health),
    ]),
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
  const parts = [
    `${counts.direct} direct`,
    `${counts.feature} in this feature`,
    `${counts.reachable} reachable`,
  ];

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

  let answerHost = null;

  root.append(main);

  try {
    if (kind === "feature" && first) {
      const answer = await ctx.api(`product/features/${productEncode(first)}`);

      answerHost = answer.host;
      const body = [
        productBreadcrumb(kit, [
          { text: "Product map", to: "product" },
          { text: answer.feature.title },
        ]),
        ...productFeaturePage(ctx, kit, answer, lightbox),
      ];

      if (!kit.shared && answer.developer) {
        const toggle = productDeveloperToggle(kit, productFeatureDeveloper(kit, answer.developer));

        body.splice(1, 0, el("div", { class: "pm-toolbar" }, [toggle.button]));
        body.push(toggle.panel);
      }

      main.append(el("div", { class: "pm-page" }, body));
    } else if (kind === "whats-new") {
      const answer = await ctx.api("product/whats-new");

      answerHost = answer.host;
      main.append(productWhatsNewPage(kit, answer, first || null));
    } else if (kind === "flow" && first && second) {
      const answer = await ctx.api(
        `product/flows/${productEncode(first)}/${productEncode(second)}`,
      );

      answerHost = answer.host;
      const body = productFlowPage(ctx, kit, answer, lightbox);

      if (!kit.shared && answer.developer) {
        const toggle = productDeveloperToggle(kit, productFlowDeveloper(ctx, kit, answer));

        body.splice(2, 0, el("div", { class: "pm-toolbar" }, [toggle.button]));
        body.push(toggle.panel);
      }

      main.append(el("div", { class: "pm-page" }, body));
    } else {
      const answer = await ctx.api("product");

      answerHost = answer.host;
      main.append(productMapPage(ctx, kit, answer));
    }
  } catch (error) {
    main.append(
      productLoadError(
        ctx,
        kit,
        kind === "feature"
          ? "this feature"
          : kind === "flow"
            ? "this flow"
            : kind === "whats-new"
              ? "what's new"
              : "the product map",
        error,
      ),
    );
  }

  main.setAttribute("aria-busy", "false");
  root.append(lightbox.dialog);

  if (kit.shared) {
    const host = productHost(answerHost);
    const app =
      host && host.app && host.app.name
        ? `${host.app.name}${host.app.version ? ` ${host.app.version}` : ""}`
        : null;

    root.append(
      el("footer", { class: "pm-footer" }, [
        el("span", { text: "Read-only view" }),
        app ? el("span", { class: "pm-mono", text: app }) : null,
        host && host.name ? productBrandLine(kit, host) : null,
      ]),
    );
  }

  return root;
}

/** The shared page: the map with no developer detail and no links into the rest of the tab. */
async function renderProductMap(context) {
  const parts = (context.route ?? "").split("/").filter(Boolean);

  if (
    parts[0] === "share" &&
    (parts.length === 1 ||
      parts[1] === "feature" ||
      parts[1] === "flow" ||
      parts[1] === "whats-new")
  )
    parts.shift();
  if (parts[0] === "product") parts.shift();

  return productMapView({ ...context, shared: true }, parts);
}

export default renderProductMap;
