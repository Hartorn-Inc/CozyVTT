"""
The image advisory gate scans the four runtime images an Instance starts
and fails CI on High or Critical findings. These read the script, the
images job, the override example and the deployment requirements as files,
and call runtime_images() the way nginx-check tests call nginx_service.

    python3 -m unittest discover -s scripts/tests
"""

import importlib.util
import io
import os
import re
import unittest

try:
    import yaml
except ImportError:
    yaml = None

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(SCRIPTS, 'ci', 'image-advisories.py')
WORKFLOW = os.path.join(ROOT, '.github', 'workflows', 'ci.yml')
OVERRIDE = os.path.join(ROOT, 'docker-compose.override.example.yml')
COMPOSE = os.path.join(ROOT, 'docker-compose.yml')
DEPLOYMENT = os.path.join(ROOT, 'docs', 'DEPLOYMENT.md')
DEVELOPMENT = os.path.join(ROOT, 'docs', 'DEVELOPMENT.md')
SECURITY = os.path.join(ROOT, 'SECURITY.md')

SKIP_FILES = (
    '.trivyignore',
    '.trivyignore.yaml',
    'trivy.yaml',
    'trivy.yml',
    'compose.yaml',
    'compose.yml',
    'docker-compose.override.yml',
)

spec = importlib.util.spec_from_file_location('image_advisories', SCRIPT)
ia = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ia)


def read(path):
    with io.open(path, encoding='utf-8') as handle:
        return handle.read()


def job_body(workflow, name):
    start = workflow.find('\n  %s:\n' % name)
    if start < 0:
        raise AssertionError('.github/workflows/ci.yml no longer has a %s job' % name)
    rest = workflow[start + 1 :]
    nxt = re.search(r'\n {2}[a-z]', rest[1:])
    return rest if nxt is None else rest[: nxt.start() + 1]


class ImageAdvisories(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = read(SCRIPT)
        cls.workflow = read(WORKFLOW)
        cls.images_job = job_body(cls.workflow, 'images')
        cls.override = read(OVERRIDE)
        cls.deployment = read(DEPLOYMENT)
        cls.development = read(DEVELOPMENT)
        cls.security = read(SECURITY)

    def test_script_scans_the_four_runtime_images_at_high_critical(self):
        self.assertEqual(ia.TRIVY[ia.TRIVY.index('--severity') + 1], 'HIGH,CRITICAL')
        self.assertEqual(ia.TRIVY[ia.TRIVY.index('--exit-code') + 1], '1')
        self.assertIn('--scanners', ia.TRIVY)
        self.assertIn('vuln', ia.TRIVY)
        self.assertIn('--ignorefile', ia.TRIVY)
        self.assertEqual(ia.TRIVY[ia.TRIVY.index('--ignorefile') + 1], '/dev/null')
        self.assertNotIn('--ignore-unfixed', ia.TRIVY)
        self.assertIn("'--', image]", self.script)

    @unittest.skipIf(yaml is None, 'PyYAML is not installed')
    def test_runtime_images_are_the_four_compose_refs_in_order(self):
        services = yaml.safe_load(read(COMPOSE))['services']
        expected = (
            services['database']['image'],
            services['nginx']['image'],
            services['backend']['image'],
            services['frontend']['image'],
        )
        self.assertRegex(expected[0], r'^postgres:\S+@sha256:[0-9a-f]{64}$')
        self.assertRegex(expected[1], r'^nginx:\S+@sha256:[0-9a-f]{64}$')
        self.assertEqual(expected[2], 'cozyvtt-backend:latest')
        self.assertEqual(expected[3], 'cozyvtt-frontend:latest')
        self.assertEqual(ia.runtime_images(), expected)

    def test_last_image_in_a_service_block_wins(self):
        digest = 'postgres:18-alpine@sha256:' + 'ab' * 32
        text = (
            '\n  database:\n'
            '    image: postgres:first\n'
            '    platform: linux/amd64\n'
            f'    image: {digest}\n'
            '  nginx:\n'
            '    image: nginx:ignore\n'
        )
        self.assertEqual(ia.service_image(text, 'database'), digest)

    def test_drops_trivy_environment_variables(self):
        previous = {name: value for name, value in os.environ.items() if name.startswith('TRIVY_')}

        def restore():
            for name in [key for key in os.environ if key.startswith('TRIVY_')]:
                del os.environ[name]
            os.environ.update(previous)

        self.addCleanup(restore)
        os.environ['TRIVY_IGNORE_UNFIXED'] = 'true'
        os.environ['TRIVY_SEVERITY'] = 'LOW'
        os.environ['TRIVY_EXIT_CODE'] = '0'
        ia.drop_trivy_environment()
        self.assertFalse(any(name.startswith('TRIVY_') for name in os.environ))

    def test_skip_files_are_absent_from_the_repository_root(self):
        present = [name for name in SKIP_FILES if os.path.exists(os.path.join(ROOT, name))]
        self.assertEqual(present, [])
        self.assertEqual(ia.SKIP_FILES, SKIP_FILES)

    def test_images_job_pulls_builds_then_runs_the_script(self):
        pull = self.images_job.find('docker compose pull database nginx')
        build = self.images_job.find('docker compose build')
        scan = self.images_job.find('python3 scripts/ci/image-advisories.py')
        self.assertNotEqual(pull, -1)
        self.assertGreater(build, pull)
        self.assertGreater(scan, build)
        scan_step = None
        for step in self.images_job.split('\n      - ')[1:]:
            if 'python3 scripts/ci/image-advisories.py' in step:
                scan_step = step
                break
        self.assertIsNotNone(scan_step)
        self.assertNotIn('continue-on-error:', scan_step)

    def test_trivy_action_is_pinned_to_a_commit(self):
        match = re.search(
            r'uses: aquasecurity/setup-trivy@([0-9a-f]{40}) # v\S+',
            self.images_job,
        )
        self.assertTrue(match, 'images job must pin aquasecurity/setup-trivy to a 40-char SHA with a version comment')
        self.assertEqual(len(match.group(1)), 40)
        install = None
        for step in self.images_job.split('\n      - ')[1:]:
            if 'aquasecurity/setup-trivy@' in step:
                install = step
                break
        self.assertIsNotNone(install)
        self.assertRegex(install, r'version:\s*v\S+')
        self.assertRegex(install, r'cache:\s*false')

    def test_override_example_does_not_set_image(self):
        keys = [
            line
            for line in self.override.splitlines()
            if not line.lstrip().startswith('#') and re.match(r'\s+image:', line)
        ]
        self.assertEqual(keys, [])
        self.assertIn('Do not set `image:`', self.override)

    def test_deployment_requirements_are_amd64_compose_and_tunnel(self):
        start = self.deployment.find('## Requirements')
        end = self.deployment.find('## Docker Compose Deployment', start)
        self.assertNotEqual(start, -1)
        self.assertNotEqual(end, -1)
        requirements = self.deployment[start:end]
        self.assertIn('amd64', requirements)
        self.assertRegex(requirements, r'Docker Compose|Compose')
        self.assertRegex(requirements, r'[Tt]unnel')
        self.assertNotIn('At least 1 GB RAM', requirements)
        bullets = [line for line in requirements.splitlines() if line.startswith('- ')]
        self.assertFalse(any(re.search(r'\bARM\b', line) for line in bullets), bullets)
        self.assertFalse(
            any(re.search(r'\b1 GB\b', line) and 'not' not in line.lower() for line in bullets),
            bullets,
        )

    def test_things_to_know_heading_matches_the_bullets(self):
        match = re.search(r'^(One|Two|Three|Four|Five) things to know:\n\n', self.deployment, re.M)
        self.assertIsNotNone(match)
        words = {'One': 1, 'Two': 2, 'Three': 3, 'Four': 4, 'Five': 5}
        block = []
        for line in self.deployment[match.end():].splitlines():
            if line.startswith('- **'):
                block.append(line)
                continue
            if line.startswith('  ') and block:
                continue
            break
        self.assertEqual(len(block), words[match.group(1)])

    def test_guides_say_a_high_or_critical_image_advisory_fails_ci(self):
        self.assertRegex(
            self.security,
            r'high or critical(?: advisory)? in(?: those)? runtime images.*fail',
        )
        self.assertRegex(
            self.development,
            r'high or critical(?: advisory)?\s+fails the images job',
        )
