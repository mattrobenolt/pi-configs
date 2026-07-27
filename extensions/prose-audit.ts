import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import fs from "node:fs/promises";
import path from "node:path";

import { auditProse, GENRES, type ProseAuditResult } from "../packages/prose-audit/index.ts";

const AuditParams = Type.Object({
  text: Type.Optional(Type.String({ description: "Prose to audit directly." })),
  path: Type.Optional(Type.String({ description: "Path to a UTF-8 text or Markdown file." })),
  genre: Type.Optional(StringEnum(GENRES, { description: "Genre profile. Defaults to general." })),
});

type AuditInput = Static<typeof AuditParams>;

function compactResult(result: ProseAuditResult): string {
  const score = result.synthetic_style_score ?? "n/a";
  const top = [...result.findings]
    .sort((left, right) => right.penalty - left.penalty)
    .slice(0, 12)
    .map(
      (finding) =>
        `- ${finding.rule} at ${finding.line}:${finding.column}: ${finding.message}\n  “${finding.evidence}”`,
    );

  return [
    `Synthetic style score: ${score}/100 (${result.band}, ${result.confidence} confidence)`,
    `${result.metrics.words} words; ${result.findings.length} findings; genre: ${result.genre}`,
    top.length ? `\nHighest-value findings:\n${top.join("\n")}` : "\nNo configured tells found.",
    `\n${result.caveats.join(" ")}`,
  ].join("\n");
}

export default function proseAuditExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "prose_audit",
    label: "Prose Audit",
    description:
      "Audit prose for explainable AI-style lexical, rhetorical, formatting, and rhythm signals. Accepts exactly one of text or path. The score measures style, not authorship. The full structured result is returned in details.",
    promptSnippet: "Audit prose for synthetic or formulaic writing patterns",
    promptGuidelines: [
      "Use prose_audit when prose may sound synthetic or formulaic; treat its score as a style signal, never proof of authorship.",
    ],
    parameters: AuditParams,
    async execute(_toolCallId, params: AuditInput, signal, _onUpdate, ctx) {
      if ((params.text === undefined) === (params.path === undefined)) {
        throw new Error("Provide exactly one of text or path");
      }

      let text = params.text;
      let source = "inline text";
      if (params.path !== undefined) {
        const requested = params.path.replace(/^@/, "");
        const absolute = path.resolve(ctx.cwd, requested);
        const stats = await fs.stat(absolute);
        if (stats.size > 1_000_000) throw new Error("Prose audit input is limited to 1 MB");
        text = await fs.readFile(absolute, { encoding: "utf8", signal });
        source = path.relative(ctx.cwd, absolute) || path.basename(absolute);
      }

      if (!text?.trim()) throw new Error("Input is empty");
      const result = auditProse(text, { genre: params.genre });
      return {
        content: [{ type: "text", text: compactResult(result) }],
        details: { source, result },
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("prose_audit"))} ${theme.fg("muted", args.path ?? "inline text")}`,
        0,
        0,
      );
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as { source: string; result: ProseAuditResult } | undefined;
      if (!details)
        return new Text(result.content[0]?.type === "text" ? result.content[0].text : "", 0, 0);

      const audit = details.result;
      const score = audit.synthetic_style_score ?? "n/a";
      const lines = [
        `${theme.fg("success", `${score}/100`)} ${theme.fg("muted", `${audit.band} · ${audit.metrics.words} words · ${audit.findings.length} findings`)}`,
      ];
      if (expanded) lines.push("", compactResult(audit));
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
