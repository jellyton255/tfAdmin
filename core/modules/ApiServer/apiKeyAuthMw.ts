const modulename = 'ApiServer:AuthMw';
import type { Next } from 'koa';
import consoleFactory from '@lib/console';
import { AuthedAdmin } from '@modules/WebServer/authLogic';
import type { InitializedCtx } from '@modules/WebServer/ctxTypes';
import { sendError } from './envelope';
import type { StoredApiKey } from './ApiKeyStore';
const console = consoleFactory(modulename);

//Scopes whose actions get the stricter rate-limit bucket
const HEAVY_PERMISSIONS = new Set(['control.server', 'console.write', 'commands.resources']);

export type ApiKeyCtx = InitializedCtx & {
    admin: AuthedAdmin;
    apiKey: StoredApiKey;
    params: any;
    request: any;
};

//Header naming the staff member a consumer is acting for (needs the api.actor scope)
export const ACTOR_HEADER = 'x-txadmin-actor';
export const ACTOR_ID_HEADER = 'x-txadmin-actor-id';
export const ACTOR_SCOPE = 'api.actor';
const ACTOR_ID_PATTERN = /^(discord:\d{17,20}|fivem:\d{1,20})$/;
const ACTOR_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.'#@-]{0,47}$/u;

/**
 * Validates an X-TxAdmin-Actor value. Returns the trimmed name, or null if it is not acceptable.
 * Kept to letters, digits and a few separators so it can't spoof the "(via api:...)" suffix or break log lines.
 */
export const parseActor = (raw: string) => {
    const actor = raw.trim();
    return ACTOR_PATTERN.test(actor) ? actor : null;
};

/**
 * Validates an X-TxAdmin-Actor-Id value (`discord:<snowflake>` or `fivem:<id>`), lowercased, or null.
 */
export const parseActorId = (raw: string) => {
    const id = raw.trim().toLowerCase();
    return ACTOR_ID_PATTERN.test(id) ? id : null;
};

/**
 * Builds the attribution label for a request that names a staff member.
 * A stable id that matches a txAdmin admin's linked Discord/FiveM account resolves to that admin's
 * txAdmin name, so renames on the consumer side don't split the record. An unmatched id is kept
 * next to the display name so the record still points at one person.
 */
export const resolveActorLabel = (name: string | undefined, id: string | undefined) => {
    if (id) {
        const admin = txCore.adminStore.getAdminByIdentifiers([id]);
        if (admin && typeof admin.name === 'string') return admin.name as string;
        return name ? `${name} [${id}]` : id;
    }
    return name;
};

const REJECT_MESSAGES: Record<string, string> = {
    malformed: 'Malformed API key.',
    unknown_key: 'Unknown API key.',
    bad_secret: 'Invalid API key.',
    revoked: 'This API key has been revoked.',
    expired: 'This API key has expired.',
    ip_not_allowed: 'This API key cannot be used from your IP address.',
};


/**
 * Builds the principal used as ctx.admin for API key requests.
 * It is a regular AuthedAdmin named `api:<keyName>`, so every existing permission check
 * and admin log line works unchanged and the action log attributes writes to the key.
 * With an actor (X-TxAdmin-Actor / X-TxAdmin-Actor-Id) the name becomes `<actor> (via api:<keyName>)`,
 * so the record shows the staff member and still names the key.
 */
export const buildApiKeyPrincipal = (key: StoredApiKey, actor?: string) => {
    return new AuthedAdmin({
        name: actor ? `${actor} (via api:${key.name})` : `api:${key.name}`,
        master: false,
        permissions: key.permissions,
    });
};


/**
 * Auth middleware factory for /api/v1 routes.
 * - Bearer token only, never cookies/sessions/CSRF
 * - optional `requiredPermission` (a scope id) checked before the handler runs
 */
export const apiKeyAuthMw = (requiredPermission?: string) => {
    return async (ctx: InitializedCtx, next: Next) => {
        const header = ctx.headers['authorization'];
        if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) {
            ctx.set('WWW-Authenticate', 'Bearer realm="txAdmin API"');
            return sendError(ctx, 401, 'UNAUTHORIZED', 'Missing bearer token.');
        }
        const token = header.slice(7).trim();

        const result = txCore.apiServer.keyStore.verify(token, ctx.txVars.realIP);
        if (!result.success) {
            console.verbose.warn(`Rejected API request (${result.reason}) from ${ctx.txVars.realIP} to ${ctx.path}`);
            ctx.set('WWW-Authenticate', 'Bearer realm="txAdmin API", error="invalid_token"');
            return sendError(ctx, 401, 'UNAUTHORIZED', REJECT_MESSAGES[result.reason] ?? 'Unauthorized.');
        }
        //Published before the rate-limit/permission checks: verify() already marked the key as used
        if (result.firstUse) {
            txCore.apiServer.publishEvent('apiKey.firstUse', {
                keyId: result.key.id,
                keyName: result.key.name,
                ip: ctx.txVars.realIP,
            });
        }

        //Rate limit
        const heavy = !!requiredPermission && HEAVY_PERMISSIONS.has(requiredPermission);
        const rl = txCore.apiServer.rateLimiter.consume(result.key.id, heavy);
        ctx.set('X-RateLimit-Remaining', String(rl.remaining));
        if (!rl.allowed) {
            ctx.set('Retry-After', String(rl.retryAfterSec));
            return sendError(ctx, 429, 'RATE_LIMITED', 'Rate limit exceeded.', { retryAfterSec: rl.retryAfterSec });
        }

        //Optional actor: only keys holding api.actor may name a staff member
        let actor: string | undefined;
        const actorHeader = ctx.headers[ACTOR_HEADER];
        const actorIdHeader = ctx.headers[ACTOR_ID_HEADER];
        if (actorHeader !== undefined || actorIdHeader !== undefined) {
            if (!buildApiKeyPrincipal(result.key).hasPermission(ACTOR_SCOPE)) {
                return sendError(ctx, 403, 'FORBIDDEN', 'This API key cannot set X-TxAdmin-Actor or X-TxAdmin-Actor-Id.', { permission: ACTOR_SCOPE });
            }
            let actorName: string | undefined;
            if (actorHeader !== undefined) {
                const parsed = typeof actorHeader === 'string' ? parseActor(actorHeader) : null;
                if (!parsed) {
                    return sendError(ctx, 400, 'VALIDATION_ERROR', 'Invalid X-TxAdmin-Actor header.', {
                        header: 'X-TxAdmin-Actor',
                        expected: '1-48 characters: letters, digits, space, _ . \' # @ -',
                    });
                }
                actorName = parsed;
            }
            let actorId: string | undefined;
            if (actorIdHeader !== undefined) {
                const parsed = typeof actorIdHeader === 'string' ? parseActorId(actorIdHeader) : null;
                if (!parsed) {
                    return sendError(ctx, 400, 'VALIDATION_ERROR', 'Invalid X-TxAdmin-Actor-Id header.', {
                        header: 'X-TxAdmin-Actor-Id',
                        expected: 'discord:<id> or fivem:<id>',
                    });
                }
                actorId = parsed;
            }
            actor = resolveActorLabel(actorName, actorId);
        }

        //Principal + permission
        const admin = buildApiKeyPrincipal(result.key, actor);
        if (requiredPermission && !admin.hasPermission(requiredPermission)) {
            return sendError(ctx, 403, 'FORBIDDEN', 'This API key lacks the required scope.', { permission: requiredPermission });
        }

        (ctx as ApiKeyCtx).admin = admin;
        (ctx as ApiKeyCtx).apiKey = result.key;
        await next();
    };
};
