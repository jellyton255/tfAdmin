import { z } from 'zod';
import { sendData } from '@modules/ApiServer/envelope';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import { ApiError } from '@modules/ApiServer/envelope';
import { banIdentifiers, importBan as importBanService, revokeAction } from '@modules/ApiServer/services/actionWrites';
import {
    ACTION_NOTE_SCOPES, addActionNote, deleteActionNote, editActionNote, findActionOr404,
} from '@modules/ApiServer/services/actionNotes';

export const idParamSchema = z.object({ id: z.string().trim().min(1).max(32) });
export const banIdsBodySchema = z.object({
    identifiers: z.array(z.string().trim().min(4)).min(1).max(64),
    reason: z.string().trim().min(3).max(2048),
    duration: z.string().trim().min(1).max(32),
    note: z.string().trim().max(4096).optional(),
});
export const revokeBodySchema = z.object({ reason: z.string().trim().max(2048).optional() });
export const actionNoteBodySchema = z.object({ text: z.string().trim().min(1).max(4096) });
export const actionNoteParamSchema = idParamSchema.extend({ noteId: z.string().trim().min(1).max(32) });
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
    return sendData(ctx, banIdentifiers(ctx.admin, body.identifiers, body.reason, body.duration, body.note), 201);
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
    const body = revokeBodySchema.parse(ctx.request.body ?? {});
    return sendData(ctx, { action: revokeAction(ctx.admin, id.toUpperCase(), body.reason) });
};


/**
 * Notes need players.note, or the scope of the action's type (players.ban, players.warn, players.kick).
 */
const noteTarget = (ctx: ApiKeyCtx, id: string) => {
    const action = findActionOr404(id.toUpperCase());
    const typeScope = ACTION_NOTE_SCOPES[action.type];
    if (!ctx.admin.hasPermission('players.note') && !ctx.admin.hasPermission(typeScope)) {
        throw new ApiError(403, 'FORBIDDEN', 'This API key lacks the required scope.', {
            permission: ['players.note', typeScope],
        });
    }
    return action;
};

/** POST /api/v1/actions/:id/notes  (players.note or the action type's scope) */
export async function addNote(ctx: ApiKeyCtx) {
    const action = noteTarget(ctx, idParamSchema.parse(ctx.params).id);
    const body = actionNoteBodySchema.parse(ctx.request.body);
    return sendData(ctx, { note: addActionNote(ctx.admin, action.id, body.text) }, 201);
};

/** PATCH /api/v1/actions/:id/notes/:noteId  (same scopes; only the note's author) */
export async function editNote(ctx: ApiKeyCtx) {
    const { id, noteId } = actionNoteParamSchema.parse(ctx.params);
    const action = noteTarget(ctx, id);
    const body = actionNoteBodySchema.parse(ctx.request.body);
    return sendData(ctx, { note: editActionNote(ctx.admin, action.id, noteId, body.text) });
};

/** DELETE /api/v1/actions/:id/notes/:noteId  (same scopes; the note's author, or manage.admins) */
export async function deleteNote(ctx: ApiKeyCtx) {
    const { id, noteId } = actionNoteParamSchema.parse(ctx.params);
    const action = noteTarget(ctx, id);
    return sendData(ctx, { note: deleteActionNote(ctx.admin, action.id, noteId) });
};
