# HomeFinance Staging Deployment Design

## Goal

Create a low-maintenance staging environment that is close to the verified Docker Compose release rehearsal, isolated from production data, reviewable through GitHub, and recoverable by redeploying an immutable manifest.

## Scope and boundaries

Staging runs on one Ubuntu 24.04 VPS and uses the existing Compose topology: Nginx/frontend, backend, PostgreSQL, Redis, MinIO, and deterministic mock-AI for test flows only. It contains staging data only, has no public registration, and is disposable after backups are verified. The first phase does not provide multi-node high availability, managed services, or production hosting.

The initial entry point is the VPS IP. A domain and TLS can be added later without changing the application topology. Only Nginx is internet-facing; PostgreSQL, Redis, and MinIO remain on the private Compose network.

## Server and access

The baseline VPS is 2 vCPU, 4 GB RAM, and 80 GB SSD running Ubuntu 24.04. The host firewall allows SSH, HTTP, and HTTPS only. SSH uses a key and disables password authentication. Application and backup data live under explicit host directories. Deployment access is restricted to the staging deployment directory and Docker operations; long-lived GitHub passwords are not stored on the server.

## Image and release flow

The deploy workflow remains tag-driven. It builds backend and frontend images, pushes a version tag and immutable digest to GHCR, and emits a deployment manifest containing the source commit, both image digests, migration head, and timestamp. The workflow deploy job targets the GitHub `staging` Environment and requires the repository owner (the user) as reviewer.

The server deploy script pulls the exact digests from the manifest, renders the staging environment file, validates the Compose configuration, and starts the stack. It then checks service health, migration status, and the four critical Playwright journeys, plus viewer/non-member denial, family isolation, and one idempotency replay. A failed step stops the release, preserves logs and container state, and marks the deployment unsuccessful. Mutable `latest` tags are not used for deployment.

Backend startup continues to run `prisma migrate deploy`. Schema changes must remain backward compatible during rollout; breaking changes are split into expand and contract migrations. Migration history is never rewritten.

## Backup and recovery

A daily job creates a PostgreSQL custom-format dump and copies MinIO objects and metadata into a host backup directory that is not served by Nginx. The policy retains the most recent seven daily backups and four weekly backups. Each backup records a SHA-256 checksum. A disposable restore rehearsal runs weekly against the current migration head and verifies representative authorization, family isolation, idempotency, and financial reconciliation behavior.

## Rollback and evidence

Each successful deployment stores the current and previous manifest, migration result, health checks, E2E result, and timestamp. Rollback redeploys the previous manifest. Application images can therefore be rolled back quickly; database schema is not automatically downgraded. If a migration is incompatible, recovery uses a forward-compatible fix or a verified backup restore with explicit operator action.

The staging evidence gate is separate from CI and rehearsal evidence. P1-H-03 can leave `BLOCKED/AT_RISK` only after a real staging deployment produces the required health, browser, authorization, isolation, replay, backup, and recovery evidence. No staging or production readiness claim is inferred from the existing rehearsal alone.

## Acceptance criteria

1. A clean VPS can be provisioned from documented steps and run the Compose stack without public database, Redis, or MinIO ports.
2. A reviewed tag deploys the exact recorded image digests and writes a complete manifest.
3. A failed health check or E2E step leaves diagnostics and does not advance the active manifest.
4. A previous manifest can be redeployed to restore the prior application version.
5. Daily backup retention, checksum verification, and weekly disposable restore are observable.
6. Staging data, credentials, and network access remain isolated from production.

## Deferred decisions

Cloud vendor, domain, TLS provider, and final secret transport are selected during implementation after comparing current price, region, and account availability. The design does not create cloud resources or secrets.
