import { describe, expect, it } from 'vitest';
import { hasTag, normalizeTags, tagSuggestions, TAG_MAX_COUNT } from './playerTags';

describe('normalizeTags', () => {
    it('trims, collapses spaces and drops empty and duplicate tags', () => {
        expect(normalizeTags([' VIP ', 'content   creator', '', 'vip', 'Content Creator'])).toEqual([
            'VIP', 'content creator',
        ]);
    });

    it('rejects long tags and too many tags', () => {
        expect(() => normalizeTags(['x'.repeat(33)])).toThrow();
        expect(() => normalizeTags(Array.from({ length: TAG_MAX_COUNT + 1 }, (_, i) => `t${i}`))).toThrow();
    });
});

describe('hasTag', () => {
    it('ignores case', () => {
        expect(hasTag({ tags: ['Under Review'] }, ' under review')).toBe(true);
        expect(hasTag({}, 'VIP')).toBe(false);
    });
});

describe('tagSuggestions', () => {
    it('lists used tags by count, then unused defaults', () => {
        const players = [{ tags: ['Racer', 'vip'] }, { tags: ['Racer'] }, {}];
        expect(tagSuggestions(players)).toEqual(['Racer', 'vip', 'Content Creator', 'Donor', 'Under Review']);
    });
});
