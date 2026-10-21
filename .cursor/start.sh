#!/usr/bin/env bash
# Cursor Cloud agent start: Docker if needed, then the throwaway test Postgres
# from docs/DEVELOPMENT.md. Does not start docker-compose, and does not write
# SESSION_SECRET, backup keys, or an Instance .env.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT}"

CONTAINER="cozyvtt-test-pg"
# Local test credentials from DEVELOPMENT.md, not a secret.
POSTGRES_USER="cozyvtt"
POSTGRES_PASSWORD="cozyvtt"
POSTGRES_DB="cozyvtt_test"
POSTGRES_PORT="55500"
IMAGE="postgres:18-alpine"
WAIT_SEC="${COZYVTT_START_WAIT_SEC:-90}"

open_docker_run_dir() {
  sudo mkdir -p /var/run
  sudo chmod 755 /var/run 2>/dev/null || true
}

docker_ready() {
  docker info >/dev/null 2>&1
}

sudo_docker_ready() {
  sudo docker info >/dev/null 2>&1
}

start_docker() {
  open_docker_run_dir
  if docker_ready || sudo_docker_ready; then
    return 0
  fi
  # Cursor-documented pattern for Cloud VMs.
  sudo service docker start || true
}

wait_for_docker() {
  local deadline
  deadline=$((SECONDS + WAIT_SEC))
  start_docker
  while ! docker_ready; do
    if ((SECONDS >= deadline)); then
      echo "Docker is not ready within ${WAIT_SEC}s" >&2
      sudo service docker status >&2 || true
      exit 1
    fi
    open_docker_run_dir
    if ! sudo_docker_ready; then
      sudo service docker start || true
    fi
    sleep 1
  done
}

wait_for_postgres() {
  local deadline
  deadline=$((SECONDS + WAIT_SEC))
  until docker exec "${CONTAINER}" pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      echo "Postgres ${CONTAINER} is not ready within ${WAIT_SEC}s" >&2
      docker logs --tail 50 "${CONTAINER}" >&2 || true
      exit 1
    fi
    sleep 1
  done
}

wait_for_docker

if docker inspect "${CONTAINER}" >/dev/null 2>&1; then
  docker start "${CONTAINER}" >/dev/null
else
  docker run -d --name "${CONTAINER}" \
    -e "POSTGRES_USER=${POSTGRES_USER}" \
    -e "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
    -e "POSTGRES_DB=${POSTGRES_DB}" \
    -p "127.0.0.1:${POSTGRES_PORT}:5432" \
    "${IMAGE}"
fi

wait_for_postgres
echo "Test Postgres is ready on localhost:${POSTGRES_PORT} (${POSTGRES_DB})"
