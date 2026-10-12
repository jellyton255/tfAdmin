import { describe, expect, it } from 'vitest';
import { appendNote, migrateLegacyNote, newestNote, notesNewestFirst } from './playerNotes';

describe('migrateLegacyNote', () => {
    it('turns the v5 note into the first history entry', () => {
        expect(migrateLegacyNote({ text: ' watch him ', lastAdmin: 'julian', tsLastEdit: 500 }, 100)).toEqual([
            { id: expect.any(String), text: 'watch him', author: 'julian', ts: 500 },
        ]);
    });

    it('keeps notes with no recorded author or time', () => {
        expect(migrateLegacyNote({ text: 'old', lastAdmin: null, tsLastEdit: null }, 100)).toMatchObject([
            { text: 'old', author: 'unknown', ts: 100 },
        ]);
    });

    it('drops empty notes and leaves an existing history as it is', () => {
        expect(migrateLegacyNote(undefined, 1)).toBeUndefined();
        expect(migrateLegacyNote({ text: '  ', lastAdmin: 'a', tsLastEdit: 1 }, 1)).toBeUndefined();
        const history = [{ id: 'X', text: 't', author: 'a', ts: 1 }];
        expect(migrateLegacyNote(history, 1)).toBe(history);
        expect(migrateLegacyNote([], 1)).toBeUndefined();
    });
});

describe('note history', () => {
    it('appends with unique ids and reads newest first', () => {
        const first = appendNote(undefined, 'one', 'a', 10);
        const second = appendNote(first.history, 'two', 'b', 10);
        const third = appendNote(second.history, 'three', 'c', 5);
        expect(second.note.id).not.toBe(first.note.id);
        expect(notesNewestFirst(third.history).map((n) => n.text)).toEqual(['two', 'one', 'three']);
        expect(newestNote(third.history)?.text).toBe('two');
        expect(newestNote(undefined)).toBeUndefined();
    });
});
