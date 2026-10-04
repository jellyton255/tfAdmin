const modulename = 'ApiServer:PlayerActions';
import { calcExpirationFromDuration } from '@lib/misc';
import playerResolver from '@lib/player/playerResolver';
import { ServerPlayer, type PlayerClass } from '@lib/player/playerClasses';
import type { AuthedAdmin } from '@modules/WebServer/authLogic';
import { ApiError } from '../envelope';
import { toApiAction } from '@routes/api/v1/actions';
import type { ApiActionRecord } from '@shared/apiV1Types';

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
    return { kickMessage, durationTranslated };
};


export const banPlayer = (admin: AuthedAdmin, player: PlayerClass, reasonInput: string, durationInput: string): ActionWriteResult => {
    const reason = reasonInput.trim() || 'no reason provided';
    const { expiration, duration } = parseBanDuration(durationInput);
    const allIds = player.allIdentifiers;
    const allHwids = player.allHardwareIdentifiers;
    if (!allIds.length) {
        throw new ApiError(409, 'CONFLICT', 'Cannot ban a player with no identifiers.');
    }

    let actionId: string;
    try {
        actionId = txCore.database.actions.registerBan(allIds, admin.name, reason, expiration, player.displayName, allHwids);
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to ban player: ${(error as Error).message}`);
    }
    admin.logAction(`Banned player "${player.displayName}": ${reason}`);

    let eventSent = false;
    if (!txCore.fxRunner.isIdle) {
        const authorPublicName = txCore.adminStore.getAdminPublicName(admin.name, 'punishment');
        const { kickMessage, durationTranslated } = buildBanKickMessage(authorPublicName, reason, expiration, duration);
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


export const warnPlayer = (admin: AuthedAdmin, player: PlayerClass, reasonInput: string): ActionWriteResult => {
    const reason = reasonInput.trim() || 'no reason provided';
    const allIds = player.allIdentifiers;
    if (!allIds.length) {
        throw new ApiError(409, 'CONFLICT', 'Cannot warn a player with no identifiers.');
    }

    let actionId: string;
    try {
        actionId = txCore.database.actions.registerWarn(allIds, admin.name, reason, player.displayName);
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to warn player: ${(error as Error).message}`);
    }
    admin.logAction(`Warned player "${player.displayName}": ${reason}`);

    const eventSent = !!txCore.fxRunner.sendEvent('playerWarned', {
        author: admin.name,
        reason,
        actionId,
        targetNetId: (player instanceof ServerPlayer && player.isConnected) ? player.netid : null,
        targetIds: allIds,
        targetName: player.displayName,
    });
    return { action: loadAction(actionId), eventSent };
};


export const kickPlayer = (admin: AuthedAdmin, player: PlayerClass, reasonInput?: string) => {
    const online = requireOnline(player);
    const kickReason = (reasonInput ?? '').trim() || txCore.translator.t('kick_messages.unknown_reason');
    admin.logAction(`Kicked "${online.displayName}": ${kickReason}`);
    const dropMessage = txCore.translator.t('kick_messages.player', { reason: kickReason });
    txCore.fxRunner.sendEvent('playerKicked', {
        target: online.netid,
        author: admin.name,
        reason: kickReason,
        dropMessage,
    });
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


export const setPlayerNote = (admin: AuthedAdmin, player: PlayerClass, noteInput: string) => {
    try {
        player.setNote(noteInput.trim(), admin.name);
    } catch (error) {
        throw new ApiError(409, 'CONFLICT', `Failed to save note: ${(error as Error).message}`);
    }
    admin.logAction(`Set notes for ${player.license}`);
};
