/**
 * ask_user tool - block on a multiple-choice question in the TUI.
 *
 * Deltas over the upstream question.ts example:
 * - number keys select instantly (1-9), no arrow-key round trip
 * - options can be marked `recommended`; cursor starts there, marker rendered
 * - non-TUI mode tells the agent to proceed with its recommendation instead of a bare error
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface AskOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

type DisplayOption = AskOption & { isOther?: boolean };

interface AskUserDetails {
  question: string;
  options: string[];
  answer: string | null;
  wasCustom?: boolean;
}

const OptionSchema = Type.Object({
  label: Type.String({ description: "Short display label for the option" }),
  description: Type.Optional(
    Type.String({ description: "One-line explanation shown below the label" }),
  ),
  recommended: Type.Optional(
    Type.Boolean({
      description: "True on exactly one option: the one you advise the user to pick",
    }),
  ),
});

const AskUserParams = Type.Object({
  question: Type.String({
    description:
      "The question to ask. Self-contained: the user sees this text, not the surrounding conversation.",
  }),
  options: Type.Array(OptionSchema, {
    minItems: 1,
    description:
      "Choices to present. 2-4 is ideal. Mark one as recommended when you have a preference.",
  }),
  allowOther: Type.Optional(
    Type.Boolean({ description: "Offer a free-text Other option (default: true)" }),
  ),
});

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user a multiple-choice question and block until they answer. Use when a decision is genuinely theirs: choosing between approaches, resolving ambiguity you cannot settle from the codebase, or confirming scope. Do not use for things you can decide yourself. Mark one option recommended when you have a preference so the user can answer fast. If they pick Other or write their own answer, treat it as the decision.",
    promptSnippet:
      "Ask the user a multiple-choice question with a recommended option and a free-text Other escape hatch",
    promptGuidelines: [
      "Use ask_user when blocked on a decision only the user can make; always mark a recommended option when you have a preference.",
    ],
    parameters: AskUserParams,
    executionMode: "sequential",

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const labels = params.options.map((o) => o.label);

      if (ctx.mode !== "tui") {
        return {
          content: [
            {
              type: "text",
              text: "Cannot ask the user in non-interactive mode. Proceed with your recommended option and clearly note the assumption in your output.",
            },
          ],
          details: { question: params.question, options: labels, answer: null } as AskUserDetails,
        };
      }

      const allowOther = params.allowOther !== false;
      const allOptions: DisplayOption[] = [...params.options];
      if (allowOther) {
        allOptions.push({ label: "Other", isOther: true });
      }

      // Start the cursor on the recommended option for a read-question-hit-Enter fast path.
      const recommendedIndex = params.options.findIndex((o) => o.recommended);

      const result = await ctx.ui.custom<{
        answer: string;
        wasCustom: boolean;
        index?: number;
      } | null>((tui, theme, _kb, done) => {
        let optionIndex = recommendedIndex >= 0 ? recommendedIndex : 0;
        let editMode = false;
        let cachedLines: string[] | undefined;

        const editorTheme: EditorTheme = {
          borderColor: (s) => theme.fg("accent", s),
          selectList: {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          },
        };
        const editor = new Editor(tui, editorTheme);

        editor.onSubmit = (value) => {
          const trimmed = value.trim();
          if (trimmed) {
            done({ answer: trimmed, wasCustom: true });
          } else {
            editMode = false;
            editor.setText("");
            refresh();
          }
        };

        function refresh() {
          cachedLines = undefined;
          tui.requestRender();
        }

        function pick(index: number) {
          const selected = allOptions[index];
          if (selected.isOther) {
            editMode = true;
            optionIndex = index;
            refresh();
          } else {
            done({ answer: selected.label, wasCustom: false, index: index + 1 });
          }
        }

        function handleInput(data: string) {
          if (editMode) {
            if (matchesKey(data, Key.escape)) {
              editMode = false;
              editor.setText("");
              refresh();
              return;
            }
            editor.handleInput(data);
            refresh();
            return;
          }

          if (matchesKey(data, Key.up)) {
            optionIndex = Math.max(0, optionIndex - 1);
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            optionIndex = Math.min(allOptions.length - 1, optionIndex + 1);
            refresh();
            return;
          }
          if (matchesKey(data, Key.enter)) {
            pick(optionIndex);
            return;
          }
          if (matchesKey(data, Key.escape)) {
            done(null);
            return;
          }

          // Instant select: 1-9 answers in one keystroke.
          if (/^[1-9]$/.test(data)) {
            const n = Number.parseInt(data, 10);
            if (n <= allOptions.length) pick(n - 1);
          }
        }

        function render(width: number): string[] {
          if (cachedLines) return cachedLines;

          const lines: string[] = [];
          const renderWidth = Math.max(1, width);

          function addWrappedWithPrefix(prefix: string, text: string) {
            const prefixWidth = visibleWidth(prefix);
            if (prefixWidth >= renderWidth) {
              lines.push(...wrapTextWithAnsi(prefix + text, renderWidth));
              return;
            }
            const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
            const continuationPrefix = " ".repeat(prefixWidth);
            for (let i = 0; i < wrapped.length; i++) {
              lines.push(`${i === 0 ? prefix : continuationPrefix}${wrapped[i]}`);
            }
          }

          lines.push(theme.fg("accent", "─".repeat(renderWidth)));
          addWrappedWithPrefix(" ", theme.fg("text", params.question));
          lines.push("");

          for (let i = 0; i < allOptions.length; i++) {
            const opt = allOptions[i];
            const selected = i === optionIndex;
            const isOther = opt.isOther === true;
            const prefix = selected ? theme.fg("accent", "> ") : "  ";
            let label = `${i + 1}. ${opt.label}`;
            if (opt.recommended) label += theme.fg("success", " ★ recommended");
            if (isOther && editMode) label += " ✎";
            const color = selected || (isOther && editMode) ? "accent" : "text";

            addWrappedWithPrefix(prefix, theme.fg(color, label));
            if (opt.description) {
              addWrappedWithPrefix("     ", theme.fg("muted", opt.description));
            }
          }

          if (editMode) {
            lines.push("");
            addWrappedWithPrefix(" ", theme.fg("muted", "Your answer:"));
            for (const line of editor.render(Math.max(1, renderWidth - 2))) {
              lines.push(` ${line}`);
            }
          }

          lines.push("");
          if (editMode) {
            addWrappedWithPrefix(" ", theme.fg("dim", "Enter to submit • Esc to go back"));
          } else {
            addWrappedWithPrefix(
              " ",
              theme.fg("dim", "1-9 or ↑↓ + Enter to select • Esc to cancel"),
            );
          }
          lines.push(theme.fg("accent", "─".repeat(renderWidth)));

          cachedLines = lines;
          return lines;
        }

        return {
          render,
          invalidate: () => {
            cachedLines = undefined;
          },
          handleInput,
        };
      });

      if (!result) {
        return {
          content: [
            {
              type: "text",
              text: "User cancelled without answering. Use your best judgment (your recommended option if you gave one) and proceed without asking again.",
            },
          ],
          details: { question: params.question, options: labels, answer: null } as AskUserDetails,
        };
      }

      if (result.wasCustom) {
        return {
          content: [{ type: "text", text: `User wrote: ${result.answer}` }],
          details: {
            question: params.question,
            options: labels,
            answer: result.answer,
            wasCustom: true,
          } as AskUserDetails,
        };
      }
      return {
        content: [{ type: "text", text: `User selected option ${result.index}: ${result.answer}` }],
        details: {
          question: params.question,
          options: labels,
          answer: result.answer,
          wasCustom: false,
        } as AskUserDetails,
      };
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("ask_user ")) + theme.fg("muted", args.question);
      const opts = Array.isArray(args.options) ? (args.options as AskOption[]) : [];
      if (opts.length) {
        const numbered = opts.map((o, i) => `${i + 1}. ${o.label}${o.recommended ? " ★" : ""}`);
        numbered.push(`${opts.length + 1}. Other`);
        text += `\n${theme.fg("dim", `  Options: ${numbered.join(", ")}`)}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      if (details.answer === null) {
        return new Text(theme.fg("warning", "No answer (cancelled or non-interactive)"), 0, 0);
      }
      if (details.wasCustom) {
        return new Text(
          theme.fg("success", "✓ ") +
            theme.fg("muted", "(wrote) ") +
            theme.fg("accent", details.answer),
          0,
          0,
        );
      }
      const idx = details.options.indexOf(details.answer) + 1;
      const display = idx > 0 ? `${idx}. ${details.answer}` : details.answer;
      return new Text(theme.fg("success", "✓ ") + theme.fg("accent", display), 0, 0);
    },
  });
}
