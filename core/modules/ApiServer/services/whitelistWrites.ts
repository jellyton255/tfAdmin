const modulename = 'ApiServer:WhitelistWrites';
import { now } from '@lib/misc';
import { parsePlayerId } from '@lib/player/idUtils';
import { DuplicateKeyError } from '@modules/Database/dbUtils';
import type { DatabaseWhitelistApprovalsType, DatabaseWhitelistRequestsType } from '@modules/Database/databaseTypes';
import type { AuthedAdmin } from '@modules/WebServer/authLogic';
import { ApiError } from '../envelope';

/**
 * Mirrors core/routes/whitelist/actions.ts for the public API.
 */

export const parseIdentifier = (identifier: string) => {
    const parsed = parsePlayerId(identifier);
    if (!parsed.isIdValid || !parsed.idType || !parsed.idValue || !parsed.idlowerCased) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'The provided identifier is not valid.', { identifier });
    }
    return parsed as { idType: string; idValue: string; idlowerCased: string };
};


export const addApproval = async (admin: AuthedAdmin, identifierInput: string): Promise<DatabaseWhitelistApprovalsType> => {
    const { idType, idValue, idlowerCased } = parseIdentifier(identifierInput);

    let playerAvatar: string | null = null;
    let playerName = (idValue.length > 8) ? `${idType}...${idValue.slice(-8)}` : `${idType}:${idValue}`;
    if (idType === 'discord') {
        try {
            const { tag, avatar } = await txCore.discordBot.resolveMemberProfile(idValue);
            playerName = tag;
            playerAvatar = avatar;
        } catch (error) { }
    }

    const approval: DatabaseWhitelistApprovalsType = {
        identifier: idlowerCased,
        playerName,
        playerAvatar,
        tsApproved: now(),
        approvedBy: admin.name,
    };
    try {
        txCore.database.whitelist.registerApproval(approval);
    } catch (error) {
        if (error instanceof DuplicateKeyError) {
            throw new ApiError(409, 'CONFLICT', 'This identifier is already whitelisted.', { identifier: idlowerCased });
        }
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to save whitelist approval: ${(error as Error).message}`);
    }
    txCore.fxRunner.sendEvent('whitelistPreApproval', {
        action: 'added',
        identifier: idlowerCased,
        playerName,
        adminName: admin.name,
    });
    admin.logAction(`Added whitelist approval for ${playerName}.`);
    return approval;
};


export const removeApproval = (admin: AuthedAdmin, identifierInput: string) => {
    const { idlowerCased } = parseIdentifier(identifierInput);
    let removed: DatabaseWhitelistApprovalsType[];
    try {
        removed = txCore.database.whitelist.removeManyApprovals({ identifier: idlowerCased });
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to remove whitelist approval: ${(error as Error).message}`);
    }
    if (!removed.length) {
        throw new ApiError(404, 'NOT_FOUND', 'No whitelist approval for this identifier.', { identifier: idlowerCased });
    }
    txCore.fxRunner.sendEvent('whitelistPreApproval', {
        action: 'removed',
        identifier: idlowerCased,
        adminName: admin.name,
    });
    admin.logAction(`Removed whitelist approval from ${idlowerCased}.`);
};


export const approveRequest = (admin: AuthedAdmin, reqId: string): DatabaseWhitelistApprovalsType => {
    const requests = txCore.database.whitelist.findManyRequests({ id: reqId });
    if (!requests.length) {
        throw new ApiError(404, 'NOT_FOUND', 'Whitelist request not found.', { id: reqId });
    }
    const req = requests[0];
    const playerName = req.discordTag ?? req.playerDisplayName;
    const approval: DatabaseWhitelistApprovalsType = {
        identifier: `license:${req.license}`,
        playerName,
        playerAvatar: req.discordAvatar ? req.discordAvatar : null,
        tsApproved: now(),
        approvedBy: admin.name,
    };
    try {
        txCore.database.whitelist.registerApproval(approval);
        txCore.fxRunner.sendEvent('whitelistRequest', {
            action: 'approved',
            playerName,
            requestId: req.id,
            license: req.license,
            adminName: admin.name,
        });
    } catch (error) {
        if (!(error instanceof DuplicateKeyError)) {
            throw new ApiError(500, 'INTERNAL_ERROR', `Failed to save whitelist approval: ${(error as Error).message}`);
        }
    }
    admin.logAction(`Approved whitelist request from ${playerName}.`);
    try {
        txCore.database.whitelist.removeManyRequests({ id: reqId });
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to remove whitelist request: ${(error as Error).message}`);
    }
    return approval;
};


export const denyRequest = (admin: AuthedAdmin, reqId: string) => {
    let removed: DatabaseWhitelistRequestsType[];
    try {
        removed = txCore.database.whitelist.removeManyRequests({ id: reqId });
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to remove whitelist request: ${(error as Error).message}`);
    }
    if (!removed.length) {
        throw new ApiError(404, 'NOT_FOUND', 'Whitelist request not found.', { id: reqId });
    }
    const req = removed[0];
    txCore.fxRunner.sendEvent('whitelistRequest', {
        action: 'denied',
        playerName: req.playerDisplayName,
        requestId: req.id,
        license: req.license,
        adminName: admin.name,
    });
    admin.logAction(`Denied whitelist request ${reqId}.`);
};


/**
 * Denies every pending request whose last attempt is at or before `beforeMs` (default: now),
 * so requests that arrive while the caller is deciding are kept.
 */
export const denyAllRequests = (admin: AuthedAdmin, beforeMs?: number) => {
    const cutoff = beforeMs ? Math.floor(beforeMs / 1000) : now();
    let removed: DatabaseWhitelistRequestsType[];
    try {
        removed = txCore.database.whitelist.removeManyRequests((req: DatabaseWhitelistRequestsType) => req.tsLastAttempt <= cutoff);
        txCore.fxRunner.sendEvent('whitelistRequest', {
            action: 'deniedAll',
            adminName: admin.name,
        });
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to remove whitelist requests: ${(error as Error).message}`);
    }
    admin.logAction('Denied all whitelist requests.');
    return removed.length;
};
