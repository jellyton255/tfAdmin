const modulename = 'WebServer:MasterActions:Action';
import { z } from 'zod';
import { DatabaseActionType, DatabasePlayerType } from '@modules/Database/databaseTypes';
import { now } from '@lib/misc';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type {
    MasterActionsCleanDatabaseReq,
    MasterActionsCleanDatabaseResp,
    MasterActionsRevokeWhitelistsReq,
    MasterActionsRevokeWhitelistsResp,
} from '@shared/masterActionsApiTypes';
const console = consoleFactory(modulename);

const DAY_SECS = 86400;


/**
 * Handle all the master actions... actions
 */
export default async function MasterActionsAction(ctx: AuthedCtx) {
    //Sanity check
    if (typeof ctx.params.action !== 'string') {
        return ctx.send({ error: 'Invalid Request' });
    }
    const action = ctx.params.action;

    //Check permissions
    if (!ctx.admin.testPermission('master', modulename)) {
        return ctx.send({ error: 'Only the master account has permission to view/use this page.' });
    }
    if (!ctx.txVars.isWebInterface) {
        return ctx.send({ error: 'This functionality cannot be used by the in-game menu, please use the web version of txAdmin.' });
    }

    //Delegate to the specific action functions
    if (action == 'cleanDatabase') {
        return handleCleanDatabase(ctx);
    } else if (action == 'revokeWhitelists') {
        return handleRevokeWhitelists(ctx);
    } else {
        return ctx.send({ error: 'Unknown settings action.' });
    }
};


/**
 * Handle clean database request
 */
const cleanDatabaseSchema = z.object({
    players: z.enum(['none', '60d', '30d', '15d']),
    bans: z.enum(['none', 'revoked', 'revokedExpired', 'all']),
    warns: z.enum(['none', 'revoked', '30d', '15d', '7d', 'all']),
    hwids: z.enum(['none', 'players', 'bans', 'all']),
}) satisfies z.ZodType<MasterActionsCleanDatabaseReq>;

async function handleCleanDatabase(ctx: AuthedCtx) {
    const sendTypedResp = (data: MasterActionsCleanDatabaseResp) => ctx.send(data);
    const parsed = cleanDatabaseSchema.safeParse(ctx.request.body);
    if (!parsed.success) {
        return sendTypedResp({ error: 'Invalid Request' });
    }
    const { players, bans, warns, hwids } = parsed.data;
    const currTs = now();
    const olderThan = (ts: number, days: number) => ts < (currTs - days * DAY_SECS);

    //Prepare filters
    const playersFilter = (x: DatabasePlayerType) => {
        if (players === 'none') return false;
        return olderThan(x.tsLastConnection, parseInt(players)) && !x.notes;
    };
    const bansFilter = (x: DatabaseActionType) => {
        if (x.type !== 'ban' || bans === 'none') return false;
        if (bans === 'all') return true;
        if (bans === 'revoked') return !!x.revocation.timestamp;
        return !!x.revocation.timestamp || !!(x.expiration && x.expiration < currTs);
    };
    const warnsFilter = (x: DatabaseActionType) => {
        if (x.type !== 'warn' || warns === 'none') return false;
        if (warns === 'all') return true;
        if (warns === 'revoked') return !!x.revocation.timestamp;
        return olderThan(x.timestamp, parseInt(warns));
    };
    const actionsFilter = (x: DatabaseActionType) => bansFilter(x) || warnsFilter(x);
    const hwidsWipePlayers = hwids === 'players' || hwids === 'all';
    const hwidsWipeBans = hwids === 'bans' || hwids === 'all';

    //Run db cleaner
    const tsStart = Date.now();
    let playersRemoved = 0;
    try {
        playersRemoved = txCore.database.cleanup.bulkRemove('players', playersFilter);
    } catch (error) {
        return sendTypedResp({ error: `Failed to clean players with error: ${(error as Error).message}` });
    }

    let actionsRemoved = 0;
    try {
        actionsRemoved = txCore.database.cleanup.bulkRemove('actions', actionsFilter);
    } catch (error) {
        return sendTypedResp({ error: `Failed to clean actions with error: ${(error as Error).message}` });
    }

    let hwidsRemoved = 0;
    try {
        hwidsRemoved = txCore.database.cleanup.wipeHwids(hwidsWipePlayers, hwidsWipeBans);
    } catch (error) {
        return sendTypedResp({ error: `Failed to clean HWIDs with error: ${(error as Error).message}` });
    }

    //Return results
    const msElapsed = Date.now() - tsStart;
    return sendTypedResp({ msElapsed, playersRemoved, actionsRemoved, hwidsRemoved });
}


/**
 * Handle revoke whitelists request
 */
const revokeWhitelistsSchema = z.object({
    filter: z.enum(['all', '30d', '15d', '7d']),
}) satisfies z.ZodType<MasterActionsRevokeWhitelistsReq>;

async function handleRevokeWhitelists(ctx: AuthedCtx) {
    const sendTypedResp = (data: MasterActionsRevokeWhitelistsResp) => ctx.send(data);
    const parsed = revokeWhitelistsSchema.safeParse(ctx.request.body);
    if (!parsed.success) {
        return sendTypedResp({ error: 'Invalid Request' });
    }
    const { filter } = parsed.data;
    const currTs = now();
    const filterFunc = (p: DatabasePlayerType) => {
        if (filter === 'all') return true;
        return p.tsLastConnection < (currTs - parseInt(filter) * DAY_SECS);
    };

    try {
        const tsStart = Date.now();
        const cntRemoved = txCore.database.players.bulkRevokeWhitelist(filterFunc);
        const msElapsed = Date.now() - tsStart;
        return sendTypedResp({ msElapsed, cntRemoved });
    } catch (error) {
        return sendTypedResp({ error: `Failed to revoke allowlists with error: ${(error as Error).message}` });
    }
}
