import { z } from 'zod';
import { sendData } from '@modules/ApiServer/envelope';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import * as svc from '@modules/ApiServer/services/playerActions';

const licenseParamSchema = z.object({ license: z.string().regex(/^[0-9a-f]{40}$/i, 'license must be 40 hex characters') });
const reasonSchema = z.string().trim().max(2048);
export const sanctionNoteSchema = z.string().trim().max(4096).optional(); //staff note saved on the action
export const banBodySchema = z.object({ reason: reasonSchema.min(1), duration: z.string().trim().min(1).max(32), note: sanctionNoteSchema });
export const warnBodySchema = z.object({ reason: reasonSchema.min(1), note: sanctionNoteSchema });
export const kickBodySchema = z.object({ reason: reasonSchema.optional(), note: sanctionNoteSchema });
export const messageBodySchema = z.object({ message: z.string().trim().min(1).max(1024) });
export const whitelistBodySchema = z.object({ whitelisted: z.boolean() });
export const noteBodySchema = z.object({ note: z.string().trim().min(1).max(4096) });
export const noteIdParamSchema = z.object({ noteId: z.string().min(1).max(32) });
export const watchBodySchema = z.object({ reason: z.string().trim().min(1).max(512) });
export const tagsBodySchema = z.object({ tags: z.array(z.string().max(64)).max(32) });

const target = (ctx: ApiKeyCtx) => svc.resolvePlayer(licenseParamSchema.parse(ctx.params).license);


/** POST /api/v1/players/:license/ban  (players.ban) */
export async function ban(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = banBodySchema.parse(ctx.request.body);
    return sendData(ctx, svc.banPlayer(ctx.admin, player, body.reason, body.duration, body.note), 201);
};

/** POST /api/v1/players/:license/warn  (players.warn) */
export async function warn(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = warnBodySchema.parse(ctx.request.body);
    return sendData(ctx, svc.warnPlayer(ctx.admin, player, body.reason, body.note), 201);
};

/** POST /api/v1/players/:license/kick  (players.kick) */
export async function kick(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = kickBodySchema.parse(ctx.request.body ?? {});
    return sendData(ctx, { ok: true as const, action: svc.kickPlayer(ctx.admin, player, body.reason, body.note) });
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

/** PUT /api/v1/players/:license/note  (players.note) - kept for older clients; appends like POST /notes */
export async function note(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = noteBodySchema.parse(ctx.request.body);
    svc.addPlayerNote(ctx.admin, player, body.note);
    return sendData(ctx, { ok: true as const });
};

/** POST /api/v1/players/:license/notes  (players.note) */
export async function addNote(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = noteBodySchema.parse(ctx.request.body);
    return sendData(ctx, { note: svc.addPlayerNote(ctx.admin, player, body.note) }, 201);
};

/** DELETE /api/v1/players/:license/notes/:noteId  (players.note) */
export async function deleteNote(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const { noteId } = noteIdParamSchema.parse(ctx.params);
    return sendData(ctx, { note: svc.deletePlayerNote(ctx.admin, player, noteId) });
};

/** PUT /api/v1/players/:license/watch  (players.note) */
export async function watch(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = watchBodySchema.parse(ctx.request.body);
    return sendData(ctx, { watch: svc.watchPlayer(ctx.admin, player, body.reason) });
};

/** DELETE /api/v1/players/:license/watch  (players.note) */
export async function unwatch(ctx: ApiKeyCtx) {
    const player = target(ctx);
    svc.unwatchPlayer(ctx.admin, player);
    return sendData(ctx, { ok: true as const });
};

/** PUT /api/v1/players/:license/tags  (players.note) */
export async function tags(ctx: ApiKeyCtx) {
    const player = target(ctx);
    const body = tagsBodySchema.parse(ctx.request.body);
    return sendData(ctx, { tags: svc.setPlayerTags(ctx.admin, player, body.tags) });
};
