/**
 * OpenAPI 3.1 document for /api/v1, built by hand from the route table and the types in
 * shared/apiV1Types.ts. docs/openapi.json is the committed copy; openapi.test.ts fails when
 * they drift so a contract change is always visible in the PR diff.
 */
import { API_ERROR_CODES, API_EVENT_TYPES, API_PAGE_DEFAULT_LIMIT, API_PAGE_MAX_LIMIT, API_WEBHOOKS_MAX } from '@shared/apiV1Types';

export const OPENAPI_INFO_VERSION = '1.0.0';

type Schema = Record<string, any>;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const str = (extra: Schema = {}): Schema => ({ type: 'string', ...extra });
const int = (extra: Schema = {}): Schema => ({ type: 'integer', ...extra });
const bool = (): Schema => ({ type: 'boolean' });
const nullable = (schema: Schema): Schema => ({ oneOf: [schema, { type: 'null' }] });
const arr = (items: Schema): Schema => ({ type: 'array', items });
const epochMs = (description = 'Unix epoch milliseconds'): Schema => int({ description });
const obj = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
});
const enumOf = (values: readonly string[]): Schema => ({ type: 'string', enum: [...values] });

const dataEnvelope = (data: Schema, meta?: Schema): Schema => obj(meta ? { data, meta } : { data });

const paramQ = (name: string, schema: Schema, description?: string): Schema => ({
    name, in: 'query', required: false, schema, ...(description ? { description } : {}),
});
const paramPath = (name: string, schema: Schema, description?: string): Schema => ({
    name, in: 'path', required: true, schema, ...(description ? { description } : {}),
});
const paginationParams = [
    paramQ('limit', int({ minimum: 1, maximum: API_PAGE_MAX_LIMIT, default: API_PAGE_DEFAULT_LIMIT })),
    paramQ('cursor', str(), 'Opaque cursor from meta.nextCursor'),
    paramQ('order', enumOf(['asc', 'desc'])),
];

const jsonBody = (schema: Schema, required = true) => ({ required, content: { 'application/json': { schema } } });
const jsonResp = (description: string, schema: Schema) => ({ description, content: { 'application/json': { schema } } });
const errResp = (description: string) => ({ description, content: { 'application/json': { schema: ref('ErrorEnvelope') } } });
const errRef = (name: string): Schema => ({ $ref: `#/components/responses/${name}` });

type OpOptions = {
    summary: string;
    tag: string;
    permission?: string | null; //undefined = any key, null = no auth
    params?: Schema[];
    body?: Schema;
    bodyOptional?: boolean;
    response: Schema;
    status?: number;
    meta?: Schema;
    errors?: number[];
    description?: string;
    permissionNote?: string; //overrides the generated scope sentence (per-type scope checks)
};
const op = (o: OpOptions): Schema => {
    const responses: Record<string, any> = {
        [String(o.status ?? 200)]: jsonResp('Success', dataEnvelope(o.response, o.meta)),
    };
    if (o.permission !== null) {
        responses['401'] = errRef('Unauthorized');
        responses['429'] = errRef('RateLimited');
    }
    if (o.permission) responses['403'] = errRef('Forbidden');
    if (o.body || o.params?.length || o.permission || o.permissionNote) responses['400'] = errRef('ValidationError');
    for (const code of o.errors ?? []) {
        responses[String(code)] = errRef(ERROR_RESPONSES[code]);
    }
    const permissionNote = o.permissionNote ?? (o.permission === null
        ? 'No authentication.'
        : o.permission
            ? `Requires the \`${o.permission}\` scope.`
            : 'Any valid key (read-only keys included).');
    //Writes (scoped routes) accept X-TxAdmin-Actor-Id to name the staff member behind the call
    const params = [...(o.params ?? []), ...(o.permission || o.permissionNote ? [{ $ref: '#/components/parameters/ActorId' }] : [])];
    return {
        summary: o.summary,
        description: [o.description, permissionNote].filter(Boolean).join('\n\n'),
        tags: [o.tag],
        ...(o.permission === null ? { security: [] } : {}),
        ...(params.length ? { parameters: params } : {}),
        ...(o.body ? { requestBody: jsonBody(o.body, !o.bodyOptional) } : {}),
        responses,
    };
};
const ERROR_RESPONSES: Record<number, string> = {
    400: 'ValidationError',
    403: 'Forbidden',
    404: 'NotFound',
    409: 'Conflict',
    503: 'Unavailable',
};
const responses: Record<string, Schema> = {
    Unauthorized: errResp('Missing, invalid, revoked or expired key'),
    Forbidden: errResp('The key lacks the scope this route needs (see the description)'),
    RateLimited: errResp('Rate limit exceeded, see the Retry-After header'),
    ValidationError: errResp('Validation error, details lists the offending fields'),
    NotFound: errResp('Not found'),
    Conflict: errResp('Conflict with the current state'),
    Unavailable: errResp('Server offline (SERVER_OFFLINE) or player offline (PLAYER_OFFLINE)'),
};


const schemas: Record<string, Schema> = {
    ErrorEnvelope: obj({
        error: obj({
            code: enumOf(API_ERROR_CODES),
            message: str(),
            details: {},
        }, ['code', 'message']),
    }),
    PageMeta: obj({
        limit: int(),
        nextCursor: nullable(str({ description: 'Pass as ?cursor= for the next page' })),
    }),
    Ok: obj({ ok: { type: 'boolean', const: true } }),
    ApiScope: obj({
        id: str(), label: str(), description: str(),
        grantRequires: nullable(str({ description: 'Admin permission the issuer must hold to grant this scope' })),
    }, ['id', 'label', 'description', 'grantRequires']),
    ApiKey: obj({
        id: str(), name: str(), permissions: arr(str({ description: 'Scope id' })), createdBy: str(), createdAt: epochMs(),
        lastUsedAt: nullable(epochMs()), expiresAt: nullable(epochMs()), allowedIps: arr(str()),
        revokedAt: nullable(epochMs()), revokedBy: nullable(str()),
    }),
    ApiKeyCreate: obj({
        name: str({ maxLength: 48, pattern: '^[a-zA-Z0-9 _.-]+$' }),
        permissions: arr(str({ description: 'Scope id, see GET /keys. Empty = read-only key' })),
        expiresAt: nullable(epochMs()),
        allowedIps: arr(str({ description: 'IP or CIDR' })),
    }, ['name', 'permissions']),
    Status: obj({
        txAdmin: obj({ version: str(), configState: str(), serverTime: epochMs() }),
        server: obj({
            name: str(), health: enumOf(['OFFLINE', 'ONLINE', 'PARTIAL']), healthReason: str(),
            uptime: int({ description: 'ms since boot, 0 when offline' }), isProcessAlive: bool(), isRunnerIdle: bool(),
            whitelistMode: enumOf(['disabled', 'adminOnly', 'approvedLicense', 'discordMember', 'discordRoles']),
            playerCount: int(), playerSlots: nullable(int()), projectName: nullable(str()), projectDesc: nullable(str()),
            gameName: nullable(enumOf(['fivem', 'redm'])), cfxId: nullable(str()), joinLink: nullable(str()),
        }),
        scheduler: obj({ nextRestartAt: nullable(epochMs()), nextSkip: bool(), nextIsTemp: bool() }),
        discord: obj({ status: enumOf(['disabled', 'starting', 'ready', 'error']) }),
    }),
    OnlinePlayer: obj({ netid: int(), displayName: str(), pureName: str(), license: nullable(str()), connectedAt: epochMs(), ids: arr(str()) }),
    PlayerSummary: obj({
        license: str(), displayName: str(), pureName: str(), playTime: int({ description: 'minutes' }),
        joinedAt: epochMs(), lastConnectionAt: epochMs(), whitelistedAt: nullable(epochMs()), notes: nullable(str()),
        isAdmin: bool(), isOnline: bool(),
    }),
    PlayerDetail: {
        allOf: [ref('PlayerSummary'), obj({
            ids: arr(str()), hwids: arr(str()), notesLastEditedBy: nullable(str()), notesLastEditedAt: nullable(epochMs()),
            session: nullable(obj({ netid: int(), connectedAt: epochMs(), idsOnline: arr(str()), hwidsOnline: arr(str()) })),
            actions: arr(ref('Action')),
        })],
    },
    PlayersStats: obj({ total: int(), playedLast24h: int(), joinedLast24h: int(), joinedLast7d: int(), onlineNow: int() }),
    Action: obj({
        id: str(), type: enumOf(['ban', 'warn']), playerName: nullable(str()), ids: arr(str()), hwids: arr(str()),
        reason: str(), author: str(), createdAt: epochMs(), expiresAt: nullable(epochMs('Bans only, null = permanent')),
        banStatus: nullable(enumOf(['active', 'expired', 'permanent'])), acked: nullable(bool()),
        revokedAt: nullable(epochMs()), revokedBy: nullable(str()),
        externalRef: nullable(str({ description: 'Idempotency key of bans recorded via POST /actions/import-ban, else null' })),
    }),
    ActionsStats: obj({
        totalWarns: int(), warnsLast7d: int(), totalBans: int(), bansLast7d: int(),
        byAdmin: arr(obj({ name: str(), actions: int() })),
    }),
    ActionWrite: obj({ action: ref('Action'), eventSent: bool() }),
    ImportBan: obj({
        externalRef: str({ minLength: 1, maxLength: 96, pattern: '^[A-Za-z0-9_.:-]+$', description: 'Idempotency key, e.g. `qbx-bans:1167`' }),
        identifiers: { ...arr(str({ description: 'Trimmed and lowercased; invalid ones are dropped' })), minItems: 1, maxItems: 64 },
        hwids: { ...arr(str({ description: 'Hardware token like `2:<64 hex>`; invalid ones are dropped' })), maxItems: 64 },
        playerName: nullable(str({ minLength: 1, maxLength: 128, description: 'Omitted or null = no name' })),
        reason: str({ minLength: 3, maxLength: 2048 }),
        author: str({ minLength: 1, maxLength: 64, description: 'Author label; must not match a txAdmin admin name (case-insensitive)' }),
        expiresAt: nullable(epochMs('Absolute expiry in epoch ms; omitted or null = permanent')),
        notify: { ...bool(), default: false, description: 'Send the in-game playerBanned event (kick, webhooks). Default false: silent' },
    }, ['externalRef', 'identifiers', 'reason', 'author']),
    ImportBanResult: obj({
        action: ref('Action'),
        created: { ...bool(), description: 'false when externalRef was already imported (nothing written)' },
        dropped: arr(str({ description: 'Identifier or hwid that failed validation and was not stored' })),
        eventSent: bool(),
    }),
    BanDuration: str({ description: '`permanent` or `<n> hours|days|weeks|months`', examples: ['permanent', '2 days'] }),
    WhitelistApproval: obj({ identifier: str(), playerName: str(), playerAvatar: nullable(str()), approvedAt: epochMs(), approvedBy: str() }),
    WhitelistRequest: obj({
        id: str(), license: str(), playerDisplayName: str(), playerPureName: str(),
        discordTag: nullable(str()), discordAvatar: nullable(str()), lastAttemptAt: epochMs(),
    }),
    Admin: obj({ name: str(), master: bool(), permissions: arr(str()), identifiers: arr(str()) }),
    Resource: obj({ name: str(), status: str(), path: str(), version: nullable(str()), author: nullable(str()), description: nullable(str()) }),
    ServerControl: obj({
        action: enumOf(['start', 'stop', 'restart']),
        result: enumOf(['started', 'stopped', 'restarting', 'scheduled', 'noop']),
        message: str(),
    }),
    EventType: enumOf(API_EVENT_TYPES),
    Event: obj({
        id: str({ description: 'Monotonic id, usable as ?since= cursor' }),
        type: ref('EventType'),
        ts: epochMs(),
        data: { type: 'object', additionalProperties: true },
    }),
    EventsMeta: obj({ cursor: nullable(str()), hasMore: bool(), dropped: bool() }),
    Webhook: obj({
        id: str(), name: str(), url: str({ format: 'uri' }),
        events: { oneOf: [arr(ref('EventType')), { type: 'array', items: { const: '*' }, minItems: 1, maxItems: 1 }] },
        enabled: bool(), createdBy: str(), createdAt: epochMs(), deliveredCount: int(), failedCount: int(),
        lastDeliveryAt: nullable(epochMs()), lastDeliveryOk: nullable(bool()),
    }),
    WebhookCreate: obj({
        name: str({ maxLength: 48, pattern: '^[a-zA-Z0-9 _.-]+$' }),
        url: str({ format: 'uri', description: 'https URL that receives the POSTs (http only for localhost/private hosts)' }),
        events: arr(str({ description: 'Event type, or `*` for all' })),
        secret: str({ minLength: 16, maxLength: 128, description: 'HMAC secret; generated when omitted' }),
    }, ['name', 'url', 'events']),
    WebhookUpdate: obj({ enabled: bool(), events: arr(str()) }, []),
    WebhookDelivery: obj({
        id: str(), webhookId: str(), eventId: str(), eventType: ref('EventType'),
        status: enumOf(['pending', 'ok', 'failed']), attempts: int(), httpStatus: nullable(int()), error: nullable(str()),
        createdAt: epochMs(), lastAttemptAt: nullable(epochMs()), nextAttemptAt: nullable(epochMs()),
    }),
    WebhookPayload: obj({
        event: ref('Event'), webhookId: str(), deliveryId: str(), attempt: int(),
        server: obj({ name: str(), txAdminVersion: str() }),
    }),
};


const licenseParam = paramPath('license', str({ pattern: '^[0-9a-f]{40}$' }), 'Player license (40 hex chars)');
const reasonBody = (required: boolean) => obj({ reason: str({ maxLength: 2048 }) }, required ? ['reason'] : []);

//Created (201) or replayed (200) by externalRef
const importBanOp = op({
    tag: 'Moderation', summary: 'Import a system or legacy ban', permission: 'players.ban_import',
    description: 'Records a ban with its own author label and absolute expiry. Idempotent on `externalRef`: 201 when created, 200 with `created: false` and the existing action when it was already imported. Silent unless `notify` is true.',
    body: ref('ImportBan'), response: ref('ImportBanResult'), status: 201,
});
importBanOp.responses['200'] = jsonResp('Already imported', dataEnvelope(ref('ImportBanResult')));

const paths: Record<string, Schema> = {
    '/openapi.json': {
        get: op({ tag: 'Meta', summary: 'This document', permission: null, response: { type: 'object' } }),
    },
    '/docs': {
        get: {
            summary: 'Interactive docs',
            description: 'Swagger UI rendering of this document. No authentication.',
            tags: ['Meta'],
            security: [],
            responses: { '200': { description: 'HTML page', content: { 'text/html': { schema: { type: 'string' } } } } },
        },
    },
    '/me': {
        get: op({
            tag: 'Meta', summary: 'The calling key',
            response: obj({ key: ref('ApiKey'), txAdminVersion: str(), serverTime: epochMs() }),
        }),
    },
    '/mcp': {
        post: {
            summary: 'MCP endpoint for agents',
            description: 'Model Context Protocol over stateless Streamable HTTP (JSON-RPC in, JSON out; send `Accept: application/json, text/event-stream`). Each tool replays one route of this API with the same key, so it needs that route\'s scope; `tools/list` only shows the tools the key can use. Any valid key.',
            tags: ['Meta'],
            parameters: [{ $ref: '#/components/parameters/ActorId' }],
            requestBody: jsonBody({ type: 'object', description: 'JSON-RPC 2.0 message' }),
            responses: {
                '200': jsonResp('JSON-RPC response', { type: 'object' }),
                '202': { description: 'Notification accepted' },
                '401': errRef('Unauthorized'),
                '429': errRef('RateLimited'),
            },
        },
    },
    '/keys': {
        get: op({
            tag: 'Keys', summary: 'List API keys', permission: 'manage.admins',
            response: obj({ keys: arr(ref('ApiKey')), scopes: arr(ref('ApiScope')) }),
        }),
        post: op({
            tag: 'Keys', summary: 'Create an API key', permission: 'manage.admins', body: ref('ApiKeyCreate'), status: 201,
            response: obj({ key: ref('ApiKey'), token: str({ description: 'Plaintext token, shown once' }) }), errors: [409],
            description: 'Scopes come from the catalogue returned by GET /keys. A key with no scopes is read-only. The caller must hold the admin permission behind every scope it grants.',
        }),
    },
    '/keys/{id}': {
        patch: op({
            tag: 'Keys', summary: 'Change an API key\'s scopes', permission: 'manage.admins', params: [paramPath('id', str())],
            body: obj({ permissions: arr(str({ description: 'Scope id, see GET /keys. Empty = read-only key' })) }),
            response: obj({ key: ref('ApiKey') }), errors: [404, 409],
            description: 'Replaces the scopes; the token stays the same. The caller must hold the admin permission behind every scope it adds or removes. Revoked keys return 409.',
        }),
        delete: op({
            tag: 'Keys', summary: 'Revoke an API key', permission: 'manage.admins', params: [paramPath('id', str())],
            response: obj({ key: ref('ApiKey') }), errors: [404],
        }),
    },
    '/status': {
        get: op({ tag: 'Server', summary: 'Server and txAdmin status', response: ref('Status') }),
    },
    '/players': {
        get: op({
            tag: 'Players', summary: 'Search players',
            params: [
                paramQ('q', str({ maxLength: 256 })),
                paramQ('type', enumOf(['name', 'ids', 'notes']), 'What `q` matches (default name)'),
                paramQ('filter', str(), 'Comma separated: isAdmin, isOnline, isWhitelisted, hasNote'),
                paramQ('sort', enumOf(['playTime', 'tsJoined', 'tsLastConnection'])),
                ...paginationParams,
            ],
            response: obj({ players: arr(ref('PlayerSummary')) }), meta: ref('PageMeta'),
        }),
    },
    '/players/online': {
        get: op({ tag: 'Players', summary: 'Players online now', response: obj({ players: arr(ref('OnlinePlayer')) }) }),
    },
    '/players/stats': {
        get: op({ tag: 'Players', summary: 'Player counts', response: ref('PlayersStats') }),
    },
    '/players/{license}': {
        get: op({
            tag: 'Players', summary: 'Player detail with history', params: [licenseParam],
            response: obj({ player: ref('PlayerDetail') }), errors: [404],
        }),
    },
    '/players/{license}/ban': {
        post: op({
            tag: 'Moderation', summary: 'Ban a player', permission: 'players.ban', params: [licenseParam],
            body: obj({ reason: str({ maxLength: 2048 }), duration: ref('BanDuration') }),
            response: ref('ActionWrite'), errors: [404],
        }),
    },
    '/players/{license}/warn': {
        post: op({
            tag: 'Moderation', summary: 'Warn a player', permission: 'players.warn', params: [licenseParam],
            body: reasonBody(true), response: ref('ActionWrite'), errors: [404],
        }),
    },
    '/players/{license}/kick': {
        post: op({
            tag: 'Moderation', summary: 'Kick an online player', permission: 'players.kick', params: [licenseParam],
            body: reasonBody(false), bodyOptional: true, response: ref('Ok'), errors: [404, 503],
        }),
    },
    '/players/{license}/message': {
        post: op({
            tag: 'Moderation', summary: 'Direct message an online player', permission: 'players.direct_message', params: [licenseParam],
            body: obj({ message: str({ maxLength: 2048 }) }), response: ref('Ok'), errors: [404, 503],
        }),
    },
    '/players/{license}/whitelist': {
        put: op({
            tag: 'Whitelist', summary: 'Set player whitelist flag', permission: 'players.whitelist', params: [licenseParam],
            body: obj({ whitelisted: bool() }), response: ref('Ok'), errors: [404],
        }),
    },
    '/players/{license}/note': {
        put: op({
            tag: 'Players', summary: 'Set player note', permission: 'players.note', params: [licenseParam],
            body: obj({ note: str({ maxLength: 2048 }) }), response: ref('Ok'), errors: [404],
        }),
    },
    '/actions': {
        get: op({
            tag: 'Actions', summary: 'Search bans and warns',
            params: [
                paramQ('q', str({ maxLength: 256 })),
                paramQ('type', enumOf(['id', 'reason', 'name', 'ids']), 'What `q` matches (default ids); `name` is a fuzzy player name search'),
                paramQ('kind', enumOf(['ban', 'warn'])),
                paramQ('author', str()),
                paramQ('status', enumOf(['active', 'revoked'])),
                ...paginationParams,
            ],
            response: obj({ actions: arr(ref('Action')) }), meta: ref('PageMeta'),
        }),
    },
    '/actions/stats': {
        get: op({ tag: 'Actions', summary: 'Action counts', response: ref('ActionsStats') }),
    },
    '/actions/ban-identifiers': {
        post: op({
            tag: 'Moderation', summary: 'Ban raw identifiers', permission: 'players.ban',
            body: obj({ identifiers: arr(str()), reason: str({ maxLength: 2048 }), duration: ref('BanDuration') }),
            response: ref('ActionWrite'),
        }),
    },
    '/actions/import-ban': {
        post: importBanOp,
    },
    '/actions/{id}': {
        get: op({ tag: 'Actions', summary: 'Action detail', params: [paramPath('id', str())], response: obj({ action: ref('Action') }), errors: [404] }),
    },
    '/actions/{id}/revoke': {
        post: op({
            tag: 'Moderation', summary: 'Revoke a ban or warn', params: [paramPath('id', str())],
            response: obj({ action: ref('Action') }), errors: [403, 404, 409],
            permissionNote: 'Requires the `players.ban` scope for bans and the `players.warn` scope for warns; read-only keys are rejected.',
        }),
    },
    '/whitelist/approvals': {
        get: op({
            tag: 'Whitelist', summary: 'List whitelist approvals', params: [paramQ('q', str()), ...paginationParams],
            response: obj({ approvals: arr(ref('WhitelistApproval')) }), meta: ref('PageMeta'),
        }),
        post: op({
            tag: 'Whitelist', summary: 'Approve an identifier', permission: 'players.whitelist',
            body: obj({ identifier: str({ description: 'eg. discord:123456789012345678 or license:…' }) }),
            response: obj({ approval: ref('WhitelistApproval') }), status: 201, errors: [409],
        }),
    },
    '/whitelist/approvals/{identifier}': {
        delete: op({
            tag: 'Whitelist', summary: 'Remove an approval', permission: 'players.whitelist',
            params: [paramPath('identifier', str())], response: ref('Ok'), errors: [404],
        }),
    },
    '/whitelist/requests': {
        get: op({
            tag: 'Whitelist', summary: 'List pending whitelist requests', params: [paramQ('q', str()), ...paginationParams],
            response: obj({ requests: arr(ref('WhitelistRequest')) }), meta: ref('PageMeta'),
        }),
    },
    '/whitelist/requests/deny-all': {
        post: op({
            tag: 'Whitelist', summary: 'Deny all pending requests', permission: 'players.whitelist',
            body: obj({ before: epochMs('Only requests last attempted before this time') }, []), bodyOptional: true,
            response: obj({ removed: int() }),
        }),
    },
    '/whitelist/requests/{id}/approve': {
        post: op({
            tag: 'Whitelist', summary: 'Approve a request', permission: 'players.whitelist', params: [paramPath('id', str())],
            response: obj({ approval: ref('WhitelistApproval') }), status: 201, errors: [404, 409],
        }),
    },
    '/whitelist/requests/{id}/deny': {
        post: op({
            tag: 'Whitelist', summary: 'Deny a request', permission: 'players.whitelist', params: [paramPath('id', str())],
            response: ref('Ok'), errors: [404],
        }),
    },
    '/admins': {
        get: op({ tag: 'Admins', summary: 'Admin roster', permission: 'manage.admins', response: obj({ admins: arr(ref('Admin')) }) }),
    },
    '/resources': {
        get: op({ tag: 'Resources', summary: 'Resource list from the running server', response: obj({ resources: arr(ref('Resource')) }), errors: [503] }),
    },
    '/resources/refresh': {
        post: op({ tag: 'Resources', summary: 'Run `refresh`', permission: 'commands.resources', response: obj({ resource: { type: 'null' }, command: { const: 'refresh' } }), errors: [503] }),
    },
    '/resources/{name}/{command}': {
        post: op({
            tag: 'Resources', summary: 'Start, stop, restart or ensure a resource', permission: 'commands.resources',
            params: [paramPath('name', str()), paramPath('command', enumOf(['start', 'stop', 'restart', 'ensure']))],
            response: obj({ resource: str(), command: str() }), errors: [503],
        }),
    },
    '/server/announce': {
        post: op({ tag: 'Server', summary: 'Broadcast an announcement', permission: 'announcement', body: obj({ message: str({ maxLength: 1024 }) }), response: ref('Ok') }),
    },
    '/server/kick-all': {
        post: op({ tag: 'Server', summary: 'Kick everyone', permission: 'control.server', body: reasonBody(false), bodyOptional: true, response: ref('Ok'), errors: [503] }),
    },
    '/server/command': {
        post: op({ tag: 'Server', summary: 'Run a console command', permission: 'console.write', body: obj({ command: str({ maxLength: 4096 }) }), response: ref('Ok'), errors: [503] }),
    },
    '/server/{action}': {
        post: op({
            tag: 'Server', summary: 'Start, stop or restart the server', permission: 'control.server',
            params: [paramPath('action', enumOf(['start', 'stop', 'restart']))], response: ref('ServerControl'), errors: [409],
        }),
    },
    '/events': {
        get: op({
            tag: 'Events', summary: 'Poll recent events',
            params: [
                paramQ('since', str({ pattern: '^\\d{1,20}$' }), 'Event id to resume after (exclusive)'),
                paramQ('types', str(), 'Comma separated event types'),
                paramQ('limit', int({ minimum: 1, maximum: 500, default: 100 })),
            ],
            response: obj({ events: arr(ref('Event')) }), meta: ref('EventsMeta'),
            description: 'Ring buffer of the last 1000 events. `meta.dropped` is true when `since` is older than the buffer. `admin.login`, `apiKey.firstUse` and `webhook.test` are only returned to keys with `manage.admins`.',
        }),
    },
    '/events/types': {
        get: op({ tag: 'Events', summary: 'Event catalogue', response: obj({ types: arr(ref('EventType')) }) }),
    },
    '/webhooks': {
        get: op({ tag: 'Webhooks', summary: 'List webhooks', permission: 'manage.admins', response: obj({ webhooks: arr(ref('Webhook')), eventTypes: arr(ref('EventType')) }) }),
        post: op({
            tag: 'Webhooks', summary: 'Create a webhook', permission: 'manage.admins', body: ref('WebhookCreate'), status: 201,
            response: obj({ webhook: ref('Webhook'), secret: str({ description: 'HMAC secret, shown once' }) }), errors: [409],
            description: `At most ${API_WEBHOOKS_MAX} webhooks. Every delivery is a POST with \`X-TxAdmin-Signature: t=<ms>,v1=<hex hmac-sha256(secret, "<ms>.<body>")>\`.`,
        }),
    },
    '/webhooks/{id}': {
        patch: op({ tag: 'Webhooks', summary: 'Enable, disable or change events', permission: 'manage.admins', params: [paramPath('id', str())], body: ref('WebhookUpdate'), response: obj({ webhook: ref('Webhook') }), errors: [404] }),
        delete: op({ tag: 'Webhooks', summary: 'Delete a webhook', permission: 'manage.admins', params: [paramPath('id', str())], response: obj({ webhook: ref('Webhook') }), errors: [404] }),
    },
    '/webhooks/{id}/test': {
        post: op({ tag: 'Webhooks', summary: 'Send a `webhook.test` event', permission: 'manage.admins', params: [paramPath('id', str())], response: obj({ delivery: ref('WebhookDelivery') }), errors: [404] }),
    },
    '/webhooks/{id}/deliveries': {
        get: op({ tag: 'Webhooks', summary: 'Recent deliveries (last 50)', permission: 'manage.admins', params: [paramPath('id', str())], response: obj({ deliveries: arr(ref('WebhookDelivery')) }), errors: [404] }),
    },
};


export const buildOpenApiDocument = () => ({
    openapi: '3.1.0',
    info: {
        title: 'Everfall txAdmin API',
        version: OPENAPI_INFO_VERSION,
        description: 'Public HTTP API of the Everfall txAdmin fork. Bearer keys are created on the panel (System > API Keys) or via POST /keys. Timestamps are Unix epoch milliseconds. Every response is `{data}`, `{data, meta}` or `{error: {code, message, details?}}`.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ bearerAuth: [] }],
    tags: [
        { name: 'Meta' }, { name: 'Keys' }, { name: 'Server' }, { name: 'Players' }, { name: 'Moderation' },
        { name: 'Actions' }, { name: 'Whitelist' }, { name: 'Admins' }, { name: 'Resources' }, { name: 'Events' }, { name: 'Webhooks' },
    ],
    paths,
    components: {
        securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', description: 'txk_<id>.<secret>' },
        },
        parameters: {
            ActorId: {
                name: 'X-TxAdmin-Actor-Id',
                in: 'header',
                required: false,
                description: 'Staff member the key acts for: `discord:<id>` or `fivem:<id>`, prefix case-insensitive (needs the `api.actor` scope). It must match the linked account of a txAdmin admin, otherwise 403 (`details.reason: actor_not_admin`). The request is then limited to the key scopes whose backing txAdmin permission that admin holds (403 `actor_lacks_permission` otherwise) and recorded as `<txAdmin admin name> (via api:<key name>)`.',
                schema: { type: 'string', pattern: '^\\s*([Dd][Ii][Ss][Cc][Oo][Rr][Dd]:\\d{17,20}|[Ff][Ii][Vv][Ee][Mm]:\\d{1,20})\\s*$' },
            },
        },
        responses,
        schemas,
    },
    webhooks: {
        event: {
            post: {
                summary: 'Event delivery',
                description: 'Sent to every subscribed webhook. Verify `X-TxAdmin-Signature` (t=<ms>,v1=<hex>) by computing hmac-sha256(secret, `${t}.${rawBody}`) and reject timestamps older than 5 minutes. Respond 2xx within 5 s; anything else is retried after 10 s, 1 min, 10 min and 1 h.',
                requestBody: jsonBody(ref('WebhookPayload')),
                responses: { '2XX': { description: 'Delivered' } },
            },
        },
    },
});
