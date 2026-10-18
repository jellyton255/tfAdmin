const modulename = 'ApiServer:BanChanges';
import type { DatabaseActionBanType } from '@modules/Database/databaseTypes';
import { toApiAction } from '@routes/api/v1/actions';
import { ApiError } from '../envelope';
import { secToMs } from '../pagination';
import { findActionOr404, type NoteWriter } from './actionNotes';
import { parseBanDuration } from './playerActions';

/**
 * everfall: changes to a ban after it was issued, shared by the panel and the public API.
 */

const findBanOr409 = (actionId: string): DatabaseActionBanType => {
    const action = findActionOr404(actionId);
    if (action.type !== 'ban') {
        throw new ApiError(409, 'CONFLICT', 'Only bans can be changed this way.', { id: actionId });
    }
    return action;
};


/**
 * Changes a ban's length. The new length counts from when the ban was issued, so a ban shortened
 * below the time already served ends at once. Revoked bans cannot be changed.
 */
export const changeBanLength = (writer: NoteWriter, actionId: string, durationInput: string, reasonInput: string) => {
    const ban = findBanOr409(actionId);
    if (ban.revocation.timestamp) {
        throw new ApiError(409, 'CONFLICT', 'This ban was revoked.', { id: actionId });
    }
    const reason = reasonInput.trim();
    if (reason.length < 3) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'The reason must be at least 3 characters long.', { field: 'reason' });
    }
    const { duration } = parseBanDuration(durationInput);
    const expiration = duration === undefined ? false : ban.timestamp + duration;
    if (expiration === ban.expiration) {
        throw new ApiError(409, 'CONFLICT', 'The ban already has this length.', { id: actionId });
    }

    let updated: DatabaseActionBanType;
    try {
        updated = txCore.database.actions.changeBanLength(ban.id, expiration, writer.name, reason);
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to change the ban length: ${(error as Error).message}`);
    }
    writer.logAction(`Changed the length of ban ${ban.id} on ${ban.playerName || 'identifiers'} to ${durationInput.trim()}: ${reason}`);
    txCore.apiServer.publishEvent('action.lengthChanged', {
        actionId: ban.id,
        playerName: ban.playerName,
        playerIds: ban.ids,
        previousExpiresAt: ban.expiration === false ? null : secToMs(ban.expiration),
        expiresAt: expiration === false ? null : secToMs(expiration),
        changedBy: writer.name,
        reason,
    });
    return toApiAction(updated);
};
