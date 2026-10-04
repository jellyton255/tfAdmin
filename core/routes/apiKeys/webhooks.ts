const modulename = 'WebServer:Webhooks';
import { z } from 'zod';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { webhookCreateSchema, webhookUpdateSchema } from '@modules/ApiServer/WebhookStore';
import { API_EVENT_TYPES, type ApiWebhookCreateResp, type ApiWebhookDeliveriesResp, type ApiWebhookResp, type ApiWebhookTestResp, type ApiWebhooksListResp } from '@shared/apiV1Types';
import { sendApiError } from './index';

/**
 * Panel-facing routes for managing webhooks (session + CSRF auth). Same envelope as /api/v1/webhooks.
 */
const idBodySchema = z.object({ id: z.string().min(8).max(32) });
const updateBodySchema = z.object({ id: z.string().min(8).max(32) }).and(webhookUpdateSchema);
const forbidden = { error: { code: 'FORBIDDEN' as const, message: 'You don\'t have permission to manage webhooks.' } };


export async function list(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return ctx.send<ApiWebhooksListResp>(forbidden);
    }
    return ctx.send<ApiWebhooksListResp>({
        data: {
            webhooks: txCore.apiServer.webhookStore.list(),
            eventTypes: [...API_EVENT_TYPES],
        },
    });
};

export async function create(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return ctx.send<ApiWebhookCreateResp>(forbidden);
    }
    try {
        const input = webhookCreateSchema.parse(ctx.request.body);
        const result = await txCore.apiServer.createWebhook(ctx.admin, input);
        return ctx.send<ApiWebhookCreateResp>({ data: result });
    } catch (error) {
        return sendApiError(ctx, error);
    }
};

export async function update(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return ctx.send<ApiWebhookResp>(forbidden);
    }
    try {
        const { id, ...input } = updateBodySchema.parse(ctx.request.body);
        const webhook = await txCore.apiServer.updateWebhook(ctx.admin, id, input);
        return ctx.send<ApiWebhookResp>({ data: { webhook } });
    } catch (error) {
        return sendApiError(ctx, error);
    }
};

export async function remove(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return ctx.send<ApiWebhookResp>(forbidden);
    }
    try {
        const { id } = idBodySchema.parse(ctx.request.body);
        const webhook = await txCore.apiServer.removeWebhook(ctx.admin, id);
        return ctx.send<ApiWebhookResp>({ data: { webhook } });
    } catch (error) {
        return sendApiError(ctx, error);
    }
};

export async function test(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return ctx.send<ApiWebhookTestResp>(forbidden);
    }
    try {
        const { id } = idBodySchema.parse(ctx.request.body);
        const delivery = await txCore.apiServer.testWebhook(ctx.admin, id);
        return ctx.send<ApiWebhookTestResp>({ data: { delivery } });
    } catch (error) {
        return sendApiError(ctx, error);
    }
};

export async function deliveries(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return ctx.send<ApiWebhookDeliveriesResp>(forbidden);
    }
    const id = typeof ctx.query.id === 'string' ? ctx.query.id : '';
    if (!txCore.apiServer.webhookStore.get(id)) {
        return ctx.send<ApiWebhookDeliveriesResp>({ error: { code: 'NOT_FOUND', message: 'Webhook not found.' } });
    }
    return ctx.send<ApiWebhookDeliveriesResp>({ data: { deliveries: txCore.apiServer.dispatcher.listDeliveries(id) } });
};
