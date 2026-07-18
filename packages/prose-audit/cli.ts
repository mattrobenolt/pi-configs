import fs from "node:fs/promises";

import { auditProse, GENRES, type Genre, type ProseAuditResult } from "./index.ts";

interface Options {
  input?: string;
  text?: string;
  genre: Genre;
  json: boolean;
}

function usage(): string {
  return `Usage: prose-audit [--json] [--genre GENRE] [--text TEXT | FILE | -]

Audit prose for explainable AI-style signals. The score is not an authorship probability.

Options:
  --json          Emit the complete result as JSON
  --genre GENRE   ${GENRES.join(", ")} (default: general)
  --text TEXT     Audit a literal string
  -h, --help      Show this help

Use '-' or omit FILE to read stdin.`;
}

function parseArgs(args: string[]): Options {
  const options: Options = { genre: "general", json: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--genre") {
      const value = args[++index];
      if (!value || !GENRES.includes(value as Genre)) {
        throw new Error(`--genre must be one of: ${GENRES.join(", ")}`);
      }
      options.genre = value as Genre;
      continue;
    }
    if (arg === "--text") {
      const value = args[++index];
      if (value === undefined) throw new Error("--text requires a value");
      options.text = value;
      continue;
    }
    if (arg.startsWith("-")) {
      if (arg === "-") {
        if (options.input) throw new Error("Provide only one input");
        options.input = arg;
        continue;
      }
      throw new Error(`Unknown option: ${arg}`);
    }
    if (options.input) throw new Error("Provide only one input");
    options.input = arg;
  }

  if (options.text !== undefined && options.input !== undefined) {
    throw new Error("Use either --text or a file/stdin input, not both");
  }
  return options;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function printHuman(result: ProseAuditResult): void {
  const score = result.synthetic_style_score ?? "n/a";
  process.stdout.write(
    `Synthetic style: ${score}/100 (${result.band}, ${result.confidence} confidence)\n`,
  );
  process.stdout.write(
    `${result.metrics.words} words · ${result.metrics.sentences} sentences · ${result.findings.length} findings\n`,
  );

  for (const finding of result.findings.slice(0, 20)) {
    process.stdout.write(
      `\n${finding.severity.toUpperCase()} ${finding.rule} at ${finding.line}:${finding.column}\n`,
    );
    process.stdout.write(`  ${finding.message}\n  “${finding.evidence}”\n`);
  }
  if (result.findings.length > 20) {
    process.stdout.write(`\n… ${result.findings.length - 20} more findings; use --json for all.\n`);
  }
  process.stdout.write(`\nCaveat: ${result.caveats[0]}\n`);
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const text =
      options.text ??
      (options.input && options.input !== "-"
        ? await fs.readFile(options.input, "utf8")
        : await readStdin());
    if (!text.trim()) throw new Error("Input is empty");

    const result = auditProse(text, { genre: options.genre });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printHuman(result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`prose-audit: ${message}\n`);
    process.exitCode = 2;
  }
}

await main();
