/**
 * Agent completion notification extension.
 *
 * When the agent finishes while the terminal is unfocused, emit a terminal bell
 * and play a short local sound. This deliberately avoids OS notifications,
 * since macOS Do Not Disturb makes those mostly decorative.
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const enableFocusEvents = "\x1b[?1004h";
const disableFocusEvents = "\x1b[?1004l";
const focusIn = "\x1b[I";
const focusOut = "\x1b[O";
const soundPath = "/System/Library/Sounds/Glass.aiff";

let focused: boolean | undefined;

const bell = (): void => {
  process.stdout.write("\x07");
};

const playSound = (): void => {
  const child = spawn("/usr/bin/afplay", [soundPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
};

const handleStdin = (chunk: Buffer | string): void => {
  const text = chunk.toString("utf8");

  if (text.includes(focusIn)) {
    focused = true;
  }

  if (text.includes(focusOut)) {
    focused = false;
  }
};

const notify = (): void => {
  if (focused) {
    return;
  }

  bell();
  playSound();
};

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    process.stdout.write(enableFocusEvents);
    process.stdin.on("data", handleStdin);
  });

  pi.on("session_shutdown", async () => {
    process.stdin.off("data", handleStdin);
    process.stdout.write(disableFocusEvents);
  });

  pi.on("agent_end", async () => {
    notify();
  });
}
