# Staging deployment runbook

Provision Ubuntu 24.04 with Docker Engine and Compose, create `/opt/homefinance-staging`, copy `ops/staging/compose.staging.yml`, `minio-proxy.conf`, `.env`, and scripts, then restrict the host firewall to SSH, HTTP, HTTPS, and proxy-only port 9000. Configure the repository `staging` Environment with the owner as required reviewer.

For a release, approve the `Deploy to staging` GitHub Environment job. It transfers the workflow manifest through SSH, logs into GHCR using the environment-scoped pull token, and runs `deploy.sh`. The script validates digest-only images, starts Compose, verifies Prisma migration status and the health endpoint, then promotes the manifest. The workflow then runs the critical browser journeys. On failure inspect the uploaded diagnostics and the evidence directory. Roll back with `ops/staging/rollback.sh` after confirming the previous manifest is compatible with the current database schema.

Run `backup.sh` daily, `BACKUP_CLASS=weekly backup.sh` weekly, prune with `backup-retention.sh`, and perform a disposable `restore-rehearsal.sh` weekly. It verifies checksums and restores into a temporary Compose project with independent volumes, then removes that project. Never place database dumps under the Nginx document root.
