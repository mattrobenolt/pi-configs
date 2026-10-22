# Methodology

The auditor combines exact-span lexical and rhetorical rules with document-level structure, cadence, grounding, and formatting measurements. It masks fenced code, inline code, URLs, HTML comments, front matter, and unified diffs before prose analysis. Genre profiles reduce penalties for conventions such as bold-label lists in technical documents, polite offers in email, and hedging in academic prose.

The score is named `synthetic_style_score`. Rule penalties are capped within each rule family so repeated low-value hits cannot dominate, weighted by confidence, normalized by document length, and mapped to 0–100 with a saturating curve. The thresholds remain heuristic and uncalibrated. They rank revision pressure inside this implementation; they do not estimate authorship probability.

## Evidence order

Treat evidence in this order:

1. Assistant residue, unresolved placeholders, or explicit model disclaimers are strong evidence of an editing failure. They still do not prove who authored the rest.
2. Clustered rhetorical templates, self-announcing document shape, repeated cadence moves, inflated significance, vague attribution, and unsupported consensus are useful revision signals.
3. Grounding problems — no names, numbers, dates, sources, or mechanisms — are high value but require judgment. A conceptual essay can be legitimately abstract.
4. Formatting habits, em dashes, title case, curly quotes, sentence-length uniformity, individual vocabulary items, and three-part lists are weak correlations. Require repetition and contextual support.
5. Genericity, factual grounding, originality, and personal voice distance need human or model-assisted reading; regexes cannot judge them reliably.

## What changed in schema 2

The second schema adds `structure`, `cadence`, and `grounding` findings, per-finding `confidence`, `fix`, and `source`, and a larger metrics profile. The added rules came from four places:

- The Wikipedia *Signs of AI writing* field guide, including its October 2026 update: self-announcing shape, notability padding, vague association, source-gap disclaimers, summary-shaped headings, and formatting artifacts.
- Corpus work on rhetorical and grammatical style, especially present-participial tails, nominalizations, phrasal coordination, and the negative-parallelism family (Reinhart et al., PNAS 2025).
- Structural-signature work: SlopShape (2026) reports that a tidy, self-announcing document shape survives rewording; the model is thesis before the first section, announced flow, editorial-explainer voice, and a conclusion that restates the thesis.
- The slop taxonomy in Chakrabarty et al. (2026): density, relevance, coherence, templatedness, repetition, verbosity, and tone are the dimensions readers actually penalize.

Rule inventories and edge-case guards were adapted from deterministic linters: slop-guard, slopless, deslopper, and proselint. None of those tools is a dependency. Their useful idea is the same one this package follows: exact spans, explainable rules, and a refusal to turn a style score into an authorship verdict.

## Score interpretation

- `0–19` low: few observed signals. Not a certificate of human authorship.
- `20–39` light: a few weak or one moderate signal.
- `40–59` moderate: clustered signals worth a revision pass.
- `60–79` high: multiple families agree; rewrite the flagged sections.
- `80–100` very high: saturated with observed tells.

Short passages are unstable. Below 60 words the tool returns findings but no score. Below 250 words it reports low confidence. A high score on a 60-word snippet means the snippet is dense with tells, not that the whole author writes that way.

## Known failure modes

Common false positives include:

- Research or commentary that quotes AI vocabulary as examples. The quoted words are evidence about the subject, not the writer's style.
- Technical or reference documents with legitimate tables, bullets, code fences, and title-case headings.
- Terse human prose, fragments used deliberately, and short declarative sentences in operational writing.
- Non-native English, translated prose, and heavily edited professional writing.
- Academic hedging, formal transitions, and citation conventions.
- Email courtesies and disclosure templates.
- A conclusion that naturally refers back to the title without being formulaic.

Do not optimize text merely to lower the score. A clear sentence should not be rewritten because it contains one em dash or a common transition. Revise when a flagged pattern is weak in context, not because the pattern exists.
