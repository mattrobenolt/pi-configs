import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  truncateTail,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  checkAbort,
  commandCompletion,
  commandOutput,
  commandStatus,
  commonPrefix,
  createdPaneId,
  DeadlineReached,
  delay,
  enqueue,
  findExecutable,
  linesOf,
  outputMatcher,
  paneId,
  parsePanes,
  remainingTime,
  shellKind,
  trackedCommand,
  withinDeadline,
  type OutputMatch,
  type PaneInfo,
} from "./core.ts";

const Actions = [
  "list",
  "ensure",
  "run",
  "resize",
  "send",
  "keys",
  "read",
  "wait",
  "interrupt",
  "kill",
] as const;
const WaitConditions = ["command", "exit", "output", "silence"] as const;
const Outcomes = [
  "listed",
  "created",
  "existing",
  "resized",
  "sent",
  "interrupted",
  "read",
  "matched",
  "exited",
  "exited_without_match",
  "silent",
  "timed_out",
  "missing",
  "killed",
] as const;

const TermParams = Type.Object({
  action: StringEnum(Actions, {
    description: "Action. Use run for shell commands and send for raw program input.",
  }),
  name: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 128,
      description: "Terminal name. Required except for list.",
    }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for a new terminal." })),
  command: Type.Optional(
    Type.Array(Type.String(), {
      minItems: 1,
      description: "For ensure: startup argv. Omit for an interactive shell.",
    }),
  ),
  shell: Type.Optional(
    Type.String({
      description: "Interactive shell path or name. Default: $SHELL, then zsh or bash.",
    }),
  ),
  shellProfile: Type.Optional(
    StringEnum(["default", "clean"] as const, {
      description: "Shell profile. Default: clean. default loads the normal shell configuration.",
    }),
  ),
  closeOnExit: Type.Optional(
    Type.Boolean({
      description:
        "For ensure: remove the pane on exit. This discards output and exit status. Default: false.",
    }),
  ),
  width: Type.Optional(
    Type.String({ description: "Pane width, such as '120' or '90%'. Default: '100%'." }),
  ),
  height: Type.Optional(
    Type.String({ description: "Pane height, such as '30' or '100%'. Default: '100%'." }),
  ),
  x: Type.Optional(Type.String({ description: "Horizontal pane position. Default: '0'." })),
  y: Type.Optional(Type.String({ description: "Vertical pane position. Default: '0'." })),
  text: Type.Optional(
    Type.String({ description: "For run: shell command. For send: raw input text." }),
  ),
  enter: Type.Optional(
    Type.Boolean({ description: "For send: append Enter. run always submits the command." }),
  ),
  keys: Type.Optional(
    Type.Array(Type.String(), {
      minItems: 1,
      description: "For keys: key names, such as ['Ctrl c'].",
    }),
  ),
  inputMode: Type.Optional(
    StringEnum(["paste", "write_chars"] as const, {
      description: "For send: paste or write_chars. Default: write_chars.",
    }),
  ),
  mode: Type.Optional(
    StringEnum(["screen", "scrollback", "delta"] as const, {
      description:
        "Read mode. Default: scrollback. Delta returns changed lines and accepts limit only.",
    }),
  ),
  offset: Type.Optional(
    Type.Integer({ minimum: 1, description: "For read: first line, indexed from 1." }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "Maximum returned lines. Read default: 120. Delta reads consume only these lines.",
    }),
  ),
  tail: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Return the last N lines. Not valid for delta reads.",
    }),
  ),
  ansi: Type.Optional(
    Type.Boolean({
      description: "For read: preserve ANSI escapes. Wait patterns always use plain text.",
    }),
  ),
  waitFor: Type.Optional(
    StringEnum(WaitConditions, {
      description:
        "Wait condition. Default: output with pattern, command after run, otherwise exit. Silence does not prove command completion.",
    }),
  ),
  pattern: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 2048,
      description:
        "Literal output text. This selects an output wait. Use matchMode: regex for regular expressions.",
    }),
  ),
  matchMode: Type.Optional(
    StringEnum(["literal", "regex"] as const, {
      description:
        "Output match mode. Default: literal. Regex uses JavaScript multiline syntax without slash delimiters.",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "For run/wait: wait timeout in milliseconds. Default: 30000. Timeout does not stop the process.",
    }),
  ),
  idleMs: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "For silence waits: required quiet period. Default: 2000 milliseconds.",
    }),
  ),
  pollMs: Type.Optional(
    Type.Integer({
      minimum: 50,
      description: "For run/wait: poll interval. Default: 500 milliseconds.",
    }),
  ),
  restart: Type.Optional(
    Type.Boolean({ description: "For ensure: replace an existing terminal. Default: false." }),
  ),
});

type Params = Static<typeof TermParams>;
type Outcome = (typeof Outcomes)[number];
type WaitCondition = (typeof WaitConditions)[number];

const TermOutput = Type.Object(
  {
    action: StringEnum(Actions),
    outcome: StringEnum(Outcomes),
    workspace: Type.String(),
    name: Type.Optional(Type.String()),
    paneId: Type.Optional(Type.String()),
    output: Type.String(),
    message: Type.String(),
    waitFor: Type.Optional(StringEnum(WaitConditions)),
    conditionMet: Type.Optional(Type.Boolean()),
    exitStatus: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
    runId: Type.Optional(Type.String()),
    matchedText: Type.Optional(Type.String()),
    matchedLine: Type.Optional(Type.String()),
    matchLine: Type.Optional(Type.Integer()),
    fullOutputPath: Type.Optional(Type.String()),
    truncated: Type.Boolean(),
  },
  { additionalProperties: true },
);

type CommandRun = {
  id: string;
  marker: string;
  statusPath: string;
  exitStatus?: number;
  output?: string;
};

type TerminalState = {
  name: string;
  paneId: string;
  cwd: string;
  command?: string[];
  shellKind?: "bash" | "zsh" | "other";
  closeOnExit: boolean;
  createdAt: number;
  deltaSnapshot: string[];
  lastRun?: CommandRun;
  width: string;
  height: string;
  x: string;
  y: string;
};

type PendingCreation = { terminal: TerminalState; before: Set<string> };
type Queue = { tail: Promise<void> };
type Workspace = {
  name: string;
  terminals: Map<string, TerminalState>;
  pending: Map<string, PendingCreation>;
  temporaryPaths: Set<string>;
  commands: Queue;
  mutations: Queue;
  initialization?: Promise<void>;
  ioDirectory?: Promise<string>;
};

function shortId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function requireName(params: Params): string {
  if (!params.name?.trim()) throw new Error(`Action ${params.action} requires name.`);
  return params.name.trim();
}

function requireText(params: Params): string {
  if (typeof params.text !== "string") throw new Error(`Action ${params.action} requires text.`);
  return params.text;
}

function geometry(params: Params, existing?: TerminalState) {
  const size = {
    width: params.width?.trim() || existing?.width || "100%",
    height: params.height?.trim() || existing?.height || "100%",
    x: params.x?.trim() || existing?.x || "0",
    y: params.y?.trim() || existing?.y || "0",
  };
  for (const [name, value] of Object.entries(size)) {
    const percent = value.endsWith("%");
    const number = Number(percent ? value.slice(0, -1) : value);
    const minimum = name === "x" || name === "y" ? 0 : 1;
    if (!/^\d+%?$/.test(value) || number < minimum || number > (percent ? 100 : 65535)) {
      throw new Error(
        `The ${name} value ${value} is invalid. Use a pane size from 1 to 65535, or a percentage from 1% to 100%. Positions can be zero.`,
      );
    }
  }
  return size;
}

function preview(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n") || "<no output>";
}

function cleanOutput(output: string): string {
  const lines = linesOf(output);
  let start = 0;
  while (lines[start]?.startsWith("direnv: ")) start++;
  while (lines[start] === "") start++;
  return lines.slice(start).join("\n");
}

function terminalInfo(terminal: TerminalState, pane?: PaneInfo) {
  return {
    name: terminal.name,
    paneId: terminal.paneId,
    cwd: terminal.cwd,
    command: terminal.command ?? null,
    createdAt: terminal.createdAt,
    width: terminal.width,
    height: terminal.height,
    x: terminal.x,
    y: terminal.y,
    closeOnExit: terminal.closeOnExit,
    status: pane ? (pane.exited ? "exited" : "running") : "missing",
    exitStatus: pane?.exit_status ?? null,
    lastRunId: terminal.lastRun?.id ?? null,
  };
}

function selectLines(lines: string[], params: Pick<Params, "offset" | "limit" | "tail">) {
  const count = params.tail ?? params.limit ?? 120;
  const start =
    params.offset !== undefined
      ? Math.min(lines.length, params.offset - 1)
      : Math.max(0, lines.length - count);
  const end = Math.min(lines.length, start + count);
  return {
    output: lines.slice(start, end).join("\n"),
    startLine: end > start ? start + 1 : 0,
    endLine: end > start ? end : 0,
    totalLines: lines.length,
    hasMoreBefore: start > 0,
    hasMoreAfter: end < lines.length,
  };
}

function matchEvidence(match: OutputMatch) {
  const matchedText = truncateHead(match.matchedText, { maxBytes: 2048, maxLines: 4 }).content;
  const index = match.matchedLine.indexOf(match.matchedText.split("\n")[0]);
  const start = Math.max(0, index - 160);
  const line = match.matchedLine.slice(start);
  const excerpt = truncateHead(line, { maxBytes: 2560, maxLines: 4 });
  return {
    matchedText,
    matchedLine: `${start ? "…" : ""}${excerpt.content}${excerpt.truncated ? "…" : ""}`,
    matchLine: match.matchLine,
  };
}

const BOOTSTRAP = `import os, pty, fcntl, termios, struct, subprocess, time, select, sys
session, cols, rows = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
master, slave = pty.openpty()
p = None
captured = bytearray()
try:
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    env = dict(os.environ, TERM='xterm-256color')
    p = subprocess.Popen(['zellij', 'attach', session], stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True)
    os.close(slave)
    slave = None
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.05)[0]:
            try:
                captured.extend(os.read(master, 65536))
            except OSError:
                break
        if p.poll() is not None:
            break
    if p.poll() is not None:
        raise RuntimeError('Zellij attach exited before workspace resize: ' + captured[-2048:].decode(errors='replace'))
finally:
    if p is not None and p.poll() is None:
        p.terminate()
        try:
            p.wait(timeout=1)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
    if slave is not None:
        os.close(slave)
    os.close(master)
`;

export default function (pi: ExtensionAPI) {
  let workspace: Workspace | undefined;

  function getWorkspace(): Workspace {
    workspace ??= {
      name: `pt-${shortId()}`,
      terminals: new Map(),
      pending: new Map(),
      temporaryPaths: new Set(),
      commands: { tail: Promise.resolve() },
      mutations: { tail: Promise.resolve() },
    };
    return workspace;
  }

  async function cleanup() {
    const state = workspace;
    if (!state) return;
    workspace = undefined;
    await Promise.allSettled([state.commands.tail, state.mutations.tail]);
    await pi.exec("zellij", ["kill-session", state.name], { timeout: 2000 }).catch(() => {});
    await pi.exec("zellij", ["delete-session", state.name], { timeout: 2000 }).catch(() => {});
    for (const dir of state.temporaryPaths)
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  pi.on("session_start", cleanup);
  pi.on("session_shutdown", cleanup);

  pi.registerTool({
    name: "term",
    label: "Term",
    description: [
      "Manage named terminals in a private Zellij workspace.",
      "Use run with name and text for shell commands. It creates a shell if needed, preserves shell state, and tracks completion automatically.",
      "After a run timeout, use wait with the same name. The command continues until completion or interruption.",
      "Use ensure with command argv for a dedicated process, then wait for exit. Use send for raw REPL or program input.",
      "A pattern selects an output wait and matches literal text by default. Use matchMode: regex for JavaScript multiline syntax.",
      "Output waits search full scrollback, including old output and command echo. They are readiness checks, not command-completion checks.",
      "Wait outcomes distinguish matched, exited, exited_without_match, silent, timed_out, and missing. Silence does not prove completion.",
      "Output is capped at 2000 lines or 50KB. Truncated results include a fullOutputPath that remains available until session shutdown.",
    ].join("\n"),
    promptSnippet:
      "Use term run for persistent shell commands with automatic completion tracking. Use send for raw program input.",
    parameters: TermParams,
    outputSchema: TermOutput,
    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("term ")) + theme.fg("muted", args.action);
      if (args.name) text += " " + theme.fg("accent", args.name);
      if (args.text) text += " " + theme.fg("dim", JSON.stringify(args.text.slice(0, 100)));
      if (args.command) text += " " + theme.fg("dim", args.command.join(" ").slice(0, 100));
      if (args.pattern)
        text +=
          " " + theme.fg("dim", `${args.matchMode ?? "literal"}:${JSON.stringify(args.pattern)}`);
      return new Text(text, 0, 0);
    },
    async execute(_id, params, signal, onUpdate, ctx) {
      const state = getWorkspace();
      let deadline: number | undefined;

      // Serialize CLI calls, not wait loops. Mutations also serialize complete input sequences.
      async function runCli(args: string[]) {
        const callDeadline = deadline;
        const job = enqueue(state.commands, async () => {
          checkAbort(signal);
          const result = await pi.exec("zellij", args, {
            signal,
            timeout: remainingTime(callDeadline),
          });
          checkAbort(signal);
          if (callDeadline !== undefined) remainingTime(callDeadline);
          return result;
        });
        return callDeadline === undefined ? job : withinDeadline(job, callDeadline, signal);
      }

      function checkResult(result: Awaited<ReturnType<typeof runCli>>, context: string) {
        if (
          result.code !== 0 ||
          result.killed ||
          /Session '.+' not found|There is no active session!/.test(result.stderr)
        ) {
          throw new Error(
            `${context} failed (exit ${result.code}${result.killed ? ", killed" : ""}).\n${preview(result.stdout, result.stderr)}`,
          );
        }
      }

      async function mutation(args: string[], context: string) {
        const result = await runCli(args);
        checkResult(result, context);
        return result;
      }

      // Only read-only queries are retried. A repeated mutation can duplicate a process.
      async function query<T>(
        args: string[],
        context: string,
        parse: (text: string) => T | Promise<T>,
        prepare?: () => Promise<unknown>,
      ): Promise<T> {
        let failure = "";
        for (let attempt = 0; attempt < 3; attempt++) {
          checkAbort(signal);
          remainingTime(deadline);
          await prepare?.();
          const result = await runCli(args);
          try {
            checkResult(result, context);
            return await parse(result.stdout);
          } catch (error) {
            failure = `${String(error)}\nstdout/stderr: ${preview(result.stdout, result.stderr).slice(0, 4096)}`;
          }
          if (attempt < 2) await delay(50 * (attempt + 1), signal, deadline);
        }
        throw new Error(`${context} failed after 3 read attempts.\n${failure}`);
      }

      async function ensureWorkspace() {
        if (!state.initialization) {
          state.initialization = (async () => {
            await mutation(
              ["attach", "--create-background", state.name],
              "Zellij workspace creation",
            );
            const python = await findExecutable("python3");
            if (!python)
              throw new Error(
                "Workspace setup requires python3 on PATH. Add Python to the dev shell.",
              );
            const result = await pi.exec(python, ["-c", BOOTSTRAP, state.name, "160", "60"], {
              signal,
              timeout: 5000,
            });
            checkAbort(signal);
            if (result.code !== 0 || result.killed)
              throw new Error(`Workspace resize failed.\n${preview(result.stdout, result.stderr)}`);
          })();
          state.initialization.catch(() => {
            state.initialization = undefined;
          });
        }
        await state.initialization;
      }

      async function listPanes(): Promise<PaneInfo[]> {
        await ensureWorkspace();
        return query(
          ["--session", state.name, "action", "list-panes", "--json"],
          "Zellij pane query",
          parsePanes,
        );
      }

      async function findPane(terminal: TerminalState) {
        return (await listPanes()).find((pane) => paneId(pane) === terminal.paneId);
      }

      function ioDirectory() {
        state.ioDirectory ??= fs.mkdtemp(path.join(os.tmpdir(), "pi-term-io-")).then((dir) => {
          state.temporaryPaths.add(dir);
          return dir;
        });
        return state.ioDirectory;
      }

      async function completion(receipt: CommandRun, output: string) {
        const marker = commandCompletion(output, receipt.marker);
        if (marker) return marker;
        // A receipt file survives scrollback rollover and background output after the prompt.
        const exitStatus = await commandStatus(receipt.statusPath);
        return exitStatus === undefined
          ? null
          : { exitStatus, output: commandOutput(output, receipt.marker) };
      }

      async function dump(terminal: TerminalState, full = true, ansi = false) {
        const target = path.join(await ioDirectory(), `${shortId()}.txt`);
        const args = [
          "--session",
          state.name,
          "action",
          "dump-screen",
          "--pane-id",
          terminal.paneId,
          "--path",
          target,
        ];
        if (full) args.push("--full");
        if (ansi) args.push("--ansi");
        try {
          // A fresh file proves that the query ran. Empty CLI stdout cannot prove that.
          return await query(
            args,
            `Zellij output query for ${terminal.name}`,
            async () => cleanOutput(await fs.readFile(target, "utf8")),
            () => fs.rm(target, { force: true }),
          );
        } finally {
          await fs.rm(target, { force: true });
        }
      }

      async function getTerminal(name: string) {
        const terminal = state.terminals.get(name);
        if (!terminal)
          throw new Error(`Terminal ${name} does not exist. Use ensure or run to create it.`);
        return terminal;
      }

      async function launchShell(cwd: string, command?: string[]) {
        const direnv = await findExecutable("direnv");
        const wrap = (argv: string[]) => (direnv ? [direnv, "exec", cwd, ...argv] : argv);
        if (command) return { argv: wrap(command), kind: undefined };
        const shell = params.shell
          ? await findExecutable(params.shell)
          : ((await findExecutable(process.env.SHELL || "zsh")) ??
            (await findExecutable("zsh")) ??
            (await findExecutable("bash")));
        if (!shell)
          throw new Error("No executable shell exists on PATH. Set shell to an executable path.");
        const kind = shellKind(shell);
        if (params.action === "run" && kind === "other")
          throw new Error(
            "run requires Bash or Zsh. Set shell to bash or zsh, or use ensure and send.",
          );
        if (params.shellProfile === "default" || kind === "other")
          return { argv: wrap([shell, "-i"]), kind };
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), `pi-term-${kind}-`));
        state.temporaryPaths.add(dir);
        if (kind === "zsh") {
          await fs.writeFile(
            path.join(dir, ".zshrc"),
            "unsetopt beep\nPROMPT='term:%1~ %# '\nRPROMPT=''\n",
          );
          return { argv: wrap(["env", `ZDOTDIR=${dir}`, shell, "-i"]), kind };
        }
        const rc = path.join(dir, "bashrc");
        await fs.writeFile(rc, "PS1='term:\\w\\$ '\nunset PROMPT_COMMAND\n");
        return { argv: wrap([shell, "--noprofile", "--rcfile", rc, "-i"]), kind };
      }

      async function recoverCreation(name: string) {
        const pending = state.pending.get(name);
        if (!pending) return undefined;
        const panes = (await listPanes()).filter(
          (pane) => !pane.is_plugin && !pending.before.has(paneId(pane)),
        );
        const named = panes.filter((pane) => pane.title === name);
        const pane = named.length === 1 ? named[0] : panes.length === 1 ? panes[0] : undefined;
        if (!pane)
          throw new Error(
            `Creation of ${name} is unconfirmed. No second process was launched. Inspect list before another creation.`,
          );
        pending.terminal.paneId = paneId(pane);
        state.terminals.set(name, pending.terminal);
        state.pending.delete(name);
        return pending.terminal;
      }

      async function createTerminal(name: string, command = params.command) {
        const recovered = await recoverCreation(name);
        if (recovered) return recovered;
        const size = geometry(params);
        const cwd = path.resolve(ctx.cwd, params.cwd?.trim() || ".");
        if (!(await fs.stat(cwd)).isDirectory())
          throw new Error(`Terminal directory ${cwd} is not a directory.`);
        const before = new Set((await listPanes()).map(paneId));
        const launch = await launchShell(cwd, command);
        const terminal: TerminalState = {
          name,
          paneId: "",
          cwd,
          command,
          shellKind: launch.kind,
          closeOnExit: Boolean(params.closeOnExit),
          createdAt: Date.now(),
          deltaSnapshot: [],
          ...size,
        };
        const args = [
          "--session",
          state.name,
          "action",
          "new-pane",
          "--name",
          name,
          "--floating",
          "--x",
          terminal.x,
          "--y",
          terminal.y,
          "--width",
          terminal.width,
          "--height",
          terminal.height,
          "--borderless",
          "true",
          "--cwd",
          cwd,
        ];
        if (params.closeOnExit) args.push("--close-on-exit");
        args.push("--", ...launch.argv);
        state.pending.set(name, { terminal, before });
        const result = await runCli(args);
        // Register a returned ID before any optional metadata query can fail.
        const id = createdPaneId(result.stdout, result.stderr);
        if (id) {
          terminal.paneId = id;
          state.terminals.set(name, terminal);
          state.pending.delete(name);
          return terminal;
        }
        try {
          return (await recoverCreation(name))!;
        } catch (error) {
          throw new Error(
            `${String(error)}\nCreation response (exit ${result.code}): ${preview(result.stdout, result.stderr)}`,
          );
        }
      }

      async function closeTerminal(terminal: TerminalState) {
        if (await findPane(terminal))
          await mutation(
            ["--session", state.name, "action", "close-pane", "--pane-id", terminal.paneId],
            `Close ${terminal.name}`,
          );
        state.terminals.delete(terminal.name);
      }

      async function sendInput(
        terminal: TerminalState,
        text: string,
        enter: boolean,
        inputMode: "paste" | "write_chars",
      ) {
        await mutation(
          [
            "--session",
            state.name,
            "action",
            inputMode === "paste" ? "paste" : "write-chars",
            "--pane-id",
            terminal.paneId,
            "--",
            text,
          ],
          `Send input to ${terminal.name}`,
        );
        if (enter)
          await mutation(
            ["--session", state.name, "action", "send-keys", "--pane-id", terminal.paneId, "Enter"],
            `Submit input to ${terminal.name}`,
          );
      }

      async function result(
        outcome: Outcome,
        message: string,
        output = "",
        fields: Record<string, unknown> = {},
        terminal?: TerminalState,
        isError = false,
      ) {
        const bounded = truncateTail(output, {
          maxBytes: DEFAULT_MAX_BYTES - 6144,
          maxLines: DEFAULT_MAX_LINES - 16,
        });
        let fullOutputPath: string | undefined;
        if (bounded.truncated) {
          const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-term-output-"));
          state.temporaryPaths.add(dir);
          fullOutputPath = path.join(dir, "output.txt");
          await fs.writeFile(fullOutputPath, output);
        }
        const data = {
          action: params.action,
          outcome,
          workspace: state.name,
          ...(terminal ? { name: terminal.name, paneId: terminal.paneId } : {}),
          ...fields,
          output: bounded.content,
          message,
          truncated: bounded.truncated,
          ...(fullOutputPath ? { fullOutputPath } : {}),
        };
        const note = fullOutputPath ? `\n\nOutput truncated. Full output: ${fullOutputPath}` : "";
        const content = truncateHead(
          `${message}${bounded.content ? `\n\n${bounded.content}` : ""}${note}`,
        ).content;
        return {
          content: [{ type: "text" as const, text: content }],
          details: data,
          structuredContent: data,
          isError,
        };
      }

      async function wait(
        terminal: TerminalState,
        forcedCondition?: WaitCondition,
        commandRun = terminal.lastRun,
      ) {
        checkAbort(signal);
        const condition =
          forcedCondition ??
          params.waitFor ??
          (params.pattern !== undefined ? "output" : terminal.lastRun ? "command" : "exit");
        if (params.pattern !== undefined && condition !== "output")
          throw new Error(
            "A pattern requires an output wait. Omit waitFor or set waitFor: output.",
          );
        if (params.matchMode && condition !== "output")
          throw new Error("matchMode requires an output wait with a pattern.");
        if (condition === "output" && params.pattern === undefined)
          throw new Error("Output waits require a pattern. Use run for shell command completion.");
        if (condition === "command" && !terminal.lastRun)
          throw new Error("No tracked command exists. Use run to launch a shell command.");
        if (condition === "exit" && !terminal.command && params.waitFor === undefined)
          throw new Error(
            "An interactive shell stays alive after commands. Use run for command completion, or explicitly waitFor: exit for shell shutdown.",
          );
        const matcher =
          condition === "output"
            ? outputMatcher(params.pattern!, params.matchMode ?? "literal")
            : undefined;
        const receipt = condition === "command" ? commandRun : undefined;

        const timeout = params.timeoutMs ?? 30_000;
        const idle = params.idleMs ?? 2000;
        const poll = params.pollMs ?? 500;
        deadline = Date.now() + timeout;
        let output = "";
        let lastChange = Date.now();
        let initialized = false;
        let nextUpdate = Date.now();
        const base = {
          waitFor: condition,
          conditionMet: false,
          ...(receipt ? { runId: receipt.id } : {}),
        };
        const shown = (text: string) =>
          selectLines(linesOf(text), { tail: params.tail ?? params.limit ?? 80 }).output;
        const currentOutput = () =>
          receipt ? commandOutput(output, receipt.marker, true) : output;
        async function completed(completion: { exitStatus: number; output: string }) {
          Object.assign(receipt!, completion);
          return result(
            "exited",
            `Command ${receipt!.id} completed in ${terminal.name}.\nExit status: ${completion.exitStatus}.`,
            shown(completion.output),
            { ...base, conditionMet: true, exitStatus: completion.exitStatus },
            terminal,
            completion.exitStatus !== 0,
          );
        }
        try {
          if (receipt?.exitStatus !== undefined && receipt.output !== undefined)
            return completed({ exitStatus: receipt.exitStatus, output: receipt.output });
          while (true) {
            checkAbort(signal);
            remainingTime(deadline);
            const pane = await findPane(terminal);
            if (!pane)
              return result(
                "missing",
                `Terminal ${terminal.name} is missing. Output and exit status are unavailable.`,
                shown(currentOutput()),
                base,
                terminal,
                true,
              );
            const current = await dump(terminal);
            if (!initialized || current !== output) lastChange = Date.now();
            initialized = true;
            output = current;
            if (receipt) {
              const done = await completion(receipt, output);
              if (done) return completed(done);
            }
            const match = matcher?.(output);
            if (match) {
              const evidence = matchEvidence(match);
              const returned = params.ansi ? await dump(terminal, true, true) : output;
              return result(
                "matched",
                `Output matched in ${terminal.name}.\nMatch mode: ${params.matchMode ?? "literal"}.\nMatched line ${evidence.matchLine}: ${JSON.stringify(evidence.matchedLine)}`,
                shown(returned),
                {
                  ...base,
                  conditionMet: true,
                  ...evidence,
                  exited: pane.exited,
                  exitStatus: pane.exit_status ?? null,
                },
                terminal,
              );
            }
            if (pane.exited) {
              const exitStatus = pane.exit_status ?? null;
              const met = condition === "exit" || condition === "command";
              if (receipt && exitStatus !== null) {
                receipt.exitStatus = exitStatus;
                receipt.output = commandOutput(output, receipt.marker);
              }
              const returned = params.ansi ? await dump(terminal, true, true) : output;
              return result(
                met ? "exited" : "exited_without_match",
                `Terminal ${terminal.name} exited${exitStatus === null ? "" : ` with status ${exitStatus}`}.
${met ? "The exit condition was met." : "The requested condition was not met."}`,
                shown(receipt?.output ?? returned),
                { ...base, conditionMet: met, exitStatus },
                terminal,
                !met || (exitStatus !== null && exitStatus !== 0),
              );
            }
            if (condition === "silence" && Date.now() - lastChange >= idle) {
              return result(
                "silent",
                `Terminal ${terminal.name} was quiet for ${idle} ms. This does not prove command completion.`,
                shown(currentOutput()),
                { ...base, conditionMet: true, idleMs: idle },
                terminal,
              );
            }
            if (Date.now() >= nextUpdate) {
              nextUpdate = Date.now() + 2000;
              onUpdate?.({
                content: [
                  {
                    type: "text",
                    text: `Waiting for ${condition} in ${terminal.name}.\n${truncateTail(currentOutput(), { maxLines: 10, maxBytes: 2048 }).content}`,
                  },
                ],
                details: base,
              });
            }
            await delay(poll, signal, deadline);
          }
        } catch (error) {
          if (!(error instanceof DeadlineReached)) throw error;
          return result(
            "timed_out",
            `Wait timed out in ${terminal.name} after ${timeout} ms. The process was not stopped.`,
            shown(currentOutput()),
            base,
            terminal,
          );
        } finally {
          deadline = undefined;
        }
      }

      async function perform() {
        checkAbort(signal);
        if (
          params.action === "run" &&
          (params.pattern !== undefined ||
            params.matchMode !== undefined ||
            (params.waitFor !== undefined && params.waitFor !== "command"))
        ) {
          throw new Error(
            "run tracks command completion automatically. Do not supply an output pattern or a different wait condition.",
          );
        }
        if (params.action === "run" && params.closeOnExit)
          throw new Error("run requires a persistent shell. Use ensure for an auto-close process.");
        switch (params.action) {
          case "list": {
            if (!state.terminals.size && !state.pending.size)
              return result("listed", "No terminals in the current workspace.", "", {
                terminals: [],
              });
            const panes = await listPanes();
            const terminals = [...state.terminals.values()].map((terminal) =>
              terminalInfo(
                terminal,
                panes.find((pane) => paneId(pane) === terminal.paneId),
              ),
            );
            const pending = [...state.pending.keys()];
            const text = terminals
              .map(
                (terminal) =>
                  `${terminal.name} [${terminal.paneId}] ${terminal.cwd} status=${terminal.status}${terminal.status === "exited" ? `(${terminal.exitStatus ?? "?"})` : ""}`,
              )
              .join("\n");
            return result(
              "listed",
              "Terminals in the current workspace.",
              `${text}${pending.length ? `\nUnconfirmed creations: ${pending.join(", ")}` : ""}`,
              {
                terminals,
                pending,
                ...(pending.length
                  ? {
                      untracked: panes.filter(
                        (pane) =>
                          ![...state.terminals.values()].some(
                            (terminal) => terminal.paneId === paneId(pane),
                          ),
                      ),
                    }
                  : {}),
              },
            );
          }
          case "ensure": {
            const name = requireName(params);
            const existing = state.terminals.get(name) ?? (await recoverCreation(name));
            if (existing) {
              const pane = await findPane(existing);
              if (pane && !params.restart)
                return result(
                  "existing",
                  `Terminal ${name} already exists (${pane.exited ? "exited" : "running"}). Use restart: true to replace it.`,
                  "",
                  { created: false, terminal: terminalInfo(existing, pane) },
                  existing,
                );
              await closeTerminal(existing);
            }
            const terminal = await createTerminal(name);
            return result(
              "created",
              `Created terminal ${name} [${terminal.paneId}] in ${terminal.cwd}.\n${terminal.command ? `Startup argv: ${JSON.stringify(terminal.command)}` : `Interactive shell: ${terminal.shellKind}. Use run for shell commands.`}`,
              "",
              { created: true, width: terminal.width, height: terminal.height },
              terminal,
            );
          }
          case "run": {
            const name = requireName(params);
            const text = requireText(params);
            if (params.command)
              throw new Error(
                "run accepts text, not startup argv. Use ensure with command for a dedicated process.",
              );
            let terminal = state.terminals.get(name) ?? (await recoverCreation(name));
            if (terminal && !(await findPane(terminal))) {
              state.terminals.delete(name);
              terminal = undefined;
            }
            terminal ??= await createTerminal(name);
            if (terminal.command || (terminal.shellKind !== "bash" && terminal.shellKind !== "zsh"))
              throw new Error(
                "run requires a Bash or Zsh shell. Use send for REPL or program input.",
              );
            const pane = await findPane(terminal);
            if (pane?.exited)
              throw new Error(`Shell ${name} exited. Use ensure with restart: true to replace it.`);
            if (terminal.lastRun && terminal.lastRun.exitStatus === undefined) {
              const done = await completion(terminal.lastRun, await dump(terminal));
              if (!done)
                throw new Error(
                  `A command is still pending in ${name}. Use wait or interrupt before another run.`,
                );
              Object.assign(terminal.lastRun, done);
            }
            const id = shortId();
            const statusPath = path.join(await ioDirectory(), `${id}.status`);
            terminal.lastRun = { id, marker: `__PI_TERM_${id}`, statusPath };
            await sendInput(
              terminal,
              trackedCommand(text, id, terminal.shellKind, statusPath),
              true,
              "paste",
            );
            return { terminal, receipt: terminal.lastRun };
          }
          case "resize": {
            const terminal = await getTerminal(requireName(params));
            if (!(await findPane(terminal)))
              return result(
                "missing",
                `Terminal ${terminal.name} is missing.`,
                "",
                {},
                terminal,
                true,
              );
            const size = geometry(params, terminal);
            await mutation(
              [
                "--session",
                state.name,
                "action",
                "change-floating-pane-coordinates",
                "--pane-id",
                terminal.paneId,
                "--x",
                size.x,
                "--y",
                size.y,
                "--width",
                size.width,
                "--height",
                size.height,
              ],
              `Resize ${terminal.name}`,
            );
            Object.assign(terminal, size);
            const pane = await findPane(terminal);
            return result(
              "resized",
              `Resized ${terminal.name}. Actual size: ${pane?.pane_columns ?? "?"} × ${pane?.pane_rows ?? "?"}.`,
              "",
              { width: pane?.pane_columns ?? null, height: pane?.pane_rows ?? null },
              terminal,
            );
          }
          case "send": {
            const terminal = await getTerminal(requireName(params));
            const pane = await findPane(terminal);
            if (!pane || pane.exited)
              throw new Error(
                `Terminal ${terminal.name} is not running. Use ensure with restart: true.`,
              );
            const text = requireText(params);
            await sendInput(
              terminal,
              text,
              Boolean(params.enter),
              params.inputMode ?? "write_chars",
            );
            return result(
              "sent",
              `Sent ${Buffer.byteLength(text)} bytes to ${terminal.name}${params.enter ? " and Enter" : ""}. No command completion was tracked.`,
              "",
              {},
              terminal,
            );
          }
          case "keys":
          case "interrupt": {
            const terminal = await getTerminal(requireName(params));
            const pane = await findPane(terminal);
            if (!pane || pane.exited)
              return result(
                "missing",
                `Terminal ${terminal.name} is not running. No keys were sent.`,
                "",
                {},
                terminal,
                true,
              );
            const keys = params.action === "interrupt" ? ["Ctrl c"] : params.keys;
            if (!keys?.length) throw new Error("Action keys requires at least one key.");
            await mutation(
              [
                "--session",
                state.name,
                "action",
                "send-keys",
                "--pane-id",
                terminal.paneId,
                "--",
                ...keys,
              ],
              `Send keys to ${terminal.name}`,
            );
            return result(
              params.action === "interrupt" ? "interrupted" : "sent",
              `Sent keys to ${terminal.name}: ${keys.join(", ")}.`,
              "",
              {},
              terminal,
            );
          }
          case "read": {
            const terminal = await getTerminal(requireName(params));
            if (!(await findPane(terminal)))
              return result(
                "missing",
                `Terminal ${terminal.name} is missing.`,
                "",
                {},
                terminal,
                true,
              );
            const mode = params.mode ?? "scrollback";
            if (mode === "delta" && (params.offset !== undefined || params.tail !== undefined))
              throw new Error("Delta reads accept limit only. Use scrollback for offset or tail.");
            const output = await dump(terminal, mode !== "screen", params.ansi);
            const lines = linesOf(output);
            if (mode === "delta") {
              const start = commonPrefix(terminal.deltaSnapshot, lines);
              const end = Math.min(lines.length, start + (params.limit ?? 120));
              const selected = lines.slice(start, end).join("\n");
              const answer = await result(
                "read",
                `${terminal.name}: ${end - start} changed lines. ${lines.length - end} lines remain unread.`,
                selected,
                {
                  mode,
                  startLine: start + 1,
                  endLine: end,
                  totalLines: lines.length,
                  hasMoreAfter: end < lines.length,
                },
                terminal,
              );
              terminal.deltaSnapshot = lines.slice(0, end);
              return answer;
            }
            const selected = selectLines(lines, params);
            return result(
              "read",
              `${terminal.name} ${mode}: lines ${selected.startLine}-${selected.endLine} of ${selected.totalLines}.`,
              selected.output,
              { ...selected, mode },
              terminal,
            );
          }
          case "wait":
            return wait(await getTerminal(requireName(params)));
          case "kill": {
            const name = requireName(params);
            const terminal = state.terminals.get(name) ?? (await recoverCreation(name));
            if (terminal) await closeTerminal(terminal);
            return result("killed", `Terminal ${name} is closed.`, "", { name }, terminal);
          }
        }
      }

      type ToolResult = Awaited<ReturnType<typeof result>>;
      if (params.action === "list" || params.action === "wait")
        return (await perform()) as ToolResult;
      const answer = await enqueue(state.mutations, perform);
      if (params.action === "run") {
        const started = answer as { terminal: TerminalState; receipt: CommandRun };
        return wait(started.terminal, "command", started.receipt);
      }
      return answer as ToolResult;
    },
  });
}
