# Hypothesis strategies — elaborated playbook

Tools to reach for when stuck. Not a checklist to grind through; pick the one that matches the situation.

| Strategy | When | Example (memory) |
|----------|------|------------------|
| **Ablation** | Unsure what's actually costing | Remove the metrics library's HTTP handler; does RSS drop? Then re-add and isolate. |
| **Amplification** | After a keep; push the win further | If streaming one hash helped, stream all the full-file reads. |
| **Combination** | Keeps on different branches | Merge the stripped-binary + GOMEMLIMIT + streaming wins on one branch; re-measure (interactions can be sub/super-additive). |
| **Inversion** | String of discards | If lowering GOGC didn't help, try raising it (with a limit set). |
| **Isolation** | Unclear which part of a change helped | Split a "stream + pool + reuse" change into three experiments. |
| **Analogy** | Truly stuck | Borrow a known-good RSS floor from a similar sidecar in the same fleet. |
| **Simplification** | Complexity accumulating | Replace a map-of-maps with a slice if keys are bounded; preserve metric. |
| **Scaling** | Tweaks plateaued | 10× the fixture count; does the cost scale linearly or is there a cliff? |
| **Decomposition** | A promising change discarded | Break it into ordered sub-changes; one of them may keep. |
| **Sweep** | Right value unknown | Sweep GOMEMLIMIT across {16,32,64,128} MiB in one branch. |

## Stop-before-rewrite guardrail

If every remaining candidate requires abandoning the implementation language or a user-declared-in-scope dependency, you have likely reached the **practical floor** for this stack. Pause and report that explicitly, with the floor number and what a further win would cost (e.g. "Rust rewrite, est. −X MiB but weeks of work + reintroducing s6 plumbing"). Let the user decide whether to cross that line. Do not drift into a rewrite on autonomy.
