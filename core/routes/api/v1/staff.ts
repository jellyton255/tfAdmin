import { sendData } from '@modules/ApiServer/envelope';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import { searchAdminLog } from '@modules/Logger/handlers/adminLogSearch';
import { getStaffActivity } from '@lib/staffActivity';
import { adminLogQuerySchema } from '@routes/adminLogSearch';
import { staffActivityQuerySchema } from '@routes/staffActivity';


/**
 * GET /api/v1/audit-log?text=&admin=&categories=ban,kick&from=&to=
 * The admin log (who did what in tfAdmin), newest page first. Pass `cursor` back as `to` for older entries.
 * Needs manage.admins: entries include login IPs, console commands and webhook URLs.
 */
export async function auditLog(ctx: ApiKeyCtx) {
    const query = adminLogQuerySchema.parse(ctx.query);
    const result = await searchAdminLog(txCore.logger.admin.basePath, query);
    return sendData(ctx, {
        entries: result.log,
        truncated: result.truncated,
        cursor: result.cursor,
    });
};


/**
 * GET /api/v1/staff/activity?weeks=8
 * Each admin's bans, warns, kicks, revokes, notes and time in game per UTC week.
 */
export async function activity(ctx: ApiKeyCtx) {
    const { weeks } = staffActivityQuerySchema.parse(ctx.query);
    return sendData(ctx, getStaffActivity(weeks));
};
