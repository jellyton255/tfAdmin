import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerPlayer } from '@lib/player/playerClasses';
import type { DatabaseActionType, DatabasePlayerType } from '@modules/Database/databaseTypes';
import { sendJoinAlerts } from './joinAlerts';

const nowSec = () => Math.round(Date.now() / 1000);
const LIC_JOIN = 'a'.repeat(40);
const LIC_ALT = 'b'.repeat(40);

let players: DatabasePlayerType[];
let actions: DatabaseActionType[];
let events: { type: string; data: any }[];

const makePlayer = (license: string, hwids: string[], extra: Partial<DatabasePlayerType> = {}): DatabasePlayerType => ({
    license, ids: [`license:${license}`], hwids,
    displayName: license === LIC_JOIN ? 'Joiner' : 'Banned Alt', pureName: 'x',
    playTime: 1, tsLastConnection: nowSec(), tsJoined: nowSec(), ...extra,
});

const joining = (dbData: DatabasePlayerType) => Object.assign(Object.create(ServerPlayer.prototype), {
    netid: 7,
    displayName: dbData.displayName,
    license: dbData.license,
    idsOnline: dbData.ids,
    hwidsOnline: dbData.hwids,
    dbData,
}) as ServerPlayer;

const banAlt = (expiration: number | false) => {
    actions.push({
        id: 'B1234-5678', type: 'ban', ids: [`license:${LIC_ALT}`], hwids: ['hw-shared'], expiration,
        playerName: 'Banned Alt', reason: 'cheating', author: 'staff', timestamp: nowSec() - 100,
        revocation: { timestamp: null, author: null },
    });
};

beforeEach(() => {
    players = [];
    actions = [];
    events = [];
    vi.stubGlobal('txCore', {
        database: {
            players: { findMany: (filter: (p: DatabasePlayerType) => boolean) => players.filter(filter) },
            actions: { findMany: (ids: string[]) => actions.filter((a) => a.ids.some((id) => ids.includes(id))) },
        },
        adminStore: { getOnlineAdminNetIds: () => [1, 2] },
        fxRunner: { sendEvent: (type: string, data: any) => events.push({ type, data }) },
    });
});

describe('sendJoinAlerts', () => {
    it('says nothing for an unwatched player with no banned links', () => {
        const joiner = makePlayer(LIC_JOIN, ['hw-shared']);
        players.push(joiner, makePlayer(LIC_ALT, ['hw-shared']));
        sendJoinAlerts(joining(joiner));
        expect(events).toEqual([]);
    });

    it('alerts staff when a watched player joins', () => {
        const joiner = makePlayer(LIC_JOIN, [], { watch: { reason: 'possible alt', author: 'julian', ts: 100 } });
        players.push(joiner);
        sendJoinAlerts(joining(joiner));
        expect(events).toEqual([{
            type: 'playerWatchJoined',
            data: {
                staffNetIds: [1, 2], netid: 7, displayName: 'Joiner', license: LIC_JOIN,
                reason: 'possible alt', watchedBy: 'julian', watchedAt: 100_000,
            },
        }]);
    });

    it('alerts staff when a linked account has an active ban', () => {
        const joiner = makePlayer(LIC_JOIN, ['hw-shared', 'hw-own']);
        players.push(joiner, makePlayer(LIC_ALT, ['hw-shared']));
        banAlt(false);
        sendJoinAlerts(joining(joiner));
        expect(events).toEqual([{
            type: 'playerPossibleBanEvasion',
            data: {
                staffNetIds: [1, 2], netid: 7, displayName: 'Joiner', license: LIC_JOIN,
                bannedLinkCount: 1,
                bannedLinks: [{ license: LIC_ALT, displayName: 'Banned Alt', matchedIdTypes: [], matchedHwidCount: 1 }],
            },
        }]);
    });

    it('ignores expired bans on linked accounts', () => {
        const joiner = makePlayer(LIC_JOIN, ['hw-shared']);
        players.push(joiner, makePlayer(LIC_ALT, ['hw-shared']));
        banAlt(nowSec() - 10);
        sendJoinAlerts(joining(joiner));
        expect(events).toEqual([]);
    });
});
