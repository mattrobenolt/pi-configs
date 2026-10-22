# Claude Mythos 5.1 — Evidence Brief

**pi ID:** `anthropic/claude-mythos-5-1`
**Status in pi:** preferred Claude juggernaut on our access — the trusted-access Claude 5.1 model. Added 2026-10-19 after PlanetScale's CVP grant was provisioned.
**Brief posture:** access/identity add. The shared Claude 5.1 capability evidence carries in full; this brief records only the differences and the access mechanics.

---

## 1. What it is

- **Vendor:** Anthropic, released 2026-09-01 as the trusted-access Claude 5.1 model ([model docs](https://platform.claude.com/docs/en/models/mythos-5-1/overview)). Same weights, same specs, same price as the GA model; the difference is the safeguard and access profile.
- **Specs:** 1M context / 128K max output, text+image in, adaptive thinking always on (cannot be disabled), June 2026 cutoff, $10/$50, cache reads $0.25, cache writes $12.50 (5m) / $20 (1h), batch $5/$25. Same tokenizer as the GA Claude 5.1.
- **Access:** only through Anthropic's verification programs — CVP (cyber) or LSVP (life sciences) — not generally available. Not offered on Claude Platform on AWS ([Anthropic model catalog](https://raw.githubusercontent.com/anthropics/skills/main/skills/claude-api/shared/models.md)). The model ID is `claude-mythos-5-1` on the Claude API.
- **pi registration:** not in pi 1.3.0's bundled catalog. Manually added to `~/.pi/agent/models.json` with metadata copied field-for-field from the built-in GA Claude 5.1 entry; rides the built-in `anthropic` provider and the same OAuth credential.

## 2. The only documented behavioral difference

Anthropic's model catalog: same capabilities, limits, pricing, and API behavior as the GA Claude 5.1 **"except it does not run the history-editing check."** Practical effect: editing earlier turns does not invalidate replayed thinking blocks. The GA model (and Opus 5.5/Sonnet 5.5) can 400 on edited history for accounts created on/after 2026-08-31; Mythos does not.

Everything else carries from the GA Claude 5.1: thinking always on, five effort levels (default `high`), no prefill, no sampling params, `stop_reason: "refusal"`, 512-token cache minimum, forced `tool_choice` 400s, thinking blocks bound to the producing model.

## 3. Safeguards

- **More permissive for vetted cyber/life-science work, not classifier-free.** Anthropic: the same model with more permissive safeguards for vetted individuals and organizations whose work is affected by cybersecurity and life-sciences restrictions. All other safeguards remain.
- **CVP is not Mythos-only.** The same grant runs Opus 5.5 and Sonnet 5.5 with tier-tuned cyber classifiers. Anthropic's CyScenarioBench on Opus 5.5: Defense blocked 46/50 multi-stage tasks; Red Team blocked none and completed 34/50 (same as no safeguards); Specialized has the fewest blocks. Prohibited use (ransomware, C2, mass exfiltration, physical harm) stays blocked at every tier. Mythos is an additional model, not a requirement.
- **It is not Mythos 5.** Mythos 5 ran no safety classifiers and never returned `refusal`. Mythos 5.1 runs access-program-dependent safeguards and **does** return `stop_reason: "refusal"` on out-of-scope work. Handle it before reading `content`.
- **Do not assume the GA model's silent fallback chain applies.** Its apps/Claude Code reroute cyber → Opus 4.8 and bio → Opus 5; the API returns refusals. Treat Mythos as refusal-returning unless a probe shows otherwise — the grant changes the classifier threshold, not the API contract.
- **Scope:** CVP covers internal work on the organization's own code, products, and infrastructure. Building or operating a client-facing product on the grant requires separate productization approval. High-risk dual use remains policy-gated, not prompt-tunable.

## 4. Vendor claims

Same launch table and methodology as the GA Claude 5.1 (production safeguards on, intervened tasks scored zero, standard errors published, Anthropic-run). The one published difference:

| Row | Mythos 5.1 | GA Claude 5.1 | Read |
|---|---:|---:|---|
| Terminal-Bench 4.0 | **60.9** | 55.8 | Anthropic: the gap is the GA model's cyber safeguards intervening on agentic-coding tasks, not capability. Says improved safeguards should shrink it. |
| TB-Science 0.1 | 52.6 | 52.6 | same system-card row |
| GDPval-AA v2 | 1853 | 1853 | same |
| HLE no-tools / tools | 60.9 / 65.0 | 60.9 / 65.0 | same |
| SWE-bench Pro | 81.2 | 81.2 | same system-card row |
| CursorBench 3.2.0 | 73.4 | 73.4 | same |

The TB4 60.9-vs-55.8 delta is the cleanest published safeguard-tax number in the guide. It is **not** evidence that Mythos is a better model on unflagged work.

## 5. Neutral evals

- **No separate same-version Mythos read.** Treat capability as the GA Claude 5.1's: AA Intelligence Index **65.7** (max with default fallback) — #1 on the 2026-09-03 v4.1.1 read ([AA Intelligence Index](https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index)). AA measured the GA model, whose fallback served ~4% of output tokens; the scale does not support claiming a distinct Mythos score.
- DeepSWE 67.4 on Anthropic's chart (their run) vs Claude 5's 69.9 ±4 — within noise, no upgrade signal. Same as the GA Claude 5.1.
- No vals.ai / LMArena / METR / Latch Mythos-specific entries at add time.
- BenchLM aggregate 82.7/100 (#1 of 229) is the GA Claude 5.1 figure; the system card is shared, so the underlying rows apply, but don't relabel it a Mythos measurement.

## 6. Access mechanics (why the first attempts 404'd)

The model ID is valid but access is org- and role-scoped. Without the grant, Anthropic returns the same `404 not_found_error` as a retired model. On Claude Enterprise the grant is provisioned through a custom role, not a per-model toggle:

1. Organization settings → **Grants** — the CVP grant must exist and be active.
2. Organization settings → **Roles** — the grant is attached to a custom role; members get it through the role's groups.
3. Organization settings → **Members** — the member's role type must be **Custom**. Owners, Primary Owners, and Admins with built-in roles do not inherit custom-role grants.
4. SCIM organizations: the IdP group mapping controls both group membership and role type.

Sources: [CVP overview](https://support.claude.com/en/articles/14604842-cyber-verification-program), [assign a program to custom roles](https://support.claude.com/en/articles/17118092-assign-a-program-to-custom-roles-on-enterprise-plans).

**Observed:** before the role assignment, the OAuth credential's `/v1/models` did not list `claude-mythos-5-1` and a `pi -p` completion returned `404 not_found_error: model: claude-mythos-5-1`. After the group/role assignment, the same credential listed the model and the completion returned `ok`. No re-login was needed.

## 7. Local / hands-on

- **Route probe (2026-10-19):** `pi -p --no-session --no-tools --model anthropic/claude-mythos-5-1 --thinking off "Reply with exactly: ok"` → `ok`.
- `/v1/models` with the same OAuth token lists `claude-mythos-5-1`.
- No local duel vs the GA model, no safeguard probe, no long-context run yet. The GA model's local history and the shared system card are the priors.

## 8. Seat read

- **The Claude juggernaut on our access.** Same weights/specs/price, fewer cyber/bio false positives, no history-edit 400. There is no quality trade for the more permissive profile on unflagged work.
- **For routes outside the grant, use Opus 5.5 or Astra.** Do not hardcode Mythos into anything that may run outside PlanetScale.
- **Not a cheaper seat:** same $10/$50 and $0.25 cache reads. The prep-first/cache economics are unchanged.
- **CVP scope is a routing constraint:** internal work on our own code/infrastructure; no client-facing productization without separate approval; general offensive work outside the grant is still out of scope.
- **vs GPT-6 Astra:** Mythos owns general intelligence and knowledge work; Astra owns coding-agent efficiency on the Codex quota. Route by work shape.

## 9. Watch items

- A separate Mythos AA read on the same index version (none at add time).
- Safeguard probe: does the CVP profile reduce false positives without changing refusal behavior on out-of-scope dual-use work? The 2026-08-09 exosphere framing-immunity prior was measured on Claude 5.
- History-edit behavior in practice: confirm pi sessions with edited/forked context don't 400 on Mythos.
- Grant durability: role/group changes silently drop the model back to 404. Re-probe after org changes.
- Mythos on other providers (Bedrock/Vertex/Foundry) — different access mechanics; not our route.
