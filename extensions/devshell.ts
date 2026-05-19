import { expandHome } from "@mattrobenolt/pi-core/files";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isBashToolResult, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { exec } from "node:child_process";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import * as path from "node:path";

type DirenvValue = string | null;
type DirenvStatus = "on" | "blocked" | "error" | "off";

const RELOAD_DEBOUNCE_MS = 300;
const WATCH_TARGETS = [".envrc", ".envrc.local", "flake.nix", "flake.lock", "devshell.toml"];

function formatHomePath(cwd: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function shellQuote(input: string): string {
  return `'${input.replaceAll("'", "'\\''")}'`;
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

function parseStatus(error: Error | null, stderr: string): DirenvStatus | null {
  if (!error) return null;
  const message = `${stderr}\n${error.message}`.toLowerCase();
  return /allow|blocked|denied|not allowed/.test(message) ? "blocked" : "error";
}

function setDirenvStatus(ctx: ExtensionContext, status: DirenvStatus): void {
  if (!ctx.hasUI) return;

  if (status === "on" || status === "off") {
    ctx.ui.setStatus("direnv", undefined);
    return;
  }

  ctx.ui.setStatus("direnv", status === "blocked" ? "direnv:blocked" : "direnv:error");
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

function loadDirenv(cwd: string, ctx: ExtensionContext): Promise<void> {
  return new Promise((resolve) => {
    exec(
      "direnv export json",
      { cwd, env: { ...process.env, DIRENV_LOG_FORMAT: "" }, timeout: 10_000 },
      (error, stdout, stderr) => {
        const errorStatus = parseStatus(error, stderr);
        if (errorStatus) {
          setDirenvStatus(ctx, errorStatus);
          resolve();
          return;
        }

        if (!stdout.trim()) {
          setDirenvStatus(ctx, "off");
          resolve();
          return;
        }

        try {
          const loaded = applyEnv(JSON.parse(stdout) as Record<string, DirenvValue>);
          setDirenvStatus(ctx, loaded > 0 ? "on" : "off");
        } catch {
          setDirenvStatus(ctx, "error");
        }
        resolve();
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
  }

  function scheduleReload(cwd: string): void {
    if (!latestCtx) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (!latestCtx || cwd !== process.cwd()) return;
      void refreshDirenv(cwd, latestCtx);
    }, RELOAD_DEBOUNCE_MS);
  }

  function startWatchers(cwd: string): void {
    stopWatchers();

    for (const target of WATCH_TARGETS) {
      try {
        watchers.push(watch(path.join(cwd, target), () => scheduleReload(cwd)));
      } catch {}
    }
  }

  async function refreshDirenv(cwd: string, ctx: ExtensionContext): Promise<void> {
    await loadDirenv(cwd, ctx);
    direnvFingerprint = getDirenvFingerprint(cwd);
  }

  function reloadForCwd(cwd: string, ctx: ExtensionContext): void {
    direnvFingerprint = null;
    void refreshDirenv(cwd, ctx);
    startWatchers(cwd);
  }

  async function refreshDirenvIfChanged(cwd: string): Promise<void> {
    if (!latestCtx) return;

    const nextFingerprint = getDirenvFingerprint(cwd);
    if (nextFingerprint === direnvFingerprint) return;

    await refreshDirenv(cwd, latestCtx);
  }

  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx;
    pi.events.emit("local:cwd_changed", process.cwd());
    reloadForCwd(process.cwd(), ctx);
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
      reloadForCwd(process.cwd(), ctx);
      ctx.ui.notify(`cwd → ${formatHomePath(process.cwd())}`, "info");
    },
  });

  pi.registerCommand("direnv", {
    description: "Reload direnv environment variables for the current working directory",
    handler: async (_args, ctx) => {
      latestCtx = ctx;
      reloadForCwd(process.cwd(), ctx);
      ctx.ui.notify("direnv reloaded", "info");
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
      await refreshDirenvIfChanged(cwd);
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
