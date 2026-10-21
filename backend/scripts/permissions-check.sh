#!/bin/sh
# Verify the bind sources selected by Docker before changing ownership.
# This closes the selection gap between the host stat and bind creation; a
# later concurrent replacement of a host path is outside this check's scope.

set -eu

if [ "$#" -ne 2 ]; then
  echo "Expected uploads and backups device:inode identities." >&2
  exit 2
fi

expected_uploads=$1
expected_backups=$2

identity() {
  stat -c '%d:%i' "$1"
}

check_identity() {
  path=$1
  expected=$2
  actual=$(identity "$path")
  if [ "$actual" != "$expected" ]; then
    echo "Refusing ownership repair: bind source identity changed for $path." >&2
    exit 1
  fi
}

check_plain_tree() {
  path=$1
  nested_link=$(find "$path" -type l -print -quit 2>/dev/null)
  if [ -n "$nested_link" ]; then
    echo "Refusing ownership repair: $path contains a symlink." >&2
    exit 1
  fi
}

check_identity /app/uploads "$expected_uploads"
check_identity /app/backups "$expected_backups"
check_plain_tree /app/uploads
check_plain_tree /app/backups

chown_tree() {
  root=$1
  root_device=$(identity "$root" | cut -d: -f1)
  # -xdev avoids descending into a nested mount. The device check also skips
  # the mount entry itself when its device differs from this root.
  find "$root" -xdev -exec sh -c '
    root_device=$1
    shift
    for entry do
      if [ "$(stat -c "%d" "$entry")" = "$root_device" ]; then
        chown -h appuser:appgroup "$entry"
      fi
    done
  ' permissions-check "$root_device" {} +
}

chown_tree /app/uploads
chown_tree /app/backups
