const modulename = 'ApiServer:ActionWrites';
import consts from '@shared/consts';
import type { DatabaseActionType } from '@modules/Database/databaseTypes';
import type { AuthedAdmin } from '@modules/WebServer/authLogic';
import { ApiError } from '../envelope';
import { toApiAction } from '@routes/api/v1/actions';
import { buildBanKickMessage, parseBanDuration, type ActionWriteResult } from './playerActions';

/**
 * Mirrors core/routes/history/actions.ts (ban by identifiers, revoke) for the public API.
 */


/**
 * Bans a list of identifiers that may not belong to a known player ("legacy ban").
 * No HWIDs: only banning a resolved player carries hardware ids.
 */
export const banIdentifiers = (admin: AuthedAdmin, identifiersInput: string[], reasonInput: string, durationInput: string): ActionWriteResult => {
    const reason = reasonInput.trim();
    const normalized = identifiersInput.map((id) => id.trim().toLowerCase());
    const invalids = normalized.filter((id) => {
        return !Object.values(consts.validIdentifiers).some((regex) => regex.test(id));
    });
    if (invalids.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid identifiers.', { invalids });
    }
    const identifiers = [...new Set(normalized)];
    const { expiration, duration } = parseBanDuration(durationInput);

    let actionId: string;
    try {
        actionId = txCore.database.actions.registerBan(identifiers, admin.name, reason, expiration, false);
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to ban identifiers: ${(error as Error).message}`);
    }
    admin.logAction(`Banned <${identifiers.join(';')}>: ${reason}`);

    let eventSent = false;
    try {
        const { kickMessage, durationTranslated } = buildBanKickMessage(admin.name, reason, expiration, duration);
        eventSent = !!txCore.fxRunner.sendEvent('playerBanned', {
            author: admin.name,
            reason,
            actionId,
            expiration,
            durationInput: durationInput.trim(),
            durationTranslated,
            targetNetId: null,
            targetIds: identifiers,
            targetHwids: [],
            targetName: 'identifiers',
            kickMessage,
        });
    } catch (error) { }

    const stored = txCore.database.actions.findOne(actionId);
    if (!stored) throw new ApiError(500, 'INTERNAL_ERROR', 'Action saved but could not be read back.');
    return { action: toApiAction(stored), eventSent };
};


/**
 * Revokes a ban or warn. The key needs players.ban to revoke bans and players.warn to revoke warns.
 */
export const revokeAction = (admin: AuthedAdmin, actionId: string) => {
    const existing = txCore.database.actions.findOne(actionId);
    if (!existing) {
        throw new ApiError(404, 'NOT_FOUND', 'Action not found.', { id: actionId });
    }
    const neededPermission = existing.type === 'ban' ? 'players.ban' : 'players.warn';
    if (!admin.hasPermission(neededPermission)) {
        throw new ApiError(403, 'FORBIDDEN', 'This API key lacks the required permission.', { permission: neededPermission });
    }
    if (existing.revocation.timestamp) {
        throw new ApiError(409, 'CONFLICT', 'This action was already revoked.', { id: actionId });
    }

    let action: DatabaseActionType;
    try {
        action = txCore.database.actions.revoke(actionId, admin.name, [existing.type]);
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to revoke action: ${(error as Error).message}`);
    }
    admin.logAction(`Revoked ${action.type} id ${actionId} from ${action.playerName ?? 'identifiers'}`);

    try {
        txCore.fxRunner.sendEvent('actionRevoked', {
            actionId: action.id,
            actionType: action.type,
            actionReason: action.reason,
            actionAuthor: action.author,
            playerName: action.playerName,
            playerIds: action.ids,
            playerHwids: 'hwids' in action ? action.hwids : [],
            revokedBy: admin.name,
        });
    } catch (error) { }

    return toApiAction(action);
};
