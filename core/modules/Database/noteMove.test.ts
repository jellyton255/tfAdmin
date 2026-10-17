import { describe, expect, it } from 'vitest';
import { applyNoteMoves, planNoteMoves } from './noteMove';
import type { DatabaseActionType, DatabaseDataType, DatabasePlayerType } from './databaseTypes';

const LICENSE = 'a'.repeat(40);

const action = (id: string, type: 'ban' | 'warn' | 'kick', author: string, timestamp: number) => ({
    id, type, author, timestamp,
    ids: [`license:${LICENSE}`],
    playerName: 'Bob',
    reason: 'r',
    expiration: false,
    acked: false,
    revocation: { timestamp: null, author: null },
}) as DatabaseActionType;

const player = (notes: { id: string; text: string; author: string; ts: number }[]) => ({
    license: LICENSE,
    ids: [`license:${LICENSE}`],
    hwids: [],
    displayName: 'Bob',
    pureName: 'bob',
    playTime: 0,
    tsLastConnection: 0,
    tsJoined: 0,
    noteHistory: notes,
}) as DatabasePlayerType;

describe('planNoteMoves', () => {
    const actions = [
        action('BAAA-1111', 'ban', 'Julian', 10_000),
        action('WBBB-2222', 'warn', 'Ana', 10_100),
        action('WCCC-3333', 'warn', 'Ana', 10_200),
        action('KDDD-4444', 'kick', 'Julian', 20_000),
    ];

    it('moves a note that names exactly one of the player\'s actions', () => {
        const moves = planNoteMoves([player([{ id: 'n1', text: 'see baaa-1111, cheating', author: 'Ana', ts: 99_999 }])], actions);
        expect(moves).toMatchObject([{ actionId: 'BAAA-1111', rule: 'id' }]);
    });

    it('keeps a note that names two actions or another player\'s action', () => {
        const two = player([{ id: 'n1', text: 'BAAA-1111 and WBBB-2222', author: 'Julian', ts: 10_000 }]);
        const other = player([{ id: 'n2', text: 'like BZZZ-9999', author: 'Julian', ts: 10_000 }]);
        expect(planNoteMoves([two, other], actions)).toEqual([]);
    });

    it('moves by author and time only when one ban or warn fits', () => {
        const moves = planNoteMoves([player([
            { id: 'n1', text: 'used a mod menu', author: 'Julian (via api:Bot)', ts: 10_500 },
            { id: 'n2', text: 'two warns nearby', author: 'Ana', ts: 10_150 },
            { id: 'n3', text: 'kick only nearby', author: 'Julian', ts: 20_100 },
            { id: 'n4', text: 'too late', author: 'Julian', ts: 10_000 + 901 },
            { id: 'n5', text: 'legacy', author: 'unknown', ts: 10_000 },
            { id: 'n6', text: 'RDM - 10/14/24 - Ford   Combat logging - 10/21/24', author: 'Julian', ts: 10_010 },
            { id: 'n7', text: 'first entry\nsecond entry', author: 'Julian', ts: 10_020 },
        ])], actions);
        expect(moves.map((m) => [m.note.id, m.actionId, m.rule])).toEqual([['n1', 'BAAA-1111', 'time']]);
    });

    it('applies moves keeping author, time and id, and empties the player history', () => {
        const data = {
            version: 6,
            players: [player([{ id: 'n1', text: 'BAAA-1111', author: 'Ana', ts: 5 }])],
            actions: [action('BAAA-1111', 'ban', 'Julian', 10_000)],
            whitelistApprovals: [],
            whitelistRequests: [],
        } as DatabaseDataType;
        applyNoteMoves(data, planNoteMoves(data.players, data.actions));
        expect(data.actions[0].notes).toEqual([{ id: 'n1', text: 'BAAA-1111', author: 'Ana', ts: 5 }]);
        expect(data.players[0].noteHistory).toBeUndefined();
    });
});
