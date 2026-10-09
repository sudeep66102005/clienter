# Security model

## Implemented controls

- Scrypt password hashing with a unique random salt per account.
- Cryptographically random opaque session cookies; only SHA-256 token digests are stored in PostgreSQL.
- HttpOnly cookies, SameSite=Lax, and Secure cookies in production.
- Seven-day sessions; logout and password changes revoke sessions.
- Rate limits on authentication and API routes. The default rate-limit store is per process, suitable for the initial single-instance deployment.
- JSON request size limits and Zod input validation.
- Custom request-header requirement and same-origin checks on state-changing API calls.
- Helmet security headers and restrictive same-origin Content Security Policy.
- Parameterized database values. Dynamic table/column identifiers are exclusively from internal allowlists and validated schemas.
- Workspace ownership checks on records and references; restricted client portal projections.
- Invoice totals recalculated by the server in integer minor units, with row locking for payment updates.
- Hashed, expiring, single-use invitation tokens; replacement invitations revoke prior links.
- Locked acknowledged documents, preserving the content the client accepted.
- React text rendering rather than raw HTML interpolation for user-generated content.
- No production in-memory fallback; database configuration is mandatory.

## Limits and future hardening

This is a first release, not a claim of independently audited security or regulatory compliance. Email delivery, verification, recovery, MFA, a formal audit log, distributed rate limiting, storage scanning, and payment-provider handling are not implemented. All staff can access operational and financial records in their workspace. A removed team member's authorship is preserved while their email/password and sessions are disabled.

Registration is public and creates a new isolated workspace. Accounts are not email-verified. Do not treat a self-entered email as verified identity. Client access requires an owner-issued invitation. Owner-generated invitation links should be shared privately with the intended recipient.

Document links point to external storage; its permissions must be configured separately. Never put sensitive access tokens in link fields. Do not use this general agency workspace to store clinical patient records.

For real-client production use, maintain database backups, review the security model, add account recovery and observability, and commission a security review proportional to the data and scale involved.
