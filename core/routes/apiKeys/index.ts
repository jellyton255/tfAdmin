const modulename = 'WebServer:ApiKeys';
import { z } from 'zod';
import { ZodError } from 'zod';
import consoleFactory from '@lib/console';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { ApiError } from '@modules/ApiServer/envelope';
import { apiKeyCreateSchema, apiKeyScopesUpdateSchema } from '@modules/ApiServer/ApiKeyStore';
import { API_SCOPES } from '@shared/apiScopes';
import type { ApiKeyCreateResp, ApiKeyListResp, ApiKeyRevokeResp, ApiKeyUpdateScopesResp } from '@shared/apiV1Types';
const console = consoleFactory(modulename);

/**
 * Panel-facing routes for managing API keys (session + CSRF auth, like every panel route).
 * They return the same envelope as /api/v1/keys so the panel can share types with API clients.
 */
const revokeBodySchema = z.object({ id: z.string().min(8).max(32) });
const updateScopesBodySchema = apiKeyScopesUpdateSchema.extend({ id: z.string().min(8).max(32) });

export const sendApiError = (ctx: AuthedCtx, error: unknown) => {
    if (error instanceof ApiError) {
        return ctx.send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error instanceof ZodError) {
        return ctx.send({
            error: {
                code: 'VALIDATION_ERROR',
                message: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
            },
        });
    }
    console.verbose.error((error as Error).message);
    return ctx.send({ error: { code: 'INTERNAL_ERROR', message: 'Internal error.' } });
};


export async function list(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return ctx.send<ApiKeyListResp>({ error: { code: 'FORBIDDEN', message: 'You don\'t have permission to manage API keys.' } });
    }
    return ctx.send<ApiKeyListResp>({
        data: {
            keys: txCore.apiServer.keyStore.list(),
            scopes: API_SCOPES,
        },
    });
};

export async function create(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return ctx.send<ApiKeyCreateResp>({ error: { code: 'FORBIDDEN', message: 'You don\'t have permission to manage API keys.' } });
    }
    try {
        const input = apiKeyCreateSchema.parse(ctx.request.body);
        const result = await txCore.apiServer.createKey(ctx.admin, input);
        return ctx.send<ApiKeyCreateResp>({ data: result });
    } catch (error) {
        return sendApiError(ctx, error);
    }
};

export async function revoke(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return ctx.send<ApiKeyRevokeResp>({ error: { code: 'FORBIDDEN', message: 'You don\'t have permission to manage API keys.' } });
    }
    try {
        const { id } = revokeBodySchema.parse(ctx.request.body);
        const key = await txCore.apiServer.revokeKey(ctx.admin, id);
        return ctx.send<ApiKeyRevokeResp>({ data: { key } });
    } catch (error) {
        return sendApiError(ctx, error);
    }
};

export async function updateScopes(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return ctx.send<ApiKeyUpdateScopesResp>({ error: { code: 'FORBIDDEN', message: 'You don\'t have permission to manage API keys.' } });
    }
    try {
        const { id, permissions } = updateScopesBodySchema.parse(ctx.request.body);
        const key = await txCore.apiServer.updateKeyScopes(ctx.admin, id, permissions);
        return ctx.send<ApiKeyUpdateScopesResp>({ data: { key } });
    } catch (error) {
        return sendApiError(ctx, error);
    }
};
