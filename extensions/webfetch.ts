import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import TurndownService from "turndown";

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
    StringEnum(["text", "markdown", "html"] as const, {
      description:
        'The format to return content in ("text", "markdown", or "html"). Default: "markdown".',
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

const WEBFETCH_DESCRIPTION = `- Fetches content from a specified URL
- Handles GitHub URLs intelligently: blob URLs return raw file content, tree URLs return directory listings, repo URLs return the README
- For other URLs, fetches and returns content as markdown by default
- Returns images as tool result image attachments
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - The URL must be a valid fully-qualified http:// or https:// URL
  - Format options: "markdown" (default), "text", or "html"
  - timeout is in seconds (default: 30, max: 120)
  - Response size limit: 5MB
  - Tool output is truncated to ${formatSize(DEFAULT_MAX_BYTES)} / ${DEFAULT_MAX_LINES} lines to protect context`;

const WEBSEARCH_DESCRIPTION = `- Search the web using Exa AI (mcp.exa.ai)
- Provides up-to-date information for recent and live topics
- Supports result count, crawl strategy, and search depth controls
- Use this tool for information beyond the model knowledge cutoff

Usage notes:
  - livecrawl: "fallback" (default) or "preferred"
  - type: "auto" (default), "fast", or "deep"
  - numResults default: ${DEFAULT_WEBSEARCH_RESULTS}
  - The current year is ${new Date().getFullYear()}; include it in recent-news style queries
  - Tool output is truncated to ${formatSize(DEFAULT_MAX_BYTES)} / ${DEFAULT_MAX_LINES} lines to protect context`;

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

// --- Main extension ---

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "webfetch",
    label: "Web Fetch",
    description: WEBFETCH_DESCRIPTION,
    promptSnippet:
      "Fetch URL content as markdown/text/html and return images as image attachments.",
    promptGuidelines: [
      "Use webfetch when the user provides a specific URL to inspect.",
      "Prefer format=markdown for readable page extraction unless raw HTML is required.",
    ],
    parameters: WEBFETCH_PARAMS,
    async execute(_toolCallId, params: WebFetchParams, signal) {
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
          const truncated = await truncateForModel(text, "webfetch");
          return {
            content: [{ type: "text", text: truncated.text }],
            details: { url, rawUrl, truncation: truncated.details } as Record<string, unknown>,
          };
        }

        if (gh.type === "tree") {
          const endpoint = `repos/${gh.owner}/${gh.repo}/contents/${gh.path}?ref=${gh.branch}`;
          const result = await pi.exec("gh", ["api", endpoint]);
          const items = JSON.parse(result.stdout) as Array<{
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
          const readme = JSON.parse(result.stdout) as { content: string; name: string };
          const content = Buffer.from(readme.content, "base64").toString("utf-8");
          const truncated = await truncateForModel(content, "webfetch");
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
      const transformed = transformContent(raw, contentType, format);
      const truncated = await truncateForModel(transformed, "webfetch");

      return {
        content: [{ type: "text", text: truncated.text }],
        details: {
          url: normalizedUrl,
          format,
          contentType,
          bytes: arrayBuffer.byteLength,
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
      const truncated = await truncateForModel(output, "websearch");

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

function buildWebFetchHeaders(format: "text" | "markdown" | "html") {
  let accept = "*/*";
  switch (format) {
    case "markdown":
      accept =
        "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
      break;
    case "text":
      accept = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
      break;
    case "html":
      accept =
        "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
      break;
  }
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
  };
}

function validateAndNormalizeUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("URL must start with http:// or https://");
  return parsed.toString();
}

function transformContent(
  raw: string,
  contentType: string,
  format: "text" | "markdown" | "html",
): string {
  if (format === "html") return raw;
  if (contentType.toLowerCase().includes("text/html")) {
    if (format === "text") return extractTextFromHTML(raw);
    return convertHTMLToMarkdown(raw);
  }
  return raw;
}

function convertHTMLToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  turndown.remove(["script", "style", "meta", "link"]);
  return turndown.turndown(html);
}

function extractTextFromHTML(html: string): string {
  const withoutHidden = html
    .replace(/<(script|style|noscript|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer)>/gi, "\n");
  const withoutTags = withoutHidden.replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return named[entity] ?? match;
  });
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

async function truncateForModel(text: string, prefix: string) {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (!truncation.truncated) return { text: truncation.content, details: { truncated: false } };

  let tempFile: string | undefined;
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-web-tools-"));
    const filePath = path.join(dir, `${prefix}-${Date.now()}.txt`);
    await fs.writeFile(filePath, text, "utf8");
    tempFile = filePath;
  } catch {
    tempFile = undefined;
  }

  let note = `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
  note += tempFile ? ` Full output saved to: ${tempFile}]` : " Full output could not be saved.]";

  return {
    text: truncation.content + note,
    details: {
      truncated: true,
      outputLines: truncation.outputLines,
      totalLines: truncation.totalLines,
      outputBytes: truncation.outputBytes,
      totalBytes: truncation.totalBytes,
      tempFile,
    },
  };
}
