import { z } from 'zod';
import { sendData } from '@modules/ApiServer/envelope';
import { apiKeyCreateSchema } from '@modules/ApiServer/ApiKeyStore';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';

const idParamSchema = z.object({ id: z.string().min(8).max(32) });


/**
 * GET /api/v1/keys
 */
export async function list(ctx: ApiKeyCtx) {
    return sendData(ctx, {
        keys: txCore.apiServer.keyStore.list(),
        permissions: txCore.adminStore.getPermissionsList(),
    });
};


/**
 * POST /api/v1/keys
 * Body: { name, permissions[], expiresAt?, allowedIps? }
 * Returns the record and the plaintext token (shown once).
 */
export async function create(ctx: ApiKeyCtx) {
    const input = apiKeyCreateSchema.parse(ctx.request.body);
    const result = await txCore.apiServer.createKey(ctx.admin, input);
    return sendData(ctx, result, 201);
};


/**
 * DELETE /api/v1/keys/:id - revokes (soft deletes) a key
 */
export async function revoke(ctx: ApiKeyCtx) {
    const { id } = idParamSchema.parse(ctx.params);
    const key = await txCore.apiServer.revokeKey(ctx.admin, id);
    return sendData(ctx, { key });
};
