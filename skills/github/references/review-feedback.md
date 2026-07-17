# Review Feedback

## Standard

Optimize for code health and forward progress, not perfection. Approve when the
change has no known merge blockers and leaves the codebase better or no worse
than before. Request changes only when a concrete issue must be resolved before
merging.

The author owns the implementation. The reviewer owns the accuracy, relevance,
and clarity of the feedback and the meaning of the verdict.

Prefer demonstrated behavior, project conventions, and documented requirements
over personal preference. When multiple approaches are equally valid, accept
the author's choice.

## Verify before commenting

Understand why the change exists and what requirements or contracts it must
satisfy. Review the design and scope before polishing individual lines.

Read the complete diff and enough surrounding code to understand each concern.
Inspect callers, tests, configuration, documentation, dependencies, and history
when they affect whether a finding is real.

Verify factual claims whenever practical. Run a focused test, trace the call
path, consult the governing specification, or cite the project convention. Do
not turn an unverified suspicion into a blocking comment. Distinguish observed
behavior from inference, and state material uncertainty.

Read existing review threads before commenting. Do not repeat feedback already
raised or fixed on a later commit.

Prioritize correctness, security, privacy, data integrity, concurrency,
resource lifetime, error handling, contracts, regressions, compatibility,
performance, operational reliability, meaningful test gaps, and unnecessary
complexity introduced by the change.

Do not block on personal style, an equally valid implementation preference,
unrelated pre-existing problems, speculative future requirements, or cleanup
outside the change's scope. Prefer automation for formatting, lint, and
mechanical conventions.

## State severity honestly

Use three forms of feedback:

- `Blocking:` The change must not merge until the concern is resolved.
- `Non-blocking:` The suggestion may be skipped without another review cycle.
- `Question:` Information is missing or the reviewer may have misunderstood.

Use `Blocking:` only for a demonstrated defect, violated requirement, material
code-health regression, or missing validation necessary to establish safety.
Do not request changes when every remaining comment is non-blocking.

Do not disguise a verified problem as a question merely to sound polite.
Questions are for genuine uncertainty. If an answer could reveal a blocker,
state that explicitly.

Avoid a separate nitpick category. If feedback is useful but not worth delaying
the change, call it non-blocking. If it is not useful enough for that, omit it.

## Write useful comments

Build a comment from these parts as needed:

1. **Finding:** State what is wrong or unclear.
2. **Consequence:** Describe the concrete failure scenario or maintenance cost.
3. **Evidence:** Point to the behavior, call path, test, requirement, or
   convention supporting the finding.
4. **Resolution:** State the property that must hold after the fix.

Lead with the finding. Do not make the author infer the concern from a proposed
patch. Explain why when the impact is not obvious; bare instructions such as
"remove this" or "use X instead" create unnecessary back-and-forth.

Give the smallest useful amount of guidance. Specify the required outcome
without designing the entire fix unless there is only one sensible solution or
a small suggestion patch removes ambiguity.

Keep one concern per thread. Combine repeated instances of the same concern
instead of creating comment noise.

Comment on the code, not the author. Avoid blame, sarcasm, false certainty, and
words such as "obviously," "simply," and "just." Respect comes from accuracy
and clarity, not from cushioning direct feedback with apologies.

Do not force praise or use a compliment sandwich. Leave visible positive
feedback only when it is specific and teaches something useful about a design
decision, test, simplification, or project pattern. A checklist of everything
that looked correct is provenance, not feedback.

Examples:

> **Blocking:** This acknowledges the operation before the write is durable.
> If the process exits between `ack()` and `flush()`, the caller observes
> success but the data is lost.
>
> Acknowledgement needs to happen only after the durable write completes. The
> exact structure is up to you; preserving that ordering is the requirement.

> **Non-blocking:** These parsing branches duplicate the same validation.
> Extracting it would make future format changes harder to apply
> inconsistently, but the current behavior is correct.

> **Question:** Is `items` guaranteed to remain sorted after `merge()`? I could
> not find that invariant in the implementation or tests. If it is not
> guaranteed, the binary search below can miss an existing item and this
> becomes blocking.

## Put feedback in the right GitHub surface

Use inline review comments for findings tied to particular code. Target the
smallest useful line or range in the diff. Place the comment where the problem
is introduced or where the required change belongs, not on a nearby line merely
because GitHub permits comments there. Make each thread understandable from its
code context without requiring the author to reconstruct it from the summary or
provenance.

Use a multiline range when the concern depends on several lines. Use a
whole-file review comment for a file-wide concern that has no honest line
target. If GitHub cannot target the relevant unchanged code, use a file comment
or the review summary rather than attaching the finding to an unrelated changed
line. Raise a repeated pattern once and name the other affected locations.

Use the overall review body for the verdict, cross-cutting design concerns,
review scope, validation performed, and residual uncertainty. Do not bury a
line-specific defect only in the summary, and do not duplicate every inline
comment there.

Use a top-level PR conversation comment only when the message is not a review
verdict or code finding. Do not use it as a substitute for an inline review or
review summary.

When submitting through `github_review`:

- Batch related line and range comments into one coherent `submit` review when
  possible.
- Target added or context lines with `side: "RIGHT"`; target deleted lines with
  `side: "LEFT"`.
- Use `start_line`, `start_side`, `line`, and `side` for a multiline range.
- Create a genuinely file-wide comment separately with `action: "comment"` and
  `subject_type: "file"`; batched `submit` comments require line coordinates.
- Pin every submission to the exact locally reviewed SHA with
  `expected_head_sha`.
- Re-fetch and review again if the head changed; never move a stale finding to
  a convenient line on new code.

## Keep the visible review concise and provenance collapsible

A useful LLM review has two layers:

1. **Visible review:** Verdict and findings that require human attention.
2. **Provenance:** The audit record showing what the reviewer inspected and
   verified.

Always include the collapsed provenance section in an LLM-authored review. It
proves thoroughness without making humans read a ceremonial checklist. It does
not replace contextual inline comments for actual findings.

Do not narrate every file that looked correct in the visible review. This makes
an LLM look busy while hiding the actual signal. Put that material in a GitHub
`<details>` block labeled `Provenance`, collapsed by default.

Keep provenance dense and factual. Record reviewed areas, load-bearing claims
checked, focused validation, relevant file references, and anything not
validated. Do not turn provenance into another essay or a second round of
praise.

Use this review-body shape:

```markdown
**Approve.** No blocking findings.

[Optional cross-cutting finding or residual risk. Inline comments contain
line-specific feedback.]

<details>
<summary>Provenance: what was reviewed</summary>

- Scope: `pkg/retry`, its callers, and the changed tests.
- Verified: timeout retries preserve the idempotency key
  (`pkg/retry/client.go:84-117`).
- Validation: `go test ./pkg/retry/...`.
- Not validated: production failover behavior.

</details>
```

For a review with blockers, lead with the blocker count or central conclusion:

```markdown
**Request changes.** One blocking correctness issue remains in the retry path;
the inline comment describes the duplicate-write sequence.

<details>
<summary>Provenance: what was reviewed</summary>

[Concise audit record.]

</details>
```

For a clean review, one visible sentence plus provenance is enough. Do not
manufacture findings or verbose praise to prove thoroughness; provenance is the
receipt.

## Choose the verdict

- **Approve:** No known blocker remains within the reviewed scope.
- **Request changes:** At least one concrete blocker remains.
- **Comment:** The review is partial, informational, or awaiting information
  needed for a verdict.

Approval means "no known blockers within the reviewed scope," not "the code is
perfect." State the scope when the review was partial or specialized.

Do not report green CI, test counts, lint/build success, or routine local
command outcomes in the visible review. GitHub already owns CI status, and a
review is not a test transcript. Phrases such as "CI green" or "tests clean
apart from an unrelated flaky test" are noise.

Record locally run commands in collapsed provenance only when they are useful
audit evidence. Do not mention an unrelated flake anywhere unless it materially
affects confidence in the change or requires action from the author.

## Handle disagreement

Re-evaluate a challenged finding against the code and evidence. The author's
confidence is not proof, but neither is the reviewer's.

If the finding was wrong, edit or retract it directly. If it still holds,
respond with the missing evidence or consequence rather than repeating the same
assertion more forcefully.

Move a prolonged disagreement to a synchronous discussion when that is faster,
then record the decision and reasoning in the PR for future readers.

## Final quality gate

Before submitting, check:

- Is each finding supported by code or another primary source?
- Is it caused or materially worsened by this change?
- Is its blocking status honest?
- Does the comment explain the consequence and required next step?
- Is a question genuinely a question?
- Is line-specific feedback attached to the relevant line or range?
- Are clean checks hidden in provenance rather than dumped into the review?
- Does the summary state the verdict, scope, validation, and uncertainty?
- Would the concern receive the same severity regardless of the author?

## Sources

This guidance synthesizes:

- [Google Engineering Practices: Code Review](https://google.github.io/eng-practices/review/)
- [GitLab Code Review Guidelines](https://docs.gitlab.com/development/code_review/)
- [Microsoft Engineering Fundamentals: Reviewer Guidance](https://microsoft.github.io/code-with-engineering-playbook/code-reviews/process-guidance/reviewer-guidance/)
- [thoughtbot Code Review Guide](https://github.com/thoughtbot/guides/tree/main/code-review)
- [Conventional Comments](https://conventionalcomments.org/)
- [Understanding Practitioners' Expectations on Clear Code Review Comments](https://arxiv.org/html/2410.06515)
- [What Makes a Code Review Useful to OpenDev Developers?](https://ar5iv.labs.arxiv.org/html/2302.11686)
- [Explaining Explanations: An Empirical Study of Explanations in Code Reviews](https://arxiv.org/html/2311.09020v2)
