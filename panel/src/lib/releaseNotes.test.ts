import { expect, it, suite } from 'vitest';
import type { ReleaseNote } from '@shared/releaseNotesTypes';
import { getUnseenNotes, groupNotesByDay } from './releaseNotes';

const note = (commit: string, landedAt: string): ReleaseNote => ({
    commit,
    landedAt,
    type: 'feat',
    scope: null,
    text: commit,
});
const notes = [
    note('c3', '2026-10-11T12:00:00Z'),
    note('c2', '2026-10-11T11:00:00Z'),
    note('c1', '2026-10-09T12:00:00Z'),
];


suite('groupNotesByDay', () => {
    it('groups consecutive notes from the same day', () => {
        const days = groupNotesByDay(notes);
        expect(days.map((d) => d.notes.map((n) => n.commit))).toEqual([['c3', 'c2'], ['c1']]);
        expect(days[0].day).toBe('October 11, 2026');
    });
});


suite('getUnseenNotes', () => {
    it('returns nothing when the newest note was seen', () => {
        expect(getUnseenNotes(notes, 'c3')).toEqual([]);
        expect(getUnseenNotes([], null)).toEqual([]);
    });

    it('returns the notes newer than the last seen one', () => {
        expect(getUnseenNotes(notes, 'c1').map((n) => n.commit)).toEqual(['c3', 'c2']);
    });

    it('falls back to the newest day for new or unknown browsers', () => {
        expect(getUnseenNotes(notes, null).map((n) => n.commit)).toEqual(['c3', 'c2']);
        expect(getUnseenNotes(notes, 'rewritten').map((n) => n.commit)).toEqual(['c3', 'c2']);
    });
});
