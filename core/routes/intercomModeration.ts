import { z } from 'zod';
import consts from '@shared/consts';
import { filterPlayerHwids } from '@lib/player/idUtils';
import { addSanctionNote, buildBanKickMessage, parseBanDuration, recordKick } from '@modules/ApiServer/services/playerActions';
import { addActionNote, type NoteWriter } from '@modules/ApiServer/services/actionNotes';

/**
 * everfall: moderation requested by game scripts through the monitor resource's server exports
 * (resource/sv_exports.lua). tfAdmin owns every ban, so scripts write here directly instead of
 * keeping their own ban tables. Authors are labels such as "Anti-Cheat", never admin names.
 */

const authorSchema = z.string().trim().min(1).max(64);
const reasonSchema = z.string().trim().min(1).max(2048);
const noteSchema = z.string().trim().max(4096).optional(); //staff note saved on the action
const targetSchema = z.object({
    netid: z.number().int().positive(),
    name: z.string().trim().min(1).max(128),
    ids: z.array(z.string()).max(32),
    hwids: z.array(z.string()).max(64).default([]),
});
const requestSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('ban'),
        resource: z.string().max(128),
        author: authorSchema,
        reason: reasonSchema,
        duration: z.string().trim().min(1).max(32),
        note: noteSchema,
        target: targetSchema,
    }),
    z.object({
        action: z.literal('warn'),
        resource: z.string().max(128),
        author: authorSchema,
        reason: reasonSchema,
        note: noteSchema,
        target: targetSchema,
    }),
    z.object({
        action: z.literal('kick'),
        resource: z.string().max(128),
        author: authorSchema,
        reason: z.string().trim().max(2048).default(''),
        note: noteSchema,
        target: targetSchema,
    }),
    z.object({
        action: z.literal('note'),
        resource: z.string().max(128),
        author: authorSchema,
        actionId: z.string().trim().min(1).max(32),
        text: z.string().trim().min(1).max(4096),
    }),
    z.object({
        action: z.literal('message'),
        resource: z.string().max(128),
        author: authorSchema,
        message: z.string().trim().min(1).max(1024),
        target: targetSchema,
    }),
]);
export type GameModerationRequest = z.infer<typeof requestSchema>;
export type GameModerationResult = { success: true; actionId?: string } | { success: false; error: string };

const isValidIdentifier = (id: string) => Object.values(consts.validIdentifiers).some((regex) => regex.test(id));

const normalizeIds = (ids: string[]) => {
    return [...new Set(ids.map((id) => id.trim().toLowerCase()).filter(isValidIdentifier))];
};

const logLine = (req: GameModerationRequest, message: string) => {
    txCore.logger.admin.write(req.author, `[${req.resource || 'unknown resource'}] ${message}`);
};

//Notes written by a game script carry its author label and log like its other actions
const noteWriter = (req: GameModerationRequest): NoteWriter => ({
    name: req.author,
    logAction: (message: string) => logLine(req, message),
});


export const handleGameModeration = (body: unknown): GameModerationResult => {
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
        return { success: false, error: `Invalid request: ${parsed.error.issues[0]?.message ?? 'unknown error'}` };
    }
    const req = parsed.data;
    if (txCore.adminStore.getAdminByName(req.author)) {
        return { success: false, error: 'The author cannot be the name of a tfAdmin admin.' };
    }

    if (req.action === 'note') {
        try {
            addActionNote(noteWriter(req), req.actionId.toUpperCase(), req.text);
        } catch (error) {
            return { success: false, error: `Failed to add note: ${(error as Error).message}` };
        }
        return { success: true, actionId: req.actionId.toUpperCase() };
    }

    const { target } = req;
    if (req.action === 'kick') {
        const reason = req.reason || txCore.translator.t('kick_messages.unknown_reason');
        let actionId: string | undefined;
        try {
            actionId = recordKick(req.author, normalizeIds(target.ids), reason, target.name);
        } catch (error) {
            return { success: false, error: `Failed to record kick: ${(error as Error).message}` }; //sv_exports.lua drops the player
        }
        if (actionId) addSanctionNote(noteWriter(req), actionId, req.note);
        logLine(req, `Kicked "${target.name}": ${reason}`);
        txCore.fxRunner.sendEvent('playerKicked', {
            target: target.netid,
            author: req.author,
            reason,
            dropMessage: txCore.translator.t('kick_messages.player', { reason }),
            actionId: actionId ?? null,
            targetName: target.name,
        });
        return { success: true, actionId };
    }

    if (req.action === 'message') {
        logLine(req, `DM to "${target.name}": ${req.message}`);
        txCore.fxRunner.sendEvent('playerDirectMessage', {
            target: target.netid,
            author: req.author,
            message: req.message,
        });
        return { success: true };
    }

    const ids = normalizeIds(target.ids);
    if (!ids.length) {
        return { success: false, error: 'The player has no valid identifiers.' };
    }

    if (req.action === 'warn') {
        let actionId: string;
        try {
            actionId = txCore.database.actions.registerWarn(ids, req.author, req.reason, target.name);
        } catch (error) {
            return { success: false, error: `Failed to warn player: ${(error as Error).message}` };
        }
        logLine(req, `Warned player "${target.name}": ${req.reason}`);
        addSanctionNote(noteWriter(req), actionId, req.note);
        txCore.fxRunner.sendEvent('playerWarned', {
            author: req.author,
            reason: req.reason,
            actionId,
            targetNetId: target.netid,
            targetIds: ids,
            targetName: target.name,
        });
        return { success: true, actionId };
    }

    let expiration: number | false;
    let duration: number | undefined;
    try {
        ({ expiration, duration } = parseBanDuration(req.duration));
    } catch (error) {
        return { success: false, error: `Invalid ban duration "${req.duration}".` };
    }
    const hwids = [...new Set(filterPlayerHwids(target.hwids).validHwidsArray)];
    let actionId: string;
    try {
        actionId = txCore.database.actions.registerBan(ids, req.author, req.reason, expiration, target.name, hwids);
    } catch (error) {
        return { success: false, error: `Failed to ban player: ${(error as Error).message}` };
    }
    logLine(req, `Banned player "${target.name}": ${req.reason}`);
    addSanctionNote(noteWriter(req), actionId, req.note);
    const { kickMessage, durationTranslated } = buildBanKickMessage(req.author, req.reason, expiration, duration);
    txCore.fxRunner.sendEvent('playerBanned', {
        author: req.author,
        reason: req.reason,
        actionId,
        expiration,
        durationInput: req.duration,
        durationTranslated,
        targetNetId: target.netid,
        targetIds: ids,
        targetHwids: hwids,
        targetName: target.name,
        kickMessage,
    });
    return { success: true, actionId };
};
