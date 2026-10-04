const modulename = 'ApiServer:AuthMw';
import type { Next } from 'koa';
import consoleFactory from '@lib/console';
import { AuthedAdmin } from '@modules/WebServer/authLogic';
import type { InitializedCtx } from '@modules/WebServer/ctxTypes';
import { sendError } from './envelope';
import type { StoredApiKey } from './ApiKeyStore';
const console = consoleFactory(modulename);

//Permissions whose actions get the stricter rate-limit bucket
const HEAVY_PERMISSIONS = new Set(['control.server', 'console.write', 'commands.resources']);

export type ApiKeyCtx = InitializedCtx & {
    admin: AuthedAdmin;
    apiKey: StoredApiKey;
    params: any;
    request: any;
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
 */
export const buildApiKeyPrincipal = (key: StoredApiKey) => {
    return new AuthedAdmin({
        name: `api:${key.name}`,
        master: false,
        permissions: key.permissions,
    });
};


/**
 * Auth middleware factory for /api/v1 routes.
 * - Bearer token only, never cookies/sessions/CSRF
 * - optional `requiredPermission` checked before the handler runs
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

        //Principal + permission
        const admin = buildApiKeyPrincipal(result.key);
        if (requiredPermission && !admin.hasPermission(requiredPermission)) {
            return sendError(ctx, 403, 'FORBIDDEN', 'This API key lacks the required permission.', { permission: requiredPermission });
        }

        (ctx as ApiKeyCtx).admin = admin;
        (ctx as ApiKeyCtx).apiKey = result.key;
        await next();
    };
};
