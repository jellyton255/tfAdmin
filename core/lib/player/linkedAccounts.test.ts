import { describe, expect, it } from 'vitest';
import { findLinkedPlayers, summarizeSanctions } from './linkedAccounts';
import type { DatabaseActionType, DatabasePlayerType } from '@modules/Database/databaseTypes';

const lic = (n: number) => n.toString(16).padStart(40, '0');
const makePlayer = (n: number, ids: string[], hwids: string[] = [], tsLastConnection = n): DatabasePlayerType => ({
    license: lic(n), ids: [`license:${lic(n)}`, ...ids], hwids,
    displayName: `P${n}`, pureName: `p${n}`, playTime: 1, tsLastConnection, tsJoined: 0,
});
const target = { license: lic(1), ids: [`license:${lic(1)}`, 'discord:111', 'fivem:9', 'ip:10.0.0.1'], hwids: ['hw-a', 'hw-b'] };

describe('findLinkedPlayers', () => {
    it('matches shared identifiers and hwids, skipping ips and the target itself', () => {
        const players = [
            makePlayer(1, ['discord:111'], ['hw-a']),
            makePlayer(2, ['discord:111']),
            makePlayer(3, ['ip:10.0.0.1']),
            makePlayer(4, [], ['hw-b']),
        ];
        const result = findLinkedPlayers(target, players);
        expect(result.matches.map((m) => [m.player.license, m.matchedIds, m.matchedHwids])).toEqual([
            [lic(2), ['discord:111'], []],
            [lic(4), [], ['hw-b']],
        ]);
        expect(result).toMatchObject({ ignoredHwids: [], truncated: false });
    });

    it('ranks identifier matches over hwid matches, then by last connection', () => {
        const players = [
            makePlayer(2, [], ['hw-a', 'hw-b'], 900),
            makePlayer(3, ['fivem:9'], [], 100),
            makePlayer(4, ['fivem:9'], [], 500),
        ];
        expect(findLinkedPlayers(target, players).matches.map((m) => m.player.license)).toEqual([lic(4), lic(3), lic(2)]);
    });

    it('ignores hwids shared by too many players and caps the result', () => {
        const crowd = Array.from({ length: 6 }, (_, i) => makePlayer(10 + i, [], ['hw-a']));
        const linked = makePlayer(2, ['discord:111'], ['hw-a']);
        const result = findLinkedPlayers(target, [...crowd, linked], 50, 5);
        expect(result.ignoredHwids).toEqual(['hw-a']);
        expect(result.matches.map((m) => [m.player.license, m.matchedHwids])).toEqual([[lic(2), []]]);

        const capped = findLinkedPlayers(target, crowd, 3, 25);
        expect(capped.matches).toHaveLength(3);
        expect(capped.truncated).toBe(true);
    });
});

describe('summarizeSanctions', () => {
    const base = { ids: [], playerName: 'x', reason: 'r', author: 'a', timestamp: 0 };
    const revoked = { timestamp: 5, author: 'a' };
    const live = { timestamp: null, author: null };
    it('counts unrevoked actions and flags only live bans', () => {
        const actions: DatabaseActionType[] = [
            { ...base, id: 'B1', type: 'ban', expiration: 50, revocation: live },
            { ...base, id: 'B2', type: 'ban', expiration: false, revocation: revoked },
            { ...base, id: 'W1', type: 'warn', expiration: false, acked: true, revocation: live },
        ];
        expect(summarizeSanctions(actions, 100)).toEqual({ isBanned: false, banCount: 1, warnCount: 1 });
        expect(summarizeSanctions(actions, 10).isBanned).toBe(true);
    });
});
