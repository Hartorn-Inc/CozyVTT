# ADR 0021: PostgreSQL 19 Preparation & Major-Version Upgrade Tooling

## Status
Accepted

## Context
CozyVTT uses PostgreSQL 18 in production (`database/Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, and `.github/workflows/ci.yml`). As established in ADR 0005, Docker Compose mounts the named volume at `/var/lib/postgresql`, and the official PostgreSQL Docker entrypoint places the cluster data inside the versioned subdirectory `/var/lib/postgresql/18/docker` (derived from `PGDATA=/var/lib/postgresql/18/docker`).

When upgrading PostgreSQL across major versions (e.g. from 18 to 19):
1. If an operator increments the image tag to PostgreSQL 19 without running cluster migration tooling, PostgreSQL's standard image entrypoint detects that `/var/lib/postgresql/19/docker` is absent, and would automatically initialize a brand new, empty PostgreSQL 19 cluster next to the existing `18/docker` directory. The application would then start against an empty database, causing apparent data loss and confusion for operators.
2. Manual cluster migration across major versions without verified tooling is error-prone and requires complex manual steps using `pg_upgrade` or dump/restore.
3. The database container filesystem runs in `read_only: true` mode with minimal dropped capabilities (`cap_drop: [ALL]`, only `CHOWN`, `DAC_READ_SEARCH`, `SETUID`, `SETGID` retained), tmpfs on `/tmp` and `/var/run/postgresql`, and isolated non-root privileges.

Operators require automated, deterministic tooling and safeguards before PostgreSQL 19 is made the default runtime image, while maintaining absolute parity and backwards-compatibility for existing PostgreSQL 18 installations.

## Decision
1. **Pre-start Upgrade Guardrail (`database/entrypoint-upgrade-guard.sh`)**:
   - We introduce an entrypoint wrapper script in `database/entrypoint-upgrade-guard.sh` integrated into `database/Dockerfile`.
   - Prior to invoking `/usr/local/bin/docker-entrypoint.sh postgres`, the script inspects `/var/lib/postgresql`.
   - It identifies the running major version (e.g., via `postgres -V` or the container environment `PG_MAJOR`).
   - If a previous major version directory (such as `/var/lib/postgresql/18/docker`) exists with a valid `PG_VERSION` file, but the current major version directory (e.g. `/var/lib/postgresql/19/docker`) does not exist or lacks `PG_VERSION`, the container halts immediately with exit code 1 and writes a clear, actionable error message to stderr explaining that major-version cluster migration is required using `scripts/upgrade-postgres.sh`.
   - If the current version data directory already exists, or if `/var/lib/postgresql` has no previous cluster data (fresh install), initialization proceeds normally.

2. **Dedicated Upgrade Script (`scripts/upgrade-postgres.sh`)**:
   - We introduce `scripts/upgrade-postgres.sh` to automate the transition of volume data from major version 18 to 19.
   - The script verifies host prerequisites: Docker availability, database container stopped status, available disk space (requiring at least 15% free disk space or sufficient headroom for pre-migration safety snapshots), and existence of `/var/lib/postgresql/18/docker`.
   - The script performs an immediate pre-upgrade local snapshot/copy of the data directory or verifies an existing database backup before modifying files.
   - It runs an ephemeral upgrade container equipped with both PostgreSQL 18 and 19 binaries executing `pg_upgrade --link` for near-instant, zero-copy migration directly inside the volume, while updating configuration and permissions.
   - In addition, it verifies that the upgraded cluster initializes cleanly.

3. **Documented Fallback & Procedure (`docs/DEPLOYMENT.md`)**:
   - `docs/DEPLOYMENT.md` is updated with complete operator documentation for both the fast path (`scripts/upgrade-postgres.sh`) and the universal fallback path (Instance backup restore via `docker compose exec backend /app/scripts/restore.sh`).
   - A structured rollback plan is documented should an upgrade fail.

4. **Default Image Invariance & Test Isolation**:
   - PostgreSQL 18 remains the default production and development version in `docker-compose.yml`, `database/Dockerfile`, `docker-compose.dev.yml`, and CI workflows.
   - Existing parity checks (`backend/src/__tests__/keepInStep.test.ts` and `backend/src/__tests__/deploymentDefaults.test.ts`) remain unchanged and fully passing.
   - New automated tests are added in `scripts/tests/test_postgres_upgrade.py` verifying the upgrade guard script, detection logic, argument handling, and volume layout invariants.

## Consequences
- Operators cannot accidentally start a newer PostgreSQL version and silently orphan their existing data.
- Fast in-place upgrades via `pg_upgrade --link` are reproducible and safe.
- Operators have clear documentation and scripted tooling ready ahead of the future PostgreSQL 19 default upgrade.
- No breaking changes are introduced to current PostgreSQL 18 deployments.