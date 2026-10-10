const modulename = 'WebServer:AdminManagerActions';
import { customAlphabet } from 'nanoid';
import dict49 from 'nanoid-dictionary/nolookalikes';
import { z } from 'zod';
import got from '@lib/got';
import consts from '@shared/consts';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { AdminManagerAddResp, AdminManagerDeleteResp, AdminManagerEditResp } from '@shared/adminManagerApiTypes';
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
    permissions: string[];
    citizenfxData: ProviderDataType | false;
    discordData: ProviderDataType | false;
};

const saveBodySchema = z.object({
    name: z.string().trim(),
    citizenfxID: z.string().trim(),
    discordID: z.string().trim(),
    permissions: z.array(z.string()),
});
const deleteBodySchema = z.object({
    name: z.string().trim(),
});


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

    let permissions = parsed.data.permissions;
    if (permissions.includes('all_permissions')) permissions = ['all_permissions'];

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

    //Check for privilege escalation
    if (!ctx.admin.isMaster && !ctx.admin.permissions.includes('all_permissions')) {
        const deniedPerms = permissions.filter((x) => !ctx.admin.permissions.includes(x));
        if (deniedPerms.length) {
            return { error: `You cannot give permissions you do not have: ${deniedPerms.join(', ')}` };
        }
    }

    return { name, permissions, citizenfxData, discordData };
}


/**
 * Handle Add
 */
async function handleAdd(ctx: AuthedCtx): Promise<AdminManagerAddResp> {
    const body = await parseSaveBody(ctx);
    if ('error' in body) return body;
    const { name, permissions, citizenfxData, discordData } = body;

    if (!consts.regexValidFivemUsername.test(name)) {
        return { error: `Invalid username, it must be ${nameRegexDesc}.` };
    }

    const changes = {
        cfxId: citizenfxData ? citizenfxData.identifier : undefined,
        discordId: discordData ? discordData.identifier : undefined,
        permissions,
    };

    const password = nanoid();
    try {
        await txCore.adminStore.addAdmin(name, citizenfxData, discordData, password, permissions);
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
    const { name, permissions, citizenfxData, discordData } = body;

    if (ctx.admin.name.toLowerCase() === name.toLowerCase()) {
        return { error: 'You cannot edit yourself.' };
    }

    const admin = txCore.adminStore.getAdminByName(name);
    if (!admin) return { error: 'Admin not found.' };
    if (!ctx.admin.isMaster && admin.master) {
        return { error: 'You cannot edit an admin master.' };
    }

    //List changes
    const permsAdded = permissions.filter((x) => !admin.permissions.includes(x));
    const permsRemoved = admin.permissions.filter((x: string) => !permissions.includes(x));
    const changes: string[] = [];
    if (permsAdded.includes('all_permissions')) {
        changes.push('Added all permissions.');
    } else {
        if (permsAdded.length) {
            changes.push(`Added permissions: ${JSON.stringify(permsAdded)}.`);
        }
        if (permsRemoved.length) {
            changes.push(`Removed permissions: ${JSON.stringify(permsRemoved)}.`);
        }
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
        await txCore.adminStore.editAdmin(name, null, citizenfxData, discordData, permissions);
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
