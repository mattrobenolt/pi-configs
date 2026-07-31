/**
 * Passive CI watcher.
 *
 * Agents push, break CI, and never notice. This watches the pushed branch
 * head: whenever local HEAD matches its upstream (i.e. just pushed), it polls
 * the commit's checks until they settle, then tells the agent about failures.
 *
 * Alerting is transition-based, not state-based: a head that is already red
 * when first observed only earns a passive notice, while a head that goes
 * red *after* we saw it pending steers (or wakes) the agent. That keeps the
 * watcher from shouting about someone else's breakage at session start.
 *
 * One report per sha. Watching resumes when a new head gets pushed.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  loadCommitChecks,
  parseGitHubRemote,
  type CheckSnapshot,
  type CommandRunner,
  type GitHubClient,
} from "./core.ts";
import { DEFAULT_CI_WATCH_CONFIG, loadCiWatchConfig, type CiWatchConfig } from "./config.ts";

export type GitProbe = {
  /** Current HEAD sha. Undefined outside a git repo. */
  headSha?: string;
  /** Current branch name. Undefined when detached. */
  branch?: string;
  /** Upstream ref (e.g. "origin/main"). Undefined when the branch doesn't track one. */
  upstreamRef?: string;
  /** Sha of the upstream ref. */
  upstreamSha?: string;
  /** owner/repo parsed from the upstream remote's URL. Undefined for non-GitHub remotes. */
  repo?: string;
};

export type WatchTarget = {
  repo: string;
  sha: string;
  branch?: string;
  startedAt: number;
  /** True once checks were observed pending/not-yet-registered. */
  sawActivity: boolean;
  lastSnapshot?: CheckSnapshot;
};

export type CiWatchDeps = {
  probeGit: () => Promise<GitProbe>;
  loadChecks: (repo: string, sha: string) => Promise<CheckSnapshot>;
  /** Failure observed in transition (was pending, now failed): steer or wake the agent. */
  report: (text: string, target: WatchTarget) => void;
  /** Failure present on first observation: passive notice only. */
  inform: (text: string, target: WatchTarget) => void;
  notify: (text: string, level: "info" | "warning" | "error") => void;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  now: () => number;
};

const MAX_CONSECUTIVE_ERRORS = 5;
const FIRST_POLL_MS = 2_000;

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatFailure(
  target: WatchTarget,
  snapshot: CheckSnapshot,
  options?: { resumeAfterFix?: boolean },
): string {
  const branch = target.branch ? ` (${target.branch})` : "";
  const lines = [
    `[ci-watch] CI failed for ${target.repo} @ ${shortSha(target.sha)}${branch}.`,
    `${snapshot.failed} of ${snapshot.total} checks failed:`,
  ];
  for (const check of snapshot.checks) {
    if (check.status !== "pending" && !isPassing(check)) {
      lines.push(
        `- ${check.name} [${check.status}]${check.run_id ? ` (run ${check.run_id})` : ""}${check.url ? ` — ${check.url}` : ""}`,
      );
    }
  }
  lines.push(
    "Inspect the failure with github_ci failed_logs run_id=<id>, fix it, and push. Do not start new work on top of the broken head.",
  );
  if (options?.resumeAfterFix) {
    lines.push(
      "After the fix is pushed and CI passes, resume the task you were working on before this CI interruption.",
    );
  }
  return lines.join("\n");
}

const PASSING = new Set(["success", "neutral", "skipped"]);

function isPassing(check: CheckSnapshot["checks"][number]): boolean {
  return PASSING.has(check.conclusion ?? check.status);
}

/** Runs the git shell-outs that locate the pushed head. Injectable for tests. */
export function makeGitProbe(exec: CommandRunner): () => Promise<GitProbe> {
  return async () => {
    const head = await exec("git", ["rev-parse", "HEAD"]);
    if (head.code !== 0) return {};
    const headSha = head.stdout.trim();

    const branchResult = await exec("git", ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const branch = branchResult.code === 0 ? branchResult.stdout.trim() : undefined;

    const upstream = await exec("git", [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    if (upstream.code !== 0) return { headSha, branch };
    const upstreamRef = upstream.stdout.trim();

    const upstreamShaResult = await exec("git", ["rev-parse", "@{upstream}"]);
    if (upstreamShaResult.code !== 0) return { headSha, branch, upstreamRef };

    // Upstream refs look like "origin/main"; remote names cannot contain "/".
    const remote = upstreamRef.split("/")[0];
    const url = await exec("git", ["remote", "get-url", remote]);
    const repo = url.code === 0 ? parseGitHubRemote(url.stdout) : undefined;

    return {
      headSha,
      branch,
      upstreamRef,
      upstreamSha: upstreamShaResult.stdout.trim(),
      repo,
    };
  };
}

export class CiWatcher {
  private readonly config: CiWatchConfig;
  private readonly deps: CiWatchDeps;
  private watched?: WatchTarget;
  private readonly notified = new Set<string>();
  private timer: unknown;
  private polling = false;
  private consecutiveErrors = 0;
  private stopped = false;

  constructor(config: CiWatchConfig, deps: CiWatchDeps) {
    this.config = config;
    this.deps = deps;
  }

  /** Re-evaluate what should be watched. Cheap: git reads only, no network. */
  async refresh(): Promise<void> {
    if (this.stopped) return;
    const probe = await this.deps.probeGit();
    if (!probe.headSha || !probe.repo || probe.headSha !== probe.upstreamSha) return;
    if (this.watched?.sha === probe.headSha && this.watched.repo === probe.repo) return;
    if (this.notified.has(probe.headSha)) return;

    this.watch({
      repo: probe.repo,
      sha: probe.headSha,
      branch: probe.branch,
      startedAt: this.deps.now(),
      sawActivity: false,
    });
  }

  stop(): void {
    this.stopped = true;
    this.cancelTimer();
    this.watched = undefined;
  }

  get status(): string {
    if (this.stopped) return "stopped";
    if (!this.watched) return "idle (no pushed head to watch)";
    const snapshot = this.watched.lastSnapshot;
    const detail = snapshot
      ? ` — ${snapshot.status}: ${snapshot.passed} passed, ${snapshot.failed} failed, ${snapshot.pending} pending`
      : " — awaiting first poll";
    return `watching ${this.watched.repo}@${shortSha(this.watched.sha)}${detail}`;
  }

  /** Exposed for tests: run one poll cycle immediately. */
  async pollNow(): Promise<void> {
    await this.poll();
  }

  private watch(target: WatchTarget): void {
    this.cancelTimer();
    this.watched = target;
    this.consecutiveErrors = 0;
    this.timer = this.deps.schedule(() => void this.poll(), FIRST_POLL_MS);
  }

  private scheduleNext(ms: number): void {
    this.cancelTimer();
    this.timer = this.deps.schedule(() => void this.poll(), ms);
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      this.deps.cancel(this.timer);
      this.timer = undefined;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling || this.stopped || !this.watched) return;
    this.polling = true;
    const target = this.watched;
    try {
      const snapshot = await this.deps.loadChecks(target.repo, target.sha);
      this.consecutiveErrors = 0;
      if (this.watched !== target || this.stopped) return;
      target.lastSnapshot = snapshot;

      if (snapshot.status === "failed") {
        this.notified.add(target.sha);
        this.watched = undefined;
        this.cancelTimer();
        if (target.sawActivity) {
          const text = formatFailure(target, snapshot, {
            resumeAfterFix: this.config.resumeAfterFix,
          });
          this.deps.report(text, target);
        } else {
          const text = formatFailure(target, snapshot);
          this.deps.inform(text, target);
        }
        return;
      }
      if (snapshot.status === "passed") {
        this.watched = undefined;
        this.cancelTimer();
        return;
      }
      target.sawActivity = true;
      if (
        snapshot.status === "no_checks" &&
        this.deps.now() - target.startedAt >= this.config.discoveryGraceSeconds * 1000
      ) {
        // Checks never registered; the repo probably has no CI for this ref.
        this.watched = undefined;
        this.cancelTimer();
        return;
      }
      this.scheduleNext(this.config.pollSeconds * 1000);
    } catch (error) {
      if (this.watched !== target || this.stopped) return;
      this.consecutiveErrors += 1;
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        this.watched = undefined;
        this.cancelTimer();
        this.deps.notify(
          `ci-watch: stopped watching ${shortSha(target.sha)} after ${MAX_CONSECUTIVE_ERRORS} failed polls: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
        return;
      }
      const backoff = Math.min(2 ** this.consecutiveErrors, 8);
      this.scheduleNext(this.config.pollSeconds * 1000 * backoff);
    } finally {
      this.polling = false;
    }
  }
}

function commandMightPush(input: unknown): boolean {
  const command = (input as { command?: unknown } | undefined)?.command;
  return typeof command === "string" && /\bgit\s+push\b/.test(command);
}

export function setupCiWatch(pi: ExtensionAPI, client: GitHubClient): void {
  let watcher: CiWatcher | undefined;
  let config: CiWatchConfig = DEFAULT_CI_WATCH_CONFIG;
  let enabledOverride: boolean | undefined;
  let lastCtx: ExtensionContext | undefined;

  const isEnabled = () => enabledOverride ?? config.enabled;

  const notify = (text: string, level: "info" | "warning" | "error") => {
    if (lastCtx?.hasUI) lastCtx.ui.notify(text, level);
  };

  const deliverInform = (text: string) => {
    pi.sendMessage(
      { customType: "ci-watch", content: text, display: true },
      {
        deliverAs: "nextTurn",
      },
    );
    notify(text.split("\n")[0], "warning");
  };

  const deps: CiWatchDeps = {
    probeGit: makeGitProbe((command, args, options) =>
      pi.exec(command, args, { timeout: 10_000, ...options }),
    ),
    loadChecks: (repo, sha) => loadCommitChecks(client, repo, sha),
    report: (text) => {
      // Steer interrupts between tool calls mid-run; when idle it delivers
      // immediately and wakes the agent. The wakeOnFailure=false path avoids
      // triggering a turn while idle and queues the message for the next prompt.
      if (!config.wakeOnFailure && (lastCtx?.isIdle() ?? true)) {
        deliverInform(text);
        return;
      }
      pi.sendUserMessage(text, { deliverAs: "steer" });
    },
    inform: deliverInform,
    notify,
    schedule: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return timer;
    },
    cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
    now: () => Date.now(),
  };

  const startWatcher = async (ctx: ExtensionContext) => {
    lastCtx = ctx;
    watcher?.stop();
    watcher = undefined;
    if (!isEnabled()) return;
    watcher = new CiWatcher(config, deps);
    await watcher.refresh();
  };

  pi.on("session_start", async (_event, ctx) => {
    config = await loadCiWatchConfig(ctx.cwd);
    enabledOverride = undefined;
    await startWatcher(ctx);
  });

  pi.on("session_shutdown", async () => {
    watcher?.stop();
    watcher = undefined;
    lastCtx = undefined;
  });

  pi.on("turn_end", async (_event, ctx) => {
    lastCtx = ctx;
    await watcher?.refresh();
  });

  pi.on("tool_result", async (event, ctx) => {
    lastCtx = ctx;
    if (watcher && commandMightPush(event.input)) await watcher.refresh();
  });

  pi.registerCommand("ci-watch", {
    description: "Show or override the CI watcher for this session: /ci-watch [status|on|off]",
    handler: async (args, ctx) => {
      lastCtx = ctx;
      const arg = args.trim().toLowerCase();
      if (arg === "on" || arg === "off") {
        enabledOverride = arg === "on";
        if (enabledOverride) await startWatcher(ctx);
        else {
          watcher?.stop();
          watcher = undefined;
        }
        ctx.ui.notify(`ci-watch ${arg} for this session`, "info");
        return;
      }
      const lines = [
        `ci-watch: ${isEnabled() ? "enabled" : "disabled"}${enabledOverride !== undefined ? " (session override)" : " (from settings)"}`,
        `poll ${config.pollSeconds}s, discovery grace ${config.discoveryGraceSeconds}s, wakeOnFailure ${config.wakeOnFailure}, resumeAfterFix ${config.resumeAfterFix}`,
        watcher?.status ?? "not watching",
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
