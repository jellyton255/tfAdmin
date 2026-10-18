const modulename = 'WebServer:AdminLogSearch';
import { z } from 'zod';
import consoleFactory from '@lib/console';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { isAdminLogCategory, searchAdminLog } from '@modules/Logger/handlers/adminLogSearch';
import type { AdminLogSearchResp } from '@shared/adminLogApiTypes';
const console = consoleFactory(modulename);

const optionalText = z.string().trim().max(128).optional().transform((val) => val || undefined);
const optionalTs = z.coerce.number().int().min(0).optional();
export const adminLogQueryShape = z.object({
    text: optionalText,
    admin: optionalText,
    categories: z.string().max(512).optional().transform((val, ctx) => {
        const list = val?.split(',').map((item) => item.trim()).filter(Boolean);
        if (!list?.length) return undefined;
        const invalid = list.find((item) => !isAdminLogCategory(item));
        if (invalid) {
            ctx.addIssue({ code: 'custom', message: `Unknown category: ${invalid}` });
            return z.NEVER;
        }
        return list.filter(isAdminLogCategory);
    }),
    from: optionalTs,
    to: optionalTs,
});
export const adminLogQuerySchema = adminLogQueryShape.refine(
    (query) => query.from === undefined || query.to === undefined || query.from <= query.to,
    { message: 'The start time must be before the end time.' },
);


/**
 * Searches the admin log (who did what in tfAdmin) for the Audit Log page.
 */
export default async function AdminLogSearch(ctx: AuthedCtx) {
    const sendTypedResp = (data: AdminLogSearchResp) => ctx.send(data);
    if (!ctx.admin.hasPermission('txadmin.log.view')) {
        return sendTypedResp({ error: 'You don\'t have permission to call this endpoint.' });
    }

    const query = adminLogQuerySchema.safeParse(ctx.request.query);
    if (!query.success) {
        return sendTypedResp({ error: query.error.issues[0]?.message ?? 'Invalid search.' });
    }

    try {
        return sendTypedResp(await searchAdminLog(txCore.logger.admin.basePath, query.data));
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.verbose.error(`Admin log search failed: ${msg}`);
        return sendTypedResp({ error: `Search failed: ${msg}` });
    }
};
