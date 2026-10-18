const modulename = 'ApiServer:PlayerActions';
import { calcExpirationFromDuration } from '@lib/misc';
import playerResolver from '@lib/player/playerResolver';
import { ServerPlayer, type PlayerClass } from '@lib/player/playerClasses';
import type { AuthedAdmin } from '@modules/WebServer/authLogic';
import { ApiError } from '../envelope';
import { toApiAction } from '@routes/api/v1/actions';
import { toApiNote, toApiWatch } from '@routes/api/v1/players';
import { normalizeTags } from '@lib/player/playerTags';
import type { ApiActionRecord } from '@shared/apiV1Types';
import { addActionNote, type NoteWriter } from './actionNotes';
import { presetRuleUrl } from '@lib/presetRule';

/**
 * Player moderation service used by the public API.
 * It mirrors core/routes/player/actions.ts (the panel's player modal) step for step: same database
 * calls, same admin log lines, same `txAdmin:events:*` payloads. The panel route is left untouched
 * so upstream syncs stay clean; keep the two in step when upstream changes one of them.
 */

export type ActionWriteResult = { action: ApiActionRecord; eventSent: boolean };

const loadAction = (actionId: string): ApiActionRecord => {
    const stored = txCore.database.actions.findOne(actionId);
    if (!stored) throw new ApiError(500, 'INTERNAL_ERROR', 'Action saved but could not be read back.');
    return toApiAction(stored);
};

/**
 * Resolves a player by license: the connected session when online, else the database record.
 */
export const resolvePlayer = (license: string): PlayerClass => {
    try {
        return playerResolver(undefined, undefined, license.toLowerCase());
    } catch (error) {
        throw new ApiError(404, 'NOT_FOUND', 'Player not found.', { license });
    }
};

/**
 * Saves the optional staff note given with a sanction. Blank notes are ignored.
 */
export const addSanctionNote = (writer: NoteWriter, actionId: string, note: string | undefined) => {
    if (note?.trim()) addActionNote(writer, actionId, note);
};

/**
 * Records a moderation kick and returns its id, or undefined when there is no identifier to record.
 * Kick-all, restarts and ban drops are not recorded.
 */
export const recordKick = (author: string, ids: string[], reason: string, playerName: string) => {
    if (!ids.length) return undefined;
    return txCore.database.actions.registerKick(ids, author, reason, playerName);
};

/**
 * everfall: checks that a preset id sent with a ban or warn names a configured preset
 */
export const resolvePresetId = (presetId: string | undefined) => {
    if (!presetId) return undefined;
    if (!txConfig.banlist.templates.some((preset) => preset.id === presetId)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'That punishment preset does not exist.', { field: 'presetId' });
    }
    return presetId;
};

const requireOnline = (player: PlayerClass): ServerPlayer => {
    if (!txCore.fxRunner.child?.isAlive) {
        throw new ApiError(503, 'SERVER_OFFLINE', 'The server is not running.');
    }
    if (!(player instanceof ServerPlayer) || !player.isConnected) {
        throw new ApiError(409, 'PLAYER_OFFLINE', 'This player is not connected to the server.');
    }
    return player;
};

export const parseBanDuration = (input: string) => {
    try {
        return calcExpirationFromDuration(input.trim());
    } catch (error) {
        throw new ApiError(400, 'VALIDATION_ERROR', (error as Error).message, { field: 'duration' });
    }
};

/**
 * Builds the kick message and translated duration for a ban event.
 */
export const buildBanKickMessage = (
    authorPublicName: string,
    reason: string,
    expiration: number | false,
    duration: number | undefined,
    ruleUrl: string | null = null,
) => {
    const tOptions: any = { author: authorPublicName, reason };
    let durationTranslated: string | null = null;
    let kickMessage: string;
    if (expiration !== false && duration) {
        durationTranslated = txCore.translator.tDuration(duration * 1000, { units: ['d', 'h'] });
        tOptions.expiration = durationTranslated;
        kickMessage = txCore.translator.t('ban_messages.kick_temporary', tOptions);
    } else {
        kickMessage = txCore.translator.t('ban_messages.kick_permanent', tOptions);
    }
    if (ruleUrl) kickMessage += ` ${txCore.translator.t('ban_messages.rule', { url: ruleUrl })}`;
    return { kickMessage, durationTranslated };
};


export const banPlayer = (admin: AuthedAdmin, player: PlayerClass, reasonInput: string, durationInput: string, note?: string, presetIdInput?: string): ActionWriteResult => {
    const reason = reasonInput.trim() || 'no reason provided';
    const presetId = resolvePresetId(presetIdInput);
    const { expiration, duration } = parseBanDuration(durationInput);
    const allIds = player.allIdentifiers;
    const allHwids = player.allHardwareIdentifiers;
    if (!allIds.length) {
        throw new ApiError(409, 'CONFLICT', 'Cannot ban a player with no identifiers.');
    }

    let actionId: string;
    try {
        actionId = txCore.database.actions.registerBan(allIds, admin.name, reason, expiration, player.displayName, allHwids, presetId);
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to ban player: ${(error as Error).message}`);
    }
    admin.logAction(`Banned player "${player.displayName}": ${reason}`);
    addSanctionNote(admin, actionId, note);

    let eventSent = false;
    if (!txCore.fxRunner.isIdle) {
        const authorPublicName = txCore.adminStore.getAdminPublicName(admin.name, 'punishment');
        const { kickMessage, durationTranslated } = buildBanKickMessage(authorPublicName, reason, expiration, duration, presetRuleUrl(presetId));
        eventSent = !!txCore.fxRunner.sendEvent('playerBanned', {
            author: admin.name,
            reason,
            actionId,
            expiration,
            durationInput: durationInput.trim(),
            durationTranslated,
            targetNetId: (player instanceof ServerPlayer) ? player.netid : null,
            targetIds: allIds,
            targetHwids: allHwids,
            targetName: player.displayName,
            kickMessage,
        });
    }
    return { action: loadAction(actionId), eventSent };
};


export const warnPlayer = (admin: AuthedAdmin, player: PlayerClass, reasonInput: string, note?: string, presetIdInput?: string): ActionWriteResult => {
    const reason = reasonInput.trim() || 'no reason provided';
    const presetId = resolvePresetId(presetIdInput);
    const allIds = player.allIdentifiers;
    if (!allIds.length) {
        throw new ApiError(409, 'CONFLICT', 'Cannot warn a player with no identifiers.');
    }

    let actionId: string;
    try {
        actionId = txCore.database.actions.registerWarn(allIds, admin.name, reason, player.displayName, presetId);
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to warn player: ${(error as Error).message}`);
    }
    admin.logAction(`Warned player "${player.displayName}": ${reason}`);
    addSanctionNote(admin, actionId, note);

    const eventSent = !!txCore.fxRunner.sendEvent('playerWarned', {
        author: admin.name,
        reason,
        actionId,
        ruleUrl: presetRuleUrl(presetId),
        targetNetId: (player instanceof ServerPlayer && player.isConnected) ? player.netid : null,
        targetIds: allIds,
        targetName: player.displayName,
    });
    return { action: loadAction(actionId), eventSent };
};


export const kickPlayer = (admin: AuthedAdmin, player: PlayerClass, reasonInput?: string, note?: string) => {
    const online = requireOnline(player);
    const kickReason = (reasonInput ?? '').trim() || txCore.translator.t('kick_messages.unknown_reason');
    let actionId: string | undefined;
    try {
        actionId = recordKick(admin.name, online.allIdentifiers, kickReason, online.displayName);
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to record kick: ${(error as Error).message}`);
    }
    admin.logAction(`Kicked "${online.displayName}": ${kickReason}`);
    if (actionId) addSanctionNote(admin, actionId, note);
    const dropMessage = txCore.translator.t('kick_messages.player', { reason: kickReason });
    txCore.fxRunner.sendEvent('playerKicked', {
        target: online.netid,
        author: admin.name,
        reason: kickReason,
        dropMessage,
        actionId: actionId ?? null,
        targetName: online.displayName,
    });
    return actionId ? loadAction(actionId) : null;
};


export const messagePlayer = (admin: AuthedAdmin, player: PlayerClass, messageInput: string) => {
    const message = messageInput.trim();
    if (!message.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot send a DM with an empty message.', { field: 'message' });
    }
    const online = requireOnline(player);
    admin.logAction(`DM to "${online.displayName}": ${message}`);
    txCore.fxRunner.sendEvent('playerDirectMessage', {
        target: online.netid,
        author: admin.name,
        message,
    });
};


export const setPlayerWhitelist = (admin: AuthedAdmin, player: PlayerClass, whitelisted: boolean) => {
    try {
        player.setWhitelist(whitelisted);
    } catch (error) {
        throw new ApiError(409, 'CONFLICT', `Failed to save whitelist status: ${(error as Error).message}`);
    }
    admin.logAction(whitelisted
        ? `Added ${player.license} to the whitelist.`
        : `Removed ${player.license} from the whitelist.`);
    txCore.fxRunner.sendEvent('whitelistPlayer', {
        action: whitelisted ? 'added' : 'removed',
        license: player.license,
        playerName: player.displayName,
        adminName: admin.name,
    });
};


/**
 * Appends a staff note to the player's note history.
 */
export const addPlayerNote = (admin: AuthedAdmin, player: PlayerClass, noteInput: string) => {
    const text = noteInput.trim();
    if (!text.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot save an empty note.', { field: 'note' });
    }
    let note;
    try {
        note = player.addNote(text, admin.name);
    } catch (error) {
        throw new ApiError(409, 'CONFLICT', `Failed to save note: ${(error as Error).message}`);
    }
    admin.logAction(`Set notes for ${player.license}`);
    return toApiNote(note);
};


export const deletePlayerNote = (admin: AuthedAdmin, player: PlayerClass, noteId: string) => {
    const dbData = player.getDbData();
    if (!dbData || !dbData.noteHistory?.some((note) => note.id === noteId)) {
        throw new ApiError(404, 'NOT_FOUND', 'Note not found.', { noteId });
    }
    const note = player.deleteNote(noteId);
    admin.logAction(`Deleted note ${noteId} from ${player.license}`);
    return toApiNote(note);
};


/**
 * Puts the player on the watchlist, or replaces the reason when already watched.
 */
export const watchPlayer = (admin: AuthedAdmin, player: PlayerClass, reasonInput: string) => {
    const reason = reasonInput.trim();
    if (!reason.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Say why this player is being watched.', { field: 'reason' });
    }
    let watch;
    try {
        watch = player.setWatch(reason, admin.name);
    } catch (error) {
        throw new ApiError(409, 'CONFLICT', `Failed to watch player: ${(error as Error).message}`);
    }
    admin.logAction(`Added ${player.license} to the watchlist: ${reason}`);
    return toApiWatch(watch);
};


export const unwatchPlayer = (admin: AuthedAdmin, player: PlayerClass) => {
    const dbData = player.getDbData();
    if (!dbData || !dbData.watch) {
        throw new ApiError(404, 'NOT_FOUND', 'This player is not on the watchlist.');
    }
    player.clearWatch();
    admin.logAction(`Removed ${player.license} from the watchlist.`);
};


/**
 * Replaces the player's tags and returns them as saved.
 */
export const setPlayerTags = (admin: AuthedAdmin, player: PlayerClass, tagsInput: string[]) => {
    let tags;
    try {
        tags = normalizeTags(tagsInput);
    } catch (error) {
        throw new ApiError(400, 'VALIDATION_ERROR', (error as Error).message, { field: 'tags' });
    }
    try {
        player.setTags(tags);
    } catch (error) {
        throw new ApiError(409, 'CONFLICT', `Failed to save tags: ${(error as Error).message}`);
    }
    admin.logAction(`Set tags for ${player.license}: ${tags.join(', ') || 'none'}`);
    return tags;
};
