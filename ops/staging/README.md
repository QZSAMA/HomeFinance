# Staging operations

Copy `.env.example` to `/opt/homefinance-staging/.env`, replace every placeholder with staging-only secrets, and install the Compose file, `minio-proxy.conf`, and scripts under the same directory. Run `backup.sh` daily, `BACKUP_CLASS=weekly backup.sh` weekly, `backup-retention.sh` after backup, and `restore-rehearsal.sh <backup-directory>` weekly. Keep backups outside the Nginx document root and alert when the filesystem reaches 80% usage.

The public firewall opens SSH, HTTP, HTTPS, and port 9000. Port 9000 reaches the Nginx `minio-proxy` only, never MinIO directly; it is required for browser-usable presigned object URLs before a domain is available. Port 9001 remains private.
