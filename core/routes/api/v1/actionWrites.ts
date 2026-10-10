import { z } from 'zod';
import { sendData } from '@modules/ApiServer/envelope';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import { banIdentifiers, importBan as importBanService, revokeAction } from '@modules/ApiServer/services/actionWrites';

const idParamSchema = z.object({ id: z.string().trim().min(1).max(32) });
const banIdsBodySchema = z.object({
    identifiers: z.array(z.string().trim().min(4)).min(1).max(64),
    reason: z.string().trim().min(3).max(2048),
    duration: z.string().trim().min(1).max(32),
});
const importBanBodySchema = z.object({
    externalRef: z.string().trim().min(1).max(96).regex(/^[A-Za-z0-9_.:-]+$/),
    identifiers: z.array(z.string().trim().toLowerCase().min(1).max(512)).min(1).max(64),
    hwids: z.array(z.string().trim().min(1).max(512)).max(64).optional(),
    playerName: z.string().trim().min(1).max(128).nullable().optional(),
    reason: z.string().trim().min(3).max(2048),
    author: z.string().trim().min(1).max(64),
    expiresAt: z.number().int().positive().nullable().optional(),
    notify: z.boolean().optional(),
}).strict();


/** POST /api/v1/actions/ban-identifiers  (players.ban) */
export async function banIds(ctx: ApiKeyCtx) {
    const body = banIdsBodySchema.parse(ctx.request.body);
    return sendData(ctx, banIdentifiers(ctx.admin, body.identifiers, body.reason, body.duration), 201);
};

/** POST /api/v1/actions/import-ban  (players.ban_import) */
export async function importBan(ctx: ApiKeyCtx) {
    const body = importBanBodySchema.parse(ctx.request.body);
    const result = importBanService(ctx.admin, body);
    return sendData(ctx, result, result.created ? 201 : 200);
};

/** POST /api/v1/actions/:id/revoke  (players.ban for bans, players.warn for warns) */
export async function revoke(ctx: ApiKeyCtx) {
    const { id } = idParamSchema.parse(ctx.params);
    return sendData(ctx, { action: revokeAction(ctx.admin, id.toUpperCase()) });
};
