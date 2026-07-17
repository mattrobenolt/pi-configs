export type GitHubJson = Record<string, any>;

export type CommandResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { signal?: AbortSignal; timeout?: number; cwd?: string },
) => Promise<CommandResult>;

export type GitHubClientOptions = {
  token: (signal?: AbortSignal) => Promise<string>;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
};

export type InlineReviewComment = {
  path: string;
  body: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
};

export type CheckItem = {
  kind: "check_run" | "status";
  name: string;
  status: string;
  conclusion?: string;
  url?: string;
  run_id?: number;
  started_at?: string;
  completed_at?: string;
};

export type CheckSnapshot = {
  status: "pending" | "passed" | "failed" | "no_checks";
  total: number;
  completed: number;
  passed: number;
  failed: number;
  pending: number;
  checks: CheckItem[];
};

export type CIWaitResult = {
  status: "passed" | "failed" | "cancelled" | "timed_out" | "head_changed" | "no_checks";
  head_sha: string;
  expected_head_sha?: string;
  elapsed_ms: number;
  snapshot: CheckSnapshot;
};

export class GitHubApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly retryAfter?: string;
  readonly response: unknown;

  constructor(status: number, endpoint: string, response: unknown, retryAfter?: string) {
    super(formatApiError(status, endpoint, response, retryAfter));
    this.name = "GitHubApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.retryAfter = retryAfter;
    this.response = response;
  }
}

function formatApiError(
  status: number,
  endpoint: string,
  response: unknown,
  retryAfter?: string,
): string {
  const messages: string[] = [];
  if (response && typeof response === "object") {
    const payload = response as {
      message?: unknown;
      errors?: Array<{ message?: unknown; code?: unknown; field?: unknown; resource?: unknown }>;
      documentation_url?: unknown;
    };
    if (typeof payload.message === "string") messages.push(payload.message);
    for (const error of payload.errors ?? []) {
      if (typeof error.message === "string") {
        messages.push(error.message);
        continue;
      }
      const parts = [error.resource, error.field, error.code].filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      );
      if (parts.length > 0) messages.push(parts.join("/"));
    }
  } else if (typeof response === "string" && response.trim()) {
    messages.push(response.trim());
  }

  if (status === 404) {
    messages.push("The resource may not exist or the authenticated account may not have access.");
  }
  if (retryAfter) messages.push(`Retry-After: ${retryAfter}s.`);

  const detail = [...new Set(messages)].join(" — ") || "request failed";
  return `GitHub API ${status} for ${endpoint}: ${detail}`;
}

function combineSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class GitHubClient {
  private readonly token: (signal?: AbortSignal) => Promise<string>;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(options: GitHubClientOptions) {
    this.token = options.token;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
  }

  async request<T = GitHubJson>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    endpoint: string,
    options: {
      body?: unknown;
      accept?: string;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const token = await this.token(options.signal);
    if (!token.trim()) throw new Error("gh auth token returned an empty token");

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          Accept: options.accept ?? "application/vnd.github+json",
          Authorization: `Bearer ${token.trim()}`,
          "Content-Type": "application/json",
          "User-Agent": "pi-github-extension/0.1",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: combineSignal(options.signal, options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const suffix =
        method === "GET" ? "" : " The write outcome is unknown; inspect GitHub before retrying.";
      throw new Error(
        `GitHub ${method} ${endpoint} failed before a response was received.${suffix} ${String(error)}`,
        { cause: error },
      );
    }

    const text = response.status === 204 ? "" : await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      throw new GitHubApiError(
        response.status,
        endpoint,
        payload,
        response.headers.get("retry-after") ?? undefined,
      );
    }

    return payload as T;
  }
}

export function splitRepo(repo: string): { owner: string; name: string; path: string } {
  const match = repo
    .trim()
    .match(/^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error(`Invalid repository "${repo}"; expected owner/repo`);
  const owner = match[1];
  const name = match[2];
  return {
    owner,
    name,
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  };
}

export type GitHubRefKind = "issue_comment" | "review_comment" | "review";

export function parseNumericRef(
  value: number | string | undefined,
  label: string,
  allowedKinds?: GitHubRefKind[],
): number {
  if (value === undefined) throw new Error(`${label} is required`);
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value > 0) return value;
    throw new Error(`${label} must be a positive integer`);
  }

  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const id = Number(text);
    if (Number.isSafeInteger(id) && id > 0) return id;
  }

  const patterns: Array<{ kind: GitHubRefKind; pattern: RegExp }> = [
    { kind: "issue_comment", pattern: /#issuecomment-(\d+)(?:$|[/?#])?/ },
    { kind: "review_comment", pattern: /#discussion_r(\d+)(?:$|[/?#])?/ },
    { kind: "review", pattern: /#pullrequestreview-(\d+)(?:$|[/?#])?/ },
    { kind: "issue_comment", pattern: /\/issues\/comments\/(\d+)(?:$|[/?#])?/ },
    { kind: "review_comment", pattern: /\/pulls\/comments\/(\d+)(?:$|[/?#])?/ },
    { kind: "review", pattern: /\/reviews\/(\d+)(?:$|[/?#])?/ },
  ];
  for (const { kind, pattern } of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    if (allowedKinds && !allowedKinds.includes(kind)) {
      throw new Error(`${label} requires a ${allowedKinds.join(" or ")} URL, not ${kind}`);
    }
    return Number(match[1]);
  }

  throw new Error(`Could not parse ${label} from "${value}"`);
}

export async function paginateList<T>(
  client: GitHubClient,
  endpoint: string,
  options: { signal?: AbortSignal; limit?: number; maxPages?: number } = {},
): Promise<T[]> {
  const perPage = 100;
  const maxPages = options.maxPages ?? 100;
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const pageItems = await client.request<T[]>(
      "GET",
      `${endpoint}${separator}per_page=${perPage}&page=${page}`,
      { signal: options.signal },
    );
    items.push(...pageItems);
    if (options.limit && items.length >= options.limit) return items.slice(0, options.limit);
    if (pageItems.length < perPage) return items;
  }

  throw new Error(`GitHub pagination exceeded ${maxPages} pages for ${endpoint}`);
}

export async function paginateObjectItems<T>(
  client: GitHubClient,
  endpoint: string,
  key: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const perPage = 100;
  const maxPages = 100;
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const payload = await client.request<GitHubJson>(
      "GET",
      `${endpoint}${separator}per_page=${perPage}&page=${page}`,
      { signal },
    );
    const pageItems = (payload[key] ?? []) as T[];
    items.push(...pageItems);
    const total = typeof payload.total_count === "number" ? payload.total_count : undefined;
    if ((total !== undefined && items.length >= total) || pageItems.length < perPage) return items;
  }

  throw new Error(`GitHub pagination exceeded ${maxPages} pages for ${endpoint}`);
}

export function positiveInteger(value: number | undefined, label: string): number {
  if (value !== undefined && Number.isSafeInteger(value) && value > 0) return value;
  throw new Error(`${label} must be a positive integer`);
}

export function requireString(value: string | undefined, label: string): string {
  if (value?.trim()) return value;
  throw new Error(`${label} is required`);
}

export function normalizeInlineComment(comment: InlineReviewComment): GitHubJson {
  const path = requireString(comment.path, "inline comment path");
  const body = requireString(comment.body, "inline comment body");
  const line = positiveInteger(comment.line, "inline comment line");
  const side = comment.side ?? "RIGHT";
  const normalized: GitHubJson = { path, body, line, side };

  if (comment.start_line !== undefined) {
    const startLine = positiveInteger(comment.start_line, "inline comment start_line");
    if (startLine > line) throw new Error("inline comment start_line cannot exceed line");
    normalized.start_line = startLine;
    normalized.start_side = comment.start_side ?? side;
  } else if (comment.start_side !== undefined) {
    throw new Error("inline comment start_side requires start_line");
  }

  return normalized;
}

export async function assertPullHead(
  client: GitHubClient,
  repo: string,
  pullNumber: number,
  expectedHeadSha: string,
  signal?: AbortSignal,
): Promise<GitHubJson> {
  const { path } = splitRepo(repo);
  const pull = await client.request<GitHubJson>("GET", `${path}/pulls/${pullNumber}`, { signal });
  const actual = pull.head?.sha;
  if (actual !== expectedHeadSha) {
    throw new Error(
      `PR head changed: reviewed ${expectedHeadSha}, current head is ${actual ?? "unknown"}. Fetch and review the new head before posting.`,
    );
  }
  return pull;
}

function runIdFromUrl(url: unknown): number | undefined {
  if (typeof url !== "string") return undefined;
  const match = url.match(/\/actions\/runs\/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const FAILURE_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "stale",
  "startup_failure",
]);

export function summarizeChecks(checkRuns: GitHubJson[], statuses: GitHubJson[]): CheckSnapshot {
  const checks: CheckItem[] = [];

  for (const check of checkRuns) {
    const completed = check.status === "completed";
    checks.push({
      kind: "check_run",
      name: String(check.name ?? "unnamed check"),
      status: completed
        ? String(check.conclusion ?? "completed")
        : String(check.status ?? "pending"),
      conclusion: completed ? String(check.conclusion ?? "") : undefined,
      url: check.html_url ?? check.details_url,
      run_id: runIdFromUrl(check.html_url) ?? runIdFromUrl(check.details_url),
      started_at: check.started_at,
      completed_at: check.completed_at,
    });
  }

  for (const status of statuses) {
    checks.push({
      kind: "status",
      name: String(status.context ?? "commit status"),
      status: String(status.state ?? "pending"),
      conclusion: status.state,
      url: status.target_url,
      started_at: status.created_at,
      completed_at: status.updated_at,
    });
  }

  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const check of checks) {
    const state = check.conclusion ?? check.status;
    if (PASSING_CONCLUSIONS.has(state)) passed++;
    else if (FAILURE_CONCLUSIONS.has(state) || state === "error") failed++;
    else pending++;
  }

  const total = checks.length;
  return {
    status: total === 0 ? "no_checks" : pending > 0 ? "pending" : failed > 0 ? "failed" : "passed",
    total,
    completed: passed + failed,
    passed,
    failed,
    pending,
    checks,
  };
}

export async function loadPullChecks(
  client: GitHubClient,
  repo: string,
  pullNumber: number,
  signal?: AbortSignal,
): Promise<{ head_sha: string; snapshot: CheckSnapshot }> {
  const { path } = splitRepo(repo);
  const pull = await client.request<GitHubJson>("GET", `${path}/pulls/${pullNumber}`, { signal });
  const headSha = requireString(pull.head?.sha, "PR head SHA");
  const [checkRuns, statuses] = await Promise.all([
    paginateObjectItems<GitHubJson>(
      client,
      `${path}/commits/${encodeURIComponent(headSha)}/check-runs`,
      "check_runs",
      signal,
    ),
    paginateObjectItems<GitHubJson>(
      client,
      `${path}/commits/${encodeURIComponent(headSha)}/status`,
      "statuses",
      signal,
    ),
  ]);

  return {
    head_sha: headSha,
    snapshot: summarizeChecks(checkRuns, statuses),
  };
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Cancelled"));
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const cancel = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Cancelled"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

export async function waitForPullChecks(options: {
  load: () => Promise<{ head_sha: string; snapshot: CheckSnapshot }>;
  expectedHeadSha?: string;
  timeoutMs: number;
  discoveryGraceMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onProgress?: (result: { head_sha: string; snapshot: CheckSnapshot; elapsed_ms: number }) => void;
}): Promise<CIWaitResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const started = now();
  const deadline = started + options.timeoutMs;
  const discoveryDeadline = started + (options.discoveryGraceMs ?? 30_000);
  const pollInterval = options.pollIntervalMs ?? 10_000;
  let latest: { head_sha: string; snapshot: CheckSnapshot } | undefined;

  while (true) {
    if (options.signal?.aborted) {
      return {
        status: "cancelled",
        head_sha: latest?.head_sha ?? options.expectedHeadSha ?? "unknown",
        expected_head_sha: options.expectedHeadSha,
        elapsed_ms: now() - started,
        snapshot: latest?.snapshot ?? summarizeChecks([], []),
      };
    }

    try {
      latest = await options.load();
    } catch (error) {
      if (!options.signal?.aborted) throw error;
      return {
        status: "cancelled",
        head_sha: latest?.head_sha ?? options.expectedHeadSha ?? "unknown",
        expected_head_sha: options.expectedHeadSha,
        elapsed_ms: now() - started,
        snapshot: latest?.snapshot ?? summarizeChecks([], []),
      };
    }

    const elapsed = now() - started;
    options.onProgress?.({ ...latest, elapsed_ms: elapsed });

    if (options.expectedHeadSha && latest.head_sha !== options.expectedHeadSha) {
      return {
        status: "head_changed",
        head_sha: latest.head_sha,
        expected_head_sha: options.expectedHeadSha,
        elapsed_ms: elapsed,
        snapshot: latest.snapshot,
      };
    }

    if (latest.snapshot.status === "passed" || latest.snapshot.status === "failed") {
      return {
        status: latest.snapshot.status,
        head_sha: latest.head_sha,
        expected_head_sha: options.expectedHeadSha,
        elapsed_ms: elapsed,
        snapshot: latest.snapshot,
      };
    }

    const current = now();
    if (current >= deadline) {
      return {
        status: "timed_out",
        head_sha: latest.head_sha,
        expected_head_sha: options.expectedHeadSha,
        elapsed_ms: current - started,
        snapshot: latest.snapshot,
      };
    }

    if (latest.snapshot.status === "no_checks" && current >= discoveryDeadline) {
      return {
        status: "no_checks",
        head_sha: latest.head_sha,
        expected_head_sha: options.expectedHeadSha,
        elapsed_ms: current - started,
        snapshot: latest.snapshot,
      };
    }

    try {
      await sleep(Math.min(pollInterval, deadline - current), options.signal);
    } catch (error) {
      if (!options.signal?.aborted) throw error;
      return {
        status: "cancelled",
        head_sha: latest.head_sha,
        expected_head_sha: options.expectedHeadSha,
        elapsed_ms: now() - started,
        snapshot: latest.snapshot,
      };
    }
  }
}

export function checkProgressText(snapshot: CheckSnapshot, elapsedMs: number): string {
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `CI: ${snapshot.completed}/${snapshot.total} complete — ${snapshot.passed} passed, ${snapshot.failed} failed, ${snapshot.pending} pending — ${minutes}m${String(seconds).padStart(2, "0")}s elapsed`;
}
