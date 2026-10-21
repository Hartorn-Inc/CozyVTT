# CozyVTT agent notes

## Agent skills

### Issue tracker

GitHub Issues on `Hartorn-Inc/CozyVTT` via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`. `ready-for-agent` is the specified-work signal; it does not start Cloud Agent. Kick: one new collaborator comment that starts with `@cursor` plus an instruction (recipe in that file).

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.

## Cursor Cloud

Implement the issue and open a **ready** (not draft) pull request, feature branch → `dev`, titled `type(scope)?: description`. Follow `.cursor/rules/orchestration.mdc`: Composer writes, Grok explores via Task. Verify with the commands in `.cursor/agents/references/cozyvtt-commands.md`; if Docker or Postgres is down, still open the PR (GitHub CI is the merge gate). Comment on the source issue with the PR URL. Local commands: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

Target `dev` only. Leave merge to humans. Keep git hooks on. Keep secrets and Instance `.env` out of commits.
