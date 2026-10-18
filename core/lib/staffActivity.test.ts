import { describe, expect, it } from 'vitest';
import type { DatabaseActionBaseType, DatabaseActionType, DatabasePlayerType } from '@modules/Database/databaseTypes';
import { addStaffMinute, buildStaffActivity, utcWeekStart } from './staffActivity';

//Wednesday 2026-10-14 12:00 UTC
const NOW = Date.UTC(2026, 9, 14, 12);
const sec = (ms: number) => Math.floor(ms / 1000);
const DAY = 24 * 60 * 60 * 1000;

function action(type: DatabaseActionType['type'], author: string, tsMs: number, extra: Partial<DatabaseActionBaseType> = {}): DatabaseActionType {
    const base: DatabaseActionBaseType = {
        id: `${type[0].toUpperCase()}AAA-AAAA`,
        ids: ['license:aaaa'],
        playerName: 'Bob',
        reason: 'test',
        author,
        timestamp: sec(tsMs),
        revocation: { timestamp: null, author: null },
        ...extra,
    };
    if (type === 'warn') return { ...base, type, expiration: false, acked: false };
    if (type === 'sanction') return { ...base, type, expiration: false, kind: 'Jail' };
    return { ...base, type, expiration: false };
}

const player = (ids: string[], extra: Partial<DatabasePlayerType> = {}): DatabasePlayerType => ({
    license: 'aaaa',
    ids,
    hwids: [],
    displayName: 'Player',
    pureName: 'player',
    playTime: 0,
    tsLastConnection: sec(NOW - DAY),
    tsJoined: 0,
    ...extra,
});

describe('utcWeekStart', () => {
    it('starts weeks on Monday 00:00 UTC', () => {
        expect(utcWeekStart(NOW)).toBe(Date.UTC(2026, 9, 12));
        expect(utcWeekStart(Date.UTC(2026, 9, 18, 23, 59))).toBe(Date.UTC(2026, 9, 12));
        expect(utcWeekStart(Date.UTC(2026, 9, 19))).toBe(Date.UTC(2026, 9, 19));
    });
});

describe('addStaffMinute', () => {
    it('adds to today and drops days too old to show', () => {
        expect(addStaffMinute(undefined, NOW)).toEqual([['2026-10-14', 1]]);
        expect(addStaffMinute([['2025-01-01', 50], ['2026-10-14', 4]], NOW)).toEqual([['2026-10-14', 5]]);
        expect(addStaffMinute([['2026-10-13', 4]], NOW)).toEqual([['2026-10-13', 4], ['2026-10-14', 1]]);
    });
});

describe('buildStaffActivity', () => {
    const admins = [
        { name: 'Alice', identifiers: ['discord:111'] },
        { name: 'Carol', identifiers: ['fivem:222'] },
    ];

    it('counts actions, revokes, notes and time online per week', () => {
        const lastWeek = NOW - 7 * DAY;
        const actions = [
            action('ban', 'Alice', NOW, {
                revocation: { timestamp: sec(NOW), author: 'carol' },
                notes: [
                    { id: 'n1', text: 'clip', author: 'Carol', ts: sec(NOW) },
                    { id: 'n2', text: 'gone', author: 'Carol', ts: sec(NOW), deleted: { author: 'Carol', ts: sec(NOW) } },
                ],
            }),
            action('warn', 'Alice', lastWeek),
            action('kick', 'Alice', NOW),
            action('sanction', 'Alice', NOW),
            action('ban', 'Alice', NOW - 30 * DAY),
            action('ban', 'api:Bot', NOW),
        ];
        const players = [
            player(['license:aaaa', 'discord:111'], {
                staffPlayDays: [['2026-10-05', 30], ['2026-10-13', 90]],
                noteHistory: [{ id: 'p1', text: 'watch', author: 'Alice', ts: sec(lastWeek) }],
            }),
        ];

        const data = buildStaffActivity({ admins, actions, players, weeks: 2, nowMs: NOW });
        expect(data.weekStarts).toEqual([Date.UTC(2026, 9, 5), Date.UTC(2026, 9, 12)]);
        expect(data.staff.map((member) => member.name)).toEqual(['Alice', 'Carol']);

        const [alice, carol] = data.staff;
        expect(alice.weeks[0]).toMatchObject({ warns: 1, notes: 1, minutesOnline: 30 });
        expect(alice.weeks[1]).toMatchObject({ bans: 1, kicks: 1, minutesOnline: 90 });
        expect(alice.weeks[1]).not.toHaveProperty('sanctions');
        expect(alice.total).toMatchObject({ bans: 1, warns: 1, notes: 1, minutesOnline: 120 });
        expect(alice.lastActionTs).toBe(sec(NOW) * 1000);
        expect(alice.lastInGameTs).toBe(sec(NOW - DAY) * 1000);

        expect(carol.total).toMatchObject({ revokes: 1, notes: 1, minutesOnline: 0 });
        expect(carol.lastInGameTs).toBeNull();
    });
});
