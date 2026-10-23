#!/usr/bin/env python3
"""
Scan the four runtime images an Instance starts for High and Critical
advisories. Trivy is invoked as:

    trivy image --scanners vuln --pkg-types os --severity HIGH,CRITICAL --exit-code 1 --format table --ignorefile /dev/null --platform linux/amd64 -- <id>

The ``<id>`` is the linux/amd64 image Compose stored after ``docker compose
pull`` / ``docker compose build``, not the raw multi-arch index string from
compose ``image:``. Each compose ref is resolved with ``docker image
inspect`` (``{{.Id}} {{.Os}}/{{.Architecture}}``). For a digest ref,
``name:tag`` is inspected as well: ``docker compose build`` retags the
apk-upgraded image without the Hub digest, so ``name:tag`` is preferred
when both resolve to linux/amd64. If inspecting ``name:tag@sha256:…``
fails because a platform-filtered pull stored only the child, the same
inspect is tried on ``name:tag``. A ref whose stored image is not
linux/amd64 is treated as missing.

Images, in this order:

  1. production compose ``database`` (pinned postgres digest, rebuilt)
  2. production compose ``nginx`` (pinned nginx digest, rebuilt)
  3. ``cozyvtt-backend:latest`` (built, not pulled)
  4. ``cozyvtt-frontend:latest`` (built, not pulled)

Builder stages and the development compose file are not scanned. The scan is
OS packages in those images (Alpine and the like). ``npm audit --omit=dev
--audit-level=high`` remains the JavaScript gate: Trivy language scanners
also read nested ``package.json`` files and helper binaries such as
postgres's ``gosu``, which is not what an Instance runs as the app.
Unfixed OS advisories are not ignored. ``TRIVY_*`` environment variables
are dropped, and ``--ignorefile /dev/null`` is passed, so a runner or a
repo ignore file cannot skip CVEs. The last ``image:`` in each service
block wins, as Compose does.

Every image is scanned even if an earlier one failed. Missing Trivy, a
missing image, an inspect failure, a Trivy error or a High/Critical
finding fails the process; remaining images are still scanned. CI
installs Trivy and pulls or builds first. GitHub CI is the merge gate.

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
PLATFORM = 'linux/amd64'
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
    '--pkg-types',
    'os',
    '--severity',
    'HIGH,CRITICAL',
    '--exit-code',
    '1',
    '--format',
    'table',
    '--ignorefile',
    '/dev/null',
    '--platform',
    PLATFORM,
)
INSPECT_FORMAT = '{{.Id}} {{.Os}}/{{.Architecture}}'


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


def _inspect(ref):
    result = subprocess.run(
        ['docker', 'image', 'inspect', '--format', INSPECT_FORMAT, ref],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        return False, None
    seen = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) != 2:
            print(f'docker image inspect {ref}: {line}', file=sys.stderr)
            continue
        image_id, platform = parts
        if platform == PLATFORM:
            return True, image_id
        seen.append(platform)
    if seen:
        print(f'image {ref} is {", ".join(seen)}, not {PLATFORM}', file=sys.stderr)
    else:
        print(f'docker image inspect {ref} printed no image id', file=sys.stderr)
    return True, None


def amd64_image_id(ref):
    found, image_id = _inspect(ref)
    name_tag = ref.split('@', 1)[0]
    if name_tag == ref:
        return image_id if found else None
    # Digest inspect found a non-amd64 image: do not silently scan another tag.
    if found and not image_id:
        return None
    # Compose build retags the apk-upgraded image as name:tag. Prefer that
    # when it exists so pull-then-build scans the rebuilt layer, not Hub.
    tag_found, tag_id = _inspect(name_tag)
    if tag_id:
        return tag_id
    if found:
        return image_id
    if tag_found:
        return tag_id
    return None


def scan(image_id):
    print(f'Scanning {image_id}', flush=True)
    result = subprocess.run(list(TRIVY) + ['--', image_id])
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
        'CI pulls database and nginx and builds database, nginx, backend and '
        'frontend first; GitHub CI is the merge gate.',
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
        image_id = amd64_image_id(image)
        if not image_id:
            print(
                f'image {image} is not present locally as {PLATFORM}. CI pulls '
                'the production compose database and nginx images and runs '
                'docker compose build (including those two) before this '
                'script; GitHub CI is the merge gate.',
                file=sys.stderr,
            )
            status = 1
            continue
        if scan(image_id) != 0:
            status = 1
    return status


if __name__ == '__main__':
    sys.exit(main())
