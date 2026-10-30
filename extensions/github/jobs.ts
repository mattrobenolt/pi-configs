/**
 * Background CI watches.
 *
 * A watch detaches the `waitForChecks()` loop from the tool call that started
 * it: the tool returns a job id immediately and the registry keeps polling.
 * When checks settle, the registry hands the result to `deliver()`, which
 * sends a custom message. An idle agent wakes on it; a busy agent gets it at
 * the end of its current turn (deliverAs "followUp").
 *
 * Watches live and die with the session, like the conversation that started
 * them. Nothing here is persisted.
 */

import {
  checkFailed,
  type CIWaitResult,
  type CheckSnapshot,
  formatChecks,
  waitForChecks,
} from "./core.ts";

export type CiWatchSpec = {
  repo: string;
  pr_number?: number;
  ref?: string;
  expected_head_sha?: string;
  timeout_ms: number;
};

export type CiWatchState =
  | "pending"
  | "passed"
  | "failed"
  | "head_changed"
  | "timed_out"
  | "no_checks"
  | "cancelled"
  | "error";

export type CiWatchJob = {
  id: string;
  spec: CiWatchSpec;
  state: CiWatchState;
  started_at: number;
  updated_at: number;
  finished_at?: number;
  head_sha?: string;
  snapshot?: CheckSnapshot;
  polls: number;
  error?: string;
};

export type CiWatchStart = {
  job: CiWatchJob;
  /** False when an equivalent watch was already running and was reused. */
  created: boolean;
};

export type CiWatchDeps = {
  load: (
    spec: CiWatchSpec,
    signal: AbortSignal,
  ) => Promise<{ head_sha: string; snapshot: CheckSnapshot }>;
  /** Posts the completion notice to the session. Called exactly once per job. */
  deliver: (job: CiWatchJob, text: string) => void;
  /** Called on start, on every poll, and on completion. Drives the status line. */
  onUpdate?: (job: CiWatchJob) => void;
  /** Injectable for tests; defaults to waitForChecks. */
  wait?: (options: Parameters<typeof waitForChecks>[0]) => Promise<CIWaitResult>;
  now?: () => number;
  pollIntervalMs?: number;
  discoveryGraceMs?: number;
  /** Finished jobs kept for later queries. Pending jobs are never trimmed. */
  retainFinished?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_DISCOVERY_GRACE_MS = 60_000;
const DEFAULT_RETAIN_FINISHED = 20;
const MAX_CONSECUTIVE_ERRORS = 5;

/** setTimeout that does not keep the process alive and honors the abort signal. */
function unrefDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Cancelled"));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    timer.unref?.();
    const cancel = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new Error("Cancelled"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function watchTarget(spec: CiWatchSpec): string {
  return spec.pr_number !== undefined ? `#${spec.pr_number}` : String(spec.ref);
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

export function watchLabel(job: CiWatchJob): string {
  const head = job.head_sha ? ` @${job.head_sha.slice(0, 7)}` : "";
  return `${job.spec.repo} ${watchTarget(job.spec)}${head}`;
}

/** One-line progress/result used by list queries and /ci-watch. */
export function formatWatchLine(job: CiWatchJob, now: number): string {
  const label = `${job.id} ${watchLabel(job)}`;
  if (job.state !== "pending") {
    const detail = job.error ?? job.state;
    const took = job.finished_at ? ` (${formatElapsed(job.finished_at - job.started_at)})` : "";
    return `- ${label}: ${detail}${took}`;
  }
  const snapshot = job.snapshot;
  const progress = snapshot
    ? `${snapshot.completed}/${snapshot.total} complete (${snapshot.passed} passed, ${snapshot.failed} failed, ${snapshot.pending} pending)`
    : "awaiting first poll";
  return `- ${label}: ${progress}, ${formatElapsed(now - job.started_at)} elapsed`;
}

/** One line for the TUI status bar; undefined when nothing is pending. */
export function formatWatchStatus(jobs: CiWatchJob[], now: number): string | undefined {
  const pending = jobs.filter((job) => job.state === "pending");
  if (pending.length === 0) return undefined;
  if (pending.length > 1) return `CI: ${pending.length} watches`;
  const job = pending[0];
  const snapshot = job.snapshot;
  const progress = snapshot ? `${snapshot.completed}/${snapshot.total}` : "watching";
  return `CI: ${progress} ${formatElapsed(now - job.started_at)} (${job.id})`;
}

function checkLine(check: CheckSnapshot["checks"][number]): string {
  const run = check.run_id ? ` (run ${check.run_id})` : "";
  const url = check.url ? ` — ${check.url}` : "";
  return `- ${check.name} [${check.status}]${run}${url}`;
}

/**
 * Completion notice delivered to the agent. Failed watches carry the failing
 * check run ids so the agent can go straight to `github_ci failed_logs`.
 */
export function formatWatchNotice(job: CiWatchJob): string {
  const label = watchLabel(job);
  const suffix = `(watch ${job.id})`;
  const elapsed = job.finished_at
    ? formatElapsed(job.finished_at - job.started_at)
    : "unknown time";
  const snapshot = job.snapshot;

  if (job.state === "passed") {
    return `[github-ci] CI passed for ${label} in ${elapsed}. ${snapshot?.passed ?? 0} of ${snapshot?.total ?? 0} checks passed. ${suffix}`;
  }
  if (job.state === "failed") {
    const lines = [
      `[github-ci] CI failed for ${label} in ${elapsed}. ${snapshot?.failed ?? 0} of ${snapshot?.total ?? 0} checks failed:`,
    ];
    for (const check of snapshot?.checks ?? []) {
      if (!checkFailed(check)) continue;
      lines.push(checkLine(check));
    }
    lines.push(
      `Inspect the failures with github_ci failed_logs run_id=<id>, fix them, and push. Do not start new work on top of the broken head. ${suffix}`,
    );
    return lines.join("\n");
  }
  if (job.state === "head_changed") {
    return `[github-ci] CI watch for ${label} stopped: the head moved${job.spec.expected_head_sha ? ` from ${job.spec.expected_head_sha.slice(0, 7)}` : ""} to ${job.head_sha?.slice(0, 7) ?? "unknown"}. Fetch and inspect the new head before deciding whether to watch it. ${suffix}`;
  }
  if (job.state === "timed_out") {
    const progress = snapshot
      ? ` Last state: ${snapshot.completed}/${snapshot.total} complete (${snapshot.passed} passed, ${snapshot.failed} failed, ${snapshot.pending} pending).`
      : "";
    return `[github-ci] CI watch for ${label} timed out after ${formatElapsed(job.spec.timeout_ms)}.${progress} Start another watch when the run has had time to progress. ${suffix}`;
  }
  if (job.state === "no_checks") {
    return `[github-ci] CI watch for ${label} found no checks after ${formatElapsed(job.finished_at ? job.finished_at - job.started_at : 0)}. The ref may have no CI configured, or checks never started. ${suffix}`;
  }
  if (job.state === "error") {
    return `[github-ci] CI watch for ${label} failed after ${elapsed}: ${job.error ?? "unknown error"}. Start another watch, or inspect with github_ci status. ${suffix}`;
  }
  return `[github-ci] CI watch for ${label} ended: ${job.state}. ${suffix}`;
}

/** Full status for one job, including the check list when a snapshot exists. */
export function formatWatchDetails(job: CiWatchJob, now: number): string {
  const lines = [`watch ${formatWatchLine(job, now).replace(/^- /, "")}`];
  if (job.error && job.state !== "error") lines.push(`error: ${job.error}`);
  if (job.snapshot) lines.push(formatChecks(job.snapshot));
  if (job.state === "pending") {
    lines.push("The agent is notified automatically when checks settle; no polling is needed.");
  }
  return lines.join("\n");
}

export class CiWatchRegistry {
  private readonly jobs = new Map<string, CiWatchJob>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly deps: CiWatchDeps;
  private readonly wait: (options: Parameters<typeof waitForChecks>[0]) => Promise<CIWaitResult>;
  private readonly clock: () => number;
  private readonly pollIntervalMs: number;
  private readonly discoveryGraceMs: number;
  private readonly retainFinished: number;
  private sequence = 1;
  private closed = false;

  constructor(deps: CiWatchDeps) {
    this.deps = deps;
    this.wait = deps.wait ?? waitForChecks;
    this.clock = deps.now ?? Date.now;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.discoveryGraceMs = deps.discoveryGraceMs ?? DEFAULT_DISCOVERY_GRACE_MS;
    this.retainFinished = deps.retainFinished ?? DEFAULT_RETAIN_FINISHED;
  }

  start(spec: CiWatchSpec): CiWatchStart {
    if (this.closed) throw new Error("CI watches are closed for this session");
    if (spec.pr_number === undefined && spec.ref === undefined) {
      throw new Error("A CI watch needs pr_number or ref.");
    }
    if (spec.pr_number !== undefined && spec.ref !== undefined) {
      throw new Error("Pass either pr_number or ref for a CI watch, not both.");
    }

    for (const job of this.jobs.values()) {
      if (job.state !== "pending") continue;
      if (
        job.spec.repo === spec.repo &&
        job.spec.pr_number === spec.pr_number &&
        job.spec.ref === spec.ref &&
        job.spec.expected_head_sha === spec.expected_head_sha
      ) {
        return { job, created: false };
      }
    }

    const started = this.clock();
    const job: CiWatchJob = {
      id: `ci-${this.sequence++}`,
      spec,
      state: "pending",
      started_at: started,
      updated_at: started,
      polls: 0,
    };
    this.jobs.set(job.id, job);

    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    void this.run(job, controller, started + spec.timeout_ms);
    this.update(job);
    return { job, created: true };
  }

  /** Current time on the registry clock; formatting uses it so tests stay deterministic. */
  now(): number {
    return this.clock();
  }

  list(): CiWatchJob[] {
    return [...this.jobs.values()];
  }

  get(id: string): CiWatchJob | undefined {
    return this.jobs.get(id);
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.state !== "pending") return false;
    const at = this.clock();
    job.state = "cancelled";
    job.updated_at = at;
    job.finished_at = at;
    const controller = this.controllers.get(id);
    this.controllers.delete(id);
    controller?.abort(new Error(`CI watch ${id} cancelled`));
    this.update(job);
    return true;
  }

  /** Session teardown: stop polling and suppress all pending notices. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const at = this.clock();
    for (const job of this.jobs.values()) {
      if (job.state !== "pending") continue;
      job.state = "cancelled";
      job.updated_at = at;
      job.finished_at = at;
    }
    for (const controller of this.controllers.values()) {
      controller.abort(new Error("CI watch session closed"));
    }
    this.controllers.clear();
  }

  private async run(job: CiWatchJob, controller: AbortController, deadline: number): Promise<void> {
    let errors = 0;

    while (!controller.signal.aborted && this.controllers.get(job.id) === controller) {
      try {
        const result = await this.wait({
          load: () => this.deps.load(job.spec, controller.signal),
          expectedHeadSha: job.spec.expected_head_sha,
          timeoutMs: Math.max(1_000, deadline - this.clock()),
          discoveryGraceMs: this.discoveryGraceMs,
          pollIntervalMs: this.pollIntervalMs,
          signal: controller.signal,
          sleep: unrefDelay,
          onProgress: (update) => {
            if (controller.signal.aborted || this.controllers.get(job.id) !== controller) return;
            job.head_sha = update.head_sha;
            job.snapshot = update.snapshot;
            job.updated_at = this.clock();
            job.polls += 1;
            this.update(job);
          },
        });
        if (controller.signal.aborted) return;
        this.finish(job, result.status, result);
        return;
      } catch (error) {
        if (controller.signal.aborted) return;
        errors += 1;
        if (errors >= MAX_CONSECUTIVE_ERRORS || this.clock() >= deadline) {
          this.finish(job, "error", { error: errorText(error) });
          return;
        }
        try {
          await unrefDelay(Math.min(2 ** errors, 30) * 1_000, controller.signal);
        } catch {
          return;
        }
      }
    }
  }

  private finish(
    job: CiWatchJob,
    state: CiWatchState,
    result: Partial<CIWaitResult> & { error?: string },
  ): void {
    if (this.closed || job.state !== "pending") return;
    const at = this.clock();
    job.state = state;
    job.updated_at = at;
    job.finished_at = at;
    if (result.head_sha) job.head_sha = result.head_sha;
    if (result.snapshot) job.snapshot = result.snapshot;
    if (result.error) job.error = result.error;
    const controller = this.controllers.get(job.id);
    this.controllers.delete(job.id);
    controller?.abort(); // no-op for a settled wait; releases listeners
    this.trim();
    this.update(job);
    if (state === "cancelled") return;
    this.deps.deliver(job, formatWatchNotice(job));
  }

  private trim(): void {
    const finished = [...this.jobs.values()]
      .filter((job) => job.state !== "pending")
      .sort((a, b) => a.started_at - b.started_at);
    while (finished.length > this.retainFinished) {
      const dropped = finished.shift();
      if (dropped) this.jobs.delete(dropped.id);
    }
  }

  private update(job: CiWatchJob): void {
    try {
      this.deps.onUpdate?.(job);
    } catch {
      // Status rendering is advisory; never let it break a watch.
    }
  }
}
