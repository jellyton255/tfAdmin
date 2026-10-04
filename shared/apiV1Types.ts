/**
 * Types for the Everfall public API (/api/v1) and its key management.
 * Shared between core (routes + ApiServer module) and the panel (API Keys page).
 */

//Error codes returned inside the `error.code` field of the envelope
export const API_ERROR_CODES = [
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'VALIDATION_ERROR',
    'RATE_LIMITED',
    'CONFLICT',
    'SERVER_OFFLINE',
    'PLAYER_OFFLINE',
    'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = typeof API_ERROR_CODES[number];

export type ApiErrorBody = {
    error: {
        code: ApiErrorCode;
        message: string;
        details?: unknown;
    };
};
export type ApiDataBody<T, M = undefined> = M extends undefined
    ? { data: T }
    : { data: T; meta: M };
export type ApiResp<T, M = undefined> = ApiDataBody<T, M> | ApiErrorBody;


/**
 * API key records
 */
export const API_KEY_PREFIX = 'txk';
export const API_KEY_NAME_MAX_LENGTH = 48;
export const API_KEY_ALLOWED_IPS_MAX = 32;

//As stored on disk (secret is hashed) and as returned to clients (no hash)
export type ApiKeyPublicRecord = {
    id: string;
    name: string;
    permissions: string[];
    createdBy: string;
    createdAt: number; //epoch ms
    lastUsedAt: number | null; //epoch ms
    expiresAt: number | null; //epoch ms
    allowedIps: string[]; //CIDR or plain IPs, empty = any
    revokedAt: number | null; //epoch ms
    revokedBy: string | null;
};

export type ApiKeyCreateReq = {
    name: string;
    permissions: string[];
    expiresAt?: number | null;
    allowedIps?: string[];
};

export type ApiKeyCreateResp = ApiResp<{
    key: ApiKeyPublicRecord;
    /** Plaintext token, shown exactly once. */
    token: string;
}>;

export type ApiKeyListResp = ApiResp<{
    keys: ApiKeyPublicRecord[];
    /** Permission id -> human description, for the panel checkboxes. */
    permissions: Record<string, string>;
}>;

export type ApiKeyRevokeResp = ApiResp<{ key: ApiKeyPublicRecord }>;

export type ApiMeResp = ApiResp<{
    key: ApiKeyPublicRecord;
    txAdminVersion: string;
    serverTime: number;
}>;


/**
 * Pagination (cursor based, used by list endpoints)
 */
export const API_PAGE_DEFAULT_LIMIT = 50;
export const API_PAGE_MAX_LIMIT = 200;
export type ApiPageMeta = {
    limit: number;
    /** Pass as `?cursor=` to get the next page, null when the list ended. */
    nextCursor: string | null;
};


/**
 * GET /status
 */
export type ApiStatusResp = ApiResp<{
    txAdmin: {
        version: string;
        configState: string;
        serverTime: number; //epoch ms
    };
    server: {
        name: string;
        health: 'OFFLINE' | 'ONLINE' | 'PARTIAL';
        healthReason: string;
        uptime: number; //ms since the server booted, 0 when offline
        isProcessAlive: boolean;
        isRunnerIdle: boolean;
        whitelistMode: 'disabled' | 'adminOnly' | 'approvedLicense' | 'discordMember' | 'discordRoles';
        playerCount: number;
        playerSlots: number | null;
        projectName: string | null;
        projectDesc: string | null;
        gameName: 'fivem' | 'redm' | null;
        cfxId: string | null;
        joinLink: string | null;
    };
    scheduler: {
        nextRestartAt: number | null; //epoch ms
        nextSkip: boolean;
        nextIsTemp: boolean;
    };
    discord: {
        status: 'disabled' | 'starting' | 'ready' | 'error';
    };
}>;


/**
 * Players
 */
export type ApiOnlinePlayer = {
    netid: number;
    displayName: string;
    pureName: string;
    license: string | null;
};
export type ApiOnlinePlayersResp = ApiResp<{ players: ApiOnlinePlayer[] }>;

export type ApiPlayerSummary = {
    license: string;
    displayName: string;
    pureName: string;
    playTime: number; //minutes
    joinedAt: number; //epoch ms
    lastConnectionAt: number; //epoch ms
    whitelistedAt: number | null; //epoch ms
    notes: string | null;
    isAdmin: boolean;
    isOnline: boolean;
};
export type ApiPlayerSearchResp = ApiResp<{ players: ApiPlayerSummary[] }, ApiPageMeta>;

export type ApiPlayerDetail = ApiPlayerSummary & {
    ids: string[];
    hwids: string[];
    notesLastEditedBy: string | null;
    notesLastEditedAt: number | null; //epoch ms
    /** Only when the player is online right now. */
    session: {
        netid: number;
        connectedAt: number; //epoch ms
        idsOnline: string[];
        hwidsOnline: string[];
    } | null;
    actions: ApiActionRecord[];
};
export type ApiPlayerDetailResp = ApiResp<{ player: ApiPlayerDetail }>;

export type ApiPlayersStatsResp = ApiResp<{
    total: number;
    playedLast24h: number;
    joinedLast24h: number;
    joinedLast7d: number;
    onlineNow: number;
}>;


/**
 * Actions (bans and warns)
 */
export type ApiActionRecord = {
    id: string;
    type: 'ban' | 'warn';
    playerName: string | null;
    ids: string[];
    hwids: string[];
    reason: string;
    author: string;
    createdAt: number; //epoch ms
    /** Bans only: null = permanent. Warns: always null. */
    expiresAt: number | null;
    /** Bans only: 'active' | 'expired' | 'permanent'; warns: null */
    banStatus: 'active' | 'expired' | 'permanent' | null;
    /** Warns only */
    acked: boolean | null;
    revokedAt: number | null; //epoch ms
    revokedBy: string | null;
};
export type ApiActionsSearchResp = ApiResp<{ actions: ApiActionRecord[] }, ApiPageMeta>;
export type ApiActionDetailResp = ApiResp<{ action: ApiActionRecord }>;
export type ApiActionsStatsResp = ApiResp<{
    totalWarns: number;
    warnsLast7d: number;
    totalBans: number;
    bansLast7d: number;
    byAdmin: { name: string; actions: number }[];
}>;


/**
 * Whitelist
 */
export type ApiWhitelistApproval = {
    identifier: string;
    playerName: string;
    playerAvatar: string | null;
    approvedAt: number; //epoch ms
    approvedBy: string;
};
export type ApiWhitelistRequest = {
    id: string;
    license: string;
    playerDisplayName: string;
    playerPureName: string;
    discordTag: string | null;
    discordAvatar: string | null;
    lastAttemptAt: number; //epoch ms
};
export type ApiWhitelistApprovalsResp = ApiResp<{ approvals: ApiWhitelistApproval[] }, ApiPageMeta>;
export type ApiWhitelistRequestsResp = ApiResp<{ requests: ApiWhitelistRequest[] }, ApiPageMeta>;


/**
 * Admins
 */
export type ApiAdminRecord = {
    name: string;
    master: boolean;
    permissions: string[];
    identifiers: string[]; //citizenfx / discord identifiers
};
export type ApiAdminsResp = ApiResp<{ admins: ApiAdminRecord[] }>;


/**
 * Resources
 */
export type ApiResourceRecord = {
    name: string;
    status: string;
    path: string;
    version: string | null;
    author: string | null;
    description: string | null;
};
export type ApiResourcesResp = ApiResp<{ resources: ApiResourceRecord[] }>;


/**
 * Writes (phase 3)
 */
/** Ban duration: 'permanent' or '<n> hours|days|weeks|months', like the panel. */
export type ApiBanDuration = string;

export type ApiBanPlayerReq = { reason: string; duration: ApiBanDuration };
export type ApiWarnPlayerReq = { reason: string };
export type ApiKickPlayerReq = { reason?: string };
export type ApiMessagePlayerReq = { message: string };
export type ApiSetWhitelistReq = { whitelisted: boolean };
export type ApiSetNoteReq = { note: string };
export type ApiBanIdsReq = { identifiers: string[]; reason: string; duration: ApiBanDuration };

export type ApiActionWriteResp = ApiResp<{
    action: ApiActionRecord;
    /** false when the action was saved but the in-game event could not be sent (server offline or stdin error). */
    eventSent: boolean;
}>;
export type ApiOkResp = ApiResp<{ ok: true }>;
export type ApiWhitelistApprovalResp = ApiResp<{ approval: ApiWhitelistApproval }>;
export type ApiWhitelistRequestsResolvedResp = ApiResp<{ removed: number }>;

export type ApiServerControlResp = ApiResp<{
    action: 'start' | 'stop' | 'restart';
    /** What happened: started, stopped, restarting, scheduled (restart delayed by the spawn backoff) or noop. */
    result: 'started' | 'stopped' | 'restarting' | 'scheduled' | 'noop';
    message: string;
}>;
export type ApiServerCommandReq = { command: string };
export type ApiAnnounceReq = { message: string };
export type ApiKickAllReq = { reason?: string };
export type ApiResourceCommandResp = ApiResp<{ resource: string | null; command: string }>;


/**
 * Phase 4: events and webhooks
 */
export const API_EVENT_TYPES = [
    'server.online',
    'server.partial',
    'server.offline',
    'server.shuttingDown',
    'server.scheduledRestart',
    'server.scheduledRestartSkipped',
    'server.nextRestartSkipped',
    'server.announcement',
    'server.configChanged',
    'player.joined',
    'player.left',
    'player.banned',
    'player.warned',
    'player.kicked',
    'player.directMessage',
    'whitelist.player',
    'whitelist.preApproval',
    'whitelist.request',
    'action.revoked',
    'apiKey.firstUse',
    'webhook.test',
] as const;
export type ApiEventType = typeof API_EVENT_TYPES[number];

export const API_EVENTS_BUFFER_SIZE = 1000;
export const API_EVENTS_PAGE_MAX = 500;

export type ApiEvent = {
    id: string; //monotonic, usable as a cursor
    type: ApiEventType;
    ts: number; //epoch ms
    data: Record<string, unknown>;
};
export type ApiEventsMeta = {
    cursor: string | null; //id of the last event returned, pass as ?since=
    hasMore: boolean;
    dropped: boolean; //true when ?since= points before the buffer start (events were lost)
};
export type ApiEventsResp = ApiResp<{ events: ApiEvent[] }, ApiEventsMeta>;
export type ApiEventTypesResp = ApiResp<{ types: ApiEventType[] }>;

export const API_WEBHOOKS_MAX = 10;
export const API_WEBHOOK_NAME_MAX_LENGTH = 48;
export const API_WEBHOOK_URL_MAX_LENGTH = 512;
export const API_WEBHOOK_SECRET_MIN_LENGTH = 16;
export const API_WEBHOOK_SECRET_MAX_LENGTH = 128;
export const API_WEBHOOK_SIGNATURE_HEADER = 'x-txadmin-signature';
export const API_WEBHOOK_DELIVERIES_KEPT = 50;

export type ApiWebhookRecord = {
    id: string;
    name: string;
    url: string;
    events: ApiEventType[] | ['*'];
    enabled: boolean;
    createdBy: string;
    createdAt: number;
    deliveredCount: number;
    failedCount: number;
    lastDeliveryAt: number | null;
    lastDeliveryOk: boolean | null;
};
export type ApiWebhookCreateReq = {
    name: string;
    url: string;
    events: string[]; //event types, or ['*'] for everything
    secret?: string; //generated when omitted
};
export type ApiWebhookUpdateReq = {
    enabled?: boolean;
    events?: string[];
};
export type ApiWebhookCreateResp = ApiResp<{
    webhook: ApiWebhookRecord;
    secret: string; //shown once
}>;
export type ApiWebhooksListResp = ApiResp<{
    webhooks: ApiWebhookRecord[];
    eventTypes: ApiEventType[];
}>;
export type ApiWebhookResp = ApiResp<{ webhook: ApiWebhookRecord }>;

export type ApiWebhookDeliveryStatus = 'pending' | 'ok' | 'failed';
export type ApiWebhookDelivery = {
    id: string;
    webhookId: string;
    eventId: string;
    eventType: ApiEventType;
    status: ApiWebhookDeliveryStatus;
    attempts: number;
    httpStatus: number | null;
    error: string | null;
    createdAt: number;
    lastAttemptAt: number | null;
    nextAttemptAt: number | null;
};
export type ApiWebhookDeliveriesResp = ApiResp<{ deliveries: ApiWebhookDelivery[] }>;
export type ApiWebhookTestResp = ApiResp<{ delivery: ApiWebhookDelivery }>;

/** Body of every webhook POST. Signature header: `t=<ts>,v1=<hex hmac-sha256 of "<ts>.<body>">`. */
export type ApiWebhookPayload = {
    event: ApiEvent;
    webhookId: string;
    deliveryId: string;
    attempt: number;
    server: { name: string; txAdminVersion: string };
};
