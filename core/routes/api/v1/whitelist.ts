import { z } from 'zod';
import Fuse from 'fuse.js';
import cleanPlayerName from '@shared/cleanPlayerName';
import { sendData } from '@modules/ApiServer/envelope';
import { decodeCursor, limitSchema, paginate, secToMs } from '@modules/ApiServer/pagination';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import type { ApiWhitelistApproval, ApiWhitelistRequest } from '@shared/apiV1Types';

const listQuerySchema = z.object({
    q: z.string().trim().min(1).max(256).optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    limit: limitSchema,
    cursor: z.string().max(256).optional(),
});


/**
 * GET /api/v1/whitelist/approvals?q=&order=&limit=&cursor=
 * Approved identifiers (license/discord), newest first.
 */
export async function approvals(ctx: ApiKeyCtx) {
    const query = listQuerySchema.parse(ctx.query);
    const cursor = decodeCursor(query.cursor);
    const desc = query.order === 'desc';

    let approvals = txCore.database.whitelist.findManyApprovals();
    if (query.q) {
        const fuse = new Fuse(approvals, { keys: ['identifier', 'playerName', 'approvedBy'], threshold: 0.3 });
        approvals = fuse.search(query.q).map((x) => x.item);
    }
    approvals.sort((a, b) => desc ? b.tsApproved - a.tsApproved : a.tsApproved - b.tsApproved);
    const page = paginate(approvals, query.limit, cursor, (a) => a.tsApproved, (a) => a.identifier, desc);

    return sendData(ctx, {
        approvals: page.items.map((a): ApiWhitelistApproval => ({
            identifier: a.identifier,
            playerName: a.playerName,
            playerAvatar: a.playerAvatar ?? null,
            approvedAt: secToMs(a.tsApproved) ?? 0,
            approvedBy: a.approvedBy,
        })),
    }, 200, page.meta);
};


/**
 * GET /api/v1/whitelist/requests?q=&order=&limit=&cursor=
 * Pending join requests, most recent attempt first.
 */
export async function requests(ctx: ApiKeyCtx) {
    const query = listQuerySchema.parse(ctx.query);
    const cursor = decodeCursor(query.cursor);
    const desc = query.order === 'desc';

    let requests = txCore.database.whitelist.findManyRequests();
    if (query.q) {
        const fuse = new Fuse(requests, { keys: ['id', 'playerPureName', 'discordTag', 'license'], threshold: 0.3 });
        const { pureName } = cleanPlayerName(query.q);
        const needle = pureName === 'emptyname' ? query.q : pureName;
        requests = fuse.search(needle).map((x) => x.item);
    }
    requests.sort((a, b) => desc ? b.tsLastAttempt - a.tsLastAttempt : a.tsLastAttempt - b.tsLastAttempt);
    const page = paginate(requests, query.limit, cursor, (r) => r.tsLastAttempt, (r) => r.id, desc);

    return sendData(ctx, {
        requests: page.items.map((r): ApiWhitelistRequest => ({
            id: r.id,
            license: r.license,
            playerDisplayName: r.playerDisplayName,
            playerPureName: r.playerPureName,
            discordTag: r.discordTag ?? null,
            discordAvatar: r.discordAvatar ?? null,
            lastAttemptAt: secToMs(r.tsLastAttempt) ?? 0,
        })),
    }, 200, page.meta);
};
