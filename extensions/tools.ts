import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { keyText } from "@earendil-works/pi-coding-agent";
import {
  fuzzyFilter,
  getKeybindings,
  Input,
  Key,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENTRY_TYPE = "tools-config";
const TOOLS_CONFIG_VERSION = 1;
const SUMMARY_WIDGET_KEY = "tools-summary";
const SUMMARY_VISIBLE_MS = 10_000;

interface ToolsState {
  enabledTools: string[];
}

interface ToolsConfig {
  version: typeof TOOLS_CONFIG_VERSION;
  disabledTools: string[];
  enabledTools?: string[];
}

function sortedNames(names: Iterable<string>): string[] {
  return [...names].sort((a, b) => a.localeCompare(b));
}

function getAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (!configured) return path.join(os.homedir(), ".pi", "agent");
  if (configured === "~") return os.homedir();
  if (configured.startsWith("~/")) return path.join(os.homedir(), configured.slice(2));
  return configured;
}

function getToolsConfigPath(): string {
  return path.join(getAgentDir(), "tools.json");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function toolSearchText(tool: ToolInfo): string {
  return [tool.name, tool.sourceInfo.source, tool.sourceInfo.path, tool.sourceInfo.scope]
    .filter(Boolean)
    .join(" ");
}

function summarizeTools(allTools: ToolInfo[], enabledTools: Set<string>): string {
  const enabled = sortedNames(enabledTools);
  return [
    `Tools: ${enabled.length}/${allTools.length} enabled`,
    `Enabled: ${enabled.join(", ") || "none"}`,
  ].join("\n");
}

function renderToolsSummary(
  allTools: ToolInfo[],
  enabledTools: Set<string>,
  theme: Theme,
): string[] {
  const enabled = sortedNames(enabledTools);
  return [
    theme.fg("mdHeading", "[Tools]"),
    `  ${theme.fg("accent", "Enabled")} ${theme.fg("dim", `${enabled.length}/${allTools.length} tools`)}`,
    theme.fg("dim", `  ${enabled.join(", ") || "none"}`),
    "\u00a0",
  ];
}

function validToolNames(allTools: ToolInfo[]): Set<string> {
  return new Set(allTools.map((tool) => tool.name));
}

function filterValidTools(
  names: string[] | undefined,
  allTools: ToolInfo[],
): Set<string> | undefined {
  if (!names) return undefined;
  const allToolNames = validToolNames(allTools);
  return new Set(names.filter((name) => allToolNames.has(name)));
}

function enabledFromDisabled(
  disabledTools: string[] | undefined,
  allTools: ToolInfo[],
): Set<string> | undefined {
  const disabled = filterValidTools(disabledTools, allTools);
  if (!disabled) return undefined;
  return new Set(allTools.map((tool) => tool.name).filter((name) => !disabled.has(name)));
}

function disabledFromEnabled(enabledTools: Set<string>, allTools: ToolInfo[]): string[] {
  return sortedNames(allTools.map((tool) => tool.name).filter((name) => !enabledTools.has(name)));
}

function restoreFromBranch(ctx: ExtensionContext, allTools: ToolInfo[]): Set<string> | undefined {
  let savedTools: string[] | undefined;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
      const data = entry.data as ToolsState | undefined;
      if (data?.enabledTools) {
        savedTools = data.enabledTools;
      }
    }
  }

  return filterValidTools(savedTools, allTools);
}

function loadToolsConfig(allTools: ToolInfo[]): Set<string> | undefined {
  try {
    const config = JSON.parse(
      fs.readFileSync(getToolsConfigPath(), "utf-8"),
    ) as Partial<ToolsConfig>;
    return (
      enabledFromDisabled(config.disabledTools, allTools) ??
      filterValidTools(config.enabledTools, allTools)
    );
  } catch {
    return undefined;
  }
}

function saveToolsConfig(enabledTools: Set<string>, allTools: ToolInfo[]): void {
  const config: ToolsConfig = {
    version: TOOLS_CONFIG_VERSION,
    disabledTools: disabledFromEnabled(enabledTools, allTools),
  };
  fs.mkdirSync(path.dirname(getToolsConfigPath()), { recursive: true });
  fs.writeFileSync(getToolsConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}

function toggleTool(enabled: Set<string>, name: string): Set<string> {
  const next = new Set(enabled);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  return next;
}

function enableTools(enabled: Set<string>, names: Iterable<string>): Set<string> {
  const next = new Set(enabled);
  for (const name of names) next.add(name);
  return next;
}

function disableTools(enabled: Set<string>, names: Iterable<string>): Set<string> {
  const next = new Set(enabled);
  for (const name of names) next.delete(name);
  return next;
}

export default function toolsExtension(pi: ExtensionAPI) {
  let allTools: ToolInfo[] = [];
  let enabledTools = new Set<string>();
  let summaryTimer: ReturnType<typeof setTimeout> | undefined;

  function refreshTools(): void {
    allTools = [...pi.getAllTools()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function syncStatus(ctx?: ExtensionContext): void {
    refreshTools();
    const text = `tools ${enabledTools.size}/${allTools.length}`;
    ctx?.ui.setStatus("tools", text);
  }

  function applyTools(ctx?: ExtensionContext): void {
    pi.setActiveTools(sortedNames(enabledTools));
    syncStatus(ctx);
  }

  function persistState(): void {
    pi.appendEntry<ToolsState>(ENTRY_TYPE, {
      enabledTools: sortedNames(enabledTools),
    });
    saveToolsConfig(enabledTools, allTools);
  }

  function restoreTools(ctx: ExtensionContext): void {
    refreshTools();
    enabledTools =
      restoreFromBranch(ctx, allTools) ?? loadToolsConfig(allTools) ?? new Set(pi.getActiveTools());
    applyTools(ctx);
  }

  function clearSummary(ctx: ExtensionContext): void {
    if (summaryTimer) clearTimeout(summaryTimer);
    summaryTimer = undefined;
    ctx.ui.setWidget(SUMMARY_WIDGET_KEY, undefined);
  }

  function showSummary(ctx: ExtensionContext): void {
    if (summaryTimer) clearTimeout(summaryTimer);
    ctx.ui.setWidget(SUMMARY_WIDGET_KEY, renderToolsSummary(allTools, enabledTools, ctx.ui.theme), {
      placement: "aboveEditor",
    });
    summaryTimer = setTimeout(() => {
      ctx.ui.setWidget(SUMMARY_WIDGET_KEY, undefined);
      summaryTimer = undefined;
    }, SUMMARY_VISIBLE_MS);
  }

  function setTools(names: Iterable<string>, ctx?: ExtensionContext): string {
    refreshTools();
    const valid = new Set(allTools.map((tool) => tool.name));
    enabledTools = new Set([...names].filter((name) => valid.has(name)));
    applyTools(ctx);
    persistState();
    return summarizeTools(allTools, enabledTools);
  }

  pi.registerCommand("tools", {
    description: "Show or change active tools",
    handler: async (args, ctx) => {
      refreshTools();
      const trimmed = args.trim();

      if (trimmed.length > 0) {
        const [command, ...rest] = trimmed.split(/\s+/);
        const names = rest.flatMap((part) => part.split(",")).filter(Boolean);

        if (command === "list") {
          ctx.ui.notify(
            `${summarizeTools(allTools, enabledTools)}\nConfig: ${getToolsConfigPath()}`,
            "info",
          );
          return;
        }

        if (command === "enable") {
          ctx.ui.notify(setTools(new Set([...enabledTools, ...names]), ctx), "info");
          return;
        }

        if (command === "disable") {
          const next = new Set(enabledTools);
          for (const name of names) {
            next.delete(name);
          }
          ctx.ui.notify(setTools(next, ctx), "info");
          return;
        }

        if (command === "only") {
          ctx.ui.notify(setTools(names, ctx), "info");
          return;
        }

        if (command === "all") {
          ctx.ui.notify(
            setTools(
              allTools.map((tool) => tool.name),
              ctx,
            ),
            "info",
          );
          return;
        }

        if (command === "none") {
          ctx.ui.notify(setTools([], ctx), "info");
          return;
        }

        ctx.ui.notify(
          "Usage: /tools [list|enable <names>|disable <names>|only <names>|all|none]",
          "warning",
        );
        return;
      }

      await ctx.ui.custom((tui, theme, _kb, done) => {
        const searchInput = new Input();
        searchInput.focused = true;
        let draftTools = new Set(enabledTools);
        let filteredTools = allTools;
        let selectedIndex = 0;
        let isDirty = false;

        function refreshFiltered(): void {
          const query = searchInput.getValue();
          filteredTools = query ? fuzzyFilter(allTools, query, toolSearchText) : allTools;
          selectedIndex = Math.min(selectedIndex, Math.max(0, filteredTools.length - 1));
        }

        function applyDraft(): void {
          enabledTools = new Set(draftTools);
          applyTools(ctx);
          tui.requestRender();
        }

        function saveDraft(): void {
          enabledTools = new Set(draftTools);
          applyTools(ctx);
          persistState();
          isDirty = false;
          ctx.ui.notify(`Saved tools to ${getToolsConfigPath()}`, "info");
          tui.requestRender();
        }

        function targetNames(): string[] {
          return searchInput.getValue()
            ? filteredTools.map((tool) => tool.name)
            : allTools.map((tool) => tool.name);
        }

        refreshFiltered();

        return {
          render(width: number) {
            refreshFiltered();
            const enabledCount = draftTools.size;
            const countText = `${enabledCount}/${allTools.length} enabled`;
            const footerParts = [
              `${keyText("tui.select.confirm")} toggle`,
              `${keyText("app.models.enableAll")} all`,
              `${keyText("app.models.clearAll")} clear`,
              `${keyText("app.models.save")} save`,
              countText,
            ];
            const footer = isDirty
              ? theme.fg("dim", `  ${footerParts.join(" · ")} `) + theme.fg("warning", "(unsaved)")
              : theme.fg("dim", `  ${footerParts.join(" · ")}`);

            const border = theme.fg("muted", "─".repeat(width));
            const lines = [
              border,
              "",
              theme.fg("accent", theme.bold("Tool Configuration")),
              theme.fg(
                "muted",
                `Session-only until ${keyText("app.models.save")} writes ${getToolsConfigPath()}.`,
              ),
              "",
              ...searchInput.render(width),
              "",
            ];

            if (filteredTools.length === 0) {
              lines.push(theme.fg("muted", "  No matching tools"));
            } else {
              const maxVisible = 8;
              const startIndex = Math.max(
                0,
                Math.min(
                  selectedIndex - Math.floor(maxVisible / 2),
                  filteredTools.length - maxVisible,
                ),
              );
              const endIndex = Math.min(startIndex + maxVisible, filteredTools.length);
              for (let i = startIndex; i < endIndex; i++) {
                const tool = filteredTools[i];
                const selected = i === selectedIndex;
                const prefix = selected ? theme.fg("accent", "→ ") : "  ";
                const name = selected ? theme.fg("accent", tool.name) : tool.name;
                const source = theme.fg(
                  "muted",
                  ` [${tool.sourceInfo.source}:${tool.sourceInfo.scope}]`,
                );
                const status = draftTools.has(tool.name)
                  ? theme.fg("success", " ✓")
                  : theme.fg("dim", " ✗");
                lines.push(`${prefix}${name}${source}${status}`);
              }
              if (startIndex > 0 || endIndex < filteredTools.length) {
                lines.push(theme.fg("muted", `  (${selectedIndex + 1}/${filteredTools.length})`));
              }
              const selected = filteredTools[selectedIndex];
              if (selected) {
                lines.push("", theme.fg("muted", `  ${oneLine(selected.description)}`));
              }
            }

            lines.push("", footer, border);
            return lines.map((line) => truncateToWidth(line, width));
          },
          invalidate() {},
          handleInput(data: string) {
            const kb = getKeybindings();

            if (kb.matches(data, "tui.select.up")) {
              if (filteredTools.length > 0) {
                selectedIndex = selectedIndex === 0 ? filteredTools.length - 1 : selectedIndex - 1;
                tui.requestRender();
              }
              return;
            }

            if (kb.matches(data, "tui.select.down")) {
              if (filteredTools.length > 0) {
                selectedIndex = selectedIndex === filteredTools.length - 1 ? 0 : selectedIndex + 1;
                tui.requestRender();
              }
              return;
            }

            if (kb.matches(data, "tui.select.confirm")) {
              const tool = filteredTools[selectedIndex];
              if (tool) {
                draftTools = toggleTool(draftTools, tool.name);
                isDirty = true;
                applyDraft();
              }
              return;
            }

            if (kb.matches(data, "app.models.enableAll")) {
              draftTools = enableTools(draftTools, targetNames());
              isDirty = true;
              applyDraft();
              return;
            }

            if (kb.matches(data, "app.models.clearAll")) {
              draftTools = disableTools(draftTools, targetNames());
              isDirty = true;
              applyDraft();
              return;
            }

            if (kb.matches(data, "app.models.save")) {
              saveDraft();
              return;
            }

            if (matchesKey(data, Key.ctrl("c"))) {
              if (searchInput.getValue()) {
                searchInput.setValue("");
                refreshFiltered();
                tui.requestRender();
              } else {
                done(undefined);
              }
              return;
            }

            if (matchesKey(data, Key.escape)) {
              done(undefined);
              return;
            }

            searchInput.handleInput(data);
            refreshFiltered();
            tui.requestRender();
          },
        };
      });
    },
  });

  pi.on("session_start", async (event, ctx) => {
    restoreTools(ctx);
    if (event.reason === "startup" || event.reason === "reload") {
      showSummary(ctx);
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreTools(ctx);
    showSummary(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearSummary(ctx);
  });
}
