const modulename = 'ApiServer:ServerControl';
import { msToShortishDuration } from '@lib/misc';
import type { AuthedAdmin } from '@modules/WebServer/authLogic';
import { ApiError } from '../envelope';

/**
 * Mirrors core/routes/fxserver/controls.ts and commands.ts for the public API.
 */

export type ServerControlResult = {
    action: 'start' | 'stop' | 'restart';
    result: 'started' | 'stopped' | 'restarting' | 'scheduled' | 'noop';
    message: string;
};

const RESOURCE_COMMANDS = ['start', 'stop', 'restart', 'ensure'] as const;
export type ResourceCommand = typeof RESOURCE_COMMANDS[number];
const UNSAFE_RESOURCE = 'runcode';


export const controlServer = async (admin: AuthedAdmin, action: 'start' | 'stop' | 'restart'): Promise<ServerControlResult> => {
    if (action === 'restart') {
        admin.logCommand('RESTART SERVER');
        const respawnDelay = txCore.fxRunner.restartSpawnDelay;
        if (respawnDelay.ms > 10_000) {
            txCore.fxRunner.restartServer('admin request', admin.name).catch(() => { });
            const durationStr = msToShortishDuration(respawnDelay.ms, { units: ['m', 's', 'ms'] });
            return { action, result: 'scheduled', message: `The server will restart with a delay of ${durationStr}.` };
        }
        const restartError = await txCore.fxRunner.restartServer('admin request', admin.name);
        if (restartError !== null) {
            throw new ApiError(409, 'CONFLICT', restartError);
        }
        return { action, result: 'restarting', message: 'The server is now restarting.' };

    } else if (action === 'stop') {
        if (txCore.fxRunner.isIdle) {
            return { action, result: 'noop', message: 'The server is already stopped.' };
        }
        admin.logCommand('STOP SERVER');
        await txCore.fxRunner.killServer('admin request', admin.name, false);
        return { action, result: 'stopped', message: 'Server stopped.' };

    } else {
        if (!txCore.fxRunner.isIdle) {
            return { action, result: 'noop', message: 'The server is already running.' };
        }
        admin.logCommand('START SERVER');
        const spawnError = await txCore.fxRunner.spawnServer(true);
        if (spawnError !== null) {
            throw new ApiError(409, 'CONFLICT', spawnError);
        }
        return { action, result: 'started', message: 'The server is now starting.' };
    }
};


const requireServerAlive = () => {
    if (!txCore.fxRunner.child?.isAlive) {
        throw new ApiError(503, 'SERVER_OFFLINE', 'The server is not running.');
    }
};


export const announce = (admin: AuthedAdmin, messageInput: string) => {
    requireServerAlive();
    const message = messageInput.trim();
    if (!message.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot send an empty announcement.', { field: 'message' });
    }
    txCore.fxRunner.sendEvent('announcement', { message, author: admin.name });
    admin.logAction(`Sending announcement: ${message}`);
    const publicAuthor = txCore.adminStore.getAdminPublicName(admin.name, 'message');
    txCore.discordBot.sendAnnouncement({
        type: 'info',
        title: { key: 'nui_menu.misc.announcement_title', data: { author: publicAuthor } },
        description: message,
    }).catch(() => { });
};


export const kickAll = (admin: AuthedAdmin, reasonInput?: string) => {
    requireServerAlive();
    const kickReason = (reasonInput ?? '').trim() || txCore.translator.t('kick_messages.unknown_reason');
    const dropMessage = txCore.translator.t('kick_messages.everyone', { reason: kickReason });
    admin.logAction(`Kicking all players: ${kickReason}`);
    txCore.fxRunner.sendEvent('playerKicked', {
        target: -1,
        author: admin.name,
        reason: kickReason,
        dropMessage,
    });
};


/**
 * Sends a raw console command, exactly like typing it in the Live Console.
 */
export const runConsoleCommand = (admin: AuthedAdmin, commandInput: string) => {
    requireServerAlive();
    const command = commandInput.trim();
    if (!command.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot send an empty command.', { field: 'command' });
    }
    admin.logCommand(command);
    const sent = txCore.fxRunner.sendRawCommand(command, admin.name);
    if (!sent) {
        throw new ApiError(503, 'SERVER_OFFLINE', 'Failed to write the command to the server (stdin error).');
    }
};


export const resourceCommand = (admin: AuthedAdmin, command: ResourceCommand, resource: string) => {
    requireServerAlive();
    const name = resource.trim();
    if (!/^[a-zA-Z0-9_.\-\[\]]{1,128}$/.test(name)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid resource name.', { resource });
    }
    if (command !== 'stop' && name.toLowerCase().includes(UNSAFE_RESOURCE)) {
        throw new ApiError(403, 'FORBIDDEN', 'The resource "runcode" might be unsafe and cannot be started through the API.');
    }
    const past = { start: 'Started', stop: 'Stopped', restart: 'Restarted', ensure: 'Ensured' }[command];
    admin.logAction(`${past} resource "${name}"`);
    txCore.fxRunner.sendCommand(command, [name], admin.name);
};


export const refreshResources = (admin: AuthedAdmin) => {
    requireServerAlive();
    admin.logAction('Refreshed resources');
    txCore.fxRunner.sendCommand('refresh', [], admin.name);
};
