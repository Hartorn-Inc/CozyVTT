"""Fail-closed checks for the schema-owner helper and Compose boot contract.

    python3 -m unittest discover -s scripts/tests
"""

import io
import os
import shutil
import stat
import subprocess
import tempfile
import unittest

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
        self.assertIn('ARG:app_password=appsecret', logged)
        self.assertIn("format('CREATE ROLE %I'", logged)
        self.assertIn('WHERE NOT EXISTS', logged)
        self.assertNotIn('CREATE ROLE IF NOT EXISTS', logged)
        uncommented_sql = '\n'.join(
            line for line in logged.splitlines() if not line.lstrip().startswith('#')
        )
        self.assertNotIn('REASSIGN OWNED', uncommented_sql)
        self.assertIn("PASSWORD :'app_password'", logged)
        self.assertIn("ALTER %s %I.%I OWNER TO %I", logged)
        self.assertIn('\\gexec', logged)
        self.assertNotIn("PASSWORD 'appsecret'", logged)


have_live_postgres = shutil.which('initdb') and shutil.which('pg_ctl') and shutil.which('psql')


@unittest.skipUnless(
    have_live_postgres,
    'live Postgres (initdb/pg_ctl/psql) is not installed in this environment',
)
class SchemaOwnerLivePostgres(unittest.TestCase):
    def test_creates_a_nonsuperuser_schema_owner_on_a_throwaway_cluster(self):
        tmp = tempfile.mkdtemp(prefix='cozyvtt-pg-')
        data = os.path.join(tmp, 'data')
        sock = os.path.join(tmp, 'run')
        os.mkdir(sock)
        try:
            subprocess.run(
                ['initdb', '-D', data, '--auth=trust', '-U', 'cozyvtt', '--pwfile=/dev/stdin'],
                input='bootsecret\n',
                text=True,
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [
                    'pg_ctl', '-D', data, '-o',
                    '-k %s -p 55432' % sock,
                    '-l', os.path.join(tmp, 'pg.log'),
                    'start',
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                ['createdb', '-h', sock, '-p', '55432', '-U', 'cozyvtt', 'cozyvtt'],
                check=True,
                capture_output=True,
                text=True,
            )
            result = subprocess.run(
                ['bash', HELPER],
                env={
                    'PATH': os.environ.get('PATH', ''),
                    'HOME': tmp,
                    'DATABASE_USER': 'cozyvtt',
                    'DATABASE_PASSWORD': 'bootsecret',
                    'DATABASE_APP_USER': 'cozyvtt_app',
                    'DATABASE_APP_PASSWORD': 'appsecret',
                    'DATABASE_NAME': 'cozyvtt',
                    'DB_HOST': sock,
                    'DB_PORT': '55432',
                    'DB_USER': 'cozyvtt_app',
                    'PGHOST': sock,
                },
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            check = subprocess.run(
                [
                    'psql', '-h', sock, '-p', '55432', '-U', 'cozyvtt_app', '-d', 'cozyvtt',
                    '-tAqc', 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user',
                ],
                env={**os.environ, 'PGPASSWORD': 'appsecret'},
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertEqual(check.stdout.strip(), 'f')
        finally:
            subprocess.run(['pg_ctl', '-D', data, 'stop', '-m', 'immediate'], capture_output=True)
            shutil.rmtree(tmp, ignore_errors=True)
