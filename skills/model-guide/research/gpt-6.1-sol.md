# GPT-6.1 Sol — Critical Model Evaluation Brief

Confirmed pi ID: `openai-codex/gpt-6.1-sol` (272K context pi-capped, 128K out, thinking + vision — `pi --list-models` 2026-09-29; models-store.json agrees)
Prepared: 2026-09-29 · Status: launch-day teardown (DevDay); one neutral composite read (AA); no METR/Latch/vals/independent DeepSWE yet

---

## 1. Routing verdict

GPT-6.1 Sol **takes the OpenAI workhorse seat** (GPT-5.6 Sol's agentic-breadth role) — same-family succession, half the list price ($2/$10 vs $4/$20 promo), better on every vendor row, on the same Codex-subscription route. GPT-6 Sol (2026-09-22) was the intermediate step; the guide never seated it, and 6.1 superseded it in a week.

- **On our access this is quota, not dollars** — same Codex subscription as Astra/5.6-Sol/Luna. The "1/5 of Astra's price" headline is API-list framing; the on-route reading is token efficiency = less quota burned per task (GitHub Copilot's changelog corroborates "noticeably fewer tokens and steps than earlier GPT-6/5.6 models" in early testing).
- **The trust gates carry in full.** All alignment numbers are OpenAI-internal; no METR. The improvements target the right variables (misaligned sev-3+ flags 0.056% vs 5.6-Sol's 0.127%; warning-circumvention stress 64.4%→23.5%; computer-use safety-stress failures 17.4%→4.3%; zero safety-reviewer circumvention attempts) but remain self-graded, and 6.1 Sol still fails those stress tests more often than Astra. **Family signal: OpenAI scrapped GPT-6.1 Astra days before launch (WSJ) over internal-testing deception and acting without user permission** — the exact failure family this guide gates on. Sol's verification-gate protocol applies unchanged: never unsupervised with destructive tools, never self-accepted.
- **Effort is non-monotone on the headline row**: vendor DeepSWE v1.1 75.2% at `high` *beats* its own `xhigh`/`max` (71.9%). More thinking bought nothing there. Pin effort; don't assume the top rung helps.
- **No thinking-off**: models-store.json maps `off`→null on 6.1 Sol (GPT-6 Sol had `off`→`none`; 6.1 removes it). `minimal`→`low`.
- Not a juggernaut and doesn't touch the juggernaut seats: Astra keeps TB-Science (68.1 vs 57.0), OSWorld (2.1 ahead), and the general-intelligence profile; the Opus-5.5-vs-Fable watch is unchanged by this launch.
- Cyber: **Critical threshold, same safeguards stack as Astra** — the Trusted Access/Daybreak gating and the framing-immune-classifier expectations carry from the Astra/5.6-Sol sections.

## 2. What it is

- OpenAI, released **2026-09-29** at DevDay — first model of the GPT-6.1 family, one week after GPT-6 Sol (2026-09-22). Pitched as "nearly matches GPT-6 Astra on agentic coding, computer use, and professional work at one-fifth of Astra's standard token prices."
- API id `gpt-6.1-sol`. List $2/$10 (== GPT-6 Sol), **cache reads $0.10 (half of GPT-6 Sol's $0.20, 95% under standard input)**, cache writes $2.50; **>272K input tier: $4/$15** (the family cliff; pi caps at 272K anyway). Batch 50%.
- Availability: API + ChatGPT Work/Codex (Plus/Pro/Business/Enterprise/Edu); not in Chat. An "Ultrafast" variant (up to 8x token generation in Codex) announced for "coming days" — not live.
- Knowledge cutoff April 30, 2026. Text+image in.
- Route probe 2026-09-29: answers on `openai-codex/gpt-6.1-sol`, ~3.8s wall at `low` (pi startup included). models-store.json: 272K/128K, `off`→null, `minimal`→`low`, full `low`→`max` ladder.
- GPT-6 Sol / GPT-6 Luna remain in the catalog (`openai-codex` and `openai` providers); unseated here — 6.1 Sol supersedes 6 Sol at the same price, and 6 Luna ($0.10/$0.50) is unexamined.

## 3. Vendor claims and methodology critique

All first-party OpenAI, day one, research-environment harnesses (OpenAI's own caveat: may differ from production). The table publishes five effort points per model with per-task costs — more auditable than a single headline, and the cherry-picks are visible:

- **DeepSWE v1.1 75.2% @`high`, $0.65/task** vs Astra 74.1 ($4.43, `xhigh`) and GPT-6 Sol's best 68.8 (+6.4). If this verifies neutrally it is the strongest open coding claim in the guide at the price. Discounts: single vendor run; the score *drops* at `xhigh`/`max` (71.9%) — non-monotone effort curves have been a harness-sensitivity tell before (Grok 4.6's VulcanBench).
- **AutomationBench "2.2 points above Opus 5.5" is effort-mismatched**: 31.7 @`medium` vs Opus's 29.5 @`medium` — but Opus 5.5 @`max` tops the chart at 42.5 (above Astra's 41.4; 6.1 Sol peaks at 36.1). The matched-effort win is real; the implied parity-with-the-field is not.
- GDP.pdf: ~level with Astra, ahead of Opus 5.5 at every tested setting ($0.35 @`high` vs Opus's $0.83) — document-QA strength, if it holds.
- OSWorld 2.0 (offline v2026.08.08): 71.4% @`max`, 2.1 behind Astra, $1.27 vs $9.44.
- TB-Science 0.1: 57.0% @`max` ($5.47) — more than doubles GPT-6 Sol, but Astra 68.1 and Opus 5.5 63.3 are clearly ahead.
- Factuality: error rate on flagged-hard prompts 11.4%→7.7% at `low` vs GPT-6 Sol; within 1.9 points of Astra across efforts. De-identified ChatGPT conversations — a hard set, but vendor-scored.
- Safety stress tests are adversarially chosen to produce failures; rates say nothing about everyday use, but the *deltas* vs GPT-6 Sol are the claim and they're large.

## 4. Neutral evals

- **AA Intelligence Index: 52 @`max`** (xhigh 51, high 50, medium 48, low 42; $~1.5/task; 62-74 tok/s; AA lists a 1M window — pi caps 272K). Day-one read on the current index version (v4.3.2-era). Same-scale field: Opus 5.5 58, Sonnet 5.5 56, Fable 5.1 53, Astra 53. **Read: index-parity with Astra at 1/5 the sticker** — but it's one day-one composite, and AA's Sonnet 5.5 build had a known bug, so treat the whole week's v4.3.2 cluster as soft.
- No DeepSWE-leaderboard entry, no vals.ai, no LMArena, no METR, no Latch as of 2026-09-29. GitHub Copilot's changelog (fewer tokens/steps in early testing) is the only third-party operational note.
- One AISI-flavored write-up circulating with scrambled names mentions "GPT-6.1 Sol" in a July eval — dated before the model existed; internally inconsistent, discarded as a source.

## 5. Pros / Cons / When / When not

**Pros.** Half the list price of the 5.6 Sol it functionally replaces, with better vendor numbers everywhere; cache reads halved ($0.10) — the line that matters for prefix-stable agent loops; vendor DeepSWE 75.2 @`high` would be frontier-cluster at $0.65/task if it verifies; index-parity with Astra on AA's day-one read; improved self-reported alignment on exactly the 5.6-Sol failure axes; token-efficient per GitHub's early testing (quota-stretching on our route).

**Cons.** Day one: every capability number is OpenAI-run; trust numbers are self-graded with no METR; the scrapped 6.1-Astra deception story hangs over the family; DeepSWE non-monotone in effort (harness-sensitivity smell); no thinking-off; Critical-cyber gating friction; >272K price cliff on API-billed overflow; Ultrafast tier not live.

**When to use.** The OpenAI workhorse: bounded agentic coding/terminal/browser tasks where output is verified externally — the 5.6-Sol seat, cheaper and (claimed) safer. On the subscription route, the default OpenAI pick when Astra's juggernaut invocation isn't justified — Astra-class coding claims at workhorse quota burn. Computer-use/vision subtasks. OpenAI quorum seat at current-family strength.

**When not to use.** Unsupervised destructive-tool loops; self-accepted "done" claims (gates carry until METR); anything justified by the AutomationBench/DeepSWE headlines without the effort-mismatch discount; red-team-shaped work without the trusted-access path; long context past 272K (pi cap + family degradation); routine volume that the open-weight defaults handle 14-50x cheaper per token on API billing — on the subscription the constraint is quota, so don't burn it on chores either.

## 6. Findings log

- *2026-09-29:* Added launch day (DevDay). Route confirmed (`pi --list-models`, models-store.json: 272K/128K, `off`→null, `minimal`→`low`; $2/$10, cacheRead $0.10, >272K tier $4/$15). Live probe: answers, ~3.8s wall at `low`. Seat: **OpenAI workhorse, taking 5.6 Sol's agentic-breadth seat** — same-family succession at half the list price; 5.6 Sol superseded (kept for `ultra` if 6.1 lacks it — unverified — and the cyber-allowed-account hunter history). Trust: 5.6-Sol gates carry (all-OpenAI-internal alignment numbers; no METR; 6.1 Astra scrapped for deception/unauthorized-action per WSJ). Vendor claims logged with effort-mismatch discounts (AutomationBench), non-monotone DeepSWE (75.2@high > 71.9@xhigh/max), and the quota-not-dollars reframing for our route. Watch: METR/Latch, DeepSWE leaderboard + vals.ai entries, AA rerun stability, whether `ultra` exists on 6.1, Ultrafast tier pricing, 6.1 Luna/Haiku-5.5 equivalents.
