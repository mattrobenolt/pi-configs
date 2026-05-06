import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// cwd handling moved to devshell.ts so bash wrapping, direnv, and rtk rewriting
// happen in one explicit pipeline.
export default function (_pi: ExtensionAPI) {}
