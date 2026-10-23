"""Login-session dump excludes and restore trailers stay scoped.

Always public.session and public.revoked_login_session; a DATABASE_URL
?schema= other than public adds that schema only. Never every schema.
A missing or empty ?schema= is public. A percent-encoded value is decoded
like the dashboard; a present non-simple identifier is then refused.
Restore of a simple custom schema replaces that schema, not public.

    python3 -m unittest discover -s scripts/tests
"""

import gzip
import os
import re
import stat
import subprocess
import tempfile
import unittest


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKUP_SH = os.path.join(ROOT, 'backend', 'scripts', 'backup.sh')
RESTORE_SH = os.path.join(ROOT, 'backend', 'scripts', 'restore.sh')
DEPLOYMENT_DOC = os.path.join(ROOT, 'docs', 'DEPLOYMENT.md')

PUBLIC_TRAILER = (
    "DO $$ BEGIN IF to_regclass('public.session') IS NOT NULL THEN "
    "DELETE FROM public.session; END IF; "
    "IF to_regclass('public.revoked_login_session') IS NOT NULL THEN "
    "DELETE FROM public.revoked_login_session; END IF; END $$;"
)

DUMP = '\n'.join([
    '-- PostgreSQL database dump',
    'CREATE TABLE public."User" (',
    '    id text NOT NULL',
    ');',
    'CREATE TABLE public._prisma_migrations (',
    '    id character varying(36) NOT NULL',
    ');',
    'COPY public."User" (id) FROM stdin;',
    'u1',
    '\\.',
    '-- PostgreSQL database dump complete',
    '',
])


def tables_dump(user, migrations):
    return '\n'.join([
        '-- PostgreSQL database dump',
        'CREATE TABLE {0} ('.format(user),
        '    id text NOT NULL',
        ');',
        'CREATE TABLE {0} ('.format(migrations),
        '    id character varying(36) NOT NULL',
        ');',
        '-- PostgreSQL database dump complete',
        '',
    ])


APP_DATA_DUMP = tables_dump('app_data."User"', 'app_data._prisma_migrations')


def read(path):
    with open(path, encoding='utf-8') as source:
        return source.read()


def database_url_block(source):
    start = source.find('# Parse DATABASE_URL')
    if start == -1:
        raise AssertionError('script no longer has its "# Parse DATABASE_URL" block')
    end = source.find('\nfi\n', start)
    if end == -1:
        raise AssertionError('DATABASE_URL block no longer ends at a fi')
    return source[start:end]


def custom_schema_trailer(schema):
    literal = schema.replace("'", "''")
    return (
        "DO $$ BEGIN IF to_regclass(format('%I.session', '{0}')) IS NOT NULL THEN "
        "EXECUTE format('DELETE FROM %I.session', '{0}'); END IF; "
        "IF to_regclass(format('%I.revoked_login_session', '{0}')) IS NOT NULL THEN "
        "EXECUTE format('DELETE FROM %I.revoked_login_session', '{0}'); END IF; END $$;"
    ).format(literal)


def custom_schema_preamble(schema):
    literal = schema.replace("'", "''")
    return (
        "DO $$ BEGIN EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', '{0}'); "
        "END $$;"
    ).format(literal)


INVALID_SCHEMA_URLS = (
    'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=*',
    'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=foo-bar',
    "postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=foo'bar",
    'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=1nope',
    'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=%2A',
    'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=foo%2Dbar',
    'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=app_data%0A',
)


class ScriptSource(unittest.TestCase):
    def setUp(self):
        self.backup = read(BACKUP_SH).replace('\r\n', '\n')
        self.restore = read(RESTORE_SH).replace('\r\n', '\n')

    def test_database_url_authority_blocks_stay_identical(self):
        self.assertEqual(database_url_block(self.restore), database_url_block(self.backup))

    def test_schema_query_parsers_stay_identical(self):
        def parser(source):
            start = source.find('APP_SCHEMA=public\n')
            self.assertNotEqual(start, -1, 'script no longer parses APP_SCHEMA from DATABASE_URL')
            end = source.find('unset _QS _PAIR _VAL', start)
            self.assertNotEqual(end, -1, 'schema parser no longer unsets its temporaries')
            self.assertEqual(source.count('APP_SCHEMA=public\n'), 1)
            return source[start:end]

        self.assertEqual(parser(self.restore), parser(self.backup))

    def test_restore_heredoc_is_the_public_trailer_byte_for_byte(self):
        held = re.search(
            r"^RESTORE_TRAILER=\$\(cat <<'SQL'\n(.*)\nSQL\n\)$",
            self.restore,
            re.MULTILINE,
        )
        self.assertIsNotNone(held, 'restore.sh no longer holds RESTORE_TRAILER in a heredoc')
        self.assertEqual(held.group(1), PUBLIC_TRAILER)
        self.assertFalse(held.group(1).endswith(' '))

    def test_restore_custom_preamble_matches_helper(self):
        held = re.search(
            r'^  CUSTOM_PREAMBLE="(DO \\\$\\\$ BEGIN.*END \\\$\\\$;)"$',
            self.restore,
            re.MULTILINE,
        )
        self.assertIsNotNone(held, 'restore.sh no longer holds CUSTOM_PREAMBLE as one format(%I) line')
        script_preamble = held.group(1).replace('\\$', '$').replace('${_SCHEMA_SQL}', 'app_data')
        self.assertEqual(script_preamble, custom_schema_preamble('app_data'))
        self.assertNotIn('\n', script_preamble)

    def test_scripts_refuse_a_non_simple_schema_in_the_shared_parser(self):
        for name, source in (('backup.sh', self.backup), ('restore.sh', self.restore)):
            parser_start = source.find('APP_SCHEMA=public\n')
            parser = source[parser_start:source.find('unset _QS _PAIR _VAL', parser_start)]
            self.assertIn('exit 1', parser, name)
            self.assertIn('simple identifier', parser, name)

    def test_scripts_never_scan_every_schema(self):
        for name, source in (('backup.sh', self.backup), ('restore.sh', self.restore)):
            code = '\n'.join(
                line for line in source.splitlines()
                if line.strip() and not line.lstrip().startswith('#')
            )
            self.assertNotIn('pg_namespace', code, name)
            self.assertNotRegex(code, r'\bFROM pg_catalog\b', name)
            self.assertNotIn('*.session', code, name)

    def test_docker_compose_backup_path_excludes_public_login_tables_only(self):
        docker = re.search(
            r"if docker compose exec -T \"\$DB_SERVICE\" \\\n(.*?) \| gzip > \"\$BACKUP_FILE\"",
            self.backup,
            re.DOTALL,
        )
        self.assertIsNotNone(docker, 'backup.sh no longer dumps through docker compose exec')
        block = docker.group(1)
        self.assertIn('--enable-row-security', block)
        self.assertIn('--exclude-table-data=public.session', block)
        self.assertIn('--exclude-table-data=public.revoked_login_session', block)
        self.assertNotIn('${APP_SCHEMA}', block)
        self.assertNotIn('pg_namespace', block)

    def test_deployment_guide_names_public_and_schema_scoped_tables(self):
        guide = read(DEPLOYMENT_DOC)
        self.assertIn('--enable-row-security', guide)
        self.assertIn('--exclude-table-data=public.session', guide)
        self.assertIn('--exclude-table-data=public.revoked_login_session', guide)
        self.assertIn('?schema=', guide)
        self.assertIn('not every schema', guide)
        self.assertIn('simple identifier', guide)
        self.assertIn('percent-encoded value that decodes to a simple identifier', guide)


class BackupRestoreScripts(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory(prefix='cozyvtt-backup-restore-')
        self.addCleanup(self.root.cleanup)
        self.bin = os.path.join(self.root.name, 'bin')
        os.mkdir(self.bin)
        self.backups = os.path.join(self.root.name, 'backups')
        self.seen = os.path.join(self.root.name, 'seen.txt')
        self.loaded = os.path.join(self.root.name, 'loaded.sql')
        self.backup_file = os.path.join(self.root.name, 'cozyvtt_20260101_030000.sql.gz')
        with gzip.open(self.backup_file, 'wb') as archive:
            archive.write(DUMP.encode('utf-8'))
        self._write_bin('pg_dump', (
            "#!/bin/sh\n"
            "printf '%s\\n' \"$@\" > \"{seen}\"\n"
            "echo '-- PostgreSQL database dump complete'\n"
        ).format(seen=self.seen))
        self._write_bin('psql', (
            "#!/bin/sh\n"
            "cat > \"{loaded}\"\n"
        ).format(loaded=self.loaded))

    def _write_bin(self, name, body):
        path = os.path.join(self.bin, name)
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(body)
        os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)

    def _env(self, database_url, extra=None):
        env = os.environ.copy()
        env['PATH'] = self.bin + os.pathsep + env.get('PATH', '')
        env['DATABASE_URL'] = database_url
        env['BACKUP_DIR'] = self.backups
        env['RESTORE_ASSUME_YES'] = 'yes'
        env['TMPDIR'] = self.root.name
        if extra:
            env.update(extra)
        return env

    def _backup_args(self, database_url):
        result = subprocess.run(
            ['bash', BACKUP_SH],
            cwd=self.root.name,
            env=self._env(database_url),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        with open(self.seen, encoding='utf-8') as handle:
            return handle.read().splitlines()

    def _write_dump(self, sql):
        with gzip.open(self.backup_file, 'wb') as archive:
            archive.write(sql.encode('utf-8'))

    def _run_restore(self, database_url):
        return subprocess.run(
            ['bash', RESTORE_SH, self.backup_file],
            cwd=self.root.name,
            env=self._env(database_url),
            capture_output=True,
            text=True,
            check=False,
        )

    def _restore_sql(self, database_url):
        result = self._run_restore(database_url)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        with open(self.loaded, encoding='utf-8') as handle:
            return handle.read()

    def _excludes(self, args):
        return [arg for arg in args if arg.startswith('--exclude-table-data=')]

    def test_backup_without_schema_excludes_public_login_tables_only(self):
        args = self._backup_args('postgresql://cozyvtt:secret@localhost:5432/cozyvtt')
        self.assertIn('--enable-row-security', args)
        self.assertEqual(self._excludes(args), [
            '--exclude-table-data=public.session',
            '--exclude-table-data=public.revoked_login_session',
        ])

    def test_backup_public_schema_query_does_not_repeat_public_excludes(self):
        args = self._backup_args(
            'postgresql://cozy%2Badmin:p%40ss%25w0rd@db.internal/cozyvtt?schema=public'
        )
        self.assertEqual(self._excludes(args), [
            '--exclude-table-data=public.session',
            '--exclude-table-data=public.revoked_login_session',
        ])

    def test_backup_custom_schema_adds_that_schema_only(self):
        args = self._backup_args(
            'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?sslmode=require&schema=app_data'
        )
        self.assertEqual(self._excludes(args), [
            '--exclude-table-data=public.session',
            '--exclude-table-data=public.revoked_login_session',
            '--exclude-table-data=app_data.session',
            '--exclude-table-data=app_data.revoked_login_session',
        ])

    def test_backup_percent_encoded_simple_schema_adds_that_schema_only(self):
        urls = (
            'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=app%5Fdata',
            'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?sslmode=require&schema=app%5Fdata',
        )
        expected = [
            '--exclude-table-data=public.session',
            '--exclude-table-data=public.revoked_login_session',
            '--exclude-table-data=app_data.session',
            '--exclude-table-data=app_data.revoked_login_session',
        ]
        for url in urls:
            with self.subTest(url=url):
                self.assertEqual(self._excludes(self._backup_args(url)), expected)

    def test_backup_empty_schema_stays_public(self):
        args = self._backup_args(
            'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema='
        )
        self.assertEqual(self._excludes(args), [
            '--exclude-table-data=public.session',
            '--exclude-table-data=public.revoked_login_session',
        ])

    def test_backup_invalid_schema_aborts_without_pg_dump(self):
        for url in INVALID_SCHEMA_URLS:
            with self.subTest(url=url):
                if os.path.isfile(self.seen):
                    os.remove(self.seen)
                result = subprocess.run(
                    ['bash', BACKUP_SH],
                    cwd=self.root.name,
                    env=self._env(url),
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertNotEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertIn('simple identifier', result.stderr + result.stdout)
                self.assertFalse(os.path.isfile(self.seen))

    def test_restore_without_schema_ends_with_the_public_trailer(self):
        text = self._restore_sql('postgresql://cozyvtt:secret@localhost:5432/cozyvtt')
        self.assertEqual(text.rstrip('\n').split('\n')[-1], PUBLIC_TRAILER)
        self.assertIn('DROP SCHEMA public CASCADE;', text)
        self.assertIn('CREATE SCHEMA public;', text)
        self.assertNotIn("format('%I.session'", text)
        self.assertNotIn('pg_namespace', text)

    def test_restore_empty_schema_stays_public(self):
        text = self._restore_sql(
            'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema='
        )
        self.assertIn('DROP SCHEMA public CASCADE;', text)
        self.assertIn('CREATE SCHEMA public;', text)
        self.assertNotIn(custom_schema_preamble('app_data'), text)
        self.assertEqual(text.rstrip('\n').split('\n')[-1], PUBLIC_TRAILER)

    def test_restore_invalid_schema_aborts_without_psql(self):
        sentinel = '-- not loaded --\n'
        with open(self.loaded, 'w', encoding='utf-8') as handle:
            handle.write(sentinel)
        for url in INVALID_SCHEMA_URLS:
            with self.subTest(url=url):
                with open(self.loaded, 'w', encoding='utf-8') as handle:
                    handle.write(sentinel)
                result = subprocess.run(
                    ['bash', RESTORE_SH, self.backup_file],
                    cwd=self.root.name,
                    env=self._env(url),
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertNotEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertIn('simple identifier', result.stderr + result.stdout)
                with open(self.loaded, encoding='utf-8') as handle:
                    self.assertEqual(handle.read(), sentinel)

    def test_restore_custom_schema_appends_format_literal_statement(self):
        self._write_dump(APP_DATA_DUMP)
        text = self._restore_sql(
            'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=app_data'
        )
        lines = text.rstrip('\n').split('\n')
        self.assertEqual(lines[-2], PUBLIC_TRAILER)
        self.assertEqual(lines[-1], custom_schema_trailer('app_data'))
        self.assertIn(custom_schema_preamble('app_data'), text)
        self.assertNotIn("format('CREATE SCHEMA %I'", text)
        self.assertNotIn('DROP SCHEMA public CASCADE;', text)
        self.assertNotIn('DELETE FROM app_data.session', text)
        self.assertNotIn('to_regclass(\'app_data.session\')', text)
        self.assertNotIn('pg_namespace', text)

    def test_restore_percent_encoded_simple_schema_uses_format_literal(self):
        urls = (
            'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=app%5Fdata',
            'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?sslmode=require&schema=app%5Fdata',
        )
        for url in urls:
            with self.subTest(url=url):
                self._write_dump(APP_DATA_DUMP)
                text = self._restore_sql(url)
                lines = text.rstrip('\n').split('\n')
                self.assertEqual(lines[-2], PUBLIC_TRAILER)
                self.assertEqual(lines[-1], custom_schema_trailer('app_data'))
                self.assertIn(custom_schema_preamble('app_data'), text)
                self.assertNotIn('DROP SCHEMA public CASCADE;', text)
                self.assertNotIn('pg_namespace', text)

    def test_restore_public_schema_query_does_not_add_a_second_statement(self):
        text = self._restore_sql(
            'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=public&sslmode=require'
        )
        self.assertEqual(text.rstrip('\n').split('\n')[-1], PUBLIC_TRAILER)
        self.assertEqual(text.count(PUBLIC_TRAILER), 1)

    def test_restore_accepts_create_table_in_the_configured_schema(self):
        cases = (
            (
                'public."User"',
                'public._prisma_migrations',
                'postgresql://cozyvtt:secret@localhost:5432/cozyvtt',
            ),
            (
                'public.User',
                'public._prisma_migrations',
                'postgresql://cozyvtt:secret@localhost:5432/cozyvtt',
            ),
            (
                '"public"."User"',
                '"public"."_prisma_migrations"',
                'postgresql://cozyvtt:secret@localhost:5432/cozyvtt',
            ),
            (
                'app_data."User"',
                'app_data._prisma_migrations',
                'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=app_data',
            ),
            (
                'app_data.User',
                'app_data._prisma_migrations',
                'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=app_data',
            ),
            (
                '"app_data"."User"',
                '"app_data"."_prisma_migrations"',
                'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=app_data',
            ),
            (
                '"app_data".User',
                '"app_data"._prisma_migrations',
                'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=app_data',
            ),
        )
        for user, migrations, url in cases:
            with self.subTest(user=user, migrations=migrations):
                self._write_dump(tables_dump(user, migrations))
                text = self._restore_sql(url)
                self.assertIn('CREATE TABLE {0} ('.format(user), text)
                self.assertIn('CREATE TABLE {0} ('.format(migrations), text)
                self.assertNotIn(
                    'it does not create the User and _prisma_migrations tables',
                    text,
                )

    def test_restore_refuses_create_table_outside_the_configured_schema(self):
        cases = (
            (
                DUMP,
                'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=app_data',
            ),
            (
                APP_DATA_DUMP,
                'postgresql://cozyvtt:secret@localhost:5432/cozyvtt',
            ),
            (
                tables_dump('"app_data"."User"', '"app_data"."_prisma_migrations"'),
                'postgresql://cozyvtt:secret@localhost:5432/cozyvtt',
            ),
            (
                tables_dump('public."User"', 'public._prisma_migrations'),
                'postgresql://cozyvtt:secret@localhost:5432/cozyvtt?schema=app_data',
            ),
        )
        sentence = (
            'it does not create the User and _prisma_migrations tables, '
            'so it is not a CozyVTT backup'
        )
        sentinel = '-- not loaded --\n'
        for dump, url in cases:
            with self.subTest(url=url, dump=dump.split('\n')[1]):
                self._write_dump(dump)
                with open(self.loaded, 'w', encoding='utf-8') as handle:
                    handle.write(sentinel)
                result = self._run_restore(url)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(sentence, result.stderr + result.stdout)
                with open(self.loaded, encoding='utf-8') as handle:
                    self.assertEqual(handle.read(), sentinel)

    def test_restore_still_refuses_a_dump_without_user_and_migrations(self):
        dump = '\n'.join([
            '-- PostgreSQL database dump',
            'CREATE TABLE app_data."Note" (',
            '    id text NOT NULL',
            ');',
            '-- PostgreSQL database dump complete',
            '',
        ])
        with gzip.open(self.backup_file, 'wb') as archive:
            archive.write(dump.encode('utf-8'))
        result = subprocess.run(
            ['bash', RESTORE_SH, self.backup_file],
            cwd=self.root.name,
            env=self._env('postgresql://cozyvtt:secret@localhost:5432/cozyvtt'),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            'it does not create the User and _prisma_migrations tables, so it is not a CozyVTT backup',
            result.stderr + result.stdout,
        )
        self.assertFalse(os.path.isfile(self.loaded))

    def test_restore_drops_row_security_off_and_extension_comments_keeps_table_comments(self):
        self._write_dump('\n'.join([
            '-- PostgreSQL database dump',
            'SET row_security = off;',
            'CREATE EXTENSION IF NOT EXISTS plpgsql WITH SCHEMA pg_catalog;',
            "COMMENT ON EXTENSION plpgsql IS 'PL/pgSQL procedural language';",
            'ALTER EXTENSION plpgsql UPDATE;',
            'DROP EXTENSION plpgsql;',
            'CREATE TABLE public."User" (',
            '    id text NOT NULL',
            ');',
            "COMMENT ON TABLE public.\"User\" IS 'instance user';",
            'CREATE FUNCTION public.reject_revoked_login_session() RETURNS trigger',
            '    LANGUAGE plpgsql',
            '    AS $$',
            'BEGIN',
            '  RETURN NEW;',
            'END;',
            '$$;',
            'CREATE TABLE public._prisma_migrations (',
            '    id character varying(36) NOT NULL',
            ');',
            '-- PostgreSQL database dump complete',
            '',
        ]))
        text = self._restore_sql('postgresql://cozyvtt:secret@localhost:5432/cozyvtt')
        self.assertNotIn('SET row_security = off;', text)
        self.assertNotIn('COMMENT ON EXTENSION plpgsql', text)
        self.assertNotIn('ALTER EXTENSION plpgsql', text)
        self.assertNotIn('DROP EXTENSION plpgsql;', text)
        self.assertIn('CREATE EXTENSION IF NOT EXISTS plpgsql WITH SCHEMA pg_catalog;', text)
        self.assertIn("COMMENT ON TABLE public.\"User\" IS 'instance user';", text)
        self.assertIn('\nBEGIN\n', text)
        self.assertIn('\nEND;\n', text)

    def test_restore_still_refuses_commit_after_a_dollar_dollar_that_is_not_a_function_body(self):
        dump = '\n'.join([
            '-- PostgreSQL database dump',
            "SELECT '$$';",
            'COMMIT;',
            'CREATE TABLE public."User" (',
            '    id text NOT NULL',
            ');',
            'CREATE TABLE public._prisma_migrations (',
            '    id character varying(36) NOT NULL',
            ');',
            '-- PostgreSQL database dump complete',
            '',
        ])
        self._write_dump(dump)
        result = subprocess.run(
            ['bash', RESTORE_SH, self.backup_file],
            cwd=self.root.name,
            env=self._env('postgresql://cozyvtt:secret@localhost:5432/cozyvtt'),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            'it takes control of the transaction the restore runs in',
            result.stderr + result.stdout,
        )
        self.assertFalse(os.path.isfile(self.loaded))


if __name__ == '__main__':
    unittest.main()
