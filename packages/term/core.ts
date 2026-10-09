import path from "node:path";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

export type PaneInfo = {
  id: number;
  is_plugin: boolean;
  exited: boolean;
  exit_status?: number | null;
  title?: string;
  pane_x?: number;
  pane_y?: number;
  pane_columns?: number;
  pane_rows?: number;
};

export function parsePanes(stdout: string): PaneInfo[] {
  const value: unknown = JSON.parse(stdout);
  if (
    !Array.isArray(value) ||
    value.some(
      (pane) =>
        !pane ||
        typeof pane !== "object" ||
        !Number.isInteger(pane.id) ||
        pane.id < 0 ||
        typeof pane.is_plugin !== "boolean" ||
        typeof pane.exited !== "boolean" ||
        (pane.exit_status !== undefined &&
          pane.exit_status !== null &&
          !Number.isInteger(pane.exit_status)),
    )
  ) {
    throw new Error("Zellij returned an invalid pane list.");
  }
  return value;
}

export function paneId(pane: PaneInfo): string {
  return `${pane.is_plugin ? "plugin" : "terminal"}_${pane.id}`;
}

export function createdPaneId(stdout: string, stderr: string): string | undefined {
  return [stdout, stderr]
    .flatMap((text) => text.split(/\r?\n/))
    .map((line) => line.trim())
    .find((line) => /^terminal_\d+$/.test(line));
}

export async function findExecutable(command: string): Promise<string | undefined> {
  const candidates = command.includes(path.sep)
    ? [path.resolve(command)]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((dir) => path.join(dir, command));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, constants.X_OK);
      if ((await fs.stat(candidate)).isFile()) return await fs.realpath(candidate);
    } catch {
      // Continue through PATH.
    }
  }
  return undefined;
}

export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function trackedCommand(
  text: string,
  id: string,
  kind: "bash" | "zsh",
  statusPath: string,
): string {
  // Prompt hooks run after Ctrl-C too. A trailing printf on the command line does not.
  const complete =
    '__pi_term_complete() { local __pi_term_status=$?; if [[ -n ${__pi_term_run_id-} ]]; then printf \'%s\\n\' "$__pi_term_status" > "$__pi_term_status_file"; printf \'\\n%s%s:%s\\n\' \'__PI_TERM_\' "$__pi_term_run_id" "$__pi_term_status"; unset __pi_term_run_id __pi_term_status_file; fi; return "$__pi_term_status"; }';
  const hook =
    kind === "bash"
      ? 'if [[ ${PROMPT_COMMAND[0]-} != __pi_term_complete ]]; then PROMPT_COMMAND=(__pi_term_complete "${PROMPT_COMMAND[@]}"); fi'
      : 'if [[ ${precmd_functions[1]-} != __pi_term_complete ]]; then precmd_functions=(__pi_term_complete "${precmd_functions[@]}"); fi';
  // The complete marker never appears in input, so terminal echo cannot satisfy it.
  return `${complete}; ${hook}; __pi_term_status_file=${shellQuote(statusPath)}; __pi_term_run_id=${shellQuote(id)}; printf '\\n%s%s:BEGIN\\n' '__PI_TERM_' "$__pi_term_run_id"; eval ${shellQuote(text)}`;
}

export function shellKind(shell: string): "bash" | "zsh" | "other" {
  const name = path.basename(shell);
  if (name.includes("zsh")) return "zsh";
  if (name.includes("bash")) return "bash";
  return "other";
}

export function linesOf(output: string): string[] {
  return output.length ? output.replaceAll("\r\n", "\n").split("\n") : [];
}

export function commonPrefix(before: string[], after: string[]): number {
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  return i;
}

export type OutputMatch = { matchedText: string; matchedLine: string; matchLine: number };

export function outputMatcher(pattern: string, mode: "literal" | "regex") {
  if (!pattern.length) throw new Error("Output waits require a nonempty pattern.");
  let regex: RegExp | undefined;
  if (mode === "regex") {
    try {
      regex = new RegExp(pattern, "m");
    } catch (error) {
      throw new Error(
        `Invalid regex pattern: ${String(error)}. Use matchMode: literal for plain text.`,
      );
    }
  }
  return (output: string): OutputMatch | null => {
    const match = regex?.exec(output);
    const index = regex ? (match?.index ?? -1) : output.indexOf(pattern);
    if (index < 0) return null;
    const start = index === 0 ? 0 : output.lastIndexOf("\n", index - 1) + 1;
    const end = output.indexOf("\n", index);
    return {
      matchedText: match ? match[0] : pattern,
      matchedLine: output.slice(start, end < 0 ? output.length : end),
      matchLine: output.slice(0, start).split("\n").length,
    };
  };
}

export function commandCompletion(
  output: string,
  marker: string,
): { exitStatus: number; output: string } | null {
  const end = outputMatcher(`^${marker}:([0-9]{1,3})$`, "regex")(output);
  if (!end) return null;
  return {
    exitStatus: Number(end.matchedText.slice(marker.length + 1)),
    output: commandOutput(
      linesOf(output)
        .slice(0, end.matchLine - 1)
        .join("\n"),
      marker,
    ),
  };
}

export function commandOutput(output: string, marker: string, requireStart = false): string {
  const begin = outputMatcher(`^${marker}:BEGIN$`, "regex")(output);
  // Pending output cannot distinguish a lost start marker from pre-command history.
  if (requireStart && !begin) return "";
  // Completion proves that the command started, even after scrollback rollover.
  return linesOf(output)
    .slice(begin?.matchLine ?? 0)
    .join("\n");
}

export async function commandStatus(statusPath: string): Promise<number | undefined> {
  try {
    const text = await fs.readFile(statusPath, "utf8");
    if (/^[0-9]{1,3}\n$/.test(text) && Number(text) <= 255) return Number(text);
    return undefined; // An incomplete write is not a completion receipt.
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

export class DeadlineReached extends Error {
  constructor() {
    super("The wait deadline expired.");
  }
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Term operation was cancelled.");
}

export function remainingTime(deadline?: number): number {
  if (deadline === undefined) return 5000;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new DeadlineReached();
  return Math.min(5000, remaining);
}

export async function delay(ms: number, signal?: AbortSignal, deadline?: number): Promise<void> {
  checkAbort(signal);
  const remaining = deadline === undefined ? ms : Math.max(0, deadline - Date.now());
  try {
    await sleep(Math.min(ms, remaining), undefined, { signal });
  } catch (error) {
    checkAbort(signal);
    throw error;
  }
  checkAbort(signal);
}

export async function withinDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    checkAbort(signal);
    remainingTime(deadline);
    const stopped = new Promise<never>((_, reject) => {
      // Unlike CLI execution limits, this timer also bounds time in the queue.
      timer = setTimeout(() => reject(new DeadlineReached()), deadline - Date.now());
      onAbort = () => reject(new Error("Term operation was cancelled."));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([promise, stopped]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

export function enqueue<T>(queue: { tail: Promise<void> }, task: () => Promise<T>): Promise<T> {
  const result = queue.tail.then(task);
  queue.tail = result.then(
    () => {},
    () => {},
  );
  return result;
}
