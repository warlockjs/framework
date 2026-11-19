import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { fakeHelpers, type FakeNode } from "../../tests/support/fake-dom";

const modulePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "ui",
  "product-map.js",
);

type Mod = {
  productSplitRefs: (sentence: string) => { text: string; refs: string[] };
  productMapView: (ctx: unknown, parts: string[]) => Promise<FakeNode>;
  productSortFeatures: (features: unknown[], sort: string) => { id: string }[];
  productSortFlows: (flows: unknown[], sort: string) => { id: string }[];
  productChangedSince: (
    features: unknown[],
    since: string,
    releases?: unknown[],
  ) => { id: string }[];
  default: (ctx: unknown) => Promise<FakeNode>;
};

const load = async (): Promise<Mod> =>
  (await import(/* @vite-ignore */ pathToFileURL(modulePath).href)) as Mod;

const health = (level: string, reason: string) => ({
  level,
  reason,
  criteria: { total: 3, pass: 3, fail: 0, stale: 0, notRun: 0, noTest: 0 },
  errors: null,
});
const shot = { src: "web/checkout.png", alt: "The checkout page" };

const mapAnswer = {
  builtAt: "2026-11-18T10:00:00.000Z",
  developer: true,
  apps: [],
  features: [
    {
      id: "checkout",
      title: "Checkout",
      summary: "Pay for what is in your basket.",
      audience: ["shoppers"],
      apps: ["web", "mobile"],
      status: "shipped",
      version: "2.0",
      flows: 2,
      health: health("good", "All 3 checks pass"),
      strip: {
        flows: { total: 2, shipped: 1 },
        criteria: { total: 3, proven: 3, failing: 0, measured: true },
        screenshots: { places: 2, present: 1 },
        findings: { errors: 0, warnings: 2 },
      },
    },
    {
      id: "returns",
      title: "Returns",
      summary: null,
      audience: ["support"],
      apps: ["web"],
      status: "building",
      version: "0.1",
      flows: 1,
      health: health("problem", "1 of 3 checks fail"),
    },
  ],
};

const featureAnswer = {
  feature: {
    id: "checkout",
    title: "Checkout",
    summary: "Pay for what is in your basket.",
    why: "Shoppers need to pay.",
    audience: ["shoppers"],
    apps: ["web"],
    status: "shipped",
    version: "2.0",
    updated: "2026-11-01",
    origin: "confirmed",
  },
  flows: [
    {
      id: "pay",
      ref: "checkout/pay",
      title: "Pay by card",
      summary: "Enter a card and pay.",
      who: "shoppers",
      status: "shipped",
      health: health("attention", "1 of 3 checks have no test"),
    },
  ],
  appearances: [
    {
      app: "web",
      type: "page",
      id: "checkout",
      title: "Checkout",
      route: "/checkout",
      block: "form",
      flow: "checkout/pay",
      screenshots: [shot],
    },
  ],
  releases: [
    {
      version: "1.0",
      release: "5.1.0",
      date: "2026-10-01",
      changes: [{ word: "added", flow: null, text: "Pay by card." }],
    },
    {
      version: "2.0",
      release: null,
      date: null,
      changes: [{ word: "fixed", flow: null, text: "Totals round correctly." }],
    },
  ],
  planned: [{ id: "T-1", title: "Add wallets", type: "feature", status: "open", flow: null }],
  health: health("good", "All 3 checks pass"),
  developer: {
    folders: ["src/app/checkout"],
    routes: [{ method: "POST", path: "/pay", name: null }],
    files: 12,
    findings: { errors: 0, warnings: 1, expected: 0 },
  },
};

const flowAnswer = {
  flow: {
    ref: "checkout/pay",
    feature: "checkout",
    featureTitle: "Checkout",
    title: "Pay by card",
    summary: "Enter a card and pay.",
    who: "shoppers",
    status: "shipped",
    since: "1.0",
  },
  story: [
    { index: 1, text: "Open the checkout.", screenshots: [shot], derived: false },
    { index: 2, text: "Pay.", screenshots: [], derived: true },
  ],
  proof: [
    { id: "AC-1", text: "A card is charged.", status: "pass", tests: null },
    { id: "AC-2", text: "A declined card shows why.", status: "no-test", tests: null },
  ],
  cases: [
    { question: "Card declined", answer: "We show the reason.", handled: true, criteria: ["AC-2"] },
    {
      question: "Cash",
      answer: "does not apply: no cash payments",
      handled: false,
      criteria: [],
    },
  ],
  appearances: [],
  previous: null,
  next: { id: "refund", heading: "Refund" },
  health: health("attention", "1 of 2 checks have no test"),
  developer: {
    steps: [
      {
        index: 1,
        type: "route",
        target: "POST /pay",
        found: true,
        entry: "src/app/checkout/pay.ts",
        entries: [],
        counts: { direct: 3, feature: 5, reachable: 40, typeOnly: 2 },
        direct: [],
        linked: null,
      },
    ],
  },
};

type Options = { shared?: boolean; share?: unknown; answers?: Record<string, unknown> };

function makeContext(options: Options = {}) {
  const answers: Record<string, unknown> = {
    product: mapAnswer,
    "product/features/checkout": featureAnswer,
    "product/flows/checkout/pay": flowAnswer,
    ...options.answers,
  };
  const navigate = vi.fn();
  const context = {
    ...fakeHelpers(),
    api: async (route = "") => {
      if (!(route in answers)) throw new Error(`no answer for ${route}`);

      return answers[route];
    },
    href: (target = "") => `#grimoire${target ? `/${target}` : ""}`,
    navigate,
    refresh: () => undefined,
    asset: (name: string) => `panels/grimoire/${name}`,
    file: (src: string) => `files/${src}`,
    shared: options.shared ?? false,
    share: options.share ?? null,
  };

  return { context, navigate };
}

describe("product map view", () => {
  it("renders the feature map with plain status, audience and a health light with words", async () => {
    const { productMapView } = await load();
    const view = await productMapView(makeContext().context, []);
    const text = view.text;

    expect(text).toContain("Checkout");
    expect(text).toContain("Live");
    expect(text).toContain("Being built");
    expect(text).toContain("shoppers");
    expect(text).toContain("Working well");
    expect(text).toContain("Has problems");
    expect(text).toContain("1 of 3 checks fail");
    expect(text).toContain("No summary yet.");
    expect(view.findAll((node) => /pm-light--good/.test(node.attributes.class ?? "")).length).toBe(
      1,
    );
  });

  it("draws a health strip with four segments and says each number in words", async () => {
    const { productMapView } = await load();
    const view = await productMapView(makeContext().context, []);
    const strips = view.findAll((node) => node.attributes.class === "pm-strip");

    // The card without strip numbers (an older answer) has no strip.
    expect(strips).toHaveLength(1);
    expect(
      strips[0]?.findAll((node) => (node.attributes.class ?? "").startsWith("pm-strip-seg")),
    ).toHaveLength(4);
    expect(strips[0]?.text).toContain("2 flows written, 1 shipped");
    expect(strips[0]?.text).toContain("3 of 3 criteria proven by tests");
    expect(strips[0]?.text).toContain("1 of 2 places with a screenshot");
    expect(strips[0]?.text).toContain("2 open findings");
  });

  it("shows criteria without recorded test results as not measured, not as a problem", async () => {
    const { productMapView } = await load();
    const first = mapAnswer.features[0] as (typeof mapAnswer.features)[number] & {
      strip: Record<string, unknown>;
    };
    const features = [
      {
        ...first,
        strip: { ...first.strip, criteria: { total: 3, proven: 0, failing: 0, measured: false } },
      },
    ];
    const { context } = makeContext({ answers: { product: { ...mapAnswer, features } } });
    const view = await productMapView(context, []);
    const strip = view.findAll((node) => node.attributes.class === "pm-strip")[0] as FakeNode;
    const segments = strip.findAll((node) =>
      (node.attributes.class ?? "").startsWith("pm-strip-seg"),
    );

    expect(strip.text).toContain("3 criteria, test results not measured");
    expect(segments[1]?.attributes.class).toContain("is-none");
    expect(strip.text).not.toContain("fail");
  });

  it("renders when a card carries a changedAt that is not a day", async () => {
    const { productMapView } = await load();
    const features = mapAnswer.features.map((feature) => ({ ...feature, changedAt: "soon" }));
    const { context } = makeContext({ answers: { product: { ...mapAnswer, features } } });
    const view = await productMapView(context, []);

    expect(view.text).toContain("Checkout");
    expect(view.text).not.toContain("Could not load");
  });

  it("filters by search text, app and audience", async () => {
    const { productMapView } = await load();
    const view = await productMapView(makeContext().context, []);
    const cards = () => view.findAll((node) => node.attributes.class === "pm-card").length;
    const search = view.find("input")[0] as FakeNode;
    const [appSelect, audienceSelect] = view.find("select") as [FakeNode, FakeNode];

    expect(cards()).toBe(2);
    search.fire("input", { target: { value: "basket" } });
    expect(cards()).toBe(1);
    search.fire("input", { target: { value: "" } });
    appSelect.fire("change", { target: { value: "mobile" } });
    expect(cards()).toBe(1);
    appSelect.fire("change", { target: { value: "" } });
    audienceSelect.fire("change", { target: { value: "support" } });
    expect(view.text).toContain("Returns");
    expect(cards()).toBe(1);
    search.fire("input", { target: { value: "zzz" } });
    expect(view.text).toContain("No feature matches");
  });

  it("says what to do when no feature is written", async () => {
    const { productMapView } = await load();
    const { context } = makeContext({ answers: { product: { ...mapAnswer, features: [] } } });
    const view = await productMapView(context, []);

    expect(view.text).toContain("No features are written yet");
    expect(view.text).toContain("grimoire/features");
  });

  it("shows an error with a next step when the answer fails", async () => {
    const { productMapView } = await load();
    const { context } = makeContext({ answers: {} });
    const view = await productMapView(context, ["feature", "nope"]);

    expect(view.text).toContain("Could not load this feature");
    expect(view.text).toContain("Try again");
  });

  it("renders a feature page: why, stories, screenshots through ctx.file, history, planned work", async () => {
    const { productMapView } = await load();
    const view = await productMapView(makeContext().context, ["feature", "checkout"]);
    const images = view.find("img");
    const text = view.text;

    expect(text).toContain("Shoppers need to pay.");
    expect(text).toContain("Pay by card");
    expect(text).toContain("Where you see it");
    expect(text).toContain("/checkout");
    expect(text).toContain("Unreleased");
    expect(text.indexOf("Unreleased")).toBeLessThan(text.indexOf("Release 5.1.0"));
    expect(text).toContain("Added");
    expect(text).toContain("Add wallets");
    expect(images.some((node) => node.attributes.src === "files/web/checkout.png")).toBe(true);
    expect(
      images.every(
        (node) =>
          node.attributes.src === undefined ||
          node.attributes.loading === "lazy" ||
          node.attributes.class === "pm-lightbox-image",
      ),
    ).toBe(true);
    expect(images[0]?.attributes.alt).toBe("The checkout page");
    expect(view.links).toContain("#grimoire/product/flow/checkout/pay");
  });

  it("shows no image whose path could leave the screenshots folder", async () => {
    const { productMapView } = await load();
    const bad = [
      "../secret.png",
      "/etc/x.png",
      "web/../../x.png",
      "https://evil.test/x.png",
      "web\\x.png",
      "web//x.png",
      "web/x.svg",
      "",
    ];
    const appearance = featureAnswer.appearances[0];
    const { context } = makeContext({
      answers: {
        "product/features/checkout": {
          ...featureAnswer,
          appearances: [
            { ...appearance, screenshots: [...bad.map((src) => ({ src, alt: "bad" })), shot] },
          ],
        },
      },
    });
    const view = await productMapView(context, ["feature", "checkout"]);
    const sources = view
      .find("img")
      .flatMap((node) => (node.attributes.src === undefined ? [] : [node.attributes.src]));

    expect(sources).toEqual(["files/web/checkout.png"]);
  });

  it("opens a screenshot in a dialog", async () => {
    const { productMapView } = await load();
    const view = await productMapView(makeContext().context, ["feature", "checkout"]);
    const button = view.findAll((node) => node.attributes.class === "pm-shot")[0] as FakeNode;
    const dialog = view.find("dialog")[0] as FakeNode;

    button.fire("click");
    expect(dialog.attributes.open).toBe("");
    expect(dialog.find("img")[0]?.attributes.src).toBe("files/web/checkout.png");
  });

  it("shows the developer toggle only in the signed-in view and remembers the choice", async () => {
    const store = new Map<string, string>();

    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });

    try {
      const { productMapView } = await load();
      const view = await productMapView(makeContext().context, ["feature", "checkout"]);
      const toggle = view.find("button").find((node) => node.text === "For developers") as FakeNode;
      const panel = view.findAll((node) => node.attributes.class === "pm-developer")[0] as FakeNode;

      expect(panel.attributes.hidden).toBe("");
      toggle.fire("click");
      expect(toggle.attributes["aria-pressed"]).toBe("true");
      expect(panel.text).toContain("src/app/checkout");
      expect(store.get("grimoire-product-developer")).toBe("1");

      const again = await productMapView(makeContext().context, ["feature", "checkout"]);

      expect(
        again.findAll((node) => node.attributes.class === "pm-developer")[0]?.attributes.hidden,
      ).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders a flow page with the story, proof, cases, neighbours and developer steps", async () => {
    const { productMapView } = await load();
    const view = await productMapView(makeContext().context, ["flow", "checkout", "pay"]);
    const text = view.text;

    expect(text).toContain("Open the checkout.");
    expect(text).toContain("from the technical steps");
    expect(text).toContain("A card is charged.");
    expect(text).toContain("Passing");
    expect(text).toContain("No test yet");
    expect(text).toContain("Checked by AC-2");
    expect(text).toContain("Does not apply (1)");
    expect(text).toContain("no cash payments");
    expect(text).not.toContain("does not apply: ");
    expect(text).toContain("Next: Refund");
    expect(view.links).toContain("#grimoire/product/flow/checkout/refund");

    const toggle = view.find("button").find((node) => node.text === "For developers") as FakeNode;

    toggle.fire("click");
    expect(view.text).toContain("3 direct");
    expect(view.text).toContain("2 type-only");
    expect(view.links).toContain("#grimoire/flows/checkout/pay");
  });

  it("leaves a zero type-only count out of the developer steps, like the flow page", async () => {
    const store = new Map<string, string>([["grimoire-product-developer", "1"]]);

    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });

    try {
      const { productMapView } = await load();
      const [step] = flowAnswer.developer.steps;
      const { context } = makeContext({
        answers: {
          "product/flows/checkout/pay": {
            ...flowAnswer,
            developer: {
              steps: [{ ...step, counts: { direct: 1, feature: 2, reachable: 4, typeOnly: 0 } }],
            },
          },
        },
      });
      const view = await productMapView(context, ["flow", "checkout", "pay"]);

      expect(view.text).toContain("1 direct · 2 in this feature · 4 reachable");
      expect(view.text).not.toContain("type-only");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("shared mode", () => {
    const shared = () => {
      const made = makeContext({
        shared: true,
        answers: {
          "product/features/checkout": { ...featureAnswer, developer: null },
          "product/flows/checkout/pay": { ...flowAnswer, developer: null },
        },
      });

      // The share page's host keeps links inside the share page.
      made.context.href = (target = "") => `#share${target ? `/${target}` : ""}`;

      return made;
    };

    it("hides the developer toggle and every developer link", async () => {
      const { default: render } = await load();
      const { context } = shared();

      for (const route of ["", "product/feature/checkout", "product/flow/checkout/pay"]) {
        const view = await render({ ...context, route });

        expect(view.text).not.toContain("For developers");
        expect(view.links.some((href) => href.startsWith("#grimoire"))).toBe(false);
        // A link opened in a new tab or after a reload must land on the share page again, not on sign-in.
        expect(view.links.every((href) => href.startsWith("#share/"))).toBe(true);
        expect(view.text).toContain("Read-only view");
      }
    });

    it("navigates inside the page through ctx.navigate", async () => {
      const { default: render } = await load();
      const { context, navigate } = shared();
      const view = await render({ ...context, route: "product" });
      const link = view
        .find("a")
        .find((node) => node.attributes.href === "#share/product/feature/checkout") as FakeNode;
      const preventDefault = vi.fn();

      link.fire("click", { preventDefault });
      expect(preventDefault).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith("product/feature/checkout");
    });
  });

  it("offers Share this map only when sharing is enabled", async () => {
    const { productMapView } = await load();
    const manage = { enabled: true, manageHref: "#/admin/shares?panel=grimoire" };
    const on = await productMapView(makeContext({ share: manage }).context, []);
    const off = await productMapView(
      makeContext({ share: { ...manage, enabled: false } }).context,
      [],
    );
    const none = await productMapView(makeContext().context, []);

    expect(on.text).toContain("Share this map");
    expect(on.links).toContain(manage.manageHref);
    expect(off.text).not.toContain("Share this map");
    expect(none.text).not.toContain("Share this map");
  });

  it("sets data as text, never as HTML", async () => {
    const { productMapView } = await load();
    const evil = "<img src=x onerror=alert(1)>";
    const { context } = makeContext({
      answers: {
        product: {
          ...mapAnswer,
          features: [{ ...mapAnswer.features[0], title: evil, summary: evil }],
        },
      },
    });
    const view = await productMapView(context, []);
    const injected = view.find("img").filter((node) => node.attributes.onerror !== undefined);

    expect(injected).toHaveLength(0);
    expect(view.text).toContain(evil);
  });
});

describe("product map: what changed", () => {
  const changed = {
    ...featureAnswer,
    releases: [
      {
        version: "1.5",
        release: null,
        date: null,
        changes: [
          { word: "fixed", flow: null, text: "Totals round correctly (AC-6, T-089)." },
          { word: "added", flow: null, text: "Pay with a wallet (see the guide) (QA 1.5.6)" },
          { word: "removed", flow: null, text: "The old form (legacy) is gone." },
        ],
      },
      {
        version: "1.0",
        release: "5.1.0",
        date: "2026-10-01",
        changes: [{ word: "added", flow: null, text: "Pay by card." }],
      },
    ],
  };

  it("pulls trailing reference ids out of the sentence and keeps ordinary parentheses", async () => {
    const { productSplitRefs } = await load();

    expect(productSplitRefs("Totals round correctly (AC-6, T-089).")).toEqual({
      text: "Totals round correctly.",
      refs: ["AC-6", "T-089"],
    });
    expect(productSplitRefs("Pay (see the guide) (QA 1.5.6)")).toEqual({
      text: "Pay (see the guide)",
      refs: ["QA 1.5.6"],
    });
    expect(productSplitRefs("The old form (legacy) is gone.")).toEqual({
      text: "The old form (legacy) is gone.",
      refs: [],
    });
    expect(productSplitRefs("Mixed (AC-1, not a ref)")).toEqual({
      text: "Mixed (AC-1, not a ref)",
      refs: [],
    });
    expect(productSplitRefs("Two groups (AC-1) (T-2)")).toEqual({
      text: "Two groups",
      refs: ["AC-1", "T-2"],
    });
  });

  it("draws one node per version with groups by type and ref chips in developer mode", async () => {
    const { productMapView } = await load();
    const { context } = makeContext({ answers: { "product/features/checkout": changed } });
    const view = await productMapView(context, ["feature", "checkout"]);
    const releases = view.findAll((node) => /^pm-release( |$)/.test(node.attributes.class ?? ""));
    const types = view
      .findAll((node) => (node.attributes.class ?? "").startsWith("pm-change-type"))
      .map((node) => node.text);
    const refs = view
      .findAll((node) => node.attributes.class === "pm-ref")
      .map((node) => node.text);

    expect(releases).toHaveLength(2);
    expect(releases[0]?.attributes.class).toContain("is-unreleased");
    expect(releases[0]?.text).toContain("Unreleased");
    expect(types.slice(0, 3)).toEqual(["Added", "Fixed", "Removed"]);
    // Groups run Added, Fixed, Removed, so the Added change's ref comes first.
    expect(refs).toEqual(["QA 1.5.6", "AC-6", "T-089"]);
    expect(view.text).toContain("Totals round correctly.");
    expect(view.text).not.toContain("(AC-6");
  });

  it("hides the reference chips in the shared view", async () => {
    const { productMapView } = await load();
    const { context } = makeContext({
      shared: true,
      answers: { "product/features/checkout": { ...changed, developer: null } },
    });
    const view = await productMapView(context, ["feature", "checkout"]);

    expect(view.findAll((node) => node.attributes.class === "pm-ref")).toHaveLength(0);
    expect(view.text).toContain("Totals round correctly.");
  });

  it("shows the app and framework in the shared footer when the adapter reports a host", async () => {
    const { productMapView } = await load();
    const host = {
      name: "Warlock.js",
      version: "5.59.0",
      logo: "data:image/png;base64,AAAA",
      app: { name: "shop", version: "1.4.0" },
    };
    const { context } = makeContext({
      shared: true,
      answers: { "product/features/checkout": { ...changed, developer: null, host } },
    });
    const view = await productMapView(context, ["feature", "checkout"]);
    const footer = view.find("footer")[0] as FakeNode;

    expect(footer.text).toContain("shop 1.4.0");
    expect(footer.text).toContain("Warlock.js v5.59.0");
    expect(footer.find("img")[0]?.attributes.src).toBe("data:image/png;base64,AAAA");
  });
});

describe("the product map sorting and the changed-since filter", () => {
  const card = (id: string, title: string, level: string, changedAt: string, extra = {}) => ({
    id,
    title,
    health: { level },
    changedAt,
    changedIn: [],
    unreleased: false,
    ...extra,
  });
  const features = [
    card("admin", "Zebra admin", "good", "2026-11-01"),
    card("billing", "Billing", "problem", "2026-11-10", { changedIn: ["5.2.0"] }),
    card("catalog", "Catalog", "attention", "2026-11-05", { changedIn: ["5.1.0"] }),
    card("drafts", "Drafts", "problem", "2026-11-12", { unreleased: true }),
  ];
  const releases = [
    { release: "5.1.0", date: "2026-11-04" },
    { release: "5.2.0", date: "2026-11-09" },
  ];

  it("sorts by id (stable default), name, recently changed and health", async () => {
    const { productSortFeatures } = await load();
    const ids = (sort: string) => productSortFeatures(features, sort).map((item) => item.id);

    expect(ids("id")).toEqual(["admin", "billing", "catalog", "drafts"]);
    expect(ids("name")).toEqual(["billing", "catalog", "drafts", "admin"]);
    expect(ids("changed")).toEqual(["drafts", "billing", "catalog", "admin"]);
    // Worst first; equal health keeps the written order.
    expect(ids("health")).toEqual(["billing", "drafts", "catalog", "admin"]);
    expect(ids("unknown-sort")).toEqual(["admin", "billing", "catalog", "drafts"]);
  });

  it("sorts flows by name and health and keeps the written order otherwise", async () => {
    const { productSortFlows } = await load();
    const flows = [
      { id: "b", title: "Pay", health: { level: "good" } },
      { id: "a", title: "Cancel", health: { level: "problem" } },
    ];

    expect(productSortFlows(flows, "written").map((item) => item.id)).toEqual(["b", "a"]);
    expect(productSortFlows(flows, "name").map((item) => item.id)).toEqual(["a", "b"]);
    expect(productSortFlows(flows, "health").map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("filters features changed since a day or since a release", async () => {
    const { productChangedSince } = await load();
    const ids = (since: string) =>
      productChangedSince(features, since, releases).map((item) => item.id);

    expect(ids("")).toHaveLength(4);
    expect(ids("2026-11-05")).toEqual(["billing", "catalog", "drafts"]);
    // Since 5.2.0: its own changes and anything unreleased.
    expect(ids("release:5.2.0")).toEqual(["billing", "drafts"]);
    expect(ids("release:5.1.0")).toEqual(["billing", "catalog", "drafts"]);
    expect(ids("release:9.9.9")).toHaveLength(4);
  });

  it("offers the sorts and the filter on the map and applies them", async () => {
    const { productMapView } = await load();
    const answer = {
      ...mapAnswer,
      releases,
      features: features.map((item) => ({
        ...item,
        summary: null,
        audience: [],
        apps: [],
        status: "shipped",
        version: "1",
        flows: 1,
      })),
    };
    const view = await productMapView(makeContext({ answers: { product: answer } }).context, []);
    const titles = () =>
      view.findAll((node) => node.attributes.class === "pm-card-link").map((node) => node.text);
    const sort = view.findAll((node) => node.attributes["data-pm"] === "sort")[0] as FakeNode;
    const since = view.findAll((node) => node.attributes["data-pm"] === "since")[0] as FakeNode;

    expect(titles()[0]).toBe("Zebra admin");
    sort.fire("change", { target: { value: "name" } });
    expect(titles()[0]).toBe("Billing");
    since.fire("change", { target: { value: "release:5.2.0" } });
    expect(titles()).toEqual(["Billing", "Drafts"]);
  });
});
