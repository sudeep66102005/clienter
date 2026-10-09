# Free deployment: Render + Neon

Repository: https://github.com/sudeep66102005/clienter
Deploy branch: `main`.

This setup hosts both the React frontend and Express API on one **Render Free web service**, with persistent data in **Neon Free PostgreSQL**. It does not create a Render database or any paid resource.

## 1. Connect the free database account

Connect the Neon integration or sign up at https://neon.com using the **Free** plan. The Free plan has no time limit or credit-card requirement, but storage and compute quotas apply. Do not select an upgrade or paid organization.

Create a dedicated project named `clienter`. Prefer a region near Singapore if available. Keep its default database and role. Do not reuse another application's database.

## 2. Configure the secret connection

Obtain the project's PostgreSQL connection string securely. Set it as the Render service's `DATABASE_URL`. Do not commit, print, or share credentials in source files.

Set `DATABASE_SSL=true` for certificate-verified TLS. The Node PostgreSQL driver supports Neon's standard PostgreSQL connection string. The application creates its initial tables on first startup.

## 3. Deploy the web service

Use the connected Render integration to create a Node service with:

| Setting | Value |
| --- | --- |
| Name | clienter-app |
| Repository | https://github.com/sudeep66102005/clienter |
| Branch | main |
| Region | singapore |
| Plan | free |
| Build | npm ci --include=dev && npm test && npm run build |
| Start | npm start |
| Health check | /api/health |
| NODE_ENV | production |
| NODE_VERSION | 22.22.0 |
| DATABASE_URL | Neon connection string, supplied as a secret |
| DATABASE_SSL | true |

Alternatively, use the checked-in Blueprint:
https://dashboard.render.com/blueprint/new?repo=https://github.com/sudeep66102005/clienter

The Blueprint asks for DATABASE_URL and creates no database resource. Render supplies PORT and RENDER_EXTERNAL_URL automatically. For a custom domain, set APP_URL to the exact public HTTPS origin without a trailing slash.

## 4. Verify the live application

1. Confirm the Render deployment reaches `live`.
2. GET `/api/health` must return `{"status":"ok"}`.
3. Open the root URL, create the owner account, and add a test client/project.
4. Refresh and confirm records persist.
5. Issue a test invoice and record a partial payment; check the balance.
6. Open a client invitation in a separate browser profile. Check client isolation and delivery approval.
7. Redeploy and confirm the database records remain available.

Do not enable DEMO_MODE in production. The application fails closed if DATABASE_URL is missing.

## 5. Free-plan limitations

- Render Free web services sleep when idle, so the first request may be slow.
- Render free compute hours are shared with the workspace's other free services. This workspace already has an unrelated free service.
- Neon Free has storage/compute quotas. Check the account dashboard before importing large datasets.
- Free tiers are appropriate for an initial low-traffic pilot, not a promise of unlimited hosting or production availability.
- Remain on Free plans; do not auto-upgrade without explicit authorization.

Current official references:
- https://render.com/docs/free
- https://neon.com/pricing
- https://neon.com/docs/introduction/plans

## 6. Updates and maintenance

Source pushes to main trigger deployment when auto-deploy is enabled; do not trigger duplicates. GitHub Actions runs build/API/browser checks. Use workspace JSON exports and the database's available backup/restore features. Future schema changes should use explicit versioned migrations.

Before general customer launch, add email verification/recovery, provider-backed notifications, and any needed payment/tax integrations. See README.md and SECURITY.md for the boundaries of this first release.
