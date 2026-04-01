import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "hello",
    label: "Hello",
    description: "A simple greeting tool",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: { greeted: params.name },
      };
    },
  });
}
