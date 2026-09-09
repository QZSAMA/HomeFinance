# Staging operations

Copy `.env.example` to `/opt/homefinance-staging/.env`, replace every placeholder with staging-only secrets, and install the Compose file and scripts under the same directory. Run `backup.sh` daily, `backup-retention.sh` after backup, and `restore-rehearsal.sh <backup-directory>` weekly. Keep backups outside the Nginx document root and alert when the filesystem reaches 80% usage.
