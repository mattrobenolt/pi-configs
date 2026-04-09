import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { getTrackedCwd, onTrackedCwdChange } from "./lib/cwd-state";

interface GitInfo {
  repoName: string | null;
  branch: string | null;
  isDirty: boolean;
}

function readGitInfo(cwd: string): Promise<GitInfo> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 1000 }, (err, root) => {
      if (err || !root.trim()) {
        resolve({ repoName: null, branch: null, isDirty: false });
        return;
      }

      execFile("git", ["branch", "--show-current"], { cwd, timeout: 1000 }, (_err2, branch) => {
        execFile(
          "git",
          ["--no-optional-locks", "status", "--porcelain"],
          { cwd, timeout: 1000 },
          (err3, status) => {
            resolve({
              repoName: path.basename(root.trim()),
              branch: branch.trim() || null,
              isDirty: err3 ? false : status.trim().length > 0,
            });
          },
        );
      });
    });
  });
}

function fmt(n: number): string {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

function nowHMS(): string {
  return new Date().toTimeString().slice(0, 8);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    let gitInfo: GitInfo = { repoName: null, branch: null, isDirty: false };
    let gitCacheAt = 0;
    const GIT_TTL = 3000;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const clockTimer = setInterval(() => tui.requestRender(), 1000);

      function refreshGitInfo(): void {
        const now = Date.now();
        if (now - gitCacheAt <= GIT_TTL) return;

        gitCacheAt = now;
        const cwd = getTrackedCwd();
        readGitInfo(cwd).then((info) => {
          if (cwd !== getTrackedCwd()) {
            gitCacheAt = 0;
            return;
          }

          gitInfo = info;
          tui.requestRender();
        });
      }

      const unsubCwd = onTrackedCwdChange(() => {
        gitCacheAt = 0;
        gitInfo = { repoName: null, branch: null, isDirty: false };
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

          const { repoName, branch, isDirty } = gitInfo;
          const modelId = ctx.model?.id ?? "no model";

          const dirPart = repoName
            ? theme.fg("accent", repoName)
            : theme.fg("dim", path.basename(getTrackedCwd()));

          const branchPart = branch ? "  " + theme.fg("success", branch) : "";
          const dirtyPart = isDirty ? " " + theme.fg("warning", "*") : "";
          const timePart = "  " + theme.fg("dim", nowHMS());

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
