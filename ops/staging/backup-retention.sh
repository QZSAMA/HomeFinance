#!/usr/bin/env bash
set -euo pipefail
ROOT="${STAGING_ROOT:-/opt/homefinance-staging}"
prune() {
  local directory="$1" keep="$2"
  test -d "$directory" || return 0
  mapfile -t backups < <(find "$directory" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
  for ((index=keep; index<${#backups[@]}; index++)); do
    case "${backups[$index]}" in "$directory"/*) rm -rf -- "${backups[$index]}";; *) exit 1;; esac
  done
}
prune "$ROOT/backups/daily" 7
prune "$ROOT/backups/weekly" 4
