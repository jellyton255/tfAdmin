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

    //Spec (no auth, no server data)
    router.get('/openapi.json', v1.openapi as any);
    router.get('/docs', v1.docs as any);

    //Identity
    router.get('/me', apiKeyAuthMw(), v1.me as any);

    //Key management (needs manage.admins)
    router.get('/keys', apiKeyAuthMw('manage.admins'), v1.keys_list as any);
    router.post('/keys', apiKeyAuthMw('manage.admins'), v1.keys_create as any);
    router.patch('/keys/:id', apiKeyAuthMw('manage.admins'), v1.keys_updateScopes as any);
    router.delete('/keys/:id', apiKeyAuthMw('manage.admins'), v1.keys_revoke as any);

    //Read endpoints (any valid key, including read-only keys with no scopes)
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

    //Events (polling fallback) and webhooks
    router.get('/events', apiKeyAuthMw(), v1.events_list as any);
    router.get('/events/types', apiKeyAuthMw(), v1.events_types as any);
    router.get('/webhooks', apiKeyAuthMw('manage.admins'), v1.webhooks_list as any);
    router.post('/webhooks', apiKeyAuthMw('manage.admins'), v1.webhooks_create as any);
    router.patch('/webhooks/:id', apiKeyAuthMw('manage.admins'), v1.webhooks_update as any);
    router.delete('/webhooks/:id', apiKeyAuthMw('manage.admins'), v1.webhooks_remove as any);
    router.post('/webhooks/:id/test', apiKeyAuthMw('manage.admins'), v1.webhooks_test as any);
    router.get('/webhooks/:id/deliveries', apiKeyAuthMw('manage.admins'), v1.webhooks_deliveries as any);

    //Player moderation
    router.post('/players/:license/ban', apiKeyAuthMw('players.ban'), v1.players_ban as any);
    router.post('/players/:license/warn', apiKeyAuthMw('players.warn'), v1.players_warn as any);
    router.post('/players/:license/kick', apiKeyAuthMw('players.kick'), v1.players_kick as any);
    router.post('/players/:license/message', apiKeyAuthMw('players.direct_message'), v1.players_message as any);
    router.put('/players/:license/whitelist', apiKeyAuthMw('players.whitelist'), v1.players_whitelist as any);
    router.put('/players/:license/note', apiKeyAuthMw('players.note'), v1.players_note as any);

    //Actions (bans/warns) writes
    router.post('/actions/ban-identifiers', apiKeyAuthMw('players.ban'), v1.actions_banIds as any);
    router.post('/actions/import-ban', apiKeyAuthMw('players.ban_import'), v1.actions_importBan as any);
    router.post('/actions/:id/revoke', apiKeyAuthMw(), v1.actions_revoke as any); //per-type permission inside

    //Whitelist writes
    router.post('/whitelist/approvals', apiKeyAuthMw('players.whitelist'), v1.whitelist_addApproval as any);
    router.delete('/whitelist/approvals/:identifier', apiKeyAuthMw('players.whitelist'), v1.whitelist_removeApproval as any);
    router.post('/whitelist/requests/deny-all', apiKeyAuthMw('players.whitelist'), v1.whitelist_denyAllRequests as any);
    router.post('/whitelist/requests/:id/approve', apiKeyAuthMw('players.whitelist'), v1.whitelist_approveRequest as any);
    router.post('/whitelist/requests/:id/deny', apiKeyAuthMw('players.whitelist'), v1.whitelist_denyRequest as any);

    //Server control and commands (heavy rate-limit bucket)
    router.post('/server/announce', apiKeyAuthMw('announcement'), v1.server_announce as any);
    router.post('/server/kick-all', apiKeyAuthMw('control.server'), v1.server_kickAll as any);
    router.post('/server/command', apiKeyAuthMw('console.write'), v1.server_command as any);
    router.post('/server/:action', apiKeyAuthMw('control.server'), v1.server_control as any);
    router.post('/resources/refresh', apiKeyAuthMw('commands.resources'), v1.resources_refresh as any);
    router.post('/resources/:name/:command', apiKeyAuthMw('commands.resources'), v1.resources_command as any);

    return router;
};


/**
 * JSON 404 for anything under /api that no route matched.
 * Used by the WebServer fallback so API clients never get the React index.
 */
export const apiNotFound = (ctx: InitializedCtx) => {
    sendError(ctx, 404, 'NOT_FOUND', `No API route for ${ctx.method} ${ctx.path}.`);
};
