import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import os from "node:os";
import path from "node:path";

// Built-in pi tools that are inactive by default. Tools registered by extensions
// (e.g. webfetch, websearch, memory) are always active and don't need to be listed here.
const EXTRA_TOOLS = ["grep", "find", "ls"];

const GIT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
  PAGER: "cat",
  LESS: "FRX",
  GIT_EDITOR: "true",
  GIT_SEQUENCE_EDITOR: "true",
  GIT_MERGE_AUTOEDIT: "no",
  GIT_ASKPASS: "false",
  SSH_ASKPASS: "false",
};

const GIT_CONFIG: Record<string, string> = {
  "core.pager": "cat",
  "core.editor": "true",
};

function configureNonInteractiveGit() {
  Object.assign(process.env, GIT_ENV);

  if (process.env.PI_GIT_NONINTERACTIVE_CONFIGURED === "1") return;

  const start = Number(process.env.GIT_CONFIG_COUNT ?? "0");
  let index = Number.isFinite(start) ? start : 0;

  for (const [key, value] of Object.entries(GIT_CONFIG)) {
    process.env[`GIT_CONFIG_KEY_${index}`] = key;
    process.env[`GIT_CONFIG_VALUE_${index}`] = value;
    index += 1;
  }

  process.env.GIT_CONFIG_COUNT = String(index);
  process.env.PI_GIT_NONINTERACTIVE_CONFIGURED = "1";
}

function expandPath(input: string): string {
  if (input === "~" || input === "$HOME" || input === "${HOME}") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  if (input.startsWith("$HOME/")) return path.join(os.homedir(), input.slice(6));
  if (input.startsWith("${HOME}/")) return path.join(os.homedir(), input.slice(8));
  return input;
}

function isBroadSearchPath(input: string | undefined): boolean {
  if (!input) return false;
  const resolved = path.resolve(expandPath(input));
  return (
    resolved === path.parse(resolved).root ||
    resolved === os.homedir() ||
    resolved === "/nix" ||
    resolved === "/nix/store"
  );
}

function shellWords(command: string): string[] {
  const words = command.match(/(?:[^\s"']+|"(?:\\.|[^"])*"|'[^']*')+/g) ?? [];
  return words.map((word) => {
    if (word.startsWith("'") && word.endsWith("'")) return word.slice(1, -1);
    if (word.startsWith('"') && word.endsWith('"'))
      return word.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
    return word;
  });
}

function unsafeFindCommand(command: string): string | undefined {
  const words = shellWords(command);
  let cwdIsBroad = false;

  for (let i = 0; i < words.length; i++) {
    if (words[i] === "cd") {
      cwdIsBroad = isBroadSearchPath(words[i + 1]);
      i += 1;
      continue;
    }

    if (path.basename(words[i]) !== "find") continue;

    const target = words[i + 1];
    if (isBroadSearchPath(target)) return target;
    if (cwdIsBroad && (!target || target === ".")) return target ?? ".";
  }

  return undefined;
}

export default function (pi: ExtensionAPI) {
  configureNonInteractiveGit();

  let lastPayload: unknown = null;

  pi.on("session_start", (_event, ctx) => {
    configureNonInteractiveGit();

    // Activate extra tools
    const active = pi.getActiveTools() as unknown as string[];
    pi.setActiveTools([...new Set([...active, ...EXTRA_TOOLS])]);

    // Auto-expand tool outputs
    ctx.ui.setToolsExpanded(true);
  });

  pi.on("before_provider_request", (event) => {
    lastPayload = event.payload;
  });

  pi.on("tool_call", (event) => {
    if (isToolCallEventType("find", event) && isBroadSearchPath(event.input.path)) {
      return {
        block: true,
        reason: `Refusing to run find over ${event.input.path}. Narrow the search to the repo or a specific subdirectory.`,
      };
    }

    if (isToolCallEventType("bash", event)) {
      const target = unsafeFindCommand(event.input.command);
      if (target) {
        return {
          block: true,
          reason: `Refusing to run shell find over ${target}. Narrow the search to the repo or a specific subdirectory.`,
        };
      }
    }
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
