/**
 * /system-prompt — inspect pi's generated system prompt at runtime.
 *
 * Views:
 *   /system-prompt          the prompt the next turn will send (override build if active)
 *   /system-prompt base     pi's cached stock template, for diffing against ours
 *   /system-prompt sent     last prompt snapshotted during before_agent_start
 *   /system-prompt options  structured build inputs (tools, snippets, skills, context files)
 *
 * Note on "sent": the snapshot is taken in agent_start, after all
 * before_agent_start handlers (including project-local ones like greg-soul)
 * have applied their changes, so it is the final prompt actually sent.
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BuildSystemPromptOptions,
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { buildPrompt, localSoulOwner } from "./system-prompt-override.ts";

type SentSnapshot = {
  text: string;
  at: number;
  promptPreview: string;
};

function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\t/g, "    ");
    if (line.length <= width) {
      out.push(line);
      continue;
    }
    let rest = line;
    while (rest.length > width) {
      let cut = rest.lastIndexOf(" ", width);
      if (cut <= 0) cut = width;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^ /, "");
    }
    if (rest.length > 0) out.push(rest);
  }
  return out;
}

function formatOptions(options: BuildSystemPromptOptions): string {
  const sections: string[] = [];

  sections.push(`cwd: ${options.cwd}`);

  const custom = options.customPrompt;
  sections.push(
    custom
      ? `customPrompt: ${custom.length} chars — replaces the default template entirely`
      : "customPrompt: (none — default template in use)",
  );
  if (custom) {
    sections.push("--- customPrompt ---", custom, "--- end customPrompt ---");
  }

  const append = options.appendSystemPrompt;
  sections.push(
    append ? `appendSystemPrompt: ${append.length} chars` : "appendSystemPrompt: (none)",
  );
  if (append) {
    sections.push("--- appendSystemPrompt ---", append, "--- end appendSystemPrompt ---");
  }

  const tools = options.selectedTools ?? ["read", "bash", "edit", "write"];
  sections.push(`selectedTools (${tools.length}):\n${tools.map((t) => `  - ${t}`).join("\n")}`);

  const snippets = Object.entries(options.toolSnippets ?? {});
  sections.push(
    `toolSnippets (${snippets.length}):\n${snippets.map(([name, s]) => `  ${name}: ${s}`).join("\n")}`,
  );

  const guidelines = options.promptGuidelines ?? [];
  sections.push(
    `promptGuidelines (${guidelines.length}):\n${guidelines.map((g) => `  - ${g}`).join("\n")}`,
  );

  const contextFiles = options.contextFiles ?? [];
  sections.push(
    `contextFiles (${contextFiles.length}):\n${contextFiles
      .map((f) => `  - ${f.path} (${f.content.length} chars)`)
      .join("\n")}`,
  );

  const skills = options.skills ?? [];
  sections.push(
    `skills (${skills.length}):\n${skills
      .map((s) => `  - ${s.name}: ${s.description}\n    ${s.filePath}`)
      .join("\n")}`,
  );

  return sections.join("\n\n");
}

function copyToClipboard(text: string, ctx: ExtensionCommandContext): void {
  if (process.platform !== "darwin") {
    ctx.ui.notify("Clipboard copy only wired up for macOS", "warning");
    return;
  }
  const child = execFile("pbcopy", [], (err) => {
    ctx.ui.notify(
      err ? `pbcopy failed: ${err.message}` : "Copied to clipboard",
      err ? "error" : "info",
    );
  });
  child.stdin?.end(text);
}

async function showViewer(
  view: string,
  title: string,
  text: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    // Non-interactive modes: dump to stdout so the data is still reachable.
    console.log(text);
    return;
  }

  await ctx.ui.custom(
    (tui, theme, _kb, done) => {
      let offset = 0;
      let lastWidth = 80;
      let cache: { width: number; lines: string[] } | null = null;

      const wrapped = (width: number): string[] => {
        if (cache && cache.width === width) return cache.lines;
        const lines = wrapText(text, Math.max(8, width));
        cache = { width, lines };
        return lines;
      };

      const viewportHeight = (): number => Math.max(3, Math.floor(tui.terminal.rows * 0.88) - 4);

      // Paint every line as a solid panel row so the overlay masks the base
      // screen. bg() resets only the background, so nested fg styling survives.
      const paint = (styled: string, width: number): string => {
        const pad = Math.max(0, width - visibleWidth(styled));
        return theme.bg("customMessageBg", styled + " ".repeat(pad));
      };

      return {
        render: (width: number): string[] => {
          lastWidth = width;
          const inner = Math.max(8, width - 4);
          const lines = wrapped(inner);
          const height = viewportHeight();
          const maxOffset = Math.max(0, lines.length - height);
          offset = Math.min(Math.max(0, offset), maxOffset);
          const view = lines.slice(offset, offset + height).map((l) => `  ${l}`);
          while (view.length < height) view.push("");

          const header = `  ${theme.fg("accent", theme.bold(title))}`;
          const rule = theme.fg("dim", `  ${"─".repeat(inner)}`);
          const stats = `${text.length} chars · ${lines.length} lines`;
          const position = `${Math.min(offset + 1, lines.length)}-${Math.min(
            offset + height,
            lines.length,
          )}`;
          const footer = theme.fg(
            "dim",
            `  ↑/↓ scroll · PgUp/PgDn · g/G top/bottom · y copy · w save · q close — ${stats} · ${position}`,
          );
          return [header, rule, ...view, rule, footer].map((l) => paint(l, width));
        },
        invalidate: () => {
          cache = null;
        },
        handleInput: (data: string): void => {
          const height = viewportHeight();
          const maxOffset = Math.max(0, wrapped(Math.max(8, lastWidth - 4)).length - height);
          if (matchesKey(data, Key.escape) || data === "q" || matchesKey(data, Key.enter)) {
            done(undefined);
          } else if (matchesKey(data, Key.up) || data === "k") {
            offset -= 1;
          } else if (matchesKey(data, Key.down) || data === "j") {
            offset += 1;
          } else if (matchesKey(data, Key.pageUp)) {
            offset -= height;
          } else if (matchesKey(data, Key.pageDown) || data === " ") {
            offset += height;
          } else if (matchesKey(data, Key.home) || data === "g") {
            offset = 0;
          } else if (matchesKey(data, Key.end) || data === "G") {
            offset = maxOffset;
          } else if (data === "y") {
            copyToClipboard(text, ctx);
          } else if (data === "w") {
            const file = join(tmpdir(), `pi-system-prompt-${view}.txt`);
            writeFile(file, text, "utf8").then(
              () => ctx.ui.notify(`Wrote ${file}`, "info"),
              (err) => ctx.ui.notify(`Save failed: ${err.message}`, "error"),
            );
          }
        },
      };
    },
    { overlay: true, overlayOptions: { width: "92%", maxHeight: "88%" } },
  );
}

export default function (pi: ExtensionAPI) {
  let lastSent: SentSnapshot | undefined;
  let pendingPreview: string | undefined;

  pi.on("session_start", () => {
    lastSent = undefined;
    pendingPreview = undefined;
  });

  pi.on("before_agent_start", (event) => {
    pendingPreview = (event.prompt ?? "").replace(/\s+/g, " ").slice(0, 80);
  });

  pi.on("agent_start", (_event, ctx) => {
    // agent.state.systemPrompt is final here: every before_agent_start handler
    // (including later project-local ones) has applied its changes. Only
    // snapshot for turns that began with a user prompt.
    if (pendingPreview === undefined) return;
    lastSent = { text: ctx.getSystemPrompt(), at: Date.now(), promptPreview: pendingPreview };
    pendingPreview = undefined;
  });

  pi.registerCommand("system-prompt", {
    description: "Inspect the generated system prompt: /system-prompt [base|sent|options]",
    handler: async (args, ctx) => {
      const view = (args ?? "").trim().toLowerCase() || "current";

      if (view === "current") {
        // A project with a .pi/SOUL.md owns its prompt (greg-soul et al.).
        // We can't render the project's builder, so point at the sent view.
        const owner = localSoulOwner(ctx.cwd);
        if (owner) {
          await showViewer(
            "current",
            "System prompt — locally owned",
            `This project owns its own system prompt via ${owner} (greg-soul). The global override defers here.\n\nRun any prompt, then /system-prompt sent to see the final prompt.`,
            ctx,
          );
          return;
        }
        // The override owns the effective prompt when no customPrompt is set.
        // Fall back to pi's cached base for the customPrompt case, matching
        // the override's deferral.
        const options = ctx.getSystemPromptOptions();
        const effective = options.customPrompt
          ? ctx.getSystemPrompt()
          : buildPrompt(options, { model: ctx.model });
        await showViewer("current", "System prompt — current (next turn)", effective, ctx);
        return;
      }

      if (view === "base") {
        await showViewer("base", "System prompt — pi stock base", ctx.getSystemPrompt(), ctx);
        return;
      }

      if (view === "sent") {
        const text = lastSent
          ? `Captured ${new Date(lastSent.at).toLocaleString()} before prompt: ${lastSent.promptPreview}\n\n${lastSent.text}`
          : "(no agent turn yet this session)";
        await showViewer("sent", "System prompt — last sent", text, ctx);
        return;
      }

      if (view === "options") {
        await showViewer(
          "options",
          "System prompt — build inputs",
          formatOptions(ctx.getSystemPromptOptions()),
          ctx,
        );
        return;
      }

      ctx.ui.notify("Usage: /system-prompt [base|sent|options]", "warning");
    },
  });
}
