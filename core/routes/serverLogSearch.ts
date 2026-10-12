const modulename = 'WebServer:ServerLogSearch';
import { z } from 'zod';
import consoleFactory from '@lib/console';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { ServerLogSearchResp } from '@shared/serverLogApiTypes';
const console = consoleFactory(modulename);

const optionalText = z.string().trim().max(128).optional().transform((val) => val || undefined);
const optionalTs = z.string().regex(/^\d{1,15}$/).transform(Number).optional();
const querySchema = z.object({
    text: optionalText,
    player: optionalText,
    types: z.string().max(512).optional().transform((val) => {
        const list = val?.split(',').map((type) => type.trim()).filter(Boolean);
        return list?.length ? list : undefined;
    }),
    from: optionalTs,
    to: optionalTs,
}).refine(
    (query) => query.from === undefined || query.to === undefined || query.from <= query.to,
    { message: 'The start time must be before the end time.' },
);


/**
 * Searches the server log buffer and the log files on disk.
 */
export default async function ServerLogSearch(ctx: AuthedCtx) {
    const sendTypedResp = (data: ServerLogSearchResp) => ctx.send(data);
    if (!ctx.admin.hasPermission('server.log.view')) {
        return sendTypedResp({ error: 'You don\'t have permission to call this endpoint.' });
    }

    const query = querySchema.safeParse(ctx.request.query);
    if (!query.success) {
        return sendTypedResp({ error: query.error.issues[0]?.message ?? 'Invalid search.' });
    }

    try {
        return sendTypedResp(await txCore.logger.server.search(query.data));
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.verbose.error(`Server log search failed: ${msg}`);
        return sendTypedResp({ error: `Search failed: ${msg}` });
    }
};
