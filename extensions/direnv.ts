import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createBashTool } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import { exec, execFileSync } from "node:child_process";
import { setTrackedCwd } from "./lib/cwd-state";

const CWD_SENTINEL = "__PI_CWD__:";

function expandHome(input: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return input;
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.join(home, input.slice(2));
  return input;
}

function formatHomePath(cwd: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function resolveDirectoryInput(input: string, cwd: string): string {
  const expanded = expandHome(input.trim());
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(cwd, expanded));
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
    const stdout = execFileSync("zoxide", args, {
      cwd,
      timeout: 2_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const result = stdout.trim();
    return result || null;
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
  const resolved = resolveDirectoryInput(input, cwd);

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

function getDirenvEnv(cwd: string): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("DIRENV_")),
    );
    exec(
      "direnv export json",
      { cwd, env: { ...cleanEnv, DIRENV_LOG_FORMAT: "" }, timeout: 10_000 },
      (_err, stdout) => {
        try {
          resolve(stdout.trim() ? JSON.parse(stdout) : {});
        } catch {
          resolve({});
        }
      },
    );
  });
}

export default function (pi: ExtensionAPI) {
  let currentCwd = process.cwd();
  let cachedEnv: Record<string, string> = {};
  let gitDirty: boolean | null = null;
  let requestRender: (() => void) | null = null;

  async function updateGitStatus(cwd: string) {
    try {
      const result = await pi.exec("git", ["-C", cwd, "status", "--porcelain"], {
        timeout: 2000,
      });
      if (cwd !== currentCwd) return;
      gitDirty = result.code === 0 ? result.stdout.trim().length > 0 : null;
    } catch {
      if (cwd !== currentCwd) return;
      gitDirty = null;
    }
    requestRender?.();
  }

  async function setCurrentCwd(cwd: string) {
    if (!cwd) return;

    currentCwd = cwd;
    setTrackedCwd(currentCwd);
    requestRender?.();

    const nextEnv = await getDirenvEnv(cwd);
    if (cwd !== currentCwd) return;

    cachedEnv = nextEnv;
    requestRender?.();
    await updateGitStatus(cwd);
  }

  pi.on("session_start", async (_event, ctx) => {
    currentCwd = process.cwd();
    setTrackedCwd(currentCwd);
    cachedEnv = await getDirenvEnv(currentCwd);
    await updateGitStatus(currentCwd);

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: () => {
          unsub();
          requestRender = null;
        },
        invalidate() {},
        render(width: number): string[] {
          const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

          let pwd = formatHomePath(currentCwd);

          const branch = footerData.getGitBranch();
          const sessionName = ctx.sessionManager.getSessionName();

          let gitIndicator = "";
          if (gitDirty === true) gitIndicator = theme.fg("warning", " ●");
          else if (gitDirty === false) gitIndicator = theme.fg("success", " ○");

          const nixBadge = cachedEnv.IN_NIX_SHELL ? theme.fg("accent", " [nix]") : "";

          const cwdStr = theme.fg("dim", pwd);
          const branchStr = branch ? theme.fg("muted", ` ⎇ ${branch}`) : "";
          const cwdLine = truncateToWidth(cwdStr + branchStr + gitIndicator + nixBadge, width);

          let totalInput = 0,
            totalOutput = 0,
            totalCost = 0;
          for (const e of ctx.sessionManager.getBranch()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              totalInput += m.usage.input;
              totalOutput += m.usage.output;
              totalCost += m.usage.cost.total;
            }
          }

          const usage = ctx.getContextUsage();
          const pct = usage?.percent != null ? `${usage.percent.toFixed(1)}%` : "?";
          const ctxWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const windowStr = ctxWindow ? `/${fmt(ctxWindow)}` : "";

          const statsLeft = [
            totalInput ? `↑${fmt(totalInput)}` : null,
            totalOutput ? `↓${fmt(totalOutput)}` : null,
            totalCost ? `$${totalCost.toFixed(3)}` : null,
            `${pct}${windowStr}`,
          ]
            .filter(Boolean)
            .join(" ");

          const thinkingLevel = pi.getThinkingLevel();
          const modelRight = ctx.model
            ? `(${ctx.model.provider}) ${ctx.model.id}${thinkingLevel !== "off" ? ` • ${thinkingLevel}` : ""}`
            : "";

          const pad = " ".repeat(
            Math.max(1, width - visibleWidth(statsLeft) - visibleWidth(modelRight)),
          );
          const statsLine = truncateToWidth(
            theme.fg("dim", statsLeft) + pad + theme.fg("dim", modelRight),
            width,
          );

          const lines = [cwdLine, statsLine];
          if (sessionName) lines.push(truncateToWidth(theme.fg("dim", `● ${sessionName}`), width));
          return lines;
        },
      };
    });
  });

  pi.registerCommand("cd", {
    description: "Change the session working directory. Usage: /cd <path-or-zoxide-query>",
    getArgumentCompletions: (prefix: string) =>
      getDirectoryCompletions(prefix, currentCwd) ?? getZoxideCompletions(prefix, currentCwd),
    handler: async (args, ctx) => {
      const input = args.trim()
        ? args.trim()
        : await ctx.ui.input("Change directory", formatHomePath(currentCwd));
      if (!input?.trim()) return;

      const nextCwd = resolveDirectoryTarget(input, currentCwd);
      if (!nextCwd) {
        ctx.ui.notify(`No such directory or zoxide match: ${input}`, "error");
        return;
      }

      await setCurrentCwd(nextCwd);
      ctx.ui.notify(`cwd → ${formatHomePath(nextCwd)}`, "info");
    },
  });

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return;

    const cwd = currentCwd;
    const nextEnv = await getDirenvEnv(cwd);
    if (cwd !== currentCwd) return;

    cachedEnv = nextEnv;
    requestRender?.();
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash") return;

    const text = event.content.find((c) => c.type === "text")?.text ?? "";
    const sentinelIdx = text.lastIndexOf(CWD_SENTINEL);
    if (sentinelIdx === -1) return;

    // Only accept the sentinel if it's at the start of a line — prevents false matches
    const lineStart = text.lastIndexOf("\n", sentinelIdx);
    if (sentinelIdx !== lineStart + 1) return;

    const lineEnd = text.indexOf("\n", sentinelIdx);
    const sentinelLine = text.slice(lineStart + 1, lineEnd === -1 ? undefined : lineEnd);
    const newCwd = sentinelLine.slice(CWD_SENTINEL.length).trim();

    if (newCwd && newCwd !== currentCwd) {
      await setCurrentCwd(newCwd);
    }

    const cleaned =
      lineEnd === -1
        ? text.slice(0, lineStart === -1 ? sentinelIdx : lineStart)
        : text.slice(0, lineStart + 1) + text.slice(lineEnd + 1);

    return {
      content: [{ type: "text", text: cleaned }],
    };
  });

  const bashTool = createBashTool(process.cwd(), {
    spawnHook: ({ command, env }) => ({
      command: `${command}\necho "${CWD_SENTINEL}$PWD"`,
      cwd: currentCwd,
      env: { ...env, ...cachedEnv },
    }),
  });

  pi.registerTool({
    ...bashTool,
    description:
      "Execute a bash command. Working directory persists across invocations — `cd` works statefully. " +
      "The nix devshell environment is already active via direnv; never use `nix develop`. " +
      "Output is truncated to last 2000 lines or 50KB. Optionally provide a timeout in seconds.",
    execute: async (id, params, signal, onUpdate, _ctx) => {
      return bashTool.execute(id, params, signal, onUpdate);
    },
  });
}
