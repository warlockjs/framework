/**
 * A minimal DOM for specs of the browser view modules (`ui/*.js`), in the
 * style of the devtools UI specs: no browser, no jsdom. Strings appended to a
 * node become text; there is no `innerHTML`, so a spec can prove that data is
 * only ever inserted as text.
 */
export class FakeNode {
  public children: (FakeNode | string)[] = [];
  public attributes: Record<string, string> = {};
  public listeners: Record<string, ((event: unknown) => void)[]> = {};
  public namespace?: string;

  public constructor(public readonly tag: string) {}

  public setAttribute(key: string, value: string): void {
    this.attributes[key] = String(value);
  }

  public set textContent(value: string) {
    this.children = [String(value)];
  }

  public get textContent(): string {
    return this.text;
  }

  public addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  public append(...items: (FakeNode | string)[]): void {
    for (const item of items) {
      if (typeof item === "object" && !(item instanceof FakeNode)) throw new Error("append() takes nodes or strings");
      this.children.push(item);
    }
  }

  public replaceChildren(...items: (FakeNode | string)[]): void {
    this.children = [];
    this.append(...items);
  }

  public get text(): string {
    return this.children.map((child) => (typeof child === "string" ? child : child.text)).join(" ");
  }

  public find(tag: string): FakeNode[] {
    return this.findAll((node) => node.tag === tag);
  }

  public findAll(match: (node: FakeNode) => boolean): FakeNode[] {
    const nodes = this.children.filter((child): child is FakeNode => typeof child !== "string");

    return [...(match(this) ? [this] : []), ...nodes.flatMap((node) => node.findAll(match))];
  }

  /** The hrefs of every link in the subtree. */
  public get links(): string[] {
    return this.findAll((node) => node.tag === "a").map((node) => node.attributes.href ?? "");
  }

  public fire(type: string, event: unknown = {}): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function build(node: FakeNode, attrs: Record<string, unknown>, children: unknown): FakeNode {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;

    if (key === "class") node.setAttribute("class", String(value));
    else if (key === "text") node.textContent = String(value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value as (event: unknown) => void);
    else node.setAttribute(key, String(value));
  }

  for (const child of Array.isArray(children) ? children : [children]) node.append(child as FakeNode | string);

  return node;
}

/** The pieces of a devtools panel context that do not depend on the panel's data. */
export function fakeHelpers() {
  const el = (tag: string, attrs: Record<string, unknown> = {}, children: unknown = []) =>
    build(new FakeNode(tag), attrs, children);
  const svg = (tag: string, attrs: Record<string, unknown> = {}, children: unknown = []) => {
    const node = new FakeNode(tag);

    node.namespace = SVG_NAMESPACE;

    return build(node, attrs, children);
  };

  return { el, svg, empty: (message: string) => el("p", { class: "empty", text: message }) };
}

/**
 * A devtools panel context for the Grimoire view: `api()` answers from
 * `answers` (keyed by the path as the view writes it) and records every call.
 */
export function fakePanelContext(answers: Record<string, unknown>, route = "") {
  const calls: string[] = [];
  const root = new FakeNode("section");

  return {
    calls,
    root,
    context: {
      id: "grimoire",
      root,
      route,
      ...fakeHelpers(),
      api: async (path = "") => {
        calls.push(path);

        if (!(path in answers)) throw new Error(`no answer for ${path}`);

        return answers[path];
      },
      href: (target = "") => `#grimoire${target ? `/${target}` : ""}`,
      navigate: () => undefined,
      refresh: () => undefined,
      asset: (name: string) => `panels/grimoire/${name}`,
    },
  };
}
