import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const DEFAULT_ROOT = path.join(os.homedir(), ".pi", "agent", "planetscale-knowledge");
const DEFAULT_PLANETSCALE_ROOT = path.join(os.homedir(), "code", "planetscale");
const DEFAULT_COLLECTION = "planetscale-knowledge";
const RESTRICTED_COLLECTION = "planetscale-knowledge-restricted";
const SOURCE_CONFIG = "sources.json";
const CATALOG_FILE = "catalog.json";
const CLAIMS_FILE = "claims.jsonl";

export type Audience = "public" | "internal" | "restricted";
export type ClaimKind = "fact" | "hypothesis";

export interface KnowledgeSource {
  id: string;
  path: string;
  kind: string;
  authority: string;
  audience: Audience;
}

interface SourceConfig {
  sources: KnowledgeSource[];
}

interface CatalogEntry {
  claimId?: string;
  sourceId?: string;
  originalPath?: string;
  sourceHash?: string;
  kind: "source" | ClaimKind;
  audience: Audience;
  authority?: string;
  createdAt?: string;
  updatedAt?: string;
  claim?: string;
  basis?: string;
  provenance?: Provenance;
}

interface Provenance {
  sourceId?: string;
  sourcePath?: string;
  sourceHash?: string;
  sourceUrl?: string;
  sourceKind: string; // "file" | "slack" | "user"
  quote?: string;
  line?: number;
  authority?: string;
}

interface StoredClaim {
  id: string;
  kind: ClaimKind;
  statement: string;
  tags: string[];
  audience: Audience;
  basis?: string;
  provenance?: Provenance;
  createdAt: string;
  updatedAt?: string;
}

interface QmdResult {
  file?: string;
  path?: string;
  score?: number;
  title?: string;
  snippet?: string;
  content?: string;
}

export function knowledgeRoot(): string {
  return process.env.PI_PLANETSCALE_KNOWLEDGE_DIR ?? DEFAULT_ROOT;
}

function packageDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function seedSourceConfig(): string {
  return path.join(packageDir(), "seed", SOURCE_CONFIG);
}

function sourceConfigPath(root = knowledgeRoot()): string {
  return path.join(root, SOURCE_CONFIG);
}

function claimsPath(root = knowledgeRoot()): string {
  return path.join(root, CLAIMS_FILE);
}

function corpusBucket(audience: Audience): "default" | "restricted" {
  return audience === "restricted" ? "restricted" : "default";
}

function catalogPath(audience: Audience, root = knowledgeRoot()): string {
  return path.join(root, "corpus", corpusBucket(audience), CATALOG_FILE);
}

function corpusPath(audience: Audience, root = knowledgeRoot()): string {
  return path.join(root, "corpus", corpusBucket(audience));
}

export function expandSourcePath(value: string): string {
  return value
    .replaceAll("$PLANETSCALE_ROOT", process.env.PLANETSCALE_ROOT ?? DEFAULT_PLANETSCALE_ROOT)
    .replace(/^~(?=\/|$)/, os.homedir());
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function lineOfQuote(content: string, quote: string): number | null {
  const offset = content.indexOf(quote);
  if (offset === -1) return null;
  return content.slice(0, offset).split("\n").length;
}

export function formatAge(recordedAt: string, now = Date.now()): string {
  const timestamp = Date.parse(recordedAt);
  if (Number.isNaN(timestamp)) return "unknown age";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "just recorded";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} old`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} old`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} old`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} old`;

  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} old`;
}

function formatProvenanceShort(provenance: Provenance): string {
  const kind = provenance.sourceKind ?? "file";
  if (kind === "user") return "Provenance: stated by user (operator)";
  if (kind === "slack" || provenance.sourceUrl) return `Provenance: ${provenance.sourceUrl}`;
  return `Provenance: ${provenance.sourcePath}:${provenance.line}`;
}

function formatProvenanceFull(provenance: Provenance): string {
  const kind = provenance.sourceKind ?? "file";
  if (kind === "user") {
    return "\n## Provenance\n\nSource: stated by user (operator)";
  }
  if (kind === "slack" || provenance.sourceUrl) {
    return `\n## Provenance\n\nSource: ${provenance.sourceUrl}\n\n> ${provenance.quote?.replaceAll("\n", "\n> ") ?? ""}`;
  }
  return `\n## Provenance\n\nSource: \`${provenance.sourcePath}\`:${provenance.line}\n\n> ${provenance.quote?.replaceAll("\n", "\n> ") ?? ""}`;
}

export function validateClaim(
  input: Pick<StoredClaim, "kind" | "statement" | "basis"> & {
    sourceId?: string;
    sourceQuote?: string;
    sourcePath?: string;
    sourceUrl?: string;
    sourceKind?: string;
  },
): string | null {
  if (!input.statement.trim()) return "statement is required";
  if (input.kind === "hypothesis") {
    if (!input.basis?.trim()) return "hypotheses require basis; they are not facts";
    return null;
  }

  // Facts require a source of some kind.
  const hasSourceId = Boolean(input.sourceId?.trim());
  const hasSourcePath = Boolean(input.sourcePath?.trim());
  const hasSourceUrl = Boolean(input.sourceUrl?.trim());
  const isUserStated = input.sourceKind === "user";

  if (!hasSourceId && !hasSourcePath && !hasSourceUrl && !isUserStated) {
    return "facts require a source: source_id (configured), source_path (ad-hoc file), source_url (Slack/web), or source_kind='user'";
  }

  // File-based and URL-based sources require a verbatim quote.
  if (hasSourceId || hasSourcePath || hasSourceUrl) {
    if (!input.sourceQuote?.trim()) {
      return "source_quote is required for file-based and URL-based facts";
    }
    if (
      !input
        .sourceQuote!.replaceAll(/\s+/g, " ")
        .includes(input.statement.trim().replaceAll(/\s+/g, " "))
    ) {
      return "facts must appear verbatim in source_quote; otherwise record a hypothesis with basis";
    }
  }

  return null;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function ensureRoot(root = knowledgeRoot()): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  if (!existsSync(sourceConfigPath(root))) {
    await fs.copyFile(seedSourceConfig(), sourceConfigPath(root));
  }
}

async function loadSources(root = knowledgeRoot()): Promise<KnowledgeSource[]> {
  await ensureRoot(root);
  const config = await readJson<SourceConfig>(sourceConfigPath(root), { sources: [] });
  return config.sources.filter(
    (source): source is KnowledgeSource =>
      typeof source.id === "string" &&
      typeof source.path === "string" &&
      typeof source.kind === "string" &&
      typeof source.authority === "string" &&
      (source.audience === "public" ||
        source.audience === "internal" ||
        source.audience === "restricted"),
  );
}

function collectionFor(audience: Audience): string {
  return audience === "restricted" ? RESTRICTED_COLLECTION : DEFAULT_COLLECTION;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function renderSource(
  source: KnowledgeSource,
  originalPath: string,
  sourceHash: string,
  content: string,
): string {
  return [
    "---",
    "knowledge-kind: source",
    `source-id: ${quoteYaml(source.id)}`,
    `source-path: ${quoteYaml(originalPath)}`,
    `source-hash: ${sourceHash}`,
    `source-kind: ${quoteYaml(source.kind)}`,
    `authority: ${quoteYaml(source.authority)}`,
    `audience: ${source.audience}`,
    "---",
    "",
    content,
  ].join("\n");
}

function renderClaim(claim: StoredClaim): string {
  const provenance = claim.provenance;
  return [
    "---",
    `knowledge-kind: ${claim.kind}`,
    `claim-id: ${claim.id}`,
    `audience: ${claim.audience}`,
    `created-at: ${claim.createdAt}`,
    claim.updatedAt ? `updated-at: ${claim.updatedAt}` : "",
    `tags: ${quoteYaml(claim.tags.join(", "))}`,
    provenance?.sourceId ? `source-id: ${quoteYaml(provenance.sourceId)}` : "",
    provenance?.sourcePath ? `source-path: ${quoteYaml(provenance.sourcePath)}` : "",
    provenance?.sourceHash ? `source-hash: ${provenance.sourceHash}` : "",
    provenance?.sourceUrl ? `source-url: ${quoteYaml(provenance.sourceUrl)}` : "",
    provenance?.sourceKind ? `source-kind: ${quoteYaml(provenance.sourceKind)}` : "",
    "---",
    "",
    `# ${claim.kind === "fact" ? "Fact" : "Hypothesis"}`,
    "",
    claim.statement,
    claim.basis ? `\n## Basis\n\n${claim.basis}` : "",
    provenance ? formatProvenanceFull(provenance) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function readClaims(root = knowledgeRoot()): Promise<StoredClaim[]> {
  try {
    const raw = await fs.readFile(claimsPath(root), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as StoredClaim];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function writeClaims(claims: StoredClaim[], root = knowledgeRoot()): Promise<void> {
  const file = claimsPath(root);
  const temporary = `${file}.${randomUUID()}.tmp`;
  const content =
    claims.length > 0 ? `${claims.map((claim) => JSON.stringify(claim)).join("\n")}\n` : "";
  await fs.writeFile(temporary, content);
  await fs.rename(temporary, file);
}

async function writeCatalog(
  audience: Audience,
  entries: Record<string, CatalogEntry>,
  root: string,
) {
  const dir = corpusPath(audience, root);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(catalogPath(audience, root), `${JSON.stringify(entries, null, 2)}\n`);
}

async function materializeClaims(root: string): Promise<void> {
  const claims = await readClaims(root);
  const catalogs = new Map<"default" | "restricted", Record<string, CatalogEntry>>([
    ["default", await readJson(catalogPath("internal", root), {})],
    ["restricted", await readJson(catalogPath("restricted", root), {})],
  ]);

  for (const audience of ["internal", "restricted"] as const) {
    await fs.rm(path.join(corpusPath(audience, root), "claims"), { recursive: true, force: true });
    const catalog = catalogs.get(corpusBucket(audience))!;
    for (const [key, entry] of Object.entries(catalog)) {
      if (entry.kind !== "source") delete catalog[key];
    }
  }

  for (const claim of claims) {
    const audience = claim.audience ?? "internal";
    const file = path.join(corpusPath(audience, root), "claims", `${claim.id}.md`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, renderClaim(claim));
    catalogs.get(corpusBucket(audience))![path.relative(corpusPath(audience, root), file)] = {
      claimId: claim.id,
      kind: claim.kind,
      audience,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      claim: claim.statement,
      basis: claim.basis,
      provenance: claim.provenance,
    };
  }

  await writeCatalog("internal", catalogs.get("default")!, root);
  await writeCatalog("restricted", catalogs.get("restricted")!, root);
}

async function resolveProvenance(
  input: {
    sourceId?: string;
    sourceQuote?: string;
    sourcePath?: string;
    sourceUrl?: string;
    sourceKind?: string;
  },
  sources: KnowledgeSource[],
): Promise<{ provenance: Provenance; audience: Audience }> {
  const kind = input.sourceKind ?? "file";

  if (kind === "user") {
    return {
      provenance: { sourceKind: "user", authority: "operator" },
      audience: "internal",
    };
  }

  if (input.sourceUrl) {
    return {
      provenance: {
        sourceKind: kind,
        sourceUrl: input.sourceUrl,
        quote: input.sourceQuote,
      },
      audience: "internal",
    };
  }

  if (input.sourcePath) {
    const expandedPath = expandSourcePath(input.sourcePath);
    const content = await fs.readFile(expandedPath, "utf8");
    const line = lineOfQuote(content, input.sourceQuote!);
    if (line === null) throw new Error(`source_quote was not found exactly in ${expandedPath}`);
    return {
      provenance: {
        sourceKind: "file",
        sourcePath: expandedPath,
        sourceHash: sha256(content),
        quote: input.sourceQuote,
        line,
      },
      audience: "internal",
    };
  }

  // Configured source (source_id)
  if (input.sourceId) {
    const source = sources.find((item) => item.id === input.sourceId);
    if (!source) throw new Error(`Unknown source_id: ${input.sourceId}`);
    const sourcePath = expandSourcePath(source.path);
    const content = await fs.readFile(sourcePath, "utf8");
    const line = lineOfQuote(content, input.sourceQuote!);
    if (line === null) throw new Error(`source_quote was not found exactly in ${sourcePath}`);
    return {
      provenance: {
        sourceKind: "file",
        sourceId: source.id,
        sourcePath,
        sourceHash: sha256(content),
        quote: input.sourceQuote,
        line,
        authority: source.authority,
      },
      audience: source.audience,
    };
  }

  throw new Error("No source provided for fact");
}

interface RecordUpdate {
  kind?: ClaimKind;
  statement?: string;
  tags?: string[];
  basis?: string;
  clearBasis?: boolean;
  sourceId?: string;
  sourceQuote?: string;
  sourcePath?: string;
  sourceUrl?: string;
  sourceKind?: string;
}

export async function updateClaim(
  current: StoredClaim,
  update: RecordUpdate,
  sources: KnowledgeSource[],
): Promise<StoredClaim> {
  const hasSourceUpdate =
    update.sourceId !== undefined ||
    update.sourceQuote !== undefined ||
    update.sourcePath !== undefined ||
    update.sourceUrl !== undefined ||
    update.sourceKind !== undefined;

  const kind = update.kind ?? current.kind;
  const statement = update.statement?.trim() || current.statement;
  const basis = update.clearBasis ? undefined : (update.basis?.trim() ?? current.basis);
  const sourceId = update.sourceId ?? current.provenance?.sourceId;
  const sourceQuote = update.sourceQuote ?? current.provenance?.quote;
  const sourcePath = update.sourcePath ?? current.provenance?.sourcePath;
  const sourceUrl = update.sourceUrl ?? current.provenance?.sourceUrl;
  const sourceKind = update.sourceKind ?? current.provenance?.sourceKind;
  const validation = validateClaim({
    kind,
    statement,
    basis,
    sourceId,
    sourceQuote,
    sourcePath,
    sourceUrl,
    sourceKind,
  });
  if (validation) throw new Error(validation);

  let provenance = current.provenance;
  let audience = current.audience ?? "internal";
  if (hasSourceUpdate) {
    const resolved = await resolveProvenance(
      { sourceId, sourceQuote, sourcePath, sourceUrl, sourceKind },
      sources,
    );
    provenance = resolved.provenance;
    audience = resolved.audience;
  }

  return {
    ...current,
    kind,
    statement,
    tags: update.tags?.map((tag) => tag.trim()).filter(Boolean) ?? current.tags,
    basis,
    provenance,
    audience,
    updatedAt: new Date().toISOString(),
  };
}

export async function syncSources(
  includeRestricted = false,
  root = knowledgeRoot(),
): Promise<{ synced: string[]; skipped: string[] }> {
  await ensureRoot(root);
  const sources = await loadSources(root);
  const audiences: Audience[] = includeRestricted
    ? ["public", "internal", "restricted"]
    : ["public", "internal"];
  const synced: string[] = [];
  const skipped: string[] = [];

  for (const audience of ["internal", "restricted"] as const) {
    const selectedSources = sources.filter(
      (source) =>
        audiences.includes(source.audience) &&
        corpusBucket(source.audience) === corpusBucket(audience),
    );
    if (selectedSources.length === 0 && audience === "restricted" && !includeRestricted) continue;

    const sourceDir = path.join(corpusPath(audience, root), "sources");
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.mkdir(sourceDir, { recursive: true });
    const catalog = await readJson<Record<string, CatalogEntry>>(catalogPath(audience, root), {});
    for (const key of Object.keys(catalog)) {
      if (catalog[key].kind === "source") delete catalog[key];
    }

    for (const source of selectedSources) {
      const originalPath = expandSourcePath(source.path);
      try {
        const content = await fs.readFile(originalPath, "utf8");
        const sourceHash = sha256(content);
        const file = path.join(sourceDir, `${safeName(source.id)}.md`);
        await fs.writeFile(file, renderSource(source, originalPath, sourceHash, content));
        catalog[path.relative(corpusPath(audience, root), file)] = {
          sourceId: source.id,
          originalPath,
          sourceHash,
          kind: "source",
          audience: source.audience,
          authority: source.authority,
        };
        synced.push(source.id);
      } catch {
        skipped.push(`${source.id} (${originalPath})`);
      }
    }
    await writeCatalog(audience, catalog, root);
  }

  await materializeClaims(root);
  return { synced, skipped };
}

async function runQmd(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("qmd", args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

async function qmdAvailable(): Promise<boolean> {
  try {
    await runQmd(["status"]);
    return true;
  } catch {
    return false;
  }
}

async function collectionExists(name: string): Promise<boolean> {
  try {
    const raw = await runQmd(["collection", "list", "--json"]);
    try {
      const collections = JSON.parse(raw) as Array<string | { name?: string }>;
      return collections.some((entry) =>
        typeof entry === "string" ? entry === name : entry.name === name,
      );
    } catch {
      return raw.split("\n").some((line) => line.startsWith(`${name} (`));
    }
  } catch {
    return false;
  }
}

async function configuredCollectionPath(name: string): Promise<string | null> {
  try {
    const output = await runQmd(["collection", "show", name]);
    const match = output.match(/^\s*Path:\s+(.+)$/m);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

async function ensureCollection(audience: Audience, root: string): Promise<void> {
  const name = collectionFor(audience);
  const expectedPath = corpusPath(audience, root);
  if (await collectionExists(name)) {
    if ((await configuredCollectionPath(name)) === expectedPath) return;
    await runQmd(["collection", "remove", name]);
  }
  await runQmd(["collection", "add", expectedPath, "--name", name]);
}

async function updateIndex(includeRestricted: boolean, root: string): Promise<void> {
  for (const audience of includeRestricted
    ? (["public", "internal", "restricted"] as const)
    : (["public", "internal"] as const)) {
    await ensureCollection(audience, root);
  }
  await runQmd(["update"]);
}

// Every mutation touches the same shared state (claims.jsonl, the corpus
// claims/ directories, the qmd index), and `qmd update` is not safe to run
// concurrently against a single index: parallel runs race document inserts
// against orphan-content cleanup and fail with FK/PK constraint errors.
// Serialize mutations in process; parallel tool calls just queue up.
let mutationQueue: Promise<unknown> = Promise.resolve();

function serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(() => mutation());
  mutationQueue = result.catch(() => {});
  return result;
}

function pathFromQmdUri(value: string | undefined, collection: string): string | null {
  if (!value) return null;
  const prefix = `qmd://${collection}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

async function searchCollection(
  query: string,
  mode: "keyword" | "deep",
  collection: string,
  limit: number,
): Promise<QmdResult[]> {
  const command = mode === "keyword" ? "search" : "query";
  const raw = await runQmd([command, "--json", "-c", collection, "-n", String(limit), query]);
  const parsed = JSON.parse(raw) as QmdResult[];
  return Array.isArray(parsed) ? parsed : [];
}

async function provenanceStatus(entry: CatalogEntry | undefined): Promise<string | null> {
  const kind = entry?.provenance?.sourceKind ?? "file";
  if (kind === "user" || kind === "slack" || kind === "notion") return null; // no file to verify
  const sourcePath = entry?.originalPath ?? entry?.provenance?.sourcePath;
  const sourceHash = entry?.sourceHash ?? entry?.provenance?.sourceHash;
  if (!sourcePath || !sourceHash) return null;
  try {
    return sha256(await fs.readFile(sourcePath, "utf8")) === sourceHash ? "current" : "stale";
  } catch {
    return "missing";
  }
}

function formatResult(
  result: QmdResult,
  entry: CatalogEntry | undefined,
  sourceStatus: string | null,
): string {
  const lines = [
    `### ${entry?.kind === "hypothesis" ? "Hypothesis" : entry?.kind === "fact" ? "Fact" : "Evidence"}`,
    `Source: ${entry?.originalPath ?? entry?.provenance?.sourcePath ?? result.file ?? "unknown"}`,
    entry?.sourceId ? `Source ID: ${entry.sourceId}` : "",
    entry?.authority ? `Authority: ${entry.authority}` : "",
    entry?.claimId ? `Record ID: ${entry.claimId}` : "",
    entry?.createdAt ? `Age: ${formatAge(entry.createdAt)}` : "",
    entry?.updatedAt ? `Updated: ${formatAge(entry.updatedAt)}` : "",
    `Audience: ${entry?.audience ?? "unknown"}`,
    entry?.provenance ? formatProvenanceShort(entry.provenance) : "",
    entry?.provenance?.quote ? `Supporting quote: ${JSON.stringify(entry.provenance.quote)}` : "",
    sourceStatus ? `Source status: ${sourceStatus}` : "",
    result.score == null ? "" : `Score: ${result.score}`,
    "",
    entry?.claim ?? result.snippet ?? result.content ?? "(no excerpt)",
  ].filter(Boolean);
  if (entry?.kind === "hypothesis")
    lines.splice(1, 0, "This is an explicitly labeled hypothesis, not a fact.");
  if (entry?.kind === "source")
    lines.splice(
      1,
      0,
      "This is primary evidence; the model must cite it rather than inventing a claim.",
    );
  return lines.join("\n");
}

async function searchKnowledge(
  query: string,
  mode: "keyword" | "deep",
  includeRestricted: boolean,
  limit: number,
  root = knowledgeRoot(),
): Promise<string> {
  const collections = includeRestricted
    ? [DEFAULT_COLLECTION, RESTRICTED_COLLECTION]
    : [DEFAULT_COLLECTION];
  const results = await Promise.all(
    collections.map(async (collection) => ({
      collection,
      results: await searchCollection(query, mode, collection, limit),
    })),
  );
  const matches: Array<{ hit: QmdResult; entry: CatalogEntry | undefined }> = [];
  for (const { collection, results: hits } of results) {
    const audience: Audience = collection === RESTRICTED_COLLECTION ? "restricted" : "internal";
    const catalog = await readJson<Record<string, CatalogEntry>>(catalogPath(audience, root), {});
    for (const hit of hits) {
      const relativePath = pathFromQmdUri(hit.file ?? hit.path, collection);
      matches.push({ hit, entry: relativePath ? catalog[relativePath] : undefined });
    }
  }

  const formatted = await Promise.all(
    matches
      .sort((left, right) => (right.hit.score ?? 0) - (left.hit.score ?? 0))
      .slice(0, limit)
      .map(async ({ hit, entry }) => formatResult(hit, entry, await provenanceStatus(entry))),
  );
  return formatted.length > 0
    ? formatted.join("\n\n---\n\n")
    : `No knowledge results for ${JSON.stringify(query)}.`;
}

export default function planetscaleKnowledgeExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "planetscale_knowledge_status",
    label: "PlanetScale Knowledge Status",
    description:
      "Show the local PlanetScale knowledge corpus configuration and whether qmd is available.",
    parameters: Type.Object({}),
    async execute() {
      const root = knowledgeRoot();
      const sources = await loadSources(root);
      return {
        content: [
          {
            type: "text",
            text: [
              `Knowledge root: ${root}`,
              `qmd: ${(await qmdAvailable()) ? "available" : "unavailable"}`,
              `Sources (${sources.length}):`,
              ...sources.map(
                (source) =>
                  `- ${source.id} [${source.audience}/${source.authority}] ${expandSourcePath(source.path)}`,
              ),
              `Claims: ${(await readClaims(root)).length}`,
            ].join("\n"),
          },
        ],
        details: { root, sources, claims: (await readClaims(root)).length },
      };
    },
  });

  pi.registerTool({
    name: "planetscale_knowledge_sync",
    label: "PlanetScale Knowledge Sync",
    description:
      "Materialize configured PlanetScale sources into a local qmd corpus. Restricted sources require include_restricted=true.",
    parameters: Type.Object({
      include_restricted: Type.Optional(
        Type.Boolean({ description: "Include configured restricted incident sources." }),
      ),
    }),
    async execute(_id, params) {
      return serializeMutation(async () => {
        if (!(await qmdAvailable()))
          throw new Error("qmd is required. Add it to the dev shell or make it available on PATH.");
        const root = knowledgeRoot();
        const includeRestricted = params.include_restricted ?? false;
        const result = await syncSources(includeRestricted, root);
        await updateIndex(includeRestricted, root);
        return {
          content: [
            {
              type: "text",
              text: [
                `Synced ${result.synced.length} source(s): ${result.synced.join(", ") || "none"}.`,
                result.skipped.length > 0 ? `Skipped: ${result.skipped.join(", ")}` : "",
                "The corpus preserves each source path and SHA-256 alongside every indexed document.",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          details: result,
        };
      });
    },
  });

  pi.registerTool({
    name: "planetscale_knowledge_search",
    label: "PlanetScale Knowledge Search",
    description:
      "Search the local PlanetScale knowledge corpus. Results distinguish evidence, facts, and hypotheses, and include provenance. Use include_restricted only for incident/restricted context.",
    promptSnippet: "Search cited PlanetScale product, architecture, and incident knowledge",
    promptGuidelines: [
      "Use planetscale_knowledge_search before relying on PlanetScale-specific nomenclature, architecture, previous incidents, or decisions.",
      "Treat planetscale_knowledge_search hypotheses as guesses, not facts; cite the returned evidence path when making factual claims.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description: "PlanetScale term, concept, question, or incident symptom to retrieve.",
      }),
      mode: Type.Optional(
        StringEnum(["keyword", "deep"] as const, {
          description: "keyword is fast exact retrieval; deep uses qmd hybrid retrieval.",
        }),
      ),
      include_restricted: Type.Optional(
        Type.Boolean({ description: "Search restricted incident context too." }),
      ),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 10, description: "Maximum result count." }),
      ),
    }),
    async execute(_id, params) {
      if (!(await qmdAvailable()))
        throw new Error("qmd is required. Run planetscale_knowledge_sync after qmd is available.");
      const root = knowledgeRoot();
      if (!(await collectionExists(DEFAULT_COLLECTION))) {
        throw new Error(
          "PlanetScale knowledge has not been synced. Call planetscale_knowledge_sync first.",
        );
      }
      if (params.include_restricted && !(await collectionExists(RESTRICTED_COLLECTION))) {
        throw new Error(
          "Restricted knowledge has not been synced. Call planetscale_knowledge_sync with include_restricted=true first.",
        );
      }
      const text = await searchKnowledge(
        params.query,
        params.mode ?? "deep",
        params.include_restricted ?? false,
        params.limit ?? 5,
        root,
      );
      return {
        content: [{ type: "text", text }],
        details: {
          query: params.query,
          mode: params.mode ?? "deep",
          includeRestricted: params.include_restricted ?? false,
        },
      };
    },
  });

  pi.registerTool({
    name: "planetscale_knowledge_record",
    label: "PlanetScale Knowledge Record",
    description:
      "Record a provenance-bound fact or explicitly labeled hypothesis. Facts require a source: a configured source_id with verbatim source_quote, an ad-hoc source_path with verbatim source_quote, a source_url (e.g. Slack permalink) with source_quote, or source_kind='user' for user-stated facts. Hypotheses require a basis and are never rendered as facts.",
    parameters: Type.Object({
      kind: StringEnum(["fact", "hypothesis"] as const, {
        description:
          "fact requires a verbatim source quote; hypothesis is an explicitly non-factual guess.",
      }),
      statement: Type.String({
        description:
          "Fact statement, which must appear verbatim in source_quote; or a concise hypothesis.",
        maxLength: 2_000,
      }),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Search aliases or PlanetScale vocabulary terms.",
        }),
      ),
      basis: Type.Optional(
        Type.String({
          description: "Required for hypotheses: why this might be true.",
          maxLength: 4_000,
        }),
      ),
      source_id: Type.Optional(
        Type.String({ description: "Configured source ID (pre-registered in sources.json)." }),
      ),
      source_quote: Type.Optional(
        Type.String({
          description:
            "Exact source text containing the fact statement verbatim. Required for file-based and URL-based facts, verified before storage.",
          maxLength: 8_000,
        }),
      ),
      source_path: Type.Optional(
        Type.String({
          description:
            "Ad-hoc file path for provenance. The file is read and the quote verified, but the source doesn't need to be pre-registered.",
        }),
      ),
      source_url: Type.Optional(
        Type.String({
          description:
            "URL for provenance (e.g., Slack message permalink). Paired with source_quote containing the exact message text.",
        }),
      ),
      source_kind: Type.Optional(
        StringEnum(["file", "slack", "notion", "user"] as const, {
          description:
            "Type of provenance. 'file' (default) reads and verifies a file. 'slack' stores a URL + quote. 'notion' stores a Notion page URL + quote. 'user' records a user-stated fact with no external verification.",
        }),
      ),
    }),
    async execute(_id, params) {
      return serializeMutation(async () => {
        const error = validateClaim({
          kind: params.kind,
          statement: params.statement,
          basis: params.basis,
          sourceId: params.source_id,
          sourceQuote: params.source_quote,
          sourcePath: params.source_path,
          sourceUrl: params.source_url,
          sourceKind: params.source_kind,
        });
        if (error) throw new Error(error);

        const root = knowledgeRoot();
        const sources = await loadSources(root);

        let provenance: Provenance | undefined;
        let audience: Audience = "internal";
        if (params.kind === "fact") {
          const resolved = await resolveProvenance(
            {
              sourceId: params.source_id,
              sourceQuote: params.source_quote,
              sourcePath: params.source_path,
              sourceUrl: params.source_url,
              sourceKind: params.source_kind,
            },
            sources,
          );
          provenance = resolved.provenance;
          audience = resolved.audience;
        }

        const claim: StoredClaim = {
          id: randomUUID(),
          kind: params.kind,
          statement: params.statement.trim(),
          tags: params.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
          audience,
          basis: params.basis?.trim(),
          provenance,
          createdAt: new Date().toISOString(),
        };
        await ensureRoot(root);
        await fs.appendFile(claimsPath(root), `${JSON.stringify(claim)}\n`);
        await materializeClaims(root);
        if (await qmdAvailable()) await updateIndex(audience === "restricted", root);

        return {
          content: [
            {
              type: "text",
              text:
                claim.kind === "fact" && provenance
                  ? `Recorded fact: ${formatProvenanceShort(provenance).replace("Provenance: ", "")}`
                  : "Recorded hypothesis. It will always be labeled as a hypothesis, not a fact.",
            },
          ],
          details: claim,
        };
      });
    },
  });

  pi.registerTool({
    name: "planetscale_knowledge_update",
    label: "PlanetScale Knowledge Update",
    description:
      "Edit a stored fact or hypothesis by record ID. Facts remain provenance-bound and are revalidated when their source changes. Edits preserve the original creation date and record an updated timestamp.",
    parameters: Type.Object({
      id: Type.String({
        description:
          "Record ID returned by planetscale_knowledge_search or planetscale_knowledge_record.",
      }),
      kind: Type.Optional(
        StringEnum(["fact", "hypothesis"] as const, { description: "New record type." }),
      ),
      statement: Type.Optional(
        Type.String({ description: "Replacement statement.", maxLength: 2_000 }),
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Replacement tags; use an empty array to clear.",
        }),
      ),
      basis: Type.Optional(
        Type.String({ description: "Replacement hypothesis basis.", maxLength: 4_000 }),
      ),
      clear_basis: Type.Optional(
        Type.Boolean({
          description: "Clear the existing basis. A hypothesis cannot have an empty basis.",
        }),
      ),
      source_id: Type.Optional(
        Type.String({
          description: "Replacement configured source ID. Must be paired with source_quote.",
        }),
      ),
      source_quote: Type.Optional(
        Type.String({
          description:
            "Replacement exact source quote. Paired with source_id, source_path, or source_url.",
          maxLength: 8_000,
        }),
      ),
      source_path: Type.Optional(
        Type.String({ description: "Replacement ad-hoc file path for provenance." }),
      ),
      source_url: Type.Optional(
        Type.String({ description: "Replacement URL for provenance (e.g., Slack permalink)." }),
      ),
      source_kind: Type.Optional(
        StringEnum(["file", "slack", "notion", "user"] as const, {
          description: "Replacement source kind.",
        }),
      ),
    }),
    async execute(_id, params) {
      return serializeMutation(async () => {
        const hasUpdate = [
          params.kind,
          params.statement,
          params.tags,
          params.basis,
          params.clear_basis,
          params.source_id,
          params.source_quote,
        ].some((value) => value !== undefined);
        if (!hasUpdate) throw new Error("Provide at least one field to update");

        const root = knowledgeRoot();
        const claims = await readClaims(root);
        const index = claims.findIndex((claim) => claim.id === params.id);
        if (index === -1) throw new Error(`No knowledge record found for ID: ${params.id}`);

        const updated = await updateClaim(
          claims[index],
          {
            kind: params.kind,
            statement: params.statement,
            tags: params.tags,
            basis: params.basis,
            clearBasis: params.clear_basis,
            sourceId: params.source_id,
            sourceQuote: params.source_quote,
            sourcePath: params.source_path,
            sourceUrl: params.source_url,
            sourceKind: params.source_kind,
          },
          await loadSources(root),
        );
        claims[index] = updated;
        await writeClaims(claims, root);
        await materializeClaims(root);
        if (await qmdAvailable()) {
          await updateIndex(
            claims.some((claim) => claim.audience === "restricted"),
            root,
          );
        }

        return {
          content: [{ type: "text", text: `Updated ${updated.kind} record ${updated.id}.` }],
          details: updated,
        };
      });
    },
  });

  pi.registerTool({
    name: "planetscale_knowledge_delete",
    label: "PlanetScale Knowledge Delete",
    description:
      "Delete a stored fact or hypothesis by record ID, including its materialized qmd document.",
    parameters: Type.Object({
      id: Type.String({
        description:
          "Record ID returned by planetscale_knowledge_search or planetscale_knowledge_record.",
      }),
    }),
    async execute(_id, params) {
      return serializeMutation(async () => {
        const root = knowledgeRoot();
        const claims = await readClaims(root);
        const claim = claims.find((item) => item.id === params.id);
        if (!claim) throw new Error(`No knowledge record found for ID: ${params.id}`);

        const remaining = claims.filter((item) => item.id !== params.id);
        await writeClaims(remaining, root);
        await materializeClaims(root);
        if (await qmdAvailable()) {
          await updateIndex(
            remaining.some((item) => item.audience === "restricted"),
            root,
          );
        }

        return {
          content: [{ type: "text", text: `Deleted ${claim.kind} record ${claim.id}.` }],
          details: { id: claim.id, kind: claim.kind },
        };
      });
    },
  });
}
