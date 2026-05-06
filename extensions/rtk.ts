import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// rtk rewriting moved to devshell.ts so command optimization happens before
// cwd/direnv wrapping in one explicit pipeline.
export default function (_pi: ExtensionAPI) {}
