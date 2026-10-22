import { Defuddle } from "defuddle/node";
import TurndownService from "turndown";

// UTM and common tracking params to strip from markdown link URLs.
const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "ref",
  "referrer",
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
];

const MARKDOWN_ALTERNATE_TIMEOUT_MS = 10_000;
const MARKDOWN_PROBE_TIMEOUT_MS = 3_000;
const LLMS_TXT_TIMEOUT_MS = 4_000;
const LLMS_TXT_MAX_BYTES = 256 * 1024;
const MARKDOWN_ACCEPT = "text/markdown, text/x-markdown;q=0.9, text/plain;q=0.8, */*;q=0.1";

export type LinkRelations = {
  alternateMarkdownUrl: string | null;
  llmsTxtUrl: string | null;
};

const DEFUDDLE_OPTS = {
  markdown: true,
  removeExactSelectors: true,
  removePartialSelectors: true,
  removeHiddenElements: true,
  removeLowScoring: true,
  removeSmallImages: true,
  standardize: true,
} as const;

export async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > maxBytes)
    throw new Error(`Response too large (exceeds ${Math.floor(maxBytes / 1024 / 1024)}MB limit)`);

  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(
          `Response too large (exceeds ${Math.floor(maxBytes / 1024 / 1024)}MB limit)`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function validateAndNormalizeUrl(value: string): string {
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

export async function transformContent(
  raw: string,
  contentType: string,
  format: "markdown" | "raw",
  url = "about:blank",
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  signal?: AbortSignal,
  maxResponseBytes = 5 * 1024 * 1024,
  linkRelations?: LinkRelations,
): Promise<string> {
  if (format === "raw") return raw;
  if (contentType.toLowerCase().includes("text/html")) {
    // Prefer a declared markdown alternate, then the conventional .md variants
    // described by llmstxt.org. Both can fail cheaply; HTML extraction is the fallback.
    const declared = linkRelations?.alternateMarkdownUrl ?? extractMarkdownAlternateUrl(raw, url);
    const attempted = new Set<string>();
    if (declared) {
      attempted.add(declared);
      const fetched = await fetchMarkdownVariant(
        declared,
        fetchFn,
        signal,
        maxResponseBytes,
        MARKDOWN_ALTERNATE_TIMEOUT_MS,
      );
      if (fetched) return fetched;
    }

    for (const candidate of markdownCandidateUrls(url)) {
      if (candidate === url || attempted.has(candidate)) continue;
      attempted.add(candidate);
      const fetched = await fetchMarkdownVariant(
        candidate,
        fetchFn,
        signal,
        maxResponseBytes,
        MARKDOWN_PROBE_TIMEOUT_MS,
      );
      if (fetched) return fetched;
    }

    try {
      const result = await Defuddle(raw, url, DEFUDDLE_OPTS);
      if (result && typeof result.content === "string" && result.content.trim()) {
        return cleanMarkdown(result.content);
      }
    } catch {
      // Fall through to Turndown; webfetch should still return useful content when Defuddle chokes.
    }
    return cleanMarkdown(convertHTMLToMarkdown(raw));
  }
  // Non-HTML markdown/text: still apply cleanup so callers benefit regardless of source.
  if (format === "markdown") return cleanMarkdown(raw);
  return raw;
}

/**
 * Extract the href from `<link rel="alternate" type="text/markdown" href="...">` in HTML.
 * Returns an absolute URL string, or null if not present / not safe to use.
 */
export function extractMarkdownAlternateUrl(html: string, baseUrl: string): string | null {
  // Quick bailout — avoid scanning huge non-HTML strings.
  if (!html.includes("alternate")) return null;
  for (const attrs of parseHtmlLinkTags(html)) {
    if (!hasRel(attrs, "alternate")) continue;
    if (!(attrs.type ?? "").toLowerCase().includes("text/markdown")) continue;
    const resolved = resolveHref(attrs.href, baseUrl);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Extract the llms.txt URL declared with `<link rel="describedby">` (or the
 * `llms-txt` relation some doc platforms emit) in the HTML head.
 */
export function extractLlmsTxtUrl(html: string, baseUrl: string): string | null {
  if (!html.includes("describedby") && !html.includes("llms-txt")) return null;
  for (const attrs of parseHtmlLinkTags(html)) {
    if (!hasRel(attrs, "describedby") && !hasRel(attrs, "llms-txt")) continue;
    const resolved = resolveHref(attrs.href, baseUrl);
    if (resolved) return resolved;
  }
  return null;
}

const HTML_LINK_TAG_RE = /<link\b[^>]*>/gi;
const HTML_ATTRIBUTE_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function parseHtmlLinkTags(html: string): Array<Record<string, string>> {
  const tags: Array<Record<string, string>> = [];
  for (const tag of html.match(HTML_LINK_TAG_RE) ?? []) {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(HTML_ATTRIBUTE_RE)) {
      const name = match[1].toLowerCase();
      attrs[name] ??= match[2] ?? match[3] ?? match[4] ?? "";
    }
    tags.push(attrs);
  }
  return tags;
}

function hasRel(attrs: Record<string, string>, relation: string): boolean {
  return (attrs.rel ?? "").toLowerCase().split(/\s+/).includes(relation);
}

function resolveHref(href: string | undefined, baseUrl: string): string | null {
  const value = href?.trim();
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Parse RFC 8288 `Link` response headers for the relations llmstxt.org uses:
 * `rel="alternate" type="text/markdown"` and `rel="describedby"` (plus the
 * `llms-txt` spelling emitted by some documentation platforms).
 */
export function parseLinkHeader(header: string | null | undefined, baseUrl: string): LinkRelations {
  const relations: LinkRelations = { alternateMarkdownUrl: null, llmsTxtUrl: null };
  if (!header) return relations;

  for (const match of header.matchAll(/<([^>]*)>([^<]*)/g)) {
    const resolved = resolveHref(match[1], baseUrl);
    if (!resolved) continue;
    const params = match[2] ?? "";
    const rel = linkParam(params, "rel").toLowerCase().split(/\s+/).filter(Boolean);
    const type = linkParam(params, "type").toLowerCase();
    if (
      !relations.alternateMarkdownUrl &&
      rel.includes("alternate") &&
      type.includes("text/markdown")
    )
      relations.alternateMarkdownUrl = resolved;
    if (!relations.llmsTxtUrl && (rel.includes("describedby") || rel.includes("llms-txt")))
      relations.llmsTxtUrl = resolved;
  }
  return relations;
}

function linkParam(params: string, name: string): string {
  const match = params.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;]*))`, "i"));
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

/**
 * Conventional markdown variants for a URL, per llmstxt.org: append `.md` to
 * the full filename (`page.html.md`), replace the extension (`page.md`), or use
 * `index.html.md` / `index.md` for URLs without a filename.
 */
export function markdownCandidateUrls(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];

  const candidates: string[] = [];
  const add = (pathname: string) => {
    const candidate = new URL(parsed.toString());
    candidate.pathname = pathname;
    candidate.hash = "";
    const value = candidate.toString();
    if (!candidates.includes(value)) candidates.push(value);
  };

  const path = parsed.pathname;
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  const base = path.slice(path.lastIndexOf("/") + 1);

  if (!base) {
    add(`${path}index.html.md`);
    add(`${path}index.md`);
    return candidates;
  }

  add(`${path}.md`);
  const dot = base.lastIndexOf(".");
  if (dot > 0) add(`${dir}${base.slice(0, dot)}.md`);
  return candidates;
}

/**
 * llms.txt locations that cover a directory URL: the most specific path first,
 * then the origin root. Non-directory URLs get no candidates; fetching a page
 * must not trigger arbitrary sibling requests.
 */
export function llmsTxtCandidateUrls(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
  if (!parsed.pathname.endsWith("/")) return [];

  const candidates: string[] = [];
  const add = (pathname: string) => {
    const candidate = new URL(parsed.toString());
    candidate.pathname = pathname;
    candidate.search = "";
    candidate.hash = "";
    const value = candidate.toString();
    if (!candidates.includes(value)) candidates.push(value);
  };

  add(`${parsed.pathname}llms.txt`);
  if (parsed.pathname !== "/") add("/llms.txt");
  return candidates;
}

/** The spec requires an H1 as the first content line; this rejects soft 404s. */
export function isLlmsTxtDocument(text: string): boolean {
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  return /^\s*#\s+\S/.test(body);
}

/** Return the URL of the most specific llms.txt that covers this directory URL. */
export async function discoverLlmsTxt(
  url: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<string | null> {
  for (const candidate of llmsTxtCandidateUrls(url)) {
    const timeout = AbortSignal.timeout(LLMS_TXT_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetchFn(candidate, {
        headers: { Accept: "text/plain, text/markdown;q=0.9, */*;q=0.1" },
        signal: requestSignal,
      });
      if (!response.ok) continue;
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      if (type.includes("html")) continue;
      const text = new TextDecoder().decode(await readResponseBytes(response, LLMS_TXT_MAX_BYTES));
      if (isLlmsTxtDocument(text)) return candidate;
    } catch {
      // Timed out or unreadable — try the next candidate.
    }
  }
  return null;
}

async function fetchMarkdownVariant(
  url: string,
  fetchFn: typeof globalThis.fetch,
  signal: AbortSignal | undefined,
  maxBytes: number,
  timeoutMs: number,
): Promise<string | null> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetchFn(url, {
      headers: { Accept: MARKDOWN_ACCEPT },
      signal: requestSignal,
    });
    if (!response.ok) return null;
    if (!isMarkdownResponse(response, url)) return null;
    const text = new TextDecoder().decode(await readResponseBytes(response, maxBytes));
    if (!text.trim() || looksLikeHtmlDocument(text)) return null;
    return cleanMarkdown(text);
  } catch {
    return null;
  }
}

function isMarkdownResponse(response: Response, url: string): boolean {
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("html")) return false;
  if (type.includes("text/markdown") || type.includes("text/x-markdown")) return true;
  if (type.includes("text/plain")) return true;
  return isMarkdownPath(url) && !type.startsWith("image/");
}

function isMarkdownPath(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith(".md") || path.endsWith(".mdx");
  } catch {
    return false;
  }
}

function looksLikeHtmlDocument(text: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html\b)/i.test(text);
}

/**
 * Apply deterministic post-processing cleanup to a markdown string:
 * - Strip UTM / tracking query params from inline and reference link URLs.
 * - Remove empty links `[](url)` and `[text]()` where the target is blank.
 * - Normalize GFM table separator rows (e.g. `| :---  |` → `| --- |`).
 *   Only touches lines that look like separator rows; never touches fenced code blocks.
 */
export function cleanMarkdown(markdown: string): string {
  let out = stripUtmFromMarkdownLinks(markdown);
  out = removeEmptyMarkdownLinks(out);
  out = normalizeTableSeparators(out);
  return out;
}

function stripUtmFromMarkdownLinks(markdown: string): string {
  // Match [text](url) inline links and strip UTM params from the URL portion.
  return markdown.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (full, text, rawUrl) => {
    const cleaned = stripTrackingParams(rawUrl.trim());
    return `[${text}](${cleaned})`;
  });
}

function removeEmptyMarkdownLinks(markdown: string): string {
  // Remove [](url) — no link text.
  let out = markdown.replace(/\[\]\([^)]*\)/g, "");
  // Remove [text]() — no URL.
  out = out.replace(/\[([^\]]*)\]\(\s*\)/g, "$1");
  return out;
}

function normalizeTableSeparators(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      // Separator rows: lines that contain only |, -, :, and whitespace.
      if (/^\|?[\s|:-]+\|$/.test(line.trim())) {
        return line.replace(/\|[\s:-]+/g, (cell) => {
          // Preserve leading pipe and replace cell content with ` --- `.
          return cell.startsWith("|") ? "| --- " : cell;
        });
      }
      return line;
    })
    .join("\n");
}

function stripTrackingParams(rawUrl: string): string {
  // Avoid mangling markdown syntax or non-URLs embedded in link targets.
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  // Only mutate http(s) URLs.
  if (url.protocol !== "http:" && url.protocol !== "https:") return rawUrl;
  let changed = false;
  for (const param of UTM_PARAMS) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  }
  if (!changed) return rawUrl;
  // Preserve trailing slash and original path casing.
  const result = url.toString();
  // If deleting all params left a bare ?, strip it.
  return result.endsWith("?") ? result.slice(0, -1) : result;
}

export function convertHTMLToMarkdown(html: string): string {
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

export function extractTextFromHTML(html: string): string {
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

export function decodeHtmlEntities(input: string): string {
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
