import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { Check } from "typebox/value";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import term from "./index.ts";
import {
  checkAbort,
  commandCompletion,
  commandOutput,
  delay,
  outputMatcher,
  parsePanes,
  shellQuote,
  type PaneInfo,
} from "./core.ts";

type Definition = Parameters<ExtensionAPI["registerTool"]>[0];
type ExecResult = Awaited<ReturnType<ExtensionAPI["exec"]>>;
type Data = {
  outcome: string;
  output: string;
  message: string;
  conditionMet?: boolean;
  exitStatus?: number | null;
  runId?: string;
  matchedLine?: string;
  matchLine?: number;
  fullOutputPath?: string;
  truncated: boolean;
  terminals?: { name: string; status: string }[];
};
const ok = (stdout = "", stderr = ""): ExecResult => ({ stdout, stderr, code: 0, killed: false });

function harness(t: TestContext) {
  let tool: Definition;
  const events = new Map<string, () => Promise<void>>();
  const panes = new Map<number, PaneInfo>();
  const output = new Map<number, string>();
  const calls: { command: string; args: string[] }[] = [];
  const updates: string[] = [];
  const listResponses: ExecResult[] = [];
  const mutationResponses: ExecResult[] = [];
  let nextId = 0;
  let onInput: ((text: string, id: number) => void) | undefined;
  let queryHook: (() => void) | undefined;
  let queryDelay = 0;
  let missingDumpFiles = 0;
  const api = {
    on(name: string, handler: () => Promise<void>) {
      events.set(name, handler);
    },
    registerTool(definition: Definition) {
      tool = definition;
    },
    async exec(command: string, args: string[]): Promise<ExecResult> {
      calls.push({ command, args });
      if (command !== "zellij") return ok();
      const action = args[args.indexOf("action") + 1];
      if (args[0] === "kill-session") {
        panes.clear();
        output.clear();
        return ok();
      }
      if (args[0] === "attach" || args[0] === "delete-session") return ok();
      if (action === "list-panes") {
        if (queryDelay) await delay(queryDelay);
        queryHook?.();
        return listResponses.shift() ?? ok(JSON.stringify([...panes.values()]));
      }
      const paneArg = args[args.indexOf("--pane-id") + 1];
      const id = Number(paneArg?.replace("terminal_", ""));
      if (action === "new-pane") {
        const created = nextId++;
        const title = args[args.indexOf("--name") + 1];
        panes.set(created, {
          id: created,
          title,
          is_plugin: false,
          exited: false,
          exit_status: null,
          pane_columns: 160,
          pane_rows: 60,
        });
        output.set(created, "");
        return mutationResponses.shift() ?? ok(`terminal_${created}\n`);
      }
      if (action === "dump-screen") {
        if (missingDumpFiles > 0) {
          missingDumpFiles--;
          return ok();
        }
        const target = args[args.indexOf("--path") + 1];
        await fs.writeFile(target, output.get(id) ?? "");
        return ok();
      }
      if (action === "close-pane") {
        panes.delete(id);
        return ok();
      }
      if (action === "paste" || action === "write-chars") {
        const text = args.at(-1)!;
        await onInput?.(text, id);
        return ok();
      }
      return ok();
    },
  };
  term(api as unknown as ExtensionAPI);
  t.after(async () => {
    await events.get("session_shutdown")?.();
  });
  async function call(args: Record<string, unknown>, signal?: AbortSignal) {
    const result = await tool!.execute(
      "test",
      args,
      signal,
      (update) => {
        for (const block of update.content) if (block.type === "text") updates.push(block.text);
      },
      { cwd: process.cwd() } as ExtensionToolContext,
    );
    // Reject undefined fields rather than hide them through JSON serialization.
    const inspect = (value: unknown): void => {
      assert.notEqual(value, undefined);
      if (Array.isArray(value)) value.forEach(inspect);
      else if (value && typeof value === "object") Object.values(value).forEach(inspect);
    };
    inspect(result.structuredContent);
    assert.ok(Check(tool!.outputSchema!, result.structuredContent));
    return { ...result, data: result.structuredContent as Data };
  }
  async function ensure(name = "test", command?: string[]) {
    const result = await call({ action: "ensure", name, ...(command ? { command } : {}) });
    const pane = [...panes.values()].find((pane) => pane.title === name)!;
    return { result, id: pane.id };
  }
  return {
    call,
    ensure,
    panes,
    output,
    calls,
    updates,
    listResponses,
    mutationResponses,
    setInput(handler: typeof onInput) {
      onInput = handler;
    },
    setQueryHook(handler: typeof queryHook) {
      queryHook = handler;
    },
    setQueryDelay(ms: number) {
      queryDelay = ms;
    },
    skipDumpFiles(count: number) {
      missingDumpFiles = count;
    },
    async startSession() {
      await events.get("session_start")?.();
    },
  };
}

test("pane JSON rejects empty, non-JSON, objects, and invalid pane fields", () => {
  for (const value of [
    "",
    "\u001b[32mwrong",
    "{}",
    "[{}]",
    '[{"id":0,"is_plugin":false,"exited":"yes"}]',
  ])
    assert.throws(() => parsePanes(value));
  assert.deepEqual(parsePanes('[{"id":0,"is_plugin":false,"exited":false}]'), [
    { id: 0, is_plugin: false, exited: false },
  ]);
});

test("literal matches punctuation and regex is explicit", () => {
  assert.equal(
    outputMatcher("Build (done)", "literal")("Build (done)")?.matchedLine,
    "Build (done)",
  );
  assert.equal(outputMatcher("^Build (done)$", "regex")("Build (done)"), null);
  assert.equal(outputMatcher("^READY$", "regex")("old\nREADY\nnew")?.matchLine, 2);
  assert.throws(() => outputMatcher("[", "regex"), /Invalid regex/);
  assert.throws(() => outputMatcher("", "literal"), /nonempty/);
});

test("shell quoting protects quotes, multiline text, and substitutions", () => {
  assert.equal(shellQuote("a'b\n$HOME"), "'a'\\''b\n$HOME'");
});

test("read-only queries recover empty and false session-not-found responses", async (t) => {
  const h = harness(t);
  h.listResponses.push(
    ok(""),
    ok(
      "\u001b[32mactive sessions",
      "Session 'fake' not found. The following sessions are active:\n",
    ),
  );
  const { result } = await h.ensure();
  assert.equal(result.data.outcome, "created");
  assert.equal(h.calls.filter((c) => c.args.includes("list-panes")).length, 3);
  assert.equal(h.calls.filter((c) => c.args.includes("new-pane")).length, 1);
});

test("exhausted queries preserve stderr and explain the read boundary", async (t) => {
  const h = harness(t);
  h.listResponses.push(...Array.from({ length: 3 }, () => ok("not-json", "backend diagnostic")));
  await assert.rejects(h.ensure(), /3 read attempts[\s\S]*backend diagnostic/);
  assert.equal(h.calls.filter((c) => c.args.includes("new-pane")).length, 0);
});

test("direct creation IDs need no post-creation query", async (t) => {
  const h = harness(t);
  await h.ensure();
  assert.equal(h.calls.filter((c) => c.args.includes("list-panes")).length, 1);
});

test("ambiguous creation is adopted instead of repeated", async (t) => {
  const h = harness(t);
  h.mutationResponses.push(ok(""));
  const { result } = await h.ensure();
  assert.equal(result.data.outcome, "created");
  await h.ensure();
  assert.equal(h.calls.filter((c) => c.args.includes("new-pane")).length, 1);
});

test("failed post-creation reads preserve an adoption receipt", async (t) => {
  const h = harness(t);
  h.mutationResponses.push(ok(""));
  let calls = 0;
  h.setQueryHook(() => {
    calls++;
    if (calls === 2) h.listResponses.push(ok(""), ok(""), ok(""));
  });
  await assert.rejects(h.ensure(), /3 read attempts/);
  h.setQueryHook(undefined);
  await h.ensure();
  assert.equal(h.calls.filter((c) => c.args.includes("new-pane")).length, 1);
});

test("concurrent ensure calls create one pane", async (t) => {
  const h = harness(t);
  const results = await Promise.all([h.ensure("same"), h.ensure("same")]);
  assert.deepEqual(
    results.map((x) => x.result.data.outcome),
    ["created", "existing"],
  );
  assert.equal(h.calls.filter((c) => c.args.includes("new-pane")).length, 1);
});

test("pattern alone selects an output wait", async (t) => {
  const h = harness(t);
  const { id } = await h.ensure();
  h.output.set(id, "READY (done)\n");
  const result = await h.call({ action: "wait", name: "test", pattern: "READY (done)" });
  assert.equal(result.data.outcome, "matched");
  assert.equal(result.data.conditionMet, true);
});

test("conflicting wait conditions and invalid regex fail without a query", async (t) => {
  const h = harness(t);
  await h.ensure();
  const before = h.calls.length;
  await assert.rejects(
    h.call({ action: "wait", name: "test", waitFor: "exit", pattern: "READY" }),
    /pattern requires/,
  );
  await assert.rejects(
    h.call({ action: "wait", name: "test", pattern: "[", matchMode: "regex" }),
    /Invalid regex/,
  );
  await assert.rejects(
    h.call({ action: "wait", name: "test", waitFor: "output" }),
    /require a pattern/,
  );
  assert.equal(h.calls.length, before);
});

test("a match outside the output tail remains visible as evidence", async (t) => {
  const h = harness(t);
  const { id } = await h.ensure();
  h.output.set(id, `READY\n${Array.from({ length: 100 }, (_, i) => `NOISE_${i}`).join("\n")}\n`);
  const result = await h.call({ action: "wait", name: "test", pattern: "READY", tail: 2 });
  assert.equal(result.data.matchedLine, "READY");
  assert.equal(result.data.matchLine, 1);
  assert.match(
    result.content[0].type === "text" ? result.content[0].text : "",
    /Matched line 1: "READY"/,
  );
  assert.doesNotMatch(result.data.output, /READY/);
});

test("zero exit without a pattern match is not success", async (t) => {
  const h = harness(t);
  const { id } = await h.ensure("test", ["program"]);
  h.panes.get(id)!.exited = true;
  h.panes.get(id)!.exit_status = 0;
  h.output.set(id, "OTHER\n");
  const result = await h.call({ action: "wait", name: "test", pattern: "READY" });
  assert.equal(result.data.outcome, "exited_without_match");
  assert.equal(result.data.conditionMet, false);
  assert.equal(result.isError, true);
});

test("command exit preserves nonzero status", async (t) => {
  const h = harness(t);
  const { id } = await h.ensure("test", ["program"]);
  Object.assign(h.panes.get(id)!, { exited: true, exit_status: 23 });
  const result = await h.call({ action: "wait", name: "test" });
  assert.equal(result.data.outcome, "exited");
  assert.equal(result.data.exitStatus, 23);
  assert.equal(result.data.conditionMet, true);
});

test("default waits on untracked shells fail immediately with run guidance", async (t) => {
  const h = harness(t);
  await h.ensure();
  await assert.rejects(h.call({ action: "wait", name: "test" }), /Use run/);
});

test("deadlines cap long poll sleeps and return a resumable outcome", async (t) => {
  const h = harness(t);
  await h.ensure("test", ["program"]);
  const start = Date.now();
  const result = await h.call({ action: "wait", name: "test", timeoutMs: 40, pollMs: 2000 });
  assert.equal(result.data.outcome, "timed_out");
  assert.equal(result.data.conditionMet, false);
  assert.ok(Date.now() - start < 400);
  assert.equal(h.panes.size, 1);
});

test("wait deadlines include retry backoff", async (t) => {
  const h = harness(t);
  await h.ensure("test", ["program"]);
  h.listResponses.push(ok(""), ok(""), ok(""));
  const start = Date.now();
  const result = await h.call({ action: "wait", name: "test", timeoutMs: 30 });
  assert.equal(result.data.outcome, "timed_out");
  assert.ok(Date.now() - start < 300);
});

test("cancellation interrupts a long wait sleep", async (t) => {
  const h = harness(t);
  await h.ensure("test", ["program"]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20);
  const start = Date.now();
  await assert.rejects(
    h.call({ action: "wait", name: "test", timeoutMs: 5000, pollMs: 2000 }, controller.signal),
    /cancelled/,
  );
  clearTimeout(timer);
  assert.ok(Date.now() - start < 400);
  assert.throws(() => checkAbort(controller.signal), /cancelled/);
});

test("missing panes are explicit and ensure recreates them", async (t) => {
  const h = harness(t);
  const { id } = await h.ensure();
  h.panes.delete(id);
  const listed = await h.call({ action: "list" });
  assert.equal(listed.data.terminals?.[0].status, "missing");
  const read = await h.call({ action: "read", name: "test" });
  assert.equal(read.data.outcome, "missing");
  await h.ensure();
  assert.equal(h.calls.filter((c) => c.args.includes("new-pane")).length, 2);
});

test("kill is idempotent", async (t) => {
  const h = harness(t);
  await h.ensure();
  await h.call({ action: "kill", name: "test" });
  const result = await h.call({ action: "kill", name: "test" });
  assert.equal(result.data.outcome, "killed");
});

test("raw text cannot enter CLI option parsing", async (t) => {
  const h = harness(t);
  await h.ensure();
  await h.call({ action: "send", name: "test", text: "--help" });
  const call = [...h.calls].reverse().find((c) => c.args.includes("write-chars"))!;
  assert.deepEqual(call.args.slice(-2), ["--", "--help"]);
});

test("keys do not close a held pane by accident", async (t) => {
  const h = harness(t);
  const { id } = await h.ensure();
  h.panes.get(id)!.exited = true;
  const result = await h.call({ action: "interrupt", name: "test" });
  assert.equal(result.data.outcome, "missing");
  assert.equal(h.calls.filter((c) => c.args.includes("send-keys")).length, 0);
});

test("limited delta reads preserve unread lines", async (t) => {
  const h = harness(t);
  const { id } = await h.ensure();
  h.output.set(id, Array.from({ length: 20 }, (_, i) => `LINE_${i + 1}`).join("\n"));
  const first = await h.call({ action: "read", name: "test", mode: "delta", limit: 3 });
  const second = await h.call({ action: "read", name: "test", mode: "delta", limit: 3 });
  assert.equal(first.data.output, "LINE_1\nLINE_2\nLINE_3");
  assert.equal(second.data.output, "LINE_4\nLINE_5\nLINE_6");
});

test("delta reads detect partial-line changes and resets", async (t) => {
  const h = harness(t);
  const { id } = await h.ensure();
  h.output.set(id, "PART_A\n");
  await h.call({ action: "read", name: "test", mode: "delta" });
  h.output.set(id, "PART_APART_B\n");
  const appended = await h.call({ action: "read", name: "test", mode: "delta" });
  assert.match(appended.data.output, /PART_B/);
  h.output.set(id, "RESET\n");
  const reset = await h.call({ action: "read", name: "test", mode: "delta" });
  assert.match(reset.data.output, /RESET/);
  await assert.rejects(
    h.call({ action: "read", name: "test", mode: "delta", tail: 1 }),
    /limit only/,
  );
});

test("large output is capped and the full result remains readable", async (t) => {
  const h = harness(t);
  const { id } = await h.ensure();
  const output = "abcdefghij".repeat(10000);
  h.output.set(id, output);
  const result = await h.call({ action: "read", name: "test", tail: 4000 });
  assert.equal(result.data.truncated, true);
  assert.ok(Buffer.byteLength(result.data.output) < 50 * 1024);
  assert.ok(
    Buffer.byteLength(result.content[0].type === "text" ? result.content[0].text : "") <= 50 * 1024,
  );
  assert.equal(await fs.readFile(result.data.fullOutputPath!, "utf8"), output);
});

test("run tracks completion with a split, unique marker", async (t) => {
  const h = harness(t);
  h.setInput((text, id) => {
    const token = /__pi_term_run_id='([^']+)'/.exec(text)![1];
    h.output.set(id, `${text}\n__PI_TERM_${token}:BEGIN\nRUN_OUTPUT\n__PI_TERM_${token}:7\n`);
  });
  const result = await h.call({ action: "run", name: "test", text: "false" });
  assert.equal(result.data.outcome, "exited");
  assert.equal(result.data.exitStatus, 7);
  assert.equal(result.isError, true);
  assert.match(result.data.output, /RUN_OUTPUT/);
  assert.doesNotMatch(result.data.output, /__PI_TERM_[a-z0-9]+:7/);
  assert.ok(result.data.runId);
});

test("run echo cannot satisfy the command marker", async (t) => {
  const h = harness(t);
  let marker = "";
  let id = 0;
  h.setInput((text, pane) => {
    id = pane;
    marker = /__pi_term_run_id='([^']+)'/.exec(text)![1];
    h.output.set(pane, text + "\n");
  });
  const result = await h.call({ action: "run", name: "test", text: "sleep 10", timeoutMs: 30 });
  assert.equal(result.data.outcome, "timed_out");
  assert.equal(result.data.output, "");
  assert.ok(h.updates.length > 0);
  assert.ok(h.updates.every((update) => !update.includes("__pi_term_")));
  await assert.rejects(
    h.call({ action: "run", name: "test", text: "echo second" }),
    /still pending/,
  );
  h.output.set(id, `RESULT\n__PI_TERM_${marker}:0\n`);
  const waited = await h.call({ action: "wait", name: "test" });
  assert.equal(waited.data.outcome, "exited");
  assert.equal(waited.data.exitStatus, 0);
  assert.equal(waited.data.runId, result.data.runId);
});

test("run refuses dedicated process terminals", async (t) => {
  const h = harness(t);
  await h.ensure("test", ["python3"]);
  await assert.rejects(
    h.call({ action: "run", name: "test", text: "echo nope" }),
    /requires a Bash or Zsh shell/,
  );
});

test("run IDs differ between commands", async (t) => {
  const h = harness(t);
  h.setInput((text, id) => {
    const token = /__pi_term_run_id='([^']+)'/.exec(text)![1];
    h.output.set(id, `${h.output.get(id)}\n__PI_TERM_${token}:BEGIN\n__PI_TERM_${token}:0\n`);
  });
  const first = await h.call({ action: "run", name: "test", text: "true" });
  const second = await h.call({ action: "run", name: "test", text: "true" });
  assert.notEqual(first.data.runId, second.data.runId);
});

test("command output excludes earlier history and wrapper echo", () => {
  assert.deepEqual(
    commandCompletion("OLD\nwrapper echo\nTOKEN:BEGIN\nRESULT\nTOKEN:23\nprompt", "TOKEN"),
    { exitStatus: 23, output: "RESULT" },
  );
  assert.deepEqual(commandCompletion("retained after rollover\nTOKEN:0", "TOKEN"), {
    exitStatus: 0,
    output: "retained after rollover",
  });
  assert.equal(commandCompletion("TOKEN:BEGIN\nnot done", "TOKEN"), null);
});

test("pending command output needs a visible start boundary", () => {
  assert.equal(commandOutput("OLD\nwrapper echo", "TOKEN", true), "");
  assert.equal(commandOutput("OLD\nTOKEN:BEGIN\nPARTIAL", "TOKEN", true), "PARTIAL");
  assert.equal(commandOutput("retained after rollover", "TOKEN"), "retained after rollover");
});

test("tracked timeouts and progress exclude history without stripping user text", async (t) => {
  const h = harness(t);
  h.setInput((text, id) => {
    const token = /__pi_term_run_id='([^']+)'/.exec(text)![1];
    h.output.set(
      id,
      `OLD_HISTORY\n${text}\n__PI_TERM_${token}:BEGIN\nPROGRESS café\nprinted __pi_term_complete by user\n`,
    );
  });
  const first = await h.call({
    action: "run",
    name: "test",
    text: "sleep 60",
    timeoutMs: 50,
    pollMs: 2000,
  });
  const expected = "PROGRESS café\nprinted __pi_term_complete by user\n";
  assert.equal(first.data.outcome, "timed_out");
  assert.equal(first.data.output, expected);
  assert.ok(h.updates.length > 0);
  assert.ok(
    h.updates.every(
      (update) =>
        update.includes("PROGRESS café") &&
        !update.includes("OLD_HISTORY") &&
        !update.includes("__pi_term_status_file"),
    ),
  );
  const second = await h.call({ action: "wait", name: "test", timeoutMs: 50, pollMs: 2000 });
  assert.equal(second.data.output, expected);
  assert.equal(second.data.runId, first.data.runId);
  const raw = await h.call({ action: "read", name: "test" });
  assert.match(raw.data.output, /OLD_HISTORY/);
  assert.match(raw.data.output, /__pi_term_status_file/);
});

test("untracked timeout output remains unchanged", async (t) => {
  const h = harness(t);
  const { id } = await h.ensure("test", ["program"]);
  h.output.set(id, "RAW_PROCESS_OUTPUT\n");
  const result = await h.call({ action: "wait", name: "test", pattern: "NEVER", timeoutMs: 30 });
  assert.equal(result.data.outcome, "timed_out");
  assert.equal(result.data.output, "RAW_PROCESS_OUTPUT\n");
});

test("fresh dump files detect empty-success responses", async (t) => {
  const h = harness(t);
  const { id } = await h.ensure();
  h.output.set(id, "ACTUAL_OUTPUT");
  h.skipDumpFiles(2);
  const result = await h.call({ action: "read", name: "test" });
  assert.equal(result.data.output, "ACTUAL_OUTPUT");
  assert.equal(h.calls.filter((call) => call.args.includes("dump-screen")).length, 3);
});

test("empty terminal output is valid when the dump file exists", async (t) => {
  const h = harness(t);
  await h.ensure();
  const result = await h.call({ action: "read", name: "test" });
  assert.equal(result.data.output, "");
  assert.equal(h.calls.filter((call) => call.args.includes("dump-screen")).length, 1);
});

test("wait deadlines include queue time and skip expired requests", async (t) => {
  const h = harness(t);
  await h.ensure("test", ["program"]);
  h.setQueryDelay(200);
  const count = h.calls.filter((call) => call.args.includes("list-panes")).length;
  const occupied = h.call({ action: "read", name: "test" });
  await delay(10);
  const start = Date.now();
  const result = await h.call({ action: "wait", name: "test", timeoutMs: 30 });
  assert.equal(result.data.outcome, "timed_out");
  assert.ok(Date.now() - start < 150);
  await occupied;
  assert.equal(h.calls.filter((call) => call.args.includes("list-panes")).length, count + 1);
});

test("completed commands remain available after scrollback clears", async (t) => {
  const h = harness(t);
  h.setInput((text, id) => {
    const token = /__pi_term_run_id='([^']+)'/.exec(text)![1];
    h.output.set(id, `__PI_TERM_${token}:BEGIN\nCACHED_RESULT\n__PI_TERM_${token}:0\n`);
  });
  const first = await h.call({ action: "run", name: "test", text: "true" });
  h.output.set([...h.panes.keys()][0], "history was cleared");
  const second = await h.call({ action: "wait", name: "test" });
  assert.equal(second.data.exitStatus, 0);
  assert.equal(second.data.output, "CACHED_RESULT");
  assert.equal(second.data.runId, first.data.runId);
});

test("invalid run flags fail before creation or input", async (t) => {
  const h = harness(t);
  for (const fields of [
    { pattern: "READY" },
    { waitFor: "exit" },
    { closeOnExit: true },
    { command: ["program"] },
  ]) {
    await assert.rejects(h.call({ action: "run", name: "test", text: "echo nope", ...fields }));
  }
  assert.equal(h.calls.length, 0);
});

test("invalid geometry and directory fail before a creation attempt", async (t) => {
  const h = harness(t);
  await assert.rejects(
    h.call({ action: "ensure", name: "bad", width: "-1" }),
    /width value .* is invalid/,
  );
  await assert.rejects(
    h.call({ action: "ensure", name: "bad", height: "101%" }),
    /height value .* is invalid/,
  );
  await assert.rejects(
    h.call({ action: "ensure", name: "bad", cwd: "/pi-term-no-such-directory" }),
    /ENOENT/,
  );
  assert.equal(h.calls.length, 0);
});

test("completion files survive lost scrollback markers", async (t) => {
  const h = harness(t);
  h.setInput(async (text, id) => {
    const target = /__pi_term_status_file='([^']+)'/.exec(text)![1];
    await fs.writeFile(target, "23\n");
    h.output.set(id, "BACKGROUND_OUTPUT_AFTER_ROLLOVER\n");
  });
  const result = await h.call({ action: "run", name: "test", text: "false", timeoutMs: 1000 });
  assert.equal(result.data.outcome, "exited");
  assert.equal(result.data.exitStatus, 23);
  assert.match(result.data.output, /BACKGROUND_OUTPUT_AFTER_ROLLOVER/);
});

test("incomplete receipt files do not imply zero exit", async (t) => {
  const h = harness(t);
  let target = "";
  h.setInput(async (text) => {
    target = /__pi_term_status_file='([^']+)'/.exec(text)![1];
    await fs.writeFile(target, "");
  });
  const first = await h.call({ action: "run", name: "test", text: "false", timeoutMs: 30 });
  assert.equal(first.data.outcome, "timed_out");
  await fs.writeFile(target, "7\n");
  const second = await h.call({ action: "wait", name: "test" });
  assert.equal(second.data.exitStatus, 7);
});

test("session changes close the old workspace and clear its names", async (t) => {
  const h = harness(t);
  await h.ensure();
  await h.startSession();
  const listed = await h.call({ action: "list" });
  assert.deepEqual(listed.data.terminals, []);
  assert.equal(h.panes.size, 0);
  await h.ensure();
  assert.equal(h.panes.size, 1);
});
