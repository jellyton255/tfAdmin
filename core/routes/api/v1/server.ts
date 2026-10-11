import { z } from 'zod';
import { sendData } from '@modules/ApiServer/envelope';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import * as svc from '@modules/ApiServer/services/serverControl';

export const controlParamSchema = z.object({ action: z.enum(['start', 'stop', 'restart']) });
export const announceBodySchema = z.object({ message: z.string().trim().min(1).max(1024) });
export const kickAllBodySchema = z.object({ reason: z.string().trim().max(2048).optional() });
export const commandBodySchema = z.object({ command: z.string().trim().min(1).max(4096) });
export const resourceParamSchema = z.object({
    name: z.string().trim().min(1).max(128),
    command: z.enum(['start', 'stop', 'restart', 'ensure']),
});


/** POST /api/v1/server/:action  start|stop|restart  (control.server) */
export async function control(ctx: ApiKeyCtx) {
    const { action } = controlParamSchema.parse(ctx.params);
    return sendData(ctx, await svc.controlServer(ctx.admin, action));
};

/** POST /api/v1/server/announce  (announcement) */
export async function announce(ctx: ApiKeyCtx) {
    const { message } = announceBodySchema.parse(ctx.request.body);
    svc.announce(ctx.admin, message);
    return sendData(ctx, { ok: true as const });
};

/** POST /api/v1/server/kick-all  (control.server) */
export async function kickAll(ctx: ApiKeyCtx) {
    const { reason } = kickAllBodySchema.parse(ctx.request.body ?? {});
    svc.kickAll(ctx.admin, reason);
    return sendData(ctx, { ok: true as const });
};

/** POST /api/v1/server/command  (console.write) */
export async function command(ctx: ApiKeyCtx) {
    const body = commandBodySchema.parse(ctx.request.body);
    svc.runConsoleCommand(ctx.admin, body.command);
    return sendData(ctx, { ok: true as const });
};

/** POST /api/v1/resources/:name/:command  start|stop|restart|ensure  (commands.resources) */
export async function resourceCommand(ctx: ApiKeyCtx) {
    const { name, command } = resourceParamSchema.parse(ctx.params);
    svc.resourceCommand(ctx.admin, command, name);
    return sendData(ctx, { resource: name, command });
};

/** POST /api/v1/resources/refresh  (commands.resources) */
export async function refreshResources(ctx: ApiKeyCtx) {
    svc.refreshResources(ctx.admin);
    return sendData(ctx, { resource: null, command: 'refresh' });
};
