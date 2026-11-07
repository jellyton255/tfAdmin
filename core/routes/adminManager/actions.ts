const modulename = 'WebServer:AdminManagerActions';
import { customAlphabet } from 'nanoid';
import dict49 from 'nanoid-dictionary/nolookalikes';
import { z } from 'zod';
import got from '@lib/got';
import consts from '@shared/consts';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type {
    AdminManagerAddResp,
    AdminManagerDeleteResp,
    AdminManagerEditResp,
    AdminManagerGroupDeleteResp,
    AdminManagerGroupSaveResp,
    AdminManagerRemovePasskeysResp,
} from '@shared/adminManagerApiTypes';
const console = consoleFactory(modulename);

//Helpers
const nanoid = customAlphabet(dict49, 20);
//NOTE: this desc misses that it should start and end with alphanum or _, and cannot have repeated -_.
const nameRegexDesc = 'up to 20 characters containing only letters, numbers and the characters `_.-`';
const cfxHttpReqOptions = {
    timeout: { request: 6000 },
};
type ProviderDataType = { id: string, identifier: string };
type ErrorResp = { error: string };
type ParsedSaveBody = {
    name: string;
    groups: string[];
    citizenfxData: ProviderDataType | false;
    discordData: ProviderDataType | false;
};

const saveBodySchema = z.object({
    name: z.string().trim(),
    citizenfxID: z.string().trim(),
    discordID: z.string().trim(),
    groups: z.array(z.string()),
});
const deleteBodySchema = z.object({
    name: z.string().trim(),
});
const groupSaveBodySchema = z.object({
    id: z.string().trim().optional(),
    name: z.string().trim(),
    description: z.string().trim().default(''),
    permissions: z.array(z.string()),
    members: z.array(z.string()).optional(),
});
const groupDeleteBodySchema = z.object({
    id: z.string().trim(),
});


/**
 * Returns the permissions the admin cannot give, as an admin can only give permissions they have
 */
const getUngrantablePerms = (ctx: AuthedCtx, perms: string[]) => {
    if (ctx.admin.isMaster || ctx.admin.permissions.includes('all_permissions')) return [];
    return perms.filter((x) => !ctx.admin.permissions.includes(x));
};

/**
 * Returns the permissions of these groups that the admin cannot give
 */
const getUngrantableGroupPerms = (ctx: AuthedCtx, groupIds: string[]) => {
    const perms = new Set<string>();
    for (const id of groupIds) {
        const group = txCore.adminStore.getGroupById(id);
        if (group) group.permissions.forEach((p: string) => perms.add(p));
    }
    return getUngrantablePerms(ctx, [...perms]);
};

const groupNamesOf = (groupIds: string[]) => groupIds.map((id) => txCore.adminStore.getGroupById(id)?.name ?? id);


/**
 * Handles the add, edit and delete admin actions.
 */
export default async function AdminManagerActions(ctx: AuthedCtx) {
    const action = ctx.params?.action;
    if (!ctx.admin.testPermission('manage.admins', modulename)) {
        return ctx.send<ErrorResp>({ error: 'You don\'t have permission to execute this action.' });
    }

    if (action === 'add') {
        return ctx.send<AdminManagerAddResp>(await handleAdd(ctx));
    } else if (action === 'edit') {
        return ctx.send<AdminManagerEditResp>(await handleEdit(ctx));
    } else if (action === 'delete') {
        return ctx.send<AdminManagerDeleteResp>(await handleDelete(ctx));
    } else if (action === 'saveGroup') {
        return ctx.send<AdminManagerGroupSaveResp>(await handleSaveGroup(ctx));
    } else if (action === 'deleteGroup') {
        return ctx.send<AdminManagerGroupDeleteResp>(await handleDeleteGroup(ctx));
    } else if (action === 'removePasskeys') {
        return ctx.send<AdminManagerRemovePasskeysResp>(handleRemovePasskeys(ctx));
    } else {
        return ctx.send<ErrorResp>({ error: 'Unknown action.' });
    }
};


/**
 * Validates the save body and resolves the provider ids
 */
async function parseSaveBody(ctx: AuthedCtx): Promise<ParsedSaveBody | ErrorResp> {
    const parsed = saveBodySchema.safeParse(ctx.request.body);
    if (!parsed.success) return { error: 'Invalid request: missing or invalid parameters.' };
    const { name, citizenfxID, discordID } = parsed.data;

    const groups = txCore.adminStore.getValidGroupIds(parsed.data.groups) as string[];
    if (groups.length !== new Set(parsed.data.groups).size) {
        return { error: 'One of the selected groups no longer exists. Reload the page and try again.' };
    }

    //Validate & translate Cfx.re ID
    let citizenfxData: ProviderDataType | false = false;
    if (citizenfxID.length) {
        try {
            if (consts.validIdentifiers.fivem.test(citizenfxID)) {
                const id = citizenfxID.split(':')[1];
                const res = await got(`https://policy-live.fivem.net/api/getUserInfo/${id}`, cfxHttpReqOptions).json<any>();
                if (!res.username || !res.username.length) {
                    return { error: 'Invalid Cfx.re ID: account not found.' };
                }
                citizenfxData = {
                    id: res.username,
                    identifier: citizenfxID,
                };
            } else if (consts.regexValidFivemUsername.test(citizenfxID)) {
                const res = await got(`https://forum.cfx.re/u/${citizenfxID}.json`, cfxHttpReqOptions).json<any>();
                if (!res.user || typeof res.user.id !== 'number') {
                    return { error: 'Invalid Cfx.re ID: forum user not found.' };
                }
                citizenfxData = {
                    id: citizenfxID,
                    identifier: `fivem:${res.user.id}`,
                };
            } else {
                return { error: 'Invalid Cfx.re ID: use a forum username or a fivem: identifier.' };
            }
        } catch (error) {
            console.error(`Failed to resolve CitizenFX ID to game identifier with error: ${(error as Error).message}`);
        }
    }

    //Validate Discord ID
    let discordData: ProviderDataType | false = false;
    if (discordID.length) {
        if (!consts.validIdentifierParts.discord.test(discordID)) {
            return { error: 'Invalid Discord ID.' };
        }
        discordData = {
            id: discordID,
            identifier: `discord:${discordID}`,
        };
    }

    return { name, groups, citizenfxData, discordData };
}


/**
 * Handle Add
 */
async function handleAdd(ctx: AuthedCtx): Promise<AdminManagerAddResp> {
    const body = await parseSaveBody(ctx);
    if ('error' in body) return body;
    const { name, groups, citizenfxData, discordData } = body;

    if (!consts.regexValidFivemUsername.test(name)) {
        return { error: `Invalid username, it must be ${nameRegexDesc}.` };
    }

    //Check for privilege escalation
    const deniedPerms = getUngrantableGroupPerms(ctx, groups);
    if (deniedPerms.length) {
        return { error: `You cannot give groups with permissions you do not have: ${deniedPerms.join(', ')}` };
    }

    const changes = {
        cfxId: citizenfxData ? citizenfxData.identifier : undefined,
        discordId: discordData ? discordData.identifier : undefined,
        groups: groupNamesOf(groups),
    };

    const password = nanoid();
    try {
        await txCore.adminStore.addAdmin(name, citizenfxData, discordData, password, groups);
        ctx.admin.logAction(`Adding user '${name}' with ${JSON.stringify(changes)}`);
        return { success: true, password };
    } catch (error) {
        return { error: (error as Error).message };
    }
}


/**
 * Handle Edit
 */
async function handleEdit(ctx: AuthedCtx): Promise<AdminManagerEditResp> {
    const body = await parseSaveBody(ctx);
    if ('error' in body) return body;
    const { name, groups, citizenfxData, discordData } = body;

    if (ctx.admin.name.toLowerCase() === name.toLowerCase()) {
        return { error: 'You cannot edit yourself.' };
    }

    const admin = txCore.adminStore.getAdminByName(name);
    if (!admin) return { error: 'Admin not found.' };
    if (!ctx.admin.isMaster && admin.master) {
        return { error: 'You cannot edit an admin master.' };
    }

    //List changes, and check for privilege escalation on the groups being added
    const groupsAdded = groups.filter((x) => !admin.groups.includes(x));
    const groupsRemoved = (admin.groups as string[]).filter((x) => !groups.includes(x));
    const deniedPerms = getUngrantableGroupPerms(ctx, groupsAdded);
    if (deniedPerms.length) {
        return { error: `You cannot give groups with permissions you do not have: ${deniedPerms.join(', ')}` };
    }
    const changes: string[] = [];
    if (groupsAdded.length) {
        changes.push(`Added to groups: ${JSON.stringify(groupNamesOf(groupsAdded))}.`);
    }
    if (groupsRemoved.length) {
        changes.push(`Removed from groups: ${JSON.stringify(groupNamesOf(groupsRemoved))}.`);
    }
    const prevCfxId = admin.providers?.citizenfx?.identifier;
    if (!prevCfxId && citizenfxData) {
        changes.push(`Added Cfx.re ID: ${citizenfxData.identifier}.`);
    } else if (prevCfxId && !citizenfxData) {
        changes.push(`Removed Cfx.re ID: ${prevCfxId}.`);
    } else if (prevCfxId && citizenfxData && prevCfxId !== citizenfxData.identifier) {
        changes.push(`Changed Cfx.re ID from ${prevCfxId} to ${citizenfxData.identifier}.`);
    }
    const prevDiscordId = admin.providers?.discord?.identifier;
    if (!prevDiscordId && discordData) {
        changes.push(`Added Discord ID: ${discordData.identifier}.`);
    } else if (prevDiscordId && !discordData) {
        changes.push(`Removed Discord ID: ${prevDiscordId}.`);
    } else if (prevDiscordId && discordData && prevDiscordId !== discordData.identifier) {
        changes.push(`Changed Discord ID from ${prevDiscordId} to ${discordData.identifier}.`);
    }

    try {
        await txCore.adminStore.editAdmin(name, null, citizenfxData, discordData, groups);
        const logMessage = changes.length
            ? `Editing user '${name}': ${changes.join(' ')}`
            : `Editing user '${name}'. No changes were made.`;
        ctx.admin.logAction(logMessage);
        return { success: true };
    } catch (error) {
        return { error: (error as Error).message };
    }
}


/**
 * Handle Delete
 */
async function handleDelete(ctx: AuthedCtx): Promise<AdminManagerDeleteResp> {
    const parsed = deleteBodySchema.safeParse(ctx.request.body);
    if (!parsed.success) return { error: 'Invalid request: missing admin name.' };
    const { name } = parsed.data;

    if (ctx.admin.name.toLowerCase() === name.toLowerCase()) {
        return { error: 'You cannot delete yourself.' };
    }

    const admin = txCore.adminStore.getAdminByName(name);
    if (!admin) return { error: 'Admin not found.' };
    if (admin.master) {
        return { error: 'You cannot delete an admin master.' };
    }

    try {
        await txCore.adminStore.deleteAdmin(name);
        ctx.admin.logAction(`Deleting user '${name}'.`);
        return { success: true };
    } catch (error) {
        return { error: (error as Error).message };
    }
}


/**
 * Handle Save Group (creates it when there is no id)
 * An admin can only make or change groups whose permissions they have.
 */
async function handleSaveGroup(ctx: AuthedCtx): Promise<AdminManagerGroupSaveResp> {
    const parsed = groupSaveBodySchema.safeParse(ctx.request.body);
    if (!parsed.success) return { error: 'Invalid request: missing or invalid parameters.' };
    const { id, name, description, permissions, members } = parsed.data;

    const existing = id ? txCore.adminStore.getGroupById(id) : false;
    if (id && !existing) return { error: 'Group not found. Reload the page and try again.' };
    const deniedPerms = getUngrantablePerms(ctx, [...permissions, ...(existing ? existing.permissions : [])]);
    if (deniedPerms.length) {
        return { error: `You cannot change groups with permissions you do not have: ${deniedPerms.join(', ')}` };
    }

    //Members: everyone except the master account, and never yourself, so nobody locks themselves out or in
    let memberNames: string[] | undefined;
    if (members) {
        const selfName = ctx.admin.name.toLowerCase();
        const adminsList = txCore.adminStore.getAdminsList() as { name: string, master: boolean, groups: string[] }[];
        const unknown = members.filter((m) => !adminsList.some((a) => a.name.toLowerCase() === m.toLowerCase()));
        if (unknown.length) return { error: `Admin not found: ${unknown.join(', ')}` };
        const wanted = new Set(members.map((m) => m.toLowerCase()));
        const wasMember = (a: { groups: string[] }) => !!id && a.groups.includes(id);
        const selfAdmin = adminsList.find((a) => a.name.toLowerCase() === selfName);
        if (selfAdmin && wasMember(selfAdmin) !== wanted.has(selfName)) {
            return { error: 'You cannot change your own groups.' };
        }
        if (!ctx.admin.isMaster) {
            const changedMaster = adminsList.some((a) => a.master && wanted.has(a.name.toLowerCase()));
            if (changedMaster) return { error: 'The master account already has every permission.' };
        }
        memberNames = adminsList
            .filter((a) => !a.master && wanted.has(a.name.toLowerCase()))
            .map((a) => a.name);
    }

    try {
        let group;
        if (existing) {
            group = await txCore.adminStore.editGroup(existing.id, { name, description, permissions });
        } else {
            group = await txCore.adminStore.addGroup({ name, description, permissions });
        }
        if (memberNames) await txCore.adminStore.setGroupMembers(group.id, memberNames);

        const what = existing ? 'Editing' : 'Adding';
        const membersMsg = memberNames ? ` and members ${JSON.stringify(memberNames)}` : '';
        ctx.admin.logAction(`${what} admin group '${group.name}' with permissions ${JSON.stringify(group.permissions)}${membersMsg}.`);
        return { success: true, id: group.id };
    } catch (error) {
        return { error: (error as Error).message };
    }
}


/**
 * Handle Delete Group
 */
async function handleDeleteGroup(ctx: AuthedCtx): Promise<AdminManagerGroupDeleteResp> {
    const parsed = groupDeleteBodySchema.safeParse(ctx.request.body);
    if (!parsed.success) return { error: 'Invalid request: missing group id.' };

    const group = txCore.adminStore.getGroupById(parsed.data.id);
    if (!group) return { error: 'Group not found.' };
    const deniedPerms = getUngrantablePerms(ctx, group.permissions);
    if (deniedPerms.length) {
        return { error: `You cannot delete groups with permissions you do not have: ${deniedPerms.join(', ')}` };
    }
    const selfAdmin = txCore.adminStore.getAdminByName(ctx.admin.name);
    if (selfAdmin && selfAdmin.groups.includes(group.id)) {
        return { error: 'You cannot delete a group you are in.' };
    }

    try {
        await txCore.adminStore.deleteGroup(group.id);
        ctx.admin.logAction(`Deleting admin group '${group.name}'.`);
        return { success: true };
    } catch (error) {
        return { error: (error as Error).message };
    }
}


/**
 * Handle Remove Passkeys
 * Lets admin managers lock out a lost or compromised account, since passkey sessions don't depend on the password.
 */
function handleRemovePasskeys(ctx: AuthedCtx): AdminManagerRemovePasskeysResp {
    const parsed = deleteBodySchema.safeParse(ctx.request.body);
    if (!parsed.success) return { error: 'Invalid request: missing admin name.' };
    const { name } = parsed.data;

    const admin = txCore.adminStore.getAdminByName(name);
    if (!admin) return { error: 'Admin not found.' };
    const isSelf = ctx.admin.name.toLowerCase() === name.toLowerCase();
    if (!isSelf && admin.master && !ctx.admin.isMaster) {
        return { error: 'You cannot change an admin master.' };
    }

    try {
        const removed = txCore.webServer.passkeyStore.removeAllForAdmin(name);
        ctx.admin.logAction(`Removing ${removed} passkey(s) of '${name}'.`);
        return { success: true };
    } catch (error) {
        return { error: (error as Error).message };
    }
}
