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

`ready-for-agent` does not start a Cloud Agent by itself. After the label is on, kick with a new collaborator comment that starts with `@cursor` plus an instruction (`@cursor implement this issue`). Edits of an existing comment and a bare `@cursor` do not kick. One comment per issue: a second `@cursor` starts a second run. The kick landed when the comment has an eyes reaction and `cursor[bot]` replies.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.
