const modulename = 'ApiServer:AuthMw';
import type { Next } from 'koa';
import consoleFactory from '@lib/console';
import { AuthedAdmin } from '@modules/WebServer/authLogic';
import type { InitializedCtx } from '@modules/WebServer/ctxTypes';
import { sendError } from './envelope';
import type { StoredApiKey } from './ApiKeyStore';
import { API_SCOPES, API_SCOPE_ALL, getApiScope } from '@shared/apiScopes';
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
export const ACTOR_ID_HEADER = 'x-txadmin-actor-id';
export const ACTOR_SCOPE = 'api.actor';
const ACTOR_ID_PATTERN = /^(discord:\d{17,20}|fivem:\d{1,20})$/;

/**
 * Validates an X-TxAdmin-Actor-Id value (`discord:<snowflake>` or `fivem:<id>`), lowercased, or null.
 */
export const parseActorId = (raw: string) => {
    const id = raw.trim().toLowerCase();
    return ACTOR_ID_PATTERN.test(id) ? id : null;
};

type ActorAdmin = { name: string; master: boolean; permissions: string[] };

/**
 * Looks up the txAdmin admin whose linked Discord/FiveM account matches the actor id, or null.
 */
export const findActorAdmin = (id: string): ActorAdmin | null => {
    const admin = txCore.adminStore.getAdminByIdentifiers([id]);
    if (!admin || typeof admin.name !== 'string') return null;
    return {
        name: admin.name,
        master: admin.master === true,
        permissions: Array.isArray(admin.permissions) ? admin.permissions : [],
    };
};

/**
 * The scopes a request may use when acting for a staff member: the key's scopes, minus any whose
 * backing txAdmin permission the staff member's own admin account lacks. Scopes without a backing
 * permission (grantRequires null) pass through. txAdmin then acts as a second gate behind the consumer.
 */
export const actorEffectiveScopes = (keyScopes: string[], actor: ActorAdmin) => {
    if (actor.master || actor.permissions.includes(API_SCOPE_ALL)) return keyScopes;
    const expanded = keyScopes.includes(API_SCOPE_ALL)
        ? API_SCOPES.map((s) => s.id).filter((id) => id !== API_SCOPE_ALL)
        : keyScopes;
    return expanded.filter((id) => {
        const required = getApiScope(id)?.grantRequires;
        return !required || actor.permissions.includes(required);
    });
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
 * With an actor (X-TxAdmin-Actor-Id) the name becomes `<txAdmin admin name> (via api:<keyName>)` and the
 * permissions are narrowed to what both the key and that admin hold.
 */
export const buildApiKeyPrincipal = (key: StoredApiKey, actor?: ActorAdmin) => {
    return new AuthedAdmin({
        name: actor ? `${actor.name} (via api:${key.name})` : `api:${key.name}`,
        master: false,
        permissions: actor ? actorEffectiveScopes(key.permissions, actor) : key.permissions,
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

        //Optional actor: only keys holding api.actor may act for a staff member, and only for one
        //whose Discord/FiveM account is linked to a txAdmin admin
        let actor: ActorAdmin | undefined;
        const actorIdHeader = ctx.headers[ACTOR_ID_HEADER];
        if (actorIdHeader !== undefined) {
            if (!buildApiKeyPrincipal(result.key).hasPermission(ACTOR_SCOPE)) {
                return sendError(ctx, 403, 'FORBIDDEN', 'This API key cannot set X-TxAdmin-Actor-Id.', { permission: ACTOR_SCOPE });
            }
            const actorId = typeof actorIdHeader === 'string' ? parseActorId(actorIdHeader) : null;
            if (!actorId) {
                return sendError(ctx, 400, 'VALIDATION_ERROR', 'Invalid X-TxAdmin-Actor-Id header.', {
                    header: 'X-TxAdmin-Actor-Id',
                    expected: 'discord:<id> or fivem:<id>',
                });
            }
            const found = findActorAdmin(actorId);
            if (!found) {
                return sendError(ctx, 403, 'FORBIDDEN', 'No txAdmin admin is linked to this staff account.', {
                    reason: 'actor_not_admin',
                    actorId,
                });
            }
            actor = found;
        }

        //Principal + permission
        const admin = buildApiKeyPrincipal(result.key, actor);
        if (requiredPermission && !admin.hasPermission(requiredPermission)) {
            if (actor && buildApiKeyPrincipal(result.key).hasPermission(requiredPermission)) {
                return sendError(ctx, 403, 'FORBIDDEN', 'The staff member lacks this permission in txAdmin.', {
                    reason: 'actor_lacks_permission',
                    permission: requiredPermission,
                    actor: actor.name,
                });
            }
            return sendError(ctx, 403, 'FORBIDDEN', 'This API key lacks the required scope.', { permission: requiredPermission });
        }

        (ctx as ApiKeyCtx).admin = admin;
        (ctx as ApiKeyCtx).apiKey = result.key;
        await next();
    };
};
