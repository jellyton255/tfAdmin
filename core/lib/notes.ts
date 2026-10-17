import { customAlphabet } from 'nanoid';
import consts from '@shared/consts';
import type { DatabaseLegacyPlayerNoteType, DatabaseNoteType } from '@modules/Database/databaseTypes';

/**
 * Staff notes, shared by players (noteHistory) and actions (notes).
 * Both lists are oldest first and absent when empty. Player notes are removed when deleted;
 * action notes are soft deleted (kept with who deleted them and when).
 */

const genNoteId = customAlphabet(consts.actionIdAlphabet, 8);
export const NOTE_MAX_LENGTH = 4096;


/**
 * Converts the single note of database v5 and older into the v6 note history.
 * Returns undefined when there is nothing to keep. An existing history passes through unchanged,
 * so running it twice on the same player is harmless.
 */
export function migrateLegacyNote(
    notes: DatabaseLegacyPlayerNoteType | DatabaseNoteType[] | undefined,
    tsJoined: number,
): DatabaseNoteType[] | undefined {
    if (Array.isArray(notes)) return notes.length ? notes : undefined;
    if (!notes || typeof notes.text !== 'string' || !notes.text.trim()) return undefined;
    return [{
        id: genNoteId(),
        text: notes.text.trim(),
        author: notes.lastAdmin || 'unknown',
        ts: notes.tsLastEdit ?? tsJoined,
    }];
}


/**
 * The notes that are not deleted, or all of them when includeDeleted is true.
 */
export function visibleNotes(history: DatabaseNoteType[] | undefined, includeDeleted = false) {
    if (!history) return [];
    return includeDeleted ? history : history.filter((note) => !note.deleted);
}


/**
 * The most recent visible note, which backs the single-note fields of the public API.
 */
export function newestNote(history: DatabaseNoteType[] | undefined): DatabaseNoteType | undefined {
    return notesNewestFirst(history)[0];
}


/**
 * Returns a new history with the note appended, using an id that is unique within the list.
 * The note keeps the given id when it is free, so a note moved between lists keeps its id.
 */
export function appendNote(
    history: DatabaseNoteType[] | undefined,
    text: string,
    author: string,
    ts: number,
    preferredId?: string,
): { history: DatabaseNoteType[]; note: DatabaseNoteType } {
    const current = history ?? [];
    const takenIds = new Set(current.map((note) => note.id));
    let id = preferredId && !takenIds.has(preferredId) ? preferredId : genNoteId();
    while (takenIds.has(id)) id = genNoteId();
    const note = { id, text, author, ts };
    return { history: [...current, note], note };
}


/**
 * Returns a new history with the text of one visible note replaced.
 */
export function editNote(history: DatabaseNoteType[] | undefined, noteId: string, text: string, ts: number) {
    const current = history ?? [];
    const found = current.find((note) => note.id === noteId && !note.deleted);
    if (!found) throw new Error('note not found');
    const note: DatabaseNoteType = { ...found, text, editedTs: ts };
    return { history: current.map((x) => (x.id === noteId ? note : x)), note };
}


/**
 * Returns a new history with one visible note marked as deleted by the author.
 */
export function softDeleteNote(history: DatabaseNoteType[] | undefined, noteId: string, author: string, ts: number) {
    const current = history ?? [];
    const found = current.find((note) => note.id === noteId && !note.deleted);
    if (!found) throw new Error('note not found');
    const note: DatabaseNoteType = { ...found, deleted: { author, ts } };
    return { history: current.map((x) => (x.id === noteId ? note : x)), note };
}


/**
 * The visible notes newest first, keeping notes saved in the same second newest first too.
 */
export function notesNewestFirst(history: DatabaseNoteType[] | undefined, includeDeleted = false) {
    return [...visibleNotes(history, includeDeleted)].reverse().sort((a, b) => b.ts - a.ts);
}

