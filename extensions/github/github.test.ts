import assert from "node:assert/strict";
import test from "node:test";

import githubExtension, { executeCI, executeIssue, executeReview } from "./index.ts";
import {
  GitHubApiError,
  GitHubClient,
  loadPullChecks,
  normalizeInlineComment,
  parseGitHubRemote,
  parseNumericRef,
  splitRepo,
  summarizeChecks,
  waitForPullChecks,
  type CheckSnapshot,
} from "./core.ts";
import { DEFAULT_CI_WATCH_CONFIG, type CiWatchConfig } from "./config.ts";
import {
  CiWatcher,
  formatFailure,
  makeGitProbe,
  type GitProbe,
  type WatchTarget,
} from "./watch.ts";

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

test("GitHubClient.graphql surfaces GraphQL errors from a 200 body", async () => {
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async () => jsonResponse({ errors: [{ message: "Field 'bogus' doesn't exist" }] }),
  });
  await assert.rejects(
    () => client.graphql("query { bogus }", {}),
    /GitHub GraphQL error: Field 'bogus' doesn't exist/,
  );
});

test("github_review list_threads renders thread node ids and resolution state", async () => {
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async () =>
      jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "PRRT_kwDO_AAA",
                    isResolved: true,
                    isOutdated: false,
                    isCollapsed: false,
                    path: "src/a.ts",
                    line: 12,
                    startLine: 10,
                    diffSide: "RIGHT",
                    comments: {
                      nodes: [
                        {
                          databaseId: 555,
                          id: "PRRC_1",
                          body: "fix this",
                          author: { login: "alice" },
                          createdAt: "x",
                        },
                      ],
                    },
                  },
                  {
                    id: "PRRT_kwDO_BBB",
                    isResolved: false,
                    isOutdated: true,
                    isCollapsed: false,
                    path: "src/b.ts",
                    line: 5,
                    startLine: null,
                    diffSide: "LEFT",
                    comments: {
                      nodes: [
                        {
                          databaseId: 666,
                          id: "PRRC_2",
                          body: "nit",
                          author: { login: "bob" },
                          createdAt: "x",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      }),
  });

  const result = await executeReview(client, { action: "list_threads", repo: "o/r", pr_number: 7 });
  const text = result.content[0].text;
  assert.match(text, /Review threads \(2\):/);
  assert.match(text, /PRRT_kwDO_AAA \[resolved\] src\/a\.ts:10-12 \(RIGHT\)/);
  assert.match(text, /PRRT_kwDO_BBB \[unresolved outdated\] src\/b\.ts:5 \(LEFT\)/);
  assert.match(text, /comment 555 alice: fix this/);
  const details = result.details as any;
  assert.equal(details.threads.length, 2);
  assert.equal(details.threads[0].id, "PRRT_kwDO_AAA");
  assert.equal(details.threads[1].comments[0].databaseId, 666);
});

test("github_review resolve_thread by comment id looks up the thread then mutates", async () => {
  const calls: Array<{ query: string; variables: any }> = [];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ query: body.query, variables: body.variables });
      if (body.query.includes("reviewThreads")) {
        return jsonResponse({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      id: "PRRT_kwDO_AAA",
                      isResolved: false,
                      isOutdated: false,
                      isCollapsed: false,
                      path: "src/a.ts",
                      line: 12,
                      startLine: 10,
                      diffSide: "RIGHT",
                      comments: {
                        nodes: [
                          {
                            databaseId: 555,
                            id: "PRRC_1",
                            body: "fix",
                            author: { login: "alice" },
                            createdAt: "x",
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          resolveReviewThread: {
            thread: {
              id: "PRRT_kwDO_AAA",
              isResolved: true,
              isOutdated: false,
              path: "src/a.ts",
              line: 12,
            },
          },
        },
      });
    },
  });

  const result = await executeReview(client, {
    action: "resolve_thread",
    repo: "o/r",
    pr_number: 7,
    comment: 555,
  });

  assert.match(
    result.content[0].text,
    /Resolved thread PRRT_kwDO_AAA — src\/a\.ts:12 \(was unresolved\)\. isResolved=true/,
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0].query, /reviewThreads/);
  assert.match(calls[1].query, /resolveReviewThread/);
  assert.equal(calls[1].variables.threadId, "PRRT_kwDO_AAA");
});

test("github_review resolve_thread accepts a #discussion_r comment URL", async () => {
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("reviewThreads")) {
        return jsonResponse({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      id: "PRRT_kwDO_AAA",
                      isResolved: false,
                      isOutdated: false,
                      isCollapsed: false,
                      path: "src/a.ts",
                      line: 12,
                      startLine: null,
                      diffSide: "RIGHT",
                      comments: {
                        nodes: [
                          {
                            databaseId: 555,
                            id: "PRRC_1",
                            body: "x",
                            author: { login: "a" },
                            createdAt: "x",
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          resolveReviewThread: {
            thread: {
              id: "PRRT_kwDO_AAA",
              isResolved: true,
              isOutdated: false,
              path: "src/a.ts",
              line: 12,
            },
          },
        },
      });
    },
  });

  const result = await executeReview(client, {
    action: "resolve_thread",
    repo: "o/r",
    pr_number: 7,
    comment: "https://github.com/o/r/pull/7#discussion_r555",
  });
  assert.match(result.content[0].text, /Resolved thread PRRT_kwDO_AAA/);
});

test("github_review resolve_thread by thread node id skips the lookup", async () => {
  const calls: Array<{ query: string; variables: any }> = [];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ query: body.query, variables: body.variables });
      return jsonResponse({
        data: {
          resolveReviewThread: {
            thread: {
              id: "PRRT_kwDO_AAA",
              isResolved: true,
              isOutdated: false,
              path: "src/a.ts",
              line: 12,
            },
          },
        },
      });
    },
  });

  const result = await executeReview(client, {
    action: "resolve_thread",
    repo: "o/r",
    pr_number: 7,
    thread: "PRRT_kwDO_AAA",
  });
  assert.match(result.content[0].text, /Resolved thread PRRT_kwDO_AAA/);
  assert.equal(calls.length, 1, "thread node id must skip the reviewThreads lookup");
  assert.match(calls[0].query, /resolveReviewThread/);
  assert.equal(calls[0].variables.threadId, "PRRT_kwDO_AAA");
});

test("github_review unresolve_thread uses the unresolve mutation", async () => {
  const calls: Array<{ query: string; variables: any }> = [];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ query: body.query, variables: body.variables });
      return jsonResponse({
        data: {
          unresolveReviewThread: {
            thread: {
              id: "PRRT_kwDO_AAA",
              isResolved: false,
              isOutdated: false,
              path: "src/a.ts",
              line: 12,
            },
          },
        },
      });
    },
  });

  const result = await executeReview(client, {
    action: "unresolve_thread",
    repo: "o/r",
    pr_number: 7,
    thread: "PRRT_kwDO_AAA",
  });
  assert.match(result.content[0].text, /Unresolved thread PRRT_kwDO_AAA.*isResolved=false/);
  assert.match(calls[0].query, /unresolveReviewThread/);
});

test("github_review resolve_thread throws when the comment is not in any thread", async () => {
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async () =>
      jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
            },
          },
        },
      }),
  });

  await assert.rejects(
    () =>
      executeReview(client, { action: "resolve_thread", repo: "o/r", pr_number: 7, comment: 999 }),
    /No review thread contains inline comment 999/,
  );
});

test("github_review resolve_thread requires a comment or thread", async () => {
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async () => jsonResponse({ data: {} }),
  });

  await assert.rejects(
    () => executeReview(client, { action: "resolve_thread", repo: "o/r", pr_number: 7 }),
    /inline review comment ID is required/,
  );
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
  const commands: string[] = [];
  githubExtension({
    registerTool(tool: { name: string }) {
      names.push(tool.name);
    },
    registerCommand(name: string) {
      commands.push(name);
    },
    on() {},
  } as any);
  assert.deepEqual(names, ["github_pr", "github_review", "github_issue", "github_ci"]);
  assert.deepEqual(commands, ["ci-watch"]);
});

test("parseGitHubRemote extracts owner/repo from common remote URL forms", () => {
  assert.equal(parseGitHubRemote("git@github.com:planetscale/vitess.git"), "planetscale/vitess");
  assert.equal(parseGitHubRemote("git@github.com:planetscale/vitess"), "planetscale/vitess");
  assert.equal(
    parseGitHubRemote("https://github.com/planetscale/vitess.git"),
    "planetscale/vitess",
  );
  assert.equal(parseGitHubRemote("https://github.com/planetscale/vitess"), "planetscale/vitess");
  assert.equal(
    parseGitHubRemote("ssh://git@github.com/planetscale/vitess.git"),
    "planetscale/vitess",
  );
  assert.equal(parseGitHubRemote("https://gitlab.com/planetscale/vitess.git"), undefined);
  assert.equal(parseGitHubRemote("not a url"), undefined);
});

type WatcherHarness = {
  watcher: CiWatcher;
  reported: string[];
  informed: string[];
  notices: string[];
  timers: Array<{ ms: number }>;
  advance: (ms: number) => void;
};

function makeWatcher(
  probe: GitProbe,
  snapshots: CheckSnapshot[],
  config: Partial<CiWatchConfig> = {},
): WatcherHarness {
  const reported: string[] = [];
  const informed: string[] = [];
  const notices: string[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let now = 1_000_000;
  const watcher = new CiWatcher(
    { ...DEFAULT_CI_WATCH_CONFIG, ...config },
    {
      probeGit: async () => probe,
      loadChecks: async () => {
        const next = snapshots.shift();
        if (!next) throw new Error("script ran out of snapshots");
        return next;
      },
      report: (text) => reported.push(text),
      inform: (text) => informed.push(text),
      notify: (text) => notices.push(text),
      schedule: (fn, ms) => {
        const timer = { fn, ms };
        timers.push(timer);
        return timer;
      },
      cancel: (handle) => {
        const index = timers.indexOf(handle as (typeof timers)[number]);
        if (index >= 0) timers.splice(index, 1);
      },
      now: () => now,
    },
  );
  return { watcher, reported, informed, notices, timers, advance: (ms) => (now += ms) };
}

const pushedProbe: GitProbe = {
  headSha: "deadbeefcafe",
  branch: "main",
  upstreamRef: "origin/main",
  upstreamSha: "deadbeefcafe",
  repo: "owner/repo",
};

const pendingSnapshot: CheckSnapshot = summarizeChecks(
  [{ name: "unit", status: "in_progress" }],
  [],
);
const failedSnapshot: CheckSnapshot = summarizeChecks(
  [
    {
      name: "unit",
      status: "completed",
      conclusion: "failure",
      html_url: "https://github.com/owner/repo/actions/runs/123/job/1",
    },
  ],
  [],
);
const passedSnapshot: CheckSnapshot = summarizeChecks(
  [{ name: "unit", status: "completed", conclusion: "success" }],
  [],
);

test("ci watcher reports a failure seen in transition exactly once", async () => {
  const harness = makeWatcher(pushedProbe, [pendingSnapshot, failedSnapshot]);
  await harness.watcher.refresh();
  assert.match(harness.watcher.status, /watching owner\/repo@deadbee/);

  await harness.watcher.pollNow();
  assert.equal(harness.reported.length, 0);
  assert.equal(harness.timers.length, 1, "pending checks keep the poll timer alive");

  await harness.watcher.pollNow();
  assert.equal(harness.reported.length, 1);
  assert.match(harness.reported[0], /CI failed for owner\/repo @ deadbee \(main\)/);
  assert.match(harness.reported[0], /run 123/);
  assert.equal(harness.informed.length, 0);
  assert.equal(harness.timers.length, 0, "terminal failure stops polling");

  // A repeat refresh for the same sha must not re-arm the watcher.
  await harness.watcher.refresh();
  assert.match(harness.watcher.status, /idle/);
  assert.equal(harness.timers.length, 0);
});

test("ci watcher only informs when the first observation is already failed", async () => {
  const harness = makeWatcher(pushedProbe, [failedSnapshot]);
  await harness.watcher.refresh();
  await harness.watcher.pollNow();
  assert.equal(harness.reported.length, 0, "pre-broken heads never steer or wake the agent");
  assert.equal(harness.informed.length, 1);
  assert.match(harness.informed[0], /CI failed for owner\/repo @ deadbee/);
});

test("ci watcher goes quiet when checks pass", async () => {
  const harness = makeWatcher(pushedProbe, [pendingSnapshot, passedSnapshot]);
  await harness.watcher.refresh();
  await harness.watcher.pollNow();
  await harness.watcher.pollNow();
  assert.equal(harness.reported.length, 0);
  assert.equal(harness.informed.length, 0);
  assert.match(harness.watcher.status, /idle/);
});

test("ci watcher ignores unpushed and non-GitHub heads", async () => {
  const unpushed = makeWatcher({ ...pushedProbe, upstreamSha: "elsewhere" }, [failedSnapshot]);
  await unpushed.watcher.refresh();
  assert.match(unpushed.watcher.status, /idle/);
  assert.equal(unpushed.timers.length, 0);

  const noRemote = makeWatcher({ headSha: "deadbeefcafe", branch: "main" }, [failedSnapshot]);
  await noRemote.watcher.refresh();
  assert.match(noRemote.watcher.status, /idle/);
  assert.equal(noRemote.timers.length, 0);
});

test("ci watcher drops heads whose checks never register", async () => {
  const noChecks = summarizeChecks([], []);
  const harness = makeWatcher(pushedProbe, [noChecks, noChecks], { discoveryGraceSeconds: 90 });
  await harness.watcher.refresh();
  await harness.watcher.pollNow();
  assert.equal(harness.timers.length, 1, "still waiting for checks to register");

  harness.advance(120_000);
  await harness.watcher.pollNow();
  assert.equal(harness.reported.length, 0);
  assert.match(harness.watcher.status, /idle/);
  assert.equal(harness.timers.length, 0);
});

test("ci watcher notifies and gives up after repeated poll errors", async () => {
  const harness = makeWatcher(pushedProbe, [], { pollSeconds: 30 });
  await harness.watcher.refresh();
  for (let attempt = 0; attempt < 5; attempt++) {
    await harness.watcher.pollNow();
  }
  assert.equal(harness.notices.length, 1);
  assert.match(harness.notices[0], /stopped watching deadbee/);
  assert.match(harness.watcher.status, /idle/);
});

test("makeGitProbe resolves the pushed head from the upstream remote", async () => {
  const commands: string[] = [];
  const probe = makeGitProbe(async (command, args) => {
    commands.push(`${command} ${args.join(" ")}`);
    const key = args.join(" ");
    if (key === "rev-parse HEAD") return { stdout: "deadbeefcafe\n", stderr: "", code: 0 };
    if (key === "symbolic-ref --quiet --short HEAD")
      return { stdout: "main\n", stderr: "", code: 0 };
    if (key === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}")
      return { stdout: "origin/main\n", stderr: "", code: 0 };
    if (key === "rev-parse @{upstream}") return { stdout: "deadbeefcafe\n", stderr: "", code: 0 };
    if (key === "remote get-url origin")
      return { stdout: "git@github.com:owner/repo.git\n", stderr: "", code: 0 };
    return { stdout: "", stderr: "unexpected", code: 1 };
  });
  assert.deepEqual(await probe(), pushedProbe);
});

test("makeGitProbe stays dormant outside a git repo", async () => {
  const probe = makeGitProbe(async () => ({ stdout: "", stderr: "fatal", code: 128 }));
  assert.deepEqual(await probe(), {});
});

test("formatFailure lists only the failing checks with run ids", () => {
  const target: WatchTarget = {
    repo: "owner/repo",
    sha: "deadbeefcafe",
    branch: "main",
    startedAt: 0,
    sawActivity: true,
  };
  const snapshot = summarizeChecks(
    [
      {
        name: "unit",
        status: "completed",
        conclusion: "failure",
        html_url: "https://github.com/owner/repo/actions/runs/123/job/1",
      },
      { name: "lint", status: "completed", conclusion: "success" },
    ],
    [],
  );
  const text = formatFailure(target, snapshot);
  assert.match(text, /unit \[failure\] \(run 123\)/);
  assert.doesNotMatch(text, /lint \[/);
  assert.match(text, /github_ci failed_logs/);
  assert.doesNotMatch(text, /resume the task/);
});

test("formatFailure includes resume instruction when resumeAfterFix is set", () => {
  const target: WatchTarget = {
    repo: "owner/repo",
    sha: "deadbeefcafe",
    branch: "main",
    startedAt: 0,
    sawActivity: true,
  };
  const snapshot = summarizeChecks(
    [{ name: "unit", status: "completed", conclusion: "failure", run_id: 123 }],
    [],
  );
  const text = formatFailure(target, snapshot, { resumeAfterFix: true });
  assert.match(text, /resume the task you were working on/);
});

test("ci watcher includes resume instruction in steer path only", async () => {
  const harness = makeWatcher(pushedProbe, [pendingSnapshot, failedSnapshot], {
    resumeAfterFix: true,
  });
  await harness.watcher.refresh();
  await harness.watcher.pollNow(); // pending
  await harness.watcher.pollNow(); // failed → report (steer path)
  assert.equal(harness.reported.length, 1);
  assert.match(harness.reported[0], /resume the task you were working on/);
  assert.equal(harness.informed.length, 0);
});

test("ci watcher omits resume instruction when resumeAfterFix is false", async () => {
  const harness = makeWatcher(pushedProbe, [pendingSnapshot, failedSnapshot], {
    resumeAfterFix: false,
  });
  await harness.watcher.refresh();
  await harness.watcher.pollNow(); // pending
  await harness.watcher.pollNow(); // failed → report (steer path)
  assert.equal(harness.reported.length, 1);
  assert.doesNotMatch(harness.reported[0], /resume the task/);
});

test("ci watcher never includes resume instruction in inform path", async () => {
  const harness = makeWatcher(pushedProbe, [failedSnapshot], { resumeAfterFix: true });
  await harness.watcher.refresh();
  await harness.watcher.pollNow(); // already failed → inform path
  assert.equal(harness.informed.length, 1);
  assert.doesNotMatch(harness.informed[0], /resume the task/);
});
