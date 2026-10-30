/**
 * Automatic PR watches.
 *
 * Creating a PR, commenting on one, or reviewing one starts a watch. The watch
 * polls for new conversation comments, reviews, inline replies, CI results,
 * head moves, and merge/close, then posts one notice per poll. Polling starts
 * fast, backs off as the PR goes quiet, and stops on merge, close, or after
 * the TTL.
 *
 * A watch record is appended to the session whenever its cursor changes, so a
 * resumed session catches up on feedback that arrived while Pi was off. No
 * external process is involved: feedback is only polled while Pi runs.
 */

import {
  checkFailed,
  splitRepo,
  type CheckSnapshot,
  type GitHubClient,
  type GitHubJson,
} from "./core.ts";
import { formatElapsed } from "./jobs.ts";

export type PrWatchStopReason = "merged" | "closed" | "expired" | "cancelled" | "error";

export type PrCiState = "unknown" | "pending" | "passed" | "failed" | "no_checks";

export type PrWatchRecord = {
  id: string;
  repo: string;
  number: number;
  title?: string;
  url?: string;
  started_at: number;
  last_touch_at: number;
  expires_at: number;
  stopped?: PrWatchStopReason;
  error?: string;
  /** Highest seen GitHub id per stream. */
  cursor: { comments: number; reviews: number; review_comments: number };
  /** Review ids this agent submitted; their inline comments stay quiet. */
  self_reviews?: number[];
  head_sha?: string;
  ci: { head_sha?: string; state: PrCiState; first_seen_at?: number };
  /** The first successful poll has not run yet; it records cursors silently. */
  baseline?: boolean;
};

export type PrActivityItem = {
  id: number;
  kind: "comment" | "review" | "review_comment";
  author: string;
  author_type?: string;
  body: string;
  url?: string;
  created_at: string;
  state?: string;
  path?: string;
  line?: number | null;
  in_reply_to_id?: number;
  /** REST pull_request_review_id, used to recognize the agent's own review. */
  review_id?: number;
};

export type PrActivity = {
  pull: {
    number: number;
    title: string;
    state: string;
    merged: boolean;
    draft: boolean;
    head_sha: string;
    url: string;
  };
  comments: PrActivityItem[];
  reviews: PrActivityItem[];
  review_comments: PrActivityItem[];
};

export type PrWatchSpec = {
  repo: string;
  number: number;
  title?: string;
  url?: string;
  head_sha?: string;
};

export type PrWatchCursor = Partial<PrWatchRecord["cursor"]>;

export type PrWatchStart = {
  record: PrWatchRecord;
  created: boolean;
};

export type PrWatchDeps = {
  loadActivity: (
    spec: { repo: string; number: number },
    signal: AbortSignal,
  ) => Promise<PrActivity>;
  loadChecks: (repo: string, headSha: string, signal: AbortSignal) => Promise<CheckSnapshot>;
  deliver: (record: PrWatchRecord, text: string) => void;
  /** Persist the current record. Called only when state actually changes. */
  persist: (record: PrWatchRecord) => void;
  now?: () => number;
  random?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  firstPollMs?: number;
  fastPollMs?: number;
  fastWindowMs?: number;
  mediumPollMs?: number;
  mediumWindowMs?: number;
  slowPollMs?: number;
  slowWindowMs?: number;
  idlePollMs?: number;
  ttlMs?: number;
  discoveryGraceMs?: number;
  maxConsecutiveErrors?: number;
};

export const PR_WATCH_DEFAULTS = {
  firstPollMs: 2_000,
  fastPollMs: 20_000,
  fastWindowMs: 10 * 60_000,
  mediumPollMs: 60_000,
  mediumWindowMs: 60 * 60_000,
  slowPollMs: 5 * 60_000,
  slowWindowMs: 6 * 3_600_000,
  idlePollMs: 15 * 60_000,
  ttlMs: 7 * 24 * 3_600_000,
  discoveryGraceMs: 2 * 60_000,
  maxConsecutiveErrors: 5,
};

type Managed = {
  record: PrWatchRecord;
  timer?: unknown;
  controller?: AbortController;
  next_poll_at?: number;
  polling: boolean;
  errors: number;
  /** First successful poll only records cursors; it never notifies. */
  baseline: boolean;
  stopped: boolean;
};

export type PrWatchEvents = {
  head_changed?: { from?: string; to: string };
  ci?: { state: "passed" | "failed"; snapshot: CheckSnapshot };
  items: PrActivityItem[];
};

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isStopReason(value: unknown): value is PrWatchStopReason {
  return (
    value === "merged" ||
    value === "closed" ||
    value === "expired" ||
    value === "cancelled" ||
    value === "error"
  );
}

function isCiState(value: unknown): value is PrCiState {
  return (
    value === "unknown" ||
    value === "pending" ||
    value === "passed" ||
    value === "failed" ||
    value === "no_checks"
  );
}

function recordFromData(data: unknown): PrWatchRecord | undefined {
  if (!data || typeof data !== "object") return undefined;
  const raw = data as Record<string, any>;
  if (typeof raw.id !== "string" || !raw.id) return undefined;
  if (typeof raw.repo !== "string" || !raw.repo.includes("/")) return undefined;
  const number = Number(raw.number);
  if (!Number.isSafeInteger(number) || number <= 0) return undefined;
  const cursor = raw.cursor && typeof raw.cursor === "object" ? raw.cursor : {};
  const ci = raw.ci && typeof raw.ci === "object" ? raw.ci : {};
  return {
    id: raw.id,
    repo: raw.repo,
    number,
    title: typeof raw.title === "string" ? raw.title : undefined,
    url: typeof raw.url === "string" ? raw.url : undefined,
    started_at: finite(raw.started_at, 0),
    last_touch_at: finite(raw.last_touch_at, 0),
    expires_at: finite(raw.expires_at, 0),
    stopped: isStopReason(raw.stopped) ? raw.stopped : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
    cursor: {
      comments: finite(cursor.comments, 0),
      reviews: finite(cursor.reviews, 0),
      review_comments: finite(cursor.review_comments, 0),
    },
    self_reviews: Array.isArray(raw.self_reviews)
      ? raw.self_reviews
          .filter(
            (id: unknown): id is number =>
              typeof id === "number" && Number.isSafeInteger(id) && id > 0,
          )
          .slice(-100)
      : undefined,
    head_sha: typeof raw.head_sha === "string" ? raw.head_sha : undefined,
    baseline: raw.baseline === true,
    ci: {
      head_sha: typeof ci.head_sha === "string" ? ci.head_sha : undefined,
      state: isCiState(ci.state) ? ci.state : "unknown",
      first_seen_at: finite(ci.first_seen_at, 0) || undefined,
    },
  };
}

/** Latest watch record per PR from a session branch. */
export function prWatchRecords(
  entries: Array<{ type: string; customType?: string; data?: unknown }>,
): PrWatchRecord[] {
  const latest = new Map<string, PrWatchRecord>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== "github-pr-watch") continue;
    const record = recordFromData(entry.data);
    if (!record) continue;
    latest.set(`${record.repo}#${record.number}`, record);
  }
  return [...latest.values()];
}

function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : "unknown";
}

/** Total body text per notice. Full text stays one github_pr inspect away. */
const NOTICE_EXCERPT_BUDGET = 6_000;
/** One long review must not consume the whole notice. */
const MAX_ITEM_EXCERPT_CHARS = 3_000;
/** More item lines than this and the notice is longer than the feedback. */
const MAX_NOTICE_ITEMS = 20;

/**
 * Keep the text inside collapsed blocks. A provenance or audit block is real
 * review data; only the HTML wrapper is noise. Code in the body may contain
 * angle brackets, so remove only the wrapper tags, not every tag.
 */
function excerptText(body: string, limit: number): { text: string; truncated: boolean } {
  const normalized = body
    .replace(/<\s*details[^>]*>/gi, "")
    .replace(/<\s*\/\s*details\s*>/gi, "")
    .replace(/<\s*summary[^>]*>/gi, "")
    .replace(/<\s*\/\s*summary\s*>/gi, "\n")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length <= limit) return { text: normalized, truncated: false };
  return { text: `${normalized.slice(0, limit)}…`, truncated: true };
}

function formatItem(
  item: PrActivityItem,
  budget: number,
): { lines: string[]; used: number; truncated: boolean } {
  const where =
    item.kind === "review_comment"
      ? ` on ${item.path ?? "file"}${item.line != null ? `:${item.line}` : ""}`
      : "";
  const reply = item.in_reply_to_id ? ` (reply to ${item.in_reply_to_id})` : "";
  const state = item.kind === "review" && item.state ? ` [${item.state.toLowerCase()}]` : "";
  const url = item.url ? ` — ${item.url}` : "";
  const kind = item.kind === "review" ? "review" : "comment";
  const line = `- ${kind} ${item.id}${state} ${item.author}${where}${reply}${url}`;
  if (budget <= 0) return { lines: [line], used: 0, truncated: false };

  const excerpt = excerptText(item.body, Math.min(MAX_ITEM_EXCERPT_CHARS, budget));
  if (!excerpt.text) return { lines: [line], used: 0, truncated: false };
  return {
    lines: [line, ...excerpt.text.split("\n").map((part) => `  ${part}`)],
    used: excerpt.text.length,
    truncated: excerpt.truncated,
  };
}

export function formatPrWatchNotice(record: PrWatchRecord, events: PrWatchEvents): string {
  const label = `${record.repo}#${record.number}`;

  if (record.stopped === "merged") return `[pr-watch] ${label} merged. Stopped watching.`;
  if (record.stopped === "closed") {
    return `[pr-watch] ${label} closed without merge. Stopped watching.`;
  }
  if (record.stopped === "expired") {
    return `[pr-watch] Watch on ${label} expired. Comment or review the PR to start a new watch.`;
  }
  if (record.stopped === "error") {
    return `[pr-watch] Watch on ${label} stopped after repeated polling errors: ${record.error ?? "unknown error"}.`;
  }

  const title = record.title ? ` ${record.title}` : "";
  const lines = [`[pr-watch] ${label} @${shortSha(record.head_sha)}${title}`];

  if (events.head_changed) {
    lines.push(
      `Head moved from ${shortSha(events.head_changed.from)} to ${shortSha(events.head_changed.to)}; watching the new head.`,
    );
  }

  if (events.ci?.state === "failed") {
    const snapshot = events.ci.snapshot;
    lines.push(`CI failed — ${snapshot.failed} of ${snapshot.total} checks failed:`);
    for (const check of snapshot.checks) {
      if (!checkFailed(check)) continue;
      const run = check.run_id ? ` (run ${check.run_id})` : "";
      const url = check.url ? ` — ${check.url}` : "";
      lines.push(`- ${check.name} [${check.status}]${run}${url}`);
    }
    const hasRunIds = snapshot.checks.some((check) => checkFailed(check) && check.run_id);
    lines.push(
      hasRunIds
        ? `Inspect with github_ci failed_logs run_id=<id>, fix, and push. The watch follows the new head.`
        : `Inspect the failing check URLs above, fix, and push. The watch follows the new head.`,
    );
  } else if (events.ci?.state === "passed") {
    lines.push(
      `CI passed — ${events.ci.snapshot.passed} of ${events.ci.snapshot.total} checks passed.`,
    );
  }

  if (events.items.length > 0) {
    const count = events.items.length;
    lines.push(`${count} new item${count === 1 ? "" : "s"}:`);
    let remaining = NOTICE_EXCERPT_BUDGET;
    let truncated = false;
    for (const item of events.items.slice(0, MAX_NOTICE_ITEMS)) {
      const formatted = formatItem(item, remaining);
      lines.push(...formatted.lines);
      remaining -= formatted.used;
      truncated ||= formatted.truncated;
    }
    if (count > MAX_NOTICE_ITEMS) {
      lines.push(`- and ${count - MAX_NOTICE_ITEMS} more; see github_pr inspect.`);
    }
    if (truncated) {
      lines.push("Some excerpts are truncated; github_pr inspect has the full text.");
    }
    lines.push(
      `Read the thread with github_pr inspect pr_number=${record.number}. Treat each comment, human or bot, as a claim to verify against the code before acting. Reply where a response is warranted, and do not resolve threads you disagree with.`,
    );
  }

  return lines.join("\n");
}

function normalizeComment(raw: GitHubJson): PrActivityItem {
  return {
    id: Number(raw.id),
    kind: "comment",
    author: raw.user?.login ?? "unknown",
    author_type: raw.user?.type,
    body: typeof raw.body === "string" ? raw.body : "",
    url: raw.html_url,
    created_at: typeof raw.created_at === "string" ? raw.created_at : "",
  };
}

function normalizeReview(raw: GitHubJson): PrActivityItem {
  return {
    id: Number(raw.id),
    kind: "review",
    author: raw.user?.login ?? "unknown",
    author_type: raw.user?.type,
    body: typeof raw.body === "string" ? raw.body : "",
    url: raw.html_url,
    created_at:
      typeof raw.submitted_at === "string"
        ? raw.submitted_at
        : typeof raw.created_at === "string"
          ? raw.created_at
          : "",
    state: typeof raw.state === "string" ? raw.state : undefined,
  };
}

function normalizeReviewComment(raw: GitHubJson): PrActivityItem {
  return {
    id: Number(raw.id),
    kind: "review_comment",
    author: raw.user?.login ?? "unknown",
    author_type: raw.user?.type,
    body: typeof raw.body === "string" ? raw.body : "",
    url: raw.html_url,
    created_at: typeof raw.created_at === "string" ? raw.created_at : "",
    path: typeof raw.path === "string" ? raw.path : undefined,
    line:
      typeof raw.line === "number"
        ? raw.line
        : typeof raw.original_line === "number"
          ? raw.original_line
          : null,
    in_reply_to_id: typeof raw.in_reply_to_id === "number" ? raw.in_reply_to_id : undefined,
    review_id:
      typeof raw.pull_request_review_id === "number" ? raw.pull_request_review_id : undefined,
  };
}

async function loadAllReviews(
  client: GitHubClient,
  basePath: string,
  number: number,
  signal?: AbortSignal,
): Promise<GitHubJson[]> {
  const reviews: GitHubJson[] = [];
  for (let page = 1; page <= 10; page++) {
    const items = await client.request<GitHubJson[]>(
      "GET",
      `${basePath}/pulls/${number}/reviews?per_page=100&page=${page}`,
      { signal },
    );
    reviews.push(...items);
    if (items.length < 100) break;
  }
  return reviews;
}

/** REST loader used by the extension. Newest 100 of each stream is plenty per poll. */
export async function loadPrActivity(
  client: GitHubClient,
  repo: string,
  number: number,
  signal?: AbortSignal,
): Promise<PrActivity> {
  const basePath = splitRepo(repo).path;
  const [pull, comments, reviewComments, reviews] = await Promise.all([
    client.request<GitHubJson>("GET", `${basePath}/pulls/${number}`, { signal }),
    client.request<GitHubJson[]>(
      "GET",
      `${basePath}/issues/${number}/comments?per_page=100&sort=created&direction=desc`,
      { signal },
    ),
    client.request<GitHubJson[]>(
      "GET",
      `${basePath}/pulls/${number}/comments?per_page=100&sort=created&direction=desc`,
      { signal },
    ),
    loadAllReviews(client, basePath, number, signal),
  ]);

  return {
    pull: {
      number,
      title: typeof pull.title === "string" ? pull.title : "",
      state: typeof pull.state === "string" ? pull.state : "open",
      merged: pull.merged === true || pull.merged_at != null,
      draft: pull.draft === true,
      head_sha: typeof pull.head?.sha === "string" ? pull.head.sha : "",
      url: typeof pull.html_url === "string" ? pull.html_url : "",
    },
    comments: comments.map(normalizeComment),
    reviews: reviews.map(normalizeReview).filter((review) => review.state !== "PENDING"),
    review_comments: reviewComments.map(normalizeReviewComment),
  };
}

export class PrWatchRegistry {
  private readonly deps: PrWatchDeps;
  private readonly managed = new Map<string, Managed>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly firstPollMs: number;
  private readonly fastPollMs: number;
  private readonly fastWindowMs: number;
  private readonly mediumPollMs: number;
  private readonly mediumWindowMs: number;
  private readonly slowPollMs: number;
  private readonly slowWindowMs: number;
  private readonly idlePollMs: number;
  private readonly ttlMs: number;
  private readonly discoveryGraceMs: number;
  private readonly maxConsecutiveErrors: number;
  private sequence = 1;
  private closed = false;

  constructor(deps: PrWatchDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.schedule =
      deps.schedule ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms);
        timer.unref?.();
        return timer;
      });
    this.cancel =
      deps.cancel ??
      ((handle) => {
        clearTimeout(handle as NodeJS.Timeout);
      });
    this.firstPollMs = deps.firstPollMs ?? PR_WATCH_DEFAULTS.firstPollMs;
    this.fastPollMs = deps.fastPollMs ?? PR_WATCH_DEFAULTS.fastPollMs;
    this.fastWindowMs = deps.fastWindowMs ?? PR_WATCH_DEFAULTS.fastWindowMs;
    this.mediumPollMs = deps.mediumPollMs ?? PR_WATCH_DEFAULTS.mediumPollMs;
    this.mediumWindowMs = deps.mediumWindowMs ?? PR_WATCH_DEFAULTS.mediumWindowMs;
    this.slowPollMs = deps.slowPollMs ?? PR_WATCH_DEFAULTS.slowPollMs;
    this.slowWindowMs = deps.slowWindowMs ?? PR_WATCH_DEFAULTS.slowWindowMs;
    this.idlePollMs = deps.idlePollMs ?? PR_WATCH_DEFAULTS.idlePollMs;
    this.ttlMs = deps.ttlMs ?? PR_WATCH_DEFAULTS.ttlMs;
    this.discoveryGraceMs = deps.discoveryGraceMs ?? PR_WATCH_DEFAULTS.discoveryGraceMs;
    this.maxConsecutiveErrors = deps.maxConsecutiveErrors ?? PR_WATCH_DEFAULTS.maxConsecutiveErrors;
  }

  start(spec: PrWatchSpec): PrWatchStart {
    if (this.closed) throw new Error("PR watches are closed for this session");
    const key = `${spec.repo}#${spec.number}`;
    const existing = this.managed.get(key);
    if (existing && !existing.stopped) return { record: existing.record, created: false };

    const at = this.now();
    const record: PrWatchRecord = {
      id: `pr-${this.sequence++}`,
      repo: spec.repo,
      number: spec.number,
      title: spec.title,
      url: spec.url,
      started_at: at,
      last_touch_at: at,
      expires_at: at + this.ttlMs,
      cursor: { comments: 0, reviews: 0, review_comments: 0 },
      head_sha: spec.head_sha,
      ci: { head_sha: spec.head_sha, state: "unknown" },
      baseline: true,
    };
    const entry: Managed = {
      record,
      polling: false,
      errors: 0,
      baseline: true,
      stopped: false,
    };
    this.managed.set(key, entry);
    this.persist(entry);
    this.schedulePoll(entry, this.firstPollMs);
    return { record, created: true };
  }

  /** Re-arm an existing watch after participation, or start one. */
  touch(spec: PrWatchSpec, cursor: PrWatchCursor = {}): PrWatchStart {
    const existing = this.managed.get(`${spec.repo}#${spec.number}`);
    if (!existing || existing.stopped) return this.start(spec);
    const record = this.rearm(spec, cursor);
    return { record: record ?? existing.record, created: false };
  }

  /**
   * Advance an existing watch without starting one. Used after inspect or
   * list_threads so feedback the agent just read does not arrive as a notice.
   */
  rearm(spec: PrWatchSpec, cursor: PrWatchCursor = {}): PrWatchRecord | undefined {
    const entry = this.managed.get(`${spec.repo}#${spec.number}`);
    if (!entry || entry.stopped) return undefined;

    const at = this.now();
    entry.record.last_touch_at = Math.max(entry.record.last_touch_at, at);
    entry.record.expires_at = Math.max(entry.record.expires_at, at + this.ttlMs);
    if (spec.title) entry.record.title = spec.title;
    if (spec.url) entry.record.url = spec.url;
    for (const stream of ["comments", "reviews", "review_comments"] as const) {
      const value = cursor[stream];
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value > entry.record.cursor[stream]
      ) {
        entry.record.cursor[stream] = value;
      }
    }
    this.persist(entry);

    if (!entry.polling) {
      const next = entry.next_poll_at;
      if (entry.timer === undefined || next === undefined || next - at > this.fastPollMs) {
        this.schedulePoll(entry, this.pollInterval(entry, at));
      }
    }
    return entry.record;
  }

  /** Rehydrate watches recorded in the session branch. */
  restore(records: PrWatchRecord[]): void {
    if (this.closed) return;
    const at = this.now();
    for (const record of records) {
      if (record.stopped) continue;
      if (record.expires_at <= at) continue;
      const key = `${record.repo}#${record.number}`;
      if (this.managed.has(key)) continue;
      this.sequence = Math.max(this.sequence, numericSuffix(record.id) + 1);
      const entry: Managed = {
        record,
        polling: false,
        errors: 0,
        baseline: record.baseline === true,
        stopped: false,
      };
      this.managed.set(key, entry);
      this.schedulePoll(entry, this.firstPollMs);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.managed.values()) {
      if (entry.timer !== undefined) this.cancel(entry.timer);
      entry.timer = undefined;
      entry.controller?.abort(new Error("PR watch session closed"));
    }
  }

  /** Record a review this agent submitted so its inline comments stay quiet. */
  markSelfReview(repo: string, number: number, reviewId: number): void {
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0) return;
    const entry = this.managed.get(`${repo}#${number}`);
    if (!entry || entry.stopped) return;
    const ids = new Set(entry.record.self_reviews ?? []);
    ids.add(reviewId);
    entry.record.self_reviews = [...ids].slice(-100);
    entry.record.cursor.reviews = Math.max(entry.record.cursor.reviews, reviewId);
    this.persist(entry);
  }

  /** Active watches, for the agent-facing list. */
  list(): PrWatchRecord[] {
    return [...this.managed.values()]
      .filter((entry) => !entry.stopped)
      .map((entry) => entry.record);
  }

  /** Stop the watch for one PR. Returns false when it is not active. */
  stopPr(repo: string, number: number): boolean {
    const entry = this.managed.get(`${repo}#${number}`);
    if (!entry || entry.stopped) return false;
    this.finish(entry, "cancelled");
    return true;
  }

  /** Stop one watch by its id (pr-1). Returns false when it is not active. */
  stop(id: string): boolean {
    for (const entry of this.managed.values()) {
      if (entry.record.id === id && !entry.stopped) {
        this.finish(entry, "cancelled");
        return true;
      }
    }
    return false;
  }

  stopAll(): number {
    let stopped = 0;
    for (const entry of this.managed.values()) {
      if (entry.stopped) continue;
      this.finish(entry, "cancelled");
      stopped += 1;
    }
    return stopped;
  }

  /** Exposed for tests: run one poll now. */
  async pollNow(repo: string, number: number): Promise<void> {
    const entry = this.managed.get(`${repo}#${number}`);
    if (entry) await this.poll(entry);
  }

  describe(): string[] {
    const at = this.now();
    const lines: string[] = [];
    for (const entry of this.managed.values()) {
      if (entry.stopped) continue;
      const record = entry.record;
      const next =
        entry.next_poll_at === undefined
          ? "polling"
          : `next poll in ${formatElapsed(Math.max(0, entry.next_poll_at - at))}`;
      lines.push(
        `- ${record.id} ${record.repo}#${record.number} — CI ${record.ci.state}, ${next}, expires in ${formatElapsed(Math.max(0, record.expires_at - at))}`,
      );
    }
    return lines;
  }

  private schedulePoll(entry: Managed, delay: number): void {
    if (this.closed || entry.stopped) return;
    if (entry.timer !== undefined) this.cancel(entry.timer);
    const at = this.now();
    entry.next_poll_at = at + delay;
    entry.timer = this.schedule(() => {
      entry.timer = undefined;
      void this.poll(entry);
    }, delay);
  }

  private pollInterval(entry: Managed, at: number): number {
    const age = at - entry.record.last_touch_at;
    const base =
      age < this.fastWindowMs
        ? this.fastPollMs
        : age < this.mediumWindowMs
          ? this.mediumPollMs
          : age < this.slowWindowMs
            ? this.slowPollMs
            : this.idlePollMs;
    // Desynchronize watches so a resumed session does not burst every PR at once.
    return Math.round(base * (0.85 + this.random() * 0.3));
  }

  private actionable(item: PrActivityItem, selfReviews: Set<number>): boolean {
    if (!Number.isSafeInteger(item.id) || item.id <= 0) return false;
    // The user and the agent share one GitHub account. Suppress only reviews
    // this agent submitted; a manual review or inline suggestion from the
    // user must still arrive.
    if (item.kind === "review" && selfReviews.has(item.id)) return false;
    if (
      item.kind === "review_comment" &&
      item.review_id !== undefined &&
      selfReviews.has(item.review_id) &&
      item.in_reply_to_id === undefined
    ) {
      return false;
    }
    return true;
  }

  private async poll(entry: Managed): Promise<void> {
    if (this.closed || entry.stopped || entry.polling) return;
    const record = entry.record;
    const at = this.now();
    if (record.expires_at <= at) {
      this.finish(entry, "expired");
      return;
    }

    entry.polling = true;
    const controller = new AbortController();
    entry.controller = controller;
    const before = fingerprint(record);
    const events: PrWatchEvents = { items: [] };
    let persisted = false;

    try {
      const activity = await this.deps.loadActivity(
        { repo: record.repo, number: record.number },
        controller.signal,
      );
      if (this.closed || entry.stopped) return;

      const pull = activity.pull;
      if (pull.title) record.title = pull.title;
      if (pull.url) record.url = pull.url;

      if (pull.merged) {
        this.finish(entry, "merged");
        return;
      }
      if (pull.state === "closed") {
        this.finish(entry, "closed");
        return;
      }

      if (pull.head_sha && record.head_sha !== pull.head_sha) {
        if (record.head_sha && !entry.baseline) {
          events.head_changed = { from: record.head_sha, to: pull.head_sha };
        }
        record.head_sha = pull.head_sha;
        record.ci = { head_sha: pull.head_sha, state: "unknown", first_seen_at: at };
      }

      if (
        pull.head_sha &&
        (record.ci.state === "unknown" ||
          record.ci.state === "pending" ||
          record.ci.state === "no_checks")
      ) {
        const stateBefore = record.ci.state;
        const checks = await this.deps.loadChecks(record.repo, pull.head_sha, controller.signal);
        if (this.closed || entry.stopped) return;
        if (!record.ci.first_seen_at) record.ci.first_seen_at = at;
        if (checks.status === "no_checks") {
          record.ci.state =
            at - record.ci.first_seen_at >= this.discoveryGraceMs ? "no_checks" : "pending";
        } else {
          record.ci.state = checks.status;
          if (!entry.baseline) {
            if (checks.status === "failed") {
              events.ci = { state: "failed", snapshot: checks };
            } else if (
              checks.status === "passed" &&
              (stateBefore === "pending" || stateBefore === "no_checks")
            ) {
              // Announce a pass only when this watch saw the head unsettled.
              events.ci = { state: "passed", snapshot: checks };
            }
          }
        }
      }

      const selfReviews = new Set(record.self_reviews ?? []);
      const streams: Array<[PrActivityItem[], keyof PrWatchRecord["cursor"]]> = [
        [activity.comments, "comments"],
        [activity.reviews, "reviews"],
        [activity.review_comments, "review_comments"],
      ];
      const baselineCutoff = record.started_at - 2_000;
      for (const [items, stream] of streams) {
        for (const item of items) {
          if (!Number.isSafeInteger(item.id) || item.id <= 0) continue;
          if (item.id <= record.cursor[stream]) continue;
          record.cursor[stream] = item.id;
          // The baseline swallows feedback that existed before the watch
          // started. Feedback that arrived after start, even during the first
          // poll, is new and must not be lost.
          const createdAt = Date.parse(item.created_at);
          if (entry.baseline && (!Number.isFinite(createdAt) || createdAt < baselineCutoff)) {
            continue;
          }
          if (this.actionable(item, selfReviews)) events.items.push(item);
        }
      }
      events.items.sort((a, b) => a.id - b.id);

      entry.baseline = false;
      record.baseline = false;
      entry.errors = 0;

      if (events.items.length || events.ci || events.head_changed) {
        record.last_touch_at = Math.max(record.last_touch_at, at);
        record.expires_at = Math.max(record.expires_at, at + this.ttlMs);
        // Record the cursor before the notice so a crash cannot replay it.
        this.persist(entry);
        persisted = true;
        this.deps.deliver(record, formatPrWatchNotice(record, events));
      }
    } catch (error) {
      if (this.closed || entry.stopped) return;
      entry.errors += 1;
      if (entry.errors >= this.maxConsecutiveErrors) {
        record.error = error instanceof Error ? error.message : String(error);
        this.finish(entry, "error");
        return;
      }
      this.persist(entry);
      this.schedulePollForRetry(entry);
      return;
    } finally {
      entry.polling = false;
      entry.controller = undefined;
    }

    if (!persisted && fingerprint(record) !== before) this.persist(entry);
    if (!this.closed && !entry.stopped)
      this.schedulePoll(entry, this.pollInterval(entry, this.now()));
  }

  private schedulePollForRetry(entry: Managed): void {
    const at = this.now();
    const base = this.pollInterval(entry, at);
    const backoff = Math.min(base * 2 ** entry.errors, 30 * 60_000);
    this.schedulePoll(entry, backoff);
  }

  private finish(entry: Managed, reason: PrWatchStopReason): void {
    if (entry.stopped) return;
    entry.stopped = true;
    entry.record.stopped = reason;
    if (entry.timer !== undefined) this.cancel(entry.timer);
    entry.timer = undefined;
    entry.controller?.abort();
    this.persist(entry);
    if (reason !== "cancelled")
      this.deps.deliver(entry.record, formatPrWatchNotice(entry.record, { items: [] }));
  }

  private persist(entry: Managed): void {
    try {
      this.deps.persist(entry.record);
    } catch {
      // Session persistence is best-effort; polling continues without it.
    }
  }
}

function fingerprint(record: PrWatchRecord): string {
  return [
    record.title ?? "",
    record.url ?? "",
    record.head_sha ?? "",
    record.ci.state,
    record.ci.first_seen_at ?? "",
    record.cursor.comments,
    record.cursor.reviews,
    record.cursor.review_comments,
    (record.self_reviews ?? []).join(","),
    record.last_touch_at,
    record.expires_at,
    record.stopped ?? "",
    record.error ?? "",
    record.baseline === true ? "baseline" : "",
  ].join("|");
}

function numericSuffix(id: string): number {
  const match = /(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}
