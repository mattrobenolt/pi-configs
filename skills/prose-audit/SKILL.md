---
name: prose-audit
description: Audit prose for AI-sounding, synthetic, formulaic, or generic writing and revise it without making unsupported authorship claims. Use when asked whether text sounds AI-generated, to find AI writing tells, to humanize or de-slop prose, to compare writing against a personal voice, or to review drafts for canned language, rhetorical templates, mechanical structure, and weak grounding.
---

# Prose Audit

Audit the writing, not the alleged writer. Style signals can identify revision targets; they cannot prove AI authorship.

## Run the mechanical pass

Use `prose_audit` with the text or file and the closest genre profile: `general`, `technical`, `email`, `academic`, or `marketing`.

If the tool is unavailable, run the package CLI from the pi config root:

```sh
pnpm prose-audit --genre technical --json path/to/file.md
```

Treat `synthetic_style_score` as synthetic-style pressure. Never call it an AI probability, confidence of authorship, plagiarism score, or detector verdict. Do not compare scores across genres as though they share a calibrated scale. For fewer than 100 words, the tool deliberately abstains.

## Perform the qualitative pass

The rules only cover observable surface patterns. Read the whole passage and test what the CLI cannot:

- **Specificity:** Are claims backed by names, numbers, dates, mechanisms, constraints, or firsthand observations?
- **Genericity:** Could paragraphs survive unchanged if the subject nouns were swapped?
- **Rhetoric:** Does the prose explain significance, or merely announce that something is crucial, nuanced, broader, or worth noting?
- **Voice:** Are there concrete preferences, asymmetric emphasis, sharp judgments, or unusual details that belong to this writer?
- **Structure:** Does each section exist because the argument needs it, or because a template expects an introduction, balanced list, challenges paragraph, and optimistic conclusion?
- **Epistemics:** Are uncertainty, attribution, and evidence stated precisely? Flag vague authorities and unsupported consensus claims.
- **Audience fit:** Technical lists, disclosure templates, academic transitions, and email courtesies can be genre conventions rather than synthetic tells.

For personal voice comparison, request or locate representative writing by the same person in the same genre. Compare recurring sentence shapes, vocabulary, punctuation, level of detail, directness, and editing habits. Do not use an unrelated “human writing” baseline.

## Report findings

Lead with a plain-language judgment about how the prose reads, not where it came from. Separate high-confidence residue (assistant disclaimers, placeholders, canned offers) from weak stylistic correlations (em dashes, title case, transition words).

Prioritize a few findings that materially affect the text. Quote exact spans, explain why each one feels canned or generic in context, and propose a direct revision. Do not dump every rule hit or replace one bag of clichés with another.

A useful report has this shape:

```text
This reads mostly like direct technical prose, with two synthetic-feeling patches. That is a style judgment, not an authorship claim.

1. “…” — [specific issue and why it matters]
   Revision: “…”

2. “…” — [specific issue and why it matters]
   Revision: “…”

The strongest human signal is …; the weakest section is …
```

When revising, preserve facts, uncertainty, terminology, links, citations, and the author's intended level of formality. Prefer deletion and specificity over forced slang, fragments, fake anecdotes, arbitrary typos, or punctuation churn. “Humanizing” by damaging otherwise good prose is cargo cult editing.

See `references/methodology.md` for rule strength, score interpretation, and known failure modes.
