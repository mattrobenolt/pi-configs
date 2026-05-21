/**
 * better-diff — syntax-highlighted diff rendering for edit and write tools.
 *
 * Uses @pierre/diffs (Shiki-powered) for syntax highlighting. Renders in
 * split (side-by-side) or stack (unified) layout based on terminal width,
 * with line wrapping for long lines.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { createEditTool, createWriteTool } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getFiletypeFromFileName,
  getHighlighterOptions,
  getSharedHighlighter,
  parseDiffFromFile,
  renderDiffWithHighlighter,
  type FileDiffMetadata,
} from "@pierre/diffs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPLIT_MIN_WIDTH = 120;
const MIN_EMPH_BG_DISTANCE = 28;
const MAX_EMPH_BLEND = 0.28;
const GUTTER_FG_BLEND = 0.78;
const HIGHLIGHT_LINE_LIMIT = 1000;

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

function hexAnsi(color: string, bg: boolean): string {
  const [r, g, b] = hexRgb(color);
  return bg ? `\x1b[48;2;${r};${g};${b}m` : `\x1b[38;2;${r};${g};${b}m`;
}

const RST = "\x1b[0m";

function styled(text: string, fg?: string, bg?: string): string {
  return (fg ? hexAnsi(fg, false) : "") + (bg ? hexAnsi(bg, true) : "") + text + RST;
}

function padToWidth(line: string, width: number, bg: string): string {
  const pad = width - visibleWidth(line);
  if (pad <= 0) return line;
  return line + hexAnsi(bg, true) + " ".repeat(pad) + RST;
}

// ---------------------------------------------------------------------------
// Theme-aware palette
// ---------------------------------------------------------------------------

interface Palette {
  addGutterFg: string;
  addGutterBg: string;
  addLineBg: string;
  addEmphBg: string;
  delGutterFg: string;
  delGutterBg: string;
  delLineBg: string;
  delEmphBg: string;
  ctxGutterBg: string;
  ctxGutterFg: string;
  panelBg: string;
  hunkBg: string;
  hunkFg: string;
  splitDivFg: string;
  codeFg: string;
  collapsedFg: string;
}

function themeHex(s: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const m = s.match(/\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/);
  if (!m) return undefined;
  return rgbHex(Number(m[1]), Number(m[2]), Number(m[3]));
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function darken(hex: string, factor: number): string {
  const [r, g, b] = hexRgb(hex);
  return rgbHex(Math.round(r * factor), Math.round(g * factor), Math.round(b * factor));
}

function lighten(hex: string, factor: number): string {
  const [r, g, b] = hexRgb(hex);
  return rgbHex(
    Math.round(255 - (255 - r) * factor),
    Math.round(255 - (255 - g) * factor),
    Math.round(255 - (255 - b) * factor),
  );
}

function blendHex(fg: string, bg: string, ratio: number): string {
  const [fr, fgGreen, fb] = hexRgb(fg);
  const [br, bgGreen, bb] = hexRgb(bg);
  return rgbHex(
    Math.round(br + (fr - br) * ratio),
    Math.round(bgGreen + (fgGreen - bgGreen) * ratio),
    Math.round(bb + (fb - bb) * ratio),
  );
}

function hexColorDistance(a: string, b: string): number {
  const [ar, ag, ab] = hexRgb(a);
  const [br, bg, bb] = hexRgb(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

function strengthenEmphBg(lineBg: string, signColor: string, fallback: string): string {
  if (hexColorDistance(fallback, lineBg) >= MIN_EMPH_BG_DISTANCE) return fallback;
  for (let ratio = 0.08; ratio <= MAX_EMPH_BLEND; ratio += 0.02) {
    const candidate = blendHex(signColor, lineBg, ratio);
    if (hexColorDistance(candidate, lineBg) >= MIN_EMPH_BG_DISTANCE) return candidate;
  }
  return blendHex(signColor, lineBg, MAX_EMPH_BLEND);
}

function isDark(theme: Theme): boolean {
  // eslint-disable-next-line no-control-regex
  const m = theme.fg("text", "x").match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
  if (!m) return true;
  return 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]) > 128;
}

function buildPalette(theme: Theme): Palette {
  try {
    const dark = isDark(theme);
    const blend = dark ? darken : lighten;

    const addFg = themeHex(theme.fg("toolDiffAdded", "x")) ?? "#50fa7b";
    const delFg = themeHex(theme.fg("toolDiffRemoved", "x")) ?? "#ff5555";
    const ctxFg = themeHex(theme.fg("toolDiffContext", "x")) ?? "#6272a4";
    const mutedFg = themeHex(theme.fg("muted", "x")) ?? "#6272a4";
    const dimFg = themeHex(theme.fg("dim", "x")) ?? "#555566";

    const addLineBg = themeHex(theme.bg("toolSuccessBg", "x")) ?? (dark ? "#1e3328" : "#e6ffec");
    const delLineBg = themeHex(theme.bg("toolErrorBg", "x")) ?? (dark ? "#33201e" : "#ffebe9");
    const panelBg =
      (theme.name && KNOWN_BG_COLORS[theme.name]) ??
      themeHex(theme.bg("userMessageBg", "x")) ??
      (dark ? "#1e1e1e" : "#ffffff");
    const hunkBg = themeHex(theme.bg("toolPendingBg", "x")) ?? (dark ? "#21222c" : "#f0f0f0");

    return {
      addGutterFg: blendHex(addFg, panelBg, GUTTER_FG_BLEND),
      addGutterBg: blend(addLineBg, 0.7),
      addLineBg,
      addEmphBg: strengthenEmphBg(addLineBg, addFg, blend(addFg, 0.25)),
      delGutterFg: blendHex(delFg, panelBg, GUTTER_FG_BLEND),
      delGutterBg: blend(delLineBg, 0.7),
      delLineBg,
      delEmphBg: strengthenEmphBg(delLineBg, delFg, blend(delFg, 0.2)),
      ctxGutterBg: hunkBg,
      ctxGutterFg: ctxFg,
      panelBg,
      hunkBg,
      hunkFg: mutedFg,
      splitDivFg: dimFg,
      codeFg: dark ? "#f8f8f2" : "#24292f",
      collapsedFg: dimFg,
    };
  } catch {
    return FALLBACK_PALETTE;
  }
}

const KNOWN_SHIKI_THEMES: Record<string, string> = {
  dracula: "dracula",
  light: "github-light",
  dark: "github-dark",
};
// Terminal background colors per named theme — used for transparent-looking context lines.
const KNOWN_BG_COLORS: Record<string, string> = {
  dracula: "#191a24",
  dark: "#0d1117",
  light: "#ffffff",
};

function pickShikiTheme(theme: Theme): string {
  if (theme.name && KNOWN_SHIKI_THEMES[theme.name]) return KNOWN_SHIKI_THEMES[theme.name]!;
  return isDark(theme) ? "github-dark" : "github-light";
}

const FALLBACK_PALETTE: Palette = {
  addGutterFg: "#50fa7b",
  addGutterBg: "#152a1e",
  addLineBg: "#1e3328",
  addEmphBg: "#14501e",
  delGutterFg: "#ff5555",
  delGutterBg: "#2d1515",
  delLineBg: "#33201e",
  delEmphBg: "#501414",
  ctxGutterBg: "#21222c",
  ctxGutterFg: "#6272a4",
  panelBg: "#282a36",
  hunkBg: "#21222c",
  hunkFg: "#6272a4",
  splitDivFg: "#555566",
  codeFg: "#f8f8f2",
  collapsedFg: "#555566",
};

// ---------------------------------------------------------------------------
// HAST → structured spans
// ---------------------------------------------------------------------------

interface Span {
  text: string;
  fg?: string;
  emph: boolean;
}

interface HastNode {
  type: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function hastToSpans(node: HastNode | undefined): Span[] {
  if (!node) return [];
  const spans: Span[] = [];
  function walk(n: HastNode, fg: string | undefined, emph: boolean): void {
    if (n.type === "text") {
      const text = (n.value ?? "").replaceAll("\t", "  ").replaceAll("\n", "");
      if (!text) return;
      const last = spans.at(-1);
      if (last && last.fg === fg && last.emph === emph) {
        last.text += text;
        return;
      }
      spans.push({ text, fg, emph });
      return;
    }
    if (n.type !== "element") return;
    const m = ((n.properties?.style ?? "") as string).match(/color:\s*(#[0-9a-fA-F]+)/);
    const nextFg = m ? m[1] : fg;
    const nextEmph = emph || "data-diff-span" in (n.properties ?? {});
    for (const c of n.children ?? []) walk(c, nextFg, nextEmph);
  }
  walk(node, undefined, false);
  return spans;
}

function renderSpans(spans: Span[], emphBg: string, lineBg: string, codeFg: string): string {
  return spans
    .map(
      (s) =>
        hexAnsi(s.fg ?? codeFg, false) + hexAnsi(s.emph ? emphBg : lineBg, true) + s.text + RST,
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Highlighter cache
// ---------------------------------------------------------------------------

type Highlighter = Awaited<ReturnType<typeof getSharedHighlighter>>;
const hlCache = new Map<string, Promise<Highlighter | null>>();

function loadHighlighter(lang: string, shikiTheme: string): Promise<Highlighter | null> {
  const key = `${shikiTheme}:${lang}`;
  const cached = hlCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const opts = getHighlighterOptions(lang, { theme: shikiTheme });
      return await getSharedHighlighter({ ...opts, preferredHighlighter: "shiki-js" });
    } catch {
      return null;
    }
  })();

  hlCache.set(key, pending);
  return pending;
}

// ---------------------------------------------------------------------------
// Diff data model — linear, correct ordering
// ---------------------------------------------------------------------------

interface LineData {
  lineNum: number;
  spans: Span[];
}

type LineKind = "context" | "addition" | "deletion" | "empty";

type HunkItem =
  | { type: "context"; lines: LineData[] }
  | { type: "change"; deletions: LineData[]; additions: LineData[] };

interface HunkData {
  header: string;
  collapsedBefore: number;
  additions: number;
  deletions: number;
  items: HunkItem[];
}
interface DiffData {
  hunks: HunkData[];
  numWidth: number;
}

function emptySpans(raw: string): Span[] {
  return raw ? [{ text: raw, fg: undefined, emph: false }] : [];
}

function aliasHighlightedContextLines(
  metadata: FileDiffMetadata,
  delNodes: (HastNode | undefined)[],
  addNodes: (HastNode | undefined)[],
): void {
  for (const hunk of metadata.hunks) {
    let di = hunk.deletionLineIndex;
    let ai = hunk.additionLineIndex;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let i = 0; i < content.lines; i++) {
          const shared = addNodes[ai + i] ?? delNodes[di + i];
          if (!shared) continue;
          delNodes[di + i] = shared;
          addNodes[ai + i] = shared;
        }
        di += content.lines;
        ai += content.lines;
        continue;
      }

      di += content.deletions;
      ai += content.additions;
    }
  }
}

function buildDiffData(
  metadata: FileDiffMetadata,
  delNodes: (HastNode | undefined)[] | null,
  addNodes: (HastNode | undefined)[] | null,
): DiffData {
  const numWidth = String(
    metadata.hunks.reduce(
      (mx, h) => Math.max(mx, h.deletionStart + h.deletionCount, h.additionStart + h.additionCount),
      1,
    ),
  ).length;

  const hunks: HunkData[] = [];

  for (const hunk of metadata.hunks) {
    const specs =
      hunk.hunkSpecs ??
      `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`;
    const header = hunk.hunkContext ? `${specs}  ${hunk.hunkContext}` : specs;
    const items: HunkItem[] = [];
    let additions = 0;
    let deletions = 0;

    let di = hunk.deletionLineIndex,
      ai = hunk.additionLineIndex;
    let dl = hunk.deletionStart,
      al = hunk.additionStart;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        const lines: LineData[] = [];
        for (let i = 0; i < content.lines; i++) {
          const raw = (metadata.additionLines[ai + i] ?? "").replace(/\n$/, "");
          lines.push({
            lineNum: al + i,
            spans: addNodes ? hastToSpans(addNodes[ai + i]) : emptySpans(raw),
          });
        }
        items.push({ type: "context", lines });
        di += content.lines;
        ai += content.lines;
        dl += content.lines;
        al += content.lines;
        continue;
      }

      deletions += content.deletions;
      additions += content.additions;

      const deletionLines: LineData[] = [];
      for (let i = 0; i < content.deletions; i++) {
        const raw = (metadata.deletionLines[di + i] ?? "").replace(/\n$/, "");
        deletionLines.push({
          lineNum: dl + i,
          spans: delNodes ? hastToSpans(delNodes[di + i]) : emptySpans(raw),
        });
      }
      const additionLines: LineData[] = [];
      for (let i = 0; i < content.additions; i++) {
        const raw = (metadata.additionLines[ai + i] ?? "").replace(/\n$/, "");
        additionLines.push({
          lineNum: al + i,
          spans: addNodes ? hastToSpans(addNodes[ai + i]) : emptySpans(raw),
        });
      }
      items.push({ type: "change", deletions: deletionLines, additions: additionLines });

      di += content.deletions;
      ai += content.additions;
      dl += content.deletions;
      al += content.additions;
    }

    hunks.push({ header, collapsedBefore: hunk.collapsedBefore, additions, deletions, items });
  }

  return { hunks, numWidth };
}

function countStats(metadata: FileDiffMetadata) {
  let additions = 0,
    deletions = 0;
  for (const hunk of metadata.hunks)
    for (const c of hunk.hunkContent)
      if (c.type === "change") {
        additions += c.additions;
        deletions += c.deletions;
      }
  return { additions, deletions };
}

// ---------------------------------------------------------------------------
// Line wrapping
// ---------------------------------------------------------------------------

// Wrap an ANSI string into visual rows of maxWidth, returning each as a string.
function wrapContent(ansiStr: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [ansiStr];
  if (visibleWidth(ansiStr) <= maxWidth) return [ansiStr];
  const wrapped = wrapTextWithAnsi(ansiStr, maxWidth);
  return Array.isArray(wrapped)
    ? wrapped.map((l) => truncateToWidth(l, maxWidth))
    : (wrapped as string).split("\n").map((l) => truncateToWidth(l, maxWidth));
}

// ---------------------------------------------------------------------------
// Stack (unified) rendering
// ---------------------------------------------------------------------------

function gutterFg(kind: LineKind, p: Palette): string {
  if (kind === "addition") return p.addGutterFg;
  if (kind === "deletion") return p.delGutterFg;
  return p.ctxGutterFg;
}

function gutterBg(kind: LineKind, p: Palette): string {
  if (kind === "addition") return p.addGutterBg;
  if (kind === "deletion") return p.delGutterBg;
  return p.ctxGutterBg;
}

function lineBg(kind: LineKind, p: Palette): string {
  if (kind === "addition") return p.addLineBg;
  if (kind === "deletion") return p.delLineBg;
  return p.panelBg;
}

function emphBg(kind: LineKind, p: Palette): string {
  if (kind === "deletion") return p.delEmphBg;
  return p.addEmphBg;
}

function renderStackLine(
  kind: "context" | "addition" | "deletion",
  oldNum: number | undefined,
  newNum: number | undefined,
  spans: Span[],
  nw: number,
  contentWidth: number,
  p: Palette,
): string[] {
  const oldN = oldNum != null ? String(oldNum).padStart(nw) : " ".repeat(nw);
  const newN = newNum != null ? String(newNum).padStart(nw) : " ".repeat(nw);
  const sign = kind === "addition" ? "+" : kind === "deletion" ? "-" : " ";
  const gFg = gutterFg(kind, p);
  const gBg = gutterBg(kind, p);
  const bg = lineBg(kind, p);
  const emphasis = emphBg(kind, p);

  const gutter = styled(`${sign}${oldN} ${newN} `, gFg, gBg);
  const gutterCont = styled(`${"·".padStart(nw * 2 + 2)}`, p.ctxGutterFg, gBg);
  const gutterW = 1 + nw + 1 + nw + 1;

  const contentAnsi = padToWidth(renderSpans(spans, emphasis, bg, p.codeFg), contentWidth, bg);
  const rows = wrapContent(contentAnsi, contentWidth);

  return rows.map((row, i) =>
    padToWidth(
      (i === 0 ? gutter : gutterCont) + padToWidth(row, contentWidth, bg),
      gutterW + contentWidth,
      bg,
    ),
  );
}

function hunkStats(hunk: HunkData, p: Palette, bg: string): string {
  return (
    styled(`+${hunk.additions}`, p.addGutterFg, bg) +
    styled(` -${hunk.deletions}`, p.delGutterFg, bg)
  );
}

function collapsedLine(count: number, width: number, p: Palette): string {
  const label = `  ··· ${count} unchanged ${count === 1 ? "line" : "lines"} ···`;
  return padToWidth(styled(label, p.collapsedFg, p.hunkBg), width, p.hunkBg);
}

function diffDataToStackLines(data: DiffData, width: number, p: Palette): string[] {
  const nw = data.numWidth;
  const gutterW = 1 + nw + 1 + nw + 1;
  const contentWidth = Math.max(0, width - gutterW);
  const lines: string[] = [];

  for (const hunk of data.hunks) {
    if (hunk.collapsedBefore > 0) lines.push(collapsedLine(hunk.collapsedBefore, width, p));

    lines.push(hunkHeader(hunk, width, p));

    for (const item of hunk.items) {
      if (item.type === "context") {
        for (const line of item.lines)
          lines.push(
            ...renderStackLine(
              "context",
              line.lineNum,
              line.lineNum,
              line.spans,
              nw,
              contentWidth,
              p,
            ),
          );
      } else {
        for (const line of item.deletions)
          lines.push(
            ...renderStackLine(
              "deletion",
              line.lineNum,
              undefined,
              line.spans,
              nw,
              contentWidth,
              p,
            ),
          );
        for (const line of item.additions)
          lines.push(
            ...renderStackLine(
              "addition",
              undefined,
              line.lineNum,
              line.spans,
              nw,
              contentWidth,
              p,
            ),
          );
      }
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Split (side-by-side) rendering
// ---------------------------------------------------------------------------

function emptyHalf(side: "left" | "right", halfWidth: number, p: Palette): string {
  if (side === "right" || halfWidth <= 0) {
    return hexAnsi(p.panelBg, true) + " ".repeat(halfWidth) + RST;
  }

  return (
    styled("▌", p.ctxGutterFg, p.panelBg) +
    hexAnsi(p.panelBg, true) +
    " ".repeat(halfWidth - 1) +
    RST
  );
}

function renderHalf(
  side: "left" | "right",
  kind: LineKind,
  lineNum: number | undefined,
  spans: Span[],
  nw: number,
  halfWidth: number,
  p: Palette,
): string[] {
  if (kind === "empty") {
    return [emptyHalf(side, halfWidth, p)];
  }

  const numStr = lineNum != null ? String(lineNum).padStart(nw) : " ".repeat(nw);
  const gFg = gutterFg(kind, p);
  const marker = side === "left" ? "▌" : " ";
  const gBg = gutterBg(kind, p);
  const bg = lineBg(kind, p);
  const emphasis = emphBg(kind, p);
  const gw = nw + 2;
  const cw = Math.max(0, halfWidth - gw);

  const gutter = styled(`${marker}${numStr} `, gFg, gBg);
  const gutterCont = styled(`${marker}${" ".repeat(Math.max(0, gw - 1))}`, gFg, gBg);

  const contentAnsi = renderSpans(spans, emphasis, bg, p.codeFg);
  const rows = wrapContent(contentAnsi, cw);

  return rows.map((row, i) => (i === 0 ? gutter : gutterCont) + padToWidth(row, cw, bg));
}

function renderSplitPair(
  leftKind: "context" | "deletion" | "empty",
  leftLine: LineData | undefined,
  rightKind: "context" | "addition" | "empty",
  rightLine: LineData | undefined,
  nw: number,
  width: number,
  p: Palette,
): string[] {
  const lw = Math.floor((width - 1) / 2);
  const rw = width - 1 - lw;
  let railFg = p.splitDivFg;
  if (rightKind === "addition") railFg = p.addGutterFg;
  else if (leftKind === "deletion") railFg = p.delGutterFg;
  const sep = styled("▌", railFg, p.panelBg);

  const leftRows = renderHalf(
    "left",
    leftKind,
    leftLine?.lineNum,
    leftLine?.spans ?? [],
    nw,
    lw,
    p,
  );
  const rightRows = renderHalf(
    "right",
    rightKind,
    rightLine?.lineNum,
    rightLine?.spans ?? [],
    nw,
    rw,
    p,
  );

  const count = Math.max(leftRows.length, rightRows.length);
  const emptyLeft = emptyHalf("left", lw, p);
  const emptyRight = emptyHalf("right", rw, p);

  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push((leftRows[i] ?? emptyLeft) + sep + (rightRows[i] ?? emptyRight));
  }
  return result;
}

function hunkHeader(hunk: HunkData, width: number, p: Palette): string {
  const m = hunk.header.match(/^(@@ [^@]+ @@)(.*)/);
  const atAt = m ? m[1]! : hunk.header;
  const ctx = m ? m[2]!.trim() : "";
  const text = ctx
    ? styled(` ${atAt}`, p.hunkFg, p.hunkBg) + styled(`  ${ctx}`, p.collapsedFg, p.hunkBg)
    : styled(` ${atAt}`, p.hunkFg, p.hunkBg);
  const stats = hunkStats(hunk, p, p.hunkBg);
  const textWidth = Math.max(0, width - visibleWidth(stats));
  return padToWidth(truncateToWidth(text, textWidth), textWidth, p.hunkBg) + stats;
}

function diffDataToSplitLines(data: DiffData, width: number, p: Palette): string[] {
  const nw = data.numWidth;
  const lines: string[] = [];

  for (const hunk of data.hunks) {
    if (hunk.collapsedBefore > 0) lines.push(collapsedLine(hunk.collapsedBefore, width, p));
    lines.push(hunkHeader(hunk, width, p));

    for (const item of hunk.items) {
      if (item.type === "context") {
        for (const line of item.lines)
          lines.push(...renderSplitPair("context", line, "context", line, nw, width, p));
      } else {
        const count = Math.max(item.deletions.length, item.additions.length);
        for (let i = 0; i < count; i++)
          lines.push(
            ...renderSplitPair(
              item.deletions[i] ? "deletion" : "empty",
              item.deletions[i],
              item.additions[i] ? "addition" : "empty",
              item.additions[i],
              nw,
              width,
              p,
            ),
          );
      }
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// DiffView component
// ---------------------------------------------------------------------------

class DiffView {
  data: DiffData | null = null;
  palette: Palette = FALLBACK_PALETTE;
  stats: { additions: number; deletions: number } | null = null;
  isNewFile = false;
  expanded = false;
  error: string | null = null;

  private cachedWidth?: number;
  private cachedLines?: string[];
  private dirty = true;

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width && !this.dirty) return this.cachedLines;
    this.cachedWidth = width;
    this.dirty = false;
    try {
      this.cachedLines = this.buildLines(width);
    } catch (e) {
      this.cachedLines = [styled(`better-diff render error: ${e}`, "#ff5555")];
    }
    return this.cachedLines;
  }

  private buildLines(width: number): string[] {
    if (this.error) return [styled(`diff error: ${this.error}`, FALLBACK_PALETTE.delGutterFg)];

    if (!this.expanded || !this.data) {
      // Collapsed: one stats line
      if (!this.stats) return [];
      if (this.isNewFile) return [styled("new file", this.palette.addGutterFg)];
      return [
        styled(`+${this.stats.additions} `, this.palette.addGutterFg) +
          styled(`-${this.stats.deletions}`, this.palette.delGutterFg),
      ];
    }

    const p = this.palette;
    return width >= SPLIT_MIN_WIDTH
      ? diffDataToSplitLines(this.data, width, p)
      : diffDataToStackLines(this.data, width, p);
  }

  invalidate() {
    this.dirty = true;
  }
}

// ---------------------------------------------------------------------------
// Shared state / rendering flow
// ---------------------------------------------------------------------------

interface DiffState {
  oldContent?: string;
  newContent?: string;
  path?: string;
  metadata?: FileDiffMetadata;
  hlStarted?: boolean;
  shikiTheme?: string;
  delNodes?: (HastNode | undefined)[];
  addNodes?: (HastNode | undefined)[];
  hlVersion?: number; // increments when highlight data arrives
  builtVersion?: number; // version of the last built DiffData
  builtData?: DiffData; // cached build result
  view?: DiffView;
}

function applyState(
  state: DiffState,
  view: DiffView,
  expanded: boolean,
  palette: Palette,
  context: { invalidate(): void },
): void {
  const prevExpanded = view.expanded;
  const prevPalette = view.palette;
  view.palette = palette;
  view.expanded = expanded;
  if (prevExpanded !== expanded || prevPalette !== palette) view.invalidate();

  if (state.newContent === undefined) return;

  try {
    if (!state.metadata) {
      try {
        state.metadata = parseDiffFromFile(
          {
            name: state.path ?? "",
            contents: state.oldContent ?? "",
            cacheKey: `old:${state.path}`,
          },
          { name: state.path ?? "", contents: state.newContent, cacheKey: `new:${state.path}` },
          { context: 2 },
          true,
        );
      } catch {
        return;
      }
    }

    const metadata = state.metadata;
    if (!metadata || metadata.hunks.length === 0) {
      view.stats = { additions: 0, deletions: 0 };
      view.isNewFile = state.oldContent === "";
      return;
    }

    view.stats = countStats(metadata);
    view.isNewFile = state.oldContent === "";
    if (!expanded) return;

    if (!state.hlStarted) {
      state.hlStarted = true;
      const lang = getFiletypeFromFileName(state.path ?? "") ?? "text";
      loadHighlighter(lang, state.shikiTheme ?? "github-dark").then((hl) => {
        if (hl && state.metadata) {
          try {
            const res = renderDiffWithHighlighter(state.metadata, hl, {
              theme: state.shikiTheme ?? "github-dark",
              useTokenTransformer: false,
              tokenizeMaxLineLength: HIGHLIGHT_LINE_LIMIT,
              lineDiffType: "word-alt",
              maxLineDiffLength: HIGHLIGHT_LINE_LIMIT,
            });
            state.delNodes = res.code.deletionLines as (HastNode | undefined)[];
            state.addNodes = res.code.additionLines as (HastNode | undefined)[];
            aliasHighlightedContextLines(state.metadata, state.delNodes, state.addNodes);
          } catch {}
        }
        state.hlVersion = (state.hlVersion ?? 0) + 1;
        view.invalidate();
        context.invalidate();
      });
    }

    // Rebuild DiffData only when highlight data changed or first time
    const currentVersion = state.hlVersion ?? 0;
    if (!state.builtData || state.builtVersion !== currentVersion) {
      state.builtData = buildDiffData(metadata, state.delNodes ?? null, state.addNodes ?? null);
      state.builtVersion = currentVersion;
      view.invalidate();
    }
    view.data = state.builtData;
  } catch (e) {
    view.error = String(e);
    view.invalidate();
  }
}

// Shared renderResult logic for both edit and write tools.
function renderDiffResult(
  result: { content: { type: string; text?: string }[]; details: unknown },
  expanded: boolean,
  isPartial: boolean,
  theme: Theme,
  context: { state: Record<string, unknown>; args: Record<string, unknown>; invalidate(): void },
): DiffView {
  const state = context.state as DiffState;
  if (!state.view) state.view = new DiffView();
  const view = state.view;

  if (isPartial) {
    view.error = null;
    view.stats = null;
    view.expanded = false;
    view.invalidate();
    return view;
  }

  const fc = result.content[0];
  if (fc?.type === "text" && fc.text?.startsWith("Error")) {
    view.error = fc.text.split("\n")[0]!;
    view.invalidate();
    return view;
  }

  const det = (result.details ?? {}) as { _old?: string; _new?: string; _path?: string };
  if (det._new === undefined) {
    view.error = null;
    view.stats = null;
    view.invalidate();
    return view;
  }

  view.error = null;

  const palette = buildPalette(theme);
  if (state.oldContent === undefined) {
    state.oldContent = det._old ?? "";
    state.newContent = det._new;
    state.path = det._path ?? (context.args.path as string);
    state.shikiTheme = pickShikiTheme(theme);
  }

  applyState(state, view, expanded, palette, context);
  return view;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

async function readUtf8(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function renderResultSafely(
  result: { content: { type: string; text?: string }[]; details: unknown },
  expanded: boolean,
  isPartial: boolean,
  theme: Theme,
  context: { state: Record<string, unknown>; args: Record<string, unknown>; invalidate(): void },
): DiffView {
  try {
    return renderDiffResult(result, expanded, isPartial, theme, context);
  } catch (e) {
    const v = new DiffView();
    v.error = String(e);
    return v;
  }
}

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  const originalEdit = createEditTool(cwd);
  const originalWrite = createWriteTool(cwd);

  // ── edit ──────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "edit",
    label: "edit",
    description: originalEdit.description,
    parameters: originalEdit.parameters,

    async execute(id, params, signal, onUpdate, ctx) {
      const absPath = resolve(ctx.cwd, params.path as string);
      const oldContent = await readUtf8(absPath);
      const result = await originalEdit.execute(id, params, signal, onUpdate);
      const newContent = await readUtf8(absPath);
      return {
        ...result,
        details: {
          ...(result.details as object),
          _old: oldContent,
          _new: newContent,
          _path: params.path as string,
        },
      };
    },

    renderCall(args, theme) {
      const t = new Text("", 0, 0);
      t.setText(theme.fg("toolTitle", theme.bold("edit ")) + theme.fg("accent", args.path));
      return t;
    },

    renderResult(result, { expanded, isPartial }, theme, context) {
      return renderResultSafely(result, expanded, isPartial, theme, context);
    },
  });

  // ── write ─────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "write",
    label: "write",
    description: originalWrite.description,
    parameters: originalWrite.parameters,

    async execute(id, params, signal, onUpdate, ctx) {
      const absPath = resolve(ctx.cwd, params.path as string);
      const oldContent = await readUtf8(absPath);
      const result = await originalWrite.execute(id, params, signal, onUpdate);
      return {
        ...result,
        details: {
          ...(result.details as object),
          _old: oldContent,
          _new: params.content as string,
          _path: params.path as string,
        },
      };
    },

    renderCall(args, theme) {
      const t = new Text("", 0, 0);
      const lc = (args.content as string).split("\n").length;
      t.setText(
        theme.fg("toolTitle", theme.bold("write ")) +
          theme.fg("accent", args.path) +
          theme.fg("dim", ` (${lc} lines)`),
      );
      return t;
    },

    renderResult(result, { expanded, isPartial }, theme, context) {
      return renderResultSafely(result, expanded, isPartial, theme, context);
    },
  });
}
