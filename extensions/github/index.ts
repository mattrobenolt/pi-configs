import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateTail,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  GitHubClient,
  assertPullHead,
  checkProgressText,
  loadPullChecks,
  normalizeInlineComment,
  paginateList,
  paginateObjectItems,
  parseNumericRef,
  positiveInteger,
  requireString,
  splitRepo,
  waitForPullChecks,
  type CheckSnapshot,
  type GitHubJson,
} from "./core.ts";
import { setupCiWatch } from "./watch.ts";

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

const PullRequestParams = Type.Object({
  action: StringEnum(
    [
      "view",
      "inspect",
      "list",
      "create",
      "update",
      "comment",
      "update_comment",
      "delete_comment",
    ] as const,
    { description: "Pull request operation." },
  ),
  repo: RepoParam,
  pr_number: Type.Optional(PositiveIntegerParam("Pull request number.")),
  state: Type.Optional(
    StringEnum(["open", "closed", "all"] as const, {
      description: "State filter for list, or new state for update (open/closed only).",
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
  base: Type.Optional(Type.String({ description: "Base branch for create or update." })),
  head: Type.Optional(Type.String({ description: "Head branch for create." })),
  draft: Type.Optional(Type.Boolean({ description: "Create the pull request as a draft." })),
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
    ["submit", "comment", "reply", "update_review", "update_comment", "delete_comment"] as const,
    { description: "Pull request review operation." },
  ),
  repo: RepoParam,
  pr_number: Type.Optional(PositiveIntegerParam("Pull request number.")),
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
});

type ReviewInput = Static<typeof ReviewParams>;

const IssueParams = Type.Object({
  action: StringEnum(
    [
      "view",
      "list",
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
      description: "Issue state filter for list.",
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
  action: StringEnum(["status", "runs", "run", "failed_logs"] as const, {
    description: "CI/check operation.",
  }),
  repo: RepoParam,
  pr_number: Type.Optional(PositiveIntegerParam("Pull request number for status.")),
  expected_head_sha: Type.Optional(
    Type.String({
      description: "Optional head SHA pin. Waiting stops with head_changed if the PR moves.",
    }),
  ),
  wait: Type.Optional(
    Type.Boolean({ description: "For status, wait until checks finish. Defaults to false." }),
  ),
  timeout_minutes: Type.Optional(
    Type.Integer({
      description: "Maximum wait time. Default 30 minutes; max 120.",
      minimum: 1,
      maximum: 120,
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

function renderChecks(snapshot: CheckSnapshot): string {
  const lines = [
    `CI: ${snapshot.status} — ${snapshot.passed} passed, ${snapshot.failed} failed, ${snapshot.pending} pending`,
  ];
  for (const check of snapshot.checks) {
    lines.push(
      `- [${check.status}] ${check.name}${check.run_id ? ` (run ${check.run_id})` : ""}${check.url ? ` — ${check.url}` : ""}`,
    );
  }
  return lines.join("\n");
}

function renderPull(pull: GitHubJson): string {
  return [
    `#${pull.number} ${pull.title}`,
    `${pull.state}${pull.draft ? " (draft)" : ""} by ${userLogin(pull)} — ${pull.html_url}`,
    `base ${pull.base?.ref}@${pull.base?.sha} <- head ${pull.head?.label ?? pull.head?.ref}@${pull.head?.sha}`,
    `clone: ${pull.base?.repo?.clone_url ?? pull.head?.repo?.clone_url ?? "unknown"}`,
    pull.body ? `\n${pull.body}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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

export async function executePull(
  client: GitHubClient,
  params: PullRequestInput,
  signal?: AbortSignal,
) {
  const basePath = endpoint(params.repo);

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
    const lines = [renderPull(pull), "", renderChecks(checks.snapshot)];
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
  onProgress?: (text: string, details: Record<string, unknown>) => void,
) {
  const basePath = endpoint(params.repo);

  if (params.action === "status") {
    const number = prNumber(params.pr_number);
    if (params.wait) {
      const result = await waitForPullChecks({
        load: () => loadPullChecks(client, params.repo, number, signal),
        expectedHeadSha: params.expected_head_sha,
        timeoutMs: (params.timeout_minutes ?? 30) * 60_000,
        signal,
        onProgress(update) {
          onProgress?.(checkProgressText(update.snapshot, update.elapsed_ms), update);
        },
      });
      return toolResult(
        `${result.status}: ${renderChecks(result.snapshot)}\nhead: ${result.head_sha}${result.expected_head_sha ? ` (expected ${result.expected_head_sha})` : ""}`,
        { action: params.action, repo: params.repo, ...result },
      );
    }

    const current = await loadPullChecks(client, params.repo, number, signal);
    const status =
      params.expected_head_sha && current.head_sha !== params.expected_head_sha
        ? "head_changed"
        : current.snapshot.status;
    return toolResult(`${status}: ${renderChecks(current.snapshot)}\nhead: ${current.head_sha}`, {
      action: params.action,
      repo: params.repo,
      status,
      expected_head_sha: params.expected_head_sha,
      ...current,
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

  pi.registerTool({
    name: "github_pr",
    label: "GitHub Pull Request",
    description:
      "Inspect and manage pull requests and their top-level conversation comments. This tool intentionally does not return diffs: clone/fetch the repository and review changes locally.",
    promptSnippet:
      "Inspect/manage GitHub PR metadata and conversation comments. Clone/fetch locally for code review; do not request API diffs.",
    promptGuidelines: [
      "Use github_pr for pull request metadata, creation, updates, and top-level PR conversation comments.",
      "Do not review code from API diffs. Use github_pr inspect for refs, SHAs, discussion, and CI context, then clone or fetch the repository and diff locally.",
      "Prefer github_pr update_comment over posting a corrective follow-up when fixing your own PR conversation comment.",
    ],
    parameters: PullRequestParams,
    async execute(_id, params: PullRequestInput, signal) {
      return executePull(client, params, signal);
    },
  });

  pi.registerTool({
    name: "github_review",
    label: "GitHub Review",
    description:
      "Submit PR reviews and create, reply to, update, or delete inline review comments. Review writes are pinned to the exact head SHA inspected locally.",
    promptSnippet:
      "Submit GitHub PR reviews and manage inline review comments/replies with stale-head protection.",
    promptGuidelines: [
      "Use github_review for review verdicts and inline code discussion; use github_pr for top-level PR conversation comments.",
      "github_review submit and comment require expected_head_sha from the locally reviewed checkout and reject stale reviews when the PR head changes.",
      "Prefer github_review update_comment or update_review for corrections and formatting fixes. Reply when the discussion genuinely advances; delete only accidental or misplaced comments.",
    ],
    parameters: ReviewParams,
    async execute(_id, params: ReviewInput, signal) {
      return executeReview(client, params, signal);
    },
  });

  pi.registerTool({
    name: "github_issue",
    label: "GitHub Issue",
    description:
      "Inspect and manage GitHub issues and their comments, including comment editing and deletion.",
    promptSnippet: "Inspect/manage GitHub issues and issue comments.",
    promptGuidelines: [
      "Use github_issue for issue lifecycle and discussion; use github_pr for pull requests even though GitHub stores PR conversation comments as issue comments internally.",
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
      "Read PR checks and GitHub Actions runs, wait for checks to finish, and retrieve failed logs. Waiting is cancellable and can be pinned to an expected PR head SHA.",
    promptSnippet: "Read or wait for GitHub CI checks and inspect failed workflow logs.",
    promptGuidelines: [
      "Use github_ci status with wait=true instead of writing shell sleep/poll loops.",
      "Pass expected_head_sha when waiting on reviewed code. If github_ci returns head_changed, fetch and inspect the new head before proceeding.",
      "After github_ci reports failed checks, use github_ci failed_logs with the returned run ID.",
    ],
    parameters: CIParams,
    async execute(_id, params: CIInput, signal, onUpdate) {
      return executeCI(pi, client, params, signal, (text, details) => {
        onUpdate?.({ content: [{ type: "text", text }], details });
      });
    },
  });

  setupCiWatch(pi, client);
}
