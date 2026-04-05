import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TermParams = Type.Object({
  action: StringEnum(
    ["list", "ensure", "resize", "send", "keys", "read", "wait", "interrupt", "kill"] as const,
    { description: "Terminal action to perform." },
  ),
  name: Type.Optional(
    Type.String({
      description:
        "Terminal name inside the current implicit workspace. Required for all actions except list.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory used when creating a terminal.",
    }),
  ),
  command: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional argv to launch in the terminal. Omit to create an interactive shell.",
    }),
  ),
  shell: Type.Optional(
    Type.String({
      description:
        "Shell executable for interactive terminals. Defaults to $SHELL, then zsh, then bash.",
    }),
  ),
  shellProfile: Type.Optional(
    StringEnum(["default", "clean"] as const, {
      description:
        "For shell terminals, use the default shell startup or a quieter clean interactive shell.",
    }),
  ),
  closeOnExit: Type.Optional(
    Type.Boolean({
      description: "Close the backing pane when the startup command exits. Defaults to false.",
    }),
  ),
  width: Type.Optional(
    Type.String({
      description: "Floating terminal width, eg. '120' or '90%'. Defaults to '100%'.",
    }),
  ),
  height: Type.Optional(
    Type.String({
      description: "Floating terminal height, eg. '30' or '100%'. Defaults to '100%'.",
    }),
  ),
  x: Type.Optional(
    Type.String({
      description: "Floating terminal x position, eg. '0' or '5%'. Defaults to '0'.",
    }),
  ),
  y: Type.Optional(
    Type.String({
      description: "Floating terminal y position, eg. '0' or '5%'. Defaults to '0'.",
    }),
  ),
  text: Type.Optional(
    Type.String({
      description: "Text to send to a terminal for action send.",
    }),
  ),
  enter: Type.Optional(
    Type.Boolean({
      description: "For action send: append Enter after the provided text. Defaults to false.",
    }),
  ),
  keys: Type.Optional(
    Type.Array(Type.String(), {
      description: "Key names for action keys, eg ['Ctrl c'] or ['Escape', 'Enter'].",
    }),
  ),
  inputMode: Type.Optional(
    StringEnum(["paste", "write_chars"] as const, {
      description: "For action send: prefer paste unless you need literal typing semantics.",
    }),
  ),
  mode: Type.Optional(
    StringEnum(["screen", "scrollback", "delta"] as const, {
      description:
        "For action read: screen = visible screen, scrollback = full history, delta = only new lines since the last read.",
    }),
  ),
  offset: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "For action read: 1-indexed line to start from.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "For action read: maximum number of lines to return.",
    }),
  ),
  tail: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "For action read: return the last N lines. Ignored when offset is provided.",
    }),
  ),
  ansi: Type.Optional(
    Type.Boolean({
      description: "For action read: preserve ANSI escape sequences in the output.",
    }),
  ),
  waitFor: Type.Optional(
    StringEnum(["exit", "output", "silence"] as const, {
      description: "For action wait: what condition to wait for. Defaults to exit.",
    }),
  ),
  pattern: Type.Optional(
    Type.String({
      description:
        "For action wait with waitFor=output: optional literal substring that must appear in new output.",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "For action wait: overall timeout in milliseconds. Defaults to 30000.",
    }),
  ),
  idleMs: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "For action wait with waitFor=silence: required quiet period in milliseconds. Defaults to 2000.",
    }),
  ),
  pollMs: Type.Optional(
    Type.Integer({
      minimum: 50,
      description: "For action wait: polling interval in milliseconds. Defaults to 500.",
    }),
  ),
  restart: Type.Optional(
    Type.Boolean({
      description: "For action ensure: if the named terminal already exists, kill and recreate it.",
    }),
  ),
});

type TermParamsType = Static<typeof TermParams>;

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
};

type PaneInfo = Record<string, unknown>;

type ShellLaunch = {
  argv: string[];
  profile: "default" | "clean";
  shellPath?: string;
  shellKind?: "zsh" | "bash" | "other";
  initPath?: string;
  envLoader?: "direnv";
};

type TerminalState = {
  name: string;
  paneId: string;
  cwd: string;
  command?: string[];
  closeOnExit: boolean;
  createdAt: number;
  lastDeltaLine: number;
  width: string;
  height: string;
  x: string;
  y: string;
};

const TERMINAL_OR_PLUGIN_ID = /^(terminal|plugin)_\d+$/;
const DEFAULT_WORKSPACE_COLS = 160;
const DEFAULT_WORKSPACE_ROWS = 60;
const workspaceStates = new Map<string, WorkspaceState>();

class WorkspaceState {
  readonly workspaceName: string;
  readonly terminals = new Map<string, TerminalState>();
  readonly initPaths = new Set<string>();
  initialized = false;

  constructor(workspaceName: string) {
    this.workspaceName = workspaceName;
  }
}

function sanitizeName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function shortId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

type ZellijSessionListEntry = {
  name: string;
  exited: boolean;
};

function previewOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n");
}

function parseZellijSessionList(stdout: string): ZellijSessionListEntry[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const name = line.split(" ")[0] ?? line;
      return {
        name,
        exited: line.includes("(EXITED"),
      };
    });
}

function requireName(params: TermParamsType): string {
  if (!params.name?.trim()) {
    throw new Error(`Action ${params.action} requires name.`);
  }
  return params.name.trim();
}

function requireText(params: TermParamsType): string {
  if (typeof params.text !== "string") {
    throw new Error(`Action ${params.action} requires text.`);
  }
  return params.text;
}

function requireKeys(params: TermParamsType): string[] {
  if (!params.keys?.length) {
    throw new Error(`Action ${params.action} requires at least one key.`);
  }
  return params.keys;
}

function parseCreatedPaneId(stdout: string, stderr: string): string | undefined {
  for (const chunk of [stdout, stderr]) {
    for (const line of chunk.split(/\r?\n/).map((entry) => entry.trim())) {
      if (TERMINAL_OR_PLUGIN_ID.test(line)) return line;
    }
  }
  return undefined;
}

function paneIdFromPaneInfo(pane: PaneInfo): string {
  const kind = pane.is_plugin ? "plugin" : "terminal";
  return `${kind}_${String(pane.id)}`;
}

function findNewPaneId(before: PaneInfo[], after: PaneInfo[], name?: string): string | undefined {
  const existing = new Set(before.map((pane) => paneIdFromPaneInfo(pane)));
  const created = after.filter((pane) => !existing.has(paneIdFromPaneInfo(pane)));

  if (name) {
    const named = created.find((pane) => pane.title === name);
    if (named) return paneIdFromPaneInfo(named);
  }

  if (created.length === 1) {
    return paneIdFromPaneInfo(created[0]);
  }

  if (name) {
    const matching = after.find((pane) => pane.title === name);
    if (matching) return paneIdFromPaneInfo(matching);
  }

  return undefined;
}

function parseCreatedPaneIdOrThrow(
  stdout: string,
  stderr: string,
  context: string,
  before: PaneInfo[] = [],
  after: PaneInfo[] = [],
  name?: string,
): string {
  const direct = parseCreatedPaneId(stdout, stderr);
  if (direct) return direct;

  const inferred = findNewPaneId(before, after, name);
  if (inferred) return inferred;

  throw new Error(
    `${context} returned an unexpected pane id.\n\n${previewOutput(stdout, stderr) || "<no output>"}`,
  );
}

function shellKindFromPath(shellPath: string): "zsh" | "bash" | "other" {
  const base = path.basename(shellPath).toLowerCase();
  if (base.includes("zsh")) return "zsh";
  if (base.includes("bash")) return "bash";
  return "other";
}

async function findKnownShell(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    for (const base of ["/run/current-system/sw/bin", "/usr/bin", "/bin"]) {
      const fullPath = path.join(base, candidate);
      try {
        const resolved = await fs.realpath(fullPath);
        return resolved;
      } catch {
        // ignore
      }
    }
  }
  return undefined;
}

async function resolveShellPath(
  shell?: string,
  profile: "default" | "clean" = "default",
): Promise<string> {
  if (shell?.trim()) return shell.trim();

  if (profile === "clean") {
    const cleanPreferred = await findKnownShell(["zsh", "bash"]);
    if (cleanPreferred) return cleanPreferred;
  }

  if (process.env.SHELL?.trim()) return process.env.SHELL.trim();

  const fallback = await findKnownShell(["zsh", "bash"]);
  if (fallback) return fallback;

  return "sh";
}

async function commandExists(command: string): Promise<boolean> {
  try {
    const resolved = await findKnownShell([command]);
    if (resolved) return true;
  } catch {
    // ignore
  }
  return false;
}

async function maybeWrapWithDirenv(
  argv: string[],
  cwd?: string,
): Promise<{ argv: string[]; envLoader?: "direnv" }> {
  if (!cwd) return { argv };
  if (!(await commandExists("direnv"))) return { argv };
  return {
    argv: ["direnv", "exec", cwd, ...argv],
    envLoader: "direnv",
  };
}

async function buildShellLaunch(
  params: Pick<TermParamsType, "cwd" | "command" | "shell" | "shellProfile">,
  workspace: WorkspaceState,
): Promise<ShellLaunch | undefined> {
  const shellProfile = params.shellProfile ?? "clean";

  if (params.command?.length) {
    const wrapped = await maybeWrapWithDirenv(params.command, params.cwd);
    return {
      argv: wrapped.argv,
      profile: shellProfile,
      envLoader: wrapped.envLoader,
    };
  }

  const shellPath = await resolveShellPath(params.shell, shellProfile);
  const shellKind = shellKindFromPath(shellPath);

  if (shellKind === "zsh") {
    const initDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-term-zsh-"));
    const initPath = path.join(initDir, ".zshrc");
    workspace.initPaths.add(initDir);
    await fs.writeFile(
      initPath,
      ["unsetopt beep", "PROMPT='term:%1~ %# '", "RPROMPT=''"].join("\n") + "\n",
      "utf8",
    );
    const wrapped = await maybeWrapWithDirenv(
      ["env", `ZDOTDIR=${initDir}`, shellPath, "-i"],
      params.cwd,
    );
    return {
      argv: wrapped.argv,
      profile: shellProfile,
      shellPath,
      shellKind,
      initPath,
      envLoader: wrapped.envLoader,
    };
  }

  if (shellKind === "bash") {
    const initDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-term-bash-"));
    const initPath = path.join(initDir, "bashrc");
    workspace.initPaths.add(initDir);
    await fs.writeFile(
      initPath,
      ["PS1='term:\\w\\$ '", "unset PROMPT_COMMAND"].join("\n") + "\n",
      "utf8",
    );
    const wrapped = await maybeWrapWithDirenv(
      [shellPath, "--noprofile", "--rcfile", initPath, "-i"],
      params.cwd,
    );
    return {
      argv: wrapped.argv,
      profile: shellProfile,
      shellPath,
      shellKind,
      initPath,
      envLoader: wrapped.envLoader,
    };
  }

  const wrapped = await maybeWrapWithDirenv([shellPath], params.cwd);
  return {
    argv: wrapped.argv,
    profile: shellProfile,
    shellPath,
    shellKind,
    envLoader: wrapped.envLoader,
  };
}

function splitLinesPreserveShape(text: string): string[] {
  if (!text.length) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function sliceLines(
  lines: string[],
  params: Pick<TermParamsType, "offset" | "limit" | "tail">,
): {
  selected: string[];
  startLine: number;
  endLine: number;
  totalLines: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
} {
  const totalLines = lines.length;
  if (totalLines === 0) {
    return {
      selected: [],
      startLine: 0,
      endLine: 0,
      totalLines: 0,
      hasMoreBefore: false,
      hasMoreAfter: false,
    };
  }

  const limit = clampPositiveInteger(params.limit, 120);
  let startIdx = 0;
  let endExclusive = totalLines;

  if (typeof params.offset === "number") {
    startIdx = Math.min(totalLines, Math.max(0, params.offset - 1));
    endExclusive = Math.min(totalLines, startIdx + limit);
  } else if (typeof params.tail === "number") {
    const tail = clampPositiveInteger(params.tail, limit);
    startIdx = Math.max(0, totalLines - tail);
    endExclusive = totalLines;
  } else {
    startIdx = Math.max(0, totalLines - limit);
    endExclusive = totalLines;
  }

  return {
    selected: lines.slice(startIdx, endExclusive),
    startLine: startIdx + 1,
    endLine: endExclusive,
    totalLines,
    hasMoreBefore: startIdx > 0,
    hasMoreAfter: endExclusive < totalLines,
  };
}

function buildReadText(name: string, payload: ReturnType<typeof sliceLines>, mode: string): string {
  if (!payload.selected.length) {
    return `No ${mode} output available for ${name}.`;
  }

  let header = `${name} ${mode} lines ${payload.startLine}-${payload.endLine} of ${payload.totalLines}`;
  if (payload.hasMoreBefore || payload.hasMoreAfter) {
    const hints = [];
    if (payload.hasMoreBefore) hints.push("more before");
    if (payload.hasMoreAfter) hints.push("more after");
    header += ` (${hints.join(", ")})`;
  }

  return `${header}\n\n${payload.selected.join("\n")}`;
}

function summarizeText(text: string, maxLen = 160): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n/g, "\\n");
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 3))}...`;
}

function stripLeadingBoilerplate(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const boilerplate = new Set([
    "direnv: loading ~/.pi/agent/.envrc",
    "direnv: using flake",
    "direnv: nix-direnv: Using cached dev shell",
  ]);

  let idx = 0;
  while (idx < lines.length && boilerplate.has(lines[idx])) idx += 1;
  while (idx < lines.length && lines[idx] === "") idx += 1;
  return lines.slice(idx).join("\n");
}

function lastNonEmptyLine(text: string): string | undefined {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (line) return line;
  }
  return undefined;
}

function renderTarget(args: TermParamsType): string {
  return typeof args.name === "string" && args.name.trim() ? args.name.trim() : "workspace";
}

function resolveGeometry(args: Pick<TermParamsType, "width" | "height" | "x" | "y">): {
  width: string;
  height: string;
  x: string;
  y: string;
} {
  return {
    width: args.width?.trim() || "100%",
    height: args.height?.trim() || "100%",
    x: args.x?.trim() || "0",
    y: args.y?.trim() || "0",
  };
}

async function removePathQuietly(targetPath: string): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export default function (pi: ExtensionAPI) {
  let workspace: WorkspaceState | null = null;

  async function cleanupExitedWorkspaces(): Promise<void> {
    try {
      const result = await pi.exec("zellij", ["list-sessions", "--no-formatting"], {
        timeout: 2000,
      });
      if (result.code !== 0) return;

      const sessions = parseZellijSessionList(result.stdout);
      for (const session of sessions) {
        if (!session.exited) continue;
        if (!session.name.startsWith("pt-")) continue;
        try {
          await pi.exec("zellij", ["delete-session", session.name], { timeout: 2000 });
        } catch {
          // ignore cleanup failures
        }
      }
    } catch {
      // ignore cleanup failures
    }
  }

  pi.on("session_start", async (_event, _ctx) => {
    await cleanupExitedWorkspaces();
    const workspaceName = `pt-${shortId()}`;
    workspace = new WorkspaceState(workspaceName);
    workspaceStates.set(workspaceName, workspace);
  });

  pi.on("session_shutdown", async () => {
    if (!workspace) return;
    const current = workspace;
    workspace = null;
    workspaceStates.delete(current.workspaceName);

    for (const initDir of current.initPaths) {
      await removePathQuietly(initDir);
    }

    try {
      await pi.exec("zellij", ["kill-session", current.workspaceName], { timeout: 2000 });
    } catch {
      // ignore cleanup failures
    }

    try {
      await pi.exec("zellij", ["delete-session", current.workspaceName], { timeout: 2000 });
    } catch {
      // ignore cleanup failures
    }
  });

  pi.registerTool({
    name: "term",
    label: "Term",
    description: [
      "Manage named terminals inside an implicit per-session workspace backed by zellij.",
      "Use this for durable shells, REPLs, logs, and background processes without exposing pane or tab ids.",
      `Read output in file-like chunks using line offsets, limits, tails, or deltas to control token usage.`,
      `Workspaces are private to the current pi session and are torn down automatically on session shutdown.`,
    ].join("\n"),
    promptSnippet:
      "Manage named terminals in a private workspace. Prefer this over raw zellij when you want durable shells, REPLs, logs, or process I/O.",
    promptGuidelines: [
      "Think in named terminals like 'server', 'repl', or 'logs', not panes or tabs.",
      "Prefer ensure to create a terminal once, then send/keys/read over time.",
      "Prefer read with tail, offset/limit, or delta to avoid flooding context with repeated output.",
      "Use send for pasted input and keys for control sequences like Ctrl c.",
      "Use wait when you need to block on exit, new output, or silence.",
    ],
    parameters: TermParams,
    renderCall(args, theme) {
      const action = typeof args.action === "string" ? args.action : "";
      const target = renderTarget(args as TermParamsType);
      let text = theme.fg("toolTitle", theme.bold("term ")) + theme.fg("muted", action);

      switch (action) {
        case "ensure": {
          text += " " + theme.fg("accent", target);
          if (typeof args.cwd === "string" && args.cwd.trim()) {
            text += " " + theme.fg("dim", args.cwd.trim());
          }
          if (Array.isArray(args.command) && args.command.length) {
            text += " " + theme.fg("dim", summarizeText(args.command.join(" "), 80));
          }
          if (typeof args.width === "string" || typeof args.height === "string") {
            text += " " + theme.fg("muted", `${args.width ?? "100%"}×${args.height ?? "100%"}`);
          }
          break;
        }
        case "resize": {
          text += " " + theme.fg("accent", target);
          text += " " + theme.fg("muted", `${args.width ?? "100%"}×${args.height ?? "100%"}`);
          break;
        }
        case "send": {
          text += " " + theme.fg("accent", target);
          if (typeof args.text === "string" && args.text.length) {
            text += " " + theme.fg("dim", JSON.stringify(summarizeText(args.text, 100)));
          }
          if (args.enter) {
            text += " " + theme.fg("muted", "+ Enter");
          }
          break;
        }
        case "keys": {
          text += " " + theme.fg("accent", target);
          if (Array.isArray(args.keys) && args.keys.length) {
            text += " " + theme.fg("dim", args.keys.join(", "));
          }
          break;
        }
        case "interrupt":
        case "kill": {
          text += " " + theme.fg("accent", target);
          break;
        }
        case "read": {
          text += " " + theme.fg("accent", target);
          if (typeof args.mode === "string") {
            text += " " + theme.fg("muted", args.mode);
          }
          if (typeof args.offset === "number") {
            const limit = typeof args.limit === "number" ? args.limit : "?";
            text += " " + theme.fg("dim", `${args.offset}-${args.offset + Number(limit) - 1}`);
          } else if (typeof args.tail === "number") {
            text += " " + theme.fg("dim", `tail:${args.tail}`);
          }
          break;
        }
        case "wait": {
          text += " " + theme.fg("accent", target);
          if (typeof args.waitFor === "string") {
            text += " " + theme.fg("muted", args.waitFor);
          }
          if (typeof args.pattern === "string" && args.pattern.length) {
            text += " " + theme.fg("dim", JSON.stringify(summarizeText(args.pattern, 60)));
          }
          if (typeof args.timeoutMs === "number") {
            text += " " + theme.fg("dim", `(${args.timeoutMs}ms)`);
          }
          break;
        }
        case "list":
        default:
          break;
      }

      return new Text(text, 0, 0);
    },
    async execute(_toolCallId, params, signal, _onUpdate): Promise<any> {
      if (!workspace) {
        const fallbackName = `pt-${shortId()}`;
        workspace = workspaceStates.get(fallbackName) ?? new WorkspaceState(fallbackName);
        workspaceStates.set(fallbackName, workspace);
      }

      const state = workspace;

      async function run(args: string[]): Promise<ExecResult> {
        const result = await pi.exec("zellij", args, { signal });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
          killed: result.killed,
        };
      }

      async function runOrThrow(
        args: string[],
        context = `zellij ${args.join(" ")}`,
      ): Promise<ExecResult> {
        const result = await run(args);
        if (result.code !== 0) {
          throw new Error(
            `${context} failed (exit ${result.code})\n\n${previewOutput(result.stdout, result.stderr)}`.trim(),
          );
        }
        return result;
      }

      async function bootstrapWorkspaceSize(cols: number, rows: number): Promise<void> {
        const python = (await findKnownShell(["python3"])) ?? "/usr/bin/python3";
        const script = [
          "import os, pty, fcntl, termios, struct, subprocess, time, sys",
          "session, cols, rows = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])",
          "master, slave = pty.openpty()",
          "fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))",
          "p = subprocess.Popen(['zellij', 'attach', session], stdin=slave, stdout=slave, stderr=slave, close_fds=True)",
          "os.close(slave)",
          "time.sleep(1.5)",
          "p.terminate()",
          "time.sleep(0.5)",
          "try:\n    p.kill()\nexcept ProcessLookupError:\n    pass",
          "os.close(master)",
        ].join("\n");
        await pi.exec(python, ["-c", script, state.workspaceName, String(cols), String(rows)], {
          timeout: 5000,
          signal,
        });
      }

      async function ensureWorkspace(): Promise<void> {
        if (state.initialized) return;
        await runOrThrow(["attach", "--create-background", state.workspaceName]);
        await bootstrapWorkspaceSize(DEFAULT_WORKSPACE_COLS, DEFAULT_WORKSPACE_ROWS);
        state.initialized = true;
      }

      async function listPanes(): Promise<PaneInfo[]> {
        await ensureWorkspace();
        const result = await runOrThrow(
          ["--session", state.workspaceName, "action", "list-panes", "--json"],
          `zellij list-panes for workspace ${state.workspaceName}`,
        );
        return JSON.parse(result.stdout) as PaneInfo[];
      }

      async function getTerminalOrThrow(name: string): Promise<TerminalState> {
        const terminal = state.terminals.get(name);
        if (!terminal) throw new Error(`Terminal ${name} does not exist in the current workspace.`);
        return terminal;
      }

      async function findPaneForTerminal(terminal: TerminalState): Promise<PaneInfo | undefined> {
        const panes = await listPanes();
        return panes.find((pane) => {
          const kind = pane.is_plugin ? "plugin" : "terminal";
          return `${kind}_${String(pane.id)}` === terminal.paneId;
        });
      }

      async function createTerminal(name: string): Promise<TerminalState> {
        await ensureWorkspace();
        const before = await listPanes();
        const cwd = params.cwd?.trim() || process.cwd();
        const shellLaunch = await buildShellLaunch(params, state);
        const geometry = resolveGeometry(params);
        const args = [
          "--session",
          state.workspaceName,
          "action",
          "new-pane",
          "--name",
          name,
          "--floating",
          "--x",
          geometry.x,
          "--y",
          geometry.y,
          "--width",
          geometry.width,
          "--height",
          geometry.height,
        ];
        if (cwd) args.push("--cwd", cwd);
        if (params.closeOnExit) args.push("--close-on-exit");
        if (shellLaunch?.argv.length) args.push("--", ...shellLaunch.argv);
        const result = await runOrThrow(
          args,
          `zellij create terminal ${name} in workspace ${state.workspaceName}`,
        );
        const after = await listPanes();
        const paneId = parseCreatedPaneIdOrThrow(
          result.stdout,
          result.stderr,
          `create terminal ${name}`,
          before,
          after,
          name,
        );
        const terminal: TerminalState = {
          name,
          paneId,
          cwd,
          command: params.command ?? undefined,
          closeOnExit: Boolean(params.closeOnExit),
          createdAt: Date.now(),
          lastDeltaLine: 0,
          width: geometry.width,
          height: geometry.height,
          x: geometry.x,
          y: geometry.y,
        };
        state.terminals.set(name, terminal);
        return terminal;
      }

      async function resizeTerminal(
        terminal: TerminalState,
        geometry: { width: string; height: string; x: string; y: string },
      ): Promise<void> {
        await runOrThrow(
          [
            "--session",
            state.workspaceName,
            "action",
            "change-floating-pane-coordinates",
            "--pane-id",
            terminal.paneId,
            "--x",
            geometry.x,
            "--y",
            geometry.y,
            "--width",
            geometry.width,
            "--height",
            geometry.height,
          ],
          `zellij resize terminal ${terminal.name} ${terminal.paneId}`,
        );
        terminal.width = geometry.width;
        terminal.height = geometry.height;
        terminal.x = geometry.x;
        terminal.y = geometry.y;
      }

      async function closeTerminal(terminal: TerminalState): Promise<void> {
        await runOrThrow(
          ["--session", state.workspaceName, "action", "close-pane", "--pane-id", terminal.paneId],
          `zellij close-pane ${terminal.paneId}`,
        );
        state.terminals.delete(terminal.name);
      }

      async function dumpTerminal(
        terminal: TerminalState,
        options: { full: boolean; ansi?: boolean },
      ): Promise<string> {
        const args = [
          "--session",
          state.workspaceName,
          "action",
          "dump-screen",
          "--pane-id",
          terminal.paneId,
        ];
        if (options.full) args.push("--full");
        if (options.ansi) args.push("--ansi");
        const result = await runOrThrow(args, `zellij dump-screen ${terminal.paneId}`);
        return stripLeadingBoilerplate(result.stdout);
      }

      switch (params.action) {
        case "list": {
          if (!state.terminals.size) {
            return {
              content: [{ type: "text", text: "No terminals in the current workspace." }],
              details: { action: params.action, workspace: state.workspaceName, terminals: [] },
            };
          }

          const panes = await listPanes();
          const terminals = await Promise.all(
            Array.from(state.terminals.values()).map(async (terminal) => {
              const pane = panes.find((entry) => {
                const kind = entry.is_plugin ? "plugin" : "terminal";
                return `${kind}_${String(entry.id)}` === terminal.paneId;
              });
              const preview = pane
                ? lastNonEmptyLine(await dumpTerminal(terminal, { full: true }))
                : undefined;
              return {
                ...terminal,
                exited: Boolean(pane?.exited),
                exitStatus: typeof pane?.exit_status === "number" ? pane.exit_status : null,
                title: typeof pane?.title === "string" ? pane.title : null,
                preview,
              };
            }),
          );

          const text = terminals
            .map((terminal) => {
              const parts = [
                terminal.name,
                `[${terminal.paneId}]`,
                terminal.cwd,
                `${terminal.width}×${terminal.height}`,
                terminal.exited ? `status=exited(${terminal.exitStatus ?? "?"})` : "status=running",
              ];
              if (terminal.command?.length) parts.push(`cmd=${terminal.command.join(" ")}`);
              if (terminal.preview)
                parts.push(`preview=${JSON.stringify(summarizeText(terminal.preview, 80))}`);
              return parts.join(" ");
            })
            .join("\n");

          return {
            content: [{ type: "text", text }],
            details: { action: params.action, workspace: state.workspaceName, terminals },
          };
        }

        case "ensure": {
          const name = requireName(params);
          const existing = state.terminals.get(name);
          if (existing && !params.restart) {
            const pane = await findPaneForTerminal(existing);
            return {
              content: [{ type: "text", text: `Terminal ${name} already exists.` }],
              details: {
                action: params.action,
                workspace: state.workspaceName,
                terminal: existing,
                exited: Boolean(pane?.exited),
                exitStatus: typeof pane?.exit_status === "number" ? pane.exit_status : null,
                created: false,
              },
            };
          }

          if (existing && params.restart) {
            try {
              await closeTerminal(existing);
            } catch {
              state.terminals.delete(name);
            }
          }

          const terminal = await createTerminal(name);
          return {
            content: [
              {
                type: "text",
                text: terminal.command?.length
                  ? `Created terminal ${name} [${terminal.paneId}] in ${terminal.cwd}\nsize: ${terminal.width} × ${terminal.height} @ (${terminal.x}, ${terminal.y})\nstartup command: ${terminal.command.join(" ")}`
                  : `Created terminal ${name} [${terminal.paneId}] in ${terminal.cwd}\nsize: ${terminal.width} × ${terminal.height} @ (${terminal.x}, ${terminal.y})\nstartup shell: ${params.shellProfile ?? "clean"}`,
              },
            ],
            details: {
              action: params.action,
              workspace: state.workspaceName,
              terminal,
              created: true,
            },
          };
        }

        case "resize": {
          const name = requireName(params);
          const terminal = await getTerminalOrThrow(name);
          const geometry = resolveGeometry(params);
          await resizeTerminal(terminal, geometry);
          return {
            content: [
              {
                type: "text",
                text: `Resized terminal ${name} [${terminal.paneId}]\nsize: ${terminal.width} × ${terminal.height} @ (${terminal.x}, ${terminal.y})`,
              },
            ],
            details: {
              action: params.action,
              workspace: state.workspaceName,
              terminal,
            },
          };
        }

        case "send": {
          const name = requireName(params);
          const terminal = await getTerminalOrThrow(name);
          const text = requireText(params);
          const inputMode = params.inputMode ?? "write_chars";
          const actionName = inputMode === "write_chars" ? "write-chars" : "paste";
          await runOrThrow(
            [
              "--session",
              state.workspaceName,
              "action",
              actionName,
              "--pane-id",
              terminal.paneId,
              text,
            ],
            `zellij ${actionName} ${terminal.paneId}`,
          );
          if (params.enter) {
            await runOrThrow(
              [
                "--session",
                state.workspaceName,
                "action",
                "send-keys",
                "--pane-id",
                terminal.paneId,
                "Enter",
              ],
              `zellij send-keys Enter ${terminal.paneId}`,
            );
          }
          return {
            content: [
              {
                type: "text",
                text:
                  `Sent ${inputMode === "paste" ? "pasted input" : "typed input"} to ${name} [${terminal.paneId}]` +
                  `\ntext: ${summarizeText(text)}` +
                  (params.enter ? "\nthen sent key: Enter" : ""),
              },
            ],
            details: {
              action: params.action,
              workspace: state.workspaceName,
              terminal,
              inputMode,
              bytes: Buffer.byteLength(text),
              enter: Boolean(params.enter),
            },
          };
        }

        case "keys": {
          const name = requireName(params);
          const terminal = await getTerminalOrThrow(name);
          const keys = requireKeys(params);
          await runOrThrow(
            [
              "--session",
              state.workspaceName,
              "action",
              "send-keys",
              "--pane-id",
              terminal.paneId,
              ...keys,
            ],
            `zellij send-keys ${terminal.paneId}`,
          );
          return {
            content: [
              {
                type: "text",
                text: `Sent keys to ${name} [${terminal.paneId}]\nkeys: ${keys.join(", ")}`,
              },
            ],
            details: { action: params.action, workspace: state.workspaceName, terminal, keys },
          };
        }

        case "interrupt": {
          const name = requireName(params);
          const terminal = await getTerminalOrThrow(name);
          await runOrThrow(
            [
              "--session",
              state.workspaceName,
              "action",
              "send-keys",
              "--pane-id",
              terminal.paneId,
              "Ctrl c",
            ],
            `zellij send-keys Ctrl c ${terminal.paneId}`,
          );
          return {
            content: [
              {
                type: "text",
                text: `Interrupted ${name} [${terminal.paneId}]\nsent key: Ctrl c`,
              },
            ],
            details: {
              action: params.action,
              workspace: state.workspaceName,
              terminal,
              signal: "Ctrl-C",
            },
          };
        }

        case "read": {
          const name = requireName(params);
          const terminal = await getTerminalOrThrow(name);
          const mode = params.mode ?? "scrollback";
          const rawOutput = await dumpTerminal(terminal, {
            full: mode !== "screen",
            ansi: params.ansi,
          });
          const lines = splitLinesPreserveShape(rawOutput);

          let payload: ReturnType<typeof sliceLines>;
          if (mode === "delta") {
            const startIdx = Math.min(lines.length, terminal.lastDeltaLine);
            const selected = lines.slice(startIdx);
            payload = {
              selected,
              startLine: selected.length ? startIdx + 1 : 0,
              endLine: lines.length,
              totalLines: lines.length,
              hasMoreBefore: startIdx > 0,
              hasMoreAfter: false,
            };
            terminal.lastDeltaLine = lines.length;

            if (
              typeof params.offset === "number" ||
              typeof params.tail === "number" ||
              typeof params.limit === "number"
            ) {
              payload = sliceLines(payload.selected, {
                offset: params.offset,
                limit: params.limit,
                tail: params.tail,
              });
              if (payload.startLine > 0) {
                payload = {
                  ...payload,
                  startLine: payload.startLine + startIdx,
                  endLine: payload.endLine + startIdx,
                  totalLines: lines.length,
                  hasMoreBefore: startIdx > 0 || payload.hasMoreBefore,
                };
              }
            }
          } else {
            payload = sliceLines(lines, params);
          }

          const text = buildReadText(name, payload, mode);
          const bytes = Buffer.byteLength(text);
          const note =
            bytes > DEFAULT_MAX_BYTES
              ? `\n\n[Note: returned content is ${formatSize(bytes)}. Consider a smaller limit or tail if this gets expensive.]`
              : "";
          return {
            content: [{ type: "text", text: text + note }],
            details: {
              action: params.action,
              workspace: state.workspaceName,
              terminal,
              mode,
              startLine: payload.startLine,
              endLine: payload.endLine,
              totalLines: payload.totalLines,
              hasMoreBefore: payload.hasMoreBefore,
              hasMoreAfter: payload.hasMoreAfter,
              maxSuggestedLines: DEFAULT_MAX_LINES,
              maxSuggestedBytes: DEFAULT_MAX_BYTES,
            },
          };
        }

        case "wait": {
          const name = requireName(params);
          const terminal = await getTerminalOrThrow(name);
          const waitFor = params.waitFor ?? "exit";
          const timeoutMs = clampPositiveInteger(params.timeoutMs, 30_000);
          const idleMs = clampPositiveInteger(params.idleMs, 2_000);
          const pollMs = clampPositiveInteger(params.pollMs, 500);
          const deadline = Date.now() + timeoutMs;
          let lastChangeAt = Date.now();
          let lastSeenOutput = "";
          let nextProgressAt = Date.now();

          const buildPayload = (output: string, tail = params.tail ?? 80) => {
            const lines = splitLinesPreserveShape(output);
            return sliceLines(lines, {
              offset: undefined,
              limit: params.limit,
              tail,
            });
          };

          const outputMatches = (output: string): boolean => {
            if (waitFor !== "output") return false;
            if (!params.pattern) return output.length > 0;
            return output.includes(params.pattern);
          };

          if (waitFor === "output" || waitFor === "silence") {
            lastSeenOutput = await dumpTerminal(terminal, { full: true, ansi: params.ansi });
            if (waitFor === "output" && outputMatches(lastSeenOutput)) {
              const payload = buildPayload(lastSeenOutput);
              return {
                content: [
                  {
                    type: "text",
                    text:
                      `Wait finished for ${name} [${terminal.paneId}]\ncondition: output` +
                      `${params.pattern ? ` matching ${JSON.stringify(params.pattern)}` : ""}` +
                      `\n\n${buildReadText(name, payload, "scrollback")}`,
                  },
                ],
                details: {
                  action: params.action,
                  workspace: state.workspaceName,
                  terminal,
                  waitFor,
                  matchedPattern: params.pattern ?? null,
                  startLine: payload.startLine,
                  endLine: payload.endLine,
                  totalLines: payload.totalLines,
                  alreadyMatched: true,
                },
              };
            }
          }

          _onUpdate?.({
            content: [
              {
                type: "text",
                text:
                  `Waiting on ${name} [${terminal.paneId}]` +
                  `\ncondition: ${waitFor}${params.pattern ? ` matching ${JSON.stringify(params.pattern)}` : ""}` +
                  `\ntimeout: ${timeoutMs}ms`,
              },
            ],
            details: {
              action: params.action,
              workspace: state.workspaceName,
              terminal,
              waitFor,
              pattern: params.pattern ?? null,
              timeoutMs,
            },
          });

          while (Date.now() <= deadline) {
            if (signal?.aborted) {
              throw new Error(`wait for ${name} was cancelled.`);
            }

            const pane = await findPaneForTerminal(terminal);
            if (!pane) {
              return {
                content: [{ type: "text", text: `Terminal ${name} no longer exists.` }],
                details: {
                  action: params.action,
                  workspace: state.workspaceName,
                  terminal,
                  waitFor,
                  missing: true,
                },
              };
            }

            if (waitFor === "exit" && pane.exited) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Wait finished for ${name} [${terminal.paneId}]\ncondition: exit\nresult: exited${typeof pane.exit_status === "number" ? ` with status ${pane.exit_status}` : ""}.`,
                  },
                ],
                details: {
                  action: params.action,
                  workspace: state.workspaceName,
                  terminal,
                  waitFor,
                  exited: true,
                  exitStatus: typeof pane.exit_status === "number" ? pane.exit_status : null,
                },
              };
            }

            if (waitFor === "output" || waitFor === "silence") {
              const currentOutput = await dumpTerminal(terminal, { full: true, ansi: params.ansi });
              if (currentOutput !== lastSeenOutput) {
                lastSeenOutput = currentOutput;
                lastChangeAt = Date.now();
              }

              if (waitFor === "output" && outputMatches(currentOutput)) {
                const payload = buildPayload(currentOutput);
                return {
                  content: [
                    {
                      type: "text",
                      text:
                        `Wait finished for ${name} [${terminal.paneId}]\ncondition: output` +
                        `${params.pattern ? ` matching ${JSON.stringify(params.pattern)}` : ""}` +
                        `\n\n${buildReadText(name, payload, "scrollback")}`,
                    },
                  ],
                  details: {
                    action: params.action,
                    workspace: state.workspaceName,
                    terminal,
                    waitFor,
                    matchedPattern: params.pattern ?? null,
                    startLine: payload.startLine,
                    endLine: payload.endLine,
                    totalLines: payload.totalLines,
                  },
                };
              }

              if (waitFor === "silence" && Date.now() - lastChangeAt >= idleMs) {
                const payload = buildPayload(lastSeenOutput);
                return {
                  content: [
                    {
                      type: "text",
                      text: `Wait finished for ${name} [${terminal.paneId}]\ncondition: silence for ${idleMs}ms\n\n${buildReadText(name, payload, "scrollback")}`,
                    },
                  ],
                  details: {
                    action: params.action,
                    workspace: state.workspaceName,
                    terminal,
                    waitFor,
                    idleMs,
                    startLine: payload.startLine,
                    endLine: payload.endLine,
                    totalLines: payload.totalLines,
                  },
                };
              }
            }

            if (Date.now() >= nextProgressAt) {
              nextProgressAt = Date.now() + 2_000;
              const previewOutputText =
                waitFor === "exit"
                  ? await dumpTerminal(terminal, { full: true, ansi: params.ansi })
                  : lastSeenOutput;
              const previewPayload = buildPayload(
                previewOutputText,
                Math.min(params.tail ?? 12, 20),
              );
              _onUpdate?.({
                content: [
                  {
                    type: "text",
                    text:
                      `Still waiting on ${name} [${terminal.paneId}]` +
                      `\ncondition: ${waitFor}${params.pattern ? ` matching ${JSON.stringify(params.pattern)}` : ""}` +
                      `\n\n${buildReadText(name, previewPayload, "scrollback")}`,
                  },
                ],
                details: {
                  action: params.action,
                  workspace: state.workspaceName,
                  terminal,
                  waitFor,
                  pattern: params.pattern ?? null,
                  timeoutMs,
                  previewStartLine: previewPayload.startLine,
                  previewEndLine: previewPayload.endLine,
                  previewTotalLines: previewPayload.totalLines,
                },
              });
            }

            await new Promise((resolve) => setTimeout(resolve, pollMs));
          }

          const finalOutput =
            waitFor === "exit"
              ? await dumpTerminal(terminal, { full: true, ansi: params.ansi })
              : lastSeenOutput;
          const finalPayload = buildPayload(finalOutput, params.tail ?? 40);
          throw new Error(
            `Timed out waiting on ${name} [${terminal.paneId}] after ${timeoutMs}ms\ncondition: ${waitFor}${params.pattern ? ` matching ${JSON.stringify(params.pattern)}` : ""}` +
              `\n\n${buildReadText(name, finalPayload, "scrollback")}`,
          );
        }

        case "kill": {
          const name = requireName(params);
          const terminal = await getTerminalOrThrow(name);
          await closeTerminal(terminal);
          return {
            content: [
              {
                type: "text",
                text: `Killed terminal ${name} [${terminal.paneId}]`,
              },
            ],
            details: { action: params.action, workspace: state.workspaceName, terminal },
          };
        }
      }
    },
  });
}
