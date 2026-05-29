import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface GitInfo {
  repoName: string | null;
  repoRoot: string | null;
  branch: string | null;
  isDirty: boolean;
}

function execGit(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 1000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

async function readGitInfo(cwd: string): Promise<GitInfo> {
  const root = await execGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return EMPTY_GIT_INFO;

  const branch = await execGit(cwd, ["branch", "--show-current"]);
  const dirty = await new Promise<boolean>((resolve) => {
    execFile(
      "git",
      ["--no-optional-locks", "diff-index", "--quiet", "HEAD", "--"],
      { cwd, timeout: 1000 },
      (err) => resolve((err as { code?: number } | null)?.code === 1),
    );
  });

  return {
    repoName: path.basename(root),
    repoRoot: root,
    branch: branch || null,
    isDirty: dirty,
  };
}

function fmt(n: number): string {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

function nowHMS(): string {
  return new Date().toTimeString().slice(0, 8);
}

const EMPTY_GIT_INFO: GitInfo = { repoName: null, repoRoot: null, branch: null, isDirty: false };

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    let gitInfo: GitInfo = EMPTY_GIT_INFO;
    let gitCacheAt = 0;
    const GIT_TTL = 3000;

    function resetGitInfo(): void {
      gitCacheAt = 0;
      gitInfo = EMPTY_GIT_INFO;
    }

    ctx.ui.setFooter((tui, theme, footerData) => {
      const clockTimer = setInterval(() => tui.requestRender(), 60_000);

      function refreshGitInfo(): void {
        const now = Date.now();
        if (now - gitCacheAt <= GIT_TTL) return;

        gitCacheAt = now;
        const cwd = process.cwd();
        readGitInfo(cwd).then((info) => {
          if (cwd !== process.cwd()) {
            gitCacheAt = 0;
            return;
          }

          gitInfo = info;
          tui.requestRender();
        });
      }

      const unsubCwd = pi.events.on("local:cwd_changed", () => {
        resetGitInfo();
        tui.requestRender();
      });

      return {
        dispose: () => {
          clearInterval(clockTimer);
          unsubCwd();
        },
        invalidate() {},
        render(width: number): string[] {
          refreshGitInfo();
          let input = 0,
            output = 0;
          let thinking = "";
          const entries = ctx.sessionManager.getBranch();
          for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (entry.type === "message" && entry.message.role === "assistant") {
              const m = entry.message as AssistantMessage;
              input += m.usage.input;
              output += m.usage.output;
            } else if (entry.type === "thinking_level_change" && !thinking) {
              thinking = entry.thinkingLevel;
            }
          }

          const { repoName, repoRoot, branch, isDirty } = gitInfo;
          const modelId = ctx.model?.id ?? "no model";
          const cwd = process.cwd();
          const repoRelativePath = repoRoot ? path.relative(repoRoot, cwd) : "";
          const cwdLabel = repoName
            ? repoRelativePath
              ? path.join(repoName, repoRelativePath)
              : repoName
            : path.basename(cwd);

          const dirPart = repoName ? theme.fg("accent", cwdLabel) : theme.fg("dim", cwdLabel);

          const branchPart = branch ? "  " + theme.fg("success", branch) : "";
          const dirtyPart = isDirty ? " " + theme.fg("warning", "*") : "";
          const timePart = "  " + theme.fg("dim", nowHMS().slice(0, 5));

          const statuses = footerData.getExtensionStatuses();
          const statusPart =
            statuses.size > 0
              ? "  " + [...statuses.values()].map((s) => theme.fg("accent", s)).join("  ")
              : "";

          const left = dirPart + branchPart + dirtyPart + timePart + statusPart;

          const right = theme.fg("dim", `${modelId}  ${thinking}  ↑${fmt(input)} ↓${fmt(output)}`);

          const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
          return [truncateToWidth(left + " ".repeat(gap) + right, width)];
        },
      };
    });
  });
}
