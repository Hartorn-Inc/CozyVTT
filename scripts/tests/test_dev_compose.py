"""Checks the development Compose stack and Makefile stay isolated.

    python3 -m unittest discover -s scripts/tests
"""

import io
import os
import unittest

try:
    import yaml
except ImportError:
    yaml = None


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEV_COMPOSE = os.path.join(ROOT, 'docker-compose.dev.yml')
PROD_COMPOSE = os.path.join(ROOT, 'docker-compose.yml')
MAKEFILE = os.path.join(ROOT, 'Makefile')
GITIGNORE = os.path.join(ROOT, '.gitignore')
DOCKERIGNORE = os.path.join(ROOT, 'backend', '.dockerignore')
DOCKERFILE = os.path.join(ROOT, 'backend', 'Dockerfile')
PERMISSIONS_SCRIPT = os.path.join(ROOT, 'backend', 'scripts', 'permissions-check.sh')
ENV_EXAMPLE = os.path.join(ROOT, '.env.example')
README = os.path.join(ROOT, 'README.md')
DEVELOPMENT_DOC = os.path.join(ROOT, 'docs', 'DEVELOPMENT.md')
CHANGELOG = os.path.join(ROOT, 'CHANGELOG.md')


def read(path):
    with io.open(path, encoding='utf-8') as source:
        return source.read()


@unittest.skipIf(yaml is None, 'PyYAML is not installed')
class DevelopmentCompose(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dev = yaml.safe_load(read(DEV_COMPOSE))
        cls.prod = yaml.safe_load(read(PROD_COMPOSE))
        cls.prod_text = read(PROD_COMPOSE)

    def test_permissions_helper_is_opt_in_and_isolated(self):
        helper = self.dev['services']['backend-permissions']
        self.assertEqual(helper['profiles'], ['permissions'])
        self.assertEqual(helper['network_mode'], 'none')
        self.assertEqual(helper['security_opt'], ['no-new-privileges:true'])
        self.assertEqual(helper['cap_drop'], ['ALL'])
        self.assertEqual(helper['cap_add'], ['CHOWN', 'DAC_READ_SEARCH'])
        self.assertTrue(helper['read_only'])
        self.assertEqual(helper['user'], 'root')
        self.assertEqual(helper['entrypoint'], ['/usr/local/bin/permissions-check.sh'])
        self.assertEqual(helper['command'], [])
        self.assertEqual(helper['volumes'], [
            './backend/uploads-dev:/app/uploads',
            './backend/backups-dev:/app/backups',
        ])
        self.assertNotIn('environment', helper)
        self.assertNotIn('depends_on', helper)
        self.assertNotIn('container_name', helper)

    def test_dev_resources_are_separate_from_production(self):
        dev_database = self.dev['services']['database']
        prod_database = self.prod['services']['database']
        self.assertNotIn('name', self.dev['volumes']['postgres_data'])
        self.assertNotIn('name', self.prod['volumes']['postgres_data'])
        for service in ('database', 'backend', 'frontend'):
            self.assertNotIn('container_name', self.dev['services'][service])
        self.assertEqual(prod_database['container_name'], 'cozyvtt-database')

        dev_backend_volumes = self.dev['services']['backend']['volumes']
        prod_backend_volumes = self.prod['services']['backend']['volumes']
        self.assertIn('./backend/uploads-dev:/app/uploads', dev_backend_volumes)
        self.assertIn('./backend/backups-dev:/app/backups', dev_backend_volumes)
        self.assertIn('/app/logs', dev_backend_volumes)
        self.assertIn('./backend/uploads:/app/uploads', prod_backend_volumes)
        self.assertIn('./backend/backups:/app/backups', prod_backend_volumes)
        self.assertIn('#   make up', self.prod_text)

    def test_dev_services_publish_only_loopback_ports(self):
        for name in ('database', 'backend', 'frontend'):
            for port in self.dev['services'][name]['ports']:
                self.assertTrue(str(port).startswith('127.0.0.1:'), (name, port))

    def test_dev_cors_and_database_healthcheck_have_safe_defaults(self):
        backend_environment = self.dev['services']['backend']['environment']
        self.assertEqual(
            backend_environment['CORS_ORIGIN'],
            '${DEV_CORS_ORIGIN:-http://localhost:3000}',
        )
        self.assertEqual(backend_environment['SESSION_SECRET'], '${DEV_SESSION_SECRET:-}')
        self.assertEqual(backend_environment['SETUP_TOKEN'], '${DEV_SETUP_TOKEN:-}')
        self.assertEqual(backend_environment['APP_URL'], '${DEV_APP_URL:-http://localhost:3000}')
        self.assertEqual(backend_environment['UPLOAD_DIR'], '/app/uploads')
        self.assertEqual(backend_environment['BACKUP_DIR'], '/app/backups')
        for key in ('SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_SECURE'):
            self.assertEqual(backend_environment[key], '${DEV_' + key + ':-}')
        database_healthcheck = self.dev['services']['database']['healthcheck']['test']
        self.assertIn('-d ${DATABASE_NAME:-cozyvtt}', database_healthcheck[1])


class MakefileSetup(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.makefile = read(MAKEFILE)
        cls.gitignore = read(GITIGNORE)
        cls.dockerignore = read(DOCKERIGNORE)
        cls.env_example = read(ENV_EXAMPLE)
        cls.readme = read(README)
        cls.development_doc = read(DEVELOPMENT_DOC)
        cls.changelog = read(CHANGELOG)
        cls.dockerfile = read(DOCKERFILE)
        cls.permissions_script = read(PERMISSIONS_SCRIPT)

    def test_paths_are_anchored_to_the_makefile_repository(self):
        self.assertIn('MAKEFILE_PATH := $(shell realpath -- "$(MAKEFILE_LIST)")', self.makefile)
        self.assertIn('REPO_DIR := $(shell dirname -- "$(MAKEFILE_PATH)")', self.makefile)
        self.assertIn('PROJECT_HASH := $(shell printf', self.makefile)
        self.assertIn('sha256sum | cut -c1-12', self.makefile)
        self.assertIn('DEV_PROJECT := cozyvtt-dev-$(PROJECT_HASH)', self.makefile)
        self.assertIn('REPO_DIR :=', self.makefile)
        self.assertIn('COMPOSE_FILE := $(REPO_DIR)/docker-compose.dev.yml', self.makefile)
        self.assertIn('--project-directory "$(REPO_DIR)"', self.makefile)
        self.assertIn('--project-name $(DEV_PROJECT)', self.makefile)
        self.assertIn('UPLOADS_DIR := $(REPO_DIR)/backend/uploads-dev', self.makefile)
        self.assertIn('BACKUPS_DIR := $(REPO_DIR)/backend/backups-dev', self.makefile)
        self.assertIn('@mkdir -p "$(UPLOADS_DIR)" "$(BACKUPS_DIR)"', self.makefile)
        self.assertIn('backend/uploads-dev/', self.gitignore)
        self.assertIn('backend/backups-dev/', self.gitignore)
        self.assertIn('uploads-dev/', self.dockerignore)
        self.assertIn('backups-dev/', self.dockerignore)
        self.assertIn('COPY scripts/permissions-check.sh /usr/local/bin/permissions-check.sh', self.dockerfile)

    def test_setup_and_lifecycle_safety_contract_is_present(self):
        self.assertIn('ENV_FILE := $(REPO_DIR)/.env', self.makefile)
        self.assertIn('COMPOSE_ENV_FILE := $(shell if [ -f "$(ENV_FILE)" ]; then printf', self.makefile)
        self.assertIn('require-env', self.makefile)
        self.assertIn('if [ -L "$$env_file" ] || [ ! -f "$$env_file" ]', self.makefile)
        self.assertIn("stat -c '%a' --", self.makefile)
        self.assertIn('"$$mode" != "600"', self.makefile)
        self.assertIn('DEV_SESSION_SECRET', self.makefile)
        self.assertIn('CHANGE_ME_TO_A_DIFFERENT_DEV_SECRET_32_CHARS_MIN', self.makefile)
        self.assertIn('$${DEV_SESSION_SECRET+x}', self.makefile)
        self.assertIn('$${SESSION_SECRET+x}', self.makefile)
        self.assertIn('compose_environment=$$($(DEV_COMPOSE) config --environment)', self.makefile)
        self.assertIn('root_session_secret=$$(printf', self.makefile)
        self.assertIn('"$${#dev_session_secret}" -lt 32', self.makefile)
        for placeholder in (
            'CHANGE_ME_TO_RANDOM_STRING_32_CHARS_MIN',
            'development-secret-change-in-production',
            'CHANGE_ME_TO_RANDOM_STRING',
            'your-64-char-random-string',
            '<paste the 64 characters that command prints>',
            'dev-session-secret-change-in-production-please',
        ):
            self.assertIn(placeholder, self.makefile)
        self.assertIn('equal to production SESSION_SECRET', self.makefile)
        self.assertIn('for path in "$$backend_root/uploads-dev" "$$backend_root/backups-dev"', self.makefile)
        self.assertIn('if [ -L "$$path" ]', self.makefile)
        self.assertIn('nested_link=$$(find "$$path" -type l -print -quit', self.makefile)
        self.assertNotIn('find "$$path" -type l -print -quit 2>/dev/null || true', self.makefile)
        self.assertIn("uploads_identity=$$(stat -c '%d:%i'", self.makefile)
        self.assertIn("backups_identity=$$(stat -c '%d:%i'", self.makefile)
        self.assertIn('"$$uploads_identity" "$$backups_identity"', self.makefile)
        self.assertIn('pwd -P', self.makefile)
        self.assertIn('command -v findmnt', self.makefile)
        self.assertIn('findmnt (util-linux) is required', self.makefile)
        self.assertIn('findmnt --raw --noheadings --output TARGET', self.makefile)
        self.assertIn("decoded=$$(printf '%b' \"$$target\")", self.makefile)
        self.assertIn('findmnt failed while checking', self.makefile)
        self.assertIn('This check cannot prevent a later mount change', self.makefile)
        self.assertIn('label=com.docker.compose.project=$(DEV_PROJECT)', self.makefile)
        self.assertIn('docker ps -a --filter "label=com.docker.compose.project=$(DEV_PROJECT)"', self.makefile)
        self.assertIn('legacy-check', self.makefile)
        self.assertIn('legacy-stop: preflight ##', self.makefile)
        self.assertIn('docker ps -a --filter "name=^/$${container_name}$$" --quiet', self.makefile)
        self.assertIn('com.docker.compose.project.config_files', self.makefile)
        self.assertIn('com.docker.compose.project.working_dir', self.makefile)
        self.assertIn('com.docker.compose.service', self.makefile)
        self.assertIn('$(LEGACY_COMPOSE) stop $$services', self.makefile)
        self.assertIn('$(LEGACY_COMPOSE) rm -f $$services', self.makefile)
        self.assertNotIn('down -v', self.makefile)
        self.assertIn('--profile permissions run --build --rm --no-deps backend-permissions', self.makefile)
        self.assertIn('print-project:', self.makefile)
        self.assertIn('up: require-env legacy-check', self.makefile)
        self.assertIn('start: up', self.makefile)
        self.assertIn('down: preflight', self.makefile)
        self.assertIn('logs: preflight', self.makefile)
        self.assertIn('DEV_SESSION_SECRET=', self.env_example)
        self.assertNotIn('CHANGE_ME_TO_A_DIFFERENT_DEV_SECRET_32_CHARS_MIN', self.env_example)
        self.assertIn('DEV_SETUP_TOKEN=', self.env_example)
        self.assertIn('DEV_APP_URL=', self.env_example)
        for key in ('DEV_SMTP_HOST', 'DEV_SMTP_PORT', 'DEV_SMTP_USER', 'DEV_SMTP_PASS', 'DEV_SMTP_FROM', 'DEV_SMTP_SECURE'):
            self.assertIn(key + '=', self.env_example)
        self.assertIn("stat -c '%d:%i'", self.permissions_script)
        self.assertIn('check_identity /app/uploads "$expected_uploads"', self.permissions_script)
        self.assertIn('check_identity /app/backups "$expected_backups"', self.permissions_script)
        self.assertIn('check_plain_tree /app/uploads', self.permissions_script)
        self.assertIn('check_plain_tree /app/backups', self.permissions_script)
        self.assertNotIn('find "$path" -type l -print -quit 2>/dev/null || true', self.permissions_script)
        self.assertIn('root_device=$(identity "$root" | cut -d: -f1)', self.permissions_script)
        self.assertIn('find "$root" -xdev -exec sh -c', self.permissions_script)
        self.assertIn('stat -c "%d" "$entry"', self.permissions_script)
        self.assertIn('chown -h appuser:appgroup "$entry"', self.permissions_script)

    def test_documented_development_command_is_up(self):
        for document in (self.readme, self.development_doc, self.changelog):
            self.assertIn('make up', document)
        self.assertNotIn('If Make is unavailable', self.development_doc)
        self.assertIn('$(make print-project)', self.development_doc)
        for command in ('make require-env', 'make setup', 'make legacy-check'):
            self.assertIn(command, self.development_doc)
        self.assertIn('DEV_APP_URL=http://mybox.local:3001', self.development_doc)
        self.assertIn('Different checkouts get different project resources', self.development_doc)
        self.assertIn('Different checkouts get separate project resources', self.readme)
        self.assertIn('OpenSSL', self.readme)
        self.assertIn('make legacy-stop', self.development_doc)
        self.assertIn('make legacy-stop', self.readme)
        for document in (self.development_doc, self.readme):
            self.assertNotIn('docker compose --project-name cozyvtt', document)
        self.assertIn('start: up', self.makefile)
