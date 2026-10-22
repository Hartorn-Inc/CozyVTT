#!/usr/bin/env bash
# Recompute CURSOR_CLI_INSTALL_SHA256 in the advisory review workflow for the
# pinned CURSOR_CLI_VERSION. Renovate bumps the version; this script refreshes
# the linux/x64 tarball digest. No network in unit tests — run by hand or on
# a deps:cursor-cli pull request.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/advisory-pr-review.yml"

VERSION="$(sed -n 's/^  CURSOR_CLI_VERSION: "\(.*\)"/\1/p' "${WORKFLOW}" | head -1)"
if [[ -z "${VERSION}" ]]; then
  echo "Failed to parse CURSOR_CLI_VERSION from ${WORKFLOW}" >&2
  exit 1
fi

url="https://downloads.cursor.com/lab/${VERSION}/linux/x64/agent-cli-package.tar.gz"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL "${url}" -o "${tmpdir}/agent-cli-package.tar.gz"
digest="$(sha256sum "${tmpdir}/agent-cli-package.tar.gz" | awk '{print $1}')"

python3 - "${WORKFLOW}" "${digest}" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
digest = sys.argv[2]
text = path.read_text()
new_text, n = re.subn(
    r'^(  CURSOR_CLI_INSTALL_SHA256: ").*(")$',
    rf'\g<1>{digest}\2',
    text,
    count=1,
    flags=re.M,
)
if n != 1:
    raise SystemExit('failed to update CURSOR_CLI_INSTALL_SHA256')
path.write_text(new_text)
print(f'Updated CURSOR_CLI_INSTALL_SHA256={digest} in {path}')
PY
