import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// direnv handling moved to devshell.ts so bash wrapping, cwd, and rtk rewriting
// happen in one explicit pipeline.
export default function (_pi: ExtensionAPI) {}
