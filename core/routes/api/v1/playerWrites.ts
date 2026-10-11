import { z } from 'zod';
import { sendData } from '@modules/ApiServer/envelope';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import * as svc from '@modules/ApiServer/services/playerActions';

const licenseParamSchema = z.object({ license: z.string().regex(/^[0-9a-f]{40}$/i, 'license must be 40 hex characters') });
const reasonSchema = z.string().trim().max(2048);
export const banBodySchema = z.object({ reason: reasonSchema.min(1), duration: z.string().trim().min(1).max(32) });
export const warnBodySchema = z.object({ reason: reasonSchema.min(1) });
export const kickBodySchema = z.object({ reason: reasonSchema.optional() });
export const messageBodySchema = z.object({ message: z.string().trim().min(1).max(1024) });
export const whitelistBodySchema = z.object({ whitelisted: z.boolean() });
export const noteBodySchema = z.object({ note: z.string().max(4096) });

const target = (ctx: ApiKeyCtx) => svc.resolvePlayer(licenseParamSchema.parse(ctx.params).license);


/** POST /api/v1/players/:license/ban  (players.ban) */
export async function ban(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = banBodySchema.parse(ctx.request.body);
    return sendData(ctx, svc.banPlayer(ctx.admin, player, body.reason, body.duration), 201);
};

/** POST /api/v1/players/:license/warn  (players.warn) */
export async function warn(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = warnBodySchema.parse(ctx.request.body);
    return sendData(ctx, svc.warnPlayer(ctx.admin, player, body.reason), 201);
};

/** POST /api/v1/players/:license/kick  (players.kick) */
export async function kick(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = kickBodySchema.parse(ctx.request.body ?? {});
    svc.kickPlayer(ctx.admin, player, body.reason);
    return sendData(ctx, { ok: true as const });
};

/** POST /api/v1/players/:license/message  (players.direct_message) */
export async function message(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = messageBodySchema.parse(ctx.request.body);
    svc.messagePlayer(ctx.admin, player, body.message);
    return sendData(ctx, { ok: true as const });
};

/** PUT /api/v1/players/:license/whitelist  (players.whitelist) */
export async function whitelist(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = whitelistBodySchema.parse(ctx.request.body);
    svc.setPlayerWhitelist(ctx.admin, player, body.whitelisted);
    return sendData(ctx, { ok: true as const });
};

/** PUT /api/v1/players/:license/note  (players.note) */
export async function note(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = noteBodySchema.parse(ctx.request.body);
    svc.setPlayerNote(ctx.admin, player, body.note);
    return sendData(ctx, { ok: true as const });
};
