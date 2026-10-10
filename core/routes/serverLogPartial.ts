const modulename = 'WebServer:ServerLogPartial';
import { z } from 'zod';
import consoleFactory from '@lib/console';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { ServerLogPartialResp } from '@shared/serverLogApiTypes';
const console = consoleFactory(modulename);

const SLICE_SIZE = 500;
const querySchema = z.object({
    dir: z.enum(['older', 'newer']),
    ref: z.string().regex(/^\d{13}$/).transform(Number),
});


/**
 * Returns a page of the server log buffer.
 * Without a valid dir/ref pair, returns the whole recent buffer.
 */
export default async function ServerLogPartial(ctx: AuthedCtx) {
    const sendTypedResp = (data: ServerLogPartialResp) => ctx.send(data);
    if (!ctx.admin.hasPermission('server.log.view')) {
        return sendTypedResp({ error: 'You don\'t have permission to call this endpoint.' });
    }

    const query = querySchema.safeParse(ctx.request.query);
    if (!query.success) {
        return sendTypedResp({
            boundry: true,
            log: txCore.logger.server.getRecentBuffer(),
        });
    }

    const { dir, ref } = query.data;
    const log = dir === 'older'
        ? txCore.logger.server.readPartialOlder(ref, SLICE_SIZE)
        : txCore.logger.server.readPartialNewer(ref, SLICE_SIZE);
    return sendTypedResp({
        boundry: log.length < SLICE_SIZE,
        log,
    });
};
