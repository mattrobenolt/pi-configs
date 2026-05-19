import { truncateForModelWithTempFile } from "@mattrobenolt/pi-core/tool-output";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { loadWebfetchConfig } from "./config.ts";
import { transformContent, validateAndNormalizeUrl } from "./core.ts";
import { narrowMarkdown } from "./narrow.ts";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_WEBFETCH_TIMEOUT_SECONDS = 30;
const MAX_WEBFETCH_TIMEOUT_SECONDS = 120;
const WEBSEARCH_TIMEOUT_MS = 25_000;
const DEFAULT_WEBSEARCH_RESULTS = 8;

const WEBSEARCH_BASE_URL = "https://mcp.exa.ai";
const WEBSEARCH_ENDPOINT = "/mcp";

const WEBFETCH_PARAMS = Type.Object({
  url: Type.String({ description: "The URL to fetch content from" }),
  format: Type.Optional(
    StringEnum(["markdown", "raw"] as const, {
      description:
        'The format to return content in. "markdown" is the default. Use "raw" only when you need the original response body (HTML, JSON, or plain text).',
      default: "markdown",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: `Optional timeout in seconds (max ${MAX_WEBFETCH_TIMEOUT_SECONDS})`,
      minimum: 1,
      maximum: MAX_WEBFETCH_TIMEOUT_SECONDS,
    }),
  ),
  objective: Type.Optional(
    Type.String({
      description:
        "Narrow the extracted markdown to content relevant to this objective. " +
        "The full page is fetched and converted to markdown first, then a local LLM pass " +
        "filters to only the relevant sections. Only applies when format=markdown. " +
        "Increases latency. Falls back to full markdown if the model is unavailable.",
    }),
  ),
});

type WebFetchParams = Static<typeof WEBFETCH_PARAMS>;

const WEBSEARCH_PARAMS = Type.Object({
  query: Type.String({ description: "Web search query" }),
  numResults: Type.Optional(
    Type.Number({
      description: `Number of search results to return (default: ${DEFAULT_WEBSEARCH_RESULTS})`,
      minimum: 1,
    }),
  ),
  livecrawl: Type.Optional(
    StringEnum(["fallback", "preferred"] as const, {
      description:
        "Live crawl mode - 'fallback': use live crawling as backup if cached content is unavailable, 'preferred': prioritize live crawling.",
      default: "fallback",
    }),
  ),
  type: Type.Optional(
    StringEnum(["auto", "fast", "deep"] as const, {
      description:
        "Search type - 'auto': balanced (default), 'fast': quick results, 'deep': comprehensive search.",
      default: "auto",
    }),
  ),
  contextMaxCharacters: Type.Optional(
    Type.Number({
      description:
        "Maximum characters for context string optimized for LLMs (default provider behavior).",
      minimum: 1,
    }),
  ),
});

type WebSearchParams = Static<typeof WEBSEARCH_PARAMS>;

const WEBFETCH_DESCRIPTION = `Fetch a specific URL and return agent-readable content.

Use webfetch when the user gives a URL to inspect, quote, summarize, debug, or use as context. Prefer format="markdown" unless the task specifically needs the original response body.

Arguments:
- url: required fully-qualified http:// or https:// URL.
- format: "markdown" (default) or "raw". Use raw only for original HTML, JSON, or plain text.
- timeout: request timeout in seconds, default ${DEFAULT_WEBFETCH_TIMEOUT_SECONDS}, max ${MAX_WEBFETCH_TIMEOUT_SECONDS}.
- objective: optional focus query for markdown output. Use this when only part of a long page is relevant, e.g. "authentication options", "POST request example", or "pricing limits". The page is fetched normally, then narrowed to objective-relevant markdown. Ignore objective for format="raw".

Behavior:
- GitHub blob URLs return raw file content; tree URLs return directory listings; repo URLs return README content.
- Image URLs return an image attachment.
- Non-GitHub web pages return markdown by default, with best-effort cleanup and truncation.
- Responses over 5MB are rejected. Output is truncated to ${formatSize(DEFAULT_MAX_BYTES)} / ${DEFAULT_MAX_LINES} lines when needed.`;

const WEBSEARCH_DESCRIPTION = `Search the web for current or unknown information and return a consolidated result snippet.

Use websearch for open-ended questions, recent information, discovery, or when the user asks about something outside the model's knowledge. If the user provides a specific URL, use webfetch instead.

Arguments:
- query: search query. Include the current year (${new Date().getFullYear()}) for recent/news/current-event queries when useful.
- numResults: number of results, default ${DEFAULT_WEBSEARCH_RESULTS}.
- livecrawl: "fallback" (default) or "preferred". Use "preferred" when freshness matters more than speed.
- type: "auto" (default), "fast", or "deep". Use "deep" for complex research, "fast" for quick lookup.
- contextMaxCharacters: optional result context size limit.

Output is truncated to ${formatSize(DEFAULT_MAX_BYTES)} / ${DEFAULT_MAX_LINES} lines when needed.`;

// --- GitHub URL handling ---

type LineRange = { start: number; end: number };
type GitHubBlob = {
  type: "blob";
  owner: string;
  repo: string;
  branch: string;
  path: string;
  lineRange: LineRange | null;
};
type GitHubTree = { type: "tree"; owner: string; repo: string; branch: string; path: string };
type GitHubRepo = { type: "repo"; owner: string; repo: string };
type GitHubUrl = GitHubBlob | GitHubTree | GitHubRepo;

const LINE_CONTEXT = 10;

function parseLineFragment(fragment: string): LineRange | null {
  const single = fragment.match(/^L(\d+)$/);
  if (single) {
    const n = parseInt(single[1], 10);
    return { start: n, end: n };
  }
  const range = fragment.match(/^L(\d+)-L(\d+)$/);
  if (range) return { start: parseInt(range[1], 10), end: parseInt(range[2], 10) };
  return null;
}

function extractLines(content: string, start: number, end: number): string {
  const lines = content.split("\n");
  const from = Math.max(1, start - LINE_CONTEXT);
  const to = Math.min(lines.length, end + LINE_CONTEXT);
  const width = String(to).length;
  return lines
    .slice(from - 1, to)
    .map((line, i) => {
      const lineNum = from + i;
      const num = String(lineNum).padStart(width, " ");
      const sep = lineNum >= start && lineNum <= end ? ":" : "-";
      return `${num}${sep}${line}`;
    })
    .join("\n");
}

function parseGitHubUrl(url: string): GitHubUrl | null {
  const [urlNoFragment, fragment] = url.split("#");
  const lineRange = fragment ? parseLineFragment(fragment) : null;

  const blob = urlNoFragment.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/,
  );
  if (blob)
    return {
      type: "blob",
      owner: blob[1],
      repo: blob[2],
      branch: blob[3],
      path: blob[4],
      lineRange,
    };

  const tree = urlNoFragment.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.+))?$/,
  );
  if (tree)
    return { type: "tree", owner: tree[1], repo: tree[2], branch: tree[3], path: tree[4] ?? "" };

  const repo = urlNoFragment.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (repo) return { type: "repo", owner: repo[1], repo: repo[2] };

  return null;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function summarizeText(text: string, maxLen = 160): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n/g, "\\n");
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 3))}...`;
}

// --- Main extension ---

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "webfetch",
    label: "Web Fetch",
    description: WEBFETCH_DESCRIPTION,
    promptSnippet: "Fetch URL content as markdown/raw text and return images as image attachments.",
    promptGuidelines: [
      "Use webfetch when the user provides a specific URL to inspect.",
      "Prefer format=markdown for readable page extraction unless the original response body is required.",
    ],
    parameters: WEBFETCH_PARAMS,
    renderCall(args, theme) {
      const params = args as Partial<WebFetchParams>;
      let text = theme.fg("toolTitle", theme.bold("webfetch "));
      if (typeof params.url === "string" && params.url.trim()) {
        text += theme.fg("accent", summarizeText(params.url.trim(), 90));
      } else {
        text += theme.fg("muted", "url?");
      }
      const format = typeof params.format === "string" ? params.format : "markdown";
      if (format !== "markdown") text += " " + theme.fg("muted", format);
      if (typeof params.objective === "string" && params.objective.trim()) {
        text += " " + theme.fg("dim", JSON.stringify(summarizeText(params.objective.trim(), 80)));
      }
      return new Text(text, 0, 0);
    },
    async execute(_toolCallId, params: WebFetchParams, signal, _onUpdate, ctx: ExtensionContext) {
      const { url } = params;

      // GitHub-aware handling
      const gh = parseGitHubUrl(url);
      if (gh) {
        if (gh.type === "blob") {
          const rawUrl = `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${gh.branch}/${gh.path}`;
          const response = await fetch(rawUrl);
          const content = await response.text();
          const text = gh.lineRange
            ? extractLines(content, gh.lineRange.start, gh.lineRange.end)
            : content;
          const truncated = await truncateForModelWithTempFile(text, "webfetch");
          return {
            content: [{ type: "text", text: truncated.text }],
            details: { url, rawUrl, truncation: truncated.details } as Record<string, unknown>,
          };
        }

        if (gh.type === "tree") {
          const endpoint = `repos/${gh.owner}/${gh.repo}/contents/${gh.path}?ref=${gh.branch}`;
          const result = await pi.exec("gh", ["api", endpoint]);
          const parsed = JSON.parse(result.stdout) as unknown;
          if (!Array.isArray(parsed)) {
            const msg =
              typeof (parsed as Record<string, unknown>).message === "string"
                ? ((parsed as Record<string, unknown>).message as string)
                : "unknown error";
            throw new Error(`GitHub API error for ${gh.owner}/${gh.repo}: ${msg}`);
          }
          const items = parsed as Array<{
            name: string;
            type: string;
            size?: number;
          }>;
          const lines = [`# ${gh.owner}/${gh.repo}/${gh.path}\n`];
          for (const item of items.sort((a, b) => {
            if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
            return a.name.localeCompare(b.name);
          })) {
            const icon = item.type === "dir" ? "📁" : "📄";
            const size = item.type === "file" && item.size ? ` (${formatBytes(item.size)})` : "";
            lines.push(`${icon} ${item.name}${item.type === "dir" ? "/" : ""}${size}`);
          }
          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: { url } as Record<string, unknown>,
          };
        }

        if (gh.type === "repo") {
          const result = await pi.exec("gh", ["api", `repos/${gh.owner}/${gh.repo}/readme`]);
          const readme = JSON.parse(result.stdout) as {
            content?: string;
            name?: string;
            message?: string;
          };
          if (typeof readme.content !== "string") {
            const msg = typeof readme.message === "string" ? readme.message : "unknown error";
            throw new Error(`GitHub API error for ${gh.owner}/${gh.repo}: ${msg}`);
          }
          const content = Buffer.from(readme.content, "base64").toString("utf-8");
          const truncated = await truncateForModelWithTempFile(content, "webfetch");
          return {
            content: [{ type: "text", text: truncated.text }],
            details: { url, file: readme.name, truncation: truncated.details } as Record<
              string,
              unknown
            >,
          };
        }
      }

      // General URL fetch
      const normalizedUrl = validateAndNormalizeUrl(url);
      const format = params.format ?? "markdown";
      const timeoutSeconds = Math.min(
        Math.max(params.timeout ?? DEFAULT_WEBFETCH_TIMEOUT_SECONDS, 1),
        MAX_WEBFETCH_TIMEOUT_SECONDS,
      );
      const { signal: requestSignal, cleanup } = mergeAbortSignals(signal, timeoutSeconds * 1000);

      let response: Response;
      try {
        const headers = buildWebFetchHeaders(format);
        const initial = await fetch(normalizedUrl, { signal: requestSignal, headers });
        response =
          initial.status === 403 && initial.headers.get("cf-mitigated") === "challenge"
            ? await fetch(normalizedUrl, {
                signal: requestSignal,
                headers: { ...headers, "User-Agent": "pi-web-tools" },
              })
            : initial;
      } catch (error) {
        cleanup();
        if (isAbortError(error))
          throw new Error(`Request timed out after ${timeoutSeconds} seconds`);
        throw error;
      }
      cleanup();

      if (!response.ok) throw new Error(`Request failed with status code: ${response.status}`);

      const contentLength = response.headers.get("content-length");
      if (contentLength && Number.parseInt(contentLength, 10) > MAX_RESPONSE_SIZE)
        throw new Error("Response too large (exceeds 5MB limit)");

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE)
        throw new Error("Response too large (exceeds 5MB limit)");

      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const mime = contentType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
      const isImage = mime.startsWith("image/") && mime !== "image/svg+xml";

      if (isImage) {
        return {
          content: [
            { type: "text", text: `Fetched image: ${normalizedUrl} (${mime})` },
            { type: "image", data: Buffer.from(arrayBuffer).toString("base64"), mimeType: mime },
          ],
          details: { url: normalizedUrl, format, contentType, bytes: arrayBuffer.byteLength },
        };
      }

      const raw = new TextDecoder().decode(arrayBuffer);
      const transformed = await transformContent(raw, contentType, format, normalizedUrl);

      // Optional: LLM-based objective narrowing. Best-effort — falls back to full markdown.
      const { objective } = params;
      let finalContent = transformed;
      let narrowed = false;
      let narrowingModel: string | undefined;
      let narrowingDiagnostics: Record<string, unknown> | undefined;
      if (objective && format === "markdown") {
        const config = await loadWebfetchConfig(ctx.cwd);
        const result = await narrowMarkdown(transformed, objective, ctx, signal, {
          model: config.objectiveModel,
        });
        finalContent = result.content;
        narrowed = result.narrowed;
        narrowingModel = result.model ? `${result.model.provider}/${result.model.id}` : undefined;
        narrowingDiagnostics = result.diagnostics;
      }

      const truncated = await truncateForModelWithTempFile(finalContent, "webfetch");

      return {
        content: [{ type: "text", text: truncated.text }],
        details: {
          url: normalizedUrl,
          format,
          contentType,
          bytes: arrayBuffer.byteLength,
          narrowed,
          narrowingModel,
          narrowingDiagnostics,
          truncation: truncated.details,
        },
      };
    },
  });

  pi.registerTool({
    name: "websearch",
    label: "Web Search",
    description: WEBSEARCH_DESCRIPTION,
    promptSnippet: "Search the web using Exa and return a consolidated result snippet.",
    promptGuidelines: [
      "Use websearch for open-ended or recent-information questions.",
      "Add the current year to news and current-events queries when useful.",
    ],
    parameters: WEBSEARCH_PARAMS,
    renderCall(args, theme) {
      const params = args as Partial<WebSearchParams>;
      let text = theme.fg("toolTitle", theme.bold("websearch "));
      if (typeof params.query === "string" && params.query.trim()) {
        text += theme.fg("accent", JSON.stringify(summarizeText(params.query.trim(), 100)));
      } else {
        text += theme.fg("muted", "query?");
      }
      if (typeof params.type === "string" && params.type !== "auto") {
        text += " " + theme.fg("muted", params.type);
      }
      if (typeof params.numResults === "number") {
        text += " " + theme.fg("dim", `${params.numResults} results`);
      }
      return new Text(text, 0, 0);
    },
    async execute(_toolCallId, params: WebSearchParams, signal) {
      const { signal: requestSignal, cleanup } = mergeAbortSignals(signal, WEBSEARCH_TIMEOUT_MS);
      const payload = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: {
            query: params.query,
            type: params.type ?? "auto",
            numResults: params.numResults ?? DEFAULT_WEBSEARCH_RESULTS,
            livecrawl: params.livecrawl ?? "fallback",
            contextMaxCharacters: params.contextMaxCharacters,
          },
        },
      };

      let response: Response;
      try {
        response = await fetch(`${WEBSEARCH_BASE_URL}${WEBSEARCH_ENDPOINT}`, {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: requestSignal,
        });
      } catch (error) {
        cleanup();
        if (isAbortError(error)) throw new Error("Search request timed out");
        throw error;
      }
      cleanup();

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Search error (${response.status}): ${errorText}`);
      }

      const responseText = await response.text();
      const parsedText = parseWebSearchResponse(responseText);
      const output = parsedText || "No search results found. Please try a different query.";
      const truncated = await truncateForModelWithTempFile(output, "websearch");

      return {
        content: [{ type: "text", text: truncated.text }],
        details: {
          query: params.query,
          numResults: params.numResults ?? DEFAULT_WEBSEARCH_RESULTS,
          livecrawl: params.livecrawl ?? "fallback",
          type: params.type ?? "auto",
          contextMaxCharacters: params.contextMaxCharacters,
          truncation: truncated.details,
        },
      };
    },
  });
}

function buildWebFetchHeaders(format: "markdown" | "raw") {
  let accept = "*/*";
  switch (format) {
    case "markdown":
      accept =
        "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
      break;
    case "raw":
      accept = "*/*";
      break;
  }
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
  };
}

function parseWebSearchResponse(text: string): string | null {
  const eventPayloads = parseSsePayloads(text);
  for (const payload of eventPayloads) {
    if (payload === "[DONE]") continue;
    try {
      const data = JSON.parse(payload) as {
        result?: { content?: Array<{ type?: string; text?: string }> };
      };
      const firstText = data.result?.content?.find(
        (item) => typeof item.text === "string" && item.text.length > 0,
      )?.text;
      if (firstText) return firstText;
    } catch {
      // ignore malformed lines
    }
  }
  try {
    const json = JSON.parse(text) as {
      result?: { content?: Array<{ type?: string; text?: string }> };
    };
    const firstText = json.result?.content?.find(
      (item) => typeof item.text === "string" && item.text.length > 0,
    )?.text;
    if (firstText) return firstText;
  } catch {
    // ignore non-JSON fallback
  }
  return null;
}

function parseSsePayloads(raw: string): string[] {
  const payloads: string[] = [];
  let current: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      current.push(line.slice(5).trimStart());
      continue;
    }
    if (line.trim() === "") {
      if (current.length > 0) {
        payloads.push(current.join("\n"));
        current = [];
      }
    }
  }
  if (current.length > 0) payloads.push(current.join("\n"));
  return payloads;
}

function mergeAbortSignals(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Timed out")), timeoutMs);
  const onAbort = () => controller.abort(parentSignal?.reason ?? new Error("Aborted"));
  if (parentSignal) {
    if (parentSignal.aborted) onAbort();
    else parentSignal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      if (parentSignal) parentSignal.removeEventListener("abort", onAbort);
    },
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("abort"))
  );
}
