import { expandHome } from "@mattrobenolt/pi-core/files";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isBashToolResult, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { exec, type ExecException, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type DirenvValue = string | null;
type DirenvStatus = "on" | "blocked" | "error" | "off";
type DirenvResult = {
  status: DirenvStatus;
  summary?: string;
  detail?: string;
};
type DirenvFailure = {
  cwd: string;
  trigger: string;
  startedAt: number;
  durationMs: number;
  result: DirenvResult;
};

const DIRENV_STATUS_DETAIL_MAX_LENGTH = 80;
const RELOAD_DEBOUNCE_MS = 300;
const WATCH_TARGETS = [".envrc", ".envrc.local", "flake.nix", "flake.lock", "devshell.toml"];

function formatHomePath(cwd: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function shellQuote(input: string): string {
  return `'${input.replaceAll("'", "'\\''")}'`;
}

function readFileIfExists(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function resolvePathInput(input: string, cwd: string): string {
  const expanded = expandHome(input.trim());
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(cwd, expanded));
}

function resolveToolPath(input: string | undefined): string {
  return resolvePathInput(input?.trim() || ".", process.cwd());
}

function isLikelyPathInput(input: string): boolean {
  return (
    input.startsWith(".") ||
    input.startsWith("~") ||
    path.isAbsolute(input) ||
    input.includes("/") ||
    (path.sep !== "/" && input.includes(path.sep))
  );
}

function getDirectoryCompletions(prefix: string, cwd: string) {
  const trimmed = prefix.trim();
  const expanded = expandHome(trimmed);
  const endsWithSeparator = expanded.endsWith(path.sep);
  const searchBase = endsWithSeparator ? expanded : path.dirname(expanded || ".");
  const namePrefix = endsWithSeparator ? "" : path.basename(expanded);
  const absoluteBase = path.resolve(
    path.isAbsolute(searchBase) ? searchBase : path.join(cwd, searchBase),
  );

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absoluteBase, { withFileTypes: true });
  } catch {
    return null;
  }

  const relativeBase =
    trimmed.startsWith("~/") || trimmed === "~"
      ? absoluteBase.replace(process.env.HOME ?? process.env.USERPROFILE ?? "", "~")
      : path.isAbsolute(trimmed)
        ? absoluteBase
        : path.relative(cwd, absoluteBase) || ".";

  const completions = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(namePrefix))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 50)
    .map((entry) => {
      const dir =
        relativeBase === "."
          ? entry.name
          : relativeBase.endsWith(path.sep)
            ? `${relativeBase}${entry.name}`
            : `${relativeBase}${path.sep}${entry.name}`;
      const value = `${dir}${path.sep}`;
      return { value, label: value };
    });

  return completions.length > 0 ? completions : null;
}

function queryZoxide(args: string[], cwd: string): string | null {
  try {
    const output = execFileSync("zoxide", args, {
      cwd,
      timeout: 2_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

function getZoxideCompletions(prefix: string, cwd: string) {
  const trimmed = prefix.trim();
  if (!trimmed || isLikelyPathInput(trimmed)) return null;

  const matches = queryZoxide(["query", "--list", "--", trimmed], cwd);
  if (!matches) return null;

  const completions = matches
    .split("\n")
    .map((dir) => dir.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((dir) => {
      const value = formatHomePath(dir);
      return { value, label: `${value} [zoxide]` };
    });

  return completions.length > 0 ? completions : null;
}

function resolveDirectoryTarget(input: string, cwd: string): string | null {
  const resolved = resolvePathInput(input, cwd);

  try {
    const stats = fs.statSync(resolved);
    if (stats.isDirectory()) return fs.realpathSync(resolved);
  } catch {}

  if (isLikelyPathInput(input.trim())) return null;

  const zoxideMatch = queryZoxide(["query", "--", input.trim()], cwd);
  if (!zoxideMatch) return null;

  try {
    return fs.realpathSync(zoxideMatch);
  } catch {
    return null;
  }
}

function changeDirectory(pi: ExtensionAPI, cwd: string): void {
  process.chdir(cwd);
  pi.events.emit("local:cwd_changed", process.cwd());
}

function cleanDirenvDetail(text: string): string {
  return text
    .split("\x1b")
    .map((part, index) => (index === 0 ? part : part.replace(/^\[[0-9;]*m/, "")))
    .join("")
    .trim();
}

function summarizeDirenvDetail(detail: string): string {
  const lines = detail
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^command failed:/i.test(line) &&
        !/^direnv: (?:error )?exit status \d+$/i.test(line) &&
        line.toLowerCase() !== "error:",
    );
  const summary =
    lines.find((line) => /^(?:error|fatal):\s+\S/i.test(line)) ?? lines[0] ?? "unknown error";
  const normalized = summary.replace(/^direnv:\s*(?:error\s*)?/i, "");

  return normalized.length > DIRENV_STATUS_DETAIL_MAX_LENGTH
    ? `${normalized.slice(0, DIRENV_STATUS_DETAIL_MAX_LENGTH - 1)}…`
    : normalized;
}

function getDirenvFailure(error: ExecException, stderr: string): DirenvResult {
  const stderrDetail = cleanDirenvDetail(stderr);
  const fallbackDetail = cleanDirenvDetail(error.message);
  const detail = stderrDetail || fallbackDetail || "direnv export failed without an error message";
  const message = `${detail}\n${fallbackDetail}`.toLowerCase();

  if (/allow|blocked|denied|not allowed/.test(message)) {
    return { status: "blocked", summary: "run direnv allow", detail };
  }

  return { status: "error", summary: summarizeDirenvDetail(detail), detail };
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs}ms` : `${(durationMs / 1_000).toFixed(1)}s`;
}

function formatDirenvFailure(failure: DirenvFailure): string {
  return [
    `time: ${new Date(failure.startedAt).toLocaleTimeString()}`,
    `trigger: ${failure.trigger}`,
    `duration: ${formatDuration(failure.durationMs)}`,
    `cwd: ${formatHomePath(failure.cwd)}`,
    "",
    failure.result.detail ?? failure.result.summary ?? "No error detail",
  ].join("\n");
}

function setDirenvStatus(ctx: ExtensionContext, result: DirenvResult): void {
  if (!ctx.hasUI) return;

  if (result.status === "on" || result.status === "off") {
    ctx.ui.setStatus("direnv", undefined);
    return;
  }

  const label = result.status === "blocked" ? "direnv:blocked" : "direnv:error";
  const color = result.status === "blocked" ? "warning" : "error";
  const summary = result.summary ? ` ${result.summary}` : "";
  ctx.ui.setStatus("direnv", ctx.ui.theme.fg(color, `${label} [run /direnv]${summary}`));
}

function applyEnv(env: Record<string, DirenvValue>): number {
  let loaded = 0;
  for (const [key, value] of Object.entries(env)) {
    if (value === null) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
    loaded += 1;
  }
  return loaded;
}

function getDirenvFingerprint(cwd: string): string {
  return WATCH_TARGETS.map((target) => {
    try {
      const stats = fs.statSync(path.join(cwd, target));
      return `${target}:${stats.mtimeMs}:${stats.size}`;
    } catch {
      return `${target}:missing`;
    }
  }).join("|");
}

function loadDirenv(cwd: string, ctx: ExtensionContext): Promise<DirenvResult> {
  return new Promise((resolve) => {
    const stderrDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-direnv-"));
    const stderrPath = path.join(stderrDir, "stderr.log");

    const finish = (result: DirenvResult): void => {
      setDirenvStatus(ctx, result);
      resolve(result);
    };

    // Never let direnv get in the way: allow any .envrc before exporting so
    // agents can't stall on a blocked rc (fresh worktrees, foreign configs).
    // The allow errors harmlessly when no .envrc exists.
    // nix-direnv reopens /dev/stderr during cache invalidation, which can fail under
    // Node-owned stdio. Give it a real file and read diagnostics back after.
    exec(
      `direnv allow 2>/dev/null; direnv export json 2>${shellQuote(stderrPath)}`,
      { cwd, env: { ...process.env, DIRENV_LOG_FORMAT: "" } },
      (error, stdout, stderr) => {
        const redirectedStderr = readFileIfExists(stderrPath);
        const direnvStderr = [redirectedStderr, stderr].filter(Boolean).join("\n");
        fs.rmSync(stderrDir, { recursive: true, force: true });

        if (error) {
          finish(getDirenvFailure(error, direnvStderr));
          return;
        }

        if (!stdout.trim()) {
          finish({ status: "off" });
          return;
        }

        try {
          const loaded = applyEnv(JSON.parse(stdout) as Record<string, DirenvValue>);
          finish({ status: loaded > 0 ? "on" : "off" });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          finish({
            status: "error",
            summary: "invalid JSON output",
            detail: `Could not parse direnv export output: ${detail}`,
          });
        }
      },
    );
  });
}

async function rewriteWithRtk(pi: ExtensionAPI, command: string): Promise<string> {
  const result = await pi.exec("rtk", ["rewrite", command], { timeout: 5_000 }).catch(() => null);
  const rewritten = result?.stdout.trim();
  return rewritten && rewritten !== command ? rewritten : command;
}

function wrapForCwd(command: string, cwd: string): string {
  return `cd ${shellQuote(cwd)} && ${command}`;
}

function stripLeadingDirenvLogs(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  let idx = 0;
  while (idx < lines.length && lines[idx].startsWith("direnv: ")) idx += 1;
  while (idx < lines.length && lines[idx] === "") idx += 1;
  return lines.slice(idx).join("\n");
}

export default function (pi: ExtensionAPI) {
  let latestCtx: ExtensionContext | null = null;
  let watchers: FSWatcher[] = [];
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let direnvFingerprint: string | null = null;
  let currentDirenvResult: DirenvResult = { status: "off" };
  let activeDirenvRefresh: Promise<DirenvResult> | null = null;
  let lastDirenvFailure: DirenvFailure | null = null;
  const pendingReloadTargets = new Set<string>();

  function stopWatchers(): void {
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {}
    }
    watchers = [];

    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    pendingReloadTargets.clear();
  }

  function scheduleReload(cwd: string, target: string): void {
    if (!latestCtx) return;
    pendingReloadTargets.add(target);
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      const targets = [...pendingReloadTargets].sort().join(", ");
      pendingReloadTargets.clear();
      if (!latestCtx || cwd !== process.cwd()) return;
      void refreshDirenvIfChanged(cwd, `changed: ${targets}`);
    }, RELOAD_DEBOUNCE_MS);
  }

  function startWatchers(cwd: string): void {
    stopWatchers();

    for (const target of WATCH_TARGETS) {
      try {
        watchers.push(watch(path.join(cwd, target), () => scheduleReload(cwd, target)));
      } catch {}
    }
  }

  async function refreshDirenv(
    cwd: string,
    ctx: ExtensionContext,
    trigger: string,
  ): Promise<DirenvResult> {
    while (activeDirenvRefresh) await activeDirenvRefresh;

    const fingerprint = getDirenvFingerprint(cwd);
    const startedAt = Date.now();
    if (ctx.hasUI) {
      ctx.ui.setStatus("direnv", ctx.ui.theme.fg("warning", "direnv:loading"));
    }
    const refresh = loadDirenv(cwd, ctx);
    activeDirenvRefresh = refresh;

    try {
      const result = await refresh;
      const durationMs = Date.now() - startedAt;
      if (result.status === "blocked" || result.status === "error") {
        lastDirenvFailure = { cwd, trigger, startedAt, durationMs, result };
      }
      currentDirenvResult = result;
      direnvFingerprint = fingerprint;
      return result;
    } finally {
      if (activeDirenvRefresh === refresh) activeDirenvRefresh = null;
    }
  }

  function reloadForCwd(
    cwd: string,
    ctx: ExtensionContext,
    trigger: string,
  ): Promise<DirenvResult> {
    direnvFingerprint = null;
    startWatchers(cwd);
    return refreshDirenv(cwd, ctx, trigger);
  }

  async function refreshDirenvIfChanged(cwd: string, trigger: string): Promise<DirenvResult> {
    if (!latestCtx) return { status: "error", detail: "direnv context is unavailable" };
    while (activeDirenvRefresh) await activeDirenvRefresh;

    const nextFingerprint = getDirenvFingerprint(cwd);
    if (nextFingerprint === direnvFingerprint) return currentDirenvResult;

    return refreshDirenv(cwd, latestCtx, trigger);
  }

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    pi.events.emit("local:cwd_changed", process.cwd());
    await reloadForCwd(process.cwd(), ctx, "session startup");
  });

  pi.on("session_shutdown", () => {
    stopWatchers();
    latestCtx = null;
  });

  pi.registerCommand("cd", {
    description: "Change the session working directory. Usage: /cd <path-or-zoxide-query>",
    getArgumentCompletions: (prefix: string) =>
      getDirectoryCompletions(prefix, process.cwd()) ?? getZoxideCompletions(prefix, process.cwd()),
    handler: async (args, ctx) => {
      const input = args.trim()
        ? args.trim()
        : await ctx.ui.input("Change directory", formatHomePath(process.cwd()));
      if (!input?.trim()) return;

      const nextCwd = resolveDirectoryTarget(input, process.cwd());
      if (!nextCwd) {
        ctx.ui.notify(`No such directory or zoxide match: ${input}`, "error");
        return;
      }

      changeDirectory(pi, nextCwd);
      lastDirenvFailure = null;
      await reloadForCwd(process.cwd(), ctx, "cwd changed");
      ctx.ui.notify(`cwd → ${formatHomePath(process.cwd())}`, "info");
    },
  });

  pi.registerCommand("direnv", {
    description: "Reload direnv and show the full reason for any failure",
    handler: async (_args, ctx) => {
      latestCtx = ctx;
      const cwd = process.cwd();
      const result = await reloadForCwd(cwd, ctx, "manual /direnv");

      if (result.status === "blocked" || result.status === "error") {
        const failure = lastDirenvFailure;
        const hint = result.status === "blocked" ? "\n\nRun `direnv allow` in that directory." : "";
        ctx.ui.notify(
          `direnv still fails:\n${failure ? formatDirenvFailure(failure) : (result.detail ?? "No error detail")}${hint}`,
          result.status === "blocked" ? "warning" : "error",
        );
        return;
      }

      const recoveredFailure = lastDirenvFailure?.cwd === cwd ? lastDirenvFailure : null;
      if (recoveredFailure) {
        ctx.ui.notify(
          `direnv recovered on manual retry. Previous failure:\n${formatDirenvFailure(recoveredFailure)}`,
          "warning",
        );
        lastDirenvFailure = null;
        return;
      }

      ctx.ui.notify(
        result.status === "on" ? "direnv environment reloaded" : "No direnv changes to load",
        "info",
      );
    },
  });

  pi.on("tool_result", (event) => {
    if (!isBashToolResult(event)) return;

    const content = event.content.map((block) => {
      if (block.type !== "text") return block;
      return { ...block, text: stripLeadingDirenvLogs(block.text) };
    });

    return { content };
  });

  pi.on("tool_call", async (event) => {
    if (isToolCallEventType("bash", event)) {
      const cwd = process.cwd();
      const direnvResult = await refreshDirenvIfChanged(cwd, "watched files changed before bash");
      if (direnvResult.status === "blocked" || direnvResult.status === "error") {
        return {
          block: true,
          reason: direnvResult.detail ?? direnvResult.summary ?? "direnv failed to load",
        };
      }
      const rewritten = await rewriteWithRtk(pi, event.input.command);
      event.input.command = wrapForCwd(rewritten, cwd);
      return;
    }

    if (isToolCallEventType("read", event)) {
      event.input.path = resolveToolPath(event.input.path);
      return;
    }

    if (isToolCallEventType("write", event)) {
      event.input.path = resolveToolPath(event.input.path);
      return;
    }

    if (isToolCallEventType("edit", event)) {
      event.input.path = resolveToolPath(event.input.path);
      return;
    }

    if (isToolCallEventType("grep", event)) {
      event.input.path = resolveToolPath(event.input.path);
      return;
    }

    if (isToolCallEventType("find", event)) {
      event.input.path = resolveToolPath(event.input.path);
      return;
    }

    if (isToolCallEventType("ls", event)) {
      event.input.path = resolveToolPath(event.input.path);
    }
  });
}
