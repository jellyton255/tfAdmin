import { z } from 'zod';
import Fuse from 'fuse.js';
import { now } from '@lib/misc';
import { parseLaxIdsArrayInput } from '@lib/player/idUtils';
import playerResolver from '@lib/player/playerResolver';
import { ServerPlayer } from '@lib/player/playerClasses';
import cleanPlayerName from '@shared/cleanPlayerName';
import type { DatabasePlayerType } from '@modules/Database/databaseTypes';
import { ApiError, sendData } from '@modules/ApiServer/envelope';
import { decodeCursor, limitSchema, paginate, secToMs } from '@modules/ApiServer/pagination';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import type { ApiPlayerDetail, ApiPlayerSummary } from '@shared/apiV1Types';
import { toApiAction } from './actions';

const licenseSchema = z.string().regex(/^[0-9a-f]{40}$/i, 'license must be 40 hex characters');
const licenseParamSchema = z.object({ license: licenseSchema });

const SORT_KEYS = ['playTime', 'tsJoined', 'tsLastConnection'] as const;
const FILTERS = ['isAdmin', 'isOnline', 'isWhitelisted', 'hasNote'] as const;
const searchQuerySchema = z.object({
    q: z.string().trim().min(1).max(256).optional(),
    type: z.enum(['name', 'ids', 'notes']).default('name'),
    filter: z.string().max(128).optional(),
    sort: z.enum(SORT_KEYS).default('tsLastConnection'),
    order: z.enum(['asc', 'desc']).default('desc'),
    limit: limitSchema,
    cursor: z.string().max(256).optional(),
});


/**
 * Helpers
 */
const toSummary = (
    p: DatabasePlayerType,
    adminIds: string[],
    onlineLicenses: Set<string>,
): ApiPlayerSummary => ({
    license: p.license,
    displayName: p.displayName,
    pureName: p.pureName,
    playTime: p.playTime,
    joinedAt: secToMs(p.tsJoined) ?? 0,
    lastConnectionAt: secToMs(p.tsLastConnection) ?? 0,
    whitelistedAt: secToMs(p.tsWhitelisted),
    notes: p.notes?.text ?? null,
    isAdmin: p.ids.some((id) => adminIds.includes(id)),
    isOnline: onlineLicenses.has(p.license),
});


/**
 * GET /api/v1/players/online - players connected right now
 */
export async function online(ctx: ApiKeyCtx) {
    return sendData(ctx, { players: txCore.fxPlayerlist.getPlayerList() });
};


/**
 * GET /api/v1/players/stats
 */
export async function stats(ctx: ApiKeyCtx) {
    return sendData(ctx, {
        ...txCore.database.stats.getPlayersStats(),
        onlineNow: txCore.fxPlayerlist.onlineCount,
    });
};


/**
 * GET /api/v1/players?q=&type=name|ids|notes&filter=isOnline,isAdmin,isWhitelisted,hasNote
 *     &sort=playTime|tsJoined|tsLastConnection&order=desc|asc&limit=50&cursor=
 * Mirrors the panel's Players table search, with cursor pagination.
 */
export async function search(ctx: ApiKeyCtx) {
    const query = searchQuerySchema.parse(ctx.query);
    const cursor = decodeCursor(query.cursor);
    const desc = query.order === 'desc';
    const adminIds = txCore.adminStore.getAdminsIdentifiers();
    const onlineLicenses = txCore.fxPlayerlist.getOnlinePlayersLicenses();

    //Filters
    const filters = new Set((query.filter ?? '').split(',').map((f) => f.trim()).filter(Boolean));
    const unknownFilters = [...filters].filter((f) => !(FILTERS as readonly string[]).includes(f));
    if (unknownFilters.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown filter.', { filters: unknownFilters, allowed: FILTERS });
    }
    const filterFns: Record<typeof FILTERS[number], (p: DatabasePlayerType) => boolean> = {
        isAdmin: (p) => p.ids.some((id) => adminIds.includes(id)),
        isOnline: (p) => onlineLicenses.has(p.license),
        isWhitelisted: (p) => !!p.tsWhitelisted,
        hasNote: (p) => !!p.notes?.text,
    };

    let players = txCore.database.players.findMany((p: DatabasePlayerType) => {
        for (const f of filters) {
            if (!filterFns[f as typeof FILTERS[number]](p)) return false;
        }
        return true;
    });

    //Search (heavy)
    if (query.q) {
        if (query.type === 'name') {
            const { pureName } = cleanPlayerName(query.q);
            if (pureName === 'emptyname') {
                throw new ApiError(400, 'VALIDATION_ERROR', 'This player name is unsearchable.');
            }
            const fuse = new Fuse(players, { isCaseSensitive: true, keys: ['pureName'], threshold: 0.3 });
            players = fuse.search(pureName).map((x) => x.item);
        } else if (query.type === 'notes') {
            const fuse = new Fuse(players, { keys: ['notes.text'], threshold: 0.3 });
            players = fuse.search(query.q).map((x) => x.item);
        } else {
            const { validIds, validHwids, invalids } = parseLaxIdsArrayInput(query.q);
            if (invalids.length) {
                throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid identifiers. Prefix each one with its type, like fivem:123456.', { invalids });
            }
            if (!validIds.length && !validHwids.length) {
                throw new ApiError(400, 'VALIDATION_ERROR', 'No valid identifiers found.');
            }
            players = players.filter((p) => {
                if (validIds.length && !validIds.some((id) => p.ids.includes(id))) return false;
                if (validHwids.length && !validHwids.some((hwid) => p.hwids.includes(hwid))) return false;
                return true;
            });
        }
    }

    //Sort + paginate
    const sortKey = query.sort;
    players.sort((a, b) => desc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]);
    const page = paginate(players, query.limit, cursor, (p) => p[sortKey], (p) => p.license, desc);

    return sendData(ctx, {
        players: page.items.map((p) => toSummary(p, adminIds, onlineLicenses)),
    }, 200, page.meta);
};


/**
 * GET /api/v1/players/:license - database record, current session (if online) and action history
 */
export async function get(ctx: ApiKeyCtx) {
    const { license } = licenseParamSchema.parse(ctx.params);
    let player;
    try {
        player = playerResolver(undefined, undefined, license.toLowerCase());
    } catch (error) {
        throw new ApiError(404, 'NOT_FOUND', 'Player not found.', { license });
    }
    const dbData = player.getDbData();
    if (!dbData) {
        throw new ApiError(404, 'NOT_FOUND', 'Player not found.', { license });
    }

    const adminIds = txCore.adminStore.getAdminsIdentifiers();
    const onlineLicenses = txCore.fxPlayerlist.getOnlinePlayersLicenses();
    const currTs = now();
    const detail: ApiPlayerDetail = {
        ...toSummary(dbData, adminIds, onlineLicenses),
        ids: dbData.ids,
        hwids: dbData.hwids,
        notesLastEditedBy: dbData.notes?.lastAdmin ?? null,
        notesLastEditedAt: secToMs(dbData.notes?.tsLastEdit),
        session: player instanceof ServerPlayer && player.isConnected ? {
            netid: player.netid,
            connectedAt: secToMs(player.tsConnected) ?? 0,
            idsOnline: player.idsOnline,
            hwidsOnline: player.hwidsOnline,
        } : null,
        actions: player.getHistory()
            .sort((a, b) => b.timestamp - a.timestamp)
            .map((a) => toApiAction(a, currTs)),
    };
    return sendData(ctx, { player: detail });
};
