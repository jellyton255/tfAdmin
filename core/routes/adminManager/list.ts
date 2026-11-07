const modulename = 'WebServer:AdminManagerList';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { AdminManagerAdmin, AdminManagerGroup, AdminManagerListResp, AdminManagerPermission } from '@shared/adminManagerApiTypes';
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
    const passkeyCounts = txCore.webServer.passkeyStore.countByAdmin();
    const admins: AdminManagerAdmin[] = [];
    for (const admin of txCore.adminStore.getAdminsList()) {
        const isSelf = admin.name.toLowerCase() === selfName;
        admins.push({
            name: admin.name,
            isMaster: admin.master,
            isSelf,
            groups: admin.groups,
            permissions: admin.permissions,
            citizenfxId: admin.providers.citizenfx?.id ?? null,
            citizenfxIdentifier: admin.providers.citizenfx?.identifier ?? null,
            discordId: admin.providers.discord?.id ?? null,
            canEdit: !isSelf && (ctx.admin.isMaster || !admin.master),
            canDelete: !isSelf && !admin.master,
            passkeyCount: passkeyCounts.get(admin.name.toLowerCase()) ?? 0,
        });
    }

    const permissions: AdminManagerPermission[] = Object.entries(txCore.adminStore.getPermissionsList())
        .map(([id, label]) => ({
            id,
            label,
            dangerous: dangerousPerms.includes(id),
            group: (id.startsWith('players.') || id.startsWith('menu.')) ? 'game' : 'panel',
        }));

    const canGrantAll = ctx.admin.isMaster || ctx.admin.permissions.includes('all_permissions');
    const groups: AdminManagerGroup[] = txCore.adminStore.getGroupsList().map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        permissions: group.permissions,
        members: group.members,
        canEdit: canGrantAll || group.permissions.every((p: string) => ctx.admin.permissions.includes(p)),
    }));

    return sendTypedResp({ admins, groups, permissions });
};
