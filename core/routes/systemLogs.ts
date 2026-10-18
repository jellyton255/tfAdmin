import { getLogBuffer } from '@lib/console';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { GenericApiErrorResp } from '@shared/genericApiTypes';


/**
 * Returns the data of for the console log page
 * NOTE: would be more efficient to return the raw string, but the frontend fetcher expects JSON
 */
export default async function SystemLogs(ctx: AuthedCtx) {
    const { scope } = ctx.params as any;
    const sendTypedResp = (data: { data: string } | GenericApiErrorResp) => ctx.send(data);

    //Check permissions
    if (!ctx.admin.hasPermission('txadmin.log.view')) {
        return sendTypedResp({ error: 'You don\'t have permission to call this endpoint.' });
    }

    //Returning the data
    if (scope === 'console') {
        return sendTypedResp({
            data: getLogBuffer(),
        });
    } else {
        return sendTypedResp({ error: 'Invalid scope' });
    }
};
