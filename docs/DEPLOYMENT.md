# Render deployment: start to finish

## 1. Source

Repository: https://github.com/sudeep66102005/clienter

Deploy branch: `main`. The app is a single Node service serving React assets and the `/api` endpoints. No separate frontend hosting is necessary.

## 2. Database and cost

Create a **new dedicated PostgreSQL 16 database** named `clienter-db` in Singapore. Do not connect to or change an unrelated application's database.

On 2026-10-09, this workspace's attempt to create another free Postgres instance was rejected because Render permits only one active free database and the workspace already had an unrelated one. The proposed alternative is the smallest paid Postgres compute plan `0.1c-256mb` with 1 GB disk.

Render listed $6/month database compute plus $0.30/GB/month storage on that date (about $6.30/month at 1 GB, before any tax or additional usage). The free web service can sleep when idle and is subject to shared workspace limits. An always-on web plan costs extra and is not selected by this configuration. Verify prices in the Render billing screen before purchase.

Sources:
- https://render.com/pricing
- https://render.com/docs/free
- https://render.com/docs/blueprint-spec

## 3. Blueprint deployment

The checked-in Blueprint defaults to the free plan. After authorizing the database cost, change only the database `plan` to `0.1c-256mb`, keep `diskSizeGB: 1`, commit, and push. Then:

1. Open https://dashboard.render.com/select-repo?type=blueprint .
2. Select `sudeep66102005/clienter`, branch `main`.
3. Review `render.yaml`. It creates `clienter-app` and `clienter-db` in Singapore.
4. Confirm the displayed resource plans and pricing, then apply the Blueprint.
5. Render populates `DATABASE_URL` from the dedicated database's private connection string.
6. Build command: `npm ci --include=dev && npm test && npm run build`.
7. Start command: `npm start`.
8. Health check: `/api/health`.

The Blueprint is the easiest way to connect the database without copying credentials. Render's API/connector may also be used to create the same resources and set the private connection string as a secret environment value.

## 4. Environment

| Variable | Value |
| --- | --- |
| NODE_ENV | production |
| NODE_VERSION | 22.22.0 |
| DATABASE_URL | Dedicated PostgreSQL private connection string; never print or commit it |
| PORT | Supplied automatically by Render |
| APP_URL | Optional for the default Render hostname; required when using a custom public domain |
| DATABASE_SSL | Leave unset for Render private-network connections; use `true` for an external database that requires certificate-verified TLS |

The application uses `RENDER_EXTERNAL_URL` when APP_URL is absent. For a custom domain set APP_URL to the exact HTTPS origin, without a trailing slash. Do not enable DEMO_MODE in production.

## 5. Verify the running service

After the deploy reports live:

1. GET `/api/health` must return `{"status":"ok"}`.
2. Open the root URL and create the owner's business account using a strong, unique password.
3. Create a test client and a project. Refresh and confirm both persist.
4. Issue a test invoice and record a partial payment; verify the remaining balance.
5. Create a client invitation and open it in a separate browser profile. Confirm the client cannot see other clients' work.
6. Restart/redeploy the service; sign in again and confirm records persist in Postgres.
7. Remove test records where safe; do not use placeholder payments for real invoices.

## 6. Ongoing deployment

Auto-deploy from `main` can be enabled on Render. A source push then starts a deployment; do not trigger duplicate deployments manually. The supplied GitHub Actions workflow also runs API/build/browser checks.

## 7. Backups and operations

- Enable an appropriate backup/recovery policy for the database and test restoring it.
- Keep database access on Render's internal network where possible. The Blueprint disables external database ingress.
- Set a custom domain and APP_URL together if desired.
- Monitor `/api/health`, deploy logs, database storage, and resource limits.
- Before general customer launch, configure email verification/recovery, provider-backed notifications, and any required payment or tax integrations.
- Future schema changes should use explicit versioned migrations. The initial schema only creates tables; it is not a general migration engine.
