# Methodology

The auditor combines exact-span lexical and rhetorical rules with document-level formatting and rhythm measurements. It masks fenced code, inline code, and URLs before prose analysis. Genre profiles reduce penalties for conventions such as bold-label lists in technical documents or polite offers in email.

The score is intentionally named `synthetic_style_score`. Rule penalties are capped within each rule family so repeated low-value hits do not dominate, normalized by document length, and mapped to 0–100 with a saturating curve. The current thresholds are heuristic and uncalibrated. They rank revision pressure inside this implementation; they do not estimate authorship probability.

Treat evidence in this order:

1. Assistant residue, unresolved placeholders, fabricated-looking citations, or explicit model disclaimers are strong evidence of an editing failure. They still do not prove who authored the rest.
2. Clustered rhetorical templates, inflated significance, vague attribution, repeated canned transitions, and generic participial tails are useful revision signals.
3. Formatting habits, em dashes, title case, sentence-length uniformity, individual vocabulary items, and three-part lists are weak correlations. Require repetition and contextual support.
4. Genericity, factual grounding, originality, and personal voice distance need human or model-assisted reading; regexes cannot judge them reliably.

Common false positives include translated prose, non-native English, SEO copy, institutional communications, accessibility-driven structure, academic conventions, disclosure templates, and heavily edited professional writing. Short passages are unstable. Technical identifiers and repeated product names can distort lexical-diversity and phrase-repetition metrics.

Do not optimize text merely to lower the score. A clear sentence should not be rewritten because it contains one em dash or a common transition. Revise when a flagged pattern is weak in context, not because the pattern exists.
