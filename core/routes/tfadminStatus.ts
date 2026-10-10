import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { getTfadminStatus } from '@lib/tfadminStatus';
import type { TfadminStatusResp } from '@shared/tfadminStatusTypes';


/**
 * Returns the tfAdmin build and upstream merge status for the panel warning bar.
 */
export default async function TfadminStatus(ctx: AuthedCtx) {
    const sendTypedResp = (data: TfadminStatusResp) => ctx.send(data);
    if (!ctx.admin.hasPermission('all_permissions')) {
        return sendTypedResp({ error: 'You don\'t have permission to call this endpoint.' });
    }
    return sendTypedResp(getTfadminStatus());
};
