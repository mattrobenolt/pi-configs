# PlanetScale knowledge

A local, provenance-first qmd corpus for PlanetScale work. It is deliberately a source index, not an answer generator: search results identify their original file, source class, authority, and audience. Curated records are either `fact` or `hypothesis`; a fact cannot be stored unless its statement appears verbatim in an exact quote from a configured source. Hypotheses require a stated basis and are always labeled as such.

On first sync, the extension copies `seed/sources.json` to `~/.pi/agent/planetscale-knowledge/sources.json`. Paths are portable through `$PLANETSCALE_ROOT`, which defaults to `~/code/planetscale`. Edit that runtime manifest to choose the docs, architecture records, and incident documents worth indexing. It is intentionally allowlisted: do not point it at an entire checkout or a Slack export.

`planetscale_knowledge_sync` materializes selected source documents, adds provenance frontmatter and a source SHA-256, then updates qmd collections. Public and internal sources are searched normally. Restricted sources, intended for incident material, live in a separate collection and are only searched when `include_restricted` is explicitly true.

`planetscale_knowledge_record` stores a fact or hypothesis in `claims.jsonl`. A fact requires `source_id` and `source_quote`; its statement must appear verbatim in the quote, which is checked against the configured local source before it is saved. The record captures its creation timestamp, line number, and source hash. A changed source hash means the old record is evidence of what was observed, not a claim that the source remains current.

`planetscale_knowledge_update` edits a record by the ID returned from search or record creation. It preserves `createdAt`, adds `updatedAt`, and revalidates a fact if its source changes. `planetscale_knowledge_delete` removes the JSONL record and its materialized qmd document.

The package is not enabled in `settings.json` yet. Load it there only after deciding that this machine-local corpus and its model-provider boundary are the intended default.
