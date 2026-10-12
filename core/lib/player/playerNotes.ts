import { customAlphabet } from 'nanoid';
import consts from '@shared/consts';
import type { DatabaseLegacyPlayerNoteType, DatabasePlayerNoteType } from '@modules/Database/databaseTypes';

const genNoteId = customAlphabet(consts.actionIdAlphabet, 8);


/**
 * Converts the single note of database v5 and older into the v6 note history.
 * Returns undefined when there is nothing to keep. An existing history passes through unchanged,
 * so running it twice on the same player is harmless.
 */
export function migrateLegacyNote(
    notes: DatabaseLegacyPlayerNoteType | DatabasePlayerNoteType[] | undefined,
    tsJoined: number,
): DatabasePlayerNoteType[] | undefined {
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
 * The most recent note, which backs the single-note fields of the public API.
 */
export function newestNote(history: DatabasePlayerNoteType[] | undefined): DatabasePlayerNoteType | undefined {
    return notesNewestFirst(history)[0];
}


/**
 * Returns a new history with the note appended, using an id that is unique within the player.
 */
export function appendNote(
    history: DatabasePlayerNoteType[] | undefined,
    text: string,
    author: string,
    ts: number,
): { history: DatabasePlayerNoteType[]; note: DatabasePlayerNoteType } {
    const current = history ?? [];
    const takenIds = new Set(current.map((note) => note.id));
    let id = genNoteId();
    while (takenIds.has(id)) id = genNoteId();
    const note = { id, text, author, ts };
    return { history: [...current, note], note };
}


/**
 * The note history newest first, keeping notes saved in the same second newest first too.
 */
export function notesNewestFirst(history: DatabasePlayerNoteType[] | undefined) {
    return [...(history ?? [])].reverse().sort((a, b) => b.ts - a.ts);
}
