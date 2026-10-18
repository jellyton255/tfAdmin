import { describe, expect, it } from 'vitest';
import { countActiveOffenses, nextLadderStep } from '@shared/offenseLadder';
import type { PlayerHistoryItem } from '@shared/playerApiTypes';
import type { BanTemplatesDataType } from '@modules/ConfigStore/schema/banlist';

const rdm: BanTemplatesDataType = {
    id: 'a'.repeat(21),
    reason: 'Random deathmatch',
    duration: { value: 1, unit: 'days' },
    name: 'RDM',
    ladder: ['warn', { value: 1, unit: 'days' }, 'permanent'],
};
const item = (overrides: Partial<PlayerHistoryItem>): PlayerHistoryItem => ({
    id: 'W0000-0000', type: 'warn', author: 'julian', reason: 'rdm', ts: 0,
    presetId: rdm.id, offenseUntil: 2000, ...overrides,
});

describe('countActiveOffenses', () => {
    it('counts preset offenses inside the window that were not revoked', () => {
        const history = [
            item({}),
            item({ offenseUntil: 900 }), //outside the window
            item({ revokedAt: 500 }),
            item({ presetId: 'b'.repeat(21) }),
            item({ presetId: undefined, offenseUntil: undefined }),
        ];
        expect(countActiveOffenses(history, rdm.id, 1000)).toBe(1);
    });
});

describe('nextLadderStep', () => {
    it('walks the ladder and stays on the last step', () => {
        expect(nextLadderStep(rdm, 0)).toBe('warn');
        expect(nextLadderStep(rdm, 1)).toEqual({ value: 1, unit: 'days' });
        expect(nextLadderStep(rdm, 5)).toBe('permanent');
    });

    it('treats a preset without a ladder as one ban of its duration', () => {
        expect(nextLadderStep({ ...rdm, ladder: undefined }, 3)).toEqual({ value: 1, unit: 'days' });
    });
});
