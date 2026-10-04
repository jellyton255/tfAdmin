import { z } from 'zod';
import { sendData } from '@modules/ApiServer/envelope';
import { secToMs } from '@modules/ApiServer/pagination';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import type { DatabaseWhitelistApprovalsType } from '@modules/Database/databaseTypes';
import * as svc from '@modules/ApiServer/services/whitelistWrites';
import type { ApiWhitelistApproval } from '@shared/apiV1Types';

const identifierBodySchema = z.object({ identifier: z.string().trim().min(3).max(128) });
const identifierParamSchema = z.object({ identifier: z.string().trim().min(3).max(128) });
const reqIdParamSchema = z.object({ id: z.string().trim().min(1).max(16) });
const denyAllBodySchema = z.object({ before: z.number().int().positive().optional() }).default({});

const toApiApproval = (a: DatabaseWhitelistApprovalsType): ApiWhitelistApproval => ({
    identifier: a.identifier,
    playerName: a.playerName,
    playerAvatar: a.playerAvatar ?? null,
    approvedAt: secToMs(a.tsApproved) ?? 0,
    approvedBy: a.approvedBy,
});


/** POST /api/v1/whitelist/approvals  body {identifier}  (players.whitelist) */
export async function addApproval(ctx: ApiKeyCtx) {
    const { identifier } = identifierBodySchema.parse(ctx.request.body);
    const approval = await svc.addApproval(ctx.admin, identifier);
    return sendData(ctx, { approval: toApiApproval(approval) }, 201);
};

/** DELETE /api/v1/whitelist/approvals/:identifier  (players.whitelist) */
export async function removeApproval(ctx: ApiKeyCtx) {
    const { identifier } = identifierParamSchema.parse(ctx.params);
    svc.removeApproval(ctx.admin, decodeURIComponent(identifier));
    return sendData(ctx, { ok: true as const });
};

/** POST /api/v1/whitelist/requests/:id/approve  (players.whitelist) */
export async function approveRequest(ctx: ApiKeyCtx) {
    const { id } = reqIdParamSchema.parse(ctx.params);
    const approval = svc.approveRequest(ctx.admin, id.toUpperCase());
    return sendData(ctx, { approval: toApiApproval(approval) }, 201);
};

/** POST /api/v1/whitelist/requests/:id/deny  (players.whitelist) */
export async function denyRequest(ctx: ApiKeyCtx) {
    const { id } = reqIdParamSchema.parse(ctx.params);
    svc.denyRequest(ctx.admin, id.toUpperCase());
    return sendData(ctx, { ok: true as const });
};

/** POST /api/v1/whitelist/requests/deny-all  body {before?: epoch ms}  (players.whitelist) */
export async function denyAllRequests(ctx: ApiKeyCtx) {
    const { before } = denyAllBodySchema.parse(ctx.request.body ?? {});
    const removed = svc.denyAllRequests(ctx.admin, before);
    return sendData(ctx, { removed });
};
