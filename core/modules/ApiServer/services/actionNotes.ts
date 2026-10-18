const modulename = 'ApiServer:ActionNotes';
import { NOTE_MAX_LENGTH } from '@lib/notes';
import { isNoteAuthor } from '@shared/noteAuthor';
import type { PlayerClass } from '@lib/player/playerClasses';
import type { DatabaseActionType, DatabaseNoteType } from '@modules/Database/databaseTypes';
import type { AuthedAdmin } from '@modules/WebServer/authLogic';
import { secToMs } from '../pagination';
import { ApiError } from '../envelope';
import type { ApiActionNote } from '@shared/apiV1Types';

/**
 * Staff notes on actions (bans, warns, kicks), shared by the panel, the public API and game exports.
 * Anyone who can add a note edits and deletes their own; manage.admins can delete any note.
 * Deletes are soft: the note stays in the database with who deleted it and when.
 */

//Who writes the note: an admin, an API key principal, or a game script label
export type NoteWriter = Pick<AuthedAdmin, 'name' | 'logAction'>;
type NoteManager = NoteWriter & Pick<AuthedAdmin, 'hasPermission'>;

//The permission that lets a key write notes on an action, besides players.note
export const ACTION_NOTE_SCOPES: Record<DatabaseActionType['type'], string> = {
    ban: 'players.ban',
    warn: 'players.warn',
    kick: 'players.kick',
    sanction: 'players.note',
};

export const toApiActionNote = (note: DatabaseNoteType): ApiActionNote => ({
    id: note.id,
    text: note.text,
    author: note.author,
    createdAt: secToMs(note.ts) ?? 0,
    editedAt: secToMs(note.editedTs),
});

const parseNoteText = (input: string) => {
    const text = input.trim();
    if (!text.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot save an empty note.', { field: 'text' });
    }
    if (text.length > NOTE_MAX_LENGTH) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'The note is too long.', { field: 'text' });
    }
    return text;
};

export const findActionOr404 = (actionId: string) => {
    const action = txCore.database.actions.findOne(actionId);
    if (!action) throw new ApiError(404, 'NOT_FOUND', 'Action not found.', { id: actionId });
    return action;
};

const findNoteOr404 = (action: DatabaseActionType, noteId: string) => {
    const note = action.notes?.find((x) => x.id === noteId && !x.deleted);
    if (!note) throw new ApiError(404, 'NOT_FOUND', 'Note not found.', { noteId });
    return note;
};

const publishNoteAdded = (action: DatabaseActionType, note: DatabaseNoteType) => {
    txCore.apiServer.publishEvent('action.noteAdded', {
        actionId: action.id,
        actionType: action.type,
        playerName: action.playerName,
        playerIds: action.ids,
        note: toApiActionNote(note),
    });
};


/**
 * Adds a note to an action and publishes action.noteAdded.
 */
export const addActionNote = (writer: NoteWriter, actionId: string, textInput: string) => {
    const action = findActionOr404(actionId);
    const text = parseNoteText(textInput);
    let note: DatabaseNoteType;
    try {
        note = txCore.database.actions.addNote(action.id, text, writer.name);
    } catch (error) {
        throw new ApiError(500, 'INTERNAL_ERROR', `Failed to save note: ${(error as Error).message}`);
    }
    writer.logAction(`Added a note to ${action.type} ${action.id}`);
    publishNoteAdded(action, note);
    return toApiActionNote(note);
};


/**
 * Replaces the text of a note. Only its author can edit it.
 */
export const editActionNote = (writer: NoteWriter, actionId: string, noteId: string, textInput: string) => {
    const action = findActionOr404(actionId);
    const existing = findNoteOr404(action, noteId);
    if (!isNoteAuthor(existing, writer.name)) {
        throw new ApiError(403, 'FORBIDDEN', 'You can only edit your own notes.', { noteId });
    }
    const text = parseNoteText(textInput);
    const note = txCore.database.actions.editNote(action.id, noteId, text);
    writer.logAction(`Edited note ${noteId} on ${action.type} ${action.id}`);
    return toApiActionNote(note);
};


/**
 * Soft deletes a note. Its author or an admin with manage.admins can delete it.
 */
export const deleteActionNote = (manager: NoteManager, actionId: string, noteId: string) => {
    const action = findActionOr404(actionId);
    const existing = findNoteOr404(action, noteId);
    if (!isNoteAuthor(existing, manager.name) && !manager.hasPermission('manage.admins')) {
        throw new ApiError(403, 'FORBIDDEN', 'You can only delete your own notes.', { noteId });
    }
    const note = txCore.database.actions.deleteNote(action.id, noteId, manager.name);
    manager.logAction(`Deleted note ${noteId} on ${action.type} ${action.id}`);
    return toApiActionNote(note);
};


/**
 * Moves a note from a player onto one of that player's actions, keeping its author and time.
 * Its author or an admin with manage.admins can move it.
 */
export const movePlayerNoteToAction = (manager: NoteManager, player: PlayerClass, noteId: string, actionId: string) => {
    const dbData = player.getDbData();
    const note = dbData ? dbData.noteHistory?.find((x) => x.id === noteId) : undefined;
    if (!note) throw new ApiError(404, 'NOT_FOUND', 'Note not found.', { noteId });
    if (!isNoteAuthor(note, manager.name) && !manager.hasPermission('manage.admins')) {
        throw new ApiError(403, 'FORBIDDEN', 'You can only move your own notes.', { noteId });
    }
    const action = findActionOr404(actionId);
    if (!player.license || !action.ids.includes(`license:${player.license}`)) {
        throw new ApiError(409, 'CONFLICT', 'This action is not on this player.', { id: actionId });
    }
    txCore.database.actions.attachNote(action.id, note);
    player.deleteNote(noteId);
    manager.logAction(`Moved note ${noteId} from ${player.license} to ${action.type} ${action.id}`);
};
