# Specification: PostgreSQL 19 Preparation & Major-Version Upgrade Tooling

## 1. Overview

### 1.1 Context and Problem
CozyVTT runs PostgreSQL 18 (`postgres:18-alpine`) with its primary storage volume mounted at `/var/lib/postgresql`. The PostgreSQL Docker entrypoint initializes cluster data inside `/var/lib/postgresql/$PG_MAJOR/docker/` (specifically `/var/lib/postgresql/18/docker`).

Without safeguards, upgrading the PostgreSQL container image to major version 19 causes the standard PostgreSQL entrypoint to observe that `/var/lib/postgresql/19/docker` does not exist. It would therefore silently initialize a clean, empty PostgreSQL 19 database cluster alongside the existing `18/docker` directory. The application would then start without existing user data, leading to severe confusion and potential data corruption.

Furthermore, migrating a database cluster across PostgreSQL major versions requires `pg_upgrade` or dump/restore. Operators require deterministic upgrade tooling, automated guardrails against accidental silent cluster re-initialization, and comprehensive automated test suites validating this tooling before PostgreSQL 19 is made the default image.

### 1.2 Objectives
- Implement a robust pre-start upgrade guard script in `database/entrypoint-upgrade-guard.sh` integrated into `database/Dockerfile` that halts container startup if an unmigrated older cluster is detected on the mounted volume.
- Provide an automated upgrade tool `scripts/upgrade-postgres.sh` capable of running fast in-place `pg_upgrade --link` migrations from PostgreSQL 18 to 19, including pre-flight checks (disk space, container status, directory presence) and safety backups.
- Document the complete upgrade procedure and rollback strategy in `docs/DEPLOYMENT.md`.
- Provide automated unit and integration tests in `scripts/tests/test_postgres_upgrade.py` verifying guardrail detection, upgrade script logic, and volume invariants without modifying default PostgreSQL 18 pins or breaking `keepInStep.test.ts` and `deploymentDefaults.test.ts`.

---

## 2. Technical Architecture & Component Design

### 2.1 Database Entrypoint Guardrail (`database/entrypoint-upgrade-guard.sh`)

#### 2.1.1 Location & Lifecycle
- File: `database/entrypoint-upgrade-guard.sh`
- Mode: Executable (`chmod +x`)
- Invocation: Configured as the `ENTRYPOINT` in `database/Dockerfile`, wrapping the upstream `/usr/local/bin/docker-entrypoint.sh`.

#### 2.1.2 Guardrail Logic
1. Identify the current running major version from `$PG_MAJOR` (set by the official PostgreSQL image, e.g. `18` or `19`) or via `postgres -V`.
2. Determine base directory: `/var/lib/postgresql`.
3. Identify expected current cluster path: `/var/lib/postgresql/$PG_MAJOR/docker`.
4. Check if `/var/lib/postgresql/$PG_MAJOR/docker/PG_VERSION` exists.
   - If it exists, the current major version cluster is already initialized. Hand off immediately via `exec /usr/local/bin/docker-entrypoint.sh "$@"`.
5. If the current version cluster does NOT exist:
   - Inspect `/var/lib/postgresql` for any directory matching `[0-9]*/docker/PG_VERSION` or `[0-9]*/PG_VERSION`.
   - Check for previous versions, specifically checking for `18` (or any integer strictly less than `$PG_MAJOR`).
   - If an older cluster is detected (e.g. `/var/lib/postgresql/18/docker/PG_VERSION` containing `18`):
     - Print a prominent fatal error message to `stderr` explaining:
       ```text
       [FATAL] Existing PostgreSQL 18 data directory detected at /var/lib/postgresql/18/docker,
       but the container is running PostgreSQL 19.
       Automatic re-initialization of an empty cluster has been prevented to avoid data loss.
       Please run ./scripts/upgrade-postgres.sh to migrate your database cluster.
       ```
     - Exit with status code `1` immediately.
   - If no older cluster is detected (empty volume or brand new installation), allow startup to proceed by calling `exec /usr/local/bin/docker-entrypoint.sh "$@"`.

#### 2.1.3 Integration in `database/Dockerfile`
- The guard script is copied into `/usr/local/bin/entrypoint-upgrade-guard.sh`.
- Permissions are set to `755`.
- `ENTRYPOINT ["entrypoint-upgrade-guard.sh"]` and `CMD ["postgres"]` are set.
- The existing base image pin `postgres:18-alpine@sha256:...` and apk packages (`brotli-libs`, `libcurl`) remain intact.

### 2.2 Major-Version Upgrade Script (`scripts/upgrade-postgres.sh`)

#### 2.2.1 Location & Responsibilities
- File: `scripts/upgrade-postgres.sh`
- Invoked by the Operator from repository root when upgrading from PostgreSQL 18 to 19.

#### 2.2.2 Workflow Steps
1. **Pre-flight Checks**:
   - Ensure Docker is installed and running.
   - Verify that the database service is currently stopped (`docker compose ps --services --filter status=running` must not contain `database`). If running, prompt operator or instruct to stop with `docker compose stop database`.
   - Locate the target Docker volume or directory (default: `cozyvtt_postgres_data` or the volume bound to `/var/lib/postgresql`).
   - Check available host disk space on the Docker volume partition (requiring at least 15% free disk space for safety snapshots and temporary link metadata).
2. **Pre-upgrade Backup**:
   - Check for recent Instance backup or create an immediate local snapshot of `/var/lib/postgresql/18/docker` (e.g., archived to `./backend/backups/pre-pg19-upgrade-cluster-18.tar.gz` or a volume snapshot directory `18-backup`).
3. **Cluster Upgrade Execution (`pg_upgrade --link`)**:
   - Run an ephemeral container containing both PostgreSQL 18 and PostgreSQL 19 binaries (using `tianon/postgres-upgrade:18-to-19` or an equivalent dedicated migration container mount).
   - Mount `postgres_data` at `/var/lib/postgresql`.
   - Initialize new cluster directory `/var/lib/postgresql/19/docker` with `initdb` using identical encoding, locale (`C` or `en_US.utf8`), and authentication.
   - Execute `pg_upgrade` with `--old-datadir=/var/lib/postgresql/18/docker --new-datadir=/var/lib/postgresql/19/docker --old-bindir=/usr/lib/postgresql/18/bin --new-bindir=/usr/lib/postgresql/19/bin --link`.
   - Verify exit status of `pg_upgrade`.
4. **Post-Upgrade Verification & Finalization**:
   - Verify `/var/lib/postgresql/19/docker/PG_VERSION` contains `19`.
   - Adjust permissions ensuring UID `postgres:postgres` owns the new cluster.
   - Provide summary instructions to operator: update docker-compose.yml image, start container, run `vacuumdb --all --analyze-in-stages`.

### 2.3 Fallback & Recovery Strategy (`docs/DEPLOYMENT.md`)

Documentation updates in `docs/DEPLOYMENT.md` detailing:
1. The automated path via `scripts/upgrade-postgres.sh`.
2. The universal fallback path using standard Instance backups:
   - Create backup on PostgreSQL 18: `docker compose exec backend /app/scripts/backup.sh`.
   - Stop stack: `docker compose down`.
   - Create fresh volume or clear `/var/lib/postgresql`.
   - Switch image to PostgreSQL 19.
   - Start database and restore: `docker compose exec backend /app/scripts/restore.sh <backup-file>`.
3. Rollback procedure if in-place upgrade fails:
   - Restore previous `18/docker` directory from the pre-upgrade snapshot.
   - Re-pin to `cozyvtt-database:latest` (PG 18).
   - Start container: `docker compose up -d database`.

### 2.4 Testing Architecture (`scripts/tests/test_postgres_upgrade.py`)

Add unit and scenario tests using Python's `unittest` module in `scripts/tests/test_postgres_upgrade.py`:
1. **Guardrail Logic Unit Tests**:
   - Test execution when target directory matches current `$PG_MAJOR`: succeeds.
   - Test execution when volume is completely empty: succeeds (fresh install).
   - Test execution when older cluster (e.g. `18/docker/PG_VERSION`) exists and `$PG_MAJOR` is 19: exits with code 1 and writes fatal error to stderr.
2. **Upgrade Script Argument & Health Checks**:
   - Test disk space requirement validation.
   - Test volume detection and argument validation.
   - Test prerequisite failure handling (e.g. when database container is actively running).
3. **Configuration & Invariant Tests**:
   - Confirm that `database/Dockerfile` still pins PostgreSQL 18.
   - Confirm that `docker-compose.yml`, `docker-compose.dev.yml`, and `.github/workflows/ci.yml` retain matching pins.
   - Confirm that `database/entrypoint-upgrade-guard.sh` has POSIX-compliant syntax and executable permissions.

---

## 3. Detailed File Changes

### 3.1 `database/entrypoint-upgrade-guard.sh`
- Shell script (`#!/bin/sh` with `set -eu`).
- Detects current major version `$PG_MAJOR`.
- Checks `/var/lib/postgresql` contents.
- Prevents silent reinitialization when older clusters exist.
- Transfers control to `/usr/local/bin/docker-entrypoint.sh "$@"`.

### 3.2 `database/Dockerfile`
- `COPY entrypoint-upgrade-guard.sh /usr/local/bin/entrypoint-upgrade-guard.sh`
- `RUN chmod +x /usr/local/bin/entrypoint-upgrade-guard.sh`
- `ENTRYPOINT ["entrypoint-upgrade-guard.sh"]`
- `CMD ["postgres"]`
- Keeps Alpine package fixes (`brotli-libs`, `libcurl`).

### 3.3 `scripts/upgrade-postgres.sh`
- Standalone bash/sh script for operator execution.
- Provides automated pre-flight checks, backup confirmation, ephemeral container invocation for `pg_upgrade --link`, and post-check verification.

### 3.4 `docs/DEPLOYMENT.md`
- New section: "Major PostgreSQL Version Upgrades".
- Complete step-by-step instructions for running `scripts/upgrade-postgres.sh`.
- Explanation of the guardrail and error handling.
- Rollback steps and dump/restore fallback instructions.

### 3.5 `scripts/tests/test_postgres_upgrade.py`
- Automated Python unit tests verifying script execution, guardrail simulation, error messages, and repository consistency.

---

## 4. Verification and Acceptance Criteria

1. **Guardrail Protection**:
   - Starting a PG 19 container against a mock volume containing `/var/lib/postgresql/18/docker/PG_VERSION` must exit with non-zero status and display the fatal error message.
   - Starting on an empty volume must proceed without error.
   - Starting on a matching volume (PG 18 on 18 data or PG 19 on 19 data) must proceed without error.
2. **Tooling & Procedures**:
   - `scripts/upgrade-postgres.sh` executes pre-flight checks and provides detailed progress and rollback instructions.
   - `docs/DEPLOYMENT.md` clearly describes the upgrade workflow, safety backups, and fallback restore path.
3. **Regression Safety**:
   - Existing tests `npm test keepInStep.test.ts` and `npm test deploymentDefaults.test.ts` continue to pass without changes to their expected pins.
   - Python test suite `python3 -m unittest discover -s scripts/tests` runs cleanly and includes `test_postgres_upgrade.py`.