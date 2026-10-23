#!/usr/bin/env python3
"""
Scan the four runtime images an Instance starts for High and Critical
advisories. Trivy is invoked as:

    trivy image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --format table --ignorefile /dev/null -- <image>

Images, in this order:

  1. production compose ``database`` (the pinned postgres digest)
  2. production compose ``nginx`` (the pinned nginx digest)
  3. ``cozyvtt-backend:latest`` (built, not pulled)
  4. ``cozyvtt-frontend:latest`` (built, not pulled)

Builder stages and the development compose file are not scanned. Unfixed
advisories are not ignored: that matches ``npm audit --omit=dev
--audit-level=high``. ``TRIVY_*`` environment variables are dropped, and
``--ignorefile /dev/null`` is passed, so a runner or a repo ignore file
cannot skip CVEs. The last ``image:`` in each service block wins, as Compose
does.

Every image is scanned even if an earlier one failed. Missing Trivy or a
missing image fails with a message; CI installs Trivy and pulls or builds
first. GitHub CI is the merge gate.

Run from the repository root after the production images exist locally:

    python3 scripts/ci/image-advisories.py
"""

import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
COMPOSE = os.path.join(ROOT, 'docker-compose.yml')

# Local tags compose builds; the postgres and nginx refs come from compose.
BUILT = ('cozyvtt-backend:latest', 'cozyvtt-frontend:latest')
# Tracked names that would change which compose file CI runs, or let Trivy
# skip advisories, relative to the files this script reads.
SKIP_FILES = (
    '.trivyignore',
    '.trivyignore.yaml',
    'trivy.yaml',
    'trivy.yml',
    'compose.yaml',
    'compose.yml',
    'docker-compose.override.yml',
)
TRIVY = (
    'trivy',
    'image',
    '--scanners',
    'vuln',
    '--severity',
    'HIGH,CRITICAL',
    '--exit-code',
    '1',
    '--format',
    'table',
    '--ignorefile',
    '/dev/null',
)


def service_block(text, name):
    start = text.find(f'\n  {name}:\n')
    if start < 0:
        raise SystemExit(f'{COMPOSE} has no {name} service')
    rest = text[start + 1 :]
    nxt = re.search(r'\n {2}[a-z]|\n[a-z]', rest[1:])
    return rest if nxt is None else rest[: nxt.start() + 1]


def service_image(text, name):
    matches = re.findall(r'(?m)^    image: (\S+)\s*$', service_block(text, name))
    if not matches:
        raise SystemExit(f'{COMPOSE} service {name} has no image:')
    return matches[-1]


def runtime_images():
    with open(COMPOSE, encoding='utf-8') as handle:
        text = handle.read()
    return (
        service_image(text, 'database'),
        service_image(text, 'nginx'),
        service_image(text, 'backend'),
        service_image(text, 'frontend'),
    )


def drop_trivy_environment():
    for key in [name for name in os.environ if name.startswith('TRIVY_')]:
        del os.environ[key]


def refuse_skip_files():
    found = [name for name in SKIP_FILES if os.path.exists(os.path.join(ROOT, name))]
    if found:
        raise SystemExit(
            'refusing to scan while these files exist at the repository root: '
            + ', '.join(found)
        )


def require_command(name, hint):
    if shutil.which(name) is None:
        raise SystemExit(f'{name} is not on PATH. {hint}')


def image_present(image):
    result = subprocess.run(
        ['docker', 'image', 'inspect', image],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def scan(image):
    print(f'Scanning {image}', flush=True)
    result = subprocess.run(list(TRIVY) + ['--', image])
    return result.returncode


def main():
    drop_trivy_environment()
    refuse_skip_files()
    require_command(
        'trivy',
        'CI installs it with aquasecurity/setup-trivy before this script; '
        'GitHub CI is the merge gate.',
    )
    require_command(
        'docker',
        'CI pulls database and nginx and builds backend and frontend first; '
        'GitHub CI is the merge gate.',
    )

    images = runtime_images()
    expected_built = set(BUILT)
    found_built = {image for image in images if image in expected_built}
    if found_built != expected_built:
        raise SystemExit(
            'production compose must name '
            f'{", ".join(BUILT)} as built runtime images, not {", ".join(images)}'
        )

    status = 0
    for image in images:
        if not image_present(image):
            print(
                f'image {image} is not present locally. CI pulls the production '
                'compose database and nginx images and runs docker compose '
                'build before this script; GitHub CI is the merge gate.',
                file=sys.stderr,
            )
            status = 1
            continue
        if scan(image) != 0:
            status = 1
    return status


if __name__ == '__main__':
    sys.exit(main())
