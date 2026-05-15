/**
 * webfetch extraction A/B harness.
 *
 * Usage:
 *   node --experimental-strip-types eval.ts [--corpus path/to/corpus.json] [--out path/to/output-dir]
 *
 * Variants run:
 *   webfetch-current   — uses packages/webfetch/core.ts helpers (transformContent)
 *   curlmd-general     — uses /tmp/curl-md-core src/md create() with profiles, no site rules
 *                        (skipped if /tmp/curl-md-core is not present)
 *
 * Outputs per run into --out (default: /tmp/webfetch-ab-<timestamp>):
 *   corpus.json
 *   summary.jsonl
 *   summary.csv
 *   report.md
 *   artifacts/<case-id>/<variant>.md
 *   artifacts/<case-id>/<variant>.json
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { transformContent } from "./core.ts";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    corpus: { type: "string", default: "./eval-corpus.json" },
    out: { type: "string" },
  },
  strict: false,
});

const corpusPath = args.corpus as string;
const outDir =
  (args.out as string | undefined) ??
  `/tmp/webfetch-ab-${new Date().toISOString().replace(/[:.]/g, "-")}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Case = {
  id: string;
  url: string;
  category: string;
  expected_contains?: string[];
  expected_absent_noise?: string[];
  objective?: string;
  notes?: string;
};

type Variant = "webfetch-current" | "curlmd-general";

type StructureMetrics = {
  headings: number;
  links: number;
  code_fences: number;
  tables: number;
  list_items: number;
};

type VariantResult = {
  variant: Variant;
  id: string;
  url: string;
  category: string;
  ok: boolean;
  elapsed_ms: number;
  source_bytes?: number;
  output_chars?: number;
  output_lines?: number;
  output_tokens?: number;
  contains_missing: string[];
  noise_present: string[];
  duplicate_line_ratio: number;
  structure: StructureMetrics;
  meta?: Record<string, unknown>;
  error?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  Accept:
    "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1",
  "Accept-Language": "en-US,en;q=0.9",
};

function estimateTokens(text: string): number {
  // Rough approximation: 1 token ≈ 4 chars.
  return Math.ceil(text.length / 4);
}

function countStructure(content: string): StructureMetrics {
  return {
    headings: (content.match(/^#{1,6}\s/gm) ?? []).length,
    links: (content.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length,
    code_fences: Math.round((content.match(/^```/gm) ?? []).length / 2),
    tables: (content.match(/^\|.*\|$/gm) ?? []).length,
    list_items: (content.match(/^\s*[-*+]\s/gm) ?? []).length,
  };
}

function duplicateLineRatio(content: string): number {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 20);
  if (!lines.length) return 0;
  return 1 - new Set(lines).size / lines.length;
}

function checkExpectations(
  content: string,
  c: Case,
): { contains_missing: string[]; noise_present: string[] } {
  const lower = content.toLowerCase();
  const contains_missing = (c.expected_contains ?? []).filter(
    (s) => !lower.includes(s.toLowerCase()),
  );
  const noise_present = (c.expected_absent_noise ?? []).filter((s) =>
    lower.includes(s.toLowerCase()),
  );
  return { contains_missing, noise_present };
}

// ---------------------------------------------------------------------------
// Variant: webfetch-current
// ---------------------------------------------------------------------------

async function runWebfetchCurrent(
  c: Case,
): Promise<{ content: string; meta: Record<string, unknown>; sourceBytes: number }> {
  const res = await fetch(c.url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  const sourceBytes = Buffer.byteLength(raw, "utf8");
  const content = await transformContent(raw, contentType, "markdown", c.url);
  return { content, meta: { contentType, sourceBytes }, sourceBytes };
}

// ---------------------------------------------------------------------------
// Variant: curlmd-general (optional, scratch only)
// ---------------------------------------------------------------------------

async function curlmdAvailable(): Promise<boolean> {
  try {
    await stat("/tmp/curl-md-core/src/md/mod.ts");
    return true;
  } catch {
    return false;
  }
}

async function runCurlmdGeneral(
  c: Case,
): Promise<{ content: string; meta: Record<string, unknown>; sourceBytes: number }> {
  // Dynamic import so the harness still runs when /tmp/curl-md-core is absent.
  const [{ create }, profiles, transports] = await Promise.all([
    import("/tmp/curl-md-core/src/md/mod.ts"),
    import("/tmp/curl-md-core/src/md/profiles.ts"),
    import("/tmp/curl-md-core/src/md/transports.ts"),
  ]);

  const md = create({
    profiles,
    headers: FETCH_HEADERS,
    transport: transports.fetch(),
  });

  const result = await md.fetch(c.url);
  if (!result.ok)
    throw new Error(`curlmd ${result.status}${result.error ? ` ${result.error}` : ""}`);
  const content = result.content;
  const sourceBytes = Buffer.byteLength(content, "utf8");
  return {
    content,
    meta: { ...result.meta, ...result.extras },
    sourceBytes,
  };
}

// ---------------------------------------------------------------------------
// Run a single variant for a single case (never throws)
// ---------------------------------------------------------------------------

async function runVariant(variant: Variant, c: Case): Promise<VariantResult & { content: string }> {
  const started = performance.now();
  try {
    const { content, meta, sourceBytes } =
      variant === "webfetch-current" ? await runWebfetchCurrent(c) : await runCurlmdGeneral(c);

    const elapsed_ms = Math.round(performance.now() - started);
    const { contains_missing, noise_present } = checkExpectations(content, c);

    return {
      variant,
      id: c.id,
      url: c.url,
      category: c.category,
      ok: true,
      elapsed_ms,
      source_bytes: sourceBytes,
      output_chars: content.length,
      output_lines: content.split("\n").length,
      output_tokens: estimateTokens(content),
      contains_missing,
      noise_present,
      duplicate_line_ratio: duplicateLineRatio(content),
      structure: countStructure(content),
      meta,
      content,
    };
  } catch (err) {
    return {
      variant,
      id: c.id,
      url: c.url,
      category: c.category,
      ok: false,
      elapsed_ms: Math.round(performance.now() - started),
      contains_missing: [],
      noise_present: [],
      duplicate_line_ratio: 0,
      structure: { headings: 0, links: 0, code_fences: 0, tables: 0, list_items: 0 },
      error: err instanceof Error ? err.message : String(err),
      content: "",
    };
  }
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function buildReport(
  rows: VariantResult[],
  variants: Variant[],
  corpus: Case[],
  outDir: string,
): string {
  const lines: string[] = [
    "# webfetch extraction A/B report",
    "",
    `Output: \`${outDir}\``,
    `Run: ${new Date().toISOString()}`,
    "",
    "## Aggregate",
    "",
    "| variant | ok | avg tokens | avg ms | missing expected | noise hits |",
    "|---|---:|---:|---:|---:|---:|",
  ];

  for (const v of variants) {
    const vRows = rows.filter((r) => r.variant === v);
    const okRows = vRows.filter((r) => r.ok);
    const avg = (key: keyof VariantResult) =>
      Math.round(
        okRows.reduce((s, r) => s + ((r[key] as number) ?? 0), 0) / Math.max(1, okRows.length),
      );
    const missing = okRows.reduce((s, r) => s + r.contains_missing.length, 0);
    const noise = okRows.reduce((s, r) => s + r.noise_present.length, 0);
    lines.push(
      `| ${v} | ${okRows.length}/${vRows.length} | ${avg("output_tokens")} | ${avg("elapsed_ms")} | ${missing} | ${noise} |`,
    );
  }

  lines.push("", "## Per-case token counts", "");
  const variantCols = variants.join(" | ");
  lines.push(`| id | category | ${variantCols} |`);
  lines.push(`|---|---|${variants.map(() => "---:").join("|")}|`);

  for (const c of corpus) {
    const cols = variants
      .map((v) => {
        const row = rows.find((r) => r.id === c.id && r.variant === v);
        if (!row) return "—";
        if (!row.ok) return `ERR: ${row.error?.slice(0, 40)}`;
        return String(row.output_tokens ?? "?");
      })
      .join(" | ");
    lines.push(`| ${c.id} | ${c.category} | ${cols} |`);
  }

  lines.push("", "## Failures", "");
  const failures = rows.filter((r) => !r.ok);
  if (failures.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| variant | id | error |", "|---|---|---|");
    for (const f of failures) lines.push(`| ${f.variant} | ${f.id} | ${f.error} |`);
  }

  lines.push("", "## Missing expected content", "");
  const missing = rows.filter((r) => r.ok && r.contains_missing.length > 0);
  if (missing.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| variant | id | missing |", "|---|---|---|");
    for (const m of missing)
      lines.push(`| ${m.variant} | ${m.id} | ${m.contains_missing.join(", ")} |`);
  }

  return lines.join("\n");
}

function buildCsv(rows: VariantResult[]): string {
  const keys: (keyof VariantResult)[] = [
    "variant",
    "id",
    "category",
    "ok",
    "elapsed_ms",
    "output_tokens",
    "output_chars",
    "output_lines",
    "duplicate_line_ratio",
    "error",
  ];
  const header = keys.join(",");
  const dataRows = rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(","));
  return [header, ...dataRows].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const corpus: Case[] = JSON.parse(await readFile(corpusPath, "utf8"));
const hasCurlmd = await curlmdAvailable();
const variants: Variant[] = hasCurlmd
  ? ["webfetch-current", "curlmd-general"]
  : ["webfetch-current"];

if (!hasCurlmd) {
  console.error(
    "ℹ  /tmp/curl-md-core not found — running webfetch-current only. Clone curl.md to /tmp/curl-md-core and run again to compare.",
  );
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "corpus.json"), JSON.stringify(corpus, null, 2));

const rows: VariantResult[] = [];

for (const c of corpus) {
  const artifactDir = path.join(outDir, "artifacts", c.id);
  await mkdir(artifactDir, { recursive: true });

  for (const variant of variants) {
    process.stderr.write(`  ${c.id} / ${variant} … `);
    const result = await runVariant(variant, c);
    const { content, ...row } = result;
    rows.push(row);
    process.stderr.write(result.ok ? `${row.output_tokens} tokens\n` : `ERR: ${row.error}\n`);

    await writeFile(path.join(artifactDir, `${variant}.md`), content ?? "");
    await writeFile(path.join(artifactDir, `${variant}.json`), JSON.stringify(row, null, 2));
  }
}

const report = buildReport(rows, variants, corpus, outDir);
const summaryJsonl = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const csv = buildCsv(rows);

await writeFile(path.join(outDir, "summary.jsonl"), summaryJsonl);
await writeFile(path.join(outDir, "summary.csv"), csv);
await writeFile(path.join(outDir, "report.md"), report);

console.log(outDir);
console.log(report);
