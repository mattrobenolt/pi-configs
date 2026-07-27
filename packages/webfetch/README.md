# webfetch

A pi extension that gives agents two web tools:

- `webfetch`: fetch a specific URL and return agent-readable content.
- `websearch`: search the web through capability-aware Exa/Jina backends and return a consolidated result snippet.

The bias is simple: make web pages useful to an agent without handing it a giant pile of HTML soup. `webfetch` defaults to markdown, cleans up common extraction junk, handles GitHub URLs specially, and can optionally narrow long pages to only the parts relevant to an objective.

Install it with:

```sh
pi install npm:@mattrobenolt/pi-webfetch
```

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

Searches through an internal provider router. Exa is the measured primary backend; Jina is the capability-aware failover for ordinary searches. Without either credential, the tool falls back to Exa's rate-limited basic MCP search.

```json
{
  "query": "Zig 0.15 release notes 2026",
  "numResults": 5,
  "type": "fast"
}
```

Parameters:

- `query`: natural-language search query.
- `numResults`: result count, default 8, max 100.
- `type`: `"auto"`, `"fast"`, `"instant"`, `"deep-lite"`, `"deep"`, or `"deep-reasoning"`.
- `category`: optional specialized index for companies, people, research papers, news, personal sites, or financial reports.
- `includeDomains` / `excludeDomains`: optional domain filters.
- `startPublishedDate` / `endPublishedDate`: optional ISO 8601 publication-date filters.
- `content`: `"highlights"` by default, `"text"` for fuller pages, or `"none"` for result metadata only.
- `maxCharacters`: optional per-result content limit.
- `maxAgeHours`: omit for normal fallback crawling, `0` to always livecrawl, or `-1` for cache only.
- `moderation`: optionally filter unsafe results.

Highlights are the default because Exa recommends them for agent workflows: they return relevant source excerpts without dumping full pages into context. Deep search modes get a longer request timeout, and direct API calls retry rate limits and transient server failures.

Store the key in the active Pi profile's `auth.json`:

```json
{
  "exa": { "type": "api_key", "key": "your-exa-key" },
  "jina": { "type": "api_key", "key": "your-jina-key" }
}
```

The extension registers both services as Pi API-key providers, so `/login exa` and `/login jina` can store profile-local credentials without editing JSON. `EXA_API_KEY` and `JINA_API_KEY` remain available as fallbacks.

Provider choice is deliberately not exposed to the agent. The router tries Exa first and fails over to Jina after authentication failures, timeouts, quota exhaustion, rate limits, transient server failures, or empty results. Authentication failures remain visible in attempt metadata and put the backend on a five-minute cooldown. Invalid requests and unsupported features remain terminal rather than being silently rewritten. Jina is skipped for Exa-only controls such as deep search, categories, publication-date filters, multiple include domains, exclusion filters, cache-only retrieval, and moderation. Shorter cooldowns prevent repeatedly hammering rate-limited or transiently failing backends.

The initial 50-query benchmark used historical searches followed by fetched URLs as implicit relevance labels. Exa had 100% request success, 38% exact-URL recall@5, 74% domain recall@5, and 943ms median latency. Jina had 96% success, 34% exact recall, 60% domain recall, and 898ms median latency. Exa scored higher on a historical-follow-up rank heuristic for 14 queries, Jina for 5, and 31 were equal. That heuristic is a relevance proxy, not a blind judgment of semantic result quality. Exa remains primary while Jina contributes materially different results (13.7% mean top-five overlap) as failover.

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

- Blob URLs return raw file content. `#L10-L20` (or `#L42`) fragments return the requested range with ±10 lines of surrounding context, marked `:` for in-range lines and `-` for context lines.
- Tree URLs return directory listings.
- Pull URLs return a structured PR view (state, author, base/head, mergeable, review decision, files, reviews, comments).
- Issue URLs return a structured issue view (state, author, body, comments).
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
pnpm --filter @mattrobenolt/pi-webfetch test
pnpm --filter @mattrobenolt/pi-webfetch check
pnpm --filter @mattrobenolt/pi-webfetch lint
pnpm --filter @mattrobenolt/pi-webfetch fmt:check
```

There are also package-local eval harnesses:

```sh
pnpm --filter @mattrobenolt/pi-webfetch eval
pnpm --filter @mattrobenolt/pi-webfetch eval:search -- --limit 50 --concurrency 3
```

`eval` measures page extraction against `eval-corpus.json`. `eval:search` mines historical Pi sessions for user turns containing exactly one search followed by fetched URLs, uses those URLs as implicit relevance labels, runs a deterministic stratified sample against Exa and Jina, and reports exact/domain recall, reciprocal rank, latency, failures, result overlap, and a clearly labeled rank-heuristic comparison. Search eval output defaults to a timestamped JSON file under the system temp directory.
