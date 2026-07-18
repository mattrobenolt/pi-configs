import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { searchExa, searchJina, type BackendSearchResponse } from "./search.ts";

type CorpusEntry = {
  query: string;
  expectedUrls: string[];
  category: string;
};

type ProviderRun = {
  ok: boolean;
  latencyMs: number;
  urls: string[];
  titles: string[];
  exactRank: number | null;
  domainRank: number | null;
  error?: string;
};

type EvalRow = {
  query: string;
  category: string;
  expectedUrls: string[];
  exa: ProviderRun;
  jina: ProviderRun;
  overlap: number;
};

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith("--") && value) args.set(key.slice(2), value);
}

const limit = Number(args.get("limit") ?? "50");
const concurrency = Number(args.get("concurrency") ?? "3");
const sessionsRoot = args.get("sessions") ?? path.join(os.homedir(), ".pi", "agent", "sessions");
const outputPath =
  args.get("output") ?? path.join(os.tmpdir(), `pi-websearch-eval-${Date.now()}.json`);

const runtime = await ModelRuntime.create({
  authPath: path.join(
    process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent"),
    "auth.json",
  ),
  modelsPath: null,
  allowModelNetwork: false,
});
runtime.registerProvider("exa", { name: "Exa", apiKey: "$EXA_API_KEY" });
runtime.registerProvider("jina", { name: "Jina", apiKey: "$JINA_API_KEY" });
const [exaAuth, jinaAuth] = await Promise.all([runtime.getAuth("exa"), runtime.getAuth("jina")]);
const exaKey = exaAuth?.auth.apiKey;
const jinaKey = jinaAuth?.auth.apiKey;
if (!exaKey) throw new Error("Exa credential is unavailable");
if (!jinaKey) throw new Error("Jina credential is unavailable");

const availableCorpus = extractCorpus(sessionsRoot);
const corpus = sampleCorpus(availableCorpus, limit);
if (corpus.length === 0) throw new Error("No historical query/fetch pairs found");

const rows = await mapConcurrent(corpus, concurrency, async (entry, index) => {
  process.stderr.write(
    `[${index + 1}/${corpus.length}] ${entry.category}: ${entry.query.slice(0, 80)}\n`,
  );
  const params = { query: entry.query, numResults: 5, content: "none" as const };
  const [exa, jina] = await Promise.all([
    runProvider(() => searchExa(params, exaKey), entry.expectedUrls),
    runProvider(() => searchJina(params, jinaKey), entry.expectedUrls),
  ]);
  return {
    ...entry,
    exa,
    jina,
    overlap: jaccard(exa.urls.map(canonicalUrl), jina.urls.map(canonicalUrl)),
  } satisfies EvalRow;
});

const report = {
  generatedAt: new Date().toISOString(),
  corpus: {
    sessionsRoot,
    available: availableCorpus.length,
    sampled: rows.length,
    categories: countBy(rows.map((row) => row.category)),
  },
  methodology: {
    relevanceLabel:
      "A URL fetched after a historical websearch in the same turn is treated as relevant.",
    exactMatch: "Normalized fetched URL appears in the provider's top five results.",
    domainMatch: "Fetched URL domain appears in the provider's top five results.",
    heuristicScore:
      "Per query: 2 / exact-match rank, otherwise 1 / domain-match rank, otherwise 0. This is a historical-follow-up recall proxy, not a semantic quality judgment.",
  },
  summary: {
    exa: summarize(rows.map((row) => row.exa)),
    jina: summarize(rows.map((row) => row.jina)),
    meanTopFiveOverlap: mean(rows.map((row) => row.overlap)),
    heuristicComparison: heuristicComparison(rows),
  },
  rows,
};

fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ outputPath, ...report.summary }, null, 2));

function extractCorpus(root: string): CorpusEntry[] {
  const byQuery = new Map<string, Set<string>>();
  for (const file of findJsonl(root)) {
    let queries: string[] = [];
    let urls: string[] = [];
    const flush = () => {
      const uniqueQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
      if (uniqueQueries.length === 1 && urls.length > 0) {
        const query = uniqueQueries[0];
        const key = query.toLowerCase();
        const expected = byQuery.get(key) ?? new Set<string>();
        for (const url of urls) if (isHttpUrl(url)) expected.add(url);
        if (expected.size > 0) byQuery.set(key, expected);
      }
      queries = [];
      urls = [];
    };

    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      let row: any;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const message = row?.message;
      if (message?.role === "user") flush();
      if (!Array.isArray(message?.content)) continue;
      for (const item of message.content) {
        if (item?.type !== "toolCall") continue;
        const input = item.arguments ?? item.input ?? {};
        if (item.name === "websearch" && typeof input.query === "string") queries.push(input.query);
        if (item.name === "webfetch" && typeof input.url === "string") urls.push(input.url);
      }
    }
    flush();
  }

  return [...byQuery.entries()].map(([query, urls]) => ({
    query,
    expectedUrls: [...urls],
    category: categorize(query),
  }));
}

function sampleCorpus(corpus: CorpusEntry[], requested: number): CorpusEntry[] {
  const groups = new Map<string, CorpusEntry[]>();
  for (const entry of corpus) {
    const group = groups.get(entry.category) ?? [];
    group.push(entry);
    groups.set(entry.category, group);
  }
  for (const group of groups.values())
    group.sort((a, b) => stableHash(a.query) - stableHash(b.query));

  const categories = [...groups.keys()].sort();
  const selected: CorpusEntry[] = [];
  while (selected.length < requested) {
    let added = false;
    for (const category of categories) {
      const entry = groups.get(category)?.shift();
      if (!entry) continue;
      selected.push(entry);
      added = true;
      if (selected.length === requested) break;
    }
    if (!added) break;
  }
  return selected;
}

async function runProvider(
  search: () => Promise<BackendSearchResponse>,
  expectedUrls: string[],
): Promise<ProviderRun> {
  const started = performance.now();
  try {
    const response = await search();
    const urls = response.results.flatMap((result) => (result.url ? [result.url] : []));
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      urls,
      titles: response.results.map((result) => result.title ?? ""),
      exactRank: findRank(urls, expectedUrls, canonicalUrl),
      domainRank: findRank(urls, expectedUrls, canonicalDomain),
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      urls: [],
      titles: [],
      exactRank: null,
      domainRank: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarize(runs: ProviderRun[]) {
  const successes = runs.filter((run) => run.ok);
  const latencies = successes.map((run) => run.latencyMs).sort((a, b) => a - b);
  return {
    successRate: ratio(successes.length, runs.length),
    exactRecallAt5: ratio(runs.filter((run) => run.exactRank !== null).length, runs.length),
    exactMrrAt5: mean(runs.map((run) => (run.exactRank ? 1 / run.exactRank : 0))),
    domainRecallAt5: ratio(runs.filter((run) => run.domainRank !== null).length, runs.length),
    domainMrrAt5: mean(runs.map((run) => (run.domainRank ? 1 / run.domainRank : 0))),
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    failures: countBy(runs.flatMap((run) => (run.error ? [run.error] : []))),
  };
}

function heuristicComparison(rows: EvalRow[]) {
  let exa = 0;
  let jina = 0;
  let tie = 0;
  for (const row of rows) {
    const exaScore = row.exa.exactRank
      ? 2 / row.exa.exactRank
      : row.exa.domainRank
        ? 1 / row.exa.domainRank
        : 0;
    const jinaScore = row.jina.exactRank
      ? 2 / row.jina.exactRank
      : row.jina.domainRank
        ? 1 / row.jina.domainRank
        : 0;
    if (exaScore > jinaScore) exa += 1;
    else if (jinaScore > exaScore) jina += 1;
    else tie += 1;
  }
  return { exaHigher: exa, jinaHigher: jina, equal: tie };
}

function findRank(
  actual: string[],
  expected: string[],
  normalize: (value: string) => string,
): number | null {
  const labels = new Set(expected.map(normalize).filter(Boolean));
  const index = actual.findIndex((value) => labels.has(normalize(value)));
  return index < 0 ? null : index + 1;
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function canonicalDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function categorize(query: string): string {
  if (/\b(error|failed|failure|bug|timeout|unexpected|closed connection|crash)\b/i.test(query))
    return "debugging";
  if (/\b(CVE|vulnerability|security|privilege escalation|exploit)\b/i.test(query))
    return "security";
  if (/\b(latest|recent|news|202[4-9]|current)\b/i.test(query)) return "current";
  if (/\b(API|SDK|source|GitHub|Zig|Go|PostgreSQL|TypeScript|npm|library|package)\b/i.test(query))
    return "code-docs";
  if (/\b(research|study|guidance|best practices|framework|comparison|compare)\b/i.test(query))
    return "conceptual";
  return "general";
}

function findJsonl(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith(".jsonl")) files.push(fullPath);
    }
  };
  walk(root);
  return files;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left.filter(Boolean));
  const b = new Set(right.filter(Boolean));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return [...a].filter((value) => b.has(value)).length / union.size;
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function percentile(sorted: number[], percentileValue: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentileValue))];
}

async function mapConcurrent<T, R>(
  values: T[],
  workerCount: number,
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  results.length = values.length;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, workerCount) }, async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        results[index] = await fn(values[index], index);
      }
    }),
  );
  return results;
}
