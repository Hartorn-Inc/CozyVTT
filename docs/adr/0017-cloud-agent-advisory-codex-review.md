# Cloud Agent implements; Codex review is advisory

Cloud Agents implement from a manual `ready-for-agent` label or a native `@cursor` kick. Composer implements, Grok explores via Task, and Luna reviews. Pull requests go only to `dev`, and only write collaborators can open them (`collaborators_only`). Actions review is opt-in Codex on OpenRouter GPT-6 Luna Flex: the `codex-review` label runs a no-secret `pull_request` request, then `workflow_run` on `dev`; `/review` is handled on `dev`. Environment `codex-review` must be restricted to branch `dev` only (a human GitHub setting; do not add `refs/pull/*/merge`). The posted review is advisory, not a required check. Outsider triggers are silent GitHub skips. No PAT in Actions, no GitHub App private key in Cursor, and no Instance secrets in Cloud.

**Status**: accepted

**Considered Options**: PAT in Actions; Azure llm-hub keys; OpenRouter workload identity federation; Bugbot as primary review; agent merge; PRs to `main`; prompt-level outsider apologies; secret-bearing `pull_request` YAML. Rejected: WIF is Business/Enterprise only, so a free OpenRouter account keeps `OPENROUTER_API_KEY` in Environment `codex-review` (GitHub job token is still short-lived). The others put org or Instance secrets in Cloud/Actions, let PR YAML name the Environment, make review a merge gate, or duplicate GitHub's collaborator gate in the prompt.
