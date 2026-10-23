"""Fail-closed checks for the schema-owner helper and Compose boot contract.

    python3 -m unittest discover -s scripts/tests
"""

import io
import os
import shutil
import stat
import subprocess
import tempfile
import time
import unittest
from urllib.parse import quote, unquote, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HELPER = os.path.join(ROOT, 'backend', 'scripts', 'ensure-schema-owner.sh')
START = os.path.join(ROOT, 'backend', 'scripts', 'start.sh')
BACKUP = os.path.join(ROOT, 'backend', 'scripts', 'backup.sh')
RESTORE = os.path.join(ROOT, 'backend', 'scripts', 'restore.sh')
DEPLOYMENT = os.path.join(ROOT, 'docs', 'DEPLOYMENT.md')
SECURITY = os.path.join(ROOT, 'SECURITY.md')

FAKE_PSQL = r'''#!/bin/sh
log="${FAKE_PSQL_LOG:-/tmp/fake-psql.log}"
user=""
prev=""
cmd=""
for a in "$@"; do
  if [ "$prev" = "-U" ]; then user="$a"; fi
  if [ "$prev" = "-c" ] || [ "$prev" = "-tAqc" ]; then cmd="$a"; fi
  prev="$a"
  printf 'ARG:%s\n' "$a" >> "$log"
done
printf 'USER:%s\n' "$user" >> "$log"
if [ -n "$PGPASSWORD" ]; then
  printf 'PGPASSWORD_SET=yes\n' >> "$log"
else
  printf 'PGPASSWORD_SET=no\n' >> "$log"
fi
if [ "${FAKE_PSQL_FAIL_USER:-}" != "" ] && [ "$user" = "$FAKE_PSQL_FAIL_USER" ]; then
  echo "psql: connection failed" >&2
  exit 2
fi
if [ -n "$cmd" ]; then
  printf 'CMD:%s\n' "$cmd" >> "$log"
  if echo "$cmd" | grep -q rolsuper; then
    if [ "$user" = "${FAKE_BOOTSTRAP_USER:-cozyvtt}" ]; then
      printf '%s\n' "${FAKE_BOOTSTRAP_SUPER:-t}"
    else
      printf '%s\n' "${FAKE_APP_SUPER:-f}"
    fi
    exit 0
  fi
fi
if [ "${FAKE_PSQL_FAIL_SQL:-}" = "1" ]; then
  echo "psql: SQL failed" >&2
  exit 1
fi
if [ ! -t 0 ]; then
  sql=$(cat)
  printf 'SQL:%s\n' "$sql" >> "$log"
  # psql sends the buffer on ';' and \gexec then has nothing to run. Fail the
  # same way so this fake cannot stay green when CREATE ROLE never issues.
  printf '%s\n' "$sql" | awk '
    BEGIN { buf = "" }
    /^[[:space:]]*\\gexec([[:space:]]|$)/ {
      tmp = buf
      gsub(/[[:space:]]/, "", tmp)
      if (tmp == "" || tmp ~ /;$/) {
        print "psql: \\gexec: no query buffer" > "/dev/stderr"
        exit 3
      }
      buf = ""
      next
    }
    /^[[:space:]]*\\/ { next }
    { buf = buf $0 "\n" }
  ' || exit 1
fi
exit 0
'''


def read(path):
    with io.open(path, encoding='utf-8') as source:
        return source.read()


class SchemaOwnerStatic(unittest.TestCase):
    def test_helper_fail_closed_messages_and_sql_shape(self):
        helper = read(HELPER)
        start = read(START)
        self.assertIn('❌ Error:', helper)
        self.assertIn('docs/DEPLOYMENT.md', helper)
        self.assertIn("format('CREATE ROLE %I'", helper)
        self.assertIn('WHERE NOT EXISTS', helper)
        uncommented = '\n'.join(
            line for line in helper.splitlines() if not line.lstrip().startswith('#')
        )
        self.assertNotIn('CREATE ROLE IF NOT EXISTS', uncommented)
        self.assertIn("PASSWORD :'app_password'", helper)
        self.assertNotIn('PASSWORD %L', helper)
        self.assertIn('\\gexec', helper)
        self.assertNotRegex(helper, r';\s*\\gexec')
        self.assertIn('\\getenv app_password DATABASE_APP_PASSWORD', helper)
        self.assertNotIn('-v "app_password=', helper)
        self.assertNotIn('DO $ensure$', helper)
        self.assertIn('-v ON_ERROR_STOP=1', helper)
        self.assertIn('CREATE ROLE', helper)
        self.assertIn('NOSUPERUSER', helper)
        self.assertIn('NOCREATEDB', helper)
        self.assertIn('NOCREATEROLE', helper)
        self.assertIn('NOREPLICATION', helper)
        self.assertIn('NOBYPASSRLS', helper)
        self.assertNotIn('REASSIGN OWNED', uncommented)
        self.assertIn('required by the database system', helper)
        self.assertIn("ALTER %s %I.%I OWNER TO %I", helper)
        self.assertIn('pg_proc', helper)
        self.assertIn('pg_type', helper)
        self.assertIn('oid::regprocedure', helper)
        self.assertIn("typtype IN ('e', 'd', 'c')", helper)
        self.assertIn('ALTER SCHEMA public OWNER TO', helper)
        self.assertIn('ALTER DATABASE', helper)
        self.assertNotRegex(uncommented, r'\bnpx\b')
        self.assertLess(start.index('ensure-schema-owner.sh'), start.index('prisma migrate deploy'))
        self.assertIn('prisma migrate deploy', start)
        uncommented_start = '\n'.join(
            line for line in start.splitlines() if not line.lstrip().startswith('#')
        )
        self.assertNotRegex(uncommented_start, r'\bnpx\b')

    def test_docker_backup_restore_use_the_schema_owner(self):
        self.assertIn('DB_USER="${DATABASE_APP_USER:-cozyvtt_app}"', read(BACKUP))
        self.assertIn('DB_USER="${DATABASE_APP_USER:-cozyvtt_app}"', read(RESTORE))
        self.assertIn('--no-owner --no-privileges', read(BACKUP))

    def test_operator_docs_name_both_roles_and_fail_closed_boot(self):
        deployment = read(DEPLOYMENT)
        self.assertIn('bootstrap superuser', deployment.lower())
        self.assertIn('schema owner', deployment.lower())
        self.assertIn('refuses to start', deployment)
        self.assertIn('DATABASE_APP_USER', deployment)
        self.assertNotRegex(read(SECURITY), r'recorded for later')
        migrations = read(os.path.join(ROOT, 'backend', 'DATABASE_MIGRATIONS.md'))
        self.assertIn('schema owner', migrations.lower())
        self.assertLess(migrations.lower().index('schema owner'), migrations.index('prisma migrate deploy'))


class SchemaOwnerHelper(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='cozyvtt-schema-owner-')
        self.bin = os.path.join(self.tmp, 'bin')
        os.mkdir(self.bin)
        self.log = os.path.join(self.tmp, 'psql.log')
        psql = os.path.join(self.bin, 'psql')
        with io.open(psql, 'w', encoding='utf-8') as handle:
            handle.write(FAKE_PSQL)
        os.chmod(psql, os.stat(psql).st_mode | stat.S_IEXEC)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_helper(self, extra_env=None, drop=()):
        env = {
            'PATH': self.bin + os.pathsep + os.environ.get('PATH', ''),
            'HOME': self.tmp,
            'FAKE_PSQL_LOG': self.log,
            'FAKE_BOOTSTRAP_USER': 'cozyvtt',
            'DATABASE_USER': 'cozyvtt',
            'DATABASE_PASSWORD': 'bootsecret',
            'DATABASE_APP_USER': 'cozyvtt_app',
            'DATABASE_APP_PASSWORD': 'appsecret',
            'DATABASE_NAME': 'cozyvtt',
            'DB_HOST': '127.0.0.1',
            'DB_PORT': '5432',
            'DB_USER': 'cozyvtt_app',
        }
        if extra_env:
            env.update(extra_env)
        for key in drop:
            env.pop(key, None)
        return subprocess.run(
            ['bash', HELPER],
            cwd=self.tmp,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def combined(self, result):
        return result.stdout + result.stderr

    def test_refuses_missing_bootstrap_credentials(self):
        result = self.run_helper(drop=('DATABASE_PASSWORD',))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('❌ Error:', self.combined(result))
        self.assertIn('docs/DEPLOYMENT.md', self.combined(result))
        self.assertIn('bootstrap credentials', self.combined(result))
        self.assertNotIn('bootsecret', self.combined(result))
        self.assertNotIn('appsecret', self.combined(result))

    def test_refuses_when_app_user_equals_bootstrap_user(self):
        result = self.run_helper(extra_env={'DATABASE_APP_USER': 'cozyvtt', 'DB_USER': 'cozyvtt'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('equals DATABASE_USER', self.combined(result))
        self.assertIn('docs/DEPLOYMENT.md', self.combined(result))

    def test_refuses_when_database_url_points_at_the_bootstrap_superuser(self):
        result = self.run_helper(extra_env={'DB_USER': 'cozyvtt'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('DATABASE_URL still points at the bootstrap superuser', self.combined(result))

    def test_refuses_non_simple_identifiers(self):
        result = self.run_helper(extra_env={'DATABASE_APP_USER': 'cozy-vtt'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('simple identifier', self.combined(result))

    def test_refuses_when_bootstrap_cannot_connect(self):
        result = self.run_helper(extra_env={'FAKE_PSQL_FAIL_USER': 'cozyvtt'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('cannot connect as the bootstrap superuser', self.combined(result))
        self.assertIn('docs/DEPLOYMENT.md', self.combined(result))

    def test_refuses_when_bootstrap_is_not_superuser(self):
        result = self.run_helper(extra_env={'FAKE_BOOTSTRAP_SUPER': 'f'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('is not a superuser', self.combined(result))

    def test_refuses_when_create_alter_grant_fails(self):
        result = self.run_helper(extra_env={'FAKE_PSQL_FAIL_SQL': '1'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('CREATE/ALTER/GRANT/OWNER', self.combined(result))

    def test_refuses_when_schema_owner_cannot_connect(self):
        result = self.run_helper(extra_env={'FAKE_PSQL_FAIL_USER': 'cozyvtt_app'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('cannot connect as the schema owner', self.combined(result))

    def test_refuses_when_schema_owner_is_still_superuser(self):
        result = self.run_helper(extra_env={'FAKE_APP_SUPER': 't'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('still a superuser', self.combined(result))

    def test_success_creates_role_via_psql_variables_without_logging_passwords(self):
        result = self.run_helper()
        self.assertEqual(result.returncode, 0, self.combined(result))
        self.assertIn('Schema owner ensured', result.stdout)
        self.assertNotIn('bootsecret', self.combined(result))
        self.assertNotIn('appsecret', self.combined(result))
        logged = read(self.log)
        self.assertNotIn('bootsecret', logged)
        self.assertNotIn('appsecret', logged)
        self.assertNotIn('ARG:app_password=', logged)
        self.assertIn('\\getenv app_password DATABASE_APP_PASSWORD', logged)
        self.assertIn("format('CREATE ROLE %I'", logged)
        self.assertIn('WHERE NOT EXISTS', logged)
        self.assertNotIn('CREATE ROLE IF NOT EXISTS', logged)
        uncommented_sql = '\n'.join(
            line for line in logged.splitlines() if not line.lstrip().startswith('#')
        )
        self.assertNotIn('REASSIGN OWNED', uncommented_sql)
        self.assertNotRegex(uncommented_sql, r';\s*\\gexec')
        self.assertIn("PASSWORD :'app_password'", logged)
        self.assertIn("ALTER %s %I.%I OWNER TO %I", logged)
        self.assertIn('pg_proc', logged)
        self.assertIn('pg_type', logged)
        self.assertIn('\\gexec', logged)
        self.assertNotIn("PASSWORD 'appsecret'", logged)


PRISMA = os.path.join(ROOT, 'backend', 'node_modules', '.bin', 'prisma')
LIVE_DB_NAME = 'cozyvtt_schema_owner_live'
BOOTSTRAP_USER = 'cozyvtt'
BOOTSTRAP_PASSWORD = 'bootsecret'
APP_USER = 'cozyvtt_app'
APP_PASSWORD = 'appsecret'

SEED_SQL = r'''
CREATE TYPE "CampaignStatus_upgrade_probe" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE OR REPLACE FUNCTION reject_revoked_login_session()
RETURNS trigger AS $$
BEGIN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
'''

OWNER_QUERY = (
    "SELECT pg_get_userbyid(p.proowner) || ' ' || pg_get_userbyid(t.typowner) "
    "FROM pg_proc p "
    "JOIN pg_namespace n ON n.oid = p.pronamespace "
    "CROSS JOIN pg_type t "
    "JOIN pg_namespace tn ON tn.oid = t.typnamespace "
    "WHERE p.proname = 'reject_revoked_login_session' "
    "AND n.nspname = 'public' "
    "AND t.typname = 'CampaignStatus_upgrade_probe' "
    "AND tn.nspname = 'public'"
)

ALTER_TYPE_SQL = "ALTER TYPE \"CampaignStatus_upgrade_probe\" ADD VALUE 'ENDED';"


def _pg_url(user, password, host, port, dbname):
    return 'postgresql://%s:%s@%s:%s/%s' % (
        quote(user, safe=''),
        quote(password, safe=''),
        host,
        port,
        quote(dbname, safe=''),
    )


def _prisma_migrate(url):
    return subprocess.run(
        [PRISMA, 'migrate', 'deploy'],
        cwd=os.path.join(ROOT, 'backend'),
        env={**os.environ, 'DATABASE_URL': url},
        capture_output=True,
        text=True,
        check=False,
    )


def _parse_pg_url(url):
    parsed = urlparse(url)
    return {
        'user': unquote(parsed.username or ''),
        'password': unquote(parsed.password or ''),
        'host': parsed.hostname or '127.0.0.1',
        'port': str(parsed.port or 5432),
        'dbname': unquote((parsed.path or '/').lstrip('/').split('?')[0]),
    }


def _psql(host, port, user, password, dbname, *args, sql=None, check=True):
    command = [
        _pg_bin('psql'),
        '-h', host,
        '-p', str(port),
        '-U', user,
        '-d', dbname,
        '--no-password',
        '-v', 'ON_ERROR_STOP=1',
    ]
    command.extend(args)
    env = dict(os.environ)
    pg_bin_dir = os.path.dirname(_pg_bin('psql') or '')
    if pg_bin_dir:
        env['PATH'] = pg_bin_dir + os.pathsep + env.get('PATH', '')
    env['PGPASSWORD'] = password
    env['PGHOST'] = host
    return subprocess.run(
        command,
        input=sql,
        env=env,
        capture_output=True,
        text=True,
        check=check,
    )


def _revocation_guard_sql():
    source = read(os.path.join(ROOT, 'backend', 'src', 'config', 'loginSessionRevocationGuard.ts'))
    marker = 'export const LOGIN_SESSION_REVOCATION_GUARD_SQL = `'
    start = source.index(marker) + len(marker)
    end = source.index('`;', start)
    return source[start:end]


def _docker_usable():
    if os.environ.get('SCHEMA_OWNER_TEST_ALLOW_DOCKER') != '1':
        return False
    docker = shutil.which('docker')
    if not docker:
        return False
    try:
        return subprocess.run([docker, 'info'], capture_output=True, timeout=5).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _database_url():
    dedicated = os.environ.get('SCHEMA_OWNER_TEST_DATABASE_URL')
    if dedicated:
        return dedicated
    url = os.environ.get('DATABASE_URL')
    if not url:
        return None
    dbname = _parse_pg_url(url).get('dbname') or ''
    if 'test' not in dbname.lower():
        return None
    return url


def _pg_bin(name):
    found = shutil.which(name)
    if found:
        return found
    for version in ('18', '17', '16'):
        candidate = '/usr/lib/postgresql/%s/bin/%s' % (version, name)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _have_live_postgres():
    if not _pg_bin('psql'):
        return False
    if _database_url():
        return True
    if _pg_bin('initdb') and _pg_bin('pg_ctl'):
        return True
    return _docker_usable()


class _LiveCluster(object):
    def __init__(self, host, port, user, password, dbname, cleanup):
        self.host = host
        self.port = str(port)
        self.user = user
        self.password = password
        self.dbname = dbname
        self._cleanup = cleanup

    def close(self):
        self._cleanup()


def _wait_psql(host, port, user, password, dbname, attempts=30):
    last = None
    for _ in range(attempts):
        last = _psql(host, port, user, password, dbname, '-tAqc', 'SELECT 1', check=False)
        if last.returncode == 0:
            return
        time.sleep(1)
    raise RuntimeError('postgres did not become ready: %s%s' % (last.stdout, last.stderr))


def _start_live_cluster():
    url = _database_url()
    if url:
        if not _pg_bin('psql'):
            raise RuntimeError('DATABASE_URL is set but psql is not available')
        parsed = _parse_pg_url(url)
        admin_db = parsed['dbname'] or 'postgres'

        def cleanup():
            _psql(
                parsed['host'], parsed['port'], parsed['user'], parsed['password'], admin_db,
                '-c',
                (
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = '%s' AND pid <> pg_backend_pid(); "
                    "DROP DATABASE IF EXISTS %s;"
                ) % (LIVE_DB_NAME, LIVE_DB_NAME),
                check=False,
            )

        cleanup()
        _psql(
            parsed['host'], parsed['port'], parsed['user'], parsed['password'], admin_db,
            '-c', 'CREATE DATABASE %s' % LIVE_DB_NAME,
        )
        return _LiveCluster(
            parsed['host'], parsed['port'], parsed['user'], parsed['password'], LIVE_DB_NAME, cleanup,
        )

    tmp = tempfile.mkdtemp(prefix='cozyvtt-pg-')
    initdb = _pg_bin('initdb')
    pg_ctl = _pg_bin('pg_ctl')
    if initdb and pg_ctl:
        data = os.path.join(tmp, 'data')
        pwfile = os.path.join(tmp, 'pwfile')
        with io.open(pwfile, 'w', encoding='utf-8') as handle:
            handle.write(BOOTSTRAP_PASSWORD + '\n')
        subprocess.run(
            [
                initdb, '-D', data,
                '--auth-host=scram-sha-256',
                '--auth-local=scram-sha-256',
                '-U', BOOTSTRAP_USER,
                '--pwfile', pwfile,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        port = '55432'
        sock = os.path.join(tmp, 'run')
        os.mkdir(sock)
        started = subprocess.run(
            [
                pg_ctl, '-D', data, '-o',
                '-h 127.0.0.1 -k %s -p %s' % (sock, port),
                '-l', os.path.join(tmp, 'pg.log'),
                'start',
            ],
            capture_output=True,
            text=True,
        )
        if started.returncode != 0:
            log = ''
            try:
                log = read(os.path.join(tmp, 'pg.log'))
            except OSError:
                log = started.stderr
            subprocess.run([pg_ctl, '-D', data, 'stop', '-m', 'immediate'], capture_output=True)
            shutil.rmtree(tmp, ignore_errors=True)
            raise RuntimeError('pg_ctl start failed: %s\n%s' % (started.stderr, log))

        def cleanup():
            subprocess.run([pg_ctl, '-D', data, 'stop', '-m', 'immediate'], capture_output=True)
            shutil.rmtree(tmp, ignore_errors=True)

        try:
            _wait_psql('127.0.0.1', port, BOOTSTRAP_USER, BOOTSTRAP_PASSWORD, 'postgres')
            _psql(
                '127.0.0.1', port, BOOTSTRAP_USER, BOOTSTRAP_PASSWORD, 'postgres',
                '-c', 'CREATE DATABASE cozyvtt',
            )
        except Exception:
            cleanup()
            raise
        return _LiveCluster('127.0.0.1', port, BOOTSTRAP_USER, BOOTSTRAP_PASSWORD, 'cozyvtt', cleanup)

    if _docker_usable():
        name = 'cozyvtt-schema-owner-%s' % os.getpid()
        port = '55439'
        image = os.environ.get('SCHEMA_OWNER_TEST_PG_IMAGE', 'postgres:18-alpine')
        run = subprocess.run(
            [
                'docker', 'run', '-d', '--rm', '--name', name,
                '-e', 'POSTGRES_USER=%s' % BOOTSTRAP_USER,
                '-e', 'POSTGRES_PASSWORD=%s' % BOOTSTRAP_PASSWORD,
                '-e', 'POSTGRES_DB=cozyvtt',
                '-e', 'POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
                '-e', 'POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256',
                '-p', '127.0.0.1:%s:5432' % port,
                image,
            ],
            capture_output=True,
            text=True,
        )
        if run.returncode != 0:
            shutil.rmtree(tmp, ignore_errors=True)
            raise unittest.SkipTest('docker could not start PostgreSQL 18: %s' % (run.stderr or run.stdout))

        def cleanup():
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
            shutil.rmtree(tmp, ignore_errors=True)

        try:
            _wait_psql('127.0.0.1', port, BOOTSTRAP_USER, BOOTSTRAP_PASSWORD, 'cozyvtt', attempts=60)
        except Exception:
            cleanup()
            raise
        return _LiveCluster('127.0.0.1', port, BOOTSTRAP_USER, BOOTSTRAP_PASSWORD, 'cozyvtt', cleanup)

    shutil.rmtree(tmp, ignore_errors=True)
    raise unittest.SkipTest('live Postgres is not available')


@unittest.skipUnless(
    _have_live_postgres(),
    'live Postgres (DATABASE_URL, initdb/pg_ctl, or docker) is not available',
)
class SchemaOwnerLivePostgres(unittest.TestCase):
    def test_upgrade_boot_reassigns_functions_and_types_then_migrates(self):
        cluster = _start_live_cluster()
        tmp = tempfile.mkdtemp(prefix='cozyvtt-schema-owner-home-')
        try:
            if os.path.exists(PRISMA):
                boot_migrate = _prisma_migrate(
                    _pg_url(cluster.user, cluster.password, cluster.host, cluster.port, cluster.dbname)
                )
                self.assertEqual(boot_migrate.returncode, 0, boot_migrate.stdout + boot_migrate.stderr)

            seed = _psql(
                cluster.host, cluster.port, cluster.user, cluster.password, cluster.dbname,
                sql=SEED_SQL, check=False,
            )
            self.assertEqual(seed.returncode, 0, seed.stdout + seed.stderr)

            before = _psql(
                cluster.host, cluster.port, cluster.user, cluster.password, cluster.dbname,
                '-tAqc', OWNER_QUERY,
            )
            self.assertEqual(before.stdout.strip(), '%s %s' % (cluster.user, cluster.user))

            helper_path = os.environ.get('PATH', '')
            psql_dir = os.path.dirname(_pg_bin('psql') or '')
            if psql_dir:
                helper_path = psql_dir + os.pathsep + helper_path
            result = subprocess.run(
                ['bash', HELPER],
                env={
                    'PATH': helper_path,
                    'HOME': tmp,
                    'DATABASE_USER': cluster.user,
                    'DATABASE_PASSWORD': cluster.password,
                    'DATABASE_APP_USER': APP_USER,
                    'DATABASE_APP_PASSWORD': APP_PASSWORD,
                    'DATABASE_NAME': cluster.dbname,
                    'DB_HOST': cluster.host,
                    'DB_PORT': cluster.port,
                    'DB_USER': APP_USER,
                },
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('Schema owner ensured', result.stdout)
            self.assertNotIn(cluster.password, result.stdout + result.stderr)
            self.assertNotIn(APP_PASSWORD, result.stdout + result.stderr)

            wrong = _psql(
                cluster.host, cluster.port, APP_USER, 'wrong-password', cluster.dbname,
                '-tAqc', 'SELECT 1', check=False,
            )
            self.assertNotEqual(wrong.returncode, 0, 'schema owner connected without the scram password')

            role = _psql(
                cluster.host, cluster.port, APP_USER, APP_PASSWORD, cluster.dbname,
                '-tAqc',
                'SELECT rolsuper FROM pg_roles WHERE rolname = current_user',
            )
            self.assertEqual(role.stdout.strip(), 'f')

            owners = _psql(
                cluster.host, cluster.port, APP_USER, APP_PASSWORD, cluster.dbname,
                '-tAqc', OWNER_QUERY,
            )
            self.assertEqual(owners.stdout.strip(), '%s %s' % (APP_USER, APP_USER))

            alter_type = _psql(
                cluster.host, cluster.port, APP_USER, APP_PASSWORD, cluster.dbname,
                sql=ALTER_TYPE_SQL, check=False,
            )
            self.assertEqual(alter_type.returncode, 0, alter_type.stdout + alter_type.stderr)

            replace_fn = _psql(
                cluster.host, cluster.port, APP_USER, APP_PASSWORD, cluster.dbname,
                sql=_revocation_guard_sql(), check=False,
            )
            self.assertEqual(replace_fn.returncode, 0, replace_fn.stdout + replace_fn.stderr)

            if os.path.exists(PRISMA):
                migrate = _prisma_migrate(
                    _pg_url(APP_USER, APP_PASSWORD, cluster.host, cluster.port, cluster.dbname)
                )
                self.assertEqual(migrate.returncode, 0, migrate.stdout + migrate.stderr)
            elif _database_url():
                self.fail('prisma migrate deploy is required when DATABASE_URL is set, but %s is missing' % PRISMA)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            cluster.close()
