import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface UsageEntry {
  tokens: number;
  model: string;
  date: string;
}

function extractUsage(filePath: string): UsageEntry[] {
  const entries: UsageEntry[] = [];

  try {
    const content = fs.readFileSync(filePath, "utf-8");

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);
        const totalTokens = entry.message?.usage?.totalTokens;

        if (
          entry.type !== "message" ||
          entry.message?.role !== "assistant" ||
          typeof totalTokens !== "number" ||
          totalTokens <= 0
        ) {
          continue;
        }

        const date =
          typeof entry.timestamp === "string"
            ? entry.timestamp.slice(0, 10)
            : path.basename(filePath).slice(0, 10);

        entries.push({
          tokens: totalTokens,
          model: entry.message.model ?? "unknown",
          date,
        });
      } catch {}
    }
  } catch {}

  return entries;
}

function findJsonlFiles(dir: string): string[] {
  const files: string[] = [];

  try {
    if (!fs.existsSync(dir)) return files;

    const walk = (currentDir: string) => {
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.name.endsWith(".jsonl")) files.push(fullPath);
      }
    };

    walk(dir);
  } catch {}

  return files;
}

function getCutoffDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatCompactNumber(value: number): string {
  const units = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "k" },
  ];

  for (const unit of units) {
    if (value < unit.threshold) continue;

    const scaled = value / unit.threshold;
    const decimals = scaled >= 100 ? 0 : 1;
    return `${scaled.toFixed(decimals).replace(/\.0$/, "")}${unit.suffix}`;
  }

  return Math.round(value).toString();
}

function formatPercent(value: number, total: number): string {
  if (total <= 0 || value <= 0) return "0%";

  const percent = (value / total) * 100;
  if (percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

function renderBar(value: number, total: number, width = 20): string {
  if (total <= 0 || value <= 0) return "";
  const count = Math.max(1, Math.round((value / total) * width));
  return "█".repeat(count);
}

function formatProjectName(filePath: string): string {
  const dirName = path.basename(path.dirname(filePath));
  const project = dirName
    .replace(/^--/, "")
    .replace(/--$/, "")
    .replace(/^Users-[^-]+-/, "")
    .replace(/^home-[^-]+-/, "")
    .replace(/^code-/, "");

  return project || "other";
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function truncateLabel(label: string, maxWidth = 40): string {
  if (label.length <= maxWidth) return label;
  return `${label.slice(0, maxWidth - 1)}…`;
}

function renderSection(title: string, rows: Array<[string, number]>, total: number): string[] {
  if (rows.length === 0 || total <= 0) return [];

  const formattedRows = rows.map(([label, value]) => ({
    label: truncateLabel(label),
    tokens: formatCompactNumber(value),
    percent: formatPercent(value, total),
    bar: renderBar(value, total),
  }));

  const labelWidth = Math.max(...formattedRows.map((row) => row.label.length));
  const tokenWidth = Math.max(...formattedRows.map((row) => row.tokens.length));
  const percentWidth = Math.max(...formattedRows.map((row) => row.percent.length));

  return [
    title,
    ...formattedRows.map(
      (row) =>
        `   ${row.label.padEnd(labelWidth)}  ${row.tokens.padStart(tokenWidth)}  ${row.percent.padStart(percentWidth)}  ${row.bar}`,
    ),
    "",
  ];
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("cost", {
    description: "Show token usage summary (default: 7 days). Usage: /cost [days]",
    handler: async (args, ctx) => {
      const days = args?.trim() ? parseInt(args.trim(), 10) : 7;
      if (isNaN(days) || days < 1) {
        ctx.ui.notify("Usage: /cost [days] — e.g. /cost 7", "error");
        return;
      }

      const cutoff = getCutoffDate(days);
      const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
      const files = findJsonlFiles(sessionsDir);

      let totalTokens = 0;
      let totalSessions = 0;
      const byDate: Record<string, number> = {};
      const byModel: Record<string, number> = {};
      const byProject: Record<string, number> = {};

      for (const filePath of files) {
        const entries = extractUsage(filePath).filter((entry) => entry.date >= cutoff);
        if (entries.length === 0) continue;

        totalSessions++;

        let sessionTokens = 0;
        for (const entry of entries) {
          sessionTokens += entry.tokens;
          byDate[entry.date] = (byDate[entry.date] ?? 0) + entry.tokens;
          byModel[entry.model] = (byModel[entry.model] ?? 0) + entry.tokens;
        }

        totalTokens += sessionTokens;
        const project = formatProjectName(filePath);
        byProject[project] = (byProject[project] ?? 0) + sessionTokens;
      }

      if (totalTokens === 0) {
        ctx.ui.notify(`No token usage found for the last ${days} days.`, "info");
        return;
      }

      const lines = [
        `🔢 Total: ${formatCompactNumber(totalTokens)} tokens  (${totalSessions} ${pluralize(totalSessions, "session")}, last ${days} days)`,
        "",
        ...renderSection(
          "📅 By date:",
          Object.entries(byDate).sort(([left], [right]) => left.localeCompare(right)),
          totalTokens,
        ),
        ...renderSection(
          "📁 By project:",
          Object.entries(byProject)
            .sort((left, right) => right[1] - left[1])
            .slice(0, 10),
          totalTokens,
        ),
        ...renderSection(
          "🤖 By model:",
          Object.entries(byModel).sort((left, right) => right[1] - left[1]),
          totalTokens,
        ),
      ];

      while (lines.at(-1) === "") lines.pop();
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
