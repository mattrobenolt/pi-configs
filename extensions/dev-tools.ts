import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@mariozechner/pi-ai";

export default function (pi: ExtensionAPI) {
  // Auto-expand tool outputs on session start
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setToolsExpanded(true);
  });
  // Capture the last provider payload so we can inspect it
  let lastPayload: unknown = null;

  pi.on("before_provider_request", (event) => {
    lastPayload = event.payload;
  });

  // Inspect the text system prompt
  pi.registerTool({
    name: "get_system_prompt",
    label: "Get System Prompt",
    description: "Returns the current system prompt so the LLM can inspect it",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const prompt = ctx.getSystemPrompt();
      return {
        content: [{ type: "text", text: prompt }],
        details: {},
      };
    },
  });

  // Inspect tool definitions from the API payload
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

  // Inspect the last full API request payload
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
