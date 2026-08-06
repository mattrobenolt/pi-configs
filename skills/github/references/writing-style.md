# GitHub Writing Style

Every title, body, review, comment, and reply posted to GitHub follows this
spec. The base is ASD-STE100 simplified technical English, adapted for code
review and pull request discussion.

GitHub text is durable and asynchronous. The reader cannot ask what you meant.
Strangers and code archaeologists read it months later. Write so the first
read gives the correct meaning.

This spec applies to text written through the GitHub tools. It does not apply
to chat with the user. Commit messages follow the repository's own convention.

## Classify each passage

Each passage is procedural or descriptive. Never mix the two in one sentence.

- Procedural text tells the reader what to do. Use the imperative mood.
  Maximum 20 words per sentence. One instruction per sentence.
- Descriptive text explains what is true. Use simple tenses. Maximum 25 words
  per sentence. One topic per paragraph. Maximum six sentences per paragraph.

A finding is descriptive. The requested fix is procedural. Keep them in
separate sentences:

> `ack()` returns before the write is durable. If the process exits between
> `ack()` and `flush()`, the caller observes success but the data is lost.
> Complete the durable write before you acknowledge.

## Verbs

Use only these forms:

- infinitive
- imperative
- simple present, simple past, simple future
- past participle as an adjective

No present perfect. Write "The retry failed" or "The retry fails". Never "The
retry has failed".

No "-ing" verb forms. Write a new sentence instead:

- "making the cache stale" becomes "This makes the cache stale."
- "Retrying commits one write" becomes "A retry commits one write."

Use the active voice. Name the actor: the function, the caller, the process.
Use the passive only in descriptive text when the actor is unknown.

## Modals

Approved modals: can, will, must.

Banned modals: should, would, may, might, could. They hedge. They hide the
requirement or the condition.

- Replace "should" with "must" when the action is required. Delete the
  sentence when the action is optional.
- Replace "could" or "might" with the condition. Write "This deadlocks when
  the queue is empty" or "This can deadlock when the queue is empty".

A finding that needs "could" is missing evidence. Find the condition or
downgrade the finding.

## Sentences

- Write complete grammar. No contractions. Write "do not", "it is", "cannot".
- Keep the articles. Keep "that": "Make sure that the file exists."
- Put the condition before the result or the command, with a comma: "If the
  test fails, read the log."
- No semicolons. Write two sentences.
- Use noun chains of maximum three words. Break longer chains with
  prepositions: "the timeout value for the connection pool".
- Use a vertical list for three or more items.

## Protected text

Never reword these tokens:

- code blocks and inline code
- identifiers
- CLI commands
- file paths
- quoted error messages
- product names

Wrap identifiers and paths in backticks. Each protected token counts as one
word for the sentence-length limits.

## Replies to feedback

Lead with the resolution. Name the commit or state the reason:

> Commit `a1b2c3d` moves `ack()` after `flush()`. The regression test covers
> the exit path.

Do not open with praise or thanks. When you decline a suggestion, give the
reason in one sentence:

> Declined: the `merge()` contract permits any order, so the caller must sort
> before the search.

## Questions

A question marks genuine uncertainty. It is not a softened finding. State what
you checked:

> **Question:** Is `items` guaranteed to remain sorted after `merge()`? I did
> not find that invariant in the implementation or the tests. If it is not
> guaranteed, the binary search below can miss an existing item.

## Fragments

Provenance blocks, checklists, and severity labels can use fragments:

> - Scope: `pkg/retry`, its callers, and the changed tests.
> - Not validated: production failover behavior.

Everything else uses complete sentences.

## Markdown

- Use headings and vertical lists to structure long bodies.
- No decorative emoji. No exclamation marks outside quoted text.
- Quote code and output in fenced blocks. Quote error messages exactly.

## Examples

Review comment, before:

> This could potentially cause an issue where the acknowledgement happens
> before the write is durable, meaning data loss might occur if the process
> exits at the wrong time. You should probably consider moving the ack after
> the flush.

After:

> **Blocking:** `ack()` returns before the write is durable. If the process
> exits between `ack()` and `flush()`, the caller observes success but the
> data is lost. Complete the durable write before you acknowledge.

Validation text, before:

> This has been tested thoroughly and all tests are passing. Edge cases were
> also checked.

After:

> The regression test reproduces the acknowledged-timeout race and asserts
> that a retry commits one write.

Reply, before:

> Good catch! I've updated the code to handle this case, thanks!

After:

> Commit `a1b2c3d` handles the empty queue. `dequeue()` returns an error and
> no longer waits.

## Self-check

Run this check on every passage before you post:

1. Expand every contraction.
2. Replace "has" or "have" plus a participle with a simple tense.
3. Replace every banned modal. Use "must" for a requirement. State the
   condition for a possibility. Delete an optional action.
4. Rewrite every "-ing" verb form with a finite verb.
5. Split every semicolon into two sentences.
6. Split every sentence over the limit: 20 words procedural, 25 descriptive.
7. Move each condition before the command, with a comma.
8. Check that identifiers, paths, and quoted errors sit untouched in backticks.
