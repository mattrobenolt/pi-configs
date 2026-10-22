import assert from "node:assert/strict";
import test from "node:test";

import { auditProse, ruleCatalog } from "./index.ts";

const synthetic = `
# Transforming the Modern Data Landscape

At its core, this groundbreaking platform is not just a tool—it's a pivotal shift in how teams work. It seamlessly integrates research, collaboration, and execution, showcasing a robust commitment to innovation.

Additionally, the platform boasts a diverse array of capabilities. It unlocks the potential of every team, fostering alignment and underscoring the importance of an ever-evolving ecosystem.

Moreover, there are three key factors to consider: speed, flexibility, and reliability. This offers valuable insights into the broader landscape, highlighting its enduring significance.

In conclusion, the platform stands as a testament to thoughtful engineering. Despite these challenges, it is positioned to continue redefining what's possible.
`;

const direct = `
We moved the parser into the request path last Tuesday. Median latency fell from 180 ms to 95 ms, but p99 stayed flat because cache misses still hit S3.

The next patch batches those reads. It does not change the wire format, so old clients keep working. I tested it against production traces from June and included the raw numbers in the issue.

The remaining risk is memory use during a cold start. Each worker now holds another 12 MB until the first batch finishes. That trade is acceptable for the API service, but not for the smaller cron containers.
`;

test("flags clustered synthetic-style patterns with exact locations", () => {
  const result = auditProse(synthetic);

  assert.ok(result.synthetic_style_score !== null);
  assert.ok(result.synthetic_style_score >= 60);
  assert.ok(result.findings.some((finding) => finding.rule === "rhetoric.negative-parallelism"));
  assert.ok(result.findings.some((finding) => finding.rule === "lexical.inflated-significance"));
  assert.ok(result.findings.every((finding) => finding.line >= 1 && finding.column >= 1));
});

test("keeps direct, specific prose below synthetic fixture", () => {
  const syntheticResult = auditProse(synthetic);
  const directResult = auditProse(direct, { genre: "technical" });

  assert.ok(directResult.synthetic_style_score !== null);
  assert.ok(syntheticResult.synthetic_style_score !== null);
  assert.ok(directResult.synthetic_style_score < syntheticResult.synthetic_style_score);
  assert.equal(directResult.findings.length, 0);
});

test("does not inspect fenced code or URLs as prose", () => {
  const text = `${direct}\n\n\`\`\`text\nIt is not just code, it's a tapestry.\n\`\`\`\nhttps://example.com/delve/tapestry`;
  const result = auditProse(text, { genre: "technical" });

  assert.equal(result.findings.length, 0);
});

test("preserves UTF-16 offsets while masking protected text", () => {
  const phrase = "At its core";
  const text = `${direct}\n\n✅ https://example.com/tapestry\n\n${phrase}, the implementation is direct.`;
  const result = auditProse(text, { genre: "technical" });
  const finding = result.findings.find((item) => item.rule === "rhetoric.performative-depth");

  assert.ok(finding);
  assert.equal(finding.start, text.indexOf(phrase));
  assert.equal(finding.evidence, phrase);
});

test("abstains on short text", () => {
  const result = auditProse("This robust system unlocks a vibrant ecosystem.");

  assert.equal(result.synthetic_style_score, null);
  assert.equal(result.band, "insufficient");
  assert.equal(result.confidence, "insufficient");
});

test("reduces formatting penalties for technical prose", () => {
  const text = Array.from(
    { length: 5 },
    (_, index) => `- **Step ${index + 1}:** Run the command and record its output.`,
  ).join("\n");
  const general = auditProse(`${text}\n\n${direct}`);
  const technical = auditProse(`${text}\n\n${direct}`, { genre: "technical" });

  assert.ok(general.synthetic_style_score !== null);
  assert.ok(technical.synthetic_style_score !== null);
  assert.ok(technical.synthetic_style_score < general.synthetic_style_score);
});

test("treats placeholders as a weak editing signal in email drafts", () => {
  const draft = `${direct}\n\nBest regards,\n\n[NAME]\n[EMAIL]`;
  const general = auditProse(draft);
  const email = auditProse(draft, { genre: "email" });

  assert.ok(general.synthetic_style_score !== null);
  assert.ok(email.synthetic_style_score !== null);
  assert.ok(email.synthetic_style_score < general.synthetic_style_score);
});

test("masks embedded unified diffs and ignores repeated file paths", () => {
  const text = `${direct}\n\ntopology/sql/manage/ManageHelper.sql.in\ntopology/sql/manage/ManageHelper.sql.in\ntopology/sql/manage/ManageHelper.sql.in\n\ndiff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-At its core, this is not just code.\n+At its core, this is a pivotal tapestry.\n\n━━━━━━━━━━━━━━━━━━━━\nVerification follows.`;
  const result = auditProse(text, { genre: "technical" });

  assert.equal(result.findings.length, 0);
});

test("flags heavily packaged verification-report structure", () => {
  const sections = [
    "### TEST 1 — Observation — ✅ VULNERABLE",
    "### TEST 2 — Escalation — ✅ VULNERABLE",
    "### TEST 3 — Resolution — ✅ CONFIRMED",
    "### TEST 4 — Patched extension — ✅ FIX VERIFIED",
    "### Environment",
    "### Functional checks",
  ];
  const body = sections
    .map(
      (heading, index) =>
        `${heading}\n\n**Result ${index + 1}.** The test produced the expected result and confirmed the mechanism with a concrete observation.\n\n\`\`\`text\nresult_${index + 1} | postgres | on\n\`\`\``,
    )
    .join("\n\n---\n\n");
  const result = auditProse(body, { genre: "technical" });

  assert.ok(result.synthetic_style_score !== null);
  assert.ok(result.synthetic_style_score >= 60);
  assert.ok(result.findings.some((finding) => finding.rule === "formatting.presentation-stack"));
  assert.ok(
    result.findings.some((finding) => finding.rule === "structure.repeated-status-headings"),
  );
});

test("flags short, blatant slop even when the score abstains", () => {
  const text =
    "In today's fast-paced world, let's be honest: this is not just a tool. It's a mindset. The future belongs to teams that quietly prioritize what matters.";
  const result = auditProse(text);

  assert.equal(result.synthetic_style_score, null);
  assert.ok(result.findings.some((finding) => finding.rule === "lexical.stock-opener"));
  assert.ok(result.findings.some((finding) => finding.rule === "rhetoric.negation-reframe"));
});

test("catches cadence slop that has no unusual vocabulary", () => {
  const text =
    "We rebuilt the deploy pipeline last month. It is faster. It is simpler. It is safer. The old system was not bad. It was just old. Here's what changed. First, we replaced the queue. Then we removed the cache. Finally, we added retries. That's it. That's the whole change. The lesson is simple. Small changes compound. The future belongs to teams that ship.";
  const result = auditProse(text);

  assert.ok(result.synthetic_style_score !== null);
  assert.ok(result.synthetic_style_score >= 60);
  assert.ok(result.findings.some((finding) => finding.rule === "cadence.punchy-fragment-run"));
  assert.ok(result.findings.some((finding) => finding.rule === "cadence.repeated-sentence-starts"));
  assert.ok(result.categories.cadence);
});

test("flags a cluster of weak GPT-era vocabulary", () => {
  const text = `
The practical answer is to prioritize the steady work that makes the system clearer and more dependable.
A practical team will prioritize steady habits, clear language, and dependable review.
The result is clearer ownership and a steady rhythm that quietly keeps the work practical.
That is the challenge: make the system dependable without pretending the work is simple.
`;
  const result = auditProse(text);

  assert.ok(result.findings.some((finding) => finding.rule === "lexical.ai-vocabulary-density"));
});

test("flags notability padding and empty significance", () => {
  const text = `
The project has been featured in several regional media outlets and trade publications.
Its independent coverage stands as a testament to the team's enduring legacy.
The work underscores the importance of collaboration and highlights the significance of the broader movement.
`;
  const result = auditProse(text, { genre: "marketing" });

  assert.ok(result.findings.some((finding) => finding.rule === "lexical.notability"));
  assert.ok(result.findings.some((finding) => finding.rule === "lexical.inflated-significance"));
});

test("exposes every emitted rule in the catalog", () => {
  const rules = ruleCatalog();
  const ids = rules.map((rule) => rule.id);
  const findings = [
    ...auditProse(
      "It is important to note that experts argue this stands as a testament to the evolving landscape. Additionally, the work offers valuable insights.",
    ).findings,
    ...auditProse(
      "We rebuilt the pipeline. It is fast. It is simple. That's it. Here's what changed. The lesson is simple. The future belongs to teams that ship.",
    ).findings,
  ];
  for (const finding of findings) {
    assert.ok(ids.includes(finding.rule), `missing catalog entry for ${finding.rule}`);
  }
  assert.equal(new Set(ids).size, ids.length);
});

test("does not flag terse concrete narrative as cadence slop", () => {
  const text =
    "The room was quiet. The fan hummed. The server logged one request. I closed the laptop and went home.";
  const result = auditProse(text);

  assert.equal(result.findings.length, 0);
});

test("masks nested markdown fences without leaving the inner code as prose", () => {
  const text = `${direct}\n\n\`\`\`\`md\n\`\`\`text\nIt is not just code, it's a tapestry.\n\`\`\`\n\`\`\`\`\n\nThe build failed at 14:02.`;
  const result = auditProse(text, { genre: "technical" });

  assert.equal(result.findings.length, 0);
  assert.equal(result.metrics.fenced_code_blocks, 1);
});
