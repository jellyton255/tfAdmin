import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitializedCtx } from '@modules/WebServer/ctxTypes';
import checkJoin from '@routes/player/checkJoin';
import FxPlayerlist from '@modules/FxPlayerlist';
import { ServerPlayer } from '@lib/player/playerClasses';
import type { DatabaseActionType, DatabasePlayerType } from './databaseTypes';

const license = 'a'.repeat(40);
const historical = {
    externalRef: 'discord:source', sourceUrl: 'https://discord.com/channels/1/2',
    duration: 'Permanent', expirationKnown: true,
};
const base = {
    ids: [`license:${license}`], playerName: 'Player', author: 'Staff', reason: 'Reason',
    timestamp: 1670000000, revocation: { timestamp: null, author: null },
};
let actions: DatabaseActionType[];
let server: ReturnType<Koa['listen']> | undefined;
let player: ServerPlayer | undefined;

beforeEach(() => {
    actions = [];
    const dbPlayer: DatabasePlayerType = {
        license, ids: base.ids, hwids: [], displayName: 'Player', pureName: 'player',
        playTime: 1, tsLastConnection: 1, tsJoined: 1,
    };
    vi.stubGlobal('txConfig', {
        banlist: { enabled: true, templates: [] }, whitelist: { mode: 'disabled' },
        gameFeatures: { hideAdminInPunishments: true },
    });
    vi.stubGlobal('txCore', {
        logger: { server: { write: vi.fn() } },
        metrics: { txRuntime: { banCheckTime: { count: vi.fn() } } },
        translator: { t: (key: string) => key, canonical: 'en' },
        database: {
            isReady: true,
            players: { findOne: () => dbPlayer, update: () => dbPlayer },
            actions: {
                findMany: (_ids: string[], _hwids?: string[], filter?: (action: DatabaseActionType) => boolean) => (
                    filter ? actions.filter(filter) : actions
                ),
            },
        },
    });
});
afterEach(async () => {
    player?.disconnect();
    player = undefined;
    const runningServer = server;
    server = undefined;
    if (runningServer?.listening) await new Promise<void>((resolve, reject) => runningServer.close((error) => error ? reject(error) : resolve()));
    vi.restoreAllMocks();
});

describe('historical records never enforce punishments', () => {
    it('allows a player with a historical permanent ban but still rejects an ordinary permanent ban', async () => {
        actions.push({ ...base, id: 'BHIS-1111', type: 'ban', expiration: false, historical });
        const app = new Koa<InitializedCtx['state'], InitializedCtx>();
        app.use(bodyParser());
        app.use(async (ctx) => {
            ctx.send = (data) => { ctx.body = data; };
            await checkJoin(ctx);
        });
        await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
        const address = server?.address();
        if (!address || typeof address === 'string') throw new Error('No test HTTP address');
        const request = () => fetch(`http://127.0.0.1:${address.port}/checkJoin`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ playerName: 'Player', playerIds: base.ids, playerHwids: [] }),
        }).then((response) => response.json());
        expect(await request()).toEqual({ allow: true });
        actions.push({ ...base, id: 'BLIV-2222', type: 'ban', expiration: false });
        expect(await request()).toMatchObject({ allow: false });
    });

    it('skips a historical warning and delivers the current pending warning on player initialization', async () => {
        actions.push(
            { ...base, id: 'WHIS-1111', type: 'warn', expiration: false, acked: false, historical },
            { ...base, id: 'WLIV-2222', type: 'warn', expiration: false, acked: false },
        );
        const list = new FxPlayerlist();
        const delivered: string[] = [];
        vi.spyOn(list, 'dispatchInitialPlayerData').mockImplementation((_id, warning) => { delivered.push(warning.id); });
        player = new ServerPlayer(7, { name: 'Player', ids: base.ids, hwids: [] }, list);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(delivered).toEqual(['WLIV-2222']);
    });
});
