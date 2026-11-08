const modulename = 'WebServer:EverfallRequest';
import { z } from 'zod';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { runEverfallOperation } from '@lib/everfall';
import type { EverfallResp } from '@shared/everfallApiTypes';
const console = consoleFactory(modulename);

const bodySchema = z.object({
    operation: z.string().regex(/^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/).max(64),
    payload: z.record(z.string(), z.unknown()).default({}),
});


/**
 * Runs one ef_administration operation for the logged-in admin. Changes are logged to the admin
 * log when ef_administration names them in `audit`.
 */
export default async function EverfallRequest(ctx: AuthedCtx) {
    const sendTypedResp = (data: EverfallResp) => ctx.send(data);
    const body = bodySchema.safeParse(ctx.request.body);
    if (!body.success) {
        return sendTypedResp({ error: 'Invalid Request' });
    }

    //Staff Log rows come from the admin log only (core/lib/everfall.ts recordStaffLog)
    if (body.data.operation === 'staffLog.record') {
        return sendTypedResp({ ok: false, error: 'This action cannot be requested from the panel.' });
    }

    const admin = txCore.adminStore.getAdminByName(ctx.admin.name);
    const discordId: unknown = admin && admin.providers?.discord?.id;
    if (typeof discordId !== 'string') {
        return sendTypedResp({ ok: false, error: 'Link a Discord account to your tfAdmin login to use Everfall actions.' });
    }

    const result = await runEverfallOperation({ discordId, name: ctx.admin.name }, body.data.operation, body.data.payload);
    if (result.ok && typeof result.data.audit === 'string') {
        ctx.admin.logAction(result.data.audit);
    }
    if (!result.ok) {
        console.verbose.warn(`${body.data.operation} refused: ${result.error}`);
    }
    return sendTypedResp(result);
};
