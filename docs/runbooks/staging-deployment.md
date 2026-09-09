# Staging deployment runbook

Provision Ubuntu 24.04 with Docker Engine and Compose, create `/opt/homefinance-staging`, copy `ops/staging/compose.staging.yml`, `.env`, and scripts, then restrict the host firewall to SSH, HTTP, and HTTPS. Configure the repository `staging` Environment with the owner as required reviewer.

For a release, download the workflow artifact `deployment-manifest.json` and run `ops/staging/deploy.sh` with that file. The script validates digest-only images, starts Compose, and promotes the manifest only after health checks pass. On failure inspect `docker compose logs` and the evidence directory. Roll back with `ops/staging/rollback.sh` after confirming the previous manifest is compatible with the current database schema.

Run `backup.sh` daily, prune with `backup-retention.sh`, and perform a disposable `restore-rehearsal.sh` weekly. Record checksums and restore results in the release evidence artifact. Never place database dumps under the Nginx document root.
