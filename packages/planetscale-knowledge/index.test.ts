import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  formatAge,
  expandSourcePath,
  lineOfQuote,
  sha256,
  syncSources,
  updateClaim,
  validateClaim,
} from "./index.ts";

test("facts require provenance while hypotheses require an explicit basis", () => {
  assert.equal(
    validateClaim({ kind: "fact", statement: "A fact" }),
    "facts require a source: source_id (configured), source_path (ad-hoc file), source_url (Slack/web), or source_kind='user'",
  );
  assert.equal(
    validateClaim({ kind: "hypothesis", statement: "A guess" }),
    "hypotheses require basis; they are not facts",
  );
  assert.equal(
    validateClaim({
      kind: "fact",
      statement: "A fact",
      sourceId: "source",
      sourceQuote: "Evidence: A fact.",
    }),
    null,
  );
  assert.equal(
    validateClaim({ kind: "hypothesis", statement: "A guess", basis: "Observed a pattern" }),
    null,
  );
  assert.equal(
    validateClaim({
      kind: "fact",
      statement: "A paraphrase",
      sourceId: "source",
      sourceQuote: "The source uses different words.",
    }),
    "facts must appear verbatim in source_quote; otherwise record a hypothesis with basis",
  );
});

test("facts can be sourced from ad-hoc files, Slack, or user statements", () => {
  // Ad-hoc file source — no pre-registration needed
  assert.equal(
    validateClaim({
      kind: "fact",
      statement: "type VitessBackupJob struct",
      sourcePath: "/code/psdb-operator/pkg/apis/psdb/v2/vitessbackupjob_types.go",
      sourceQuote: "type VitessBackupJob struct",
    }),
    null,
  );
  // Slack source — URL + quote, no file verification
  assert.equal(
    validateClaim({
      kind: "fact",
      statement: "CBJ is only clone from a replica, upload",
      sourceUrl: "https://planetscale.slack.com/archives/C0ALNJHGYTT/p1784847393784019",
      sourceQuote:
        "Exactly, CBJ is only clone from a replica, upload. We don't know if this backup can actually be restored",
      sourceKind: "slack",
    }),
    null,
  );
  // User-stated fact — no quote needed, the user's word is the provenance
  assert.equal(
    validateClaim({
      kind: "fact",
      statement: "The deploy is blocked by CI",
      sourceKind: "user",
    }),
    null,
  );
  // User-stated fact with a paraphrased quote is still valid (no verbatim check for user sources)
  assert.equal(
    validateClaim({
      kind: "fact",
      statement: "We should ship on Friday",
      sourceKind: "user",
    }),
    null,
  );
  // Ad-hoc file source still requires verbatim quote
  assert.equal(
    validateClaim({
      kind: "fact",
      statement: "A paraphrase",
      sourcePath: "/some/file.go",
      sourceQuote: "The source uses different words.",
    }),
    "facts must appear verbatim in source_quote; otherwise record a hypothesis with basis",
  );
  // Slack source still requires verbatim quote
  assert.equal(
    validateClaim({
      kind: "fact",
      statement: "A paraphrase",
      sourceUrl: "https://planetscale.slack.com/archives/C123/p456",
      sourceQuote: "The source uses different words.",
      sourceKind: "slack",
    }),
    "facts must appear verbatim in source_quote; otherwise record a hypothesis with basis",
  );
});

test("lineOfQuote returns a source location only for exact evidence", () => {
  const source = "first line\nsecond line\nthird line";
  assert.equal(lineOfQuote(source, "second line"), 2);
  assert.equal(lineOfQuote(source, "missing"), null);
  assert.equal(sha256(source).length, 64);
});

test("formatAge makes record freshness obvious", () => {
  const now = Date.parse("2026-07-20T12:00:00Z");
  assert.equal(formatAge("2026-07-20T11:57:00Z", now), "3 minutes old");
  assert.equal(formatAge("2026-07-17T12:00:00Z", now), "3 days old");
  assert.equal(formatAge("not-a-date", now), "unknown age");
});

test("updating a claim preserves its creation time and revalidates facts", async () => {
  const sourcePath = "/tmp/evidence.md";
  const sourceQuote = "A supported fact.";
  const current = {
    id: "record-1",
    kind: "fact" as const,
    statement: sourceQuote,
    tags: [],
    audience: "internal" as const,
    provenance: {
      sourceKind: "file",
      sourceId: "evidence",
      sourcePath,
      sourceHash: sha256(sourceQuote),
      quote: sourceQuote,
      line: 1,
    },
    createdAt: "2026-07-17T12:00:00Z",
  };
  const sources = [
    {
      id: "evidence",
      path: sourcePath,
      kind: "test",
      authority: "canonical",
      audience: "internal" as const,
    },
  ];

  const hypothesis = await updateClaim(
    current,
    {
      kind: "hypothesis",
      statement: "The evidence may be incomplete.",
      basis: "This is intentionally uncertain.",
    },
    sources,
  );
  assert.equal(hypothesis.createdAt, current.createdAt);
  assert.equal(hypothesis.kind, "hypothesis");
  assert.ok(hypothesis.updatedAt);

  await assert.rejects(
    updateClaim(current, { statement: "A paraphrase." }, sources),
    /facts must appear verbatim/,
  );
});

test("sync materializes selected evidence with original path and digest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "planetscale-knowledge-"));
  const source = path.join(root, "source.md");
  await writeFile(source, "# Branching\n\nA branch is an isolated copy of a database.");
  await writeFile(
    path.join(root, "sources.json"),
    JSON.stringify({
      sources: [
        {
          id: "branching",
          path: source,
          kind: "product-doc",
          authority: "canonical",
          audience: "public",
        },
        {
          id: "incident",
          path: source,
          kind: "incident",
          authority: "incident-notes",
          audience: "restricted",
        },
      ],
    }),
  );

  try {
    const first = await syncSources(false, root);
    assert.deepEqual(first.synced, ["branching"]);
    const rendered = await readFile(
      path.join(root, "corpus", "default", "sources", "branching.md"),
      "utf8",
    );
    assert.match(rendered, new RegExp(`source-path: ${JSON.stringify(source)}`));
    assert.match(rendered, /knowledge-kind: source/);

    const second = await syncSources(true, root);
    assert.deepEqual(second.synced.sort(), ["branching", "incident"]);
    const restricted = await readFile(
      path.join(root, "corpus", "restricted", "sources", "incident.md"),
      "utf8",
    );
    assert.match(restricted, /audience: restricted/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source paths support a portable PlanetScale root", () => {
  const previous = process.env.PLANETSCALE_ROOT;
  process.env.PLANETSCALE_ROOT = "/tmp/planetscale";
  try {
    assert.equal(
      expandSourcePath("$PLANETSCALE_ROOT/docs/page.md"),
      "/tmp/planetscale/docs/page.md",
    );
  } finally {
    if (previous === undefined) delete process.env.PLANETSCALE_ROOT;
    else process.env.PLANETSCALE_ROOT = previous;
  }
});
