# CozyVTT agent notes

## Agent skills

### Issue tracker

GitHub Issues on `Hartorn-Inc/CozyVTT` via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`. `ready-for-agent` marks a fully specified task ready for EPURE execution; feature specifications and task graphs are orchestrated through `/epure plan` and `/epure approve` (see `docs/adr/0019-epure-governance-and-multi-agent-orchestration.md`).

### Domain docs

Single-context: root `GLOSSARY.md`, `DESIGN.md`, and `docs/adr/`. See `docs/agents/domain.md`.

## EPURE Governance & Multi-Agent Review

- **Commands**: Collaborators with write permission trigger planning and execution via `/epure plan`, `/epure approve`, `/epure retry`, and `/epure pause` on GitHub Issues (`epure-issue-command.yml`), and bootstrap or update repository governance via `/setup-repo` (`.agents/skills/setup-repo/SKILL.md`).
- **Branching & Rulesets**: 3 Repository Rulesets (`epure-feature-governance` on `refs/heads/feature/**`, `epure-dev-governance` on `refs/heads/dev`, and `epure-release-immutability` on `refs/heads/main` and `refs/tags/v*`) enforce squash-only merges, Conventional Commit PR titles (`PR title`), CozyVTT CI quality gates (`Quality (Format, Lint, Typecheck, Test & Build)`), Zizmor static workflow analysis (`Zizmor`), and the blocking multi-agent review gate (`ai-review`).
- **Reviewer Roster**: `.cursor/agents/*.md` defines the 12 readonly EPURE reviewers (`domain-backend-reviewer`, `realtime-reviewer`, `game-systems-reviewer`, `frontend-reviewer`, `infra-reviewer`, `architecture-reviewer`, `security-reviewer`, `spec-parity-reviewer`, `standards-reviewer`, `accessibility-reviewer`, `design-reviewer`, and `user-advocate`). See `.cursor/rules/orchestration.mdc`.
- **Verification**: Run the commands in `.cursor/agents/references/cozyvtt-commands.md` and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Keep git hooks on, and keep secrets and Instance `.env` out of commits.
