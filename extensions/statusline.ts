import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

interface GitInfo {
	repoName: string | null;
	isDirty: boolean;
}

function readGitInfo(cwd: string): Promise<GitInfo> {
	return new Promise((resolve) => {
		execFile("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 1000 }, (err, root) => {
			if (err || !root.trim()) { resolve({ repoName: null, isDirty: false }); return; }
			execFile("git", ["--no-optional-locks", "status", "--porcelain"], { cwd, timeout: 1000 }, (err2, status) => {
				if (err2) { resolve({ repoName: path.basename(root.trim()), isDirty: false }); return; }
				resolve({ repoName: path.basename(root.trim()), isDirty: status.trim().length > 0 });
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
		let gitInfo: GitInfo = { repoName: null, isDirty: false };
		let gitCacheAt = 0;
		const GIT_TTL = 3000;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const clockTimer = setInterval(() => tui.requestRender(), 1000);

			function refreshGitInfo(): void {
				const now = Date.now();
				if (now - gitCacheAt <= GIT_TTL) return;
				gitCacheAt = now;
				readGitInfo(process.cwd()).then((info) => {
					gitInfo = info;
					tui.requestRender();
				});
			}

			const unsubBranch = footerData.onBranchChange(() => {
				gitCacheAt = 0;
				tui.requestRender();
			});

			return {
				dispose: () => {
					clearInterval(clockTimer);
					unsubBranch();
				},
				invalidate() {},
				render(width: number): string[] {
					refreshGitInfo();
					let input = 0,
						output = 0,
						cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							input += m.usage.input;
							output += m.usage.output;
							cost += m.usage.cost.total;
						}
					}

					const { repoName, isDirty } = gitInfo;
					const branch = footerData.getGitBranch();
					const modelId = ctx.model?.id ?? "no model";

					const dirPart = repoName
						? theme.fg("accent", repoName)
						: theme.fg("dim", path.basename(process.cwd()));

					const branchPart = branch ? "  " + theme.fg("success", branch) : "";
					const dirtyPart = isDirty ? " " + theme.fg("warning", "*") : "";
					const timePart = "  " + theme.fg("dim", nowHMS());

					const left = dirPart + branchPart + dirtyPart + timePart;

					const right = theme.fg(
						"dim",
						`${modelId}  ↑${fmt(input)} ↓${fmt(output)} $${cost.toFixed(3)}`,
					);

					const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
					return [truncateToWidth(left + " ".repeat(gap) + right, width)];
				},
			};
		});
	});
}
