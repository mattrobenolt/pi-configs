# Fireworks models via Cloudflare AI Gateway

These are the custom Fireworks upstream models configured in `models.json` under the `cloudflare-ai-gateway` provider. Model IDs are sent through Cloudflare AI Gateway as `custom-fireworks/accounts/fireworks/models/<model>`.

Prices are from `firectl -a fireworks model get ...` `sku_infos`, in USD per 1M tokens. `cacheWrite` is set equal to uncached input because Fireworks exposes cached and uncached input SKUs, but not a separate cache-write SKU.

| Model | Context | Max output | Input | Cached input | Uncached input | Output | Notes |
| --- | ---: | ---: | --- | ---: | ---: | ---: | --- |
| `gpt-oss-120b` | 131K | 32K | text | $0.014 | $0.15 | $0.60 | Cheapest baseline. Good first sanity check for reasoning/agent tasks. |
| `minimax-m2p5` | 197K | 32K | text | $0.029 | $0.30 | $1.20 | Fireworks-recommended coding/agent model. Always-reasoning; pi limits thinking levels to low/medium/high. |
| `minimax-m2p7` | 197K | 32K | text | $0.059 | $0.30 | $1.20 | Newer MiniMax candidate; likely worth comparing against M2.5. Always-reasoning; pi limits thinking levels to low/medium/high. |
| `deepseek-v3p2` | 164K | 32K | text | $0.28 | $0.56 | $1.68 | Fireworks-recommended for coding, agents, and reasoning. Strong baseline before judging V4. |
| `kimi-k2p5` | 262K | 32K | text + image | $0.10 | $0.60 | $3.00 | Fireworks-recommended Kimi baseline. Agentic coding, reasoning, multimodal. |
| `kimi-k2p6` | 262K | 32K | text + image | $0.16 | $0.95 | $4.00 | Newer Kimi candidate. Start here unless it behaves worse than K2.5. |
| `glm-5` | 203K | 32K | text | $0.20 | $1.00 | $3.20 | Fireworks-recommended GLM baseline for agentic engineering. |
| `glm-5p1` | 203K | 32K | text | $0.26 | $1.40 | $4.40 | Newer GLM candidate. More expensive; should earn its keep. |
| `deepseek-v4-pro` | 1M | 32K | text | $0.145 | $1.74 | $3.48 | Long-context flagship candidate. Expensive uncached input, surprisingly reasonable cached input. |

## Quick take

Start cheap and work up. `gpt-oss-120b` and the MiniMax models are the cost-effective candidates. `deepseek-v3p2` is the middle-price recommendation-backed baseline. `kimi-k2p6`, `glm-5p1`, and `deepseek-v4-pro` are the premium candidates that need to clearly outperform the cheaper models.

For pi agent work, the useful eval order is probably:

```text
gpt-oss-120b
minimax-m2p7
minimax-m2p5
deepseek-v3p2
kimi-k2p6
kimi-k2p5
glm-5p1
glm-5
deepseek-v4-pro
```

`deepseek-v4-pro` is special: do not judge it on tiny prompts. Its main reason to exist here is huge-context repo/session work.
