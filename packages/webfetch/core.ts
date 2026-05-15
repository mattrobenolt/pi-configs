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

const DEFUDDLE_OPTS = {
  markdown: true,
  removeExactSelectors: true,
  removePartialSelectors: true,
  removeHiddenElements: true,
  removeLowScoring: true,
  removeSmallImages: true,
  standardize: true,
} as const;

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
): Promise<string> {
  if (format === "raw") return raw;
  if (contentType.toLowerCase().includes("text/html")) {
    // Try the markdown alternate URL declared in the HTML head before parsing HTML.
    const alternateUrl = extractMarkdownAlternateUrl(raw, url);
    if (alternateUrl) {
      try {
        const res = await fetchFn(alternateUrl, {
          headers: { Accept: "text/markdown, text/plain;q=0.9, */*;q=0.1" },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const ct = res.headers.get("content-type") ?? "";
          if (
            ct.includes("text/markdown") ||
            ct.includes("text/plain") ||
            alternateUrl.endsWith(".md") ||
            alternateUrl.endsWith(".mdx")
          ) {
            const text = await res.text();
            if (text.trim()) return cleanMarkdown(text);
          }
        }
      } catch {
        // Alternate fetch failed — fall through to HTML extraction.
      }
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
  // Quick bailout — avoid regex on huge non-HTML strings.
  if (!html.includes("alternate")) return null;
  const match =
    html.match(
      /<link[^>]+rel=["']alternate["'][^>]+type=["']text\/markdown["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    ) ??
    html.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+type=["']text\/markdown["'][^>]+rel=["']alternate["'][^>]*>/i,
    );
  const href = match?.[1]?.trim();
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
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
