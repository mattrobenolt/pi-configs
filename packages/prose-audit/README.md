# @mattrobenolt/prose-audit

Deterministic prose auditor for synthetic-style signals. It returns exact-span findings, a 0–100 style pressure score, and structured metrics. It does not estimate authorship.

## Use

From the pi config root:

```sh
pnpm prose-audit --genre technical path/to/file.md
pnpm prose-audit --json --text "Text to audit"
pnpm prose-audit --rules
```

As a pi tool:

```text
prose_audit({ path: "draft.md", genre: "technical" })
prose_audit({ text: "...", genre: "email" })
```

Genres are `general`, `technical`, `email`, `academic`, and `marketing`. Genre profiles reduce penalties for conventions such as bold-label lists in technical docs, polite offers in email, and hedging in academic prose.

## Output

The result uses `schema_version: 2`:

- `synthetic_style_score`: 0–100 style pressure, or `null` below 60 words.
- `band` and `confidence`: coarse score interpretation.
- `metrics`: sentence/paragraph distribution, punctuation rates, vocabulary density, formatting counts, and grounding markers.
- `categories`: finding counts and raw penalties by category.
- `findings`: each with rule ID, category, severity, confidence, exact offsets, line/column, evidence, plain-language message, revision lever, and source.
- `caveats`: claim boundaries.

Findings use these categories:

- `assistant-residue`
- `lexical`
- `rhetoric`
- `structure`
- `cadence`
- `grounding`
- `formatting`
- `voice`

## What it is not

The score is not an AI probability, plagiarism score, detector verdict, or authorship claim. It ranks revision pressure inside this implementation. Rule weights are heuristic and not calibrated against a held-out corpus yet. Short passages are unstable: below 60 words the tool returns findings but no score; below 250 words it reports low confidence.

See `skills/prose-audit/SKILL.md` for the review workflow and `skills/prose-audit/references/methodology.md` for score interpretation and known failure modes.

## Sources

Rule inventories and edge-case guards were adapted from the Wikipedia _Signs of AI writing_ field guide, slop-guard, slopless, deslopper, proselint, and corpus work on AI prose style (Reinhart et al. 2025; Juzek and Ward 2025; Chakrabarty et al. 2026; SlopShape 2026). No external linter is a runtime dependency.
