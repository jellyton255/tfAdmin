import { z } from 'zod';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { getStaffActivity, STAFF_ACTIVITY_MAX_WEEKS } from '@lib/staffActivity';
import type { StaffActivityResp } from '@shared/staffActivityApiTypes';

export const staffActivityQuerySchema = z.object({
    weeks: z.coerce.number().int().min(1).max(STAFF_ACTIVITY_MAX_WEEKS).default(8),
});


/**
 * Returns each admin's weekly activity for the Staff Activity page.
 */
export default async function StaffActivity(ctx: AuthedCtx) {
    const sendTypedResp = (data: StaffActivityResp) => ctx.send(data);
    if (!ctx.admin.hasPermission('manage.admins')) {
        return sendTypedResp({ error: 'You don\'t have permission to call this endpoint.' });
    }

    const query = staffActivityQuerySchema.safeParse(ctx.request.query);
    if (!query.success) {
        return sendTypedResp({ error: query.error.issues[0]?.message ?? 'Invalid request.' });
    }
    return sendTypedResp(getStaffActivity(query.data.weeks));
};
