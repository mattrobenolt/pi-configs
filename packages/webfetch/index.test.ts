import assert from "node:assert/strict";
import test from "node:test";

import { parseModelSpec } from "./config.ts";
import { parseWebSearchResponse } from "./index.ts";
import {
  buildExaSearchRequest,
  formatSearchResponse,
  jinaUnsupportedReason,
  SearchBackendError,
  searchJina,
  searchWithFailover,
} from "./search.ts";
import {
  cleanMarkdown,
  convertHTMLToMarkdown,
  decodeHtmlEntities,
  extractMarkdownAlternateUrl,
  extractTextFromHTML,
  transformContent,
  validateAndNormalizeUrl,
} from "./core.ts";
import {
  chunkMarkdown,
  narrowMarkdown,
  resolveNarrowingModel,
  splitMarkdownSections,
} from "./narrow.ts";

test("validateAndNormalizeUrl accepts fully-qualified http(s) URLs", () => {
  assert.equal(
    validateAndNormalizeUrl("https://example.com/path?q=1"),
    "https://example.com/path?q=1",
  );
  assert.equal(validateAndNormalizeUrl("http://example.com"), "http://example.com/");
});

test("validateAndNormalizeUrl rejects invalid and non-http URLs", () => {
  assert.throws(() => validateAndNormalizeUrl("example.com"), /Invalid URL/);
  assert.throws(() => validateAndNormalizeUrl("file:///tmp/x"), /http:\/\/ or https:\/\//);
});

test("decodeHtmlEntities decodes common named, decimal, and hex entities", () => {
  assert.equal(
    decodeHtmlEntities("Tom &amp; Jerry &#169; &#x1F411; &unknown;"),
    "Tom & Jerry © 🐑 &unknown;",
  );
});

test("extractTextFromHTML strips scripts/styles and keeps readable block text", () => {
  const text = extractTextFromHTML(`
    <html>
      <body>
        <style>body { color: red }</style>
        <script>alert("nope")</script>
        <h1>Title&nbsp;Here</h1>
        <p>Hello <strong>world</strong>.</p>
        <div>Another<br>line</div>
      </body>
    </html>
  `);

  assert.equal(text, "Title Here\nHello world .\nAnother\nline");
});

test("convertHTMLToMarkdown removes document chrome tags and converts basic markup", () => {
  const markdown = convertHTMLToMarkdown(`
    <html>
      <head><title>Ignored</title><meta name="x" content="y"></head>
      <body><h1>Hello</h1><p>See <a href="https://example.com">example</a>.</p></body>
    </html>
  `);

  assert.match(markdown, /# Hello/);
  assert.match(markdown, /\[example\]\(https:\/\/example\.com\)/);
  assert.doesNotMatch(markdown, /meta/);
});

test("transformContent returns raw content when requested", async () => {
  const html = "<main><h1>Hello</h1></main>";
  assert.equal(await transformContent(html, "text/html", "raw", "https://example.com"), html);
});

test("transformContent returns non-html content unchanged for markdown output", async () => {
  const text = "# Already markdown\n\nBody";
  assert.equal(
    await transformContent(text, "text/markdown", "markdown", "https://example.com"),
    text,
  );
});

test("transformContent uses Defuddle's Node API for html markdown extraction", async () => {
  const markdown = await transformContent(
    `<!doctype html>
    <html>
      <head><title>Example Page</title></head>
      <body>
        <nav><a href="/nav">Navigation</a></nav>
        <main>
          <h1>Example Page</h1>
          <p>This is the main article content.</p>
          <p><a href="/more">Read more</a></p>
        </main>
      </body>
    </html>`,
    "text/html; charset=utf-8",
    "markdown",
    "https://example.com/article",
  );

  assert.match(markdown, /main article content/);
  assert.match(markdown, /Read more/);
  assert.doesNotMatch(markdown, /Navigation/);
});

// --- extractMarkdownAlternateUrl ---

test("extractMarkdownAlternateUrl finds rel=alternate type=text/markdown", () => {
  const html = `<html><head>
    <link rel="alternate" type="text/markdown" href="/docs/page.md">
  </head><body></body></html>`;
  assert.equal(
    extractMarkdownAlternateUrl(html, "https://example.com/docs/page"),
    "https://example.com/docs/page.md",
  );
});

test("extractMarkdownAlternateUrl resolves relative hrefs against baseUrl", () => {
  const html = `<link rel="alternate" type="text/markdown" href="../other.md">`;
  assert.equal(
    extractMarkdownAlternateUrl(html, "https://example.com/a/b"),
    "https://example.com/other.md",
  );
});

test("extractMarkdownAlternateUrl returns null when no alternate link present", () => {
  assert.equal(
    extractMarkdownAlternateUrl("<html><body>no links</body></html>", "https://x.com"),
    null,
  );
});

test("extractMarkdownAlternateUrl returns null when href is empty", () => {
  const html = `<link rel="alternate" type="text/markdown" href="">`;
  assert.equal(extractMarkdownAlternateUrl(html, "https://example.com"), null);
});

// --- cleanMarkdown ---

test("cleanMarkdown strips UTM params from inline links", () => {
  const input =
    "See [the post](https://example.com/post?utm_source=newsletter&utm_medium=email) for details.";
  const result = cleanMarkdown(input);
  assert.match(result, /\[the post\]\(https:\/\/example\.com\/post\)/);
  assert.doesNotMatch(result, /utm_/);
});

test("cleanMarkdown strips fbclid and gclid from links", () => {
  const input = "[page](https://example.com/?fbclid=abc123&gclid=xyz)";
  assert.equal(cleanMarkdown(input), "[page](https://example.com/)");
});

test("cleanMarkdown preserves links with no tracking params", () => {
  const input = "[normal](https://example.com/path?page=2&sort=asc)";
  assert.equal(cleanMarkdown(input), input);
});

test("cleanMarkdown removes empty [](url) links", () => {
  const result = cleanMarkdown("before [](https://example.com) after");
  assert.equal(result.trim(), "before  after");
});

test("cleanMarkdown converts [text]() to plain text", () => {
  assert.equal(cleanMarkdown("[click here]()"), "click here");
});

test("cleanMarkdown normalizes GFM table separator rows", () => {
  const input = ["| Header A | Header B |", "| :------- | --------: |", "| cell 1 | cell 2 |"].join(
    "\n",
  );
  const result = cleanMarkdown(input);
  assert.match(result, /\| --- \| --- /);
  assert.match(result, /cell 1/);
});

test("cleanMarkdown does not touch separator-like lines inside fenced code blocks", () => {
  const input = ["```", "| :--- | :--- |", "```"].join("\n");
  assert.equal(cleanMarkdown(input), input);
});

test("cleanMarkdown applies cleanup to non-HTML markdown passthrough", async () => {
  const raw = "[article](https://example.com/article?utm_source=test)\n\n[](https://x.com/junk)";
  const result = await transformContent(raw, "text/markdown", "markdown", "https://example.com");
  assert.doesNotMatch(result, /utm_/);
  assert.doesNotMatch(result, /\[\]\(/);
});

// --- transformContent markdown alternate URL ---

test("transformContent uses markdown alternate URL when server returns markdown", async () => {
  const html = `<!doctype html><html><head>
    <link rel="alternate" type="text/markdown" href="/page.md">
  </head><body><p>HTML fallback</p></body></html>`;

  const mockFetch: typeof globalThis.fetch = async (input) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/page.md")) {
      return new Response("# Markdown Content\n\nFrom alternate.", {
        headers: { "content-type": "text/markdown" },
      });
    }
    return new Response("not found", { status: 404 });
  };

  const result = await transformContent(
    html,
    "text/html",
    "markdown",
    "https://example.com/page",
    mockFetch,
  );
  assert.match(result, /Markdown Content/);
  assert.doesNotMatch(result, /HTML fallback/);
});

test("transformContent falls back to Defuddle when alternate URL returns 404", async () => {
  const html = `<!doctype html><html><head>
    <link rel="alternate" type="text/markdown" href="/missing.md">
  </head><body><main><p>Actual page content.</p></main></body></html>`;

  const mockFetch: typeof globalThis.fetch = async () => new Response("not found", { status: 404 });

  const result = await transformContent(
    html,
    "text/html",
    "markdown",
    "https://example.com/page",
    mockFetch,
  );
  assert.match(result, /Actual page content/);
});

// --- chunkMarkdown ---

test("chunkMarkdown returns single chunk when content fits", () => {
  const md = "# Title\n\nSome content.";
  const chunks = chunkMarkdown(md, 10_000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], md);
});

test("chunkMarkdown splits on heading boundaries", () => {
  // Build content big enough to force a split.
  const section1 = "# Section One\n\n" + "word ".repeat(1500);
  const section2 = "## Section Two\n\n" + "word ".repeat(1500);
  const md = section1 + "\n" + section2;
  const chunks = chunkMarkdown(md, 4000);
  assert.ok(chunks.length >= 2, `Expected >=2 chunks, got ${chunks.length}`);
  assert.ok(chunks.some((c) => c.includes("Section One")));
  assert.ok(chunks.some((c) => c.includes("Section Two")));
});

test("chunkMarkdown produces non-empty chunks", () => {
  const md = Array.from({ length: 100 }, (_, i) => `## Heading ${i}\n\nContent ${i}\n`).join("\n");
  const chunks = chunkMarkdown(md, 2000);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.trim().length > 0);
});

test("chunkMarkdown handles empty string", () => {
  assert.deepEqual(chunkMarkdown(""), []);
});

// --- narrowMarkdown safety fallbacks ---

test("narrowMarkdown returns original markdown when model registry is unavailable", async () => {
  const markdown = "# Hello\n\nContent here.";
  // Minimal ctx stub with no model registry support.
  const ctx = {
    modelRegistry: {
      find: () => null,
      getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }),
    },
    model: undefined,
  } as any;

  const result = await narrowMarkdown(markdown, "find the greeting", ctx, undefined);
  assert.equal(result.content, markdown);
  assert.equal(result.narrowed, false);
});

test("narrowMarkdown returns original markdown when objective is empty", async () => {
  const markdown = "# Hello\n\nContent here.";
  const ctx = {
    modelRegistry: {
      find: () => null,
      getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }),
    },
    model: undefined,
  } as any;

  const result = await narrowMarkdown(markdown, "", ctx, undefined);
  assert.equal(result.content, markdown);
  assert.equal(result.narrowed, false);
});

test("narrowMarkdown returns original markdown when markdown is empty", async () => {
  const ctx = {
    modelRegistry: {
      find: () => null,
      getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }),
    },
    model: undefined,
  } as any;

  const result = await narrowMarkdown("", "some objective", ctx, undefined);
  assert.equal(result.content, "");
  assert.equal(result.narrowed, false);
});

// --- webfetch config ---

test("parseModelSpec accepts provider/id strings", () => {
  assert.deepEqual(parseModelSpec("llamacpp/gemma4-26b-a4b"), {
    provider: "llamacpp",
    id: "gemma4-26b-a4b",
  });
});

test("parseModelSpec accepts object forms", () => {
  assert.deepEqual(parseModelSpec({ provider: "anthropic", modelId: "claude-sonnet-4-6" }), {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
  });
  assert.deepEqual(parseModelSpec({ provider: "openai", model: "gpt-5.5" }), {
    provider: "openai",
    id: "gpt-5.5",
  });
});

test("parseModelSpec rejects malformed values", () => {
  assert.equal(parseModelSpec("missing-provider-separator"), undefined);
  assert.equal(parseModelSpec({ provider: "llamacpp" }), undefined);
  assert.equal(parseModelSpec(null), undefined);
});

test("resolveNarrowingModel prefers configured model when available", () => {
  const configured = { provider: "custom", id: "narrower" };
  const fallback = { provider: "llamacpp", id: "gemma4-26b-a4b" };
  const ctx = {
    modelRegistry: {
      find: (provider: string, id: string) => {
        if (provider === configured.provider && id === configured.id) return configured;
        if (provider === fallback.provider && id === fallback.id) return fallback;
        return null;
      },
    },
    model: undefined,
  } as any;

  assert.equal(resolveNarrowingModel(ctx, configured), configured);
});

test("resolveNarrowingModel falls back when configured model is unavailable", () => {
  const fallback = { provider: "openai-codex", id: "gpt-5.4-mini" };
  const ctx = {
    modelRegistry: {
      find: (provider: string, id: string) =>
        provider === fallback.provider && id === fallback.id ? fallback : null,
    },
    model: undefined,
  } as any;

  assert.equal(resolveNarrowingModel(ctx, { provider: "missing", id: "model" }), fallback);
});

test("splitMarkdownSections preserves heading paths", () => {
  const sections = splitMarkdownSections(
    "# API\n\nIntro\n\n## Auth\n\nAuth body\n\n### Tokens\n\nToken body\n\n## Billing\n\nBilling body",
  );

  assert.deepEqual(
    sections.map((section) => section.path),
    [["API"], ["API", "Auth"], ["API", "Auth", "Tokens"], ["API", "Billing"]],
  );
});

test("buildExaSearchRequest defaults to auto search with highlights", () => {
  assert.deepEqual(buildExaSearchRequest({ query: "Zig 0.15 allocators" }), {
    query: "Zig 0.15 allocators",
    type: "auto",
    numResults: 8,
    contents: { highlights: true },
  });
});

test("buildExaSearchRequest maps filters, content, and freshness", () => {
  assert.deepEqual(
    buildExaSearchRequest({
      query: "AI regulation",
      type: "deep",
      numResults: 12,
      category: "news",
      includeDomains: ["reuters.com"],
      excludeDomains: ["example.com"],
      startPublishedDate: "2026-01-01",
      endPublishedDate: "2026-07-01",
      content: "text",
      maxCharacters: 5000,
      maxAgeHours: 0,
      moderation: true,
    }),
    {
      query: "AI regulation",
      type: "deep",
      numResults: 12,
      category: "news",
      includeDomains: ["reuters.com"],
      excludeDomains: ["example.com"],
      startPublishedDate: "2026-01-01",
      endPublishedDate: "2026-07-01",
      moderation: true,
      contents: { text: { maxCharacters: 5000 }, maxAgeHours: 0 },
    },
  );
});

test("buildExaSearchRequest rejects filters unsupported by entity categories", () => {
  assert.throws(
    () =>
      buildExaSearchRequest({
        query: "database engineers",
        category: "people",
        startPublishedDate: "2026-01-01",
      }),
    /does not support/,
  );
});

test("jinaUnsupportedReason rejects Exa-only controls", () => {
  assert.equal(jinaUnsupportedReason({ query: "x", type: "deep" }), "search type deep");
  assert.equal(
    jinaUnsupportedReason({ query: "x", includeDomains: ["a.com", "b.com"] }),
    "multiple includeDomains",
  );
  assert.equal(jinaUnsupportedReason({ query: "x", maxAgeHours: 0 }), undefined);
});

test("SearchBackendError allows backend availability failures to fail over", () => {
  assert.equal(new SearchBackendError("exa", "transient", "timeout").canFailOver, true);
  assert.equal(new SearchBackendError("exa", "quota", "limited").canFailOver, true);
  assert.equal(new SearchBackendError("exa", "auth", "bad key").canFailOver, true);
  assert.equal(new SearchBackendError("exa", "request", "bad input").canFailOver, false);
  assert.equal(new SearchBackendError("exa", "cancelled", "cancelled").canFailOver, false);
});

test("searchJina preserves cancellation while waiting to retry", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "rate limited" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "30" },
    });
  const controller = new AbortController();
  const search = searchJina({ query: "test" }, "jina-key", controller.signal);
  setTimeout(() => controller.abort(), 5);

  try {
    await assert.rejects(
      search,
      (error: unknown) => error instanceof SearchBackendError && error.kind === "cancelled",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchJina treats response-stream failures as transient", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("connection reset"));
        },
      }),
      { headers: { "content-type": "application/json" } },
    );

  try {
    await assert.rejects(
      searchJina({ query: "test" }, "jina-key"),
      (error: unknown) => error instanceof SearchBackendError && error.kind === "transient",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchJina treats its no-results 422 as an empty search", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "No search results available for query test" }), {
      status: 422,
      headers: { "content-type": "application/json" },
    });

  try {
    const response = await searchJina({ query: "test" }, "jina-key");
    assert.deepEqual(response.results, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchWithFailover routes Exa authentication failures to Jina and cools Exa down", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("api.exa.ai")) {
      return new Response(JSON.stringify({ error: "invalid API key" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        data: [{ title: "Jina result", url: "https://example.com", description: "Useful" }],
        meta: { usage: { tokens: 10000 } },
      }),
      { headers: { "content-type": "application/json" } },
    );
  };

  try {
    const credentials = { exa: "bad-exa-key", jina: "jina-key" };
    const routed = await searchWithFailover({ query: "test", content: "none" }, credentials);
    assert.equal(routed.response.backend, "jina");
    assert.deepEqual(
      routed.attempts.map(({ backend, outcome }) => ({ backend, outcome })),
      [
        { backend: "exa", outcome: "failed" },
        { backend: "jina", outcome: "success" },
      ],
    );

    const duringCooldown = await searchWithFailover(
      { query: "test", content: "none" },
      credentials,
    );
    assert.equal(duringCooldown.response.backend, "jina");
    assert.equal(duringCooldown.attempts[0].outcome, "skipped");
    assert.match(duringCooldown.attempts[0].reason ?? "", /^cooldown for 300s$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("formatSearchResponse includes answers, results, and unique citations", () => {
  const output = formatSearchResponse({
    backend: "exa",
    answer: "Grounded answer",
    citations: [
      { title: "Official docs", url: "https://example.com/docs" },
      { title: "Official docs", url: "https://example.com/docs" },
    ],
    results: [
      {
        title: "Example",
        url: "https://example.com",
        highlights: ["Relevant excerpt"],
      },
    ],
  });

  assert.match(output, /Answer:\nGrounded answer/);
  assert.match(output, /Title: Example/);
  assert.match(output, /Highlights:\nRelevant excerpt/);
  assert.equal(output.match(/Official docs/g)?.length, 1);
});

test("parseWebSearchResponse surfaces MCP tool errors", () => {
  assert.throws(
    () =>
      parseWebSearchResponse(
        JSON.stringify({
          result: { isError: true, content: [{ type: "text", text: "rate limited" }] },
        }),
      ),
    /rate limited/,
  );
  assert.throws(
    () => parseWebSearchResponse(JSON.stringify({ error: { message: "bad request" } })),
    /bad request/,
  );
});

test("narrowMarkdown narrows with injected model completion", async () => {
  const markdown = [
    "# Fetch",
    "",
    "Intro text",
    "",
    "## Setting headers",
    "",
    "Use Content-Type for JSON.",
    "",
    "## Streaming",
    "",
    "Streaming response text.",
  ].join("\n");
  const model = { provider: "test", id: "model" };
  const ctx = {
    modelRegistry: {
      find: () => model,
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key", headers: {} }),
    },
    model: undefined,
  } as any;
  const completeFn = async (_model: any, request: any) => {
    const text = request.messages[0].content[0].text as string;
    const isReducer = text.includes("<candidate_markdown>");
    return {
      stopReason: "end_turn",
      content: [
        {
          type: "text",
          text:
            isReducer || text.includes("Setting headers")
              ? "## Setting headers\n\nUse Content-Type for JSON."
              : "NONE",
        },
      ],
    } as any;
  };

  const result = await narrowMarkdown(markdown, "JSON headers only", ctx, undefined, {
    completeFn: completeFn as any,
  });

  assert.equal(result.narrowed, true);
  assert.match(result.content, /Setting headers/);
  assert.doesNotMatch(result.content, /Streaming/);
  assert.equal(result.diagnostics.sectionsTotal, 1);
  assert.equal(result.diagnostics.sectionsRelevant, 1);
});
