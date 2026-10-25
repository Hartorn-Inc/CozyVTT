---
status: superseded by ADR-0019
---
# Advisory review runs on Cursor CLI with Grok 4.7

The [advisory review](../../GLOSSARY.md) is the ADR 0017 Actions product: opt-in, collaborator-only, roster [reviewer passes](../../GLOSSARY.md), one GitHub COMMENT, not a required check. Inference is Cursor CLI on the GitHub-hosted runner (`agent -p --mode=ask`), model `grok-4.7` from the included Cursor pool, billed to a user `CURSOR_API_KEY` in Environment `advisory-review` (human GitHub setting: branch `dev` only; do not add `refs/pull/*/merge`). Grok 4.7 is the review model even though it is a poor implementation model. The CLI is version-pinned and runs as an unprivileged UNIX user. It writes JSON for one reviewer pass; trusted Python from `dev` assembles and posts. The opt-in label is `advisory-review`; `/review` is unchanged; the COMMENT header is `## Advisory review (Grok 4.7)`; prior Codex comments still count as prior advisory reviews.

**Status**: superseded by [ADR-0019](0019-epure-governance-and-multi-agent-orchestration.md)

**Considered Options**: OpenRouter Codex as the engine or as a fallback; Bugbot as primary review; Cloud Agents API; `@cursor/sdk`; Luna or Haiku as the default model; a model picker; keeping the `codex-review` names; CLI full autonomy (`gh` / commit / post). Rejected: a second engine duplicates the secret and the trust surface; Bugbot ignores the roster and was rejected in ADR 0017; Cloud Agents and the SDK are the wrong runtime for a readonly Actions pass; Luna and Haiku are prepaid third-party usage, not the included pool; a picker and leftover Codex names hide which model reviewed; the agent must not post. Superseded by [ADR 0019](0019-epure-governance-and-multi-agent-orchestration.md).
