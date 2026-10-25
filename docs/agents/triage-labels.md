# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Under EPURE governance (`docs/adr/0019-epure-governance-and-multi-agent-orchestration.md`), write collaborators orchestrate feature specifications and task execution via `/epure plan` and `/epure approve` comments on GitHub Issues (`epure-issue-command.yml`). Approved child tasks receive `ready-for-agent` and open pull requests verified by the blocking `ai-review` check and the 3 Repository Rulesets (`epure-feature-governance`, `epure-dev-governance`, `epure-release-immutability`).

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.
