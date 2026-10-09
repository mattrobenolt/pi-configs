import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import term from "./index.ts";

const enabled = process.env.TERM_INTEGRATION === "1";
type Definition = Parameters<ExtensionAPI["registerTool"]>[0];
type Result = {
  outcome: string;
  output: string;
  conditionMet?: boolean;
  exitStatus?: number | null;
  runId?: string;
  matchedLine?: string;
  truncated: boolean;
  fullOutputPath?: string;
  width?: number;
  height?: number;
};

test("live Zellij battery", { skip: !enabled, timeout: 120_000 }, async (t) => {
  const module = import.meta.resolve("@earendil-works/pi-coding-agent");
  const { execCommand } = await import(new URL("./core/exec.js", module).href);
  let tool: Definition;
  const events = new Map<string, () => Promise<void>>();
  const failures: { args: string[]; stdout: string; stderr: string; code: number }[] = [];
  let statusPath = "";
  let clearNextRead = false;
  let clearAfterPaste = false;
  let clearTarget: string[] = [];
  const api = {
    on(name: string, handler: () => Promise<void>) {
      events.set(name, handler);
    },
    registerTool(definition: Definition) {
      tool = definition;
    },
    async exec(
      command: string,
      args: string[],
      options: { signal?: AbortSignal; timeout?: number } = {},
    ) {
      if (command === "zellij" && args.includes("paste")) {
        statusPath = /__pi_term_status_file='([^']+)'/.exec(args.at(-1)!)?.[1] ?? statusPath;
        clearNextRead = clearAfterPaste;
        clearTarget = [
          "--session",
          args[args.indexOf("--session") + 1],
          "action",
          "clear",
          "--pane-id",
          args[args.indexOf("--pane-id") + 1],
        ];
      }
      if (clearNextRead && args.includes("list-panes")) {
        clearNextRead = false;
        const deadline = Date.now() + 1500;
        while (true) {
          try {
            if (/^[0-9]+\n$/.test(await fs.readFile(statusPath, "utf8"))) break;
          } catch {
            /* Await command completion before the clear. */
          }
          assert.ok(Date.now() < deadline, "command receipt did not arrive");
          await sleep(10);
        }
        const cleared = await execCommand("zellij", clearTarget, process.cwd(), { timeout: 1000 });
        assert.equal(cleared.code, 0, cleared.stderr);
      }
      const result = await execCommand(command, args, process.cwd(), options);
      if (
        command === "zellij" &&
        (args.includes("list-panes") || args.includes("dump-screen")) &&
        (result.code !== 0 ||
          (args.includes("--json") && !result.stdout.trimStart().startsWith("[")))
      )
        failures.push({ args, ...result });
      return result;
    },
  };
  term(api as unknown as ExtensionAPI);
  t.after(async () => {
    await events.get("session_shutdown")?.();
    console.log(`Read-query anomalies: ${failures.length}`);
  });
  async function call(args: Record<string, unknown>, signal?: AbortSignal, updates?: string[]) {
    const result = await tool!.execute(
      "integration",
      args,
      signal,
      (update) => {
        if (updates)
          for (const block of update.content) if (block.type === "text") updates.push(block.text);
      },
      { cwd: process.cwd() } as ExtensionToolContext,
    );
    assert.ok(Check(tool!.outputSchema!, result.structuredContent));
    return result.structuredContent as Result;
  }

  await t.test("run creates a shell and preserves real exit status", async () => {
    const result = await call({
      action: "run",
      name: "shell",
      text: "printf 'RUN_OK\\n'; false",
      timeoutMs: 5000,
      pollMs: 50,
    });
    assert.equal(result.outcome, "exited");
    assert.equal(result.exitStatus, 1);
    assert.match(result.output, /RUN_OK/);
    assert.equal(await fs.readFile(statusPath, "utf8"), "1\n");
  });
  await t.test("shell state, quotes, and multiline commands survive runs", async () => {
    await call({
      action: "run",
      name: "shell",
      text: "export TERM_AUDIT_STATE=kept; cd /",
      timeoutMs: 5000,
      pollMs: 50,
    });
    const result = await call({
      action: "run",
      name: "shell",
      text: "pwd\nprintf 'STATE:%s\\n' \"$TERM_AUDIT_STATE\"\nprintf '%s\\n' \"quote's intact\"",
      timeoutMs: 5000,
      pollMs: 50,
    });
    assert.equal(result.exitStatus, 0);
    assert.match(result.output, /STATE:kept/);
    assert.match(result.output, /quote's intact/);
    assert.match(result.output, /^\/$/m);
  });
  await t.test("echo cannot complete a slow run and timeout is resumable", async () => {
    const started = Date.now();
    const first = await call({
      action: "run",
      name: "shell",
      text: "sleep 1; printf 'SLOW_DONE\\n'",
      timeoutMs: 100,
      pollMs: 50,
    });
    assert.equal(first.outcome, "timed_out");
    assert.equal(first.output, "");
    assert.ok(Date.now() - started < 1000);
    const second = await call({ action: "wait", name: "shell", timeoutMs: 3000, pollMs: 50 });
    assert.equal(second.outcome, "exited");
    assert.equal(second.exitStatus, 0);
    assert.equal(second.runId, first.runId);
    assert.ok(Date.now() - started >= 900);
  });
  await t.test("tracked timeout and progress show only current stdout", async () => {
    await call({
      action: "run",
      name: "shell",
      text: "printf 'OLD_TIMEOUT_HISTORY\\n'",
      timeoutMs: 2000,
      pollMs: 50,
    });
    const updates: string[] = [];
    const expected = "PARTIAL café __pi_term_complete\n";
    const first = await call(
      {
        action: "run",
        name: "shell",
        text: "printf 'PARTIAL café __pi_term_complete\\n'; sleep 60",
        timeoutMs: 100,
        pollMs: 50,
      },
      undefined,
      updates,
    );
    assert.equal(first.outcome, "timed_out");
    assert.ok(first.output === "" || first.output === expected);
    await call({
      action: "wait",
      name: "shell",
      pattern: "^PARTIAL café __pi_term_complete$",
      matchMode: "regex",
      timeoutMs: 2000,
      pollMs: 50,
    });
    const second = await call(
      { action: "wait", name: "shell", timeoutMs: 100, pollMs: 50 },
      undefined,
      updates,
    );
    assert.equal(second.outcome, "timed_out");
    assert.equal(second.output, expected);
    assert.equal(second.runId, first.runId);
    assert.ok(updates.length > 0);
    assert.ok(
      updates.every(
        (update) =>
          !update.includes("OLD_TIMEOUT_HISTORY") &&
          !update.includes("__pi_term_status_file") &&
          !update.includes("__PI_TERM_"),
      ),
    );
    const raw = await call({ action: "read", name: "shell", tail: 4000 });
    assert.match(raw.output, /OLD_TIMEOUT_HISTORY/);
    assert.match(raw.output, /__pi_term_status_file/);
    await call({ action: "interrupt", name: "shell" });
    assert.equal(
      (await call({ action: "wait", name: "shell", timeoutMs: 2000, pollMs: 50 })).exitStatus,
      130,
    );
  });
  await t.test("dedicated process exits and early output failure remain distinct", async () => {
    await call({
      action: "ensure",
      name: "failed",
      command: ["/bin/sh", "-c", "printf 'FAILED\\n'; exit 23"],
    });
    const exit = await call({ action: "wait", name: "failed", timeoutMs: 2000, pollMs: 50 });
    assert.equal(exit.outcome, "exited");
    assert.equal(exit.exitStatus, 23);
    const absent = await call({
      action: "wait",
      name: "failed",
      pattern: "NEVER",
      timeoutMs: 2000,
    });
    assert.equal(absent.outcome, "exited_without_match");
    assert.equal(absent.conditionMet, false);
  });
  await t.test("literal pattern inference and hidden-match evidence", async () => {
    await call({
      action: "ensure",
      name: "ready",
      command: [
        "/bin/sh",
        "-c",
        "printf 'Build (done)\\n'; i=1; while [ $i -le 100 ]; do echo NOISE_$i; i=$((i+1)); done; sleep 60",
      ],
    });
    const result = await call({
      action: "wait",
      name: "ready",
      pattern: "Build (done)",
      timeoutMs: 2000,
      tail: 3,
    });
    assert.equal(result.outcome, "matched");
    assert.equal(result.matchedLine, "Build (done)");
    assert.doesNotMatch(result.output, /Build \(done\)/);
  });
  await t.test("leading-hyphen input reaches a program", async () => {
    await call({
      action: "ensure",
      name: "input",
      command: [
        "/bin/sh",
        "-c",
        "stty -echo; printf 'INPUT_READY\\n'; read line; printf 'VALUE:%s\\n' \"$line\"",
      ],
    });
    await call({ action: "wait", name: "input", pattern: "INPUT_READY", timeoutMs: 2000 });
    await call({ action: "send", name: "input", text: "--help", enter: true });
    const result = await call({ action: "wait", name: "input", timeoutMs: 2000, pollMs: 50 });
    assert.equal(result.exitStatus, 0);
    assert.match(result.output, /VALUE:--help/);
  });
  await t.test("geometry bootstrap permits a real 100-column pane", async () => {
    const resized = await call({ action: "resize", name: "shell", width: "100", height: "24" });
    assert.equal(resized.width, 100);
    assert.equal(resized.height, 24);
    const result = await call({
      action: "run",
      name: "shell",
      text: "stty size",
      timeoutMs: 2000,
      pollMs: 50,
    });
    assert.match(result.output, /24 100/);
  });
  await t.test("large reads preserve full output outside the response cap", async () => {
    await call({
      action: "ensure",
      name: "large",
      command: [
        "/bin/sh",
        "-c",
        "i=1; while [ $i -le 3000 ]; do printf 'ROW_%04d_abcdefghijklmnopqrstuv\\n' \"$i\"; i=$((i+1)); done",
      ],
    });
    await call({ action: "wait", name: "large", timeoutMs: 3000, pollMs: 50 });
    const read = await call({ action: "read", name: "large", tail: 4000 });
    assert.equal(read.truncated, true);
    assert.ok(Buffer.byteLength(read.output) < 50 * 1024);
    assert.match(await fs.readFile(read.fullOutputPath!, "utf8"), /ROW_0001/);
  });
  await t.test("limited deltas preserve unread lines", async () => {
    const first = await call({ action: "read", name: "large", mode: "delta", limit: 3 });
    const second = await call({ action: "read", name: "large", mode: "delta", limit: 3 });
    assert.match(first.output, /ROW_0001/);
    assert.match(second.output, /ROW_0004/);
  });
  await t.test("12 concurrent readiness waits survive repeated queries", async () => {
    await call({
      action: "ensure",
      name: "parallel",
      command: ["/bin/sh", "-c", "sleep 3; printf 'PARALLEL_READY\\n'; sleep 60"],
    });
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        call({
          action: "wait",
          name: "parallel",
          pattern: "PARALLEL_READY",
          timeoutMs: 8000,
          pollMs: 50,
        }),
      ),
    );
    assert.ok(results.every((result) => result.outcome === "matched"));
  });
  await t.test("interrupt preserves a shell and releases its tracked command", async () => {
    const first = await call({
      action: "run",
      name: "shell",
      text: "sleep 60",
      timeoutMs: 100,
      pollMs: 50,
    });
    assert.equal(first.outcome, "timed_out");
    await call({ action: "interrupt", name: "shell" });
    const result = await call({ action: "wait", name: "shell", timeoutMs: 2000, pollMs: 50 });
    assert.equal(result.outcome, "exited");
    assert.notEqual(result.exitStatus, 0);
  });
  await t.test("Bash reports interruption and permits the next run", async () => {
    const first = await call({
      action: "run",
      name: "bash",
      shell: "bash",
      text: "sleep 60",
      timeoutMs: 100,
      pollMs: 50,
    });
    assert.equal(first.outcome, "timed_out");
    await call({ action: "interrupt", name: "bash" });
    const interrupted = await call({ action: "wait", name: "bash", timeoutMs: 2000, pollMs: 50 });
    assert.equal(interrupted.outcome, "exited");
    assert.equal(interrupted.exitStatus, 130);
    const next = await call({
      action: "run",
      name: "bash",
      text: "printf 'BASH_OK\\n'",
      timeoutMs: 2000,
      pollMs: 50,
    });
    assert.equal(next.exitStatus, 0);
    assert.equal(next.output.trim(), "BASH_OK");
  });
  await t.test("narrow panes do not break completion tracking", async () => {
    const result = await call({
      action: "run",
      name: "narrow",
      width: "20",
      height: "12",
      text: "printf 'NARROW_OK\\n'",
      timeoutMs: 2000,
      pollMs: 50,
    });
    assert.equal(result.outcome, "exited");
    assert.equal(result.exitStatus, 0);
    assert.match(result.output, /NARROW_OK/);
  });
  await t.test("existing prompt hooks do not erase a failed command status", async () => {
    const zsh = await call({
      action: "run",
      name: "hooks",
      shell: "zsh",
      text: "precmd() { printf 'USER_PRECMD\\n'; return 0; }; false",
      timeoutMs: 2000,
      pollMs: 50,
    });
    assert.equal(zsh.exitStatus, 1);
    const bash = await call({
      action: "run",
      name: "bash-hooks",
      shell: "bash",
      text: "PROMPT_COMMAND+=(\"printf 'USER_PROMPT_COMMAND\\n'\"); false",
      timeoutMs: 2000,
      pollMs: 50,
    });
    assert.equal(bash.exitStatus, 1);
  });
  await t.test("receipt files survive a real scrollback clear", async () => {
    clearAfterPaste = true;
    try {
      const result = await call({
        action: "run",
        name: "rollover",
        text: "printf 'BEFORE_CLEAR\\n'; false",
        timeoutMs: 2000,
        pollMs: 50,
      });
      assert.equal(result.outcome, "exited");
      assert.equal(result.exitStatus, 1);
      assert.equal(result.output.trim(), "");
      assert.equal(await fs.readFile(statusPath, "utf8"), "1\n");
    } finally {
      clearAfterPaste = false;
    }
  });
  await t.test("shell exit counts as completion without a prompt hook", async () => {
    const result = await call({
      action: "run",
      name: "exit",
      text: "printf 'BEFORE_EXIT\\n'; exit 17",
      timeoutMs: 2000,
      pollMs: 50,
    });
    assert.equal(result.outcome, "exited");
    assert.equal(result.exitStatus, 17);
    assert.match(result.output, /BEFORE_EXIT/);
  });
  await t.test("a missing auto-closed pane is recreated", async () => {
    await call({
      action: "ensure",
      name: "closed",
      command: ["/bin/sh", "-c", "exit 0"],
      closeOnExit: true,
    });
    const waited = await call({ action: "wait", name: "closed", waitFor: "exit", timeoutMs: 2000 });
    assert.equal(waited.outcome, "missing");
    const recreated = await call({
      action: "ensure",
      name: "closed",
      command: ["/bin/sh", "-c", "exit 0"],
    });
    assert.equal(recreated.outcome, "created");
  });
});
