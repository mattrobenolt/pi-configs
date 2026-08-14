# Muse Glimmer 30B — evidence brief

Status: 2026-08-12. pi route: `fireworks/accounts/fireworks/models/muse-glimmer-30b`
(Fireworks serverless: 131K ctx, image input + function calling supported; probed live:
`reasoning_effort` accepts `none/low/medium/high/xhigh/max` — `minimal` rejected by the
route; `reasoning_content` is still emitted at `none`; prompt caching active).
$0.35 / $1.50 per 1M, cached input $0.04.

## What it is

Meta Superintelligence Labs, released 2026-08-10. 29.7B dense (52 layers, GQA 32Q/2KV,
SwiGLU), distilled from the closed Muse Spark flagship, Apache 2.0 weights (full BF16 +
4-bit quants + DFlash speculative drafter + perception encoder). ~1.8B ViT-G/14 encoder
for interleaved text+image. Design target is *always-on local agents in a 24-32GB
envelope* (Q4 < 20GB + KV + encoder + drafter), with hosted as the scale-out path.
131,072-token context. Trained on 100+ languages; post-training is SFT + on-policy
distillation + RL over reasoning/coding/agentic domains. Muse Spark 1.2 open-weights
release promised "in the coming weeks" but not shipped.

## Vendor claims & methodology

Meta's launch table (self-run, "High Reasoning"; Fireworks blog reprints it) positions
Glimmer against its size class only — Gemma 4 31B and Qwen 3.6 27B:

| Benchmark | Glimmer 30B | Gemma 4 31B | Qwen 3.6 27B |
|---|---|---|---|
| MCP Atlas (Public) | 75.5 | 54.2 | 62.5 |
| DeepSearch QA | 74.6 | 61.7 | 71.1 |
| Gaia2 | 43.3 | 36.4 | 40.0 |
| WildClawBench | 47.6 | 37.6 | 43.2 |
| SWE-Bench Pro | 51.2 | 36.9 | 50.2 |

Careful with the framing: the chosen comparison set is two same-size models it beats,
not the models it competes with for a routing seat (DeepSeek V4 Flash is 4-5x cheaper
per token with an AA index ~17 points higher). All numbers are vendor-run on unreleased
harnesses; no third-party reproduction at write time. Fireworks notably took an extra
day to fix "the model's shipped generation config" before serving — the launch config
was wrong, so day-0 third-party numbers (if any) are suspect.

## Neutral evals

Artificial Analysis (via temperature2, measured 2026-08-11, `high` effort):
**Intelligence Index 35.1 (rank 76/432)**, Coding Index 49.0, GPQA Diamond 83.5,
LongContext Reasoning 80.0, Terminal-Bench 2.1 51.7, SciCode 43.6, **τ-bench Banking
23.5**, Humanity's Last Exam 22.0. 96 tok/s output, 0.64s TTFT.

Caveats: read predates the guide's 2026-08-12 AA v4.1.1 refresh (cross-date comparisons
invalid per guide rule) — but ~35 vs DeepSeek Flash's 52 is far beyond drift. The
τ-bench 23.5 is the stand-out worry: a model marketed on tool orchestration scoring in
the bottom tier of a neutral tool-use eval directly contradicts the MCP Atlas headline
(one eval each way; treat the agentic-reliability question as unresolved, leaning
negative).

## Local evals (our pi harness, 2026-08-12 — `~/.pi/agent/evals/model-duel/`)

**Coding pack** (6 Matt-shaped TS/Zig bugfix/feature/removal tasks × 2 reps,
glimmer@`high` vs deepseek-v4-flash-0731@`max`): **substance parity — both 12/12**.
(Recorded 10/12 each: both "failed" `ts-remove-feature` only because verify.sh grepped
the workdir including the model's own reply.md, which naturally contains the word
"webhook". Verifier fixed; both models' actual removals were complete and correct.)
The difference is the bill: **$0.204 vs $0.043 total (4.7x), 117s vs 34s average wall
clock (3.4x), 84K vs 41K output tokens (2x)**. Worst single run: glimmer spent 493s /
40 tool calls / $0.067 on zig-proxyv2 rep1 (rep2 was clean at 167s) — high-variance
looping on the hardest task.

**Vision-agentic probe** (`vision-slug-bug`, new task: alert.png screenshot of a
production error report pins a German-umlaut slug bug; fix must match hidden tests and
the reply must quote the image's expected slug; 2 reps, three models):
- glimmer@high: **1/2** — rep1 clean (123s, read image, correct fix); rep2 a 485s /
  64-tool-call spiral that failed both the hidden tests and the reply check.
- qwen3p7-plus@high (price twin, $0.40/$1.60): 1/2 recorded but **2/2 on substance** —
  both fixes correct; rep2 only failed the reply-grep (didn't quote the slug). 15s avg.
- deepseek@max (text-only control): **2/2 recorded — without seeing the image.** Traced
  the run (`scripts/trace-run.mjs`): pi's read tool omitted the image per its text-only
  note (behavior confirmed in pi source; the Fireworks route rejects images outright),
  local OCR attempts failed (no tesseract; swift sandboxed), and it then implemented
  canonical German transliteration from code archaeology alone — while *claiming* in
  its summary it had read the values "from alert.png OCR". The 84%-hallucination /
  generates-rather-than-refuses failure mode in a new costume. Also a task-design
  caveat: this probe is guessable by a strong text model; it is not a clean vision
  discriminator.

Net local read: on Matt-shaped coding, parity with the incumbent at ~5x cost and ~3.4x
latency; on the one task built for its home turf, slower and no more reliable than the
same-price qwen3p7-plus. n=2 reps on the vision probe — thin; the coding pack is the
solid signal.

## Behavioral properties

Verbose reasoning (2x DeepSeek's output tokens for the same tasks — and DeepSeek is
itself 2x-median verbose). Near-loop failure shape on hard tasks (493s/40 tools once;
485s/64 tools once) — bound runs with turn/tool budgets. Serves vision + function
calling on the Fireworks route, prompt caching works. No abstention/verifier data yet —
do not seat it as a verifier on spec.

## Pros

Apache 2.0, runs on a 24GB consumer GPU with a bundled speculative drafter (3.1x decode
on RTX 5090 per Meta) — genuinely differentiated *local* story. Vision + tools + 131K
at $0.35/$1.50. Vendor agentic numbers lead its size class. Prompt caching on route.

## Cons

AA 35.1 puts it ~17 points under the flash incumbent it would have to displace, at
2.5x/5.4x the input/output price. Neutral τ-bench contradicts the tool-use headline.
Locally: coding parity with DeepSeek Flash at 4.7x cost / 3.4x latency, with a looping
failure shape the incumbent doesn't show on this pack. No local always-on need has been
tested here (omlx tier exists but was out of scope).

## Verdict

**No seat.** Evaluated 2026-08-12 and rejected for the flash tier (parity capability,
4.7x cost) and for the cheap-vision-agentic tier (qwen3p7-plus matched it at the same
price, 8-20x faster, in a 2-rep sample). Entry kept in `models.json` for re-checks.
The one place a future re-eval could make sense is *local* always-on agent duty (MLX/
llama.cpp on this Mac), which is the model's actual design point — the hosted Fireworks
route has no gap it fills. Re-check if Meta ships a checkpoint update or AA's coding
index climbs out of the 30s.
