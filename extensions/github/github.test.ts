import assert from "node:assert/strict";
import test from "node:test";

import githubExtension, { executeCI, executeIssue, executeReview } from "./index.ts";
import {
  GitHubApiError,
  GitHubClient,
  loadPullChecks,
  normalizeInlineComment,
  parseNumericRef,
  splitRepo,
  summarizeChecks,
  waitForPullChecks,
  type CheckSnapshot,
} from "./core.ts";

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("splitRepo validates and encodes owner/repo", () => {
  assert.deepEqual(splitRepo("planetscale/exosphere-zig"), {
    owner: "planetscale",
    name: "exosphere-zig",
    path: "/repos/planetscale/exosphere-zig",
  });
  assert.throws(() => splitRepo("exosphere-zig"), /expected owner\/repo/);
  assert.throws(() => splitRepo("owner/repo/extra"), /expected owner\/repo/);
});

test("parseNumericRef accepts IDs and GitHub comment URLs", () => {
  assert.equal(parseNumericRef(123, "comment"), 123);
  assert.equal(parseNumericRef("456", "comment"), 456);
  assert.equal(parseNumericRef("https://github.com/o/r/pull/1#discussion_r789", "comment"), 789);
  assert.equal(parseNumericRef("https://github.com/o/r/issues/1#issuecomment-321", "comment"), 321);
  assert.equal(
    parseNumericRef("https://api.github.com/repos/o/r/pulls/comments/654", "comment"),
    654,
  );
  assert.throws(() => parseNumericRef("not-a-comment", "comment"), /Could not parse/);
  assert.throws(
    () =>
      parseNumericRef("https://github.com/o/r/issues/1#issuecomment-321", "inline review comment", [
        "review_comment",
      ]),
    /requires a review_comment URL/,
  );
});

test("normalizeInlineComment fills sides and validates ranges", () => {
  assert.deepEqual(
    normalizeInlineComment({ path: "src/a.ts", line: 12, start_line: 10, body: "Fix this" }),
    {
      path: "src/a.ts",
      line: 12,
      side: "RIGHT",
      start_line: 10,
      start_side: "RIGHT",
      body: "Fix this",
    },
  );
  assert.throws(
    () => normalizeInlineComment({ path: "src/a.ts", line: 10, start_line: 12, body: "bad" }),
    /cannot exceed/,
  );
});

test("GitHubClient sends exact JSON without exposing the token", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new GitHubClient({
    token: async () => "secret-token",
    fetch: async (input, init) => {
      requests.push({ url: String(input), init });
      return jsonResponse({ id: 1 });
    },
  });
  const body = {
    body: "`code` $(echo nope) 'single' \"double\"\nUnicode: λ\n-leading dash",
  };

  await client.request("POST", "/repos/o/r/issues/1/comments", { body });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.github.com/repos/o/r/issues/1/comments");
  assert.equal(requests[0].init?.method, "POST");
  assert.equal(requests[0].init?.body, JSON.stringify(body));
  const headers = requests[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer secret-token");
  assert.equal(headers["User-Agent"], "pi-github-extension/0.1");
  assert.equal(headers["X-GitHub-Api-Version"], "2022-11-28");
});

test("GitHubClient surfaces structured API errors and retry-after", async () => {
  const client = new GitHubClient({
    token: async () => "secret-token",
    fetch: async () =>
      jsonResponse(
        {
          message: "Validation Failed",
          errors: [{ resource: "PullRequestReviewComment", field: "line", code: "invalid" }],
        },
        422,
        { "retry-after": "60" },
      ),
  });

  await assert.rejects(
    () => client.request("POST", "/repos/o/r/pulls/1/comments", { body: { body: "x" } }),
    (error: unknown) => {
      assert.ok(error instanceof GitHubApiError);
      assert.match(error.message, /Validation Failed/);
      assert.match(error.message, /PullRequestReviewComment\/line\/invalid/);
      assert.match(error.message, /Retry-After: 60s/);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    },
  );
});

test("review submit pins the inspected head and preserves markdown", async () => {
  const requests: Array<{ method: string; endpoint: string; body?: unknown }> = [];
  const markdown = "Review with `code`, $(shell), quotes ' \" and\nmultiple lines.";
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input, init) => {
      const endpoint = new URL(String(input)).pathname;
      requests.push({
        method: String(init?.method),
        endpoint,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (init?.method === "GET") {
        return jsonResponse({ number: 7, head: { sha: "abc1234" } });
      }
      return jsonResponse({
        id: 91,
        state: "COMMENTED",
        html_url: "https://github.com/o/r/pull/7#pullrequestreview-91",
      });
    },
  });

  const result = await executeReview(client, {
    action: "submit",
    repo: "o/r",
    pr_number: 7,
    expected_head_sha: "abc1234",
    event: "comment",
    body: markdown,
    comments: [{ path: "src/a.ts", line: 8, side: "RIGHT", body: "Inline `body`" }],
  });

  assert.ok(result.content[0].text.includes(markdown));
  assert.match(result.content[0].text, /Inline `body`/);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], {
    method: "POST",
    endpoint: "/repos/o/r/pulls/7/reviews",
    body: {
      commit_id: "abc1234",
      event: "COMMENT",
      body: markdown,
      comments: [{ path: "src/a.ts", line: 8, side: "RIGHT", body: "Inline `body`" }],
    },
  });
});

test("standalone line comments omit subject_type for GitHub's line-positioning schema", async () => {
  const requests: Array<{ method: string; body?: any }> = [];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (_input, init) => {
      requests.push({
        method: String(init?.method),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (init?.method === "GET") return jsonResponse({ head: { sha: "abc1234" } });
      return jsonResponse({ id: 1, html_url: "https://github.com/o/r/pull/1#discussion_r1" }, 201);
    },
  });

  const result = await executeReview(client, {
    action: "comment",
    repo: "o/r",
    pr_number: 1,
    expected_head_sha: "abc1234",
    path: "src/a.ts",
    subject_type: "line",
    line: 3,
    side: "RIGHT",
    body: "line comment",
  });

  assert.match(result.content[0].text, /line comment/);
  assert.deepEqual(requests[1].body, {
    body: "line comment",
    commit_id: "abc1234",
    path: "src/a.ts",
    line: 3,
    side: "RIGHT",
  });
});

test("review submit rejects a stale head before writing", async () => {
  let postCalls = 0;
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (_input, init) => {
      if (init?.method === "POST") postCalls++;
      return jsonResponse({ number: 7, head: { sha: "new-head" } });
    },
  });

  await assert.rejects(
    () =>
      executeReview(client, {
        action: "submit",
        repo: "o/r",
        pr_number: 7,
        expected_head_sha: "old-head",
        event: "approve",
      }),
    /PR head changed/,
  );
  assert.equal(postCalls, 0);
});

test("summarizeChecks combines check runs and commit statuses", () => {
  const snapshot = summarizeChecks(
    [
      {
        name: "unit",
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/o/r/actions/runs/10/job/11",
      },
      { name: "lint", status: "in_progress" },
      { name: "integration", status: "completed", conclusion: "failure" },
    ],
    [{ context: "deploy", state: "success", target_url: "https://example.com" }],
  );
  assert.deepEqual(
    {
      status: snapshot.status,
      total: snapshot.total,
      completed: snapshot.completed,
      passed: snapshot.passed,
      failed: snapshot.failed,
      pending: snapshot.pending,
    },
    { status: "pending", total: 4, completed: 3, passed: 2, failed: 1, pending: 1 },
  );
  assert.equal(snapshot.checks[0].run_id, 10);
});

test("loadPullChecks paginates before deciding CI status", async () => {
  const pageOne = Array.from({ length: 100 }, (_, index) => ({
    name: `check-${index}`,
    status: "completed",
    conclusion: "success",
  }));
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/pulls/1")) {
        return jsonResponse({ head: { sha: "abc" } });
      }
      if (url.pathname.endsWith("/check-runs")) {
        return url.searchParams.get("page") === "1"
          ? jsonResponse({ total_count: 101, check_runs: pageOne })
          : jsonResponse({
              total_count: 101,
              check_runs: [{ name: "late-failure", status: "completed", conclusion: "failure" }],
            });
      }
      if (url.pathname.endsWith("/status")) {
        return jsonResponse({ total_count: 0, statuses: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const result = await loadPullChecks(client, "o/r", 1);
  assert.equal(result.snapshot.total, 101);
  assert.equal(result.snapshot.status, "failed");
  assert.equal(result.snapshot.failed, 1);
});

test("issue list paginates past pull requests before applying limit", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    number: index + 1,
    title: `PR ${index + 1}`,
    state: "open",
    pull_request: {},
  }));
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input) => {
      const url = new URL(String(input));
      return url.searchParams.get("page") === "1"
        ? jsonResponse(firstPage)
        : jsonResponse([
            {
              number: 101,
              title: "Actual issue",
              state: "open",
              html_url: "https://github.com/o/r/issues/101",
            },
          ]);
    },
  });

  const result = await executeIssue(client, { action: "list", repo: "o/r", limit: 1 });
  const resultDetails = result.details as any;
  assert.equal(resultDetails.issues.length, 1);
  assert.equal(resultDetails.issues[0].number, 101);
});

test("CI run view paginates workflow jobs", async () => {
  const pageOne = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    name: `job-${index + 1}`,
    status: "completed",
    conclusion: "success",
  }));
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/actions/runs/42")) {
        return jsonResponse({
          id: 42,
          name: "matrix",
          display_title: "Matrix run",
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/o/r/actions/runs/42",
        });
      }
      if (url.pathname.endsWith("/actions/runs/42/jobs")) {
        return url.searchParams.get("page") === "1"
          ? jsonResponse({ total_count: 101, jobs: pageOne })
          : jsonResponse({
              total_count: 101,
              jobs: [{ id: 101, name: "late-job", status: "completed", conclusion: "failure" }],
            });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const result = await executeCI({} as any, client, { action: "run", repo: "o/r", run_id: 42 });
  const resultDetails = result.details as any;
  assert.equal(resultDetails.jobs.length, 101);
  assert.equal(resultDetails.jobs[100].name, "late-job");
});

test("waitForPullChecks waits through discovery and returns terminal status", async () => {
  let now = 0;
  let calls = 0;
  const empty: CheckSnapshot = summarizeChecks([], []);
  const pending: CheckSnapshot = summarizeChecks([{ name: "unit", status: "in_progress" }], []);
  const passed: CheckSnapshot = summarizeChecks(
    [{ name: "unit", status: "completed", conclusion: "success" }],
    [],
  );
  const snapshots = [empty, pending, passed];

  const result = await waitForPullChecks({
    load: async () => ({ head_sha: "abc", snapshot: snapshots[Math.min(calls++, 2)] }),
    expectedHeadSha: "abc",
    timeoutMs: 60_000,
    pollIntervalMs: 10_000,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.elapsed_ms, 20_000);
  assert.equal(calls, 3);
});

test("waitForPullChecks stops when the PR head changes", async () => {
  const result = await waitForPullChecks({
    load: async () => ({ head_sha: "new", snapshot: summarizeChecks([], []) }),
    expectedHeadSha: "old",
    timeoutMs: 60_000,
  });
  assert.equal(result.status, "head_changed");
  assert.equal(result.head_sha, "new");
  assert.equal(result.expected_head_sha, "old");
});

test("extension registers four user-facing GitHub tools", () => {
  const names: string[] = [];
  githubExtension({
    registerTool(tool: { name: string }) {
      names.push(tool.name);
    },
  } as any);
  assert.deepEqual(names, ["github_pr", "github_review", "github_issue", "github_ci"]);
});
