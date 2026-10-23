#!/bin/bash
# Create or update the non-superuser schema owner before migrations run.
#
# Compose still lets the official image create DATABASE_USER as a superuser on
# an empty volume. The backend must not migrate or connect as that role. This
# helper runs on every backend start: first start after upgrade creates
# DATABASE_APP_USER (default cozyvtt_app) or refuses to boot.

set -euo pipefail

fatal() {
  echo "❌ Error: $*"
  echo "   See docs/DEPLOYMENT.md"
  exit 1
}

SIMPLE='^[A-Za-z_][A-Za-z0-9_]*$'

DATABASE_USER="${DATABASE_USER:-}"
DATABASE_PASSWORD="${DATABASE_PASSWORD:-}"
DATABASE_APP_USER="${DATABASE_APP_USER:-cozyvtt_app}"
DATABASE_APP_PASSWORD="${DATABASE_APP_PASSWORD:-${DATABASE_PASSWORD:-}}"
DATABASE_NAME="${DATABASE_NAME:-cozyvtt}"
DB_HOST="${DB_HOST:-}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-}"

if [ -z "$DATABASE_USER" ] || [ -z "$DATABASE_PASSWORD" ]; then
  fatal "bootstrap credentials are missing (DATABASE_USER and DATABASE_PASSWORD)."
fi

if [ -z "$DATABASE_APP_PASSWORD" ]; then
  fatal "schema owner password is missing (DATABASE_APP_PASSWORD or DATABASE_PASSWORD)."
fi

if [ -z "$DB_HOST" ]; then
  fatal "database host is missing."
fi

if [[ ! "$DATABASE_USER" =~ $SIMPLE ]]; then
  fatal "DATABASE_USER is not a simple identifier (use letters, digits and underscore)."
fi
if [[ ! "$DATABASE_APP_USER" =~ $SIMPLE ]]; then
  fatal "DATABASE_APP_USER is not a simple identifier (use letters, digits and underscore)."
fi
if [[ ! "$DATABASE_NAME" =~ $SIMPLE ]]; then
  fatal "DATABASE_NAME is not a simple identifier (use letters, digits and underscore)."
fi

if [ "$DATABASE_APP_USER" = "$DATABASE_USER" ]; then
  fatal "DATABASE_APP_USER equals DATABASE_USER; the schema owner must not be the bootstrap superuser."
fi

if [ -n "$DB_USER" ] && [ "$DB_USER" = "$DATABASE_USER" ]; then
  fatal "DATABASE_URL still points at the bootstrap superuser; the backend must connect as the schema owner."
fi

if ! command -v psql >/dev/null 2>&1; then
  fatal "psql is not available, so the schema owner cannot be created."
fi

psql_as() {
  local user="$1"
  local password="$2"
  shift 2
  PGPASSWORD="$password" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$user" \
    -d "$DATABASE_NAME" \
    --no-password \
    -v ON_ERROR_STOP=1 \
    "$@"
}

bootstrap_super=""
if ! bootstrap_super="$(psql_as "$DATABASE_USER" "$DATABASE_PASSWORD" -tAqc "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")"; then
  fatal "cannot connect as the bootstrap superuser ($DATABASE_USER)."
fi
bootstrap_super="$(printf '%s' "$bootstrap_super" | tr -d '[:space:]')"
if [ "$bootstrap_super" != "t" ]; then
  fatal "bootstrap role ($DATABASE_USER) is not a superuser (rolsuper)."
fi

# psql interpolates :'var' / :"var" only outside dollar-quoted strings, so
# these stay at top level. CREATE ROLE uses a catalog predicate (PostgreSQL 18
# has no IF NOT EXISTS clause on CREATE ROLE). Do not REASSIGN OWNED BY the bootstrap
# superuser: PostgreSQL 18 refuses that with "cannot reassign ownership of
# objects owned by role … because they are required by the database system".
# ALTER ROLE … PASSWORD is a single statement so \gexec never prints it.
if ! psql_as "$DATABASE_USER" "$DATABASE_PASSWORD" -q \
  -v "app_user=${DATABASE_APP_USER}" \
  -v "app_password=${DATABASE_APP_PASSWORD}" \
  -v "bootstrap_user=${DATABASE_USER}" \
  -v "db_name=${DATABASE_NAME}" <<'SQL'
SELECT format('CREATE ROLE %I', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user');
\gexec
ALTER ROLE :"app_user" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
GRANT CONNECT ON DATABASE :"db_name" TO :"app_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
ALTER DATABASE :"db_name" OWNER TO :"app_user";
ALTER SCHEMA public OWNER TO :"app_user";
SELECT format(
  'ALTER %s %I.%I OWNER TO %I',
  CASE c.relkind
    WHEN 'r' THEN 'TABLE'
    WHEN 'p' THEN 'TABLE'
    WHEN 'S' THEN 'SEQUENCE'
    WHEN 'v' THEN 'VIEW'
    WHEN 'm' THEN 'MATERIALIZED VIEW'
    WHEN 'f' THEN 'FOREIGN TABLE'
  END,
  n.nspname,
  c.relname,
  :'app_user'
)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles o ON o.oid = c.relowner
WHERE o.rolname = :'bootstrap_user'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
  AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f');
\gexec
SQL
then
  fatal "CREATE/ALTER/GRANT/OWNER change for the schema owner failed."
fi

app_super=""
if ! app_super="$(psql_as "$DATABASE_APP_USER" "$DATABASE_APP_PASSWORD" -tAqc "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")"; then
  fatal "cannot connect as the schema owner ($DATABASE_APP_USER)."
fi
app_super="$(printf '%s' "$app_super" | tr -d '[:space:]')"
if [ "$app_super" = "t" ]; then
  fatal "schema owner ($DATABASE_APP_USER) is still a superuser after ensure."
fi
if [ "$app_super" != "f" ]; then
  fatal "could not confirm the schema owner ($DATABASE_APP_USER) is not a superuser."
fi

echo "✅ Schema owner ensured ($DATABASE_APP_USER)"
