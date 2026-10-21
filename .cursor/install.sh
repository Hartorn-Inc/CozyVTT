#!/usr/bin/env bash
# Cursor Cloud Build install: Node 26.12.0 (same as CI), npm ci, Prisma client.
# Idempotent. Runs from the repository root. Installs Node into $HOME; does not
# assume root or /usr/local. Does not write an Instance .env or start Compose.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT}"

NODE_VERSION="26.12.0"

node_arch() {
  case "$(uname -m)" in
    x86_64) echo x64 ;;
    aarch64 | arm64) echo arm64 ;;
    *)
      echo "unsupported architecture: $(uname -m)" >&2
      return 1
      ;;
  esac
}

node_on_path_is_pinned() {
  command -v node >/dev/null 2>&1 && [[ "$(node -v 2>/dev/null || true)" == "v${NODE_VERSION}" ]]
}

install_node_in_home() {
  local arch prefix tmp tarball sumfile
  arch="$(node_arch)"
  prefix="${HOME}/.local/node-v${NODE_VERSION}"
  if [[ -x "${prefix}/bin/node" && "$("${prefix}/bin/node" -v)" == "v${NODE_VERSION}" ]]; then
    export PATH="${prefix}/bin:${PATH}"
    return 0
  fi
  tmp="$(mktemp -d)"
  tarball="node-v${NODE_VERSION}-linux-${arch}.tar.xz"
  sumfile="${tmp}/SHASUMS256.txt"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "${sumfile}"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${tarball}" -o "${tmp}/${tarball}"
  (
    cd "${tmp}"
    grep "  ${tarball}\$" "${sumfile}" | sha256sum -c -
  )
  mkdir -p "${HOME}/.local"
  rm -rf "${prefix}"
  tar -xJf "${tmp}/${tarball}" -C "${HOME}/.local"
  mv "${HOME}/.local/node-v${NODE_VERSION}-linux-${arch}" "${prefix}"
  rm -rf "${tmp}"
  export PATH="${prefix}/bin:${PATH}"
}

persist_node_path() {
  local prefix line
  prefix="${HOME}/.local/node-v${NODE_VERSION}"
  mkdir -p "${HOME}/.local/bin"
  ln -sfn "${prefix}/bin/node" "${HOME}/.local/bin/node"
  ln -sfn "${prefix}/bin/npm" "${HOME}/.local/bin/npm"
  ln -sfn "${prefix}/bin/npx" "${HOME}/.local/bin/npx"
  line='export PATH="$HOME/.local/bin:$PATH"'
  for rc in "${HOME}/.profile" "${HOME}/.bashrc"; do
    touch "${rc}"
    grep -qxF "${line}" "${rc}" || echo "${line}" >>"${rc}"
  done
}

if ! node_on_path_is_pinned; then
  install_node_in_home
  persist_node_path
fi

node -v
npm -v

(cd backend && npm ci)
(cd backend && npx prisma generate)
(cd frontend && npm ci)
