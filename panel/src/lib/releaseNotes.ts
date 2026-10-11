import type { ReleaseNote } from '@shared/releaseNotesTypes';

export type ReleaseNoteDay = {
    day: string;
    notes: ReleaseNote[];
};


/**
 * Groups notes (newest first) by the local day they reached master.
 */
export function groupNotesByDay(notes: ReleaseNote[]) {
    const days: ReleaseNoteDay[] = [];
    for (const note of notes) {
        const day = new Date(note.landedAt).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        });
        const last = days.at(-1);
        if (last?.day === day) {
            last.notes.push(note);
        } else {
            days.push({ day, notes: [note] });
        }
    }
    return days;
}


/**
 * Notes newer than the last one this browser has seen.
 * Without a known last-seen note, only the newest day is shown.
 */
export function getUnseenNotes(notes: ReleaseNote[], lastSeenCommit: string | null) {
    if (!notes.length || notes[0].commit === lastSeenCommit) return [];
    const seenIndex = lastSeenCommit ? notes.findIndex((note) => note.commit === lastSeenCommit) : -1;
    if (seenIndex !== -1) return notes.slice(0, seenIndex);
    return groupNotesByDay(notes)[0].notes;
}
