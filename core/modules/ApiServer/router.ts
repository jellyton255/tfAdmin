import Router from '@koa/router';
import { apiEnvelopeMw, sendError } from './envelope';
import { apiKeyAuthMw } from './apiKeyAuthMw';
import * as v1 from '@routes/api/v1';
import type { InitializedCtx } from '@modules/WebServer/ctxTypes';


/**
 * Router factory for the public API, mounted by WebServer/router.ts under /api/v1.
 * Every route goes through the envelope middleware and bearer-key auth.
 */
export default () => {
    const router = new Router({ prefix: '/api/v1' });
    router.use(apiEnvelopeMw as any);

    //Identity
    router.get('/me', apiKeyAuthMw(), v1.me as any);

    //Key management (needs manage.admins)
    router.get('/keys', apiKeyAuthMw('manage.admins'), v1.keys_list as any);
    router.post('/keys', apiKeyAuthMw('manage.admins'), v1.keys_create as any);
    router.delete('/keys/:id', apiKeyAuthMw('manage.admins'), v1.keys_revoke as any);

    //Read endpoints (any valid key, like the panel pages they mirror)
    router.get('/status', apiKeyAuthMw(), v1.status as any);
    router.get('/players', apiKeyAuthMw(), v1.players_search as any);
    router.get('/players/online', apiKeyAuthMw(), v1.players_online as any);
    router.get('/players/stats', apiKeyAuthMw(), v1.players_stats as any);
    router.get('/players/:license', apiKeyAuthMw(), v1.players_get as any);
    router.get('/actions', apiKeyAuthMw(), v1.actions_search as any);
    router.get('/actions/stats', apiKeyAuthMw(), v1.actions_stats as any);
    router.get('/actions/:id', apiKeyAuthMw(), v1.actions_get as any);
    router.get('/whitelist/approvals', apiKeyAuthMw(), v1.whitelist_approvals as any);
    router.get('/whitelist/requests', apiKeyAuthMw(), v1.whitelist_requests as any);
    router.get('/resources', apiKeyAuthMw(), v1.resources as any);

    //Admin roster (needs manage.admins)
    router.get('/admins', apiKeyAuthMw('manage.admins'), v1.admins as any);

    return router;
};


/**
 * JSON 404 for anything under /api that no route matched.
 * Used by the WebServer fallback so API clients never get the React index.
 */
export const apiNotFound = (ctx: InitializedCtx) => {
    sendError(ctx, 404, 'NOT_FOUND', `No API route for ${ctx.method} ${ctx.path}.`);
};
