import { marked, type RendererObject } from "marked";

// Slack mrkdwn has no syntax highlighting — the language tag after the
// opening triple backticks shows up as literal text. Strip it.
//
// Slack uses *bold* (single asterisk) and _italic_ (single underscore),
// not **bold** or *italic* like standard markdown. Links are <url|text>
// instead of [text](url).
//
// See: https://api.slack.com/reference/surfaces/formatting

// --- Slack pattern protection ---
//
// Slack's native formatting uses <...> sequences for mentions, channels,
// special mentions, and links. These would be mangled by the markdown
// parser (treated as HTML tags or escaped). Protect them before parsing,
// restore after.

const SLACK_PATTERN_RE =
  /<(?:@[A-Z0-9]+(?:\|[^>]*)?|#[A-Z0-9]+(?:\|[^>]*)?|![^>]+|https?:\/\/[^>|]+(?:\|[^>]*)?|mailto:[^>|]+(?:\|[^>]*)?)>/g;

const PROTECT_MARKER = "\u00a7"; // § — unlikely in agent-generated text

function protectSlackPatterns(text: string): { text: string; patterns: string[] } {
  const patterns: string[] = [];
  const result = text.replace(SLACK_PATTERN_RE, (match) => {
    const idx = patterns.length;
    patterns.push(match);
    return `${PROTECT_MARKER}SP${idx}${PROTECT_MARKER}`;
  });
  return { text: result, patterns };
}

function restoreSlackPatterns(text: string, patterns: string[]): string {
  if (!patterns.length) return text;
  return text.replace(
    new RegExp(`${PROTECT_MARKER}SP(\\d+)${PROTECT_MARKER}`, "g"),
    (_match, idx) => patterns[Number(idx)] ?? _match,
  );
}

// --- Text escaping ---
//
// In mrkdwn, & < > are special — must be escaped in plain text to avoid
// Slack interpreting them as formatting. Code spans/blocks are exempt
// (the codespan renderer returns raw, and code blocks are preformatted).

function escapeSlackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cleanUrl(href: string): string {
  try {
    return encodeURI(href).replace(/%25/g, "%");
  } catch {
    return href;
  }
}

// --- Renderer ---
//
// Adapts the approach from md-to-slack (https://github.com/nicoespeon/md-to-slack)
// but fixes the code block language tag issue and tailors rendering for
// agent-generated markdown.

const slackRenderer: RendererObject = {
  space(token) {
    // Preserve whitespace between blocks — marked generates space tokens
    // for blank lines, and the parser concatenates block outputs without
    // automatic separators.
    return token.raw;
  },

  code({ text }) {
    // Strip the language tag. Slack mrkdwn doesn't support syntax
    // highlighting — any text after the opening backticks is literal.
    // Trailing newline separates the code block from the next block —
    // marked's parser concatenates block outputs without separators.
    return "```\n" + text + "\n```\n";
  },

  blockquote({ tokens }) {
    return tokens.map((t) => "> " + this.parser.parse([t]).trim()).join("\n") + "\n";
  },

  html({ text }) {
    return text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(?:del|s|strike)>/gi, "~")
      .replace(/<\/?[^>]+>/g, "");
  },

  heading({ tokens }) {
    // mrkdwn has no headings — render as bold.
    return "*" + this.parser.parseInline(tokens) + "*\n";
  },

  hr() {
    return "———\n";
  },

  list(token) {
    const items = token.items.map((item, i) => {
      const prefix = token.ordered
        ? `${Number(token.start) + i}. `
        : item.task
          ? item.checked
            ? "☒ "
            : "☐ "
          : "• ";
      return prefix + this.parser.parse(item.tokens).trim();
    });
    return items.join("\n") + "\n";
  },

  listitem() {
    return "";
  },

  checkbox() {
    return "";
  },

  paragraph({ tokens }) {
    return this.parser.parseInline(tokens) + "\n";
  },

  // Tables: mrkdwn has no table support. Dropping them is the same
  // approach as md-to-slack. The agent rarely writes tables; if needed,
  // we can convert to a preformatted code block later.
  table() {
    return "";
  },
  tablerow() {
    return "";
  },
  tablecell() {
    return "";
  },

  strong({ tokens }) {
    return "*" + this.parser.parseInline(tokens) + "*";
  },

  em({ tokens }) {
    return "_" + this.parser.parseInline(tokens) + "_";
  },

  codespan(token) {
    // Preserve raw — includes the backtick delimiters.
    return token.raw;
  },

  br() {
    return "\n";
  },

  del({ tokens }) {
    return "~" + this.parser.parseInline(tokens) + "~";
  },

  link({ href, tokens }) {
    const text = this.parser.parseInline(tokens);
    const url = cleanUrl(href);
    if (!text || url === text || url === `mailto:${text}`) {
      return `<${url}>`;
    }
    return `<${url}|${text}>`;
  },

  image() {
    // Not supported in mrkdwn.
    return "";
  },

  text(token) {
    // Block-level text with sub-tokens (e.g., loose list items) —
    // parse the inline children.
    if ("tokens" in token && token.tokens) {
      return this.parser.parseInline(token.tokens);
    }
    // Backslash-escaped characters — output as-is.
    if ("escaped" in token && token.escaped) {
      return token.text;
    }
    return escapeSlackText(token.text);
  },
};

marked.use({ renderer: slackRenderer });

// --- Public API ---

export function markdownToMrkdwn(text: string): string {
  const { text: protectedText, patterns } = protectSlackPatterns(text);
  const converted = marked.parse(protectedText, { async: false, gfm: true }) as string;
  const restored = restoreSlackPatterns(converted, patterns);
  // Collapse 3+ consecutive newlines to 2 (block renderers add trailing
  // newlines, space tokens add their own — this normalizes the result).
  return restored.replace(/\n{3,}/g, "\n\n").trim();
}
