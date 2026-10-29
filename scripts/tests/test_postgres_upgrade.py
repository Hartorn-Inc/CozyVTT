"""Tests for PostgreSQL major-version upgrade detection and guardrails.

Validates that major version cluster detection correctly identifies /var/lib/postgresql/18
and arbitrary cluster layouts, prevents accidental startup across incompatible major versions,
and verifies operator upgrade tooling.

    python3 -m unittest discover -s scripts/tests
"""

import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UPGRADE_SCRIPT = os.path.join(ROOT, 'backend', 'scripts', 'upgrade-postgres.sh')
DEPLOYMENT_DOC = os.path.join(ROOT, 'docs', 'DEPLOYMENT.md')


def read(path):
    with open(path, encoding='utf-8') as source:
        return source.read()


class PostgresUpgradeDetectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.path.exists(UPGRADE_SCRIPT):
            try:
                os.chmod(UPGRADE_SCRIPT, os.stat(UPGRADE_SCRIPT).st_mode | 0o755)
            except OSError:
                pass

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.test_dir)

    def run_script(self, mode, env=None, args=None):
        custom_env = os.environ.copy()
        custom_env['PGDATA_ROOT'] = self.test_dir
        if env:
            custom_env.update(env)
        cmd = ['sh', UPGRADE_SCRIPT, mode] + (args or [])
        res = subprocess.run(cmd, env=custom_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return res

    def test_detect_clean_directory(self):
        res = self.run_script('detect')
        self.assertIn('CLUSTER_DETECTED=false', res.stdout)
        self.assertIn('DETECTED_VERSION=none', res.stdout)
        self.assertEqual(res.returncode, 1)

    def test_detect_postgresql_18_docker_layout(self):
        cluster_dir = os.path.join(self.test_dir, '18', 'docker')
        os.makedirs(cluster_dir, exist_ok=True)
        with open(os.path.join(cluster_dir, 'PG_VERSION'), 'w', encoding='utf-8') as f:
            f.write('18\n')

        res = self.run_script('detect')
        self.assertEqual(res.returncode, 0)
        self.assertIn('CLUSTER_DETECTED=true', res.stdout)
        self.assertIn('DETECTED_VERSION=18', res.stdout)
        self.assertIn(cluster_dir, res.stdout)

    def test_check_compatibility_flags_older_version(self):
        cluster_dir = os.path.join(self.test_dir, '18', 'docker')
        os.makedirs(cluster_dir, exist_ok=True)
        with open(os.path.join(cluster_dir, 'PG_VERSION'), 'w', encoding='utf-8') as f:
            f.write('18\n')

        res = self.run_script('check', env={'TARGET_PG_VERSION': '19'})
        self.assertEqual(res.returncode, 2)
        self.assertIn('PostgreSQL 18 cluster detected', res.stdout)
        self.assertIn('docs/DEPLOYMENT.md', res.stdout)

    def test_check_compatibility_succeeds_when_matched(self):
        cluster_dir = os.path.join(self.test_dir, '19', 'docker')
        os.makedirs(cluster_dir, exist_ok=True)
        with open(os.path.join(cluster_dir, 'PG_VERSION'), 'w', encoding='utf-8') as f:
            f.write('19\n')

        res = self.run_script('check', env={'TARGET_PG_VERSION': '19'})
        self.assertEqual(res.returncode, 0)
        self.assertIn('Cluster is already PostgreSQL 19', res.stdout)

    def test_rehearse_backup_checks_archive_format(self):
        fake_backup = os.path.join(self.test_dir, 'test-backup.zip')
        with open(fake_backup, 'wb') as f:
            f.write(b'PK\x03\x04dummy')

        res = self.run_script('rehearse-backup', env={'BACKUP_ARCHIVE': fake_backup, 'TARGET_PG_VERSION': '19'})
        self.assertEqual(res.returncode, 0)
        self.assertIn('Rehearsal preflight checks completed successfully', res.stdout)

    def test_rehearse_backup_fails_on_missing_file(self):
        res = self.run_script('rehearse-backup', env={'BACKUP_ARCHIVE': '/nonexistent/file.zip'})
        self.assertEqual(res.returncode, 1)
        self.assertIn('Instance backup archive file not found', res.stdout)

    def test_pg_upgrade_guidance(self):
        cluster_dir = os.path.join(self.test_dir, '18', 'docker')
        os.makedirs(cluster_dir, exist_ok=True)
        with open(os.path.join(cluster_dir, 'PG_VERSION'), 'w', encoding='utf-8') as f:
            f.write('18\n')

        res = self.run_script('pg-upgrade', env={'TARGET_PG_VERSION': '19'})
        self.assertEqual(res.returncode, 0)
        self.assertIn('Source cluster: PostgreSQL 18', res.stdout)
        self.assertIn('Target cluster: PostgreSQL 19', res.stdout)
        self.assertIn('pg_upgrade', res.stdout)


class PostgresUpgradeDocsTests(unittest.TestCase):
    def test_deployment_docs_detail_upgrade_procedure(self):
        doc = read(DEPLOYMENT_DOC)
        self.assertIn('PostgreSQL Major-Version Upgrades', doc)
        self.assertIn('upgrade-postgres.sh', doc)
        self.assertIn('pg_upgrade', doc)
        self.assertIn('/var/lib/postgresql/18/docker', doc)
        self.assertIn('rehearse-backup', doc)


if __name__ == '__main__':
    unittest.main()
