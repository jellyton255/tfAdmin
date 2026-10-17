import { describe, expect, it } from 'vitest';
import {
    appendNote, editNote, migrateLegacyNote, newestNote, notesNewestFirst, softDeleteNote, visibleNotes,
} from './notes';
import { isNoteAuthor } from '@shared/noteAuthor';

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

describe('action notes', () => {
    it('edits and soft deletes, hiding deleted notes unless asked', () => {
        const { history } = appendNote(undefined, 'one', 'julian', 10);
        const id = history[0].id;
        const edited = editNote(history, id, 'one, fixed', 20);
        expect(edited.note).toMatchObject({ text: 'one, fixed', editedTs: 20, ts: 10 });
        const deleted = softDeleteNote(edited.history, id, 'boss', 30);
        expect(deleted.history).toHaveLength(1);
        expect(visibleNotes(deleted.history)).toEqual([]);
        expect(visibleNotes(deleted.history, true)[0].deleted).toEqual({ author: 'boss', ts: 30 });
        expect(newestNote(deleted.history)).toBeUndefined();
        expect(() => editNote(deleted.history, id, 'x', 40)).toThrow();
    });

    it('keeps the id of a moved note unless it is taken', () => {
        const first = appendNote(undefined, 'a', 'x', 1, 'KEEPME12');
        expect(first.note.id).toBe('KEEPME12');
        expect(appendNote(first.history, 'b', 'x', 2, 'KEEPME12').note.id).not.toBe('KEEPME12');
    });

    it('treats API writes for a staff member as theirs, and unknown authors as nobody', () => {
        const note = { id: 'a', text: 't', author: 'Julian (via api:Admin Panel)', ts: 1 };
        expect(isNoteAuthor(note, 'Julian')).toBe(true);
        expect(isNoteAuthor(note, 'Julian (via api:Discord Bot)')).toBe(true);
        expect(isNoteAuthor(note, 'Ana')).toBe(false);
        expect(isNoteAuthor({ ...note, author: 'unknown' }, 'unknown')).toBe(false);
    });
});
