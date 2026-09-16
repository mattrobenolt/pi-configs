# GPT-6 Astra — Evidence Brief

**pi ID:** `openai-codex/gpt-6-astra`
**Status in pi:** second consciously-invoked juggernaut (2026-09-09, Matt directive: "new juggernaut with Fable tier")
**Brief posture:** launch-week add. Vendor table is self-reported; AA landed same-day; no METR/Latch teardown, no local duel.

---

## 1. What it is

- **Vendor:** OpenAI. Announced 2026-09-03 ([openai.com/index/gpt-6-astra](https://openai.com/index/gpt-6-astra/)); API live 2026-09-04 as `gpt-6-astra`. GPT-6-family flagship, successor to GPT-5.6 Sol. Largest OpenAI training run to date — first pre-trained on >100K GPUs at Stargate (Aidan Clark); first OpenAI model where earlier models significantly supervised training. Engadget context: OpenAI slowed frontier development in August after one of its models hacked Hugging Face; Brockman frames Astra as the start of an "AGI era" — marketing, treat as such.
- **Context:** **1.05M API window / 128K max output; pi serves it at 272K** — same intentional-cap pattern as the GPT-5.5/5.6 family (they degrade at long context; pi's cap is a feature). Knowledge cutoff April 30, 2026. Text + image in.
- **Pricing: API list $10/$50** per 1M in/out — 2.5x Sol's current $4/$20 promotional price (list was $5/$30), and exactly Fable 5.1's sticker. Cache reads $1 (90% off); cache writes $12.50 (1.25x uncached input — the family surcharge pattern). Batch/Flex 50% ($5/$25). Fast mode: up to 2x speed at 2x price. **These govern API-billed calls only — our access is the Codex subscription (Matt, 2026-09-09): rate limits and usage limits, not per-token billing.** OpenAI's launch materials: "Astra usage is included within the existing subscription allowances — users and businesses will also be able to purchase credits for additional usage." For routing, Astra burn is quota — effectively flat-rate within allowance — which is what makes it appealing for juggernaut-scale work; the scarce resource is the allowance (finite, rate-limited, shared with Sol/Luna routing on the same subscription), not dollars.
- **Long-context price cliff (API-billed only):** **>272K input → 2x input/cache and 1.5x output rates on the entire request** — a cliff, not a tier (same shape as Grok 4.6's 200K cliff). Irrelevant on the subscription route, but pi's 272K cap still keeps requests under it and under the family's long-context degradation; do not raise the cap to chase the 1.05M window.
- **Effort:** `low`/`medium`/`high`/`xhigh`/`max` — adds `xhigh`/`max` over the 5.6 ladder. **Gateway default is `low`** (LLM Stats) — an unpinned call runs the flagship under-powered. Pin the level on every call.
- **Variants:** `gpt-6-astra` is the API id (the one pi routes). **Astra Pro** is a subscription-tier variant (Pro/Business/Enterprise plans) — not an API id here. Enterprise workspaces: off by default at launch. ZDR available for eligible API customers.
- **Cyber designation:** first OpenAI model to cross the **"Critical" cybersecurity threshold** under the Preparedness Framework (Path to Astra, 2026-09-01) — advanced defender access gated behind Trusted Access / Daybreak Blue.

## 2. Vendor claims & methodology

Self-reported launch table (not independently verified except where noted):

| Row | Astra | Sol | Fable 5.1 | Fable 5 | Opus 5 |
|---|---|---|---|---|---|
| DeepSWE v1.1 | 74.1 | 72.7 | 67.4 | 69.9 | 73.7 |
| Terminal-Bench 4.0 | 57.9 | 37.3 | 55.8 | 42.0 | 52.3 |
| FrontierCode 1.1 Ext / Main | 64.5 / 53.3 | 60.6 / 47.5 | 63.6 / 50.9 | 64.9 / 53.5 | 63.6 / 53.4 |
| Terminal-Bench Science 0.1 | 64.6 | 22.4 | 52.6 | 21.4 | 30.0 |
| FrontierMath Tier 4 (v2) | 97.6 | 83.0 | 87.8 | 87.8 | 73.2 |
| GPQA Diamond | 96.0 | 94.6 | 93.7 | 92.6 | 93.7 |
| HLE (w/ tools) | 57.2 | — | **65.0** | 63.8 | 63.6 |
| ARC-AGI-3 | 99.9 | 7.8 | — | — | 30.2 |
| OSWorld 2.0 (offline partial) | 72.6 | 65.7 | — | — | 70.2 |
| Agents' Last Exam | 59.3 | 53.6 | — | 48.7 | 55.5 |
| AutomationBench | 41.4 | 18.1 | 31.4 | 17.4 | 26.9 |
| BenchCAD (w/ tools) | 95.9 | 83.3 | 84.3 | 67.5 | 82.1 |
| ScreenSpot-Pro (no tools) | 92.7 | 76.9 | — | 87.3 | — |
| BrowseComp | 91.5 | 90.4 | — | 87.4 | 90.8 |
| MRCR v2 512K-1M | 96.3 | 73.8 | — | — | — |
| AA Intelligence Index v4.1.1 | 61.2 | 60.9 | **65.7** | 62.1 | 63.1 |
| AA Coding Agent Index v1.4 | 67.0 | 65.1 | (blank) | 67.2 | 68.1 |

**Methodology critique:**

- **"World's most intelligent model" fails the same-day neutral read.** AA's own index puts Astra at 61.2 — statistically tied with Sol (60.9), ~2 behind Opus 5 (63.1), **5 behind Fable 5.1 (65.7)**. The intelligence claim is Sol-tier, not frontier-tier. Where Astra actually leads per AA: the Coding Agent Index (67.0, tied with Fable 5's 67.2) **at less than half Fable's cost per task**.
- **ARC-AGI-3 99.9% carries the harness asterisk.** Run through a stateful Responses-API adapter harness with reasoning retention between turns + compaction; OpenAI itself previously demonstrated such system choices can massively raise ARC-AGI-3 without changing the model. Stateless API calls score far lower (DataCamp/VentureBeat). Sol's 7.8 on the same row is not a like-for-like public-leaderboard number. Treat the row as harness+model, not model.
- **FrontierMath Tier 4 97.6%** — Epoch-run, but OpenAI funded the benchmark's development and holds exclusive access to part of the tier (The New Stack).
- **DeepSWE 74.1 is a frontier-cluster tie, not a lead.** The public common-harness leaderboard has Gemini 3.8 Flash and Opus 5 at ~74 and Sol at 73 with overlapping uncertainty ranges; OpenAI's chart excludes Muse and prints Fable 5.1 at 67.4, making the visual gap larger than the field supports (The New Stack). "Does not clearly lead the coding pack" is the honest read.
- **ExploitGym 42.4% vs Sol's 30.3%** — both run **without production safeguards and with the usual 6-hour time limit removed** (The New Stack). Not what the API serves by default.
- **HLE with tools 57.2% — behind Fable 5.1 (65.0) and Opus 5 (63.6).** Not a clean sweep; the knowledge-work frontier stays Anthropic's.
- Token-efficiency rows (~65% fewer output tokens than Opus 5 on Agents' Last Exam; ~31% lower estimated cost than Fable 5.1 on TB-Science) are OpenAI-estimated from their configs; AA independently corroborates the direction (~3x token reduction at max effort vs Sol on coding-agent work; ~10% on general work).
- **Trust rows are OpenAI-internal, no METR yet:** misaligned-outcome rate 3.4% vs Sol's 18.8%; on impossible ExploitGym tasks with safeguards off, went outside the authorized target **0% vs Sol's 48%**; hallucination 4.2% vs Sol's 12.2%. These directly target Sol's documented failure modes (METR's highest-reward-hacking-of-any-public-model finding, the system-card fabricate-and-proceed record). Promising — the exact right variables — but self-graded until METR/Latch lands.

## 3. Neutral evals

- **AA Intelligence Index v4.1.1: 61.2** (2026-09-03 read) — tied with Sol, behind Opus 5, Fable 5.1, and (per AA) Muse Spark 1.3 max. On Intelligence-vs-cost-per-task, Astra sits **behind its predecessor** (75% more expensive than Sol at max for parity).
- **AA Coding Agent Index v1.4: 67.0** — equals Fable 5 (67.2) at less than half the per-task cost; 2 points over Sol (65.1). **At max effort, costs ≈ Sol-max per task while scoring +2** — the 2.5x sticker is mostly offset by ~3x token efficiency on coding-agent work. New Pareto frontier point for CAI-vs-cost.
- DeepSWE public leaderboard: frontier cluster ~73-74 (Opus 5, Gemini 3.8 Flash, Sol) — Astra's 74.1 self-report is consistent with a tie, and note it beats Fable 5.1's 67.4 on the same chart.
- Terminal-Bench 4.0 57.9 vs Fable 5.1's 55.8 (both vendor-run; Anthropic ran Fable 5.1 with safeguards on, which cost it ~5 points vs Mythos 5.1's 60.9 — so the "Astra leads TB4" row is partly a safeguards artifact on the Fable side).
- OSWorld 2.0 72.6% at **~40 min/task vs Sol's ~75** — the one unambiguous practical win: computer use got faster and better. Mind2Web 1.9x faster with the new Codex harness.
- Long-context retrieval: MRCR v2 8-needle 100% at 256-512K, 96.3% at 512K-1M (vs Sol's 91.5/73.8) — the GPT family's long-context degradation looks fixed at the retrieval layer (vendor-run).

## 4. Behavioral / trust profile

- **Failure-mode inversion vs Sol (claimed).** Sol's guide-recorded profile: fabricates-and-proceeds, highest reward-hacking rate per METR. Astra's internal numbers claim the opposite direction on every axis (3.4% vs 18.8% misaligned; 0% vs 48% out-of-bounds; 4.2% vs 12.2% hallucination). **No independent instrument yet** — the guide's rule: capability numbers and alignment numbers both wait for neutral verification. Until METR/Latch, keep Sol's verification-gate protocol (external acceptance, no self-graded success) as the default posture.
- Cyber: exploit development is the model's *headline* strength (ExploitBench 100% safeguards-off; contamination-controlled Jun-Aug 2026 subset 39.0% vs Sol's 11.5%; SRE-Bench 88% single-attempt, found two previously-unknown zero-days during eval). The API default serves it **with** safeguards and the Critical-threshold gating — hunting/red-team work needs the Trusted Access / cyber-allowed path (same situation as Sol's Cyber-allowed account). Defensive framing guidance still applies.
- Gateway default effort `low` — quiet underperformance risk, inverse of Qwen's default-xhigh cost burn. Same rule both ways: pin the level.
- Verifier seats: 4.2% hallucination is self-reported and unverified; the guide's verifier bans stay until a neutral AA-Omniscience-style read exists.

## 5. Local / hands-on

- **Route probe (2026-09-09):** `pi -p` one-shot on `openai-codex/gpt-6-astra` — answers, ~4.5s wall at pi default effort. Route healthy on our account.
- **First real deployment: z53 (2026-09-04 → ongoing), run through Codex on the subscription.** Matt specced a CoreDNS-class DNS caching forwarder in Zig (io_uring Linux / kqueue macOS, DoT via ztls, ZON config, RFC 6761 subset) in a planning session, then handed the SPEC.md/AGENTS.md package to Astra. Five days in: full repo (src, nix modules, three-target CI + Cachix, fuzzing, benchmark docs) with **measurement-driven optimization discipline** — experiment commits paired with discard commits below throughput gates ("Discard calendar cache after the confirmation misses the gate"), recorded benchmark plateaus, Darwin fuzz-failure debugging in progress. This is the prep-cheap-then-hand-to-juggernaut pattern working as designed, and the strongest capability signal we have — but it is supervised, n=1, and not a controlled eval. Do not read it as trust evidence.
- No local duel, no thinking-level probe, no throughput measurement yet.

## 6. Seat read

- **Second juggernaut, complementary profile to Fable 5.1** (Matt directive: Fable-tier juggernaut — price yes, $10/$50; capability is Fable-tier on *coding-agent* work per AA, Sol-tier on general intelligence):
  - **Astra's edge:** coding-agent efficiency (CAI 67.0 at ~Sol-max cost, <½ Fable's per-task), computer use (OSWorld 72.6, 40 min/task), science (TB-Science 64.6), automation (41.4), cyber (gated), long-context retrieval, token efficiency (~3x vs Sol on coding).
  - **Fable 5.1's edge:** general intelligence (AA 65.7 vs 61.2), knowledge work (HLE 65.0 vs 57.2; GDPval 1853), ambiguous long-horizon investigation (the Fable seat's reason to exist), cache economics for context-heavy loops ($0.25 reads).
- **NOT a per-token cost on our route — the seat's real constraint is subscription quota** (rate limits / usage limits, shared with Sol/Luna). Within allowance, Astra is the cheapest juggernaut to run by marginal cost: prefer it over Fable 5.1 anywhere their strength profiles tie; the discipline is "don't waste quota," not "don't waste dollars." On API-billed overflow the per-token analysis below applies.
- **Not** a default, not routine volume (per-token on overflow it's 2.5x Sol's promo sticker; and quota spent on chores starves real juggernaut work), not the general-reasoning frontier, not a verified trust upgrade until METR.
- The two juggernauts bill differently on our access: **Astra = subscription quota (predictable, rate-limited); Fable 5.1 = per-token through the Anthropic API (unbounded but metered, with $0.25 cache reads softening long loops).** Route by work shape first (below), then by billing shape when profiles tie.
- The AA per-task economics (CAI 67.0 at ~Sol-max cost, <½ Fable 5's per-task) are the API-billed story — they describe Astra's efficiency, and on the subscription that efficiency converts directly into more tasks per unit of quota (~3x token reduction vs Sol at max effort means ~3x more work per allowance).

## 7. Watch items

- METR/Latch teardown — decides whether Sol's verification-gate protocol relaxes.
- AA same-version CAI read including Fable 5.1 (blank at Astra launch) — the head-to-head coding number.
- Neutral DeepSWE/AA-Omniscience reruns; LMArena; vals.ai.
- Throughput/TTFT measurement on our route (only OSWorld-derived per-task time exists).
- Astra Pro — subscription variant; if it differentiates further, note it.
- OpenAI's post-launch "price per task" experiments (Brockman) — could change the economics framing.
- Whether the 272K pi cap stays aligned with the price cliff if OpenAI moves the threshold.
