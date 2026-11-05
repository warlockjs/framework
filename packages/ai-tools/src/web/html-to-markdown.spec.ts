import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToMarkdown } from "./html-to-markdown";

describe("htmlToMarkdown", () => {
  it("converts headings, paragraphs, emphasis and links", () => {
    const html =
      '<h1>Title</h1><p>Hello <strong>bold</strong> and <em>soft</em> <a href="https://a.test/x">link</a>.</p><h2>Sub</h2><p>Next</p>';

    expect(htmlToMarkdown(html)).toBe(
      "# Title\n\nHello **bold** and _soft_ [link](https://a.test/x).\n\n## Sub\n\nNext",
    );
  });

  it("emits plain text without markup when plain is set", () => {
    const html = '<h1>Title</h1><p>See <a href="https://a.test">this</a> <b>now</b></p>';

    expect(htmlToMarkdown(html, { plain: true })).toBe("Title\n\nSee this now");
  });

  it("drops scripts, styles, comments and page chrome", () => {
    const html =
      "<head><title>t</title></head><nav>menu</nav><script>alert(1)</script><style>p{}</style><!-- c --><p>Body</p><footer>foot</footer>";

    expect(htmlToMarkdown(html)).toBe("Body");
  });

  it("keeps only the main region when the page has one", () => {
    const html = "<header>Site</header><main><p>Core</p></main><aside>Ads</aside>";

    expect(htmlToMarkdown(html)).toBe("Core");
  });

  it("renders ordered and unordered lists, including nesting", () => {
    const html = "<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><ol><li>one</li><li>two</li></ol>";

    expect(htmlToMarkdown(html)).toBe("- a\n- b\n  - c\n\n1. one\n2. two");
  });

  it("fences preformatted code and keeps its whitespace", () => {
    const html = "<pre><code>line 1\n  line 2</code></pre><p>use <code>x</code></p>";

    expect(htmlToMarkdown(html)).toBe("```\nline 1\n  line 2\n```\n\nuse `x`");
  });

  it("renders blockquotes and table rows", () => {
    const html = "<blockquote><p>quoted</p></blockquote><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>";

    expect(htmlToMarkdown(html)).toBe("> quoted\n\nA | B\n1 | 2");
  });

  it("drops javascript and fragment links but keeps their text", () => {
    expect(htmlToMarkdown('<p><a href="javascript:x()">run</a> <a href="#top">top</a></p>')).toBe(
      "run top",
    );
  });

  it("decodes entities", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#169; &#x1F600; &unknown;")).toBe(
      "a & b <c> © \u{1F600} &unknown;",
    );
  });
});
