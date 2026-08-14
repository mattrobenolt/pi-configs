/**
 * Agent completion notification extension.
 *
 * When the agent finishes while the terminal is unfocused, emit a terminal bell
 * and play a short local sound. This deliberately avoids OS notifications,
 * since macOS Do Not Disturb makes those mostly decorative.
 */

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { onTerminalFocusChange } from "@mattrobenolt/pi-core/terminal-focus";

const soundPlayer = "/usr/bin/afplay";
const soundPath = "/System/Library/Sounds/Glass.aiff";

// herdr plays its own attention sound; skip ours to avoid double-dinging.
const inHerdr = "HERDR_ENV" in process.env;

let focused = true;
let enabled = false;
let unsubscribe: (() => void) | undefined;

const hasInteractiveTerminal = (): boolean =>
  process.stdin.isTTY === true && process.stdout.isTTY === true;

const bell = (): void => {
  if (enabled) {
    process.stdout.write("\x07");
  }
};

const playSound = (): void => {
  if (inHerdr) {
    return;
  }

  try {
    accessSync(soundPlayer, constants.X_OK);
  } catch {
    return;
  }

  const child = spawn(soundPlayer, [soundPath], {
    detached: true,
    stdio: "ignore",
  });

  child.on("error", () => {});
  child.unref();
};

const notify = (): void => {
  if (focused) {
    return;
  }

  bell();
  playSound();
};

export default function (pi: ExtensionAPI) {
  // Register at factory time so the producer's session_start snapshot is
  // delivered before any turn can finish.
  unsubscribe = onTerminalFocusChange(pi, (next) => {
    focused = next;
  });

  pi.on("session_start", async () => {
    enabled = hasInteractiveTerminal();
  });

  pi.on("session_shutdown", async () => {
    unsubscribe?.();
    unsubscribe = undefined;
    enabled = false;
  });

  pi.on("agent_end", async () => {
    notify();
  });
}
