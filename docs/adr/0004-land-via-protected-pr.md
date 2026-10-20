# Land on `dev` and `main` only through a green PR

Direct pushes are blocked. A PR needs no approving review (solo), but every CI job must pass, including Zizmor (blocking, no SARIF) and the production-image smoke tests. Organization admins may squash or rebase a PR even when a required check is missing or failing; they cannot push `dev` or `main` directly. Merge is squash or rebase, never a merge commit; the branch is deleted afterwards. `dev` stays linear; `main` still only takes releases.

**Status**: accepted
