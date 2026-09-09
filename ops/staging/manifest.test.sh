#!/usr/bin/env bash
set -euo pipefail
bad='{"commit":"x","backendDigest":"latest","frontendDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","migrationHead":"m","createdAt":"t"}'
if grep -Eq '"backendDigest"[[:space:]]*:[[:space:]]*"sha256:[a-f0-9]{64}"' <<<"$bad"; then exit 1; fi
echo PASS
