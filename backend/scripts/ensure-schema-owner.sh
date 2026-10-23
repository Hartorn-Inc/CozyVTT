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

# psql interpolates :'var' only outside dollar-quoted strings, so these must
# stay at top level. format('%I'/'%L') then \gexec runs the quoted SQL.
if ! psql_as "$DATABASE_USER" "$DATABASE_PASSWORD" -q \
  -v "app_user=${DATABASE_APP_USER}" \
  -v "app_password=${DATABASE_APP_PASSWORD}" \
  -v "bootstrap_user=${DATABASE_USER}" \
  -v "db_name=${DATABASE_NAME}" <<'SQL'
SELECT format('CREATE ROLE %I', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user');
\gexec
SELECT format(
  'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'app_user',
  :'app_password'
);
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db_name', :'app_user');
\gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user');
\gexec
SELECT format('REASSIGN OWNED BY %I TO %I', :'bootstrap_user', :'app_user');
\gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user');
\gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'db_name', :'app_user');
\gexec
SQL
then
  fatal "CREATE/ALTER/GRANT/REASSIGN/OWNER change for the schema owner failed."
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
