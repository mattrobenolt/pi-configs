/**
 * Herdr native tools, deferred by default.
 *
 * The socket API is the source of truth. `herdr_call` covers every method;
 * the typed tools cover the supervisor's common paths. The tools are
 * `deferred`, so they stay out of the system prompt until `tool_search` loads
 * them. Schema/catalog reads use HERDR_BIN_PATH when it is set, because the
 * running server may be older than the `herdr` on PATH.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const MAX_RPC_BYTES = 8 * 1024 * 1024;
const MAX_MODEL_BYTES = 24 * 1024;
const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;
const DEFAULT_START_TIMEOUT_MS = 120_000;
const DEFAULT_READ_LINES = 80;
const DEFAULT_DIGEST_LINES = 24;
const DEFAULT_WATCH_MS = 60_000;
const MAX_WATCH_MS = 10 * 60_000;

const AgentStatuses = ["idle", "working", "blocked", "done", "unknown"] as const;
const ReadSources = ["visible", "recent", "recent_unwrapped", "detection"] as const;
const ReadFormats = ["text", "ansi"] as const;
const AgentActions = [
  "list",
  "get",
  "read",
  "start",
  "prompt",
  "wait",
  "send_keys",
  "rename",
  "focus",
  "explain",
] as const;
const PaneActions = [
  "list",
  "get",
  "current",
  "layout",
  "process_info",
  "split",
  "read",
  "run",
  "wait_output",
  "close",
  "zoom",
  "focus_direction",
  "rename",
  "send_text",
  "send_keys",
  "neighbor",
  "edges",
  "resize",
  "input_set",
] as const;
const WorkspaceActions = ["list", "get", "create", "focus", "rename", "close"] as const;
const TabActions = ["list", "get", "create", "focus", "rename", "close", "move"] as const;
const WorktreeActions = ["list", "create", "open", "remove"] as const;
const FleetActions = ["status", "digest"] as const;
const EventActions = ["wait", "watch"] as const;
const NotifyActions = ["show"] as const;

const HerdrNamespace = {
  name: "herdr",
  aliases: ["herdr"],
  description:
    "Herdr terminal workspace manager. Deferred tools for panes, agents, workspaces, tabs, worktrees, events, and notifications.",
  instructions:
    "These tools control the Herdr session this agent runs inside. Use tool_search with a query such as 'herdr pane split', 'herdr agent prompt', or 'herdr supervisor fleet'. Read the Herdr skill with `herdr --skill` before mutating topology or answering a blocked agent. Prefer herdr_fleet for status and herdr_catalog before herdr_call.",
};

type JsonObject = Record<string, unknown>;

interface HerdrRpcFailure extends Error {
  code?: string;
  method: string;
}

interface SchemaDoc {
  protocol?: number;
  schema_version?: number;
  schemas?: {
    request?: {
      oneOf?: Array<{
        properties?: {
          method?: { const?: unknown };
          params?: unknown;
        };
      }>;
      $defs?: Record<string, unknown>;
    };
  };
}

let requestSequence = 0;
let schemaCache: { doc: SchemaDoc; fetchedAt: number } | undefined;

function herdrSocketPath(): string {
  if (process.env.HERDR_ENV !== "1") {
    throw new Error(
      "Herdr tools require running inside a Herdr pane (HERDR_ENV=1). Do not control a Herdr session from outside.",
    );
  }
  const socketPath = process.env.HERDR_SOCKET_PATH;
  if (!socketPath) throw new Error("HERDR_SOCKET_PATH is not set.");
  return socketPath;
}

function herdrBin(): string {
  const configured = process.env.HERDR_BIN_PATH;
  if (configured && fs.existsSync(configured)) return configured;
  return "herdr";
}

function decodeFrame(line: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)) as unknown;
  } catch {
    throw new Error("Herdr returned malformed JSON or UTF-8.");
  }
}

function rpc<T = unknown>(
  method: string,
  params: JsonObject = {},
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const socketPath = herdrSocketPath();
  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  const id = `pi-herdr:${process.pid}:${++requestSequence}:${method}`;

  return new Promise<T>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = Buffer.alloc(0);
    let bytes = 0;
    let settled = false;

    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      if (error) reject(error);
      else resolve(value as T);
    };

    const failure = (message: string, code?: string): HerdrRpcFailure => {
      const error = new Error(message) as HerdrRpcFailure;
      error.method = method;
      if (code) error.code = code;
      return error;
    };

    const onAbort = () => finish(failure(`Herdr RPC '${method}' was aborted.`));
    const timer = setTimeout(
      () => finish(failure(`Herdr RPC '${method}' timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
    timer.unref?.();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });

    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_RPC_BYTES) {
        finish(failure(`Herdr RPC '${method}' response exceeded ${MAX_RPC_BYTES} bytes.`));
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(10);
      if (newline < 0) return;

      let frame: unknown;
      try {
        frame = decodeFrame(buffer.subarray(0, newline));
      } catch (error) {
        finish(failure(`Herdr RPC '${method}' returned malformed JSON: ${String(error)}`));
        return;
      }
      const record = frame as {
        id?: unknown;
        result?: unknown;
        error?: { code?: unknown; message?: unknown };
      };
      if (record.error) {
        finish(
          failure(
            `Herdr RPC '${method}' failed (${String(record.error.code ?? "error")}): ${String(record.error.message ?? "unknown error")}`,
            typeof record.error.code === "string" ? record.error.code : undefined,
          ),
        );
        return;
      }
      if (record.id !== id) {
        finish(failure(`Herdr RPC '${method}' response id mismatch.`));
        return;
      }
      finish(undefined, record.result as T);
    });

    socket.on("error", (error) =>
      finish(failure(`Herdr RPC '${method}' transport error: ${error.message}`)),
    );
    socket.on("close", () => {
      if (!settled) finish(failure(`Herdr RPC '${method}' closed before a response.`));
    });
  });
}

interface WatchResult {
  events: unknown[];
  timedOut: boolean;
  error?: string;
}

function watchEvents(
  subscriptions: unknown[],
  durationMs: number,
  maxEvents: number,
  signal?: AbortSignal,
): Promise<WatchResult> {
  const socketPath = herdrSocketPath();
  const id = `pi-herdr:${process.pid}:${++requestSequence}:events.subscribe`;
  const boundedDuration = Math.max(50, Math.min(durationMs, MAX_WATCH_MS));

  return new Promise<WatchResult>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const events: unknown[] = [];
    let buffer = Buffer.alloc(0);
    let bytes = 0;
    let acknowledged = false;
    let settled = false;

    const finish = (timedOut = false, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(durationTimer);
      clearTimeout(ackTimer);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      if (!acknowledged && error) reject(new Error(error));
      else resolve({ events, timedOut, ...(error ? { error } : {}) });
    };

    const onAbort = () => finish(false, "watch aborted");
    const durationTimer = setTimeout(() => finish(true), boundedDuration);
    const ackTimer = setTimeout(
      () => finish(false, "Herdr subscription acknowledgement timed out."),
      15_000,
    );
    durationTimer.unref?.();
    ackTimer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({ id, method: "events.subscribe", params: { subscriptions } })}\n`,
      );
    });

    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_RPC_BYTES * 32) {
        finish(false, "Herdr subscription exceeded its byte bound.");
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const newline = buffer.indexOf(10);
        if (newline < 0) break;
        const line = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);

        let frame: unknown;
        try {
          frame = decodeFrame(line);
        } catch (error) {
          finish(false, `Herdr subscription returned malformed JSON: ${String(error)}`);
          return;
        }
        const record = frame as {
          id?: unknown;
          result?: { type?: unknown; event?: unknown; data?: unknown };
          error?: { code?: unknown; message?: unknown };
        };

        if (!acknowledged) {
          if (record.error) {
            finish(
              false,
              `Herdr subscription failed (${String(record.error.code ?? "error")}): ${String(record.error.message ?? "unknown error")}`,
            );
            return;
          }
          if (record.id !== id) {
            finish(
              false,
              "Herdr subscription returned an unexpected frame before acknowledgement.",
            );
            return;
          }
          if (record.result?.type !== "subscription_started") {
            finish(false, "Herdr subscription returned an invalid acknowledgement.");
            return;
          }
          acknowledged = true;
          clearTimeout(ackTimer);
          continue;
        }

        if (record.error) {
          finish(
            false,
            `Herdr subscription failed (${String(record.error.code ?? "error")}): ${String(record.error.message ?? "unknown error")}`,
          );
          return;
        }
        events.push(record.result ?? frame);
        if (events.length >= maxEvents) {
          finish(false);
          return;
        }
      }
    });

    socket.on("error", (error) =>
      finish(false, `Herdr subscription transport error: ${error.message}`),
    );
    socket.on("close", () => {
      if (!settled) finish(false, acknowledged ? "Herdr subscription closed." : undefined);
    });
  });
}

function clipText(
  text: string,
  options: { tail?: boolean } = {},
): {
  text: string;
  truncated: boolean;
  fullOutputPath?: string;
} {
  if (Buffer.byteLength(text) <= MAX_MODEL_BYTES) {
    return { text, truncated: false };
  }
  const fullOutputPath = path.join(
    os.tmpdir(),
    `herdr-${Date.now()}-${randomBytes(6).toString("hex")}.txt`,
  );
  fs.writeFileSync(fullOutputPath, text, { mode: 0o600 });
  const preview = options.tail ? text.slice(-MAX_MODEL_BYTES) : text.slice(0, MAX_MODEL_BYTES);
  return {
    text: `${options.tail ? "[showing tail]" : "[showing head]"}\n${preview}\n\n[full output at ${fullOutputPath}]`,
    truncated: true,
    fullOutputPath,
  };
}

function formatJson(value: unknown): { text: string; details?: JsonObject } {
  const raw = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
  const clipped = clipText(raw);
  return {
    text: clipped.text,
    ...(clipped.truncated
      ? { details: { truncated: true, fullOutputPath: clipped.fullOutputPath } }
      : {}),
  };
}

function textResult(text: string, details: JsonObject = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

function jsonResult(value: unknown, details: JsonObject = {}) {
  const rendered = formatJson(value);
  return textResult(rendered.text, { ...details, ...rendered.details });
}

function compactAgent(agent: JsonObject): string {
  const name = typeof agent.name === "string" ? agent.name : "(root)";
  const status = typeof agent.agent_status === "string" ? agent.agent_status : "?";
  const pane = typeof agent.pane_id === "string" ? agent.pane_id : "?";
  const cwd = typeof agent.cwd === "string" ? agent.cwd : "";
  const title =
    typeof agent.terminal_title_stripped === "string" ? ` · ${agent.terminal_title_stripped}` : "";
  return `${pane.padEnd(8)} ${status.padEnd(8)} ${name.padEnd(16)} ${cwd}${title}`;
}

function agentListText(agents: JsonObject[]): string {
  if (agents.length === 0) return "No agents.";
  return agents.map(compactAgent).join("\n");
}

function paneListText(panes: JsonObject[]): string {
  if (panes.length === 0) return "No panes.";
  return panes
    .map((pane) => {
      const id = String(pane.pane_id ?? "?");
      const workspace = String(pane.workspace_id ?? "?");
      const tab = String(pane.tab_id ?? "?");
      const status = String(pane.agent_status ?? "?");
      const title = String(pane.terminal_title_stripped ?? "");
      return `${id.padEnd(8)} ${workspace}/${tab} ${status.padEnd(8)} ${title}`;
    })
    .join("\n");
}

function cleanPaneLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^[─│╭╮╰╯├┤┬┴┼┌┐└┘]+$/u.test(trimmed)) return false;
      if (/^─+\s*custom\s*─+$/u.test(trimmed)) return false;
      if (trimmed.startsWith("[TokenBloat]")) return false;
      if (/[↑↓].*[↑↓]/u.test(trimmed)) return false;
      if (/\b\d{2}:\d{2}\b/u.test(trimmed) && /\bbase\b/u.test(trimmed)) return false;
      if (/active agent ·/u.test(trimmed)) return false;
      return true;
    });
}

function lastLine(lines: string[]): string {
  return (lines.at(-1) ?? "")
    .replace(/^[\s⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]+/u, "")
    .trim()
    .slice(0, 180);
}

type FleetKind = "decision" | "blocked" | "working" | "idle" | "unknown";
const FleetOrder: Record<FleetKind, number> = {
  decision: 0,
  blocked: 0,
  working: 1,
  unknown: 2,
  idle: 3,
};

function classifyFleet(status: string, lines: string[]): FleetKind {
  if (status === "blocked") return "blocked";
  if (/\?\s*$/u.test(lines.at(-1) ?? "")) return "decision";
  if (status === "working") return "working";
  if (status === "unknown") return "unknown";
  return "idle";
}

interface FleetRow {
  kind: FleetKind;
  workspace: string;
  pane: string;
  name: string;
  status: string;
  last: string;
}

function fleetText(rows: FleetRow[], counts: Record<string, number>): string {
  const lines = [
    `fleet digest: ${rows.length} agents  ` +
      Object.entries(counts)
        .map(([kind, count]) => `${kind}=${count}`)
        .join("  "),
    "",
    "  workspace          session                status   last output",
    "",
  ];
  const titles: Record<FleetKind, string> = {
    decision: "NEEDS A DECISION",
    blocked: "BLOCKED",
    working: "WORKING",
    unknown: "UNKNOWN",
    idle: "IDLE",
  };
  let current: FleetKind | undefined;
  for (const row of rows) {
    if (row.kind !== current) {
      current = row.kind;
      lines.push(titles[row.kind]);
    }
    const label = row.name === "(root)" ? `pane ${row.pane}` : row.name;
    lines.push(
      `  ${row.workspace.padEnd(18)} ${label.padEnd(22)} ${row.status.padEnd(8)} ${row.last}`,
    );
  }
  return lines.join("\n");
}

function schemaFamilies(doc: SchemaDoc): string {
  const methods = methodNames(doc);
  const families = new Map<string, string[]>();
  for (const method of methods) {
    const family = method.includes(".") ? method.slice(0, method.indexOf(".")) : method;
    const list = families.get(family) ?? [];
    list.push(method);
    families.set(family, list);
  }
  return [...families.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([family, names]) => `${family} (${names.length}): ${names.sort().join(", ")}`)
    .join("\n");
}

function methodNames(doc: SchemaDoc): string[] {
  return (doc.schemas?.request?.oneOf ?? [])
    .map((entry) => entry.properties?.method?.const)
    .filter((value): value is string => typeof value === "string")
    .sort();
}

function methodEntry(doc: SchemaDoc, method: string): { params?: unknown } | undefined {
  return (doc.schemas?.request?.oneOf ?? []).find(
    (entry) => entry.properties?.method?.const === method,
  )?.properties;
}

function defsOf(doc: SchemaDoc): Record<string, unknown> {
  return doc.schemas?.request?.$defs ?? {};
}

function resolveRef(doc: SchemaDoc, ref: unknown): unknown {
  if (typeof ref !== "string" || !ref.startsWith("#/schemas/request/$defs/")) return undefined;
  return defsOf(doc)[ref.slice("#/schemas/request/$defs/".length)];
}

function typeLabel(schema: unknown, depth = 0): string {
  if (!schema || typeof schema !== "object" || depth > 4) return "unknown";
  const node = schema as JsonObject;
  if (typeof node.$ref === "string") return node.$ref.split("/").at(-1) ?? "ref";
  if (Array.isArray(node.enum)) return `enum(${node.enum.join("|")})`;
  if (typeof node.type === "string") {
    if (node.type === "array" && node.items) return `array<${typeLabel(node.items, depth + 1)}>`;
    return node.type;
  }
  if (Array.isArray(node.anyOf))
    return node.anyOf.map((item) => typeLabel(item, depth + 1)).join("|");
  if (Array.isArray(node.oneOf))
    return node.oneOf.map((item) => typeLabel(item, depth + 1)).join("|");
  if (node.properties) return "object";
  return "unknown";
}

function signature(doc: SchemaDoc, method: string): string {
  const entry = methodEntry(doc, method);
  if (!entry) return `${method}(?)`;
  const params = entry.params;
  if (!params || typeof params !== "object") return `${method}()`;
  const node = params as JsonObject;
  if (typeof node.$ref === "string") {
    const resolved = resolveRef(doc, node.$ref) as JsonObject | undefined;
    if (!resolved) return `${method}(...)`;
    const required = new Set(
      Array.isArray(resolved.required)
        ? resolved.required.filter((item) => typeof item === "string")
        : [],
    );
    const properties = (resolved.properties ?? {}) as Record<string, unknown>;
    const args = Object.entries(properties).map(
      ([name, schema]) => `${name}${required.has(name) ? "" : "?"}: ${typeLabel(schema)}`,
    );
    return `${method}(${args.join(", ")})`;
  }
  return `${method}(...)`;
}

function collectRefs(
  value: unknown,
  doc: SchemaDoc,
  seen = new Set<string>(),
  out: Record<string, unknown> = {},
) {
  if (!value || typeof value !== "object") return out;
  const node = value as JsonObject;
  if (typeof node.$ref === "string") {
    const name = node.$ref.split("/").at(-1);
    if (name && !seen.has(name)) {
      seen.add(name);
      const resolved = resolveRef(doc, node.$ref);
      if (resolved) {
        out[name] = resolved;
        collectRefs(resolved, doc, seen, out);
      }
    }
  }
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const item of child) collectRefs(item, doc, seen, out);
    } else {
      collectRefs(child, doc, seen, out);
    }
  }
  return out;
}

const execFileAsync = promisify(execFile);

function loadSchema(refresh = false, signal?: AbortSignal): Promise<SchemaDoc> {
  if (!refresh && schemaCache) return Promise.resolve(schemaCache.doc);
  return loadSchemaUncached(signal);
}

async function loadSchemaUncached(signal?: AbortSignal): Promise<SchemaDoc> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(herdrBin(), ["api", "schema", "--json"], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      signal,
    }));
  } catch (error) {
    const failure = error as {
      message: string;
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    if (failure.code === undefined) {
      throw new Error(`Could not run herdr api schema: ${failure.message}`);
    }
    throw new Error(
      `herdr api schema failed with code ${failure.code}: ${(failure.stderr || failure.stdout || "").trim()}`,
    );
  }
  let doc: SchemaDoc;
  try {
    doc = JSON.parse(stdout) as SchemaDoc;
  } catch (error) {
    throw new Error(`Could not parse herdr api schema: ${String(error)}`);
  }
  schemaCache = { doc, fetchedAt: Date.now() };
  return doc;
}

function catalogText(doc: SchemaDoc, search?: string): string {
  const methods = methodNames(doc);
  if (!search) {
    return [
      `Herdr schema protocol ${doc.protocol ?? "?"} version ${doc.schema_version ?? "?"}`,
      `${methods.length} methods:`,
      "",
      schemaFamilies(doc),
      "",
      "Use search to narrow, or method to return the request schema.",
    ].join("\n");
  }
  const terms = search
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
  const matches = methods
    .map((method) => ({ method, line: signature(doc, method) }))
    .filter((entry) => {
      const haystack = `${entry.method} ${entry.line}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .map((entry) => ({
      ...entry,
      methodHits: terms.filter((term) => entry.method.toLowerCase().includes(term)).length,
    }))
    .sort(
      (left, right) =>
        right.methodHits - left.methodHits || left.method.localeCompare(right.method),
    );
  if (matches.length === 0) return `No methods matched '${search}'.`;
  const shown = matches.slice(0, 60);
  return [
    `${matches.length} match${matches.length === 1 ? "" : "es"} for '${search}':`,
    "",
    ...shown.map((entry) => entry.line),
    ...(matches.length > shown.length ? ["", `[showing ${shown.length}; narrow the search]`] : []),
  ].join("\n");
}

const FleetParams = Type.Object({
  action: StringEnum(FleetActions, {
    description: "status is cheap. digest reads pane tails and groups work by attention.",
  }),
  workspace: Type.Optional(
    Type.String({ description: "Filter by workspace id or label. Applies to digest." }),
  ),
  only: Type.Optional(
    StringEnum(["all", "attention", "questions"] as const, {
      description:
        "Digest filter. attention = decision/blocked/working; questions = decision/blocked.",
    }),
  ),
  lines: Type.Optional(
    Type.Integer({
      minimum: 4,
      maximum: 200,
      description: `Pane lines to read for digest. Default ${DEFAULT_DIGEST_LINES}.`,
    }),
  ),
  include_self: Type.Optional(
    Type.Boolean({ description: "Include the calling pane. Default false." }),
  ),
});

const AgentParams = Type.Object({
  action: StringEnum(AgentActions, {
    description: "Agent lifecycle action.",
  }),
  target: Type.Optional(
    Type.String({ description: "Unique live agent name or the pane id hosting it." }),
  ),
  name: Type.Optional(Type.String({ description: "For start: unique agent name." })),
  kind: Type.Optional(
    Type.String({
      description: "For start: agent kind, such as pi, claude, codex, cursor, gemini, opencode.",
    }),
  ),
  pane_id: Type.Optional(Type.String({ description: "For start: existing shell pane id." })),
  args: Type.Optional(
    Type.Array(Type.String(), {
      description: "For start: native agent arguments after the executable.",
    }),
  ),
  text: Type.Optional(Type.String({ description: "For prompt: text to submit." })),
  wait: Type.Optional(
    Type.Boolean({
      description:
        "For prompt: wait for a settled state. Default true. Set false to acknowledge submission only.",
    }),
  ),
  until: Type.Optional(
    Type.Array(StringEnum(AgentStatuses), {
      description: "Statuses to wait for. Default idle, done, blocked.",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 600_000,
      description: "Operation timeout in milliseconds.",
    }),
  ),
  source: Type.Optional(
    StringEnum(ReadSources, {
      description: `For read: read source. Default recent_unwrapped.`,
    }),
  ),
  lines: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 5000, description: "For read: line count. Default 80." }),
  ),
  format: Type.Optional(StringEnum(ReadFormats, { description: "For read: text or ansi." })),
  strip_ansi: Type.Optional(
    Type.Boolean({ description: "For read: strip ANSI escapes. Default true." }),
  ),
  keys: Type.Optional(
    Type.Array(Type.String(), {
      description: "For send_keys: logical keys such as enter, esc, ctrl+c.",
    }),
  ),
  new_name: Type.Optional(Type.String({ description: "For rename: new agent name." })),
  wait_for_ready: Type.Optional(
    Type.Boolean({
      description:
        "For start: poll until interactive_ready. Default true. Handles server 0.9.1 launch_pending.",
    }),
  ),
});

const PaneParams = Type.Object({
  action: StringEnum(PaneActions, { description: "Pane topology or terminal action." }),
  pane_id: Type.Optional(Type.String({ description: "Target pane id." })),
  workspace_id: Type.Optional(Type.String({ description: "For list: filter by workspace." })),
  direction: Type.Optional(
    StringEnum(["left", "right", "up", "down"] as const, {
      description: "Direction for split, focus_direction, neighbor, or resize.",
    }),
  ),
  ratio: Type.Optional(
    Type.Number({ minimum: 0, maximum: 1, description: "For split: new pane ratio." }),
  ),
  cwd: Type.Optional(Type.String({ description: "For split: working directory." })),
  env: Type.Optional(
    Type.Record(Type.String(), Type.String(), { description: "For split: environment variables." }),
  ),
  focus: Type.Optional(
    Type.Boolean({ description: "For split: focus the new pane. Default false." }),
  ),
  right_click: Type.Optional(
    StringEnum(["herdr", "pane"] as const, {
      description: "For split/input_set: right-click policy.",
    }),
  ),
  source: Type.Optional(
    StringEnum(ReadSources, {
      description: "For read/wait_output: read source. Default recent_unwrapped.",
    }),
  ),
  lines: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 5000, description: "For read/wait_output: line count." }),
  ),
  format: Type.Optional(StringEnum(ReadFormats, { description: "For read: text or ansi." })),
  strip_ansi: Type.Optional(
    Type.Boolean({ description: "For read/wait_output: strip ANSI. Default true." }),
  ),
  command: Type.Optional(
    Type.String({ description: "For run: shell command to submit with Enter." }),
  ),
  match_type: Type.Optional(
    StringEnum(["substring", "regex"] as const, { description: "For wait_output: match type." }),
  ),
  match_value: Type.Optional(
    Type.String({ description: "For wait_output: literal or regex pattern." }),
  ),
  timeout_ms: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 600_000,
      description: "For wait_output: timeout. Default 120000.",
    }),
  ),
  mode: Type.Optional(
    StringEnum(["toggle", "on", "off"] as const, {
      description: "For zoom: mode. Default toggle.",
    }),
  ),
  label: Type.Optional(Type.String({ description: "For rename: new pane label." })),
  text: Type.Optional(Type.String({ description: "For send_text: literal text." })),
  keys: Type.Optional(
    Type.Array(Type.String(), {
      description: "For send_keys: logical keys such as enter, esc, ctrl+c.",
    }),
  ),
  amount: Type.Optional(Type.Number({ description: "For resize: amount, such as 0.1." })),
});

const WorkspaceParams = Type.Object({
  action: StringEnum(WorkspaceActions, { description: "Workspace action." }),
  workspace_id: Type.Optional(Type.String({ description: "Target workspace id." })),
  label: Type.Optional(Type.String({ description: "For create/rename: workspace label." })),
  cwd: Type.Optional(Type.String({ description: "For create: working directory." })),
  focus: Type.Optional(
    Type.Boolean({ description: "For create: focus the workspace. Default false." }),
  ),
  source_workspace_id: Type.Optional(
    Type.String({ description: "For create: workspace whose focused pane supplies follow cwd." }),
  ),
  env: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: "For create: environment variables.",
    }),
  ),
  close_group: Type.Optional(
    Type.Boolean({
      description: "For close: close linked worktree workspaces too. Default false.",
    }),
  ),
});

const TabParams = Type.Object({
  action: StringEnum(TabActions, { description: "Tab action." }),
  tab_id: Type.Optional(Type.String({ description: "Target tab id." })),
  workspace_id: Type.Optional(Type.String({ description: "For list/create: workspace id." })),
  label: Type.Optional(Type.String({ description: "For create/rename: tab label." })),
  cwd: Type.Optional(Type.String({ description: "For create: working directory." })),
  focus: Type.Optional(Type.Boolean({ description: "For create: focus the tab. Default false." })),
  env: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: "For create: environment variables.",
    }),
  ),
  insert_index: Type.Optional(
    Type.Integer({ minimum: 0, description: "For move: destination index." }),
  ),
});

const WorktreeParams = Type.Object({
  action: StringEnum(WorktreeActions, { description: "Worktree action." }),
  workspace_id: Type.Optional(Type.String({ description: "Source workspace id." })),
  cwd: Type.Optional(
    Type.String({ description: "Absolute repository path instead of workspace_id." }),
  ),
  branch: Type.Optional(Type.String({ description: "Branch to create or open." })),
  base: Type.Optional(Type.String({ description: "For create: base revision." })),
  path: Type.Optional(Type.String({ description: "For create/open: absolute checkout path." })),
  label: Type.Optional(Type.String({ description: "For create/open: workspace label." })),
  focus: Type.Optional(Type.Boolean({ description: "For create/open: focus. Default false." })),
  trust_repository: Type.Optional(
    Type.Boolean({
      description:
        "For create/open/remove: grant per-request Git trust. Use only after verification.",
    }),
  ),
  force: Type.Optional(
    Type.Boolean({ description: "For remove: force a dirty checkout removal. Default false." }),
  ),
});

const EventParams = Type.Object({
  action: StringEnum(EventActions, { description: "Event action." }),
  match_event: Type.Optional(
    Type.Record(Type.String(), Type.Any(), {
      description:
        "For wait: EventMatch object, such as { event: 'pane.agent_status_changed', pane_id: 'w1:p1' }.",
    }),
  ),
  subscriptions: Type.Optional(
    Type.Array(Type.Record(Type.String(), Type.Any()), {
      description: "For watch: Subscription entries. Use this or pane_ids.",
    }),
  ),
  pane_ids: Type.Optional(
    Type.Array(Type.String(), { description: "For watch: build one subscription per pane id." }),
  ),
  event: Type.Optional(
    StringEnum(["agent_status_changed", "output_matched", "scroll_changed"] as const, {
      description: "For watch with pane_ids: event type. Default agent_status_changed.",
    }),
  ),
  source: Type.Optional(
    StringEnum(ReadSources, { description: "For output_matched: read source." }),
  ),
  match_type: Type.Optional(
    StringEnum(["substring", "regex"] as const, { description: "For output_matched: match type." }),
  ),
  match_value: Type.Optional(Type.String({ description: "For output_matched: pattern." })),
  lines: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 5000, description: "For output_matched: line count." }),
  ),
  duration_ms: Type.Optional(
    Type.Integer({
      minimum: 50,
      maximum: MAX_WATCH_MS,
      description: "For watch: bounded duration. Default 60000.",
    }),
  ),
  max_events: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 1000,
      description: "For watch: stop after this many events. Default 100.",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 600_000,
      description: "For wait: timeout. Default 120000.",
    }),
  ),
});

const NotifyParams = Type.Object({
  action: StringEnum(NotifyActions, { description: "Notification action." }),
  title: Type.String({ description: "Notification title." }),
  body: Type.Optional(Type.String({ description: "Notification body." })),
  position: Type.Optional(
    StringEnum(["top-left", "top-right", "bottom-left", "bottom-right"] as const, {
      description: "Toast position when Herdr toast delivery is active.",
    }),
  ),
  sound: Type.Optional(
    StringEnum(["none", "done", "request"] as const, { description: "Notification sound." }),
  ),
});

const CallParams = Type.Object({
  method: Type.String({
    description:
      "Herdr socket method, such as ping, session.snapshot, pane.split, agent.prompt. Use herdr_catalog for the full list.",
  }),
  params: Type.Optional(
    Type.Record(Type.String(), Type.Any(), { description: "Method params object." }),
  ),
  timeout_ms: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 600_000, description: "RPC timeout. Default 30000." }),
  ),
});

const CatalogParams = Type.Object({
  search: Type.Optional(
    Type.String({
      description: "Filter method signatures by substring, such as 'agent prompt' or 'pane split'.",
    }),
  ),
  method: Type.Optional(
    Type.String({
      description: "Return the full request schema and referenced definitions for one method.",
    }),
  ),
  refresh: Type.Optional(Type.Boolean({ description: "Re-run herdr api schema. Default false." })),
});

function requireString(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function workspaceLabelMap(snapshot: JsonObject): Map<string, string> {
  const workspaces = Array.isArray(snapshot.workspaces) ? snapshot.workspaces : [];
  const labels = new Map<string, string>();
  for (const workspace of workspaces) {
    if (!workspace || typeof workspace !== "object") continue;
    const record = workspace as JsonObject;
    if (typeof record.workspace_id === "string") {
      labels.set(
        record.workspace_id,
        typeof record.label === "string" ? record.label : record.workspace_id,
      );
    }
  }
  return labels;
}

async function fleetStatus(signal?: AbortSignal) {
  const result = await rpc<{ snapshot?: JsonObject }>("session.snapshot", {}, { signal });
  const snapshot = result.snapshot ?? {};
  const agents = (Array.isArray(snapshot.agents) ? snapshot.agents : []).filter(
    (item): item is JsonObject => Boolean(item && typeof item === "object"),
  );
  const workspaces = (Array.isArray(snapshot.workspaces) ? snapshot.workspaces : []).filter(
    (item): item is JsonObject => Boolean(item && typeof item === "object"),
  );
  const counts = agents.reduce<Record<string, number>>((accumulator, agent) => {
    const status = String(agent.agent_status ?? "unknown");
    accumulator[status] = (accumulator[status] ?? 0) + 1;
    return accumulator;
  }, {});
  const labels = workspaceLabelMap(snapshot);
  const workspaceLines = workspaces.map((workspace) => {
    const id = String(workspace.workspace_id ?? "?");
    const label = String(workspace.label ?? id);
    const paneCount = String(workspace.pane_count ?? "?");
    const workspaceAgents = agents.filter((agent) => agent.workspace_id === id);
    const statuses = workspaceAgents.reduce<Record<string, number>>((accumulator, agent) => {
      const status = String(agent.agent_status ?? "unknown");
      accumulator[status] = (accumulator[status] ?? 0) + 1;
      return accumulator;
    }, {});
    const statusText = Object.entries(statuses)
      .map(([status, count]) => `${status}:${count}`)
      .join(" ");
    return `${id.padEnd(5)} ${label.padEnd(20)} panes=${paneCount} agents=${workspaceAgents.length}${
      statusText ? `  ${statusText}` : ""
    }`;
  });
  const focused = [snapshot.focused_workspace_id, snapshot.focused_tab_id, snapshot.focused_pane_id]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const text = [
    `Herdr ${String(snapshot.version ?? "?")} protocol ${String(snapshot.protocol ?? "?")}${
      focused ? `  focused ${focused}` : ""
    }`,
    `${workspaces.length} workspaces, ${agents.length} agents: ` +
      Object.entries(counts)
        .map(([status, count]) => `${status}=${count}`)
        .join("  "),
    "",
    workspaceLines.join("\n"),
  ].join("\n");
  return {
    text,
    details: { counts, labels: [...labels.entries()], workspaces: workspaceLines.length },
  };
}

async function fleetDigest(
  params: {
    workspace?: string;
    only?: "all" | "attention" | "questions";
    lines?: number;
    include_self?: boolean;
  },
  signal?: AbortSignal,
) {
  const result = await rpc<{ snapshot?: JsonObject }>("session.snapshot", {}, { signal });
  const snapshot = result.snapshot ?? {};
  const labels = workspaceLabelMap(snapshot);
  const selfPane = process.env.HERDR_PANE_ID;
  const filter = params.workspace?.toLowerCase();
  const only = params.only ?? "all";
  const lines = params.lines ?? DEFAULT_DIGEST_LINES;
  const agents = (Array.isArray(snapshot.agents) ? snapshot.agents : []).filter(
    (item): item is JsonObject => Boolean(item && typeof item === "object"),
  );

  const rows: FleetRow[] = [];
  for (const agent of agents) {
    const paneId = typeof agent.pane_id === "string" ? agent.pane_id : undefined;
    if (!paneId) continue;
    if (!params.include_self && paneId === selfPane) continue;
    const workspaceId = String(agent.workspace_id ?? "?");
    const label = labels.get(workspaceId) ?? workspaceId;
    if (filter && workspaceId.toLowerCase() !== filter && label.toLowerCase() !== filter) continue;

    let text = "";
    try {
      const read = await rpc<{ read?: { text?: unknown } }>(
        "pane.read",
        { pane_id: paneId, source: "recent_unwrapped", lines },
        { signal, timeoutMs: 10_000 },
      );
      text = typeof read.read?.text === "string" ? read.read.text : "";
    } catch (error) {
      text = `(read failed: ${error instanceof Error ? error.message : String(error)})`;
    }
    const cleaned = cleanPaneLines(text);
    const status = String(agent.agent_status ?? "unknown");
    const kind = classifyFleet(status, cleaned);
    if (only === "attention" && kind === "idle") continue;
    if (only === "questions" && kind !== "decision" && kind !== "blocked") continue;
    rows.push({
      kind,
      workspace: label,
      pane: paneId,
      name: typeof agent.name === "string" ? agent.name : "(root)",
      status,
      last: lastLine(cleaned),
    });
  }

  rows.sort((left, right) => FleetOrder[left.kind] - FleetOrder[right.kind]);
  const counts = rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.kind] = (accumulator[row.kind] ?? 0) + 1;
    return accumulator;
  }, {});
  return { text: fleetText(rows, counts), details: { rows, counts } };
}

export default function herdrExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "herdr_fleet",
    label: "Herdr Fleet",
    description:
      "Supervisor view of the Herdr fleet. status lists workspaces and agent-status counts cheaply. digest reads the last lines of each agent pane and groups sessions into NEEDS A DECISION, BLOCKED, WORKING, UNKNOWN, and IDLE. Read-only. Use this first when asked what is running, what needs attention, or which agents are stuck.",
    promptSnippet: "Supervisor status and attention digest for Herdr agents and panes",
    promptGuidelines: [
      "Use herdr_fleet digest before asking the user for a status update; it reads the live panes without waking agents.",
      "Treat a digest row as a claim from the session, not external truth. Verify outcomes with git, CI, PR, Slack, or the relevant service before closing work.",
    ],
    parameters: FleetParams,
    exposure: "deferred",
    namespace: HerdrNamespace,
    annotations: { readOnlyHint: true, openWorldHint: false },
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (params.action === "status") {
        const status = await fleetStatus(signal);
        return textResult(status.text, status.details);
      }
      const digest = await fleetDigest(params, signal);
      return textResult(digest.text, digest.details);
    },
  });

  pi.registerTool({
    name: "herdr_agent",
    label: "Herdr Agent",
    description:
      "Inspect and control Herdr agents: list, get, read, start, prompt, wait, send_keys, rename, focus, explain. start activates an existing shell pane; prompt submits a real turn to a pi/Claude/Codex/other interactive agent and can wait for idle, done, or blocked. Handles the Herdr 0.9.1 launch_pending and agent_pane_busy startup races.",
    promptSnippet: "List, start, prompt, wait on, read, or key Herdr agents",
    promptGuidelines: [
      "Do not prompt a working agent unless you intend to steer or queue into the active turn.",
      "When prompt returns agent_blocked, read the pane and ask the user before answering an approval or question.",
      "Agent status is a claim. Use files, git, CI, or the service as external truth.",
    ],
    parameters: AgentParams,
    exposure: "deferred",
    namespace: HerdrNamespace,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      switch (params.action) {
        case "list": {
          const result = await rpc<{ agents?: JsonObject[] }>("agent.list", {}, { signal });
          const agents = (result.agents ?? []).filter((item): item is JsonObject =>
            Boolean(item && typeof item === "object"),
          );
          return textResult(agentListText(agents), { count: agents.length, agents });
        }
        case "get": {
          const target = requireString(params.target, "target");
          const result = await rpc("agent.get", { target }, { signal });
          return jsonResult(result, { target });
        }
        case "read": {
          const target = requireString(params.target, "target");
          const result = await rpc<{ read?: { text?: unknown } }>(
            "agent.read",
            {
              target,
              source: params.source ?? "recent_unwrapped",
              lines: params.lines ?? DEFAULT_READ_LINES,
              format: params.format ?? "text",
              strip_ansi: params.strip_ansi ?? true,
            },
            { signal },
          );
          const text = typeof result.read?.text === "string" ? result.read.text : "";
          const clipped = clipText(text, { tail: true });
          return textResult(clipped.text, {
            target,
            ...(clipped.truncated
              ? { truncated: true, fullOutputPath: clipped.fullOutputPath }
              : {}),
          });
        }
        case "start": {
          const name = requireString(params.name, "name");
          const kind = requireString(params.kind, "kind");
          const paneId = requireString(params.pane_id, "pane_id");
          const timeoutMs = params.timeout_ms ?? DEFAULT_START_TIMEOUT_MS;
          const busyDeadline = Date.now() + 45_000;
          let started: unknown;
          for (;;) {
            try {
              started = await rpc(
                "agent.start",
                {
                  name,
                  kind,
                  pane_id: paneId,
                  args: params.args ?? [],
                  timeout_ms: timeoutMs,
                },
                { signal, timeoutMs: timeoutMs + 15_000 },
              );
              break;
            } catch (error) {
              const failure = error as HerdrRpcFailure;
              if (failure.code === "agent_not_ready") {
                started = { type: "agent_not_ready", error: failure.message };
                break;
              }
              const busy =
                failure.code === "agent_pane_busy" ||
                /not an available shell/u.test(failure.message);
              if (!busy || Date.now() >= busyDeadline) throw error;
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }

          if (params.wait_for_ready === false) {
            return jsonResult({ started }, { name, kind, paneId });
          }

          const readyDeadline = Date.now() + timeoutMs;
          let agent: JsonObject | undefined;
          while (Date.now() < readyDeadline) {
            try {
              const current = await rpc<{ agent?: JsonObject }>(
                "agent.get",
                { target: name },
                { signal, timeoutMs: 5_000 },
              );
              agent = current.agent;
              if (agent?.agent_status === "blocked") break;
              if (agent?.interactive_ready === true && agent.launch_pending !== true) break;
            } catch {
              // The name is not active yet; keep polling until the deadline.
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (!agent) {
            return jsonResult(
              {
                started,
                warning: `agent ${name} did not report interactive_ready within ${timeoutMs}ms`,
              },
              { name, kind, paneId, ready: false },
            );
          }
          return textResult(
            `started ${name} (${kind}) in ${paneId}; status=${String(agent.agent_status ?? "?")}` +
              (agent.agent_status === "blocked" ? " — blocked during startup" : ""),
            { name, kind, paneId, started, agent },
          );
        }
        case "prompt": {
          const target = requireString(params.target, "target");
          const text = requireString(params.text, "text");
          const timeoutMs = params.timeout_ms ?? DEFAULT_PROMPT_TIMEOUT_MS;
          const wait =
            params.wait === false
              ? undefined
              : {
                  timeout_ms: timeoutMs,
                  ...(params.until?.length ? { until: params.until } : {}),
                };
          const result = await rpc(
            "agent.prompt",
            { target, text, ...(wait ? { wait } : {}) },
            { signal, timeoutMs: timeoutMs + 15_000 },
          );
          return jsonResult(result, { target, waited: Boolean(wait) });
        }
        case "wait": {
          const target = requireString(params.target, "target");
          const timeoutMs = params.timeout_ms ?? DEFAULT_PROMPT_TIMEOUT_MS;
          const result = await rpc(
            "agent.wait",
            {
              target,
              until: params.until?.length ? params.until : ["idle", "done", "blocked"],
              timeout_ms: timeoutMs,
            },
            { signal, timeoutMs: timeoutMs + 15_000 },
          );
          return jsonResult(result, { target });
        }
        case "send_keys": {
          const target = requireString(params.target, "target");
          if (!params.keys?.length) throw new Error("keys is required.");
          const result = await rpc("agent.send_keys", { target, keys: params.keys }, { signal });
          return jsonResult(result, { target, keys: params.keys });
        }
        case "rename": {
          const target = requireString(params.target, "target");
          const newName = requireString(params.new_name, "new_name");
          const result = await rpc("agent.rename", { target, name: newName }, { signal });
          return jsonResult(result, { target, newName });
        }
        case "focus": {
          const target = requireString(params.target, "target");
          const result = await rpc("agent.focus", { target }, { signal });
          return jsonResult(result, { target });
        }
        case "explain": {
          const target = requireString(params.target, "target");
          const result = await rpc("agent.explain", { target }, { signal });
          return jsonResult(result, { target });
        }
      }
    },
  });

  pi.registerTool({
    name: "herdr_pane",
    label: "Herdr Pane",
    description:
      "Inspect and control Herdr panes: list, get, current, layout, process_info, split, read, run, wait_output, close, zoom, focus_direction, rename, send_text, send_keys, neighbor, edges, resize, input_set. split creates a sibling pane; run submits a shell command with Enter; wait_output blocks on a literal or regex. Use herdr_call for pane.move, pane.swap, and report methods.",
    promptSnippet: "Create, read, run in, wait on, and close Herdr panes",
    promptGuidelines: [
      "Use --no-focus semantics (focus: false) for background workers unless the user asked to switch context.",
      "Do not close a pane you did not create unless the user explicitly asked.",
      "Prefer agent.prompt for a recognized agent; use pane.run only for a shell pane.",
    ],
    parameters: PaneParams,
    exposure: "deferred",
    namespace: HerdrNamespace,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const paneId = params.pane_id;
      switch (params.action) {
        case "list": {
          const result = await rpc<{ panes?: JsonObject[] }>(
            "pane.list",
            params.workspace_id ? { workspace_id: params.workspace_id } : {},
            { signal },
          );
          const panes = (result.panes ?? []).filter((item): item is JsonObject =>
            Boolean(item && typeof item === "object"),
          );
          return textResult(paneListText(panes), { count: panes.length, panes });
        }
        case "get": {
          const id = requireString(paneId, "pane_id");
          return jsonResult(await rpc("pane.get", { pane_id: id }, { signal }), { paneId: id });
        }
        case "current": {
          const caller = paneId ?? process.env.HERDR_PANE_ID;
          return jsonResult(
            await rpc("pane.current", caller ? { caller_pane_id: caller } : {}, { signal }),
            { caller: caller ?? null },
          );
        }
        case "layout": {
          return jsonResult(
            await rpc("pane.layout", paneId ? { pane_id: paneId } : {}, { signal }),
            { paneId: paneId ?? null },
          );
        }
        case "process_info": {
          return jsonResult(
            await rpc("pane.process_info", paneId ? { pane_id: paneId } : {}, { signal }),
            { paneId: paneId ?? null },
          );
        }
        case "split": {
          const direction = params.direction;
          if (direction !== "right" && direction !== "down") {
            throw new Error("direction must be right or down for split.");
          }
          const target = paneId ?? process.env.HERDR_PANE_ID;
          const result = await rpc(
            "pane.split",
            {
              ...(target ? { target_pane_id: target } : {}),
              direction,
              ...(params.ratio !== undefined ? { ratio: params.ratio } : {}),
              ...(params.cwd ? { cwd: params.cwd } : {}),
              ...(params.env ? { env: params.env } : {}),
              focus: params.focus ?? false,
              ...(params.right_click ? { right_click: params.right_click } : {}),
            },
            { signal },
          );
          return jsonResult(result, { target: target ?? null, direction });
        }
        case "read": {
          const id = requireString(paneId, "pane_id");
          const result = await rpc<{ read?: { text?: unknown } }>(
            "pane.read",
            {
              pane_id: id,
              source: params.source ?? "recent_unwrapped",
              lines: params.lines ?? DEFAULT_READ_LINES,
              format: params.format ?? "text",
              strip_ansi: params.strip_ansi ?? true,
            },
            { signal },
          );
          const text = typeof result.read?.text === "string" ? result.read.text : "";
          const clipped = clipText(text, { tail: true });
          return textResult(clipped.text, {
            paneId: id,
            ...(clipped.truncated
              ? { truncated: true, fullOutputPath: clipped.fullOutputPath }
              : {}),
          });
        }
        case "run": {
          const id = requireString(paneId, "pane_id");
          const command = requireString(params.command, "command");
          const result = await rpc(
            "pane.send_input",
            { pane_id: id, text: command, keys: ["enter"] },
            { signal },
          );
          return jsonResult(result, { paneId: id, command });
        }
        case "wait_output": {
          const id = requireString(paneId, "pane_id");
          const value = requireString(params.match_value, "match_value");
          const timeoutMs = params.timeout_ms ?? DEFAULT_PROMPT_TIMEOUT_MS;
          const result = await rpc(
            "pane.wait_for_output",
            {
              pane_id: id,
              source: params.source ?? "recent_unwrapped",
              match: { type: params.match_type ?? "substring", value },
              lines: params.lines ?? DEFAULT_READ_LINES,
              strip_ansi: params.strip_ansi ?? true,
              timeout_ms: timeoutMs,
            },
            { signal, timeoutMs: timeoutMs + 15_000 },
          );
          return jsonResult(result, { paneId: id, match: value });
        }
        case "close": {
          const id = requireString(paneId, "pane_id");
          const result = await rpc("pane.close", { pane_id: id }, { signal });
          return jsonResult(result, { paneId: id });
        }
        case "zoom": {
          const result = await rpc(
            "pane.zoom",
            { ...(paneId ? { pane_id: paneId } : {}), mode: params.mode ?? "toggle" },
            { signal },
          );
          return jsonResult(result, { paneId: paneId ?? null });
        }
        case "focus_direction": {
          const direction = requireString(params.direction, "direction");
          const result = await rpc(
            "pane.focus_direction",
            { direction, ...(paneId ? { pane_id: paneId } : {}) },
            { signal },
          );
          return jsonResult(result, { paneId: paneId ?? null, direction });
        }
        case "rename": {
          const id = requireString(paneId, "pane_id");
          const result = await rpc(
            "pane.rename",
            { pane_id: id, ...(params.label !== undefined ? { label: params.label } : {}) },
            { signal },
          );
          return jsonResult(result, { paneId: id, label: params.label ?? null });
        }
        case "send_text": {
          const id = requireString(paneId, "pane_id");
          const text = requireString(params.text, "text");
          return jsonResult(await rpc("pane.send_text", { pane_id: id, text }, { signal }), {
            paneId: id,
          });
        }
        case "send_keys": {
          const id = requireString(paneId, "pane_id");
          if (!params.keys?.length) throw new Error("keys is required.");
          return jsonResult(
            await rpc("pane.send_keys", { pane_id: id, keys: params.keys }, { signal }),
            { paneId: id, keys: params.keys },
          );
        }
        case "neighbor": {
          const direction = requireString(params.direction, "direction");
          return jsonResult(
            await rpc(
              "pane.neighbor",
              { direction, ...(paneId ? { pane_id: paneId } : {}) },
              { signal },
            ),
            { paneId: paneId ?? null, direction },
          );
        }
        case "edges": {
          return jsonResult(
            await rpc("pane.edges", paneId ? { pane_id: paneId } : {}, { signal }),
            { paneId: paneId ?? null },
          );
        }
        case "resize": {
          const direction = requireString(params.direction, "direction");
          return jsonResult(
            await rpc(
              "pane.resize",
              {
                direction,
                ...(paneId ? { pane_id: paneId } : {}),
                ...(params.amount !== undefined ? { amount: params.amount } : {}),
              },
              { signal },
            ),
            { paneId: paneId ?? null, direction },
          );
        }
        case "input_set": {
          const id = requireString(paneId, "pane_id");
          const rightClick = requireString(params.right_click, "right_click");
          if (rightClick !== "herdr" && rightClick !== "pane") {
            throw new Error("right_click must be herdr or pane.");
          }
          return jsonResult(
            await rpc("pane.input.set", { pane_id: id, right_click: rightClick }, { signal }),
            { paneId: id, rightClick },
          );
        }
      }
    },
  });

  pi.registerTool({
    name: "herdr_workspace",
    label: "Herdr Workspace",
    description:
      "List, inspect, create, focus, rename, or close Herdr workspaces. Workspace create also creates the first tab and root pane; read the returned ids.",
    promptSnippet: "Create, list, focus, rename, or close Herdr workspaces",
    promptGuidelines: [
      "Create workspaces with focus: false for background work unless the user asked to switch context.",
      "Do not close a workspace you did not create unless the user explicitly asked.",
    ],
    parameters: WorkspaceParams,
    exposure: "deferred",
    namespace: HerdrNamespace,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      switch (params.action) {
        case "list":
          return jsonResult(await rpc("workspace.list", {}, { signal }));
        case "get": {
          const id = requireString(params.workspace_id, "workspace_id");
          return jsonResult(await rpc("workspace.get", { workspace_id: id }, { signal }), {
            workspaceId: id,
          });
        }
        case "create": {
          const result = await rpc(
            "workspace.create",
            {
              ...(params.label !== undefined ? { label: params.label } : {}),
              ...(params.cwd ? { cwd: params.cwd } : {}),
              focus: params.focus ?? false,
              ...(params.source_workspace_id
                ? { source_workspace_id: params.source_workspace_id }
                : {}),
              ...(params.env ? { env: params.env } : {}),
            },
            { signal },
          );
          return jsonResult(result);
        }
        case "focus": {
          const id = requireString(params.workspace_id, "workspace_id");
          return jsonResult(await rpc("workspace.focus", { workspace_id: id }, { signal }), {
            workspaceId: id,
          });
        }
        case "rename": {
          const id = requireString(params.workspace_id, "workspace_id");
          const label = requireString(params.label, "label");
          return jsonResult(
            await rpc("workspace.rename", { workspace_id: id, label }, { signal }),
            {
              workspaceId: id,
              label,
            },
          );
        }
        case "close": {
          const id = requireString(params.workspace_id, "workspace_id");
          return jsonResult(
            await rpc(
              "workspace.close",
              { workspace_id: id, ...(params.close_group ? { close_group: true } : {}) },
              { signal },
            ),
            { workspaceId: id },
          );
        }
      }
    },
  });

  pi.registerTool({
    name: "herdr_tab",
    label: "Herdr Tab",
    description:
      "List, inspect, create, focus, rename, close, or move Herdr tabs. Tab create returns the new tab id and root pane id; use those for workers.",
    promptSnippet: "Create, list, focus, rename, close, or move Herdr tabs",
    promptGuidelines: [
      "Create tabs with focus: false for background work unless the user asked to switch context.",
      "Do not close a tab you did not create unless the user explicitly asked.",
    ],
    parameters: TabParams,
    exposure: "deferred",
    namespace: HerdrNamespace,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      switch (params.action) {
        case "list":
          return jsonResult(
            await rpc(
              "tab.list",
              params.workspace_id ? { workspace_id: params.workspace_id } : {},
              { signal },
            ),
          );
        case "get": {
          const id = requireString(params.tab_id, "tab_id");
          return jsonResult(await rpc("tab.get", { tab_id: id }, { signal }), { tabId: id });
        }
        case "create": {
          const result = await rpc(
            "tab.create",
            {
              ...(params.workspace_id ? { workspace_id: params.workspace_id } : {}),
              ...(params.label !== undefined ? { label: params.label } : {}),
              ...(params.cwd ? { cwd: params.cwd } : {}),
              focus: params.focus ?? false,
              ...(params.env ? { env: params.env } : {}),
            },
            { signal },
          );
          return jsonResult(result);
        }
        case "focus": {
          const id = requireString(params.tab_id, "tab_id");
          return jsonResult(await rpc("tab.focus", { tab_id: id }, { signal }), { tabId: id });
        }
        case "rename": {
          const id = requireString(params.tab_id, "tab_id");
          const label = requireString(params.label, "label");
          return jsonResult(await rpc("tab.rename", { tab_id: id, label }, { signal }), {
            tabId: id,
            label,
          });
        }
        case "close": {
          const id = requireString(params.tab_id, "tab_id");
          return jsonResult(await rpc("tab.close", { tab_id: id }, { signal }), { tabId: id });
        }
        case "move": {
          const id = requireString(params.tab_id, "tab_id");
          const insertIndex = params.insert_index;
          if (insertIndex === undefined) throw new Error("insert_index is required for move.");
          return jsonResult(
            await rpc("tab.move", { tab_id: id, insert_index: insertIndex }, { signal }),
            { tabId: id, insertIndex },
          );
        }
      }
    },
  });

  pi.registerTool({
    name: "herdr_worktree",
    label: "Herdr Worktree",
    description:
      "List, create, open, or remove Herdr worktree workspaces. Worktree create makes an isolated checkout and workspace; use it when a worker must not share a working tree with another writer.",
    promptSnippet: "Create and manage isolated Herdr worktree workspaces",
    promptGuidelines: [
      "Use worktree create before starting concurrent writers on the same repository.",
      "Use trust_repository only after the user has verified the repository.",
      "Do not remove a worktree you did not create unless the user explicitly asked.",
    ],
    parameters: WorktreeParams,
    exposure: "deferred",
    namespace: HerdrNamespace,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      switch (params.action) {
        case "list": {
          if (params.workspace_id && params.cwd)
            throw new Error("Use at most one of workspace_id or cwd.");
          return jsonResult(
            await rpc(
              "worktree.list",
              {
                ...(params.workspace_id ? { workspace_id: params.workspace_id } : {}),
                ...(params.cwd ? { cwd: params.cwd } : {}),
              },
              { signal },
            ),
          );
        }
        case "create":
          return jsonResult(
            await rpc(
              "worktree.create",
              {
                ...(params.workspace_id ? { workspace_id: params.workspace_id } : {}),
                ...(params.cwd ? { cwd: params.cwd } : {}),
                ...(params.branch ? { branch: params.branch } : {}),
                ...(params.base ? { base: params.base } : {}),
                ...(params.path ? { path: params.path } : {}),
                ...(params.label ? { label: params.label } : {}),
                focus: params.focus ?? false,
                ...(params.trust_repository ? { trust_repository: true } : {}),
              },
              { signal, timeoutMs: 120_000 },
            ),
          );
        case "open":
          return jsonResult(
            await rpc(
              "worktree.open",
              {
                ...(params.workspace_id ? { workspace_id: params.workspace_id } : {}),
                ...(params.cwd ? { cwd: params.cwd } : {}),
                ...(params.branch ? { branch: params.branch } : {}),
                ...(params.path ? { path: params.path } : {}),
                ...(params.label ? { label: params.label } : {}),
                focus: params.focus ?? false,
                ...(params.trust_repository ? { trust_repository: true } : {}),
              },
              { signal, timeoutMs: 120_000 },
            ),
          );
        case "remove": {
          const id = requireString(params.workspace_id, "workspace_id");
          return jsonResult(
            await rpc(
              "worktree.remove",
              {
                workspace_id: id,
                ...(params.force ? { force: true } : {}),
                ...(params.trust_repository ? { trust_repository: true } : {}),
              },
              { signal, timeoutMs: 120_000 },
            ),
            { workspaceId: id },
          );
        }
      }
    },
  });

  pi.registerTool({
    name: "herdr_events",
    label: "Herdr Events",
    description:
      "Wait for one Herdr event or watch a bounded stream of pane events. wait uses events.wait. watch subscribes to agent_status_changed, output_matched, or scroll_changed for selected panes and returns events until the duration or event limit. Use watch to monitor several workers without polling.",
    promptSnippet: "Wait for or watch bounded Herdr pane and agent events",
    promptGuidelines: [
      "Herdr 0.9.1 requires a pane_id for pane.agent_status_changed subscriptions; this tool builds one subscription per pane.",
      "A watch is bounded. If it returns timedOut, subscribe again or use agent.wait.",
      "If the server reports events_lost, treat cached state as stale and re-read session.snapshot.",
    ],
    parameters: EventParams,
    exposure: "deferred",
    namespace: HerdrNamespace,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (params.action === "wait") {
        if (!params.match_event) throw new Error("match_event is required for wait.");
        const timeoutMs = params.timeout_ms ?? DEFAULT_PROMPT_TIMEOUT_MS;
        return jsonResult(
          await rpc(
            "events.wait",
            { match_event: params.match_event, timeout_ms: timeoutMs },
            { signal, timeoutMs: timeoutMs + 15_000 },
          ),
        );
      }

      let subscriptions = params.subscriptions;
      if (!subscriptions?.length) {
        if (!params.pane_ids?.length) {
          throw new Error("Provide subscriptions or pane_ids for watch.");
        }
        const event = params.event ?? "agent_status_changed";
        subscriptions = params.pane_ids.map((paneId) => {
          if (event === "output_matched") {
            if (!params.match_value) throw new Error("match_value is required for output_matched.");
            return {
              type: "pane.output_matched",
              pane_id: paneId,
              source: params.source ?? "recent_unwrapped",
              ...(params.lines ? { lines: params.lines } : {}),
              match: { type: params.match_type ?? "substring", value: params.match_value },
            };
          }
          return { type: `pane.${event}`, pane_id: paneId };
        });
      }

      const result = await watchEvents(
        subscriptions,
        params.duration_ms ?? DEFAULT_WATCH_MS,
        params.max_events ?? 100,
        signal,
      );
      return jsonResult(result);
    },
  });

  pi.registerTool({
    name: "herdr_notify",
    label: "Herdr Notify",
    description:
      "Show a Herdr notification or toast. Use it to alert the user when a watched worker blocks or a background job finishes.",
    promptSnippet: "Show a Herdr notification or toast",
    parameters: NotifyParams,
    exposure: "deferred",
    namespace: HerdrNamespace,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const title = requireString(params.title, "title");
      return jsonResult(
        await rpc(
          "notification.show",
          {
            title,
            ...(params.body !== undefined ? { body: params.body } : {}),
            ...(params.position ? { position: params.position } : {}),
            ...(params.sound ? { sound: params.sound } : {}),
          },
          { signal },
        ),
      );
    },
  });

  pi.registerTool({
    name: "herdr_catalog",
    label: "Herdr Catalog",
    description:
      "List or search the Herdr socket API methods, or return the full request JSON schema for one method. Start here before herdr_call. The catalog comes from herdr api schema --json, using HERDR_BIN_PATH so it matches the running server.",
    promptSnippet: "Discover Herdr socket methods and request schemas",
    promptGuidelines: [
      "Call herdr_catalog with search before herdr_call if you do not know the exact method or params.",
      "Call herdr_catalog with method to get the request schema and referenced definitions.",
    ],
    parameters: CatalogParams,
    exposure: "deferred",
    namespace: HerdrNamespace,
    annotations: { readOnlyHint: true, openWorldHint: false },
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const doc = await loadSchema(params.refresh === true, signal);
      if (params.method) {
        const entry = methodEntry(doc, params.method);
        if (!entry) throw new Error(`Unknown Herdr method '${params.method}'.`);
        const defs = collectRefs(entry.params, doc);
        return jsonResult({
          method: params.method,
          signature: signature(doc, params.method),
          params: entry.params,
          defs,
          protocol: doc.protocol,
          schema_version: doc.schema_version,
        });
      }
      return textResult(catalogText(doc, params.search), {
        protocol: doc.protocol,
        schema_version: doc.schema_version,
        methodCount: methodNames(doc).length,
      });
    },
  });

  pi.registerTool({
    name: "herdr_call",
    label: "Herdr Call",
    description:
      "Raw call escape hatch for the full Herdr socket API. Call any method directly: ping, session.snapshot, workspace.*, tab.*, pane.*, agent.*, layout.*, worktree.*, events.wait, notification.show, plugin.*, server.*. Use herdr_catalog first for exact params. Destructive methods include pane.close, workspace.close, worktree.remove, plugin.unlink, and server.stop; use them only with explicit intent.",
    promptSnippet: "Call any Herdr socket method directly",
    promptGuidelines: [
      "Prefer the typed herdr_agent, herdr_pane, herdr_workspace, herdr_tab, herdr_worktree, and herdr_events tools for common operations.",
      "Use herdr_catalog to look up params before a raw call.",
      "Do not call server.stop unless the user explicitly intends to stop the Herdr server and its pane processes.",
    ],
    parameters: CallParams,
    exposure: "deferred",
    namespace: HerdrNamespace,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const method = requireString(params.method, "method");
      if (method === "events.subscribe") {
        throw new Error(
          "Use herdr_events watch for a subscription; a one-shot call cannot hold the socket open.",
        );
      }
      const timeoutMs = params.timeout_ms ?? DEFAULT_RPC_TIMEOUT_MS;
      const result = await rpc(method, params.params ?? {}, { signal, timeoutMs });
      return jsonResult(result, { method });
    },
  });
}
