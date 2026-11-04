import assert from "node:assert/strict";
import test from "node:test";

import githubExtension, { executeCI, executeIssue, executePull, executeReview } from "./index.ts";
import {
  GitHubApiError,
  GitHubClient,
  loadPullChecks,
  loadRefChecks,
  normalizeInlineComment,
  parseNumericRef,
  splitRepo,
  summarizeChecks,
  waitForChecks,
  type CheckSnapshot,
  type CIWaitResult,
} from "./core.ts";
import { CiWatchRegistry } from "./jobs.ts";
import {
  PrWatchRegistry,
  loadPrActivity,
  prWatchRecords,
  type PrActivity,
  type PrActivityItem,
  type PrWatchRecord,
} from "./pr-watch.ts";

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

test("github_review resolve_thread by thread node id omits pr_number", async () => {
  const calls: Array<{ method: string; url: string; query?: string; variables?: any }> = [];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input, init) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({
        method,
        url: String(input),
        query: body.query,
        variables: body.variables,
      });
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
    thread: "PRRT_kwDO_AAA",
  });
  assert.match(result.content[0].text, /Resolved thread PRRT_kwDO_AAA/);
  assert.equal(
    calls.length,
    1,
    "thread node id must skip the reviewThreads lookup and need no pr_number",
  );
  assert.match(calls[0].query ?? "", /resolveReviewThread/);
  assert.equal(calls[0].variables.threadId, "PRRT_kwDO_AAA");
});

test("github_review resolve_thread by comment omits pr_number and resolves it via REST", async () => {
  const calls: Array<{ method: string; url: string; query?: string; variables?: any }> = [];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input, init) => {
      const method = init?.method ?? "GET";
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ method, url, query: body.query, variables: body.variables });
      // REST: resolve the PR number from the review comment.
      if (method === "GET" && url.includes("/pulls/comments/555")) {
        return jsonResponse({
          pull_request_url: "https://api.github.com/repos/o/r/pulls/7",
        });
      }
      // GraphQL: load review threads for the resolved PR.
      if (body.query?.includes("reviewThreads")) {
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
      // GraphQL: resolve the thread.
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
    comment: 555,
  });
  assert.match(
    result.content[0].text,
    /Resolved thread PRRT_kwDO_AAA — src\/a\.ts:12 \(was unresolved\)/,
  );
  assert.equal(calls.length, 3, "REST comment lookup + reviewThreads + resolve mutation");
  assert.equal(calls[0].method, "GET");
  assert.match(calls[0].url, /\/pulls\/comments\/555$/);
  assert.match(calls[1].query ?? "", /reviewThreads/);
  assert.equal(calls[1].variables.pr, 7, "PR number resolved from the REST comment lookup");
  assert.match(calls[2].query ?? "", /resolveReviewThread/);
  assert.equal(calls[2].variables.threadId, "PRRT_kwDO_AAA");
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

test("issue search pins repo/type qualifiers, requests text matches, renders fragments", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input, init) => {
      seen = { url: String(input), init };
      return jsonResponse({
        total_count: 2,
        incomplete_results: false,
        items: [
          {
            number: 256,
            title: "Storage: shared-cache env wiring for remaining PMs",
            state: "open",
            html_url: "https://github.com/o/r/issues/256",
            text_matches: [{ property: "body", fragment: "the  shared-cache\nvolume wiring" }],
          },
          {
            number: 255,
            title: "Storage: cache volume + virtiofs export wiring",
            state: "open",
            html_url: "https://github.com/o/r/issues/255",
          },
        ],
      });
    },
  });

  const result = await executeIssue(client, {
    action: "search",
    repo: "o/r",
    query: "cache in:title",
  });

  assert.ok(seen);
  const url = new URL(seen.url);
  assert.equal(url.pathname, "/search/issues");
  assert.equal(url.searchParams.get("q"), "cache in:title repo:o/r is:issue");
  assert.equal(url.searchParams.get("per_page"), "30");
  const headers = seen.init?.headers as Record<string, string>;
  assert.equal(headers.Accept, "application/vnd.github.text-match+json");

  const text = (result.content[0] as any).text;
  assert.match(text, /^2 matches for: cache in:title repo:o\/r is:issue/);
  assert.match(text, /#256 \[open\] Storage: shared-cache env wiring/);
  assert.match(text, /#255 \[open\] Storage: cache volume/);
  // The body fragment renders whitespace-collapsed under its issue.
  assert.match(text, /› the shared-cache volume wiring/);
  const details = result.details as any;
  assert.equal(details.total_count, 2);
  assert.equal(details.items.length, 2);
});

test("issue search defaults to all states, applies state filter, requires query", async () => {
  const seen: string[] = [];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input) => {
      seen.push(String(input));
      return jsonResponse({ total_count: 0, items: [] });
    },
  });

  const empty = await executeIssue(client, { action: "search", repo: "o/r", query: "flaky" });
  assert.equal(new URL(seen[0]).searchParams.get("q"), "flaky repo:o/r is:issue");
  assert.match((empty.content[0] as any).text, /^No matches for: flaky repo:o\/r is:issue$/);

  await executeIssue(client, { action: "search", repo: "o/r", query: "flaky", state: "closed" });
  assert.equal(new URL(seen[1]).searchParams.get("q"), "flaky repo:o/r is:issue state:closed");

  await assert.rejects(
    () => executeIssue(client, { action: "search", repo: "o/r" }),
    /query is required/,
  );
});

test("pull request search pins is:pr and shows draft/closed state", async () => {
  let seenUrl = "";
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input) => {
      seenUrl = String(input);
      return jsonResponse({
        total_count: 1,
        items: [
          {
            number: 42,
            title: "Add search",
            state: "closed",
            draft: false,
            html_url: "https://github.com/o/r/pull/42",
          },
        ],
      });
    },
  });

  const result = await executePull(client, { action: "search", repo: "o/r", query: "search" });
  assert.equal(new URL(seenUrl).searchParams.get("q"), "search repo:o/r is:pr");
  assert.match(
    (result.content[0] as any).text,
    /#42 \[closed\] Add search — https:\/\/github.com\/o\/r\/pull\/42/,
  );
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

test("waitForChecks waits through discovery and returns terminal status", async () => {
  let now = 0;
  let calls = 0;
  const empty: CheckSnapshot = summarizeChecks([], []);
  const pending: CheckSnapshot = summarizeChecks([{ name: "unit", status: "in_progress" }], []);
  const passed: CheckSnapshot = summarizeChecks(
    [{ name: "unit", status: "completed", conclusion: "success" }],
    [],
  );
  const snapshots = [empty, pending, passed];

  const result = await waitForChecks({
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

test("waitForChecks stops when the PR head changes", async () => {
  const result = await waitForChecks({
    load: async () => ({ head_sha: "new", snapshot: summarizeChecks([], []) }),
    expectedHeadSha: "old",
    timeoutMs: 60_000,
  });
  assert.equal(result.status, "head_changed");
  assert.equal(result.head_sha, "new");
  assert.equal(result.expected_head_sha, "old");
});

test("loadRefChecks resolves a branch ref to its commit SHA and loads checks", async () => {
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/commits/trunk")) {
        return jsonResponse({ sha: "abc123" });
      }
      if (url.pathname.endsWith("/commits/abc123/check-runs")) {
        return jsonResponse({
          total_count: 1,
          check_runs: [{ name: "unit", status: "completed", conclusion: "success" }],
        });
      }
      if (url.pathname.endsWith("/commits/abc123/status")) {
        return jsonResponse({ total_count: 0, statuses: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const result = await loadRefChecks(client, "o/r", "trunk");
  assert.equal(result.head_sha, "abc123");
  assert.equal(result.snapshot.status, "passed");
});

test("CI status accepts a git ref instead of a PR number", async () => {
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/commits/trunk")) {
        return jsonResponse({ sha: "abc123" });
      }
      if (url.pathname.endsWith("/commits/abc123/check-runs")) {
        return jsonResponse({
          total_count: 1,
          check_runs: [{ name: "unit", status: "completed", conclusion: "success" }],
        });
      }
      if (url.pathname.endsWith("/commits/abc123/status")) {
        return jsonResponse({ total_count: 0, statuses: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const result = await executeCI({} as any, client, {
    action: "status",
    repo: "o/r",
    ref: "trunk",
  });
  const resultDetails = result.details as any;
  assert.equal(resultDetails.status, "passed");
  assert.equal(resultDetails.head_sha, "abc123");
  assert.match((result.content[0] as any).text, /head: abc123/);
});

test("CI status rejects ambiguous or missing targets", async () => {
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async () => {
      throw new Error("should not call GitHub");
    },
  });

  await assert.rejects(
    executeCI({} as any, client, { action: "status", repo: "o/r", pr_number: 1, ref: "main" }),
    /not both/,
  );
  await assert.rejects(
    executeCI({} as any, client, { action: "status", repo: "o/r" }),
    /requires pr_number or ref/,
  );
});

test("waitForChecks re-resolves refs each poll and stops when the branch moves", async () => {
  let now = 0;
  let resolutions = 0;
  const shas = ["abc", "def"];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/commits/main")) {
        return jsonResponse({ sha: shas[Math.min(resolutions++, 1)] });
      }
      if (url.pathname.endsWith("/check-runs")) {
        return jsonResponse({ total_count: 0, check_runs: [] });
      }
      if (url.pathname.endsWith("/status")) {
        return jsonResponse({ total_count: 0, statuses: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const result = await waitForChecks({
    load: () => loadRefChecks(client, "o/r", "main"),
    expectedHeadSha: "abc",
    timeoutMs: 60_000,
    pollIntervalMs: 10_000,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  assert.equal(result.status, "head_changed");
  assert.equal(result.head_sha, "def");
  assert.equal(resolutions, 2);
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
  assert.deepEqual(commands, ["pr-watch", "ci-watch"]);
});

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

type PendingWait = {
  resolve: (result: CIWaitResult) => void;
  reject: (error: Error) => void;
  progress: (update: { head_sha: string; snapshot: CheckSnapshot; elapsed_ms: number }) => void;
};

type WatchHarness = {
  registry: CiWatchRegistry;
  delivered: Array<{ id: string; text: string }>;
  pending: PendingWait[];
  next: () => PendingWait;
  take: () => PendingWait;
};

function makeWatchHarness(options: { retainFinished?: number } = {}): WatchHarness {
  const delivered: Array<{ id: string; text: string }> = [];
  const pending: PendingWait[] = [];
  let now = 1_000_000;
  const registry = new CiWatchRegistry({
    load: async () => ({ head_sha: "abc1234", snapshot: passedSnapshot }),
    wait(waitOptions) {
      return new Promise<CIWaitResult>((resolve, reject) => {
        pending.push({ resolve, reject, progress: waitOptions.onProgress! });
        waitOptions.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    },
    deliver: (job, text) => delivered.push({ id: job.id, text }),
    now: () => now,
    ...options,
  });
  const next = () => {
    const entry = pending[0];
    if (!entry) throw new Error("no pending wait");
    return entry;
  };
  const take = () => {
    const entry = pending.shift();
    if (!entry) throw new Error("no pending wait");
    return entry;
  };
  return { registry, delivered, pending, next, take };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("ci watch starts in the background and delivers one completion notice", async () => {
  const harness = makeWatchHarness();
  const { job, created } = harness.registry.start({
    repo: "o/r",
    pr_number: 42,
    timeout_ms: 60_000,
  });

  assert.equal(created, true);
  assert.equal(job.id, "ci-1");
  assert.equal(job.state, "pending");
  assert.equal(harness.pending.length, 1, "start returns without waiting for the first poll");

  harness.next().progress({ head_sha: "abc1234", snapshot: pendingSnapshot, elapsed_ms: 1_000 });
  assert.equal(job.snapshot?.status, "pending");
  assert.equal(job.polls, 1);

  harness.take().resolve({
    status: "passed",
    head_sha: "abc1234",
    elapsed_ms: 5_000,
    snapshot: passedSnapshot,
  });
  await tick();
  await tick();

  assert.equal(job.state, "passed");
  assert.equal(harness.delivered.length, 1);
  assert.match(harness.delivered[0].text, /CI passed for o\/r #42 @abc1234/);
  assert.match(harness.delivered[0].text, /\(watch ci-1\)/);
});

test("ci watch reuses an equivalent pending watch instead of polling twice", () => {
  const harness = makeWatchHarness();
  const first = harness.registry.start({ repo: "o/r", pr_number: 42, timeout_ms: 60_000 });
  const second = harness.registry.start({
    repo: "o/r",
    pr_number: 42,
    expected_head_sha: undefined,
    timeout_ms: 10_000,
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.job.id, first.job.id);
  assert.equal(harness.pending.length, 1);
});

test("ci watch failure notice lists failing checks with run ids", async () => {
  const harness = makeWatchHarness();
  harness.registry.start({ repo: "o/r", ref: "fix/flaky", timeout_ms: 60_000 });
  harness.take().resolve({
    status: "failed",
    head_sha: "abc1234",
    elapsed_ms: 2_000,
    snapshot: failedSnapshot,
  });
  await tick();
  await tick();

  assert.equal(harness.delivered.length, 1);
  const text = harness.delivered[0].text;
  assert.match(text, /CI failed for o\/r fix\/flaky @abc1234/);
  assert.match(text, /- unit \[failure\] \(run 123\)/);
  assert.match(text, /github_ci failed_logs run_id=<id>/);
});

test("ci watch cancel stops polling and suppresses the notice", async () => {
  const harness = makeWatchHarness();
  const { job } = harness.registry.start({ repo: "o/r", pr_number: 7, timeout_ms: 60_000 });

  assert.equal(harness.registry.cancel(job.id), true);
  await tick();

  assert.equal(job.state, "cancelled");
  assert.equal(harness.delivered.length, 0);
  assert.equal(harness.registry.cancel(job.id), false, "already finished");
});

test("ci watch close cancels pending jobs without notifying", async () => {
  const harness = makeWatchHarness();
  const { job } = harness.registry.start({ repo: "o/r", pr_number: 7, timeout_ms: 60_000 });

  harness.registry.close();
  harness.take().resolve({
    status: "passed",
    head_sha: "abc1234",
    elapsed_ms: 2_000,
    snapshot: passedSnapshot,
  });
  await tick();
  await tick();

  assert.equal(job.state, "cancelled");
  assert.equal(harness.delivered.length, 0);
  assert.throws(
    () => harness.registry.start({ repo: "o/r", pr_number: 8, timeout_ms: 60_000 }),
    /closed/,
  );
});

test("ci watch retains finished jobs up to the limit", async () => {
  const harness = makeWatchHarness({ retainFinished: 1 });
  for (const pr of [1, 2, 3]) {
    harness.registry.start({ repo: "o/r", pr_number: pr, timeout_ms: 60_000 });
    harness.take().resolve({
      status: "passed",
      head_sha: "abc1234",
      elapsed_ms: 1_000,
      snapshot: passedSnapshot,
    });
    await tick();
    await tick();
  }

  assert.deepEqual(
    harness.registry.list().map((job) => job.id),
    ["ci-3"],
  );
  assert.equal(harness.delivered.length, 3);
});

test("github_ci watch actions start, inspect, and cancel a background watch", async () => {
  const harness = makeWatchHarness();
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async () => {
      throw new Error("watch actions must not block on the network");
    },
  });

  const started = await executeCI(
    {} as any,
    client,
    { action: "watch", repo: "o/r", ref: "fix/flaky", timeout_minutes: 5 },
    undefined,
    harness.registry,
  );
  const startText = (started.content[0] as any).text;
  assert.match(startText, /Started background CI watch ci-1 for o\/r fix\/flaky/);
  assert.equal((started.details as any).created, true);

  harness.next().progress({ head_sha: "abc1234", snapshot: pendingSnapshot, elapsed_ms: 1_000 });
  const listed = await executeCI(
    {} as any,
    client,
    { action: "watches", repo: "o/r" },
    undefined,
    harness.registry,
  );
  assert.match((listed.content[0] as any).text, /ci-1 o\/r fix\/flaky @abc1234: 0\/1 complete/);

  const single = await executeCI(
    {} as any,
    client,
    { action: "watches", repo: "o/r", watch_id: "ci-1" },
    undefined,
    harness.registry,
  );
  assert.match((single.content[0] as any).text, /^watch ci-1 o\/r fix\/flaky @abc1234:/);

  const stopped = await executeCI(
    {} as any,
    client,
    { action: "unwatch", repo: "o/r", watch_id: "ci-1" },
    undefined,
    harness.registry,
  );
  assert.match((stopped.content[0] as any).text, /Cancelled CI watch ci-1/);
  assert.equal((stopped.details as any).cancelled, true);
});

test("github_ci watch requires exactly one target", async () => {
  const harness = makeWatchHarness();
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async () => new Response(),
  });
  await assert.rejects(
    () =>
      executeCI(
        {} as any,
        client,
        { action: "watch", repo: "o/r", pr_number: 1, ref: "main" },
        undefined,
        harness.registry,
      ),
    /not both/,
  );
  await assert.rejects(
    () =>
      executeCI({} as any, client, { action: "watch", repo: "o/r" }, undefined, harness.registry),
    /requires pr_number or ref/,
  );
  await assert.rejects(
    () =>
      executeCI(
        {} as any,
        client,
        { action: "watch", repo: "o/r", pr_number: 42 },
        undefined,
        harness.registry,
      ),
    /watched automatically/,
  );
});

const PR_TEST_NOW = Date.parse("2026-10-28T10:00:00Z");

function prActivity(overrides: Partial<PrActivity> = {}): PrActivity {
  return {
    pull: {
      number: 42,
      title: "Fix retries",
      state: "open",
      merged: false,
      draft: false,
      head_sha: "abc1234",
      url: "https://github.com/o/r/pull/42",
    },
    comments: [],
    reviews: [],
    review_comments: [],
    ...overrides,
  };
}

function prItem(id: number, overrides: Partial<PrActivityItem> = {}): PrActivityItem {
  return {
    id,
    kind: "comment",
    author: "alice",
    author_type: "User",
    body: `body ${id}`,
    url: `https://github.com/o/r/pull/42#issuecomment-${id}`,
    created_at: "2026-10-28T09:59:00Z",
    ...overrides,
  };
}

type PrHarness = {
  registry: PrWatchRegistry;
  delivered: Array<{ id: string; text: string }>;
  persisted: PrWatchRecord[];
  activity: (next: PrActivity) => void;
  checks: (next: CheckSnapshot[]) => void;
  now: () => number;
  advance: (ms: number) => void;
};

function makePrHarness(options: { ttlMs?: number } = {}): PrHarness {
  let now = PR_TEST_NOW;
  let activities: PrActivity[] = [prActivity()];
  let checks: CheckSnapshot[] = [pendingSnapshot];
  const delivered: Array<{ id: string; text: string }> = [];
  const persisted: PrWatchRecord[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const registry = new PrWatchRegistry({
    loadActivity: async () => (activities.length > 1 ? activities.shift()! : activities[0]),
    loadChecks: async () => (checks.length > 1 ? checks.shift()! : checks[0]),
    deliver: (record, text) => delivered.push({ id: record.id, text }),
    persist: (record) => persisted.push(structuredClone(record)),
    now: () => now,
    random: () => 0.5,
    schedule: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    cancel: (handle) => {
      const index = timers.indexOf(handle as (typeof timers)[number]);
      if (index >= 0) timers.splice(index, 1);
    },
    ttlMs: options.ttlMs ?? 7 * 24 * 3_600_000,
    firstPollMs: 1,
  });
  return {
    registry,
    delivered,
    persisted,
    activity: (next) => {
      activities = [next];
    },
    checks: (next) => {
      checks = [...next];
    },
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("pr watch baselines existing feedback and notifies once per new item", async () => {
  const harness = makePrHarness();
  harness.activity(prActivity({ comments: [prItem(10, { body: "old" })] }));
  const { record, created } = harness.registry.start({
    repo: "o/r",
    number: 42,
    head_sha: "abc1234",
  });
  assert.equal(created, true);

  await harness.registry.pollNow("o/r", 42);
  assert.equal(harness.delivered.length, 0, "baseline records cursors without notifying");
  assert.equal(record.cursor.comments, 10);

  harness.activity(
    prActivity({ comments: [prItem(10, { body: "old" }), prItem(11, { body: "new" })] }),
  );
  await harness.registry.pollNow("o/r", 42);
  assert.equal(harness.delivered.length, 1);
  assert.match(harness.delivered[0].text, /1 new item/);
  assert.match(harness.delivered[0].text, /comment 11 alice/);
  assert.match(harness.delivered[0].text, /^  new$/m);
  assert.equal(record.cursor.comments, 11);

  await harness.registry.pollNow("o/r", 42);
  assert.equal(harness.delivered.length, 1, "seen items do not notify twice");
});

test("pr watch surfaces every author, including the user and bots", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline

  harness.activity(
    prActivity({
      comments: [
        prItem(20, { author: "me", body: "my own comment" }),
        prItem(21, { author: "dependabot[bot]", author_type: "Bot", body: "bump" }),
        prItem(22, { author: "alice", body: "real feedback" }),
        prItem(23, { author: "drew-barry[bot]", author_type: "Bot", body: "review bot" }),
      ],
    }),
  );
  await harness.registry.pollNow("o/r", 42);

  assert.equal(harness.delivered.length, 1);
  const text = harness.delivered[0].text;
  assert.match(text, /comment 20 me/);
  assert.match(text, /comment 21 dependabot\[bot\]/);
  assert.match(text, /comment 22 alice/);
  assert.match(text, /comment 23 drew-barry\[bot\]/);
});

test("pr watch suppresses the agent's submitted review and its inline comments", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline
  harness.registry.markSelfReview("o/r", 42, 70);

  harness.activity(
    prActivity({
      reviews: [prItem(70, { kind: "review", author: "me", body: "my review" })],
      review_comments: [
        prItem(71, {
          kind: "review_comment",
          author: "me",
          body: "my inline comment",
          review_id: 70,
        }),
        prItem(72, {
          kind: "review_comment",
          author: "me",
          body: "user reply to the agent",
          review_id: 70,
          in_reply_to_id: 71,
        }),
      ],
    }),
  );
  await harness.registry.pollNow("o/r", 42);

  const text = harness.delivered[0].text;
  assert.doesNotMatch(text, /comment 71 me|my inline comment|review 70/);
  assert.match(text, /comment 72 me/);
  assert.match(text, /user reply to the agent/);
});

test("pr watch surfaces a user review not submitted by the agent", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline

  harness.activity(
    prActivity({
      reviews: [prItem(80, { kind: "review", author: "me", body: "user review" })],
      review_comments: [
        prItem(81, {
          kind: "review_comment",
          author: "me",
          body: "use Steve here",
          review_id: 80,
        }),
      ],
    }),
  );
  await harness.registry.pollNow("o/r", 42);

  const text = harness.delivered[0].text;
  assert.match(text, /review 80/);
  assert.match(text, /comment 81 me/);
  assert.match(text, /use Steve here/);
});

test("pr watch batches a review and its inline comments into one notice", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline

  harness.activity(
    prActivity({
      reviews: [
        prItem(30, {
          kind: "review",
          author: "bob",
          body: "Please fix the retry loop",
          state: "CHANGES_REQUESTED",
          url: "https://github.com/o/r/pull/42#pullrequestreview-30",
        }),
      ],
      review_comments: [
        prItem(31, {
          kind: "review_comment",
          author: "bob",
          body: "This swallows the timeout",
          path: "src/retry.ts",
          line: 42,
          in_reply_to_id: 29,
        }),
      ],
    }),
  );
  await harness.registry.pollNow("o/r", 42);

  assert.equal(harness.delivered.length, 1);
  const text = harness.delivered[0].text;
  assert.match(text, /2 new items/);
  assert.match(text, /review 30 \[changes_requested\] bob/);
  assert.match(text, /comment 31 bob on src\/retry.ts:42 \(reply to 29\)/);
});

test("pr watch announces a CI failure with run ids", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline pending

  harness.checks([failedSnapshot]);
  await harness.registry.pollNow("o/r", 42);

  assert.equal(harness.delivered.length, 1);
  const text = harness.delivered[0].text;
  assert.match(text, /CI failed/);
  assert.match(text, /- unit \[failure\] \(run 123\)/);
  assert.match(text, /github_ci failed_logs/);
});

test("pr watch announces a pass only after seeing the head pending", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline pending

  harness.checks([passedSnapshot]);
  await harness.registry.pollNow("o/r", 42);
  assert.equal(harness.delivered.length, 1);
  assert.match(harness.delivered[0].text, /CI passed/);
});

test("pr watch stops on merge and does not poll again", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline

  harness.activity(prActivity({ pull: { ...prActivity().pull, merged: true, state: "closed" } }));
  await harness.registry.pollNow("o/r", 42);
  assert.equal(harness.delivered.length, 1);
  assert.match(harness.delivered[0].text, /merged. Stopped watching/);

  harness.activity(prActivity({ comments: [prItem(99, { body: "after merge" })] }));
  await harness.registry.pollNow("o/r", 42);
  assert.equal(harness.delivered.length, 1, "a finished watch ignores further polls");
});

test("pr watch reports a moved head and resets CI tracking", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline

  harness.activity(
    prActivity({
      pull: { ...prActivity().pull, head_sha: "def5678" },
      comments: [prItem(40, { body: "pushed a fix" })],
    }),
  );
  await harness.registry.pollNow("o/r", 42);

  assert.equal(harness.delivered.length, 1);
  assert.match(harness.delivered[0].text, /Head moved from abc1234 to def5678/);
});

test("pr watch expires after the TTL", async () => {
  const harness = makePrHarness({ ttlMs: 1_000 });
  const { record } = harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  harness.advance(2_000);
  await harness.registry.pollNow("o/r", 42);

  assert.equal(record.stopped, "expired");
  assert.equal(harness.delivered.length, 1);
  assert.match(harness.delivered[0].text, /expired/);
});

test("pr watch restore catches up from the persisted cursor", async () => {
  const persisted = prWatchRecords([
    {
      type: "custom",
      customType: "github-pr-watch",
      data: {
        id: "pr-7",
        repo: "o/r",
        number: 42,
        started_at: 1_000,
        last_touch_at: 1_000,
        expires_at: Date.now() + 60_000,
        cursor: { comments: 10, reviews: 0, review_comments: 0 },
        head_sha: "abc1234",
        ci: { head_sha: "abc1234", state: "passed" },
      },
    },
  ]);
  assert.equal(persisted.length, 1);

  const harness = makePrHarness();
  harness.activity(prActivity({ comments: [prItem(10), prItem(11, { body: "while away" })] }));
  harness.registry.restore(persisted);
  await harness.registry.pollNow("o/r", 42);

  assert.equal(harness.delivered.length, 1);
  assert.match(harness.delivered[0].text, /comment 11 alice/);
  assert.match(harness.delivered[0].text, /while away/);
});

test("prWatchRecords keeps the latest record per PR and ignores garbage", () => {
  const base = {
    type: "custom" as const,
    customType: "github-pr-watch",
  };
  const records = prWatchRecords([
    {
      ...base,
      data: {
        id: "pr-1",
        repo: "o/r",
        number: 42,
        started_at: 1,
        last_touch_at: 1,
        expires_at: 2,
        cursor: { comments: 1, reviews: 1, review_comments: 1 },
      },
    },
    {
      ...base,
      data: {
        id: "pr-1",
        repo: "o/r",
        number: 42,
        started_at: 1,
        last_touch_at: 2,
        expires_at: 3,
        cursor: { comments: 5, reviews: 2, review_comments: 3 },
      },
    },
    { ...base, data: { id: "bad" } },
    { type: "custom" as const, customType: "other", data: {} },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].cursor.comments, 5);
  assert.equal(records[0].cursor.reviews, 2);
});

test("loadPrActivity requests the newest comments and normalizes review fields", async () => {
  const seen: string[] = [];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input) => {
      const url = new URL(String(input));
      seen.push(url.pathname + url.search);
      if (url.pathname.endsWith("/pulls/42")) {
        return jsonResponse({
          number: 42,
          title: "Fix retries",
          state: "open",
          merged: false,
          draft: false,
          head: { sha: "abc1234" },
          html_url: "https://github.com/o/r/pull/42",
        });
      }
      if (url.pathname.endsWith("/issues/42/comments")) {
        return jsonResponse([
          {
            id: 10,
            user: { login: "alice", type: "User" },
            body: "top level",
            html_url: "https://github.com/o/r/pull/42#issuecomment-10",
            created_at: "2026-10-28T10:00:00Z",
          },
        ]);
      }
      if (url.pathname.endsWith("/pulls/42/comments")) {
        return jsonResponse([
          {
            id: 11,
            user: { login: "bob", type: "User" },
            body: "inline",
            path: "src/retry.ts",
            line: 42,
            in_reply_to_id: 9,
            pull_request_review_id: 12,
            html_url: "https://github.com/o/r/pull/42#discussion_r11",
            created_at: "2026-10-28T10:01:00Z",
          },
        ]);
      }
      if (url.pathname.endsWith("/pulls/42/reviews")) {
        return jsonResponse([
          {
            id: 12,
            user: { login: "carol", type: "User" },
            state: "CHANGES_REQUESTED",
            body: "needs work",
            submitted_at: "2026-10-28T10:02:00Z",
            html_url: "https://github.com/o/r/pull/42#pullrequestreview-12",
          },
          { id: 13, user: { login: "me" }, state: "PENDING", body: "" },
        ]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const activity = await loadPrActivity(client, "o/r", 42);
  assert.equal(activity.comments[0].body, "top level");
  assert.equal(activity.review_comments[0].path, "src/retry.ts");
  assert.equal(activity.review_comments[0].line, 42);
  assert.equal(activity.review_comments[0].in_reply_to_id, 9);
  assert.equal(activity.review_comments[0].review_id, 12);
  assert.equal(activity.reviews.length, 1, "pending reviews are not feedback");
  assert.equal(activity.reviews[0].state, "CHANGES_REQUESTED");
  assert.ok(
    seen.some((url) =>
      url.startsWith("/repos/o/r/issues/42/comments?per_page=100&sort=created&direction=desc"),
    ),
  );
  assert.ok(
    seen.some((url) =>
      url.startsWith("/repos/o/r/pulls/42/comments?per_page=100&sort=created&direction=desc"),
    ),
  );
});

test("pr watch reuses an existing watch instead of polling twice", () => {
  const harness = makePrHarness();
  const first = harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  const second = harness.registry.touch({ repo: "o/r", number: 42 }, { comments: 10 });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.record.id, first.record.id);
  assert.equal(second.record.cursor.comments, 10);
});

test("pr watch does not announce a pass it never saw pending", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  harness.checks([passedSnapshot]);
  await harness.registry.pollNow("o/r", 42); // baseline sees an already-green head
  await harness.registry.pollNow("o/r", 42);
  assert.equal(harness.delivered.length, 0);
});

test("pr watch gives up after repeated poll errors", async () => {
  let attempts = 0;
  const registry = new PrWatchRegistry({
    loadActivity: async () => {
      attempts += 1;
      throw new Error("boom");
    },
    loadChecks: async () => passedSnapshot,
    deliver: () => {},
    persist: () => {},
    now: () => 1_000_000,
    random: () => 0.5,
    schedule: (fn) => {
      // Run retries inline so the test does not depend on fake timers.
      setImmediate(fn);
      return fn;
    },
    cancel: () => {},
    maxConsecutiveErrors: 3,
  });
  registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  for (let index = 0; index < 10 && attempts < 3; index++) {
    await registry.pollNow("o/r", 42);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(attempts, 3);
  registry.close();
});

test("pr watch rearm after inspect suppresses feedback that was already read", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline

  harness.activity(
    prActivity({ comments: [prItem(10, { body: "read it" }), prItem(11, { body: "also read" })] }),
  );
  harness.registry.rearm({ repo: "o/r", number: 42 }, { comments: 11 });
  await harness.registry.pollNow("o/r", 42);

  assert.equal(harness.delivered.length, 0);
});

test("pr watch rearm does not start a watch", () => {
  const harness = makePrHarness();
  assert.equal(harness.registry.rearm({ repo: "o/r", number: 7 }, {}), undefined);
  assert.equal(harness.persisted.length, 0);
});

test("pr watch stop suppresses the notice and stopAll clears active watches", async () => {
  const harness = makePrHarness();
  const first = harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  harness.registry.start({ repo: "o/r", number: 43, head_sha: "def5678" });

  assert.equal(harness.registry.stop(first.record.id), true);
  assert.equal(harness.registry.stop(first.record.id), false);
  assert.equal(harness.registry.stopAll(), 1);
  await harness.registry.pollNow("o/r", 42);
  await harness.registry.pollNow("o/r", 43);
  assert.equal(harness.delivered.length, 0);
});

test("pr watch keeps provenance text and drops only the details wrapper", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline

  harness.activity(
    prActivity({
      reviews: [
        prItem(50, {
          kind: "review",
          author: "drew-barry[bot]",
          author_type: "Bot",
          state: "APPROVED",
          body: "Looks good.\n<details><summary>Provenance: what was reviewed</summary>\n- Verified: noise\n</details>",
        }),
        prItem(51, {
          kind: "review",
          author: "drew-barry[bot]",
          author_type: "Bot",
          state: "APPROVED",
          body: "<details><summary>Provenance: what was reviewed</summary>\n- Verified: only provenance\n</details>",
        }),
      ],
    }),
  );
  await harness.registry.pollNow("o/r", 42);

  const text = harness.delivered[0].text;
  assert.match(text, /review 50 \[approved\] drew-barry\[bot\]/);
  assert.match(text, /^  Looks good\.$/m);
  assert.match(text, /^  Provenance: what was reviewed$/m);
  assert.match(text, /^  - Verified: noise$/m);
  assert.match(text, /^  - Verified: only provenance$/m);
  assert.doesNotMatch(text, /<details>|<\/details>|<summary>/);
});

test("pr watch points at check URLs when a failure has no workflow run id", async () => {
  const noRunSnapshot = summarizeChecks(
    [
      {
        name: "Drew",
        status: "completed",
        conclusion: "failure",
        html_url: "https://github.com/o/r/runs/99",
      },
    ],
    [],
  );
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline pending

  harness.checks([noRunSnapshot]);
  await harness.registry.pollNow("o/r", 42);

  const text = harness.delivered[0].text;
  assert.match(text, /Inspect the failing check URLs above/);
  assert.doesNotMatch(text, /failed_logs run_id/);
});

test("pr watch bounds total excerpt text and points at inspect", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  await harness.registry.pollNow("o/r", 42); // baseline

  const body = `start ${"x".repeat(10_000)} END`;
  harness.activity(
    prActivity({
      reviews: [
        prItem(60, {
          kind: "review",
          author: "alice",
          state: "COMMENTED",
          body,
          url: "https://github.com/o/r/pull/42#pullrequestreview-60",
        }),
      ],
    }),
  );
  await harness.registry.pollNow("o/r", 42);

  const text = harness.delivered[0].text;
  assert.match(text, /Some excerpts are truncated; github_pr inspect has the full text\./);
  assert.match(text, /pullrequestreview-60/);
  assert.doesNotMatch(text, /END/);
  assert.ok(text.length < 8_500, `notice was ${text.length} chars`);
});

test("pr watch lists active watches and stops by PR", async () => {
  const harness = makePrHarness();
  harness.registry.start({ repo: "o/r", number: 42, head_sha: "abc1234" });
  harness.registry.start({ repo: "o/r", number: 43, head_sha: "def5678" });

  assert.deepEqual(
    harness.registry
      .list()
      .map((record) => record.number)
      .sort(),
    [42, 43],
  );
  assert.equal(harness.registry.stopPr("o/r", 42), true);
  assert.equal(harness.registry.stopPr("o/r", 42), false);
  assert.deepEqual(
    harness.registry.list().map((record) => record.number),
    [43],
  );
  assert.equal(harness.registry.stopAll(), 1);
  assert.deepEqual(harness.registry.list(), []);
});

test("github_pr watch actions list, start, and stop PR watches", async () => {
  const harness = makePrHarness();
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async () => {
      throw new Error("watch management must not hit the network");
    },
  });

  const started = await executePull(
    client,
    { action: "watch", repo: "o/r", pr_number: 42 },
    undefined,
    harness.registry,
  );
  assert.match((started.content[0] as any).text, /^Watching #42 for CI and new feedback\.$/);
  assert.equal((started.details as any).created, true);

  const listed = await executePull(
    client,
    { action: "watches", repo: "o/r" },
    undefined,
    harness.registry,
  );
  assert.match((listed.content[0] as any).text, /pr-1 o\/r#42/);
  assert.equal((listed.details as any).watches.length, 1);

  const again = await executePull(
    client,
    { action: "watch", repo: "o/r", pr_number: 42 },
    undefined,
    harness.registry,
  );
  assert.match((again.content[0] as any).text, /^Already watching #42\.$/);
  assert.equal((again.details as any).created, false);

  const stopped = await executePull(
    client,
    { action: "unwatch", repo: "o/r", pr_number: 42 },
    undefined,
    harness.registry,
  );
  assert.match((stopped.content[0] as any).text, /^Cancelled the PR watch for #42\.$/);
  assert.equal((stopped.details as any).cancelled, true);

  const none = await executePull(
    client,
    { action: "unwatch", repo: "o/r", pr_number: 42 },
    undefined,
    harness.registry,
  );
  assert.match((none.content[0] as any).text, /^No active PR watch for #42\.$/);
  assert.equal((none.details as any).cancelled, false);

  const empty = await executePull(
    client,
    { action: "watches", repo: "o/r" },
    undefined,
    harness.registry,
  );
  assert.equal((empty.content[0] as any).text, "No active PR watches.");
});

function pullJson(number: number, head: string, base: string, extra: Record<string, any> = {}) {
  return {
    number,
    title: `PR ${number}`,
    state: "open",
    draft: false,
    html_url: `https://github.com/o/r/pull/${number}`,
    head: { ref: head, sha: `${head}-sha`, label: `o:${head}` },
    base: { ref: base, sha: `${base}-sha` },
    ...extra,
  };
}

function stackJson(number: number, base: string, pulls: Array<Record<string, any>>) {
  return {
    id: number * 10,
    number,
    node_id: `PRS_${number}`,
    url: `https://api.github.com/repos/o/r/stacks/${number}`,
    base: { ref: base },
    open: true,
    created_at: "2026-11-03T00:00:00Z",
    pull_requests: pulls,
  };
}

test("create_stack chains PR bases and creates a GitHub stack", async () => {
  const requests: Array<{
    method: string;
    path: string;
    body?: Record<string, any>;
    apiVersion?: string;
  }> = [];
  const byHead = new Map<string, Record<string, any>>();
  const byNumber = new Map<number, Record<string, any>>();
  let next = 101;
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const headers = init?.headers as Record<string, string>;
      requests.push({
        method,
        path: `${url.pathname}${url.search}`,
        body,
        apiVersion: headers["X-GitHub-Api-Version"],
      });
      if (url.pathname === "/repos/o/r/pulls" && method === "GET") {
        const head = (url.searchParams.get("head") ?? "").replace(/^o:/, "");
        const existing = byHead.get(head);
        return jsonResponse(existing ? [existing] : []);
      }
      if (url.pathname === "/repos/o/r/pulls" && method === "POST") {
        const pull = pullJson(next++, body.head, body.base, {
          title: body.title,
          draft: body.draft ?? false,
        });
        byHead.set(body.head, pull);
        byNumber.set(pull.number, pull);
        return jsonResponse(pull, 201);
      }
      if (url.pathname === "/repos/o/r/stacks" && method === "POST") {
        return jsonResponse(
          stackJson(
            7,
            "main",
            body.pull_requests.map((number: number) => byNumber.get(number)),
          ),
          201,
        );
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
  });

  const result = await executePull(client, {
    action: "create_stack",
    repo: "o/r",
    base: "main",
    pull_requests: [
      { head: "feat-a", title: "Add auth" },
      { head: "feat-b", title: "Add routes", draft: false },
    ],
  });
  const details = result.details as any;

  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.path}`),
    [
      "GET /repos/o/r/pulls?state=open&head=o%3Afeat-a&per_page=10",
      "POST /repos/o/r/pulls",
      "GET /repos/o/r/pulls?state=open&head=o%3Afeat-b&per_page=10",
      "POST /repos/o/r/pulls",
      "POST /repos/o/r/stacks",
    ],
  );
  assert.deepEqual(requests[1].body, { title: "Add auth", head: "feat-a", base: "main" });
  assert.deepEqual(requests[3].body, {
    title: "Add routes",
    head: "feat-b",
    base: "feat-a",
    draft: false,
  });
  assert.deepEqual(requests[4].body, { pull_requests: [101, 102] });
  assert.equal(requests[4].apiVersion, "2026-03-10");
  assert.equal(details.stack.number, 7);
  assert.equal(details.created.length, 2);
  const text = (result.content[0] as any).text;
  assert.match(text, /Stack #7 open on main — 2 pull requests/);
  assert.match(text, /1\. #101 \[open\] Add auth — feat-a — https:\/\/github.com\/o\/r\/pull\/101/);
  assert.match(text, /Created #101, #102/);
});

test("create_stack reuses open PRs and retargets them onto the chain", async () => {
  const requests: Array<{ method: string; path: string; body?: Record<string, any> }> = [];
  const existing = [pullJson(41, "feat-a", "main"), pullJson(42, "feat-b", "main")];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, path: `${url.pathname}${url.search}`, body });
      if (url.pathname === "/repos/o/r/pulls" && method === "GET") {
        const head = (url.searchParams.get("head") ?? "").replace(/^o:/, "");
        return jsonResponse(existing.filter((pull) => pull.head.ref === head));
      }
      if (url.pathname === "/repos/o/r/pulls/42" && method === "PATCH") {
        existing[1] = { ...existing[1], base: { ref: body.base, sha: `${body.base}-sha` } };
        return jsonResponse(existing[1]);
      }
      if (url.pathname === "/repos/o/r/stacks" && method === "POST") {
        return jsonResponse(stackJson(8, "main", existing), 201);
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
  });

  const result = await executePull(client, {
    action: "create_stack",
    repo: "o/r",
    base: "main",
    pull_requests: [
      { head: "feat-a", title: "Add auth" },
      { head: "feat-b", title: "Add routes" },
    ],
  });

  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.path}`),
    [
      "GET /repos/o/r/pulls?state=open&head=o%3Afeat-a&per_page=10",
      "GET /repos/o/r/pulls?state=open&head=o%3Afeat-b&per_page=10",
      "PATCH /repos/o/r/pulls/42",
      "POST /repos/o/r/stacks",
    ],
  );
  assert.deepEqual(requests[2].body, { base: "feat-a" });
  assert.deepEqual(requests[3].body, { pull_requests: [41, 42] });
  const text = (result.content[0] as any).text;
  assert.match(text, /Retargeted #42 base main -> feat-a\./);
  assert.match(text, /#41 \[open\] PR 41/);
});

test("create_stack appends only new entries to an existing stack", async () => {
  const requests: Array<{ method: string; path: string; body?: Record<string, any> }> = [];
  const stackTop = pullJson(41, "feat-a", "main", {
    stack: { number: 7, position: 1, size: 1, base: { ref: "main" } },
  });
  const added = pullJson(42, "feat-b", "feat-a");
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, path: `${url.pathname}${url.search}`, body });
      if (url.pathname === "/repos/o/r/stacks/7" && method === "GET") {
        return jsonResponse(stackJson(7, "main", [stackTop]));
      }
      if (url.pathname === "/repos/o/r/pulls/41" && method === "GET") {
        return jsonResponse(stackTop);
      }
      if (url.pathname === "/repos/o/r/pulls" && method === "GET") {
        return jsonResponse([]);
      }
      if (url.pathname === "/repos/o/r/pulls" && method === "POST") {
        return jsonResponse(added, 201);
      }
      if (url.pathname === "/repos/o/r/stacks/7/add" && method === "POST") {
        return jsonResponse(stackJson(7, "main", [{ ...stackTop, stack: undefined }, added]));
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
  });

  const result = await executePull(client, {
    action: "create_stack",
    repo: "o/r",
    stack_number: 7,
    pull_requests: [{ pr_number: 41 }, { head: "feat-b", title: "Add routes" }],
  });
  const details = result.details as any;

  assert.deepEqual(requests.at(-1), {
    method: "POST",
    path: "/repos/o/r/stacks/7/add",
    body: { pull_requests: [42] },
  });
  assert.equal(details.created.length, 1);
  assert.equal(details.reused.length, 1);
  assert.match((result.content[0] as any).text, /1 pull request was already in the stack\./);
});

test("create_stack appends nothing when every entry is already in the stack", async () => {
  let writes = 0;
  const member = pullJson(41, "feat-a", "main", {
    stack: { number: 7, position: 1, size: 1, base: { ref: "main" } },
  });
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if ((init?.method ?? "GET") !== "GET") writes++;
      if (url.pathname === "/repos/o/r/stacks/7")
        return jsonResponse(stackJson(7, "main", [member]));
      if (url.pathname === "/repos/o/r/pulls/41") return jsonResponse(member);
      throw new Error(`Unexpected ${url}`);
    },
  });

  const result = await executePull(client, {
    action: "create_stack",
    repo: "o/r",
    stack_number: 7,
    pull_requests: [{ pr_number: 41 }],
  });

  assert.equal(writes, 0);
  assert.equal((result.details as any).unchanged, true);
  assert.match((result.content[0] as any).text, /already in stack #7/);
});

test("create_stack refuses to move a PR out of another stack without retargeting it", async () => {
  const methods: string[] = [];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      methods.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/repos/o/r/stacks/7") {
        return jsonResponse(stackJson(7, "main", [pullJson(40, "feat-root", "main")]));
      }
      if (url.pathname === "/repos/o/r/pulls/41") {
        return jsonResponse(
          pullJson(41, "feat-a", "main", {
            stack: { number: 5, position: 1, size: 2, base: { ref: "main" } },
          }),
        );
      }
      throw new Error(`Unexpected ${url}`);
    },
  });

  await assert.rejects(
    () =>
      executePull(client, {
        action: "create_stack",
        repo: "o/r",
        stack_number: 7,
        pull_requests: [{ pr_number: 41 }],
      }),
    /already belongs to stack #5/,
  );
  assert.deepEqual(methods, ["GET /repos/o/r/stacks/7", "GET /repos/o/r/pulls/41"]);
});

test("create_stack refuses a new stack when a reused PR is already stacked", async () => {
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/repos/o/r/pulls") {
        const head = (url.searchParams.get("head") ?? "").replace(/^o:/, "");
        return jsonResponse([
          pullJson(41, head, "main", {
            stack: { number: 5, position: 1, size: 1, base: { ref: "main" } },
          }),
        ]);
      }
      throw new Error(`Unexpected ${url}`);
    },
  });

  await assert.rejects(
    () =>
      executePull(client, {
        action: "create_stack",
        repo: "o/r",
        base: "main",
        pull_requests: [{ head: "feat-a", title: "Add auth" }],
      }),
    /pass stack_number=5/i,
  );
});

test("create_stack defaults the bottom base to the repository default branch", async () => {
  const bases: string[] = [];
  const pull = pullJson(101, "feat-a", "develop");
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (url.pathname === "/repos/o/r" && method === "GET") {
        return jsonResponse({ default_branch: "develop" });
      }
      if (url.pathname === "/repos/o/r/pulls" && method === "GET") return jsonResponse([]);
      if (url.pathname === "/repos/o/r/pulls" && method === "POST") {
        bases.push(JSON.parse(String(init?.body)).base);
        return jsonResponse(pull, 201);
      }
      if (url.pathname === "/repos/o/r/stacks" && method === "POST") {
        return jsonResponse(stackJson(9, "develop", [pull]), 201);
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
  });

  await executePull(client, {
    action: "create_stack",
    repo: "o/r",
    pull_requests: [{ head: "feat-a", title: "Add auth" }],
  });

  assert.deepEqual(bases, ["develop"]);
});

test("view_stack resolves a pull request to its stack and renders positions", async () => {
  const stack = stackJson(7, "main", [
    pullJson(41, "feat-a", "main"),
    pullJson(42, "feat-b", "feat-a", { draft: true }),
  ]);
  const paths: string[] = [];
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input) => {
      const url = new URL(String(input));
      paths.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/repos/o/r/stacks") return jsonResponse([{ number: 7 }]);
      if (url.pathname === "/repos/o/r/stacks/7") return jsonResponse(stack);
      throw new Error(`Unexpected ${url}`);
    },
  });

  const result = await executePull(client, {
    action: "view_stack",
    repo: "o/r",
    pr_number: 42,
  });

  assert.deepEqual(paths, ["/repos/o/r/stacks?pull_request=42", "/repos/o/r/stacks/7"]);
  const text = (result.content[0] as any).text;
  assert.match(text, /1\. #41 \[open\] PR 41 — feat-a/);
  assert.match(text, /2\. #42 \[open, draft\] PR 42 — feat-b/);
});

test("unstack reports a dissolved stack on 204 and keeps PRs", async () => {
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(init?.method, "POST");
      assert.equal(url.pathname, "/repos/o/r/stacks/7/unstack");
      return jsonResponse(null, 204);
    },
  });

  const result = await executePull(client, { action: "unstack", repo: "o/r", stack_number: 7 });
  assert.equal((result.details as any).dissolved, true);
  assert.match((result.content[0] as any).text, /Dissolved stack #7/);
});

test("view and inspect report a pull request's stack position", async () => {
  const pull = pullJson(42, "feat-b", "feat-a", {
    stack: { number: 7, position: 2, size: 2, base: { ref: "main" } },
  });
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async () => jsonResponse(pull),
  });

  const result = await executePull(client, { action: "view", repo: "o/r", pr_number: 42 });
  assert.match((result.content[0] as any).text, /stack #7, position 2 of 2 \(base main\)/);
});

test("GitHubClient honors a per-request API version", async () => {
  let version = "";
  const client = new GitHubClient({
    token: async () => "token",
    fetch: async (_input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      version = headers["X-GitHub-Api-Version"];
      return jsonResponse({});
    },
  });

  await client.request("GET", "/repos/o/r/stacks", { apiVersion: "2026-03-10" });
  assert.equal(version, "2026-03-10");
});
