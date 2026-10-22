export interface Span {
  text: string;
  start: number;
  end: number;
  kind?: "prose" | "list" | "quote" | "heading" | "table" | "code";
}

export interface WordToken {
  text: string;
  lower: string;
  start: number;
  end: number;
}

export interface Heading {
  level: number;
  text: string;
  start: number;
  end: number;
  line: number;
}

export interface ParsedLine {
  text: string;
  start: number;
  end: number;
}

export interface Structure {
  lines: ParsedLine[];
  headings: Heading[];
  paragraphs: Span[];
  list_items: Span[];
  blockquotes: Span[];
  table_rows: Span[];
  horizontal_rules: Span[];
  non_empty_lines: number;
  title: string | null;
}

export const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;

const ABBREVIATIONS = new Set([
  "a.m",
  "adm",
  "al",
  "approx",
  "apr",
  "aug",
  "b.c",
  "bros",
  "capt",
  "cf",
  "cmdr",
  "col",
  "corp",
  "dec",
  "dept",
  "dr",
  "e.g",
  "eg",
  "est",
  "etc",
  "feb",
  "fig",
  "figs",
  "gen",
  "gov",
  "i.e",
  "ie",
  "inc",
  "jan",
  "jr",
  "jul",
  "jun",
  "lt",
  "ltd",
  "mar",
  "mr",
  "mrs",
  "ms",
  "mt",
  "no",
  "nov",
  "oct",
  "p.m",
  "prof",
  "rep",
  "rev",
  "sen",
  "sep",
  "sept",
  "sgt",
  "sr",
  "st",
  "u.s",
  "u.k",
  "vs",
  "vol",
  "vols",
]);

export const STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
]);

export const HEDGE_WORDS = new Set([
  "apparently",
  "arguably",
  "basically",
  "broadly",
  "could",
  "fairly",
  "generally",
  "largely",
  "likely",
  "maybe",
  "might",
  "often",
  "perhaps",
  "possibly",
  "potentially",
  "probably",
  "quite",
  "rather",
  "relatively",
  "seem",
  "seemed",
  "seems",
  "sometimes",
  "somewhat",
  "typically",
  "usually",
  "various",
]);

export const ABSTRACT_NOUNS = new Set([
  "adaptability",
  "alignment",
  "ambiguity",
  "authenticity",
  "capability",
  "clarity",
  "collaboration",
  "community",
  "complexity",
  "confidence",
  "connection",
  "creativity",
  "culture",
  "curiosity",
  "discipline",
  "efficiency",
  "empathy",
  "engagement",
  "excellence",
  "experience",
  "flexibility",
  "focus",
  "growth",
  "harmony",
  "impact",
  "innovation",
  "insight",
  "integrity",
  "intentionality",
  "journey",
  "leadership",
  "meaning",
  "momentum",
  "narrative",
  "nuance",
  "opportunity",
  "paradigm",
  "potential",
  "purpose",
  "quality",
  "resilience",
  "relevance",
  "scalability",
  "strategy",
  "synergy",
  "transformation",
  "trust",
  "value",
  "vision",
  "vulnerability",
]);

export const EVALUATIVE_WORDS = new Set([
  "answer",
  "big",
  "boring",
  "change",
  "clear",
  "difference",
  "easy",
  "enough",
  "hard",
  "important",
  "key",
  "lesson",
  "matter",
  "matters",
  "obvious",
  "point",
  "real",
  "shift",
  "simple",
  "small",
  "story",
  "takeaway",
  "truth",
  "whole",
]);

const COMMON_CAPITALIZED = new Set([
  "a",
  "after",
  "although",
  "an",
  "and",
  "as",
  "at",
  "because",
  "before",
  "but",
  "by",
  "each",
  "even",
  "every",
  "for",
  "from",
  "he",
  "her",
  "here",
  "his",
  "how",
  "however",
  "i",
  "if",
  "in",
  "into",
  "it",
  "its",
  "many",
  "most",
  "my",
  "no",
  "not",
  "of",
  "on",
  "once",
  "only",
  "or",
  "our",
  "she",
  "since",
  "so",
  "some",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "though",
  "through",
  "to",
  "under",
  "we",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

const COMMON_CAPITALIZED_ACRONYMS = new Set([
  "AI",
  "API",
  "CD",
  "CI",
  "CLI",
  "CPU",
  "CSS",
  "DB",
  "DNS",
  "GPU",
  "HTML",
  "HTTP",
  "HTTPS",
  "ID",
  "IP",
  "JSON",
  "LLM",
  "LLMS",
  "OS",
  "PR",
  "SDK",
  "SQL",
  "SSH",
  "SSL",
  "TCP",
  "TLS",
  "TUI",
  "UDP",
  "UI",
  "URL",
  "UX",
  "YAML",
]);

export function words(text: string): string[] {
  return text.match(WORD_PATTERN) ?? [];
}

export function wordTokens(text: string): WordToken[] {
  return [...text.matchAll(WORD_PATTERN)].map((match) => ({
    text: match[0],
    lower: match[0].toLowerCase(),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

export function coefficientOfVariation(values: number[]): number {
  const average = mean(values);
  return average === 0 ? 0 : stddev(values) / average;
}

export function maskProtectedText(text: string): string {
  const chars = text.split("");
  const mask = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
    }
  };

  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (frontmatter?.index === 0) mask(0, frontmatter[0].length);

  let openFence: { index: number; marker: string } | null = null;
  for (const line of linesWithOffsets(text)) {
    const fence = line.text.match(/^\s*(`{3,}|~{3,})/);
    if (!fence) continue;
    if (!openFence) {
      openFence = { index: line.start, marker: fence[1] };
    } else if (fence[1][0] === openFence.marker[0] && fence[1].length >= openFence.marker.length) {
      mask(openFence.index, line.end);
      openFence = null;
    }
  }
  if (openFence) mask(openFence.index, text.length);

  for (const match of text.matchAll(/<!--[\s\S]*?-->/g)) {
    mask(match.index, match.index + match[0].length);
  }

  let diffStart = text.search(/^diff --git /m);
  while (diffStart >= 0) {
    const separator = text.indexOf("\n━", diffStart);
    const diffEnd = separator >= 0 ? separator : text.length;
    mask(diffStart, diffEnd);
    const next = text.slice(diffEnd).search(/^diff --git /m);
    diffStart = next >= 0 ? diffEnd + next : -1;
  }

  for (const match of text.matchAll(/`{1,2}[^`\n]+`{1,2}/g)) {
    mask(match.index, match.index + match[0].length);
  }
  for (const match of text.matchAll(/https?:\/\/[^\s)>\]]+/g)) {
    mask(match.index, match.index + match[0].length);
  }

  return chars.join("");
}

export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const line = before.split("\n").length;
  const lastBreak = before.lastIndexOf("\n");
  return { line, column: offset - lastBreak };
}

export function countFencedCodeBlocks(text: string): number {
  let open: { char: string; length: number } | null = null;
  let count = 0;
  for (const line of linesWithOffsets(text)) {
    const match = line.text.match(/^\s*(`{3,}|~{3,})/);
    if (!match) continue;
    const marker = match[1];
    if (!open) {
      open = { char: marker[0], length: marker.length };
    } else if (marker[0] === open.char && marker.length >= open.length) {
      open = null;
      count += 1;
    }
  }
  return count;
}

export function linesWithOffsets(text: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text[index] === "\n") {
      const end = index > start && text[index - 1] === "\r" ? index - 1 : index;
      lines.push({ text: text.slice(start, end), start, end });
      start = index + 1;
    }
  }
  return lines;
}

function lineIndexAt(text: string, offset: number, lines: ParsedLine[]): number {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const line = lines[middle];
    if (offset < line.start) high = middle - 1;
    else if (offset > line.end) low = middle + 1;
    else return middle;
  }
  return Math.max(0, Math.min(lines.length - 1, low));
}

function lineKind(text: string, offset: number, lines: ParsedLine[]): Span["kind"] {
  const line = lines[lineIndexAt(text, offset, lines)]?.text ?? "";
  if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) return "list";
  if (/^\s*>\s?/.test(line)) return "quote";
  if (/^\s*\|.*\|\s*$/.test(line)) return "table";
  if (/^\s*#{1,6}\s+/.test(line)) return "heading";
  return "prose";
}

function isAbbreviationBoundary(text: string, boundaryStart: number): boolean {
  const before = text.slice(Math.max(0, boundaryStart - 12), boundaryStart + 1);
  const word = before.match(/([\p{L}.]{1,12})\.$/u)?.[1]?.toLowerCase();
  if (!word) return false;
  if (ABBREVIATIONS.has(word)) return true;
  if (/^[a-z]$/.test(word)) return true;
  if (/\d/.test(word) && /\d/.test(text[boundaryStart + 1] ?? "")) return true;
  return false;
}

export function sentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  const lines = linesWithOffsets(text);
  const boundary =
    /[.!?]+(?:["'’”)]*)?(?=\s+|$)|(?:\r?\n\s*){2,}|\r?\n(?=\s*(?:[-*+]|\d+[.)]|#{1,6}\s|>|\||```|~~~|-{3,}|\*{3,}|_{3,}))/g;
  let start = 0;

  const append = (rawStart: number, rawEnd: number) => {
    let value = text.slice(rawStart, rawEnd);
    let spanStart = rawStart;
    let spanEnd = rawEnd;

    const leading = value.search(/\S/);
    if (leading < 0) return;
    spanStart += leading;
    value = value.slice(leading);
    const trimmed = value.trimEnd();
    spanEnd = spanStart + trimmed.length;

    if (/^\s*(?:#{1,6}\s|[-*_]{3,}\s*$|\|.*\|\s*$)/.test(trimmed)) return;
    if (/^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*|__)[^*\n]+(?:\*\*|__)/.test(trimmed)) return;

    const marker = trimmed.match(/^[ \t>]*(?:[-*+]|\d+[.)])\s+/);
    if (marker) {
      spanStart += marker[0].length;
      value = trimmed.slice(marker[0].length);
    } else {
      value = trimmed.replace(/^[ \t>]+/, "");
      spanStart += trimmed.length - value.length;
    }

    if (words(value).length < 2) return;
    spans.push({
      text: value,
      start: spanStart,
      end: spanEnd,
      kind: lineKind(text, spanStart, lines),
    });
  };

  for (const match of text.matchAll(boundary)) {
    const boundaryStart = match.index;
    const boundaryEnd = boundaryStart + match[0].length;
    if (/^[.!?]/.test(match[0]) && isAbbreviationBoundary(text, boundaryStart)) continue;
    append(start, boundaryEnd);
    start = boundaryEnd;
  }
  append(start, text.length);
  return spans;
}

export function parseStructure(text: string): Structure {
  const lines = linesWithOffsets(text);
  const headingAt = new Map<number, { level: number; text: string }>();
  const setextUnderline = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].text;
    const atx = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (atx) {
      headingAt.set(index, { level: atx[1].length, text: atx[2].trim() });
      continue;
    }
    if (
      index > 0 &&
      /^\s*(?:=+|-+)\s*$/.test(line) &&
      lines[index - 1].text.trim() !== "" &&
      !/^\s*(?:[-*+]|\d+[.)]|#{1,6}\s|>|\|)/.test(lines[index - 1].text)
    ) {
      const level = line.includes("=") ? 1 : 2;
      headingAt.set(index - 1, { level, text: lines[index - 1].text.trim() });
      setextUnderline.add(index);
    }
  }

  const headings: Heading[] = [];
  const paragraphs: Span[] = [];
  const listItems: Span[] = [];
  const blockquotes: Span[] = [];
  const tableRows: Span[] = [];
  const horizontalRules: Span[] = [];
  let fence: { char: string; length: number } | null = null;
  let proseStart = -1;
  let proseEnd = -1;

  const flushProse = () => {
    if (proseStart < 0) return;
    const raw = text.slice(proseStart, proseEnd);
    const leading = raw.search(/\S/);
    if (leading >= 0) {
      const spanStart = proseStart + leading;
      const value = text.slice(spanStart, proseEnd).trimEnd();
      if (words(value).length >= 3) {
        paragraphs.push({
          text: value,
          start: spanStart,
          end: spanStart + value.length,
          kind: "prose",
        });
      }
    }
    proseStart = -1;
    proseEnd = -1;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.text.trim();
    const fenceMatch = line.text.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      flushProse();
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { char: marker[0], length: marker.length };
      } else if (marker[0] === fence.char && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;
    if (trimmed === "") {
      flushProse();
      continue;
    }

    const heading = headingAt.get(index);
    if (heading) {
      flushProse();
      const start = line.start + line.text.search(/\S/);
      headings.push({
        level: heading.level,
        text: heading.text,
        start,
        end: line.end,
        line: index + 1,
      });
      continue;
    }
    if (setextUnderline.has(index)) continue;

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line.text)) {
      flushProse();
      horizontalRules.push({ text: trimmed, start: line.start, end: line.end, kind: "prose" });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line.text)) {
      flushProse();
      tableRows.push({ text: trimmed, start: line.start, end: line.end, kind: "table" });
      continue;
    }
    if (/^\s*>\s?/.test(line.text)) {
      flushProse();
      const marker = line.text.match(/^\s*>\s?/)?.[0] ?? "";
      const start = line.start + marker.length;
      const value = text.slice(start, line.end).trimEnd();
      if (value) blockquotes.push({ text: value, start, end: start + value.length, kind: "quote" });
      continue;
    }
    const list = line.text.match(/^\s*(?:[-*+]|\d+[.)])\s+/);
    if (list) {
      flushProse();
      const start = line.start + list[0].length;
      const value = text.slice(start, line.end).trimEnd();
      if (value) listItems.push({ text: value, start, end: start + value.length, kind: "list" });
      continue;
    }

    if (proseStart < 0) proseStart = line.start;
    proseEnd = line.end;
  }
  flushProse();

  const firstH1 = headings.find((heading) => heading.level === 1);
  return {
    lines,
    headings,
    paragraphs,
    list_items: listItems,
    blockquotes,
    table_rows: tableRows,
    horizontal_rules: horizontalRules,
    non_empty_lines: lines.filter((line) => line.text.trim() !== "").length,
    title: firstH1?.text ?? null,
  };
}

export function paragraphSpans(text: string): Span[] {
  return parseStructure(text).paragraphs;
}

export function contentWords(text: string): string[] {
  return wordTokens(text)
    .map((token) => token.lower)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

export function hasDigit(text: string): boolean {
  return /\p{N}/u.test(text);
}

export function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

export function wordsInSpan(span: Span): number {
  return words(span.text).length;
}

export function startsWithAny(text: string, prefixes: readonly string[]): string | undefined {
  const lower = text.trimStart().toLowerCase();
  return prefixes.find((prefix) => lower.startsWith(prefix));
}

export function properNounTokens(text: string): string[] {
  const lines = linesWithOffsets(text);
  const sentenceStarts = new Set(sentenceSpans(text).map((span) => span.start));
  const found: string[] = [];
  for (const token of wordTokens(text)) {
    const first = token.text[0];
    if (!first || first !== first.toUpperCase() || first === first.toLowerCase()) continue;
    if (COMMON_CAPITALIZED.has(token.lower)) continue;
    if (STOPWORDS.has(token.lower) || STOPWORDS.has(token.lower.split("'")[0])) continue;
    if (COMMON_CAPITALIZED_ACRONYMS.has(token.text)) continue;
    if (token.text.length > 1 && token.text === token.text.toUpperCase()) continue;
    const line = lines[lineIndexAt(text, token.start, lines)];
    const linePrefix = text.slice(line.start, token.start);
    if (/^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s*$/.test(linePrefix)) continue;
    if (sentenceStarts.has(token.start)) continue;
    if (/^\s*[#>|]/.test(linePrefix)) continue;
    if (linePrefix.trim() === "" || /[.!?]["'’”)]*\s*$/.test(linePrefix)) continue;
    found.push(token.lower);
  }
  return found;
}

export function countNominalizations(text: string): number {
  return wordTokens(text).filter(
    (token) =>
      token.lower.length > 6 &&
      /(?:tion|sion|ment|ness|ity|ance|ence|ship|ism|ization|isation)$/.test(token.lower),
  ).length;
}

export function countAbstractNouns(text: string): number {
  return wordTokens(text).filter((token) => ABSTRACT_NOUNS.has(token.lower)).length;
}

export function countHedges(text: string): number {
  return wordTokens(text).filter((token) => HEDGE_WORDS.has(token.lower)).length;
}

export function countContractions(text: string): number {
  return countMatches(
    text,
    /(?:n['’]t|['’](?:re|ve|ll|d|m))\b|\b(?:it|that|there|what|here|let|he|she|who)['’]s\b/giu,
  );
}
