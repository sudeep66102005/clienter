# Clienter Workspace

A working client-management application inspired by the workflow at clienter.co.in, implemented from scratch. React frontend, Express API, PostgreSQL persistence, and a separate client portal. This repository was initially a README only; it does not contain or claim to be the source code of the reference service.

## What works

- Business account registration, sign-in/out, password changes, hashed passwords, revocable server-side sessions.
- Separate workspaces with server-enforced data ownership.
- Leads: stages, source, value, follow-up dates, conversion to clients.
- Clients: contact details, status, notes, private portal invitations.
- Projects: budgets, dates, shared/private visibility, delivery review and client approval.
- Tasks: project assignment, team assignee, priority, status, due dates.
- Retainers: monthly fee, billing month, deliverable target/progress, one draft invoice per period.
- Invoices: multiple line items, server-calculated tax/total, draft/issued/void states, partial payments, printable PDF via the browser.
- Expenses and dashboard totals derived from actual records.
- Meetings with downloadable `.ics` calendar events.
- Proposals/contracts/file links, portal sharing, immutable acknowledged documents.
- Team invitations and removal; workspace owner manages access and exports.
- Client portal: only that client's shared projects/documents, issued invoices, and meetings; project conversations, delivery approval, completed-project review.
- Workspace settings and JSON export.
- Responsive public landing page, desktop workspace, and mobile navigation.

The public landing page contains clearly labeled illustrative figures. New accounts start empty. No demonstration data is inserted into a production database.

## Run locally

Use Node 22.22+ or Node 24 and PostgreSQL 16+.

```sh
npm ci
cp .env.example .env
# Set DATABASE_URL and APP_URL in .env.
npm run build
npm run dev
```

Open http://localhost:3000. Tables are created idempotently on startup. The database connection is required in production; the app will fail closed rather than silently use temporary storage.

For frontend hot reload, run `npm run dev:web` in a second terminal and open http://localhost:5173. API requests are proxied to port 3000.

### Temporary local demo

```sh
npm ci
npm run build
DEMO_MODE=true npm start
```

Leave DATABASE_URL unset and do not set NODE_ENV=production. This uses an in-memory database, displays a warning, and loses all data when stopped. It must never be used for real client records.

### Docker with persistent PostgreSQL

Set `POSTGRES_PASSWORD` in your shell or an untracked `.env`, then run:

```sh
docker compose up --build
```

The database uses a named Docker volume. The bundled Compose setup is for localhost development. Never commit database credentials.

## Tests

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

Integration tests cover session protection, tenant isolation, invoice arithmetic and payments, retainer duplicate prevention, invitation scope/single use, client approval, document immutability, team access removal, export, and logout. They use pg-mem, not an external Postgres server. Browser tests exercise registration, clients, projects, tasks, invoice/payment creation, client invitation/approval, and mobile layout.

## Deploy on Render

See [the step-by-step deployment guide](docs/DEPLOYMENT.md). The root `render.yaml` describes a single Node web service that serves both the built frontend and API, plus a PostgreSQL database in Singapore. This same-origin design avoids cross-domain authentication and CORS setup.

**Billing:** the approved Blueprint selects a free web service and a dedicated paid `0.1c-256mb` database. At 1 GB storage, the database costs about $6.30/month before tax/additional usage. Render currently requires payment information before it can provision this database. Existing unrelated services must not be modified to make room.

## Deliberate integration boundaries

This is a functional first release of the core workspace, not every feature advertised by the reference product:

- Payments are manually recorded receipts, not card/UPI collection. No payment gateway or subscription billing is connected.
- Invitation links are generated for manual sharing. No email provider is configured; email verification and self-service password recovery are not implemented.
- Meetings export to calendar files; they do not automatically create Google Meet meetings.
- Files are HTTPS links, not hosted uploads. Use your existing file storage and its access controls.
- Document acknowledgment records the authenticated client's name and time. It is not a regulated digital-signature service.
- Tax is a single configurable percentage. This is not a certified GST/e-invoicing system and does not implement tax-jurisdiction logic or CGST/SGST splitting.
- Retainer invoices are generated explicitly by a user, not by a scheduler.
- Reviews are collected inside the client portal and visible to agency staff; there is no public marketplace/review directory.
- No AI quote generation, payroll calculation, custom-domain provisioning, or external messaging is connected.
- Team members have broad operational access to their workspace. Only the owner can invite/remove users, delete records, change workspace settings, and export data.
- One email belongs to one workspace account in this version.

## Security and operations

See [security notes](docs/SECURITY.md). Secrets belong in Render environment variables, never GitHub source. Use a dedicated database, keep backups, and run the live smoke checks in the deployment guide before inviting real users.
