import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const EXTRA_TOOLS = ["grep", "find", "ls", "websearch"];

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    const active = pi.getActiveTools() as unknown as string[];
    pi.setActiveTools([...new Set([...active, ...EXTRA_TOOLS])]);
  });
}
