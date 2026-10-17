const modulename = 'DatabaseNoteMove';
import fsp from 'node:fs/promises';
import consts from '@shared/consts';
import { txEnv } from '@core/globalData';
import { appendNote } from '@lib/notes';
import { noteAuthorPerson } from '@shared/noteAuthor';
import consoleFactory from '@lib/console';
import type { DatabaseActionType, DatabaseDataType, DatabaseNoteType, DatabasePlayerType } from './databaseTypes';
import type { DatabaseObjectType } from './instance';
const console = consoleFactory(modulename);

/**
 * One-time pass that moves player notes onto the ban or warn they describe.
 * A note moves only when the match is clear:
 * - its text names exactly one of that player's action ids, or
 * - it names no action id, reads as a single entry, and exactly one ban or warn on that player was
 *   made by the note's author within 15 minutes of the note.
 * Notes from database v5 and older were one note per player that staff kept appending to, so a note
 * with line breaks or more than one date is a running history, not a note about one sanction.
 * Everything else stays on the player, where staff can move it by hand.
 */

export const NOTE_MOVE_MARKER = 'move-player-notes-to-actions';
const NOTE_MOVE_WINDOW = 15 * 60; //seconds
const actionIdRegex = new RegExp(`\\b[${consts.actionIdAlphabet}]{4}-[${consts.actionIdAlphabet}]{4}\\b`, 'gi');
const months = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const dateRegex = new RegExp([
    '\\b\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?\\b', //10/14/24, 30.09.2024, 10/21
    `\\b\\d{1,2}(?:st|nd|rd|th)? ${months}\\b`, //5 October
    `\\b${months} \\d{1,2}(?:st|nd|rd|th)?\\b`, //May 3rd
].join('|'), 'gi');

/**
 * Whether the note reads as one entry rather than a running history.
 */
export function isSingleEntryNote(text: string) {
    const trimmed = text.trim();
    return !trimmed.includes('\n') && (trimmed.match(dateRegex) ?? []).length <= 1;
}

export type NoteMove = {
    license: string;
    note: DatabaseNoteType;
    actionId: string;
    rule: 'id' | 'time';
};


/**
 * Picks the action a player note belongs to, or undefined when the match is not clear.
 */
export function matchNoteToAction(note: DatabaseNoteType, playerActions: DatabaseActionType[]) {
    const mentioned = new Set([...note.text.matchAll(actionIdRegex)].map((m) => m[0].toUpperCase()));
    if (mentioned.size) {
        const named = playerActions.filter((action) => mentioned.has(action.id));
        return named.length === 1 ? { action: named[0], rule: 'id' as const } : undefined;
    }

    if (note.author === 'unknown' || !isSingleEntryNote(note.text)) return undefined;
    const notePerson = noteAuthorPerson(note.author);
    const nearby = playerActions.filter((action) => (
        (action.type === 'ban' || action.type === 'warn')
        && noteAuthorPerson(action.author) === notePerson
        && Math.abs(note.ts - action.timestamp) <= NOTE_MOVE_WINDOW
    ));
    return nearby.length === 1 ? { action: nearby[0], rule: 'time' as const } : undefined;
}


/**
 * Lists the notes that would move, without changing anything.
 */
export function planNoteMoves(players: DatabasePlayerType[], actions: DatabaseActionType[]): NoteMove[] {
    const actionsByLicense = new Map<string, DatabaseActionType[]>();
    for (const action of actions) {
        for (const id of action.ids) {
            if (!id.startsWith('license:')) continue;
            const license = id.slice('license:'.length);
            const list = actionsByLicense.get(license);
            if (list) {
                list.push(action);
            } else {
                actionsByLicense.set(license, [action]);
            }
        }
    }

    const moves: NoteMove[] = [];
    for (const player of players) {
        if (!player.noteHistory?.length) continue;
        const playerActions = actionsByLicense.get(player.license);
        if (!playerActions) continue;
        for (const note of player.noteHistory) {
            const match = matchNoteToAction(note, playerActions);
            if (match) moves.push({ license: player.license, note, actionId: match.action.id, rule: match.rule });
        }
    }
    return moves;
}


/**
 * Applies the moves to the database data in place: each note joins its action with the same
 * author and time, and leaves the player's note history.
 */
export function applyNoteMoves(data: DatabaseDataType, moves: NoteMove[]) {
    const actionsById = new Map(data.actions.map((action) => [action.id, action]));
    const playersByLicense = new Map(data.players.map((player) => [player.license, player]));
    for (const move of moves) {
        const action = actionsById.get(move.actionId)!;
        const player = playersByLicense.get(move.license)!;
        action.notes = appendNote(action.notes, move.note.text, move.note.author, move.note.ts, move.note.id).history;
        const remaining = player.noteHistory!.filter((note) => note !== move.note);
        player.noteHistory = remaining.length ? remaining : undefined;
    }
}


/**
 * Runs the pass once per database: backs the file up, moves the clear matches, logs each move to
 * the admin log, and stores the marker together with the moves.
 */
export async function runNoteMovePass(dbo: DatabaseObjectType, dbPath: string) {
    const data = dbo.data;
    if (data.tfMigrations?.includes(NOTE_MOVE_MARKER)) return;

    const backupPath = `${txEnv.profilePath}/data/playersDB.backup.before-note-move.json`;
    await fsp.copyFile(dbPath, backupPath);

    const moves = planNoteMoves(data.players, data.actions);
    const playerNotesBefore = data.players.reduce((acc, player) => acc + (player.noteHistory?.length ?? 0), 0);
    applyNoteMoves(data, moves);
    data.tfMigrations = [...(data.tfMigrations ?? []), NOTE_MOVE_MARKER];
    await dbo.write();

    for (const move of moves) {
        txCore.logger.admin.write(
            'tfAdmin',
            `Moved note ${move.note.id} by ${move.note.author} from player ${move.license} to ${move.actionId} (${move.rule === 'id' ? 'action id in text' : 'same author within 15 minutes'})`,
        );
    }
    console.ok(`Moved ${moves.length} of ${playerNotesBefore} player notes onto actions (backup: ${backupPath}).`);
}
