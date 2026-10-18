const modulename = 'WebServer:PlayerActions';
import playerResolver from '@lib/player/playerResolver';
import { GenericApiResp } from '@shared/genericApiTypes';
import { PlayerClass, ServerPlayer } from '@lib/player/playerClasses';
import { anyUndefined, calcExpirationFromDuration } from '@lib/misc';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { SYM_CURRENT_MUTEX } from '@lib/symbols';
import { z } from 'zod';
import { shortenId } from '@shared/utils';
import { summarizeIdsArray } from '@lib/player/idUtils';
import { addSanctionNote, recordKick, resolvePresetId, setPlayerTags, unwatchPlayer, watchPlayer } from '@modules/ApiServer/services/playerActions';
import { movePlayerNoteToAction } from '@modules/ApiServer/services/actionNotes';
const console = consoleFactory(modulename);


//Schemas
const removeIdsBodySchema = z.object({
    ids: z.array(z.string().min(4, 'invalid identifier')),
});
export type ApiRemoveIdsReqSchema = z.infer<typeof removeIdsBodySchema>;
const saveNoteBodySchema = z.object({
    note: z.string().trim().min(1, 'The note is empty.').max(4096, 'The note is too long.'),
});
const deleteNoteBodySchema = z.object({
    noteId: z.string().min(1).max(32),
});
const moveNoteBodySchema = z.object({
    noteId: z.string().min(1).max(32),
    actionId: z.string().min(1).max(32),
});
export type ApiMovePlayerNoteReqSchema = z.infer<typeof moveNoteBodySchema>;
const watchBodySchema = z.object({
    reason: z.string().trim().min(1, 'Say why this player is being watched.').max(512, 'The reason is too long.'),
});
const setTagsBodySchema = z.object({
    tags: z.array(z.string().max(64)).max(32),
});
const sanctionNoteSchema = z.string().trim().max(4096, 'The note is too long.').optional();
const presetIdSchema = z.string().max(32).optional();

/**
 * Reads the optional punishment preset sent with a ban or warn. Returns an error message when it is unknown.
 */
const readPresetId = (ctx: AuthedCtx): { presetId?: string; error?: string } => {
    const parsed = presetIdSchema.safeParse(ctx.request.body?.presetId);
    if (!parsed.success) return { error: 'Invalid preset.' };
    try {
        return { presetId: resolvePresetId(parsed.data) };
    } catch (error) {
        return { error: (error as Error).message };
    }
};

/**
 * Saves the optional staff note sent with a ban, warn or kick. Returns an error message on failure.
 */
const saveSanctionNote = (ctx: AuthedCtx, actionId: string) => {
    const parsed = sanctionNoteSchema.safeParse(ctx.request.body?.note);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid note.';
    try {
        addSanctionNote(ctx.admin, actionId, parsed.data);
    } catch (error) {
        return (error as Error).message;
    }
};


/**
 * Actions route for the player modal
 */
export default async function PlayerActions(ctx: AuthedCtx) {
    //Sanity check
    if (anyUndefined(ctx.params.action)) {
        return ctx.utils.error(400, 'Invalid Request');
    }
    const action = ctx.params.action;
    const { mutex, netid, license } = ctx.query;
    const sendTypedResp = (data: GenericApiResp) => ctx.send(data);

    //Finding the player
    let player;
    try {
        const refMutex = mutex === 'current' ? SYM_CURRENT_MUTEX : mutex;
        player = playerResolver(refMutex, parseInt((netid as string)), license);
    } catch (error) {
        return sendTypedResp({ error: (error as Error).message });
    }

    //Delegate to the specific action handler
    if (action === 'save_note') {
        return sendTypedResp(await handleSaveNote(ctx, player));
    } else if (action === 'delete_note') {
        return sendTypedResp(await handleDeleteNote(ctx, player));
    } else if (action === 'move_note') {
        return sendTypedResp(await handleMoveNote(ctx, player));
    } else if (action === 'watch') {
        return sendTypedResp(await handleWatch(ctx, player));
    } else if (action === 'unwatch') {
        return sendTypedResp(await handleUnwatch(ctx, player));
    } else if (action === 'set_tags') {
        return sendTypedResp(await handleSetTags(ctx, player));
    } else if (action === 'warn') {
        return sendTypedResp(await handleWarning(ctx, player));
    } else if (action === 'ban') {
        return sendTypedResp(await handleBan(ctx, player));
    } else if (action === 'whitelist') {
        return sendTypedResp(await handleSetWhitelist(ctx, player));
    } else if (action === 'removeIds') {
        return sendTypedResp(await handleRemoveIds(ctx, player));
    } else if (action === 'message') {
        return sendTypedResp(await handleDirectMessage(ctx, player));
    } else if (action === 'kick') {
        return sendTypedResp(await handleKick(ctx, player));
    } else {
        return sendTypedResp({ error: 'unknown action' });
    }
};


/**
 * Handle Save Note (open to all admins): appends an entry to the player's note history
 */
async function handleSaveNote(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    const schemaRes = saveNoteBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return { error: schemaRes.error.issues[0]?.message ?? 'Invalid request.' };
    }

    try {
        player.addNote(schemaRes.data.note, ctx.admin.name);
        ctx.admin.logAction(`Set notes for ${player.license}`);
        return { success: true };
    } catch (error) {
        return { error: `Failed to save note: ${(error as Error).message}` };
    }
}


/**
 * Handle Delete Note (open to all admins, like saving one)
 */
async function handleDeleteNote(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    const schemaRes = deleteNoteBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return { error: 'Invalid request.' };
    }

    try {
        player.deleteNote(schemaRes.data.noteId);
        ctx.admin.logAction(`Deleted note ${schemaRes.data.noteId} from ${player.license}`);
        return { success: true };
    } catch (error) {
        return { error: `Failed to delete note: ${(error as Error).message}` };
    }
}


/**
 * Handle Move Note: moves a player note onto one of the player's actions (its author or manage.admins)
 */
async function handleMoveNote(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    const schemaRes = moveNoteBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return { error: 'Invalid request.' };
    }

    try {
        movePlayerNoteToAction(ctx.admin, player, schemaRes.data.noteId, schemaRes.data.actionId);
        return { success: true };
    } catch (error) {
        return { error: `Failed to move note: ${(error as Error).message}` };
    }
}


/**
 * Handle Watch (open to all admins, like notes): puts the player on the watchlist
 */
async function handleWatch(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    const schemaRes = watchBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return { error: schemaRes.error.issues[0]?.message ?? 'Invalid request.' };
    }
    try {
        watchPlayer(ctx.admin, player, schemaRes.data.reason);
        return { success: true };
    } catch (error) {
        return { error: (error as Error).message };
    }
}


/**
 * Handle Unwatch (open to all admins): takes the player off the watchlist
 */
async function handleUnwatch(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    try {
        unwatchPlayer(ctx.admin, player);
        return { success: true };
    } catch (error) {
        return { error: (error as Error).message };
    }
}


/**
 * Handle Set Tags (open to all admins): replaces the player's tags
 */
async function handleSetTags(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    const schemaRes = setTagsBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return { error: 'Invalid request.' };
    }
    try {
        setPlayerTags(ctx.admin, player, schemaRes.data.tags);
        return { success: true };
    } catch (error) {
        return { error: (error as Error).message };
    }
}


/**
 * Handle Send Warning
 */
async function handleWarning(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (anyUndefined(
        ctx.request.body,
        ctx.request.body.reason,
    )) {
        return { error: 'Invalid request.' };
    }
    const reason = ctx.request.body.reason.trim() || 'no reason provided';
    const preset = readPresetId(ctx);
    if (preset.error) return { error: preset.error };

    //Check permissions
    if (!ctx.admin.testPermission('players.warn', modulename)) {
        return { error: 'You don\'t have permission to execute this action.' };
    }

    //Validating server & player
    const allIds = player.allIdentifiers;
    if (!allIds.length) {
        return { error: 'Cannot warn a player with no identifiers.' };
    }

    //Register action
    let actionId;
    try {
        actionId = txCore.database.actions.registerWarn(
            allIds,
            ctx.admin.name,
            reason,
            player.displayName,
            preset.presetId,
        );
    } catch (error) {
        return { error: `Failed to warn player: ${(error as Error).message}` };
    }
    ctx.admin.logAction(`Warned player "${player.displayName}": ${reason}`);
    const warnNoteError = saveSanctionNote(ctx, actionId);

    // Dispatch `txAdmin:events:playerWarned`
    const eventSent = txCore.fxRunner.sendEvent('playerWarned', {
        author: ctx.admin.name,
        reason,
        actionId,
        targetNetId: (player instanceof ServerPlayer && player.isConnected) ? player.netid : null,
        targetIds: allIds,
        targetName: player.displayName,
    });

    if (!eventSent) {
        return { error: `Warn saved, but likely failed to send the warn in game (stdin error).` };
    } else if (warnNoteError) {
        return { error: `Warn saved, but the note failed: ${warnNoteError}` };
    }
    return { success: true };
}


/**
 * Handle Banning command
 */
async function handleBan(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (
        anyUndefined(
            ctx.request.body,
            ctx.request.body.duration,
            ctx.request.body.reason,
        )
    ) {
        return { error: 'Invalid request.' };
    }
    const durationInput = ctx.request.body.duration.trim();
    const reason = (ctx.request.body.reason as string).trim() || 'no reason provided';

    //Calculating expiration/duration
    let calcResults;
    try {
        calcResults = calcExpirationFromDuration(durationInput);
    } catch (error) {
        return { error: (error as Error).message };
    }
    const { expiration, duration } = calcResults;
    const preset = readPresetId(ctx);
    if (preset.error) return { error: preset.error };

    //Check permissions
    if (!ctx.admin.testPermission('players.ban', modulename)) {
        return { error: 'You don\'t have permission to execute this action.' }
    }

    //Validating player - hwids.length can be zero 
    const allIds = player.allIdentifiers;
    const allHwids = player.allHardwareIdentifiers;
    if (!allIds.length) {
        return { error: 'Cannot ban a player with no identifiers.' }
    }

    //Register action
    let actionId;
    try {
        actionId = txCore.database.actions.registerBan(
            allIds,
            ctx.admin.name,
            reason,
            expiration,
            player.displayName,
            allHwids,
            preset.presetId,
        );
    } catch (error) {
        return { error: `Failed to ban player: ${(error as Error).message}` };
    }
    ctx.admin.logAction(`Banned player "${player.displayName}": ${reason}`);
    const banNoteError = saveSanctionNote(ctx, actionId);
    const noteFailedResp = banNoteError ? { error: `Ban saved, but the note failed: ${banNoteError}` } : undefined;

    //No need to dispatch events if server is not online
    if (txCore.fxRunner.isIdle) {
        return noteFailedResp ?? { success: true };
    }

    //Prepare and send command
    let kickMessage, durationTranslated;
    const tOptions: any = {
        author: txCore.adminStore.getAdminPublicName(ctx.admin.name, 'punishment'),
        reason: reason,
    };
    if (expiration !== false && duration) {
        durationTranslated = txCore.translator.tDuration(
            duration * 1000,
            { units: ['d', 'h'] },
        );
        tOptions.expiration = durationTranslated;
        kickMessage = txCore.translator.t('ban_messages.kick_temporary', tOptions);
    } else {
        durationTranslated = null;
        kickMessage = txCore.translator.t('ban_messages.kick_permanent', tOptions);
    }

    // Dispatch `txAdmin:events:playerBanned`
    const eventSent = txCore.fxRunner.sendEvent('playerBanned', {
        author: ctx.admin.name,
        reason,
        actionId,
        expiration,
        durationInput,
        durationTranslated,
        targetNetId: (player instanceof ServerPlayer) ? player.netid : null,
        targetIds: allIds,
        targetHwids: allHwids,
        targetName: player.displayName,
        kickMessage,
    });

    if (eventSent) {
        return noteFailedResp ?? { success: true };
    } else {
        return { error: `Player banned, but likely failed to kick player (stdin error).` };
    }
}


/**
 * Handle Player Whitelist Action
 */
async function handleSetWhitelist(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (anyUndefined(
        ctx.request.body,
        ctx.request.body.status,
    )) {
        return { error: 'Invalid request.' };
    }
    const status = (ctx.request.body.status === 'true' || ctx.request.body.status === true);

    //Check permissions
    if (!ctx.admin.testPermission('players.whitelist', modulename)) {
        return { error: 'You don\'t have permission to execute this action.' }
    }

    try {
        player.setWhitelist(status);
        if (status) {
            ctx.admin.logAction(`Added ${player.license} to the whitelist.`);
        } else {
            ctx.admin.logAction(`Removed ${player.license} from the whitelist.`);
        }

        // Dispatch `txAdmin:events:whitelistPlayer`
        txCore.fxRunner.sendEvent('whitelistPlayer', {
            action: status ? 'added' : 'removed',
            license: player.license,
            playerName: player.displayName,
            adminName: ctx.admin.name,
        });

        return { success: true };
    } catch (error) {
        return { error: `Failed to save whitelist status: ${(error as Error).message}` };
    }
}


/**
 * Handle Player Removal of IDs
 */
async function handleRemoveIds(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    const schemaRes = removeIdsBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return { error: 'Invalid request body.' };
    }
    const { ids: idsToDelete } = schemaRes.data;

    //Check permissions
    if (!ctx.admin.testPermission('players.remove_ids', modulename)) {
        return { error: 'You don\'t have permission to execute this action.' }
    }

    //Checking IDs
    if (!player.license || !player.isRegistered) {
        return { error: 'This player is not registered in the database, so there is no saved ID to delete.' };
    }
    if (idsToDelete.includes(player.license)) {
        return { error: 'You cannot remove the player\'s license from their IDs.' };
    }
    if (player instanceof ServerPlayer && player.isConnected) {
        // If the player is connected, player.ids/hwids only contain the active IDs
        const onlineIdFound = idsToDelete.find(id => player.idsOnline.includes(id));
        if (onlineIdFound) {
            return { error: `The player #${player.netid} currently has the ID ${shortenId(onlineIdFound)}, so you need to wait for them to disconnect from the server to be able to delete it from the player history.` };
        }
        const onlineHwidFound = idsToDelete.find(id => player.hwidsOnline.includes(id));
        if (onlineHwidFound) {
            return { error: `The player #${player.netid} currently has the HWID ${shortenId(onlineHwidFound, 6)}, so you need to wait for them to disconnect from the server to be able to delete it from the player history.` };
        }
    }

    try {
        player.removeIds(idsToDelete);
        const summarizedIds = summarizeIdsArray(idsToDelete);
        ctx.admin.logAction(`Deleted IDs/HWIDs ${summarizedIds} from player "${player.displayName}" with license ${player.license}.`);

        return { success: true };
    } catch (error) {
        return { error: `Failed to save whitelist status: ${(error as Error).message}` };
    }
}


/**
 * Handle Direct Message Action
 */
async function handleDirectMessage(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (anyUndefined(
        ctx.request.body,
        ctx.request.body.message,
    )) {
        return { error: 'Invalid request.' };
    }
    const message = ctx.request.body.message.trim();
    if (!message.length) {
        return { error: 'Cannot send a DM with empty message.' };
    }

    //Check permissions
    if (!ctx.admin.testPermission('players.direct_message', modulename)) {
        return { error: 'You don\'t have permission to execute this action.' };
    }

    //Validating server & player
    if (!txCore.fxRunner.child?.isAlive) {
        return { error: 'The server is not running.' };
    }
    if (!(player instanceof ServerPlayer) || !player.isConnected) {
        return { error: 'This player is not connected to the server.' };
    }

    try {
        ctx.admin.logAction(`DM to "${player.displayName}": ${message}`);

        // Dispatch `txAdmin:events:playerDirectMessage`
        txCore.fxRunner.sendEvent('playerDirectMessage', {
            target: player.netid,
            author: ctx.admin.name,
            message,
        });

        return { success: true };
    } catch (error) {
        return { error: `Failed to save dm player: ${(error as Error).message}` };
    }
}


/**
 * Handle Kick Action
 */
async function handleKick(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (anyUndefined(
        ctx.request.body,
        ctx.request.body.reason,
    )) {
        return { error: 'Invalid request.' };
    }
    const kickReason = ctx.request.body.reason.trim() || txCore.translator.t('kick_messages.unknown_reason');

    //Check permissions
    if (!ctx.admin.testPermission('players.kick', modulename)) {
        return { error: 'You don\'t have permission to execute this action.' };
    }

    //Validating server & player
    if (!txCore.fxRunner.child?.isAlive) {
        return { error: 'The server is not running.' };
    }
    if (!(player instanceof ServerPlayer) || !player.isConnected) {
        return { error: 'This player is not connected to the server.' };
    }

    try {
        //everfall: kicks are recorded in the player history, with an optional staff note
        const actionId = recordKick(ctx.admin.name, player.allIdentifiers, kickReason, player.displayName);
        ctx.admin.logAction(`Kicked "${player.displayName}": ${kickReason}`);
        const noteError = actionId ? saveSanctionNote(ctx, actionId) : undefined;
        const dropMessage = txCore.translator.t(
            'kick_messages.player',
            { reason: kickReason }
        );

        // Dispatch `txAdmin:events:playerKicked`
        txCore.fxRunner.sendEvent('playerKicked', {
            target: player.netid,
            author: ctx.admin.name,
            reason: kickReason,
            dropMessage,
            actionId: actionId ?? null,
            targetName: player.displayName,
        });

        if (noteError) {
            return { error: `Player kicked, but the note failed: ${noteError}` };
        }
        return { success: true };
    } catch (error) {
        return { error: `Failed to save kick player: ${(error as Error).message}` };
    }
}
