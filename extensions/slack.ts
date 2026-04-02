import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { execFileSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { snappyUncompress } from "hysnappy";

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_USER_LOOKUP_LIMIT = 10;
const DEFAULT_CHANNEL_HISTORY_LIMIT = 100;
const MAX_SEARCH_LIMIT = 20;
const MAX_USER_LOOKUP_LIMIT = 20;
const MAX_CHANNEL_HISTORY_LIMIT = 200;
const SEARCH_PAGE_SIZE = 20;
const USER_AGENT = "pi-slack-extension/0.1";
const GLOBAL_SETTINGS_PATH = path.join(os.homedir(), ".pi", "agent", "settings.json");
const PROJECT_SETTINGS_PATH = path.join(".pi", "settings.json");
const LEVELDB_MAGIC = Buffer.from([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]);
const COMPRESSION_NONE = 0;
const COMPRESSION_SNAPPY = 1;
const LOG_RECORD_FULL = 1;
const LOG_RECORD_FIRST = 2;
const LOG_RECORD_MIDDLE = 3;
const LOG_RECORD_LAST = 4;

type SlackAuth = {
  kind: "browser";
  token: string;
  cookieD: string;
};

type SlackDesktopTeam = {
  url: string;
  name?: string;
  token: string;
};

type SlackDesktopCredentials = {
  cookieD: string;
  teams: SlackDesktopTeam[];
  source: {
    leveldbPath: string;
    cookiesPath: string;
  };
};

type SlackMessageRef = {
  workspaceUrl: string;
  channelId: string;
  messageTs: string;
  threadTsHint?: string;
  raw: string;
};

type SlackFileSummary = {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  mode?: string;
  permalink?: string;
  urlPrivate?: string;
  urlPrivateDownload?: string;
  size?: number;
  snippetContent?: string;
  snippetLanguage?: string;
};

type SlackMessage = {
  workspaceUrl: string;
  channelId: string;
  ts: string;
  threadTs?: string;
  replyCount?: number;
  userId?: string;
  username?: string;
  botId?: string;
  text: string;
  permalink: string;
  files: SlackFileSummary[];
  raw: Record<string, unknown>;
};

type SlackUser = {
  id: string;
  name?: string;
  displayName?: string;
  realName?: string;
  email?: string;
  title?: string;
  isBot?: boolean;
  deleted?: boolean;
  raw: Record<string, unknown>;
};

type SlackSearchMode = "messages" | "threads";
type SlackReadMode = "message" | "thread";
type SlackOutputFormat = "markdown" | "json";

type SlackSearchResult = {
  searchQuery: string;
  mode: SlackSearchMode;
  count: number;
  text: string;
  details: Record<string, unknown>;
};

type SlackReadResult = {
  mode: SlackReadMode;
  text: string;
  details: Record<string, unknown>;
};

type SlackReplyResult = {
  text: string;
  details: Record<string, unknown>;
};

type SlackUserLookupResult = {
  text: string;
  details: Record<string, unknown>;
};

type SlackChannelHistoryResult = {
  text: string;
  details: Record<string, unknown>;
};

type SearchRawMatch = Record<string, unknown>;

type ToolExecutionOptions = {
  signal?: AbortSignal;
  cwd?: string;
};

type LevelDBEntry = {
  key: Buffer;
  value: Buffer;
};

const userNameCache = new Map<string, string>();
const channelNameCache = new Map<string, string>();
let cachedDesktopCredentialsPromise: Promise<SlackDesktopCredentials> | undefined;
const cachedWorkspaceAuth = new Map<string, Promise<SlackAuth>>();

const OutputFormatParam = Type.Optional(
  Type.Union([
    Type.Literal("markdown", { description: "Return markdown with YAML frontmatter metadata." }),
    Type.Literal("json", { description: "Return raw JSON-oriented output instead of markdown." }),
  ]),
);

const SlackReadParams = Type.Object({
  url: Type.Optional(
    Type.String({
      description:
        "Slack message URL. Example: 'https://workspace.slack.com/archives/C123/p1775000000000000'.",
    }),
  ),
  channel: Type.Optional(
    Type.String({
      description: "Channel name like '#general' or a channel ID like 'C123...'.",
    }),
  ),
  ts: Type.Optional(
    Type.String({
      description:
        "Message timestamp when reading by channel instead of URL. Format: '1775000000.123456'.",
    }),
  ),
  mode: Type.Optional(
    Type.Union([
      Type.Literal("message", { description: "Read just the target message." }),
      Type.Literal("thread", { description: "Read the full thread context." }),
    ]),
  ),
  format: OutputFormatParam,
});

const SlackSearchParams = Type.Object({
  query: Type.String({
    description: "Search query for Slack messages.",
  }),
  channel: Type.Optional(
    Type.String({
      description: "Optional channel filter like '#general' or 'general'.",
    }),
  ),
  from: Type.Optional(
    Type.String({
      description: "Optional sender filter like '@matt', 'matt', or a Slack user ID.",
    }),
  ),
  after: Type.Optional(
    Type.String({
      description: "Optional lower date bound in YYYY-MM-DD format.",
    }),
  ),
  before: Type.Optional(
    Type.String({
      description: "Optional upper date bound in YYYY-MM-DD format.",
    }),
  ),
  mode: Type.Optional(
    Type.Union([
      Type.Literal("messages", { description: "Return matching messages." }),
      Type.Literal("threads", { description: "Expand matches into full threads." }),
    ]),
  ),
  limit: Type.Optional(
    Type.Number({
      description: `Maximum number of results to return. Defaults to ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}.`,
      minimum: 1,
      maximum: MAX_SEARCH_LIMIT,
    }),
  ),
  format: OutputFormatParam,
});

const SlackReplyParams = Type.Object({
  url: Type.Optional(
    Type.String({
      description: "Slack message URL to reply to. Replies always go to the thread root.",
    }),
  ),
  channel: Type.Optional(
    Type.String({
      description: "Channel name or ID when replying without a URL.",
    }),
  ),
  threadTs: Type.Optional(
    Type.String({
      description:
        "Thread root timestamp when replying by channel instead of URL. Format: '1775000000.123456'.",
    }),
  ),
  text: Type.String({
    description: "Reply text to post.",
  }),
  dryRun: Type.Optional(
    Type.Boolean({
      description:
        "If true, resolve auth and the reply target but do not actually send the message.",
    }),
  ),
  format: OutputFormatParam,
});

const SlackUserLookupParams = Type.Object({
  query: Type.String({
    description: "Lookup by Slack user ID, handle, display name, real name, or email.",
  }),
  includeBots: Type.Optional(
    Type.Boolean({
      description: "Include bot users in results.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: `Maximum number of users to return. Defaults to ${DEFAULT_USER_LOOKUP_LIMIT}, max ${MAX_USER_LOOKUP_LIMIT}.`,
      minimum: 1,
      maximum: MAX_USER_LOOKUP_LIMIT,
    }),
  ),
  format: OutputFormatParam,
});

const SlackChannelHistoryParams = Type.Object({
  channel: Type.String({
    description: "Channel name like '#general' or a channel ID like 'C123...'.",
  }),
  oldest: Type.Optional(
    Type.String({
      description:
        "Exclusive lower timestamp bound. Pass the previous result's nextOldest to page forward chronologically. Format: '1775000000.123456'.",
    }),
  ),
  latest: Type.Optional(
    Type.String({
      description: "Optional upper timestamp bound. Format: '1775000000.123456'.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: `Maximum number of channel messages to return. Defaults to ${DEFAULT_CHANNEL_HISTORY_LIMIT}, max ${MAX_CHANNEL_HISTORY_LIMIT}.`,
      minimum: 1,
      maximum: MAX_CHANNEL_HISTORY_LIMIT,
    }),
  ),
  format: OutputFormatParam,
});

type SlackReadInput = Static<typeof SlackReadParams>;
type SlackSearchInput = Static<typeof SlackSearchParams>;
type SlackReplyInput = Static<typeof SlackReplyParams>;
type SlackUserLookupInput = Static<typeof SlackUserLookupParams>;
type SlackChannelHistoryInput = Static<typeof SlackChannelHistoryParams>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getOutputFormat(value: unknown): SlackOutputFormat {
  return value === "json" ? "json" : "markdown";
}

function renderMarkdownDocument(
  frontmatter: Record<string, string | number | boolean | undefined>,
  body: string,
): string {
  const lines = Object.entries(frontmatter)
    .filter(([, value]) => value !== undefined)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}`,
    );
  const trimmedBody = body.trim();
  return trimmedBody.length > 0
    ? [`---`, ...lines, `---`, ``, trimmedBody].join("\n")
    : [`---`, ...lines, `---`].join("\n");
}

function renderJsonDocument(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function summarizeSlackFiles(files: SlackFileSummary[]): Record<string, unknown>[] {
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    title: file.title,
    mimetype: file.mimetype,
    filetype: file.filetype,
    mode: file.mode,
    permalink: file.permalink,
    urlPrivate: file.urlPrivate,
    urlPrivateDownload: file.urlPrivateDownload,
    size: file.size,
    snippetContent: file.snippetContent,
    snippetLanguage: file.snippetLanguage,
  }));
}

function validateTs(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!/^\d{6,}\.\d{6}$/.test(trimmed)) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return trimmed;
}

function validateDate(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`Invalid date: ${value} (expected YYYY-MM-DD)`);
  }
  return trimmed;
}

function truncateForModel(text: string) {
  const truncated = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  return {
    text: truncated.content,
    truncated: truncated.truncated,
  };
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").split("\u0000").join("").trim();
}

function clipText(text: string, maxChars: number): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function formatTimestamp(ts: string): string {
  const millis = Number.parseFloat(ts) * 1000;
  if (!Number.isFinite(millis)) return ts;
  return new Date(millis).toISOString();
}

function normalizeWorkspaceUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

function tsToPermalinkId(ts: string): string {
  const [seconds, micros = ""] = ts.split(".");
  return `p${seconds}${micros.padEnd(6, "0").slice(0, 6)}`;
}

function buildSlackPermalink(workspaceUrl: string, channelId: string, ts: string): string {
  return `${normalizeWorkspaceUrl(workspaceUrl)}/archives/${channelId}/${tsToPermalinkId(ts)}`;
}

function parseSlackMessageUrl(input: string): SlackMessageRef {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid Slack URL: ${input}`);
  }

  if (!/\.slack\.com$/i.test(url.hostname)) {
    throw new Error(`Not a Slack workspace URL: ${url.hostname}`);
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "archives") {
    throw new Error(`Unsupported Slack URL path: ${url.pathname}`);
  }

  const channelId = parts[1]!;
  const messagePart = parts[2]!;
  const match = messagePart.match(/^p(\d{7,})$/);
  if (!match) {
    throw new Error(`Unsupported Slack message id: ${messagePart}`);
  }

  const digits = match[1]!;
  const seconds = digits.slice(0, -6);
  const micros = digits.slice(-6);
  const threadTsHint = url.searchParams.get("thread_ts") ?? undefined;

  return {
    workspaceUrl: `${url.protocol}//${url.host}`,
    channelId,
    messageTs: `${seconds}.${micros}`,
    threadTsHint: threadTsHint && /^\d{6,}\.\d{6}$/.test(threadTsHint) ? threadTsHint : undefined,
    raw: input,
  };
}

function isChannelId(input: string): boolean {
  return /^[CDG][A-Z0-9]{8,}$/.test(input.trim());
}

async function readJsonIfExists(filePath: string): Promise<unknown> {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse JSON at ${filePath}: ${errorMessage(error)}`);
  }
}

async function getConfiguredWorkspaceUrl(cwd?: string): Promise<string> {
  const globalSettings = await readJsonIfExists(GLOBAL_SETTINGS_PATH);
  const projectSettingsPath = cwd ? path.join(cwd, PROJECT_SETTINGS_PATH) : undefined;
  const projectSettings = projectSettingsPath
    ? await readJsonIfExists(projectSettingsPath)
    : undefined;

  const workspaceUrl =
    getString(
      isRecord(projectSettings) && isRecord(projectSettings.slack)
        ? projectSettings.slack.workspaceUrl
        : undefined,
    ) ??
    getString(
      isRecord(globalSettings) && isRecord(globalSettings.slack)
        ? globalSettings.slack.workspaceUrl
        : undefined,
    );

  if (!workspaceUrl) {
    throw new Error(
      `Slack workspace URL is not configured. Add { "slack": { "workspaceUrl": "https://your-workspace.slack.com" } } to ${GLOBAL_SETTINGS_PATH}${projectSettingsPath ? ` or ${projectSettingsPath}` : ""}.`,
    );
  }

  return normalizeWorkspaceUrl(workspaceUrl);
}

async function getSlackAuth(workspaceUrl: string, signal?: AbortSignal): Promise<SlackAuth> {
  const normalizedWorkspaceUrl = normalizeWorkspaceUrl(workspaceUrl);
  const cached = cachedWorkspaceAuth.get(normalizedWorkspaceUrl);
  if (cached) return cached;

  const promise = loadSlackAuth(normalizedWorkspaceUrl, signal).catch((error) => {
    cachedWorkspaceAuth.delete(normalizedWorkspaceUrl);
    throw error;
  });
  cachedWorkspaceAuth.set(normalizedWorkspaceUrl, promise);
  return promise;
}

async function loadSlackAuth(workspaceUrl: string, signal?: AbortSignal): Promise<SlackAuth> {
  if (process.platform !== "darwin") {
    throw new Error("Slack desktop auth currently only supports macOS Slack.app.");
  }

  cachedDesktopCredentialsPromise ??= extractSlackDesktopCredentials().catch((error) => {
    cachedDesktopCredentialsPromise = undefined;
    throw error;
  });

  const desktop = await cachedDesktopCredentialsPromise;
  const team = desktop.teams.find(
    (candidate) => normalizeWorkspaceUrl(candidate.url) === workspaceUrl,
  );
  if (!team) {
    const knownWorkspaces = desktop.teams
      .map((candidate) => normalizeWorkspaceUrl(candidate.url))
      .sort()
      .join(", ");
    throw new Error(
      `Slack desktop auth does not contain a token for ${workspaceUrl}. Known workspaces: ${knownWorkspaces || "none"}`,
    );
  }

  const auth: SlackAuth = {
    kind: "browser",
    token: team.token,
    cookieD: desktop.cookieD,
  };

  await slackApiCall(
    "auth.test",
    {},
    {
      auth,
      workspaceUrl,
      signal,
    },
  );

  return auth;
}

async function extractSlackDesktopCredentials(): Promise<SlackDesktopCredentials> {
  const candidates = getSlackDesktopCandidates();
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const teams = await extractTeamsFromSlackLevelDb(candidate.leveldbDir);
      const cookieD = extractSlackCookieD(candidate.cookiesPath);
      return {
        cookieD,
        teams,
        source: {
          leveldbPath: candidate.leveldbDir,
          cookiesPath: candidate.cookiesPath,
        },
      };
    } catch (error) {
      errors.push(`${candidate.baseDir}: ${errorMessage(error)}`);
    }
  }

  throw new Error(
    `Could not extract Slack Desktop credentials from Slack.app:\n  - ${errors.join("\n  - ")}`,
  );
}

function getSlackDesktopCandidates(): Array<{
  baseDir: string;
  leveldbDir: string;
  cookiesPath: string;
}> {
  const home = os.homedir();
  const bases = [
    path.join(home, "Library", "Application Support", "Slack"),
    path.join(
      home,
      "Library",
      "Containers",
      "com.tinyspeck.slackmacgap",
      "Data",
      "Library",
      "Application Support",
      "Slack",
    ),
  ];

  const candidates = bases
    .map((baseDir) => {
      const leveldbDir = path.join(baseDir, "Local Storage", "leveldb");
      const cookiesPath = [
        path.join(baseDir, "Network", "Cookies"),
        path.join(baseDir, "Cookies"),
      ].find((candidate) => existsSync(candidate));
      return cookiesPath && existsSync(leveldbDir)
        ? { baseDir, leveldbDir, cookiesPath }
        : undefined;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  if (!candidates.length) {
    throw new Error("Slack Desktop data not found in the standard Slack.app locations.");
  }

  return candidates;
}

async function snapshotLevelDb(srcDir: string): Promise<string> {
  const base = path.join(os.tmpdir(), "pi-slack-leveldb-snapshots");
  const dest = path.join(base, `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await fs.mkdir(base, { recursive: true });

  let copied = false;
  try {
    execFileSync("cp", ["-cR", srcDir, dest], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    copied = true;
  } catch {
    // fall through
  }

  if (!copied) {
    await fs.cp(srcDir, dest, { recursive: true, force: true });
  }

  try {
    await fs.unlink(path.join(dest, "LOCK"));
  } catch {
    // ignore
  }

  return dest;
}

function parseLocalConfig(raw: Buffer): unknown {
  if (raw.length === 0) {
    throw new Error("localConfig is empty");
  }

  const data = raw[0] === 0x00 || raw[0] === 0x01 || raw[0] === 0x02 ? raw.subarray(1) : raw;
  const nulCount = [...data].filter((byte) => byte === 0).length;
  const encodings: BufferEncoding[] =
    nulCount > data.length / 4 ? ["utf16le", "utf8"] : ["utf8", "utf16le"];

  let lastError: unknown;
  for (const encoding of encodings) {
    try {
      const text = data.toString(encoding);
      try {
        return JSON.parse(text);
      } catch (error) {
        lastError = error;
      }

      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch (error) {
          lastError = error;
        }
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("localConfig not parseable");
}

function toSlackDesktopTeam(value: unknown): SlackDesktopTeam | null {
  if (!isRecord(value)) return null;
  const url = getString(value.url);
  const token = getString(value.token);
  if (!url || !token) return null;
  return {
    url,
    name: getString(value.name),
    token,
  };
}

async function extractTeamsFromSlackLevelDb(leveldbDir: string): Promise<SlackDesktopTeam[]> {
  const snapshotDir = await snapshotLevelDb(leveldbDir);
  try {
    const entries = await findKeysContaining(snapshotDir, Buffer.from("localConfig_v"));
    const localConfigV2 = Buffer.from("localConfig_v2");
    const localConfigV3 = Buffer.from("localConfig_v3");

    let configBuffer: Buffer | undefined;
    let configRank = -1n;

    for (const entry of entries) {
      if (!entry.value.length) continue;
      if (!entry.key.includes(localConfigV2) && !entry.key.includes(localConfigV3)) continue;

      let rank = 0n;
      if (entry.key.length >= 8) {
        rank = entry.key.readBigUInt64LE(entry.key.length - 8);
      }
      if (!configBuffer || rank >= configRank) {
        configBuffer = entry.value;
        configRank = rank;
      }
    }

    if (!configBuffer) {
      throw new Error("Slack LevelDB did not contain localConfig_v2/v3");
    }

    const parsed = parseLocalConfig(configBuffer);
    const teamsObject = isRecord(parsed) && isRecord(parsed.teams) ? parsed.teams : {};
    const teams = Object.values(teamsObject)
      .map((value) => toSlackDesktopTeam(value))
      .filter((team): team is SlackDesktopTeam => Boolean(team))
      .filter((team) => team.token.startsWith("xoxc-"));

    if (!teams.length) {
      throw new Error("No xoxc tokens found in Slack localConfig");
    }

    return teams;
  } finally {
    await fs.rm(snapshotDir, { recursive: true, force: true }).catch(() => {});
  }
}

function extractSlackCookieD(cookiesPath: string): string {
  const sql = [
    "select host_key, value, hex(encrypted_value)",
    "from cookies",
    "where name = 'd' and host_key like '%slack.com'",
    "order by length(encrypted_value) desc, length(value) desc",
  ].join(" ");

  let output: string;
  try {
    output = execFileSync("sqlite3", ["-separator", "\t", cookiesPath, sql], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`Failed to read Slack cookies DB: ${errorMessage(error)}`);
  }

  const rows = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hostKey = "", value = "", encryptedHex = ""] = line.split("\t");
      return { hostKey, value, encryptedHex };
    });

  if (!rows.length) {
    throw new Error(`No Slack 'd' cookie found in ${cookiesPath}`);
  }

  for (const row of rows) {
    if (row.value.startsWith("xoxd-")) {
      return row.value;
    }

    if (!row.encryptedHex) continue;
    const encrypted = Buffer.from(row.encryptedHex, "hex");
    const prefix = encrypted.subarray(0, 3).toString("utf8");
    const data = prefix === "v10" || prefix === "v11" ? encrypted.subarray(3) : encrypted;

    for (const password of getSlackSafeStoragePasswords()) {
      try {
        const decrypted = decryptChromiumCookieValue(data, password, 1003);
        const match = decrypted.match(/xoxd-[A-Za-z0-9%/+_=.-]+/);
        if (!match?.[0]) continue;
        try {
          return decodeURIComponent(match[0]);
        } catch {
          return match[0];
        }
      } catch {
        // keep trying
      }
    }
  }

  throw new Error(`Could not decrypt Slack 'd' cookie from ${cookiesPath}`);
}

function getSlackSafeStoragePasswords(): string[] {
  const queries: Array<{ service: string; account?: string }> = [
    { service: "Slack Safe Storage", account: "Slack Key" },
    { service: "Slack Safe Storage", account: "Slack App Store Key" },
    { service: "Slack Safe Storage" },
    { service: "Chrome Safe Storage" },
    { service: "Chromium Safe Storage" },
  ];

  const passwords = new Set<string>();
  for (const query of queries) {
    try {
      const args = ["find-generic-password", "-w", "-s", query.service];
      if (query.account) args.push("-a", query.account);
      const password = execFileSync("security", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (password) passwords.add(password);
    } catch {
      // keep going
    }
  }

  if (!passwords.size) {
    throw new Error("Could not read Slack Safe Storage password from Keychain.");
  }

  return [...passwords];
}

function decryptChromiumCookieValue(data: Buffer, password: string, iterations: number): string {
  const salt = Buffer.from("saltysalt", "utf8");
  const iv = Buffer.alloc(16, " ");
  const key = pbkdf2Sync(password, salt, iterations, 16, "sha1");
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function readVarint(buf: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < buf.length) {
    const byte = buf[offset + bytesRead]!;
    bytesRead++;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return [result, bytesRead];
    }
    shift += 7;
    if (shift >= 35) {
      throw new Error("Varint too long");
    }
  }

  throw new Error("Unexpected end of buffer reading varint");
}

function readVarint64(buf: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < buf.length && bytesRead < 10) {
    const byte = buf[offset + bytesRead]!;
    bytesRead++;
    if (shift < 32) {
      result |= (byte & 0x7f) << shift;
    }
    if ((byte & 0x80) === 0) {
      return [result >>> 0, bytesRead];
    }
    shift += 7;
  }

  throw new Error("Unexpected end of buffer reading varint64");
}

function getSnappyUncompressedLength(compressed: Buffer): number {
  const [length] = readVarint(compressed, 0);
  return length;
}

function parseBlockHandle(
  buf: Buffer,
  offset: number,
): { offset: number; size: number; bytesRead: number } {
  const [blockOffset, firstBytes] = readVarint64(buf, offset);
  const [blockSize, secondBytes] = readVarint64(buf, offset + firstBytes);
  return {
    offset: blockOffset,
    size: blockSize,
    bytesRead: firstBytes + secondBytes,
  };
}

function decompressBlock(blockData: Buffer, compressionType: number): Buffer {
  if (compressionType === COMPRESSION_NONE) {
    return blockData;
  }
  if (compressionType === COMPRESSION_SNAPPY) {
    const uncompressedLength = getSnappyUncompressedLength(blockData);
    return Buffer.from(snappyUncompress(blockData, uncompressedLength));
  }
  throw new Error(`Unknown compression type: ${compressionType}`);
}

function parseDataBlock(block: Buffer): LevelDBEntry[] {
  const entries: LevelDBEntry[] = [];
  if (block.length < 4) return entries;

  const numRestarts = block.readUInt32LE(block.length - 4);
  const restartsStart = block.length - 4 - numRestarts * 4;
  if (restartsStart < 0) return entries;

  let offset = 0;
  let previousKey = Buffer.alloc(0);

  while (offset < restartsStart) {
    try {
      const [shared, sharedBytes] = readVarint(block, offset);
      offset += sharedBytes;
      const [nonShared, nonSharedBytes] = readVarint(block, offset);
      offset += nonSharedBytes;
      const [valueLength, valueLengthBytes] = readVarint(block, offset);
      offset += valueLengthBytes;

      if (offset + nonShared + valueLength > restartsStart) {
        break;
      }

      const keyDelta = block.subarray(offset, offset + nonShared);
      offset += nonShared;
      const key = Buffer.concat([previousKey.subarray(0, shared), keyDelta]);
      const value = block.subarray(offset, offset + valueLength);
      offset += valueLength;

      entries.push({ key: Buffer.from(key), value: Buffer.from(value) });
      previousKey = key;
    } catch {
      break;
    }
  }

  return entries;
}

async function parseSSTable(filePath: string): Promise<LevelDBEntry[]> {
  let data: Buffer;
  try {
    data = await fs.readFile(filePath);
  } catch {
    return [];
  }

  if (data.length < 48) return [];
  const footer = data.subarray(-48);
  if (!footer.subarray(40, 48).equals(LEVELDB_MAGIC)) {
    return [];
  }

  try {
    const { bytesRead: metaBytes } = parseBlockHandle(footer, 0);
    const indexHandle = parseBlockHandle(footer, metaBytes);
    const indexBlockStart = indexHandle.offset;
    const indexBlockEnd = indexHandle.offset + indexHandle.size + 5;
    if (indexBlockEnd > data.length - 48) return [];

    const indexBlockRaw = data.subarray(indexBlockStart, indexBlockEnd);
    const indexCompressionType = indexBlockRaw.at(-5)!;
    const indexBlock = decompressBlock(indexBlockRaw.subarray(0, -5), indexCompressionType);
    const indexEntries = parseDataBlock(indexBlock);

    const entries: LevelDBEntry[] = [];
    for (const entry of indexEntries) {
      try {
        const blockHandle = parseBlockHandle(entry.value, 0);
        const blockStart = blockHandle.offset;
        const blockEnd = blockHandle.offset + blockHandle.size + 5;
        if (blockEnd > data.length) continue;
        const blockRaw = data.subarray(blockStart, blockEnd);
        const compressionType = blockRaw.at(-5)!;
        const block = decompressBlock(blockRaw.subarray(0, -5), compressionType);
        entries.push(...parseDataBlock(block));
      } catch {
        // ignore malformed blocks
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function parseLogBatch(batch: Buffer, entries: LevelDBEntry[]): void {
  if (batch.length < 12) return;
  let offset = 12;

  while (offset < batch.length) {
    try {
      const recordType = batch[offset]!;
      offset += 1;
      if (recordType === 1) {
        const [keyLength, keyLengthBytes] = readVarint(batch, offset);
        offset += keyLengthBytes;
        const key = batch.subarray(offset, offset + keyLength);
        offset += keyLength;
        const [valueLength, valueLengthBytes] = readVarint(batch, offset);
        offset += valueLengthBytes;
        const value = batch.subarray(offset, offset + valueLength);
        offset += valueLength;
        entries.push({ key: Buffer.from(key), value: Buffer.from(value) });
      } else if (recordType === 0) {
        const [keyLength, keyLengthBytes] = readVarint(batch, offset);
        offset += keyLengthBytes + keyLength;
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

async function parseLogFile(filePath: string): Promise<LevelDBEntry[]> {
  let data: Buffer;
  try {
    data = await fs.readFile(filePath);
  } catch {
    return [];
  }

  const blockSize = 32768;
  const entries: LevelDBEntry[] = [];
  let offset = 0;
  let pendingRecord: Buffer[] = [];

  while (offset < data.length) {
    const blockOffset = offset % blockSize;
    const remaining = blockSize - blockOffset;
    if (remaining < 7) {
      offset += remaining;
      continue;
    }
    if (offset + 7 > data.length) break;

    const length = data.readUInt16LE(offset + 4);
    const type = data[offset + 6]!;

    if (length === 0 || offset + 7 + length > data.length) {
      offset += remaining;
      pendingRecord = [];
      continue;
    }

    const recordData = data.subarray(offset + 7, offset + 7 + length);
    offset += 7 + length;

    if (type === LOG_RECORD_FULL) {
      pendingRecord = [];
      parseLogBatch(recordData, entries);
    } else if (type === LOG_RECORD_FIRST) {
      pendingRecord = [recordData];
    } else if (type === LOG_RECORD_MIDDLE) {
      if (pendingRecord.length) pendingRecord.push(recordData);
    } else if (type === LOG_RECORD_LAST) {
      if (pendingRecord.length) {
        pendingRecord.push(recordData);
        parseLogBatch(Buffer.concat(pendingRecord), entries);
      }
      pendingRecord = [];
    }
  }

  return entries;
}

async function readChromiumLevelDB(dir: string): Promise<LevelDBEntry[]> {
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const entries: LevelDBEntry[] = [];
  for (const file of files.filter((name) => name.endsWith(".ldb") || name.endsWith(".sst"))) {
    entries.push(...(await parseSSTable(path.join(dir, file))));
  }
  for (const file of files.filter((name) => name.endsWith(".log"))) {
    entries.push(...(await parseLogFile(path.join(dir, file))));
  }
  return entries;
}

async function findKeysContaining(dir: string, substring: Buffer): Promise<LevelDBEntry[]> {
  const entries = await readChromiumLevelDB(dir);
  return entries.filter((entry) => entry.key.includes(substring));
}

async function slackApiCall(
  method: string,
  params: Record<string, unknown>,
  input: { auth?: SlackAuth; workspaceUrl: string; signal?: AbortSignal; attempt?: number },
): Promise<Record<string, unknown>> {
  const workspaceUrl = normalizeWorkspaceUrl(input.workspaceUrl);
  const auth = input.auth ?? (await getSlackAuth(workspaceUrl, input.signal));
  const attempt = input.attempt ?? 0;

  const formData = new URLSearchParams({ token: auth.token });
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    formData.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }

  const response = await fetch(`${workspaceUrl}/api/${method}`, {
    method: "POST",
    headers: {
      Cookie: `d=${encodeURIComponent(auth.cookieD)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://app.slack.com",
      Referer: "https://app.slack.com/",
      "User-Agent": USER_AGENT,
    },
    body: formData,
    signal: input.signal,
  });

  if (response.status === 429 && attempt < 3) {
    const retryAfter = Number(response.headers.get("Retry-After") ?? "5");
    await delay(Math.min(Math.max(retryAfter, 1) * 1000, 30000), input.signal);
    return slackApiCall(method, params, {
      ...input,
      auth,
      workspaceUrl,
      attempt: attempt + 1,
    });
  }

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Slack HTTP ${response.status} calling ${method}`);
  }
  if (!isRecord(body) || body.ok !== true) {
    const error = isRecord(body) ? getString(body.error) : undefined;
    throw new Error(error ?? `Slack API error calling ${method}`);
  }
  return body;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error("Aborted"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function resolveChannelId(
  channel: string,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = channel.trim();
  if (!trimmed) throw new Error("Channel is empty");
  if (isChannelId(trimmed)) return trimmed;

  const name = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (!name) throw new Error("Channel name is empty");

  try {
    const search = await slackApiCall(
      "search.messages",
      {
        query: `in:#${name}`,
        count: 1,
        sort: "timestamp",
        sort_dir: "desc",
      },
      { workspaceUrl, signal },
    );
    const messages = isRecord(search.messages) ? search.messages : undefined;
    const matches = messages ? asArray(messages.matches).filter(isRecord) : [];
    const channelInfo = matches[0] && isRecord(matches[0].channel) ? matches[0].channel : undefined;
    const channelId = channelInfo ? getString(channelInfo.id) : undefined;
    if (channelId) return channelId;
  } catch {
    // fall through
  }

  let cursor: string | undefined;
  for (;;) {
    const response = await slackApiCall(
      "conversations.list",
      {
        exclude_archived: true,
        limit: 200,
        cursor,
        types: "public_channel,private_channel",
      },
      { workspaceUrl, signal },
    );
    const channels = asArray(response.channels).filter(isRecord);
    for (const item of channels) {
      if (getString(item.name) === name && getString(item.id)) {
        return getString(item.id)!;
      }
    }
    const meta = isRecord(response.response_metadata) ? response.response_metadata : undefined;
    const nextCursor = meta ? getString(meta.next_cursor) : undefined;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  throw new Error(`Could not resolve channel name: #${name}`);
}

async function resolveChannelName(
  channelId: string,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const cached = channelNameCache.get(channelId);
  if (cached) return cached;

  try {
    const response = await slackApiCall(
      "conversations.info",
      { channel: channelId },
      { workspaceUrl, signal },
    );
    const channel = isRecord(response.channel) ? response.channel : undefined;
    const name = channel ? getString(channel.name) : undefined;
    if (name) {
      channelNameCache.set(channelId, name);
      return name;
    }
  } catch {
    // ignore
  }

  channelNameCache.set(channelId, channelId);
  return channelId;
}

function slackUserFromApi(raw: Record<string, unknown>): SlackUser {
  const profile = isRecord(raw.profile) ? raw.profile : {};
  return {
    id: getString(raw.id) ?? "",
    name: getString(raw.name),
    displayName: getString(profile.display_name),
    realName: getString(raw.real_name) ?? getString(profile.real_name),
    email: getString(profile.email),
    title: getString(profile.title),
    isBot: typeof raw.is_bot === "boolean" ? raw.is_bot : undefined,
    deleted: typeof raw.deleted === "boolean" ? raw.deleted : undefined,
    raw,
  };
}

async function getSlackUser(
  userId: string,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<SlackUser | undefined> {
  try {
    const response = await slackApiCall("users.info", { user: userId }, { workspaceUrl, signal });
    const user = isRecord(response.user) ? response.user : undefined;
    return user ? slackUserFromApi(user) : undefined;
  } catch {
    return undefined;
  }
}

async function resolveUserId(
  input: string,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (/^U[A-Z0-9]{8,}$/.test(trimmed)) return trimmed;

  const maybeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) && !trimmed.startsWith("@");
  if (maybeEmail) {
    try {
      const response = await slackApiCall(
        "users.lookupByEmail",
        { email: trimmed },
        { workspaceUrl, signal },
      );
      const user = isRecord(response.user) ? response.user : undefined;
      const userId = user ? getString(user.id) : undefined;
      if (userId) return userId;
    } catch {
      // fall through
    }
  }

  const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!handle) return undefined;

  let cursor: string | undefined;
  for (;;) {
    const response = await slackApiCall(
      "users.list",
      { limit: 200, cursor },
      { workspaceUrl, signal },
    );
    const members = asArray(response.members).filter(isRecord);
    const found = members.find((member) => {
      if (getString(member.name) === handle) return true;
      const profile = isRecord(member.profile) ? member.profile : undefined;
      const email = profile ? getString(profile.email) : undefined;
      return maybeEmail && Boolean(email) && email?.toLowerCase() === trimmed.toLowerCase();
    });
    const id = found ? getString(found.id) : undefined;
    if (id) return id;
    const meta = isRecord(response.response_metadata) ? response.response_metadata : undefined;
    const nextCursor = meta ? getString(meta.next_cursor) : undefined;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return undefined;
}

async function resolveUserName(
  userId: string | undefined,
  username: string | undefined,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!userId) return username ?? "unknown";

  const cached = userNameCache.get(userId);
  if (cached) return cached;

  const user = await getSlackUser(userId, workspaceUrl, signal);
  const resolved = user?.displayName || user?.realName || user?.name || username || userId;
  userNameCache.set(userId, resolved);
  return resolved;
}

async function resolveSearchChannelToken(
  channel: string,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = channel.trim();
  if (!trimmed) throw new Error("Channel is empty");
  if (!isChannelId(trimmed)) {
    return `in:#${trimmed.startsWith("#") ? trimmed.slice(1) : trimmed}`;
  }

  const name = await resolveChannelName(trimmed, workspaceUrl, signal);
  return `in:#${name}`;
}

async function resolveSearchUserToken(
  from: string,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = from.trim();
  if (!trimmed) throw new Error("User filter is empty");
  if (!/^U[A-Z0-9]{8,}$/.test(trimmed) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    return `from:@${trimmed.startsWith("@") ? trimmed.slice(1) : trimmed}`;
  }

  const userId = await resolveUserId(trimmed, workspaceUrl, signal);
  if (!userId) {
    throw new Error(`Could not resolve Slack user: ${trimmed}`);
  }

  const user = await getSlackUser(userId, workspaceUrl, signal);
  const handle = user?.name;
  if (!handle) {
    throw new Error(`Could not resolve Slack user handle: ${trimmed}`);
  }
  return `from:@${handle}`;
}

async function buildSearchQuery(
  input: SlackSearchInput,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const parts: string[] = [];
  const base = input.query.trim();
  if (base) parts.push(base);
  if (input.after) parts.push(`after:${validateDate(input.after)}`);
  if (input.before) parts.push(`before:${validateDate(input.before)}`);
  if (input.channel)
    parts.push(await resolveSearchChannelToken(input.channel, workspaceUrl, signal));
  if (input.from) parts.push(await resolveSearchUserToken(input.from, workspaceUrl, signal));
  return parts.join(" ").trim();
}

async function searchMessagesRaw(
  searchQuery: string,
  workspaceUrl: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchRawMatch[]> {
  const out: SearchRawMatch[] = [];
  let page = 1;
  let pages = 1;

  for (;;) {
    const response = await slackApiCall(
      "search.messages",
      {
        query: searchQuery,
        count: Math.min(Math.max(limit, 1), SEARCH_PAGE_SIZE),
        page,
        highlight: false,
        sort: "timestamp",
        sort_dir: "desc",
      },
      { workspaceUrl, signal },
    );

    const messages = isRecord(response.messages) ? response.messages : undefined;
    const matches = messages ? asArray(messages.matches).filter(isRecord) : [];
    out.push(...matches);

    const paging = messages
      ? isRecord(messages.paging)
        ? messages.paging
        : isRecord(messages.pagination)
          ? messages.pagination
          : undefined
      : undefined;
    const totalPages = paging ? Number(paging.pages ?? 1) : 1;
    if (Number.isFinite(totalPages) && totalPages > 0) {
      pages = totalPages;
    }

    if (out.length >= limit) break;
    if (!matches.length) break;
    if (page >= pages) break;
    page += 1;
  }

  return out.slice(0, limit);
}

function toSlackFileSummary(value: unknown): SlackFileSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = getString(value.id);
  if (!id) return undefined;
  return {
    id,
    name: getString(value.name),
    title: getString(value.title),
    mimetype: getString(value.mimetype),
    filetype: getString(value.filetype),
    mode: getString(value.mode),
    permalink: getString(value.permalink),
    urlPrivate: getString(value.url_private),
    urlPrivateDownload: getString(value.url_private_download),
    size: getNumber(value.size),
  };
}

async function hydrateSlackFile(
  file: SlackFileSummary,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<SlackFileSummary> {
  if (file.mode !== "snippet" && file.urlPrivateDownload) {
    return file;
  }

  try {
    const response = await slackApiCall("files.info", { file: file.id }, { workspaceUrl, signal });
    const rawFile = isRecord(response.file) ? response.file : undefined;
    return {
      ...file,
      name: file.name ?? getString(rawFile?.name),
      title: file.title ?? getString(rawFile?.title),
      mimetype: file.mimetype ?? getString(rawFile?.mimetype),
      filetype: file.filetype ?? getString(rawFile?.filetype),
      mode: file.mode ?? getString(rawFile?.mode),
      permalink: file.permalink ?? getString(rawFile?.permalink),
      urlPrivate: file.urlPrivate ?? getString(rawFile?.url_private),
      urlPrivateDownload: file.urlPrivateDownload ?? getString(rawFile?.url_private_download),
      size: file.size ?? getNumber(rawFile?.size),
      snippetContent: getString(rawFile?.content),
      snippetLanguage: getString(rawFile?.filetype),
    };
  } catch {
    return file;
  }
}

async function hydrateMessageFiles(
  rawMessage: Record<string, unknown>,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<SlackFileSummary[]> {
  const files = asArray(rawMessage.files)
    .map((value) => toSlackFileSummary(value))
    .filter((file): file is SlackFileSummary => Boolean(file));
  if (!files.length) return [];
  return Promise.all(files.map((file) => hydrateSlackFile(file, workspaceUrl, signal)));
}

async function fetchMessage(ref: SlackMessageRef, signal?: AbortSignal): Promise<SlackMessage> {
  const history = await slackApiCall(
    "conversations.history",
    {
      channel: ref.channelId,
      latest: ref.messageTs,
      inclusive: true,
      limit: 5,
    },
    { workspaceUrl: ref.workspaceUrl, signal },
  );

  const historyMessages = asArray(history.messages).filter(isRecord);
  let rawMessage = historyMessages.find((message) => getString(message.ts) === ref.messageTs);

  if (!rawMessage && ref.threadTsHint) {
    const thread = await fetchThread(
      ref.workspaceUrl,
      ref.channelId,
      ref.threadTsHint,
      signal,
    ).catch(() => []);
    rawMessage = undefined;
    if (thread.length) {
      const match = thread.find((message) => message.ts === ref.messageTs);
      if (match) return match;
    }
  }

  if (!rawMessage) {
    try {
      const response = await slackApiCall(
        "conversations.replies",
        {
          channel: ref.channelId,
          ts: ref.messageTs,
          limit: 1,
        },
        { workspaceUrl: ref.workspaceUrl, signal },
      );
      const root = asArray(response.messages).find(
        (message): message is Record<string, unknown> =>
          isRecord(message) && getString(message.ts) === ref.messageTs,
      );
      if (root) {
        rawMessage = root;
      }
    } catch {
      // ignore
    }
  }

  if (!rawMessage) {
    throw new Error("Message not found (no access or wrong URL)");
  }

  const files = await hydrateMessageFiles(rawMessage, ref.workspaceUrl, signal);
  return messageFromApi(ref.workspaceUrl, ref.channelId, rawMessage, files);
}

async function fetchThread(
  workspaceUrl: string,
  channelId: string,
  threadTs: string,
  signal?: AbortSignal,
): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  let cursor: string | undefined;

  for (;;) {
    const response = await slackApiCall(
      "conversations.replies",
      {
        channel: channelId,
        ts: threadTs,
        limit: 200,
        cursor,
      },
      { workspaceUrl, signal },
    );

    const messages = asArray(response.messages).filter(isRecord);
    for (const message of messages) {
      const files = await hydrateMessageFiles(message, workspaceUrl, signal);
      out.push(messageFromApi(workspaceUrl, channelId, message, files));
    }

    const meta = isRecord(response.response_metadata) ? response.response_metadata : undefined;
    const nextCursor = meta ? getString(meta.next_cursor) : undefined;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  out.sort((a, b) => Number.parseFloat(a.ts) - Number.parseFloat(b.ts));
  return out;
}

function messageFromApi(
  workspaceUrl: string,
  channelId: string,
  rawMessage: Record<string, unknown>,
  files: SlackFileSummary[] = [],
): SlackMessage {
  const ts = getString(rawMessage.ts) ?? "";
  return {
    workspaceUrl,
    channelId,
    ts,
    threadTs: getString(rawMessage.thread_ts),
    replyCount: getNumber(rawMessage.reply_count),
    userId: getString(rawMessage.user),
    username: getString(rawMessage.username),
    botId: getString(rawMessage.bot_id),
    text: normalizeText(getString(rawMessage.text) ?? ""),
    permalink: buildSlackPermalink(workspaceUrl, channelId, ts),
    files,
    raw: rawMessage,
  };
}

async function resolveReadTarget(
  input: SlackReadInput,
  options?: ToolExecutionOptions,
): Promise<SlackMessageRef> {
  if (input.url) {
    return parseSlackMessageUrl(input.url);
  }

  if (!input.channel || !input.ts) {
    throw new Error("SlackRead requires either url or both channel and ts.");
  }

  const workspaceUrl = await getConfiguredWorkspaceUrl(options?.cwd);
  const channelId = await resolveChannelId(input.channel, workspaceUrl, options?.signal);
  const messageTs = validateTs(input.ts, "ts");
  return {
    workspaceUrl,
    channelId,
    messageTs,
    raw: `${input.channel}:${messageTs}`,
  };
}

async function resolveReplyTarget(
  input: SlackReplyInput,
  options?: ToolExecutionOptions,
): Promise<{ workspaceUrl: string; channelId: string; threadTs: string; source: string }> {
  if (input.url) {
    const ref = parseSlackMessageUrl(input.url);
    const message = await fetchMessage(ref, options?.signal);
    return {
      workspaceUrl: ref.workspaceUrl,
      channelId: ref.channelId,
      threadTs: message.threadTs ?? message.ts,
      source: input.url,
    };
  }

  if (!input.channel || !input.threadTs) {
    throw new Error("SlackReply requires either url or both channel and threadTs.");
  }

  const workspaceUrl = await getConfiguredWorkspaceUrl(options?.cwd);
  return {
    workspaceUrl,
    channelId: await resolveChannelId(input.channel, workspaceUrl, options?.signal),
    threadTs: validateTs(input.threadTs, "threadTs"),
    source: `${input.channel}:${input.threadTs}`,
  };
}

async function hydrateSearchMatch(
  rawMatch: SearchRawMatch,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<SlackMessage | undefined> {
  const permalink = getString(rawMatch.permalink);
  if (permalink) {
    try {
      return await fetchMessage(parseSlackMessageUrl(permalink), signal);
    } catch {
      // keep going
    }
  }

  const channelInfo = isRecord(rawMatch.channel) ? rawMatch.channel : undefined;
  const channelId = channelInfo ? getString(channelInfo.id) : undefined;
  const channelName = channelInfo ? getString(channelInfo.name) : undefined;
  const ts = getString(rawMatch.ts);
  if (!ts) return undefined;

  let resolvedChannelId = channelId;
  if (!resolvedChannelId && channelName) {
    resolvedChannelId = await resolveChannelId(channelName, workspaceUrl, signal).catch(
      () => undefined,
    );
  }
  if (!resolvedChannelId) return undefined;

  try {
    return await fetchMessage(
      {
        workspaceUrl,
        channelId: resolvedChannelId,
        messageTs: ts,
        threadTsHint: getString(rawMatch.thread_ts),
        raw: permalink ?? `${resolvedChannelId}:${ts}`,
      },
      signal,
    );
  } catch {
    return {
      workspaceUrl,
      channelId: resolvedChannelId,
      ts,
      threadTs: getString(rawMatch.thread_ts),
      replyCount: getNumber(rawMatch.reply_count),
      userId: getString(rawMatch.user),
      username: getString(rawMatch.username),
      botId: getString(rawMatch.bot_id),
      text: normalizeText(getString(rawMatch.text) ?? ""),
      permalink: permalink ?? buildSlackPermalink(workspaceUrl, resolvedChannelId, ts),
      files: [],
      raw: rawMatch,
    };
  }
}

function renderCodeFence(content: string, language?: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const longestTickRun = Math.max(
    3,
    ...Array.from(normalized.matchAll(/`+/g), (match) => match[0].length + 1),
  );
  const fence = "`".repeat(longestTickRun);
  return `${fence}${language ?? ""}\n${normalized}\n${fence}`;
}

function renderSlackFiles(files: SlackFileSummary[], options?: { clipSnippet?: number }): string[] {
  if (!files.length) return [];

  const lines = ["### Attachments", ""];
  files.forEach((file, index) => {
    if (index > 0) {
      lines.push("");
    }

    const title = file.title || file.name || file.id;
    const extras = [file.mode, file.filetype, file.mimetype].filter(Boolean);
    lines.push(`#### ${title}`);
    if (extras.length) {
      lines.push(`- Type: ${extras.join(", ")}`);
    }
    if (typeof file.size === "number") {
      lines.push(`- Size: ${file.size}`);
    }
    if (file.permalink) {
      lines.push(`- [Permalink](${file.permalink})`);
    }
    if (file.snippetContent) {
      lines.push(
        "",
        renderCodeFence(
          clipText(file.snippetContent, options?.clipSnippet ?? 1200),
          file.snippetLanguage,
        ),
      );
    }
  });

  return lines;
}

async function resolveSlackMentionsInText(
  text: string,
  workspaceUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const matches = [...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g)];
  if (!matches.length) {
    return text;
  }

  const userIds = [...new Set(matches.map((match) => match[1]).filter(Boolean))] as string[];
  const resolvedNames = new Map<string, string>();

  await Promise.all(
    userIds.map(async (userId) => {
      const fallback = matches.find((match) => match[1] === userId)?.[2];
      const resolved = await resolveUserName(userId, fallback, workspaceUrl, signal);
      resolvedNames.set(userId, `@${resolved}`);
    }),
  );

  return text.replace(
    /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g,
    (_match, userId: string, fallback?: string) =>
      resolvedNames.get(userId) ?? (fallback ? `@${fallback}` : `@${userId}`),
  );
}

async function renderMessage(
  message: SlackMessage,
  options?: {
    headingLevel?: number;
    includeChannel?: boolean;
    showPermalink?: boolean;
    clipBody?: number;
    clipSnippet?: number;
    signal?: AbortSignal;
  },
): Promise<string> {
  const channelName = await resolveChannelName(
    message.channelId,
    message.workspaceUrl,
    options?.signal,
  );
  const author = await resolveUserName(
    message.userId,
    message.username ?? message.botId,
    message.workspaceUrl,
    options?.signal,
  );

  const headingLevel = Math.min(Math.max(options?.headingLevel ?? 2, 1), 6);
  const heading = `${"#".repeat(headingLevel)} ${formatTimestamp(message.ts)} — ${author}`;
  const resolvedText = message.text
    ? await resolveSlackMentionsInText(message.text, message.workspaceUrl, options?.signal)
    : "(no text)";
  const body = options?.clipBody ? clipText(resolvedText, options.clipBody) : resolvedText;
  const lines = [heading, "", body];

  const metadataLines: string[] = [];
  if (options?.includeChannel) {
    metadataLines.push(`- Channel: #${channelName}`);
  }
  if (message.threadTs) {
    metadataLines.push(`- Thread ts: \`${message.threadTs}\``);
  }
  if (message.replyCount) {
    metadataLines.push(`- Thread replies: ${message.replyCount}`);
  }
  if (options?.showPermalink ?? true) {
    metadataLines.push(`- [Permalink](${message.permalink})`);
  }
  if (metadataLines.length) {
    lines.push("", ...metadataLines);
  }

  const fileLines = renderSlackFiles(message.files, { clipSnippet: options?.clipSnippet });
  if (fileLines.length) {
    lines.push("", ...fileLines);
  }

  return lines.join("\n");
}

async function renderThread(thread: SlackMessage[], signal?: AbortSignal): Promise<string> {
  if (!thread.length) return "No messages found.";
  const blocks = await Promise.all(
    thread.map((message) => renderMessage(message, { headingLevel: 2, signal })),
  );
  return blocks.join("\n\n");
}

async function renderSearchMessages(
  messages: SlackMessage[],
  signal?: AbortSignal,
): Promise<string> {
  if (!messages.length) return "No results found.";
  const blocks = await Promise.all(
    messages.map((message) =>
      renderMessage(message, {
        headingLevel: 2,
        includeChannel: true,
        showPermalink: true,
        clipBody: 500,
        clipSnippet: 400,
        signal,
      }),
    ),
  );
  return blocks.join("\n\n");
}

async function renderSearchThreads(
  threads: SlackMessage[][],
  signal?: AbortSignal,
): Promise<string> {
  if (!threads.length) return "No results found.";
  const blocks = await Promise.all(
    threads.map(async (thread, index) => {
      const rendered = await Promise.all(
        thread.map((message) =>
          renderMessage(message, {
            headingLevel: 2,
            includeChannel: true,
            signal,
          }),
        ),
      );
      return [`# Thread ${index + 1}`, "", rendered.join("\n\n")].join("\n");
    }),
  );
  return blocks.join("\n\n");
}

async function fetchChannelHistoryPage(
  input: SlackChannelHistoryInput,
  options?: ToolExecutionOptions,
): Promise<{
  workspaceUrl: string;
  channelId: string;
  channelName: string;
  messages: SlackMessage[];
  nextOldest?: string;
  hasMore: boolean;
  requestedOldest?: string;
  requestedLatest?: string;
}> {
  const workspaceUrl = await getConfiguredWorkspaceUrl(options?.cwd);
  const channelId = await resolveChannelId(input.channel, workspaceUrl, options?.signal);
  const channelName = await resolveChannelName(channelId, workspaceUrl, options?.signal);
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? DEFAULT_CHANNEL_HISTORY_LIMIT), 1),
    MAX_CHANNEL_HISTORY_LIMIT,
  );
  const oldest = input.oldest ? validateTs(input.oldest, "oldest") : undefined;
  const latest = input.latest ? validateTs(input.latest, "latest") : undefined;

  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  let hasMore = false;

  while (messages.length < limit) {
    const remaining = limit - messages.length;
    const response = await slackApiCall(
      "conversations.history",
      {
        channel: channelId,
        limit: Math.min(remaining, 200),
        cursor,
        oldest,
        latest,
        inclusive: false,
      },
      { workspaceUrl, signal: options?.signal },
    );

    const rawMessages = asArray(response.messages).filter(isRecord);
    for (const rawMessage of rawMessages) {
      const files = await hydrateMessageFiles(rawMessage, workspaceUrl, options?.signal);
      messages.push(messageFromApi(workspaceUrl, channelId, rawMessage, files));
      if (messages.length >= limit) {
        break;
      }
    }

    const meta = isRecord(response.response_metadata) ? response.response_metadata : undefined;
    const nextCursor = meta ? getString(meta.next_cursor) : undefined;
    hasMore = nextCursor ? true : response.has_more === true;
    if (messages.length >= limit || !nextCursor) {
      break;
    }
    cursor = nextCursor;
  }

  messages.sort((a, b) => Number.parseFloat(a.ts) - Number.parseFloat(b.ts));

  return {
    workspaceUrl,
    channelId,
    channelName,
    messages,
    nextOldest: messages.at(-1)?.ts,
    hasMore,
    requestedOldest: oldest,
    requestedLatest: latest,
  };
}

async function renderChannelHistory(
  channelName: string,
  messages: SlackMessage[],
  signal?: AbortSignal,
): Promise<string> {
  if (!messages.length) {
    return `No messages found in #${channelName}.`;
  }

  const blocks = await Promise.all(
    messages.map((message) =>
      renderMessage(message, {
        headingLevel: 2,
        showPermalink: true,
        signal,
      }),
    ),
  );

  return blocks.join("\n\n");
}

function serializeSlackMessage(message: SlackMessage): Record<string, unknown> {
  return {
    workspaceUrl: message.workspaceUrl,
    channelId: message.channelId,
    ts: message.ts,
    threadTs: message.threadTs,
    replyCount: message.replyCount,
    userId: message.userId,
    username: message.username,
    botId: message.botId,
    text: message.text,
    permalink: message.permalink,
    files: summarizeSlackFiles(message.files),
    raw: message.raw,
  };
}

function matchesUserQuery(user: SlackUser, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  const values = [user.id, user.name, user.displayName, user.realName, user.email, user.title]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  return values.some((value) => value.includes(needle));
}

function scoreUserMatch(user: SlackUser, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const exact = [user.id, user.name, user.displayName, user.realName, user.email]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  if (exact.includes(needle) || exact.includes(needle.replace(/^@/, ""))) return 100;
  if (user.name?.toLowerCase() === needle.replace(/^@/, "")) return 90;
  if (user.email?.toLowerCase() === needle) return 90;
  if (user.displayName?.toLowerCase().includes(needle)) return 60;
  if (user.realName?.toLowerCase().includes(needle)) return 50;
  if (user.name?.toLowerCase().includes(needle.replace(/^@/, ""))) return 40;
  return 10;
}

async function lookupSlackUsers(
  input: SlackUserLookupInput,
  options?: ToolExecutionOptions,
): Promise<SlackUser[]> {
  const workspaceUrl = await getConfiguredWorkspaceUrl(options?.cwd);
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? DEFAULT_USER_LOOKUP_LIMIT), 1),
    MAX_USER_LOOKUP_LIMIT,
  );
  const includeBots = input.includeBots ?? false;
  const query = input.query.trim();
  if (!query) {
    throw new Error("SlackUserLookup query is empty.");
  }

  const results = new Map<string, SlackUser>();
  const maybeId = /^U[A-Z0-9]{8,}$/.test(query);
  const maybeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(query) && !query.startsWith("@");

  if (maybeId) {
    const user = await getSlackUser(query, workspaceUrl, options?.signal);
    if (user && !user.deleted && (includeBots || !user.isBot)) {
      results.set(user.id, user);
    }
  }

  if (maybeEmail) {
    const userId = await resolveUserId(query, workspaceUrl, options?.signal);
    if (userId) {
      const user = await getSlackUser(userId, workspaceUrl, options?.signal);
      if (user && !user.deleted && (includeBots || !user.isBot)) {
        results.set(user.id, user);
      }
    }
  }

  let cursor: string | undefined;
  while (results.size < limit) {
    const response = await slackApiCall(
      "users.list",
      { limit: 200, cursor },
      { workspaceUrl, signal: options?.signal },
    );
    const members = asArray(response.members).filter(isRecord);
    for (const member of members) {
      const user = slackUserFromApi(member);
      if (!user.id) continue;
      if (user.deleted) continue;
      if (!includeBots && user.isBot) continue;
      if (matchesUserQuery(user, query)) {
        results.set(user.id, user);
      }
    }

    const meta = isRecord(response.response_metadata) ? response.response_metadata : undefined;
    const nextCursor = meta ? getString(meta.next_cursor) : undefined;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return [...results.values()]
    .sort((a, b) => scoreUserMatch(b, query) - scoreUserMatch(a, query))
    .slice(0, limit);
}

async function renderUserLookup(
  users: SlackUser[],
  options?: { signal?: AbortSignal; cwd?: string },
): Promise<string> {
  if (!users.length) return "No users found.";
  const workspaceUrl = await getConfiguredWorkspaceUrl(options?.cwd);
  const lines: string[] = [];

  for (const user of users) {
    const display = user.displayName || user.realName || user.name || user.id;
    const details = [user.name ? `@${user.name}` : undefined, user.email, user.title]
      .filter(Boolean)
      .join(" · ");
    lines.push(display);
    if (details) lines.push(details);
    lines.push(user.id, `${workspaceUrl}/team/${user.id}`, "");
  }

  return lines.join("\n").trim();
}

export async function slackRead(
  input: SlackReadInput,
  options?: ToolExecutionOptions,
): Promise<SlackReadResult> {
  const format = getOutputFormat(input.format);
  const mode: SlackReadMode = input.mode ?? "thread";
  const target = await resolveReadTarget(input, options);
  const message = await fetchMessage(target, options?.signal);

  if (mode === "message") {
    const channelName = await resolveChannelName(
      message.channelId,
      message.workspaceUrl,
      options?.signal,
    );
    const author = await resolveUserName(
      message.userId,
      message.username ?? message.botId,
      message.workspaceUrl,
      options?.signal,
    );
    const details = {
      format,
      mode,
      workspaceUrl: message.workspaceUrl,
      channelId: message.channelId,
      channelName,
      author,
      ts: message.ts,
      threadTs: message.threadTs,
      permalink: message.permalink,
      replyCount: message.replyCount,
      fileCount: message.files.length,
      source: target.raw,
    };

    return {
      mode,
      text:
        format === "json"
          ? renderJsonDocument({
              tool: "SlackRead",
              format,
              mode,
              source: target.raw,
              workspaceUrl: message.workspaceUrl,
              channelId: message.channelId,
              messageTs: message.ts,
              message: message.raw,
            })
          : renderMarkdownDocument(
              {
                tool: "SlackRead",
                format,
                mode,
                source: target.raw,
                workspaceUrl: message.workspaceUrl,
                channelId: message.channelId,
                channelName,
                author,
                ts: message.ts,
                threadTs: message.threadTs,
                permalink: message.permalink,
                replyCount: message.replyCount,
                fileCount: message.files.length,
              },
              await renderMessage(message, { headingLevel: 1, signal: options?.signal }),
            ),
      details,
    };
  }

  const rootTs = message.threadTs ?? message.ts;
  const thread = await fetchThread(
    message.workspaceUrl,
    message.channelId,
    rootTs,
    options?.signal,
  ).catch(() => [message]);
  const messages = thread.length ? thread : [message];
  const channelName = await resolveChannelName(
    message.channelId,
    message.workspaceUrl,
    options?.signal,
  );
  const details = {
    format,
    mode,
    workspaceUrl: message.workspaceUrl,
    channelId: message.channelId,
    channelName,
    threadTs: rootTs,
    count: messages.length,
    permalink: messages[0]?.permalink,
    source: target.raw,
  };

  return {
    mode,
    text:
      format === "json"
        ? renderJsonDocument({
            tool: "SlackRead",
            format,
            mode,
            source: target.raw,
            workspaceUrl: message.workspaceUrl,
            channelId: message.channelId,
            threadTs: rootTs,
            messages: messages.map((entry) => entry.raw),
          })
        : renderMarkdownDocument(
            {
              tool: "SlackRead",
              format,
              mode,
              source: target.raw,
              workspaceUrl: message.workspaceUrl,
              channelId: message.channelId,
              channelName,
              threadTs: rootTs,
              count: messages.length,
              permalink: messages[0]?.permalink,
            },
            await renderThread(messages, options?.signal),
          ),
    details,
  };
}

export async function slackSearch(
  input: SlackSearchInput,
  options?: ToolExecutionOptions,
): Promise<SlackSearchResult> {
  const format = getOutputFormat(input.format);
  const workspaceUrl = await getConfiguredWorkspaceUrl(options?.cwd);
  const mode: SlackSearchMode = input.mode ?? "messages";
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? DEFAULT_SEARCH_LIMIT), 1),
    MAX_SEARCH_LIMIT,
  );
  const rawLimit = mode === "threads" ? Math.min(limit * 3, 100) : limit;
  const searchQuery = await buildSearchQuery(input, workspaceUrl, options?.signal);
  const rawMatches = await searchMessagesRaw(searchQuery, workspaceUrl, rawLimit, options?.signal);

  if (mode === "messages") {
    const messages: SlackMessage[] = [];
    for (const rawMatch of rawMatches) {
      const hydrated = await hydrateSearchMatch(rawMatch, workspaceUrl, options?.signal);
      if (!hydrated) continue;
      messages.push(hydrated);
      if (messages.length >= limit) break;
    }

    const details = {
      format,
      mode,
      count: messages.length,
      query: input.query,
      searchQuery,
      workspaceUrl,
    };

    return {
      searchQuery,
      mode,
      count: messages.length,
      text:
        format === "json"
          ? renderJsonDocument({
              tool: "SlackSearch",
              format,
              mode,
              workspaceUrl,
              query: input.query,
              searchQuery,
              count: messages.length,
              matches: rawMatches,
              messages: messages.map((message) => message.raw),
            })
          : renderMarkdownDocument(
              {
                tool: "SlackSearch",
                format,
                mode,
                workspaceUrl,
                query: input.query,
                searchQuery,
                count: messages.length,
              },
              await renderSearchMessages(messages, options?.signal),
            ),
      details,
    };
  }

  const threads = new Map<string, SlackMessage[]>();
  for (const rawMatch of rawMatches) {
    const hydrated = await hydrateSearchMatch(rawMatch, workspaceUrl, options?.signal);
    if (!hydrated) continue;
    const rootTs = hydrated.threadTs ?? hydrated.ts;
    const key = `${hydrated.channelId}:${rootTs}`;
    if (threads.has(key)) continue;
    const thread = await fetchThread(
      hydrated.workspaceUrl,
      hydrated.channelId,
      rootTs,
      options?.signal,
    ).catch(() => [hydrated]);
    threads.set(key, thread.length ? thread : [hydrated]);
    if (threads.size >= limit) break;
  }

  const threadList = [...threads.values()];
  const details = {
    format,
    mode,
    count: threadList.length,
    query: input.query,
    searchQuery,
    workspaceUrl,
  };

  return {
    searchQuery,
    mode,
    count: threadList.length,
    text:
      format === "json"
        ? renderJsonDocument({
            tool: "SlackSearch",
            format,
            mode,
            workspaceUrl,
            query: input.query,
            searchQuery,
            count: threadList.length,
            matches: rawMatches,
            threads: threadList.map((thread) => thread.map((message) => message.raw)),
          })
        : renderMarkdownDocument(
            {
              tool: "SlackSearch",
              format,
              mode,
              workspaceUrl,
              query: input.query,
              searchQuery,
              count: threadList.length,
            },
            await renderSearchThreads(threadList, options?.signal),
          ),
    details,
  };
}

export async function slackChannelHistory(
  input: SlackChannelHistoryInput,
  options?: ToolExecutionOptions,
): Promise<SlackChannelHistoryResult> {
  const format = getOutputFormat(input.format);
  const page = await fetchChannelHistoryPage(input, options);
  const details = {
    format,
    workspaceUrl: page.workspaceUrl,
    channelId: page.channelId,
    channelName: page.channelName,
    count: page.messages.length,
    hasMore: page.hasMore,
    requestedOldest: page.requestedOldest,
    requestedLatest: page.requestedLatest,
    nextOldest: page.nextOldest,
    messages: page.messages.map((message) => serializeSlackMessage(message)),
  };

  return {
    text:
      format === "json"
        ? renderJsonDocument({
            tool: "SlackChannelHistory",
            format,
            workspaceUrl: page.workspaceUrl,
            channelId: page.channelId,
            channelName: page.channelName,
            requestedOldest: page.requestedOldest,
            requestedLatest: page.requestedLatest,
            count: page.messages.length,
            hasMore: page.hasMore,
            nextOldest: page.nextOldest,
            messages: page.messages.map((message) => message.raw),
          })
        : renderMarkdownDocument(
            {
              tool: "SlackChannelHistory",
              format,
              workspaceUrl: page.workspaceUrl,
              channelId: page.channelId,
              channelName: page.channelName,
              requestedOldest: page.requestedOldest,
              requestedLatest: page.requestedLatest,
              count: page.messages.length,
              hasMore: page.hasMore,
              nextOldest: page.nextOldest,
            },
            await renderChannelHistory(page.channelName, page.messages, options?.signal),
          ),
    details,
  };
}

export async function slackReply(
  input: SlackReplyInput,
  options?: ToolExecutionOptions,
): Promise<SlackReplyResult> {
  const format = getOutputFormat(input.format);
  const target = await resolveReplyTarget(input, options);
  const channelName = await resolveChannelName(
    target.channelId,
    target.workspaceUrl,
    options?.signal,
  );

  if (input.dryRun) {
    const details = {
      format,
      dryRun: true,
      workspaceUrl: target.workspaceUrl,
      channelId: target.channelId,
      channelName,
      threadTs: target.threadTs,
      source: target.source,
    };
    return {
      text:
        format === "json"
          ? renderJsonDocument({
              tool: "SlackReply",
              format,
              dryRun: true,
              workspaceUrl: target.workspaceUrl,
              channelId: target.channelId,
              channelName,
              threadTs: target.threadTs,
              source: target.source,
              text: input.text,
            })
          : renderMarkdownDocument(
              {
                tool: "SlackReply",
                format,
                dryRun: true,
                workspaceUrl: target.workspaceUrl,
                channelId: target.channelId,
                channelName,
                threadTs: target.threadTs,
                source: target.source,
              },
              [
                `Dry run: would reply in #${channelName}`,
                `Thread root: ${target.threadTs}`,
                "",
                normalizeText(input.text),
              ].join("\n"),
            ),
      details,
    };
  }

  const response = await slackApiCall(
    "chat.postMessage",
    {
      channel: target.channelId,
      thread_ts: target.threadTs,
      text: input.text,
    },
    { workspaceUrl: target.workspaceUrl, signal: options?.signal },
  );

  const channelId = getString(response.channel) ?? target.channelId;
  const ts = getString(response.ts);
  const permalink = ts ? buildSlackPermalink(target.workspaceUrl, channelId, ts) : undefined;
  const details = {
    format,
    dryRun: false,
    workspaceUrl: target.workspaceUrl,
    channelId,
    channelName,
    threadTs: target.threadTs,
    ts,
    permalink,
    source: target.source,
  };

  return {
    text:
      format === "json"
        ? renderJsonDocument({
            tool: "SlackReply",
            format,
            dryRun: false,
            workspaceUrl: target.workspaceUrl,
            channelId,
            channelName,
            threadTs: target.threadTs,
            ts,
            permalink,
            source: target.source,
            response,
          })
        : renderMarkdownDocument(
            {
              tool: "SlackReply",
              format,
              dryRun: false,
              workspaceUrl: target.workspaceUrl,
              channelId,
              channelName,
              threadTs: target.threadTs,
              ts,
              permalink,
              source: target.source,
            },
            [
              `Reply posted to #${channelName}`,
              permalink ?? `${target.workspaceUrl} · ${channelId} · ${ts ?? "unknown ts"}`,
            ].join("\n"),
          ),
    details,
  };
}

export async function slackUserLookup(
  input: SlackUserLookupInput,
  options?: ToolExecutionOptions,
): Promise<SlackUserLookupResult> {
  const format = getOutputFormat(input.format);
  const users = await lookupSlackUsers(input, options);
  const workspaceUrl = await getConfiguredWorkspaceUrl(options?.cwd);
  const details = {
    format,
    query: input.query,
    count: users.length,
    workspaceUrl,
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      displayName: user.displayName,
      realName: user.realName,
      email: user.email,
      title: user.title,
      isBot: user.isBot,
      deleted: user.deleted,
    })),
  };

  return {
    text:
      format === "json"
        ? renderJsonDocument({
            tool: "SlackUserLookup",
            format,
            query: input.query,
            count: users.length,
            workspaceUrl,
            users: users.map((user) => user.raw),
          })
        : renderMarkdownDocument(
            {
              tool: "SlackUserLookup",
              format,
              query: input.query,
              count: users.length,
              workspaceUrl,
            },
            await renderUserLookup(users, options),
          ),
    details,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "SlackRead",
    label: "Slack Read",
    description: [
      "Read a Slack message or full thread.",
      "Defaults to full thread context when given a message URL.",
      "Authentication is automatic on macOS from Slack.app.",
    ].join("\n"),
    promptSnippet:
      "Read a Slack message or full thread. Auth comes from Slack.app. The default workspace comes from settings.json.",
    parameters: SlackReadParams,
    async execute(_toolCallId, params: SlackReadInput, signal, onUpdate, ctx) {
      onUpdate?.({
        content: [{ type: "text", text: "Reading Slack…" }],
        details: { stage: "read" },
      });
      const result = await slackRead(params, { signal, cwd: ctx.cwd });
      const truncated = truncateForModel(result.text);
      return {
        content: [{ type: "text" as const, text: truncated.text }],
        details: {
          ...result.details,
          truncated: truncated.truncated,
        },
      };
    },
  });

  pi.registerTool({
    name: "SlackSearch",
    label: "Slack Search",
    description: [
      "Search Slack messages, optionally scoped to a channel or sender.",
      "Can return matching messages or expand them into full thread context.",
      "Authentication is automatic on macOS from Slack.app.",
    ].join("\n"),
    promptSnippet:
      "Search Slack messages or threads. Auth comes from Slack.app. The default workspace comes from settings.json.",
    parameters: SlackSearchParams,
    async execute(_toolCallId, params: SlackSearchInput, signal, onUpdate, ctx) {
      onUpdate?.({
        content: [{ type: "text", text: "Searching Slack…" }],
        details: { stage: "search", mode: params.mode ?? "messages" },
      });
      const result = await slackSearch(params, { signal, cwd: ctx.cwd });
      const truncated = truncateForModel(result.text);
      return {
        content: [{ type: "text" as const, text: truncated.text }],
        details: {
          ...result.details,
          truncated: truncated.truncated,
        },
      };
    },
  });

  pi.registerTool({
    name: "SlackChannelHistory",
    label: "Slack Channel History",
    description: [
      "List channel messages chronologically with pagination-friendly bounds.",
      "Use oldest=nextOldest from the previous call to walk forward through a channel.",
      "Authentication is automatic on macOS from Slack.app.",
    ].join("\n"),
    promptSnippet:
      "List channel history chronologically. Use oldest=nextOldest from the previous result to page through a full channel.",
    parameters: SlackChannelHistoryParams,
    async execute(_toolCallId, params: SlackChannelHistoryInput, signal, onUpdate, ctx) {
      onUpdate?.({
        content: [{ type: "text", text: "Listing Slack channel history…" }],
        details: { stage: "channel-history" },
      });
      const result = await slackChannelHistory(params, { signal, cwd: ctx.cwd });
      const truncated = truncateForModel(result.text);
      return {
        content: [{ type: "text" as const, text: truncated.text }],
        details: {
          ...result.details,
          truncated: truncated.truncated,
        },
      };
    },
  });

  pi.registerTool({
    name: "SlackReply",
    label: "Slack Reply",
    description: [
      "Post a reply into a Slack thread.",
      "Accepts a message URL or channel + threadTs.",
      "Set dryRun=true to validate auth and the target without posting anything.",
    ].join("\n"),
    promptSnippet:
      "Reply in a Slack thread. Auth comes from Slack.app. The default workspace comes from settings.json.",
    parameters: SlackReplyParams,
    async execute(_toolCallId, params: SlackReplyInput, signal, onUpdate, ctx) {
      onUpdate?.({
        content: [
          {
            type: "text",
            text: params.dryRun ? "Validating Slack reply target…" : "Posting Slack reply…",
          },
        ],
        details: { stage: params.dryRun ? "dry-run" : "reply" },
      });
      const result = await slackReply(params, { signal, cwd: ctx.cwd });
      const truncated = truncateForModel(result.text);
      return {
        content: [{ type: "text" as const, text: truncated.text }],
        details: {
          ...result.details,
          truncated: truncated.truncated,
        },
      };
    },
  });

  pi.registerTool({
    name: "SlackUserLookup",
    label: "Slack User Lookup",
    description: [
      "Look up Slack users by handle, display name, real name, email, or user ID.",
      "Useful for resolving Slack IDs before reading or searching.",
      "Authentication is automatic on macOS from Slack.app.",
    ].join("\n"),
    promptSnippet:
      "Look up Slack users by name, handle, email, or Slack user ID. Auth comes from Slack.app.",
    parameters: SlackUserLookupParams,
    async execute(_toolCallId, params: SlackUserLookupInput, signal, onUpdate, ctx) {
      onUpdate?.({
        content: [{ type: "text", text: "Looking up Slack users…" }],
        details: { stage: "user-lookup" },
      });
      const result = await slackUserLookup(params, { signal, cwd: ctx.cwd });
      const truncated = truncateForModel(result.text);
      return {
        content: [{ type: "text" as const, text: truncated.text }],
        details: {
          ...result.details,
          truncated: truncated.truncated,
        },
      };
    },
  });
}
