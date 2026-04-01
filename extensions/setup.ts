import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@mariozechner/pi-ai";

// Built-in pi tools that are inactive by default. Tools registered by extensions
// (e.g. webfetch, websearch, memory) are always active and don't need to be listed here.
const EXTRA_TOOLS = ["grep", "find", "ls"];

export default function (pi: ExtensionAPI) {
  let lastPayload: unknown = null;

  pi.on("session_start", (_event, ctx) => {
    // Activate extra tools
    const active = pi.getActiveTools() as unknown as string[];
    pi.setActiveTools([...new Set([...active, ...EXTRA_TOOLS])]);

    // Auto-expand tool outputs
    ctx.ui.setToolsExpanded(true);
  });

  pi.on("before_provider_request", (event) => {
    lastPayload = event.payload;
  });

  pi.registerTool({
    name: "get_system_prompt",
    label: "Get System Prompt",
    description: "Returns the current system prompt so the LLM can inspect it",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      return {
        content: [{ type: "text", text: ctx.getSystemPrompt() }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "get_tools",
    label: "Get Tools",
    description: "Returns all registered tool definitions as seen by the LLM",
    parameters: Type.Object({}),
    async execute() {
      const all = pi.getAllTools().map((t) => t.name);
      const active = pi.getActiveTools() as string[];
      const inactive = all.filter((n) => !active.includes(n));
      return {
        content: [{ type: "text", text: JSON.stringify({ active, inactive }, null, 2) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "get_last_payload",
    label: "Get Last Payload",
    description: "Returns the last raw API request payload sent to the provider",
    parameters: Type.Object({}),
    async execute() {
      if (!lastPayload) {
        return {
          content: [{ type: "text", text: "No payload captured yet" }],
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(lastPayload, null, 2) }],
        details: {},
      };
    },
  });
}
