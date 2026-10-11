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
- a set of **scopes**. Every valid key can read (status, players, bans and warns, whitelist, resources,
  events); a key with no scopes is read-only. Each scope unlocks one group of writes and is named after what
  it lets the key do (see the table below). A key can never hold a scope backed by an admin permission its
  creator does not hold;
- an optional **expiry** and an optional **IP allowlist** (plain IPs or CIDRs).

Changing a key's scopes or revoking it takes effect immediately. Revoked keys stay listed for audit.

### Scopes

| Scope id | Shown as | Unlocks |
| --- | --- | --- |
| *(none)* | Read access | Every `GET` route except `/keys`, `/webhooks` and `/admins` |
| `players.ban` | Ban players | Ban players or identifiers, revoke bans |
| `players.ban_import` | Import system bans | Record bans from game systems (anti-cheat) or the legacy game database with their own author label and absolute expiry. Only `all_permissions` admins can grant it |
| `players.warn` | Warn players | Warn players, revoke warns |
| `players.kick` | Kick players | Kick an online player |
| `players.direct_message` | Message players | Direct message an online player |
| `players.note` | Edit player notes | Set the admin note on a player |
| `players.whitelist` | Manage whitelist | Whitelist flag, approvals and requests |
| `announcement` | Send announcements | Broadcast an announcement |
| `control.server` | Control the server | Start, stop, restart, kick everyone |
| `console.write` | Run console commands | Execute console commands |
| `commands.resources` | Manage resources | Refresh and resource start/stop/restart/ensure |
| `manage.admins` | Manage API keys and webhooks | Keys, webhooks and the admin roster |
| `api.actor` | Act for staff members | Lets the key act for a txAdmin admin with `X-TxAdmin-Actor-Id` |
| `all_permissions` | Full access | Everything, including future scopes |

`GET /api/v1/keys` returns this catalogue as `scopes` so clients and the panel never hard-code it.

### Acting for a staff member

A consumer that lets its own staff press the buttons (ticket system, in-game admin panel) says who pressed
them. Give its key the `api.actor` scope and send the staff member's Discord (or FiveM) id on each write:

```
X-TxAdmin-Actor-Id: discord:272800190639898628
```

- The id must belong to a txAdmin admin (the Discord or FiveM account linked on their admin page). Anyone
  else gets **403** with `details.reason: "actor_not_admin"`, so staff need a txAdmin admin account to act
  through the API.
- The request can only use scopes that both the key and that admin hold. A key with `players.ban` acting for
  an admin without the Ban permission gets **403** with `details.reason: "actor_lacks_permission"`. Scopes
  with no matching admin permission (`players.note`, `api.actor`) are not narrowed.
- The action is recorded under the admin's txAdmin name, the same one their panel actions use:
  `Julian (via api:Tickets)` in the ban or warn record, revocations, notes, the admin log, in-game
  `txAdmin:events:*` and webhooks. Renaming the staff member elsewhere changes nothing; renaming the txAdmin
  admin applies to new actions.
- The id is `discord:<17-20 digits>` or `fivem:<digits>` (prefix case-insensitive, surrounding spaces
  ignored); anything else is a 400. A key without
  `api.actor` gets a 403 for the header. Without the header the key acts as itself (`api:Tickets`).

## Envelope

Responses are JSON. Success:

```json
{ "data": { ... } }
```

Failure, with a matching HTTP status:

```json
{ "error": { "code": "FORBIDDEN", "message": "This API key lacks the required scope.", "details": { "permission": "players.ban" } } }
```

| Status | `error.code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body or params failed validation; `details` lists the issues |
| 401 | `UNAUTHORIZED` | Missing, malformed, unknown, revoked or expired key, or IP not allowed |
| 403 | `FORBIDDEN` | Key lacks the scope, or tried to grant one its creator lacks |
| 404 | `NOT_FOUND` | Unknown route or resource |
| 409 | `CONFLICT` | e.g. an active key with that name already exists |
| 409 | `PLAYER_OFFLINE` | Kick or direct message to a player who is not connected |
| 503 | `SERVER_OFFLINE` | The action needs a running FXServer and it is offline or did not answer |
| 415 | `VALIDATION_ERROR` | Write request without `Content-Type: application/json` |
| 429 | `RATE_LIMITED` | Per-key limit hit; see `Retry-After` |
| 500 | `INTERNAL_ERROR` | Unexpected error; `details.requestId` matches the `X-Request-Id` header |

Every response carries `X-Request-Id`, `X-TxAdmin-Version` and `X-RateLimit-Remaining`.
Timestamps are epoch milliseconds everywhere (txAdmin's own database stores seconds; the API converts).

### Pagination

List endpoints take `limit` (1 to 200, default 50) and return `meta.nextCursor`. Pass it back as `?cursor=` to get the
next page; it is `null` on the last page. Cursors stay valid while rows are added or removed.

```json
{ "data": { "players": [ ... ] }, "meta": { "limit": 50, "nextCursor": "MTc1OTQ2...fA" } }
```

## Rate limits

Per key: about 120 requests per minute for normal routes, and about 10 per minute for routes that need
`control.server`, `console.write` or `commands.resources` (server start/stop/restart, kick-all, console
commands and resource commands). The existing per-IP limiter still applies on top.

## Endpoints (phase 1)

| Method and path | Scope | Returns |
| --- | --- | --- |
| `GET /api/v1/me` | any valid key | The calling key's record, txAdmin version, server time |
| `GET /api/v1/keys` | `manage.admins` | All keys (no hashes) and the scope catalogue |
| `POST /api/v1/keys` | `manage.admins` | Creates a key. Body: `{ name, permissions[] (scope ids, empty = read-only), expiresAt?, allowedIps? }`. Returns `{ key, token }` with status 201 |
| `PATCH /api/v1/keys/{id}` | `manage.admins` | Replaces a key's scopes; the token stays the same. Body: `{ permissions[] }`. The caller must hold the admin permission behind every scope it adds or removes. Revoked keys return 409 |
| `DELETE /api/v1/keys/{id}` | `manage.admins` | Revokes a key |

## Endpoints (phase 2, reads)

All of these work with any valid key, mirroring the panel pages every admin can see, except `/admins`.

| Method and path | Scope | Returns |
| --- | --- | --- |
| `GET /api/v1/status` | any valid key | txAdmin and FXServer state: health, uptime, player count and slots, project name, cfx.re join link, whitelist mode, next scheduled restart, Discord bot status |
| `GET /api/v1/players/online` | any valid key | Connected players: `netid`, `displayName`, `pureName`, `license` |
| `GET /api/v1/players/stats` | any valid key | Totals: `total`, `playedLast24h`, `joinedLast24h`, `joinedLast7d`, `onlineNow` |
| `GET /api/v1/players` | any valid key | Database search, paginated. Query: `q` with `type=name\|ids\|notes`, `filter=isOnline,isAdmin,isWhitelisted,hasNote`, `sort=tsLastConnection\|tsJoined\|playTime`, `order=desc\|asc` |
| `GET /api/v1/players/{license}` | any valid key | One player: database record, identifiers, notes, the current session when online, and the full action history |
| `GET /api/v1/actions` | any valid key | Bans and warns, paginated. Query: `q` with `type=ids\|id\|reason\|name` (`name` is a fuzzy player name search), `kind=ban\|warn`, `author`, `status=active\|revoked`, `order` |
| `GET /api/v1/actions/stats` | any valid key | Totals for the last 7 days and all time, plus a per-admin count |
| `GET /api/v1/actions/{id}` | any valid key | One action |
| `GET /api/v1/whitelist/approvals` | any valid key | Approved identifiers, paginated, `q` searches identifier, name and approver |
| `GET /api/v1/whitelist/requests` | any valid key | Pending join requests, paginated, `q` searches id, name, Discord tag and license |
| `GET /api/v1/resources` | any valid key | Every resource with its status, path relative to the server data folder, version, author and description. 503 while the server is offline |
| `GET /api/v1/admins` | `manage.admins` | Admin names, master flag, permissions and provider identifiers. Never includes password hashes or tokens |

Action records carry `banStatus` (`active`, `expired`, `permanent`, or `null` for warns), `expiresAt`, `acked` for warns,
and `revokedAt` / `revokedBy`. `externalRef` is the idempotency key of bans recorded through
`POST /api/v1/actions/import-ban`, and `null` for every other action.

## Endpoints (phase 3, writes)

Writes behave exactly like the matching panel buttons: same database records, same admin log lines
(attributed to `api:<key name>`) and the same `txAdmin:events:*` events to the server. Bodies are JSON.

`duration` for bans is `permanent` or `<n> hours|days|weeks|months`, e.g. `2 days`.

| Method and path | Scope | Body and result |
| --- | --- | --- |
| `POST /api/v1/players/{license}/ban` | `players.ban` | `{ reason, duration }`. 201 with `{ action, eventSent }`; kicks the player if online |
| `POST /api/v1/players/{license}/warn` | `players.warn` | `{ reason }`. 201 with `{ action, eventSent }` |
| `POST /api/v1/players/{license}/kick` | `players.kick` | `{ reason? }`. Player must be online (409 `PLAYER_OFFLINE`) |
| `POST /api/v1/players/{license}/message` | `players.direct_message` | `{ message }`. Player must be online |
| `PUT /api/v1/players/{license}/whitelist` | `players.whitelist` | `{ whitelisted: true\|false }` |
| `PUT /api/v1/players/{license}/note` | `players.note` | `{ note }`; an empty string clears it |
| `POST /api/v1/actions/ban-identifiers` | `players.ban` | `{ identifiers[], reason, duration }`. Bans raw identifiers (`discord:…`, `fivem:…`, `license:…`) that may not belong to a known player. 201 with `{ action, eventSent }` |
| `POST /api/v1/actions/import-ban` | `players.ban_import` | `{ externalRef, identifiers[], hwids?[], playerName?, reason, author, expiresAt?, notify? }`. Records a system or legacy ban. 201 with `{ action, created: true, dropped, eventSent }`; 200 with `created: false` on a replay |
| `POST /api/v1/actions/{id}/revoke` | `players.ban` for bans, `players.warn` for warns | Revokes the action; 409 if already revoked. Returns `{ action }` |
| `POST /api/v1/whitelist/approvals` | `players.whitelist` | `{ identifier }`. 201 with `{ approval }`; 409 if already approved |
| `DELETE /api/v1/whitelist/approvals/{identifier}` | `players.whitelist` | Removes the approval |
| `POST /api/v1/whitelist/requests/{id}/approve` | `players.whitelist` | Approves the pending request (`R0001`), 201 with `{ approval }` |
| `POST /api/v1/whitelist/requests/{id}/deny` | `players.whitelist` | Removes the request |
| `POST /api/v1/whitelist/requests/deny-all` | `players.whitelist` | `{ before?: epochMs }`. Removes every request last attempted at or before `before` (default now). Returns `{ removed }` |
| `POST /api/v1/server/start`, `/stop`, `/restart` | `control.server` | Returns `{ action, result, message }`; `result` is `started`, `stopped`, `restarting`, `scheduled` (restart delayed by the spawn backoff) or `noop` |
| `POST /api/v1/server/kick-all` | `control.server` | `{ reason? }` |
| `POST /api/v1/server/announce` | `announcement` | `{ message }`. In-game announcement plus the Discord announcement channel |
| `POST /api/v1/server/command` | `console.write` | `{ command }`. Raw console command, logged like the Live Console |
| `POST /api/v1/resources/{name}/{start\|stop\|restart\|ensure}` | `commands.resources` | Sends the resource command. Starting `runcode` is refused |
| `POST /api/v1/resources/refresh` | `commands.resources` | Sends `refresh` |

`eventSent: false` on a ban or warn means the record was saved but the in-game event could not be
delivered (server offline or stdin error), the same case where the panel shows a warning toast.

### Importing bans

`POST /api/v1/actions/import-ban` records bans that game systems (anti-cheat) issue or that come from the
legacy game database. The `players.ban_import` scope is separate from `players.ban`.

- **Idempotency.** `externalRef` (1-96 chars of `A-Z a-z 0-9 _ . : -`, e.g. `qbx-bans:1167`) identifies the
  ban. When a ban with the same `externalRef` exists, the response is 200 with `created: false` and the
  stored action. Nothing is written, logged or sent.
- **`dropped`.** Identifiers that are not valid txAdmin identifiers and hwids that are not hardware
  tokens are dropped and listed in `dropped`. When no valid identifier remains, the response is 400
  `VALIDATION_ERROR` with `details.invalids`.
- **`author`.** The label stored as the ban author (1-64 chars). A label that matches a txAdmin admin
  name, case-insensitive, is rejected with 400 `VALIDATION_ERROR` and `details.field: "author"`.
  The admin log records the key as the actor.
- **`expiresAt`.** Absolute expiry in epoch ms. Omitted or `null` means permanent. `playerName` is
  optional too: omitted or `null` stores the ban without a name.
- **`notify`.** Default `false`: the import is silent (no in-game event, so no kick, no `player.banned`
  event or webhook). With `true`, the server gets the same `playerBanned` event as a panel ban.

## Events and webhooks (phase 4)

txAdmin publishes the events it already broadcasts in-game, plus player joins/leaves and server
health changes, to two sinks: a ring buffer you can poll and signed webhooks it pushes to you.

Event shape: `{ id, type, ts, data }`. `id` is monotonic and doubles as the polling cursor, `ts` is
epoch ms, and `data` matches the in-game event table in `docs/events.md` for the mapped events.

| Type | Source and `data` |
| --- | --- |
| `server.online`, `server.partial`, `server.offline` | Health monitor transitions. `{ status }` |
| `server.shuttingDown` | `txAdmin:events:serverShuttingDown` |
| `server.scheduledRestart`, `server.scheduledRestartSkipped`, `server.nextRestartSkipped` | Scheduler events |
| `server.announcement` | `{ author, message }` |
| `server.configChanged` | Settings saved that affect the server |
| `player.joined` | `{ netid, displayName, license, ids }` |
| `player.left` | `{ netid, displayName, license, reason, reasonCategory }` |
| `player.banned`, `player.warned`, `player.kicked`, `player.directMessage` | Same payload as `txAdmin:events:playerBanned` etc. `author` is `api:<key>` for API actions |
| `whitelist.player`, `whitelist.preApproval`, `whitelist.request` | Whitelist changes |
| `action.revoked` | `{ actionId, actionType, actionReason, actionAuthor, playerName, playerIds, playerHwids, revokedBy }` |
| `admin.login` | A panel admin signed in. `{ name, method: 'password' \| 'citizenfx', ip }` |
| `apiKey.firstUse` | First request made with a new key. `{ keyId, keyName, ip }` |
| `webhook.test` | Sent by the test button / endpoint to that webhook only |

### Polling

| Method and path | Scope | Notes |
| --- | --- | --- |
| `GET /api/v1/events?since={cursor}&types=a,b&limit=100` | any valid key | Last 1000 events (`admin.login`, `apiKey.firstUse` and `webhook.test` only for keys with `manage.admins`). `meta.cursor` is what to pass back as `since`; `meta.hasMore` means call again now; `meta.dropped` means `since` was older than the buffer and events were lost |
| `GET /api/v1/events/types` | any valid key | The catalogue above |

### Webhooks

| Method and path | Scope | Notes |
| --- | --- | --- |
| `GET /api/v1/webhooks` | `manage.admins` | List (secrets are never returned) plus the event catalogue |
| `POST /api/v1/webhooks` | `manage.admins` | `{ name, url, events[], secret? }`. `url` must be `https://` (plain `http://` only for localhost/private hosts). `events` is a list of types or `["*"]`. Returns the secret once. Max 10 webhooks |
| `PATCH /api/v1/webhooks/{id}` | `manage.admins` | `{ enabled?, events? }` |
| `DELETE /api/v1/webhooks/{id}` | `manage.admins` | Drops pending retries too |
| `POST /api/v1/webhooks/{id}/test` | `manage.admins` | Sends `webhook.test` and waits for the first attempt. Returns the delivery |
| `GET /api/v1/webhooks/{id}/deliveries` | `manage.admins` | Last 50 deliveries with status, attempts, HTTP status and next retry time |

The same management lives in the panel under **System > API Keys > Webhooks**.

Delivery is a `POST` with a JSON body `{ event, webhookId, deliveryId, attempt, server: { name, txAdminVersion } }`
and these headers:

| Header | Value |
| --- | --- |
| `X-TxAdmin-Signature` | `t=<epoch ms>,v1=<hex hmac-sha256(secret, "<t>.<raw body>")>` |
| `X-TxAdmin-Event` | the event type |
| `X-TxAdmin-Delivery` | the delivery id (same on every retry; `attempt` in the body increments) |
| `X-TxAdmin-Webhook` | the webhook id |

Respond with any 2xx within 5 seconds. Anything else (or a timeout) is retried after 10 s, 1 min,
10 min and 1 h, then the delivery is marked failed. Deliveries are at-least-once: dedupe on
`deliveryId` for retries or `event.id` for the event itself. Verify the signature before trusting the
body and reject timestamps more than 5 minutes old:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, header, rawBody) {
    if (typeof header !== 'string') return false;
    const { t, v1 } = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
    if (typeof v1 !== 'string' || !Number.isFinite(Number(t))) return false;
    if (Math.abs(Date.now() - Number(t)) > 5 * 60_000) return false;
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
    const given = Buffer.from(v1, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
}
```

Or use `parseWebhookRequest()` from the client package below.

## OpenAPI and client

- `GET /api/v1/docs` is a Swagger UI page over the document below, handy for trying calls with a key.
- `GET /api/v1/openapi.json` serves the OpenAPI 3.1 document (no auth, no server data). The same
  file is committed at `docs/openapi.json`; `openapi.test.ts` fails when the routes and the committed
  spec drift, so every contract change shows in the PR diff. Regenerate with
  `UPDATE_OPENAPI=1 pnpm --filter txadmin-core exec vitest run modules/ApiServer/openapi.test.ts`.
- `client/` is `@everfall/txadmin-client`, a zero-dependency typed client (fetch based) covering every
  endpoint, a polling iterator for `/events` and the webhook verification helpers. It compiles against
  `shared/apiV1Types.ts`, so the types can never drift from the server. Build with
  `pnpm --filter @everfall/txadmin-client build`. Releases: bump the version in
  `client/package.json` and merge to master. When no `client-vX.Y.Z` tag exists for that version
  yet, the `publish-client` workflow creates the tag and a GitHub release carrying the packed
  tarball (and publishes to npm when an `NPM_TOKEN` secret exists); when the tag already exists
  the run is a no-op. Nobody pushes tags by hand, and the workflow only runs from master, so a
  failed run is re-run from the Actions tab rather than dispatched by hand. Consumers can depend on the
  release tarball URL directly, see `client/README.md`.

## Example

```sh
curl -H "Authorization: Bearer txk_abc123.…" https://tx.example.com/api/v1/me
```
