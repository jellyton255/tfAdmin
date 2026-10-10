import { z } from 'zod';
import Fuse from 'fuse.js';
import { union } from 'lodash-es';
import { now } from '@lib/misc';
import { parseLaxIdsArrayInput } from '@lib/player/idUtils';
import type { DatabaseActionType } from '@modules/Database/databaseTypes';
import { ApiError, sendData } from '@modules/ApiServer/envelope';
import { decodeCursor, limitSchema, paginate, secToMs } from '@modules/ApiServer/pagination';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import type { ApiActionRecord } from '@shared/apiV1Types';

const idParamSchema = z.object({ id: z.string().trim().min(1).max(32) });
const searchQuerySchema = z.object({
    q: z.string().trim().min(1).max(256).optional(),
    type: z.enum(['id', 'reason', 'name', 'ids']).default('ids'),
    kind: z.enum(['ban', 'warn']).optional(),
    author: z.string().trim().min(1).max(128).optional(),
    status: z.enum(['active', 'revoked']).optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    limit: limitSchema,
    cursor: z.string().max(256).optional(),
});


/**
 * Converts a database action into the API shape (epoch ms, explicit ban status).
 */
export const toApiAction = (a: DatabaseActionType, currTs = now()): ApiActionRecord => {
    let banStatus: ApiActionRecord['banStatus'] = null;
    let expiresAt: number | null = null;
    if (a.type === 'ban') {
        if (a.expiration === false) {
            banStatus = 'permanent';
        } else {
            expiresAt = secToMs(a.expiration);
            banStatus = a.expiration < currTs ? 'expired' : 'active';
        }
    }
    return {
        id: a.id,
        type: a.type,
        playerName: a.playerName === false ? null : a.playerName,
        ids: a.ids,
        hwids: 'hwids' in a && a.hwids ? a.hwids : [],
        reason: a.reason,
        author: a.author,
        createdAt: secToMs(a.timestamp) ?? 0,
        expiresAt,
        banStatus,
        acked: a.type === 'warn' ? a.acked : null,
        revokedAt: secToMs(a.revocation.timestamp),
        revokedBy: a.revocation.author ?? null,
        externalRef: a.type === 'ban' ? a.externalRef ?? null : null,
    };
};


/**
 * GET /api/v1/actions?q=&type=ids|id|reason|name&kind=ban|warn&author=&status=active|revoked
 *     &order=desc|asc&limit=50&cursor=
 * Mirrors the panel's History table search, with cursor pagination.
 */
export async function search(ctx: ApiKeyCtx) {
    const query = searchQuerySchema.parse(ctx.query);
    const cursor = decodeCursor(query.cursor);
    const desc = query.order === 'desc';

    let actions = txCore.database.getDboRef().chain.get('actions').value().filter((a) => {
        if (query.kind && a.type !== query.kind) return false;
        if (query.author && a.author !== query.author) return false;
        if (query.status === 'active' && a.revocation.timestamp) return false;
        if (query.status === 'revoked' && !a.revocation.timestamp) return false;
        return true;
    });

    if (query.q) {
        if (query.type === 'id') {
            //exact id first, then prefix, then fuzzy (like the panel)
            const cleanId = query.q.toUpperCase();
            const exact = actions.filter((a) => a.id === cleanId);
            const prefixed = actions.filter((a) => a.id.startsWith(cleanId));
            if (exact.length) {
                actions = exact;
            } else if (prefixed.length) {
                actions = prefixed;
            } else {
                const fuse = new Fuse(actions, { isCaseSensitive: true, keys: ['id'], threshold: 0.3 });
                actions = fuse.search(cleanId).map((x) => x.item);
            }
        } else if (query.type === 'reason') {
            const fuse = new Fuse(actions, { keys: ['reason'], threshold: 0.3 });
            actions = fuse.search(query.q).map((x) => x.item);
        } else if (query.type === 'name') {
            const fuse = new Fuse(actions, { keys: ['playerName'], threshold: 0.3 });
            actions = fuse.search(query.q).map((x) => x.item);
        } else {
            const { validIds, validHwids, invalids } = parseLaxIdsArrayInput(query.q);
            if (invalids.length) {
                throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid identifiers. Prefix each one with its type, like fivem:123456.', { invalids });
            }
            if (!validIds.length && !validHwids.length) {
                throw new ApiError(400, 'VALIDATION_ERROR', 'No valid identifiers found.');
            }
            actions = actions.filter((a) => {
                if (validIds.length && !validIds.some((id) => a.ids.includes(id))) return false;
                if (validHwids.length && !('hwids' in a && a.hwids?.some((hwid) => validHwids.includes(hwid)))) return false;
                return true;
            });
        }
    }

    actions = [...actions].sort((a, b) => desc ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);
    const page = paginate(actions, query.limit, cursor, (a) => a.timestamp, (a) => a.id, desc);
    const currTs = now();
    return sendData(ctx, {
        actions: page.items.map((a) => toApiAction(a, currTs)),
    }, 200, page.meta);
};


/**
 * GET /api/v1/actions/stats
 */
export async function stats(ctx: ApiKeyCtx) {
    const dbStats = txCore.database.stats.getActionStats();
    const dbAdmins = Object.keys(dbStats.groupedByAdmins);
    const vaultAdmins = txCore.adminStore.getAdminsList().map((a: { name: string }) => a.name);
    const byAdmin = union(dbAdmins, vaultAdmins)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ name, actions: dbStats.groupedByAdmins[name] ?? 0 }));
    return sendData(ctx, {
        totalWarns: dbStats.totalWarns,
        warnsLast7d: dbStats.warnsLast7d,
        totalBans: dbStats.totalBans,
        bansLast7d: dbStats.bansLast7d,
        byAdmin,
    });
};


/**
 * GET /api/v1/actions/:id
 */
export async function get(ctx: ApiKeyCtx) {
    const { id } = idParamSchema.parse(ctx.params);
    const action = txCore.database.actions.findOne(id.toUpperCase());
    if (!action) {
        throw new ApiError(404, 'NOT_FOUND', 'Action not found.', { id });
    }
    return sendData(ctx, { action: toApiAction(action) });
};
