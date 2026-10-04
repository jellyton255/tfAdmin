# Everfall txAdmin API (`/api/v1`)

> Everfall-only. Upstream txAdmin has no public API; this one is added by our fork and tracked in the
> [txAdmin API Plan](https://claude.ai/code/artifact/528bac32-45d6-42f1-9c1c-b699b189b0a6).

The API is served by the same web server and port as the panel (default `40120`), so it works through
whatever reverse proxy already fronts txAdmin. It is a separate surface from the panel's internal routes:
it never uses cookies or CSRF tokens, and a panel session cannot call it.

## Authentication

Every request carries an API key as a bearer token:

```
Authorization: Bearer txk_<keyId>.<secret>
```

Keys are created in the panel under **System → API Keys** (needs the `manage.admins` permission), or over the
API itself with a key that holds `manage.admins`. The plaintext token is shown exactly once; txAdmin stores
only its SHA-256 hash in `txData/apiKeys.json`.

Each key has:

- a **name**, which shows up in the admin action log as `api:<name>` for every action the key performs;
- a set of **permissions**, taken from the normal txAdmin permission list (`players.ban`, `control.server`, ...).
  A key can never hold a permission its creator does not hold;
- an optional **expiry** and an optional **IP allowlist** (plain IPs or CIDRs).

Revoking a key takes effect immediately. Revoked keys stay listed for audit.

## Envelope

Responses are JSON. Success:

```json
{ "data": { ... } }
```

Failure, with a matching HTTP status:

```json
{ "error": { "code": "FORBIDDEN", "message": "This API key lacks the required permission.", "details": { "permission": "players.ban" } } }
```

| Status | `error.code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body or params failed validation; `details` lists the issues |
| 401 | `UNAUTHORIZED` | Missing, malformed, unknown, revoked or expired key, or IP not allowed |
| 403 | `FORBIDDEN` | Key lacks the permission, or tried to grant one its creator lacks |
| 404 | `NOT_FOUND` | Unknown route or resource |
| 409 | `CONFLICT` | e.g. an active key with that name already exists |
| 415 | `VALIDATION_ERROR` | Write request without `Content-Type: application/json` |
| 429 | `RATE_LIMITED` | Per-key limit hit; see `Retry-After` |
| 500 | `INTERNAL_ERROR` | Unexpected error; `details.requestId` matches the `X-Request-Id` header |

Every response carries `X-Request-Id`, `X-TxAdmin-Version` and `X-RateLimit-Remaining`.
Timestamps are epoch milliseconds.

## Rate limits

Per key: about 120 requests per minute for normal routes, and about 10 per minute for routes that need
`control.server`, `console.write` or `commands.resources`. The existing per-IP limiter still applies on top.

## Endpoints (phase 1)

| Method and path | Permission | Returns |
| --- | --- | --- |
| `GET /api/v1/me` | any valid key | The calling key's record, txAdmin version, server time |
| `GET /api/v1/keys` | `manage.admins` | All keys (no hashes) and the permission catalogue |
| `POST /api/v1/keys` | `manage.admins` | Creates a key. Body: `{ name, permissions[], expiresAt?, allowedIps? }`. Returns `{ key, token }` with status 201 |
| `DELETE /api/v1/keys/{id}` | `manage.admins` | Revokes a key |

Later phases add server status, players, actions, whitelist, server control and webhooks; see the plan.

## Example

```sh
curl -H "Authorization: Bearer txk_abc123.…" https://tx.example.com/api/v1/me
```
