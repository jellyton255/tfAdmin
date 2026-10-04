import { z } from 'zod';
import { sendData } from '@modules/ApiServer/envelope';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import { API_EVENTS_PAGE_MAX, API_EVENT_TYPES, type ApiEventType } from '@shared/apiV1Types';

const querySchema = z.object({
    since: z.string().regex(/^\d{1,20}$/, 'since must be an event id').optional(),
    types: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(API_EVENTS_PAGE_MAX).default(100),
});
const VALID_TYPES = new Set<string>(API_EVENT_TYPES);


/**
 * GET /api/v1/events?since=<cursor>&types=a,b&limit=100
 * Polling fallback for consumers that can't receive webhooks. Any valid key.
 */
export async function list(ctx: ApiKeyCtx) {
    const query = querySchema.parse(ctx.query);
    let types: ApiEventType[] | undefined;
    if (query.types) {
        const parsed = query.types.split(',').map((t) => t.trim()).filter(Boolean);
        const unknown = parsed.filter((t) => !VALID_TYPES.has(t));
        if (unknown.length) {
            throw new z.ZodError([{ code: 'custom', path: ['types'], message: `unknown event type(s): ${unknown.join(', ')}` }]);
        }
        types = parsed as ApiEventType[];
    }
    const page = txCore.apiServer.events.list({ since: query.since, types, limit: query.limit });
    return sendData(ctx, { events: page.events }, 200, {
        cursor: page.cursor,
        hasMore: page.hasMore,
        dropped: page.dropped,
    });
};

/** GET /api/v1/events/types */
export async function types(ctx: ApiKeyCtx) {
    return sendData(ctx, { types: [...API_EVENT_TYPES] });
};
