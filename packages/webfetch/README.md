# webfetch

A pi extension that gives agents two web tools:

- `webfetch`: fetch a specific URL and return agent-readable content.
- `websearch`: search the web through Exa and return a consolidated result snippet.

The bias is simple: make web pages useful to an agent without handing it a giant pile of HTML soup. `webfetch` defaults to markdown, cleans up common extraction junk, handles GitHub URLs specially, and can optionally narrow long pages to only the parts relevant to an objective.

## Tools

### `webfetch`

Fetches one URL.

```json
{
  "url": "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch",
  "objective": "Only the section that shows setting request headers for a JSON POST request. Include the code example and no CORS, response, streaming, credentials, or abort sections."
}
```

By default, HTML pages are converted to markdown with Defuddle and then cleaned up. Non-HTML text is returned as markdown-ish text with the same cleanup pass applied. Images are returned as image attachments.

Parameters:

- `url`: fully-qualified `http://` or `https://` URL.
- `format`: `"markdown"` by default. Use `"raw"` only when the original response body matters, such as raw HTML, JSON, or plain text.
- `timeout`: request timeout in seconds. Defaults to 30, capped at 120.
- `objective`: optional focus query for markdown output. The full page is fetched and converted first, then a local model extracts the relevant subset. If narrowing fails, the tool falls back to full markdown.

`raw` intentionally bypasses Defuddle, markdown cleanup, and objective narrowing.

### `websearch`

Searches the web through Exa's MCP endpoint.

```json
{
  "query": "Zig 0.15 release notes 2026",
  "numResults": 5,
  "type": "fast"
}
```

Parameters:

- `query`: search query.
- `numResults`: result count, default 8.
- `livecrawl`: `"fallback"` by default, or `"preferred"` when freshness matters more than speed.
- `type`: `"auto"`, `"fast"`, or `"deep"`.
- `contextMaxCharacters`: optional Exa context size limit.

## Markdown extraction

For normal web pages, `webfetch` uses this pipeline:

```text
fetch URL → size/content-type checks → image handling → markdown extraction → cleanup → optional objective narrowing → truncation
```

Extraction details:

- Uses Defuddle's Node API for readable HTML extraction.
- Looks for `<link rel="alternate" type="text/markdown">` and uses that markdown source when available.
- Strips common tracking query params from markdown links.
- Removes empty markdown links.
- Normalizes table separator rows without touching fenced code blocks.
- Rejects responses over 5MB before decoding.
- Truncates final tool output using pi's normal model-output limits, with temp-file spillover for large results.

GitHub URLs skip the normal page extraction path:

- Blob URLs return raw file content, including line fragment support.
- Tree URLs return directory listings.
- Repo URLs return README content when available.

## Objective narrowing

`objective` is for the common case where a page is huge but only one section matters.

The narrowing pass is best-effort by design. It chunks markdown on natural boundaries, asks a configured local model to extract only verbatim relevant content, then runs a reducer pass to keep the smallest directly useful subset. If the model is unavailable, misconfigured, times out, or returns nothing useful, the original markdown is returned.

This is deliberately not a keyword filter. Recall comes first; the reducer trims after the model has enough context. Fewer knobs, fewer opportunities for the caller to drive into a ditch.

Configure the model in global pi settings:

```json
{
  "webfetch": {
    "objectiveModel": "anthropic/claude-haiku-4-5"
  }
}
```

Project-local settings can override it at `.pi/settings.json`:

```json
{
  "webfetch": {
    "objectiveModel": "openai-codex/gpt-5.4-mini"
  }
}
```

The older object shape is also accepted internally:

```json
{
  "webfetch": {
    "objective": {
      "model": { "provider": "anthropic", "id": "claude-haiku-4-5" }
    }
  }
}
```

Prefer the string form. It matches normal pi model IDs and gives the model one less weird shape to hallucinate.

## Development

From the repo root:

```sh
pnpm --filter webfetch test
pnpm --filter webfetch check
pnpm --filter webfetch lint
pnpm --filter webfetch fmt:check
```

There is also a small local eval harness:

```sh
pnpm --filter webfetch eval
```

It fetches the corpus in `eval-corpus.json`, runs the extraction path, and prints rough size/token stats. It is intentionally package-local and not wired into CI. Use it when changing extraction, cleanup, or narrowing behavior.
