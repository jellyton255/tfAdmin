/**
 * @everfall/txadmin-client
 * Thin typed wrapper over the Everfall txAdmin API (/api/v1). Uses the global fetch, so it runs
 * on Node 18+, Bun, Deno, Cloudflare Workers and browsers (the key must never ship to a browser).
 */
import type {
    ApiActionDetailResp,
    ApiActionWriteResp,
    ApiActionsSearchResp,
    ApiActionsStatsResp,
    ApiAdminsResp,
    ApiAnnounceReq,
    ApiBanIdsReq,
    ApiBanPlayerReq,
    ApiDataBody,
    ApiErrorBody,
    ApiErrorCode,
    ApiEventType,
    ApiEventTypesResp,
    ApiEventsResp,
    ApiKeyCreateReq,
    ApiKeyCreateResp,
    ApiKeyListResp,
    ApiKeyRevokeResp,
    ApiKickAllReq,
    ApiKickPlayerReq,
    ApiMeResp,
    ApiMessagePlayerReq,
    ApiOkResp,
    ApiOnlinePlayersResp,
    ApiPlayerDetailResp,
    ApiPlayerSearchResp,
    ApiPlayersStatsResp,
    ApiResourceCommandResp,
    ApiResourcesResp,
    ApiResp,
    ApiServerCommandReq,
    ApiServerControlResp,
    ApiSetNoteReq,
    ApiSetWhitelistReq,
    ApiStatusResp,
    ApiWarnPlayerReq,
    ApiWebhookCreateReq,
    ApiWebhookCreateResp,
    ApiWebhookDeliveriesResp,
    ApiWebhookPayload,
    ApiWebhookResp,
    ApiWebhookTestResp,
    ApiWebhookUpdateReq,
    ApiWebhooksListResp,
    ApiWhitelistApprovalResp,
    ApiWhitelistApprovalsResp,
    ApiWhitelistRequestsResolvedResp,
    ApiWhitelistRequestsResp,
} from '../../shared/apiV1Types';

export type * from '../../shared/apiV1Types';


/**
 * Thrown for every non-2xx response. `code` is the API error code, `status` the HTTP status.
 */
export class TxAdminApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: ApiErrorCode | 'NETWORK_ERROR',
        message: string,
        public readonly details?: unknown,
        public readonly requestId?: string | null,
        /** Seconds to wait, only on 429. */
        public readonly retryAfterSec?: number | null,
    ) {
        super(message);
        this.name = 'TxAdminApiError';
    }
}

export type TxAdminClientOptions = {
    /** txAdmin origin, eg. https://admin.example.com (no trailing /api/v1). */
    baseUrl: string;
    /** Bearer key (txk_<id>.<secret>). */
    apiKey: string;
    /** Override the fetch implementation (tests, custom agents). */
    fetch?: typeof fetch;
    /** Per-request timeout in ms (default 15000). */
    timeoutMs?: number;
    /** Extra headers sent with every request. */
    headers?: Record<string, string>;
};

type Query = Record<string, string | number | boolean | undefined | null>;
//Structural on purpose: inferring through the ApiDataBody conditional alias resolves to never under TypeScript 7.
type Unwrap<R> = R extends { data: infer T; meta: infer M } ? { data: T; meta: M } : R extends { data: infer T } ? T : never;
type Data<R> = Unwrap<Exclude<R, ApiErrorBody>>;

export type PlayerSearchQuery = {
    q?: string;
    type?: 'name' | 'ids' | 'notes';
    filter?: ('isAdmin' | 'isOnline' | 'isWhitelisted' | 'hasNote')[];
    sort?: 'playTime' | 'tsJoined' | 'tsLastConnection';
    order?: 'asc' | 'desc';
    limit?: number;
    cursor?: string;
};
export type ActionSearchQuery = {
    q?: string;
    type?: 'id' | 'reason' | 'ids';
    kind?: 'ban' | 'warn';
    author?: string;
    status?: 'active' | 'revoked';
    order?: 'asc' | 'desc';
    limit?: number;
    cursor?: string;
};
export type ListQuery = { q?: string; order?: 'asc' | 'desc'; limit?: number; cursor?: string };
export type EventsQuery = { since?: string; types?: ApiEventType[]; limit?: number };


export class TxAdminClient {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;
    private readonly extraHeaders: Record<string, string>;

    constructor(options: TxAdminClientOptions) {
        if (!options.baseUrl) throw new Error('baseUrl is required');
        if (!options.apiKey) throw new Error('apiKey is required');
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.apiKey = options.apiKey;
        this.fetchImpl = options.fetch ?? globalThis.fetch;
        this.timeoutMs = options.timeoutMs ?? 15_000;
        this.extraHeaders = options.headers ?? {};
        if (typeof this.fetchImpl !== 'function') throw new Error('No fetch implementation available; pass options.fetch');
    }


    /**
     * Low-level request. Resolves with `data` (or `{data, meta}` for paginated routes), rejects with TxAdminApiError.
     */
    async request<R extends ApiResp<any, any>>(method: string, path: string, options: { query?: Query; body?: unknown; signal?: AbortSignal } = {}): Promise<Data<R>> {
        const url = new URL(`${this.baseUrl}/api/v1${path}`);
        for (const [key, value] of Object.entries(options.query ?? {})) {
            if (value === undefined || value === null || value === '') continue;
            url.searchParams.set(key, String(value));
        }
        const headers: Record<string, string> = {
            authorization: `Bearer ${this.apiKey}`,
            accept: 'application/json',
            ...this.extraHeaders,
        };
        if (options.body !== undefined) headers['content-type'] = 'application/json';

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
        const onOuterAbort = () => controller?.abort();
        options.signal?.addEventListener('abort', onOuterAbort, { once: true });
        let resp: Response;
        try {
            resp = await this.fetchImpl(url.toString(), {
                method,
                headers,
                body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
                signal: controller?.signal,
            });
        } catch (error) {
            throw new TxAdminApiError(0, 'NETWORK_ERROR', (error as Error).message);
        } finally {
            if (timer) clearTimeout(timer);
            options.signal?.removeEventListener('abort', onOuterAbort);
        }

        const requestId = resp.headers.get('x-request-id');
        let parsed: any = null;
        const text = await resp.text();
        if (text) {
            try {
                parsed = JSON.parse(text);
            } catch {
                throw new TxAdminApiError(resp.status, 'INTERNAL_ERROR', `Non-JSON response (HTTP ${resp.status})`, text.slice(0, 200), requestId);
            }
        }
        if (!resp.ok || !parsed || 'error' in parsed) {
            const err = parsed?.error ?? {};
            const retryAfter = resp.headers.get('retry-after');
            throw new TxAdminApiError(
                resp.status,
                err.code ?? 'INTERNAL_ERROR',
                err.message ?? `HTTP ${resp.status}`,
                err.details,
                requestId,
                retryAfter ? Number(retryAfter) : null,
            );
        }
        return ('meta' in parsed ? { data: parsed.data, meta: parsed.meta } : parsed.data) as Data<R>;
    }

    private get<R extends ApiResp<any, any>>(path: string, query?: Query) { return this.request<R>('GET', path, { query }); }
    private post<R extends ApiResp<any, any>>(path: string, body?: unknown) { return this.request<R>('POST', path, { body }); }
    private put<R extends ApiResp<any, any>>(path: string, body?: unknown) { return this.request<R>('PUT', path, { body }); }
    private patch<R extends ApiResp<any, any>>(path: string, body?: unknown) { return this.request<R>('PATCH', path, { body }); }
    private delete<R extends ApiResp<any, any>>(path: string) { return this.request<R>('DELETE', path); }


    //MARK: Meta & keys
    me() { return this.get<ApiMeResp>('/me'); }
    status() { return this.get<ApiStatusResp>('/status'); }
    keys = {
        list: () => this.get<ApiKeyListResp>('/keys'),
        create: (input: ApiKeyCreateReq) => this.post<ApiKeyCreateResp>('/keys', input),
        revoke: (id: string) => this.delete<ApiKeyRevokeResp>(`/keys/${encodeURIComponent(id)}`),
    };

    //MARK: Players
    players = {
        online: () => this.get<ApiOnlinePlayersResp>('/players/online'),
        stats: () => this.get<ApiPlayersStatsResp>('/players/stats'),
        search: (query: PlayerSearchQuery = {}) => this.get<ApiPlayerSearchResp>('/players', { ...query, filter: query.filter?.join(',') }),
        get: (license: string) => this.get<ApiPlayerDetailResp>(`/players/${encodeURIComponent(license)}`),
        ban: (license: string, input: ApiBanPlayerReq) => this.post<ApiActionWriteResp>(`/players/${encodeURIComponent(license)}/ban`, input),
        warn: (license: string, input: ApiWarnPlayerReq) => this.post<ApiActionWriteResp>(`/players/${encodeURIComponent(license)}/warn`, input),
        kick: (license: string, input: ApiKickPlayerReq = {}) => this.post<ApiOkResp>(`/players/${encodeURIComponent(license)}/kick`, input),
        message: (license: string, input: ApiMessagePlayerReq) => this.post<ApiOkResp>(`/players/${encodeURIComponent(license)}/message`, input),
        setWhitelist: (license: string, input: ApiSetWhitelistReq) => this.put<ApiOkResp>(`/players/${encodeURIComponent(license)}/whitelist`, input),
        setNote: (license: string, input: ApiSetNoteReq) => this.put<ApiOkResp>(`/players/${encodeURIComponent(license)}/note`, input),
    };

    //MARK: Actions
    actions = {
        search: (query: ActionSearchQuery = {}) => this.get<ApiActionsSearchResp>('/actions', query),
        stats: () => this.get<ApiActionsStatsResp>('/actions/stats'),
        get: (id: string) => this.get<ApiActionDetailResp>(`/actions/${encodeURIComponent(id)}`),
        banIdentifiers: (input: ApiBanIdsReq) => this.post<ApiActionWriteResp>('/actions/ban-identifiers', input),
        revoke: (id: string) => this.post<ApiActionDetailResp>(`/actions/${encodeURIComponent(id)}/revoke`),
    };

    //MARK: Whitelist
    whitelist = {
        approvals: (query: ListQuery = {}) => this.get<ApiWhitelistApprovalsResp>('/whitelist/approvals', query),
        requests: (query: ListQuery = {}) => this.get<ApiWhitelistRequestsResp>('/whitelist/requests', query),
        addApproval: (identifier: string) => this.post<ApiWhitelistApprovalResp>('/whitelist/approvals', { identifier }),
        removeApproval: (identifier: string) => this.delete<ApiOkResp>(`/whitelist/approvals/${encodeURIComponent(identifier)}`),
        approveRequest: (id: string) => this.post<ApiWhitelistApprovalResp>(`/whitelist/requests/${encodeURIComponent(id)}/approve`),
        denyRequest: (id: string) => this.post<ApiOkResp>(`/whitelist/requests/${encodeURIComponent(id)}/deny`),
        denyAllRequests: (before?: number) => this.post<ApiWhitelistRequestsResolvedResp>('/whitelist/requests/deny-all', before ? { before } : {}),
    };

    //MARK: Server, admins, resources
    admins = {
        list: () => this.get<ApiAdminsResp>('/admins'),
    };
    server = {
        start: () => this.post<ApiServerControlResp>('/server/start'),
        stop: () => this.post<ApiServerControlResp>('/server/stop'),
        restart: () => this.post<ApiServerControlResp>('/server/restart'),
        announce: (input: ApiAnnounceReq) => this.post<ApiOkResp>('/server/announce', input),
        kickAll: (input: ApiKickAllReq = {}) => this.post<ApiOkResp>('/server/kick-all', input),
        command: (input: ApiServerCommandReq) => this.post<ApiOkResp>('/server/command', input),
    };
    resources = {
        list: () => this.get<ApiResourcesResp>('/resources'),
        refresh: () => this.post<ApiResourceCommandResp>('/resources/refresh'),
        command: (name: string, command: 'start' | 'stop' | 'restart' | 'ensure') =>
            this.post<ApiResourceCommandResp>(`/resources/${encodeURIComponent(name)}/${command}`),
    };

    //MARK: Events & webhooks
    events = {
        types: () => this.get<ApiEventTypesResp>('/events/types'),
        list: (query: EventsQuery = {}) => this.get<ApiEventsResp>('/events', { ...query, types: query.types?.join(',') }),
        /**
         * Async iterator that polls GET /events forever (or until `signal` aborts), yielding each event once.
         * `onDropped` fires when the buffer wrapped before we polled, so events were lost.
         */
        poll: (options: { types?: ApiEventType[]; intervalMs?: number; since?: string; signal?: AbortSignal; onDropped?: () => void } = {}) =>
            this.pollEvents(options),
    };
    webhooks = {
        list: () => this.get<ApiWebhooksListResp>('/webhooks'),
        create: (input: ApiWebhookCreateReq) => this.post<ApiWebhookCreateResp>('/webhooks', input),
        update: (id: string, input: ApiWebhookUpdateReq) => this.patch<ApiWebhookResp>(`/webhooks/${encodeURIComponent(id)}`, input),
        remove: (id: string) => this.delete<ApiWebhookResp>(`/webhooks/${encodeURIComponent(id)}`),
        test: (id: string) => this.post<ApiWebhookTestResp>(`/webhooks/${encodeURIComponent(id)}/test`),
        deliveries: (id: string) => this.get<ApiWebhookDeliveriesResp>(`/webhooks/${encodeURIComponent(id)}/deliveries`),
    };

    private async *pollEvents(options: { types?: ApiEventType[]; intervalMs?: number; since?: string; signal?: AbortSignal; onDropped?: () => void }) {
        const intervalMs = options.intervalMs ?? 5_000;
        const { signal } = options;
        const list = (since?: string) => this.request<ApiEventsResp>('GET', '/events', {
            query: { since, types: options.types?.join(','), limit: 500 },
            signal,
        });
        let since = options.since;
        if (since === undefined) {
            //start from "now": drain the buffer to its head without yielding history
            let head = await list();
            while (head.meta.hasMore && !signal?.aborted) {
                head = await list(head.meta.cursor ?? undefined);
            }
            since = head.meta.cursor ?? undefined;
        }
        while (!signal?.aborted) {
            const page = await list(since);
            if (page.meta.dropped) options.onDropped?.();
            for (const event of page.data.events) yield event;
            if (page.meta.cursor) since = page.meta.cursor;
            if (!page.meta.hasMore) {
                await new Promise<void>((resolve) => {
                    const onAbort = () => { clearTimeout(t); resolve(); };
                    const t = setTimeout(() => {
                        signal?.removeEventListener('abort', onAbort);
                        resolve();
                    }, intervalMs);
                    signal?.addEventListener('abort', onAbort, { once: true });
                });
            }
        }
    }
}


//MARK: Webhook receiving helpers
const encoder = new TextEncoder();
const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const timingSafeEqualHex = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
};

/**
 * Verifies the `X-TxAdmin-Signature` header (`t=<ms>,v1=<hex>`) against the raw request body.
 * Uses WebCrypto, so it is async. Rejects signatures older than `toleranceMs` (default 5 min).
 */
export async function verifyWebhookSignature(
    secret: string,
    signatureHeader: string | null | undefined,
    rawBody: string | Uint8Array,
    options: { nowMs?: number; toleranceMs?: number } = {},
): Promise<boolean> {
    if (!signatureHeader) return false;
    const parts = Object.fromEntries(signatureHeader.split(',').map((kv) => kv.split('=') as [string, string]));
    const ts = Number(parts.t);
    if (!Number.isFinite(ts) || typeof parts.v1 !== 'string') return false;
    const now = options.nowMs ?? Date.now();
    if (Math.abs(now - ts) > (options.toleranceMs ?? 5 * 60_000)) return false;
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('WebCrypto (crypto.subtle) is not available in this runtime');
    const key = await subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bodyBytes = typeof rawBody === 'string' ? encoder.encode(rawBody) : rawBody;
    const prefix = encoder.encode(`${ts}.`);
    const message = new Uint8Array(prefix.length + bodyBytes.length);
    message.set(prefix, 0);
    message.set(bodyBytes, prefix.length);
    const expected = toHex(await subtle.sign('HMAC', key, message));
    return timingSafeEqualHex(expected, parts.v1.toLowerCase());
}

/**
 * Verifies and parses a webhook request in one go. Throws on a bad signature.
 */
export async function parseWebhookRequest(
    secret: string,
    signatureHeader: string | null | undefined,
    rawBody: string,
    options?: { nowMs?: number; toleranceMs?: number },
): Promise<ApiWebhookPayload> {
    if (!(await verifyWebhookSignature(secret, signatureHeader, rawBody, options))) {
        throw new Error('Invalid webhook signature');
    }
    return JSON.parse(rawBody) as ApiWebhookPayload;
}

export const WEBHOOK_SIGNATURE_HEADER = 'x-txadmin-signature';
export default TxAdminClient;
