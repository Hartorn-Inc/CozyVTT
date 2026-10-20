# PostgreSQL 18, official volume layout, read-only database filesystem

Hartorn ships PostgreSQL 18 because this is an independent version, not CheekyChinchilla's stay-on-15 clock. Compose mounts the named volume at `/var/lib/postgresql` (the image's `PGDATA` is `/var/lib/postgresql/18/docker`); there is no dump/reload sidecar for 15 data directories. The database container is read-only, with tmpfs on `/tmp` and `/var/run/postgresql`. Renovate postgres majors stay off: a 19 tag on that parent mount would init empty `19/docker` beside unread 18 data.

**Status**: accepted
