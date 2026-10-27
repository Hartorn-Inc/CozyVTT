# ADR 0020: Backlog Cleanup and Feature Extraction Strategy

## Context

In accordance with ADR 0003 (`docs/adr/0003-github-issues-only.md`), this clone tracks all active, scheduled, and backlog work exclusively in GitHub Issues. However, legacy documentation accumulated in the repository—notably `docs/FUTURE_FEATURES.md`, disparate notes in `docs/*.md`, and untracked `// TODO` or `/* FIXME */` comments throughout `backend/src/` and `frontend/src/`—creates an inconsistent secondary backlog.

Maintaining redundant backlog lists in markdown causes divergence with actual codebase capabilities, confuses developers on what features are truly planned or already delivered, and bypasses issue tracking hygiene. Furthermore, comments in source code often lack context, ownership, or traceability to planned work.

## Decision

1. **Retire Document-Based Backlogs**:
   - `docs/FUTURE_FEATURES.md` and related informal backlog lists will undergo a comprehensive triage audit.
   - Defunct, abandoned, superseded, or "Won't Do" proposals will be permanently removed from repository documentation. In alignment with project guidelines, no `docs/archive/` cemetery directory will be introduced; Git commit history remains the historical record.
   - Valid proposals, deferred enhancements, and confirmed bug reports will be extracted into discrete GitHub Issues labeled `scope:extracted-feature`. Each extracted issue must record its origin file, original text, and context.

2. **Code Comment Harmonization**:
   - All unformatted `TODO` and `FIXME` comments in `backend/src/` and `frontend/src/` (excluding vendor and build artifacts) must either be:
     - Converted to referenced comments following the format `// TODO(#<issue_id>): <description>`, or
     - Removed if the comment describes already resolved work, obsolete experiments, or invalid assumptions.
   - No functional application logic or runtime behavior may be altered during comment cleanup.
   - Test markers prohibited by guards (such as `.skip` or `.only` checked in `testMarkers.test.ts`) must never be added.

3. **Audit Execution in Two Steps**:
   - **Step 1 (Audit & Matrix)**: Automated scanning creates an inventory matrix (`docs/reports/backlog-audit-inventory.md`) classifying each detected item with an action recommendation (`Delete`, `Extract Issue`, `Retain`).
   - **Step 2 (Execution & Integrity)**: Document prunings and comment updates are performed, and an integrity check (`scripts/check-markdown-links.py`) ensures no broken internal markdown links or references remain.

## Consequences

- **Positive**:
  - GitHub Issues becomes the single source of truth for planning and backlog tracking, honoring ADR 0003.
  - `docs/` reflects only active, true system documentation rather than speculative roadmaps.
  - Code comments gain clear traceability to actionable issues.
  - Internal markdown link integrity is safeguarded through automated checks.

- **Negative / Risks**:
  - Requires careful triage to avoid discarding relevant context.
  - Code modifications require strict hygiene to ensure zero accidental changes to executable lines.

**Status**: accepted
