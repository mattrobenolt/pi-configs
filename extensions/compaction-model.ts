import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

const LOCAL_COMPACTION_MODEL = { provider: "llamacpp", id: "gemma4-26b-a4b" } as const;
const SUMMARY_MAX_TOKENS = 4096;

export default function (pi: ExtensionAPI) {
  pi.on("session_before_compact", async (event, ctx) => {
    const active = ctx.model;
    if (!active || active.provider !== "llamacpp") return;

    const model = ctx.modelRegistry.find(
      LOCAL_COMPACTION_MODEL.provider,
      LOCAL_COMPACTION_MODEL.id,
    );
    if (!model) {
      ctx.ui.notify(
        `Compaction model ${LOCAL_COMPACTION_MODEL.provider}/${LOCAL_COMPACTION_MODEL.id} not found; using default compaction`,
        "warning",
      );
      return;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      ctx.ui.notify(
        `Compaction auth failed for ${LOCAL_COMPACTION_MODEL.provider}/${LOCAL_COMPACTION_MODEL.id}: ${auth.ok ? "missing API key" : auth.error}`,
        "warning",
      );
      return;
    }

    const { preparation, customInstructions, signal } = event;
    const {
      messagesToSummarize,
      turnPrefixMessages,
      previousSummary,
      tokensBefore,
      firstKeptEntryId,
      fileOps,
    } = preparation;
    const messages = [...messagesToSummarize, ...turnPrefixMessages];

    if (messages.length === 0) {
      if (previousSummary?.trim()) {
        ctx.ui.notify(
          `Compaction had no new messages to summarize; preserving previous summary instead of asking ${active.id} to summarize an empty conversation`,
          "warning",
        );
        return {
          compaction: {
            summary: previousSummary,
            firstKeptEntryId,
            tokensBefore,
            details: fileDetails(fileOps),
          },
        };
      }

      ctx.ui.notify(
        `Compaction had no messages to summarize; cancelling instead of asking ${active.id} to summarize an empty conversation`,
        "warning",
      );
      return { cancel: true };
    }

    const conversation = serializeConversation(convertToLlm(messages));
    const previous = previousSummary
      ? `\n\n<previous-summary>\n${previousSummary}\n</previous-summary>`
      : "";
    const focus = customInstructions ? `\n\nAdditional focus: ${customInstructions}` : "";
    const modelLabel =
      active.id === LOCAL_COMPACTION_MODEL.id
        ? LOCAL_COMPACTION_MODEL.id
        : `${LOCAL_COMPACTION_MODEL.id} instead of ${active.id}`;

    ctx.ui.notify(`Compacting ${tokensBefore.toLocaleString()} tokens with ${modelLabel}`, "info");

    const response = await complete(
      model,
      {
        systemPrompt:
          "You summarize coding-agent conversations. Do not continue the conversation. Preserve exact technical state, decisions, file paths, constraints, blockers, and next steps.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Create a compact but complete handoff summary for continuing this agent session.${previous}${focus}

Include these sections exactly:

## Goal
## Constraints & Preferences
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Next Steps
## Critical Context

Rules:
- Preserve concrete file paths, commands, model names, config values, and error messages.
- Preserve unresolved questions and current hypotheses.
- Do not include chit-chat or generic advice.
- If a section has nothing important, write "None".
- Keep it concise, but do not drop information needed to continue safely.

<conversation>
${conversation}
</conversation>`,
              },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: SUMMARY_MAX_TOKENS,
        signal,
      },
    );

    if (response.stopReason === "error") {
      ctx.ui.notify(
        `Compaction via ${LOCAL_COMPACTION_MODEL.id} failed: ${response.errorMessage ?? "unknown error"}`,
        "warning",
      );
      return;
    }

    const summary = response.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (!summary) {
      ctx.ui.notify(
        `Compaction via ${LOCAL_COMPACTION_MODEL.id} returned an empty summary; using default compaction`,
        "warning",
      );
      return;
    }

    return {
      compaction: {
        summary,
        firstKeptEntryId,
        tokensBefore,
        details: fileDetails(fileOps),
      },
    };
  });
}

function fileDetails(fileOps: { read: Set<string>; written: Set<string>; edited: Set<string> }) {
  const modifiedFiles = [...new Set([...fileOps.written, ...fileOps.edited])].sort();
  const modified = new Set(modifiedFiles);
  const readFiles = [...fileOps.read].filter((file) => !modified.has(file)).sort();
  return { readFiles, modifiedFiles };
}
