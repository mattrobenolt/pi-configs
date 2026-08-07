/**
 * Terminal pane focus reporting for extensions.
 *
 * Enables xterm focus reporting (CSI ? 1004 h) and broadcasts pane focus
 * changes on the shared extension event bus. Other extensions subscribe via
 * onTerminalFocusChange() from @mattrobenolt/pi-core/terminal-focus.
 *
 * Must be its own extension rather than a shared singleton: the extension
 * loader jiti-imports modules with moduleCache disabled, so each extension
 * gets a private copy of any imported module. The event bus is the only
 * state shared across extensions, and this extension is the single producer.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { emitTerminalFocus } from "@mattrobenolt/pi-core/terminal-focus";

const enableFocusEvents = "\x1b[?1004h";
const disableFocusEvents = "\x1b[?1004l";
const focusIn = "\x1b[I";
const focusOut = "\x1b[O";

const hasInteractiveTerminal = (): boolean =>
  process.stdin.isTTY === true && process.stdout.isTTY === true;

export default function (pi: ExtensionAPI) {
  let focused = true;
  let enabled = false;

  const handleStdin = (chunk: Buffer | string): void => {
    const text = chunk.toString("utf8");
    const next = text.includes(focusOut) ? false : text.includes(focusIn) ? true : focused;
    if (next === focused) {
      return;
    }
    focused = next;
    // The factory always runs before the first session_start, so subscribers
    // registered at factory time are already listening.
    emitTerminalFocus(pi, focused);
  };

  pi.on("session_start", async () => {
    if (!hasInteractiveTerminal()) {
      enabled = false;
      return;
    }

    process.stdout.write(enableFocusEvents);
    process.stdin.on("data", handleStdin);
    enabled = true;

    // Snapshot so subscribers learn the current state; without it a terminal
    // left unfocused through a reload keeps consumers at their focused=true
    // default until the next focus change.
    emitTerminalFocus(pi, focused);
  });

  pi.on("session_shutdown", async () => {
    if (!enabled) {
      return;
    }
    process.stdin.off("data", handleStdin);
    process.stdout.write(disableFocusEvents);
    enabled = false;
  });
}
