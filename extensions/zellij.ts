import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateTail,
  withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ZellijParams = Type.Object({
  action: StringEnum(
    [
      "list_sessions",
      "ensure_session",
      "kill_session",
      "list_panes",
      "list_tabs",
      "create_pane",
      "create_tab",
      "close_pane",
      "close_tab",
      "send_input",
      "send_keys",
      "dump_screen",
    ] as const,
    { description: "Zellij action to perform." },
  ),
  session: Type.Optional(
    Type.String({
      description: "Target zellij session name. Required for all actions except list_sessions.",
    }),
  ),
  paneId: Type.Optional(
    Type.String({
      description: "Pane ID like 'terminal_1', 'plugin_2', or bare number '3'.",
    }),
  ),
  tabId: Type.Optional(
    Type.Integer({
      description: "Stable tab ID. Used by close_tab.",
    }),
  ),
  name: Type.Optional(
    Type.String({
      description: "Pane or tab name for create_pane/create_tab.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory for create_pane/create_tab.",
    }),
  ),
  command: Type.Optional(
    Type.Array(
      Type.String({ description: "One argv segment. Example: ['bash', '-lc', 'just dev']" }),
      { description: "Command argv to run directly in a pane or tab, bypassing shell parsing." },
    ),
  ),
  shell: Type.Optional(
    Type.String({
      description:
        "Shell executable for clean shell launch. Defaults to $SHELL, then zsh, then bash.",
    }),
  ),
  shellProfile: Type.Optional(
    StringEnum(["default", "clean"] as const, {
      description:
        "For create_pane/create_tab without command: launch the default zellij shell or a quieter clean interactive shell.",
    }),
  ),
  direction: Type.Optional(
    StringEnum(["right", "down"] as const, {
      description: "Direction for create_pane when not floating/in_place.",
    }),
  ),
  floating: Type.Optional(Type.Boolean({ description: "Open the pane as floating." })),
  inPlace: Type.Optional(
    Type.Boolean({ description: "Open the pane in place of the focused pane." }),
  ),
  closeOnExit: Type.Optional(
    Type.Boolean({ description: "Close pane/tab immediately when its command exits." }),
  ),
  startSuspended: Type.Optional(
    Type.Boolean({ description: "Start command suspended until Enter is pressed." }),
  ),
  nearCurrentPane: Type.Optional(
    Type.Boolean({ description: "Open near the current pane instead of following focus." }),
  ),
  stacked: Type.Optional(Type.Boolean({ description: "Open the pane in stacked mode." })),
  pinned: Type.Optional(Type.Boolean({ description: "Pin a floating pane so it stays on top." })),
  borderless: Type.Optional(Type.Boolean({ description: "Set borderless mode for a new pane." })),
  x: Type.Optional(Type.String({ description: "Floating pane x coordinate, eg. '10' or '10%'." })),
  y: Type.Optional(Type.String({ description: "Floating pane y coordinate, eg. '10' or '10%'." })),
  width: Type.Optional(Type.String({ description: "Floating pane width, eg. '80' or '80%'." })),
  height: Type.Optional(Type.String({ description: "Floating pane height, eg. '24' or '50%'." })),
  block: Type.Optional(
    StringEnum(["pane_closed", "exit", "exit_success", "exit_failure"] as const, {
      description: "Blocking behavior for create_pane/create_tab.",
    }),
  ),
  text: Type.Optional(Type.String({ description: "Text to send for send_input." })),
  inputMode: Type.Optional(
    StringEnum(["paste", "write_chars"] as const, {
      description: "Input mode for send_input. Prefer paste unless you need literal typing.",
    }),
  ),
  keys: Type.Optional(
    Type.Array(Type.String({ description: "Single key spec, eg. 'Enter' or 'Ctrl c'." }), {
      description: "Key names for send_keys.",
    }),
  ),
  full: Type.Optional(Type.Boolean({ description: "For dump_screen: include full scrollback." })),
  ansi: Type.Optional(Type.Boolean({ description: "For dump_screen: preserve ANSI styling." })),
  outputFile: Type.Optional(
    Type.String({
      description:
        "Optional path to write full dump_screen output. Relative paths are resolved from the current working directory.",
    }),
  ),
});

type ZellijParamsType = Static<typeof ZellijParams>;

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
};

type ZellijSessionInfo = {
  name: string;
  current: boolean;
  raw: string;
};

const TERMINAL_OR_PLUGIN_ID = /^(terminal|plugin)_\d+$/;
const INTEGER_TEXT = /^\d+$/;

type ShellLaunch = {
  argv: string[];
  profile: "default" | "clean";
  shellPath?: string;
  shellKind?: "zsh" | "bash" | "other";
  initPath?: string;
  envLoader?: "direnv";
};

function requireSession(params: ZellijParamsType): string {
  if (!params.session?.trim()) {
    throw new Error(`Action ${params.action} requires a session.`);
  }
  return params.session.trim();
}

function requirePaneId(params: ZellijParamsType): string {
  if (!params.paneId?.trim()) {
    throw new Error(`Action ${params.action} requires paneId.`);
  }
  return params.paneId.trim();
}

function requireTabId(params: ZellijParamsType): number {
  if (typeof params.tabId !== "number") {
    throw new Error(`Action ${params.action} requires tabId.`);
  }
  return params.tabId;
}

function requireText(params: ZellijParamsType): string {
  if (typeof params.text !== "string") {
    throw new Error(`Action ${params.action} requires text.`);
  }
  return params.text;
}

function requireKeys(params: ZellijParamsType): string[] {
  if (!params.keys?.length) {
    throw new Error(`Action ${params.action} requires at least one key.`);
  }
  return params.keys;
}

function normalizeOutputPath(cwd: string, outputFile: string): string {
  const cleaned = outputFile.startsWith("@") ? outputFile.slice(1) : outputFile;
  return path.resolve(cwd, cleaned);
}

function buildBlockingArgs(block: ZellijParamsType["block"]): string[] {
  switch (block) {
    case "pane_closed":
      return ["--blocking"];
    case "exit":
      return ["--block-until-exit"];
    case "exit_success":
      return ["--block-until-exit-success"];
    case "exit_failure":
      return ["--block-until-exit-failure"];
    default:
      return [];
  }
}

function parseSessions(stdout: string): ZellijSessionInfo[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const current = line.endsWith("(current)");
      const base = current ? line.slice(0, -"(current)".length).trim() : line;
      return { name: base, current, raw: line };
    });
}

function previewOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n");
}

function parseJsonOrThrow<T>(stdout: string, stderr: string, context: string): T {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    throw new Error(
      `${context} returned non-JSON output.\n\n${previewOutput(stdout, stderr) || "<no output>"}`,
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${context} returned invalid JSON: ${message}\n\n${previewOutput(stdout, stderr) || "<no output>"}`,
    );
  }
}

function parseCreatedPaneIdOrThrow(stdout: string, stderr: string, context: string): string {
  const paneId = stdout.trim();
  if (!TERMINAL_OR_PLUGIN_ID.test(paneId)) {
    throw new Error(
      `${context} returned an unexpected pane id.\n\n${previewOutput(stdout, stderr) || "<no output>"}`,
    );
  }
  return paneId;
}

function parseCreatedTabIdOrThrow(stdout: string, stderr: string, context: string): number {
  const raw = stdout.trim();
  if (!INTEGER_TEXT.test(raw)) {
    throw new Error(
      `${context} returned an unexpected tab id.\n\n${previewOutput(stdout, stderr) || "<no output>"}`,
    );
  }
  return Number.parseInt(raw, 10);
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
    const cleanPreferred = await findKnownShell(["bash", "zsh"]);
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

async function buildShellLaunch(params: ZellijParamsType): Promise<ShellLaunch | undefined> {
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
    const initDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-zellij-zsh-"));
    const initPath = path.join(initDir, ".zshrc");
    await fs.writeFile(
      initPath,
      ["unsetopt beep", "PROMPT='agent:%1~ %# '", "RPROMPT=''", "export ZELLIJ_AGENT_SHELL=1"].join(
        "\n",
      ) + "\n",
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
    const initDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-zellij-bash-"));
    const initPath = path.join(initDir, "bashrc");
    await fs.writeFile(
      initPath,
      ["PS1='agent:\\w\\$ '", "unset PROMPT_COMMAND", "export ZELLIJ_AGENT_SHELL=1"].join("\n") +
        "\n",
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

async function truncateDump(text: string): Promise<{
  text: string;
  details: Record<string, unknown>;
}> {
  const truncation = truncateTail(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return {
      text,
      details: { truncated: false },
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-zellij-dump-"));
  const tempFile = path.join(tempDir, "dump.txt");
  await fs.writeFile(tempFile, text, "utf8");

  let note = `\n\n[Output truncated: showing last ${truncation.outputLines} of ${truncation.totalLines} lines`;
  note += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
  note += ` Full output saved to: ${tempFile}]`;

  return {
    text: truncation.content + note,
    details: {
      truncated: true,
      tempFile,
      outputLines: truncation.outputLines,
      totalLines: truncation.totalLines,
      outputBytes: truncation.outputBytes,
      totalBytes: truncation.totalBytes,
    },
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "zellij",
    label: "Zellij",
    description: [
      "Control zellij sessions, tabs, and panes via the supported CLI automation surface.",
      "Use this for headless session creation, pane/tab management, sending input, and reading pane output.",
      `dump_screen output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first); if truncated, the full dump is saved to a temp file.`,
      "Prefer command argv arrays for create_pane/create_tab to avoid shell quoting issues.",
    ].join("\n"),
    promptSnippet:
      "Control zellij sessions, tabs, and panes using the official CLI automation surface.",
    promptGuidelines: [
      "Use this tool instead of bash when the user wants zellij pane/session management.",
      "Prefer send_input with inputMode='paste' for commands sent to an interactive shell pane.",
      "Prefer create_pane/create_tab with command argv when you know the command up front.",
    ],
    parameters: ZellijParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      async function run(args: string[]): Promise<ExecResult> {
        const result = await pi.exec("zellij", args, { signal });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
          killed: result.killed,
        };
      }

      async function runOrThrow(args: string[]): Promise<ExecResult> {
        const result = await run(args);
        if (result.code !== 0) {
          const rendered = [result.stderr.trim(), result.stdout.trim()]
            .filter(Boolean)
            .join("\n\n");
          throw new Error(
            `zellij ${args.join(" ")} failed (exit ${result.code})\n\n${rendered}`.trim(),
          );
        }
        return result;
      }

      async function listSessions(): Promise<ZellijSessionInfo[]> {
        const result = await runOrThrow(["list-sessions", "--short", "--no-formatting"]);
        return parseSessions(result.stdout);
      }

      switch (params.action) {
        case "list_sessions": {
          const sessions = await listSessions();
          const text = sessions.length
            ? sessions.map((session) => `${session.current ? "*" : "-"} ${session.name}`).join("\n")
            : "No active zellij sessions.";
          return {
            content: [{ type: "text", text }],
            details: { action: params.action, sessions },
          };
        }

        case "ensure_session": {
          const session = requireSession(params);
          const sessions = await listSessions();
          const existing = sessions.find((entry) => entry.name === session);
          if (!existing) {
            await runOrThrow(["attach", "--create-background", session]);
          }

          const deadline = Date.now() + 2_000;
          let refreshed = sessions;
          let ensured = refreshed.find((entry) => entry.name === session);
          while (!ensured && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 75));
            refreshed = await listSessions();
            ensured = refreshed.find((entry) => entry.name === session);
          }

          if (!ensured) {
            throw new Error(`Session ${session} did not appear after creation.`);
          }

          return {
            content: [
              {
                type: "text",
                text: existing
                  ? `Session ${session} already exists.`
                  : `Created background session ${session}.`,
              },
            ],
            details: {
              action: params.action,
              session,
              existed: Boolean(existing),
              sessionInfo: ensured,
              sessions: refreshed,
            },
          };
        }

        case "kill_session": {
          const session = requireSession(params);
          await runOrThrow(["kill-session", session]);
          return {
            content: [{ type: "text", text: `Killed session ${session}.` }],
            details: { action: params.action, session },
          };
        }

        case "list_panes": {
          const session = requireSession(params);
          const result = await runOrThrow(["--session", session, "action", "list-panes", "--json"]);
          const panes = parseJsonOrThrow<Array<Record<string, unknown>>>(
            result.stdout,
            result.stderr,
            `zellij list-panes for session ${session}`,
          );
          const text = panes.length
            ? panes
                .map((pane) => {
                  const kind = pane.is_plugin ? "plugin" : "terminal";
                  const id = `${kind}_${String(pane.id)}`;
                  const title = typeof pane.title === "string" ? pane.title : "";
                  const tabName = typeof pane.tab_name === "string" ? pane.tab_name : "";
                  const focused = pane.is_focused ? " focused" : "";
                  const floating = pane.is_floating ? " floating" : "";
                  const exited = pane.exited ? " exited" : "";
                  return `${id} ${title}${tabName ? ` [${tabName}]` : ""}${focused || floating || exited ? ` (${[focused.trim(), floating.trim(), exited.trim()].filter(Boolean).join(", ")})` : ""}`;
                })
                .join("\n")
            : `No panes found in session ${session}.`;
          return {
            content: [{ type: "text", text }],
            details: { action: params.action, session, panes },
          };
        }

        case "list_tabs": {
          const session = requireSession(params);
          const result = await runOrThrow(["--session", session, "action", "list-tabs", "--json"]);
          const tabs = parseJsonOrThrow<Array<Record<string, unknown>>>(
            result.stdout,
            result.stderr,
            `zellij list-tabs for session ${session}`,
          );
          const text = tabs.length
            ? tabs
                .map((tab) => {
                  const name = typeof tab.name === "string" ? tab.name : "Tab";
                  const id = typeof tab.tab_id === "number" ? tab.tab_id : "?";
                  const position = typeof tab.position === "number" ? tab.position : "?";
                  const active = tab.active ? " active" : "";
                  return `${id}: ${name} (position ${position}${active ? ", active" : ""})`;
                })
                .join("\n")
            : `No tabs found in session ${session}.`;
          return {
            content: [{ type: "text", text }],
            details: { action: params.action, session, tabs },
          };
        }

        case "create_pane": {
          const session = requireSession(params);
          const shellLaunch = await buildShellLaunch(params);
          const args = ["--session", session, "action", "new-pane"];
          if (params.name) args.push("--name", params.name);
          if (params.cwd) args.push("--cwd", params.cwd);
          if (params.direction) args.push("--direction", params.direction);
          if (params.floating) args.push("--floating");
          if (params.inPlace) args.push("--in-place");
          if (params.closeOnExit) args.push("--close-on-exit");
          if (params.startSuspended) args.push("--start-suspended");
          if (params.nearCurrentPane) args.push("--near-current-pane");
          if (params.stacked) args.push("--stacked");
          if (typeof params.pinned === "boolean") args.push("--pinned", String(params.pinned));
          if (typeof params.borderless === "boolean") {
            args.push("--borderless", String(params.borderless));
          }
          if (params.x) args.push("--x", params.x);
          if (params.y) args.push("--y", params.y);
          if (params.width) args.push("--width", params.width);
          if (params.height) args.push("--height", params.height);
          args.push(...buildBlockingArgs(params.block));
          if (shellLaunch?.argv.length) {
            args.push("--", ...shellLaunch.argv);
          }
          const result = await runOrThrow(args);
          const paneId = parseCreatedPaneIdOrThrow(
            result.stdout,
            result.stderr,
            `zellij create_pane for session ${session}`,
          );
          return {
            content: [{ type: "text", text: `Created pane ${paneId} in session ${session}.` }],
            details: {
              action: params.action,
              session,
              paneId,
              args,
              shellLaunch,
            },
          };
        }

        case "create_tab": {
          const session = requireSession(params);
          const shellLaunch = await buildShellLaunch(params);
          const args = ["--session", session, "action", "new-tab"];
          if (params.name) args.push("--name", params.name);
          if (params.cwd) args.push("--cwd", params.cwd);
          if (params.closeOnExit) args.push("--close-on-exit");
          if (params.startSuspended) args.push("--start-suspended");
          args.push(...buildBlockingArgs(params.block));
          if (shellLaunch?.argv.length) {
            args.push("--", ...shellLaunch.argv);
          }
          const result = await runOrThrow(args);
          const tabId = parseCreatedTabIdOrThrow(
            result.stdout,
            result.stderr,
            `zellij create_tab for session ${session}`,
          );
          const tabIdRaw = String(tabId);
          return {
            content: [{ type: "text", text: `Created tab ${tabIdRaw} in session ${session}.` }],
            details: {
              action: params.action,
              session,
              tabId,
              rawTabId: tabIdRaw,
              args,
              shellLaunch,
            },
          };
        }

        case "close_pane": {
          const session = requireSession(params);
          const paneId = requirePaneId(params);
          await runOrThrow(["--session", session, "action", "close-pane", "--pane-id", paneId]);
          return {
            content: [{ type: "text", text: `Closed pane ${paneId} in session ${session}.` }],
            details: { action: params.action, session, paneId },
          };
        }

        case "close_tab": {
          const session = requireSession(params);
          const tabId = requireTabId(params);
          await runOrThrow([
            "--session",
            session,
            "action",
            "close-tab",
            "--tab-id",
            String(tabId),
          ]);
          return {
            content: [{ type: "text", text: `Closed tab ${tabId} in session ${session}.` }],
            details: { action: params.action, session, tabId },
          };
        }

        case "send_input": {
          const session = requireSession(params);
          const paneId = requirePaneId(params);
          const text = requireText(params);
          const inputMode = params.inputMode ?? "paste";
          const actionName = inputMode === "write_chars" ? "write-chars" : "paste";
          await runOrThrow(["--session", session, "action", actionName, "--pane-id", paneId, text]);
          return {
            content: [
              {
                type: "text",
                text: `Sent ${inputMode === "paste" ? "pasted text" : "typed characters"} to ${paneId}.`,
              },
            ],
            details: {
              action: params.action,
              session,
              paneId,
              inputMode,
              bytes: Buffer.byteLength(text),
            },
          };
        }

        case "send_keys": {
          const session = requireSession(params);
          const paneId = requirePaneId(params);
          const keys = requireKeys(params);
          await runOrThrow([
            "--session",
            session,
            "action",
            "send-keys",
            "--pane-id",
            paneId,
            ...keys,
          ]);
          return {
            content: [{ type: "text", text: `Sent keys to ${paneId}: ${keys.join(", ")}` }],
            details: { action: params.action, session, paneId, keys },
          };
        }

        case "dump_screen": {
          const session = requireSession(params);
          const paneId = requirePaneId(params);
          const args = ["--session", session, "action", "dump-screen", "--pane-id", paneId];
          if (params.full) args.push("--full");
          if (params.ansi) args.push("--ansi");

          let rawOutput: string;
          let absoluteOutputFile: string | undefined;

          if (params.outputFile) {
            absoluteOutputFile = normalizeOutputPath(ctx.cwd, params.outputFile);
            const outputPath = absoluteOutputFile;
            await withFileMutationQueue(outputPath, async () => {
              await fs.mkdir(path.dirname(outputPath), { recursive: true });
            });
            await runOrThrow([...args, "--path", outputPath]);
            rawOutput = await fs.readFile(outputPath, "utf8");
          } else {
            const result = await runOrThrow(args);
            rawOutput = result.stdout;
          }

          const truncated = await truncateDump(rawOutput);
          const wroteFileNote = absoluteOutputFile
            ? ` Full output also written to ${absoluteOutputFile}.`
            : "";
          return {
            content: [{ type: "text", text: truncated.text + wroteFileNote }],
            details: {
              action: params.action,
              session,
              paneId,
              full: Boolean(params.full),
              ansi: Boolean(params.ansi),
              outputFile: absoluteOutputFile,
              truncation: truncated.details,
            },
          };
        }
      }
    },
  });
}
