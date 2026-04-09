/**
 * Memory Extension with QMD-Powered Search
 *
 * Plain-Markdown memory system with semantic search via qmd.
 * Core memory tools (write/read/scratchpad) work without qmd installed.
 * The memory_search tool requires qmd for keyword, semantic, and hybrid search.
 *
 * Layout:
 *   ~/.pi/agent/memory/
 *     MEMORY.md              — global long-term memory (personal prefs, env setup, pi config)
 *     SCRATCHPAD.md          — checklist of things to keep in mind / fix later
 *     daily/YYYY-MM-DD.md    — daily append-only log (today + yesterday loaded at session start)
 *
 *   ~/.pi/agent/projects/
 *     git/github.com/org/repo/MEMORY.md   — per-project memory (keyed by git remote)
 *     path/Users/matt/some-dir/MEMORY.md  — fallback for repos without a remote
 *
 * Tools:
 *   memory_write   — write to MEMORY.md, project memory, or daily log
 *   memory_read    — read any memory file or list daily logs
 *   scratchpad     — add/check/uncheck/clear items on the scratchpad checklist
 *   memory_search  — search across all memory files via qmd (keyword, semantic, or deep)
 *
 * Context injection:
 *   - scratchpad + today's daily + project MEMORY.md + global MEMORY.md + yesterday's daily
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import { type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getTrackedCwd, onTrackedCwdChange } from "./lib/cwd-state";

const DEFAULT_MEMORY_DIR =
  process.env.PI_MEMORY_DIR ?? path.join(process.env.HOME ?? "~", ".pi", "agent", "memory");
const DEFAULT_PROJECTS_DIR = path.join(process.env.HOME ?? "~", ".pi", "agent", "projects");
const SESSIONS_DIR = path.join(process.env.HOME ?? "~", ".pi", "agent", "sessions");
const SESSIONS_INDEX_DIR = path.join(process.env.HOME ?? "~", ".pi", "agent", "sessions-index");

let MEMORY_DIR = DEFAULT_MEMORY_DIR;
let MEMORY_FILE = path.join(MEMORY_DIR, "MEMORY.md");
let SCRATCHPAD_FILE = path.join(MEMORY_DIR, "SCRATCHPAD.md");
let SELF_FILE = path.join(MEMORY_DIR, "SELF.md");
let USER_FILE = path.join(MEMORY_DIR, "USER.md");
let DAILY_DIR = path.join(MEMORY_DIR, "daily");
let PROJECTS_DIR = DEFAULT_PROJECTS_DIR;

/** Override base directory (for testing). */
export function _setBaseDir(baseDir: string) {
  MEMORY_DIR = baseDir;
  MEMORY_FILE = path.join(baseDir, "MEMORY.md");
  SCRATCHPAD_FILE = path.join(baseDir, "SCRATCHPAD.md");
  SELF_FILE = path.join(baseDir, "SELF.md");
  USER_FILE = path.join(baseDir, "USER.md");
  DAILY_DIR = path.join(baseDir, "daily");
  PROJECTS_DIR = path.join(baseDir, "projects");
}

/** Reset to default paths (for testing). */
export function _resetBaseDir() {
  _setBaseDir(DEFAULT_MEMORY_DIR);
  PROJECTS_DIR = DEFAULT_PROJECTS_DIR;
}

export function projectMemoryFile(projectKey: string): string {
  return path.join(PROJECTS_DIR, projectKey, "MEMORY.md");
}

export interface ProjectFrontmatter {
  "project-dirs": Record<string, string>;
}

/** Parse YAML frontmatter from a markdown file. Returns null if no frontmatter found. */
export function parseFrontmatter(
  content: string,
): { frontmatter: ProjectFrontmatter; body: string } | null {
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const yaml = content.slice(4, end);
  const body = content.slice(end + 5);

  const frontmatter: ProjectFrontmatter = { "project-dirs": {} };
  let inProjectDirs = false;
  for (const line of yaml.split("\n")) {
    if (line === "project-dirs:") {
      inProjectDirs = true;
      continue;
    }
    if (inProjectDirs) {
      const match = line.match(/^  ([^:]+): (.+)$/);
      if (match) {
        frontmatter["project-dirs"][match[1].trim()] = match[2].trim();
      } else if (!line.startsWith(" ")) {
        inProjectDirs = false;
      }
    }
  }
  return { frontmatter, body };
}

/** Serialize a ProjectFrontmatter to a YAML frontmatter block. */
export function serializeFrontmatter(frontmatter: ProjectFrontmatter): string {
  const dirs = frontmatter["project-dirs"];
  const entries = Object.entries(dirs);
  if (entries.length === 0) return "";
  const lines = ["---", "project-dirs:"];
  for (const [host, dir] of entries) {
    lines.push(`  ${host}: ${dir}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

/**
 * Upsert the current hostname → gitRoot into the project memory file's frontmatter.
 * Creates frontmatter if not present. Returns the updated full content.
 */
export function upsertProjectFrontmatter(
  existing: string,
  hostname: string,
  gitRoot: string,
): string {
  const parsed = parseFrontmatter(existing);
  if (parsed) {
    parsed.frontmatter["project-dirs"][hostname] = gitRoot;
    return serializeFrontmatter(parsed.frontmatter) + parsed.body;
  }
  // No frontmatter yet — prepend it
  const frontmatter: ProjectFrontmatter = { "project-dirs": { [hostname]: gitRoot } };
  return serializeFrontmatter(frontmatter) + existing;
}

/** Strip frontmatter from content before injecting into context. */
export function stripFrontmatter(content: string): string {
  const parsed = parseFrontmatter(content);
  return parsed ? parsed.body : content;
}

export function ensureDirs() {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.mkdirSync(DAILY_DIR, { recursive: true });
}

export function todayStr(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function nowTimestamp(): string {
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
}

export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

export function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function dailyPath(date: string): string {
  return path.join(DAILY_DIR, `${date}.md`);
}

interface SessionEntry {
  type: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
  };
  timestamp?: string;
  cwd?: string;
  id?: string;
}

/**
 * Extract user/assistant text from a session JSONL file into a Markdown string.
 * Strips tool calls, tool results, and thinking blocks — chat text only.
 */
export async function extractSessionMarkdown(jsonlPath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(jsonlPath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return null;

  let sessionDate = "";
  let cwd = "";
  let sessionId = "";
  const turns: string[] = [];

  for (const line of lines) {
    let entry: SessionEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "session") {
      sessionDate = entry.timestamp?.slice(0, 10) ?? "";
      cwd = entry.cwd ?? "";
      sessionId = entry.id ?? "";
      continue;
    }

    if (entry.type !== "message" || !entry.message) continue;

    const { role, content } = entry.message;
    if (role !== "user" && role !== "assistant") continue;

    const text = content
      .filter((c) => c.type === "text" && c.text?.trim())
      .map((c) => c.text!.trim())
      .join("\n");

    if (text) turns.push(`**${role === "user" ? "User" : "Assistant"}:** ${text}`);
  }

  if (turns.length === 0) return null;

  const header = [
    `# Session ${sessionDate}`,
    ``,
    cwd ? `Project: ${cwd}` : "",
    sessionId ? `ID: ${sessionId}` : "",
    ``,
    `---`,
    ``,
  ]
    .filter((l, i) => l || i > 3)
    .join("\n");

  return header + turns.join("\n\n");
}

/** Write extracted session markdown to the sessions-index directory. */
export async function indexSession(jsonlPath: string): Promise<boolean> {
  const md = await extractSessionMarkdown(jsonlPath);
  if (!md) return false;

  const basename = path.basename(jsonlPath, ".jsonl");
  // Use YYYY-MM subdir for organisation
  const month = basename.slice(0, 7); // "2026-03"
  const outDir = path.join(SESSIONS_INDEX_DIR, month);
  await fs.promises.mkdir(outDir, { recursive: true });
  await fs.promises.writeFile(path.join(outDir, `${basename}.md`), md, "utf-8");
  return true;
}

const RESPONSE_PREVIEW_MAX_CHARS = 4_000;
const RESPONSE_PREVIEW_MAX_LINES = 120;

const CONTEXT_LONG_TERM_MAX_CHARS = 4_000;
const CONTEXT_LONG_TERM_MAX_LINES = 150;
const CONTEXT_PROJECT_MAX_CHARS = 4_000;
const CONTEXT_PROJECT_MAX_LINES = 150;
const CONTEXT_SELF_MAX_CHARS = 2_000;
const CONTEXT_SELF_MAX_LINES = 80;
const CONTEXT_USER_MAX_CHARS = 2_000;
const CONTEXT_USER_MAX_LINES = 80;
const CONTEXT_SCRATCHPAD_MAX_CHARS = 2_000;
const CONTEXT_SCRATCHPAD_MAX_LINES = 120;
const CONTEXT_DAILY_MAX_CHARS = 3_000;
const CONTEXT_DAILY_MAX_LINES = 120;
const CONTEXT_SEARCH_MAX_CHARS = 2_500;
const CONTEXT_SEARCH_MAX_LINES = 80;
const CONTEXT_MAX_CHARS = 20_000;

type TruncateMode = "start" | "end" | "middle";

interface PreviewResult {
  preview: string;
  truncated: boolean;
  totalLines: number;
  totalChars: number;
  previewLines: number;
  previewChars: number;
}

function truncateLines(lines: string[], maxLines: number, mode: TruncateMode) {
  if (maxLines <= 0 || lines.length <= maxLines) {
    return { lines, truncated: false };
  }

  if (mode === "end") {
    return { lines: lines.slice(-maxLines), truncated: true };
  }

  if (mode === "middle" && maxLines > 1) {
    const marker = "... (truncated) ...";
    const keep = maxLines - 1;
    const headCount = Math.ceil(keep / 2);
    const tailCount = Math.floor(keep / 2);
    const head = lines.slice(0, headCount);
    const tail = tailCount > 0 ? lines.slice(-tailCount) : [];
    return { lines: [...head, marker, ...tail], truncated: true };
  }

  return { lines: lines.slice(0, maxLines), truncated: true };
}

function truncateText(text: string, maxChars: number, mode: TruncateMode) {
  if (maxChars <= 0 || text.length <= maxChars) {
    return { text, truncated: false };
  }

  if (mode === "end") {
    return { text: text.slice(-maxChars), truncated: true };
  }

  if (mode === "middle" && maxChars > 10) {
    const marker = "... (truncated) ...";
    const keep = maxChars - marker.length;
    if (keep > 0) {
      const headCount = Math.ceil(keep / 2);
      const tailCount = Math.floor(keep / 2);
      return {
        text: text.slice(0, headCount) + marker + text.slice(text.length - tailCount),
        truncated: true,
      };
    }
  }

  return { text: text.slice(0, maxChars), truncated: true };
}

function buildPreview(
  content: string,
  options: { maxLines: number; maxChars: number; mode: TruncateMode },
): PreviewResult {
  const normalized = content.trim();
  if (!normalized) {
    return {
      preview: "",
      truncated: false,
      totalLines: 0,
      totalChars: 0,
      previewLines: 0,
      previewChars: 0,
    };
  }

  const lines = normalized.split("\n");
  const totalLines = lines.length;
  const totalChars = normalized.length;

  const lineResult = truncateLines(lines, options.maxLines, options.mode);
  const text = lineResult.lines.join("\n");
  const charResult = truncateText(text, options.maxChars, options.mode);
  const preview = charResult.text;

  const previewLines = preview ? preview.split("\n").length : 0;
  const previewChars = preview.length;

  return {
    preview,
    truncated: lineResult.truncated || charResult.truncated,
    totalLines,
    totalChars,
    previewLines,
    previewChars,
  };
}

function formatPreviewBlock(label: string, content: string, mode: TruncateMode) {
  const result = buildPreview(content, {
    maxLines: RESPONSE_PREVIEW_MAX_LINES,
    maxChars: RESPONSE_PREVIEW_MAX_CHARS,
    mode,
  });

  if (!result.preview) {
    return `${label}: empty.`;
  }

  const meta = `${label} (${result.totalLines} lines, ${result.totalChars} chars)`;
  const note = result.truncated
    ? `\n[preview truncated: showing ${result.previewLines}/${result.totalLines} lines, ${result.previewChars}/${result.totalChars} chars]`
    : "";
  return `${meta}\n\n${result.preview}${note}`;
}

function formatContextSection(
  label: string,
  content: string,
  mode: TruncateMode,
  maxLines: number,
  maxChars: number,
) {
  const result = buildPreview(content, { maxLines, maxChars, mode });
  if (!result.preview) {
    return "";
  }
  const note = result.truncated
    ? `\n\n[truncated: showing ${result.previewLines}/${result.totalLines} lines, ${result.previewChars}/${result.totalChars} chars]`
    : "";
  return `${label}\n\n${result.preview}${note}`;
}

function uniqStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function summarizeMemoryInjection(injection: LastMemoryInjection | null): string {
  if (!injection) return "mem: no injection yet";
  const transport =
    injection.transports.length > 0 ? uniqStrings(injection.transports).join("/") : "none";
  const hits = injection.skippedSearch
    ? "search skipped"
    : `${injection.searchHitCount} hit${injection.searchHitCount === 1 ? "" : "s"}`;
  return `mem: ${injection.chars} chars · ${injection.sections} section${injection.sections === 1 ? "" : "s"} · ${hits} · ${transport}`;
}

function updateMemoryWidget() {
  if (!capturedUi) return;
  if (!lastMemoryInjection) {
    capturedUi.setWidget("memory-context", []);
    return;
  }
  const transport =
    lastMemoryInjection.transports.length > 0
      ? uniqStrings(lastMemoryInjection.transports).join("/")
      : "none";
  const files =
    lastMemoryInjection.searchFiles.length > 0
      ? uniqStrings(lastMemoryInjection.searchFiles).slice(0, 2).join(", ")
      : lastMemoryInjection.skippedSearch
        ? "search skipped"
        : "no hits";
  capturedUi.setWidget("memory-context", [
    `🧠 ${summarizeMemoryInjection(lastMemoryInjection)}`,
    `   ${transport} · ${files}`,
  ]);
}

function formatLastMemoryInjection(
  injection: LastMemoryInjection | null,
  includeContext = true,
): string {
  if (!injection) return "No memory has been injected yet in this session.";

  const lines = [
    `Time: ${injection.at}`,
    `Prompt: ${injection.prompt || "(empty)"}`,
    `Summary: ${summarizeMemoryInjection(injection)}`,
    `Project: ${injection.projectKey ?? "(none)"}`,
    `Search chars: ${injection.searchChars}`,
    `Search files: ${
      injection.searchFiles.length > 0
        ? uniqStrings(injection.searchFiles).join(", ")
        : injection.skippedSearch
          ? "search skipped"
          : "none"
    }`,
    `Debug: ${injection.debug.length > 0 ? injection.debug.join(" | ") : "(none)"}`,
  ];

  if (!includeContext) return lines.join("\n");
  return `${lines.join("\n")}\n\n${formatPreviewBlock("Injected memory context", injection.memoryContext, "start")}`;
}

function getQmdUpdateMode(): "background" | "manual" | "off" {
  const mode = (process.env.PI_MEMORY_QMD_UPDATE ?? "background").toLowerCase();
  if (mode === "manual" || mode === "off" || mode === "background") {
    return mode;
  }
  return "background";
}

async function ensureQmdAvailableForUpdate(): Promise<boolean> {
  if (qmdAvailable) return true;
  if (getQmdUpdateMode() !== "background") return false;
  qmdAvailable = await detectQmd();
  return qmdAvailable;
}

export interface ScratchpadItem {
  done: boolean;
  text: string;
  meta: string; // the <!-- timestamp [session] --> comment
}

export function parseScratchpad(content: string): ScratchpadItem[] {
  const items: ScratchpadItem[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^- \[([ xX])\] (.+)$/);
    if (match) {
      let meta = "";
      if (i > 0 && lines[i - 1].match(/^<!--.*-->$/)) {
        meta = lines[i - 1];
      }
      items.push({
        done: match[1].toLowerCase() === "x",
        text: match[2],
        meta,
      });
    }
  }
  return items;
}

export function serializeScratchpad(items: ScratchpadItem[]): string {
  const lines: string[] = ["# Scratchpad", ""];
  for (const item of items) {
    if (item.meta) {
      lines.push(item.meta);
    }
    const checkbox = item.done ? "[x]" : "[ ]";
    lines.push(`- ${checkbox} ${item.text}`);
  }
  return `${lines.join("\n")}\n`;
}

export function buildMemoryContext(
  searchResults?: string,
  _currentProjectKey?: string | null,
): string {
  if (!searchResults?.trim()) {
    return "";
  }

  const section = formatContextSection(
    "## Relevant memories (auto-retrieved)",
    searchResults,
    "start",
    CONTEXT_SEARCH_MAX_LINES,
    CONTEXT_SEARCH_MAX_CHARS,
  );
  if (!section) {
    return "";
  }

  const context = `# Memory\n\n${section}`;
  if (context.length > CONTEXT_MAX_CHARS) {
    const result = buildPreview(context, {
      maxLines: Number.POSITIVE_INFINITY,
      maxChars: CONTEXT_MAX_CHARS,
      mode: "start",
    });
    const note = result.truncated
      ? `\n\n[truncated overall context: showing ${result.previewChars}/${result.totalChars} chars]`
      : "";
    return `${result.preview}${note}`;
  }

  return context;
}

type ExecFileFn = typeof execFile;
let execFileFn: ExecFileFn = execFile;

interface LastMemoryInjection {
  at: string;
  prompt: string;
  memoryContext: string;
  chars: number;
  sections: number;
  searchHitCount: number;
  searchFiles: string[];
  searchChars: number;
  transports: string[];
  debug: string[];
  projectKey: string | null;
  skippedSearch: boolean;
}

let qmdAvailable = false;
let updateTimer: ReturnType<typeof setTimeout> | null = null;
let projectKeyCache = new Map<string, string | null>();
let unsubscribeTrackedCwd: (() => void) | null = null;
let qmdDaemonHealthy: boolean | null = null;
let qmdDaemonEnsurePromise: Promise<boolean> | null = null;
let qmdDaemonRetryAfter = 0;
let qmdLastDebug = "";
let capturedUi: ExtensionContext["ui"] | null = null;
let lastMemoryInjection: LastMemoryInjection | null = null;

/** Normalize a git remote URL to a canonical key like "git/github.com/org/repo". */
export function normalizeGitRemote(url: string): string | null {
  url = url.trim();
  // SSH: git@github.com:org/repo.git
  const sshMatch = url.match(/^[^@]+@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) return `git/${sshMatch[1]}/${sshMatch[2]}`;
  // HTTPS/HTTP: https://github.com/org/repo.git
  const httpsMatch = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return `git/${httpsMatch[1]}/${httpsMatch[2]}`;
  return null;
}

/** Get the git root for the given working directory, or null if not in a repo. */
export function getGitRoot(cwd = getTrackedCwd()): Promise<string | null> {
  return new Promise((resolve) => {
    execFileFn(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd, timeout: 3_000 },
      (err, stdout, _stderr) => {
        resolve(err || !stdout?.trim() ? null : stdout.trim());
      },
    );
  });
}

/** Resolve a project key from a cwd + git root. Tries remote first, falls back to path/. */
export function resolveProjectKey(
  gitRoot: string | null,
  cwd = getTrackedCwd(),
): Promise<string | null> {
  if (!gitRoot) {
    const rel = cwd.replace(/^\//, "");
    return Promise.resolve(rel ? `path/${rel}` : null);
  }

  const cacheKey = `git:${gitRoot}`;
  const cached = projectKeyCache.get(cacheKey);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise((resolve) => {
    execFileFn(
      "git",
      ["-C", gitRoot, "remote", "get-url", "origin"],
      { timeout: 3_000 },
      (err, remoteUrl) => {
        const key =
          err || !remoteUrl?.trim()
            ? `path/${gitRoot.replace(/^\//, "")}`
            : (normalizeGitRemote(remoteUrl.trim()) ?? `path/${gitRoot.replace(/^\//, "")}`);
        projectKeyCache.set(cacheKey, key);
        resolve(key);
      },
    );
  });
}

/** Get the current project key for the tracked cwd. */
export async function getProjectKey(cwd = getTrackedCwd()): Promise<string | null> {
  const gitRoot = await getGitRoot(cwd);
  if (!gitRoot) {
    const cacheKey = `cwd:${cwd}`;
    const cached = projectKeyCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const key = await resolveProjectKey(null, cwd);
    projectKeyCache.set(cacheKey, key);
    return key;
  }

  return resolveProjectKey(gitRoot, cwd);
}

/** Override execFile implementation (for testing). */
export function _setExecFileForTest(fn: ExecFileFn) {
  execFileFn = fn;
}

/** Reset execFile implementation (for testing). */
export function _resetExecFileForTest() {
  execFileFn = execFile;
}

/** Set qmd availability flag (for testing). */
export function _setQmdAvailable(value: boolean) {
  qmdAvailable = value;
}

/** Get current qmd availability flag (for testing). */
export function _getQmdAvailable(): boolean {
  return qmdAvailable;
}

/** Get current update timer (for testing). */
export function _getUpdateTimer(): ReturnType<typeof setTimeout> | null {
  return updateTimer;
}

/** Clear the update timer (for testing). */
export function _clearUpdateTimer() {
  if (updateTimer) {
    clearTimeout(updateTimer);
    updateTimer = null;
  }
}

const QMD_REPO_URL = "https://github.com/tobi/qmd";
const DEFAULT_QMD_DAEMON_URL = "http://localhost:8181";
const QMD_DAEMON_HEALTH_TIMEOUT_MS = 750;
const QMD_DAEMON_START_TIMEOUT_MS = 15_000;
const QMD_DAEMON_RETRY_COOLDOWN_MS = 30_000;
const QMD_DAEMON_READY_ATTEMPTS = 10;
const QMD_DAEMON_READY_DELAY_MS = 300;

export function qmdInstallInstructions(): string {
  return [
    "memory_search requires qmd.",
    "",
    "Install qmd (requires Bun):",
    `  bun install -g ${QMD_REPO_URL}`,
    "  # ensure ~/.bun/bin is in your PATH",
    "",
    "Then set up the collection (one-time):",
    `  qmd collection add ${MEMORY_DIR} --name pi-memory`,
    "  qmd embed",
  ].join("\n");
}

export function qmdCollectionInstructions(): string {
  return [
    "qmd collection pi-memory is not configured.",
    "",
    "Set up the collection (one-time):",
    `  qmd collection add ${MEMORY_DIR} --name pi-memory`,
    "  qmd embed",
  ].join("\n");
}

/** Auto-create the pi-projects collection for per-project memory files. */
export async function setupProjectsCollection(): Promise<boolean> {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      execFileFn(
        "qmd",
        ["collection", "add", PROJECTS_DIR, "--name", "pi-projects"],
        { timeout: 10_000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  } catch {
    return false;
  }
  return true;
}

export interface QmdSearchResult {
  path?: string;
  file?: string;
  score?: number;
  content?: string;
  chunk?: string;
  snippet?: string;
  title?: string;
  [key: string]: unknown;
}

function getQmdResultPath(r: QmdSearchResult): string | undefined {
  return r.path ?? r.file;
}

function getQmdResultText(r: QmdSearchResult): string {
  return r.content ?? r.chunk ?? r.snippet ?? "";
}

function stripAnsi(text: string): string {
  // qmd may emit spinners/progress bars even with --json, especially on first model download.
  // Strip ANSI CSI/OSC sequences so we can reliably find and parse JSON payloads.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences
  return text
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, "");
}

function parseQmdJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  if (trimmed === "No results found." || trimmed === "No results found") return [];

  const cleaned = stripAnsi(stdout);
  const lines = cleaned.split(/\r?\n/);
  const startLine = lines.findIndex((l) => {
    const s = l.trimStart();
    return s.startsWith("[") || s.startsWith("{");
  });
  if (startLine === -1) {
    throw new Error(`Failed to parse qmd output: ${trimmed.slice(0, 200)}`);
  }

  const jsonText = lines.slice(startLine).join("\n").trim();
  if (!jsonText) return [];
  return JSON.parse(jsonText);
}

function getQmdDaemonUrl(): string {
  return (process.env.PI_MEMORY_QMD_DAEMON_URL ?? DEFAULT_QMD_DAEMON_URL).replace(/\/+$/, "");
}

async function qmdHttpGetJson(endpoint: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getQmdDaemonUrl()}${endpoint}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`QMD daemon ${response.status}: ${await response.text()}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function qmdHttpPostJson(
  endpoint: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getQmdDaemonUrl()}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`QMD daemon ${response.status}: ${await response.text()}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function qmdDaemonHealthCheck(timeoutMs = QMD_DAEMON_HEALTH_TIMEOUT_MS): Promise<boolean> {
  try {
    const response = (await qmdHttpGetJson("/health", timeoutMs)) as { status?: string };
    return response?.status === "ok";
  } catch (err) {
    qmdLastDebug = `health-check failed: ${err instanceof Error ? err.message : String(err)}`;
    return false;
  }
}

async function startQmdDaemon(): Promise<boolean> {
  return await new Promise((resolve) => {
    execFileFn(
      "qmd",
      ["mcp", "--http", "--daemon"],
      { timeout: QMD_DAEMON_START_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (!err) {
          qmdLastDebug = `daemon started: ${(stdout ?? stderr ?? "").trim() || "ok"}`;
          resolve(true);
          return;
        }
        const message = [stderr?.trim(), stdout?.trim(), err.message].filter(Boolean).join(" | ");
        if (/already running/i.test(message)) {
          qmdLastDebug = `daemon already running: ${message}`;
          resolve(true);
          return;
        }
        qmdLastDebug = `daemon start failed: ${message}`;
        resolve(false);
      },
    );
  });
}

async function waitForQmdDaemonReady(): Promise<boolean> {
  for (let attempt = 0; attempt < QMD_DAEMON_READY_ATTEMPTS; attempt++) {
    if (await qmdDaemonHealthCheck()) return true;
    await new Promise((resolve) => setTimeout(resolve, QMD_DAEMON_READY_DELAY_MS));
  }
  return false;
}

async function ensureQmdDaemon(): Promise<boolean> {
  if (qmdDaemonHealthy === true) {
    qmdLastDebug = "daemon cached healthy";
    return true;
  }
  if (qmdDaemonEnsurePromise) {
    qmdLastDebug = "daemon ensure already in progress";
    return qmdDaemonEnsurePromise;
  }
  if (Date.now() < qmdDaemonRetryAfter) {
    qmdLastDebug = `daemon retry cooldown until ${new Date(qmdDaemonRetryAfter).toISOString()}`;
    return false;
  }

  qmdDaemonEnsurePromise = (async () => {
    if (await qmdDaemonHealthCheck()) {
      qmdDaemonHealthy = true;
      qmdDaemonRetryAfter = 0;
      qmdLastDebug = "daemon healthy before start";
      return true;
    }

    const started = await startQmdDaemon();
    if (!started) {
      const healthy = await qmdDaemonHealthCheck();
      qmdDaemonHealthy = healthy;
      qmdDaemonRetryAfter = healthy ? 0 : Date.now() + QMD_DAEMON_RETRY_COOLDOWN_MS;
      qmdLastDebug = healthy ? "daemon became healthy after failed start" : qmdLastDebug;
      return healthy;
    }

    const healthy = await waitForQmdDaemonReady();
    qmdDaemonHealthy = healthy;
    qmdDaemonRetryAfter = healthy ? 0 : Date.now() + QMD_DAEMON_RETRY_COOLDOWN_MS;
    qmdLastDebug = healthy ? "daemon healthy after start" : `${qmdLastDebug} | ready check failed`;
    return healthy;
  })().finally(() => {
    qmdDaemonEnsurePromise = null;
  });

  return qmdDaemonEnsurePromise;
}

function qmdHttpSearches(
  mode: "keyword" | "semantic" | "deep",
  query: string,
): Array<{ type: "lex" | "vec"; query: string }> {
  if (mode === "keyword") return [{ type: "lex", query }];
  if (mode === "semantic") return [{ type: "vec", query }];
  return [
    { type: "lex", query },
    { type: "vec", query },
  ];
}

async function runQmdSearchHttp(
  mode: "keyword" | "semantic" | "deep",
  query: string,
  limit: number,
  collection: string,
): Promise<{ results: QmdSearchResult[]; stderr: string; transport: string }> {
  const parsed = (await qmdHttpPostJson(
    "/query",
    {
      searches: qmdHttpSearches(mode, query),
      limit,
      collections: [collection],
    },
    60_000,
  )) as { results?: QmdSearchResult[]; hits?: QmdSearchResult[] } | QmdSearchResult[];

  const results = Array.isArray(parsed) ? parsed : (parsed.results ?? parsed.hits ?? []);
  qmdLastDebug = `http search ok (${collection}, ${mode})`;
  return { results, stderr: "", transport: "http" };
}

async function runQmdSearchCli(
  mode: "keyword" | "semantic" | "deep",
  query: string,
  limit: number,
  collection: string,
): Promise<{ results: QmdSearchResult[]; stderr: string; transport: string }> {
  const subcommand = mode === "keyword" ? "search" : mode === "semantic" ? "vsearch" : "query";
  const args = [subcommand, "--json", "-c", collection, "-n", String(limit), query];

  return await new Promise((resolve, reject) => {
    execFileFn("qmd", args, { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      try {
        const parsed = parseQmdJson(stdout);
        const results = Array.isArray(parsed)
          ? parsed
          : ((parsed as any).results ?? (parsed as any).hits ?? []);
        qmdLastDebug = `cli search ok (${collection}, ${mode})`;
        resolve({ results, stderr: stderr ?? "", transport: "cli" });
      } catch (parseErr) {
        if (parseErr instanceof Error) {
          reject(parseErr);
          return;
        }
        reject(new Error(`Failed to parse qmd output: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

export function detectQmd(): Promise<boolean> {
  return new Promise((resolve) => {
    // qmd doesn't reliably support --version; use a fast command that exits 0 when available.
    execFileFn("qmd", ["status"], { timeout: 5_000 }, (err) => {
      resolve(!err);
    });
  });
}

export function checkCollection(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFileFn("qmd", ["collection", "list", "--json"], { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        resolve(false);
        return;
      }
      try {
        const collections = JSON.parse(stdout);
        if (Array.isArray(collections)) {
          resolve(
            collections.some((entry) => {
              if (typeof entry === "string") return entry === name;
              if (entry && typeof entry === "object" && "name" in entry) {
                return (entry as { name?: string }).name === name;
              }
              return false;
            }),
          );
        } else {
          // qmd may output an object with a collections array or similar
          resolve(stdout.includes(name));
        }
      } catch {
        // Fallback: just check if the name appears in the output
        resolve(stdout.includes(name));
      }
    });
  });
}

/** Search both pi-memory and pi-projects, merge and rank results. */
export async function runQmdSearchAll(
  mode: "keyword" | "semantic" | "deep",
  query: string,
  limit: number,
  collections: string[] = ["pi-memory", "pi-projects", "pi-sessions"],
): Promise<{ results: QmdSearchResult[]; stderr: string; transports: string[]; debug: string[] }> {
  const searches = collections.map((collection) =>
    runQmdSearch(mode, query, limit, collection).then((value) => ({ collection, value })),
  );
  const settled = await Promise.allSettled(searches);
  const combined: QmdSearchResult[] = [];
  let stderr = "";
  const transports: string[] = [];
  const debug: string[] = [];
  for (const entry of settled) {
    if (entry.status === "fulfilled") {
      combined.push(...entry.value.value.results);
      stderr += entry.value.value.stderr;
      transports.push(`${entry.value.collection}:${entry.value.value.transport}`);
      debug.push(`${entry.value.collection}:${entry.value.value.debug}`);
    } else {
      debug.push(entry.reason instanceof Error ? entry.reason.message : String(entry.reason));
    }
  }
  combined.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { results: combined.slice(0, limit), stderr, transports, debug };
}

/** Auto-create the pi-memory collection and path contexts in qmd. */
export async function setupQmdCollection(): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      execFileFn(
        "qmd",
        ["collection", "add", MEMORY_DIR, "--name", "pi-memory"],
        { timeout: 10_000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  } catch {
    // Collection may already exist under a different name — not critical
    return false;
  }

  // Add path contexts (best-effort, ignore errors)
  const contexts: [string, string][] = [
    ["/daily", "Daily append-only work logs organized by date"],
    ["/", "Curated long-term memory: decisions, preferences, facts, lessons"],
  ];
  for (const [ctxPath, desc] of contexts) {
    try {
      await new Promise<void>((resolve, reject) => {
        execFileFn(
          "qmd",
          ["context", "add", ctxPath, desc, "-c", "pi-memory"],
          { timeout: 10_000 },
          (err) => (err ? reject(err) : resolve()),
        );
      });
    } catch {
      // Ignore — context may already exist
    }
  }
  return true;
}

export function scheduleQmdUpdate() {
  if (getQmdUpdateMode() !== "background") return;
  if (!qmdAvailable) return;
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    updateTimer = null;
    execFileFn("qmd", ["update"], { timeout: 30_000 }, () => {});
  }, 500);
}

async function runQmdUpdateNow() {
  if (getQmdUpdateMode() !== "background") return;
  if (!qmdAvailable) return;
  await new Promise<void>((resolve) => {
    execFileFn("qmd", ["update"], { timeout: 30_000 }, () => resolve());
  });
}

interface RelevantMemorySearch {
  text: string;
  hitCount: number;
  files: string[];
  transports: string[];
  debug: string[];
}

/** Search for memories relevant to the user's prompt. Returns formatted markdown or null on error/no results. */
export async function searchRelevantMemories(prompt: string): Promise<RelevantMemorySearch | null> {
  if (!qmdAvailable || !prompt.trim()) return null;

  // Sanitize: strip control chars, limit to 200 chars for the search query
  const sanitized = prompt
    // biome-ignore lint/suspicious/noControlCharactersInRegex: we intentionally strip control chars.
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .trim()
    .slice(0, 200);
  if (!sanitized) return null;

  try {
    const hasCollection = await checkCollection("pi-memory");
    if (!hasCollection) return null;

    const results = await runQmdSearchAll("keyword", sanitized, 3, ["pi-memory", "pi-projects"]);

    if (!results || results.results.length === 0) return null;

    const files = results.results
      .map((r) => getQmdResultPath(r))
      .filter((v): v is string => Boolean(v));
    const snippets = results.results
      .map((r) => {
        const text = getQmdResultText(r);
        if (!text.trim()) return null;
        const filePath = getQmdResultPath(r);
        const filePart = filePath ? `_${filePath}_` : "";
        return filePart ? `${filePart}\n${text.trim()}` : text.trim();
      })
      .filter(Boolean);

    if (snippets.length === 0) return null;
    return {
      text: snippets.join("\n\n---\n\n"),
      hitCount: results.results.length,
      files,
      transports: results.transports,
      debug: results.debug,
    };
  } catch {
    return null;
  }
}

export async function runQmdSearch(
  mode: "keyword" | "semantic" | "deep",
  query: string,
  limit: number,
  collection = "pi-memory",
): Promise<{ results: QmdSearchResult[]; stderr: string; transport: string; debug: string }> {
  if (await ensureQmdDaemon()) {
    try {
      const result = await runQmdSearchHttp(mode, query, limit, collection);
      return { ...result, debug: qmdLastDebug };
    } catch (err) {
      qmdDaemonHealthy = false;
      qmdDaemonRetryAfter = Date.now() + QMD_DAEMON_RETRY_COOLDOWN_MS;
      qmdLastDebug = `http search failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const result = await runQmdSearchCli(mode, query, limit, collection);
  return { ...result, debug: qmdLastDebug };
}

export default function (pi: ExtensionAPI) {
  // --- session_start: detect project + qmd, auto-setup collection ---
  pi.on("session_start", async (_event, ctx) => {
    // Reset project key cache so the first prompt re-detects from the current CWD.
    projectKeyCache = new Map();
    unsubscribeTrackedCwd?.();
    unsubscribeTrackedCwd = onTrackedCwdChange(() => {
      projectKeyCache = new Map();
    });

    capturedUi = ctx.hasUI ? ctx.ui : null;
    updateMemoryWidget();
    qmdDaemonHealthy = null;
    qmdDaemonEnsurePromise = null;
    qmdDaemonRetryAfter = 0;
    qmdAvailable = await detectQmd();
    if (!qmdAvailable) return;

    // Collection setup is best-effort and non-blocking — fire and forget.
    Promise.all([
      checkCollection("pi-memory").then((has) => {
        if (!has) return setupQmdCollection();
      }),
      checkCollection("pi-projects").then((has) => {
        if (!has) return setupProjectsCollection();
      }),
      checkCollection("pi-sessions").then((has) => {
        if (!has) {
          fs.mkdirSync(SESSIONS_INDEX_DIR, { recursive: true });
          return new Promise<void>((resolve) => {
            execFileFn(
              "qmd",
              ["collection", "add", SESSIONS_INDEX_DIR, "--name", "pi-sessions"],
              { timeout: 10_000 },
              () => resolve(),
            );
          });
        }
      }),
    ]).catch(() => {});
  });

  // --- session_shutdown: index session + clean up timer ---
  pi.on("session_shutdown", async (_event, ctx) => {
    capturedUi = null;
    if (updateTimer) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }
    // Extract session to searchable markdown — fast, no LLM.
    const sessionFile = ctx.sessionManager.getSessionFile?.();
    if (sessionFile) {
      try {
        const indexed = await indexSession(sessionFile);
        if (indexed) {
          ensureQmdAvailableForUpdate()
            .then(() => runQmdUpdateNow())
            .catch(() => {});
        }
      } catch (err) {
        // Log failures to help debug
        try {
          fs.appendFileSync(
            path.join(SESSIONS_INDEX_DIR, "errors.log"),
            `${new Date().toISOString()} indexSession error: ${err}\n`,
          );
        } catch {}
      }
    } else {
      try {
        fs.appendFileSync(
          path.join(SESSIONS_INDEX_DIR, "errors.log"),
          `${new Date().toISOString()} session_shutdown: getSessionFile returned undefined\n`,
        );
      } catch {}
    }
  });

  // --- Inject memory context before every agent turn ---
  pi.on("before_agent_start", async (event, _ctx) => {
    // Skip if memory is already injected (e.g. btw side sessions that inherit the main system prompt).
    if (event.systemPrompt.includes("\n## Memory\n")) return;

    const skipSearch = process.env.PI_MEMORY_NO_SEARCH === "1";
    const [searchResults, currentProjectKey] = await Promise.all([
      skipSearch ? Promise.resolve(null) : searchRelevantMemories(event.prompt ?? ""),
      getProjectKey(),
    ]);
    const memoryContext = buildMemoryContext(searchResults?.text, currentProjectKey);
    if (!memoryContext) {
      lastMemoryInjection = null;
      updateMemoryWidget();
      return;
    }

    lastMemoryInjection = {
      at: new Date().toISOString(),
      prompt: event.prompt ?? "",
      memoryContext,
      chars: memoryContext.length,
      sections: (memoryContext.match(/^## /gm) ?? []).length,
      searchHitCount: searchResults?.hitCount ?? 0,
      searchFiles: searchResults?.files ?? [],
      searchChars: searchResults?.text.length ?? 0,
      transports: searchResults?.transports ?? [],
      debug: searchResults?.debug ?? [],
      projectKey: currentProjectKey,
      skippedSearch: skipSearch,
    };
    updateMemoryWidget();

    const memoryInstructions = [
      "\n\n## Memory",
      "The following memory files have been loaded. Use the memory_write tool to persist important information.",
      "- Decisions, preferences, and durable facts \u2192 MEMORY.md",
      "- Day-to-day notes and running context \u2192 daily/<YYYY-MM-DD>.md",
      "- Things to fix later or keep in mind \u2192 scratchpad tool",
      "- Use memory_search to find past context across all memory files (keyword, semantic, or deep search).",
      "- Use #tags (e.g. #decision, #preference) and [[links]] (e.g. [[auth-strategy]]) in memory content to improve future search recall.",
      '- If someone says "remember this," write it immediately.',
      "",
      memoryContext,
    ].join("\n");

    return {
      systemPrompt: event.systemPrompt + memoryInstructions,
    };
  });

  pi.registerCommand("memory-context", {
    description: "Show a summary of the last memory context injected into the prompt.",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const summary = formatLastMemoryInjection(lastMemoryInjection, false);
      ctx.ui.notify(`${summary}\n\nUse /memory-context-full for the full rendered block.`, "info");
    },
  });

  pi.registerCommand("memory-context-full", {
    description: "Show the full last memory context injected into the prompt.",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      ctx.ui.notify(formatLastMemoryInjection(lastMemoryInjection, true), "info");
    },
  });

  // --- Pre-compaction: auto-capture session handoff ---
  pi.on("session_before_compact", async (_event, ctx) => {
    ensureDirs();
    const sid = shortSessionId(ctx.sessionManager.getSessionId());
    const ts = nowTimestamp();
    const parts: string[] = [];

    // Capture open scratchpad items
    const scratchpad = readFileSafe(SCRATCHPAD_FILE);
    if (scratchpad?.trim()) {
      const openItems = parseScratchpad(scratchpad).filter((i) => !i.done);
      if (openItems.length > 0) {
        parts.push("**Open scratchpad items:**");
        for (const item of openItems) {
          parts.push(`- [ ] ${item.text}`);
        }
      }
    }

    // Capture last few lines from today's daily log
    const todayContent = readFileSafe(dailyPath(todayStr()));
    if (todayContent?.trim()) {
      const lines = todayContent.trim().split("\n");
      const tail = lines.slice(-15).join("\n");
      parts.push(`**Recent daily log context:**\n${tail}`);
    }

    if (parts.length === 0) return;

    const handoff = [`<!-- HANDOFF ${ts} [${sid}] -->`, "## Session Handoff", ...parts].join("\n");

    const filePath = dailyPath(todayStr());
    const existing = readFileSafe(filePath) ?? "";
    const separator = existing.trim() ? "\n\n" : "";
    fs.writeFileSync(filePath, existing + separator + handoff, "utf-8");
    await ensureQmdAvailableForUpdate();
    scheduleQmdUpdate();
  });

  // --- memory_write tool ---
  pi.registerTool({
    name: "memory_write",
    label: "Memory Write",
    description: [
      "Write to memory files. Five targets:",
      "- 'long_term': Write to global MEMORY.md (personal prefs, env setup, pi config). Mode: 'append' or 'overwrite'.",
      "- 'project': Write to project-scoped MEMORY.md (architecture, conventions, gotchas for this repo). Mode: 'append' or 'overwrite'.",
      "- 'self': Write to SELF.md — your own learnings, behavioral corrections, patterns to remember about how to work well with Matt.",
      "- 'user': Write to USER.md — observations about Matt as a person: personality, quirks, preferences, communication style, things that matter to him.",
      "- 'daily': Append to today's daily log (daily/<YYYY-MM-DD>.md). Always appends.",
      "Use this proactively — when corrected, when you notice a pattern, when Matt reveals something about himself worth remembering.",
      "Use #tags (e.g. #correction, #quirk, #preference, #lesson) in content to improve searchability.",
    ].join("\n"),
    parameters: Type.Object({
      target: StringEnum(["long_term", "project", "self", "user", "daily"] as const, {
        description: "Where to write",
      }),
      content: Type.String({ description: "Content to write (Markdown)" }),
      mode: Type.Optional(
        StringEnum(["append", "overwrite"] as const, {
          description: "Write mode for long_term target. Default: 'append'. Daily always appends.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ensureDirs();
      const { target, content, mode } = params;
      const sid = shortSessionId(ctx.sessionManager.getSessionId());
      const ts = nowTimestamp();
      const projectKey = target === "project" ? await getProjectKey() : null;

      if (target === "self" || target === "user") {
        const filePath = target === "self" ? SELF_FILE : USER_FILE;
        const label = target === "self" ? "SELF.md" : "USER.md";
        const existing = readFileSafe(filePath) ?? "";
        if (mode === "overwrite") {
          fs.writeFileSync(filePath, `<!-- last updated: ${ts} [${sid}] -->\n${content}`, "utf-8");
        } else {
          const separator = existing.trim() ? "\n\n" : "";
          fs.writeFileSync(
            filePath,
            existing + separator + `<!-- ${ts} [${sid}] -->\n${content}`,
            "utf-8",
          );
        }
        await ensureQmdAvailableForUpdate();
        scheduleQmdUpdate();
        return {
          content: [
            {
              type: "text",
              text: `${mode === "overwrite" ? "Overwrote" : "Appended to"} ${label}`,
            },
          ],
          details: {
            path: filePath,
            target,
            mode: mode ?? "append",
            sessionId: sid,
            timestamp: ts,
          },
        };
      }

      if (target === "daily") {
        const filePath = dailyPath(todayStr());
        const existing = readFileSafe(filePath) ?? "";
        const existingPreview = buildPreview(existing, {
          maxLines: RESPONSE_PREVIEW_MAX_LINES,
          maxChars: RESPONSE_PREVIEW_MAX_CHARS,
          mode: "end",
        });
        const existingSnippet = existingPreview.preview
          ? `\n\n${formatPreviewBlock("Existing daily log preview", existing, "end")}`
          : "\n\nDaily log was empty.";

        const separator = existing.trim() ? "\n\n" : "";
        const stamped = `<!-- ${ts} [${sid}] -->\n${content}`;
        fs.writeFileSync(filePath, existing + separator + stamped, "utf-8");
        await ensureQmdAvailableForUpdate();
        scheduleQmdUpdate();
        return {
          content: [
            {
              type: "text",
              text: `Appended to daily log: ${filePath}${existingSnippet}`,
            },
          ],
          details: {
            path: filePath,
            target,
            mode: "append",
            sessionId: sid,
            timestamp: ts,
            qmdUpdateMode: getQmdUpdateMode(),
            existingPreview,
          },
        };
      }

      if (target === "project") {
        if (!projectKey) {
          return {
            content: [
              {
                type: "text",
                text: "No project detected for this session. Cannot write to project memory.",
              },
            ],
            isError: true,
            details: {},
          };
        }
        const filePath = projectMemoryFile(projectKey);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        // Upsert frontmatter with current hostname → git root.
        const hostname = os.hostname();
        const gitRoot = await getGitRoot();
        const existing = readFileSafe(filePath) ?? "";
        const withFrontmatter = gitRoot
          ? upsertProjectFrontmatter(existing, hostname, gitRoot)
          : existing;

        const existingPreview = buildPreview(withFrontmatter, {
          maxLines: RESPONSE_PREVIEW_MAX_LINES,
          maxChars: RESPONSE_PREVIEW_MAX_CHARS,
          mode: "middle",
        });
        const existingSnippet = existingPreview.preview
          ? `\n\n${formatPreviewBlock("Existing project memory preview", withFrontmatter, "middle")}`
          : "\n\nProject memory was empty.";

        if (mode === "overwrite") {
          const stamped = `<!-- last updated: ${ts} [${sid}] -->\n${content}`;
          // Re-apply frontmatter on top of the new content.
          const final = gitRoot ? upsertProjectFrontmatter(stamped, hostname, gitRoot) : stamped;
          fs.writeFileSync(filePath, final, "utf-8");
          await ensureQmdAvailableForUpdate();
          scheduleQmdUpdate();
          return {
            content: [
              { type: "text", text: `Overwrote project memory: ${filePath}${existingSnippet}` },
            ],
            details: {
              path: filePath,
              target,
              mode: "overwrite",
              projectKey,
              sessionId: sid,
              timestamp: ts,
            },
          };
        }
        // append (default)
        const body = stripFrontmatter(withFrontmatter);
        const separator = body.trim() ? "\n\n" : "";
        const stamped = `<!-- ${ts} [${sid}] -->\n${content}`;
        const newBody = body + separator + stamped;
        const final = gitRoot ? upsertProjectFrontmatter(newBody, hostname, gitRoot) : newBody;
        fs.writeFileSync(filePath, final, "utf-8");
        await ensureQmdAvailableForUpdate();
        scheduleQmdUpdate();
        return {
          content: [
            { type: "text", text: `Appended to project memory: ${filePath}${existingSnippet}` },
          ],
          details: {
            path: filePath,
            target,
            mode: "append",
            projectKey,
            sessionId: sid,
            timestamp: ts,
          },
        };
      }

      // long_term
      const existing = readFileSafe(MEMORY_FILE) ?? "";
      const existingPreview = buildPreview(existing, {
        maxLines: RESPONSE_PREVIEW_MAX_LINES,
        maxChars: RESPONSE_PREVIEW_MAX_CHARS,
        mode: "middle",
      });
      const existingSnippet = existingPreview.preview
        ? `\n\n${formatPreviewBlock("Existing MEMORY.md preview", existing, "middle")}`
        : "\n\nMEMORY.md was empty.";

      if (mode === "overwrite") {
        const stamped = `<!-- last updated: ${ts} [${sid}] -->\n${content}`;
        fs.writeFileSync(MEMORY_FILE, stamped, "utf-8");
        await ensureQmdAvailableForUpdate();
        scheduleQmdUpdate();
        return {
          content: [{ type: "text", text: `Overwrote MEMORY.md${existingSnippet}` }],
          details: {
            path: MEMORY_FILE,
            target,
            mode: "overwrite",
            sessionId: sid,
            timestamp: ts,
            qmdUpdateMode: getQmdUpdateMode(),
            existingPreview,
          },
        };
      }

      // append (default)
      const separator = existing.trim() ? "\n\n" : "";
      const stamped = `<!-- ${ts} [${sid}] -->\n${content}`;
      fs.writeFileSync(MEMORY_FILE, existing + separator + stamped, "utf-8");
      await ensureQmdAvailableForUpdate();
      scheduleQmdUpdate();
      return {
        content: [{ type: "text", text: `Appended to MEMORY.md${existingSnippet}` }],
        details: {
          path: MEMORY_FILE,
          target,
          mode: "append",
          sessionId: sid,
          timestamp: ts,
          qmdUpdateMode: getQmdUpdateMode(),
          existingPreview,
        },
      };
    },
  });

  // --- scratchpad tool ---
  pi.registerTool({
    name: "scratchpad",
    label: "Scratchpad",
    description: [
      "Manage a checklist of things to fix later or keep in mind. Actions:",
      "- 'add': Add a new unchecked item (- [ ] text)",
      "- 'done': Mark an item as done (- [x] text). Match by substring.",
      "- 'undo': Uncheck a done item back to open. Match by substring.",
      "- 'clear_done': Remove all checked items from the list.",
      "- 'list': Show all items.",
    ].join("\n"),
    parameters: Type.Object({
      action: StringEnum(["add", "done", "undo", "clear_done", "list"] as const, {
        description: "What to do",
      }),
      text: Type.Optional(
        Type.String({
          description: "Item text for add, or substring to match for done/undo",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ensureDirs();
      const { action, text } = params;
      const sid = shortSessionId(ctx.sessionManager.getSessionId());
      const ts = nowTimestamp();

      const existing = readFileSafe(SCRATCHPAD_FILE) ?? "";
      let items = parseScratchpad(existing);

      if (action === "list") {
        if (items.length === 0) {
          return {
            content: [{ type: "text", text: "Scratchpad is empty." }],
            details: {},
          };
        }
        const serialized = serializeScratchpad(items);
        const preview = buildPreview(serialized, {
          maxLines: RESPONSE_PREVIEW_MAX_LINES,
          maxChars: RESPONSE_PREVIEW_MAX_CHARS,
          mode: "start",
        });
        return {
          content: [
            {
              type: "text",
              text: formatPreviewBlock("Scratchpad preview", serialized, "start"),
            },
          ],
          details: {
            count: items.length,
            open: items.filter((i) => !i.done).length,
            preview,
          },
        };
      }

      if (action === "add") {
        if (!text) {
          return {
            content: [{ type: "text", text: "Error: 'text' is required for add." }],
            details: {},
          };
        }
        items.push({ done: false, text, meta: `<!-- ${ts} [${sid}] -->` });
        const serialized = serializeScratchpad(items);
        const preview = buildPreview(serialized, {
          maxLines: RESPONSE_PREVIEW_MAX_LINES,
          maxChars: RESPONSE_PREVIEW_MAX_CHARS,
          mode: "start",
        });
        fs.writeFileSync(SCRATCHPAD_FILE, serialized, "utf-8");
        await ensureQmdAvailableForUpdate();
        scheduleQmdUpdate();
        return {
          content: [
            {
              type: "text",
              text: `Added: - [ ] ${text}\n\n${formatPreviewBlock("Scratchpad preview", serialized, "start")}`,
            },
          ],
          details: {
            action,
            sessionId: sid,
            timestamp: ts,
            qmdUpdateMode: getQmdUpdateMode(),
            preview,
          },
        };
      }

      if (action === "done" || action === "undo") {
        if (!text) {
          return {
            content: [
              {
                type: "text",
                text: `Error: 'text' is required for ${action}.`,
              },
            ],
            details: {},
          };
        }
        const needle = text.toLowerCase();
        const targetDone = action === "done";
        let matched = false;
        for (const item of items) {
          if (item.done !== targetDone && item.text.toLowerCase().includes(needle)) {
            item.done = targetDone;
            matched = true;
            break;
          }
        }
        if (!matched) {
          return {
            content: [
              {
                type: "text",
                text: `No matching ${targetDone ? "open" : "done"} item found for: "${text}"`,
              },
            ],
            details: {},
          };
        }
        const serialized = serializeScratchpad(items);
        const preview = buildPreview(serialized, {
          maxLines: RESPONSE_PREVIEW_MAX_LINES,
          maxChars: RESPONSE_PREVIEW_MAX_CHARS,
          mode: "start",
        });
        fs.writeFileSync(SCRATCHPAD_FILE, serialized, "utf-8");
        await ensureQmdAvailableForUpdate();
        scheduleQmdUpdate();
        return {
          content: [
            {
              type: "text",
              text: `Updated.\n\n${formatPreviewBlock("Scratchpad preview", serialized, "start")}`,
            },
          ],
          details: {
            action,
            sessionId: sid,
            timestamp: ts,
            qmdUpdateMode: getQmdUpdateMode(),
            preview,
          },
        };
      }

      if (action === "clear_done") {
        const before = items.length;
        items = items.filter((i) => !i.done);
        const removed = before - items.length;
        const serialized = serializeScratchpad(items);
        const preview = buildPreview(serialized, {
          maxLines: RESPONSE_PREVIEW_MAX_LINES,
          maxChars: RESPONSE_PREVIEW_MAX_CHARS,
          mode: "start",
        });
        fs.writeFileSync(SCRATCHPAD_FILE, serialized, "utf-8");
        await ensureQmdAvailableForUpdate();
        scheduleQmdUpdate();
        return {
          content: [
            {
              type: "text",
              text: `Cleared ${removed} done item(s).\n\n${formatPreviewBlock("Scratchpad preview", serialized, "start")}`,
            },
          ],
          details: {
            action,
            removed,
            qmdUpdateMode: getQmdUpdateMode(),
            preview,
          },
        };
      }

      return {
        content: [{ type: "text", text: `Unknown action: ${action}` }],
        details: {},
      };
    },
  });

  // --- memory_read tool ---
  pi.registerTool({
    name: "memory_read",
    label: "Memory Read",
    description: [
      "Read a memory file. Targets:",
      "- 'long_term': Read global MEMORY.md",
      "- 'project': Read project-scoped MEMORY.md (current project)",
      "- 'self': Read SELF.md (your learnings and behavioral patterns)",
      "- 'user': Read USER.md (observations about Matt)",
      "- 'scratchpad': Read SCRATCHPAD.md",
      "- 'daily': Read a specific day's log (default: today). Pass date as YYYY-MM-DD.",
      "- 'list': List all daily log files.",
    ].join("\n"),
    parameters: Type.Object({
      target: StringEnum(
        ["long_term", "project", "self", "user", "scratchpad", "daily", "list"] as const,
        {
          description: "What to read",
        },
      ),
      date: Type.Optional(
        Type.String({
          description: "Date for daily log (YYYY-MM-DD). Default: today.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      ensureDirs();
      const { target, date } = params;
      const projectKey = target === "project" ? await getProjectKey() : null;

      if (target === "self" || target === "user") {
        const filePath = target === "self" ? SELF_FILE : USER_FILE;
        const label = target === "self" ? "SELF.md" : "USER.md";
        const content = readFileSafe(filePath);
        if (!content?.trim()) {
          return { content: [{ type: "text", text: `${label} is empty.` }], details: {} };
        }
        return { content: [{ type: "text", text: content }], details: { path: filePath } };
      }

      if (target === "list") {
        try {
          const files = fs
            .readdirSync(DAILY_DIR)
            .filter((f) => f.endsWith(".md"))
            .sort()
            .reverse();
          if (files.length === 0) {
            return {
              content: [{ type: "text", text: "No daily logs found." }],
              details: {},
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `Daily logs:\n${files.map((f) => `- ${f}`).join("\n")}`,
              },
            ],
            details: { files },
          };
        } catch {
          return {
            content: [{ type: "text", text: "No daily logs directory." }],
            details: {},
          };
        }
      }

      if (target === "project") {
        if (!projectKey) {
          return {
            content: [{ type: "text", text: "No project detected for this session." }],
            details: {},
          };
        }
        const filePath = projectMemoryFile(projectKey);
        const content = readFileSafe(filePath);
        if (!content?.trim()) {
          return {
            content: [{ type: "text", text: `No project memory yet for ${projectKey}.` }],
            details: { projectKey, path: filePath },
          };
        }
        return {
          content: [{ type: "text", text: content }],
          details: { projectKey, path: filePath },
        };
      }

      if (target === "daily") {
        const d = date ?? todayStr();
        const filePath = dailyPath(d);
        const content = readFileSafe(filePath);
        if (!content) {
          return {
            content: [{ type: "text", text: `No daily log for ${d}.` }],
            details: {},
          };
        }
        return {
          content: [{ type: "text", text: content }],
          details: { path: filePath, date: d },
        };
      }

      if (target === "scratchpad") {
        const content = readFileSafe(SCRATCHPAD_FILE);
        if (!content?.trim()) {
          return {
            content: [
              {
                type: "text",
                text: "SCRATCHPAD.md is empty or does not exist.",
              },
            ],
            details: {},
          };
        }
        return {
          content: [{ type: "text", text: content }],
          details: { path: SCRATCHPAD_FILE },
        };
      }

      // long_term
      const content = readFileSafe(MEMORY_FILE);
      if (!content) {
        return {
          content: [{ type: "text", text: "MEMORY.md is empty or does not exist." }],
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: content }],
        details: { path: MEMORY_FILE },
      };
    },
  });

  pi.registerTool({
    name: "memory_last_context",
    label: "Memory Last Context",
    description:
      "Show the last memory block injected into the system prompt for this session, with metadata about hits, transports, and the rendered context.",
    parameters: Type.Object({
      full: Type.Optional(
        Type.Boolean({ description: "Include the rendered injected context. Default: true." }),
      ),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [
          {
            type: "text",
            text: formatLastMemoryInjection(lastMemoryInjection, params.full ?? true),
          },
        ],
        details: lastMemoryInjection
          ? {
              at: lastMemoryInjection.at,
              chars: lastMemoryInjection.chars,
              sections: lastMemoryInjection.sections,
              searchHitCount: lastMemoryInjection.searchHitCount,
              searchFiles: uniqStrings(lastMemoryInjection.searchFiles),
              transports: uniqStrings(lastMemoryInjection.transports),
              projectKey: lastMemoryInjection.projectKey,
              skippedSearch: lastMemoryInjection.skippedSearch,
            }
          : {},
      };
    },
  });

  // --- memory_search tool ---
  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description:
      "Search across all memory files (MEMORY.md, SCRATCHPAD.md, daily logs).\n" +
      "Modes:\n" +
      "- 'keyword' (default, ~30ms): Fast BM25 search. Best for specific terms, dates, names, #tags, [[links]].\n" +
      "- 'semantic' (~2s): Meaning-based search. Finds related concepts even with different wording.\n" +
      "- 'deep' (~10s): Hybrid search with reranking. Use when other modes don't find what you need.\n" +
      "If semantic/deep warns about missing embeddings, run `qmd embed` once and retry.\n" +
      "If the first search doesn't find what you need, try rephrasing or switching modes. " +
      "Keyword mode is best for specific terms; semantic mode finds related concepts even with different wording.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      mode: Type.Optional(
        StringEnum(["keyword", "semantic", "deep"] as const, {
          description: "Search mode. Default: 'keyword'.",
        }),
      ),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!qmdAvailable) {
        // Re-check on demand in case qmd was installed after session start.
        qmdAvailable = await detectQmd();
      }

      if (!qmdAvailable) {
        return {
          content: [
            {
              type: "text",
              text: qmdInstallInstructions(),
            },
          ],
          isError: true,
          details: {},
        };
      }

      if (!(await checkCollection("pi-memory"))) {
        await setupQmdCollection();
      }
      if (!(await checkCollection("pi-projects"))) {
        await setupProjectsCollection();
      }

      const mode = params.mode ?? "keyword";
      const limit = params.limit ?? 5;

      try {
        const { results, stderr, transports, debug } = await runQmdSearchAll(
          mode,
          params.query,
          limit,
        );
        const needsEmbed = /need embeddings/i.test(stderr ?? "");

        if (results.length === 0) {
          if (needsEmbed && (mode === "semantic" || mode === "deep")) {
            return {
              content: [
                {
                  type: "text",
                  text: [
                    `No results found for "${params.query}" (mode: ${mode}).`,
                    "",
                    "qmd reports missing vector embeddings for one or more documents.",
                    "Run this once, then retry:",
                    "  qmd embed",
                  ].join("\n"),
                },
              ],
              details: { mode, query: params.query, count: 0, needsEmbed: true, transports, debug },
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `No results found for "${params.query}" (mode: ${mode}).`,
              },
            ],
            details: { mode, query: params.query, count: 0, needsEmbed, transports, debug },
          };
        }

        const formatted = results
          .map((r, i) => {
            const parts: string[] = [`### Result ${i + 1}`];
            const filePath = getQmdResultPath(r);
            if (filePath) parts.push(`**File:** ${filePath}`);
            if (r.score != null) parts.push(`**Score:** ${r.score}`);
            const text = getQmdResultText(r);
            if (text) parts.push(`\n${text}`);
            return parts.join("\n");
          })
          .join("\n\n---\n\n");

        return {
          content: [{ type: "text", text: formatted }],
          details: {
            mode,
            query: params.query,
            count: results.length,
            needsEmbed,
            transports,
            debug,
          },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `memory_search error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
          details: {},
        };
      }
    },
  });
}
