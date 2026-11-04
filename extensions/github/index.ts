import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateTail,
} from "@earendil-works/pi-coding-agent";
import { StringEnum, Type, type Static } from "@mattrobenolt/pi-core/schema";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  GitHubApiError,
  GitHubClient,
  assertPullHead,
  formatChecks,
  loadCommitChecks,
  loadPullChecks,
  loadRefChecks,
  normalizeInlineComment,
  paginateList,
  paginateObjectItems,
  parseNumericRef,
  positiveInteger,
  requireString,
  splitRepo,
  type GitHubJson,
} from "./core.ts";
import {
  CiWatchRegistry,
  formatWatchDetails,
  formatWatchLine,
  formatWatchStatus,
  type CiWatchJob,
} from "./jobs.ts";
import { PrWatchRegistry, loadPrActivity, prWatchRecords, type PrWatchCursor } from "./pr-watch.ts";

const RepoParam = Type.String({ description: "Repository as owner/repo." });
const PositiveIntegerParam = (description: string) => Type.Integer({ description, minimum: 1 });
function referenceParam(description: string) {
  return Type.Union([
    Type.Integer({ description: "Numeric GitHub ID.", minimum: 1 }),
    Type.String({ description }),
  ]);
}

const IssueCommentRefParam = referenceParam(
  "Numeric ID or GitHub PR/issue conversation comment URL containing #issuecomment- or /issues/comments/.",
);
const ReviewCommentRefParam = referenceParam(
  "Numeric ID or inline review comment URL containing #discussion_r or /pulls/comments/.",
);
const ReviewRefParam = referenceParam(
  "Numeric review ID or GitHub review URL containing #pullrequestreview- or /reviews/.",
);

const StackEntryParams = Type.Object({
  pr_number: Type.Optional(
    PositiveIntegerParam("Existing pull request number to include in the stack."),
  ),
  head: Type.Optional(
    Type.String({
      description:
        "Head branch. Reuses that branch's open pull request when one exists, otherwise creates one.",
    }),
  ),
  title: Type.Optional(
    Type.String({
      description: "Title for a newly created pull request. Required when no open PR exists.",
    }),
  ),
  body: Type.Optional(Type.String({ description: "Body for a newly created pull request." })),
  draft: Type.Optional(
    Type.Boolean({
      description: "Create this pull request as a draft. Defaults to the top-level draft.",
    }),
  ),
});

const PullRequestParams = Type.Object({
  action: StringEnum(
    [
      "view",
      "inspect",
      "list",
      "search",
      "create",
      "create_stack",
      "update",
      "view_stack",
      "unstack",
      "comment",
      "update_comment",
      "delete_comment",
      "watch",
      "watches",
      "unwatch",
    ] as const,
    { description: "Pull request operation." },
  ),
  repo: RepoParam,
  pr_number: Type.Optional(
    PositiveIntegerParam(
      "Pull request number. Required for view, inspect, update, comment, update_comment, delete_comment, watch, and unwatch. Optional for view_stack and unstack, which resolve a PR to its stack. Omit for list, search, and watches.",
    ),
  ),
  state: Type.Optional(
    StringEnum(["open", "closed", "all"] as const, {
      description:
        "State filter for list or search, or new state for update (open/closed only). Search defaults to all states.",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        "Search query for action=search. GitHub search syntax passes through (e.g. `cache in:title`, `label:bug`); the tool pins repo: and is:pr itself.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      description: "Maximum results for list. Default 30; max 100.",
      minimum: 1,
      maximum: 100,
    }),
  ),
  title: Type.Optional(Type.String({ description: "Pull request title." })),
  body: Type.Optional(Type.String({ description: "Markdown body or comment text." })),
  base: Type.Optional(
    Type.String({
      description:
        "Base branch for create or update, or the bottom branch for create_stack. Defaults to the repository default branch when create_stack creates the bottom PR.",
    }),
  ),
  head: Type.Optional(Type.String({ description: "Head branch for create." })),
  draft: Type.Optional(Type.Boolean({ description: "Create the pull request as a draft." })),
  pull_requests: Type.Optional(
    Type.Array(StackEntryParams, {
      minItems: 1,
      description:
        "Stack entries ordered from the bottom (closest to base) to the top, for create_stack. Each entry is an existing PR (pr_number) or a branch (head, with title when a new PR is needed).",
    }),
  ),
  stack_number: Type.Optional(
    PositiveIntegerParam(
      "Stack number. For create_stack, appends to the top of that stack; for view_stack and unstack, selects the stack.",
    ),
  ),
  comment: Type.Optional(IssueCommentRefParam),
});

type PullRequestInput = Static<typeof PullRequestParams>;

const InlineCommentParams = Type.Object({
  path: Type.String({ description: "Repository-relative file path." }),
  line: PositiveIntegerParam("Final file line number for the comment or range."),
  side: Type.Optional(
    StringEnum(["LEFT", "RIGHT"] as const, {
      description: "LEFT for deleted lines; RIGHT for added or context lines. Defaults to RIGHT.",
    }),
  ),
  start_line: Type.Optional(PositiveIntegerParam("First line for a multiline comment.")),
  start_side: Type.Optional(
    StringEnum(["LEFT", "RIGHT"] as const, {
      description: "Starting side for a multiline comment. Defaults to side.",
    }),
  ),
  body: Type.String({ description: "Markdown inline comment body." }),
});

const ReviewParams = Type.Object({
  action: StringEnum(
    [
      "submit",
      "comment",
      "reply",
      "update_review",
      "update_comment",
      "delete_comment",
      "list_threads",
      "resolve_thread",
      "unresolve_thread",
    ] as const,
    { description: "Pull request review operation." },
  ),
  repo: RepoParam,
  pr_number: Type.Optional(
    PositiveIntegerParam(
      "Pull request number. Required for submit/comment/list_threads; optional for resolve_thread/unresolve_thread (not needed when passing a thread node ID, and looked up automatically from the comment when resolving by comment).",
    ),
  ),
  expected_head_sha: Type.Optional(
    Type.String({
      description:
        "Exact PR head SHA inspected locally. Required for submit and comment; the operation is rejected if the PR changed.",
      minLength: 7,
    }),
  ),
  event: Type.Optional(
    StringEnum(["approve", "request_changes", "comment"] as const, {
      description: "Review verdict for submit.",
    }),
  ),
  body: Type.Optional(Type.String({ description: "Markdown review, comment, or reply body." })),
  comments: Type.Optional(
    Type.Array(InlineCommentParams, {
      description: "Inline line comments submitted as part of one review.",
      maxItems: 100,
    }),
  ),
  path: Type.Optional(
    Type.String({ description: "Repository-relative path for a standalone comment." }),
  ),
  subject_type: Type.Optional(
    StringEnum(["line", "file"] as const, {
      description: "Target a line/range or the whole file. Defaults to line.",
    }),
  ),
  line: Type.Optional(PositiveIntegerParam("Final file line for a standalone line/range comment.")),
  side: Type.Optional(StringEnum(["LEFT", "RIGHT"] as const)),
  start_line: Type.Optional(PositiveIntegerParam("First line for a standalone multiline comment.")),
  start_side: Type.Optional(StringEnum(["LEFT", "RIGHT"] as const)),
  comment: Type.Optional(ReviewCommentRefParam),
  review: Type.Optional(ReviewRefParam),
  thread: Type.Optional(
    Type.String({
      description:
        "PullRequestReviewThread GraphQL node ID (PRRT_...) for resolve_thread/unresolve_thread. If omitted, pass comment (any inline review comment in the thread) and the containing thread is resolved.",
    }),
  ),
});

type ReviewInput = Static<typeof ReviewParams>;

const IssueParams = Type.Object({
  action: StringEnum(
    [
      "view",
      "list",
      "search",
      "create",
      "update",
      "close",
      "reopen",
      "comment",
      "update_comment",
      "delete_comment",
    ] as const,
    { description: "Issue operation." },
  ),
  repo: RepoParam,
  issue_number: Type.Optional(PositiveIntegerParam("Issue number.")),
  state: Type.Optional(
    StringEnum(["open", "closed", "all"] as const, {
      description: "State filter for list or search. Search defaults to all states.",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        "Search query for action=search. GitHub search syntax passes through (e.g. `cache in:title`, `label:bug`); the tool pins repo: and is:issue itself.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      description: "Maximum issues for list. Default 30; max 100.",
      minimum: 1,
      maximum: 100,
    }),
  ),
  title: Type.Optional(Type.String({ description: "Issue title." })),
  body: Type.Optional(Type.String({ description: "Markdown issue or comment body." })),
  labels: Type.Optional(Type.Array(Type.String(), { description: "Issue label names." })),
  comment: Type.Optional(IssueCommentRefParam),
});

type IssueInput = Static<typeof IssueParams>;

const CIParams = Type.Object({
  action: StringEnum(
    ["watch", "status", "watches", "unwatch", "runs", "run", "failed_logs"] as const,
    {
      description:
        "CI operation. watch waits on a ref in the background and returns immediately; PRs are watched automatically. status is a one-shot snapshot. No operation blocks.",
    },
  ),
  repo: RepoParam,
  pr_number: Type.Optional(
    PositiveIntegerParam("Pull request number for status. Required unless ref is provided."),
  ),
  ref: Type.Optional(
    Type.String({
      description:
        "Git ref (branch, tag, or SHA) for status or watch on a commit outside a PR. Mutually exclusive with pr_number.",
    }),
  ),
  expected_head_sha: Type.Optional(
    Type.String({
      description: "Optional head SHA pin. A watch stops with head_changed if the head moves.",
    }),
  ),
  timeout_minutes: Type.Optional(
    Type.Integer({
      description: "Maximum watch time. Default 30 minutes; max 120.",
      minimum: 1,
      maximum: 120,
    }),
  ),
  watch_id: Type.Optional(
    Type.String({
      description: "Background watch id such as ci-1, for watches (single job) or unwatch.",
    }),
  ),
  run_id: Type.Optional(PositiveIntegerParam("Workflow run ID for run or failed_logs.")),
  branch: Type.Optional(Type.String({ description: "Optional branch filter for runs." })),
  status: Type.Optional(
    StringEnum(
      [
        "completed",
        "action_required",
        "cancelled",
        "failure",
        "neutral",
        "skipped",
        "stale",
        "success",
        "timed_out",
        "in_progress",
        "queued",
        "requested",
        "waiting",
        "pending",
      ] as const,
      { description: "Optional workflow run status filter." },
    ),
  ),
  limit: Type.Optional(
    Type.Integer({
      description: "Maximum workflow runs. Default 20; max 100.",
      minimum: 1,
      maximum: 100,
    }),
  ),
});

type CIInput = Static<typeof CIParams>;

function bodyValue(value: string | undefined, label: string): string {
  return requireString(value, label);
}

function prNumber(value: number | undefined): number {
  return positiveInteger(value, "pr_number");
}

function issueNumber(value: number | undefined): number {
  return positiveInteger(value, "issue_number");
}

function eventName(event: ReviewInput["event"]): "APPROVE" | "REQUEST_CHANGES" | "COMMENT" {
  if (event === "approve") return "APPROVE";
  if (event === "request_changes") return "REQUEST_CHANGES";
  if (event === "comment") return "COMMENT";
  throw new Error("event is required for submit");
}

function endpoint(repo: string): string {
  return splitRepo(repo).path;
}

function userLogin(value: GitHubJson): string {
  return value.user?.login ?? value.author?.login ?? "unknown";
}

function renderPull(pull: GitHubJson): string {
  const stack = pull.stack;
  return [
    `#${pull.number} ${pull.title}`,
    `${pull.state}${pull.draft ? " (draft)" : ""} by ${userLogin(pull)} — ${pull.html_url}`,
    `base ${pull.base?.ref}@${pull.base?.sha} <- head ${pull.head?.label ?? pull.head?.ref}@${pull.head?.sha}`,
    stack
      ? `stack #${stack.number}, position ${stack.position} of ${stack.size} (base ${stack.base?.ref ?? "unknown"})`
      : "",
    `clone: ${pull.base?.repo?.clone_url ?? pull.head?.repo?.clone_url ?? "unknown"}`,
    pull.body ? `\n${pull.body}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// Stacked pull requests are a GitHub preview feature. The dedicated Stacks API
// uses the 2026-03-10 version; older versions do not promise it.
const STACK_API_VERSION = "2026-03-10";

type RequestOptions = NonNullable<Parameters<GitHubClient["request"]>[2]>;

type ResolvedStackEntry = {
  pull: GitHubJson;
  created: boolean;
  base_changed: boolean;
  previous_base?: string;
};

async function stackRequest<T = GitHubJson>(
  client: GitHubClient,
  method: "GET" | "POST",
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  try {
    return await client.request<T>(method, path, { ...options, apiVersion: STACK_API_VERSION });
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      // A 404 from the collection endpoints means stacks are not enabled for
      // the repository. A single-stack 404 usually means a stale stack number.
      const hint = /\/stacks(?:\?|$)/.test(path)
        ? " Stacked pull requests are enabled per repository; confirm the repository has the feature."
        : "";
      throw new Error(`${error.message}${hint}`, { cause: error });
    }
    throw error;
  }
}

function requireStackEntries(
  value: PullRequestInput["pull_requests"],
): Array<NonNullable<PullRequestInput["pull_requests"]>[number]> {
  if (!value?.length) {
    throw new Error(
      "create_stack requires pull_requests, ordered from the bottom of the stack to the top",
    );
  }
  return value;
}

function renderStack(stack: GitHubJson): string {
  const pullRequests = Array.isArray(stack.pull_requests) ? stack.pull_requests : [];
  const lines = [
    `Stack #${stack.number} ${stack.open === false ? "closed" : "open"} on ${stack.base?.ref ?? "unknown base"} — ${pullRequests.length} pull request${pullRequests.length === 1 ? "" : "s"}`,
  ];
  pullRequests.forEach((pull: GitHubJson, index: number) => {
    const state = pull.merged_at
      ? "merged"
      : `${pull.state ?? "unknown"}${pull.draft ? ", draft" : ""}`;
    const summary = [`${index + 1}. #${pull.number}`, `[${state}]`, pull.title]
      .filter(Boolean)
      .join(" ");
    const meta = [pull.head?.ref, pull.html_url].filter(Boolean).join(" — ");
    lines.push(meta ? `${summary} — ${meta}` : summary);
  });
  return lines.join("\n");
}

async function findOpenPull(
  client: GitHubClient,
  repo: string,
  head: string,
  signal?: AbortSignal,
): Promise<GitHubJson | undefined> {
  const { owner } = splitRepo(repo);
  const query = new URLSearchParams({ state: "open", head: `${owner}:${head}`, per_page: "10" });
  const pulls = await client.request<GitHubJson[]>("GET", `${endpoint(repo)}/pulls?${query}`, {
    signal,
  });
  return pulls.find((pull) => pull.head?.ref === head);
}

async function repositoryDefaultBranch(
  client: GitHubClient,
  repo: string,
  signal?: AbortSignal,
): Promise<string> {
  const data = await client.request<GitHubJson>("GET", endpoint(repo), { signal });
  return requireString(data.default_branch, "repository default_branch");
}

/**
 * Resolve stack entries in bottom-to-top order. Existing open PRs for a head
 * branch are reused so that a failed or repeated create_stack does not collide
 * with PRs it already made. Each PR is retargeted onto the head of the entry
 * below it, which is the chain rule the Stacks API enforces.
 */
async function resolveStackEntries(
  client: GitHubClient,
  params: PullRequestInput,
  signal?: AbortSignal,
): Promise<{ entries: ResolvedStackEntry[]; stack?: GitHubJson }> {
  const repo = params.repo;
  const path = endpoint(repo);
  const inputs = requireStackEntries(params.pull_requests);
  const rootBase = params.base === undefined ? undefined : requireString(params.base, "base");

  let stack: GitHubJson | undefined;
  let previousHead: string | undefined;
  if (params.stack_number !== undefined) {
    if (rootBase !== undefined) {
      throw new Error(
        "base cannot be combined with stack_number: an appended pull request bases on the current top of the stack",
      );
    }
    stack = await stackRequest<GitHubJson>(client, "GET", `${path}/stacks/${params.stack_number}`, {
      signal,
    });
    const top = (stack.pull_requests ?? []).at(-1);
    if (!top?.head?.ref) {
      throw new Error(`Stack #${params.stack_number} has no pull requests to append to`);
    }
    previousHead = top.head.ref;
  }

  const resolved: ResolvedStackEntry[] = [];
  for (const [index, input] of inputs.entries()) {
    const hasNumber = input.pr_number !== undefined;
    const hasHead = input.head !== undefined;
    if (hasNumber === hasHead) {
      throw new Error(`pull_requests[${index}] needs exactly one of pr_number or head`);
    }
    const expectedBase = index === 0 ? rootBase : previousHead;
    let pull: GitHubJson;
    let created = false;

    if (hasNumber) {
      const number = positiveInteger(input.pr_number, `pull_requests[${index}].pr_number`);
      pull = await client.request<GitHubJson>("GET", `${path}/pulls/${number}`, { signal });
    } else {
      const head = requireString(input.head, `pull_requests[${index}].head`).trim();
      const existing = await findOpenPull(client, repo, head, signal);
      if (existing) {
        pull = existing;
      } else {
        const base = expectedBase ?? (await repositoryDefaultBranch(client, repo, signal));
        const payload: GitHubJson = {
          title: requireString(input.title, `pull_requests[${index}].title`),
          head,
          base,
        };
        if (input.body !== undefined) payload.body = input.body;
        const draft = input.draft ?? params.draft;
        if (draft !== undefined) payload.draft = draft;
        pull = await client.request<GitHubJson>("POST", `${path}/pulls`, { body: payload, signal });
        created = true;
      }
    }

    const previousBase = typeof pull.base?.ref === "string" ? pull.base.ref : undefined;
    const memberStack = pull.stack?.number;
    let baseChanged = false;
    if (memberStack !== undefined) {
      // A PR already on a stack is positioned by that stack. Refuse a move
      // before retargeting anything, and never retarget a stack member.
      if (params.stack_number === undefined) {
        throw new Error(
          `#${pull.number} already belongs to stack #${memberStack}. Pass stack_number=${memberStack} to append to it, or view_stack to inspect it.`,
        );
      }
      if (memberStack !== params.stack_number) {
        throw new Error(
          `#${pull.number} already belongs to stack #${memberStack}; a pull request cannot join stack #${params.stack_number}.`,
        );
      }
    } else if (expectedBase !== undefined && previousBase !== expectedBase) {
      pull = await client.request<GitHubJson>("PATCH", `${path}/pulls/${pull.number}`, {
        body: { base: expectedBase },
        signal,
      });
      baseChanged = true;
    }

    previousHead = requireString(pull.head?.ref, `pull_requests[${index}] head ref`);
    resolved.push({ pull, created, base_changed: baseChanged, previous_base: previousBase });
  }

  return { entries: resolved, stack };
}

function renderIssue(issue: GitHubJson): string {
  return [
    `#${issue.number} ${issue.title}`,
    `${issue.state} by ${userLogin(issue)} — ${issue.html_url}`,
    issue.labels?.length
      ? `labels: ${issue.labels.map((label: GitHubJson) => label.name).join(", ")}`
      : "",
    issue.body ? `\n${issue.body}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderMutation(summary: string, body: unknown): string {
  return typeof body === "string" ? `${summary}\n\n${body}` : summary;
}

function renderSubmittedReview(summary: string, payload: GitHubJson): string {
  const sections = [summary];
  if (typeof payload.body === "string") sections.push(`Review body:\n${payload.body}`);
  if (payload.comments?.length) {
    const comments = payload.comments.map((comment: GitHubJson) => {
      const range = comment.start_line
        ? `${comment.start_line}-${comment.line}`
        : (comment.line ?? "file");
      return `${comment.path}:${range} (${comment.side ?? "file"})\n${comment.body}`;
    });
    sections.push(`Inline comments (${comments.length}):\n${comments.join("\n\n")}`);
  }
  return sections.join("\n\n");
}

type ReviewThreadComment = {
  databaseId: number;
  id: string;
  body: string;
  author: string;
  createdAt: string;
};

type ReviewThread = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  isCollapsed: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  diffSide: string;
  comments: ReviewThreadComment[];
};

// reviewThreads is GraphQL-only: the REST API neither lists threads nor
// exposes isResolved. Each thread's comment.databaseId is the REST numeric id
// our other actions use, so a comment ref maps to its containing thread.
const REVIEW_THREADS_QUERY = `
  query($owner: String!, $name: String!, $pr: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $pr) {
        reviewThreads(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            isCollapsed
            path
            line
            startLine
            diffSide
            comments(first: 100) {
              nodes {
                databaseId
                id
                body
                author { login }
                createdAt
              }
            }
          }
        }
      }
    }
  }
`;

async function loadReviewThreads(
  client: GitHubClient,
  repo: string,
  pullNumber: number,
  signal?: AbortSignal,
): Promise<ReviewThread[]> {
  const { owner, name } = splitRepo(repo);
  const threads: ReviewThread[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const data = await client.graphql<{
      repository?: {
        pullRequest?: {
          reviewThreads: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Array<{
              id: string;
              isResolved: boolean;
              isOutdated: boolean;
              isCollapsed: boolean;
              path: string;
              line: number | null;
              startLine: number | null;
              diffSide: string;
              comments?: {
                nodes?: Array<{
                  databaseId: number;
                  id: string;
                  body: string;
                  author?: { login?: string };
                  createdAt: string;
                }>;
              };
            }>;
          };
        };
      };
    }>(REVIEW_THREADS_QUERY, { owner, name, pr: pullNumber, cursor }, { signal });
    const reviewThreads = data.repository?.pullRequest?.reviewThreads;
    if (!reviewThreads) {
      throw new Error(`GitHub GraphQL returned no reviewThreads for ${repo}#${pullNumber}`);
    }
    for (const node of reviewThreads.nodes) {
      threads.push({
        id: node.id,
        isResolved: node.isResolved,
        isOutdated: node.isOutdated,
        isCollapsed: node.isCollapsed,
        path: node.path,
        line: node.line,
        startLine: node.startLine,
        diffSide: node.diffSide,
        comments: (node.comments?.nodes ?? []).map((comment) => ({
          databaseId: comment.databaseId,
          id: comment.id,
          body: comment.body,
          author: comment.author?.login ?? "unknown",
          createdAt: comment.createdAt,
        })),
      });
    }
    if (!reviewThreads.pageInfo.hasNextPage) break;
    cursor = reviewThreads.pageInfo.endCursor ?? undefined;
  }
  return threads;
}

// resolve_thread/unresolve_thread identify a thread by either a thread node ID
// (which needs no PR number for the GraphQL mutation) or by an inline comment
// (which needs the PR number only to load that PR's review threads). When the
// caller omits pr_number, resolve it from the review comment via one REST call
// (GET /repos/{owner}/{repo}/pulls/comments/{id} returns pull_request_url).
async function resolvePrNumber(
  client: GitHubClient,
  repo: string,
  prNumberValue: number | undefined,
  commentId: number,
  signal?: AbortSignal,
): Promise<number> {
  if (prNumberValue !== undefined) {
    return positiveInteger(prNumberValue, "pr_number");
  }
  const basePath = endpoint(repo);
  const comment = await client.request<GitHubJson>(
    "GET",
    `${basePath}/pulls/comments/${commentId}`,
    { signal },
  );
  const url = comment.pull_request_url;
  const match = typeof url === "string" ? url.match(/\/pulls\/(\d+)(?:$|[/?#])/) : null;
  const number = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(
      `Could not resolve PR number from review comment ${commentId} on ${repo} (pull_request_url: ${String(url)}). Pass pr_number explicitly.`,
    );
  }
  return number;
}

function threadRange(thread: ReviewThread): string {
  if (thread.startLine != null && thread.line != null) return `${thread.startLine}-${thread.line}`;
  return thread.line != null ? String(thread.line) : "file";
}

function renderThreads(threads: ReviewThread[]): string {
  if (!threads.length) return "No review threads found.";
  const lines = [`Review threads (${threads.length}):`];
  for (const thread of threads) {
    const flags = [
      thread.isResolved ? "resolved" : "unresolved",
      thread.isOutdated ? "outdated" : "",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `- thread ${thread.id} [${flags}] ${thread.path}:${threadRange(thread)} (${thread.diffSide})`,
    );
    for (const comment of thread.comments) {
      const excerpt = comment.body.replace(/\s+/g, " ").trim().slice(0, 160);
      lines.push(`  - comment ${comment.databaseId} ${comment.author}: ${excerpt}`);
    }
  }
  return lines.join("\n");
}

async function spillOutput(text: string, prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `pi-github-${prefix}-`));
  const file = path.join(directory, "output.txt");
  await fs.writeFile(file, text, { encoding: "utf8", mode: 0o600 });
  return file;
}

async function toolResult(
  text: string,
  details: Record<string, unknown>,
  mode: "head" | "tail" = "head",
) {
  const truncated = (mode === "head" ? truncateHead : truncateTail)(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  let content = truncated.content;
  let outputFile: string | undefined;
  if (truncated.truncated) {
    outputFile = await spillOutput(text, mode);
    content += `\n\n[Output truncated: ${truncated.outputLines}/${truncated.totalLines} lines, ${formatSize(truncated.outputBytes)}/${formatSize(truncated.totalBytes)}. Full output: ${outputFile}]`;
  }
  return {
    content: [{ type: "text" as const, text: content }],
    details: { ...details, truncated: truncated.truncated, outputFile },
  };
}

type SearchType = "issue" | "pr";

/**
 * Shared backend for github_issue search and github_pr search. Both hit
 * /search/issues; the tool pins repo: and the is: type qualifier, the caller's
 * query passes through verbatim so GitHub qualifiers (in:title, label:,
 * author:, …) keep working. Duplicates hide in closed issues, so search
 * defaults to all states — unlike list, which defaults to open. The
 * text-match media type asks GitHub for the matched body fragment, which is
 * what reveals a title miss actually matched the body.
 */
async function executeSearch(
  client: GitHubClient,
  params: { repo: string; query?: string; state?: "open" | "closed" | "all"; limit?: number },
  type: SearchType,
  signal?: AbortSignal,
) {
  const { owner, name } = splitRepo(params.repo);
  const terms = [requireString(params.query, "query").trim()];
  terms.push(`repo:${owner}/${name}`, `is:${type}`);
  if (params.state && params.state !== "all") terms.push(`state:${params.state}`);
  const q = terms.join(" ");
  const limit = params.limit ?? 30;
  const searchParams = new URLSearchParams({ q, per_page: String(limit) });
  const result = await client.request<GitHubJson>("GET", `/search/issues?${searchParams}`, {
    accept: "application/vnd.github.text-match+json",
    signal,
  });
  const items = (result.items ?? []) as GitHubJson[];
  const total = typeof result.total_count === "number" ? result.total_count : items.length;
  if (!items.length) {
    return toolResult(`No matches for: ${q}`, {
      action: "search",
      repo: params.repo,
      query: q,
      total_count: total,
      items,
    });
  }
  const lines = [
    `${total} match${total === 1 ? "" : "es"} for: ${q}${items.length < total ? ` (showing ${items.length})` : ""}`,
  ];
  for (const item of items) {
    lines.push(
      `#${item.number} [${item.state}${item.draft ? ", draft" : ""}] ${item.title} — ${item.html_url}`,
    );
    const fragment = item.text_matches?.[0]?.fragment;
    if (typeof fragment === "string" && fragment.trim()) {
      const collapsed = fragment.replace(/\s+/g, " ").trim();
      lines.push(`  › ${collapsed.length > 200 ? `${collapsed.slice(0, 200)}…` : collapsed}`);
    }
  }
  return toolResult(lines.join("\n"), {
    action: "search",
    repo: params.repo,
    query: q,
    total_count: total,
    incomplete_results: result.incomplete_results === true,
    items,
  });
}

export async function executePull(
  client: GitHubClient,
  params: PullRequestInput,
  signal?: AbortSignal,
  prWatches?: PrWatchRegistry,
) {
  const basePath = endpoint(params.repo);

  if (params.action === "watches") {
    if (!prWatches) throw new Error("PR watches are unavailable in this context.");
    const lines = prWatches.describe();
    return toolResult(
      lines.length > 0 ? ["PR watches:", ...lines].join("\n") : "No active PR watches.",
      { action: params.action, repo: params.repo, watches: prWatches.list() },
    );
  }

  if (params.action === "unwatch") {
    if (!prWatches) throw new Error("PR watches are unavailable in this context.");
    const number = prNumber(params.pr_number);
    const cancelled = prWatches.stopPr(params.repo, number);
    return toolResult(
      cancelled ? `Cancelled the PR watch for #${number}.` : `No active PR watch for #${number}.`,
      { action: params.action, repo: params.repo, pr_number: number, cancelled },
    );
  }

  if (params.action === "watch") {
    if (!prWatches) throw new Error("PR watches are unavailable in this context.");
    const number = prNumber(params.pr_number);
    const start = prWatches.start({ repo: params.repo, number });
    return toolResult(
      start.created
        ? `Watching #${number} for CI and new feedback.`
        : `Already watching #${number}.`,
      {
        action: params.action,
        repo: params.repo,
        pr_number: number,
        created: start.created,
        watch: start.record,
      },
    );
  }

  if (params.action === "view") {
    const number = prNumber(params.pr_number);
    const pull = await client.request<GitHubJson>("GET", `${basePath}/pulls/${number}`, { signal });
    return toolResult(renderPull(pull), { action: params.action, repo: params.repo, pull });
  }

  if (params.action === "inspect") {
    const number = prNumber(params.pr_number);
    const [pull, reviews, reviewComments, conversation, checks] = await Promise.all([
      client.request<GitHubJson>("GET", `${basePath}/pulls/${number}`, { signal }),
      paginateList<GitHubJson>(client, `${basePath}/pulls/${number}/reviews`, { signal }),
      paginateList<GitHubJson>(client, `${basePath}/pulls/${number}/comments`, { signal }),
      paginateList<GitHubJson>(client, `${basePath}/issues/${number}/comments`, { signal }),
      loadPullChecks(client, params.repo, number, signal),
    ]);
    const lines = [renderPull(pull), "", formatChecks(checks.snapshot)];
    if (reviews.length) {
      lines.push("", "Reviews:");
      for (const review of reviews) {
        lines.push(
          `- review ${review.id} [${review.state}] ${userLogin(review)} — ${review.html_url ?? ""}\n  ${review.body ?? ""}`,
        );
      }
    }
    if (reviewComments.length) {
      lines.push("", "Inline review comments:");
      for (const comment of reviewComments) {
        const range = comment.start_line
          ? `${comment.start_line}-${comment.line}`
          : (comment.line ?? "file");
        lines.push(
          `- comment ${comment.id} ${comment.path}:${range} ${userLogin(comment)} — ${comment.html_url}\n  ${comment.body ?? ""}`,
        );
      }
    }
    if (conversation.length) {
      lines.push("", "PR conversation:");
      for (const comment of conversation) {
        lines.push(
          `- comment ${comment.id} ${userLogin(comment)} — ${comment.html_url}\n  ${comment.body ?? ""}`,
        );
      }
    }
    return toolResult(lines.join("\n"), {
      action: params.action,
      repo: params.repo,
      pull,
      checks,
      reviews,
      reviewComments,
      conversation,
    });
  }

  if (params.action === "list") {
    const query = new URLSearchParams({
      state: params.state ?? "open",
      per_page: String(params.limit ?? 30),
    });
    const pulls = await client.request<GitHubJson[]>("GET", `${basePath}/pulls?${query}`, {
      signal,
    });
    const text =
      pulls
        .map(
          (pull) =>
            `#${pull.number} [${pull.state}${pull.draft ? ", draft" : ""}] ${pull.title} — ${pull.html_url}`,
        )
        .join("\n") || "No pull requests found.";
    return toolResult(text, { action: params.action, repo: params.repo, pulls });
  }

  if (params.action === "search") {
    return executeSearch(client, params, "pr", signal);
  }

  if (params.action === "create") {
    const payload: GitHubJson = {
      title: requireString(params.title, "title"),
      head: requireString(params.head, "head"),
      base: requireString(params.base, "base"),
    };
    if (params.body !== undefined) payload.body = params.body;
    if (params.draft !== undefined) payload.draft = params.draft;
    const pull = await client.request<GitHubJson>("POST", `${basePath}/pulls`, {
      body: payload,
      signal,
    });
    return toolResult(renderPull(pull), {
      action: params.action,
      repo: params.repo,
      pull,
    });
  }

  if (params.action === "create_stack") {
    const { entries, stack: existingStack } = await resolveStackEntries(client, params, signal);
    const created = entries.filter((entry) => entry.created);
    const baseChanges = entries.filter((entry) => entry.base_changed);
    let additions = entries;

    if (params.stack_number !== undefined) {
      additions = entries.filter((entry) => entry.pull.stack?.number !== params.stack_number);
      if (additions.length === 0) {
        const unchanged =
          existingStack ??
          (await stackRequest<GitHubJson>(
            client,
            "GET",
            `${basePath}/stacks/${params.stack_number}`,
            { signal },
          ));
        return toolResult(
          [
            `All ${entries.length} pull request${entries.length === 1 ? " is" : "s are"} already in stack #${params.stack_number}.`,
            renderStack(unchanged),
          ].join("\n"),
          {
            action: params.action,
            repo: params.repo,
            stack: unchanged,
            created: [],
            reused: entries.map((entry) => entry.pull),
            unchanged: true,
          },
        );
      }
    }

    let stack: GitHubJson;
    try {
      stack =
        params.stack_number !== undefined
          ? await stackRequest(client, "POST", `${basePath}/stacks/${params.stack_number}/add`, {
              body: { pull_requests: additions.map((entry) => entry.pull.number) },
              signal,
            })
          : await stackRequest(client, "POST", `${basePath}/stacks`, {
              body: { pull_requests: entries.map((entry) => entry.pull.number) },
              signal,
            });
    } catch (error) {
      const createdNumbers = created.map((entry) => `#${entry.pull.number}`).join(", ");
      if (createdNumbers) {
        throw new Error(
          `${(error as Error).message}\nCreated ${createdNumbers}, but the stack was not updated. Rerun create_stack: existing open pull requests are reused.`,
          { cause: error },
        );
      }
      throw error;
    }

    const lines = [renderStack(stack)];
    if (created.length) {
      lines.push(`Created ${created.map((entry) => `#${entry.pull.number}`).join(", ")}.`);
    }
    if (baseChanges.length) {
      lines.push(
        ...baseChanges.map(
          (entry) =>
            `Retargeted #${entry.pull.number} base ${entry.previous_base ?? "unknown"} -> ${entry.pull.base?.ref}.`,
        ),
      );
    }
    const alreadyThere = entries.length - additions.length;
    if (alreadyThere > 0) {
      lines.push(
        `${alreadyThere} pull request${alreadyThere === 1 ? " was" : "s were"} already in the stack.`,
      );
    }
    lines.push(
      "Merge the stack with GitHub's asynchronous stack merge (gh stack merge); gh pr merge does not merge a stack.",
    );
    return toolResult(lines.join("\n"), {
      action: params.action,
      repo: params.repo,
      stack,
      created: created.map((entry) => entry.pull),
      reused: entries.filter((entry) => !entry.created).map((entry) => entry.pull),
      base_changes: baseChanges.map((entry) => ({
        number: entry.pull.number,
        from: entry.previous_base,
        to: entry.pull.base?.ref,
      })),
    });
  }

  if (params.action === "view_stack") {
    if (params.stack_number === undefined && params.pr_number === undefined) {
      throw new Error("view_stack requires stack_number or pr_number");
    }
    let number = params.stack_number;
    if (number === undefined) {
      const pull = prNumber(params.pr_number);
      const query = new URLSearchParams({ pull_request: String(pull) });
      const stacks = await stackRequest<GitHubJson[]>(
        client,
        "GET",
        `${basePath}/stacks?${query}`,
        { signal },
      );
      if (!stacks.length) {
        return toolResult(`#${pull} is not part of a stack.`, {
          action: params.action,
          repo: params.repo,
          pr_number: pull,
          stack: null,
        });
      }
      number = stacks[0].number;
    }
    const stack = await stackRequest(client, "GET", `${basePath}/stacks/${number}`, { signal });
    return toolResult(renderStack(stack), {
      action: params.action,
      repo: params.repo,
      stack,
    });
  }

  if (params.action === "unstack") {
    if (params.stack_number === undefined && params.pr_number === undefined) {
      throw new Error("unstack requires stack_number or pr_number");
    }
    let number = params.stack_number;
    if (number === undefined) {
      const pull = prNumber(params.pr_number);
      const query = new URLSearchParams({ pull_request: String(pull) });
      const stacks = await stackRequest<GitHubJson[]>(
        client,
        "GET",
        `${basePath}/stacks?${query}`,
        { signal },
      );
      if (!stacks.length) throw new Error(`#${pull} is not part of a stack`);
      number = stacks[0].number;
    }
    const stack = await stackRequest<GitHubJson | null>(
      client,
      "POST",
      `${basePath}/stacks/${number}/unstack`,
      { signal },
    );
    if (!stack) {
      return toolResult(
        `Dissolved stack #${number}. The pull requests and branches are unchanged.`,
        {
          action: params.action,
          repo: params.repo,
          stack_number: number,
          dissolved: true,
          stack: null,
        },
      );
    }
    return toolResult(
      [`Unstacked the removable pull requests from stack #${number}.`, renderStack(stack)].join(
        "\n",
      ),
      {
        action: params.action,
        repo: params.repo,
        stack_number: number,
        dissolved: false,
        stack,
      },
    );
  }

  if (params.action === "update") {
    const number = prNumber(params.pr_number);
    const payload: GitHubJson = {};
    if (params.title !== undefined) payload.title = params.title;
    if (params.body !== undefined) payload.body = params.body;
    if (params.base !== undefined) payload.base = params.base;
    if (params.state !== undefined) {
      if (params.state === "all") throw new Error("state must be open or closed for update");
      payload.state = params.state;
    }
    if (Object.keys(payload).length === 0)
      throw new Error("update requires title, body, base, or state");
    const pull = await client.request<GitHubJson>("PATCH", `${basePath}/pulls/${number}`, {
      body: payload,
      signal,
    });
    return toolResult(renderPull(pull), {
      action: params.action,
      repo: params.repo,
      pull,
    });
  }

  if (params.action === "comment") {
    const number = prNumber(params.pr_number);
    const comment = await client.request<GitHubJson>(
      "POST",
      `${basePath}/issues/${number}/comments`,
      {
        body: { body: bodyValue(params.body, "body") },
        signal,
      },
    );
    return toolResult(
      renderMutation(
        `Created PR comment ${comment.id}: ${comment.html_url}`,
        comment.body ?? params.body,
      ),
      {
        action: params.action,
        repo: params.repo,
        comment,
      },
    );
  }

  if (params.action !== "update_comment" && params.action !== "delete_comment") {
    throw new Error(`Unsupported github_pr action: ${String(params.action)}`);
  }
  const commentId = parseNumericRef(params.comment, "PR conversation comment ID", [
    "issue_comment",
  ]);
  if (params.action === "update_comment") {
    const comment = await client.request<GitHubJson>(
      "PATCH",
      `${basePath}/issues/comments/${commentId}`,
      {
        body: { body: bodyValue(params.body, "body") },
        signal,
      },
    );
    return toolResult(
      renderMutation(
        `Updated PR comment ${comment.id}: ${comment.html_url}`,
        comment.body ?? params.body,
      ),
      {
        action: params.action,
        repo: params.repo,
        comment,
      },
    );
  }

  await client.request("DELETE", `${basePath}/issues/comments/${commentId}`, { signal });
  return toolResult(`Deleted PR comment ${commentId}.`, {
    action: params.action,
    repo: params.repo,
    comment_id: commentId,
    deleted: true,
  });
}

export async function executeReview(
  client: GitHubClient,
  params: ReviewInput,
  signal?: AbortSignal,
) {
  const basePath = endpoint(params.repo);

  if (params.action === "submit") {
    const number = prNumber(params.pr_number);
    const headSha = requireString(params.expected_head_sha, "expected_head_sha");
    const event = eventName(params.event);
    if ((event === "COMMENT" || event === "REQUEST_CHANGES") && !params.body?.trim()) {
      throw new Error(`body is required when event is ${params.event}`);
    }
    await assertPullHead(client, params.repo, number, headSha, signal);
    const payload: GitHubJson = {
      commit_id: headSha,
      event,
      comments: (params.comments ?? []).map(normalizeInlineComment),
    };
    if (params.body !== undefined) payload.body = params.body;
    const review = await client.request<GitHubJson>("POST", `${basePath}/pulls/${number}/reviews`, {
      body: payload,
      signal,
    });
    return toolResult(
      renderSubmittedReview(
        `Submitted ${review.state ?? event} review ${review.id}: ${review.html_url}`,
        payload,
      ),
      {
        action: params.action,
        repo: params.repo,
        review,
      },
    );
  }

  if (params.action === "comment") {
    const number = prNumber(params.pr_number);
    const headSha = requireString(params.expected_head_sha, "expected_head_sha");
    await assertPullHead(client, params.repo, number, headSha, signal);
    const subjectType = params.subject_type ?? "line";
    const payload: GitHubJson = {
      body: bodyValue(params.body, "body"),
      commit_id: headSha,
      path: requireString(params.path, "path"),
    };
    if (subjectType === "line") {
      payload.line = positiveInteger(params.line, "line");
      payload.side = params.side ?? "RIGHT";
      if (params.start_line !== undefined) {
        payload.start_line = positiveInteger(params.start_line, "start_line");
        if (payload.start_line > payload.line) throw new Error("start_line cannot exceed line");
        payload.start_side = params.start_side ?? payload.side;
      } else if (params.start_side !== undefined) {
        throw new Error("start_side requires start_line");
      }
    } else if (params.line !== undefined || params.start_line !== undefined) {
      throw new Error("file comments must omit line and start_line");
    } else {
      payload.subject_type = "file";
    }
    const comment = await client.request<GitHubJson>(
      "POST",
      `${basePath}/pulls/${number}/comments`,
      {
        body: payload,
        signal,
      },
    );
    return toolResult(
      renderMutation(
        `Created inline comment ${comment.id}: ${comment.html_url}`,
        comment.body ?? payload.body,
      ),
      {
        action: params.action,
        repo: params.repo,
        comment,
      },
    );
  }

  if (params.action === "reply") {
    const number = prNumber(params.pr_number);
    const commentId = parseNumericRef(params.comment, "inline review comment ID", [
      "review_comment",
    ]);
    const comment = await client.request<GitHubJson>(
      "POST",
      `${basePath}/pulls/${number}/comments/${commentId}/replies`,
      { body: { body: bodyValue(params.body, "body") }, signal },
    );
    return toolResult(
      renderMutation(
        `Replied with comment ${comment.id}: ${comment.html_url}`,
        comment.body ?? params.body,
      ),
      {
        action: params.action,
        repo: params.repo,
        comment,
      },
    );
  }

  if (params.action === "update_review") {
    const number = prNumber(params.pr_number);
    const reviewId = parseNumericRef(params.review, "review ID", ["review"]);
    const review = await client.request<GitHubJson>(
      "PUT",
      `${basePath}/pulls/${number}/reviews/${reviewId}`,
      {
        body: { body: bodyValue(params.body, "body") },
        signal,
      },
    );
    return toolResult(
      renderMutation(`Updated review ${review.id}: ${review.html_url}`, review.body ?? params.body),
      {
        action: params.action,
        repo: params.repo,
        review,
      },
    );
  }

  if (params.action === "list_threads") {
    const number = prNumber(params.pr_number);
    const threads = await loadReviewThreads(client, params.repo, number, signal);
    return toolResult(renderThreads(threads), {
      action: params.action,
      repo: params.repo,
      threads,
    });
  }

  if (params.action === "resolve_thread" || params.action === "unresolve_thread") {
    const resolve = params.action === "resolve_thread";
    let threadId = params.thread?.trim();
    let prior: ReviewThread | undefined;
    if (!threadId) {
      const commentId = parseNumericRef(params.comment, "inline review comment ID", [
        "review_comment",
      ]);
      const number = await resolvePrNumber(
        client,
        params.repo,
        params.pr_number,
        commentId,
        signal,
      );
      const threads = await loadReviewThreads(client, params.repo, number, signal);
      prior = threads.find((thread) =>
        thread.comments.some((comment) => comment.databaseId === commentId),
      );
      if (!prior) {
        throw new Error(
          `No review thread contains inline comment ${commentId} on ${params.repo}#${number}. It may be a top-level PR conversation comment (use github_pr) or an already-resolved thread filtered out by GitHub.`,
        );
      }
      threadId = prior.id;
    }
    const mutation = resolve
      ? "mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved isOutdated path line } } }"
      : "mutation($threadId: ID!) { unresolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved isOutdated path line } } }";
    const data = await client.graphql<{
      [key: string]: {
        thread?: {
          id: string;
          isResolved: boolean;
          isOutdated: boolean;
          path: string;
          line: number | null;
        };
      };
    }>(mutation, { threadId }, { signal });
    const thread = data[resolve ? "resolveReviewThread" : "unresolveReviewThread"]?.thread;
    if (!thread) throw new Error(`GitHub GraphQL returned no thread for ${params.action}`);
    const verb = resolve ? "Resolved" : "Unresolved";
    const priorNote = prior ? ` (was ${prior.isResolved ? "resolved" : "unresolved"})` : "";
    return toolResult(
      `${verb} thread ${thread.id} — ${thread.path}:${thread.line ?? "file"}${priorNote}. isResolved=${thread.isResolved}`,
      { action: params.action, repo: params.repo, thread, prior },
    );
  }

  if (params.action !== "update_comment" && params.action !== "delete_comment") {
    throw new Error(`Unsupported github_review action: ${String(params.action)}`);
  }
  const commentId = parseNumericRef(params.comment, "inline review comment ID", ["review_comment"]);
  if (params.action === "update_comment") {
    const comment = await client.request<GitHubJson>(
      "PATCH",
      `${basePath}/pulls/comments/${commentId}`,
      {
        body: { body: bodyValue(params.body, "body") },
        signal,
      },
    );
    return toolResult(
      renderMutation(
        `Updated inline comment ${comment.id}: ${comment.html_url}`,
        comment.body ?? params.body,
      ),
      {
        action: params.action,
        repo: params.repo,
        comment,
      },
    );
  }

  await client.request("DELETE", `${basePath}/pulls/comments/${commentId}`, { signal });
  return toolResult(`Deleted inline comment ${commentId}.`, {
    action: params.action,
    repo: params.repo,
    comment_id: commentId,
    deleted: true,
  });
}

export async function executeIssue(client: GitHubClient, params: IssueInput, signal?: AbortSignal) {
  const basePath = endpoint(params.repo);

  if (params.action === "view") {
    const number = issueNumber(params.issue_number);
    const [issue, comments] = await Promise.all([
      client.request<GitHubJson>("GET", `${basePath}/issues/${number}`, { signal }),
      paginateList<GitHubJson>(client, `${basePath}/issues/${number}/comments`, { signal }),
    ]);
    if (issue.pull_request) throw new Error(`#${number} is a pull request; use github_pr`);
    const lines = [renderIssue(issue)];
    if (comments.length) {
      lines.push("", "Comments:");
      for (const comment of comments) {
        lines.push(
          `- comment ${comment.id} ${userLogin(comment)} — ${comment.html_url}\n  ${comment.body ?? ""}`,
        );
      }
    }
    return toolResult(lines.join("\n"), {
      action: params.action,
      repo: params.repo,
      issue,
      comments,
    });
  }

  if (params.action === "list") {
    const limit = params.limit ?? 30;
    const issues: GitHubJson[] = [];
    for (let page = 1; page <= 100; page++) {
      const query = new URLSearchParams({
        state: params.state ?? "open",
        per_page: "100",
        page: String(page),
      });
      const items = await client.request<GitHubJson[]>("GET", `${basePath}/issues?${query}`, {
        signal,
      });
      issues.push(...items.filter((item) => !item.pull_request));
      if (issues.length >= limit || items.length < 100) break;
      if (page === 100) {
        throw new Error(`GitHub pagination exceeded 100 pages for ${basePath}/issues`);
      }
    }
    const limitedIssues = issues.slice(0, limit);
    const text =
      limitedIssues
        .map((issue) => `#${issue.number} [${issue.state}] ${issue.title} — ${issue.html_url}`)
        .join("\n") || "No issues found.";
    return toolResult(text, { action: params.action, repo: params.repo, issues: limitedIssues });
  }

  if (params.action === "search") {
    return executeSearch(client, params, "issue", signal);
  }

  if (params.action === "create") {
    const payload: GitHubJson = { title: requireString(params.title, "title") };
    if (params.body !== undefined) payload.body = params.body;
    if (params.labels !== undefined) payload.labels = params.labels;
    const issue = await client.request<GitHubJson>("POST", `${basePath}/issues`, {
      body: payload,
      signal,
    });
    return toolResult(renderIssue(issue), {
      action: params.action,
      repo: params.repo,
      issue,
    });
  }

  if (params.action === "update") {
    const number = issueNumber(params.issue_number);
    const payload: GitHubJson = {};
    if (params.title !== undefined) payload.title = params.title;
    if (params.body !== undefined) payload.body = params.body;
    if (params.labels !== undefined) payload.labels = params.labels;
    if (Object.keys(payload).length === 0)
      throw new Error("update requires title, body, or labels");
    const issue = await client.request<GitHubJson>("PATCH", `${basePath}/issues/${number}`, {
      body: payload,
      signal,
    });
    return toolResult(renderIssue(issue), {
      action: params.action,
      repo: params.repo,
      issue,
    });
  }

  if (params.action === "close" || params.action === "reopen") {
    const number = issueNumber(params.issue_number);
    const issue = await client.request<GitHubJson>("PATCH", `${basePath}/issues/${number}`, {
      body: { state: params.action === "close" ? "closed" : "open" },
      signal,
    });
    return toolResult(
      `${params.action === "close" ? "Closed" : "Reopened"} issue #${number}: ${issue.html_url}`,
      {
        action: params.action,
        repo: params.repo,
        issue,
      },
    );
  }

  if (params.action === "comment") {
    const number = issueNumber(params.issue_number);
    const comment = await client.request<GitHubJson>(
      "POST",
      `${basePath}/issues/${number}/comments`,
      {
        body: { body: bodyValue(params.body, "body") },
        signal,
      },
    );
    return toolResult(
      renderMutation(
        `Created issue comment ${comment.id}: ${comment.html_url}`,
        comment.body ?? params.body,
      ),
      {
        action: params.action,
        repo: params.repo,
        comment,
      },
    );
  }

  if (params.action !== "update_comment" && params.action !== "delete_comment") {
    throw new Error(`Unsupported github_issue action: ${String(params.action)}`);
  }
  const commentId = parseNumericRef(params.comment, "issue comment ID", ["issue_comment"]);
  if (params.action === "update_comment") {
    const comment = await client.request<GitHubJson>(
      "PATCH",
      `${basePath}/issues/comments/${commentId}`,
      {
        body: { body: bodyValue(params.body, "body") },
        signal,
      },
    );
    return toolResult(
      renderMutation(
        `Updated issue comment ${comment.id}: ${comment.html_url}`,
        comment.body ?? params.body,
      ),
      {
        action: params.action,
        repo: params.repo,
        comment,
      },
    );
  }

  await client.request("DELETE", `${basePath}/issues/comments/${commentId}`, { signal });
  return toolResult(`Deleted issue comment ${commentId}.`, {
    action: params.action,
    repo: params.repo,
    comment_id: commentId,
    deleted: true,
  });
}

export async function executeCI(
  pi: ExtensionAPI,
  client: GitHubClient,
  params: CIInput,
  signal?: AbortSignal,
  watches?: CiWatchRegistry,
) {
  const basePath = endpoint(params.repo);

  if (params.action === "status") {
    if (params.pr_number !== undefined && params.ref !== undefined) {
      throw new Error("Pass either pr_number or ref for status, not both.");
    }
    if (params.pr_number === undefined && params.ref === undefined) {
      throw new Error("status requires pr_number or ref (branch, tag, or commit SHA).");
    }
    const current =
      params.ref !== undefined
        ? await loadRefChecks(client, params.repo, requireString(params.ref, "ref"), signal)
        : await loadPullChecks(client, params.repo, prNumber(params.pr_number), signal);
    const status =
      params.expected_head_sha && current.head_sha !== params.expected_head_sha
        ? "head_changed"
        : current.snapshot.status;
    return toolResult(`${status}: ${formatChecks(current.snapshot)}\nhead: ${current.head_sha}`, {
      action: params.action,
      repo: params.repo,
      status,
      expected_head_sha: params.expected_head_sha,
      ...current,
    });
  }

  if (params.action === "watch") {
    if (!watches) throw new Error("Background CI watches are unavailable in this context.");
    if (params.pr_number !== undefined && params.ref !== undefined) {
      throw new Error("Pass either pr_number or ref for a watch, not both.");
    }
    if (params.pr_number === undefined && params.ref === undefined) {
      throw new Error("watch requires pr_number or ref (branch, tag, or commit SHA).");
    }
    if (params.pr_number !== undefined) {
      throw new Error(
        "Pull requests are watched automatically on create and participation. Pass ref to watch a commit or branch without a PR.",
      );
    }
    const { job, created } = watches.start({
      repo: params.repo,
      pr_number: params.pr_number !== undefined ? prNumber(params.pr_number) : undefined,
      ref: params.ref !== undefined ? requireString(params.ref, "ref") : undefined,
      expected_head_sha: params.expected_head_sha,
      timeout_ms: (params.timeout_minutes ?? 30) * 60_000,
    });
    const target = `${job.spec.repo} ${job.spec.pr_number !== undefined ? `#${job.spec.pr_number}` : job.spec.ref}`;
    const pin = job.spec.expected_head_sha ? `, pinned to ${job.spec.expected_head_sha}` : "";
    const text = created
      ? [
          `Started background CI watch ${job.id} for ${target}${pin}.`,
          "It polls until checks settle and posts a notice in this conversation. Continue with other work; the notice wakes an idle agent.",
          `Query progress with github_ci action=watches watch_id=${job.id}, or stop it with action=unwatch.`,
        ].join("\n")
      : `CI watch ${job.id} is already running for ${target}${pin}. Use github_ci action=watches watch_id=${job.id} for progress.`;
    return toolResult(text, { action: params.action, repo: params.repo, created, watch: job });
  }

  if (params.action === "watches") {
    if (!watches) throw new Error("Background CI watches are unavailable in this context.");
    if (params.watch_id) {
      const job = watches.get(params.watch_id);
      if (!job) throw new Error(`Unknown CI watch ${params.watch_id}.`);
      return toolResult(formatWatchDetails(job, watches.now()), {
        action: params.action,
        repo: params.repo,
        watch: job,
      });
    }
    const jobs = watches.list();
    const text = jobs.length
      ? ["Background CI watches:", ...jobs.map((job) => formatWatchLine(job, watches.now()))].join(
          "\n",
        )
      : "No background CI watches.";
    return toolResult(text, { action: params.action, repo: params.repo, watches: jobs });
  }

  if (params.action === "unwatch") {
    if (!watches) throw new Error("Background CI watches are unavailable in this context.");
    const id = params.watch_id?.trim();
    if (!id) throw new Error("unwatch requires watch_id.");
    const job = watches.get(id);
    if (!job) throw new Error(`Unknown CI watch ${id}.`);
    if (!watches.cancel(id)) {
      return toolResult(`CI watch ${id} already finished (${job.state}).`, {
        action: params.action,
        repo: params.repo,
        cancelled: false,
        watch: job,
      });
    }
    return toolResult(`Cancelled CI watch ${id}.`, {
      action: params.action,
      repo: params.repo,
      cancelled: true,
      watch: job,
    });
  }

  if (params.action === "runs") {
    const query = new URLSearchParams({ per_page: String(params.limit ?? 20) });
    if (params.branch) query.set("branch", params.branch);
    if (params.status) query.set("status", params.status);
    const data = await client.request<GitHubJson>("GET", `${basePath}/actions/runs?${query}`, {
      signal,
    });
    const runs = data.workflow_runs ?? [];
    const text =
      runs
        .map(
          (run: GitHubJson) =>
            `run ${run.id} [${run.status}${run.conclusion ? `/${run.conclusion}` : ""}] ${run.name}: ${run.display_title} — ${run.html_url}`,
        )
        .join("\n") || "No workflow runs found.";
    return toolResult(text, { action: params.action, repo: params.repo, runs });
  }

  if (params.action !== "run" && params.action !== "failed_logs") {
    throw new Error(`Unsupported github_ci action: ${String(params.action)}`);
  }
  const runId = positiveInteger(params.run_id, "run_id");
  if (params.action === "run") {
    const [run, jobs] = await Promise.all([
      client.request<GitHubJson>("GET", `${basePath}/actions/runs/${runId}`, { signal }),
      paginateObjectItems<GitHubJson>(
        client,
        `${basePath}/actions/runs/${runId}/jobs`,
        "jobs",
        signal,
      ),
    ]);
    const lines = [
      `run ${run.id} [${run.status}${run.conclusion ? `/${run.conclusion}` : ""}] ${run.name}: ${run.display_title}`,
      run.html_url,
      ...jobs.map(
        (job: GitHubJson) =>
          `- job ${job.id} [${job.status}${job.conclusion ? `/${job.conclusion}` : ""}] ${job.name} — ${job.html_url}`,
      ),
    ];
    return toolResult(lines.join("\n"), { action: params.action, repo: params.repo, run, jobs });
  }

  const result = await pi.exec(
    "gh",
    ["run", "view", String(runId), "--repo", params.repo, "--log-failed"],
    { signal, timeout: 120_000 },
  );
  if (result.code !== 0) {
    throw new Error(
      `gh run view --log-failed failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return toolResult(
    result.stdout || "No failed logs returned.",
    {
      action: params.action,
      repo: params.repo,
      run_id: runId,
    },
    "tail",
  );
}

export default function githubExtension(pi: ExtensionAPI) {
  const token = async (signal?: AbortSignal): Promise<string> => {
    const result = await pi.exec("gh", ["auth", "token", "--hostname", "github.com"], {
      signal,
      timeout: 10_000,
    });
    if (result.code !== 0) {
      throw new Error(
        `GitHub authentication failed: ${result.stderr.trim() || `gh auth token exited ${result.code}`}. Run gh auth login --hostname github.com.`,
      );
    }
    return result.stdout.trim();
  };
  const client = new GitHubClient({ token });

  let lastCtx: ExtensionContext | undefined;
  // The user stopped a run. A notice that lands while held is appended for
  // the next prompt instead of starting a run they just cancelled.
  let held = false;

  const notifyUser = (text: string, level: "info" | "warning" | "error") => {
    const ctx = lastCtx;
    if (!ctx?.hasUI) return;
    try {
      ctx.ui.notify(text.split("\n")[0], level);
    } catch {
      // The session is going away; nothing sensible to do with the notice.
    }
  };

  const refreshCiStatus = () => {
    const ctx = lastCtx;
    if (!ctx?.hasUI || ctx.mode !== "tui") return;
    try {
      ctx.ui.setStatus("github-ci", formatWatchStatus(watches.list(), watches.now()));
    } catch {
      // Status rendering is advisory only.
    }
  };

  const deliverNotice = (
    customType: string,
    text: string,
    details: unknown,
    level: "info" | "warning" | "error",
  ) => {
    notifyUser(text, level);
    const message = { customType, content: text, display: true, details };
    try {
      if (held) {
        pi.sendMessage(message, { triggerTurn: false });
        return;
      }
      // Idle: starts a run. Busy: delivered after the current turn, so the
      // notice never cuts into an in-flight tool call.
      pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" });
    } catch (error) {
      notifyUser(
        `github: could not deliver a notice: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  };

  const watches = new CiWatchRegistry({
    load: (spec, signal) =>
      spec.pr_number !== undefined
        ? loadPullChecks(client, spec.repo, spec.pr_number, signal)
        : loadRefChecks(client, spec.repo, spec.ref ?? "", signal),
    deliver: (job: CiWatchJob, text: string) =>
      deliverNotice(
        "github-ci-watch",
        text,
        { watch: job },
        job.state === "failed" ? "warning" : "info",
      ),
    onUpdate: refreshCiStatus,
  });

  const prWatches = new PrWatchRegistry({
    loadActivity: (spec, signal) => loadPrActivity(client, spec.repo, spec.number, signal),
    loadChecks: (repo, head, signal) => loadCommitChecks(client, repo, head, signal),
    deliver: (record, text) =>
      deliverNotice(
        "github-pr-watch",
        text,
        { watch: record },
        text.includes("CI failed") || record.stopped === "error" ? "warning" : "info",
      ),
    persist: (record) => {
      try {
        pi.appendEntry("github-pr-watch", record);
      } catch {
        // Session persistence is best-effort; watching continues without it.
      }
    },
  });

  const appendResultText = (result: { content: unknown[] }, text: string) => {
    const first = result.content[0] as { type?: string; text?: string } | undefined;
    if (first?.type === "text" && typeof first.text === "string") {
      first.text = `${first.text}\n\n${text}`;
    }
    return result;
  };

  const maxId = (items: unknown): number => {
    if (!Array.isArray(items)) return 0;
    let max = 0;
    for (const item of items) {
      const id = Number((item as { id?: unknown } | undefined)?.id);
      if (Number.isSafeInteger(id) && id > max) max = id;
    }
    return max;
  };

  const observePullResult = (
    params: PullRequestInput,
    result: Awaited<ReturnType<typeof executePull>>,
  ) => {
    const details = result.details as Record<string, any>;
    if (params.action === "create_stack") {
      const created = Array.isArray(details.created) ? details.created : [];
      const watched: number[] = [];
      for (const pull of created) {
        if (typeof pull?.number !== "number") continue;
        const start = prWatches.start({
          repo: params.repo,
          number: pull.number,
          title: typeof pull.title === "string" ? pull.title : undefined,
          url: typeof pull.html_url === "string" ? pull.html_url : undefined,
          head_sha: typeof pull.head?.sha === "string" ? pull.head.sha : undefined,
        });
        if (start.created) watched.push(pull.number);
      }
      if (watched.length) {
        appendResultText(
          result,
          `Watching ${watched.map((number) => `#${number}`).join(", ")} for CI and new comments, reviews, or replies.`,
        );
      }
      return result;
    }

    if (params.action === "create") {
      const pull = details.pull ?? {};
      if (typeof pull.number !== "number") return result;
      const start = prWatches.start({
        repo: params.repo,
        number: pull.number,
        title: typeof pull.title === "string" ? pull.title : undefined,
        url: typeof pull.html_url === "string" ? pull.html_url : undefined,
        head_sha: typeof pull.head?.sha === "string" ? pull.head.sha : undefined,
      });
      if (start.created) {
        appendResultText(
          result,
          `Watching #${pull.number} for CI and new comments, reviews, or replies. No polling is needed; a notice arrives when something changes.`,
        );
      }
      return result;
    }

    const number = params.pr_number;
    if (number === undefined) return result;
    if (params.action === "view" || params.action === "inspect") {
      const cursor: PrWatchCursor =
        params.action === "inspect"
          ? {
              comments: maxId(details.conversation),
              reviews: maxId(details.reviews),
              review_comments: maxId(details.reviewComments),
            }
          : {};
      prWatches.rearm({ repo: params.repo, number }, cursor);
      return result;
    }
    if (params.action === "comment") {
      const commentId = details.comment?.id;
      const cursor: PrWatchCursor = typeof commentId === "number" ? { comments: commentId } : {};
      const start = prWatches.touch({ repo: params.repo, number }, cursor);
      if (start.created) {
        appendResultText(result, `Watching #${number} for replies and new feedback.`);
      }
    } else if (params.action === "update") {
      const start = prWatches.touch({ repo: params.repo, number });
      if (start.created) {
        appendResultText(result, `Watching #${number} for CI and new feedback.`);
      }
    }
    return result;
  };

  const observeReviewResult = (
    params: ReviewInput,
    result: Awaited<ReturnType<typeof executeReview>>,
  ) => {
    const details = result.details as Record<string, any>;
    const number = params.pr_number;
    if (number === undefined) return result;
    if (params.action === "list_threads") {
      let max = 0;
      for (const thread of details.threads ?? []) {
        for (const comment of thread.comments ?? []) {
          const id = Number(comment.databaseId);
          if (Number.isSafeInteger(id) && id > max) max = id;
        }
      }
      if (max > 0) prWatches.rearm({ repo: params.repo, number }, { review_comments: max });
      return result;
    }
    let cursor: PrWatchCursor = {};
    if (params.action === "submit" && typeof details.review?.id === "number") {
      cursor = { reviews: details.review.id };
    } else if (
      (params.action === "comment" || params.action === "reply") &&
      typeof details.comment?.id === "number"
    ) {
      cursor = { review_comments: details.comment.id };
    } else if (
      params.action !== "update_review" &&
      params.action !== "update_comment" &&
      params.action !== "delete_comment" &&
      params.action !== "resolve_thread" &&
      params.action !== "unresolve_thread"
    ) {
      return result;
    }
    const start = prWatches.touch({ repo: params.repo, number }, cursor);
    if (params.action === "submit" && typeof details.review?.id === "number") {
      prWatches.markSelfReview(params.repo, number, details.review.id);
    }
    if (start.created) {
      appendResultText(result, `Watching #${number} for replies and new feedback.`);
    }
    return result;
  };

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;
    held = false;
    refreshCiStatus();
    prWatches.restore(prWatchRecords(ctx.sessionManager.getBranch()));
  });
  pi.on("turn_end", (_event, ctx) => {
    lastCtx = ctx;
  });
  pi.on("agent_start", () => {
    held = false;
  });
  pi.on("agent_settled", (event, ctx) => {
    lastCtx = ctx;
    held = event.aborted;
    refreshCiStatus();
  });
  pi.on("session_shutdown", () => {
    watches.close();
    prWatches.close();
    lastCtx = undefined;
  });

  pi.registerTool({
    name: "github_pr",
    label: "GitHub Pull Request",
    description:
      "Inspect and manage pull requests and their top-level conversation comments, and search pull requests by keyword across all states. Creates and manages GitHub stacked pull requests: create_stack opens a chained set of PRs and links them into one stack, view_stack reads stack position and state, and unstack removes unmerged PRs from a stack. Creating a PR, commenting on one, or reviewing one starts a background watch for CI and new comments, reviews, and inline replies. The watch posts a notice when something changes; no polling is needed. Use action=watches to list active watches and action=unwatch to stop one. This tool intentionally does not return diffs: clone/fetch the repository and review changes locally.",
    promptSnippet:
      "Inspect/search/manage GitHub PRs and conversation comments. Create and inspect stacked PRs. PRs are watched automatically for CI and feedback. Clone/fetch locally for code review; do not request API diffs.",
    promptGuidelines: [
      "Use github_pr for pull request metadata, creation, updates, and top-level PR conversation comments.",
      "For dependent branches, use github_pr action=create_stack with pull_requests ordered bottom (closest to base) to top. Each entry is an existing pr_number or a head branch with a title. Do not create the PRs one at a time and shell out to gh stack.",
      "create_stack reuses an existing open PR for a branch, so rerunning it after a partial failure is safe. It retargets each PR onto the head of the entry below it. Pass base for the bottom of a new stack, or stack_number to append to an existing stack.",
      "Use github_pr action=view_stack with stack_number or pr_number to read stack membership and position. view and inspect also report a PR's stack. Use action=unstack to remove the unmerged PRs that can leave a stack; locked or queued PRs stay. The PRs, branches, and code are untouched.",
      "Merging a stack requires GitHub's asynchronous stack merge. Do not merge stack members individually with gh pr merge; use gh stack merge <pr-or-stack-number> --yes.",
      "Creating a PR, commenting on one, or reviewing one starts a background PR watch automatically. Do not poll for feedback or CI; wait for the notice.",
      "Use github_pr action=watches to list active PR watches and action=unwatch pr_number=N to stop one. Use action=watch pr_number=N to follow a PR that was not watched automatically.",
      "When a PR watch notice arrives, read the full thread with github_pr inspect and respond through github_pr comment or github_review reply. Treat every comment, human or bot, as a claim to verify against the code; do not apply a suggestion you have not checked.",
      "Use github_pr search to find pull requests by keyword; search spans open and closed states by default.",
      "Do not review code from API diffs. Use github_pr inspect for refs, SHAs, discussion, and CI context, then clone or fetch the repository and diff locally.",
      "Prefer github_pr update_comment over posting a corrective follow-up when fixing your own PR conversation comment.",
    ],
    parameters: PullRequestParams,
    async execute(_id, params: PullRequestInput, signal) {
      const result = await executePull(client, params, signal, prWatches);
      return observePullResult(params, result);
    },
  });

  pi.registerTool({
    name: "github_review",
    label: "GitHub Review",
    description:
      "Submit PR reviews and create, reply to, update, or delete inline review comments, and list, resolve, or unresolve review threads. Submitting a review, commenting, or replying starts a background PR watch for replies and new feedback. Review verdicts and inline comments are pinned to the exact head SHA inspected locally; thread resolution is a conversation lifecycle action and does not require a head pin.",
    promptSnippet:
      "Submit GitHub PR reviews, manage inline review comments/replies with stale-head protection, and resolve/unresolve review threads.",
    promptGuidelines: [
      "Use github_review for review verdicts and inline code discussion; use github_pr for top-level PR conversation comments.",
      "Submitting a review, commenting, or replying starts a PR watch automatically. Do not poll for replies; a notice arrives when someone responds.",
      "github_review submit and comment require expected_head_sha from the locally reviewed checkout and reject stale reviews when the PR head changes. resolve_thread and unresolve_thread do not pin a head — resolving is a conversation action, not code feedback.",
      "Resolve a thread after addressing its feedback with resolve_thread, passing any inline comment in the thread (comment ID or #discussion_r URL) or the thread node ID from list_threads. Use list_threads to see which threads are still open before resolving. pr_number is optional for resolve_thread/unresolve_thread: omit it with a thread node ID, or omit it when resolving by comment (the PR is looked up automatically).",
      "Prefer github_review update_comment or update_review for corrections and formatting fixes. Reply when the discussion genuinely advances; delete only accidental or misplaced comments.",
    ],
    parameters: ReviewParams,
    async execute(_id, params: ReviewInput, signal) {
      const result = await executeReview(client, params, signal);
      return observeReviewResult(params, result);
    },
  });

  pi.registerTool({
    name: "github_issue",
    label: "GitHub Issue",
    description:
      "Inspect and manage GitHub issues and their comments, including comment editing and deletion, and search issues by keyword. Search matches title, body, and comments via GitHub's issue search and spans open and closed issues by default.",
    promptSnippet: "Inspect/search/manage GitHub issues and issue comments.",
    promptGuidelines: [
      "Use github_issue for issue lifecycle and discussion; use github_pr for pull requests even though GitHub stores PR conversation comments as issue comments internally.",
      "Use github_issue search to find issues by keyword before creating one — duplicates hide in closed issues, and search spans open and closed by default.",
      "Prefer github_issue update_comment over posting a corrective follow-up when fixing your own issue comment.",
    ],
    parameters: IssueParams,
    async execute(_id, params: IssueInput, signal) {
      return executeIssue(client, params, signal);
    },
  });

  pi.registerTool({
    name: "github_ci",
    label: "GitHub CI",
    description:
      "Read commit checks (by PR number or git ref), watch checks in the background, and retrieve GitHub Actions runs and failed logs. Waiting is asynchronous: action=watch returns immediately and posts a completion notice when checks settle. action=status reads one snapshot and never blocks.",
    promptSnippet:
      "Read GitHub CI state, watch checks in the background, and inspect progress or failed workflow logs.",
    promptGuidelines: [
      "PR watches cover CI for pull requests automatically. Use github_ci for one-shot status reads, workflow runs, and failed logs.",
      "Use github_ci action=watch only with ref, for a commit or branch without a PR, or when the user explicitly asks for a CI watch. Never write shell sleep/poll loops.",
      "After starting a github_ci watch, continue with other work or end the turn. The completion notice wakes an idle agent and joins a busy agent after its current turn.",
      "Use github_ci action=watches only for on-demand progress, and action=unwatch to stop a watch. Do not poll watches in a loop.",
      "Use github_ci action=status only for a one-shot snapshot when no waiting is needed.",
      "Pass ref (branch, tag, or SHA) instead of pr_number for checks on commits outside a PR, such as CI on a branch just pushed to.",
      "Pass expected_head_sha when watching reviewed code. If a watch reports head_changed, fetch and inspect the new head before proceeding.",
      "After a watch reports failed checks, use github_ci failed_logs with the returned run ID. Do not rerun workflows automatically.",
    ],
    parameters: CIParams,
    async execute(_id, params: CIInput, signal) {
      return executeCI(pi, client, params, signal, watches);
    },
  });

  pi.registerCommand("pr-watch", {
    description: "Show or stop automatic PR watches: /pr-watch [stop <id...>|stop-all]",
    handler: async (args, ctx) => {
      const text = args.trim();
      if (!text) {
        const lines = prWatches.describe();
        ctx.ui.notify(
          lines.length > 0 ? ["PR watches:", ...lines].join("\n") : "No active PR watches.",
          "info",
        );
        return;
      }
      const [verb, ...ids] = text.split(/\s+/);
      if (verb === "stop-all") {
        const count = prWatches.stopAll();
        ctx.ui.notify(`Stopped ${count} PR watch${count === 1 ? "" : "es"}.`, "info");
        return;
      }
      if (verb === "stop" && ids.length > 0) {
        const count = ids.filter((id) => prWatches.stop(id)).length;
        ctx.ui.notify(`Stopped ${count} PR watch${count === 1 ? "" : "es"}.`, "info");
        return;
      }
      ctx.ui.notify("Usage: /pr-watch [stop <id...>|stop-all]", "warning");
    },
  });

  pi.registerCommand("ci-watch", {
    description: "Show active background CI and PR watches",
    handler: async (_args, ctx) => {
      const sections: string[] = [];
      const background = watches.list();
      if (background.length > 0) {
        sections.push(
          [
            "background CI watches:",
            ...background.map((job) => formatWatchLine(job, watches.now())),
          ].join("\n"),
        );
      }
      const prLines = prWatches.describe();
      if (prLines.length > 0) sections.push(["PR watches:", ...prLines].join("\n"));
      ctx.ui.notify(
        sections.length > 0 ? sections.join("\n\n") : "No active CI or PR watches.",
        "info",
      );
    },
  });
}
