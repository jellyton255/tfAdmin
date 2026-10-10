const modulename = 'ApiServer:ActionWrites';
import consts from '@shared/consts';
import { now } from '@lib/misc';
import { filterPlayerHwids } from '@lib/player/idUtils';
import type { DatabaseActionType } from '@modules/Database/databaseTypes';
import type { AuthedAdmin } from '@modules/WebServer/authLogic';
import { ApiError } from '../envelope';
import { toApiAction } from '@routes/api/v1/actions';
import { buildBanKickMessage, parseBanDuration, type ActionWriteResult } from './playerActions';
import type { ApiActionRecord } from '@shared/apiV1Types';

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


export type ImportBanInput = {
    externalRef: string;
    identifiers: string[]; //trimmed and lowercased by the route schema
    hwids?: string[];
    playerName?: string | null;
    reason: string;
    author: string;
    expiresAt?: number | null; //epoch ms, omitted/null = permanent
    notify?: boolean;
};
export type ImportBanResult = { action: ApiActionRecord; created: boolean; dropped: string[]; eventSent: boolean };

const isValidIdentifier = (id: string) => Object.values(consts.validIdentifiers).some((regex) => regex.test(id));

/**
 * Records a ban issued by a game system or imported from the legacy game database (players.ban_import).
 * Idempotent on externalRef: a replay returns the stored action and writes nothing.
 * Silent unless notify is true: no in-game event, so no kick, announcement or webhook.
 */
export const importBan = (admin: AuthedAdmin, input: ImportBanInput): ImportBanResult => {
    const { externalRef, reason, author } = input;
    const dropped = input.identifiers.filter((id) => !isValidIdentifier(id));
    const identifiers = [...new Set(input.identifiers.filter(isValidIdentifier))];
    const { validHwidsArray, invalidHwidsArray } = filterPlayerHwids(input.hwids ?? []);
    dropped.push(...invalidHwidsArray);
    const hwids = [...new Set(validHwidsArray)];

    const existing = txCore.database.actions.findByExternalRef(externalRef);
    if (existing) {
        return { action: toApiAction(existing), created: false, dropped, eventSent: false };
    }
    if (!identifiers.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'No valid identifiers.', { invalids: dropped });
    }
    if (txCore.adminStore.getAdminByName(author)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'The author cannot be the name of a txAdmin admin.', { field: 'author' });
    }

    const expiration = typeof input.expiresAt === 'number' ? Math.floor(input.expiresAt / 1000) : false;
    let actionId: string;
    try {
        actionId = txCore.database.actions.importBan({
            ids: identifiers,
            hwids,
            playerName: input.playerName ?? false,
            reason,
            author,
            expiration,
            externalRef,
        });
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to import ban: ${(error as Error).message}`);
    }
    admin.logAction(`Imported ban ${externalRef} as ${actionId} (author ${author}): ${reason}`);

    let eventSent = false;
    if (input.notify === true) {
        try {
            const duration = expiration === false ? undefined : Math.max(1, expiration - now());
            const { kickMessage, durationTranslated } = buildBanKickMessage(author, reason, expiration, duration);
            eventSent = !!txCore.fxRunner.sendEvent('playerBanned', {
                author,
                reason,
                actionId,
                expiration,
                durationInput: duration === undefined ? 'permanent' : `${Math.ceil(duration / 3600)} hours`,
                durationTranslated,
                targetNetId: null,
                targetIds: identifiers,
                targetHwids: hwids,
                targetName: input.playerName ?? 'identifiers',
                kickMessage,
            });
        } catch (error) { }
    }

    const stored = txCore.database.actions.findOne(actionId);
    if (!stored) throw new ApiError(500, 'INTERNAL_ERROR', 'Action saved but could not be read back.');
    return { action: toApiAction(stored), created: true, dropped, eventSent };
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
