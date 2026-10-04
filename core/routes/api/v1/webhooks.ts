import { z } from 'zod';
import { sendData } from '@modules/ApiServer/envelope';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import { webhookCreateSchema, webhookUpdateSchema } from '@modules/ApiServer/WebhookStore';
import { ApiError } from '@modules/ApiServer/envelope';
import { API_EVENT_TYPES } from '@shared/apiV1Types';

const idParamSchema = z.object({ id: z.string().min(8).max(32) });

/** GET /api/v1/webhooks  (manage.admins) */
export async function list(ctx: ApiKeyCtx) {
    return sendData(ctx, {
        webhooks: txCore.apiServer.webhookStore.list(),
        eventTypes: [...API_EVENT_TYPES],
    });
};

/** POST /api/v1/webhooks  body {name, url, events, secret?}  (manage.admins) */
export async function create(ctx: ApiKeyCtx) {
    const input = webhookCreateSchema.parse(ctx.request.body);
    const result = await txCore.apiServer.createWebhook(ctx.admin, input);
    return sendData(ctx, result, 201);
};

/** PATCH /api/v1/webhooks/:id  body {enabled?, events?}  (manage.admins) */
export async function update(ctx: ApiKeyCtx) {
    const { id } = idParamSchema.parse(ctx.params);
    const input = webhookUpdateSchema.parse(ctx.request.body);
    const webhook = await txCore.apiServer.updateWebhook(ctx.admin, id, input);
    return sendData(ctx, { webhook });
};

/** DELETE /api/v1/webhooks/:id  (manage.admins) */
export async function remove(ctx: ApiKeyCtx) {
    const { id } = idParamSchema.parse(ctx.params);
    const webhook = await txCore.apiServer.removeWebhook(ctx.admin, id);
    return sendData(ctx, { webhook });
};

/** POST /api/v1/webhooks/:id/test  (manage.admins) */
export async function test(ctx: ApiKeyCtx) {
    const { id } = idParamSchema.parse(ctx.params);
    const delivery = await txCore.apiServer.testWebhook(ctx.admin, id);
    return sendData(ctx, { delivery });
};

/** GET /api/v1/webhooks/:id/deliveries  (manage.admins) */
export async function deliveries(ctx: ApiKeyCtx) {
    const { id } = idParamSchema.parse(ctx.params);
    if (!txCore.apiServer.webhookStore.get(id)) {
        throw new ApiError(404, 'NOT_FOUND', 'Webhook not found.');
    }
    return sendData(ctx, { deliveries: txCore.apiServer.dispatcher.listDeliveries(id) });
};
