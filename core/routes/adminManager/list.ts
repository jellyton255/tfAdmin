const modulename = 'WebServer:AdminManagerList';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { AdminManagerAdmin, AdminManagerListResp, AdminManagerPermission } from '@shared/adminManagerApiTypes';
import consoleFactory from '@lib/console';
const console = consoleFactory(modulename);

const dangerousPerms = ['all_permissions', 'manage.admins', 'console.write', 'settings.write'];


/**
 * Returns the admins list and the registered permissions for the Admins page.
 */
export default async function AdminManagerList(ctx: AuthedCtx) {
    const sendTypedResp = (data: AdminManagerListResp) => ctx.send(data);
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return sendTypedResp({ error: 'You don\'t have permission to view this page.' });
    }

    const selfName = ctx.admin.name.toLowerCase();
    const admins: AdminManagerAdmin[] = [];
    for (const admin of txCore.adminStore.getAdminsList()) {
        const isSelf = admin.name.toLowerCase() === selfName;
        admins.push({
            name: admin.name,
            isMaster: admin.master,
            isSelf,
            permissions: admin.permissions,
            citizenfxId: admin.providers.citizenfx?.id ?? null,
            citizenfxIdentifier: admin.providers.citizenfx?.identifier ?? null,
            discordId: admin.providers.discord?.id ?? null,
            canEdit: !isSelf && (ctx.admin.isMaster || !admin.master),
            canDelete: !isSelf && !admin.master,
        });
    }

    const permissions: AdminManagerPermission[] = Object.entries(txCore.adminStore.getPermissionsList())
        .map(([id, label]) => ({
            id,
            label,
            dangerous: dangerousPerms.includes(id),
            group: (id.startsWith('players.') || id.startsWith('menu.')) ? 'game' : 'panel',
        }));

    return sendTypedResp({ admins, permissions });
};
