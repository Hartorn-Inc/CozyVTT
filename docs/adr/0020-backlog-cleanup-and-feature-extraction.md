---
status: accepted
---
# Backlog cleanup, static roadmap elimination, and code TODO normalization

## Context

CozyVTT historically maintained `docs/FUTURE_FEATURES.md` alongside in-code `TODO`/`FIXME` comments and scattered documentation references across `README.md`, `docs/DM_GUIDE.md`, and other guides. This static roadmap drifted out of sync with actual development, accumulated obsolete ideas, known issues from ancient versions (1.5.x), and entries explicitly rejected ("Won't Do").

Furthermore, maintaining static roadmap files directly conflicts with ADR 0003 (*"GitHub surface is Issues only"*), which establishes that active backlog items, bugs, and feature proposals live strictly in GitHub Issues, while release history lives in `CHANGELOG.md`. Having backlog items duplicated in static markdown files creates divergent sources of truth, broken references, and invisible technical debt in application source code.

## Decision

1. **Permanent removal of `docs/FUTURE_FEATURES.md`**:
   - Completely delete `docs/FUTURE_FEATURES.md` once triage and extraction are complete.
   - Purge or update all references pointing to `docs/FUTURE_FEATURES.md` across repository markdown files (specifically in `README.md`).
   - Prohibit the creation of archive directories such as `docs/archive/`. Historical traceability is guaranteed by Git commit history and the extracted issue records.

2. **Systematic Triage and Extraction into GitHub Issues**:
   - **Outright deletion**: Drop obsolete proposals, features already implemented in current releases, and items designated as "Won't Do".
   - **Thematic grouping**: Group minor UI/UX anomalies and micro-fixes by subsystem into consolidated GitHub issues rather than spawning dozens of isolated micro-tickets.
   - **Individual issues for major initiatives**: Open standalone GitHub issues for significant feature proposals or major architectural refactorings, labeled `scope:extracted-feature`.
   - **Catalog artifact**: Record all extracted issues in a structured inventory document (`docs/reports/extracted-issues-backlog.md`) detailing source location, context, description, and acceptance criteria prior to synchronization.

3. **Normalization of Source Code TODO Comments**:
   - Strictly preserve functional logic and execution behavior (zero runtime impact, verified via unit/integration test suites).
   - Delete obsolete or already-implemented TODO comments in `backend/src/` and `frontend/src/`.
   - Format all retained TODO comments using the standard syntax: `// TODO(#<issue_id>): <description>` (or multi-line equivalent `/* TODO(#<issue_id>): <description> */`).

4. **Automated Documentation & Link Integrity Tooling in CI**:
   - Introduce `scripts/check-markdown-links.py` to recursively validate internal markdown hyperlinks and heading slug anchors offline without external HTTP calls.
   - Introduce `scripts/audit-backlog-todos.py` with a `--check-unreferenced` flag to enforce that no unreferenced `TODO`/`FIXME` comments exist in `backend/src/` and `frontend/src/`.
   - Integrate link checking and TODO validation into automated repository test suites (`scripts/tests/test_doc_checks.py`).

## Consequences

- **Positive**:
  - Restores compliance with ADR 0003 by establishing GitHub Issues as the single authoritative source of truth for the product backlog.
  - Eliminates stale, misleading roadmap documentation and dead markdown hyperlinks.
  - Establishes a direct, searchable link between application source code debt and trackable GitHub issues.
  - Protects against regression through automated CI checks preventing broken markdown links and unreferenced TODOs.

- **Negative / Operational Trade-offs**:
  - Future feature requests or technical debt cannot be noted informally as bare `// TODO` comments; developers must reference a valid GitHub issue identifier.
  - Offline markdown link validation enforces strict slug conformity across all markdown headings.

## Considered Options

- **Keeping `docs/FUTURE_FEATURES.md` as a curated roadmap file**: Rejected. Static roadmaps inevitably diverge from active GitHub issues and violate ADR 0003.
- **Moving outdated documents to `docs/archive/`**: Rejected. Archive folders create a documentation graveyard that accumulates unmaintained, misleading artifacts.
- **Permitting unreferenced `TODO` comments in source code**: Rejected. Unreferenced TODO comments obscure maintenance ownership and resist automated tracking.
